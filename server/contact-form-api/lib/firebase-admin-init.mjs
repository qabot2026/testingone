/**
 * Firebase Admin initialization (shared by RTDB + optional Firestore).
 *
 * This module intentionally does NOT import Firestore to keep RTDB-only
 * deployments (and local scripts) lightweight and free of gRPC deps.
 */

import fs from "node:fs";
import admin from "firebase-admin";

const FIREBASE_DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || "").trim();

export function firebaseAdminInit() {
    if (admin.apps.length) {
        return;
    }
    const json = (process.env.FIREBASE_CONFIG || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (json) {
        const cred = JSON.parse(json);
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: cred.project_id,
            ...(FIREBASE_DATABASE_URL ? { databaseURL: FIREBASE_DATABASE_URL } : {})
        });
        return;
    }
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path && fs.existsSync(path)) {
        const cred = JSON.parse(fs.readFileSync(path, "utf8"));
        const pid = cred.project_id || process.env.GCLOUD_PROJECT;
        admin.initializeApp({
            credential: admin.credential.cert(cred),
            projectId: pid,
            ...(FIREBASE_DATABASE_URL ? { databaseURL: FIREBASE_DATABASE_URL } : {})
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

