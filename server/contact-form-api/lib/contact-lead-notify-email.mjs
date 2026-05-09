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
 *   CONTACT_LEAD_ATTACH_OUTCOME_IN_JSON=1 — add non-blocking `lead_email` stub to JSON ({ status:"scheduled", delay_ms }); never waits on SMTP.
 *
 * Timing: CONTACT_LEAD_EMAIL_DELAY_MS (default 60000) waits after flush + deferred Firestore before SMTP; set to 0 for immediate send after response.
 *
 * Sends when there is ANY of: visitor name/email/mobile OR a picked appointment slot (date + time).
 * The API schedules sending **after** HTTP 200 is flushed (`scheduleContactPostSuccessTail_` in index.mjs),
 * with a time fallback — not during the form request. Deferred Firestore runs in the same tail unless
 * CONTACT_FORM_DEFER_FIRESTORE_AFTER_RESPONSE=1 moves Firestore-only work there (see index).
 *
 * Optional: CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC=1 (see index.mjs comment).
 */

import { getMailTransport_ } from "./mail/smtp-transport.mjs";
import { sendTimedMail_ } from "./mail/smtp-send.mjs";

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

/**
 * Quick SMTP login test (runs after server boot). Logs only success/failure message.
 */
export async function verifyContactLeadSmtpOnBoot() {
    if (!isContactLeadEmailConfigured()) {
        return;
    }
    const port = Number(process.env.SMTP_PORT) || 587;
    const host = (process.env.SMTP_HOST || "").trim();
    /** Must exceed TCP+STARTTLS/handshake (`CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS`), or races short and looks like flaky SMTP on Railway/cloud. */
    const verifyMs = Math.min(
        Math.max(Number(process.env.CONTACT_LEAD_SMTP_VERIFY_TIMEOUT_MS) || 45000, 8000),
        90000
    );
    console.log(
        `[contact-lead-notify-email] SMTP verify starting host=${host || "(empty)"} port=${port} ` +
            `(outer budget ${verifyMs}ms — raise CONTACT_LEAD_SMTP_VERIFY_TIMEOUT_MS / CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS if needed)`
    );
    try {
        await Promise.race([
            getMailTransport_().verify(),
            new Promise((_, rej) => {
                globalThis.setTimeout(() => rej(new Error(`verify timeout after ${verifyMs}ms`)), verifyMs);
            })
        ]);
        console.log("[contact-lead-notify-email] SMTP verify OK (login/host reachable).");
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error(
            "[contact-lead-notify-email] SMTP verify FAILED — host=" +
                `${host || "(empty)"} port=${port}: ` +
                msg +
                " | Fix SMTP_HOST/SMTP_PORT/SMTP_SECURE, App Password / auth, outbound firewall." +
                " Try CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS=25000 CONTACT_LEAD_SMTP_VERIFY_TIMEOUT_MS=60000"
        );
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
/**
 * Sends one real mail to CONTACT_LEAD_NOTIFY_TO (same SMTP path as leads). Used by POST /contact-form-email-self-test.
 *
 * @returns {Promise<{ skipped: true, reason: string } | { sent: true } | { error: string }>}
 */
export async function sendContactLeadMailboxSelfTestPing() {
    return maybeSendContactLeadNotifyEmail({
        source: "mailbox-self-test",
        formId: "__self_test__",
        name: "SMTP self-test (safe to delete)",
        email: "",
        mobile: "",
        fields: {
            note: "If you see this mail, CONTACT_LEAD_NOTIFY_TO and SMTP_* are wired correctly."
        },
        submittedAtIso: new Date().toISOString()
    });
}

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
        await sendTimedMail_(mail);
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
