/**
 * Legacy Sheet1 live-agent queue marker — disabled.
 * Handoff rows sync via Live Agent tab (scheduleLiveAgentHandoffSheetSync_).
 */

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

/**
 * @param {string} conversationId session id
 */
export async function syncLiveAgentToSheet_(conversationId) {
    void conversationId;
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return { ok: false, skipped: "sheets_disabled" };
    }
    return { ok: true, skipped: "live_agent_tab_only" };
}
