import fs from "node:fs";
import path from "node:path";
import { firebaseAdminInit } from "../lib/firebase-admin-init.mjs";
import { doctorsFromCsvText, branchesFromCsvText } from "../lib/catalog-csv-ingest.mjs";
import { listBranches, listDoctors } from "../lib/catalog-rtdb.mjs";

/**
 * Usage:
 *   node scripts/verify-catalog-upload.mjs --doctors data/doctors.upload.csv --branches data/branches.upload.csv
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

function requireRtdbEnv_() {
    const url = (process.env.FIREBASE_DATABASE_URL || "").trim();
    if (!url) {
        console.error(
            "Missing FIREBASE_DATABASE_URL. Set it to your Realtime Database URL, e.g.\n" +
                "  https://YOUR-PROJECT-default-rtdb.firebaseio.com\n" +
                "(Firebase Console → Realtime Database → copy URL.)"
        );
        process.exit(1);
    }
    const hasJson = !!(process.env.FIREBASE_CONFIG || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    const hasFile = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    if (!hasJson && !hasFile) {
        console.error(
            "Missing Firebase Admin credentials. Set one of:\n" +
                "  FIREBASE_SERVICE_ACCOUNT_JSON — full JSON string of the service account key, or\n" +
                "  GOOGLE_APPLICATION_CREDENTIALS — path to the key .json file."
        );
        process.exit(1);
    }
}

function loadCsv_(p) {
    const abs = path.resolve(p);
    return fs.readFileSync(abs, "utf8");
}

function sample_(arr, n) {
    return Array.isArray(arr) ? arr.slice(0, n) : [];
}

async function main() {
    requireRtdbEnv_();
    firebaseAdminInit();

    const doctorsPath = argValue_("--doctors");
    const branchesPath = argValue_("--branches");
    if (!doctorsPath && !branchesPath) {
        console.error("Provide --doctors and/or --branches CSV paths.");
        process.exit(2);
    }

    const root = (process.env.FIREBASE_CATALOG_ROOT || "catalog").trim();

    /** @type {any} */
    const report = {
        ok: true,
        root,
        expected: {},
        actual: {},
        checks: []
    };

    if (doctorsPath) {
        const parsed = doctorsFromCsvText(loadCsv_(doctorsPath));
        report.expected.doctorsRows = parsed.doctors.length;
        report.expected.doctorsWithId = parsed.withId;

        const actualDocs = await listDoctors();
        report.actual.doctorsCount = actualDocs.length;
        report.actual.doctorsSample = sample_(actualDocs, 5).map((d) => ({
            DoctorId: d.DoctorId,
            DoctorName: d.DoctorName,
            DisplayDoctorName: d.DisplayDoctorName,
            Specialization: d.Specialization,
            BranchId: d.BranchId,
            City: d.City
        }));

        const expectedIds = new Set(parsed.doctors.map((d) => String(d.DoctorId || "").trim()).filter(Boolean));
        const actualIds = new Set(actualDocs.map((d) => String(d.DoctorId || "").trim()).filter(Boolean));
        const missing = Array.from(expectedIds).filter((id) => !actualIds.has(id)).sort();
        const extras = Array.from(actualIds).filter((id) => !expectedIds.has(id)).sort();

        report.checks.push({
            name: "doctors_count_match",
            pass: actualDocs.length === parsed.withId,
            expected: parsed.withId,
            actual: actualDocs.length
        });
        report.checks.push({
            name: "doctors_missing_ids",
            pass: missing.length === 0,
            count: missing.length,
            sample: missing.slice(0, 10)
        });
        report.checks.push({
            name: "doctors_extra_ids_vs_csv",
            pass: extras.length === 0,
            count: extras.length,
            sample: extras.slice(0, 10)
        });
    }

    if (branchesPath) {
        const parsed = branchesFromCsvText(loadCsv_(branchesPath));
        report.expected.branchesRows = parsed.branches.length;
        report.expected.branchesWithId = parsed.withId;

        const actualBranches = await listBranches();
        report.actual.branchesCount = actualBranches.length;
        report.actual.branchesSample = sample_(actualBranches, 5);

        const expectedIds = new Set(parsed.branches.map((b) => String(b.BranchId || "").trim()).filter(Boolean));
        const actualIds = new Set(actualBranches.map((b) => String(b.BranchId || "").trim()).filter(Boolean));
        const missing = Array.from(expectedIds).filter((id) => !actualIds.has(id)).sort();
        const extras = Array.from(actualIds).filter((id) => !expectedIds.has(id)).sort();

        report.checks.push({
            name: "branches_count_match",
            pass: actualBranches.length === parsed.withId,
            expected: parsed.withId,
            actual: actualBranches.length
        });
        report.checks.push({
            name: "branches_missing_ids",
            pass: missing.length === 0,
            count: missing.length,
            sample: missing.slice(0, 10)
        });
        report.checks.push({
            name: "branches_extra_ids_vs_csv",
            pass: extras.length === 0,
            count: extras.length,
            sample: extras.slice(0, 10)
        });
    }

    const allPass = report.checks.every((c) => c && c.pass === true);
    report.ok = allPass;

    console.log(JSON.stringify(report, null, 2));
    if (!allPass) {
        process.exitCode = 3;
    }
}

main().catch((e) => {
    console.error("Verify failed:", e && e.stack ? e.stack : e);
    process.exit(1);
});

