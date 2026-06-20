/**
 * Round-robin queue assignment + timed escalation.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";
import {
    getDepartment_,
    getLiveAgentSettings_,
    pickRoundRobinAssignee_,
    resolveDepartmentId_
} from "./departments.mjs";
import { getConversation_ } from "./store.mjs";

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

function conversationRef_(id) {
    return firestoreDb_().collection(conversationsCollection_()).doc(id);
}

/**
 * Assign first round-robin agent when a chat enters waiting.
 */
export async function applyInitialRoundRobin_(conversationId, departmentId) {
    const settings = await getLiveAgentSettings_();
    const deptId = resolveDepartmentId_(departmentId, settings);
    const dept = await getDepartment_(deptId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch = {
        departmentId: deptId,
        departmentName: dept?.name || "General",
        visitorSessionActive: true
    };

    if (settings.routing.algorithm === "round_robin") {
        const { assigneeEmail, roundIndex, departmentName } = await pickRoundRobinAssignee_(deptId);
        patch.departmentName = dept?.name || departmentName || "General";
        patch.currentAssigneeEmail = assigneeEmail;
        patch.assigneeRoundIndex = roundIndex;
        patch.assigneeAssignedAt = now;
    } else {
        patch.currentAssigneeEmail = "";
        patch.assigneeRoundIndex = 0;
        patch.assigneeAssignedAt = now;
    }

    await conversationRef_(conversationId).set(patch, { merge: true });
    return getConversation_(conversationId);
}

/**
 * If waiting longer than claimWaitSeconds, assign next agent in pool.
 */
export async function maybeEscalateWaitingConversation_(conversation) {
    if (!conversation || conversation.status !== "waiting") return conversation;
    const settings = await getLiveAgentSettings_();
    if (settings.routing.algorithm !== "round_robin") return conversation;
    const waitMs = (settings.claimWaitSeconds || 30) * 1000;
    const assignedAt = conversation.assigneeAssignedAt
        ? new Date(conversation.assigneeAssignedAt).getTime()
        : 0;
    if (!assignedAt || Date.now() - assignedAt < waitMs) return conversation;

    const deptId = conversation.departmentId || settings.defaultDepartmentId;
    const dept = await getDepartment_(deptId);
    const pool = dept?.agentEmails || [];
    if (pool.length < 2) return conversation;

    const current = trim_(conversation.currentAssigneeEmail).toLowerCase();
    let nextIdx = pool.findIndex((e) => e === current);
    if (nextIdx < 0) nextIdx = conversation.assigneeRoundIndex || 0;
    nextIdx = (nextIdx + 1) % pool.length;
    const nextEmail = pool[nextIdx];
    if (nextEmail === current) return conversation;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = conversationRef_(conversation.id);
    await ref.update({
        currentAssigneeEmail: nextEmail,
        assigneeRoundIndex: nextIdx,
        assigneeAssignedAt: now
    });
    return getConversation_(conversation.id);
}

export async function processWaitingEscalations_(conversations) {
    const out = [];
    for (const c of conversations) {
        if (c.status === "waiting") {
            try {
                out.push(await maybeEscalateWaitingConversation_(c));
            } catch {
                out.push(c);
            }
        } else {
            out.push(c);
        }
    }
    return out;
}
