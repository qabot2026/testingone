/**
 * Lead / conversation channel ids for Sheets, Firestore, and Dialogflow session params.
 */

/** @param {unknown} raw @returns {"web"|"whatsapp"|"instagram"|"facebook"} */
export function normalizeLeadChannel(raw) {
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (s === "whatsapp" || s === "wa") {
        return "whatsapp";
    }
    if (s === "instagram" || s === "ig") {
        return "instagram";
    }
    if (s === "facebook" || s === "fb" || s === "messenger") {
        return "facebook";
    }
    return "web";
}

/** @param {unknown} channel */
export function isMetaLeadChannel(channel) {
    const c = normalizeLeadChannel(channel);
    return c === "whatsapp" || c === "instagram" || c === "facebook";
}

/** Meta webhook session ids: wa_*, ig_*, fb_* */
export function isMetaSessionId(sessionId) {
    return /^(wa|ig|fb)_/i.test(String(sessionId || "").trim());
}
