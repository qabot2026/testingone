/**
 * Firestore persistence for live human-agent conversations.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { isPlausibleVisitorDisplayName_, sanitizeVisitorNameForStorage_ } from "./visitor-name.mjs";

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
    let s = trim_(id);
    if (!s) {
        throw new Error("Invalid conversation id");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(s)) {
        s = s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    }
    if (!s || s.length > 128) {
        throw new Error("Invalid conversation id");
    }
    return s;
}

/** Same id normalization as Firestore writes (use on all agent API routes). */
export function resolveConversationId_(raw) {
    return safeConversationId_(raw);
}

/** Debounced Google Sheet row sync for the Live Agent tab (mirrors bot Sheet1 scheduleSheetSync). */
function scheduleLiveAgentHandoffSheetSync_(conversationId) {
    const id = trim_(conversationId);
    if (!id) {
        return;
    }
    void import("./live-agent-sheet-sync.mjs")
        .then((mod) => {
            if (mod && typeof mod.scheduleLiveAgentHandoffSheetSync_ === "function") {
                mod.scheduleLiveAgentHandoffSheetSync_(id);
            }
        })
        .catch((err) => {
            console.warn(LOG_TAG, "live-agent sheet schedule:", err.message || err);
        });
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
        visitorName: isPlausibleVisitorDisplayName_(typeof d.visitorName === "string" ? d.visitorName : "")
            ? trim_(d.visitorName)
            : "",
        assignedAgentEmail: typeof d.assignedAgentEmail === "string" ? d.assignedAgentEmail : "",
        departmentId: typeof d.departmentId === "string" ? d.departmentId : "general",
        departmentName: typeof d.departmentName === "string" ? d.departmentName : "General Department",
        currentAssigneeEmail: typeof d.currentAssigneeEmail === "string" ? d.currentAssigneeEmail : "",
        assigneeRoundIndex: typeof d.assigneeRoundIndex === "number" ? d.assigneeRoundIndex : 0,
        assigneeAssignedAt: tsToIso_(d.assigneeAssignedAt),
        visitorSessionActive: d.visitorSessionActive !== false,
        lastMessagePreview: typeof d.lastMessagePreview === "string" ? d.lastMessagePreview : "",
        unreadForAgent: typeof d.unreadForAgent === "number" ? d.unreadForAgent : 0,
        unreadForVisitor: typeof d.unreadForVisitor === "number" ? d.unreadForVisitor : 0,
        requestedAt: tsToIso_(d.requestedAt),
        claimedAt: tsToIso_(d.claimedAt),
        acceptedAt: tsToIso_(d.acceptedAt || d.claimedAt),
        acceptedByEmail:
            typeof d.acceptedByEmail === "string"
                ? d.acceptedByEmail
                : typeof d.assignedAgentEmail === "string"
                  ? d.assignedAgentEmail
                  : "",
        closedAt: tsToIso_(d.closedAt),
        closedByEmail: typeof d.closedByEmail === "string" ? d.closedByEmail : "",
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
        senderDisplayName:
            typeof d.senderDisplayName === "string" ? trim_(d.senderDisplayName) : "",
        createdAt: tsToIso_(d.createdAt)
    };
}

export function clearInboxSettingsCache_() {
    inboxSettingsCache_ = null;
    inboxSettingsCacheAt_ = 0;
}

/** Call after settings are saved so accept/inbox read fresh agent profiles. */
export async function refreshDeskSettingsCache_() {
    clearInboxSettingsCache_();
    try {
        return await inboxDeskSettings_(false);
    } catch {
        return null;
    }
}

