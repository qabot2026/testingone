/**
 * Agent presence (by email) and activity log (accepts, closes, status).
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import { listDepartments_ } from "./departments.mjs";

const LOG_TAG = "[live-agent/agents]";
const ONLINE_STALE_MS = 2 * 60 * 1000;

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail_(raw) {
    return trim_(raw).toLowerCase();
}

function agentDocId_(email) {
    const e = normalizeEmail_(email);
    if (!e || !e.includes("@")) throw new Error("Valid agent email required");
    return e;
}

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function agentsCol_() {
    return firestoreDb_().collection(
        trim_(process.env.LIVE_AGENT_AGENTS_COLLECTION) || "live_agent_agents"
    );
}

function activityCol_() {
    return firestoreDb_().collection(
        trim_(process.env.LIVE_AGENT_ACTIVITY_COLLECTION) || "live_agent_activity"
    );
}

function tsToIso_(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return null;
}

function pickStatus_(v) {
    const s = trim_(v).toLowerCase();
    if (s === "online" || s === "away" || s === "offline") return s;
    return "offline";
}

function serializeAgent_(id, data) {
    const d = data || {};
    const lastSeenAt = tsToIso_(d.lastSeenAt);
    const status = pickStatus_(d.status);
    let effectiveStatus = status;
    if (status === "online" && lastSeenAt) {
        const age = Date.now() - new Date(lastSeenAt).getTime();
        if (age > ONLINE_STALE_MS) effectiveStatus = "offline";
    } else if (status !== "away" && lastSeenAt) {
        const age = Date.now() - new Date(lastSeenAt).getTime();
        if (age > ONLINE_STALE_MS * 3) effectiveStatus = "offline";
    }
    return {
        email: normalizeEmail_(d.email) || id,
        status,
        effectiveStatus,
        lastSeenAt,
        statusUpdatedAt: tsToIso_(d.statusUpdatedAt),
        totalAccepted: typeof d.totalAccepted === "number" ? d.totalAccepted : 0,
        totalClosed: typeof d.totalClosed === "number" ? d.totalClosed : 0,
        lastAcceptedAt: tsToIso_(d.lastAcceptedAt),
        lastAcceptedConversationId:
            typeof d.lastAcceptedConversationId === "string" ? d.lastAcceptedConversationId : "",
        lastClosedAt: tsToIso_(d.lastClosedAt),
        lastClosedConversationId:
            typeof d.lastClosedConversationId === "string" ? d.lastClosedConversationId : "",
        updatedAt: tsToIso_(d.updatedAt)
    };
}

function serializeActivity_(id, data) {
    const d = data || {};
    return {
        id,
        type: typeof d.type === "string" ? d.type : "event",
        agentEmail: normalizeEmail_(d.agentEmail),
        conversationId: typeof d.conversationId === "string" ? d.conversationId : "",
        visitorName: typeof d.visitorName === "string" ? d.visitorName : "",
        departmentName: typeof d.departmentName === "string" ? d.departmentName : "",
        meta: d.meta && typeof d.meta === "object" ? d.meta : {},
        createdAt: tsToIso_(d.createdAt)
    };
}

export async function recordAgentActivity_({
    agentEmail,
    type,
    conversationId,
    visitorName,
    departmentName,
    meta
}) {
    const email = normalizeEmail_(agentEmail);
    if (!email) return null;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const activity = {
        type: trim_(type) || "event",
        agentEmail: email,
        conversationId: trim_(conversationId),
        visitorName: trim_(visitorName),
        departmentName: trim_(departmentName),
        meta: meta && typeof meta === "object" ? meta : {},
        createdAt: now
    };
    const ref = await activityCol_().add(activity);
    return { id: ref.id, ...serializeActivity_(ref.id, { ...activity, createdAt: new Date() }) };
}

export async function touchAgentPresence_({ agentEmail, status }) {
    const email = normalizeEmail_(agentEmail);
    if (!email) throw new Error("Agent email required");
    const ref = agentsCol_().doc(agentDocId_(email));
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() || {} : {};
    const nextStatus = status !== undefined ? pickStatus_(status) : pickStatus_(prev.status || "online");
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(
        {
            email,
            status: nextStatus,
            lastSeenAt: now,
            statusUpdatedAt: status !== undefined ? now : prev.statusUpdatedAt || now,
            updatedAt: now
        },
        { merge: true }
    );
    if (status !== undefined && pickStatus_(prev.status) !== nextStatus) {
        await recordAgentActivity_({
            agentEmail: email,
            type: "status",
            meta: { from: pickStatus_(prev.status), to: nextStatus }
        });
    }
    const out = await ref.get();
    return serializeAgent_(email, out.data());
}

export async function bumpAgentStats_({ agentEmail, kind, conversationId, visitorName, departmentName }) {
    const email = normalizeEmail_(agentEmail);
    if (!email) return;
    const ref = agentsCol_().doc(agentDocId_(email));
    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch = { email, updatedAt: now, lastSeenAt: now };
    if (kind === "accept") {
        patch.totalAccepted = admin.firestore.FieldValue.increment(1);
        patch.lastAcceptedAt = now;
        patch.lastAcceptedConversationId = trim_(conversationId);
        await recordAgentActivity_({
            agentEmail: email,
            type: "accept",
            conversationId,
            visitorName,
            departmentName
        });
    } else if (kind === "close") {
        patch.totalClosed = admin.firestore.FieldValue.increment(1);
        patch.lastClosedAt = now;
        patch.lastClosedConversationId = trim_(conversationId);
        await recordAgentActivity_({
            agentEmail: email,
            type: "close",
            conversationId,
            visitorName,
            departmentName
        });
    } else if (kind === "reopen") {
        await recordAgentActivity_({
            agentEmail: email,
            type: "reopen",
            conversationId,
            visitorName,
            departmentName
        });
    }
    await ref.set(patch, { merge: true });
}

async function collectKnownAgentEmails_() {
    const emails = new Set();
    try {
        const depts = await listDepartments_();
        for (const d of depts) {
            for (const e of d.agentEmails || []) {
                if (e) emails.add(normalizeEmail_(e));
            }
        }
    } catch (err) {
        console.warn(LOG_TAG, "departments for agent list:", err.message || err);
    }
    const snap = await agentsCol_().limit(200).get();
    for (const doc of snap.docs) {
        const e = normalizeEmail_(doc.data()?.email) || normalizeEmail_(doc.id);
        if (e && e.includes("@")) emails.add(e);
    }
    return [...emails].sort();
}

export async function listAgentsOverview_() {
    const emails = await collectKnownAgentEmails_();
    const agents = [];
    for (const email of emails) {
        const ref = agentsCol_().doc(agentDocId_(email));
        const snap = await ref.get();
        const base = serializeAgent_(email, snap.exists ? snap.data() : { email, status: "offline" });
        let activeChats = 0;
        try {
            const { countActiveConversationsForAgent_ } = await import("./store.mjs");
            activeChats = await countActiveConversationsForAgent_(email);
        } catch (_) {
            /* ignore */
        }
        agents.push({ ...base, activeChats });
    }
    agents.sort((a, b) => {
        const rank = { online: 0, away: 1, offline: 2 };
        const ra = rank[a.effectiveStatus] ?? 3;
        const rb = rank[b.effectiveStatus] ?? 3;
        if (ra !== rb) return ra - rb;
        return a.email.localeCompare(b.email);
    });
    return agents;
}

