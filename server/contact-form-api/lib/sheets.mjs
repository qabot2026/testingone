/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:J").trim();

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
