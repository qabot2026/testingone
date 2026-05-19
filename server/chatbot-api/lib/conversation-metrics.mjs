/**
 * Conversation analytics for Google Sheet columns V+ and Dialogflow CX `$session.params.*`.
 */

import { campaignParamsFromClientContext_ } from "./campaign-params.mjs";
import { crmFieldsFromClientContext_ } from "./crm-sync.mjs";
import {
    buildTranscriptTurnsFromClientContext_,
    coerceChatTranscriptArray_,
    enrichClientContextForSheetMetricsAsync_,
    normalizeTranscriptItemRole_,
    transcriptTurnTextFromItem_
} from "./chat-transcript-turns.mjs";

export { enrichClientContextForSheetMetricsAsync_ };

/** @param {string} s */
function looksLikeUserBotMessageCount_(s) {
    return /^\d{1,5}-\d{1,5}$/.test(String(s || "").trim());
}

/** @param {string} text */
function isFormSubmissionTranscriptLine_(text) {
    return /^form submission\b/i.test(String(text || "").trim());
}

/**
 * Count user/bot lines in raw widget `chat_transcript` (typed + chip/list selections).
 *
 * @param {unknown} cx
 * @returns {{ user: number, bot: number }}
 */
function countMessagesFromRawChatTranscript_(cx) {
    const o =
        cx && typeof cx === "object" && !Array.isArray(cx)
            ? /** @type {Record<string, unknown>} */ (cx)
            : {};
    const raw = coerceChatTranscriptArray_(o.chat_transcript);
    let user = 0;
    let bot = 0;
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (!item || typeof item !== "object") {
            continue;
        }
        const rec = /** @type {Record<string, unknown>} */ (item);
        const role = normalizeTranscriptItemRole_(rec);
        const text = transcriptTurnTextFromItem_(rec);
        if (!text || isFormSubmissionTranscriptLine_(text)) {
            if (role === "assistant" || role === "agent") {
                bot += 1;
            }
            continue;
        }
        if (role === "user") {
            user += 1;
        } else if (role === "assistant" || role === "agent") {
            bot += 1;
        }
    }
    return { user, bot };
}

/**
 * @param {unknown} cx
 * @returns {{ user: number, bot: number }}
 */
function countMessagesFromContextLists_(cx) {
    const o =
        cx && typeof cx === "object" && !Array.isArray(cx)
            ? /** @type {Record<string, unknown>} */ (cx)
            : {};
    let user = 0;
    let bot = 0;
    const uq = o.user_queries;
    if (Array.isArray(uq)) {
        for (let i = 0; i < uq.length; i += 1) {
            const item = uq[i];
            if (typeof item === "string" && item.trim()) {
                user += 1;
            } else if (item && typeof item === "object") {
                const rec = /** @type {Record<string, unknown>} */ (item);
                const t =
                    typeof rec.text === "string"
                        ? rec.text.trim()
                        : typeof rec.query === "string"
                          ? rec.query.trim()
                          : "";
                if (t) {
                    user += 1;
                }
            }
        }
    }
    const csv =
        typeof o.user_queries_csv === "string"
            ? o.user_queries_csv.trim()
            : typeof o.userqueriescsv === "string"
              ? o.userqueriescsv.trim()
              : "";
    if (csv) {
        const parts = csv.split(/[,;|]/).map((p) => p.trim()).filter(Boolean);
        if (parts.length > user) {
            user = parts.length;
        }
    }
    const aq = o.assistant_queries;
    if (Array.isArray(aq)) {
        for (let i = 0; i < aq.length; i += 1) {
            const item = aq[i];
            if (typeof item === "string" && item.trim()) {
                bot += 1;
            } else if (item && typeof item === "object") {
                bot += 1;
            }
        }
    }
    const fromRaw = countMessagesFromRawChatTranscript_(cx);
    user = Math.max(user, fromRaw.user);
    bot = Math.max(bot, fromRaw.bot);
    return { user, bot };
}

/** @param {string} text */
function normalizeUtteranceForCount_(text) {
    return String(text || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .slice(0, 240);
}

/**
 * User messages from merged transcript (skips consecutive duplicates from double events).
 *
 * @param {{ role: string, text: string }[]} turns
 */
function countUserMessagesFromTurns_(turns) {
    let n = 0;
    let lastKey = "";
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i].role !== "user") {
            continue;
        }
        const text = String(turns[i].text || "").trim();
        if (!text || isFormSubmissionTranscriptLine_(text)) {
            continue;
        }
        const key = normalizeUtteranceForCount_(text);
        if (key && key === lastKey) {
            continue;
        }
        lastKey = key;
        n += 1;
    }
    return n;
}

