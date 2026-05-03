/**
 * Backend for `company.js` POST /contact-form-submissions (same JSON the widget sends).
 *
 * Setup:
 * 1. Create a Google Cloud **service account** with role **Datastore User** (or a custom Firestore role).
 * 2. Download JSON key → set GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/key.json (or rely on GCP default credentials when deployed).
 * 3. In **Google Sheets** → Share the spreadsheet with the service account email (Editor).
 * 4. Set SHEETS_SPREADSHEET_ID to the spreadsheet id from the sheet URL.
 * 5. Run: npm install && npm start
 * 6. Point the site at this API base (meta `dfchat-api-base-url` or window.COMPANY_API_BASE_URL).
 *
 * Env:
 *   PORT (default 8080)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service account JSON (local dev)
 *   SHEETS_SPREADSHEET_ID — required unless DISABLE_SHEETS=1
 *   SHEETS_RANGE — default "Sheet1!A:F" (timestamp, formId, name, mobile, email, client_session_id)
 *   DISABLE_SHEETS=1 — skip Google Sheets (Firestore only)
 *   DISABLE_FIRESTORE=1 — skip Firestore (Sheets only; unusual)
 *   CORS_ORIGIN — omit for reflect request Origin; set to exact origin(s) comma-separated if you prefer strict CORS
 */

import express from "express";
import cors from "cors";
import fs from "node:fs";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
const SHEETS_DISABLED = process.env.DISABLE_SHEETS === "1";
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1";

function corsOriginOption() {
    const raw = (process.env.CORS_ORIGIN || "").trim();
    if (!raw) {
        return true;
    }
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return (origin, cb) => {
        if (!origin || list.includes(origin)) {
            return cb(null, true);
        }
        return cb(new Error("CORS blocked"));
    };
}

if (!FIRESTORE_DISABLED) {
    firebaseAdminInit();
}

const app = express();
app.use(cors({
    origin: corsOriginOption(),
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    optionsSuccessStatus: 204
}));
app.use(express.json({ limit: "1mb" }));

app.options(PATHNAME, (_req, res) => res.sendStatus(204));

app.post(PATHNAME, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};

    /** @type {Record<string, string>} */
    const fields = {};
    for (const [k, val] of Object.entries(body)) {
        if (!k.startsWith("_") && k !== "client_context") {
            if (typeof val === "string") {
                fields[k] = val.trim();
            } else if (val != null && typeof val !== "object") {
                fields[k] = String(val).trim();
            }
        }
    }

    const name = fields.name ?? "";
    const email = fields.email ?? "";
    const mobile = fields.mobile ?? "";
    const formId = typeof body._contactFormId === "string" ? body._contactFormId : "unknown";
    const clientContext = body.client_context && typeof body.client_context === "object" ? body.client_context : {};
    const clientSessionId = typeof clientContext.client_session_id === "string"
        ? clientContext.client_session_id
        : "";

    const iso = new Date().toISOString();
    /** Firestore-safe payload (flattened for querying) */
    const record = {
        submitted_at: iso,
        form_id: formId,
        name,
        email,
        mobile,
        fields,
        client_context: clientContext
    };

    try {
        if (FIRESTORE_DISABLED && SHEETS_DISABLED) {
            return res.status(500).json({
                ok: false,
                error: "Neither Firestore nor Sheets is enabled; remove DISABLE_FIRESTORE / DISABLE_SHEETS from env."
            });
        }
        if (!FIRESTORE_DISABLED) {
            await persistToFirestore(record);
        }
        if (!SHEETS_DISABLED) {
            await appendContactRowToSheet({
                iso,
                formId,
                name,
                mobile,
                email,
                clientSessionId
            });
        }
        return res.status(200).json({ ok: true, message: "Saved." });
    } catch (err) {
        const message = err && err.message ? err.message : "Save failed";
        console.error("[contact-form-api]", message, err);
        return res.status(500).json({ ok: false, error: message });
    }
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Opening the Cloud Run URL in a browser hits GET / — avoid Express default "Cannot GET /". */
app.get("/", (_req, res) => {
    res.status(200).type("text/plain; charset=utf-8").send(
        [`Contact leads API running.`, `POST JSON → ${PATHNAME}`, `GET /health → health check.`].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    console.log(`contact-form-api listening on :${PORT} ${PATHNAME} — ${fsHint} ${sheetHint}`);
});
