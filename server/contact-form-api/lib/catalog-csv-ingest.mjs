import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.mjs";
import { upsertCatalogFromRecords } from "./catalog-rtdb.mjs";

export function normalizeDoctorRecordForUpload(r) {
    const out = { ...r };
    out.DoctorId = String(out.DoctorId || out.doctorId || "").trim();
    out.BranchId = String(out.BranchId || out.branchId || "").trim();
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
 * Read CSV files from disk and upsert into RTDB under FIREBASE_CATALOG_ROOT.
 * @param {{ doctorsFile?: string, branchesFile?: string }} args
 */
export async function upsertCatalogFromCsvFiles(args) {
    const doctorsPath = args.doctorsFile ? path.resolve(args.doctorsFile) : "";
    const branchesPath = args.branchesFile ? path.resolve(args.branchesFile) : "";
    let doctors = [];
    let branches = [];
    /** @type {string[]} */
    const notes = [];

    if (doctorsPath) {
        const raw = fs.readFileSync(doctorsPath, "utf8");
        const parsed = doctorsFromCsvText(raw);
        doctors = parsed.doctors;
        if (parsed.skipped > 0) {
            notes.push(
                `${parsed.skipped} doctor row(s) skipped (empty DoctorId). First header was: ${JSON.stringify(parsed.headers[0] || "")}`
            );
        }
    }
    if (branchesPath) {
        const raw = fs.readFileSync(branchesPath, "utf8");
        const parsed = branchesFromCsvText(raw);
        branches = parsed.branches;
        if (parsed.skipped > 0) {
            notes.push(`${parsed.skipped} branch row(s) skipped (empty BranchId).`);
        }
    }

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