async function enrichMessagesWithAgentNames_(messages, options = {}) {
    if (!messages.length) {
        return messages;
    }
    const audience = options.audience === "agent" ? "agent" : "visitor";
    const visitorDisplayName = trim_(options.visitorDisplayName);
    const viewingAgentEmail = trim_(options.viewingAgentEmail);
    const assignedAgentEmail = trim_(options.assignedAgentEmail);
    try {
        const {
            resolveAgentDisplayName_,
            formatSystemMessageTextForVisitor_,
            formatSystemMessageTextForAgent_
        } = await import("./departments.mjs");
        const settings = await cachedLiveAgentSettings_();
        return messages.map((m) => {
            const role = trim_(m.role).toLowerCase();
            if (role === "agent" || role === "staff") {
                return {
                    ...m,
                    senderDisplayName: resolveAgentDisplayName_(m.senderEmail, settings)
                };
            }
            if (role === "system") {
                const text =
                    audience === "agent"
                        ? formatSystemMessageTextForAgent_(
                              m.text,
                              visitorDisplayName,
                              m,
                              viewingAgentEmail,
                              settings,
                              assignedAgentEmail
                          )
                        : formatSystemMessageTextForVisitor_(
                              m.text,
                              settings,
                              m.senderEmail,
                              assignedAgentEmail
                          );
                return {
                    ...m,
                    text
                };
            }
            return m;
        });
    } catch (err) {
        console.warn(LOG_TAG, "enrich agent names:", err.message || err);
        return messages;
    }
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
export async function requestHumanAgent_({
    conversationId,
    botid,
    visitorName,
    initialMessage,
    departmentId
}) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    let created = false;
    let alreadyQueued = false;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            const cur = snap.data() || {};
            if (cur.status === "closed") {
                tx.set(ref, {
                    status: "waiting",
                    humanMode: "waiting",
                    aiEnabled: true,
                    botid: botIdOrDefault_(botid),
                    visitorName:
                        sanitizeVisitorNameForStorage_(visitorName)
                        || (isPlausibleVisitorDisplayName_(cur.visitorName) ? cur.visitorName : "")
                        || "",
                    assignedAgentEmail: "",
                    departmentId: trim_(departmentId) || cur.departmentId || "general",
                    currentAssigneeEmail: "",
                    requestedAt: now,
                    claimedAt: null,
                    closedAt: null,
                    closedBy: "",
                    lastMessageAt: now,
                    lastMessagePreview: "",
                    unreadForAgent: 0,
                    unreadForVisitor: 0,
                    visitorSessionActive: true
                }, { merge: true });
                created = true;
            } else if (cur.status === "waiting" || cur.status === "active") {
                alreadyQueued = true;
                const patch = {};
                const vn = sanitizeVisitorNameForStorage_(visitorName);
                if (vn && vn !== cur.visitorName) {
                    patch.visitorName = vn;
                }
                if (Object.keys(patch).length) {
                    tx.update(ref, patch);
                }
            }
            return;
        }
        tx.set(ref, {
            status: "waiting",
            humanMode: "waiting",
            aiEnabled: true,
            botid: botIdOrDefault_(botid),
            visitorName: sanitizeVisitorNameForStorage_(visitorName),
            assignedAgentEmail: "",
            departmentId: trim_(departmentId) || "general",
            currentAssigneeEmail: "",
            requestedAt: now,
            claimedAt: null,
            closedAt: null,
            closedBy: "",
            lastMessageAt: now,
            lastMessagePreview: "",
            unreadForAgent: 0,
            unreadForVisitor: 0,
            visitorSessionActive: true
        });
        created = true;
    });

    if (alreadyQueued && !created) {
        const snap = await ref.get();
        return {
            conversation: serializeConversation_(id, snap.data()),
            reopened: false,
            alreadyActive: true
        };
    }

    const preview = trim_(initialMessage);
    if (preview && created) {
        await appendMessage_({
            conversationId: id,
            role: "visitor",
            text: preview,
            senderEmail: "",
            bumpUnread: { agent: 1, visitor: 0 }
        });
    }

    const { applyInitialRoundRobin_ } = await import("./routing.mjs");
    const { syncLiveAgentToSheet_ } = await import("./sheet-sync.mjs");
    let conversation;
    conversation = await applyInitialRoundRobin_(id, departmentId);
    try {
        await syncLiveAgentToSheet_(id);
    } catch (_) {
        /* non-fatal */
    }
    scheduleLiveAgentHandoffSheetSync_(id);
    return { conversation, reopened: created, alreadyActive: false };
}

