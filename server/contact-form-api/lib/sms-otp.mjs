/**
 * SMS OTP integration — provider: Fast2SMS (https://www.fast2sms.com/dashboard/dev-api).
 *
 * Adds three HTTP endpoints to your existing Express app:
 *   POST /api/sms-otp/send    body: { mobile }              -> sends a numeric OTP via Fast2SMS
 *   POST /api/sms-otp/verify  body: { mobile, code }        -> verifies the OTP (one-shot, then consumed)
 *   GET  /api/sms-otp/health                                -> reports whether FAST2SMS_API_KEY is configured
 *
 * Wire-up — add ONE line near the top of index.mjs and ONE line right after `const app = express();`:
 *   import { mountSmsOtpRoutes } from "./lib/sms-otp.mjs";
 *   mountSmsOtpRoutes(app);
 *
 * Required env:
 *   FAST2SMS_API_KEY            Dev API key from your Fast2SMS dashboard.
 *
 * Optional env:
 *   FAST2SMS_ROUTE              "otp" (default) | "q" | "v3" | "dlt"
 *                               - "otp": Fast2SMS sends a generic "Your OTP verification code is XXXXXX" message.
 *                                        No DLT approval required, only Indian numbers, no custom text.
 *                               - "q"  : Quick transactional, custom message (FAST2SMS_MESSAGE_TEMPLATE).
 *                               - "v3" : Sender-ID route (legacy), needs FAST2SMS_SENDER_ID.
 *                               - "dlt": DLT route, needs FAST2SMS_SENDER_ID + FAST2SMS_DLT_MESSAGE_ID.
 *   FAST2SMS_SENDER_ID          DLT sender id (required for "dlt"/"v3").
 *   FAST2SMS_MESSAGE_TEMPLATE   Custom message for "q"/"v3" routes. Use {{otp}} placeholder.
 *                               Default: "Your OTP is {{otp}}".
 *   FAST2SMS_DLT_MESSAGE_ID     DLT-approved template id (numeric) for "dlt" route.
 *   SMS_OTP_LENGTH              Digits in the OTP. 4..8, default 6.
 *   SMS_OTP_TTL_SECONDS         OTP validity window. 30..900, default 300 (5 min).
 *   SMS_OTP_MAX_ATTEMPTS        Verify failures before lockout. 1..20, default 5.
 *   SMS_OTP_RESEND_COOLDOWN_S   Min seconds between sends to same mobile. 0..600, default 30.
 *
 * Mobile format: Indian 10-digit. `+91` / `91` / leading `0` are stripped. Fast2SMS OTP route
 *   accepts only valid Indian mobile numbers starting with 6-9.
 *
 * Storage: in-memory `Map` (per-process). For multi-instance / horizontally scaled deployments,
 *   replace `otpStore` with Firestore or Redis (the two helpers `storeOtp_` / `consumeOtp_` are
 *   the only places that touch state).
 */

import crypto from "node:crypto";
import express from "express";

const FAST2SMS_ENDPOINT = "https://www.fast2sms.com/dev/bulkV2";

