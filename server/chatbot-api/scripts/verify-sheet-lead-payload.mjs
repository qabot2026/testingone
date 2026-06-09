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
    {
        clientContext: ctx,
        fields: {
            appointmentdate: "15-06-2026",
            appointmenttime: "10:30 AM"
        }
    }
);

const checks = [
    ["sourceUrl", lead.sourceUrl, "https://example.com/contact"],
    ["city", lead.city, "Mumbai"],
    ["ip", lead.ip, "203.0.113.42"],
    ["browserName", lead.browserName, "Chrome"],
    ["deviceType", lead.deviceType, "Desktop"],
    ["osName", lead.osName, "Windows 10"],
    ["feedbackRating", lead.feedbackRating, "4"],
    ["feedbackMessage", lead.feedbackMessage, "Helpful chat"],
    ["appointmentBooked", lead.appointmentBooked, "Scheduled"],
    ["appointmentDate", lead.appointmentDate, "15-06-2026"],
    ["appointmentTime", lead.appointmentTime, "10:30 AM"],
    ["fallBack", lead.fallBack, "1"],
    ["agentName", lead.agentName, ""],
    ["departmentName", lead.departmentName, ""],
    ["agentStatus", lead.agentStatus, ""]
];

let failed = 0;

const leadWithAgent = assembleLeadSheetPayloadFromSources_(
    {
        clientSessionId: "verify_session_agent",
        agentName: "Dr. Smith",
        departmentName: "General",
        agentStatus: "Active",
        channel: "web"
    },
    { clientContext: ctx, fields: {} }
);
const agentChecks = [
    ["agentName", leadWithAgent.agentName, "Dr. Smith"],
    ["departmentName", leadWithAgent.departmentName, "General"],
    ["agentStatus", leadWithAgent.agentStatus, "Active"]
];
for (const [label, got, want] of agentChecks) {
    if (got !== want) {
        console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
        failed += 1;
    } else {
        console.log(`OK   ${label}: ${got}`);
    }
}

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