export async function getConversation_(conversationId) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const snap = await db.collection(conversationsCollection_()).doc(id).get();
    if (!snap.exists) return null;
    return serializeConversation_(id, snap.data());
}

let inboxSettingsCache_ = null;
let inboxSettingsCacheAt_ = 0;

async function inboxDeskSettings_(skipEscalation) {
    const now = Date.now();
    if (skipEscalation && inboxSettingsCache_ && now - inboxSettingsCacheAt_ < 90000) {
        return inboxSettingsCache_;
    }
    const { getLiveAgentSettings_ } = await import("./departments.mjs");
    const deskSettings = await getLiveAgentSettings_();
    if (skipEscalation) {
        inboxSettingsCache_ = deskSettings;
        inboxSettingsCacheAt_ = now;
    }
    return deskSettings;
}

/** Cached settings for hot paths (every message / poll) — avoids extra Firestore reads. */
async function cachedLiveAgentSettings_() {
    return inboxDeskSettings_(true);
}

export async function listInbox_({ status, agentEmail, limit, skipEscalation }) {
    const db = firestoreDb_();
    const col = db.collection(conversationsCollection_());
    const lim = Math.min(Math.max(limit || 50, 1), 100);
    const st = trim_(status).toLowerCase();
    const email = trim_(agentEmail).toLowerCase();

    // Single-field orderBy avoids composite Firestore indexes for MVP.
    const fetchN = skipEscalation ? Math.min(lim * 2, 80) : Math.min(lim * 4, 200);
    let snap;
    try {
        snap = await col.orderBy("lastMessageAt", "desc").limit(fetchN).get();
    } catch (orderErr) {
        console.warn(LOG_TAG, "inbox orderBy fallback:", orderErr.message || orderErr);
        snap = await col.limit(fetchN).get();
    }
    let rows = snap.docs.map((doc) => serializeConversation_(doc.id, doc.data()));

    if (st === "waiting") {
        rows = rows.filter((r) => r.status === "waiting");
        rows.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    } else if (st === "active") {
        rows = rows.filter((r) => r.status === "active");
    } else if (st === "mine" && email) {
        rows = rows.filter(
            (r) =>
                (r.status === "active" && r.assignedAgentEmail === email) ||
                (r.status === "waiting" && r.currentAssigneeEmail === email)
        );
    } else if (st === "closed") {
        rows = rows.filter((r) => r.status === "closed");
    } else if (st === "assigned") {
        rows = rows.filter(
            (r) =>
                r.status !== "closed" &&
                (trim_(r.assignedAgentEmail) || trim_(r.currentAssigneeEmail))
        );
    } else if (st === "unassigned") {
        rows = rows.filter(
            (r) => r.status === "waiting" && !trim_(r.currentAssigneeEmail) && !trim_(r.assignedAgentEmail)
        );
    } else if (st === "ai") {
        rows = rows.filter(
            (r) =>
                r.status !== "closed" &&
                r.aiEnabled !== false &&
                (r.humanMode || "ai") !== "human" &&
                r.status !== "active"
        );
    } else if (st === "agent" || st === "agent_chats") {
        rows = rows.filter(
            (r) =>
                r.status !== "closed" &&
                (r.humanMode === "human" || (r.status === "active" && trim_(r.assignedAgentEmail)))
        );
    } else {
        rows = rows.filter((r) => r.status !== "closed");
    }

    const deskSettings = await inboxDeskSettings_(Boolean(skipEscalation));
    if (deskSettings.general.sortChatsByLastMessage) {
        rows.sort((a, b) =>
            String(b.lastMessageAt || b.requestedAt || "").localeCompare(
                String(a.lastMessageAt || a.requestedAt || "")
            )
        );
    } else if (st !== "waiting") {
        rows.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    }

    if (!skipEscalation) {
        const { processWaitingEscalations_ } = await import("./routing.mjs");
        rows = await processWaitingEscalations_(rows);
    }
    return rows.slice(0, lim);
}

