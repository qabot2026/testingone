/**
 * When a staff member deletes a row from Sheet1 or the Live Agent sheet tab,
 * remember the session and stop re-appending on later sync jobs.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

import { firebaseAdminInit } from "./firebase-admin-init.mjs";

const SESSION_TRANSCRIPT_COLLECTION = (
    process.env.FIRESTORE_SESSION_TRANSCRIPT_COLLECTION || "session_chat_transcripts"
).trim();

const LIVE_AGENT_CONVERSATIONS_COLLECTION = (
    process.env.LIVE_AGENT_CONVERSATIONS_COLLECTION || "live_agent_conversations"
).trim();

/** @type {Map<string, true>} */
const sheet1ExcludedMem_ = new Map();
/** @type {Map<string, true>} */
const sheet2ExcludedMem_ = new Map();

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function sessionTranscriptRef_(sessionId) {
    return firestoreDb_().collection(SESSION_TRANSCRIPT_COLLECTION).doc(sessionId);
}

function liveAgentConversationRef_(sessionId) {
    return firestoreDb_().collection(LIVE_AGENT_CONVERSATIONS_COLLECTION).doc(sessionId);
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ excluded: boolean, sheet1Row: number }>}
 */
export async function fetchSheet1SyncState_(sessionId) {
    const sid = trim_(sessionId);
    if (!sid) {
        return { excluded: false, sheet1Row: 0 };
    }
    if (sheet1ExcludedMem_.has(sid)) {
        return { excluded: true, sheet1Row: 0 };
    }
    try {
        const snap = await sessionTranscriptRef_(sid).get();
        if (!snap.exists) {
            return { excluded: false, sheet1Row: 0 };
        }
        const data = snap.data() || {};
        const excluded = !!data.sheet1_excluded_at;
        if (excluded) {
            sheet1ExcludedMem_.set(sid, true);
        }
        const row = Number(data.sheet1_row);
        return { excluded, sheet1Row: Number.isFinite(row) && row >= 2 ? row : 0 };
    } catch (err) {
        console.warn("[sheet-sync-suppression] fetchSheet1SyncState:", err.message || err);
        return { excluded: false, sheet1Row: 0 };
    }
}

/**
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function isSheet1SyncExcluded_(sessionId) {
    const state = await fetchSheet1SyncState_(sessionId);
    return state.excluded;
}

/**
 * @param {string} sessionId
 * @param {string} [reason]
 */
export async function markSheet1SyncExcluded_(sessionId, reason) {
    const sid = trim_(sessionId);
    if (!sid) {
        return;
    }
    sheet1ExcludedMem_.set(sid, true);
    try {
        await sessionTranscriptRef_(sid).set(
            {
                client_session_id: sid,
                sheet1_excluded_at: admin.firestore.FieldValue.serverTimestamp(),
                sheet1_excluded_reason: trim_(reason) || "row_removed",
                sheet1_row: admin.firestore.FieldValue.delete()
            },
            { merge: true }
        );
    } catch (err) {
        console.warn("[sheet-sync-suppression] markSheet1SyncExcluded:", err.message || err);
    }
}

/**
 * @param {string} sessionId
 * @param {number} rowNum
 */
export async function persistSheet1Row_(sessionId, rowNum) {
    const sid = trim_(sessionId);
    const row = Number(rowNum);
    if (!sid || !(row >= 2)) {
        return;
    }
    try {
        await sessionTranscriptRef_(sid).set(
            {
                client_session_id: sid,
                sheet1_row: row
            },
            { merge: true }
        );
    } catch (err) {
        console.warn("[sheet-sync-suppression] persistSheet1Row:", err.message || err);
    }
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ excluded: boolean, sheet2Row: number }>}
 */
export async function fetchSheet2SyncState_(sessionId) {
    const sid = trim_(sessionId);
    if (!sid) {
        return { excluded: false, sheet2Row: 0 };
    }
    if (sheet2ExcludedMem_.has(sid)) {
        return { excluded: true, sheet2Row: 0 };
    }
    try {
        const snap = await liveAgentConversationRef_(sid).get();
        if (!snap.exists) {
            return { excluded: false, sheet2Row: 0 };
        }
        const data = snap.data() || {};
        const excluded = !!data.sheet2_excluded_at;
        if (excluded) {
            sheet2ExcludedMem_.set(sid, true);
        }
        const row = Number(data.sheet2Row ?? data.sheet2_row);
        return { excluded, sheet2Row: Number.isFinite(row) && row >= 2 ? row : 0 };
    } catch (err) {
        console.warn("[sheet-sync-suppression] fetchSheet2SyncState:", err.message || err);
        return { excluded: false, sheet2Row: 0 };
    }
}

/**
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function isSheet2SyncExcluded_(sessionId) {
    const state = await fetchSheet2SyncState_(sessionId);
    return state.excluded;
}

/**
 * @param {string} sessionId
 * @param {string} [reason]
 */
export async function markSheet2SyncExcluded_(sessionId, reason) {
    const sid = trim_(sessionId);
    if (!sid) {
        return;
    }
    sheet2ExcludedMem_.set(sid, true);
    try {
        await liveAgentConversationRef_(sid).set(
            {
                sheet2_excluded_at: admin.firestore.FieldValue.serverTimestamp(),
                sheet2_excluded_reason: trim_(reason) || "row_removed",
                sheet2Row: admin.firestore.FieldValue.delete()
            },
            { merge: true }
        );
    } catch (err) {
        console.warn("[sheet-sync-suppression] markSheet2SyncExcluded:", err.message || err);
    }
}
