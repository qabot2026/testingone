import { firebaseAdminInit } from "../lib/firebase-admin-init.mjs";
import { upsertCatalogFromCsvFiles } from "../lib/catalog-csv-ingest.mjs";

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
    const out = await upsertCatalogFromCsvFiles({
        doctorsFile: doctorsPath || undefined,
        branchesFile: branchesPath || undefined
    });
    console.log(JSON.stringify(out, null, 2));
    console.log(
        `Done. In Firebase Console → Realtime Database open: ${root}/branches and ${root}/doctors (DoctorId / BranchId keys).`
    );
    if (out.notes && out.notes.length) {
        console.warn("Notes:", out.notes.join(" "));
    }
}

main().catch((e) => {
    console.error("Upload failed:", e && e.message ? e.message : e);
    process.exit(1);
});