/**
 * Bot/agent side: one count per reply burst (multi-bubble CX response = 1).
 *
 * @param {{ role: string, text: string }[]} turns
 */
function countBotReplyRoundsFromTurns_(turns) {
    let n = 0;
    let inReplyBurst = false;
    for (let i = 0; i < turns.length; i += 1) {
        const role = turns[i].role;
        if (role === "user") {
            inReplyBurst = false;
            continue;
        }
        if (role !== "assistant" && role !== "agent") {
            continue;
        }
        const text = String(turns[i].text || "").trim();
        if (isFormSubmissionTranscriptLine_(text)) {
            continue;
        }
        if (!inReplyBurst) {
            n += 1;
            inReplyBurst = true;
        }
    }
    return n;
}

/**
 * @param {unknown} cx
 * @returns {{ user: number, bot: number }}
 */
function countUserBotFallbackFromLists_(cx) {
    const o =
        cx && typeof cx === "object" && !Array.isArray(cx)
            ? /** @type {Record<string, unknown>} */ (cx)
            : {};
    let user = 0;
    let lastKey = "";
    const uq = o.user_queries;
    if (Array.isArray(uq)) {
        for (let i = 0; i < uq.length; i += 1) {
            const item = uq[i];
            const t =
                typeof item === "string"
                    ? item.trim()
                    : item && typeof item === "object"
                      ? String(
                            /** @type {Record<string, unknown>} */ (item).text
                                || /** @type {Record<string, unknown>} */ (item).query
                                || ""
                        ).trim()
                      : "";
            if (!t || isFormSubmissionTranscriptLine_(t)) {
                continue;
            }
            const key = normalizeUtteranceForCount_(t);
            if (key === lastKey) {
                continue;
            }
            lastKey = key;
            user += 1;
        }
    }
    let bot = 0;
    const aq = o.assistant_queries;
    if (Array.isArray(aq)) {
        let lastBot = "";
        for (let i = 0; i < aq.length; i += 1) {
            const item = aq[i];
            const t = typeof item === "string" ? item.trim() : "";
            if (!t) {
                continue;
            }
            const key = normalizeUtteranceForCount_(t);
            if (key === lastBot) {
                continue;
            }
            lastBot = key;
            bot += 1;
        }
    }
    return { user, bot };
}

/**
 * @param {unknown} cx
 * @param {{ role: string, text: string, at: number }[]} turns
 */
function countUserBotFromTurns_(cx, turns) {
    if (turns.length > 0) {
        return {
            userCount: countUserMessagesFromTurns_(turns),
            botCount: countBotReplyRoundsFromTurns_(turns)
        };
    }
    const fb = countUserBotFallbackFromLists_(cx);
    return { userCount: fb.user, botCount: fb.bot };
}

/**
 * @param {{ role: string, text: string, at: number }[]} turns
 * @returns {number[]}
 */
function botResponseLatenciesMs_(turns) {
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
                let delta = turns[j].at - t0;
                if (delta <= 0) {
                    delta = 1000;
                }
                responseLatencies.push(delta);
                break;
            }
            if (r === "user") {
                break;
            }
        }
    }
    if (!responseLatencies.length) {
        for (let i = 0; i < turns.length - 1; i += 1) {
            const a = turns[i];
            const b = turns[i + 1];
            if (a.role === "user" && (b.role === "assistant" || b.role === "agent")) {
                let delta = b.at - a.at;
                if (delta <= 0) {
                    delta = 1000;
                }
                responseLatencies.push(delta);
            }
        }
    }
    return responseLatencies;
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


