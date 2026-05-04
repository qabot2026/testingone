/**
 * Backend for `company.js` POST /contact-form-submissions (same JSON the widget sends).
 * Hosting: **Railway only**. Data: **Firebase Firestore** (credentials from Firebase Console, not GCP Cloud Run).
 * Google Sheets is disabled in code (SHEETS_DISABLED = true).
 *
 * Setup:
 * 1. Firebase Console → Project settings → Service accounts → **Generate new private key** (JSON).
 * 2. Railway → Variables → **FIREBASE_SERVICE_ACCOUNT_JSON** = paste full JSON.
 * 3. Local dev: set **GOOGLE_APPLICATION_CREDENTIALS** to that JSON file path, or paste JSON into **FIREBASE_SERVICE_ACCOUNT_JSON**.
 * 4. Point the site at this API base (`dfchat-api-base-url` / `apiBase` on the loader).
 *
 * Env:
 *   PORT (default 8080; set by Railway at runtime)
 *   FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CONFIG — service account JSON string (production on Railway)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to JSON file (local dev)
 *   DISABLE_FIRESTORE=1 — skip Firestore
 *   FIRESTORE_DATABASE_ID — only if not using the default database
 *   CORS_ORIGIN — optional; comma-separated origins or omit to reflect Origin
 */

import express from "express";
import cors from "cors";
import fs from "node:fs";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
const SHEETS_DISABLED = true; // Google Sheets disabled — Railway + Firestore only (DISABLE_SHEETS=1)
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
            try {
                await persistToFirestore(record);
            } catch (fe) {
                const detail = fe && fe.message ? fe.message : String(fe);
                throw new Error(`Firestore: ${detail}`);
            }
        }
        if (!SHEETS_DISABLED) {
            try {
                await appendContactRowToSheet({
                    iso,
                    formId,
                    name,
                    mobile,
                    email,
                    clientSessionId
                });
            } catch (se) {
                const detail = se && se.message ? se.message : String(se);
                throw new Error(`Sheets: ${detail}`);
            }
        }
        return res.status(200).json({ ok: true, message: "Saved." });
    } catch (err) {
        const message = err && err.message ? err.message : "Save failed";
        console.error("[contact-form-api]", message, err);
        return res.status(500).json({ ok: false, error: message });
    }
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Opening the Railway URL in a browser hits GET / — avoid Express default "Cannot GET /". */
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
