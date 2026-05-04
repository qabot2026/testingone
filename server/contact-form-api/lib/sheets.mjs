/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import fs from "node:fs";
import { google } from "googleapis";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:I").trim();

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

/**
 * Same JSON as Firestore: full service account (`type` + `private_key`).
 * On Railway there is no "default credentials" — must not fall through to ADC.
 */
function getServiceAccountCredentials() {
    const rawStrings = [
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        process.env.FIREBASE_CONFIG,
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON,
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ];
    for (const raw of rawStrings) {
        const s = (raw || "").trim();
        if (!s) {
            continue;
        }
        try {
            const o = JSON.parse(s);
            if (o && o.type === "service_account" && typeof o.private_key === "string") {
                return o;
            }
        } catch {
            continue;
        }
    }
    const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    if (credPath && fs.existsSync(credPath)) {
        try {
            const o = JSON.parse(fs.readFileSync(credPath, "utf8"));
            if (o && o.type === "service_account") {
                return o;
            }
        } catch {
            /* ignore */
        }
    }
    return null;
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
 * Columns A–I: iso, formId, name, mobile, email, clientSessionId, browserName, deviceType, channel (web|whatsapp).
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string }} row
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
    const values = [[
        row.iso,
        row.formId,
        row.name,
        row.mobile,
        row.email,
        row.clientSessionId,
        row.browserName,
        row.deviceType,
        ch
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: appendRangeFullWidth(RANGE),
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
}
