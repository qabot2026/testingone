/**
 * Firebase Admin SDK initialisation.
 *
 * Reads credentials from the FIREBASE_CONFIG environment variable (service
 * account JSON string set in Railway).  Falls back to
 * FIREBASE_SERVICE_ACCOUNT_JSON, then GOOGLE_APPLICATION_CREDENTIALS, and
 * finally to Application Default Credentials when running on GCP.
 *
 * Exports:
 *   admin  — the firebase-admin namespace (for FieldValue, Timestamp, etc.)
 *   db     — the default Firestore database instance
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";

const FIRESTORE_DATABASE_ID = (process.env.FIRESTORE_DATABASE_ID || "").trim();

function initApp() {
    if (admin.apps.length) {
        return;
    }

    const json = (process.env.FIREBASE_CONFIG || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (json) {
        const cred = JSON.parse(json);
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: cred.project_id,
        });
        return;
    }

    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && fs.existsSync(credPath)) {
        const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: cred.project_id || process.env.GCLOUD_PROJECT,
        });
        return;
    }

    // Fall back to Application Default Credentials (GCP-managed environments).
    admin.initializeApp();
}

initApp();

function buildDb() {
    const id = FIRESTORE_DATABASE_ID;
    if (!id || id === "(default)" || id === "default") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

export { admin };
export const db = buildDb();
