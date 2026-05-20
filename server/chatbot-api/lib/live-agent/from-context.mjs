/**
 * Queue live-agent conversations from widget `client_context` / CX session params.
 * Runs on session sync endpoints so handoff works even when the browser fetch path fails.
 */

import {
    requestHumanAgent_,
    liveAgentFirestoreReady_,
    getConversation_,
    isLiveAgentAiCopilot_
} from "./store.mjs";
import {
    sanitizeVisitorNameForStorage_,
    visitorNameMatchesChatLine_
} from "./visitor-name.mjs";

const LOG_TAG = "[live-agent/from-context]";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function scalar_(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "boolean") {
        return v ? "true" : "";
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    if (typeof v === "object" && typeof v.stringValue === "string") {
        return v.stringValue.trim();
    }
    return String(v).trim();
}

function paramTruthy_(v) {
    if (v === true) {
        return true;
    }
    const s = scalar_(v).toLowerCase();
    return s === "true" || s === "yes" || s === "1";
}

function lastUserQueryLine_(ctx) {
    const uq = ctx.user_queries;
    if (!Array.isArray(uq) || !uq.length) {
        return "";
    }
    for (let i = uq.length - 1; i >= 0; i -= 1) {
        const line = scalar_(uq[i]);
        if (line) {
            return line;
        }
    }
    return "";
}

/**
 * @param {Record<string, unknown>} clientContext
 * @returns {Promise<{ queued: boolean, reason?: string, conversationId?: string }>}
 */
export async function maybeQueueLiveAgentFromClientContext_(clientContext) {
    if (!liveAgentFirestoreReady_()) {
        return { queued: false, reason: "firestore_not_ready" };
    }
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const sid = scalar_(ctx.client_session_id);
    if (!sid) {
        return { queued: false, reason: "no_client_session_id" };
    }

    const sp = ctx.session_params && typeof ctx.session_params === "object" ? ctx.session_params : {};

    try {
        const conv = await getConversation_(sid);
        if (conv && isLiveAgentAiCopilot_(conv)) {
            return { queued: false, reason: "ai_copilot", conversationId: sid };
        }
    } catch (copilotErr) {
        console.warn(LOG_TAG, "copilot check:", copilotErr.message || copilotErr);
    }

    if (paramTruthy_(ctx.live_agent_copilot) || paramTruthy_(sp.live_agent_copilot)) {
        return { queued: false, reason: "ai_copilot_session", conversationId: sid };
    }

    let requested = paramTruthy_(ctx.live_agent_requested);
    const paramKeys = [
        "request_live_agent",
        "live_agent",
        "request_human_agent",
        "human_agent",
        "handoff_live_agent"
    ];
    for (let i = 0; i < paramKeys.length; i += 1) {
        if (paramTruthy_(sp[paramKeys[i]])) {
            requested = true;
            break;
        }
    }

    if (!requested) {
        return { queued: false, reason: "not_requested", conversationId: sid };
    }

    const lastQ = lastUserQueryLine_(ctx);
    let visitorName =
        sanitizeVisitorNameForStorage_(scalar_(ctx.name) || scalar_(ctx.visitor_name)) || "";
    if (visitorName && (visitorNameMatchesChatLine_(visitorName, lastQ) || visitorNameMatchesChatLine_(visitorName, scalar_(ctx.live_agent_initial_message)))) {
        visitorName = "";
    }
    let initialMessage =
        scalar_(ctx.live_agent_initial_message) || lastQ || "";
    const imNorm = initialMessage.toLowerCase().replace(/\s+/g, " ").trim();
    const handoffOnly =
        !imNorm ||
        imNorm === "human agent" ||
        imNorm === "live agent" ||
        imNorm === "request live agent" ||
        imNorm === "request human agent" ||
        imNorm === "speak to agent";
    if (handoffOnly) {
        initialMessage = "";
    }
    const departmentId = scalar_(sp.department_id) || scalar_(sp.departmentId) || "";

    try {
        const result = await requestHumanAgent_({
            conversationId: sid,
            visitorName,
            initialMessage,
            departmentId
        });
        console.log(LOG_TAG, "queued", sid, result.alreadyActive ? "alreadyActive" : "new");
        return { queued: true, conversationId: sid, alreadyActive: Boolean(result.alreadyActive) };
    } catch (err) {
        console.warn(LOG_TAG, "queue failed", sid, err.message || err);
        return { queued: false, reason: err.message || String(err), conversationId: sid };
    }
}

/**
 * CX webhook body parameters (may be plain strings or protobuf structs).
 * @param {Record<string, unknown>} params
 * @param {string} key
 */
export function cxWebhookParamStr_(params, key) {
    const p = params && typeof params === "object" ? params : {};
    return scalar_(p[key]);
}
