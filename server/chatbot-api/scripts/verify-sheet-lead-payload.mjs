/**
 * Smoke test: assembleLeadSheetPayloadFromSources_ maps client_context → sheet columns.
 * Run: node server/chatbot-api/scripts/verify-sheet-lead-payload.mjs
 */

import { assembleLeadSheetPayloadFromSources_ } from "../lib/sheets.mjs";
import { computeConversationMetricsFromClientContext_ } from "../lib/conversation-metrics.mjs";

const ctx = {
    source_url: "https://example.com/contact",
    browser_name: "Chrome",
    device_type: "Desktop",
    os_name: "Windows 10",
    city: "Mumbai",
    ip: "203.0.113.42",
    feedback_rating: "4",
    feedback_message: "Helpful chat",
    chat_transcript: [
        { role: "user", text: "What are your hours?" },
        {
            role: "assistant",
            text: "Sorry, I didn't quite get that. Could you rephrase your question?"
        }
    ]
};

const lead = assembleLeadSheetPayloadFromSources_(
    {
        clientSessionId: "verify_session_001",
        name: "Test User",
        mobile: "919876543210",
        email: "test@example.com",
        channel: "web"
    },
    { clientContext: ctx, fields: {} }
);

const checks = [
    ["sourceUrl", lead.sourceUrl, "https://example.com/contact"],
    ["city", lead.city, "Mumbai"],
    ["ip", lead.ip, "203.0.113.42"],
    ["browserName", lead.browserName, "Chrome"],
    ["deviceType", lead.deviceType, "Desktop"],
    ["osName", lead.osName, "Windows 10"],
    ["feedbackRating", lead.feedbackRating, "4"],
    ["feedbackMessage", lead.feedbackMessage, "Helpful chat"]
];

let failed = 0;
for (const [label, got, want] of checks) {
    if (got !== want) {
        console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
        failed += 1;
    } else {
        console.log(`OK   ${label}: ${got}`);
    }
}

const metrics = computeConversationMetricsFromClientContext_(ctx);
if (!metrics.fallbackMessageCount || metrics.fallbackMessageCount === "0") {
    console.error(`FAIL fallBack count: got ${JSON.stringify(metrics.fallbackMessageCount)}`);
    failed += 1;
} else {
    console.log(`OK   fallbackMessageCount: ${metrics.fallbackMessageCount}`);
}

if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log("\nAll sheet lead payload checks passed.");
