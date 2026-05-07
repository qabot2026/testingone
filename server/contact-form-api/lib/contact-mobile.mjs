/**
 * Normalize form POST values (multipart can repeat fields → arrays) and resolve phone for folder naming.
 */

import { normalizeMobileDigits } from "./submission-folder-name.mjs";

/** @param {unknown} val */
export function scalarFormValue(val) {
    if (val == null) {
        return "";
    }
    if (typeof val === "string") {
        return val.trim();
    }
    if (typeof val === "number" && Number.isFinite(val)) {
        return String(val);
    }
    if (Array.isArray(val)) {
        for (const x of val) {
            const s = scalarFormValue(x);
            if (s) {
                return s;
            }
        }
        return "";
    }
    return "";
}

const MOBILE_KEYS = [
    "mobile",
    "phone",
    "tel",
    "contact_mobile",
    "whatsapp",
    "whatsapp_number",
    "contact_phone",
    "mobile_number",
    "phone_number",
    "cell",
    "cell_phone"
];

/** Normalized key → match common form field spellings (contactMobile, Mobile Number, etc.) */
const MOBILE_ALIASES_NORMALIZED = new Set(
    [
        "mobile",
        "phonenumber",
        "phone",
        "tel",
        "whatsapp",
        "whatsappnumber",
        "contactnumber",
        "contactphone",
        "contactmobile",
        "cell",
        "cellphone",
        "mobilenumber",
        "mobilephone",
        "usermobile",
        "yourmobile",
        "customermobile"
    ]
);

function normalizedFormKey(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
function pickMobileFromLooseKeys(obj) {
    if (!obj || typeof obj !== "object") {
        return "";
    }
    for (const [rk, rv] of Object.entries(obj)) {
        const nk = normalizedFormKey(rk);
        if (MOBILE_ALIASES_NORMALIZED.has(nk)) {
            const v = scalarFormValue(rv);
            if (v) {
                return v;
            }
        }
    }
    return "";
}

/**
 * Prefer strict keys, then any field whose normalized name matches a phone alias (covers custom `name=` in configs).
 *
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [clientContext]
 */
export function resolveContactMobile(fields, body, clientContext) {
    for (const k of MOBILE_KEYS) {
        // Form POST fields must win over stale client_context / merged body (session can carry empty "mobile").
        const v = scalarFormValue(fields[k]) || scalarFormValue(body[k]);
        if (v) {
            return v;
        }
    }
    if (clientContext && typeof clientContext === "object") {
        for (const k of MOBILE_KEYS) {
            const v = scalarFormValue(
                /** @type {Record<string, unknown>} */ (clientContext)[k]
            );
            if (v) {
                return v;
            }
        }
    }
    let loose = pickMobileFromLooseKeys(fields);
    if (loose) {
        return loose;
    }
    loose = pickMobileFromLooseKeys(body);
    if (loose) {
        return loose;
    }
    if (clientContext && typeof clientContext === "object") {
        loose = pickMobileFromLooseKeys(
            /** @type {Record<string, unknown>} */ (clientContext)
        );
        if (loose) {
            return loose;
        }
    }
    return "";
}

/**
 * Flat merge for mobile resolution when forwarding to Apps Script (fields + client_context may both hold the number).
 *
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} clientContext
 * @param {string} [serverResolvedMobile] from `resolveContactMobile` on the request
 */
export function resolveMobileForUpstream(fields, clientContext, serverResolvedMobile) {
    if (typeof serverResolvedMobile === "string" && serverResolvedMobile.trim()) {
        return serverResolvedMobile.trim();
    }
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const mergedBody = /** @type {Record<string, unknown>} */ ({
        ...ctx,
        ...fields
    });
    return resolveContactMobile(fields, mergedBody, ctx);
}

/** @param {string} s */
function bestDigitRunFromString_(s) {
    const str = String(s || "");
    const runs = str.match(/\d+/g);
    if (!runs) {
        return "";
    }
    let best = "";
    for (const run of runs) {
        // Filter out unix-epoch milliseconds timestamps (common in session ids / client clocks).
        // Examples: 1712345678901 (13 digits). These are frequently mis-detected as phones.
        if (run.length === 13) {
            const n = Number(run);
            if (Number.isFinite(n) && n >= 1_400_000_000_000 && n <= 2_200_000_000_000) {
                continue;
            }
        }
        if (run.length >= 9 && run.length <= 15 && run.length > best.length) {
            best = run;
        }
    }
    return best;
}

const DIGIT_SCAN_MAX_DEPTH = 12;

/**
 * Longest plausible mobile digit run anywhere in JSON-like payloads (nested client_context, wa_id, etc.).
 * Skips `_files` and other `_`-prefixed keys to avoid scanning base64.
 *
 * @param {unknown} val
 * @param {number} depth
 */
function longestDigitRunDeep_(val, depth) {
    if (depth > DIGIT_SCAN_MAX_DEPTH || val == null) {
        return "";
    }
    if (typeof val === "string") {
        return bestDigitRunFromString_(val.trim());
    }
    if (typeof val === "number" && Number.isFinite(val)) {
        return bestDigitRunFromString_(String(val));
    }
    if (Array.isArray(val)) {
        let best = "";
        for (const x of val) {
            const r = longestDigitRunDeep_(x, depth + 1);
            if (r.length > best.length) {
                best = r;
            }
        }
        return best;
    }
    if (typeof val === "object") {
        let best = "";
        for (const [k, rv] of Object.entries(val)) {
            if (typeof k === "string" && (k === "_files" || k.startsWith("_"))) {
                continue;
            }
            // Avoid scanning obvious non-phone identifiers that are often numeric.
            // This prevents accidentally treating session ids / timestamps as "mobile".
            if (typeof k === "string") {
                const nk = normalizedFormKey(k);
                if (
                    nk.includes("session") ||
                    nk.includes("clientsession") ||
                    nk.includes("timestamp") ||
                    nk.endsWith("ts") ||
                    nk.includes("time") ||
                    nk.includes("date") ||
                    nk.includes("createdat") ||
                    nk.includes("updatedat")
                ) {
                    continue;
                }
            }
            const r = longestDigitRunDeep_(rv, depth + 1);
            if (r.length > best.length) {
                best = r;
            }
        }
        return best;
    }
    return "";
}

/**
 * Digits-only mobile for upstream `_submission_mobile_digits` (explicit resolution, then heuristic scan).
 *
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [clientContext]
 */
export function resolveSubmissionMobileDigits(fields, body, clientContext) {
    const resolved = resolveContactMobile(fields, body, clientContext);
    const direct = normalizeMobileDigits(resolved);
    if (direct) {
        return direct;
    }
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const bodyObj = body && typeof body === "object" ? body : {};
    return (
        longestDigitRunDeep_(fields, 0) ||
        longestDigitRunDeep_(ctx, 0) ||
        longestDigitRunDeep_(bodyObj, 0)
    );
}
