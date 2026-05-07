import fs from "node:fs";
import path from "node:path";
import { firebaseAdminInit } from "../lib/firebase-admin-init.mjs";
import { parseCsv } from "../lib/csv.mjs";
import { upsertCatalogFromRecords } from "../lib/catalog-rtdb.mjs";

/**
 * Usage:
 *   node scripts/upload-catalog-from-csv.mjs --doctors data/doctors.upload.csv --branches data/branches.upload.csv
 *
 * Env required:
 *   FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS)
 *   FIREBASE_DATABASE_URL (Realtime Database URL)
 */

function argValue_(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return "";
    return process.argv[idx + 1] || "";
}

function readCsvFile_(p) {
    const abs = path.resolve(p);
    const raw = fs.readFileSync(abs, "utf8");
    return parseCsv(raw).records;
}

function normalizeDays_(s) {
    const raw = String(s || "").trim();
    if (!raw) return "";
    // Allow "Mon-Fri" or "Mon,Tue" etc. Store as a string; webhook/UI can format.
    return raw;
}

function normalizeTime12h_(s) {
    const raw = String(s || "").trim();
    if (!raw) return "";
    // Expect already in 12h format; keep as-is.
    return raw;
}

function normalizeDoctorRecord_(r) {
    const out = { ...r };
    out.DoctorId = String(r.DoctorId || "").trim();
    out.BranchId = String(r.BranchId || "").trim();
    out.Days = normalizeDays_(r.Days);
    out.Start = normalizeTime12h_(r.Start);
    out.End = normalizeTime12h_(r.End);
    return out;
}

function normalizeBranchRecord_(r) {
    const out = { ...r };
    out.BranchId = String(r.BranchId || "").trim();
    return out;
}

async function main() {
    firebaseAdminInit();

    const doctorsPath = argValue_("--doctors");
    const branchesPath = argValue_("--branches");
    if (!doctorsPath && !branchesPath) {
        console.error("Provide --doctors and/or --branches CSV paths.");
        process.exit(2);
    }

    const doctors = doctorsPath ? readCsvFile_(doctorsPath).map(normalizeDoctorRecord_) : [];
    const branches = branchesPath ? readCsvFile_(branchesPath).map(normalizeBranchRecord_) : [];

    const wrote = await upsertCatalogFromRecords({ doctors, branches });
    console.log(JSON.stringify({ ok: true, ...wrote, doctors: doctors.length, branches: branches.length }, null, 2));
}

main().catch((e) => {
    console.error("Upload failed:", e && e.message ? e.message : e);
    process.exit(1);
});

