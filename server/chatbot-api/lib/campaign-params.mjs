/**
 * Marketing / campaign query parameters for Sheets and transcripts.
 */

/** Known keys (also accepts any query param starting with `utm_`). */
export const CAMPAIGN_PARAM_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
    "msclkid",
    "dclid",
    "twclid",
    "li_fat_id",
    "mc_cid",
    "mc_eid",
    "ref",
    "referrer",
    "campaign",
    "campaign_id",
    "adgroup",
    "adgroupid",
    "keyword",
    "matchtype",
    "device",
    "creative",
    "placement"
];

/**
 * @param {string} key
 */
function isCampaignParamKey_(key) {
    const k = String(key || "").trim().toLowerCase();
    if (!k) {
        return false;
    }
    if (CAMPAIGN_PARAM_KEYS.includes(k)) {
        return true;
    }
    return k.startsWith("utm_");
}

/**
 * @param {string} href
 * @returns {Record<string, string>}
 */
export function extractCampaignParamsFromUrl(href) {
    /** @type {Record<string, string>} */
    const out = {};
    const raw = typeof href === "string" ? href.trim() : "";
    if (!raw) {
        return out;
    }
    try {
        const u = new URL(raw, "https://placeholder.local");
        for (const [k, v] of u.searchParams.entries()) {
            if (!isCampaignParamKey_(k)) {
                continue;
            }
            const val = String(v || "").trim();
            if (!val) {
                continue;
            }
            out[k.toLowerCase()] = val.length > 500 ? val.slice(0, 500) : val;
        }
    } catch {
        /* ignore */
    }
    return out;
}

/**
 * @param {Record<string, unknown>} sessionParams
 * @param {Record<string, string>} fromUrl
 */
export function mergeCampaignParamsIntoSessionParams(sessionParams, fromUrl) {
    const sp =
        sessionParams && typeof sessionParams === "object" && !Array.isArray(sessionParams)
            ? { ...sessionParams }
            : {};
    const prev =
        sp.campaign_params && typeof sp.campaign_params === "object" && !Array.isArray(sp.campaign_params)
            ? /** @type {Record<string, string>} */ ({ .../** @type {Record<string, unknown>} */ (sp.campaign_params) })
            : {};
    /** @type {Record<string, string>} */
    const merged = { ...prev };
    for (const [k, v] of Object.entries(fromUrl || {})) {
        if (v) {
            merged[k] = v;
        }
    }
    for (const [k, v] of Object.entries(sp)) {
        if (typeof v === "string" && v.trim() && isCampaignParamKey_(k) && !merged[k]) {
            merged[k] = v.trim().slice(0, 500);
        }
    }
    if (Object.keys(merged).length) {
        sp.campaign_params = merged;
    }
    return sp;
}

/**
 * @param {unknown} clientContext
 * @returns {Record<string, string>}
 */
export function campaignParamsFromClientContext_(clientContext) {
    const cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? /** @type {Record<string, unknown>} */ (clientContext)
            : {};
    /** @type {Record<string, string>} */
    const out = {};
    const cp = cx.campaign_params;
    if (cp && typeof cp === "object" && !Array.isArray(cp)) {
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (cp))) {
            const s = v != null && typeof v !== "object" ? String(v).trim() : "";
            if (s) {
                out[String(k).toLowerCase()] = s.slice(0, 500);
            }
        }
    }
    const sp = cx.session_params;
    if (sp && typeof sp === "object" && !Array.isArray(sp)) {
        const nested = /** @type {Record<string, unknown>} */ (sp).campaign_params;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (nested))) {
                const s = v != null && typeof v !== "object" ? String(v).trim() : "";
                if (s && !out[String(k).toLowerCase()]) {
                    out[String(k).toLowerCase()] = s.slice(0, 500);
                }
            }
        }
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (sp))) {
            if (!isCampaignParamKey_(k)) {
                continue;
            }
            const s = v != null && typeof v !== "object" ? String(v).trim() : "";
            if (s && !out[k.toLowerCase()]) {
                out[k.toLowerCase()] = s.slice(0, 500);
            }
        }
    }
    for (const [k, v] of Object.entries(cx)) {
        if (!isCampaignParamKey_(k)) {
            continue;
        }
        const s = v != null && typeof v !== "object" ? String(v).trim() : "";
        if (s && !out[k.toLowerCase()]) {
            out[k.toLowerCase()] = s.slice(0, 500);
        }
    }
    return out;
}

/**
 * Compact string for a Sheet cell (key=value pairs).
 *
 * @param {unknown} clientContext
 * @returns {string}
 */
export function formatCampaignParamsForSheet_(clientContext) {
    const map = campaignParamsFromClientContext_(clientContext);
    const keys = Object.keys(map).sort();
    if (!keys.length) {
        return "";
    }
    return keys.map((k) => `${k}=${map[k]}`).join(" | ").slice(0, 49000);
}

/**
 * Multi-line block for staff transcript assistant bubble.
 *
 * @param {unknown} clientContext
 * @returns {string}
 */
export function formatCampaignParamsForTranscript_(clientContext) {
    const map = campaignParamsFromClientContext_(clientContext);
    const keys = Object.keys(map).sort();
    if (!keys.length) {
        return "";
    }
    const lines = keys.map((k) => {
        const label = k
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        return `${label}: ${map[k]}`;
    });
    return `Campaign parameters\n\n${lines.join("\n")}`;
}
