/**
 * Visitor-facing acknowledgement: “we received your enquiry” (does not notify staff — see contact-lead-notify-email).
 *
 * HTML layout: templates/lead_mail_to_client.html — edit branding/colours/copy there.
 *
 * Enable: CONTACT_LEAD_CLIENT_ACK_ENABLED=1
 * Optional: CONTACT_LEAD_CLIENT_ACK_SUBJECT, CONTACT_MAIL_* company lines, CONTACT_LEAD_CLIENT_ACK_REPLY_TO
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
    const corp =
        (process.env.CONTACT_MAIL_COMPANY_NAME || "").trim()
        || (process.env.CONTACT_MAIL_BRAND_TITLE || "").trim()
        || "Medical team";
    let webStrip = ((process.env.CONTACT_MAIL_COMPANY_WEBSITE || "").trim() || "—").replace(
        /^https?:\/\//i,
        ""
    );

    const surl = t_(args.sourceUrl);
    const ssrc = t_(args.source);
    const pageOrSourceLine = surl ? surl : ssrc ? ssrc : "—";

    const greetPlain = name ? `Hi ${name},` : "Hi,";
    const ts = t_(args.submittedAtIso) || "—";

    /** @type {string[]} */
    const textParts = [
        greetPlain,
        "",
        "Thanks for contacting us. We received your enquiry and our team will get back to you soon.",
        "",
        "What you sent:",
        "",
        `Name: ${name || "—"}`,
        `Mobile: ${t_(args.mobile) || "—"}`,
        `Email: ${toAddr}`,
        `City: ${t_(args.city) || "—"}`,
        `Page / source URL: ${pageOrSourceLine}`,
        `Submitted (UTC): ${ts}`,
        "",
        "This email was sent automatically.",
        "",
        "Regards,",
        corp
    ];
    if (webStrip !== "—") {
        textParts.push(webStrip);
    }
    const text = textParts.join("\n");

    const html = renderEmailTemplateHtml_("lead_mail_to_client.html", {
        greeting_line: escapeMailHtml_(greetPlain),
        name: escapeMailHtml_(name || "—"),
        email: escapeMailHtml_(toAddr),
        mobile: escapeMailHtml_(t_(args.mobile) || "—"),
        city: escapeMailHtml_(t_(args.city) || "—"),
        source_url: escapeMailHtml_(pageOrSourceLine),
        submitted_at: escapeMailHtml_(ts),
        company_name: escapeMailHtml_(corp),
        company_website: escapeMailHtml_(webStrip === "—" ? "" : webStrip)
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
