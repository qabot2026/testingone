/**
 * Backend for `company.js` POST /contact-form-submissions (JSON or multipart with files).
 * Large file uploads: **Google Drive API** in this service, **or** relay to your **Apps Script web app**
 *   (`GOOGLE_APPS_SCRIPT_WEBAPP_URL` → script runs as you, no service-account Drive quota issue).
 *
 * **Easiest “files only” (no Firestore):** set on Railway `DRIVE_ONLY=1` + Apps Script or Drive API as below.
 *   Google Sheets still append when `SHEETS_SPREADSHEET_ID` is set (unless `DISABLE_SHEETS=1`);
 *   `DRIVE_ONLY` only skips Firestore, not Sheets.
 *   `DRIVE_ONLY=1` + `GOOGLE_APPS_SCRIPT_WEBAPP_URL` (recommended for personal Gmail), **or**
 *   `DRIVE_ONLY=1` + `GOOGLE_DRIVE_FOLDER_ID` + service-account JSON (**Workspace Shared drive** only).
 *
 * **Text-only leads (no attachments):** `SHEETS_SPREADSHEET_ID` + share the Sheet with the service
 *   account; `DISABLE_FIRESTORE=1` + `DISABLE_DRIVE_UPLOAD=1`.
 *
 * Env:
 *   GOOGLE_APPS_SCRIPT_WEBAPP_URL — full `/exec` URL; POST **JSON + Base64 `_files`** (see examples/apps-script-drive-upload/Code.gs)
 *   GOOGLE_APPS_SCRIPT_USE_MULTIPART=1 — legacy multipart (omit unless your script parses it)
 *   GOOGLE_DRIVE_FOLDER_ID — Drive API folder, **or** target folder sent to Apps Script as `_drive_folder_id`
 *   DRIVE_ONLY=1 — skip Firestore only; Sheets still run if SHEETS_SPREADSHEET_ID is set
 *   DISABLE_DRIVE_UPLOAD=1 — reject file fields (Sheet/text-only mode)
 *   GOOGLE_DRIVE_OAUTH_* (Drive API path; optional if Apps Script URL set)
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN, SHEETS_*, DISABLE_SHEETS=1
 *
 * Chat-only mobile → Sheet row (no file upload): POST JSON `/contact-form-mobile-sheet-sync`.
 * Optional: CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET → client must send `X-Contact-Form-Mobile-Sync-Secret`.
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
import { resolveContactMobile, resolveSubmissionMobileDigits, scalarFormValue } from "./lib/contact-mobile.mjs";

const APPS_SCRIPT_WEBAPP_URL = (process.env.GOOGLE_APPS_SCRIPT_WEBAPP_URL || "").trim();

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
const PATHNAME_MOBILE_SHEET_SYNC = "/contact-form-mobile-sheet-sync";
/** “Just put files in Drive” — skips Firestore; Sheets are independent (see SHEETS_DISABLED). */
const DRIVE_ONLY = process.env.DRIVE_ONLY === "1";
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1" || DRIVE_ONLY;
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 (independent of DRIVE_ONLY). */
const SHEETS_DISABLED =
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

function stripIpv4Port_(ip) {
    const s = typeof ip === "string" ? ip.trim() : "";
    if (!s) {
        return "";
    }
    return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s) ? s.slice(0, s.lastIndexOf(":")) : s;
}

function normalizeRemoteAddress_(ip) {
    const s = typeof ip === "string" ? ip.trim() : "";
    if (!s) {
        return "";
    }
    // "::ffff:1.2.3.4" → "1.2.3.4"
    if (s.toLowerCase().startsWith("::ffff:")) {
        return s.slice("::ffff:".length);
    }
    return s;
}

