/**
 * Clinic / operations inbox: appointment was booked via Dialogflow CX (chatbot tag `book_doctor_appointment`).
 *
 * Set CONTACT_APPOINTMENT_CHATBOT_STAFF_NOTIFY_TO (comma-separated) to enable.
 */

import { isSmtpCredentialEnvPresent_, sendTimedMail_ } from "./smtp-send.mjs";

/** @param {string | undefined} s */
function t_(s) {
    return typeof s === "string" ? s.trim() : "";
}

/**
 * @param {{
 *   doctorDisplay?: string,
 *   doctorName?: string,
 *   specialization?: string,
 *   branchId?: string,
 *   dateISO: string,
 *   slotLabel: string,
 *   cityOrPlace?: string,
 * }} args
 */
export async function maybeSendAppointmentChatbotStaffNotifyEmail(args) {
    const rawTo = (process.env.CONTACT_APPOINTMENT_CHATBOT_STAFF_NOTIFY_TO || "").trim();
    const toList = rawTo
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!toList.length) {
        return { skipped: true, reason: "no_CONTACT_APPOINTMENT_CHATBOT_STAFF_NOTIFY_TO" };
    }
    if (!isSmtpCredentialEnvPresent_()) {
        return { skipped: true, reason: "smtp_not_configured_for_outbound" };
    }
    const fromAddr = (process.env.MAIL_FROM || "").trim() || (process.env.SMTP_USER || "").trim();
    if (!fromAddr) {
        return { skipped: true, reason: "no_from_MAIL_FROM_or_SMTP_USER" };
    }
    const prefix = (
        process.env.CONTACT_APPOINTMENT_CHATBOT_STAFF_SUBJECT || "NEW chatbot booking"
    ).trim();
    const dr = t_(args.doctorDisplay) || `Dr. ${t_(args.doctorName)}` || "(doctor)";
    const subject = `${prefix} — ${dr} — ${t_(args.dateISO)} ${t_(args.slotLabel)}`.slice(0, 900);
    const text = [
        "An appointment slot was booked from the Dialogflow CX / chat assistant.",
        "",
        `Doctor (display/name): ${dr}`,
        `Specialization: ${t_(args.specialization) || "—"}`,
        `Branch Id: ${t_(args.branchId) || "—"}`,
        `Date (ISO): ${t_(args.dateISO)}`,
        `Time slot: ${t_(args.slotLabel)}`,
        `Place / city: ${t_(args.cityOrPlace) || "—"}`,
        "",
        `Booked wall clock (UTC): ${new Date().toISOString()}`,
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
    try {
        await sendTimedMail_({
            from: fromAddr,
            to: toList.join(", "),
            subject,
            text,
            html
        });
        if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1") {
            console.log("[appointment-chatbot-staff-notify-email] sent_ok staff_count=", String(toList.length));
        }
        return { sent: true };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.error("[appointment-chatbot-staff-notify-email] send failed:", msg);
        return { error: msg };
    }
}
