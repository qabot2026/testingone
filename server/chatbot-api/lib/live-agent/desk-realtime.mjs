/**
 * Real-time desk helpers — refer-compatible typing pulse / live-sync (Firestore).
 */

import admin from "firebase-admin";

import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { getConversation_, listMessages_ } from "./store.mjs";

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
        return { visitorTyping: "", agentTyping: "", revision: 0, lastMessageId: "" };
    }
    const snap = await convRef_(id).get();
    if (!snap.exists) {
        return { visitorTyping: "", agentTyping: "", revision: 0, lastMessageId: "" };
    }
    const data = snap.data() || {};
    const conv = await getConversation_(id);
    return {
        visitorTyping: activeTypingText_(data.visitorTypingText, data.visitorTypingAt),
        agentTyping: activeTypingText_(data.agentTypingText, data.agentTypingAt),
        revision: conversationRevision_(conv, data),
        lastMessageId: trim_(data.lastMessageId)
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

export async function listDeskMessages_({ conversationId, sinceIso, sinceId, limit, markReadFor }) {
    let messages = await listMessages_({
        conversationId,
        sinceIso: sinceIso || undefined,
        limit: limit || 80,
        markReadFor: markReadFor || undefined
    });
    if (sinceId) {
        messages = filterMessagesSinceId_(messages, sinceId);
    }
    return messages;
}

export function sleep_(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function liveSyncPoll_({ conversationId, clientRev, waitMs, sinceId, lastMessageId }) {
    const id = trim_(conversationId);
    const deadline = Date.now() + Math.min(Math.max(Number(waitMs) || 900, 400), 28000);
    const since = trim_(sinceId || lastMessageId);

    while (Date.now() < deadline) {
        const typing = await getTypingState_(id);
        const conv = await getConversation_(id);
        const rev = Math.max(typing.revision, conversationRevision_(conv));
        const messages = await listDeskMessages_({
            conversationId: id,
            sinceId: since || undefined,
            limit: 80
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
                agentTyping: typing.agentTyping,
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
        agentTyping: typing.agentTyping
    };
}
