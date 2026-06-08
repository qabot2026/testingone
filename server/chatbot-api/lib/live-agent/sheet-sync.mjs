/**
 * Append live-agent handoff chat to Sheet1 User Queries (bot lines preserved).
 * Queue status lives on the Live Agent tab — not in User Queries.
 */

import { createRequire } from "node:module";

import {
    formatChannelForSheetDisplay,
    formatMobileForSheetDisplay,
    upsertSessionQueriesInSheet
} from "../sheets.mjs";
import { isSheet1SyncExcluded_ } from "../sheet-sync-suppression.mjs";
import { loadSessionForLiveAgentSheet } from "./firestore-bridge.mjs";

const require = createRequire(import.meta.url);

const sheet1SyncTimers = new Map();
const sheet1SyncChains = new Map();

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function splitCsvValues_(raw) {
    const s = typeof raw === "string" ? raw : "";
    if (!s.trim()) {
        return [];
    }
    return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
}

function isLiveAgentHandoffCsvSegment_(seg) {
    const t = String(seg ?? "").trim();
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

/** Keep bot queries before the first handoff marker; replace the handoff tail on each sync. */
function mergeHandoffIntoUserQueriesCsv_(existingCsv, newHandoffCsv) {
    const all = splitCsvValues_(existingCsv);
    let cut = all.length;
    for (let i = 0; i < all.length; i += 1) {
        if (isLiveAgentHandoffCsvSegment_(all[i])) {
            cut = i;
            break;
        }
    }
    const bot = all.slice(0, cut);
    const handoff = splitCsvValues_(typeof newHandoffCsv === "string" ? newHandoffCsv.trim() : "");
    if (!handoff.length) {
        return bot.join(", ");
    }
    return [...bot, ...handoff].join(", ");
}

/**
 * Debounced Sheet1 User Queries sync while live-agent chat is active (mirrors Sheet2 schedule).
 *
 * @param {string} sessionId
 */
export function scheduleLiveAgentSheet1Sync_(sessionId) {
    const sid = trim_(sessionId);
    if (!sid) {
        return;
    }
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return;
    }
    if (sheet1SyncTimers.has(sid)) {
        clearTimeout(sheet1SyncTimers.get(sid));
    }
    sheet1SyncTimers.set(
        sid,
        setTimeout(() => {
            sheet1SyncTimers.delete(sid);
            const prev = sheet1SyncChains.get(sid) || Promise.resolve();
            const job = prev
                .then(() => syncLiveAgentToSheet_(sid))
                .catch((err) => {
                    console.warn("[live-agent/sheet-sync]", err.message || err);
                });
            sheet1SyncChains.set(sid, job);
            void job.finally(() => {
                if (sheet1SyncChains.get(sid) === job) {
                    sheet1SyncChains.delete(sid);
                }
            });
        }, 2500)
    );
}

/**
 * Merge Firestore live-agent visitor queries into an existing Sheet1 User Queries CSV (read-only).
 *
 * @param {string} sessionId
 * @param {string} existingCsv
 */
export async function mergedSheet1UserQueriesCsv_(sessionId, existingCsv) {
    const id = trim_(sessionId);
    const base = typeof existingCsv === "string" ? existingCsv.trim() : "";
    if (!id) {
        return base;
    }
    let session = null;
    try {
        session = await loadSessionForLiveAgentSheet(id);
    } catch (err) {
        console.warn("[live-agent/sheet-sync] merge queries:", err.message || err);
        return base;
    }
    if (!session) {
        return base;
    }
    const liveAgentSheet = require("../refer-staff/live-agent-sheet.js");
    const handoff =
        liveAgentSheet && typeof liveAgentSheet.buildSheet1LiveAgentHandoffQueries === "function"
            ? liveAgentSheet.buildSheet1LiveAgentHandoffQueries(session)
            : "";
    if (!handoff) {
        return base;
    }
    return mergeHandoffIntoUserQueriesCsv_(base, handoff);
}

/**
 * @param {string} conversationId session id
 */
export async function syncLiveAgentToSheet_(conversationId) {
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return { ok: false, skipped: "sheets_disabled" };
    }
    const id = trim_(conversationId);
    if (!id) {
        return { ok: false, skipped: "no_id" };
    }

    let session = null;
    try {
        session = await loadSessionForLiveAgentSheet(id);
    } catch (err) {
        console.warn("[live-agent/sheet-sync]", err.message || err);
        return { ok: false, error: err.message || String(err) };
    }
    if (!session) {
        return { ok: false, skipped: "no_session" };
    }

    if (await isSheet1SyncExcluded_(id)) {
        return { ok: false, skipped: "sheet1_excluded" };
    }

    const liveAgentSheet = require("../refer-staff/live-agent-sheet.js");
    const handoffCsv =
        liveAgentSheet && typeof liveAgentSheet.buildSheet1LiveAgentHandoffQueries === "function"
            ? liveAgentSheet.buildSheet1LiveAgentHandoffQueries(session)
            : "";
    if (!handoffCsv) {
        return { ok: false, skipped: "empty_handoff_queries" };
    }

    const meta =
        session._sheetMeta && typeof session._sheetMeta === "object" ? session._sheetMeta : {};
    let channel = "";
    try {
        channel = formatChannelForSheetDisplay(session.channel || "web");
    } catch {
        channel = formatChannelForSheetDisplay("web");
    }

    try {
        /** @type {Parameters<typeof upsertSessionQueriesInSheet>[0]} */
        const row = {
            clientSessionId: id,
            name: trim_(session.visitorName) || trim_(meta.name) || "",
            mobile: formatMobileForSheetDisplay(trim_(meta.mobile) || trim_(meta.phone) || "", meta),
            email: trim_(meta.email) || "",
            browserName: "",
            deviceType: "",
            channel,
            userQueriesCsv: handoffCsv,
            replaceLiveAgentHandoffBlock: true,
            lightweightSessionSync: false
        };
        const result = await upsertSessionQueriesInSheet(row);
        return { ok: true, result };
    } catch (err) {
        console.warn("[live-agent/sheet-sync]", err.message || err);
        return { ok: false, error: err.message || String(err) };
    }
}
