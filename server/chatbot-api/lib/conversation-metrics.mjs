/**
 * Conversation analytics for Google Sheet columns V+ and Dialogflow CX `$session.params.*`.
 */

import { campaignParamsFromClientContext_ } from "./campaign-params.mjs";
import { crmFieldsFromClientContext_ } from "./crm-sync.mjs";
import {
    buildTranscriptTurnsFromClientContext_,
    coerceChatTranscriptArray_,
    enrichClientContextForSheetMetricsAsync_
} from "./chat-transcript-turns.mjs";

export { enrichClientContextForSheetMetricsAsync_ };

/** @param {string} s */
function looksLikeUserBotMessageCount_(s) {
    return /^\d{1,5}-\d{1,5}$/.test(String(s || "").trim());
}

/** @param {string} s */
function sanitizeCrmPushStatusForSheet_(s) {
    const t = String(s || "").trim();
    if (!t || looksLikeUserBotMessageCount_(t)) {
        return "";
    }
    if (/^passed$/i.test(t)) {
        return "Success";
    }
    if (/^failed$/i.test(t) || /^fail$/i.test(t)) {
        return "Fail";
    }
    return t;
}

const LEAD_CAPTURE_POSITIVE_RE =
    /\b(thank|thanks|thankyou|great|good|excellent|happy|love|appreciate|wonderful|amazing|helpful|satisfied|perfect|awesome|fantastic|pleased|glad|nice|delighted)\b/gi;
const LEAD_CAPTURE_NEGATIVE_RE =
    /\b(bad|terrible|awful|angry|hate|disappointed|frustrat|complaint|worst|rude|unhappy|poor|horrible|useless|annoyed|upset|disgust|not\s+happy|waste|pathetic|disappointing)\b/gi;

/** @type {RegExp[]|null} */
let botFallbackPatternsCache_ = null;

function botFallbackPatterns_() {
    if (botFallbackPatternsCache_) {
        return botFallbackPatternsCache_;
    }
    const raw = (process.env.SHEETS_BOT_FALLBACK_RESPONSE_RE || "").trim();
    if (raw) {
        try {
            if (raw.startsWith("[")) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    botFallbackPatternsCache_ = arr
                        .map((p) => {
                            try {
                                return new RegExp(String(p), "i");
                            } catch {
                                return null;
                            }
                        })
                        .filter(Boolean);
                    return botFallbackPatternsCache_;
                }
            }
            botFallbackPatternsCache_ = raw
                .split("|")
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p) => {
                    try {
                        return new RegExp(p, "i");
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
            if (botFallbackPatternsCache_.length) {
                return botFallbackPatternsCache_;
            }
        } catch {
            /* fall through */
        }
    }
    botFallbackPatternsCache_ = [
        /i\s+didn'?t\s+(quite\s+)?understand/i,
        /i'?m\s+not\s+sure/i,
        /sorry.{0,40}didn'?t\s+(quite\s+)?get/i,
        /please\s+rephrase/i,
        /default\s+fallback/i,
        /no\s+match(?:ing)?\s+intent/i,
        /couldn'?t\s+find\s+(an\s+)?answer/i,
        /i'?m\s+having\s+trouble/i,
        /try\s+asking\s+that\s+a\s+different\s+way/i,
        /i\s+don'?t\s+have\s+information/i
    ];
    return botFallbackPatternsCache_;
}

/** @param {string} text */
function isBotFallbackAssistantText_(text) {
    const t = String(text || "").trim();
    if (!t || t.length < 8) {
        return false;
    }
    if (/^form submission\b/i.test(t)) {
        return false;
    }
    const patterns = botFallbackPatterns_();
    for (let i = 0; i < patterns.length; i += 1) {
        if (patterns[i].test(t)) {
            return true;
        }
    }
    return false;
}

