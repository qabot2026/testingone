/**
 * Firestore bridge for refer-staff live-agent sheet sync (CJS live-agent-store.js).
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { fetchLatestContactSubmissionForClientSession, fetchSessionChatTranscriptContext } from "../firestore.mjs";
import { getVisitorContext_ } from "./context.mjs";
import { getLiveAgentSettings_, resolveAgentDisplayName_ } from "./departments.mjs";

const LOG_TAG = "[live-agent/firestore-bridge]";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function conversationsCollection_() {
    return trim_(process.env.LIVE_AGENT_CONVERSATIONS_COLLECTION) || "live_agent_conversations";
}

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function tsToIso_(v) {
    if (!v) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v.toDate === "function") {
        try {
            return v.toDate().toISOString();
        } catch {
            return "";
        }
    }
    return "";
}

function normalizeMessageRole_(m) {
    const r = trim_(m && m.role).toLowerCase();
    if (r === "user" || r === "visitor" || r === "customer") return "visitor";
    if (r === "agent" || r === "human" || r === "staff") return "agent";
    if (r === "system") return "system";
    if (r === "internal") return "internal";
    return r || "visitor";
}

function serializeFirestoreConversation_(id, data) {
    const d = data || {};
    const status = typeof d.status === "string" ? d.status : "waiting";
    let humanMode = typeof d.humanMode === "string" ? d.humanMode : "";
    if (!humanMode) {
        if (status === "waiting") humanMode = "waiting";
        else if (status === "active") humanMode = "human";
        else humanMode = "ai";
    }
    return {
        sessionId: id,
        status,
        humanMode,
        aiEnabled: typeof d.aiEnabled === "boolean" ? d.aiEnabled : status !== "waiting" && status !== "active",
        botid: typeof d.botid === "string" ? d.botid : "default",
        visitorName: trim_(d.visitorName),
        assignedAgentEmail: trim_(d.assignedAgentEmail),
        acceptedByEmail: trim_(d.acceptedByEmail),
        departmentId: typeof d.departmentId === "string" ? d.departmentId : "general",
        departmentName: typeof d.departmentName === "string" ? d.departmentName : "General",
        currentAssigneeEmail: trim_(d.currentAssigneeEmail),
        requestedAt: tsToIso_(d.requestedAt),
        createdAt: tsToIso_(d.createdAt),
        claimedAt: tsToIso_(d.claimedAt),
        acceptedAt: tsToIso_(d.acceptedAt || d.claimedAt),
        closedAt: tsToIso_(d.closedAt),
        lastMessageAt: tsToIso_(d.lastMessageAt),
        updatedAt: tsToIso_(d.updatedAt),
        sheet2Row: typeof d.sheet2Row === "number" ? d.sheet2Row : Number(d.sheet2Row) || 0,
        sheetVisitorQueryLines: Array.isArray(d.sheetVisitorQueryLines)
            ? d.sheetVisitorQueryLines
                  .map((line) => (typeof line === "string" ? line.trim() : String(line ?? "").trim()))
                  .filter(Boolean)
            : []
    };
}

function serializeFirestoreMessage_(id, data) {
    const d = data || {};
    return {
        id,
        role: normalizeMessageRole_(d),
        text: typeof d.text === "string" ? d.text : "",
        senderEmail: trim_(d.senderEmail),
        senderDisplayName: trim_(d.senderDisplayName),
        createdAt: tsToIso_(d.createdAt)
    };
}

async function loadMessagesForSession_(convRef, limit = 300) {
    const lim = Math.min(Math.max(limit, 1), 500);
    try {
        const snap = await convRef
            .collection("messages")
            .orderBy("createdAt", "asc")
            .limit(lim)
            .get();
        return snap.docs.map((doc) => serializeFirestoreMessage_(doc.id, doc.data()));
    } catch (err) {
        console.warn(LOG_TAG, "messages orderBy fallback:", err.message || err);
        const snap = await convRef.collection("messages").limit(lim).get();
        return snap.docs
            .map((doc) => serializeFirestoreMessage_(doc.id, doc.data()))
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
}

function mergeWidgetMetaFromContext_(sheetMeta, cx) {
    if (!cx || typeof cx !== "object") {
        return sheetMeta;
    }
    const sp =
        cx.session_params && typeof cx.session_params === "object" && !Array.isArray(cx.session_params)
            ? /** @type {Record<string, unknown>} */ (cx.session_params)
            : {};
    const pick = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const k = keys[i];
            const v = cx[k] != null && String(cx[k]).trim() !== "" ? String(cx[k]).trim() : "";
            if (v) return v;
            const sv = sp[k] != null && String(sp[k]).trim() !== "" ? String(sp[k]).trim() : "";
            if (sv) return sv;
        }
        return "";
    };
    return {
        ...sheetMeta,
        name: pick("name", "visitor_name") || sheetMeta.name,
        email: pick("email") || sheetMeta.email,
        mobile: pick("mobile", "phone") || sheetMeta.mobile,
        dial_code: pick("dial_code", "dialCode", "country_dial_code") || sheetMeta.dial_code,
        phone: pick("mobile", "phone") || sheetMeta.phone,
        channel: pick("channel") || sheetMeta.channel || "Web",
        sourceUrl: pick("sourceUrl", "source_url", "pageUrl", "page_url", "url") || sheetMeta.sourceUrl,
        device: pick("device", "device_type", "deviceType") || sheetMeta.device,
        browser: pick("browser", "browser_name", "browserName") || sheetMeta.browser,
        os: pick("os", "os_name", "osName") || sheetMeta.os,
        city: pick("city", "user_city", "visitor_city") || sheetMeta.city,
        ip: pick("ip", "ipAddress", "ip_address") || sheetMeta.ip,
        utm_campaign: pick("utm_campaign", "utmCampaign") || sheetMeta.utm_campaign,
        utm_content: pick("utm_content", "utmContent") || sheetMeta.utm_content,
        utm_medium: pick("utm_medium", "utmMedium") || sheetMeta.utm_medium,
        utm_source: pick("utm_source", "utmSource") || sheetMeta.utm_source,
        utm_term: pick("utm_term", "utmTerm") || sheetMeta.utm_term,
        rating: pick("rating", "feedbackRating", "feedback_rating") || sheetMeta.rating,
        feedback: pick("feedback", "feedbackMessage", "feedback_message", "message") || sheetMeta.feedback,
        fallback: pick("fallback", "fallBack", "fallback_message_count", "fallbackMessageCount")
            || sheetMeta.fallback,
        crmPushStatus: pick("crmPushStatus", "crm_push_status") || sheetMeta.crmPushStatus,
    };
}

