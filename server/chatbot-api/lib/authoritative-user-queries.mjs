/**
 * Single source of truth for Sheet1 "User Queries" — same merge as chatscript Summary.
 */

import { createRequire } from "node:module";

import { fetchSessionChatTranscriptContext } from "./firestore.mjs";
import {
    assembleFullUserQueriesCsv_,
    fetchLeadSheetUserQueriesForSession,
    LIVE_AGENT_ENDED_USER_QUERY_MARKER,
    mergeUserQueriesCsvPreferRicher_,
    sanitizeUserQueriesCsvForSheet
} from "./sheets.mjs";
import { mergedSheet1UserQueriesCsv_ } from "./live-agent/sheet-sync.mjs";

const require = createRequire(import.meta.url);

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function isUserQuerySheetAndSummaryNoise_(raw) {
    const t = trim_(raw);
    if (!t) {
        return true;
    }
    if (/^__form_closed:/i.test(t)) {
        return true;
    }
    if (/\bform\s+closed\.?$/i.test(t)) {
        return true;
    }
    return false;
}

function isConnectedWithAgentMarker_(raw) {
    return /^connected with agent$/i.test(trim_(raw));
}

/** Ordered widget lines for sheet assembly (keeps phase markers used for splitting). */
function userQueryLinesFromContextForSheet_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return [];
    }
    /** @type {string[]} */
    const out = [];
    const uq = Array.isArray(ctx.user_queries) ? ctx.user_queries : [];
    for (let i = 0; i < uq.length; i += 1) {
        const raw = typeof uq[i] === "string" ? uq[i].trim() : "";
        if (!raw) {
            continue;
        }
        if (raw === LIVE_AGENT_ENDED_USER_QUERY_MARKER || isConnectedWithAgentMarker_(raw)) {
            out.push(isConnectedWithAgentMarker_(raw) ? "Connected with Agent" : raw);
            continue;
        }
        if (/^\[Live Agent\]/i.test(raw)) {
            continue;
        }
        if (/^human agent requested$/i.test(raw)) {
            continue;
        }
        if (
            /Status:\s*/i.test(raw)
            && /Dept:/i.test(raw)
            && (/Queue:/i.test(raw) || /Agent:/i.test(raw))
        ) {
            continue;
        }
        const line = isUserQuerySheetAndSummaryNoise_(raw) ? "" : raw;
        if (line) {
            out.push(line);
        }
    }
    return out;
}

/** Prefer the fullest context; when tied, prefer one that recorded agent disconnect. */
function bestUserQueryLinesFromContexts_(contexts) {
    /** @type {string[]} */
    let best = [];
    /** @type {string[]} */
    let bestEnded = [];
    const list = Array.isArray(contexts) ? contexts : [];
    for (let i = 0; i < list.length; i += 1) {
        const ctx = list[i];
        if (!ctx || typeof ctx !== "object") {
            continue;
        }
        const fromCtx = userQueryLinesFromContextForSheet_(ctx);
        if (fromCtx.length > best.length) {
            best = fromCtx;
        }
        if (
            fromCtx.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER)
            && fromCtx.length >= bestEnded.length
        ) {
            bestEnded = fromCtx;
        }
    }
    if (bestEnded.length) {
        return bestEnded.length >= best.length ? bestEnded : best;
    }
    return best;
}

/**
 * Build Sheet1 User Queries CSV — mirrors chatscript Summary `meta.user_queries`.
 *
 * @param {string} sessionId
 * @param {{
 *   sheetCsv?: string,
 *   clientContext?: Record<string, unknown> | null,
 *   contexts?: Array<Record<string, unknown> | null | undefined>,
 *   loadFirestoreContext?: boolean
 * }} [options]
 */
export async function buildAuthoritativeSheet1UserQueriesCsv_(sessionId, options = {}) {
    const sid = trim_(sessionId);
    if (!sid) {
        return "";
    }

    /** @type {Record<string, unknown>[]} */
    const contexts = [];
    if (Array.isArray(options.contexts)) {
        for (let i = 0; i < options.contexts.length; i += 1) {
            const ctx = options.contexts[i];
            if (ctx && typeof ctx === "object") {
                contexts.push(ctx);
            }
        }
    }
    if (options.clientContext && typeof options.clientContext === "object") {
        const dup = contexts.some((c) => c === options.clientContext);
        if (!dup) {
            contexts.push(options.clientContext);
        }
    }

    if (options.loadFirestoreContext !== false) {
        try {
            const fsCx = await fetchSessionChatTranscriptContext(sid);
            if (fsCx && typeof fsCx === "object") {
                const dup = contexts.some((c) => c === fsCx);
                if (!dup) {
                    contexts.push(fsCx);
                }
            }
        } catch {
            /* ignore */
        }
    }

    const clientLines = bestUserQueryLinesFromContexts_(contexts);

    let sheetCsvExisting = "";
    if (options.sheetCsv === undefined) {
        try {
            const got = await fetchLeadSheetUserQueriesForSession(sid);
            sheetCsvExisting = got && typeof got.csv === "string" ? got.csv.trim() : "";
        } catch {
            sheetCsvExisting = "";
        }
    } else {
        sheetCsvExisting = typeof options.sheetCsv === "string" ? options.sheetCsv.trim() : "";
    }

    let handoffCsv = "";
    try {
        handoffCsv = (await mergedSheet1UserQueriesCsv_(sid, "")) || "";
    } catch {
        handoffCsv = "";
    }

    let csv = assembleFullUserQueriesCsv_(clientLines, handoffCsv);

    if (!csv && clientLines.length) {
        csv = sanitizeUserQueriesCsvForSheet(clientLines.join(", "), { preserveAllChatQueries: true });
    }

    if (sheetCsvExisting) {
        csv = mergeUserQueriesCsvPreferRicher_(sheetCsvExisting, csv || "");
    }

    return csv;
}
