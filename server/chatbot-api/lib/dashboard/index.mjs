/**
 * Customization dashboard — drop-in Express module.
 *
 * Endpoints registered by `mountDashboardRoutes(app, opts)`:
 *
 *   Static front-end (served from <pkg>/dashboard/):
 *     GET  /dashboard              → dashboard SPA shell
 *     GET  /dashboard/*            → dashboard CSS / JS / assets
 *
 *   JSON API:
 *     POST /api/dashboard/login/request     body: { email }                      [public]
 *     GET  /api/dashboard/login/verify?token=...                                  [public]
 *     POST /api/dashboard/logout                                                  [public, idempotent]
 *     GET  /api/dashboard/me                                                      [auth if DASHBOARD_REQUIRE_AUTH]
 *     GET  /api/dashboard/settings?botid=...                                      [auth if DASHBOARD_REQUIRE_AUTH]
 *     PUT  /api/dashboard/settings?botid=...   body: { flat, advancedPatchJson }  [auth if DASHBOARD_REQUIRE_AUTH]
 *     GET  /api/dashboard/appointments?status=...                               [auth if DASHBOARD_REQUIRE_AUTH]
 *     PATCH /api/dashboard/appointments/:key   body: { staffStatus }            [auth if DASHBOARD_REQUIRE_AUTH]
 *
 *   Public read (called by chat-frame.html on load to apply saved settings):
 *     GET  /api/public/widget-settings?botid=...                                  [public, CORS *]
 *
 * Auth design:
 *   - Passwordless magic links via existing SMTP. Email allowlist via env.
 *   - One-time-use tokens: HMAC over { email, exp, nonce }. Consumed in Firestore.
 *   - Session: HMAC-signed cookie { email, exp }. HttpOnly, SameSite=Lax.
 *
 * Required env vars:
 *   DASHBOARD_ALLOWED_EMAILS      comma-separated allowlist, e.g. "alice@x.com,bob@y.com"
 *   DASHBOARD_SESSION_SECRET      random 32+ char string (HMAC key for tokens + cookies)
 *   DASHBOARD_PUBLIC_BASE_URL     public origin of THIS API, e.g. "https://api.example.com"
 *                                 (used to build the magic-link URL in the email)
 *
 * Optional env vars:
 *   DASHBOARD_SESSION_TTL_HOURS   default 168 (7 days)
 *   DASHBOARD_LINK_TTL_MINUTES    default 15
 *   DASHBOARD_FROM_EMAIL          fallback to MAIL_FROM / SMTP_USER
 *   DASHBOARD_SETTINGS_COLLECTION default "dashboard_settings"
 *   DASHBOARD_TOKENS_COLLECTION   default "dashboard_login_tokens"
 *   DASHBOARD_PREVIEW_URL         default preview chat-frame.html URL (informational)
 *   DASHBOARD_WIDGET_SETTINGS_BACKEND  "firestore" | omit for "file" (default) — file = disk JSON for theme without Firestore
 *   DASHBOARD_WIDGET_SETTINGS_FILE     path when backend=file (default: server/chatbot-api/data/widget-settings-store.json)
 *
 * Peer deps (already in package.json): express, firebase-admin, nodemailer.
 */

import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import express from "express";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { isSmtpCredentialEnvPresent_ } from "../mail/smtp-transport.mjs";
import {
    currentMailProvider_,
    isMailConfigured_,
    sendTimedMail_,
    transactionalFromAddress_
} from "../mail/smtp-send.mjs";
import { isResendConfigured_ } from "../mail/resend-send.mjs";
import { githubWidgetPublishConfigured_, publishWidgetBotToGithub_ } from "./github-widget-publish.mjs";
import {
    listAppointmentLeads,
    updateAppointmentLeadStaffStatus
} from "../appointments.mjs";
import { listDoctors } from "../catalog-rtdb.mjs";

const LOG_TAG = "[dashboard]";

const COOKIE_NAME = "dashboard_session";
const SESSION_VERSION = "v1";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
/** Static front-end lives at `<server/chatbot-api>/dashboard/`. */
const STATIC_DIR = path.resolve(__dirname_lib, "..", "..", "dashboard");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function envInt_(key, fallback, min, max) {
    const raw = trim_(process.env[key]);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    const c = Math.round(n);
    if (Number.isFinite(min) && c < min) return min;
    if (Number.isFinite(max) && c > max) return max;
    return c;
}