async function enrichSessionForSheet_(base) {
    const settings = await getLiveAgentSettings_().catch(() => null);
    const agentEmail =
        trim_(base.acceptedByEmail) ||
        trim_(base.assignedAgentEmail) ||
        trim_(base.currentAssigneeEmail);
    const assignedAgentDisplayName = agentEmail
        ? resolveAgentDisplayName_(agentEmail, settings)
        : "";
    let sheetMeta = {
        name: base.visitorName || "",
        email: "",
        mobile: "",
        dial_code: "",
        phone: ""
    };
    try {
        const ctx = await getVisitorContext_(base.sessionId, {
            conversation: { visitorName: base.visitorName }
        });
        if (ctx) {
            sheetMeta = {
                name: trim_(ctx.name) || sheetMeta.name,
                email: trim_(ctx.email),
                mobile: trim_(ctx.mobile),
                dial_code: trim_(ctx.dial_code || ctx.dialCode || ctx.country_dial_code),
                phone: trim_(ctx.mobile)
            };
        }
    } catch (ctxErr) {
        console.warn(LOG_TAG, "visitor context:", ctxErr.message || ctxErr);
    }
    /** @type {string[]} */
    let widgetUserQueries = [];
    let transcriptCx = null;
    try {
        transcriptCx = await fetchSessionChatTranscriptContext(base.sessionId);
        if (transcriptCx && Array.isArray(transcriptCx.user_queries)) {
            for (let i = 0; i < transcriptCx.user_queries.length; i += 1) {
                const line = transcriptCx.user_queries[i];
                if (typeof line === "string" && line.trim()) {
                    widgetUserQueries.push(line.trim());
                }
            }
        }
    } catch (uqErr) {
        console.warn(LOG_TAG, "widget user_queries:", uqErr.message || uqErr);
    }
    sheetMeta = mergeWidgetMetaFromContext_(sheetMeta, transcriptCx);
    try {
        const lead = await fetchLatestContactSubmissionForClientSession(base.sessionId);
        const leadCx =
            lead && lead.client_context && typeof lead.client_context === "object"
                ? /** @type {Record<string, unknown>} */ (lead.client_context)
                : null;
        const leadUq = leadCx && Array.isArray(leadCx.user_queries) ? leadCx.user_queries : [];
        /** @type {Set<string>} */
        const seenUq = new Set(widgetUserQueries.map((line) => line.toLowerCase()));
        for (let i = 0; i < leadUq.length; i += 1) {
            const line = typeof leadUq[i] === "string" ? leadUq[i].trim() : "";
            if (!line) continue;
            const key = line.toLowerCase();
            if (seenUq.has(key)) continue;
            seenUq.add(key);
            widgetUserQueries.push(line);
        }
    } catch (leadErr) {
        console.warn(LOG_TAG, "lead user_queries:", leadErr.message || leadErr);
    }
    return {
        ...base,
        assignedAgentDisplayName,
        _sheetMeta: sheetMeta,
        _widgetUserQueries: widgetUserQueries.length ? widgetUserQueries : undefined,
        messages: base.messages || []
    };
}