/** @param {unknown} raw */
function coerceContextTimestampMs_(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        if (raw > 1_000_000_000_000) {
            return raw;
        }
        if (raw > 1_000_000_000) {
            return raw * 1000;
        }
        return 0;
    }
    if (raw && typeof raw === "object") {
        const o = /** @type {{ seconds?: unknown, _seconds?: unknown }} */ (raw);
        const sec =
            typeof o.seconds === "number" && Number.isFinite(o.seconds)
                ? o.seconds
                : typeof o._seconds === "number" && Number.isFinite(o._seconds)
                  ? o._seconds
                  : NaN;
        if (Number.isFinite(sec)) {
            return sec * 1000;
        }
    }
    if (typeof raw === "string" && raw.trim()) {
        const parsed = Date.parse(raw.trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

/**
 * Wall-clock chat span: first activity → last activity (how long the visitor stayed in chat).
 *
 * @param {Record<string, unknown>} cx
 * @param {{ at: number }[]} turns
 */
function chatSessionDurationMs_(cx, turns) {
    const now = Date.now();
    let endMs = 0;
    for (const k of [
        "assistant_queries_last_at",
        "user_queries_last_at",
        "chat_last_message_at",
        "last_message_at"
    ]) {
        const v = coerceContextTimestampMs_(cx[k]);
        if (v > endMs) {
            endMs = v;
        }
    }
    for (let i = 0; i < turns.length; i += 1) {
        const at = turns[i].at;
        if (at > 1_000_000_000_000 && at > endMs) {
            endMs = at;
        }
    }
    if (!endMs) {
        endMs = now;
    }

    let startMs = 0;
    for (const k of [
        "chat_session_started_at",
        "chat_started_at",
        "session_started_at",
        "first_message_at",
        "chat_first_message_at"
    ]) {
        const v = coerceContextTimestampMs_(cx[k]);
        if (v > 0) {
            startMs = v;
            break;
        }
    }
    if (!startMs && turns.length) {
        const epochAts = turns.map((t) => t.at).filter((at) => at > 1_000_000_000_000);
        if (epochAts.length) {
            startMs = Math.min(...epochAts);
        }
    }
    if (startMs > 0 && endMs >= startMs) {
        return endMs - startMs;
    }
    if (turns.length >= 2) {
        const ats = turns.map((t) => t.at);
        const span = Math.max(0, Math.max(...ats) - Math.min(...ats));
        if (span > 0) {
            return span;
        }
    }
    return 0;
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
    const { userCount, botCount } = countUserBotFromTurns_(cx, turns);
    const durationMs = chatSessionDurationMs_(cx, turns);

    let chatDurationSec = 0;
    let chatDurationDisplay = "";
    if (durationMs > 0) {
        chatDurationSec = Math.round(durationMs / 1000);
        chatDurationDisplay = formatChatDuration_(durationMs);
    } else if (typeof cx.chat_duration_sec === "number" && Number.isFinite(cx.chat_duration_sec)) {
        chatDurationSec = Math.max(0, Math.round(cx.chat_duration_sec));
        chatDurationDisplay = formatChatDuration_(chatDurationSec * 1000);
    } else if (typeof cx.chatduration === "string" && cx.chatduration.trim()) {
        chatDurationDisplay = cx.chatduration.trim();
    }

    const messageCount =
        userCount > 0 || botCount > 0 ? `${userCount}-${botCount}` : "";

    const totalMessages = userCount + botCount;
    let avgResponseTimeMs = "";
    if (durationMs > 0 && totalMessages > 0) {
        avgResponseTimeMs = String(Math.max(1, Math.round(durationMs / totalMessages)));
    } else {
        const responseLatencies = botResponseLatenciesMs_(turns);
        if (responseLatencies.length) {
            const avg = responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length;
            avgResponseTimeMs = String(Math.max(1, Math.round(avg)));
        } else if (userCount > 0 && botCount > 0 && chatDurationSec > 0) {
            avgResponseTimeMs = String(
                Math.max(1, Math.round((chatDurationSec * 1000) / totalMessages))
            );
        }
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
    const messageCount =
        (m.messageCount && looksLikeUserBotMessageCount_(m.messageCount) ? m.messageCount : "")
        || pick("message_count", "messageCount");
    let avgResponseTimeMs =
        m.avgResponseTimeMs && !looksLikeUserBotMessageCount_(m.avgResponseTimeMs)
            ? m.avgResponseTimeMs
            : "";
    if (!avgResponseTimeMs) {
        const picked = pick("avg_response_time_ms", "avgResponseTimeMs");
        avgResponseTimeMs = looksLikeUserBotMessageCount_(picked) ? "" : picked;
    }
    if (!avgResponseTimeMs && messageCount && messageCount.includes("-") && m.chatDurationSec > 0) {
        const parts = messageCount.split("-");
        const u = Number(parts[0]);
        const b = Number(parts[1]);
        const total = u + b;
        if (total > 0) {
            avgResponseTimeMs = String(Math.max(1, Math.round((m.chatDurationSec * 1000) / total)));
        }
    }
    return {
        crmPushStatus: sanitizeCrmPushStatusForSheet_(m.crmPushStatus) || pickCrm("crm_push_status", "crmPushStatus", "crm_status"),
        duration:
            m.chatDurationDisplay
            || (m.chatDurationSec > 0 ? formatChatDuration_(m.chatDurationSec * 1000) : "")
            || pick("chatduration", "chat_duration", "duration"),
        messageCount,
        avgResponseTimeMs,
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
