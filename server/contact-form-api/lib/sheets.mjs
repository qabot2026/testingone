/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:J").trim();
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
async function alreadyInSheetRecent_(sheets, row) {
    const key = buildDedupeKey(row);
    if (!key) {
        return false;
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
        return false;
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const incomingIsoMs = Date.parse(row.iso);
    const incomingMobileDigits = mobileDigitsOnly(row.mobile);
    const incomingSid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";

    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingIso = typeof r[0] === "string" ? r[0].trim() : "";
        const existingMobile = typeof r[3] === "string" ? r[3].trim() : "";
        const existingSid = typeof r[5] === "string" ? r[5].trim() : "";

        // If we have a session id, enforce "only once per session".
        if (incomingSid && existingSid && incomingSid === existingSid) {
            return true;
        }
        // Some sheets have different column ordering; scan the whole row for the session id string.
        if (incomingSid && Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = typeof r[c] === "string" ? r[c].trim() : "";
                if (cell && cell === incomingSid) {
                    return true;
                }
            }
        }

        const existingMobileDigits = mobileDigitsOnly(existingMobile);
        if (!existingMobileDigits || existingMobileDigits !== incomingMobileDigits) {
            continue;
        }

        // Fallback: if session id missing, only suppress duplicates within a short time window.
        if (!incomingSid || !existingSid) {
            const existingMs = Date.parse(existingIso);
            if (Number.isFinite(incomingIsoMs) && Number.isFinite(existingMs)) {
                if (Math.abs(incomingIsoMs - existingMs) <= DEDUP_WINDOW_MS) {
                    return true;
                }
            }
        }
    }

    return false;
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
 * Columns A–J: iso, formId, name, mobile, email, clientSessionId, browserName, deviceType, channel (web|whatsapp), file_links (Drive URLs, comma-separated, or empty).
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string }} row
 */
export async function appendContactRowToSheet(row) {
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    // Prevent double-write when chat mobile sync and form submission both hit Sheets.
    if (await alreadyInSheetRecent_(sheets, row)) {
        return;
    }

    const ch = typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : "web";
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
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
        fileLinks
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: appendRangeFullWidth(RANGE),
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
}
