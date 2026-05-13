/**
 * Visitor confirmation: booked appointment summary (CX chatbot, contact-form appointment flows, REST when email provided).
 *
 * HTML layout: templates/appointment_mail_to_client.html (+ optional appointment_banner_html for chat bookings).
 *
 * Enable: CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED=1
 * Optional: CONTACT_MAIL_* (company footer), CONTACT_APPOINTMENT_CLIENT_ACK_SUBJECT / _CHATBOT
 */

import { isSmtpCredentialEnvPresent_, sendTimedMail_ } from "./smtp-send.mjs";
import { escapeMailHtml_, renderEmailTemplateHtml_ } from "./render-email-template.mjs";

/** @param {string | undefined} s */
function t_(s) {
    return typeof s === "string" ? s.trim() : "";
}

/**
 * @param {{
 *   toEmail: string,
 *   recipientName?: string,
 *   doctorDisplay?: string,
 *   specialization?: string,
 *   branchId?: string,
 *   dateISO: string,
 *   slotLabel: string,
 *   cityOrPlace?: string,
 *   source?: string,
 *   mobile?: string,
 * }} args
 */
export async function maybeSendAppointmentClientAckEmail(args) {
    if ((process.env.CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED || "").trim() !== "1") {
        return { skipped: true, reason: "client_appointment_ack_disabled" };
    }
    const toAddr = t_(args.toEmail);
    if (!toAddr) {
        return { skipped: true, reason: "no_recipient_email" };
    }
    if (!isSmtpCredentialEnvPresent_()) {
        return { skipped: true, reason: "smtp_not_configured_for_outbound" };
    }
    const fromAddr =
        (process.env.CONTACT_APPOINTMENT_CLIENT_ACK_FROM || "").trim()
        || (process.env.MAIL_FROM || "").trim()
        || (process.env.SMTP_USER || "").trim();
    if (!fromAddr) {
        return { skipped: true, reason: "no_from_ADDRESS" };
    }
    const src = (t_(args.source) || "").toLowerCase();
    const subjFallback =
        src === "dialogflow-cx-chatbot"
            ? "Your appointment is confirmed (via chat assistant)"
            : "Your appointment is confirmed";
    let subjectBase = (process.env.CONTACT_APPOINTMENT_CLIENT_ACK_SUBJECT || "").trim();
    if (!subjectBase && src === "dialogflow-cx-chatbot") {
        subjectBase = (process.env.CONTACT_APPOINTMENT_CLIENT_ACK_SUBJECT_CHATBOT || "").trim();
    }
    if (!subjectBase) {
        subjectBase = subjFallback;
    }
    const dr = t_(args.doctorDisplay) || "(your doctor)";
    const subject =
        `${subjectBase} — ${dr} — ${t_(args.dateISO)}`.slice(0, 900);
    const name = t_(args.recipientName);
    const branchParts = [];
    const br = t_(args.branchId);
    const city = t_(args.cityOrPlace);
    if (br) branchParts.push(br);
    if (city) branchParts.push(city.includes("branch") ? city : `(${city})`);
    const locationLine = branchParts.join(" ").trim() || "—";

    const text = [
        "Hi" + (name ? ` ${name}` : ""),
        "",
        "This confirms we have booked the following appointment for you:",
        "",
        `  Doctor: ${dr}`,
        `  Specialization: ${t_(args.specialization) || "—"}`,
        `  Date: ${t_(args.dateISO)}`,
        `  Time: ${t_(args.slotLabel)}`,
        `  Branch / office: ${locationLine}`,
        `  Reference (source): ${t_(args.source) || "booking"}`,
        `  Mobile on file: ${t_(args.mobile) || "—"}`,
        "",
        "Please carry a government photo ID when you arrive. If you did not request this booking, reply to clinic staff.",
        "",
        `Sent UTC: ${new Date().toISOString()}`,
        ""
    ].join("\n");

    const corp =
        (process.env.CONTACT_MAIL_COMPANY_NAME || "").trim()
        || (process.env.CONTACT_MAIL_BRAND_TITLE || "").trim()
        || "Medical team";
    let webStrip = ((process.env.CONTACT_MAIL_COMPANY_WEBSITE || "").trim() || "—").replace(
        /^https?:\/\//i,
        ""
    );

    const greetPlain = name ? `Hi ${name},` : "Hi,";
    const badgeHtmlCx =
        src === "dialogflow-cx-chatbot"
            ? '<p style="margin:0 0 14px;background:#eef6ff;color:#174ea6;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.45;"><strong>Chat assistant</strong> — you booked via our conversational assistant.</p>'
            : "";

    const sentUtcNow = new Date().toISOString();
    const html = renderEmailTemplateHtml_(
        "appointment_mail_to_client.html",
        {
            greeting_line: escapeMailHtml_(greetPlain),
            doctor_name: escapeMailHtml_(dr),
            specialization: escapeMailHtml_(t_(args.specialization) || "—"),
            appointment_date: escapeMailHtml_(t_(args.dateISO)),
            appointment_time: escapeMailHtml_(t_(args.slotLabel)),
            branch: escapeMailHtml_(locationLine),
            source: escapeMailHtml_(t_(args.source) || "booking"),
            mobile: escapeMailHtml_(t_(args.mobile) || "—"),
            submitted_at: escapeMailHtml_(sentUtcNow),
            company_name: escapeMailHtml_(corp),
            company_website: escapeMailHtml_(webStrip === "—" ? "" : webStrip)
        },
        { appointment_banner_html: badgeHtmlCx }
    );
    const replyToRaw = (process.env.CONTACT_APPOINTMENT_CLIENT_ACK_REPLY_TO || "").trim();
    /** @type {Record<string, string>} */
    const mail = {
        from: fromAddr,
        to: toAddr,
        subject,
        text,
        html
    };
    if (replyToRaw) {
        mail.replyTo = replyToRaw.split(",")[0].trim();
    }
    try {
        await sendTimedMail_(mail);
        if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1") {
            console.log("[appointment-client-ack-email] sent_ok to_visitor:", toAddr);
        }
        return { sent: true };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.error("[appointment-client-ack-email] send failed:", msg);
        return { error: msg };
    }
}
