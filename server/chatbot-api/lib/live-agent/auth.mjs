/**
 * Live-agent dashboard auth — reuses the customization dashboard session cookie.
 * Allowlist: LIVE_AGENT_ALLOWED_EMAILS, else DASHBOARD_ALLOWED_EMAILS.
 */

import crypto from "node:crypto";

const COOKIE_NAME = "dashboard_session";
const SESSION_VERSION = "v1";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function allowedEmailsFromEnv_(key) {
    const raw = trim_(process.env[key]);
    if (!raw) return [];
    return raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

export function liveAgentAllowedEmails_() {
    const dedicated = allowedEmailsFromEnv_("LIVE_AGENT_ALLOWED_EMAILS");
    if (dedicated.length > 0) return dedicated;
    return allowedEmailsFromEnv_("DASHBOARD_ALLOWED_EMAILS");
}

export function isLiveAgentEmailAllowed_(email) {
    const e = trim_(email).toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
    const list = liveAgentAllowedEmails_();
    if (list.length === 0) return false;
    return list.includes(e);
}

function sessionSecret_() {
    const s = trim_(process.env.DASHBOARD_SESSION_SECRET);
    return s.length >= 16 ? s : "";
}

function b64urlDecode_(s) {
    const raw = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (raw.length % 4)) % 4;
    return Buffer.from(raw + "=".repeat(pad), "base64");
}

function b64urlEncode_(buf) {
    return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hmacSha256_(secret, data) {
    return crypto.createHmac("sha256", secret).update(data).digest();
}

function timingSafeEqStr_(a, b) {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function verifyPayload_(token, secret) {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expectSig = b64urlEncode_(hmacSha256_(secret, body));
    if (!timingSafeEqStr_(sig, expectSig)) return null;
    let json;
    try {
        json = JSON.parse(b64urlDecode_(body).toString("utf8"));
    } catch {
        return null;
    }
    if (!json || typeof json !== "object") return null;
    if (typeof json.exp === "number" && Date.now() > json.exp) return null;
    return json;
}

function parseCookies_(req) {
    const out = {};
    const raw = trim_(req.headers && req.headers.cookie);
    if (!raw) return out;
    for (const part of raw.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

export function readLiveAgentSessionFromReq_(req) {
    const secret = sessionSecret_();
    if (!secret) return null;
    const cookies = parseCookies_(req);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    const data = verifyPayload_(token, secret);
    if (!data || data.k !== "session") return null;
    if (!isLiveAgentEmailAllowed_(data.email)) return null;
    return { email: data.email };
}

export function liveAgentAuthRequired_() {
    const v = trim_(process.env.LIVE_AGENT_REQUIRE_AUTH).toLowerCase();
    if (v === "0" || v === "false" || v === "no") return false;
    return true;
}

export function requireLiveAgentSession_() {
    return (req, res, next) => {
        if (!liveAgentAuthRequired_()) {
            req.liveAgentSession = { email: trim_(process.env.LIVE_AGENT_DEV_EMAIL) || "dev@local" };
            next();
            return;
        }
        const sess = readLiveAgentSessionFromReq_(req);
        if (!sess) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        req.liveAgentSession = sess;
        next();
    };
}

export function liveAgentAuthConfigured_() {
    return liveAgentAllowedEmails_().length > 0 && !!sessionSecret_();
}
