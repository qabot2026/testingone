/**
 * Upsert live-agent queue state onto the conversations Google Sheet row (same session id).
 */

import { upsertSessionQueriesInSheet } from "../sheets.mjs";
import { getConversation_ } from "./store.mjs";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function liveAgentSheetLine_(conv) {
    if (!conv) return "";
    const parts = [
        "[Live Agent]",
        "Status: " + (conv.status || "—"),
        "Dept: " + (conv.departmentName || conv.departmentId || "General"),
        "Queue: " + (conv.currentAssigneeEmail || "unassigned"),
        "Agent: " + (conv.assignedAgentEmail || "—"),
        conv.visitorSessionActive === false ? "Visitor: ended" : "Visitor: active"
    ];
    return parts.join(" | ");
}

/**
 * @param {string} conversationId session id
 */
export async function syncLiveAgentToSheet_(conversationId) {
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return { ok: false, skipped: "sheets_disabled" };
    }
    const id = trim_(conversationId);
    if (!id) return { ok: false, skipped: "no_id" };
    const conv = await getConversation_(id);
    if (!conv) return { ok: false, skipped: "no_conversation" };
    const line = liveAgentSheetLine_(conv);
    try {
        const result = await upsertSessionQueriesInSheet({
            clientSessionId: id,
            name: conv.visitorName || "",
            mobile: "",
            email: "",
            browserName: "",
            deviceType: "",
            channel: "Live Agent",
            userQueriesCsv: line,
            replaceCsvPrefix: "[Live Agent]"
        });
        return { ok: true, result };
    } catch (err) {
        console.warn("[live-agent/sheet-sync]", err.message || err);
        return { ok: false, error: err.message || String(err) };
    }
}
