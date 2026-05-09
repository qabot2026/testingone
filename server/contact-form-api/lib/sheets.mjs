/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
// Default includes extra columns for repeated/source URL/appointments/drive links (A–Q).
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:Q").trim();
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
 * Force append into our schema columns (A–N).
 *
 * We previously used `A:Z` to avoid truncation when env was set to `A:H`, but `values.append`
 * may choose a "table" anchored later in the sheet and append at an unexpected start column
 * (e.g. `W:AJ`), making the lead look "missing" in A–N.
 *
 * @param {string} raw same as `SHEETS_RANGE` / default
 */
function appendRangeSchemaWidth_(raw) {
    const tab = tabNameFromRange(raw);
    return `${tab}!A:Q`;
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

function normalizedHeaderKey_(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function columnLetterFromIndex_(idx0) {
    let n = idx0 + 1; // 1-based
    let out = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

let headerCache_ = { tab: "", at: 0, mobileColIdx: 3, mobileColLetter: "D" };
const HEADER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Detect mobile column position by header row.
 * Falls back to the default schema (column D) if not found.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getMobileColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (headerCache_.tab === tab && now - headerCache_.at < HEADER_CACHE_TTL_MS) {
        return headerCache_;
    }
    let mobileColIdx = 3;
    let mobileColLetter = "D";
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const want = new Set([
            "mobile",
            "phone",
            "phonenumber",
            "mobile_number",
            "mobilenumber",
            "contact",
            "contactnumber",
            "contactno",
            "whatsapp",
            "whatsappnumber"
        ].map(normalizedHeaderKey_));
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && want.has(k)) {
                mobileColIdx = i;
                mobileColLetter = columnLetterFromIndex_(i);
                break;
            }
        }
    } catch {
        // ignore
    }
    headerCache_ = { tab, at: now, mobileColIdx, mobileColLetter };
    return headerCache_;
}

let repeatedHeaderCache_ = { tab: "", at: 0, repeatedColIdx: 12, repeatedColLetter: "M" };

/**
 * Detect "Repeated" column position by header row.
 * Falls back to the default schema (column M) if not found.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getRepeatedColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (repeatedHeaderCache_.tab === tab && now - repeatedHeaderCache_.at < HEADER_CACHE_TTL_MS) {
        return repeatedHeaderCache_;
    }
    let repeatedColIdx = 12;
    let repeatedColLetter = "M";
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const want = new Set(
            [
                "repeated",
                "repeat",
                "isrepeated",
                "repeatuser",
                "repeateduser",
                "duplicate",
                "duplicatelead",
                "existing",
                "existinguser"
            ].map(normalizedHeaderKey_)
        );
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && want.has(k)) {
                repeatedColIdx = i;
                repeatedColLetter = columnLetterFromIndex_(i);
                break;
            }
        }
    } catch {
        // ignore
    }
    repeatedHeaderCache_ = { tab, at: now, repeatedColIdx, repeatedColLetter };
    return repeatedHeaderCache_;
}

/** @param {string} s */
function mobileDigitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
}

/**
 * Normalize a phone-like cell to a comparable key.
 * - Extract digits (handles "+91 98..." etc.)
 * - If it's longer than 10 digits, compare by the last 10 digits (India-centric; avoids country code mismatch)
 * - Attempt to expand scientific notation strings (e.g. "9.19876E+11") to digits when safe
 *
 * @param {unknown} rawCell
 */
function mobileKeyFromCell_(rawCell) {
    const s0 = sheetCellString_(rawCell);
    if (!s0) {
        return "";
    }
    let s = s0;
    // Sheets sometimes stores long numbers in scientific notation (string or number).
    if (/[eE][+-]?\d+/.test(s)) {
        const n = Number(s);
        // Avoid tiny/invalid parses; 9 digits minimum to resemble a phone.
        if (Number.isFinite(n) && n >= 1e8 && n <= 1e15) {
            // toFixed(0) expands without decimals; may still be rounded if the sheet already lost precision.
            s = n.toFixed(0);
        }
    }
    let digits = mobileDigitsOnly(s);
    if (!digits) {
        return "";
    }
    // Prefer comparing by last 10 digits to ignore country codes / prefixes.
    if (digits.length > 10) {
        digits = digits.slice(-10);
    }
    return digits;
}

