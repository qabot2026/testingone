/**
 * Firebase Cloud Firestore — contact submissions via firebase-admin (same Firebase project as your console).
 * Production (Railway): set FIREBASE_SERVICE_ACCOUNT_JSON from Firebase Console → Project settings → Service accounts → private key.
 * Local: GOOGLE_APPLICATION_CREDENTIALS pointing at the same JSON file, or FIREBASE_SERVICE_ACCOUNT_JSON.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "./firebase-admin-init.mjs";

const COLLECTION = process.env.FIRESTORE_COLLECTION || "contact_submissions";
/** Live widget transcript per session (not a lead row). Override with FIRESTORE_SESSION_TRANSCRIPT_COLLECTION. */
const SESSION_TRANSCRIPT_COLLECTION = (
    process.env.FIRESTORE_SESSION_TRANSCRIPT_COLLECTION || "session_chat_transcripts"
).trim();
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

/** Collection for lightweight visitor ratings / CSAT (no BigQuery). Override with FIRESTORE_CHAT_FEEDBACK_COLLECTION. */
const CHAT_FEEDBACK_COLLECTION = (process.env.FIRESTORE_CHAT_FEEDBACK_COLLECTION || "chat_feedback").trim();

/**
 * Append one chat feedback document (helpful / rating / comment). Uses same Firebase credentials as leads.
 *
 * @param {Record<string, unknown>} record
 */
export async function persistChatFeedbackRecord(record) {
    firebaseAdminInit();
    const db = getFirestoreDb();
    await db.collection(CHAT_FEEDBACK_COLLECTION || "chat_feedback").add({
        ...record,
        saved_at: admin.firestore.FieldValue.serverTimestamp()
    });
}

/** @param {unknown[]} arr */
function maxChatTranscriptSeq_(arr) {
    if (!Array.isArray(arr)) {
        return 0;
    }
    let max = 0;
    for (const it of arr) {
        if (!it || typeof it !== "object") {
            continue;
        }
        const q = /** @type {{ seq?: unknown }} */ (it).seq;
        if (typeof q === "number" && Number.isFinite(q)) {
            max = Math.max(max, q);
        }
    }
    return max;
}

const CHAT_TRANSCRIPT_MERGE_CAP = 120;
const FIRESTORE_SANITIZE_MAX_DEPTH = 14;
const FIRESTORE_SANITIZE_STRING_MAX = 12000;
const FIRESTORE_RICH_JSON_MAX = 49000;

/**
 * Firestore cannot store nested arrays (e.g. CX `richContent: [][]`). Coerce or drop invalid values.
 *
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function sanitizeValueForFirestore_(value, depth) {
    if (depth > FIRESTORE_SANITIZE_MAX_DEPTH) {
        return null;
    }
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        return value.length > FIRESTORE_SANITIZE_STRING_MAX
            ? value.slice(0, FIRESTORE_SANITIZE_STRING_MAX)
            : value;
    }
    if (Array.isArray(value)) {
        /** @type {unknown[]} */
        const out = [];
        for (let i = 0; i < value.length; i += 1) {
            const el = value[i];
            if (Array.isArray(el)) {
                try {
                    const s = JSON.stringify(el);
                    out.push(
                        s.length > FIRESTORE_SANITIZE_STRING_MAX
                            ? s.slice(0, FIRESTORE_SANITIZE_STRING_MAX)
                            : s
                    );
                } catch {
                    /* skip nested array */
                }
                continue;
            }
            const cleaned = sanitizeValueForFirestore_(el, depth + 1);
            if (cleaned !== undefined) {
                out.push(cleaned);
            }
        }
        return out;
    }
    if (typeof value === "object") {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
            if (typeof k !== "string" || !k.trim() || k.length > 120) {
                continue;
            }
            const cleaned = sanitizeValueForFirestore_(v, depth + 1);
            if (cleaned !== undefined) {
                out[k] = cleaned;
            }
        }
        return out;
    }
    return String(value).slice(0, 500);
}