export async function getAgentByEmail_(agentEmail) {
    const email = normalizeEmail_(agentEmail);
    if (!email) throw new Error("Agent email required");
    const snap = await agentsCol_().doc(agentDocId_(email)).get();
    const agent = serializeAgent_(email, snap.exists ? snap.data() : { email, status: "offline" });
    const { countActiveConversationsForAgent_ } = await import("./store.mjs");
    const activeChats = await countActiveConversationsForAgent_(email);
    const activity = await listAgentActivity_({ agentEmail: email, limit: 40 });
    return { agent: { ...agent, activeChats }, activity };
}

export async function listAgentActivity_({ agentEmail, limit }) {
    const lim = Math.min(Math.max(limit || 30, 1), 100);
    let q = activityCol_().orderBy("createdAt", "desc").limit(lim);
    const email = normalizeEmail_(agentEmail);
    if (email) {
        q = activityCol_()
            .where("agentEmail", "==", email)
            .orderBy("createdAt", "desc")
            .limit(lim);
    }
    let snap;
    try {
        snap = await q.get();
    } catch (err) {
        console.warn(LOG_TAG, "activity query fallback:", err.message || err);
        snap = await activityCol_().orderBy("createdAt", "desc").limit(lim).get();
        if (email) {
            const rows = snap.docs
                .map((doc) => serializeActivity_(doc.id, doc.data()))
                .filter((r) => r.agentEmail === email);
            return rows.slice(0, lim);
        }
    }
    return snap.docs.map((doc) => serializeActivity_(doc.id, doc.data()));
}
