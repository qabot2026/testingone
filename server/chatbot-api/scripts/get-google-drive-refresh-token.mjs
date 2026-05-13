/**
 * One-time helper: obtain GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN for Railway.
 *
 * Prereqs:
 * 1. Google Cloud Console → APIs & Services → OAuth consent screen (add yourself as test user if External).
 * 2. Credentials → Create OAuth client ID → type "Web application".
 * 3. Authorized redirect URI: http://127.0.0.1:8765/oauth2callback (exactly).
 * 4. Enable Google Drive API for the project.
 *
 * Run from this package directory:
 *   set GOOGLE_DRIVE_OAUTH_CLIENT_ID=...
 *   set GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=...
 *   node scripts/get-google-drive-refresh-token.mjs
 *
 * Copy the printed refresh_token into Railway as GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN.
 */

import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const PORT = 8765;
const REDIRECT_PATH = "/oauth2callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${REDIRECT_PATH}`;

const clientId = (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || "").trim();
const clientSecret = (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || "").trim();

if (!clientId || !clientSecret) {
    console.error(
        "Set GOOGLE_DRIVE_OAUTH_CLIENT_ID and GOOGLE_DRIVE_OAUTH_CLIENT_SECRET (values from OAuth client → Web application)."
    );
    process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive"]
});

const server = http.createServer(async (req, res) => {
    if (!req.url || !req.url.startsWith(REDIRECT_PATH)) {
        res.writeHead(404);
        res.end();
        return;
    }
    const params = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams;
    const code = params.get("code");
    const err = params.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (err) {
        res.end(`<p>OAuth error: ${err}</p>`);
        console.error("OAuth error:", err);
        server.close();
        process.exit(1);
        return;
    }
    if (!code) {
        res.end("<p>No code in callback.</p>");
        server.close();
        process.exit(1);
        return;
    }
    try {
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);
        const rt = tokens.refresh_token;
        res.end(
            "<p>Success. Check this terminal for GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN and copy it to Railway.</p>"
        );
        console.log("\n--- Add to Railway (and keep secret) ---\n");
        if (rt) {
            console.log(`GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${rt}`);
        } else {
            console.log(
                "No new refresh_token returned (Google only sends it on first consent). Revoke app access at " +
                    "https://myaccount.google.com/permissions and run this script again, or use a new OAuth client."
            );
        }
        console.log("");
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        res.end(`<p>Token exchange failed: ${msg}</p>`);
        console.error(msg);
        process.exit(1);
    }
    server.close();
    process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log("Open this URL in your browser (sign in with the Google account that should own uploads):\n");
    console.log(authUrl);
    console.log(`\nWaiting for redirect to ${REDIRECT_URI} …\n`);
});
