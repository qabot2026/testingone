/**
 * Schedule Live Agent tab row sync (same debounced pattern as bot Sheet1 via conversation-sheet.js).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * @param {string} sessionId
 */
export function scheduleLiveAgentHandoffSheetSync_(sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid) {
        return;
    }
    if (String(process.env.DISABLE_SHEETS || "").trim() === "1") {
        return;
    }
    try {
        const liveAgentSheet = require("../refer-staff/live-agent-sheet.js");
        if (liveAgentSheet && typeof liveAgentSheet.scheduleSheet2Sync === "function") {
            liveAgentSheet.scheduleSheet2Sync(sid);
        }
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn("[live-agent/sheet-sync-tab]", msg.slice(0, 240));
    }
}
