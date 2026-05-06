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

/**
 * Dedupe strategy:
 * - Primary key: clientSessionId when session id exists (only one Sheet row per session)
 * - Secondary: (mobile_digits + clientSessionId) retained implicitly by the primary key
 * - Fallback: if session id missing, only dedupe same mobile if another row was appended very recently
 *
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 */
function buildDedupeKey(row) {
    const md = mobileDigitsOnly(row.mobile);
    const sid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    if (!md) {
        return "";
    }
    if (sid) {
        return `m:${md}|sid:${sid}`;
    }
    return `m:${md}|sid:`;
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 */
/**
 * Scan recent sheet rows for:
 * - duplicate for the same session id (only one row per session id)
 * - repeated: same mobile already exists under a different session id
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 * @returns {Promise<{ duplicate: boolean, repeatedAcrossSessions: boolean, matchedRowNumber: number }>}
 */
async function scanSheetTailForDedupeAndRepeat_(sheets, row) {
    const key = buildDedupeKey(row);
    if (!key) {
        return { duplicate: false, repeatedAcrossSessions: false, matchedRowNumber: 0 };
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
        return { duplicate: false, repeatedAcrossSessions: false, matchedRowNumber: 0 };
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const tailOffset = rows.length - tail.length; // 0-based offset into full sheet rows
    const incomingIsoMs = Date.parse(row.iso);
    const incomingMobileDigits = mobileDigitsOnly(row.mobile);
    const incomingSid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    let repeatedAcrossSessions = false;

    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingIso = typeof r[0] === "string" ? r[0].trim() : "";
        const existingMobile = typeof r[3] === "string" ? r[3].trim() : "";
        const existingSid = typeof r[5] === "string" ? r[5].trim() : "";
        const rowNumber = tailOffset + i + 1; // 1-based row number in the sheet

        // If we have a session id, enforce "only once per session".
        if (incomingSid && existingSid && incomingSid === existingSid) {
            return { duplicate: true, repeatedAcrossSessions, matchedRowNumber: rowNumber };
        }
        // Some sheets have different column ordering; scan the whole row for the session id string.
        if (incomingSid && Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = typeof r[c] === "string" ? r[c].trim() : "";
                if (cell && cell === incomingSid) {
                    return { duplicate: true, repeatedAcrossSessions, matchedRowNumber: rowNumber };
                }
            }
        }

        const existingMobileDigits = mobileDigitsOnly(existingMobile);
        if (!existingMobileDigits || existingMobileDigits !== incomingMobileDigits) {
            continue;
        }

        // Mark as repeated when the same mobile appears with a different session id.
        if (
            incomingSid
            && existingSid
            && incomingSid !== existingSid
        ) {
            repeatedAcrossSessions = true;
        }

        // Fallback: if session id missing, only suppress duplicates within a short time window.
        if (!incomingSid || !existingSid) {
            const existingMs = Date.parse(existingIso);
            if (Number.isFinite(incomingIsoMs) && Number.isFinite(existingMs)) {
                if (Math.abs(incomingIsoMs - existingMs) <= DEDUP_WINDOW_MS) {
                    return { duplicate: true, repeatedAcrossSessions, matchedRowNumber: rowNumber };
                }
            }
        }
    }

    return { duplicate: false, repeatedAcrossSessions, matchedRowNumber: 0 };
}

function isBlankCell_(v) {
    return !(typeof v === "string" && v.trim());
}

/**
 * If we already have a row for this session id (from chat mobile sync), fill in missing fields
 * from the later contact-form submit rather than dropping the write.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber 1-based sheet row
 * @param {{ formId: string, name: string, email: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string }} incoming
 */
async function updateExistingSessionRow_(sheets, tab, rowNumber, incoming) {
    if (!rowNumber || rowNumber < 1) {
        return;
    }
    // Read the current row so we only fill blanks (don’t overwrite existing values).
    const got = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${rowNumber}:N${rowNumber}`
    });
    const row = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
    const existing = (idx) => (typeof row[idx] === "string" ? row[idx].trim() : "");

    const name = incoming.name && isBlankCell_(existing(2)) ? incoming.name.trim() : "";
    const email = incoming.email && isBlankCell_(existing(4)) ? incoming.email.trim() : "";
    const formId = incoming.formId && isBlankCell_(existing(1)) ? incoming.formId.trim() : "";
    const browserName =
        incoming.browserName && isBlankCell_(existing(6)) ? incoming.browserName.trim() : "";
    const deviceType =
        incoming.deviceType && isBlankCell_(existing(7)) ? incoming.deviceType.trim() : "";
    const channel =
        incoming.channel && isBlankCell_(existing(8)) ? incoming.channel.trim() : "";
    const fileLinks =
        incoming.fileLinks && isBlankCell_(existing(9)) ? incoming.fileLinks.trim() : "";
    const city =
        incoming.city && isBlankCell_(existing(10)) ? incoming.city.trim() : "";
    const ip =
        incoming.ip && isBlankCell_(existing(11)) ? incoming.ip.trim() : "";
    const userQueriesCsv =
        incoming.userQueriesCsv && isBlankCell_(existing(13)) ? incoming.userQueriesCsv.trim() : "";

    /** @type {Array<{ range: string, values: string[][] }>} */
    const data = [];
    if (formId) data.push({ range: `${tab}!B${rowNumber}`, values: [[formId]] });
    if (name) data.push({ range: `${tab}!C${rowNumber}`, values: [[name]] });
    if (email) data.push({ range: `${tab}!E${rowNumber}`, values: [[email]] });
    if (browserName) data.push({ range: `${tab}!G${rowNumber}`, values: [[browserName]] });
    if (deviceType) data.push({ range: `${tab}!H${rowNumber}`, values: [[deviceType]] });
    if (channel) data.push({ range: `${tab}!I${rowNumber}`, values: [[channel]] });
    if (fileLinks) data.push({ range: `${tab}!J${rowNumber}`, values: [[fileLinks]] });
    if (city) data.push({ range: `${tab}!K${rowNumber}`, values: [[city]] });
    if (ip) data.push({ range: `${tab}!L${rowNumber}`, values: [[ip]] });
    if (userQueriesCsv) data.push({ range: `${tab}!N${rowNumber}`, values: [[userQueriesCsv]] });

    if (!data.length) {
        return;
    }
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data
        }
    });
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
 */
export async function appendContactRowToSheet(row) {
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
        await updateExistingSessionRow_(sheets, tab, scan.matchedRowNumber, row);
        return;
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
    const repeated = scan.repeatedAcrossSessions ? "Yes" : "No";
    const userQueriesCsv = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
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
}
