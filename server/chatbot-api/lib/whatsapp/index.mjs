/**
 * WhatsApp Cloud API webhook → Dialogflow CX → reply on WhatsApp.
 *
 * Meta setup:
 *   Callback URL: https://YOUR-API.up.railway.app/api/whatsapp/webhook
 *   Verify token: same as WHATSAPP_VERIFY_TOKEN
 *   Subscribe to: messages
 *
 * Railway env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * Dialogflow auth: DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON (recommended) or FIREBASE_SERVICE_ACCOUNT_JSON
 * Optional: WHATSAPP_APP_SECRET (signature check), DIALOGFLOW_CX_* (defaults match company.config.js)
 */

import crypto from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { getServiceAccountCredentials } from "../google-service-account.mjs";

/**
 * Dialogflow-only credentials. Use when Firebase JSON is from another GCP project
 * or the service account is not visible under qabot01.
 * @returns {Record<string, unknown> | null}
 */
function getDialogflowServiceAccountCredentials_() {
    const raw = trim_(process.env.DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON);
    if (raw) {
        try {
            const o = JSON.parse(raw);
            if (o && o.type === "service_account" && typeof o.private_key === "string") {
                return o;
            }
        } catch {
            /* fall through */
        }
    }
    return getServiceAccountCredentials();
}

const LOG_TAG = "[whatsapp]";
const WEBHOOK_PATH = "/api/whatsapp/webhook";
const DIALOGFLOW_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** @type {Map<string, number>} */
const seenMessageIds_ = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 2000;

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

function whatsappConfig_() {
    return {
        verifyToken: trim_(process.env.WHATSAPP_VERIFY_TOKEN),
        accessToken: trim_(process.env.WHATSAPP_ACCESS_TOKEN),
        phoneNumberId: trim_(process.env.WHATSAPP_PHONE_NUMBER_ID),
        appSecret: trim_(process.env.WHATSAPP_APP_SECRET),
        projectId: trim_(process.env.DIALOGFLOW_CX_PROJECT_ID) || "qabot01",
        location: trim_(process.env.DIALOGFLOW_CX_LOCATION) || "us-central1",
        agentId: trim_(process.env.DIALOGFLOW_CX_AGENT_ID) || "9dbd4886-3cbe-43fc-8eb5-54ee5097f25c",
        languageCode: trim_(process.env.DIALOGFLOW_CX_LANGUAGE_CODE) || "en",
        graphVersion: trim_(process.env.WHATSAPP_GRAPH_API_VERSION) || "v21.0"
    };
}

/** @returns {string[]} */
export function missingWhatsappEnvKeys_() {
    const c = whatsappConfig_();
    const missing = [];
    if (!c.verifyToken) {
        missing.push("WHATSAPP_VERIFY_TOKEN");
    }
    if (!c.accessToken) {
        missing.push("WHATSAPP_ACCESS_TOKEN");
    }
    if (!c.phoneNumberId) {
        missing.push("WHATSAPP_PHONE_NUMBER_ID");
    }
    if (!getDialogflowServiceAccountCredentials_()) {
        missing.push(
            "DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON (Dialogflow CX API)"
        );
    }
    if (!c.projectId) {
        missing.push("DIALOGFLOW_CX_PROJECT_ID");
    }
    if (!c.agentId) {
        missing.push("DIALOGFLOW_CX_AGENT_ID");
    }
    return missing;
}

function log_(event, extra) {
    const base = { event };
    console.log(LOG_TAG, JSON.stringify(extra ? { ...base, ...extra } : base));
}

function pruneSeen_() {
    const now = Date.now();
    for (const [id, at] of seenMessageIds_) {
        if (now - at > SEEN_TTL_MS) {
            seenMessageIds_.delete(id);
        }
    }
    while (seenMessageIds_.size > SEEN_MAX) {
        const first = seenMessageIds_.keys().next().value;
        if (first) {
            seenMessageIds_.delete(first);
        } else {
            break;
        }
    }
}

