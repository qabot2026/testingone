/**
 * Shared loader for the same service-account JSON used by Sheets, Drive, etc.
 */

import fs from "node:fs";

/**
 * @returns {Record<string, unknown> | null}
 */
export function getServiceAccountCredentials() {
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
