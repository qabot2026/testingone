import { getMailTransport_, isSmtpCredentialEnvPresent_ } from "./smtp-transport.mjs";

function sendTimeoutMs_() {
    return Math.min(Math.max(Number(process.env.CONTACT_LEAD_SEND_TIMEOUT_MS) || 20000, 5000), 180000);
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
                            `SMTP send stalled after ${sendMs}ms (wrong host/port, firewall, or provider blocking)`
                        )
                    ),
                sendMs
            );
        })
    ]);
}

export { isSmtpCredentialEnvPresent_ };
