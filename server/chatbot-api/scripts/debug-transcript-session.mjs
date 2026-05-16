/**
 * Inspect Firestore + transcript API for one session (local ops).
 *
 * Usage (from server/chatbot-api):
 *   set FIREBASE_SERVICE_ACCOUNT_JSON=...
 *   set CONVERSATIONS_SHEET_VIEW_SECRET=...
 *   node scripts/debug-transcript-session.mjs a2cff3ce-d06a-41b1-8998-d0d4061616ee
 */
import {
    fetchLatestContactSubmissionForClientSession,
    fetchSessionChatTranscriptContext
} from "../lib/firestore.mjs";

const session = (process.argv[2] || "").trim();
const apiBase = (process.env.CONVERSATIONS_PUBLIC_BASE_URL || "https://handsome-amazement-production-7f65.up.railway.app").replace(/\/$/, "");
const secret = (process.env.CONVERSATIONS_SHEET_VIEW_SECRET || "").trim();

if (!session) {
    console.error("Usage: node scripts/debug-transcript-session.mjs <session-id>");
    process.exit(1);
}

function countAssistantRows(arr) {
    if (!Array.isArray(arr)) {
        return 0;
    }
    return arr.filter(
        (it) =>
            it
            && typeof it === "object"
            && String(it.role || "")
                .trim()
                .toLowerCase() === "assistant"
    ).length;
}

const lead = await fetchLatestContactSubmissionForClientSession(session);
const live = await fetchSessionChatTranscriptContext(session);

const leadCx = lead?.client_context && typeof lead.client_context === "object" ? lead.client_context : {};
const leadCt = leadCx.chat_transcript;

console.log("session:", session);
console.log("lead_found:", !!lead);
console.log("lead_chat_transcript_kind:", Array.isArray(leadCt) ? "array" : typeof leadCt);
console.log("lead_chat_transcript_len:", Array.isArray(leadCt) ? leadCt.length : 0);
console.log("lead_assistant_rows:", countAssistantRows(leadCt));
console.log(
    "lead_assistant_queries:",
    Array.isArray(leadCx.assistant_queries) ? leadCx.assistant_queries.length : 0
);
console.log("live_session_doc:", !!live);
console.log("live_chat_transcript_len:", Array.isArray(live?.chat_transcript) ? live.chat_transcript.length : 0);
console.log("live_assistant_rows:", countAssistantRows(live?.chat_transcript));

if (secret) {
    const url = `${apiBase}/api/conversation-transcript?session=${encodeURIComponent(session)}`;
    const res = await fetch(url, {
        headers: { "X-Conversations-Sheet-Secret": secret }
    });
    const json = await res.json();
    console.log("api_status:", res.status);
    console.log("api_source:", json.source);
    console.log("api_transcript_stats:", JSON.stringify(json.transcript_stats || null));
    console.log(
        "api_turns:",
        Array.isArray(json.turns)
            ? json.turns.map((t) => `${t.role}:${String(t.text || "").slice(0, 60)}`)
            : json.error
    );
} else {
    console.log("skip_api: set CONVERSATIONS_SHEET_VIEW_SECRET to call live API");
}
