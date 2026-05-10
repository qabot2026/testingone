import { getMailTransport_, isSmtpCredentialEnvPresent_ } from "./smtp-transport.mjs";

/** Default 60s: Railway→Gmail cold STARTTLS often exceeds 20s; override via CONTACT_LEAD_SEND_TIMEOUT_MS. */
function sendTimeoutMs_() {
    const d = Number(process.env.CONTACT_LEAD_SEND_TIMEOUT_MS);
    const base = Number.isFinite(d) && d > 0 ? d : 60000;
    return Math.min(Math.max(base, 5000), 180000);
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
