/**
 * Visitor display names for live-agent inbox / context (never use chat triggers as names).
 */

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

/** @param {string} text */
function normalizedPhrase_(text) {
    return trim_(text).toLowerCase().replace(/\s+/g, " ");
}

/** @param {string} raw */
export function isPlausibleVisitorDisplayName_(raw) {
    const t = trim_(raw);
    if (!t || t.length < 2 || t.length > 80) {
        return false;
    }
    if (/\d/.test(t) || /@/.test(t)) {
        return false;
    }
    if (t.includes("?")) {
        return false;
    }
    const words = t.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) {
        return false;
    }
    const n = normalizedPhrase_(t);
    const blocked = new Set([
        "human agent",
        "live agent",
        "live chat",
        "request live agent",
        "request human agent",
        "speak to agent",
        "speak to human",
        "talk to agent",
        "talk to human",
        "connect to agent",
        "connect agent",
        "agent please",
        "real person",
        "customer service",
        "request human",
        "handoff live agent",
        "yes",
        "no",
        "ok",
        "okay",
        "hi",
        "hello",
        "hey",
        "help",
        "menu"
    ]);
    if (blocked.has(n)) {
        return false;
    }
    if (/^(human|live)\s+(agent|chat)\b/.test(n)) {
        return false;
    }
    if (/\b(agent|chatbot|live\s*chat)\b/.test(n) && words.length <= 4) {
        return false;
    }
    if (/^(request|speak|talk|connect|need|want|get)\s+(to\s+)?(a\s+)?(human\s+)?agent$/.test(n)) {
        return false;
    }
    return /^[\p{L}\s'.-]+$/u.test(t);
}

/**
 * @param {{ visitorName?: string, contactName?: string, mobile?: string }} [opts]
 */
export function resolveVisitorDisplayName_(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const contactName = trim_(o.contactName);
    const visitorName = trim_(o.visitorName);
    if (isPlausibleVisitorDisplayName_(contactName)) {
        return contactName;
    }
    if (isPlausibleVisitorDisplayName_(visitorName)) {
        return visitorName;
    }
    const mobile = trim_(o.mobile).replace(/\D/g, "");
    if (mobile.length >= 4) {
        return "Visitor " + mobile.slice(-4);
    }
    return "Visitor";
}

/** @param {string} raw */
export function sanitizeVisitorNameForStorage_(raw) {
    const t = trim_(raw);
    return isPlausibleVisitorDisplayName_(t) ? t : "";
}
