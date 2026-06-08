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
function acceptResolvedMobile_(raw, clientContext) {
    const v = scalarFormValue(raw);
    if (!v) {
        return "";
    }
    const digits = normalizeMobileDigits(v);
    if (digits.length >= 9) {
        return rejectSessionDerivedMobileDigits_(digits, clientContext) ? v.trim() : "";
    }
    return v.trim();
}

export function resolveContactMobile(fields, body, clientContext) {
    for (const k of MOBILE_KEYS) {
        // Form POST fields must win over stale client_context / merged body (session can carry empty "mobile").
        const v = acceptResolvedMobile_(
            scalarFormValue(fields[k]) || scalarFormValue(body[k]),
            clientContext
        );
        if (v) {
            return v;
        }
    }
    if (clientContext && typeof clientContext === "object") {
        const lookup = contactContextLookupRecord_(clientContext);
        for (const k of MOBILE_KEYS) {
            const v = acceptResolvedMobile_(scalarFormValue(lookup[k]), clientContext);
            if (v) {
                return v;
            }
        }
    }
    let loose = pickMobileFromLooseKeys(fields);
    loose = acceptResolvedMobile_(loose, clientContext);
    if (loose) {
        return loose;
    }
    loose = acceptResolvedMobile_(pickMobileFromLooseKeys(body), clientContext);
    if (loose) {
        return loose;
    }
    if (clientContext && typeof clientContext === "object") {
        loose = acceptResolvedMobile_(
            pickMobileFromLooseKeys(contactContextLookupRecord_(clientContext)),
            clientContext
        );
        if (loose) {
            return loose;
        }
    }
    return "";
}

/** @param {string} s */
function trimNameCell_(s) {
    const t = String(s || "").trim();
    if (!t) {
        return "";
    }
    // Defensive: ignore unrendered CX/session template placeholders (should never go to Sheets).
    if (/^\$session\.params\.[a-z0-9_]+$/i.test(t) || t.includes("$session.params.")) {
        return "";
    }
    return t.length > 200 ? t.slice(0, 200) : t;
}

const CONTACT_NAME_KEYS = ["name"];

/**
 * Flat map for contact resolution: top-level `client_context` plus Dialogflow `session_params`.
 *
 * @param {Record<string, unknown> | null | undefined} clientContext
 * @returns {Record<string, unknown>}
 */
export function contactContextLookupRecord_(clientContext) {
    if (!clientContext || typeof clientContext !== "object" || Array.isArray(clientContext)) {
        return {};
    }
    const cx = /** @type {Record<string, unknown>} */ (clientContext);
    const sp =
        cx.session_params && typeof cx.session_params === "object" && !Array.isArray(cx.session_params)
            ? /** @type {Record<string, unknown>} */ (cx.session_params)
            : {};
    /** @type {Record<string, unknown>} */
    const out = { ...sp };
    for (const [k, val] of Object.entries(cx)) {
        if (k === "session_params" || (typeof k === "string" && k.startsWith("_"))) {
            continue;
        }
        const s = scalarFormValue(val);
        if (!s) {
            continue;
        }
        out[k] = val;
    }
    return out;
}

const CONTACT_NAME_ALIASES = [
    "customer_name",
    "full_name",
    "person_name",
    "username",
    "guest_name",
    "guestname"
];

const EMAIL_SUFFIX_KEYS_NORMALIZED = new Set(["email", "useremail", "mail", "contactemail"]);

/** Keys that end with `"email"` but are names ( middlename → false positive for nk.endsWith("email") ). */
const LOOSE_EMAIL_FALSE_POSITIVE = new Set(["lastname", "middlename"]);

/** @type {(cx: Record<string, unknown>) => string} */
function pickNameFromLooseKeys_(cx) {
    let firstPart = "";
    let lastPart = "";

    for (const [rk, rv] of Object.entries(cx)) {
        if (typeof rk === "string" && rk.startsWith("_")) {
            continue;
        }
        const nk = normalizedFormKey(rk);
        const v = scalarFormValue(rv);
        if (!v) {
            continue;
        }
        if (CONTACT_NAME_ALIASES.some((alias) => normalizedFormKey(alias) === nk)) {
            return trimNameCell_(v);
        }
        /** Dialogflow @sys.person / CX often uses given-name · family-name (→ givenname · familyname). */
        if (nk === "displayname" || nk === "persondisplayname" || nk === "callername") {
            return trimNameCell_(v);
        }
        if (
            nk === "firstname"
            || nk === "givenname"
            || nk === "first"
            || nk === "fname"
        ) {
            firstPart = trimNameCell_(v);
            continue;
        }
        if (
            nk === "lastname"
            || nk === "familyname"
            || nk === "surname"
            || nk === "secondname"
            || nk === "lname"
        ) {
            lastPart = trimNameCell_(v);
            continue;
        }
        if (nk === "middlename") {
            continue;
        }
    }

    const composite = [firstPart, lastPart].filter(Boolean).join(" ").trim();
    return composite ? trimNameCell_(composite) : "";
}

