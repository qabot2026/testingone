/**
 * Backend for `company.js` POST /contact-form-submissions (JSON or multipart with files).
 * Large file uploads: **Google Drive API** in this service, **or** relay to your **Apps Script web app**
 *   (`GOOGLE_APPS_SCRIPT_WEBAPP_URL` → script runs as you, no service-account Drive quota issue).
 *
 * **Easiest “files only” (no database, no Sheet):** set on Railway
 *   `DRIVE_ONLY=1` + `GOOGLE_APPS_SCRIPT_WEBAPP_URL` (recommended for personal Gmail), **or**
 *   `DRIVE_ONLY=1` + `GOOGLE_DRIVE_FOLDER_ID` + service-account JSON (**Workspace Shared drive** only).
 *
 * **Text-only leads (no attachments):** `SHEETS_SPREADSHEET_ID` + share the Sheet with the service
 *   account; `DISABLE_FIRESTORE=1` + `DISABLE_DRIVE_UPLOAD=1`.
 *
 * Env:
 *   GOOGLE_APPS_SCRIPT_WEBAPP_URL — full `/exec` deploy URL; multipart is forwarded here (skips Drive API)
 *   DRIVE_ONLY=1 — skip Firestore and Sheets; only accept uploads (multipart with files)
 *   DISABLE_DRIVE_UPLOAD=1 — reject file fields (Sheet/text-only mode)
 *   GOOGLE_DRIVE_FOLDER_ID, GOOGLE_DRIVE_OAUTH_* (Drive API path; optional if Apps Script URL set)
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN, SHEETS_*, DISABLE_SHEETS=1
 */

import fs from "node:fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";
import { uploadSubmissionFilesToDrive } from "./lib/drive-upload.mjs";
import { hasDriveUploadCredentials } from "./lib/drive-auth.mjs";
import { forwardSubmissionToAppsScript } from "./lib/apps-script-upload.mjs";

const APPS_SCRIPT_WEBAPP_URL = (process.env.GOOGLE_APPS_SCRIPT_WEBAPP_URL || "").trim();

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
/** “Just put files in Drive” — one flag instead of DISABLE_FIRESTORE + DISABLE_SHEETS. */
const DRIVE_ONLY = process.env.DRIVE_ONLY === "1";
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1" || DRIVE_ONLY;
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 */
const SHEETS_DISABLED =
    DRIVE_ONLY ||
    process.env.DISABLE_SHEETS === "1" ||
    !(process.env.SHEETS_SPREADSHEET_ID || "").trim();
