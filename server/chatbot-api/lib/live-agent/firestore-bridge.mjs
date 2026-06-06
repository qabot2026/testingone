/**
 * Firestore bridge for refer-staff live-agent sheet sync (CJS live-agent-store.js).
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

import { firebaseAdminInit } from "../firebase-admin-init.mjs";
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
        sheet2Row: typeof d.sheet2Row === "number" ? d.sheet2Row : Number(d.sheet2Row) || 0
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

async function enrichSessionForSheet_(base) {
    const settings = await getLiveAgentSettings_().catch(() => null);
    const assignedAgentDisplayName = base.assignedAgentEmail
        ? resolveAgentDisplayName_(base.assignedAgentEmail, settings)
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
                dial_code: "",
                phone: trim_(ctx.mobile)
            };
        }
    } catch (ctxErr) {
        console.warn(LOG_TAG, "visitor context:", ctxErr.message || ctxErr);
    }
    return {
        ...base,
        assignedAgentDisplayName,
        _sheetMeta: sheetMeta,
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
        base.assignedAgentDisplayName = base.assignedAgentEmail
            ? resolveAgentDisplayName_(base.assignedAgentEmail, settings)
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
