/**
 * Backend for `company.js` POST /contact-form-submissions (JSON or multipart with files).
 * Hosting: **Railway only**. Data: **Firestore** + optional **Google Sheets**; file fields → **Google Drive**.
 *
 * Setup:
 * 1. Service account JSON (**same** as Firebase/Sheets): `FIREBASE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_SERVICE_ACCOUNT_JSON`).
 * 2. Google Cloud Console → enable **Google Drive API** for that project.
 * 3. Use a folder inside a **Shared drive** (Team Drive), not personal "My Drive" — service accounts have no My Drive quota.
 *    Add the service account to the shared drive (or share the folder) with **`client_email`** (Editor / Content manager).
 * 4. Railway → **`GOOGLE_DRIVE_FOLDER_ID`** = that folder’s id from the URL.  
 *    Subfolders per upload: `9960343434` / `9960343434_2` or `unknown1`, `unknown2`, …
 * 5. Firebase/Firestore for lead documents (optional disable with **DISABLE_FIRESTORE**). Sheets optional (**SHEETS_SPREADSHEET_ID**).
 * 6. Point the site at this API (`dfchat-api-base-url` / `apiBase`).
 *
 * Env:
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_CONFIG / GOOGLE_APPLICATION_CREDENTIALS
 *   GOOGLE_DRIVE_FOLDER_ID — required for multipart file uploads
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN
 *   SHEETS_SPREADSHEET_ID, SHEETS_RANGE, DISABLE_SHEETS=1
 */

import fs from "node:fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";
import { uploadSubmissionFilesToDrive } from "./lib/drive-upload.mjs";
import { getServiceAccountCredentials } from "./lib/google-service-account.mjs";

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

/** Firestore persistence (optional); Drive uploads use the same service account JSON via `google-service-account.mjs`. */
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
        let drive_uploads = [];
        let drive_subfolder_id = "";
        let drive_subfolder_name = "";

        if (uploadedFiles.length > 0 && FIRESTORE_DISABLED) {
            return res.status(400).json({
                ok: false,
                error: "Submissions with file attachments require Firestore (metadata + Drive file ids). Turn off DISABLE_FIRESTORE on Railway."
            });
        }

        if (uploadedFiles.length > 0) {
            if (!(process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim()) {
                return res.status(500).json({
                    ok: false,
                    error: "Set GOOGLE_DRIVE_FOLDER_ID in Railway (Drive folder shared with the service account as Editor)."
                });
            }
            if (!getServiceAccountCredentials()) {
                return res.status(500).json({
                    ok: false,
                    error: "File uploads require a Google service account JSON (e.g. FIREBASE_SERVICE_ACCOUNT_JSON)."
                });
            }
            try {
                const pack = await uploadSubmissionFilesToDrive(uploadedFiles, {
                    mobile
                });
                drive_uploads = pack.uploads;
                drive_subfolder_id = pack.drive_subfolder_id || "";
                drive_subfolder_name = pack.drive_subfolder_name || "";
            } catch (ue) {
                let detail = ue && ue.message ? ue.message : String(ue);
                if (/storage quota|Service Accounts do not have storage/i.test(detail)) {
                    detail += " — Use a folder on a Google Shared drive (Team Drive) with the service account added; personal My Drive does not work.";
                }
                console.error("[contact-form-api] Google Drive upload failed", detail, ue);
                return res.status(500).json({
                    ok: false,
                    error: `Drive: ${detail} Enable Drive API; parent folder must live on a Shared drive for service accounts.`
                });
            }
            const namesForSummary = drive_uploads
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
            ...(drive_uploads.length
                ? {
                    drive_uploads,
                    ...(drive_subfolder_id
                        ? { drive_subfolder_id, drive_subfolder_name }
                        : {})
                }
                : {})
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
            `Firestore + Google Drive (file fields) + optional Google Sheets.`
        ].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    console.log(`contact-form-api listening on :${PORT} ${PATHNAME} — ${fsHint} ${sheetHint}`);
});