function wasSeenMessage_(id) {
    if (!id) {
        return false;
    }
    pruneSeen_();
    if (seenMessageIds_.has(id)) {
        return true;
    }
    seenMessageIds_.set(id, Date.now());
    return false;
}

function sessionIdForWaUser_(waUserId) {
    const safe = String(waUserId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    return `wa_${safe}`;
}

/**
 * @param {unknown} data
 * @returns {string[]}
 */
function extractCxReplyTexts_(data) {
    const out = [];
    const messages = data?.queryResult?.responseMessages;
    if (!Array.isArray(messages)) {
        return out;
    }
    for (const m of messages) {
        const parts = m?.text?.text;
        if (Array.isArray(parts)) {
            for (const t of parts) {
                const s = trim_(t);
                if (s) {
                    out.push(s);
                }
            }
        }
    }
    return out;
}

async function getDialogflowAccessToken_() {
    const key = getDialogflowServiceAccountCredentials_();
    if (!key) {
        throw new Error("Missing service account JSON for Dialogflow CX");
    }
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: [DIALOGFLOW_SCOPE]
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token?.token;
    if (!accessToken) {
        throw new Error("Could not obtain Google access token for Dialogflow");
    }
    return accessToken;
}

/**
 * @param {{ sessionId: string, text: string, languageCode: string }} input
 */
async function detectIntentCx_(input) {
    const c = whatsappConfig_();
    const accessToken = await getDialogflowAccessToken_();
    const host = `${c.location}-dialogflow.googleapis.com`;
    const sessionPath = [
        "projects",
        c.projectId,
        "locations",
        c.location,
        "agents",
        c.agentId,
        "sessions",
        input.sessionId
    ].join("/");
    const url = `https://${host}/v3/${sessionPath}:detectIntent`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            queryInput: {
                text: { text: input.text },
                languageCode: input.languageCode
            }
        })
    });
    const raw = await res.text();
    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {};
    }
    if (!res.ok) {
        const errMsg =
            data?.error?.message || data?.message || raw.slice(0, 400) || `HTTP ${res.status}`;
        throw new Error(`Dialogflow detectIntent failed: ${errMsg}`);
    }
    return data;
}

/**
 * @param {{ to: string, body: string }} input
 */
async function sendWhatsappText_(input) {
    const c = whatsappConfig_();
    const url = `https://graph.facebook.com/${c.graphVersion}/${c.phoneNumberId}/messages`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${c.accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: input.to,
            type: "text",
            text: { body: input.body.slice(0, 4096) }
        })
    });
    const raw = await res.text();
    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {};
    }
    if (!res.ok) {
        const errMsg =
            data?.error?.message || raw.slice(0, 400) || `HTTP ${res.status}`;
        throw new Error(`WhatsApp send failed: ${errMsg}`);
    }
    return data;
}

function verifyMetaSignature_(rawBody, signatureHeader, appSecret) {
    if (!appSecret) {
        return true;
    }
    const sig = trim_(signatureHeader);
    if (!sig.startsWith("sha256=")) {
        return false;
    }
    const expected =
        "sha256=" +
        crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        return false;
    }
}

/** GET — Meta webhook verification */
function handleVerify_(req, res) {
    const c = whatsappConfig_();
    const mode = trim_(req.query["hub.mode"]);
    const token = trim_(req.query["hub.verify_token"]);
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && token === c.verifyToken && challenge != null) {
        log_("verify_ok");
        return res.status(200).send(String(challenge));
    }
    log_("verify_failed", { mode, token_match: token === c.verifyToken });
    return res.sendStatus(403);
}

