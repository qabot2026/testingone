/**
 * Notify your team when a visitor submits contact details (name / email / mobile).
 *
 * Configure via environment variables (Railway / .env — never commit secrets):
 *
 *   CONTACT_LEAD_NOTIFY_TO     Comma-separated inbox(es) that receive leads (required to send).
 *   SMTP_HOST                  e.g. smtp.gmail.com, smtp.sendgrid.net
 *   SMTP_PORT                  Default 587 (STARTTLS). Use 465 with SMTP_SECURE=1.
 *   SMTP_USER                  SMTP login (Gmail = full address; SendGrid = "apikey").
 *   SMTP_PASS or SMTP_PASSWORD App password / SMTP secret.
 *   SMTP_SECURE                Set to "1" or "true" for TLS on 465.
 *   MAIL_FROM                  From address shown to recipients (defaults to SMTP_USER).
 *   CONTACT_LEAD_NOTIFY_SUBJECT  Optional subject prefix (default: "New chat lead").
 *
 * Optional:
 *   CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC=1 — also send when POST /contact-form-mobile-sheet-sync succeeds
 *     (only if name or visitor email is present, to limit noise).
 *
 * Sending runs after a successful save; failures are logged and do not fail the HTTP response.
 */

import nodemailer from "nodemailer";

/**
 * @returns {boolean}
 */
export function isContactLeadEmailConfigured() {
    const to = (process.env.CONTACT_LEAD_NOTIFY_TO || "").trim();
    const host = (process.env.SMTP_HOST || "").trim();
    const user = (process.env.SMTP_USER || "").trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
    return Boolean(to && host && user && pass);
}

/**
 * @param {string | undefined} s
 * @returns {string}
 */
function t_(s) {
    return typeof s === "string" ? s.trim() : "";
}

let transporterCache = null;

function getTransporter_() {
    if (transporterCache) {
        return transporterCache;
    }
    const host = (process.env.SMTP_HOST || "").trim();
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = (process.env.SMTP_USER || "").trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim();
    const secureRaw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
    const secure = secureRaw === "1" || secureRaw === "true" || port === 465;
    transporterCache = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
    });
    return transporterCache;
}

/**
 * @param {Record<string, string>} fields
 * @param {number} maxLen
 * @returns {string}
 */
function formatFieldsBlock_(fields, maxLen) {
    const keys = Object.keys(fields || {}).sort();
    if (!keys.length) {
        return "(none)";
    }
    const lines = [];
    for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        let v = String(fields[k] ?? "");
        if (v.length > maxLen) {
            v = `${v.slice(0, maxLen)}…`;
        }
        lines.push(`  ${k}: ${v}`);
    }
    return lines.join("\n");
}

/**
 * @param {{
 *   source?: string,
 *   formId?: string,
 *   name?: string,
 *   email?: string,
 *   mobile?: string,
 *   city?: string,
 *   channel?: string,
 *   sourceUrl?: string,
 *   clientSessionId?: string,
 *   appointmentDate?: string,
 *   appointmentTime?: string,
 *   appointmentBooked?: string,
 *   submittedAtIso?: string,
 *   fields?: Record<string, string>,
 *   ip?: string
 * }} args
 * @returns {Promise<{ skipped: true, reason: string } | { sent: true } | { error: string }>}
 */
export async function maybeSendContactLeadNotifyEmail(args) {
    if (!isContactLeadEmailConfigured()) {
        return { skipped: true, reason: "not_configured" };
    }

    const name = t_(args.name);
    const email = t_(args.email);
    const mobile = t_(args.mobile);
    if (!name && !email && !mobile) {
        return { skipped: true, reason: "no_contact_fields" };
    }

    const toRaw = (process.env.CONTACT_LEAD_NOTIFY_TO || "").trim();
    const toList = toRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!toList.length) {
        return { skipped: true, reason: "no_recipients" };
    }

    const fromAddr = (process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();
    if (!fromAddr) {
        return { skipped: true, reason: "no_from" };
    }

    const subjectPrefix = (process.env.CONTACT_LEAD_NOTIFY_SUBJECT || "New chat lead").trim();
    const source = t_(args.source) || "contact-form";
    const subject = `${subjectPrefix} — ${name || email || mobile || "lead"}`;

    const lines = [
        `Source: ${source}`,
        `Form: ${t_(args.formId) || "unknown"}`,
        "",
        `Name: ${name || "—"}`,
        `Email: ${email || "—"}`,
        `Mobile: ${mobile || "—"}`,
        `City: ${t_(args.city) || "—"}`,
        `Channel: ${t_(args.channel) || "—"}`,
        `Page / source URL: ${t_(args.sourceUrl) || "—"}`,
        `Session: ${t_(args.clientSessionId) || "—"}`,
        `Submitted (UTC): ${t_(args.submittedAtIso) || "—"}`,
        `IP: ${t_(args.ip) || "—"}`,
        ""
    ];

    const apptD = t_(args.appointmentDate);
    const apptT = t_(args.appointmentTime);
    if (apptD || apptT) {
        lines.push(
            `Appointment: ${apptD || "—"} ${apptT || ""}`.trim(),
            `Appointment booked: ${t_(args.appointmentBooked) || "—"}`,
            ""
        );
    }

    lines.push("All fields:", formatFieldsBlock_(args.fields || {}, 800));
    const text = lines.join("\n");

    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    const html = `<pre style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;line-height:1.45;white-space:pre-wrap">${esc(
        text
    )}</pre>`;

    try {
        const tx = getTransporter_();
        await tx.sendMail({
            from: fromAddr,
            to: toList.join(", "),
            subject,
            text,
            html
        });
        return { sent: true };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[contact-lead-notify-email] send failed:", msg);
        return { error: msg };
    }
}
