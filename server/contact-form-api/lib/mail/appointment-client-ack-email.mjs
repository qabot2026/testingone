/**
 * Visitor confirmation: booked appointment summary (CX chatbot, contact-form appointment flows, REST when email provided).
 *
 * Enable: CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED=1
 * Optional subjects: CONTACT_APPOINTMENT_CLIENT_ACK_SUBJECT_CHATBOT vs generic — single CONTACT_APPOINTMENT_CLIENT_ACK_SUBJECT for all if set.
 */

import { isSmtpCredentialEnvPresent_, sendTimedMail_ } from "./smtp-send.mjs";

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
    const text = [
        "Hi" + (name ? ` ${name}` : ""),
        "",
        "This confirms we have booked the following appointment for you:",
        "",
        `  Doctor: ${dr}`,
        `  Specialization: ${t_(args.specialization) || "—"}`,
        `  Date: ${t_(args.dateISO)}`,
        `  Time: ${t_(args.slotLabel)}`,
        `  Branch / office: ${t_(args.branchId) || "—"} ${t_(args.cityOrPlace) ? `(${t_(args.cityOrPlace)})` : ""}`,
        `  Reference (source): ${t_(args.source) || "booking"}`,
        `  Mobile on file: ${t_(args.mobile) || "—"}`,
        "",
        "Please carry a government photo ID when you arrive. If you did not request this booking, reply to clinic staff.",
        "",
        `Sent UTC: ${new Date().toISOString()}`,
        ""
    ].join("\n");
    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    const html = `<pre style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;line-height:1.45;white-space:pre-wrap">${esc(
        text
    )}</pre>`;
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
