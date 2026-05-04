/**
 * Normalize form POST values (multipart can repeat fields → arrays) and resolve phone for folder naming.
 */

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

const MOBILE_KEYS = ["mobile", "phone", "tel", "contact_mobile", "whatsapp", "whatsapp_number"];

/**
 * @param {Record<string, string>} fields
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [clientContext]
 */
export function resolveContactMobile(fields, body, clientContext) {
    for (const k of MOBILE_KEYS) {
        const v = scalarFormValue(body[k]) || scalarFormValue(fields[k]);
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
    return "";
}