/** When set, file fields are not accepted; use Sheet + service account only (no Drive/OAuth). */
const DISABLE_DRIVE_UPLOAD = process.env.DISABLE_DRIVE_UPLOAD === "1";

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

        if (DRIVE_ONLY) {
            const hasBytes = uploadedFiles.some(
                (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
            );
            if (!hasBytes) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "DRIVE_ONLY=1: include at least one file with data in the form, or remove DRIVE_ONLY to save text to Firestore/Sheets."
                });
            }
        }

        /** @type {Array<Record<string, unknown>>} */
        let drive_uploads = [];
        let drive_subfolder_id = "";
        let drive_subfolder_name = "";
        /** True after a successful Apps Script forward, even if the script returns no JSON uploads. */
        let filesStoredExternally = false;

        if (uploadedFiles.length > 0 && DISABLE_DRIVE_UPLOAD) {
            return res.status(400).json({
                ok: false,
                error:
                    "This app is set to save only to Google Sheets (DISABLE_DRIVE_UPLOAD=1). " +
                    "Sheets cannot store file attachments. Remove files from the form, or set DISABLE_DRIVE_UPLOAD=0 and configure Google Drive for uploads."
            });
        }

        if (uploadedFiles.length > 0) {
            try {
                if (APPS_SCRIPT_WEBAPP_URL) {
                    const pack = await forwardSubmissionToAppsScript(APPS_SCRIPT_WEBAPP_URL, {
                        files: uploadedFiles,
                        fields,
                        clientContext: mergedClientContext,
                        formId
                    });
                    drive_uploads = pack.uploads;
                    filesStoredExternally = true;
                    const j = pack.json;
                    if (j && typeof j === "object") {
                        if (typeof j.drive_subfolder_id === "string" && j.drive_subfolder_id.trim()) {
                            drive_subfolder_id = j.drive_subfolder_id.trim();
                        }
                        if (typeof j.drive_subfolder_name === "string" && j.drive_subfolder_name.trim()) {
                            drive_subfolder_name = j.drive_subfolder_name.trim();
                        }
                    }
                } else {
                    if (!(process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim()) {
                        return res.status(500).json({
                            ok: false,
                            error:
                                "Set GOOGLE_APPS_SCRIPT_WEBAPP_URL (Apps Script /exec URL) or GOOGLE_DRIVE_FOLDER_ID (Drive API folder id)."
                        });
                    }
                    if (!hasDriveUploadCredentials()) {
                        return res.status(500).json({
                            ok: false,
                            error:
                                "File uploads need either GOOGLE_APPS_SCRIPT_WEBAPP_URL, or Drive API auth: GOOGLE_DRIVE_OAUTH_* or a service-account JSON for Workspace Shared drive."
                        });
                    }
                    const pack = await uploadSubmissionFilesToDrive(uploadedFiles, { mobile });
                    drive_uploads = pack.uploads;
                    drive_subfolder_id = pack.drive_subfolder_id || "";
                    drive_subfolder_name = pack.drive_subfolder_name || "";
                    filesStoredExternally = drive_uploads.length > 0;
                }
            } catch (ue) {
                let detail = ue && ue.message ? ue.message : String(ue);
                if (/storage quota|Service Accounts do not have storage/i.test(detail)) {
                    detail +=
                        " Use Apps Script (GOOGLE_APPS_SCRIPT_WEBAPP_URL), a Workspace Shared drive, or GOOGLE_DRIVE_OAUTH_*.";
                }
                console.error("[contact-form-api] Upload forward failed", detail, ue);
                return res.status(500).json({
                    ok: false,
                    error: detail
                });
            }
            const namesForSummary = uploadedFiles
                .map((f) => (typeof f.originalname === "string" ? f.originalname : ""))
                .filter(Boolean);
            if (namesForSummary.length && !fields.document) {
                fields.document = namesForSummary.join(", ");
            }
        }

        const iso = new Date().toISOString();
        /** Firestore-safe payload (flattened for querying) */
        const fileLinksForSheet = drive_uploads
            .map((u) => (typeof u.web_view_link === "string" ? u.web_view_link : ""))
            .filter(Boolean)
            .join(", ");

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
                        : { ...(drive_subfolder_name ? { drive_subfolder_name } : {}) })
                }
                : {})
        };

        try {
            if (FIRESTORE_DISABLED && SHEETS_DISABLED && drive_uploads.length === 0 && !filesStoredExternally) {
                return res.status(500).json({
                    ok: false,
                    error: "Neither Firestore nor Sheets is enabled, and files were not stored (no Drive upload and no Apps Script success). Set SHEETS_SPREADSHEET_ID and/or Firestore, or configure GOOGLE_APPS_SCRIPT_WEBAPP_URL / Drive uploads."
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
                        channel,
                        fileLinks: fileLinksForSheet
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
            `Drive uploads + optional Firestore/Sheets (set DRIVE_ONLY=1 for files-only).`
        ].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    const driveHint = DISABLE_DRIVE_UPLOAD
        ? "uploads=off"
        : APPS_SCRIPT_WEBAPP_URL
          ? "uploads=AppsScript"
          : "uploads=DriveAPI";
    const mode = DRIVE_ONLY ? " DRIVE_ONLY" : "";
    console.log(`contact-form-api listening on :${PORT} ${PATHNAME} — ${fsHint} ${sheetHint} ${driveHint}${mode}`);
});
