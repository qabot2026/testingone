/**
 * Firestore writer via firebase-admin.
 * Production (Railway): set FIREBASE_SERVICE_ACCOUNT_JSON from Firebase Console → Service accounts → private key.
 * Local: GOOGLE_APPLICATION_CREDENTIALS pointing at the same JSON file, or FIREBASE_SERVICE_ACCOUNT_JSON.
 */

import fs from "node:fs";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = process.env.FIRESTORE_COLLECTION || "contact_submissions";
/** Empty, `default`, or `(default)` → default DB. Any other value → named Firestore database (avoids NOT_FOUND if you did not use the default). */
const FIRESTORE_DATABASE_ID = (process.env.FIRESTORE_DATABASE_ID || "").trim();

/** @typedef {Record<string, unknown>} FirestoreRecord */

export function firebaseAdminInit() {
    if (admin.apps.length) {
        return;
    }
    const json = (process.env.FIREBASE_CONFIG || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
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
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT_JSON in Railway (Firebase Console → Project settings → Service accounts → Generate new private key)."
        );
    }
    admin.initializeApp();
}

function getFirestoreDb() {
    const id = FIRESTORE_DATABASE_ID;
    if (!id || id === "(default)" || id === "default") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

export async function persistToFirestore(record) {
    const db = getFirestoreDb();
    await db.collection(COLLECTION).add({
        ...record,
        /** server time for indexing */
        saved_at: admin.firestore.FieldValue.serverTimestamp()
    });
}