function isPrivateIpv4_(ip) {
    const s = stripIpv4Port_(normalizeRemoteAddress_(ip));
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        return false;
    }
    const parts = s.split(".").map((x) => Number.parseInt(x, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
        return true;
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    // CGNAT 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function isPrivateIpv6_(ip) {
    const s = String(ip || "").trim().toLowerCase();
    if (!s) return true;
    if (s === "::1") return true;
    if (s.startsWith("fe80:")) return true; // link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local
    return false;
}

function isPublicIp_(ip) {
    const s = normalizeRemoteAddress_(stripIpv4Port_(ip));
    if (!s) return false;
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        return !isPrivateIpv4_(s);
    }
    // IPv6-ish
    if (s.includes(":")) {
        return !isPrivateIpv6_(s);
    }
    return false;
}

function bestIpFromXForwardedFor(value) {
    const raw = typeof value === "string" ? value : "";
    if (!raw.trim()) {
        return "";
    }
    // Usually: "client, proxy1, proxy2" — but some platforms prepend internal IPs.
    const parts = raw.split(",").map((x) => normalizeRemoteAddress_(stripIpv4Port_(x))).filter(Boolean);
    for (const p of parts) {
        if (isPublicIp_(p)) {
            return p;
        }
    }
    // Fall back to the first non-empty token.
    return parts[0] || "";
}

function extractRequestIp(req) {
    const h = req && req.headers ? req.headers : {};
    const xf = bestIpFromXForwardedFor(h["x-forwarded-for"]);
    if (xf) {
        return xf;
    }
    const cf = typeof h["cf-connecting-ip"] === "string" ? h["cf-connecting-ip"].trim() : "";
    if (cf) {
        return cf;
    }
    const real = typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "";
    if (real) {
        return real;
    }
    const ra = req && req.socket && typeof req.socket.remoteAddress === "string"
        ? normalizeRemoteAddress_(req.socket.remoteAddress)
        : "";
    return ra || "";
}

function normalizeUserQueriesCsvFromClientContext(clientContext) {
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const arr = Array.isArray(ctx.user_queries) ? ctx.user_queries : null;
    if (arr) {
        const cleaned = arr
            .filter((x) => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean);
        return cleaned.join(", ");
    }
    const raw = typeof ctx.user_queries_csv === "string" ? ctx.user_queries_csv.trim() : "";
    return raw;
}

const GEOIP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** @type {Map<string, { city: string, ts: number }>} */
const geoIpCityCache = new Map();

async function resolveCityForRequest(req) {
    const h = req && req.headers ? req.headers : {};
    // Prefer provider-injected city headers if present (fast/no external call).
    const fromCf = typeof h["cf-ipcity"] === "string" ? h["cf-ipcity"].trim() : "";
    if (fromCf) {
        return fromCf;
    }
    const fromVercel = typeof h["x-vercel-ip-city"] === "string" ? h["x-vercel-ip-city"].trim() : "";
    if (fromVercel) {
        return fromVercel;
    }

    const ip = extractRequestIp(req);
    if (!ip) {
        return "";
    }
    const cached = geoIpCityCache.get(ip);
    if (cached && Date.now() - cached.ts <= GEOIP_CACHE_TTL_MS) {
        return cached.city;
    }

    // Best-effort GeoIP: ipapi.co (no token). If fetch is unavailable or it errors, return empty.
    if (typeof fetch !== "function") {
        return "";
    }
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 1500);
    try {
        const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: ac.signal
        });
        if (!resp.ok) {
            return "";
        }
        const data = await resp.json().catch(() => null);
        const city = data && typeof data.city === "string" ? data.city.trim() : "";
        geoIpCityCache.set(ip, { city, ts: Date.now() });
        return city;
    } catch {
        return "";
    } finally {
        clearTimeout(timeout);
    }
}

if (hasFirebaseCredentials()) {
    firebaseAdminInit();
}

const app = express();
app.use(cors({
    origin: corsOriginOption(),
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Contact-Form-Mobile-Sync-Secret"],
    optionsSuccessStatus: 204
}));