function allowedEmails_() {
    const raw = trim_(process.env.DASHBOARD_ALLOWED_EMAILS);
    if (!raw) return [];
    return raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function isEmailAllowed_(email) {
    const e = trim_(email).toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
    const list = allowedEmails_();
    if (list.length === 0) return false;
    return list.includes(e);
}

function sessionSecret_() {
    const s = trim_(process.env.DASHBOARD_SESSION_SECRET);
    return s.length >= 16 ? s : "";
}

function publicBaseUrl_() {
    return trim_(process.env.DASHBOARD_PUBLIC_BASE_URL).replace(/\/+$/, "");
}

function fromEmail_() {
    return trim_(process.env.DASHBOARD_FROM_EMAIL) || transactionalFromAddress_();
}

function b64urlEncode_(buf) {
    return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode_(s) {
    const raw = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (raw.length % 4)) % 4;
    return Buffer.from(raw + "=".repeat(pad), "base64");
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

/** Compact signed payload: base64url(JSON).base64url(HMAC). */
function signPayload_(payload, secret) {
    const body = b64urlEncode_(JSON.stringify(payload));
    const sig = b64urlEncode_(hmacSha256_(secret, body));
    return `${body}.${sig}`;
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

// --- Cookies (dep-free) -----------------------------------------------------

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

function setSessionCookie_(res, value, maxAgeSec) {
    const secure = (process.env.DASHBOARD_COOKIE_SECURE || "1").trim() !== "0";
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(1, Math.floor(maxAgeSec))}`
    ];
    if (secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie_(res) {
    const secure = (process.env.DASHBOARD_COOKIE_SECURE || "1").trim() !== "0";
    const parts = [
        `${COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0"
    ];
    if (secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

// --- Firestore --------------------------------------------------------------

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function settingsCollection_() {
    return trim_(process.env.DASHBOARD_SETTINGS_COLLECTION) || "dashboard_settings";
}

function tokensCollection_() {
    return trim_(process.env.DASHBOARD_TOKENS_COLLECTION) || "dashboard_login_tokens";
}

function botIdOrDefault_(v) {
    const s = trim_(v) || "default";
    // Restrict to filesystem-safe characters; we use this as a doc id.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return "default";
    return s;
}

/** @returns {"firestore" | "file"} */
function widgetSettingsBackend_() {
    const v = trim_(process.env.DASHBOARD_WIDGET_SETTINGS_BACKEND).toLowerCase();
    if (v === "firestore") {
        return "firestore";
    }
    if (v === "file" || v === "filesystem" || v === "disk") {
        return "file";
    }
    return "file";
}

function widgetSettingsFilePath_() {
    const custom = trim_(process.env.DASHBOARD_WIDGET_SETTINGS_FILE);
    if (custom) {
        return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
    }
    return path.resolve(__dirname_lib, "..", "..", "data", "widget-settings-store.json");
}

const WIDGET_SETTINGS_FILE_SCHEMA_VERSION = 1;

async function readWidgetSettingsFileRoot_(filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return { version: WIDGET_SETTINGS_FILE_SCHEMA_VERSION, bots: {} };
        }
        const bots = parsed.bots && typeof parsed.bots === "object" ? parsed.bots : {};
        return { version: WIDGET_SETTINGS_FILE_SCHEMA_VERSION, bots };
    } catch (err) {
        const code = err && err.code;
        if (code === "ENOENT") {
            return { version: WIDGET_SETTINGS_FILE_SCHEMA_VERSION, bots: {} };
        }
        throw err;
    }
}

async function readSettingsFromFile_(botid) {
    const id = botIdOrDefault_(botid);
    const filePath = widgetSettingsFilePath_();
    const root = await readWidgetSettingsFileRoot_(filePath);
    const row = root.bots[id];
    if (!row || typeof row !== "object") {
        return { flat: {}, advancedPatchJson: "", updatedAt: null, updatedBy: "" };
    }
    return {
        flat: row.flat && typeof row.flat === "object" ? row.flat : {},
        advancedPatchJson: typeof row.advancedPatchJson === "string" ? row.advancedPatchJson : "",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
        updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : ""
    };
}

async function writeSettingsToFile_(botid, flat, advancedPatchJson, email) {
    const id = botIdOrDefault_(botid);
    const filePath = widgetSettingsFilePath_();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const root = await readWidgetSettingsFileRoot_(filePath);
    const now = new Date().toISOString();
    root.version = WIDGET_SETTINGS_FILE_SCHEMA_VERSION;
    root.bots[id] = {
        flat: flat && typeof flat === "object" ? flat : {},
        advancedPatchJson: typeof advancedPatchJson === "string" ? advancedPatchJson : "",
        updatedAt: now,
        updatedBy: trim_(email)
    };
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(root, null, 2), "utf8");
    await fs.rename(tmp, filePath);
}

async function readSettings_(botid) {
    if (widgetSettingsBackend_() === "file") {
        return readSettingsFromFile_(botid);
    }
    const db = firestoreDb_();
    const snap = await db.collection(settingsCollection_()).doc(botIdOrDefault_(botid)).get();
    if (!snap.exists) {
        return { flat: {}, advancedPatchJson: "", updatedAt: null, updatedBy: "" };
    }
    const data = snap.data() || {};
    return {
        flat: data.flat && typeof data.flat === "object" ? data.flat : {},
        advancedPatchJson: typeof data.advancedPatchJson === "string" ? data.advancedPatchJson : "",
        updatedAt: data.updatedAt && typeof data.updatedAt.toDate === "function" ? data.updatedAt.toDate().toISOString() : null,
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : ""
    };
}

async function writeSettings_(botid, flat, advancedPatchJson, email) {
    if (widgetSettingsBackend_() === "file") {
        return writeSettingsToFile_(botid, flat, advancedPatchJson, email);
    }
    const db = firestoreDb_();
    await db.collection(settingsCollection_()).doc(botIdOrDefault_(botid)).set({
        flat: flat && typeof flat === "object" ? flat : {},
        advancedPatchJson: typeof advancedPatchJson === "string" ? advancedPatchJson : "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: trim_(email)
    });
}

/** Consume a magic-link token id once. Returns true if this call consumed it; false if already consumed. */
async function consumeLoginToken_(jti) {
    const db = firestoreDb_();
    const ref = db.collection(tokensCollection_()).doc(jti);
    try {
        await ref.create({
            consumedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (err) {
        // ALREADY_EXISTS → token previously consumed.
        const code = err && err.code;
        if (code === 6 || /ALREADY_EXISTS/i.test(String(err && err.message))) {
            return false;
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

async function sendMagicLinkEmail_({ to, link }) {
    if (!isMailConfigured_()) {
        throw new Error(
            "No email provider configured (set RESEND_API_KEY, or SMTP_HOST / SMTP_USER / SMTP_PASS)."
        );
    }
    const from = fromEmail_();
    if (!from) {
        throw new Error(
            "Sender address not configured (DASHBOARD_FROM_EMAIL / MAIL_FROM / RESEND_FROM / SMTP_USER)."
        );
    }
    const ttlMin = envInt_("DASHBOARD_LINK_TTL_MINUTES", 15, 1, 120);
    const text = [
        "Sign in to the chatbot customization dashboard.",
        "",
        `Open this link within ${ttlMin} minutes (one-time use):`,
        link,
        "",
        "If you did not request this email, you can ignore it."
    ].join("\n");
    const safeLink = String(link).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `
<div style="font-family: system-ui, Segoe UI, Roboto, sans-serif; max-width:520px; margin:auto; padding:24px; color:#0f172a">
  <h2 style="margin:0 0 8px;font-size:18px;">Sign in to the chatbot dashboard</h2>
  <p style="margin:0 0 18px;color:#475569;font-size:14px;">Tap the button below within ${ttlMin} minutes to sign in. This link can only be used once.</p>
  <p style="text-align:center;margin:24px 0;">
    <a href="${safeLink}" style="background:#0369a1;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;display:inline-block;font-size:14px;">Sign in</a>
  </p>
  <p style="margin:0;color:#64748b;font-size:12px;word-break:break-all;">If the button does not work, copy this URL:<br/><a href="${safeLink}" style="color:#0369a1;">${safeLink}</a></p>
</div>`;
    await sendTimedMail_({
        from,
        to,
        subject: "Your sign-in link",
        text,
        html
    });
}

/**
 * Build a one-time login token. Carries the email and a server-side jti (consumed in Firestore).
 */
function buildLoginToken_({ email }) {
    const secret = sessionSecret_();
    const ttlMs = envInt_("DASHBOARD_LINK_TTL_MINUTES", 15, 1, 120) * 60 * 1000;
    const payload = {
        v: SESSION_VERSION,
        k: "login",
        email: String(email).toLowerCase(),
        exp: Date.now() + ttlMs,
        jti: b64urlEncode_(crypto.randomBytes(18))
    };
    return signPayload_(payload, secret);
}

function buildSessionToken_({ email }) {
    const secret = sessionSecret_();
    const ttlHours = envInt_("DASHBOARD_SESSION_TTL_HOURS", 168, 1, 24 * 30);
    const payload = {
        v: SESSION_VERSION,
        k: "session",
        email: String(email).toLowerCase(),
        exp: Date.now() + ttlHours * 60 * 60 * 1000
    };
    return signPayload_(payload, secret);
}

function readSessionFromReq_(req) {
    const secret = sessionSecret_();
    if (!secret) return null;
    const cookies = parseCookies_(req);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    const data = verifyPayload_(token, secret);
    if (!data || data.k !== "session") return null;
    if (!isEmailAllowed_(data.email)) {
        // Email removed from allowlist → invalidate existing sessions.
        return null;
    }
    return { email: data.email };
}

function requireSession_() {
    return (req, res, next) => {
        const sess = readSessionFromReq_(req);
        if (!sess) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        req.dashboardSession = sess;
        next();
    };
}

/** When unset/false, dashboard settings API works without login (open editor). Set DASHBOARD_REQUIRE_AUTH=1 to restore cookie sessions. */
function dashboardAuthRequired_() {
    const v = trim_(process.env.DASHBOARD_REQUIRE_AUTH).toLowerCase();
    return v === "1" || v === "true" || v === "yes";
}

function requireSessionUnlessDashboardOpen_() {
    return (req, res, next) => {
        if (!dashboardAuthRequired_()) {
            req.dashboardSession = { email: "" };
            next();
            return;
        }
        return requireSession_()(req, res, next);
    };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function setNoCache_(res) {
    res.setHeader("Cache-Control", "no-store");
}

/**
 * Mount the dashboard onto an existing Express app.
 *
 * @param {import('express').Express} app
 */
export function mountDashboardRoutes(app) {
    const router = express.Router();
    router.use(express.json({ limit: "1mb" }));

    // --- Static front-end ----------------------------------------------------
    app.use("/dashboard", express.static(STATIC_DIR, {
        index: ["index.html"],
        extensions: ["html"],
        setHeaders(res, filePath) {
            // The HTML shell must always be fresh so we pick up new dashboard.js.
            if (filePath.toLowerCase().endsWith(".html")) {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    }));

    // Friendly redirect for the bare "/dashboard" (no trailing slash) →
    // express.static handles this, but make sure the root resolves to the SPA.
    app.get("/dashboard", (_req, res, next) => {
        fs.access(path.join(STATIC_DIR, "index.html"))
            .then(() => res.sendFile(path.join(STATIC_DIR, "index.html")))
            .catch(() => next());
    });

    // --- Login: request magic link ------------------------------------------
    router.post("/login/request", async (req, res) => {
        setNoCache_(res);
        try {
            if (!sessionSecret_()) {
                res.status(500).json({ ok: false, error: "DASHBOARD_SESSION_SECRET not configured." });
                return;
            }
            if (!publicBaseUrl_()) {
                res.status(500).json({ ok: false, error: "DASHBOARD_PUBLIC_BASE_URL not configured." });
                return;
            }
            const email = trim_(req.body && req.body.email).toLowerCase();
            const allowed = isEmailAllowed_(email);
            /** User-visible result copy (always ok:true for allowed vs disallowed). */
            let userMessage = "If your email is allowed, a sign-in link has been sent.";
            const failureMsg =
                "Could not deliver email (no mail provider configured, slow, or rejected). If your email is allowed, the sign-in link was written to the server log — open Railway Logs and click it.";
            const successMsg = "If your email is allowed, a sign-in link has been sent.";

            // Always return ok=true to avoid leaking which emails are allowed.
            if (allowed) {
                const token = buildLoginToken_({ email });
                const link = `${publicBaseUrl_()}/api/dashboard/login/verify?token=${encodeURIComponent(token)}`;
                const ttlMin = envInt_("DASHBOARD_LINK_TTL_MINUTES", 15, 1, 120);

                const printLink_ = (reason) => {
                    // High-visibility block in Railway Logs.
                    console.log(LOG_TAG, "==================== MAGIC LINK ====================");
                    console.log(LOG_TAG, `Email:  ${email}`);
                    console.log(LOG_TAG, `Reason: ${reason}`);
                    console.log(LOG_TAG, `Expires in ${ttlMin} minutes. One-time use. Open this URL:`);
                    console.log(LOG_TAG, link);
                    console.log(LOG_TAG, "====================================================");
                };

                const forceLog = (process.env.DASHBOARD_PRINT_LOGIN_LINK || "").trim() === "1";
                const mailReady = isMailConfigured_() && !!fromEmail_();
                const provider = currentMailProvider_();

                if (forceLog || !mailReady) {
                    // Fast path: print the link immediately so the operator can sign in
                    // from Railway Logs without waiting on the mail provider. Still
                    // attempt to send in the background when a provider is configured.
                    printLink_(
                        forceLog
                            ? "DASHBOARD_PRINT_LOGIN_LINK=1 (forced)"
                            : "No mail provider configured (set RESEND_API_KEY or SMTP_*)"
                    );
                    if (!mailReady) {
                        userMessage = failureMsg;
                    } else if (forceLog) {
                        // Email still fires in background — do not scare the user with the
                        // "could not deliver" copy that is meant for real failures.
                        userMessage =
                            `${successMsg} A copy of the link was also written to the server log (DASHBOARD_PRINT_LOGIN_LINK=1). Remove that variable on Railway for shorter messaging once email works.`;
                    }
                    if (mailReady) {
                        sendMagicLinkEmail_({ to: email, link }).catch((err) => {
                            const msg = err && err.message ? err.message : String(err);
                            console.error(LOG_TAG, `background magic-link send failed (${provider}):`, msg);
                        });
                    }
                } else {
                    // Provider is configured and we are not forcing log output. Race
                    // the send against a tight wall-clock budget so a stuck network
                    // never blocks the response for more than a few seconds.
                    const budgetMs = envInt_("DASHBOARD_LOGIN_EMAIL_TIMEOUT_MS", 25000, 5000, 120000);
                    let timeoutHandle = null;
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutHandle = setTimeout(
                            () => reject(new Error(`mail send exceeded ${budgetMs}ms budget`)),
                            budgetMs
                        );
                    });
                    try {
                        await Promise.race([
                            sendMagicLinkEmail_({ to: email, link }),
                            timeoutPromise
                        ]);
                        userMessage = successMsg;
                        if (trim_(process.env.DASHBOARD_DEBUG) === "1") {
                            console.log(LOG_TAG, `magic-link sent via ${provider} to ${email}`);
                        }
                    } catch (err) {
                        const msg = err && err.message ? err.message : String(err);
                        console.error(LOG_TAG, `magic-link send failed (${provider}):`, msg);
                        printLink_(`${provider} send failed: ${msg}`);
                        userMessage = failureMsg;
                    } finally {
                        if (timeoutHandle) clearTimeout(timeoutHandle);
                    }
                }
            } else {
                // Add a small delay so attackers cannot distinguish allowed vs not via timing.
                await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
            }
            res.json({
                ok: true,
                message: userMessage
            });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "login/request failed:", msg);
            res.status(500).json({ ok: false, error: "Internal error" });
        }
    });

    // --- Login: verify magic link (browser GET) -----------------------------
    router.get("/login/verify", async (req, res) => {
        setNoCache_(res);
        const secret = sessionSecret_();
        if (!secret) {
            res.status(500).send("DASHBOARD_SESSION_SECRET not configured.");
            return;
        }
        const token = trim_(req.query && req.query.token);
        const data = verifyPayload_(token, secret);
        const bad = (reason) => {
            res.status(401).type("html").send(
                `<!doctype html><meta charset="utf-8"><title>Sign-in link invalid</title>` +
                `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:24px;color:#0f172a">` +
                `<h2 style="margin:0 0 12px;">Sign-in link is invalid or expired</h2>` +
                `<p style="color:#475569">${reason}</p>` +
                `<p><a href="/dashboard" style="color:#0369a1">Back to sign-in</a></p></div>`
            );
        };
        if (!data || data.k !== "login") {
            bad("This link is invalid. Request a new one.");
            return;
        }
        if (!isEmailAllowed_(data.email)) {
            bad("This email is no longer allowed.");
            return;
        }
        // Consume the jti once. Reusing the link fails fast.
        try {
            const ok = await consumeLoginToken_(data.jti);
            if (!ok) {
                bad("This link was already used. Request a new one.");
                return;
            }
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "consumeLoginToken failed:", msg);
            res.status(500).send("Sign-in failed. Try again.");
            return;
        }
        // Issue session cookie + redirect to dashboard.
        const ttlHours = envInt_("DASHBOARD_SESSION_TTL_HOURS", 168, 1, 24 * 30);
        const sess = buildSessionToken_({ email: data.email });
        setSessionCookie_(res, sess, ttlHours * 3600);
        res.redirect(302, "/dashboard/");
    });

    // --- Logout --------------------------------------------------------------
    router.post("/logout", (_req, res) => {
        setNoCache_(res);
        clearSessionCookie_(res);
        res.json({ ok: true });
    });

    // --- Current session ----------------------------------------------------
    router.get("/me", (req, res) => {
        setNoCache_(res);
        if (!dashboardAuthRequired_()) {
            res.json({ ok: true, email: "" });
            return;
        }
        const sess = readSessionFromReq_(req);
        if (!sess) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        res.json({ ok: true, email: sess.email });
    });

    // --- Settings: read/write (optional auth — see dashboardAuthRequired_) ---
    router.get("/settings", requireSessionUnlessDashboardOpen_(), async (req, res) => {
        setNoCache_(res);
        try {
            const botid = botIdOrDefault_(req.query && req.query.botid);
            const data = await readSettings_(botid);
            res.json({ ok: true, botid, ...data });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "settings GET failed:", msg);
            res.status(500).json({ ok: false, error: msg });
        }
    });

    // --- Appointments (staff inbox) -----------------------------------------
    router.get("/appointments", requireSessionUnlessDashboardOpen_(), async (req, res) => {
        setNoCache_(res);
        try {
            firebaseAdminInit();
            const status = trim_(req.query && req.query.status);
            const limitRaw = trim_(req.query && req.query.limit);
            const limit = limitRaw ? Number(limitRaw) : 200;
            const rows = await listAppointmentLeads({
                status: status || undefined,
                limit: Number.isFinite(limit) ? limit : 200
            });

            /** @type {Map<string, string>} */
            let doctorLabelById = new Map();
            try {
                const docs = await listDoctors();
                for (const d of docs) {
                    const id = trim_(d.DoctorId);
                    if (!id) continue;
                    const label =
                        trim_(d.DisplayDoctorName) ||
                        (trim_(d.DoctorName) ? `Dr. ${trim_(d.DoctorName)}` : id);
                    doctorLabelById.set(id, label);
                }
            } catch (catErr) {
                const msg = catErr && catErr.message ? catErr.message : String(catErr);
                console.warn(LOG_TAG, "appointments catalog enrich skipped:", msg);
            }

            const appointments = rows.map((row) => {
                const doctorId = trim_(row.doctorId);
                const doctorDisplay =
                    trim_(row.doctorDisplay) ||
                    (doctorId ? doctorLabelById.get(doctorId) || "" : "");
                return { ...row, doctorDisplay: doctorDisplay || doctorId };
            });

            res.json({ ok: true, appointments });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "appointments GET failed:", msg);
            res.status(500).json({ ok: false, error: msg });
        }
    });

    router.patch("/appointments/:key", requireSessionUnlessDashboardOpen_(), async (req, res) => {
        setNoCache_(res);
        try {
            firebaseAdminInit();
            const key = trim_(req.params && req.params.key);
            const body = req.body && typeof req.body === "object" ? req.body : {};
            const staffStatus = trim_(body.staffStatus);
            const email =
                req.dashboardSession && req.dashboardSession.email
                    ? req.dashboardSession.email
                    : "";
            const out = await updateAppointmentLeadStaffStatus({
                key,
                staffStatus,
                updatedBy: email
            });
            res.json({ ok: true, ...out });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            const status = /not found/i.test(msg) ? 404 : 400;
            console.error(LOG_TAG, "appointments PATCH failed:", msg);
            res.status(status).json({ ok: false, error: msg });
        }
    });

    router.put("/settings", requireSessionUnlessDashboardOpen_(), async (req, res) => {
        setNoCache_(res);
        try {
            const botid = botIdOrDefault_(req.query && req.query.botid);
            const body = (req.body && typeof req.body === "object") ? req.body : {};
            const flat = (body.flat && typeof body.flat === "object") ? body.flat : {};
            const advancedPatchJson = typeof body.advancedPatchJson === "string" ? body.advancedPatchJson : "";
            await writeSettings_(botid, flat, advancedPatchJson, req.dashboardSession.email);
            const data = await readSettings_(botid);
            const flatKeysCount = Object.keys(data.flat && typeof data.flat === "object" ? data.flat : {}).length;

            /** @type {{ skipped?: boolean, reason?: string, error?: string, path?: string, branch?: string, repo?: string } | null} */
            let githubPublish = null;
            if (githubWidgetPublishConfigured_()) {
                try {
                    githubPublish = await publishWidgetBotToGithub_({
                        botid,
                        flat,
                        advancedPatchJson,
                        updatedBy: req.dashboardSession && req.dashboardSession.email ? req.dashboardSession.email : ""
                    });
                    if (!githubPublish.skipped) {
                        console.log(LOG_TAG, "GitHub widget mirror ok:", githubPublish.repo, githubPublish.path);
                    }
                } catch (ghErr) {
                    const ge = ghErr && ghErr.message ? ghErr.message : String(ghErr);
                    console.warn(LOG_TAG, "GitHub widget mirror failed:", ge);
                    githubPublish = { skipped: false, error: ge };
                }
            } else {
                githubPublish = { skipped: true, reason: "not_configured" };
            }

            res.json({
                ok: true,
                botid,
                settings_backend: widgetSettingsBackend_(),
                updatedAt: data.updatedAt || null,
                flatKeysCount,
                githubPublish
            });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "settings PUT failed:", msg);
            res.status(500).json({ ok: false, error: msg });
        }
    });

    app.use("/api/dashboard", router);

    // --- Public read endpoint (called by chat-frame.html on load) -----------
    // Separate path with permissive CORS so any embed origin can read.
    app.get("/api/public/widget-settings", async (req, res) => {
        // Permissive CORS for this read-only public endpoint.
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Cache-Control", "no-store");
        try {
            const botid = botIdOrDefault_(req.query && req.query.botid);
            const data = await readSettings_(botid);
            res.json({
                ok: true,
                botid,
                flat: data.flat || {},
                advancedPatchJson: data.advancedPatchJson || "",
                updatedAt: data.updatedAt || null
            });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error(LOG_TAG, "public widget-settings failed:", msg);
            // Never break the widget — return an empty patch on error.
            res.json({ ok: true, botid: botIdOrDefault_(req.query && req.query.botid), flat: {}, advancedPatchJson: "", error: msg });
        }
    });

    app.options("/api/public/widget-settings", (_req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.status(204).end();
    });

    // --- Health --------------------------------------------------------------
    app.get("/api/dashboard/health", (_req, res) => {
        const wsBackend = widgetSettingsBackend_();
        res.json({
            ok: true,
            allowed_emails_configured: allowedEmails_().length > 0,
            dashboard_require_auth: dashboardAuthRequired_(),
            session_secret_configured: !!sessionSecret_(),
            public_base_url_configured: !!publicBaseUrl_(),
            mail_provider: currentMailProvider_(),
            smtp_configured: isSmtpCredentialEnvPresent_(),
            resend_configured: isResendConfigured_(),
            /** False when key is set but does not look like a Resend key (should start with `re_`). */
            resend_api_key_format_ok:
                !isResendConfigured_() || trim_(process.env.RESEND_API_KEY).startsWith("re_"),
            preview_url_default: trim_(process.env.DASHBOARD_PREVIEW_URL) || null,
            widget_settings_backend: wsBackend,
            widget_settings_file: wsBackend === "file" ? widgetSettingsFilePath_() : null,
            github_widget_publish_configured: githubWidgetPublishConfigured_()
        });
    });

    console.log(LOG_TAG, "mounted /dashboard + /api/dashboard/* + /api/public/widget-settings");
    const _wsb = widgetSettingsBackend_();
    console.log(
        LOG_TAG,
        `widget settings: ${_wsb}` + (_wsb === "file" ? ` → ${widgetSettingsFilePath_()}` : " (firestore)")
    );
}
