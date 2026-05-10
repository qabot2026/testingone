/** Shared nodemailer transport — one cache per server process for all outbound mail modules. */

import dns from "node:dns";
import nodemailer from "nodemailer";

import { resolveContactLeadSendTimeoutMs_ } from "./smtp-timeouts.mjs";

let transportCache = null;

/** Many cloud hosts (Railway, etc.) resolve smtp.gmail.com to IPv6 first; the route can hang. Prefer IPv4. */
let dnsHintsApplied = false;
function ensureSmtpDnsHints_() {
    if (dnsHintsApplied) {
        return;
    }
    dnsHintsApplied = true;
    const off = (process.env.SMTP_DNS_IPV4_FIRST || "1").trim() === "0";
    if (off) {
        return;
    }
    try {
        dns.setDefaultResultOrder("ipv4first");
        console.log("[smtp-transport] DNS ipv4first for SMTP (reduces Gmail timeouts on Railway); SMTP_DNS_IPV4_FIRST=0 to disable");
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.warn("[smtp-transport] dns.setDefaultResultOrder(ipv4first) skipped:", msg);
    }
}

export function clearMailTransportCache_() {
    transportCache = null;
}

/**
 * @returns {boolean}
 */
export function isSmtpCredentialEnvPresent_() {
    const host = (process.env.SMTP_HOST || "").trim();
    const user = (process.env.SMTP_USER || "").trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
    return Boolean(host && user && pass);
}

/** @returns {import('nodemailer').Transporter} */
export function getMailTransport_() {
    if (transportCache) {
        return transportCache;
    }
    ensureSmtpDnsHints_();
    const host = (process.env.SMTP_HOST || "").trim();
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = (process.env.SMTP_USER || "").trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
    const secureRaw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
    const secure = secureRaw === "1" || secureRaw === "true" || port === 465;
    /** Default 45s: Railway→Gmail TCP+TLS often exceeds 20s cold start. */
    const connMs = Math.min(
        Math.max(Number(process.env.CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS) || 45000, 3000),
        120000
    );
    const sendBudgetMs = resolveContactLeadSendTimeoutMs_();
    /** Idle socket cap must cover our outer `sendMail` race or TLS can abort mid-send. */
    const socketIdleMs = Math.min(Math.max(connMs + 20000, sendBudgetMs), 300000);
    transportCache = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: connMs,
        /** Slow STARTTLS to e.g. Gmail from cloud hosts needs headroom. */
        greetingTimeout: Math.min(Math.max(connMs, 45000), 90000),
        socketTimeout: socketIdleMs,
        ...(!secure && port === 587 ? { requireTLS: true } : {})
    });
    return transportCache;
}
