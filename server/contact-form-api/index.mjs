/**
 * Backend for `company.js` POST /contact-form-submissions (same JSON the widget sends).
 * Hosting: **Railway only**. Data: **Firestore** + optional **Google Sheets** (append row on each submit).
 *
 * Setup:
 * 1. Firebase Console → Project settings → Service accounts → **Generate new private key** (JSON).
 * 2. Railway → **FIREBASE_SERVICE_ACCOUNT_JSON** = full JSON (used for Firestore + Sheets).
 * 3. Google Sheets: share the spreadsheet with the service account **`client_email`** (Editor). Enable **Google Sheets API** in the same Google Cloud project if prompted.
 * 4. Railway → **SHEETS_SPREADSHEET_ID** (from the sheet URL). Optional **SHEETS_RANGE** (default `Sheet1!A:I`). Set **DISABLE_SHEETS=1** to skip Sheets; omit **SHEETS_SPREADSHEET_ID** to use Firestore only.
 * 5. Point the site at this API (`dfchat-api-base-url` / `apiBase`).
 *
 * Env:
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_CONFIG, GOOGLE_APPLICATION_CREDENTIALS (local file)
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN
 *   SHEETS_SPREADSHEET_ID — enables live append when set (unless DISABLE_SHEETS=1)
 *   SHEETS_RANGE — optional, default Sheet1!A:I
 *   DISABLE_SHEETS=1 — never write to Sheets (even if SHEETS_SPREADSHEET_ID is set)
 */

import express from "express";
import cors from "cors";
import { firebaseAdminInit, persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet } from "./lib/sheets.mjs";

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 */
const SHEETS_DISABLED =
    process.env.DISABLE_SHEETS === "1" ||
    !(process.env.SHEETS_SPREADSHEET_ID || "").trim();
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1";

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
    const browserName = typeof clientContext.browser_name === "string"
        ? clientContext.browser_name.trim()
        : "";
    const deviceType = typeof clientContext.device_type === "string"
        ? clientContext.device_type.trim()
        : "";
    const channel = normalizeLeadChannel(clientContext.channel);
    const mergedClientContext = { ...clientContext, channel };

    const iso = new Date().toISOString();
    /** Firestore-safe payload (flattened for querying) */
    const record = {
        submitted_at: iso,
        form_id: formId,
        name,
        email,
        mobile,
        fields,
        client_context: mergedClientContext
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
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Opening the Railway URL in a browser hits GET / — avoid Express default "Cannot GET /". */
app.get("/", (_req, res) => {
    res.status(200).type("text/plain; charset=utf-8").send(
        [
            `Contact leads API running.`,
            `POST JSON → ${PATHNAME}`,
            `GET /health → health check.`,
            `Firestore + optional Google Sheets (set SHEETS_SPREADSHEET_ID on Railway for live sheet rows).`
        ].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    console.log(`contact-form-api listening on :${PORT} ${PATHNAME} — ${fsHint} ${sheetHint}`);
});
