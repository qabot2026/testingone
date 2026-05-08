import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.mjs";
import { upsertCatalogFromRecords } from "./catalog-rtdb.mjs";

export function normalizeDoctorRecordForUpload(r) {
    const out = { ...r };
    out.DoctorId = String(out.DoctorId || out.doctorId || "").trim();
    out.BranchId = String(out.BranchId || out.branchId || "").trim();
    out.City = String(out.City || out.city || "").trim();
    out.Specialization = String(out.Specialization || out.specialization || "").trim();
    out.Days = String(out.Days || "").trim();
    out.Start = String(out.Start || "").trim();
    out.End = String(out.End || "").trim();
    return out;
}

export function normalizeBranchRecordForUpload(r) {
    const out = { ...r };
    out.BranchId = String(out.BranchId || out.branchId || "").trim();
    return out;
}

/**
 * @param {string} rawUtf8
 */
export function doctorsFromCsvText(rawUtf8) {
    const { headers, records } = parseCsv(rawUtf8);
    const doctors = records.map(normalizeDoctorRecordForUpload);
    const withId = doctors.filter((d) => d.DoctorId).length;
    return { headers, doctors, withId, skipped: doctors.length - withId };
}

/**
 * @param {string} rawUtf8
 */
export function branchesFromCsvText(rawUtf8) {
    const { headers, records } = parseCsv(rawUtf8);
    const branches = records.map(normalizeBranchRecordForUpload);
    const withId = branches.filter((b) => b.BranchId).length;
    return { headers, branches, withId, skipped: branches.length - withId };
}

/**
 * @param {string} filePath
 * @returns {{ doctors: Array<Record<string, string>>, headers: string[], skipped: number }}
 */
export function doctorsFromCatalogFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".json")) {
        const arr = JSON.parse(raw);
        const doctors = Array.isArray(arr) ? arr.map(normalizeDoctorRecordForUpload) : [];
        const withId = doctors.filter((d) => d.DoctorId).length;
        return { doctors, headers: [], skipped: doctors.length - withId };
    }
    const parsed = doctorsFromCsvText(raw);
    return { doctors: parsed.doctors, headers: parsed.headers, skipped: parsed.skipped };
}

/**
 * @param {string} filePath
 * @returns {{ branches: Array<Record<string, string>>, headers: string[], skipped: number }}
 */
export function branchesFromCatalogFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".json")) {
        const arr = JSON.parse(raw);
        const branches = Array.isArray(arr) ? arr.map(normalizeBranchRecordForUpload) : [];
        const withId = branches.filter((b) => b.BranchId).length;
        return { branches, headers: [], skipped: branches.length - withId };
    }
    const parsed = branchesFromCsvText(raw);
    return { branches: parsed.branches, headers: parsed.headers, skipped: parsed.skipped };
}

/** When doctor rows omit City, copy from the matching branch row (webhooks filter by city). */
function fillDoctorCityFromBranches_(doctors, branches) {
    /** @type {Map<string, string>} */
    const cityByBranch = new Map();
    for (const b of branches) {
        const id = String(b.BranchId || "").trim();
        const city = String(b.City || "").trim();
        if (id && city) {
            cityByBranch.set(id, city);
        }
    }
    for (const d of doctors) {
        const bid = String(d.BranchId || "").trim();
        if (!bid || String(d.City || "").trim()) {
            continue;
        }
        const c = cityByBranch.get(bid);
        if (c) {
            d.City = c;
        }
    }
}

/**
 * Read CSV or JSON catalog files from disk and upsert into RTDB under FIREBASE_CATALOG_ROOT.
 * @param {{ doctorsFile?: string, branchesFile?: string }} args
 */
export async function upsertCatalogFromCsvFiles(args) {
    const doctorsPath = args.doctorsFile ? path.resolve(args.doctorsFile) : "";
    const branchesPath = args.branchesFile ? path.resolve(args.branchesFile) : "";
    let doctors = [];
    let branches = [];
    /** @type {string[]} */
    const notes = [];

    if (doctorsPath && fs.existsSync(doctorsPath)) {
        const parsed = doctorsFromCatalogFile(doctorsPath);
        doctors = parsed.doctors;
        if (parsed.skipped > 0) {
            notes.push(
                `${parsed.skipped} doctor row(s) skipped (empty DoctorId). Source: ${path.basename(doctorsPath)}`
            );
        }
    }
    if (branchesPath && fs.existsSync(branchesPath)) {
        const parsed = branchesFromCatalogFile(branchesPath);
        branches = parsed.branches;
        if (parsed.skipped > 0) {
            notes.push(`${parsed.skipped} branch row(s) skipped (empty BranchId).`);
        }
    }

    fillDoctorCityFromBranches_(doctors, branches);

    const wrote = await upsertCatalogFromRecords({ doctors, branches });
    return {
        ok: true,
        ...wrote,
        doctorsRows: doctors.length,
        doctorsWritten: doctors.filter((d) => d.DoctorId).length,
        branchesRows: branches.length,
        branchesWritten: branches.filter((b) => b.BranchId).length,
        notes
    };
}