/** Best-effort mobile key from a whole sheet row (handles column reorders). @param {unknown[]} r @param {number} mobileColIdx */
function mobileKeyFromRow_(r, mobileColIdx) {
    if (!Array.isArray(r) || !r.length) {
        return "";
    }
    const idx = typeof mobileColIdx === "number" && Number.isFinite(mobileColIdx)
        ? mobileColIdx
        : 3;
    // Prefer detected mobile column first.
    const primary = mobileKeyFromCell_(r[idx]);
    if (primary) {
        return primary;
    }
    // Fallback: scan all cells for any phone-like value.
    let best = "";
    for (let i = 0; i < r.length; i += 1) {
        const k = mobileKeyFromCell_(r[i]);
        if (k.length > best.length) {
            best = k;
        }
        if (best.length === 10) {
            // Can't do better than a full 10-digit key.
            return best;
        }
    }
    return best;
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

/** Coerce outbound row cells to plain strings — API payloads must not contain `undefined` (can break inserts). */
function sheetOutboundCell_(v) {
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
    return String(v);
}

/** @param {import("googleapis").gaxios.GaxiosResponse<import("googleapis").sheets_v4.Schema$BatchUpdateValuesResponse> | null | undefined} batchRes */
function googleBatchSummaryFromResponse_(batchRes) {
    const br = batchRes && batchRes.data ? batchRes.data : {};
    const updatedRanges = Array.isArray(br.responses)
        ? br.responses.map((r) => (r && typeof r.updatedRange === "string" ? r.updatedRange : "")).filter(Boolean)
        : [];
    return {
        totalUpdatedCells:
            typeof br.totalUpdatedCells === "number"
                ? br.totalUpdatedCells
                : undefined,
        totalUpdatedRows:
            typeof br.totalUpdatedRows === "number"
                ? br.totalUpdatedRows
                : undefined,
        updatedRanges
    };
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
 * - repeated: same mobile already exists anywhere else in the sheet tail
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 * @returns {Promise<{ duplicate: boolean, matchedRowNumber: number, repeatedAcrossSessions: boolean }>}
 */
async function scanSheetTailForDedupeAndRepeat_(sheets, row) {
    const key = buildDedupeKey(row);
    const tab = tabNameFromRange(RANGE);
    const mobileCol = await getMobileColumnInfo_(sheets, tab);
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
    const incomingMobileDigits = mobileKeyFromCell_(row.mobile);
    let repeatedAcrossSessions = false;

    // Repeated check: scan the full sheet, not just the tail.
    // Semantics: "Yes" means the mobile already exists in the sheet (including the current session row
    // when strict session dedupe updates an existing row).
    if (incomingMobileDigits) {
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i] || [];
            const existingKey = mobileKeyFromRow_(/** @type {unknown[]} */ (r), mobileCol.mobileColIdx);
            if (!existingKey || existingKey !== incomingMobileDigits) {
                continue;
            }
            repeatedAcrossSessions = true;
            break;
        }
    }

    // Fallback: scan the entire mobile column directly (more reliable for very large sheets).
    // This ignores column reorders, but if your sheet follows the documented schema (mobile in column D),
    // it avoids missing repeats due to API truncation / row-width quirks.
    if (incomingMobileDigits && !repeatedAcrossSessions) {
        try {
            const col = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${tab}!${mobileCol.mobileColLetter}:${mobileCol.mobileColLetter}`
            });
            const colRows = Array.isArray(col.data.values) ? col.data.values : [];
            for (let i = 0; i < colRows.length; i += 1) {
                const cell = colRows[i] && colRows[i][0] !== undefined ? colRows[i][0] : "";
                const existingKey = mobileKeyFromCell_(cell);
                if (existingKey && existingKey === incomingMobileDigits) {
                    repeatedAcrossSessions = true;
                    break;
                }
            }
        } catch {
            /* ignore: keep repeatedAcrossSessions from the primary scan */
        }
    }

    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingSid = sheetCellString_(r[5]);
        const rowNumber = tailOffset + i + 1; // 1-based row number in the sheet

        // If we have a session id, enforce "only once per session".
        if (key && incomingSid && existingSid && incomingSid === existingSid) {
            return { duplicate: true, matchedRowNumber: rowNumber, repeatedAcrossSessions };
        }
        // Some sheets have different column ordering; scan the whole row for the session id string.
        if (key && incomingSid && Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = sheetCellString_(r[c]);
                if (cell && cell === incomingSid) {
                    return { duplicate: true, matchedRowNumber: rowNumber, repeatedAcrossSessions };
                }
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
 * @param {{ formId: string, name: string, mobile: string, email: string, browserName: string, deviceType: string, channel: string, repeated?: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string }} incoming
 * @param {{ preferIncomingContact?: boolean }} [options] when true (contact-form POST), B–E use incoming whenever non-empty; chat/sync fills blanks only.
 */
/** @returns {Promise<{ applied: boolean, googleBatch?: { totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } }>} */
async function updateExistingSessionRow_(sheets, tab, rowNumber, incoming, options = {}) {
    if (!rowNumber || rowNumber < 1) {
        return { applied: false };
    }
    const preferIncomingContact = !!(options && options.preferIncomingContact);
    const repeatedCol = await getRepeatedColumnInfo_(sheets, tab);
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
    const repeatedIncoming = typeof incoming.repeated === "string" ? incoming.repeated.trim() : "";
    const existingRepeated = sheetCellString_(row[12]);
    const repeated =
        repeatedIncoming && repeatedIncoming !== existingRepeated ? repeatedIncoming : "";
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
    if (repeated) data.push({ range: `${tab}!${repeatedCol.repeatedColLetter}${rowNumber}`, values: [[repeated]] });
    if (userQueriesCsv) data.push({ range: `${tab}!N${rowNumber}`, values: [[userQueriesCsv]] });

    if (!data.length) {
        if (preferIncomingContact) {
            console.warn(
                "[contact-form-api] Sheets duplicate-session row update applied no patches (incoming contact/query fields empty or unchanged)."
            );
        }
        return { applied: false };
    }
    const batchRes = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data
        }
    });
    return {
        applied: true,
        googleBatch: googleBatchSummaryFromResponse_(batchRes)
    };
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

let sheetSchemaCache_ = { tab: "", at: 0, byKey: /** @type {Record<string, number>} */ ({}) };

async function getHeaderIndexMap_(sheets, tab) {
    const now = Date.now();
    if (sheetSchemaCache_.tab === tab && now - sheetSchemaCache_.at < HEADER_CACHE_TTL_MS) {
        return sheetSchemaCache_.byKey;
    }
    /** @type {Record<string, number>} */
    const byKey = {};
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && byKey[k] === undefined) {
                byKey[k] = i;
            }
        }
    } catch {
        // ignore
    }
    sheetSchemaCache_ = { tab, at: now, byKey };
    return byKey;
}

function pickHeaderIndex_(map, aliases, fallbackIdx) {
    for (let i = 0; i < aliases.length; i += 1) {
        const k = normalizedHeaderKey_(aliases[i]);
        if (k && map[k] !== undefined) {
            return map[k];
        }
    }
    return fallbackIdx;
}

function rowNumberFromUpdatedRange_(updatedRange) {
    const s = typeof updatedRange === "string" ? updatedRange : "";
    const m = s.match(/!([A-Z]+)(\d+)(?::[A-Z]+(\d+))?$/);
    const rowNumber = m && m[2] ? Number.parseInt(m[2], 10) : 0;
    return Number.isFinite(rowNumber) ? rowNumber : 0;
}

async function writeLeadRowByHeader_(sheets, tab, rowNumber, lead) {
    if (!rowNumber) {
        return;
    }
    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const getIdx = (aliases, fallbackIdx) => pickHeaderIndex_(headerMap, aliases, fallbackIdx);

    const col = (idx0) => columnLetterFromIndex_(idx0);

    const updates = [];
    const put = (aliases, fallbackIdx, value) => {
        const v = sheetOutboundCell_(value);
        const idx0 = getIdx(aliases, fallbackIdx);
        updates.push({ range: `${tab}!${col(idx0)}${rowNumber}`, values: [[v]] });
    };

    // Prefer your declared A–Q schema order, but still match by header aliases when columns moved.
    put(["convdateandtime", "conversiondatetime", "date", "datetime", "timestamp", "submittedat"], 0, lead.iso);
    put(["formid", "form_id"], 1, lead.formId);
    put(["name"], 2, lead.name);
    put(["mobile", "phone", "phonenumber", "mobilenumber", "mobile_number"], 3, lead.mobile);
    put(["email"], 4, lead.email);
    put(["sessionid", "session", "sessioni id", "clientsessionid", "client_session_id"], 5, lead.clientSessionId);
    put(["device", "devicetype"], 6, lead.deviceType);
    put(["browser", "browsername"], 7, lead.browserName);
    put(["channel"], 8, lead.channel);
    put(["city"], 9, lead.city);
    put(["ip", "ipaddress", "ip_address"], 10, lead.ip);
    put(["repeateduser", "repeated", "duplicate", "existinguser"], 11, lead.repeated);
    put(["sourceurl", "source_url", "url", "pageurl"], 12, lead.sourceUrl);
    put(["appointmentbooked", "booked", "appointment"], 13, lead.appointmentBooked);
    put(["appointmentdate"], 14, lead.appointmentDate);
    put(["appointmenttime"], 15, lead.appointmentTime);
    put(["drivefilelink", "drive file link", "drivefile", "filelink", "filelinks", "drivelink"], 16, lead.driveFileLink);

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates
        }
    });
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
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, sourceUrl?: string, appointmentBooked?: string, appointmentDate?: string, appointmentTime?: string, userQueriesCsv?: string }} row
 * @param {{ preferIncomingContact?: boolean, skipSessionDedup?: boolean }} [opts] `skipSessionDedup` (with `preferIncomingContact`) skips “one row per session” and always appends — default for main contact-form POST.
 * @returns {Promise<{ action: "appended"|"duplicate_updated"|"duplicate_noop", patched: boolean, tab: string, appendRangeUsed?: string, sheetRowNumber?: number, googleAppend?: { updatedRange?: string, updatedRows?: number, spreadsheetId?: string }, googleBatch?: { totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } }>}
 */
export async function appendContactRowToSheet(row, opts) {
    const tabResolved = tabNameFromRange(RANGE);
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const preferIncoming = !!(opts && opts.preferIncomingContact);
    const skipSessionDedup =
        !!(opts && opts.skipSessionDedup)
        && preferIncoming
        && typeof row.clientSessionId === "string"
        && row.clientSessionId.trim();

    // Prevent double-write when chat mobile sync and form submission both hit Sheets,
    // but *update* the existing session row when the contact-form later provides name/email.
    const scanFull = await scanSheetTailForDedupeAndRepeat_(sheets, row);
    const scan = skipSessionDedup
        ? { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions: scanFull.repeatedAcrossSessions }
        : scanFull;
    const tab = tabNameFromRange(RANGE);
    const appendRangeUsed = appendRangeSchemaWidth_(RANGE);
    if (scan.duplicate) {
        const repeated = scanFull.repeatedAcrossSessions ? "Yes" : "No";
        const up = await updateExistingSessionRow_(sheets, tab, scan.matchedRowNumber, row, {
            preferIncomingContact: !!(opts && opts.preferIncomingContact),
            repeated
        });
        const patched = !!(up && up.applied);
        const prefer = !!(opts && opts.preferIncomingContact);
        if (prefer && !patched) {
            console.warn(
                "[contact-form-api] Contact form Sheets write: duplicate session row matched but batchUpdate skipped (nothing changed). ",
                `tab="${tabResolved}" row=${scan.matchedRowNumber} spreadsheet tail …${String(SPREADSHEET_ID).slice(-8)}.`,
                'Confirm SHEETS_RANGE tab matches your open sheet; ensure POST includes name/mobile/email in body or client_context.'
            );
        }
        return {
            action: patched ? "duplicate_updated" : "duplicate_noop",
            patched,
            tab: tabResolved,
            appendRangeUsed,
            sheetRowNumber: scan.matchedRowNumber,
            googleBatch: up.googleBatch
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
    const sourceUrl = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const appointmentBooked = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const userQueriesCsv = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
    const repeated = scanFull.repeatedAcrossSessions ? "Yes" : "No";
    // Append A–Q values directly (matches your declared sheet schema), then optionally correct by headers.
    // This makes Sheets writes robust even if header-based patching fails.
    const values = [[
        sheetOutboundCell_(row.iso), // A Conv. Date and Time
        sheetOutboundCell_(row.formId), // B Form ID
        sheetOutboundCell_(row.name), // C Name
        sheetOutboundCell_(row.mobile), // D Mobile
        sheetOutboundCell_(row.email), // E Email
        sheetOutboundCell_(row.clientSessionId), // F SessionI ID
        sheetOutboundCell_(row.deviceType), // G Device
        sheetOutboundCell_(row.browserName), // H Browser
        sheetOutboundCell_(ch), // I Channel
        sheetOutboundCell_(city), // J City
        sheetOutboundCell_(ip), // K IP Address
        sheetOutboundCell_(repeated), // L Repeated User
        sheetOutboundCell_(sourceUrl), // M Source URL
        sheetOutboundCell_(appointmentBooked), // N Appointment Booked
        sheetOutboundCell_(appointmentDate), // O Appointment Date
        sheetOutboundCell_(appointmentTime), // P Appointment Time
        sheetOutboundCell_(fileLinks) // Q Drive file link
    ]];
    const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: appendRangeUsed,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
    const up = appendRes && appendRes.data && appendRes.data.updates ? appendRes.data.updates : {};
    /** @type {{ updatedRange?: string, updatedRows?: number, spreadsheetId?: string }} */
    const googleAppend = {};
    if (typeof up.updatedRange === "string") {
        googleAppend.updatedRange = up.updatedRange;
    }
    if (typeof up.updatedRows === "number") {
        googleAppend.updatedRows = up.updatedRows;
    }
    if (typeof up.spreadsheetId === "string") {
        googleAppend.spreadsheetId = up.spreadsheetId;
    }
    if (!googleAppend.updatedRange) {
        console.warn(
            "[contact-form-api] Sheets append succeeded but updates.updatedRange missing; check SHEETS_RANGE tab and spreadsheet id.",
            `tab="${tabResolved}"`,
            appendRangeUsed
        );
    }

    try {
        const rowNumber = rowNumberFromUpdatedRange_(googleAppend.updatedRange);
        if (rowNumber) {
            await writeLeadRowByHeader_(sheets, tabResolved, rowNumber, {
                iso: row.iso,
                formId: row.formId,
                name: row.name,
                mobile: row.mobile,
                email: row.email,
                clientSessionId: row.clientSessionId,
                deviceType,
                browserName: row.browserName,
                channel: ch,
                city,
                ip,
                repeated,
                sourceUrl,
                appointmentBooked,
                appointmentDate,
                appointmentTime,
                driveFileLink: fileLinks
            });
        }
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[contact-form-api] Sheets header-mapped patch failed; row still appended.", msg);
    }
    return {
        action: "appended",
        patched: true,
        tab: tabResolved,
        appendRangeUsed,
        googleAppend: Object.keys(googleAppend).length ? googleAppend : undefined
    };
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
        return { mode: "skipped_empty_queries" };
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
        const queryColumnWritten = merged !== existingCsv;
        /** @type {{ totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } | null} */
        let googleBatchQueries = null;
        if (queryColumnWritten) {
            const nBatch = await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: "USER_ENTERED",
                    data: [{ range: `${tab}!N${rowNumber}`, values: [[merged]] }]
                }
            });
            googleBatchQueries = googleBatchSummaryFromResponse_(nBatch);
        }
        // Chat may append a row on mobile first (empty C/E), then capture name/email later; session
        // query sync still hits this path — fill blank contact columns without touching N again.
        const contact = await updateExistingSessionRow_(
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
        return {
            mode: "merge_into_existing_row",
            tab,
            sheetRowNumber: rowNumber,
            queryColumnWritten,
            googleBatchQueries,
            contactFill: {
                applied: contact.applied,
                googleBatch: contact.googleBatch
            }
        };
    }

    const sheetOutcome = await appendContactRowToSheet(row);
    return { mode: "appended_new_row", sheetOutcome };
}

/**
 * Read-only spreadsheet metadata for ops debugging (wrong tab / permissions / spreadsheet id).
 * @returns {Promise<{ ok: true, title: string, tabNames: string[], configuredRangeTab: string } | { ok: false, code: string, message?: string }>}
 */
export async function probeSheetsSpreadsheetAccess() {
    if (!SPREADSHEET_ID) {
        return { ok: false, code: "missing_spreadsheet_env" };
    }
    try {
        const client = await getSheetsAuthClient();
        const sheetsApi = google.sheets({ version: "v4", auth: client });
        const got = await sheetsApi.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: "properties.title,sheets.properties(title)"
        });
        /** @type {Array<{ properties?: { title?: string } }>} */
        const sh = Array.isArray(got.data.sheets) ? got.data.sheets : [];
        const tabNames = sh
            .map((x) =>
                x && x.properties && typeof x.properties.title === "string"
                    ? x.properties.title.trim()
                    : ""
            )
            .filter(Boolean);
        const title =
            got.data.properties && typeof got.data.properties.title === "string"
                ? got.data.properties.title.trim()
                : "";
        return {
            ok: true,
            title,
            tabNames,
            configuredRangeTab: tabNameFromRange(RANGE)
        };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        return { ok: false, code: "spreadsheets_get_failed", message: msg.slice(0, 500) };
    }
}