/**
 * @param {unknown} turn
 * @returns {Record<string, unknown> | null}
 */
function sanitizeChatTranscriptTurnForFirestore_(turn) {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
        return null;
    }
    const o = /** @type {Record<string, unknown>} */ (turn);
    /** @type {Record<string, unknown>} */
    const out = { role: normalizeTranscriptMergeRole_(o) };
    const textRaw = typeof o.text === "string" ? o.text.trim() : "";
    if (textRaw) {
        out.text =
            textRaw.length > FIRESTORE_SANITIZE_STRING_MAX
                ? `${textRaw.slice(0, FIRESTORE_SANITIZE_STRING_MAX)}…`
                : textRaw;
    }
    if (typeof o.at === "number" && Number.isFinite(o.at)) {
        out.at = o.at;
    }
    const seqRaw = o.seq;
    if (typeof seqRaw === "number" && Number.isFinite(seqRaw)) {
        out.seq = seqRaw;
    } else if (typeof seqRaw === "string" && Number.isFinite(Number(seqRaw.trim()))) {
        out.seq = Number(seqRaw.trim());
    }
    if (o.rich != null) {
        try {
            const richJson = JSON.stringify(o.rich);
            if (richJson) {
                out.rich_json =
                    richJson.length > FIRESTORE_RICH_JSON_MAX
                        ? richJson.slice(0, FIRESTORE_RICH_JSON_MAX)
                        : richJson;
            }
        } catch {
            /* skip */
        }
    } else if (typeof o.rich_json === "string" && o.rich_json.trim()) {
        const rj = o.rich_json.trim();
        out.rich_json = rj.length > FIRESTORE_RICH_JSON_MAX ? rj.slice(0, FIRESTORE_RICH_JSON_MAX) : rj;
    }
    if (!out.text && !out.rich_json) {
        if (out.role === "assistant") {
            out.text = "(Bot message)";
        } else {
            return null;
        }
    }
    return out;
}

/**
 * @param {Record<string, unknown>} cx
 * @returns {Record<string, unknown>}
 */
function sanitizeClientContextForFirestore_(cx) {
    if (!cx || typeof cx !== "object" || Array.isArray(cx)) {
        return {};
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(cx)) {
        if (k === "chat_transcript") {
            const arr = coerceChatTranscriptArray_(v);
            /** @type {Record<string, unknown>[]} */
            const rows = [];
            for (let i = 0; i < arr.length; i += 1) {
                const row = sanitizeChatTranscriptTurnForFirestore_(arr[i]);
                if (row) {
                    rows.push(row);
                }
            }
            if (rows.length) {
                out.chat_transcript = rows;
            }
            continue;
        }
        const cleaned = sanitizeValueForFirestore_(v, 0);
        if (cleaned !== undefined) {
            out[k] = cleaned;
        }
    }
    return out;
}

