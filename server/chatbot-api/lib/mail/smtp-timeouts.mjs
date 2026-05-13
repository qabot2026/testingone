/** Shared caps for outbound SMTP (Railway → Gmail often needs >60s end-to-end). */

/**
 * Overall budget for `sendMail` (our Promise.race). Default 180s; max 300s.
 * @returns {number}
 */
export function resolveContactLeadSendTimeoutMs_() {
    const d = Number(process.env.CONTACT_LEAD_SEND_TIMEOUT_MS);
    const base = Number.isFinite(d) && d > 0 ? d : 180000;
    return Math.min(Math.max(base, 5000), 300000);
}
