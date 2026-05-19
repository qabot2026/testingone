/**
 * Normalize widget / Firestore chat payloads into countable transcript turns (metrics + Sheets).
 */

/** @param {unknown} raw */
export function coerceChatTranscriptArray_(raw) {
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

/** @param {unknown} raw */
function coerceTranscriptAtMs_(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    if (raw && typeof raw === "object") {
        const o = /** @type {{ seconds?: unknown, _seconds?: unknown }} */ (raw);
        const sec =
            typeof o.seconds === "number" && Number.isFinite(o.seconds)
                ? o.seconds
                : typeof o._seconds === "number" && Number.isFinite(o._seconds)
                  ? o._seconds
                  : NaN;
        if (Number.isFinite(sec)) {
            return sec * 1000;
        }
    }
    return undefined;
}

/** @param {Record<string, unknown>} rec */
function transcriptItemLooksLikeCxAssistantPayload_(rec) {
    if (rec.fulfillment_response || rec.fulfillmentResponse) {
        return true;
    }
    const pl = rec.payload;
    if (pl && typeof pl === "object") {
        const p = /** @type {Record<string, unknown>} */ (pl);
        if (p.fulfillment_response || p.fulfillmentResponse) {
            return true;
        }
    }
    const tx = rec.text;
    if (tx && typeof tx === "object" && !Array.isArray(tx)) {
        const nest = /** @type {{ text?: unknown }} */ (tx).text;
        if (Array.isArray(nest) && nest.some((x) => typeof x === "string" && x.trim())) {
            return true;
        }
    }
    return false;
}

/**
 * @param {Record<string, unknown>} rec
 * @returns {"user"|"assistant"|"agent"}
 */
export function normalizeTranscriptItemRole_(rec) {
    const raw =
        rec.role
        ?? rec.type
        ?? rec.sender
        ?? rec.participant
        ?? rec.author
        ?? rec.messageFrom
        ?? rec.source
        ?? rec.speaker;
    const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (r === "staff" || r === "human_agent" || r === "live_agent" || r === "agent") {
        return "agent";
    }
    if (
        r === "assistant"
        || r === "bot"
        || r === "model"
        || r === "virtual_agent"
        || r === "df-bot"
        || r.includes("automated")
        || r === "system"
    ) {
        return "assistant";
    }
    if (r === "user" || r === "human" || r === "customer" || r === "client" || r === "end_user" || r === "enduser") {
        return "user";
    }
    if (transcriptItemLooksLikeCxAssistantPayload_(rec)) {
        return "assistant";
    }
    return "user";
}

/**
 * @param {Record<string, unknown>} o
 * @param {number} [depth]
 */
export function transcriptTurnTextFromItem_(o, depth = 0) {
    if (!o || typeof o !== "object" || depth > 8) {
        return "";
    }
    const rec = /** @type {Record<string, unknown>} */ (o);
    const cxTextNest = rec.text;
    if (cxTextNest && typeof cxTextNest === "object" && !Array.isArray(cxTextNest)) {
        const nest = /** @type {{ text?: unknown }} */ (cxTextNest).text;
        if (Array.isArray(nest)) {
            /** @type {string[]} */
            const bits = [];
            for (const x of nest) {
                if (typeof x === "string" && x.trim()) {
                    bits.push(x.trim());
                }
            }
            if (bits.length) {
                return bits.join("\n");
            }
        }
    }
    /** @param {unknown} v */
    const stringLeaf = (v) => {
        if (typeof v === "string" && v.trim()) {
            return v.trim();
        }
        if (
            v
            && typeof v === "object"
            && typeof /** @type {{ text?: unknown }} */ (v).text === "string"
            && String(/** @type {{ text?: string }} */ (v).text).trim()
        ) {
            return String(/** @type {{ text?: string }} */ (v).text).trim();
        }
        return "";
    };
    for (const k of ["text", "message", "content", "body", "query"]) {
        const leaf = stringLeaf(rec[k]);
        if (leaf) {
            return leaf;
        }
    }
    for (const k of ["outputText", "displayText"]) {
        if (typeof rec[k] === "string" && String(rec[k]).trim()) {
            return String(rec[k]).trim();
        }
    }
    const fr = rec.fulfillment_response || rec.fulfillmentResponse;
    if (fr && typeof fr === "object") {
        const msgs = /** @type {{ messages?: unknown[] }} */ (fr).messages;
        if (Array.isArray(msgs) && msgs.length) {
            /** @type {string[]} */
            const bits = [];
            for (let mi = 0; mi < msgs.length; mi += 1) {
                const m = msgs[mi];
                const sub =
                    m && typeof m === "object"
                        ? transcriptTurnTextFromItem_(/** @type {Record<string, unknown>} */ (m), depth + 1)
                        : "";
                if (sub) {
                    bits.push(sub);
                }
            }
            if (bits.length) {
                return bits.join("\n\n");
            }
        }
    }
    return "";
}

/** @param {string} text */
function isFormSubmissionLine_(text) {
    return /^form submission\b/i.test(String(text || "").trim());
}

/**
 * @param {unknown} item
 * @param {number} ord
 * @returns {{ role: string, text: string, at: number, seq?: number } | null}
 */
function turnFromTranscriptItem_(item, ord) {
    if (!item || typeof item !== "object") {
        return null;
    }
    const o = /** @type {Record<string, unknown>} */ (item);
    const text = transcriptTurnTextFromItem_(o);
    if (!text || isFormSubmissionLine_(text)) {
        return null;
    }
    const role = normalizeTranscriptItemRole_(o);
    const atMs = coerceTranscriptAtMs_(o.at);
    const at = typeof atMs === "number" && Number.isFinite(atMs) ? atMs : ord + 1;
    const rawSeq = o.seq;
    const seq =
        typeof rawSeq === "number" && Number.isFinite(rawSeq)
            ? rawSeq
            : typeof rawSeq === "string" && Number.isFinite(Number(rawSeq.trim()))
              ? Number(rawSeq.trim())
              : undefined;
    /** @type {{ role: string, text: string, at: number, seq?: number }} */
    const row = { role, text, at };
    if (seq !== undefined) {
        row.seq = seq;
    }
    return row;
}

/** @param {unknown} cx */
function turnsFromUserQueriesList_(cx) {
    const o = cx && typeof cx === "object" ? /** @type {Record<string, unknown>} */ (cx) : {};
    const uq = o.user_queries;
    /** @type {{ role: string, text: string, at: number }[]} */
    const out = [];
    if (!Array.isArray(uq)) {
        return out;
    }
    const baseAt =
        typeof o.user_queries_last_at === "number" && Number.isFinite(o.user_queries_last_at)
            ? o.user_queries_last_at
            : Date.now();
    for (let i = 0; i < uq.length; i += 1) {
        const item = uq[i];
        if (typeof item === "string" && item.trim() && !isFormSubmissionLine_(item)) {
            out.push({ role: "user", text: item.trim(), at: baseAt - (uq.length - i) * 1000 });
            continue;
        }
        if (item && typeof item === "object") {
            const rec = /** @type {Record<string, unknown>} */ (item);
            const text =
                transcriptTurnTextFromItem_(rec)
                || (typeof rec.query === "string" ? rec.query.trim() : "")
                || (typeof rec.text === "string" ? rec.text.trim() : "");
            if (text && !isFormSubmissionLine_(text)) {
                const atMs = coerceTranscriptAtMs_(rec.at);
                out.push({
                    role: "user",
                    text,
                    at: typeof atMs === "number" ? atMs : baseAt - (uq.length - i) * 1000
                });
            }
        }
    }
    return out;
}

/** @param {unknown} cx */
function turnsFromAssistantQueriesList_(cx) {
    const o = cx && typeof cx === "object" ? /** @type {Record<string, unknown>} */ (cx) : {};
    const aq = o.assistant_queries;
    /** @type {{ role: string, text: string, at: number }[]} */
    const out = [];
    if (!Array.isArray(aq)) {
        return out;
    }
    const baseAt =
        typeof o.assistant_queries_last_at === "number" && Number.isFinite(o.assistant_queries_last_at)
            ? o.assistant_queries_last_at
            : typeof o.user_queries_last_at === "number" && Number.isFinite(o.user_queries_last_at)
              ? o.user_queries_last_at
              : Date.now();
    for (let i = 0; i < aq.length; i += 1) {
        const item = aq[i];
        if (typeof item === "string" && item.trim() && !isFormSubmissionLine_(item)) {
            out.push({
                role: "assistant",
                text: item.trim(),
                at: baseAt - (aq.length - i) * 1000 + 500
            });
            continue;
        }
        if (item && typeof item === "object") {
            const rec = /** @type {Record<string, unknown>} */ (item);
            const text = transcriptTurnTextFromItem_(rec);
            if (text && !isFormSubmissionLine_(text)) {
                const atMs = coerceTranscriptAtMs_(rec.at);
                const role = normalizeTranscriptItemRole_(rec);
                out.push({
                    role: role === "user" ? "user" : "assistant",
                    text,
                    at:
                        typeof atMs === "number" && Number.isFinite(atMs)
                            ? atMs
                            : baseAt - (aq.length - i) * 1000 + 500
                });
            }
        }
    }
    return out;
}

/** @param {{ role: string, text: string, at?: number, seq?: number }} t */
function turnDedupKey_(t) {
    const role = String(t.role || "").toLowerCase();
    const text = String(t.text || "")
        .trim()
        .toLowerCase()
        .slice(0, 200);
    const seq = typeof t.seq === "number" ? t.seq : "";
    return `${role}|${text}|${seq}`;
}

/**
 * @param {{ role: string, text: string, at: number, seq?: number }[]} turns
 */
function sortTurnsDialogOrder_(turns) {
    if (!turns.length) {
        return turns;
    }
    const seqCount = turns.filter((t) => typeof t.seq === "number" && Number.isFinite(t.seq)).length;
    if (seqCount === turns.length) {
        turns.sort((a, b) => /** @type {number} */ (a.seq) - /** @type {number} */ (b.seq));
        return turns;
    }
    const maxAt = Math.max(...turns.map((t) => t.at));
    const minAt = Math.min(...turns.map((t) => t.at));
    const allEpochMs = minAt > 1_000_000_000_000 && maxAt > 1_000_000_000_000;
    const allEpochSec = !allEpochMs && minAt > 1_000_000_000 && maxAt > 1_000_000_000;
    if (allEpochMs || allEpochSec) {
        turns.sort((a, b) => a.at - b.at);
        return turns;
    }
    return turns;
}

/**
 * Normalize `at` to 0, 1000, 2000… so response-time math works when sources mixed epoch ms + index stamps.
 *
 * @param {{ role: string, text: string, at: number, seq?: number }[]} turns
 */
function assignMonotonicTurnTimesForMetrics_(turns) {
    if (!turns.length) {
        return turns;
    }
    const sorted = sortTurnsDialogOrder_(turns.slice());
    return sorted.map((t, i) => ({
        ...t,
        at: i * 1000
    }));
}

/**
 * @param {{ role: string, text: string, at: number, seq?: number }[]} turns
 */
function mergeTurnLists_(...lists) {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {{ role: string, text: string, at: number, seq?: number }[]} */
    const out = [];
    for (let li = 0; li < lists.length; li += 1) {
        const list = lists[li];
        if (!Array.isArray(list)) {
            continue;
        }
        for (let i = 0; i < list.length; i += 1) {
            const t = list[i];
            if (!t || !t.text) {
                continue;
            }
            const key = turnDedupKey_(t);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(t);
        }
    }
    return assignMonotonicTurnTimesForMetrics_(out);
}

/**
 * @param {unknown} clientContext
 * @returns {{ role: string, text: string, at: number, seq?: number }[]}
 */
export function buildTranscriptTurnsFromClientContext_(clientContext) {
    const cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? /** @type {Record<string, unknown>} */ (clientContext)
            : {};
    /** @type {{ role: string, text: string, at: number, seq?: number }[]} */
    const fromTranscript = [];
    const raw = coerceChatTranscriptArray_(cx.chat_transcript);
    for (let i = 0; i < raw.length; i += 1) {
        const row = turnFromTranscriptItem_(raw[i], i);
        if (row) {
            fromTranscript.push(row);
        }
    }
    if (fromTranscript.length) {
        sortTurnsDialogOrder_(fromTranscript);
    }
    return mergeTurnLists_(fromTranscript, turnsFromUserQueriesList_(cx), turnsFromAssistantQueriesList_(cx));
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function mergeClientContextRecords_(a, b) {
    const A = a && typeof a === "object" && !Array.isArray(a) ? /** @type {Record<string, unknown>} */ (a) : {};
    const B = b && typeof b === "object" && !Array.isArray(b) ? /** @type {Record<string, unknown>} */ (b) : {};
    const turnsA = buildTranscriptTurnsFromClientContext_(A);
    const turnsB = buildTranscriptTurnsFromClientContext_(B);
    const mergedTurns = mergeTurnLists_(turnsA, turnsB);
    return {
        ...A,
        ...B,
        chat_transcript: mergedTurns,
        user_queries: Array.isArray(B.user_queries) && B.user_queries.length
            ? B.user_queries
            : A.user_queries,
        assistant_queries: Array.isArray(B.assistant_queries) && B.assistant_queries.length
            ? B.assistant_queries
            : A.assistant_queries
    };
}

/**
 * @param {unknown} clientContext
 * @param {{ sessionId?: string, incomingRow?: unknown, fetchFirestore?: boolean }} [opts]
 */
export async function enrichClientContextForSheetMetricsAsync_(clientContext, opts = {}) {
    let cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? { .../** @type {Record<string, unknown>} */ (clientContext) }
            : {};
    const row =
        opts.incomingRow && typeof opts.incomingRow === "object" && !Array.isArray(opts.incomingRow)
            ? /** @type {Record<string, unknown>} */ (opts.incomingRow)
            : {};
    if (!coerceChatTranscriptArray_(cx.chat_transcript).length) {
        const json = row.chatTranscriptJson;
        if (typeof json === "string" && json.trim()) {
            const parsed = coerceChatTranscriptArray_(json);
            if (parsed.length) {
                cx.chat_transcript = parsed;
            }
        }
    }
    const sid = typeof opts.sessionId === "string" ? opts.sessionId.trim() : "";
    const wantFs = opts.fetchFirestore !== false;
    if (sid && wantFs && process.env.DISABLE_FIRESTORE !== "1") {
        try {
            const { fetchSessionChatTranscriptContext, fetchLatestContactSubmissionForClientSession } =
                await import("./firestore.mjs");
            const [live, leadRec] = await Promise.all([
                fetchSessionChatTranscriptContext(sid),
                fetchLatestContactSubmissionForClientSession(sid)
            ]);
            if (live && typeof live === "object") {
                cx = mergeClientContextRecords_(cx, live);
            }
            const leadCx =
                leadRec
                && typeof leadRec === "object"
                && leadRec.client_context
                && typeof leadRec.client_context === "object"
                    ? leadRec.client_context
                    : null;
            if (leadCx) {
                cx = mergeClientContextRecords_(cx, leadCx);
            }
        } catch (e) {
            const m = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
            console.warn("[chatbot-api] enrichClientContextForSheetMetrics Firestore:", m.slice(0, 200));
        }
    }
    const turns = buildTranscriptTurnsFromClientContext_(cx);
    cx.chat_transcript = turns;
    return cx;
}