/**
 * Name for Sheets / Firestore — form fields win, then nested `client_context` (matches chat/widget session storage keys).
 *
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [clientContext]
 */
export function resolveContactName(fields, body, clientContext) {
    for (const k of CONTACT_NAME_KEYS) {
        const v =
            scalarFormValue(fields[k])
            || (body && typeof body === "object" ? scalarFormValue(body[k]) : "");
        const t = trimNameCell_(v);
        if (t) {
            return t;
        }
    }
    /** Custom form `name=` values (full_name, contact_name, …) plus flat multipart fields. */
    const looseFields = pickNameFromLooseKeys_(/** @type {Record<string, unknown>} */ (fields));
    if (looseFields) {
        return looseFields;
    }
    if (body && typeof body === "object") {
        const looseBody = pickNameFromLooseKeys_(body);
        if (looseBody) {
            return looseBody;
        }
    }
    if (clientContext && typeof clientContext === "object") {
        const lookup = contactContextLookupRecord_(clientContext);
        for (const k of CONTACT_NAME_KEYS) {
            const t = trimNameCell_(scalarFormValue(lookup[k]));
            if (t) {
                return t;
            }
        }
        const loose = pickNameFromLooseKeys_(lookup);
        if (loose) {
            return loose;
        }
    }
    return "";
}

/** @type {(cx: Record<string, unknown>) => string} */
function pickEmailFromLooseKeys_(cx) {
    for (const [rk, rv] of Object.entries(cx)) {
        if (typeof rk === "string" && rk.startsWith("_")) {
            continue;
        }
        const nk = normalizedFormKey(rk);
        const looksLikeEmailKey =
            EMAIL_SUFFIX_KEYS_NORMALIZED.has(nk)
            || nk === "e_mail"
            || (nk.endsWith("email") && !LOOSE_EMAIL_FALSE_POSITIVE.has(nk));
        if (looksLikeEmailKey) {
            const v = scalarFormValue(rv);
            if (v) {
                return v.trim();
            }
        }
    }
    return "";
}

/**
 * Email — form fields win, then nested `client_context` (matches chat session storage keys).
 *
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [clientContext]
 */
