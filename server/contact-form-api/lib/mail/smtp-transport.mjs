/** Shared nodemailer transport — one cache per server process for all outbound mail modules. */

import nodemailer from "nodemailer";

let transportCache = null;

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
    const host = (process.env.SMTP_HOST || "").trim();
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = (process.env.SMTP_USER || "").trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
    const secureRaw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
    const secure = secureRaw === "1" || secureRaw === "true" || port === 465;
    const connMs = Math.min(
        Math.max(Number(process.env.CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS) || 20000, 3000),
        120000
    );
    transportCache = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: connMs,
        greetingTimeout: Math.min(connMs, 10000),
        socketTimeout: Math.min(connMs + 5000, 120000),
        ...(!secure && port === 587 ? { requireTLS: true } : {})
    });
    return transportCache;
}