export async function countActiveConversationsForAgent_(agentEmail) {
    const email = trim_(agentEmail).toLowerCase();
    if (!email) return 0;
    const db = firestoreDb_();
    const col = db.collection(conversationsCollection_());
    let snap;
    try {
        snap = await col.where("status", "==", "active").limit(80).get();
    } catch (_) {
        snap = await col.limit(120).get();
    }
    return snap.docs.filter((doc) => {
        const d = doc.data() || {};
        return d.status === "active" && trim_(d.assignedAgentEmail).toLowerCase() === email;
    }).length;
}

/** Accept (claim) a waiting chat for the logged-in agent. */
export async function claimConversation_({ conversationId, agentEmail }) {
    const id = safeConversationId_(conversationId);
    const email = trim_(agentEmail).toLowerCase();
    if (!email) throw new Error("Agent email required");
    if (!email.includes("@")) {
        throw new Error(
            "Use your work email on the login screen (e.g. you@company.com) to accept chats."
        );
    }

    clearInboxSettingsCache_();
    let max = 2;
    try {
        const { getLiveAgentSettings_ } = await import("./departments.mjs");
        const settings = await getLiveAgentSettings_();
        max =
            settings && settings.routing && settings.routing.maxConcurrentChats
                ? settings.routing.maxConcurrentChats
                : 2;
    } catch (settingsErr) {
        console.warn(LOG_TAG, "accept settings load:", settingsErr.message || settingsErr);
    }
    const activeCount = await countActiveConversationsForAgent_(email);
    if (activeCount >= max) {
        throw new Error(
            "You already have " + activeCount + " active chat(s). Maximum allowed is " + max + "."
        );
    }

    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        const st = typeof cur.status === "string" ? cur.status : "waiting";
        if (st === "closed") throw new Error("Conversation is closed");
        const assigned = trim_(cur.assignedAgentEmail).toLowerCase();
        if (st === "active" && assigned && assigned !== email) {
            throw new Error("Already assigned to another agent");
        }
        if (st !== "waiting" && st !== "active") {
            throw new Error("Conversation is not available to accept");
        }
        tx.update(ref, {
            status: "active",
            humanMode: "human",
            aiEnabled: false,
            assignedAgentEmail: email,
            currentAssigneeEmail: email,
            claimedAt: cur.claimedAt || now,
            acceptedAt: cur.acceptedAt || now,
            acceptedByEmail: email,
            unreadForAgent: 0,
            visitorSessionActive: true,
            deskRevision: admin.firestore.FieldValue.increment(1)
        });
    });

    try {
        const { LIVE_AGENT_HUMAN_CONNECTED_MARKER_ } = await import("./departments.mjs");
        await appendMessage_({
            conversationId: id,
            role: "system",
            text: LIVE_AGENT_HUMAN_CONNECTED_MARKER_,
            senderEmail: email,
            bumpUnread: { agent: 0, visitor: 1 }
        });
    } catch (msgErr) {
        console.warn(LOG_TAG, "accept system message:", msgErr.message || msgErr);
    }

    const snap = await ref.get();
    const out = serializeConversation_(id, snap.data());

    void (async () => {
        try {
            const { bumpAgentStats_, touchAgentPresence_ } = await import("./agents.mjs");
            await bumpAgentStats_({
                agentEmail: email,
                kind: "accept",
                conversationId: id,
                visitorName: out.visitorName,
                departmentName: out.departmentName
            });
            await touchAgentPresence_({ agentEmail: email });
        } catch (err) {
            console.warn(LOG_TAG, "agent stats on accept:", err.message || err);
        }
        try {
            const { syncLiveAgentToSheet_ } = await import("./sheet-sync.mjs");
            await syncLiveAgentToSheet_(id);
        } catch (_) {
            /* non-fatal */
        }
        scheduleLiveAgentHandoffSheetSync_(id);
    })();

    return out;
}

export const acceptConversation_ = claimConversation_;

/**
 * Hand active chat to another registered agent (current assignee only).
 *
 * @param {{ conversationId: string, fromAgentEmail: string, toAgentEmail: string }} opts
 */
