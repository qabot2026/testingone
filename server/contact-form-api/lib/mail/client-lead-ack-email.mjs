/**
 * Visitor-facing acknowledgement: “we received your enquiry” (does not notify staff — see contact-lead-notify-email).
 *
 * HTML layout: templates/client-lead-ack.html — edit branding/colours/copy there.
 *
 * Enable: CONTACT_LEAD_CLIENT_ACK_ENABLED=1
 * Optional: CONTACT_LEAD_CLIENT_ACK_SUBJECT, CONTACT_LEAD_CLIENT_ACK_HTML_TITLE, CONTACT_MAIL_BRAND_TITLE, CONTACT_LEAD_CLIENT_ACK_REPLY_TO
 */

import { isSmtpCredentialEnvPresent_, sendTimedMail_ } from "./smtp-send.mjs";
import { escapeMailHtml_, renderEmailTemplateHtml_ } from "./render-email-template.mjs";

/** @param {string | undefined} s */
function t_(s) {
    return typeof s === "string" ? s.trim() : "";
}

/**
 * @param {{
 *   name?: string,
 *   email?: string,
 *   mobile?: string,
 *   city?: string,
 *   source?: string,
 *   sourceUrl?: string,
 *   submittedAtIso?: string,
 * }} args
 * @returns {Promise<{ skipped: true, reason: string } | { sent: true } | { error: string }>}
 */
export async function maybeSendClientLeadAckEmail(args) {
    if ((process.env.CONTACT_LEAD_CLIENT_ACK_ENABLED || "").trim() !== "1") {
        return { skipped: true, reason: "client_ack_disabled" };
    }
    const toAddr = t_(args.email);
    if (!toAddr) {
        return { skipped: true, reason: "no_visitor_email" };
    }
    if (!isSmtpCredentialEnvPresent_()) {
        return { skipped: true, reason: "smtp_not_configured_for_outbound" };
    }
    const fromAddr =
        (process.env.CONTACT_LEAD_CLIENT_ACK_FROM || "").trim()
        || (process.env.MAIL_FROM || "").trim()
        || (process.env.SMTP_USER || "").trim();
    if (!fromAddr) {
        return { skipped: true, reason: "no_from_ADDRESS" };
    }
    const subjPrefix = (
        process.env.CONTACT_LEAD_CLIENT_ACK_SUBJECT || "Thank you — we received your message"
    ).trim();
    const name = t_(args.name);
    const subject = `${subjPrefix}${name ? ` — ${name}` : ""}`;
    const lines = [
        "Hi" + (name ? ` ${name}` : ""),
        "",
        "Thanks for contacting us. We have received your details and our team will get back to you soon.",
        "",
        "Summary (please keep this email for reference):",
        `  Name: ${name || "—"}`,
        `  Mobile: ${t_(args.mobile) || "—"}`,
        `  Email: ${toAddr}`,
        `  City: ${t_(args.city) || "—"}`,
        `  Source: ${t_(args.source) || "—"}`,
        `  Page: ${t_(args.sourceUrl) || "—"}`,
        `  Submitted (UTC): ${t_(args.submittedAtIso) || "—"}`,
        "",
        "This is an automated confirmation message."
    ];
    const text = lines.join("\n");
    const brandTitle = (
        (process.env.CONTACT_LEAD_CLIENT_ACK_HTML_TITLE || "").trim()
            || (process.env.CONTACT_MAIL_BRAND_TITLE || "").trim()
            || subjPrefix
    );
    const greetPlain = name ? `Hi ${name},` : "Hi,";
    const html = renderEmailTemplateHtml_("client-lead-ack.html", {
        BRAND_TITLE: escapeMailHtml_(brandTitle),
        VISITOR_GREET: escapeMailHtml_(greetPlain),
        NAME: escapeMailHtml_(name || "—"),
        EMAIL: escapeMailHtml_(toAddr),
        MOBILE: escapeMailHtml_(t_(args.mobile) || "—"),
        CITY: escapeMailHtml_(t_(args.city) || "—"),
        SOURCE: escapeMailHtml_(t_(args.source) || "—"),
        PAGE_URL: escapeMailHtml_(t_(args.sourceUrl) || "—"),
        SUBMITTED_UTC: escapeMailHtml_(t_(args.submittedAtIso) || "—")
    });
    const replyToRaw = (process.env.CONTACT_LEAD_CLIENT_ACK_REPLY_TO || "").trim();
    /** @type {Record<string, string>} */
    const mail = { from: fromAddr, to: toAddr, subject, text, html };
    if (replyToRaw) {
        mail.replyTo = replyToRaw.split(",")[0].trim();
    }
    try {
        await sendTimedMail_(mail);
        if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1") {
            console.log("[client-lead-ack-email] sent_ok to_visitor:", toAddr);
        }
        return { sent: true };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.error("[client-lead-ack-email] send failed:", msg);
        return { error: msg };
    }
}
