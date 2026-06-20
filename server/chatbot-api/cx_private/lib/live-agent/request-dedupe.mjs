/**
 * Short-lived cache for POST /api/live-agent/request (same clientSessionId).
 * Stops paste/console spam from hammering Firestore when DevTools fires many fetches.
 */

const COOLDOWN_MS = Math.max(
    1000,
    Number.parseInt(process.env.LIVE_AGENT_REQUEST_COOLDOWN_MS || "5000", 10) || 5000
);

/** @type {Map<string, { at: number, result: object }>} */
const cache = new Map();

export function getCachedVisitorRequest_(sessionId) {
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!id) return null;
    const e = cache.get(id);
    if (!e) return null;
    if (Date.now() - e.at > COOLDOWN_MS) {
        cache.delete(id);
        return null;
    }
    return e.result;
}

export function cacheVisitorRequest_(sessionId, result) {
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!id || !result) return;
    cache.set(id, { at: Date.now(), result });
}