/** POST — incoming WhatsApp events */
async function handleWebhookPost_(req, res) {
    const c = whatsappConfig_();
    const rawBody = req.rawBody;
    if (c.appSecret && rawBody) {
        const ok = verifyMetaSignature_(
            rawBody,
            req.get("x-hub-signature-256") || "",
            c.appSecret
        );
        if (!ok) {
            log_("signature_invalid");
            return res.sendStatus(403);
        }
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.object !== "whatsapp_business_account") {
        return res.sendStatus(200);
    }

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value && typeof change.value === "object" ? change.value : {};
            const messages = Array.isArray(value.messages) ? value.messages : [];
            for (const msg of messages) {
                if (msg?.type !== "text" || !msg?.text?.body) {
                    continue;
                }
                const messageId = trim_(msg.id);
                if (wasSeenMessage_(messageId)) {
                    continue;
                }
                const from = trim_(msg.from);
                const text = trim_(msg.text.body);
                if (!from || !text) {
                    continue;
                }
                try {
                    const sessionId = sessionIdForWaUser_(from);
                    const cx = await detectIntentCx_({
                        sessionId,
                        text,
                        languageCode: c.languageCode
                    });
                    const replies = extractCxReplyTexts_(cx);
                    const replyBody =
                        replies.length > 0
                            ? replies.join("\n\n")
                            : "Sorry, I could not process that. Please try again.";
                    await sendWhatsappText_({ to: from, body: replyBody });
                    log_("reply_sent", {
                        from_masked: from.length > 4 ? `***${from.slice(-4)}` : "***",
                        sessionId,
                        reply_chars: replyBody.length
                    });
                } catch (e) {
                    const errMsg = e && e.message ? e.message : String(e);
                    log_("message_error", { error: errMsg.slice(0, 300) });
                    try {
                        await sendWhatsappText_({
                            to: from,
                            body: "Sorry, something went wrong. Please try again in a moment."
                        });
                    } catch {
                        /* ignore secondary failure */
                    }
                }
            }
        }
    }

    return res.sendStatus(200);
}

function handleHealth_(req, res) {
    const c = whatsappConfig_();
    const missing = missingWhatsappEnvKeys_();
    const dfKey = getDialogflowServiceAccountCredentials_();
    const dfProjectId =
        dfKey && typeof dfKey.project_id === "string" ? trim_(dfKey.project_id) : "";
    const dfClientEmail =
        dfKey && typeof dfKey.client_email === "string" ? trim_(dfKey.client_email) : "";
    const webhookUrlHint =
        trim_(process.env.CONVERSATIONS_PUBLIC_BASE_URL) ||
        (trim_(process.env.RAILWAY_PUBLIC_DOMAIN)
            ? `https://${trim_(process.env.RAILWAY_PUBLIC_DOMAIN)}`
            : "");
    return res.status(200).json({
        ok: missing.length === 0,
        webhook_path: WEBHOOK_PATH,
        webhook_url_example: webhookUrlHint
            ? `${webhookUrlHint.replace(/\/+$/, "")}${WEBHOOK_PATH}`
            : `https://YOUR-API.up.railway.app${WEBHOOK_PATH}`,
        missing_env: missing,
        dialogflow: {
            projectId: c.projectId,
            location: c.location,
            agentId: c.agentId ? `${c.agentId.slice(0, 8)}…` : "",
            languageCode: c.languageCode,
            credentials_source: trim_(process.env.DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON)
                ? "DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON"
                : "FIREBASE_SERVICE_ACCOUNT_JSON",
            service_account_project_id: dfProjectId,
            service_account_email: dfClientEmail
                ? dfClientEmail.replace(/^(.{3}).*(@.+)$/, "$1…$2")
                : ""
        },
        whatsapp: {
            phone_number_id_set: !!c.phoneNumberId,
            access_token_set: !!c.accessToken,
            verify_token_set: !!c.verifyToken,
            app_secret_set: !!c.appSecret
        }
    });
}

/**
 * @param {import("express").Express} app
 */
export function mountWhatsappRoutes(app) {
    const rawJson = express.raw({ type: "application/json", limit: "512kb" });

    app.get(WEBHOOK_PATH, handleVerify_);

    app.post(WEBHOOK_PATH, rawJson, (req, res, next) => {
        req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
        try {
            req.body = req.rawBody.length
                ? JSON.parse(req.rawBody.toString("utf8"))
                : {};
        } catch {
            req.body = {};
        }
        next();
    }, handleWebhookPost_);

    app.get("/api/whatsapp/health", handleHealth_);
}
