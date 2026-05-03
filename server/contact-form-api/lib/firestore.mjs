/**
 * Firestore writer using firebase-admin default credentials (GOOGLE_APPLICATION_CREDENTIALS).
 */

import fs from "node:fs";
import admin from "firebase-admin";

const COLLECTION = process.env.FIRESTORE_COLLECTION || "contact_submissions";

/** @typedef {Record<string, unknown>} FirestoreRecord */

export function firebaseAdminInit() {
    if (admin.apps.length) {
        return;
    }
    const json = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (json) {
        const cred = JSON.parse(json);
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: cred.project_id
        });
        return;
    }
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path && fs.existsSync(path)) {
        const cred = JSON.parse(fs.readFileSync(path, "utf8"));
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: cred.project_id || process.env.GCLOUD_PROJECT
        });
        return;
    }
    admin.initializeApp();
}

export async function persistToFirestore(record) {
    const db = admin.firestore();
    await db.collection(COLLECTION).add({
        ...record,
        /** server time for indexing */
        saved_at: admin.firestore.FieldValue.serverTimestamp()
    });
}