/** @param {string} text */
function isUserQuestionText_(text) {
    const t = String(text || "").trim();
    if (!t || t.length < 2) {
        return false;
    }
    if (/^form submission\b/i.test(t)) {
        return false;
    }
    if (t.includes("?")) {
        return true;
    }
    return /^(what|how|why|when|where|who|which|can|could|do|does|did|is|are|will|would|should|may|might)\b/i.test(
        t
    );
}

/**
 * Ensure transcript exists for metrics (sync; prefer {@link enrichClientContextForSheetMetricsAsync_} on submit).
 *
 * @param {unknown} clientContext
 * @param {unknown} [incomingRow]
 * @returns {Record<string, unknown>}
 */
export function clientContextEnrichedForSheetMetrics_(clientContext, incomingRow) {
    const cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? { .../** @type {Record<string, unknown>} */ (clientContext) }
            : {};
    const row =
        incomingRow && typeof incomingRow === "object" && !Array.isArray(incomingRow)
            ? /** @type {Record<string, unknown>} */ (incomingRow)
            : {};
    if (!coerceChatTranscriptArray_(cx.chat_transcript).length) {
        const json = row.chatTranscriptJson;
        if (typeof json === "string" && json.trim()) {
            cx.chat_transcript = coerceChatTranscriptArray_(json);
        }
    }
    cx.chat_transcript = buildTranscriptTurnsFromClientContext_(cx);
    return cx;
}

/** @param {unknown} v */
function metricScalarFromContext_(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    if (typeof v === "boolean") {
        return v ? "true" : "false";
    }
    return "";
}


/** @param {number} ms */
function formatChatDuration_(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
        return "";
    }
    const sec = Math.round(ms / 1000);
    if (sec < 60) {
        return `${sec}s`;
    }
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) {
        return s ? `${m}m ${s}s` : `${m}m`;
    }
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** @param {string} text @returns {"positive"|"negative"|""} */
function sentimentPolarityLabel_(text) {
    const s = String(text || "").toLowerCase();
    if (!s || s.length < 2) {
        return "";
    }
    const pos = (s.match(LEAD_CAPTURE_POSITIVE_RE) || []).length;
    const neg = (s.match(LEAD_CAPTURE_NEGATIVE_RE) || []).length;
    if (pos === 0 && neg === 0) {
        return "";
    }
    if (pos > neg) {
        return "positive";
    }
    if (neg > pos) {
        return "negative";
    }
    return "";
}

/**
 * @param {unknown} clientContext
 * @returns {{
 *   crmPushStatus: string,
 *   chatDurationSec: number,
 *   chatDurationDisplay: string,
 *   messageCount: string,
 *   avgResponseTimeMs: string,
 *   sentiment: string,
 *   unansweredQuestions: string,
 *   utmCampaign: string,
 *   utmContent: string,
 *   utmMedium: string,
 *   utmSource: string,
 *   utmTerm: string
 * }}
 */
