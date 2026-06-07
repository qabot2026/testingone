/**
 * Append live-agent handoff chat to Sheet1 User Queries (bot lines preserved).
 * Queue status lives on the Live Agent tab — not in User Queries.
 */

import { createRequire } from "node:module";

import { formatChannelForSheetDisplay, upsertSessionQueriesInSheet } from "../sheets.mjs";
import { loadSessionForLiveAgentSheet } from "./firestore-bridge.mjs";

const require = createRequire(import.meta.url);

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
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

    const liveAgentSheet = require("../refer-staff/live-agent-sheet.js");
    const handoffCsv =
        liveAgentSheet && typeof liveAgentSheet.buildSheet1LiveAgentHandoffQueries === "function"
            ? liveAgentSheet.buildSheet1LiveAgentHandoffQueries(session)
            : "Human Agent Requested";
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
            name: trim(session.visitorName) || trim(meta.name) || "",
            mobile: trim(meta.mobile) || trim(meta.phone) || "",
            email: trim(meta.email) || "",
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
