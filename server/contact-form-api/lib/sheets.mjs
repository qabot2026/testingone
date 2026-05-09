/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
// Default includes extra columns for city/ip/repeated/user queries (A–N).
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:N").trim();
const DEDUP_LOOKBACK_ROWS = Math.max(
    10,
    Number.parseInt(process.env.SHEETS_DEDUP_LOOKBACK_ROWS || "500", 10) || 500
);
const DEDUP_WINDOW_MS = Math.max(
    10_000,
    Number.parseInt(process.env.SHEETS_DEDUP_WINDOW_MS || String(10 * 60 * 1000), 10)
        || (10 * 60 * 1000)
);

const SPREADSHEET_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * Google Sheets `append` uses the range width as the table width. `Sheet1!A:H` drops
 * any column past H (e.g. channel in I). We keep the tab from env but append with A:Z.
 * @param {string} raw same as `SHEETS_RANGE` / default
 */
function appendRangeFullWidth(raw) {
    const s = (raw || "").trim();
    if (!s) {
        return "Sheet1!A:Z";
    }
    const bang = s.indexOf("!");
    if (bang === -1) {
        return `${s}!A:Z`;
    }
    return `${s.slice(0, bang)}!A:Z`;
}

function tabNameFromRange(raw) {
    const s = (raw || "").trim();
    if (!s) {
        return "Sheet1";
    }
    const bang = s.indexOf("!");
    if (bang === -1) {
        return s;
    }
    return s.slice(0, bang) || "Sheet1";
}

/** @param {string} s */
function mobileDigitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
}

/** Values API often returns numbers (e.g. phone) instead of strings — normalize for compares + blank checks. */
function sheetCellString_(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    if (typeof v === "boolean") {
        return v ? "true" : "false";
    }
    return "";
}

/** @param {unknown} rawCell sheet cell value before coercion */
function isBlankSheetCell_(rawCell) {
    return !sheetCellString_(rawCell);
}

/**
 * Dedupe strategy:
 * - Primary key: clientSessionId when session id exists (only one Sheet row per session)
 * - Used for "Repeated" flag: mobile digits across different sessions
 *
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 */
function buildDedupeKey(row) {
    const sid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    return sid || "";
}

/**
 * Scan recent sheet rows for:
 * - duplicate for the same session id (only one row per session id)
 * - repeated: same mobile already exists under a different session id
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 * @returns {Promise<{ duplicate: boolean, matchedRowNumber: number, repeatedAcrossSessions: boolean }>}
 */
async function scanSheetTailForDedupeAndRepeat_(sheets, row) {
    const key = buildDedupeKey(row);
    if (!key) {
        return { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions: false };
    }
    const tab = tabNameFromRange(RANGE);
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        // Use a wide range so dedupe works even if your sheet has more columns than expected
        // or the session id column was moved.
        range: `${tab}!A:Z`
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    if (!rows.length) {
        return { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions: false };
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const tailOffset = rows.length - tail.length; // 0-based offset into full sheet rows
    const incomingSid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    const incomingMobileDigits = mobileDigitsOnly(row.mobile);
    let repeatedAcrossSessions = false;

    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingMobile = sheetCellString_(r[3]);
        const existingSid = sheetCellString_(r[5]);
        const rowNumber = tailOffset + i + 1; // 1-based row number in the sheet

        // If we have a session id, enforce "only once per session".
        if (incomingSid && existingSid && incomingSid === existingSid) {
            return { duplicate: true, matchedRowNumber: rowNumber, repeatedAcrossSessions };
        }
        // Some sheets have different column ordering; scan the whole row for the session id string.
        if (incomingSid && Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = sheetCellString_(r[c]);
                if (cell && cell === incomingSid) {
                    return { duplicate: true, matchedRowNumber: rowNumber, repeatedAcrossSessions };
                }
            }
        }

        // Repeated (same mobile, different session).
        const existingMobileDigits = mobileDigitsOnly(existingMobile);
        if (incomingMobileDigits && existingMobileDigits && incomingMobileDigits === existingMobileDigits) {
            if (incomingSid && existingSid && incomingSid !== existingSid) {
                repeatedAcrossSessions = true;
            }
        }
    }

    return { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions };
}

function splitCsvValues_(raw) {
    const s = typeof raw === "string" ? raw : "";
    if (!s.trim()) {
        return [];
    }
    return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
}

function mergeCsvUnique_(existingCsv, incomingCsv, limit = 40) {
    const existing = splitCsvValues_(existingCsv);
    const incoming = splitCsvValues_(incomingCsv);
    if (!incoming.length) {
        return existing.join(", ");
    }
    const seen = new Set();
    const out = [];
    // Preserve order: existing first, then add new ones.
    for (const v of existing) {
        const k = v.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push(v);
        }
    }
    for (const v of incoming) {
        const k = v.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push(v);
        }
    }
    return out.slice(0, Math.max(1, limit)).join(", ");
}