export function computeConversationMetricsFromClientContext_(clientContext) {
    const cx =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? /** @type {Record<string, unknown>} */ (clientContext)
            : {};

    const crm = crmFieldsFromClientContext_(cx);
    let crmPushStatus = "";
    const crmRaw = sanitizeCrmPushStatusForSheet_(crm.crmStatus || "");
    if (crmRaw) {
        crmPushStatus = crmRaw;
    } else if (cx.crm_ok === true) {
        crmPushStatus = "Success";
    } else if (cx.crm_ok === false && (cx.crm_status || cx.crm_request || cx.crm_response)) {
        crmPushStatus = "Fail";
    }

    const turns = buildTranscriptTurnsFromClientContext_(cx);
    let userCount = 0;
    let botCount = 0;
    /** @type {number[]} */
    const ats = [];
    for (let i = 0; i < turns.length; i += 1) {
        ats.push(turns[i].at);
        if (turns[i].role === "user") {
            userCount += 1;
        } else if (turns[i].role === "assistant" || turns[i].role === "agent") {
            botCount += 1;
        }
    }

    let chatDurationSec = 0;
    let chatDurationDisplay = "";
    if (ats.length >= 2) {
        const span = Math.max(0, Math.max(...ats) - Math.min(...ats));
        chatDurationSec = Math.round(span / 1000);
        chatDurationDisplay = formatChatDuration_(span);
    } else if (typeof cx.chat_duration_sec === "number" && Number.isFinite(cx.chat_duration_sec)) {
        chatDurationSec = Math.max(0, Math.round(cx.chat_duration_sec));
        chatDurationDisplay = formatChatDuration_(chatDurationSec * 1000);
    } else if (typeof cx.chatduration === "string" && cx.chatduration.trim()) {
        chatDurationDisplay = cx.chatduration.trim();
    }

    const messageCount =
        userCount || botCount ? `${userCount}-${botCount}` : "";

    /** @type {number[]} */
    const responseLatencies = [];
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i].role !== "user") {
            continue;
        }
        const t0 = turns[i].at;
        for (let j = i + 1; j < turns.length; j += 1) {
            const r = turns[j].role;
            if (r === "assistant" || r === "agent") {
                if (turns[j].at > t0) {
                    responseLatencies.push(turns[j].at - t0);
                }
                break;
            }
            if (r === "user") {
                break;
            }
        }
    }
    let avgResponseTimeMs = "";
    if (responseLatencies.length) {
        const avg = responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length;
        avgResponseTimeMs = String(Math.round(avg));
    }

    /** @type {string[]} */
    const userTexts = [];
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i].role === "user") {
            userTexts.push(turns[i].text);
        }
    }
    const pol = sentimentPolarityLabel_(userTexts.join(" "));
    const sentiment =
        pol === "positive" ? "Positive" : pol === "negative" ? "Negative" : "";

    let unansweredQuestions = 0;
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i].role !== "user" || !isUserQuestionText_(turns[i].text)) {
            continue;
        }
        for (let j = i + 1; j < turns.length; j += 1) {
            const r = turns[j].role;
            if (r === "assistant" || r === "agent") {
                if (isBotFallbackAssistantText_(turns[j].text)) {
                    unansweredQuestions += 1;
                }
                break;
            }
            if (r === "user") {
                break;
            }
        }
    }

    const camp = campaignParamsFromClientContext_(cx);
    return {
        crmPushStatus,
        chatDurationSec,
        chatDurationDisplay,
        messageCount,
        avgResponseTimeMs,
        sentiment,
        unansweredQuestions: unansweredQuestions ? String(unansweredQuestions) : "0",
        utmCampaign: camp.utm_campaign || "",
        utmContent: camp.utm_content || "",
        utmMedium: camp.utm_medium || "",
        utmSource: camp.utm_source || "",
        utmTerm: camp.utm_term || ""
    };
}

/**
 * @param {ReturnType<typeof computeConversationMetricsFromClientContext_>} metrics
 */
/**
 * @param {unknown} clientContext
 * @param {unknown} [incomingRow]
 */
