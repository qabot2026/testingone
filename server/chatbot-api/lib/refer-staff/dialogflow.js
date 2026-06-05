/** Minimal Dialogflow helpers for query-analytics (ES — no direct Dialogflow API here). */

function isFallbackIntent_(intentName, intentObj) {
    if (intentObj && intentObj.isFallback) return true;
    const name = String(intentName || (intentObj && intentObj.displayName) || "")
        .trim()
        .toLowerCase();
    if (!name) return false;
    if (name === "default fallback intent" || name === "default unknown") return true;
    if (name.includes("fallback")) return true;
    const custom = String(process.env.DIALOGFLOW_FALLBACK_INTENTS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return custom.includes(name);
}

module.exports = {
    isFallbackIntent: isFallbackIntent_,
    PROJECT_ID: process.env.DIALOGFLOW_PROJECT_ID || ""
};