/**
 * If we already have a row for this session id (from chat mobile sync), fill in missing fields
 * from the later contact-form submit rather than dropping the write.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber 1-based sheet row
 * @param {{ formId: string, name: string, mobile: string, email: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string }} incoming
 * @param {{ preferIncomingContact?: boolean }} [options] when true (contact-form POST), B–E use incoming whenever non-empty; chat/sync fills blanks only.
 */
/** @returns {Promise<boolean>} true if Sheets batchUpdate ran */
async function updateExistingSessionRow_(sheets, tab, rowNumber, incoming, options = {}) {
    if (!rowNumber || rowNumber < 1) {
        return false;
    }
    const preferIncomingContact = !!(options && options.preferIncomingContact);
    const got = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${rowNumber}:N${rowNumber}`
    });
    const row = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];

    /** B–E: contact-form submits should overwrite an older chat-sync row when values are present. */
    const contactPatchFor = (v, colIdx) => {
        const s = typeof v === "string" ? v.trim() : "";
        if (!s) {
            return "";
        }
        if (preferIncomingContact) {
            return s;
        }
        return isBlankSheetCell_(row[colIdx]) ? s : "";
    };

    const formId = contactPatchFor(typeof incoming.formId === "string" ? incoming.formId : "", 1);
    const name = contactPatchFor(typeof incoming.name === "string" ? incoming.name : "", 2);
    const mobile = contactPatchFor(typeof incoming.mobile === "string" ? incoming.mobile : "", 3);
    const email = contactPatchFor(typeof incoming.email === "string" ? incoming.email : "", 4);
    const browserName =
        incoming.browserName && isBlankSheetCell_(row[6]) ? incoming.browserName.trim() : "";
    const deviceType =
        incoming.deviceType && isBlankSheetCell_(row[7]) ? incoming.deviceType.trim() : "";
    const channel =
        incoming.channel && isBlankSheetCell_(row[8]) ? incoming.channel.trim() : "";
    const fileLinks =
        incoming.fileLinks && isBlankSheetCell_(row[9]) ? incoming.fileLinks.trim() : "";
    const city =
        incoming.city && isBlankSheetCell_(row[10]) ? incoming.city.trim() : "";
    const ip =
        incoming.ip && isBlankSheetCell_(row[11]) ? incoming.ip.trim() : "";
    const existingQueries = sheetCellString_(row[13]);
    const mergedQueries = mergeCsvUnique_(existingQueries, incoming.userQueriesCsv || "", 200);
    const userQueriesCsv = mergedQueries && mergedQueries !== existingQueries ? mergedQueries : "";

    /** @type {Array<{ range: string, values: string[][] }>} */
    const data = [];
    if (formId) data.push({ range: `${tab}!B${rowNumber}`, values: [[formId]] });
    if (name) data.push({ range: `${tab}!C${rowNumber}`, values: [[name]] });
    if (mobile) data.push({ range: `${tab}!D${rowNumber}`, values: [[mobile]] });
    if (email) data.push({ range: `${tab}!E${rowNumber}`, values: [[email]] });
    if (browserName) data.push({ range: `${tab}!G${rowNumber}`, values: [[browserName]] });
    if (deviceType) data.push({ range: `${tab}!H${rowNumber}`, values: [[deviceType]] });
    if (channel) data.push({ range: `${tab}!I${rowNumber}`, values: [[channel]] });
    if (fileLinks) data.push({ range: `${tab}!J${rowNumber}`, values: [[fileLinks]] });
    if (city) data.push({ range: `${tab}!K${rowNumber}`, values: [[city]] });
    if (ip) data.push({ range: `${tab}!L${rowNumber}`, values: [[ip]] });
    if (userQueriesCsv) data.push({ range: `${tab}!N${rowNumber}`, values: [[userQueriesCsv]] });

    if (!data.length) {
        if (preferIncomingContact) {
            console.warn(
                "[contact-form-api] Sheets duplicate-session row update applied no patches (incoming contact/query fields empty or unchanged)."
            );
        }
        return false;
    }
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data
        }
    });
    return true;
}

async function getSheetsAuthClient() {
    const key = getServiceAccountCredentials();
    if (!key) {
        throw new Error(
            [
                "No Google service account JSON for Sheets.",
                "In Railway, set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_CONFIG) to the full JSON from",
                "Firebase Console → Project settings → Service accounts → Generate new private key.",
                "Same value as for Firestore; do not rely on default credentials on Railway."
            ].join(" ")
        );
    }
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: SPREADSHEET_SCOPES
    });
    return auth.getClient();
}

/**
 * Columns A–M:
 * A iso
 * B formId
 * C name
 * D mobile
 * E email
 * F clientSessionId
 * G browserName
 * H deviceType
 * I channel (web|whatsapp)
 * J file_links (Drive URLs, comma-separated, or empty)
 * K city
 * L ip
 * M repeated (Yes|No)
 * N user_queries (comma-separated)
 *
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string }} row
 * @param {{ preferIncomingContact?: boolean }} [opts] set on official contact-form submissions so duplicate rows update B–E with form values (not chat placeholders).
 * @returns {Promise<{ action: "appended"|"duplicate_updated"|"duplicate_noop", patched: boolean, tab: string }>}
 */
export async function appendContactRowToSheet(row, opts) {
    const tabResolved = tabNameFromRange(RANGE);
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    // Prevent double-write when chat mobile sync and form submission both hit Sheets,
    // but *update* the existing session row when the contact-form later provides name/email.
    const scan = await scanSheetTailForDedupeAndRepeat_(sheets, row);
    const tab = tabNameFromRange(RANGE);
    if (scan.duplicate) {
        const patched = await updateExistingSessionRow_(sheets, tab, scan.matchedRowNumber, row, {
            preferIncomingContact: !!(opts && opts.preferIncomingContact)
        });
        const prefer = !!(opts && opts.preferIncomingContact);
        if (prefer && !patched) {
            console.warn(
                "[contact-form-api] Contact form Sheets write: duplicate session row matched but batchUpdate skipped (nothing changed). ",
                `tab="${tabResolved}" spreadsheet tail …${String(SPREADSHEET_ID).slice(-8)}.`,
                'Confirm SHEETS_RANGE tab matches your open sheet; ensure POST includes name/mobile/email in body or client_context.'
            );
        }
        return {
            action: patched ? "duplicate_updated" : "duplicate_noop",
            patched,
            tab: tabResolved
        };
    }

    const ch = typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : "web";
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
    const city = typeof row.city === "string" ? row.city.trim() : "";
    const ip = typeof row.ip === "string" ? row.ip.trim() : "";
    const userQueriesCsv = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
    const repeated = scan.repeatedAcrossSessions ? "Yes" : "No";
    const values = [[
        row.iso,
        row.formId,
        row.name,
        row.mobile,
        row.email,
        row.clientSessionId,
        row.browserName,
        row.deviceType,
        ch,
        fileLinks,
        city,
        ip,
        repeated,
        userQueriesCsv
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: appendRangeFullWidth(RANGE),
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
    return { action: "appended", patched: true, tab: tabResolved };
}

/**
 * Find 1-based row number whose column F (or any cell) matches session id.
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {string} sessionId
 */
async function findSessionRowNumberBySessionId_(sheets, tab, sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid) {
        return 0;
    }
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A:Z`
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    if (!rows.length) {
        return 0;
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const tailOffset = rows.length - tail.length;
    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingSid = sheetCellString_(r[5]);
        if (existingSid === sid) {
            return tailOffset + i + 1;
        }
        if (Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = sheetCellString_(r[c]);
                if (cell && cell === sid) {
                    return tailOffset + i + 1;
                }
            }
        }
    }
    return 0;
}