export function conversationMetricsForSheetRow_(metrics, clientContext, incomingRow) {
    const m = metrics && typeof metrics === "object" ? metrics : {};
    const cx = clientContextEnrichedForSheetMetrics_(clientContext, incomingRow);
    const sp =
        cx.session_params && typeof cx.session_params === "object" && !Array.isArray(cx.session_params)
            ? /** @type {Record<string, unknown>} */ (cx.session_params)
            : {};
    /** @param {string[]} keys */
    const pick = (...keys) => {
        for (let i = 0; i < keys.length; i += 1) {
            const k = keys[i];
            const v = metricScalarFromContext_(cx[k]) || metricScalarFromContext_(sp[k]);
            if (v) {
                return v;
            }
        }
        return "";
    };
    const pickCrm = (...keys) => sanitizeCrmPushStatusForSheet_(pick(...keys));
    const unanswered =
        m.unansweredQuestions != null && String(m.unansweredQuestions) !== ""
            ? String(m.unansweredQuestions)
            : pick("unanswered_questions", "unansweredQuestions") || "0";
    const userBot = m.messageCount || pick("message_count", "messageCount") || "";
    const turnsLen = buildTranscriptTurnsFromClientContext_(cx).length;
    return {
        crmPushStatus: sanitizeCrmPushStatusForSheet_(m.crmPushStatus) || pickCrm("crm_push_status", "crmPushStatus", "crm_status"),
        duration: m.chatDurationDisplay || pick("chatduration", "chat_duration", "duration"),
        messageCount: userBot || (turnsLen ? "0-0" : ""),
        avgResponseTimeMs: m.avgResponseTimeMs || pick("avg_response_time_ms", "avgResponseTimeMs"),
        sentiment: m.sentiment || pick("sentiment"),
        unansweredQuestions: unanswered,
        utmCampaign: m.utmCampaign || pick("utm_campaign", "utmcampaign"),
        utmContent: m.utmContent || pick("utm_content", "utmcontent"),
        utmMedium: m.utmMedium || pick("utm_medium", "utmmedium"),
        utmSource: m.utmSource || pick("utm_source", "utmsource"),
        utmTerm: m.utmTerm || pick("utm_term", "utmterm")
    };
}

/**
 * Merge metrics onto `client_context` + `session_params` for CX (`$session.params.*`).
 *
 * @param {Record<string, unknown>} clientContext
 * @param {ReturnType<typeof computeConversationMetricsFromClientContext_>} metrics
 */
export function mergeConversationMetricsIntoClientContext_(clientContext, metrics) {
    const cx = { ...clientContext };
    const m = metrics && typeof metrics === "object" ? metrics : computeConversationMetricsFromClientContext_(cx);
    const sp =
        cx.session_params && typeof cx.session_params === "object" && !Array.isArray(cx.session_params)
            ? { .../** @type {Record<string, unknown>} */ (cx.session_params) }
            : {};

    const setSp = (k, v) => {
        const s = v == null ? "" : String(v).trim();
        if (s) {
            sp[k] = s;
        }
    };

    setSp("crm_push_status", sanitizeCrmPushStatusForSheet_(m.crmPushStatus));
    setSp("chatduration", m.chatDurationDisplay);
    setSp("chat_duration", m.chatDurationDisplay);
    if (m.chatDurationSec > 0) {
        setSp("chat_duration_sec", String(m.chatDurationSec));
    }
    setSp("message_count", m.messageCount);
    setSp("avg_response_time_ms", m.avgResponseTimeMs);
    setSp("sentiment", m.sentiment);
    setSp("unanswered_questions", m.unansweredQuestions);
    setSp("utmcampaign", m.utmCampaign);
    setSp("utm_campaign", m.utmCampaign);
    setSp("utmcontent", m.utmContent);
    setSp("utm_content", m.utmContent);
    setSp("utmmedium", m.utmMedium);
    setSp("utm_medium", m.utmMedium);
    setSp("utmsource", m.utmSource);
    setSp("utm_source", m.utmSource);
    setSp("utmterm", m.utmTerm);
    setSp("utm_term", m.utmTerm);

    cx.session_params = sp;
    if (m.crmPushStatus) {
        cx.crm_push_status = m.crmPushStatus;
    }
    if (m.chatDurationDisplay) {
        cx.chatduration = m.chatDurationDisplay;
        cx.chat_duration = m.chatDurationDisplay;
    }
    if (m.chatDurationSec > 0) {
        cx.chat_duration_sec = m.chatDurationSec;
    }
    if (m.messageCount) {
        cx.message_count = m.messageCount;
    }
    if (m.avgResponseTimeMs) {
        cx.avg_response_time_ms = m.avgResponseTimeMs;
    }
    if (m.sentiment) {
        cx.sentiment = m.sentiment;
    }
    if (m.unansweredQuestions !== "") {
        cx.unanswered_questions = m.unansweredQuestions;
    }

    return cx;
}