/** @param {unknown} text */
function normalizeTranscriptTextKey_(text) {
    return String(text ?? "")
        .replace(/\s{2,}\n/g, " ")
        .replace(/\r\n/g, "\n")
        .replace(/\n+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

/**
 * @param {Record<string, unknown>} o
 * @returns {"assistant" | "user"}
 */
/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function coerceChatTranscriptArray_(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === "string") {
        const s = raw.trim();
        if (s.startsWith("[")) {
            try {
                const parsed = JSON.parse(s);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
    }
    return [];
}

function normalizeTranscriptMergeRole_(o) {
    const raw =
        o.role
        ?? o.type
        ?? o.sender
        ?? o.participant
        ?? o.author
        ?? o.messageFrom
        ?? o.source
        ?? o.speaker;
    const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (
        r === "assistant"
        || r === "bot"
        || r === "agent"
        || r === "model"
        || r === "assistant_bot"
        || r === "virtual_agent"
        || r === "df-bot"
        || r === "system"
        || r === "chirp"
        || r.includes("automated")
    ) {
        return "assistant";
    }
    if (r === "user" || r === "human" || r === "customer" || r === "client" || r === "end_user" || r === "enduser") {
        return "user";
    }
    if (o.fulfillment_response || o.fulfillmentResponse) {
        return "assistant";
    }
    const tx = o.text;
    if (tx && typeof tx === "object" && !Array.isArray(tx)) {
        const nest = /** @type {{ text?: unknown }} */ (tx).text;
        if (Array.isArray(nest) && nest.some((x) => typeof x === "string" && x.trim())) {
            return "assistant";
        }
    }
    return "user";
}

/**
 * Union-merge widget transcript arrays (never drop a longer history because `seq` advanced on a shorter slice).
 *
 * @param {unknown} prev
 * @param {unknown} next
 * @returns {unknown[]}
 */
function mergeChatTranscriptArrays_(prev, next) {
    const p = Array.isArray(prev) ? prev : [];
    const n = Array.isArray(next) ? next : [];
    if (!n.length) {
        return p;
    }
    if (!p.length) {
        return n;
    }
    /** @type {Map<string, Record<string, unknown>>} */
    const byKey = new Map();
    /** @param {unknown[]} arr */
    const ingest = (arr) => {
        for (let i = 0; i < arr.length; i += 1) {
            const it = arr[i];
            if (!it || typeof it !== "object") {
                continue;
            }
            const o = /** @type {Record<string, unknown>} */ (it);
            const role = normalizeTranscriptMergeRole_(o);
            const text = String(o.text ?? "").trim();
            const rich =
                o.rich && typeof o.rich === "object" && !Array.isArray(o.rich)
                    ? /** @type {Record<string, unknown>} */ (o.rich)
                    : null;
            const richSig = rich ? JSON.stringify(rich).slice(0, 240) : "";
            const seqRaw = o.seq;
            const seq =
                typeof seqRaw === "number" && Number.isFinite(seqRaw)
                    ? seqRaw
                    : typeof seqRaw === "string" && Number.isFinite(Number(seqRaw.trim()))
                      ? Number(seqRaw.trim())
                      : NaN;
            const atRaw = o.at;
            const at =
                typeof atRaw === "number" && Number.isFinite(atRaw)
                    ? atRaw
                    : typeof atRaw === "string" && Number.isFinite(Number(atRaw.trim()))
                      ? Number(atRaw.trim())
                      : NaN;
            const textNorm = normalizeTranscriptTextKey_(text);
            const isFormSummary =
                role === "assistant"
                && textNorm
                && (/^form submission\b/im.test(textNorm)
                    || (/thank you for sharing\.?$/i.test(textNorm)
                        && (textNorm.match(/\s-\s/g) || []).length >= 2));
            const key = isFormSummary
                ? `asstform|${textNorm}`
                : Number.isFinite(seq)
                  ? richSig
                      ? `seq:${seq}|${role}|${richSig}`
                      : `seq:${seq}|${role}|${textNorm}`
                  : Number.isFinite(at)
                    ? richSig
                        ? `at:${at}|${role}|${richSig}`
                        : `at:${at}|${role}|${textNorm}`
                    : richSig
                      ? `ord:${byKey.size}|${role}|${richSig}`
                      : `ord:${byKey.size}|${role}|${textNorm}`;
            if (!byKey.has(key)) {
                byKey.set(key, o);
            } else {
                const prevEntry = byKey.get(key);
                if (prevEntry && typeof prevEntry === "object") {
                    const merged = { ...prevEntry, ...o };
                    if (rich) {
                        merged.rich = rich;
                    }
                    const prevText = String(prevEntry.text ?? "").trim();
                    const nextText = String(o.text ?? "").trim();
                    if (!prevText && nextText) {
                        merged.text = nextText;
                    }
                    byKey.set(key, merged);
                }
            }
        }
    };
    ingest(p);
    ingest(n);
    const merged = Array.from(byKey.values());
    merged.sort((a, b) => {
        const sa =
            typeof a.seq === "number" && Number.isFinite(a.seq)
                ? a.seq
                : typeof a.seq === "string" && Number.isFinite(Number(a.seq))
                  ? Number(a.seq)
                  : 0;
        const sb =
            typeof b.seq === "number" && Number.isFinite(b.seq)
                ? b.seq
                : typeof b.seq === "string" && Number.isFinite(Number(b.seq))
                  ? Number(b.seq)
                  : 0;
        if (sa !== sb) {
            return sa - sb;
        }
        const aa = typeof a.at === "number" && Number.isFinite(a.at) ? a.at : 0;
        const ab = typeof b.at === "number" && Number.isFinite(b.at) ? b.at : 0;
        return aa - ab;
    });
    return merged.length > CHAT_TRANSCRIPT_MERGE_CAP
        ? merged.slice(-CHAT_TRANSCRIPT_MERGE_CAP)
        : merged;
}

/**
 * @param {*} qs
 * @returns {{ ref: import("firebase-admin/firestore").DocumentReference, data: FirestoreRecord, ms: number } | null}
 */
function newestDocFromQuerySnap_(qs) {
    if (!qs || qs.empty) {
        return null;
    }
    /** @type {{ ref: import("firebase-admin/firestore").DocumentReference, data: FirestoreRecord, ms: number } | null} */
    let best = null;
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
        if (!best || ms >= best.ms) {
            best = { ref: doc.ref, data, ms };
        }
    }
    return best;
}

/**
 * Merge live widget `client_context` (especially `chat_transcript`) into the newest lead doc for a session.
 * Used by session-sheet-sync so staff transcripts include bot lines after form submit without Sheet JSON.
 *
 * @param {string} sessionId
 * @param {Record<string, unknown>} clientContextPatch
 * @returns {Promise<boolean>}
 */
/**
 * Live `chat_transcript` for a widget session (updated on session-sheet-sync; not shown as a lead).
 *
 * @param {string} sessionId
 * @param {Record<string, unknown>} clientContextPatch
 */
export async function upsertSessionChatTranscriptDoc(sessionId, clientContextPatch) {
    firebaseAdminInit();
    const db = getFirestoreDb();
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || !clientContextPatch || typeof clientContextPatch !== "object") {
        return;
    }
    const ref = db.collection(SESSION_TRANSCRIPT_COLLECTION || "session_chat_transcripts").doc(sid);
    const snap = await ref.get();
    const prevCx =
        snap.exists
        && snap.data()
        && typeof snap.data().client_context === "object"
            ? /** @type {Record<string, unknown>} */ ({ .../** @type {Record<string, unknown>} */ (snap.data().client_context) })
            : {};
    const patchCx = { ...clientContextPatch };
    if (patchCx.chat_transcript != null) {
        patchCx.chat_transcript = coerceChatTranscriptArray_(patchCx.chat_transcript);
    }
    const merged = {
        ...prevCx,
        ...patchCx,
        client_session_id: sid,
        chat_transcript: mergeChatTranscriptArrays_(prevCx.chat_transcript, patchCx.chat_transcript)
    };
    const prevSeq = prevCx.chat_transcript_seq;
    const patchSeq = clientContextPatch.chat_transcript_seq;
    if (typeof patchSeq === "number" && Number.isFinite(patchSeq)) {
        merged.chat_transcript_seq =
            typeof prevSeq === "number" && Number.isFinite(prevSeq) ? Math.max(prevSeq, patchSeq) : patchSeq;
    } else if (typeof prevSeq === "number" && Number.isFinite(prevSeq)) {
        merged.chat_transcript_seq = prevSeq;
    }
    if (Array.isArray(clientContextPatch.user_queries) && clientContextPatch.user_queries.length) {
        merged.user_queries = clientContextPatch.user_queries;
    }
    const safeContext = sanitizeClientContextForFirestore_(merged);
    await ref.set(
        {
            client_session_id: sid,
            client_context: safeContext,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
    );
}

/**
 * @param {string} sessionId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchSessionChatTranscriptContext(sessionId) {
    firebaseAdminInit();
    const db = getFirestoreDb();
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid) {
        return null;
    }
    try {
        const snap = await db.collection(SESSION_TRANSCRIPT_COLLECTION || "session_chat_transcripts").doc(sid).get();
        if (!snap.exists) {
            return null;
        }
        const data = snap.data();
        if (data && typeof data.client_context === "object") {
            return /** @type {Record<string, unknown>} */ (data.client_context);
        }
    } catch {
        return null;
    }
    return null;
}

