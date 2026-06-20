/**
 * Real-time desk helpers — refer-compatible typing pulse / live-sync (Firestore).
 */

import admin from "firebase-admin";

import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { getConversation_, isLiveAgentAiCopilot_, listMessages_ } from "./store.mjs";

const TYPING_TTL_MS = 12000;

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function firestoreDb_() {
    firebaseAdminInit();
    return admin.firestore();
}

function conversationsCollection_() {
    return trim_(process.env.LIVE_AGENT_CONVERSATIONS_COLLECTION) || "live_agent_conversations";
}

function convRef_(id) {
    return firestoreDb_().collection(conversationsCollection_()).doc(id);
}

function activeTypingText_(text, atIso) {
    const t = trim_(text);
    if (!t) return "";
    const at = Date.parse(atIso || "");
    if (!Number.isFinite(at) || Date.now() - at > TYPING_TTL_MS) return "";
    return t;
}

/** Refer-style monotonic revision for desk polling. */
export function conversationRevision_(conv, data) {
    const d = data || {};
    const explicit = Number(d.deskRevision);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const t = Date.parse((conv && conv.lastMessageAt) || (conv && conv.requestedAt) || "");
    return Number.isFinite(t) ? t : 0;
}

export async function getTypingState_(conversationId) {
    const id = trim_(conversationId);
    if (!id) {
        return {
            visitorTyping: "",
            agentTyping: "",
            agentTypingVisitor: "",
            revision: 0,
            lastMessageId: ""
        };
    }
    const snap = await convRef_(id).get();
    if (!snap.exists) {
        return {
            visitorTyping: "",
            agentTyping: "",
            agentTypingVisitor: "",
            revision: 0,
            lastMessageId: ""
        };
    }
    const data = snap.data() || {};
    const conv = await getConversation_(id);
    const agentDraft = activeTypingText_(data.agentTypingText, data.agentTypingAt);
    let agentTypingVisitor = "";
    if (agentDraft && !isLiveAgentAiCopilot_(conv)) {
        agentTypingVisitor = "Typing...";
    }
    return {
        visitorTyping: activeTypingText_(data.visitorTypingText, data.visitorTypingAt),
        agentTyping: agentDraft,
        agentTypingVisitor,
        revision: conversationRevision_(conv, data),
        lastMessageId: trim_(data.lastMessageId)
    };
}

export async function updateVisitorTyping_({ conversationId, text, active }) {
    const id = trim_(conversationId);
    if (!id) throw new Error("conversationId required");
    const ref = convRef_(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Conversation not found");
    const cur = snap.data() || {};
    if (cur.status === "closed") throw new Error("Conversation is closed");
    const conv = await getConversation_(id);
    if (isLiveAgentAiCopilot_(conv)) {
        return {
            skipped: true,
            revision: conversationRevision_(conv, cur),
            visitorTyping: ""
        };
    }
    const now = new Date().toISOString();
    const payload =
        active !== false && trim_(text)
            ? {
                  visitorTypingText: trim_(text).slice(0, 400),
                  visitorTypingAt: now,
                  deskRevision: admin.firestore.FieldValue.increment(1)
              }
            : {
                  visitorTypingText: "",
                  visitorTypingAt: "",
                  deskRevision: admin.firestore.FieldValue.increment(1)
              };
    await ref.set(payload, { merge: true });
    const snap2 = await ref.get();
    const conv2 = await getConversation_(id);
    const data2 = snap2.data() || {};
    return {
        revision: conversationRevision_(conv2, data2),
        visitorTyping: activeTypingText_(data2.visitorTypingText, data2.visitorTypingAt)
    };
}

export async function updateAgentTyping_({ conversationId, text, active, agentEmail }) {
    const id = trim_(conversationId);
    if (!id) throw new Error("conversationId required");
    const ref = convRef_(id);
    const now = new Date().toISOString();
    const payload = active && trim_(text)
        ? {
              agentTypingText: trim_(text).slice(0, 400),
              agentTypingAt: now,
              agentTypingEmail: trim_(agentEmail).toLowerCase()
          }
        : {
              agentTypingText: "",
              agentTypingAt: "",
              agentTypingEmail: ""
          };
    await ref.set(payload, { merge: true });
    const conv = await getConversation_(id);
    const snap = await ref.get();
    return {
        conversation: conv,
        revision: conversationRevision_(conv, snap.data())
    };
}

export function filterMessagesSinceId_(messages, sinceId) {
    const sid = trim_(sinceId);
    if (!sid || !Array.isArray(messages)) return messages || [];
    const idx = messages.findIndex((m) => m && m.id === sid);
    return idx >= 0 ? messages.slice(idx + 1) : messages;
}

export async function listDeskMessages_({
    conversationId,
    sinceIso,
    sinceId,
    limit,
    markReadFor,
    viewingAgentEmail,
    audience
}) {
    const enrichAudience = audience === "visitor" ? "visitor" : "agent";
    let messages = await listMessages_({
        conversationId,
        sinceIso: sinceIso || undefined,
        limit: limit || 80,
        markReadFor: markReadFor || undefined,
        audience: enrichAudience,
        viewingAgentEmail: enrichAudience === "agent" ? trim_(viewingAgentEmail) : ""
    });
    if (sinceId) {
        messages = filterMessagesSinceId_(messages, sinceId);
    }
    return messages;
}

export function sleep_(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function liveSyncPoll_({
    conversationId,
    clientRev,
    waitMs,
    sinceId,
    lastMessageId,
    viewingAgentEmail,
    audience
}) {
    const id = trim_(conversationId);
    const waitBudget = Math.min(Math.max(Number(waitMs) || 900, 80), 28000);
    const deadline = Date.now() + waitBudget;
    const since = trim_(sinceId || lastMessageId);

    while (Date.now() < deadline) {
        const typing = await getTypingState_(id);
        const conv = await getConversation_(id);
        const rev = typing.revision;
        const messages = await listDeskMessages_({
            conversationId: id,
            sinceId: since || undefined,
            limit: 80,
            viewingAgentEmail,
            audience
        });
        const messageHint = !!(
            typing.lastMessageId &&
            since &&
            typing.lastMessageId !== since
        );
        if (rev > clientRev || messages.length || messageHint) {
            return {
                ok: true,
                revision: rev,
                visitorTyping: typing.visitorTyping,
                agentTyping: typing.agentTypingVisitor,
                lastMessageId: typing.lastMessageId,
                conversation: conv,
                messages
            };
        }
        await sleep_(25);
    }

    const typing = await getTypingState_(id);
    return {
        ok: true,
        unchanged: true,
        revision: Math.max(clientRev, typing.revision),
        visitorTyping: typing.visitorTyping,
        agentTyping: typing.agentTypingVisitor
    };
}
