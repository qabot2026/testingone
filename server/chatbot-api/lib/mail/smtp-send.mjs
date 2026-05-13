import { getMailTransport_, isSmtpCredentialEnvPresent_ } from "./smtp-transport.mjs";
import { resolveContactLeadSendTimeoutMs_ } from "./smtp-timeouts.mjs";

/** Default 180s for cloud→Gmail; override via CONTACT_LEAD_SEND_TIMEOUT_MS (max 300s). */
function sendTimeoutMs_() {
    return resolveContactLeadSendTimeoutMs_();
}

/**
 * @param {import('nodemailer').SendMailOptions} mailOpts
 */
export async function sendTimedMail_(mailOpts) {
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
