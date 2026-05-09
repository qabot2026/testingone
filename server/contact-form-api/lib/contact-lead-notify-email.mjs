/**
 * New lead email: company → your team, body = visitor name, email, phone.
 *
 * WHERE TO SET VALUES (no secrets in code):
 *   1) Railway: Project → your contact-form-api service → Variables.
 *   2) Or file: server/contact-form-api/.env  (next to index.mjs), only on your PC.
 *
 * See also: ../env.example.txt  (copy-paste cheat sheet).
 *
 * Variables:
 *   MAIL_FROM                 — "From" (your company email).
 *   CONTACT_LEAD_NOTIFY_TO    — "To" (who gets the lead). Commas = many addresses.
 *   CONTACT_LEAD_NOTIFY_CC      — "Cc" (optional). Commas = many addresses.
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS — mail server login.
 *   CONTACT_LEAD_NOTIFY_SUBJECT — optional subject prefix.
 *
 * Debug (Railway Logs):
 *   CONTACT_LEAD_EMAIL_DEBUG=1 — log every outcome (skipped / sent / SMTP error).
 *   CONTACT_LEAD_ATTACH_OUTCOME_IN_JSON=1 — add `lead_email` to POST /contact-form-submissions JSON (debug only).
 *
 * Sends when there is ANY of: visitor name/email/mobile OR a picked appointment slot (date + time).
 *
 * Optional: CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC=1 (see index.mjs comment).
 */

import nodemailer from "nodemailer";

/** @returns {string[]} */
export function missingContactLeadEmailEnvKeys_() {
    /** @type {string[]} */
    const missing = [];
    if (!(process.env.CONTACT_LEAD_NOTIFY_TO || "").trim()) missing.push("CONTACT_LEAD_NOTIFY_TO");
    if (!(process.env.SMTP_HOST || "").trim()) missing.push("SMTP_HOST");
    if (!(process.env.SMTP_USER || "").trim()) missing.push("SMTP_USER");
    if (!(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim()) {
        missing.push("SMTP_PASS (or SMTP_PASSWORD)");
    }
    return missing;
}

/**
 * Call once when the server starts (see index.mjs). No secrets logged.
 */
export function logContactLeadEmailBoot() {
    const missing = missingContactLeadEmailEnvKeys_();
    if (!missing.length) {
        console.log(
            "[contact-lead-notify-email] READY — after save: visitor name/email/mobile OR appointment date+time triggers email."
        );
        return;
    }
    const hinted = !!(process.env.CONTACT_LEAD_NOTIFY_TO || "").trim()
        || !!(process.env.SMTP_HOST || "").trim();
    if (hinted) {
        console.warn(
            `[contact-lead-notify-email] NOT ready — missing env: ${missing.join(", ")}. Fix in Railway Variables, redeploy.`
        );
    }
}

/** @param {{ skipped?: boolean, reason?: string, sent?: boolean, error?: string, missing_env?: string[] }} r */
function logOutcome_(r) {
    const dbg = (process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1";
    if (dbg) {
        const extra =
            r.missing_env && r.missing_env.length ? ` missing_env=${r.missing_env.join(",")}` : "";
        console.log(
            "[contact-lead-notify-email] outcome:",
            r.sent ? "sent_ok" : r.error ? `error:${r.error}` : `skipped:${r.reason || "?"}${extra}`
        );
        return;
    }
    if (r.sent) return;
    if (r.skipped && r.reason === "not_configured") return;
    if (r.skipped) console.warn("[contact-lead-notify-email] skipped:", r.reason);
    if (typeof r.error === "string" && r.error.trim()) console.error("[contact-lead-notify-email] SMTP:", r.error.trim());
}

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
        auth: { user, pass },
        // Port 587 = STARTTLS; helps Gmail / Office365 refuse less often.
        ...(!secure && port === 587 ? { requireTLS: true } : {})
    });
    return transporterCache;
}

/**
 * Quick SMTP login test (runs after server boot). Logs only success/failure message.
 */
export async function verifyContactLeadSmtpOnBoot() {
    if (!isContactLeadEmailConfigured()) {
        return;
    }
    try {
        await getTransporter_().verify();
        console.log("[contact-lead-notify-email] SMTP verify OK (login/host reachable).");
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[contact-lead-notify-email] SMTP verify FAILED — fix SMTP_* / password / port:", msg);
    }
}

/**
 * @param {{ skipped?: boolean, reason?: string, sent?: boolean, error?: string }} r
 * @returns {Record<string, string>}
 */
export function formatLeadEmailOutcomeForJson(r) {
    if (r.sent) return { status: "sent" };
    if (typeof r.error === "string" && r.error.trim()) {
        return { status: "error", detail: r.error.trim().slice(0, 400) };
    }
    if (r.skipped) return { status: "skipped", reason: String(r.reason || "") };
    return { status: "unknown" };
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
        const r = { skipped: true, reason: "not_configured", missing_env: missingContactLeadEmailEnvKeys_() };
        logOutcome_(r);
        return r;
    }

    const name = t_(args.name);
    const email = t_(args.email);
    const mobile = t_(args.mobile);
    const apptDEarly = t_(args.appointmentDate);
    const apptTEarly = t_(args.appointmentTime);
    const hasAppointmentPick = Boolean(apptDEarly && apptTEarly);
    /** General appointment forms often omit inline name fields; date+time still counts as a lead. */
    if (!name && !email && !mobile && !hasAppointmentPick) {
        const r = { skipped: true, reason: "no_contact_fields" };
        logOutcome_(r);
        return r;
    }

    const toRaw = (process.env.CONTACT_LEAD_NOTIFY_TO || "").trim();
    const toList = toRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!toList.length) {
        const r = { skipped: true, reason: "no_recipients" };
        logOutcome_(r);
        return r;
    }

    const fromAddr = (process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();
    if (!fromAddr) {
        const r = { skipped: true, reason: "no_from_set_MAIL_FROM_or_SMTP_USER" };
        logOutcome_(r);
        return r;
    }

    const subjectPrefix = (process.env.CONTACT_LEAD_NOTIFY_SUBJECT || "New chat lead").trim();
    const source = t_(args.source) || "contact-form";
    const subjectTail =
        name || email || mobile || (hasAppointmentPick ? `${apptDEarly} ${apptTEarly}`.trim() : "lead");
    const subject = `${subjectPrefix} — ${subjectTail}`;

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

    if (apptDEarly || apptTEarly) {
        lines.push(
            `Appointment: ${apptDEarly || "—"} ${apptTEarly || ""}`.trim(),
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
        const ccRaw = (process.env.CONTACT_LEAD_NOTIFY_CC || "").trim();
        const ccList = ccRaw
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        const mail = {
            from: fromAddr,
            to: toList.join(", "),
            subject,
            text,
            html
        };
        if (ccList.length) {
            mail.cc = ccList.join(", ");
        }
        await tx.sendMail(mail);
        const ok = /** @type {const} */ ({ sent: true });
        logOutcome_(ok);
        return ok;
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[contact-lead-notify-email] send failed:", msg);
        const r = { error: msg };
        logOutcome_(r);
        return r;
    }
}
