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
        if (raw === LIVE_AGENT_ENDED_USER_QUERY_MARKER) {
            out.push(raw);
            continue;
        }
        if (isConnectedWithAgentMarker_(raw)) {
            out.push("Connected with Agent");
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

function userQueryLineKey_(line) {
    return String(line ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

/**
 * Merge widget + Firestore `user_queries` without dropping post-agent lines.
 * Stale Firestore snapshots can be longer but miss `__live_agent_ended__`; always union post-end lines.
 *
 * @param {Record<string, unknown>[]} contexts
 * @param {Record<string, unknown> | null | undefined} [primaryContext] live request context wins as base
 */
function mergeUserQueryLinesFromContexts_(contexts, primaryContext) {
    /** @type {{ lines: string[], lastAt: number, isPrimary: boolean }[]} */
    const parsed = [];
    const list = Array.isArray(contexts) ? contexts : [];

    if (primaryContext && typeof primaryContext === "object") {
        const lines = userQueryLinesFromContextForSheet_(primaryContext);
        if (lines.length) {
            const lastAt =
                typeof primaryContext.user_queries_last_at === "number"
                && Number.isFinite(primaryContext.user_queries_last_at)
                    ? primaryContext.user_queries_last_at
                    : Number.MAX_SAFE_INTEGER;
            parsed.push({ lines, lastAt, isPrimary: true });
        }
    }

    for (let i = 0; i < list.length; i += 1) {
        const ctx = list[i];
        if (!ctx || typeof ctx !== "object") {
            continue;
        }
        if (ctx === primaryContext) {
            continue;
        }
        const lines = userQueryLinesFromContextForSheet_(ctx);
        if (!lines.length) {
            continue;
        }
        const lastAt =
            typeof ctx.user_queries_last_at === "number" && Number.isFinite(ctx.user_queries_last_at)
                ? ctx.user_queries_last_at
                : 0;
        parsed.push({ lines, lastAt, isPrimary: false });
    }

    if (!parsed.length) {
        return [];
    }
    if (parsed.length === 1) {
        return parsed[0].lines;
    }

    let baseIdx = parsed.findIndex((p) => p.isPrimary);
    if (baseIdx < 0) {
        baseIdx = 0;
        for (let i = 0; i < parsed.length; i += 1) {
            const cur = parsed[i];
            const base = parsed[baseIdx];
            const curHasEnd = cur.lines.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
            const baseHasEnd = base.lines.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
            if (curHasEnd && !baseHasEnd) {
                baseIdx = i;
            } else if (curHasEnd && baseHasEnd) {
                if (
                    cur.lastAt > base.lastAt
                    || (cur.lastAt === base.lastAt && cur.lines.length > base.lines.length)
                ) {
                    baseIdx = i;
                }
            } else if (!baseHasEnd) {
                if (
                    cur.lastAt > base.lastAt
                    || (cur.lastAt === base.lastAt && cur.lines.length > base.lines.length)
                ) {
                    baseIdx = i;
                }
            }
        }
    }

    const merged = parsed[baseIdx].lines.slice();
    /** @type {Set<string>} */
    const seen = new Set(merged.map((line) => userQueryLineKey_(line)).filter(Boolean));

    /** @type {string[]} */
    const postEndUnion = [];
    let anyEndMarker = merged.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER);

    for (let i = 0; i < parsed.length; i += 1) {
        const { lines } = parsed[i];
        if (lines.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER)) {
            anyEndMarker = true;
        }
        const endIdx = lines.indexOf(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
        if (endIdx < 0) {
            continue;
        }
        for (let j = endIdx + 1; j < lines.length; j += 1) {
            const line = lines[j];
            const k = userQueryLineKey_(line);
            if (!k || seen.has(k)) {
                continue;
            }
            seen.add(k);
            postEndUnion.push(line);
        }
    }

    if (postEndUnion.length) {
        if (!merged.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER)) {
            merged.push(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
        }
        merged.push(...postEndUnion);
    } else if (anyEndMarker && !merged.includes(LIVE_AGENT_ENDED_USER_QUERY_MARKER)) {
        merged.push(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
    }

    return merged;
}

/** Lines after `__live_agent_ended__` in widget context — always append to assembled CSV tail. */
function postAgentWidgetLinesFromMerged_(clientLines) {
    const lines = Array.isArray(clientLines) ? clientLines : [];
    const endIdx = lines.indexOf(LIVE_AGENT_ENDED_USER_QUERY_MARKER);
    if (endIdx < 0) {
        return [];
    }
    /** @type {string[]} */
    const out = [];
    for (let i = endIdx + 1; i < lines.length; i += 1) {
        const raw = String(lines[i] ?? "").trim();
        if (!raw || raw === LIVE_AGENT_ENDED_USER_QUERY_MARKER || isConnectedWithAgentMarker_(raw)) {
            continue;
        }
        if (isUserQuerySheetAndSummaryNoise_(raw)) {
            continue;
        }
        out.push(raw);
    }
    return out;
}

function appendPostAgentWidgetLinesToCsv_(assembledCsv, postWidgetLines) {
    const postLines = Array.isArray(postWidgetLines) ? postWidgetLines : [];
    if (!postLines.length) {
        return typeof assembledCsv === "string" ? assembledCsv.trim() : "";
    }
    const postCsv = sanitizeUserQueriesCsvForSheet(postLines.join(", "), {
        preserveAllChatQueries: true
    });
    return mergeUserQueriesCsvPreferRicher_(assembledCsv || "", postCsv);
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

    const clientLines = mergeUserQueryLinesFromContexts_(contexts, options.clientContext);

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

    csv = appendPostAgentWidgetLinesToCsv_(csv || "", postAgentWidgetLinesFromMerged_(clientLines));

    try {
        const { loadSessionForLiveAgentSheet } = await import("./live-agent/firestore-bridge.mjs");
        const laSession = await loadSessionForLiveAgentSheet(sid);
        if (laSession) {
            const liveAgentSheet = require("../refer-staff/live-agent-sheet.js");
            if (typeof liveAgentSheet.collectPostAgentUserQueryLines_ === "function") {
                const postAgentLines = liveAgentSheet.collectPostAgentUserQueryLines_(laSession);
                csv = appendPostAgentWidgetLinesToCsv_(csv || "", postAgentLines);
            }
        }
    } catch {
        /* non-fatal */
    }

    if (sheetCsvExisting) {
        csv = mergeUserQueriesCsvPreferRicher_(sheetCsvExisting, csv || "");
    }

    return csv;
}