export async function transferConversation_({ conversationId, fromAgentEmail, toAgentEmail }) {
    const id = safeConversationId_(conversationId);
    const from = trim_(fromAgentEmail).toLowerCase();
    const to = trim_(toAgentEmail).toLowerCase();
    if (!from || !from.includes("@")) {
        throw new Error("Your work email is required to transfer a chat");
    }
    if (!to || !to.includes("@")) {
        throw new Error("Select an agent email to transfer to");
    }
    if (from === to) {
        throw new Error("Cannot transfer to yourself");
    }
    const { isAgentEmailRegistered_, resolveAgentDisplayName_, getLiveAgentSettings_ } = await import(
        "./departments.mjs"
    );
    if (!(await isAgentEmailRegistered_(to))) {
        throw new Error("That agent is not registered in Live Agent Settings");
    }
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new Error("Conversation not found");
        }
        const cur = snap.data() || {};
        if (cur.status === "closed") {
            throw new Error("Conversation is closed");
        }
        if (cur.status !== "active") {
            throw new Error("Only active chats can be transferred");
        }
        const assignee = trim_(cur.assignedAgentEmail).toLowerCase();
        if (assignee && assignee !== from) {
            throw new Error("Only the agent handling this chat can transfer it");
        }
        tx.update(ref, {
            status: "active",
            humanMode: "human",
            aiEnabled: false,
            assignedAgentEmail: to,
            currentAssigneeEmail: to,
            acceptedByEmail: to,
            unreadForAgent: Math.min((cur.unreadForAgent || 0) + 1, 99),
            visitorSessionActive: true
        });
    });
    try {
        const settings = await getLiveAgentSettings_();
        const fromName = resolveAgentDisplayName_(from, settings);
        const toName = resolveAgentDisplayName_(to, settings);
        await appendMessage_({
            conversationId: id,
            role: "system",
            text: fromName + " handed this chat to " + toName + ".",
            senderEmail: from,
            bumpUnread: { agent: 1, visitor: 1 }
        });
    } catch (msgErr) {
        console.warn(LOG_TAG, "transfer system message:", msgErr.message || msgErr);
    }
    const snap = await ref.get();
    return serializeConversation_(id, snap.data());
}

/**
 * Close many open chats whose id starts with idPrefix (e.g. test-). Caps work per call.
 */
export async function bulkCloseTestConversations_({ idPrefix, agentEmail, maxClose }) {
    const prefix = trim_(idPrefix).toLowerCase();
    if (!prefix) throw new Error("idPrefix required");
    const cap = Math.min(Math.max(Number(maxClose) || 100, 1), 200);
    const rows = await listInbox_({ status: "all", agentEmail: "", limit: 200 });
    const targets = rows.filter((r) => {
        const id = String(r.id || "").toLowerCase();
        return id.startsWith(prefix) && (r.status === "waiting" || r.status === "active");
    });
    let closed = 0;
    for (const r of targets.slice(0, cap)) {
        try {
            await closeConversation_({
                conversationId: r.id,
                agentEmail: agentEmail || "",
                closedBy: "bulk-clear"
            });
            closed += 1;
        } catch (err) {
            console.warn(LOG_TAG, "bulk close skip", r.id, err.message);
        }
    }
    return { closed, matched: targets.length, capped: targets.length > cap };
}

