import { getMailTransport_, isSmtpCredentialEnvPresent_ } from "./smtp-transport.mjs";
import { resolveContactLeadSendTimeoutMs_ } from "./smtp-timeouts.mjs";
import { isResendConfigured_, sendViaResend_ } from "./resend-send.mjs";

/** Default 180s for cloud→Gmail; override via CONTACT_LEAD_SEND_TIMEOUT_MS (max 300s). */
function sendTimeoutMs_() {
    return resolveContactLeadSendTimeoutMs_();
}

/** True if at least one mail provider (Resend OR SMTP) is configured. */
export function isMailConfigured_() {
    return isResendConfigured_() || isSmtpCredentialEnvPresent_();
}

/** Active provider id for logs/telemetry. */
export function currentMailProvider_() {
    if (isResendConfigured_()) return "resend";
    if (isSmtpCredentialEnvPresent_()) return "smtp";
    return "none";
}

/**
 * Send one transactional email through the active provider.
 *
 * Provider selection order:
 *   1. Resend HTTPS API   — if RESEND_API_KEY is set
 *   2. Nodemailer SMTP    — fallback (legacy path)
 *
 * @param {import('nodemailer').SendMailOptions} mailOpts
 */
export async function sendTimedMail_(mailOpts) {
    if (isResendConfigured_()) {
        await sendViaResend_(/** @type {Parameters<typeof sendViaResend_>[0]} */ (mailOpts));
        return;
    }

    const tx = getMailTransport_();
    const sendMs = sendTimeoutMs_();
    await Promise.race([
        tx.sendMail(mailOpts),
        new Promise((_, rej) => {
            globalThis.setTimeout(
                () =>
                    rej(
                        new Error(
                            `SMTP send stalled after ${sendMs}ms (slow TLS/network from cloud is common — raise CONTACT_LEAD_SEND_TIMEOUT_MS / CONTACT_LEAD_SMTP_CONNECT_TIMEOUT_MS; check SMTP_HOST, use port 587+STARTTLS or 465 + SMTP_SECURE=1)`
                        )
                    ),
                sendMs
            );
        })
    ]);
}

export { isSmtpCredentialEnvPresent_ };
