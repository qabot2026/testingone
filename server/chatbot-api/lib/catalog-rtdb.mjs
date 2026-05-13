import admin from "firebase-admin";
import "firebase-admin/database";

const CATALOG_ROOT = (process.env.FIREBASE_CATALOG_ROOT || "catalog").trim();

/**
 * In-process TTL cache for branch and doctor catalogs. The chatbot webhook
 * reads the catalog on almost every turn (states / cities / areas / doctors
 * / nearby) — without this cache, each turn does a 100–300ms RTDB roundtrip
 * over the public internet, which dominates p95 latency under load.
 *
 * Catalog changes are infrequent (a few times a day at most) and writes go
 * through `upsertCatalogFromRecords` below, which invalidates the cache, so
 * stale reads are bounded to `CATALOG_CACHE_TTL_MS` (default 60s).
 *
 * Override with env: `CATALOG_CACHE_TTL_MS=0` disables the cache entirely.
 */
const CATALOG_CACHE_TTL_MS = (() => {
    const raw = String(process.env.CATALOG_CACHE_TTL_MS || "").trim();
    if (!raw) return 60_000;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 60_000;
})();

/** @type {{ data: Array<Record<string, string>> | null, fetchedAt: number, inFlight: Promise<Array<Record<string, string>>> | null }} */
const branchesCache_ = { data: null, fetchedAt: 0, inFlight: null };
/** @type {{ data: Array<Record<string, string>> | null, fetchedAt: number, inFlight: Promise<Array<Record<string, string>>> | null }} */
const doctorsCache_ = { data: null, fetchedAt: 0, inFlight: null };

function isCacheFresh_(entry) {
    if (CATALOG_CACHE_TTL_MS === 0) return false;
    return !!entry.data && Date.now() - entry.fetchedAt < CATALOG_CACHE_TTL_MS;
}

export function invalidateCatalogCache(kind) {
    if (!kind || kind === "branches") {
        branchesCache_.data = null;
        branchesCache_.fetchedAt = 0;
        branchesCache_.inFlight = null;
    }
    if (!kind || kind === "doctors") {
        doctorsCache_.data = null;
        doctorsCache_.fetchedAt = 0;
        doctorsCache_.inFlight = null;
    }
}

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

async function fetchAllBranchesFromDb_() {
    const snap = await db_().ref(`${CATALOG_ROOT}/branches`).get();
    const val = snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") return [];
    const out = [];
    for (const [id, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : {};
        out.push({ BranchId: String(id), ...clean_(/** @type {Record<string, unknown>} */ (p)) });
    }
    out.sort((a, b) => String(a.BranchId).localeCompare(String(b.BranchId), undefined, { numeric: true }));
    return out;
}

async function fetchAllDoctorsFromDb_() {
    const snap = await db_().ref(`${CATALOG_ROOT}/doctors`).get();
    const val = snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") return [];
    const out = [];
    for (const [id, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : {};
        out.push({ DoctorId: String(id), ...clean_(/** @type {Record<string, unknown>} */ (p)) });
    }
    out.sort((a, b) => String(a.DoctorId).localeCompare(String(b.DoctorId), undefined, { numeric: true }));
    return out;
}

export async function listBranches() {
    if (isCacheFresh_(branchesCache_)) return branchesCache_.data;
    if (branchesCache_.inFlight) return branchesCache_.inFlight;
    branchesCache_.inFlight = (async () => {
        try {
            const data = await fetchAllBranchesFromDb_();
            branchesCache_.data = data;
            branchesCache_.fetchedAt = Date.now();
            return data;
        } finally {
            branchesCache_.inFlight = null;
        }
    })();
    return branchesCache_.inFlight;
}

/**
 * @param {{ branchId?: string, department?: string }} [filters]
 */
export async function listDoctors(filters) {
    const branchId = String(filters?.branchId || "").trim();
    const department = String(filters?.department || "").trim();
    let all;
    if (isCacheFresh_(doctorsCache_)) {
        all = doctorsCache_.data;
    } else if (doctorsCache_.inFlight) {
        all = await doctorsCache_.inFlight;
    } else {
        doctorsCache_.inFlight = (async () => {
            try {
                const data = await fetchAllDoctorsFromDb_();
                doctorsCache_.data = data;
                doctorsCache_.fetchedAt = Date.now();
                return data;
            } finally {
                doctorsCache_.inFlight = null;
            }
        })();
        all = await doctorsCache_.inFlight;
    }
    if (!branchId && !department) return all;
    return all.filter((row) => {
        if (branchId && String(row.BranchId || "").trim() !== branchId) return false;
        if (department && String(row.Specialization || "").trim() !== department) return false;
        return true;
    });
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
    invalidateCatalogCache();
    return { ok: true, wrote: Object.keys(updates).length };
}