/** Put a closed conversation back in the agent queue (waiting). */
export async function reopenConversationForAgent_({ conversationId, agentEmail }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "waiting" || cur.status === "active") {
            return;
        }
        if (cur.status !== "closed") {
            throw new Error("Conversation cannot be reopened");
        }
        tx.set(
            ref,
            {
                status: "waiting",
                humanMode: "waiting",
                aiEnabled: true,
                assignedAgentEmail: "",
                claimedAt: null,
                closedAt: null,
                closedBy: "",
                requestedAt: now,
                lastMessageAt: now,
                unreadForAgent: 1,
                unreadForVisitor: 0
            },
            { merge: true }
        );
    });

    await appendMessage_({
        conversationId: id,
        role: "system",
        text: "Chat reopened — waiting for an agent.",
        senderEmail: "",
        bumpUnread: { agent: 1, visitor: 0 }
    });

    const { applyInitialRoundRobin_ } = await import("./routing.mjs");
    const { syncLiveAgentToSheet_ } = await import("./sheet-sync.mjs");
    await applyInitialRoundRobin_(id, null);
    const out = await getConversation_(id);
    const who = trim_(agentEmail).toLowerCase();
    if (who) {
        try {
            const { bumpAgentStats_ } = await import("./agents.mjs");
            await bumpAgentStats_({
                agentEmail: who,
                kind: "reopen",
                conversationId: id,
                visitorName: out?.visitorName,
                departmentName: out?.departmentName
            });
        } catch (err) {
            console.warn(LOG_TAG, "agent stats on reopen:", err.message || err);
        }
    }
    try {
        await syncLiveAgentToSheet_(id);
    } catch (_) {
        /* non-fatal */
    }
    return out;
}

export async function closeConversation_({ conversationId, closedBy, agentEmail }) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const ref = db.collection(conversationsCollection_()).doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const endText = "This chat has ended. You can request a human agent again if needed.";

    const pre = await ref.get();
    if (!pre.exists) {
        throw new Error("Conversation not found");
    }
    if ((pre.data() || {}).status === "closed") {
        return serializeConversation_(id, pre.data());
    }

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "closed") {
            return;
        }
        if (cur.status === "active" && cur.assignedAgentEmail && agentEmail) {
            if (cur.assignedAgentEmail !== agentEmail.toLowerCase()) {
                throw new Error("Only the assigned agent can close this chat");
            }
        }
        const msgRef = ref.collection("messages").doc();
        tx.set(msgRef, {
            role: "system",
            text: endText,
            senderEmail: trim_(agentEmail),
            createdAt: now
        });
        tx.update(ref, {
            status: "closed",
            humanMode: "ai",
            aiEnabled: true,
            closedAt: now,
            closedBy: trim_(closedBy) || "agent",
            closedByEmail: trim_(agentEmail).toLowerCase(),
            visitorSessionActive: false,
            currentAssigneeEmail: "",
            unreadForAgent: 0,
            lastMessageAt: now,
            lastMessagePreview: endText.slice(0, 240),
            unreadForVisitor: (cur.unreadForVisitor || 0) + 1
        });
    });

    const snap = await ref.get();
    const out = serializeConversation_(id, snap.data());
    const closer = trim_(agentEmail).toLowerCase();
    void (async () => {
        if (closer) {
            try {
                const { bumpAgentStats_ } = await import("./agents.mjs");
                await bumpAgentStats_({
                    agentEmail: closer,
                    kind: "close",
                    conversationId: id,
                    visitorName: out.visitorName,
                    departmentName: out.departmentName
                });
            } catch (err) {
                console.warn(LOG_TAG, "agent stats on close:", err.message || err);
            }
        }
        try {
            const { syncLiveAgentToSheet_ } = await import("./sheet-sync.mjs");
            await syncLiveAgentToSheet_(id);
        } catch (_) {
            /* non-fatal */
        }
        scheduleLiveAgentHandoffSheetSync_(id);
    })();
    return out;
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
    const roleNormEarly = trim_(role).toLowerCase();
    let senderDisplayName = "";
    if (
        roleNormEarly === "agent"
        || roleNormEarly === "staff"
        || (roleNormEarly === "system" && trim_(senderEmail))
    ) {
        const { resolveAgentDisplayName_ } = await import("./departments.mjs");
        const settings = await cachedLiveAgentSettings_();
        senderDisplayName = resolveAgentDisplayName_(senderEmail, settings);
    }

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(convRef);
        if (!snap.exists) throw new Error("Conversation not found");
        const cur = snap.data() || {};
        if (cur.status === "closed") throw new Error("Conversation is closed");

        const roleNorm = trim_(role).toLowerCase();
        if (roleNorm === "agent" || roleNorm === "staff") {
            if (isLiveAgentAiCopilot_(serializeConversation_(id, cur))) {
                throw new Error(
                    "Take over required — chatbot is replying to the visitor. Click Take over on the desk to send as agent."
                );
            }
        }
        if (roleNorm === "visitor" && isLiveAgentAiCopilot_(serializeConversation_(id, cur))) {
            throw new Error("Chatbot is handling this chat — visitor messages go through the bot");
        }

        /** @type {Record<string, unknown>} */
        const msgData = {
            role: role || "visitor",
            text: body,
            senderEmail: trim_(senderEmail),
            createdAt: now
        };
        if (senderDisplayName) {
            msgData.senderDisplayName = senderDisplayName;
        }
        tx.set(msgRef, msgData);

        const agentBump = bumpUnread && bumpUnread.agent ? bumpUnread.agent : 0;
        const visitorBump = bumpUnread && bumpUnread.visitor ? bumpUnread.visitor : 0;

        const nextUnreadAgent =
            agentBump > 0
                ? Math.min((cur.unreadForAgent || 0) + agentBump, 99)
                : cur.unreadForAgent || 0;
        /** @type {Record<string, unknown>} */
        const convPatch = {
            lastMessageAt: now,
            lastMessagePreview: body.slice(0, 240),
            lastMessageId: msgRef.id,
            deskRevision: admin.firestore.FieldValue.increment(1),
            unreadForAgent: nextUnreadAgent,
            unreadForVisitor: (cur.unreadForVisitor || 0) + visitorBump
        };
        if (roleNorm === "agent" || roleNorm === "staff") {
            const agentEmail = trim_(senderEmail).toLowerCase();
            const curHmAgent = trim_(cur.humanMode).toLowerCase();
            const aiCopilotOn =
                cur.status === "active" && curHmAgent === "ai" && cur.aiEnabled !== false;
            convPatch.status = "active";
            convPatch.visitorSessionActive = true;
            if (!aiCopilotOn) {
                convPatch.humanMode = "human";
                convPatch.aiEnabled = false;
            }
            if (agentEmail) {
                if (!trim_(cur.assignedAgentEmail)) {
                    convPatch.assignedAgentEmail = agentEmail;
                    convPatch.currentAssigneeEmail = agentEmail;
                }
                if (!cur.acceptedAt) {
                    convPatch.acceptedAt = now;
                    convPatch.acceptedByEmail = agentEmail;
                }
            }
        } else if (roleNorm === "visitor") {
            const curHm = trim_(cur.humanMode).toLowerCase();
            const aiCopilotActive =
                cur.status === "active" && curHm === "ai" && cur.aiEnabled !== false;
            if (cur.status === "active" && !aiCopilotActive) {
                convPatch.humanMode = "human";
                convPatch.aiEnabled = false;
            } else if (cur.status === "waiting") {
                convPatch.aiEnabled = true;
                convPatch.humanMode = "waiting";
            }
        }
        tx.update(convRef, convPatch);
    });

    const snap = await msgRef.get();
    const out = serializeMessage_(msgRef.id, snap.data());
    scheduleLiveAgentHandoffSheetSync_(id);
    return out;
}

