/**
 * Single source of truth for Sheet1 "User Queries" — same merge as chatscript Summary.
 */

import { fetchSessionChatTranscriptContext } from "./firestore.mjs";
import {
    fetchLeadSheetUserQueriesForSession,
    mergeClientAuthoritativeQueriesPreservingHandoff_,
    sanitizeUserQueriesCsvForSheet
} from "./sheets.mjs";
import { mergedSheet1UserQueriesCsv_ } from "./live-agent/sheet-sync.mjs";

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

function isTranscriptLiveAgentSheetStatusLine_(text) {
    const t = String(text ?? "").trim();
    if (!t) {
        return false;
    }
    if (/^\[Live Agent\]/i.test(t)) {
        return true;
    }
    if (/^human agent requested$/i.test(t)) {
        return true;
    }
    if (/^connected with agent$/i.test(t)) {
        return true;
    }
    return (
        /Status:\s*/i.test(t)
        && /Dept:/i.test(t)
        && (/Queue:/i.test(t) || /Agent:/i.test(t))
    );
}

function shouldOmitTranscriptUserTurn_(text) {
    if (/^__form_closed:/i.test(String(text ?? "").trim())) {
        return false;
    }
    return isTranscriptLiveAgentSheetStatusLine_(text);
}

/** @param {string} raw */
function userQueryLineForDisplayAndSheet_(raw) {
    const t = trim_(raw);
    if (!t || isUserQuerySheetAndSummaryNoise_(t)) {
        return "";
    }
    return t;
}

/** @param {Record<string, unknown> | null | undefined} ctx */
function userQueryLinesFromContextOrdered_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return [];
    }
    /** @type {string[]} */
    const out = [];
    const uq = Array.isArray(ctx.user_queries) ? ctx.user_queries : [];
    for (let i = 0; i < uq.length; i += 1) {
        const raw = typeof uq[i] === "string" ? uq[i].trim() : "";
        if (!raw || shouldOmitTranscriptUserTurn_(raw)) {
            continue;
        }
        const line = userQueryLineForDisplayAndSheet_(raw);
        if (line) {
            out.push(line);
        }
    }
    return out;
}

/** @param {string} csv */
function userQueryLinesFromCsv_(csv) {
    const s = trim_(csv);
    if (!s) {
        return [];
    }
    const bits = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (!bits.length) {
        return [];
    }
    return bits.filter((text) => !isTranscriptLiveAgentSheetStatusLine_(text));
}

/** @param {Record<string, unknown> | null | undefined} ctx */
function normalizeUserQueriesCsvFromClientContext_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return "";
    }
    const lines = userQueryLinesFromContextOrdered_(ctx);
    if (!lines.length) {
        return "";
    }
    return sanitizeUserQueriesCsvForSheet(lines.join(", "), { preserveAllChatQueries: true });
}

/**
 * @param {string} sheetCsv
 * @param {Array<Record<string, unknown> | null | undefined>} contexts
 */
function mergeAuthoritativeUserQueriesCsv_(sheetCsv, contexts) {
    /** @type {string[]} */
    let best = userQueryLinesFromCsv_(sheetCsv);
    const list = Array.isArray(contexts) ? contexts : [];
    for (let i = 0; i < list.length; i += 1) {
        const ctx = list[i];
        if (!ctx || typeof ctx !== "object") {
            continue;
        }
        const fromCtx = userQueryLinesFromContextOrdered_(ctx);
        if (fromCtx.length > best.length) {
            best = fromCtx;
        }
    }
    return best.join(", ");
}

/**
 * Build Sheet1 User Queries CSV — mirrors chatscript Summary `meta.user_queries`.
 *
 * @param {string} sessionId
 * @param {{
 *   sheetCsv?: string,
 *   clientContext?: Record<string, unknown> | null,
 *   loadFirestoreContext?: boolean
 * }} [options]
 */
export async function buildAuthoritativeSheet1UserQueriesCsv_(sessionId, options = {}) {
    const sid = trim_(sessionId);
    if (!sid) {
        return "";
    }

    let sheetCsv = options.sheetCsv;
    if (sheetCsv === undefined) {
        try {
            const got = await fetchLeadSheetUserQueriesForSession(sid);
            sheetCsv = got && typeof got.csv === "string" ? got.csv : "";
        } catch {
            sheetCsv = "";
        }
    }

    let csv = "";
    try {
        csv = (await mergedSheet1UserQueriesCsv_(sid, sheetCsv || "")) || sheetCsv || "";
    } catch {
        csv = sheetCsv || "";
    }

    /** @type {Record<string, unknown>[]} */
    const contexts = [];
    if (options.clientContext && typeof options.clientContext === "object") {
        contexts.push(options.clientContext);
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

    for (let i = 0; i < contexts.length; i += 1) {
        const clientCsv = normalizeUserQueriesCsvFromClientContext_(contexts[i]);
        if (clientCsv) {
            csv = mergeClientAuthoritativeQueriesPreservingHandoff_(csv, clientCsv);
        }
    }

    csv = mergeAuthoritativeUserQueriesCsv_(csv, contexts);
    return sanitizeUserQueriesCsvForSheet(csv, { preserveAllChatQueries: true });
}
