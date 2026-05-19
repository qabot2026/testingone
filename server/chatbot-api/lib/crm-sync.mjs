/**
 * Optional outbound CRM webhook on lead submit (pass/fail for Sheets + transcript).
 */

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function crmWebhookUrl_() {
    return trim_(process.env.CRM_WEBHOOK_URL || process.env.LEAD_CRM_WEBHOOK_URL);
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function safeJsonString_(payload) {
    try {
        const s = JSON.stringify(payload, null, 0);
        return s.length > 12000 ? s.slice(0, 12000) + "…" : s;
    } catch {
        return String(payload).slice(0, 12000);
    }
}

/**
 * POST lead payload to CRM webhook when configured.
 *
 * @param {Record<string, unknown>} leadPayload
 * @returns {Promise<{ skipped?: boolean, status: string, ok: boolean, httpStatus?: number, request: string, response: string, error?: string }>}
 */
export async function syncLeadToCrm_(leadPayload) {
    const url = crmWebhookUrl_();
    if (!url) {
        return {
            skipped: true,
            status: "",
            ok: false,
            request: "",
            response: ""
        };
    }
    const requestBody = safeJsonString_(leadPayload);
    const timeoutMs = Math.max(
        3000,
        Math.min(
            Number.parseInt(process.env.CRM_WEBHOOK_TIMEOUT_MS || "25000", 10) || 25000,
            120000
        )
    );
    const headers = { "Content-Type": "application/json" };
    const secret = trim_(process.env.CRM_WEBHOOK_SECRET);
    if (secret) {
        headers["X-CRM-Webhook-Secret"] = secret;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers,
            body: requestBody,
            signal: ac.signal
        });
        const text = await resp.text();
        const response = text.length > 12000 ? text.slice(0, 12000) + "…" : text;
        const ok = resp.ok;
        return {
            status: ok ? "Passed" : "Failed",
            ok,
            httpStatus: resp.status,
            request: requestBody,
            response
        };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        return {
            status: "Failed",
            ok: false,
            request: requestBody,
            response: "",
            error: msg.slice(0, 500)
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {unknown} clientContext
 * @returns {{ crmStatus: string, crmRequest: string, crmResponse: string }}
 */
export function crmFieldsFromClientContext_(clientContext) {
    const cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? /** @type {Record<string, unknown>} */ (clientContext)
            : {};
    const status =
        trim_(cx.crm_status)
        || trim_(cx.crmStatus)
        || (cx.crm_ok === true ? "Passed" : cx.crm_ok === false ? "Failed" : "");
    const crmRequest =
        trim_(cx.crm_request) || trim_(cx.crmRequest) || trim_(cx.crm_request_body);
    const crmResponse =
        trim_(cx.crm_response)
        || trim_(cx.crmResponse)
        || trim_(cx.crm_response_body)
        || trim_(cx.crm_error);
    return { crmStatus: status, crmRequest, crmResponse };
}

/**
 * Multi-line assistant bubble for staff transcript (after form summary).
 *
 * @param {unknown} clientContext
 * @returns {string}
 */
export function formatCrmExchangeForTranscript_(clientContext) {
    const { crmStatus, crmRequest, crmResponse } = crmFieldsFromClientContext_(clientContext);
    if (!crmStatus && !crmRequest && !crmResponse) {
        return "";
    }
    /** @type {string[]} */
    const lines = [];
    if (crmStatus) {
        lines.push(`CRM: ${crmStatus}`);
    }
    if (crmRequest) {
        lines.push("", "Request:", crmRequest);
    }
    if (crmResponse) {
        lines.push("", "Response:", crmResponse);
    }
    return `CRM integration\n\n${lines.join("\n")}`.slice(0, 49000);
}
