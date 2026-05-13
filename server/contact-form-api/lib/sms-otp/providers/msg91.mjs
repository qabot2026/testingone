/**
 * SMS provider: MSG91 — https://docs.msg91.com/
 *
 * Implements the `SmsProvider` interface consumed by ../index.mjs. We use the MSG91 OTP API
 *   POST https://control.msg91.com/api/v5/otp
 * and **supply our own OTP** so the core module keeps control of generation, hashing, storage,
 * verification, attempt limits and rate-limiting. MSG91 acts purely as the DLT-compliant SMS pipe.
 *
 * What MSG91 needs (set as env vars on your server, NOT here):
 *   MSG91_AUTHKEY        — required. Authentication key from https://control.msg91.com/app/#/api
 *   MSG91_TEMPLATE_ID    — required. DLT-approved template id. Your template must contain ##OTP##
 *                          (case-sensitive) where the code should appear, e.g.
 *                            "Your verification code is ##OTP##. Valid for 5 minutes. - XYZCLN"
 *
 * Optional:
 *   MSG91_BASE_URL       — defaults to https://control.msg91.com
 *   MSG91_SENDER_ID      — usually already baked into the DLT template
 *   MSG91_COUNTRY_CODE   — defaults to "91" (India). MSG91 expects <countrycode><mobile> with no '+'.
 *
 * @typedef {import("../index.mjs").SmsProviderSendInput} SmsProviderSendInput
 * @typedef {import("../index.mjs").SmsProviderSendResult} SmsProviderSendResult
 * @typedef {import("../index.mjs").SmsProvider} SmsProvider
 */

const DEFAULT_BASE_URL = "https://control.msg91.com";

function baseUrl_() {
    const raw = (process.env.MSG91_BASE_URL || DEFAULT_BASE_URL).trim();
    return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function authKey_() {
    return (process.env.MSG91_AUTHKEY || "").trim();
}

function templateId_() {
    return (process.env.MSG91_TEMPLATE_ID || "").trim();
}

function senderId_() {
    return (process.env.MSG91_SENDER_ID || "").trim();
}

function countryCode_() {
    const raw = (process.env.MSG91_COUNTRY_CODE || "91").trim().replace(/\D+/g, "");
    return raw || "91";
}

/**
 * Extract the most useful error string from MSG91's varied response shapes.
 * MSG91 responses look like:
 *   { type: "success", message: "...", request_id: "..." }
 *   { type: "error",   message: "Invalid template_id" }
 *   { type: "error",   message: { "mobile": ["Invalid number"] } }
 */
function extractMsg91Error_(data, httpStatus) {
    if (!data || typeof data !== "object") {
        return `MSG91 HTTP ${httpStatus}`;
    }
    const m = data.message;
    if (typeof m === "string" && m.trim()) {
        return m.trim();
    }
    if (m && typeof m === "object") {
        try {
            const flat = [];
            for (const [field, val] of Object.entries(m)) {
                if (Array.isArray(val)) {
                    flat.push(`${field}: ${val.join(", ")}`);
                } else {
                    flat.push(`${field}: ${String(val)}`);
                }
            }
            if (flat.length) {
                return flat.join("; ");
            }
        } catch {
            /* ignore */
        }
    }
    return `MSG91 HTTP ${httpStatus}`;
}

/** @type {SmsProvider} */
export const provider = {
    name: "msg91",

    missingEnvKeys() {
        const out = [];
        if (!authKey_()) {
            out.push("MSG91_AUTHKEY");
        }
        if (!templateId_()) {
            out.push("MSG91_TEMPLATE_ID");
        }
        return out;
    },

    debugInfo() {
        return {
            base_url: baseUrl_(),
            template_id_configured: !!templateId_(),
            authkey_configured: !!authKey_(),
            sender_id: senderId_() || null,
            country_code: countryCode_()
        };
    },

    /**
     * @param {SmsProviderSendInput} input
     * @returns {Promise<SmsProviderSendResult>}
     */
    async sendOtp(input) {
        const missing = provider.missingEnvKeys();
        if (missing.length) {
            return {
                ok: false,
                error: `MSG91 not configured: missing ${missing.join(", ")} on the server.`
            };
        }

        const mobile10 = String(input && input.mobile ? input.mobile : "").replace(/\D+/g, "");
        const otp = String(input && input.otp ? input.otp : "");
        const otpLength = Number.isFinite(input && input.otpLength) ? Number(input.otpLength) : otp.length;

        if (!/^[6-9]\d{9}$/.test(mobile10)) {
            return { ok: false, error: "MSG91 provider received an invalid Indian mobile." };
        }
        if (!otp) {
            return { ok: false, error: "MSG91 provider received an empty OTP." };
        }

        const fullMobile = `${countryCode_()}${mobile10}`;
        const url = `${baseUrl_()}/api/v5/otp`;

        /** @type {Record<string, unknown>} */
        const body = {
            template_id: templateId_(),
            mobile: fullMobile,
            otp,
            otp_length: otpLength
        };
        const sender = senderId_();
        if (sender) {
            body.sender = sender;
        }

        /** @type {Response} */
        let resp;
        try {
            resp = await fetch(url, {
                method: "POST",
                headers: {
                    authkey: authKey_(),
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify(body)
            });
        } catch (e) {
            return {
                ok: false,
                error: `MSG91 request failed: ${e && e.message ? e.message : String(e)}`
            };
        }

        const text = await resp.text();
        /** @type {Record<string, unknown>} */
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = {};
        }

        const type = typeof data.type === "string" ? data.type.trim().toLowerCase() : "";
        if (!resp.ok || type === "error" || type === "failure") {
            return {
                ok: false,
                status: resp.status,
                error: extractMsg91Error_(data, resp.status)
            };
        }

        const requestId =
            typeof data.request_id === "string"
                ? data.request_id
                : typeof data.requestId === "string"
                    ? data.requestId
                    : undefined;

        return { ok: true, status: resp.status, request_id: requestId };
    }
};