/**
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function loadSessionForLiveAgentSheet(sessionId) {
    const id = trim_(sessionId);
    if (!id) return null;
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const base = serializeFirestoreConversation_(snap.id, snap.data());
    base.messages = await loadMessagesForSession_(ref);
    return enrichSessionForSheet_(base);
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listSessionsForLiveAgentSheet(opts = {}) {
    const lim = Math.min(Math.max(Number(opts.limit) || 500, 1), 1000);
    const db = firestoreDb_();
    const col = db.collection(conversationsCollection_());
    let snap;
    try {
        snap = await col.orderBy("lastMessageAt", "desc").limit(lim * 2).get();
    } catch (orderErr) {
        console.warn(LOG_TAG, "list orderBy fallback:", orderErr.message || orderErr);
        snap = await col.limit(lim * 2).get();
    }

    const settings = await getLiveAgentSettings_().catch(() => null);
    /** @type {object[]} */
    const out = [];
    for (const doc of snap.docs) {
        const base = serializeFirestoreConversation_(doc.id, doc.data());
        if (!base.requestedAt && !base.createdAt) continue;
        if (!base.requestedAt && base.status === "closed" && base.humanMode === "ai") continue;
        base.assignedAgentDisplayName = base.acceptedByEmail || base.assignedAgentEmail
            ? resolveAgentDisplayName_(
                  trim_(base.acceptedByEmail) || trim_(base.assignedAgentEmail),
                  settings
              )
            : "";
        base.messages = [];
        base._sheetMeta = { name: base.visitorName || "", email: "", mobile: "", phone: "" };
        out.push(base);
        if (out.length >= lim) break;
    }
    return out;
}

/**
 * @param {string} sessionId
 * @param {number} rowNum
 */
export async function persistSheet2Row_(sessionId, rowNum) {
    const id = trim_(sessionId);
    const row = Number(rowNum);
    if (!id || !(row >= 2)) return;
    try {
        const db = firestoreDb_();
        await db.collection(conversationsCollection_()).doc(id).set({ sheet2Row: row }, { merge: true });
    } catch (err) {
        console.warn(LOG_TAG, "persist sheet2Row:", err.message || err);
    }
}

/**
 * Load full session (with messages + meta) for a single sync job.
 * @param {string} sessionId
 */
export async function hydrateSessionForSheetSync_(sessionId) {
    return loadSessionForLiveAgentSheet(sessionId);
}