export async function listMessages_({
    conversationId,
    sinceIso,
    limit,
    markReadFor,
    audience,
    viewingAgentEmail
}) {
    const id = safeConversationId_(conversationId);
    const db = firestoreDb_();
    const convRef = db.collection(conversationsCollection_()).doc(id);
    const lim = Math.min(Math.max(limit || 80, 1), 200);

    let messages = [];
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : NaN;
    const useSince = Number.isFinite(sinceMs);
    /** Overlap so equal-timestamp / index fallback never drops the tail of the thread. */
    const sinceCutoff = useSince ? sinceMs - 3000 : 0;

    try {
        const snap = await convRef
            .collection("messages")
            .orderBy("createdAt", "desc")
            .limit(lim)
            .get();
        messages = snap.docs.map((doc) => serializeMessage_(doc.id, doc.data())).reverse();
    } catch (queryErr) {
        console.warn(LOG_TAG, "messages list fallback:", queryErr.message || queryErr);
        const snap = await convRef.collection("messages").limit(lim).get();
        messages = snap.docs
            .map((doc) => serializeMessage_(doc.id, doc.data()))
            .sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return ta - tb;
            });
    }

    if (useSince) {
        messages = messages.filter((m) => {
            const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
            return !t || t > sinceCutoff;
        });
    }

    let visitorDisplayName = "";
    let assignedAgentEmail = "";
    const enrichAudience = audience === "agent" ? "agent" : "visitor";
    const needsConvMeta =
        markReadFor === "agent" || enrichAudience === "agent" || enrichAudience === "visitor";
    if (needsConvMeta) {
        try {
            const convSnap = await convRef.get();
            if (convSnap.exists) {
                const conv = serializeConversation_(id, convSnap.data());
                const { resolveVisitorDisplayName_ } = await import("./visitor-name.mjs");
                visitorDisplayName = resolveVisitorDisplayName_({ visitorName: conv.visitorName });
                assignedAgentEmail = trim_(conv.assignedAgentEmail);
            }
        } catch (nameErr) {
            console.warn(LOG_TAG, "visitor display name for messages:", nameErr.message || nameErr);
        }
    }
    if (markReadFor === "agent") {
        await convRef.update({ unreadForAgent: 0 });
    } else if (markReadFor === "visitor") {
        await convRef.update({ unreadForVisitor: 0 });
    }

    return enrichMessagesWithAgentNames_(messages, {
        audience: enrichAudience,
        visitorDisplayName,
        viewingAgentEmail: enrichAudience === "agent" ? viewingAgentEmail : "",
        assignedAgentEmail
    });
}