app.options(PATHNAME, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_MOBILE_SHEET_SYNC, (_req, res) => res.sendStatus(204));

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
        const formId = typeof body._contactFormId === "string" ? body._contactFormId : "unknown";
        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                const s = scalarFormValue(val);
                if (s) {
                    fields[k] = s;
                }
            }
        }

        const name = fields.name ?? "";
        const email = fields.email ?? "";
        let mobile = resolveContactMobile(fields, body, mergedClientContext);
        if (!mobile) {
            const digitsFromContext = resolveSubmissionMobileDigits(fields, body, mergedClientContext);
            if (digitsFromContext) {
                mobile = digitsFromContext;
            }
        }
        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";

        if (DRIVE_ONLY) {
            const hasBytes = uploadedFiles.some(
                (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
            );
            if (!hasBytes) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "DRIVE_ONLY=1: include at least one file with data in the form, or remove DRIVE_ONLY to allow text-only submissions (Firestore / Sheet without attachments)."
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
                        formId,
                        mobile,
                        body
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
                    const pack = await uploadSubmissionFilesToDrive(uploadedFiles, {
                        mobile,
                        clientSessionId
                    });
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
        const ip = extractRequestIp(req);
        const city = await resolveCityForRequest(req);
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);
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
                        fileLinks: fileLinksForSheet,
                        ip,
                        city,
                        userQueriesCsv
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

/** Append one Sheet row when chat (Dialogflow) captured mobile — does not require file upload or DRIVE_ONLY. */
app.post(
    PATHNAME_MOBILE_SHEET_SYNC,
    express.json({ limit: "512kb" }),
    async (req, res) => {
        const syncSecret = (process.env.CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET || "").trim();
        if (syncSecret) {
            const sent = typeof req.headers["x-contact-form-mobile-sync-secret"] === "string"
                ? req.headers["x-contact-form-mobile-sync-secret"].trim()
                : "";
            if (sent !== syncSecret) {
                return res.status(401).json({
                    ok: false,
                    error: "Unauthorized (set X-Contact-Form-Mobile-Sync-Secret or CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET)."
                });
            }
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Google Sheets is not enabled. Set SHEETS_SPREADSHEET_ID or remove DISABLE_SHEETS=1."
            });
        }

        let body = req.body && typeof req.body === "object" ? req.body : {};

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

        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                const s = scalarFormValue(val);
                if (s) {
                    fields[k] = s;
                }
            }
        }

        const formId =
            typeof body._contactFormId === "string" && body._contactFormId.trim()
                ? body._contactFormId.trim()
                : "chat";
        let mobile =
            resolveContactMobile(fields, body, mergedClientContext)
            || resolveSubmissionMobileDigits(fields, body, mergedClientContext)
            || "";
        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";
        const name = fields.name ?? "";
        const email = fields.email ?? "";

        if (!mobile) {
            return res.status(400).json({ ok: false, error: "Missing mobile (send mobile or client_context.mobile)." });
        }

        const iso = new Date().toISOString();
        const ip = extractRequestIp(req);
        const city = await resolveCityForRequest(req);
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);

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
                fileLinks: "",
                ip,
                city,
                userQueriesCsv
            });
            return res.status(200).json({ ok: true, message: "Sheet updated." });
        } catch (se) {
            const detail = se && se.message ? se.message : String(se);
            console.error("[contact-form-api] mobile-sheet-sync", detail, se);
            return res.status(500).json({ ok: false, error: detail });
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
            `POST JSON (chat mobile) → ${PATHNAME_MOBILE_SHEET_SYNC}`,
            `GET /health → health check.`,
            `Drive uploads + optional Firestore/Sheets (DRIVE_ONLY=1 skips Firestore only; Sheets use SHEETS_SPREADSHEET_ID).`
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
    console.log(
        `contact-form-api listening on :${PORT} ${PATHNAME} ${PATHNAME_MOBILE_SHEET_SYNC} — ${fsHint} ${sheetHint} ${driveHint}${mode}`
    );
});
