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

/**
 * Longest digit-only run (length 10–15) from shallow string values — catches custom field names
 * that do not match phone aliases so Drive / Apps Script can still folder by mobile.
 *
 * @param {Record<string, unknown>} obj
 */
function longestDigitRunFromObject_(obj) {
    if (!obj || typeof obj !== "object") {
        return "";
    }
    let best = "";
    for (const [k, rv] of Object.entries(obj)) {
        if (typeof k === "string" && k.startsWith("_")) {
            continue;
        }
        const s = scalarFormValue(rv);
        if (!s) {
            continue;
        }
        const runs = String(s).match(/\d+/g);
        if (!runs) {
            continue;
        }
        for (const run of runs) {
            if (run.length >= 10 && run.length <= 15 && run.length > best.length) {
                best = run;
            }
        }
    }
    return best;
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
    return (
        longestDigitRunFromObject_(fields) ||
        longestDigitRunFromObject_(ctx) ||
        longestDigitRunFromObject_(body)
    );
}
