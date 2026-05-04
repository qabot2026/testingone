/**
 * Google Drive API auth for uploads.
 *
 * **OAuth (user account)** — set all three:
 *   GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
 *   Use a normal Google account (e.g. your “shared” Drive). Files go to GOOGLE_DRIVE_FOLDER_ID in that
 *   account’s Drive (My Drive or Shared drives). No service-account quota issue.
 *
 * **Service account** — if OAuth env is incomplete, falls back to service-account JSON
 *   (FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_JSON). Parent folder must be on a
 *   Workspace **Shared drive (Team Drive)** or uploads fail with “no storage quota”.
 */

import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

function trim(s) {
    return typeof s === "string" ? s.trim() : "";
}

/** @returns {{ useOAuth: boolean; clientId: string; clientSecret: string; refreshToken: string }} */
function oauthEnv() {
    const clientId = trim(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID);
    const clientSecret = trim(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET);
    const refreshToken = trim(process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN);
    const useOAuth = !!(clientId && clientSecret && refreshToken);
    return { useOAuth, clientId, clientSecret, refreshToken };
}

/** True if Drive uploads can run (OAuth trio or service account JSON). */
export function hasDriveUploadCredentials() {
    const { useOAuth } = oauthEnv();
    if (useOAuth) {
        return true;
    }
    return !!getServiceAccountCredentials();
}

/** When true, uploads use a real user’s Drive (My Drive allowed). When false, service account rules apply. */
export function isDriveAuthOAuthUser() {
    return oauthEnv().useOAuth;
}

export async function getDriveClient() {
    const { useOAuth, clientId, clientSecret, refreshToken } = oauthEnv();
    if (useOAuth) {
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        return google.drive({ version: "v3", auth: oauth2 });
    }
    const cred = getServiceAccountCredentials();
    if (!cred) {
        throw new Error(
            "Drive auth missing. Either set GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, " +
                "and GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN (user account), or provide a service-account JSON " +
                "(e.g. FIREBASE_SERVICE_ACCOUNT_JSON) for Workspace Shared drive uploads."
        );
    }
    const auth = new google.auth.GoogleAuth({
        credentials: cred,
        scopes: DRIVE_SCOPES
    });
    return google.drive({ version: "v3", auth: await auth.getClient() });
}
