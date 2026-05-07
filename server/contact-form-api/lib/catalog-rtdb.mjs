import admin from "firebase-admin";
import "firebase-admin/database";

const CATALOG_ROOT = (process.env.FIREBASE_CATALOG_ROOT || "catalog").trim();

function db_() {
    return admin.database();
}

/** @param {Record<string, unknown>} obj */
function clean_(obj) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        const key = String(k || "").trim();
        if (!key) continue;
        const val = v == null ? "" : String(v).trim();
        out[key] = val;
    }
    return out;
}

export async function listBranches() {
    const snap = await db_().ref(`${CATALOG_ROOT}/branches`).get();
    const val = snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") return [];
    const out = [];
    for (const [id, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : {};
        out.push({ BranchId: String(id), ...clean_(/** @type {Record<string, unknown>} */ (p)) });
    }
    // numeric-ish sort
    out.sort((a, b) => String(a.BranchId).localeCompare(String(b.BranchId), undefined, { numeric: true }));
    return out;
}

/**
 * @param {{ branchId?: string, department?: string }} [filters]
 */
export async function listDoctors(filters) {
    const branchId = String(filters?.branchId || "").trim();
    const department = String(filters?.department || "").trim();
    const snap = await db_().ref(`${CATALOG_ROOT}/doctors`).get();
    const val = snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") return [];
    const out = [];
    for (const [id, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : {};
        const row = { DoctorId: String(id), ...clean_(/** @type {Record<string, unknown>} */ (p)) };
        if (branchId && String(row.BranchId || "").trim() !== branchId) continue;
        if (department && String(row.Specialization || "").trim() !== department) continue;
        out.push(row);
    }
    out.sort((a, b) => String(a.DoctorId).localeCompare(String(b.DoctorId), undefined, { numeric: true }));
    return out;
}

/**
 * @param {{ branchId?: string }} [args]
 */
export async function listDepartments(args) {
    const branchId = String(args?.branchId || "").trim();
    const docs = await listDoctors({ branchId: branchId || undefined });
    const set = new Set(docs.map((d) => String(d.Specialization || "").trim()).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * @param {{ branches?: Array<Record<string, unknown>>, doctors?: Array<Record<string, unknown>> }} args
 */
export async function upsertCatalogFromRecords(args) {
    const updates = {};
    if (Array.isArray(args.branches)) {
        for (const b of args.branches) {
            const id = String(b.BranchId || b.branchId || "").trim();
            if (!id) continue;
            updates[`${CATALOG_ROOT}/branches/${id}`] = clean_(b);
        }
    }
    if (Array.isArray(args.doctors)) {
        for (const d of args.doctors) {
            const id = String(d.DoctorId || d.doctorId || "").trim();
            if (!id) continue;
            updates[`${CATALOG_ROOT}/doctors/${id}`] = clean_(d);
        }
    }
    if (Object.keys(updates).length === 0) {
        return { ok: true, wrote: 0 };
    }
    await db_().ref().update(updates);
    return { ok: true, wrote: Object.keys(updates).length };
}

