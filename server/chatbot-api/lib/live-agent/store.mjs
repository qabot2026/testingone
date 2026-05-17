/**
 * Firestore persistence for live human-agent conversations.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";

const LOG_TAG = "[live-agent/store]";

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

function safeConversationId_(id) {
    const s = trim_(id);
    if (!s || s.length > 128 || !/^[A-Za-z0-9._-]+$/.test(s)) {
        throw new Error("Invalid conversation id");
    }
    return s;
}

function botIdOrDefault_(v) {
    const s = trim_(v) || "default";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return "default";
    return s;
}

function tsToIso_(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return null;
}

function serializeConversation_(id, data) {
    const d = data || {};
    const status = typeof d.status === "string" ? d.status : "waiting";
    let humanMode = typeof d.humanMode === "string" ? d.humanMode : "";
    if (!humanMode) {
        if (status === "waiting") humanMode = "waiting";
        else if (status === "active") humanMode = "human";
        else if (status === "closed") humanMode = "ai";
        else humanMode = "ai";
    }
    let aiEnabled = d.aiEnabled;
    if (typeof aiEnabled !== "boolean") {
        aiEnabled = status !== "waiting" && status !== "active";
    }
    return {
        id,
        status,
        humanMode,
        aiEnabled,
        botid: typeof d.botid === "string" ? d.botid : "default",
        visitorName: typeof d.visitorName === "string" ? d.visitorName : "",
        assignedAgentEmail: typeof d.assignedAgentEmail === "string" ? d.assignedAgentEmail : "",
        lastMessagePreview: typeof d.lastMessagePreview === "string" ? d.lastMessagePreview : "",
        unreadForAgent: typeof d.unreadForAgent === "number" ? d.unreadForAgent : 0,
        unreadForVisitor: typeof d.unreadForVisitor === "number" ? d.unreadForVisitor : 0,
        requestedAt: tsToIso_(d.requestedAt),
        claimedAt: tsToIso_(d.claimedAt),
        closedAt: tsToIso_(d.closedAt),
        lastMessageAt: tsToIso_(d.lastMessageAt)
    };
}

function serializeMessage_(id, data) {
    const d = data || {};
    return {
        id,
        role: typeof d.role === "string" ? d.role : "visitor",
        text: typeof d.text === "string" ? d.text : "",
        senderEmail: typeof d.senderEmail === "string" ? d.senderEmail : "",
        createdAt: tsToIso_(d.createdAt)
    };
}

export function liveAgentFirestoreReady_() {
    try {
        firebaseAdminInit();
        return true;
    } catch {
        return false;
    }
}

/**
 * Visitor requests a human agent (idempotent while waiting/active).
 */
export async function requestHumanAgent_({ conversationId, botid, visitorName, initialMessage }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    let created = false;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            const cur = snap.data() || {};
            if (cur.status === "closed") {
                tx.set(ref, {
                    status: "waiting",
                    humanMode: "waiting",
                    aiEnabled: false,
                    botid: botIdOrDefault_(botid),
                    visitorName: trim_(visitorName) || cur.visitorName || "",
                    assignedAgentEmail: "",
                    requestedAt: now,
                    claimedAt: null,
                    closedAt: null,
                    closedBy: "",
                    lastMessageAt: now,
                    lastMessagePreview: "",
                    unreadForAgent: 0,
                    unreadForVisitor: 0
                }, { merge: true });
                created = true;
            }
            return;
        }
        tx.set(ref, {
            status: "waiting",
            humanMode: "waiting",
            aiEnabled: false,
            botid: botIdOrDefault_(botid),
            visitorName: trim_(visitorName),
            assignedAgentEmail: "",
            requestedAt: now,
            claimedAt: null,
            closedAt: null,
            closedBy: "",
            lastMessageAt: now,
            lastMessagePreview: "",
            unreadForAgent: 0,
            unreadForVisitor: 0
        });
        created = true;
    });

    const preview = trim_(initialMessage);
    if (preview) {
        await appendMessage_({
            conversationId: id,
            role: "visitor",
            text: preview,
            senderEmail: "",
            bumpUnread: { agent: 1, visitor: 0 }
        });
    }

    const snap = await ref.get();
    return { conversation: serializeConversation_(id, snap.data()), reopened: created };
}

export async function getConversation_(conversationId) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const snap = await db.collection(conversationsCollection_()).doc(id).get();
    if (!snap.exists) return null;
    return serializeConversation_(id, snap.data());
}

export async function listInbox_({ status, agentEmail, limit }) {
    const db = firestoreDb_();
    const col = db.collection(conversationsCollection_());
    const lim = Math.min(Math.max(limit || 50, 1), 100);
    const st = trim_(status).toLowerCase();
    const email = trim_(agentEmail).toLowerCase();

    // Single-field orderBy avoids composite Firestore indexes for MVP.
    const fetchN = Math.min(lim * 4, 200);
    const snap = await col.orderBy("lastMessageAt", "desc").limit(fetchN).get();
    let rows = snap.docs.map((doc) => serializeConversation_(doc.id, doc.data()));

    if (st === "waiting") {
        rows = rows.filter((r) => r.status === "waiting");
        rows.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    } else if (st === "active") {
        rows = rows.filter((r) => r.status === "active");
    } else if (st === "mine" && email) {
        rows = rows.filter((r) => r.status === "active" && r.assignedAgentEmail === email);
    } else if (st === "closed") {
        rows = rows.filter((r) => r.status === "closed");
    } else {
        rows = rows.filter((r) => r.status !== "closed");
    }

    return rows.slice(0, lim);
}

