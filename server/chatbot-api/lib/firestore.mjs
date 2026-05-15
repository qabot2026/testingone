/**
 * Firebase Cloud Firestore — contact submissions via firebase-admin (same Firebase project as your console).
 * Production (Railway): set FIREBASE_SERVICE_ACCOUNT_JSON from Firebase Console → Project settings → Service accounts → private key.
 * Local: GOOGLE_APPLICATION_CREDENTIALS pointing at the same JSON file, or FIREBASE_SERVICE_ACCOUNT_JSON.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "./firebase-admin-init.mjs";

const COLLECTION = process.env.FIRESTORE_COLLECTION || "contact_submissions";
/** Empty, `default`, or `(default)` → default DB. Any other value → named Firestore database (avoids NOT_FOUND if you did not use the default). */
const FIRESTORE_DATABASE_ID = (process.env.FIRESTORE_DATABASE_ID || "").trim();

/** @typedef {Record<string, unknown>} FirestoreRecord */

function getFirestoreDb() {
    const id = FIRESTORE_DATABASE_ID;
    if (!id || id === "(default)" || id === "default") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

/**
 * Latest contact submission for a widget session id (top-level `client_session_id` or nested `client_context.client_session_id`).
 *
 * @param {string} sessionId
 * @returns {Promise<FirestoreRecord|null>}
 */
export async function fetchLatestContactSubmissionForClientSession(sessionId) {
    firebaseAdminInit();
    const db = getFirestoreDb();
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid) {
        return null;
    }

    /** @param {*} qs */
    const newestFromSnap = (qs) => {
        if (!qs || qs.empty) {
            return null;
        }
        /** @type {{ ms: number, data: FirestoreRecord }[]} */
        const rows = [];
        for (const doc of qs.docs) {
            const data = /** @type {FirestoreRecord} */ (doc.data());
            let ms = 0;
            const sa = /** @type {{ toMillis?: () => number }} */ (data.saved_at);
            if (sa && typeof sa.toMillis === "function") {
                ms = sa.toMillis();
            }
            const sub = data.submitted_at;
            if (typeof sub === "string") {
                const t = Date.parse(sub);
                if (Number.isFinite(t)) {
                    ms = Math.max(ms, t);
                }
            }
            rows.push({ ms, data });
        }
        rows.sort((a, b) => b.ms - a.ms);
        return rows.length ? rows[0].data : null;
    };

    try {
        const snapTop = await db.collection(COLLECTION).where("client_session_id", "==", sid).limit(25).get();
        const hitTop = newestFromSnap(snapTop);
        if (hitTop) {
            return hitTop;
        }
    } catch {
        /* fall through */
    }

    try {
        const snapNest = await db
            .collection(COLLECTION)
            .where("client_context.client_session_id", "==", sid)
            .limit(25)
            .get();
        return newestFromSnap(snapNest);
    } catch {
        return null;
    }
}

export async function persistToFirestore(record) {
    // Ensure Admin app exists before Firestore use.
    firebaseAdminInit();
    const db = getFirestoreDb();
    try {
        await db.collection(COLLECTION).add({
            ...record,
            /** server time for indexing */
            saved_at: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const code = err && err.code;
        if (
            code === 5 ||
            /NOT_FOUND/i.test(msg) ||
            /5 NOT_FOUND/.test(msg)
        ) {
            const pid = admin.apps[0] && admin.apps[0].options && admin.apps[0].options.projectId;
            const dbId = FIRESTORE_DATABASE_ID || "(default)";
            throw new Error(
                [
                    "Firestore NOT_FOUND — the database was not found for this project/credentials.",
                    `Using project_id="${pid || "?"}" and database id="${dbId}".`,
                    "Fix: (1) Firebase Console → same project as this service account → Firestore → create the Native database if missing.",
                    "(2) If you created a named database (not \"(default)\"), set Railway env FIRESTORE_DATABASE_ID to that exact id.",
                    "(3) Ensure your FIREBASE_SERVICE_ACCOUNT_JSON is from the same Firebase project where Firestore lives.",
                    `Original: ${msg}`
                ].join(" ")
            );
        }
        throw err;
    }
}