/** Active chat where the widget should use Dialogflow, not the agent inbox. */
export function isLiveAgentAiCopilot_(conv) {
    if (!conv || conv.status !== "active") {
        return false;
    }
    return trim_(conv.humanMode).toLowerCase() === "ai" && conv.aiEnabled !== false;
}

/**
 * Agent toggles AI vs human handling for the visitor widget (poll via /status).
 * @param {{ conversationId: string, aiEnabled?: boolean, humanMode?: string }} opts
 */
export async function updateConversationMode_({ conversationId, aiEnabled, humanMode, agentEmail }) {
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
    const wasBotReply = isLiveAgentAiCopilot_(serializeConversation_(id, cur));
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
    const botOn = hm === "ai" || (hm !== "human" && patch.aiEnabled === true);
    if (botOn) {
        patch.visitorTypingText = "";
        patch.visitorTypingAt = "";
        patch.agentTypingText = "";
        patch.agentTypingAt = "";
        patch.deskRevision = admin.firestore.FieldValue.increment(1);
    }
    await ref.update(patch);
    try {
        const {
            LIVE_AGENT_HANDOFF_TO_BOT_MARKER_,
            LIVE_AGENT_HUMAN_REJOINED_MARKER_
        } = await import("./departments.mjs");
        const me = trim_(agentEmail).toLowerCase() || trim_(cur.assignedAgentEmail).toLowerCase();
        if (botOn) {
            await appendMessage_({
                conversationId: id,
                role: "system",
                text: LIVE_AGENT_HANDOFF_TO_BOT_MARKER_,
                senderEmail: me,
                bumpUnread: { agent: 0, visitor: 1 }
            });
        } else if (hm === "human" && wasBotReply) {
            await appendMessage_({
                conversationId: id,
                role: "system",
                text: LIVE_AGENT_HUMAN_REJOINED_MARKER_,
                senderEmail: me,
                bumpUnread: { agent: 0, visitor: 1 }
            });
            await ref.update({
                visitorTypingText: "",
                visitorTypingAt: "",
                agentTypingText: "",
                agentTypingAt: "",
                deskRevision: admin.firestore.FieldValue.increment(1)
            });
        }
    } catch (modeMsgErr) {
        console.warn(LOG_TAG, "mode system message:", modeMsgErr.message || modeMsgErr);
    }
    const next = await ref.get();
    return serializeConversation_(id, next.data());
}

export function logStoreError_(err, context) {
    const msg = err && err.message ? err.message : String(err);
    console.error(LOG_TAG, context, msg);
}
