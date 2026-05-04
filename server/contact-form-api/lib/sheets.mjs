/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 */

import fs from "node:fs";
import { google } from "googleapis";

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:F").trim();

const SPREADSHEET_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function getSheetsAuthClient() {
    const jsonRaw = (
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON ||
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        ""
    ).trim();
    let key = jsonRaw ? JSON.parse(jsonRaw) : null;
    if (!key && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (fs.existsSync(path)) {
            key = JSON.parse(fs.readFileSync(path, "utf8"));
        }
    }
    if (key) {
        const auth = new google.auth.GoogleAuth({
            credentials: key,
            scopes: SPREADSHEET_SCOPES
        });
        return auth.getClient();
    }
    const auth = new google.auth.GoogleAuth({ scopes: SPREADSHEET_SCOPES });
    return auth.getClient();
}

/**
 * @param {{ iso: string, formId: string, name: string, mobile: string, email: string, clientSessionId: string }} row
 */
export async function appendContactRowToSheet(row) {
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const values = [[
        row.iso,
        row.formId,
        row.name,
        row.mobile,
        row.email,
        row.clientSessionId
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: RANGE,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
}
