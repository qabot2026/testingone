/**
 * Live agent departments + global settings (Firestore).
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";

const LOG_TAG = "[live-agent/dept]";
const GENERAL_ID = "general";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function slugId_(name) {
    const s = trim_(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s || "dept";
}

function normalizeEmail_(raw) {
    return trim_(raw).toLowerCase();
}

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function departmentsCol_() {
    return firestoreDb_().collection(
        trim_(process.env.LIVE_AGENT_DEPARTMENTS_COLLECTION) || "live_agent_departments"
    );
}

function settingsRef_() {
    firebaseAdminInit();
    return firestoreDb_()
        .collection(trim_(process.env.LIVE_AGENT_SETTINGS_COLLECTION) || "live_agent_settings")
        .doc("config");
}

function serializeDepartment_(id, data) {
    const d = data || {};
    const emails = Array.isArray(d.agentEmails)
        ? d.agentEmails.map(normalizeEmail_).filter(Boolean)
        : [];
    return {
        id,
        name: typeof d.name === "string" ? d.name : id,
        agentEmails: [...new Set(emails)],
        isSystem: d.isSystem === true || id === GENERAL_ID,
        roundRobinCursor: typeof d.roundRobinCursor === "number" ? d.roundRobinCursor : 0,
        createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : null
    };
}

export async function ensureGeneralDepartment_() {
    const ref = departmentsCol_().doc(GENERAL_ID);
    const snap = await ref.get();
    if (snap.exists) return serializeDepartment_(GENERAL_ID, snap.data());
    const now = admin.firestore.FieldValue.serverTimestamp();
    const data = {
        name: "General Department",
        agentEmails: [],
        isSystem: true,
        roundRobinCursor: 0,
        createdAt: now,
        updatedAt: now
    };
    await ref.set(data);
    return serializeDepartment_(GENERAL_ID, data);
}

export async function getLiveAgentSettings_() {
    await ensureGeneralDepartment_();
    const snap = await settingsRef_().get();
    const d = snap.exists ? snap.data() || {} : {};
    return {
        claimWaitSeconds: Math.min(Math.max(Number(d.claimWaitSeconds) || 30, 5), 300),
        defaultDepartmentId: trim_(d.defaultDepartmentId) || GENERAL_ID,
        updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : null
    };
}

export async function saveLiveAgentSettings_(patch) {
    const cur = await getLiveAgentSettings_();
    const next = {
        claimWaitSeconds:
            patch && patch.claimWaitSeconds !== undefined
                ? Math.min(Math.max(Number(patch.claimWaitSeconds) || 30, 5), 300)
                : cur.claimWaitSeconds,
        defaultDepartmentId:
            patch && patch.defaultDepartmentId !== undefined
                ? trim_(patch.defaultDepartmentId) || GENERAL_ID
                : cur.defaultDepartmentId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await settingsRef_().set(next, { merge: true });
    return getLiveAgentSettings_();
}

export async function listDepartments_() {
    await ensureGeneralDepartment_();
    const snap = await departmentsCol_().get();
    const rows = snap.docs.map((doc) => serializeDepartment_(doc.id, doc.data()));
    rows.sort((a, b) => {
        if (a.isSystem && !b.isSystem) return -1;
        if (!a.isSystem && b.isSystem) return 1;
        return a.name.localeCompare(b.name);
    });
    return rows;
}

export async function getDepartment_(departmentId) {
    const id = trim_(departmentId) || GENERAL_ID;
    const snap = await departmentsCol_().doc(id).get();
    if (!snap.exists) {
        if (id === GENERAL_ID) return ensureGeneralDepartment_();
        return null;
    }
    return serializeDepartment_(id, snap.data());
}

export async function createDepartment_({ name, agentEmails }) {
    const n = trim_(name);
    if (!n) throw new Error("Department name required");
    let id = slugId_(n);
    const col = departmentsCol_();
    if ((await col.doc(id).get()).exists) {
        id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }
    const emails = Array.isArray(agentEmails)
        ? agentEmails.map(normalizeEmail_).filter(Boolean)
        : [];
    const now = admin.firestore.FieldValue.serverTimestamp();
    const data = {
        name: n,
        agentEmails: [...new Set(emails)],
        isSystem: false,
        roundRobinCursor: 0,
        createdAt: now,
        updatedAt: now
    };
    await col.doc(id).set(data);
    return serializeDepartment_(id, data);
}

export async function updateDepartment_({ departmentId, name, agentEmails }) {
    const id = trim_(departmentId);
    if (!id) throw new Error("departmentId required");
    const ref = departmentsCol_().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Department not found");
    const cur = snap.data() || {};
    /** @type {Record<string, unknown>} */
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (name !== undefined && !cur.isSystem) {
        patch.name = trim_(name) || cur.name;
    }
    if (agentEmails !== undefined) {
        const emails = Array.isArray(agentEmails)
            ? agentEmails.map(normalizeEmail_).filter(Boolean)
            : [];
        patch.agentEmails = [...new Set(emails)];
    }
    await ref.update(patch);
    const next = await ref.get();
    return serializeDepartment_(id, next.data());
}

export async function deleteDepartment_(departmentId) {
    const id = trim_(departmentId);
    if (!id || id === GENERAL_ID) throw new Error("Cannot delete General Department");
    const ref = departmentsCol_().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Department not found");
    if (snap.data()?.isSystem) throw new Error("Cannot delete system department");
    await ref.delete();
    return { ok: true, id };
}

export function resolveDepartmentId_(requested, settings) {
    const id = trim_(requested) || trim_(settings?.defaultDepartmentId) || GENERAL_ID;
    return id;
}

export async function agentInDepartment_(agentEmail, departmentId) {
    const email = normalizeEmail_(agentEmail);
    if (!email) return false;
    const dept = await getDepartment_(departmentId);
    if (!dept) return false;
    if (!dept.agentEmails.length) return true;
    return dept.agentEmails.includes(email);
}

export async function pickRoundRobinAssignee_(departmentId) {
    const dept = await getDepartment_(departmentId);
    if (!dept) return { assigneeEmail: "", roundIndex: 0, departmentName: "General" };
    const pool = dept.agentEmails || [];
    if (!pool.length) {
        return { assigneeEmail: "", roundIndex: 0, departmentName: dept.name };
    }
    const idx = ((dept.roundRobinCursor || 0) % pool.length + pool.length) % pool.length;
    const assigneeEmail = pool[idx];
    const nextCursor = (idx + 1) % pool.length;
    await departmentsCol_().doc(dept.id).update({
        roundRobinCursor: nextCursor,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { assigneeEmail, roundIndex: idx, departmentName: dept.name };
}

export function logDept_(msg, extra) {
    if (extra !== undefined) console.warn(LOG_TAG, msg, extra);
    else console.warn(LOG_TAG, msg);
}
