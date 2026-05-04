/**
 * Backend for `company.js` POST /contact-form-submissions (JSON or multipart with files).
 * Hosting: **Railway only**. Data: **Firestore** + optional **Google Sheets**; file fields → **Firebase Storage**.
 *
 * Setup:
 * 1. Firebase Console → Project settings → Service accounts → **Generate new private key** (JSON).
 * 2. Railway → **FIREBASE_SERVICE_ACCOUNT_JSON** = full JSON (used for Firestore, Storage, Sheets).
 * 3. GCP: enable **Cloud Storage API**; default bucket `<project-id>.appspot.com` must exist (Firebase → Storage).
 * 4. Grant the service account **Storage Object Admin** (or Firebase Admin) on that bucket if uploads fail with 403.
 * 5. Optional **`FIREBASE_STORAGE_BUCKET`** if you use a non-default bucket name.
 * 6. Google Sheets: share the spreadsheet with the service account **`client_email`** (Editor).
 * 7. Point the site at this API (`dfchat-api-base-url` / `apiBase`).
 *
 * Env:
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_CONFIG, GOOGLE_APPLICATION_CREDENTIALS (local file)
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN
 *   FIREBASE_STORAGE_BUCKET — optional override
 *   SHEETS_SPREADSHEET_ID, SHEETS_RANGE, DISABLE_SHEETS=1
 */

import fs from "node:fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";
import { uploadSubmissionFiles } from "./lib/storage-upload.mjs";

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 */
const SHEETS_DISABLED =
    process.env.DISABLE_SHEETS === "1" ||
    !(process.env.SHEETS_SPREADSHEET_ID || "").trim();
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1";

function hasFirebaseCredentials() {
    if ((process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()) {
        return true;
    }
    if ((process.env.FIREBASE_CONFIG || "").trim()) {
        return true;
    }
    const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    return !!(credPath && fs.existsSync(credPath));
}

const multipart = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 32 * 1024 * 1024, files: 30 }
});

/** `client_context.channel`: `web` or `whatsapp` (non-WhatsApp integrations should send `whatsapp` explicitly). */
function normalizeLeadChannel(raw) {
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return s === "whatsapp" ? "whatsapp" : "web";
}

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

/** Initialize Admin when credentials exist so Storage uploads work even if Firestore writes are disabled. */
if (hasFirebaseCredentials()) {
    firebaseAdminInit();
}

const app = express();
app.use(cors({
    origin: corsOriginOption(),
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    optionsSuccessStatus: 204
}));

app.options(PATHNAME, (_req, res) => res.sendStatus(204));

app.post(
    PATHNAME,
    (req, res, next) => {
        const ct = req.headers["content-type"] || "";
        if (ct.includes("multipart/form-data")) {
            return multipart.any()(req, res, (err) => {
                if (err) {
                    return res.status(413).json({
                        ok: false,
                        error: err.message || "File upload too large or invalid."
                    });
                }
                return next();
            });
        }
        return express.json({ limit: "32mb" })(req, res, next);
    },
    async (req, res) => {
        const rawBody = req.body && typeof req.body === "object" ? req.body : {};
        /** @type {Record<string, unknown>} */
        let body = rawBody;

        if (typeof body.client_context === "string") {
            try {
                body = {
                    ...body,
                    client_context: JSON.parse(body.client_context)
                };
            } catch {
                body = { ...body, client_context: {} };
            }
        }

        const uploadedFiles = Array.isArray(req.files) ? req.files : [];

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                if (typeof val === "string") {
                    fields[k] = val.trim();
                } else if (val != null && typeof val !== "object" && typeof val !== "undefined") {
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
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        /** @type {Array<Record<string, unknown>>} */
        let file_uploads = [];

        if (uploadedFiles.length > 0 && FIRESTORE_DISABLED) {
            return res.status(400).json({
                ok: false,
                error: "Submissions with file attachments require Firestore (metadata + Storage paths). Turn off DISABLE_FIRESTORE on Railway."
            });
        }

        if (uploadedFiles.length > 0) {
            if (!hasFirebaseCredentials()) {
                return res.status(500).json({
                    ok: false,
                    error: "File uploads require FIREBASE_SERVICE_ACCOUNT_JSON on the server."
                });
            }
            try {
                file_uploads = await uploadSubmissionFiles(uploadedFiles, {
                    sessionId: clientSessionId
                });
            } catch (ue) {
                const detail = ue && ue.message ? ue.message : String(ue);
                console.error("[contact-form-api] Storage upload failed", detail, ue);
                return res.status(500).json({
                    ok: false,
                    error: `Storage: ${detail}. Enable Cloud Storage API and grant the service account access to the bucket.`
                });
            }
            const namesForSummary = file_uploads
                .map((f) => (typeof f.original_name === "string" ? f.original_name : ""))
                .filter(Boolean);
            if (namesForSummary.length && !fields.document) {
                fields.document = namesForSummary.join(", ");
            }
        }

        const iso = new Date().toISOString();
        /** Firestore-safe payload (flattened for querying) */
        const record = {
            submitted_at: iso,
            form_id: formId,
            name,
            email,
            mobile,
            fields,
            client_context: mergedClientContext,
            ...(file_uploads.length ? { file_uploads } : {})
        };

        try {
            if (FIRESTORE_DISABLED && SHEETS_DISABLED) {
                return res.status(500).json({
                    ok: false,
                    error: "Neither Firestore nor Sheets is enabled: set FIREBASE_SERVICE_ACCOUNT_JSON + Firestore, and/or SHEETS_SPREADSHEET_ID for Sheets. Remove DISABLE_FIRESTORE / DISABLE_SHEETS if applicable."
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
                        clientSessionId,
                        browserName,
                        deviceType,
                        channel
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
    }
);

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Opening the Railway URL in a browser hits GET / — avoid Express default "Cannot GET /". */
app.get("/", (_req, res) => {
    res.status(200).type("text/plain; charset=utf-8").send(
        [
            `Contact leads API running.`,
            `POST JSON or multipart/form-data → ${PATHNAME}`,
            `GET /health → health check.`,
            `Firestore + Firebase Storage (file fields) + optional Google Sheets.`
        ].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    console.log(`contact-form-api listening on :${PORT} ${PATHNAME} — ${fsHint} ${sheetHint}`);
});