export async function claimConversation_({ conversationId, agentEmail }) {
    const id = safeConversationId_(conversationId);
    const email = trim_(agentEmail).toLowerCase();
    if (!email) throw new Error("Agent email required");

    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "closed") throw new Error("Conversation is closed");
        if (cur.status === "active" && cur.assignedAgentEmail && cur.assignedAgentEmail !== email) {
            throw new Error("Already assigned to another agent");
        }
        tx.update(ref, {
            status: "active",
            humanMode: "human",
            aiEnabled: false,
            assignedAgentEmail: email,
            claimedAt: cur.claimedAt || now,
            unreadForAgent: 0
        });
    });

    await appendMessage_({
        conversationId: id,
        role: "system",
        text: `Agent ${email} joined the chat.`,
        senderEmail: email,
        bumpUnread: { agent: 0, visitor: 1 }
    });

    const snap = await ref.get();
    return serializeConversation_(id, snap.data());
}

export async function closeConversation_({ conversationId, closedBy, agentEmail }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "active" && cur.assignedAgentEmail && agentEmail) {
            if (cur.assignedAgentEmail !== agentEmail.toLowerCase()) {
                throw new Error("Only the assigned agent can close this chat");
            }
        }
        tx.update(ref, {
            status: "closed",
            humanMode: "ai",
            aiEnabled: true,
            closedAt: now,
            closedBy: trim_(closedBy) || "agent"
        });
    });

    await appendMessage_({
        conversationId: id,
        role: "system",
        text: "This chat has ended. You can request a human agent again if needed.",
        senderEmail: agentEmail || "",
        bumpUnread: { agent: 0, visitor: 1 }
    });

    const snap = await ref.get();
    return serializeConversation_(id, snap.data());
}

export async function appendMessage_({
    conversationId,
    role,
    text,
    senderEmail,
    bumpUnread
}) {
    const id = safeConversationId_(conversationId);
    const body = trim_(text);
    if (!body) throw new Error("Message text required");

    const db = firestoreDb_();
    const convRef = db.collection(conversationsCollection_()).doc(id);
    const msgRef = convRef.collection("messages").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(convRef);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "closed") throw new Error("Conversation is closed");

        tx.set(msgRef, {
            role: role || "visitor",
            text: body,
            senderEmail: trim_(senderEmail),
            createdAt: now
        });

        const agentBump = bumpUnread && bumpUnread.agent ? bumpUnread.agent : 0;
        const visitorBump = bumpUnread && bumpUnread.visitor ? bumpUnread.visitor : 0;

        tx.update(convRef, {
            lastMessageAt: now,
            lastMessagePreview: body.slice(0, 240),
            unreadForAgent: (cur.unreadForAgent || 0) + agentBump,
            unreadForVisitor: (cur.unreadForVisitor || 0) + visitorBump
        });
    });

    const snap = await msgRef.get();
    return serializeMessage_(msgRef.id, snap.data());
}

export async function listMessages_({ conversationId, sinceIso, limit, markReadFor }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const convRef = db.collection(conversationsCollection_()).doc(id);
    const lim = Math.min(Math.max(limit || 100, 1), 200);

    let q = convRef.collection("messages").orderBy("createdAt", "asc");
    if (sinceIso) {
        const since = new Date(sinceIso);
        if (!Number.isNaN(since.getTime())) {
            q = convRef.collection("messages").where("createdAt", ">", since).orderBy("createdAt", "asc");
        }
    }

    const snap = await q.limit(lim).get();
    const messages = snap.docs.map((doc) => serializeMessage_(doc.id, doc.data()));

    if (markReadFor === "agent") {
        await convRef.update({ unreadForAgent: 0 });
    } else if (markReadFor === "visitor") {
        await convRef.update({ unreadForVisitor: 0 });
    }

    return messages;
}

/**
 * Agent toggles AI vs human handling for the visitor widget (poll via /status).
 * @param {{ conversationId: string, aiEnabled?: boolean, humanMode?: string }} opts
 */
export async function updateConversationMode_({ conversationId, aiEnabled, humanMode }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error("Conversation not found");
    }
    const cur = snap.data() || {};
    if (cur.status === "closed") {
        throw new Error("Conversation is closed");
    }
    /** @type {Record<string, unknown>} */
    const patch = {};
    if (typeof aiEnabled === "boolean") {
        patch.aiEnabled = aiEnabled;
    }
    const hm = trim_(humanMode).toLowerCase();
    if (hm === "ai" || hm === "human" || hm === "waiting") {
        patch.humanMode = hm;
        if (hm === "ai") {
            patch.aiEnabled = true;
        } else if (hm === "human" || hm === "waiting") {
            patch.aiEnabled = false;
        }
    }
    if (!Object.keys(patch).length) {
        throw new Error("Nothing to update");
    }
    await ref.update(patch);
    const next = await ref.get();
    return serializeConversation_(id, next.data());
}

export function logStoreError_(err, context) {
    const msg = err && err.message ? err.message : String(err);
    console.error(LOG_TAG, context, msg);
}