function envInt_(key, fallback, min, max) {
    const raw = (process.env[key] || "").trim();
    if (!raw) {
        return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    const clamped = Math.round(n);
    if (Number.isFinite(min) && clamped < min) {
        return min;
    }
    if (Number.isFinite(max) && clamped > max) {
        return max;
    }
    return clamped;
}

function smsOtpLength_() {
    return envInt_("SMS_OTP_LENGTH", 6, 4, 8);
}

function smsOtpTtlSeconds_() {
    return envInt_("SMS_OTP_TTL_SECONDS", 300, 30, 15 * 60);
}

function smsOtpMaxAttempts_() {
    return envInt_("SMS_OTP_MAX_ATTEMPTS", 5, 1, 20);
}

function smsOtpResendCooldownSeconds_() {
    return envInt_("SMS_OTP_RESEND_COOLDOWN_S", 30, 0, 600);
}

/** Cryptographically-strong numeric OTP of `SMS_OTP_LENGTH` digits. */
function generateOtp_() {
    const len = smsOtpLength_();
    let out = "";
    while (out.length < len) {
        const buf = crypto.randomBytes(len);
        for (let i = 0; i < buf.length && out.length < len; i += 1) {
            out += String(buf[i] % 10);
        }
    }
    return out;
}

function sha256Hex_(s) {
    return crypto.createHash("sha256").update(String(s)).digest("hex");
}

/** Strip +91 / 91 / leading 0; return a 10-digit Indian mobile or "" if invalid. */
function normalizeIndianMobile_(raw) {
    const digits = String(raw == null ? "" : raw).replace(/\D+/g, "");
    let d = digits;
    if (d.length === 12 && d.startsWith("91")) {
        d = d.slice(2);
    } else if (d.length === 11 && d.startsWith("0")) {
        d = d.slice(1);
    }
    if (!/^[6-9]\d{9}$/.test(d)) {
        return "";
    }
    return d;
}

/**
 * In-memory OTP store keyed by 10-digit mobile.
 * Per-process only — swap for Firestore/Redis on horizontally scaled deployments.
 * @type {Map<string, { codeHash: string, expiresAt: number, attempts: number, sentAt: number }>}
 */
const otpStore = new Map();

function purgeExpiredOtps_() {
    const now = Date.now();
    for (const [key, rec] of otpStore.entries()) {
        if (!rec || rec.expiresAt <= now) {
            otpStore.delete(key);
        }
    }
}

function storeOtp_(mobile, code) {
    purgeExpiredOtps_();
    const ttlMs = smsOtpTtlSeconds_() * 1000;
    otpStore.set(mobile, {
        codeHash: sha256Hex_(code),
        expiresAt: Date.now() + ttlMs,
        attempts: 0,
        sentAt: Date.now()
    });
}

/**
 * Verify and consume the OTP.
 * @returns {{ ok: true } | { ok: false, reason: string, attempts_remaining?: number }}
 */
function consumeOtp_(mobile, code) {
    purgeExpiredOtps_();
    const rec = otpStore.get(mobile);
    if (!rec) {
        return { ok: false, reason: "no_otp_or_expired" };
    }
    if (rec.expiresAt <= Date.now()) {
        otpStore.delete(mobile);
        return { ok: false, reason: "no_otp_or_expired" };
    }
    const max = smsOtpMaxAttempts_();
    if (rec.attempts >= max) {
        otpStore.delete(mobile);
        return { ok: false, reason: "too_many_attempts" };
    }
    rec.attempts += 1;
    if (rec.codeHash !== sha256Hex_(code)) {
        const remaining = Math.max(0, max - rec.attempts);
        if (remaining <= 0) {
            otpStore.delete(mobile);
            return { ok: false, reason: "too_many_attempts", attempts_remaining: 0 };
        }
        return { ok: false, reason: "invalid_code", attempts_remaining: remaining };
    }
    otpStore.delete(mobile);
    return { ok: true };
}

function lastSentAtMs_(mobile) {
    const rec = otpStore.get(mobile);
    return rec && Number.isFinite(rec.sentAt) ? rec.sentAt : 0;
}

/**
 * Send the OTP SMS through Fast2SMS.
 * @param {string} mobile10  10-digit Indian mobile.
 * @param {string} otp       Numeric OTP.
 * @returns {Promise<{ ok: boolean, status?: number, request_id?: string, error?: string }>}
 */
async function sendOtpViaFast2Sms_(mobile10, otp) {
    const apiKey = (process.env.FAST2SMS_API_KEY || "").trim();
    if (!apiKey) {
        return { ok: false, error: "FAST2SMS_API_KEY is not set on the server." };
    }
    const route = (process.env.FAST2SMS_ROUTE || "otp").trim().toLowerCase();

    /** @type {Record<string, string>} */
    const body = { route, numbers: mobile10 };

    if (route === "otp") {
        body.variables_values = otp;
    } else if (route === "dlt") {
        const tplId = (process.env.FAST2SMS_DLT_MESSAGE_ID || "").trim();
        const sender = (process.env.FAST2SMS_SENDER_ID || "").trim();
        if (!tplId || !sender) {
            return {
                ok: false,
                error: "FAST2SMS_DLT_MESSAGE_ID and FAST2SMS_SENDER_ID are required for FAST2SMS_ROUTE=dlt."
            };
        }
        body.message = tplId;
        body.sender_id = sender;
        body.variables_values = otp;
    } else if (route === "v3") {
        const sender = (process.env.FAST2SMS_SENDER_ID || "FSTSMS").trim();
        const tpl = (process.env.FAST2SMS_MESSAGE_TEMPLATE || "Your OTP is {{otp}}").trim();
        body.message = tpl.replace(/\{\{\s*otp\s*\}\}/g, otp);
        body.sender_id = sender;
        body.language = "english";
        body.flash = "0";
    } else if (route === "q") {
        const tpl = (process.env.FAST2SMS_MESSAGE_TEMPLATE || "Your OTP is {{otp}}").trim();
        body.message = tpl.replace(/\{\{\s*otp\s*\}\}/g, otp);
        body.language = "english";
        body.flash = "0";
    } else {
        return {
            ok: false,
            error: `Unsupported FAST2SMS_ROUTE "${route}". Use one of: otp, q, v3, dlt.`
        };
    }

    /** @type {Response} */
    let resp;
    try {
        resp = await fetch(FAST2SMS_ENDPOINT, {
            method: "POST",
            headers: {
                authorization: apiKey,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify(body)
        });
    } catch (e) {
        return {
            ok: false,
            error: `Fast2SMS request failed: ${e && e.message ? e.message : String(e)}`
        };
    }

    const text = await resp.text();
    /** @type {Record<string, unknown>} */
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }

    if (!resp.ok || data.return === false) {
        const msg =
            typeof data.message === "string"
                ? data.message
                : Array.isArray(data.message)
                    ? data.message.join(", ")
                    : `Fast2SMS HTTP ${resp.status}`;
        return { ok: false, status: resp.status, error: msg };
    }

    const requestId = typeof data.request_id === "string" ? data.request_id : undefined;
    return { ok: true, status: resp.status, request_id: requestId };
}

/** POST /api/sms-otp/send */
async function handleSendOtp_(req, res) {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const mobile = normalizeIndianMobile_(body.mobile);
        if (!mobile) {
            return res
                .status(400)
                .json({ ok: false, error: "Provide a valid 10-digit Indian mobile number." });
        }

        const cooldown = smsOtpResendCooldownSeconds_();
        if (cooldown > 0) {
            const last = lastSentAtMs_(mobile);
            if (last) {
                const elapsedMs = Date.now() - last;
                const remainingMs = cooldown * 1000 - elapsedMs;
                if (remainingMs > 0) {
                    const retryAfter = Math.ceil(remainingMs / 1000);
                    return res
                        .status(429)
                        .set("Retry-After", String(retryAfter))
                        .json({
                            ok: false,
                            error: `Please wait ${retryAfter}s before requesting a new OTP.`,
                            retry_after_seconds: retryAfter
                        });
                }
            }
        }

        const otp = generateOtp_();
        const sendResult = await sendOtpViaFast2Sms_(mobile, otp);
        if (!sendResult.ok) {
            return res
                .status(502)
                .json({ ok: false, error: sendResult.error || "Failed to send OTP." });
        }

        storeOtp_(mobile, otp);

        return res.status(200).json({
            ok: true,
            message: "OTP sent.",
            ttl_seconds: smsOtpTtlSeconds_(),
            request_id: sendResult.request_id
        });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
}

/** POST /api/sms-otp/verify */
function handleVerifyOtp_(req, res) {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const mobile = normalizeIndianMobile_(body.mobile);
        const codeRaw = body.code != null ? body.code : body.otp;
        const code = String(codeRaw == null ? "" : codeRaw).replace(/\D+/g, "");
        if (!mobile) {
            return res
                .status(400)
                .json({ ok: false, error: "Provide a valid 10-digit Indian mobile number." });
        }
        if (!code) {
            return res.status(400).json({ ok: false, error: "Provide the OTP code." });
        }
        const r = consumeOtp_(mobile, code);
        if (r.ok) {
            return res.status(200).json({ ok: true, message: "OTP verified." });
        }
        /** Map our reason -> HTTP status + human message. */
        let httpStatus = 400;
        let message = "Invalid or expired OTP.";
        if (r.reason === "no_otp_or_expired") {
            message = "OTP expired or not requested. Please request a new code.";
            httpStatus = 410;
        } else if (r.reason === "too_many_attempts") {
            message = "Too many incorrect attempts. Please request a new OTP.";
            httpStatus = 429;
        } else if (r.reason === "invalid_code") {
            message = "Incorrect OTP.";
            httpStatus = 400;
        }
        return res.status(httpStatus).json({
            ok: false,
            error: message,
            reason: r.reason,
            attempts_remaining: r.attempts_remaining
        });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
}

/** GET /api/sms-otp/health */
function handleHealth_(_req, res) {
    const apiKey = (process.env.FAST2SMS_API_KEY || "").trim();
    return res.status(200).json({
        ok: !!apiKey,
        provider: "fast2sms",
        api_key_configured: !!apiKey,
        route: (process.env.FAST2SMS_ROUTE || "otp").trim().toLowerCase(),
        otp_length: smsOtpLength_(),
        ttl_seconds: smsOtpTtlSeconds_(),
        max_attempts: smsOtpMaxAttempts_(),
        resend_cooldown_seconds: smsOtpResendCooldownSeconds_(),
        pending_otp_count: otpStore.size
    });
}

/**
 * Register SMS OTP routes on the given Express app.
 * Call once after `const app = express();`.
 * @param {import("express").Express} app
 */
export function mountSmsOtpRoutes(app) {
    const json = express.json({ limit: "16kb" });
    app.post("/api/sms-otp/send", json, handleSendOtp_);
    app.post("/api/sms-otp/verify", json, handleVerifyOtp_);
    app.get("/api/sms-otp/health", handleHealth_);
}

/** Exposed for unit testing only. */
export const __smsOtpInternals = {
    normalizeIndianMobile: normalizeIndianMobile_,
    generateOtp: generateOtp_,
    storeOtp: storeOtp_,
    consumeOtp: consumeOtp_,
    sendOtpViaFast2Sms: sendOtpViaFast2Sms_,
    store: otpStore
};