/**
 * Merge latest user_queries into Column N for this session, or append a minimal row if none exists.
 * Used for live chat query sync without requiring another form POST.
 *
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string }} row
 */
export async function upsertSessionQueriesInSheet(row) {
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const incomingQ = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
    if (!incomingQ) {
        return;
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);
    const sid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    if (!sid) {
        throw new Error("Missing clientSessionId");
    }

    const rowNumber = await findSessionRowNumberBySessionId_(sheets, tab, sid);
    if (rowNumber > 0) {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A${rowNumber}:N${rowNumber}`
        });
        const r0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const existingCsv = sheetCellString_(r0[13]);
        const merged = mergeCsvUnique_(existingCsv, incomingQ, 200);
        if (merged !== existingCsv) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: "USER_ENTERED",
                    data: [{ range: `${tab}!N${rowNumber}`, values: [[merged]] }]
                }
            });
        }
        // Chat may append a row on mobile first (empty C/E), then capture name/email later; session
        // query sync still hits this path — fill blank contact columns without touching N again.
        await updateExistingSessionRow_(
            sheets,
            tab,
            rowNumber,
            {
                formId: typeof row.formId === "string" ? row.formId : "",
                name: typeof row.name === "string" ? row.name : "",
                mobile: typeof row.mobile === "string" ? row.mobile : "",
                email: typeof row.email === "string" ? row.email : "",
                browserName: typeof row.browserName === "string" ? row.browserName : "",
                deviceType: typeof row.deviceType === "string" ? row.deviceType : "",
                channel: typeof row.channel === "string" ? row.channel : "",
                fileLinks: typeof row.fileLinks === "string" ? row.fileLinks : "",
                city: typeof row.city === "string" ? row.city : "",
                ip: typeof row.ip === "string" ? row.ip : "",
                userQueriesCsv: ""
            },
            {}
        );
        return;
    }

    await appendContactRowToSheet(row);
}