export async function patchLatestContactSubmissionClientContext(sessionId, clientContextPatch) {
    firebaseAdminInit();
    const db = getFirestoreDb();
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || !clientContextPatch || typeof clientContextPatch !== "object") {
        return false;
    }

    /** @type {{ ref: import("firebase-admin/firestore").DocumentReference, data: FirestoreRecord, ms: number } | null} */
    let hit = null;
    try {
        const snapTop = await db.collection(COLLECTION).where("client_session_id", "==", sid).limit(25).get();
        hit = newestDocFromQuerySnap_(snapTop);
    } catch {
        /* fall through */
    }
    if (!hit) {
        try {
            const snapNest = await db
                .collection(COLLECTION)
                .where("client_context.client_session_id", "==", sid)
                .limit(25)
                .get();
            hit = newestDocFromQuerySnap_(snapNest);
        } catch {
            return false;
        }
    }
    if (!hit) {
        return false;
    }

    const prevCx =
        hit.data.client_context && typeof hit.data.client_context === "object"
            ? /** @type {Record<string, unknown>} */ ({ .../** @type {Record<string, unknown>} */ (hit.data.client_context) })
            : {};
    const patchCx =
        clientContextPatch && typeof clientContextPatch === "object" ? { ...clientContextPatch } : {};
    if (patchCx.chat_transcript != null) {
        patchCx.chat_transcript = coerceChatTranscriptArray_(patchCx.chat_transcript);
    }

    const merged = {
        ...prevCx,
        ...patchCx,
        client_session_id:
            typeof patchCx.client_session_id === "string" && patchCx.client_session_id.trim()
                ? patchCx.client_session_id.trim()
                : typeof prevCx.client_session_id === "string"
                  ? prevCx.client_session_id
                  : sid,
        chat_transcript: mergeChatTranscriptArrays_(prevCx.chat_transcript, patchCx.chat_transcript)
    };
    const prevSeq = prevCx.chat_transcript_seq;
    const patchSeq = patchCx.chat_transcript_seq;
    if (typeof patchSeq === "number" && Number.isFinite(patchSeq)) {
        merged.chat_transcript_seq =
            typeof prevSeq === "number" && Number.isFinite(prevSeq) ? Math.max(prevSeq, patchSeq) : patchSeq;
    } else if (typeof prevSeq === "number" && Number.isFinite(prevSeq)) {
        merged.chat_transcript_seq = prevSeq;
    }

    if (Array.isArray(patchCx.user_queries) && patchCx.user_queries.length) {
        merged.user_queries = patchCx.user_queries;
    }

    const safeContext = sanitizeClientContextForFirestore_(merged);
    await hit.ref.update({
        client_context: safeContext,
        transcript_synced_at: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
}

export async function persistToFirestore(record) {
    // Ensure Admin app exists before Firestore use.
    firebaseAdminInit();
    const db = getFirestoreDb();
    const rec =
        record && typeof record === "object"
            ? /** @type {Record<string, unknown>} */ ({ .../** @type {Record<string, unknown>} */ (record) })
            : {};
    if (rec.client_context && typeof rec.client_context === "object") {
        rec.client_context = sanitizeClientContextForFirestore_(
            /** @type {Record<string, unknown>} */ (rec.client_context)
        );
    }
    try {
        await db.collection(COLLECTION).add({
            ...rec,
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