export function resolveContactEmail(fields, body, clientContext) {
    const canonicalEmailKeys = ["email", "user_email", "contact_email"];
    for (let i = 0; i < canonicalEmailKeys.length; i += 1) {
        const k = canonicalEmailKeys[i];
        const v =
            scalarFormValue(fields[k])
            || (body && typeof body === "object" ? scalarFormValue(body[k]) : "");
        if (v) {
            return v.trim();
        }
    }
    const looseF = pickEmailFromLooseKeys_(/** @type {Record<string, unknown>} */ (fields));
    if (looseF) {
        return looseF.trim();
    }
    if (body && typeof body === "object") {
        const looseB = pickEmailFromLooseKeys_(body);
        if (looseB) {
            return looseB.trim();
        }
    }
    if (clientContext && typeof clientContext === "object") {
        const lookup = contactContextLookupRecord_(clientContext);
        const direct =
            scalarFormValue(lookup.email)
            || scalarFormValue(lookup.user_email)
            || scalarFormValue(lookup.contact_email);
        if (direct) {
            return direct.trim();
        }
        return pickEmailFromLooseKeys_(lookup);
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

const UUID_V4_TEXT_RE =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

/** @param {string} s */
function looksLikeUuidString_(s) {
    const t = String(s || "").trim();
    return t.length > 0 && UUID_V4_TEXT_RE.test(t) && t.replace(/[^0-9a-f-]/gi, "").length >= 32;
}

/** @param {string} s */
function stringLikelyContainsUuid_(s) {
    return UUID_V4_TEXT_RE.test(String(s || ""));
}

/** @param {string} digits */
function isEpochMillisDigitRun_(digits) {
    const d = normalizeMobileDigits(digits);
    if (d.length !== 13) {
        return false;
    }
    const n = Number(d);
    return Number.isFinite(n) && n >= 1_400_000_000_000 && n <= 2_200_000_000_000;
}

/** @param {Record<string, unknown> | null | undefined} clientContext */
function sessionIdFromClientContext_(clientContext) {
    if (!clientContext || typeof clientContext !== "object") {
        return "";
    }
    const cx = /** @type {Record<string, unknown>} */ (clientContext);
    const direct =
        typeof cx.client_session_id === "string" && cx.client_session_id.trim()
            ? cx.client_session_id.trim()
            : "";
    if (direct) {
        return direct;
    }
    const nested =
        cx.client_context
        && typeof cx.client_context === "object"
        && !Array.isArray(cx.client_context)
        && typeof /** @type {Record<string, unknown>} */ (cx.client_context).client_session_id === "string"
            ? String(/** @type {Record<string, unknown>} */ (cx.client_context).client_session_id).trim()
            : "";
    return nested;
}

/**
 * Reject mobiles parsed from session ids (UUID fragments, `chat-{epoch}-…` timestamps, etc.).
 * @param {string} digits
 * @param {Record<string, unknown> | string | null | undefined} clientContextOrSessionId
 */
export function rejectSessionDerivedMobileDigits(digits, clientContextOrSessionId) {
    const d = normalizeMobileDigits(digits);
    if (!d || isEpochMillisDigitRun_(d)) {
        return "";
    }
    const sid =
        typeof clientContextOrSessionId === "string"
            ? clientContextOrSessionId.trim()
            : sessionIdFromClientContext_(clientContextOrSessionId);
    if (!sid) {
        return d;
    }
    const sidNorm = sid.replace(/\s+/g, "").toLowerCase();
    const mobileNorm = String(digits || "").replace(/\s+/g, "").toLowerCase();
    if (mobileNorm && (mobileNorm === sidNorm || sidNorm.includes(mobileNorm))) {
        return "";
    }
    const sidDigits = sid.replace(/\D/g, "");
    if (sidDigits.length >= 9) {
        if (d === sidDigits || sidDigits.includes(d) || d.includes(sidDigits)) {
            return "";
        }
    }
    if (d.length >= 9 && sid.includes(d)) {
        return "";
    }
    return d;
}

/** @param {string} digits @param {Record<string, unknown>} [clientContext] */
function rejectSessionDerivedMobileDigits_(digits, clientContext) {
    return rejectSessionDerivedMobileDigits(digits, clientContext);
}

const USER_QUERY_CONTEXT_KEYS = [
    "user_queries",
    "chat_queries",
    "visitor_queries",
    "dialog_queries",
    "conversation_queries"
];

/**
 * Prefer the latest user chat line when it is clearly a phone (form field may be missing on some clients).
 *
 * @param {Record<string, unknown>} ctx
 */
function pickMobileFromUserQueriesInContext_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return "";
    }
    for (let ki = 0; ki < USER_QUERY_CONTEXT_KEYS.length; ki += 1) {
        const key = USER_QUERY_CONTEXT_KEYS[ki];
        const arr = ctx[key];
        if (!Array.isArray(arr)) {
            continue;
        }
        for (let i = arr.length - 1; i >= 0; i -= 1) {
            const line = scalarFormValue(arr[i]);
            if (!line || looksLikeUuidString_(line) || stringLikelyContainsUuid_(line)) {
                continue;
            }
            const digits = rejectSessionDerivedMobileDigits_(
                normalizeMobileDigits(line),
                ctx
            );
            if (digits.length >= 9 && digits.length <= 15 && !isEpochMillisDigitRun_(digits)) {
                return digits;
            }
        }
    }
    return "";
}

/** @param {string} s */
function bestDigitRunFromString_(s) {
    const str = String(s || "").trim();
    if (!str || looksLikeUuidString_(str)) {
        return "";
    }
    if (str.length > 48 && stringLikelyContainsUuid_(str)) {
        return "";
    }
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
        const t = val.trim();
        if (!t || looksLikeUuidString_(t)) {
            return "";
        }
        if (t.length > 48 && stringLikelyContainsUuid_(t)) {
            return "";
        }
        return bestDigitRunFromString_(t);
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
                if (nk === "clientcontext" && typeof rv === "string") {
                    continue;
                }
                if (
                    nk === "clientsessionid" ||
                    nk === "sessionid" ||
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
    const direct = rejectSessionDerivedMobileDigits_(
        normalizeMobileDigits(resolved),
        clientContext
    );
    if (direct) {
        return direct;
    }
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const fromQueries = rejectSessionDerivedMobileDigits_(
        pickMobileFromUserQueriesInContext_(ctx),
        clientContext
    );
    if (fromQueries) {
        return fromQueries;
    }
    // Only scan explicit form fields — never deep-scan session/client_context (session ids look like phones).
    const fromFields = rejectSessionDerivedMobileDigits_(
        longestDigitRunDeep_(fields, 0),
        clientContext
    );
    return fromFields || "";
}
