/**
 * Meta messaging webhook → Dialogflow CX → reply on WhatsApp, Facebook Messenger, Instagram.
 *
 * One webhook URL for all Meta channels:
 *   https://YOUR-API.up.railway.app/api/whatsapp/webhook
 *
 * WhatsApp env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * Facebook Page + Instagram DMs: META_PAGE_ACCESS_TOKEN, META_PAGE_ID
 *   (aliases: FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID)
 * Dialogflow: DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON
 */

import crypto from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { getServiceAccountCredentials } from "../google-service-account.mjs";
import {
    extractCxResponse_,
    choiceLabels_,
    choiceValues_,
    supplementalTextBlocks_,
    parseYoutubeVideoId_,
    youtubeWatchUrl_,
    youtubeThumbnailUrl_,
    isDirectVideoFileUrl_
} from "../meta-channels/cx-payload.mjs";

/**
 * Dialogflow-only credentials. Use when Firebase JSON is from another GCP project
 * or the service account is not visible under qabot01.
 * @returns {Record<string, unknown> | null}
 */
function getDialogflowServiceAccountCredentials_() {
    const raw = trim_(process.env.DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON);
    if (raw) {
        try {
            const o = JSON.parse(raw);
            if (o && o.type === "service_account" && typeof o.private_key === "string") {
                return o;
            }
        } catch {
            /* fall through */
        }
    }
    return getServiceAccountCredentials();
}

const LOG_TAG = "[meta-channel]";
const WEBHOOK_PATH = "/api/whatsapp/webhook";
const DIALOGFLOW_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** @type {Map<string, number>} */
const seenMessageIds_ = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 2000;

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

/** Strip accidental "Bearer ", quotes, or newlines pasted from Meta docs. */
function normalizeAccessToken_(raw) {
    let s = trim_(raw).replace(/\s+/g, "");
    if (/^bearer/i.test(s)) {
        s = s.replace(/^bearer/i, "");
    }
    if (
        (s.startsWith('"') && s.endsWith('"'))
        || (s.startsWith("'") && s.endsWith("'"))
    ) {
        s = s.slice(1, -1);
    }
    return s;
}

function metaConfig_() {
    const graphVersion = trim_(process.env.WHATSAPP_GRAPH_API_VERSION) || "v25.0";
    return {
        verifyToken: trim_(process.env.WHATSAPP_VERIFY_TOKEN),
        appSecret: trim_(process.env.WHATSAPP_APP_SECRET),
        projectId: trim_(process.env.DIALOGFLOW_CX_PROJECT_ID) || "qabot01",
        location: trim_(process.env.DIALOGFLOW_CX_LOCATION) || "us-central1",
        agentId: trim_(process.env.DIALOGFLOW_CX_AGENT_ID) || "9dbd4886-3cbe-43fc-8eb5-54ee5097f25c",
        languageCode: trim_(process.env.DIALOGFLOW_CX_LANGUAGE_CODE) || "en",
        graphVersion,
        whatsapp: {
            accessToken: normalizeAccessToken_(process.env.WHATSAPP_ACCESS_TOKEN),
            phoneNumberId: trim_(process.env.WHATSAPP_PHONE_NUMBER_ID).replace(/\D/g, "")
        },
        page: {
            accessToken: normalizeAccessToken_(
                process.env.META_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN
            ),
            pageId: trim_(process.env.META_PAGE_ID || process.env.FACEBOOK_PAGE_ID).replace(/\D/g, "")
        }
    };
}

/** @deprecated alias */
function whatsappConfig_() {
    const c = metaConfig_();
    return {
        verifyToken: c.verifyToken,
        accessToken: c.whatsapp.accessToken,
        phoneNumberId: c.whatsapp.phoneNumberId,
        appSecret: c.appSecret,
        projectId: c.projectId,
        location: c.location,
        agentId: c.agentId,
        languageCode: c.languageCode,
        graphVersion: c.graphVersion
    };
}

/** @returns {string[]} */
export function missingWhatsappEnvKeys_() {
    const c = metaConfig_();
    const missing = [];
    if (!c.verifyToken) {
        missing.push("WHATSAPP_VERIFY_TOKEN");
    }
    const hasWhatsapp = !!(c.whatsapp.accessToken && c.whatsapp.phoneNumberId);
    const hasPage = !!(c.page.accessToken && c.page.pageId);
    if (!hasWhatsapp && !hasPage) {
        missing.push("WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID (WhatsApp)");
        missing.push("META_PAGE_ACCESS_TOKEN + META_PAGE_ID (Facebook + Instagram)");
    }
    if (!getDialogflowServiceAccountCredentials_()) {
        missing.push(
            "DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON (Dialogflow CX API)"
        );
    }
    if (!c.projectId) {
        missing.push("DIALOGFLOW_CX_PROJECT_ID");
    }
    if (!c.agentId) {
        missing.push("DIALOGFLOW_CX_AGENT_ID");
    }
    return missing;
}

function log_(event, extra) {
    const base = { event };
    console.log(LOG_TAG, JSON.stringify(extra ? { ...base, ...extra } : base));
}

function pruneSeen_() {
    const now = Date.now();
    for (const [id, at] of seenMessageIds_) {
        if (now - at > SEEN_TTL_MS) {
            seenMessageIds_.delete(id);
        }
    }
    while (seenMessageIds_.size > SEEN_MAX) {
        const first = seenMessageIds_.keys().next().value;
        if (first) {
            seenMessageIds_.delete(first);
        } else {
            break;
        }
    }
}

function wasSeenMessage_(id) {
    if (!id) {
        return false;
    }
    pruneSeen_();
    if (seenMessageIds_.has(id)) {
        return true;
    }
    seenMessageIds_.set(id, Date.now());
    return false;
}

/** @type {Map<string, { labels: string[], values: string[], at: number }>} */
const waSessionChoiceMap_ = new Map();
const CHOICE_MAP_TTL_MS = 30 * 60 * 1000;

/**
 * @param {string} sessionId
 * @param {string[]} labels Display labels (list/button titles)
 * @param {string[]} values Sent to Dialogflow on selection (defaults to labels)
 */
function rememberChoiceOptions_(sessionId, labels, values) {
    if (!sessionId || !labels.length) {
        return;
    }
    waSessionChoiceMap_.set(sessionId, {
        labels: [...labels],
        values: values.length ? [...values] : [...labels],
        at: Date.now()
    });
}

/**
 * @param {string} sessionId
 * @param {string} choiceId e.g. chip_0 or card_2
 * @param {string} fallbackTitle
 */
function resolveChoiceSelection_(sessionId, choiceId, fallbackTitle) {
    const cached = waSessionChoiceMap_.get(sessionId);
    if (!cached || Date.now() - cached.at > CHOICE_MAP_TTL_MS) {
        return fallbackTitle;
    }
    const m = /^(?:chip|card)_(\d+)$/.exec(trim_(choiceId));
    if (!m) {
        return fallbackTitle;
    }
    const idx = Number.parseInt(m[1], 10);
    return cached.values[idx] || cached.labels[idx] || fallbackTitle;
}

function isHttpsUrl_(raw) {
    return /^https:\/\/.+/i.test(trim_(raw));
}

/** @typedef {import("../meta-channels/cx-payload.mjs").CarouselCard} WaCarouselCard */
/** @typedef {import("../meta-channels/cx-payload.mjs").CxReplyParts} CxReplyParts */

function webChatUrl_() {
    const explicit = trim_(process.env.META_CHAT_WEB_URL || process.env.CHAT_WIDGET_URL);
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }
    const base = metaApiPublicBaseUrl_();
    return base ? `${base.replace(/\/+$/, "")}/chat-frame.html` : "";
}

function metaApiPublicBaseUrl_() {
    const explicit = trim_(process.env.CONVERSATIONS_PUBLIC_BASE_URL);
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }
    const dom = trim_(process.env.RAILWAY_PUBLIC_DOMAIN);
    if (dom) {
        return `https://${dom.replace(/\/+$/, "")}`;
    }
    const staticUrl = trim_(process.env.RAILWAY_STATIC_URL);
    if (staticUrl) {
        return staticUrl.replace(/\/+$/, "");
    }
    return "";
}

function waShortTitle_(text, maxLen) {
    const t = trim_(text);
    if (t.length <= maxLen) {
        return t;
    }
    return t.slice(0, Math.max(1, maxLen - 1)) + "…";
}

async function whatsappGraphPost_(payload) {
    const c = whatsappConfig_();
    const url = `https://graph.facebook.com/${c.graphVersion}/${c.phoneNumberId}/messages`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${c.accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
    const raw = await res.text();
    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {};
    }
    if (!res.ok) {
        const err = data?.error && typeof data.error === "object" ? data.error : {};
        const errMsg =
            err.message || raw.slice(0, 400) || `HTTP ${res.status}`;
        const detail = [err.type, err.code, err.error_subcode].filter(Boolean).join(" ");
        throw new Error(
            `WhatsApp send failed: ${errMsg}${detail ? ` (${detail})` : ""}`
        );
    }
    return data;
}

/**
 * @param {{ to: string, body: string }} input
 */
async function sendWhatsappText_(input) {
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: { body: input.body.slice(0, 4096) }
    });
}

/**
 * @param {{ to: string, link: string, caption?: string }} input
 */
async function sendWhatsappImage_(input) {
    const image = { link: input.link };
    if (input.caption) {
        image.caption = input.caption.slice(0, 1024);
    }
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "image",
        image
    });
}

/**
 * @param {{ to: string, body: string, labels: string[], idPrefix?: string, allowDefault?: boolean }} input
 */
async function sendWhatsappChoiceMenu_(input) {
    const labels = input.labels.slice(0, 10);
    const idPrefix = input.idPrefix || "chip";
    let body = waShortTitle_(trim_(input.body), 1024);
    if (!body && input.allowDefault !== false) {
        body = waShortTitle_("Please choose an option:", 1024);
    }
    if (!body || labels.length === 0) {
        return null;
    }
    if (labels.length <= 3) {
        return whatsappGraphPost_({
            messaging_product: "whatsapp",
            to: input.to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: body },
                action: {
                    buttons: labels.map((label, i) => ({
                        type: "reply",
                        reply: {
                            id: `${idPrefix}_${i}`,
                            title: waShortTitle_(label, 20)
                        }
                    }))
                }
            }
        });
    }
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "interactive",
        interactive: {
            type: "list",
            body: { text: body },
            action: {
                button: waShortTitle_(body.slice(0, 20) || "Menu", 20),
                sections: [
                    {
                        title: waShortTitle_(body, 24),
                        rows: labels.map((label, i) => ({
                            id: `${idPrefix}_${i}`,
                            title: waShortTitle_(label, 24),
                            description: ""
                        }))
                    }
                ]
            }
        }
    });
}

/**
 * @param {WaCarouselCard[]} cards
 * @returns {{ label: string, value: string }[]}
 */
function cardCarouselChoiceOptions_(cards) {
    return cards.map((c, i) => {
        const label = [c.title, c.subtitle].filter(Boolean).join(" — ")
            || c.ctaLabel
            || `Option ${i + 1}`;
        const value = c.ctaValue || c.title || c.subtitle || label;
        return { label, value };
    });
}

/**
 * @param {string} to
 * @param {string} sessionId
 * @param {WaCarouselCard[]} cards
 * @param {CxReplyParts} parts
 * @param {string} [alreadyShown]
 */
async function sendWhatsappChoicesFromCards_(to, sessionId, cards, parts) {
    const opts = cardCarouselChoiceOptions_(cards);
    if (!opts.length) {
        return;
    }
    rememberChoiceOptions_(sessionId, opts.map((o) => o.label), opts.map((o) => o.value));
    const menuPrompt = trim_(parts.choicePrompt) || trim_(parts.cardCarousel?.message) || "";
    try {
        await sendWhatsappChoiceMenu_({
            to,
            body: menuPrompt,
            labels: opts.map((o) => o.label),
            idPrefix: "card",
            allowDefault: false
        });
    } catch (e) {
        const numbered = opts.map((opt, i) => `${i + 1}. ${opt.label}`).join("\n");
        await sendWhatsappText_({
            to,
            body: menuPrompt ? `${menuPrompt}\n\n${numbered}` : numbered
        });
        log_("card_menu_fallback", {
            error: e && e.message ? String(e.message).slice(0, 200) : String(e)
        });
    }
}

/**
 * Image carousel: intro (optional) → all images → choices handled by caller.
 * @param {{ to: string, message: string, cards: WaCarouselCard[] }} input
 */
async function sendWhatsappCardCarousel_(input) {
    const cards = input.cards.slice(0, 10);
    const message = trim_(input.message);

    if (message) {
        await sendWhatsappText_({ to: input.to, body: message });
    }

    for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i];
        if (!isHttpsUrl_(card.imageUrl)) {
            continue;
        }
        try {
            await sendWhatsappImage_({
                to: input.to,
                link: card.imageUrl
            });
        } catch (e) {
            log_("card_image_skip", {
                index: i,
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }
}

/**
 * @param {{ to: string, message: string, urls: string[] }} input
 */
async function sendWhatsappGallery_(input) {
    const message = trim_(input.message);
    if (message) {
        await sendWhatsappText_({ to: input.to, body: message });
    }
    for (const url of input.urls) {
        try {
            await sendWhatsappImage_({ to: input.to, link: url });
        } catch (e) {
            log_("gallery_image_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }
}

/**
 * @param {string} to
 * @param {string} sessionId
 * @param {CxReplyParts} parts
 */
async function sendWhatsappChoicesFromParts_(to, sessionId, parts, opts = {}) {
    if (!parts.choices.length) {
        return;
    }
    rememberChoiceOptions_(sessionId, choiceLabels_(parts), choiceValues_(parts));
    const menuPrompt = opts.payloadMessageOnly
        ? trim_(parts.choicePrompt)
        : resolveChoiceMenuPrompt_(parts, opts.alreadyShown || "");
    try {
        const sent = await sendWhatsappChoiceMenu_({
            to,
            body: menuPrompt,
            labels: choiceLabels_(parts),
            idPrefix: "chip",
            allowDefault: !opts.payloadMessageOnly
        });
        if (!sent && menuPrompt) {
            throw new Error("choice_menu_empty");
        }
    } catch (e) {
        const numbered = parts.choices.map((opt, i) => `${i + 1}. ${opt.label}`).join("\n");
        await sendWhatsappText_({
            to,
            body: menuPrompt ? `${menuPrompt}\n\n${numbered}` : numbered
        });
        log_("chip_menu_fallback", {
            error: e && e.message ? String(e.message).slice(0, 200) : String(e)
        });
    }
}

/**
 * @param {{ to: string, sessionId: string, parts: CxReplyParts }} input
 */
async function sendWhatsappCxReply_(input) {
    const parts = input.parts;
    const supplemental = supplementalTextBlocks_(parts, webChatUrl_());
    let leadText = [...parts.texts, ...supplemental].filter(Boolean).join("\n\n");

    if (!parts.gallery && !parts.cardCarousel && parts.images.length > 0) {
        if (leadText) {
            await sendWhatsappText_({ to: input.to, body: leadText });
            leadText = "";
        }
        for (const url of parts.images) {
            try {
                await sendWhatsappImage_({ to: input.to, link: url });
            } catch (e) {
                log_("rich_image_skip", {
                    error: e && e.message ? String(e.message).slice(0, 160) : String(e)
                });
            }
        }
    }

    if (parts.cardCarousel?.cards?.length) {
        const agentText = agentTextBeforePayload_(parts);
        if (agentText) {
            await sendWhatsappText_({ to: input.to, body: agentText });
        }
        await sendWhatsappCardCarousel_({
            to: input.to,
            message: undefined,
            cards: parts.cardCarousel.cards
        });
        if (parts.choices.length) {
            await sendWhatsappChoicesFromParts_(input.to, input.sessionId, parts, {
                payloadMessageOnly: true
            });
        } else {
            await sendWhatsappChoicesFromCards_(input.to, input.sessionId, parts.cardCarousel.cards, parts);
        }
        return;
    }

    if (parts.gallery?.urls?.length) {
        const agentText = agentTextBeforePayload_(parts);
        if (agentText) {
            await sendWhatsappText_({ to: input.to, body: agentText });
        }
        if (!parts.choices.length && trim_(parts.gallery.message)) {
            await sendWhatsappText_({ to: input.to, body: trim_(parts.gallery.message) });
        }
        await sendWhatsappGallery_({
            to: input.to,
            message: undefined,
            urls: parts.gallery.urls
        });
        if (parts.choices.length) {
            await sendWhatsappChoicesFromParts_(input.to, input.sessionId, parts, {
                payloadMessageOnly: true
            });
        }
        return;
    }

    if (parts.video?.url) {
        const intro = resolveVideoIntro_(parts);
        const title = trim_(parts.video?.title);
        await sendWhatsappVideo_({
            to: input.to,
            url: parts.video.url,
            title: title || undefined,
            message: intro || undefined
        });
        if (parts.choices.length) {
            await sendWhatsappChoicesFromParts_(input.to, input.sessionId, parts, {
                payloadMessageOnly: Boolean(trim_(parts.choicePrompt)),
                alreadyShown: [intro, title].filter(Boolean).join("\n\n")
            });
        }
        return;
    }

    if (leadText) {
        await sendWhatsappText_({ to: input.to, body: leadText });
    }

    if (parts.choices.length) {
        await sendWhatsappChoicesFromParts_(input.to, input.sessionId, parts, {
            alreadyShown: leadText
        });
        return;
    }

    if (!leadText && parts.images.length === 0) {
        await sendWhatsappText_({
            to: input.to,
            body: "Sorry, I could not process that. Please try again."
        });
    }
}

/** @param {string} s */
function normalizePrompt_(s) {
    return trim_(s).toLowerCase().replace(/\s+/g, " ").replace(/[.:!?…]+$/g, "");
}

/** @param {string} a @param {string} b */
function promptsEquivalent_(a, b) {
    const na = normalizePrompt_(a);
    const nb = normalizePrompt_(b);
    return Boolean(na && nb && na === nb);
}

/** @param {string} prompt @param {string} alreadyShown */
function promptAlreadyShown_(prompt, alreadyShown) {
    const shown = trim_(alreadyShown);
    if (!shown || !trim_(prompt)) {
        return false;
    }
    if (promptsEquivalent_(prompt, shown)) {
        return true;
    }
    for (const block of shown.split(/\n\n+/)) {
        if (promptsEquivalent_(prompt, block)) {
            return true;
        }
    }
    return false;
}

/** @param {string} text */
function isGenericChoicePrompt_(text) {
    const n = normalizePrompt_(text);
    return !n
        || n === "please choose an option"
        || n === "choose an option"
        || n === "select an option"
        || n === "select option"
        || n.startsWith("select an option")
        || n.startsWith("choose an option");
}

/**
 * Agent text before gallery/carousel/video payload — skip auto CX chip lines and duplicate menu prompts.
 * @param {CxReplyParts} parts
 */
function agentTextBeforePayload_(parts) {
    const choicePrompt = trim_(parts.choicePrompt);
    const hasChoices = parts.choices.length > 0;
    /** @type {string[]} */
    const blocks = [];

    for (const t of parts.texts) {
        const s = trim_(t);
        if (!s) {
            continue;
        }
        if (hasChoices && isGenericChoicePrompt_(s)) {
            continue;
        }
        if (hasChoices && choicePrompt && promptsEquivalent_(s, choicePrompt)) {
            continue;
        }
        if (!blocks.some((b) => promptsEquivalent_(b, s))) {
            blocks.push(s);
        }
    }

    for (const line of supplementalTextBlocks_(parts, webChatUrl_())) {
        const s = trim_(line);
        if (!s || blocks.some((b) => promptsEquivalent_(b, s))) {
            continue;
        }
        blocks.push(s);
    }

    return blocks.join("\n\n");
}

/**
 * Choice menu body: avoid repeating text already shown as intro or lead message.
 * @param {CxReplyParts} parts
 * @param {string} [alreadyShown]
 */
function resolveChoiceMenuPrompt_(parts, alreadyShown) {
    const fromPayload = trim_(parts.choicePrompt);
    const fallback = "Please choose an option:";

    if (fromPayload && !promptAlreadyShown_(fromPayload, alreadyShown)) {
        return fromPayload;
    }
    if (!promptAlreadyShown_(fallback, alreadyShown)) {
        return fallback;
    }
    return "Options:";
}

/**
 * Intro for open_video: agent text + optional title + payload message (deduped).
 * @param {CxReplyParts} parts
 */
function resolveVideoIntro_(parts) {
    const choicePrompt = trim_(parts.choicePrompt);
    const hasChoices = parts.choices.length > 0;
    /** @type {string[]} */
    const blocks = [];

    /** @param {string} text */
    function pushUnique(text) {
        const t = trim_(text);
        if (!t || blocks.some((b) => promptsEquivalent_(b, t))) {
            return;
        }
        blocks.push(t);
    }

    for (const t of parts.texts) {
        if (hasChoices && (promptsEquivalent_(t, choicePrompt) || isGenericChoicePrompt_(t))) {
            continue;
        }
        pushUnique(t);
    }

    const payloadMessage = trim_(parts.video?.message);
    const videoTitle = trim_(parts.video?.title);
    if (
        payloadMessage
        && !promptsEquivalent_(payloadMessage, videoTitle)
        && !(hasChoices && (promptsEquivalent_(payloadMessage, choicePrompt) || isGenericChoicePrompt_(payloadMessage)))
    ) {
        pushUnique(payloadMessage);
    }

    return blocks.join("\n\n");
}

/**
 * YouTube on WhatsApp: agent intro, titled thumbnail, then link preview.
 * @param {{ to: string, youtubeId: string, title?: string, message?: string }} input
 */
async function sendWhatsappYoutubeLink_(input) {
    const watchUrl = youtubeWatchUrl_(input.youtubeId);
    const message = trim_(input.message);
    const title = trim_(input.title);

    if (message) {
        await sendWhatsappText_({ to: input.to, body: message });
    }
    if (title) {
        try {
            await sendWhatsappImage_({
                to: input.to,
                link: youtubeThumbnailUrl_(input.youtubeId),
                caption: title.slice(0, 1024)
            });
        } catch (e) {
            await sendWhatsappText_({ to: input.to, body: title });
            log_("video_title_image_fallback", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }

    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: {
            body: watchUrl,
            preview_url: true
        }
    });
}

/**
 * @param {{ to: string, url: string, message?: string }} input
 */
async function sendWhatsappNativeVideo_(input) {
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "video",
        video: {
            link: input.url,
            ...(input.message ? { caption: input.message.slice(0, 1024) } : {})
        }
    });
}

/**
 * @param {{ to: string, url: string, message?: string }} input
 */
async function sendWhatsappVideoLink_(input) {
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "interactive",
        interactive: {
            type: "cta_url",
            body: {
                text: waShortTitle_(input.message || "Tap below to watch the video:", 1024)
            },
            action: {
                name: "cta_url",
                parameters: {
                    display_text: waShortTitle_("Watch video", 20),
                    url: input.url
                }
            }
        }
    });
}

/**
 * @param {{ to: string, url: string, title?: string, message?: string }} input
 */
async function sendWhatsappVideo_(input) {
    const url = trim_(input.url);
    if (!url) {
        return;
    }
    const message = trim_(input.message);
    const title = trim_(input.title);
    const youtubeId = parseYoutubeVideoId_(url);

    if (youtubeId) {
        await sendWhatsappYoutubeLink_({
            to: input.to,
            youtubeId,
            title: title || undefined,
            message: message || undefined
        });
        return;
    }

    if (title) {
        await sendWhatsappText_({ to: input.to, body: title });
    }

    if (isDirectVideoFileUrl_(url) || isHttpsUrl_(url)) {
        try {
            const caption = [title, message].filter(Boolean).join("\n\n");
            await sendWhatsappNativeVideo_({
                to: input.to,
                url,
                message: caption || undefined
            });
            return;
        } catch (e) {
            log_("wa_video_file_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }

    try {
        if (message) {
            await sendWhatsappText_({ to: input.to, body: message });
        }
        await sendWhatsappVideoLink_({
            to: input.to,
            url,
            message: message ? undefined : "Tap below to watch:"
        });
    } catch (e) {
        log_("wa_video_link_skip", {
            error: e && e.message ? String(e.message).slice(0, 160) : String(e)
        });
        await sendWhatsappText_({
            to: input.to,
            body: message ? `${message}\n\nWatch: ${url}` : `Watch: ${url}`
        });
    }
}

async function pageGraphPost_(body) {
    const c = metaConfig_();
    if (!c.page.accessToken || !c.page.pageId) {
        throw new Error("META_PAGE_ACCESS_TOKEN and META_PAGE_ID required for Facebook/Instagram");
    }
    const url = `https://graph.facebook.com/${c.graphVersion}/${c.page.pageId}/messages`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${c.page.accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const raw = await res.text();
    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {};
    }
    if (!res.ok) {
        const err = data?.error && typeof data.error === "object" ? data.error : {};
        const errMsg = err.message || raw.slice(0, 400) || `HTTP ${res.status}`;
        const detail = [err.type, err.code, err.error_subcode].filter(Boolean).join(" ");
        throw new Error(
            `Messenger send failed: ${errMsg}${detail ? ` (${detail})` : ""}`
        );
    }
    return data;
}

/**
 * @param {{ recipientId: string, message: Record<string, unknown> }} input
 */
async function sendPageMessage_(input) {
    return pageGraphPost_({
        recipient: { id: input.recipientId },
        messaging_type: "RESPONSE",
        message: input.message
    });
}

async function sendPageText_(recipientId, text) {
    return sendPageMessage_({
        recipientId,
        message: { text: text.slice(0, 2000) }
    });
}

/**
 * @param {{ recipientId: string, sessionId: string, prompt: string, labels: string[], values: string[] }} input
 */
async function sendPageQuickReplies_(input) {
    const labels = input.labels.slice(0, 13);
    const values = input.values.slice(0, 13);
    rememberChoiceOptions_(input.sessionId, labels, values.length ? values : labels);
    return sendPageMessage_({
        recipientId: input.recipientId,
        message: {
            text: waShortTitle_(input.prompt || "Please choose an option:", 2000),
            quick_replies: labels.map((label, i) => ({
                content_type: "text",
                title: waShortTitle_(label, 20),
                payload: (values[i] || label).slice(0, 1000)
            }))
        }
    });
}

/**
 * @param {{ recipientId: string, card: WaCarouselCard }} input
 * @returns {Record<string, unknown> | null}
 */
function pageGenericElementForCard_(input) {
    const card = input.card;
    const title = waShortTitle_(card.title || "Option", 80);
    if (!title) {
        return null;
    }
    const subtitleRaw = waShortTitle_(card.subtitle || "", 80);
    /** @type {Record<string, unknown>} */
    const el = {
        title,
        buttons: [
            {
                type: "postback",
                title: waShortTitle_(card.ctaLabel || "View", 20),
                payload: (card.ctaValue || card.title || card.subtitle).slice(0, 1000)
            }
        ]
    };
    if (subtitleRaw && subtitleRaw !== title) {
        el.subtitle = subtitleRaw;
    }
    if (isHttpsUrl_(card.imageUrl)) {
        el.image_url = card.imageUrl;
    }
    return el;
}

/**
 * @param {{ recipientId: string, message: string, cards: WaCarouselCard[] }} input
 */
async function sendPageGenericCarousel_(input) {
    const cards = input.cards.slice(0, 10);
    if (!cards.length) {
        return null;
    }
    if (input.message) {
        await sendPageText_(input.recipientId, input.message);
    }
    for (const card of cards) {
        const el = pageGenericElementForCard_({ recipientId: input.recipientId, card });
        if (!el) {
            continue;
        }
        try {
            await sendPageMessage_({
                recipientId: input.recipientId,
                message: {
                    attachment: {
                        type: "template",
                        payload: {
                            template_type: "generic",
                            elements: [el]
                        }
                    }
                }
            });
        } catch (e) {
            log_("page_card_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
            const line = [card.title, card.subtitle].filter(Boolean).join(" — ");
            if (line) {
                await sendPageText_(input.recipientId, line);
            }
        }
    }
    return null;
}

/**
 * @param {{ recipientId: string, message: string, urls: string[] }} input
 */
async function sendPageGallery_(input) {
    if (input.message) {
        await sendPageText_(input.recipientId, input.message);
    }
    const urls = input.urls.filter(isHttpsUrl_).slice(0, 10);
    if (urls.length >= 2) {
        const elements = urls.map((url, i) => ({
            title: `Image ${i + 1}`,
            image_url: url,
            buttons: [
                {
                    type: "web_url",
                    url,
                    title: "Open"
                }
            ]
        }));
        return sendPageMessage_({
            recipientId: input.recipientId,
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements
                    }
                }
            }
        });
    }
    for (const url of urls) {
        try {
            await sendPageMessage_({
                recipientId: input.recipientId,
                message: {
                    attachment: {
                        type: "image",
                        payload: { url, is_reusable: false }
                    }
                }
            });
        } catch (e) {
            log_("page_gallery_image_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }
    return null;
}

/**
 * @param {string} recipientId
 * @param {string} sessionId
 * @param {CxReplyParts} parts
 */
async function sendPageChoicesFromParts_(recipientId, sessionId, parts) {
    if (!parts.choices.length) {
        return;
    }
    const prompt = parts.choicePrompt || (parts.texts.length ? "Please choose an option:" : "How can I help you?");
    try {
        await sendPageQuickReplies_({
            recipientId,
            sessionId,
            prompt,
            labels: choiceLabels_(parts),
            values: choiceValues_(parts)
        });
    } catch (e) {
        const numbered = parts.choices.map((opt, i) => `${i + 1}. ${opt.label}`).join("\n");
        await sendPageText_(recipientId, `${prompt}\n\n${numbered}\n\nReply with the option text.`);
        log_("page_chip_fallback", {
            error: e && e.message ? String(e.message).slice(0, 200) : String(e)
        });
    }
}

/**
 * @param {{ recipientId: string, sessionId: string, url: string, message: string }} input
 */
async function sendPageVideo_(input) {
    const url = trim_(input.url);
    if (!url) {
        return;
    }
    const message = trim_(input.message);
    const youtubeId = parseYoutubeVideoId_(url);

    /** @param {string} videoUrl */
    async function attachNativeVideo_(videoUrl) {
        if (message) {
            await sendPageText_(input.recipientId, message);
        }
        await sendPageMessage_({
            recipientId: input.recipientId,
            message: {
                attachment: {
                    type: "video",
                    payload: { url: videoUrl, is_reusable: false }
                }
            }
        });
    }

    if (youtubeId) {
        const openUrl = youtubeWatchUrl_(youtubeId);
        const thumb = youtubeThumbnailUrl_(youtubeId);
        if (message) {
            await sendPageText_(input.recipientId, message);
        }
        try {
            await sendPageMessage_({
                recipientId: input.recipientId,
                message: {
                    attachment: {
                        type: "template",
                        payload: {
                            template_type: "generic",
                            elements: [
                                {
                                    title: waShortTitle_("Video", 80),
                                    image_url: thumb,
                                    buttons: [
                                        {
                                            type: "web_url",
                                            url: openUrl,
                                            title: waShortTitle_("Watch video", 20)
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            });
            return;
        } catch (e) {
            log_("page_youtube_card_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
        await sendPageMessage_({
            recipientId: input.recipientId,
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: waShortTitle_(message || "Tap below to watch the video:", 640),
                        buttons: [{ type: "web_url", url: openUrl, title: "Watch video" }]
                    }
                }
            }
        });
        return;
    }

    if (isDirectVideoFileUrl_(url) || isHttpsUrl_(url)) {
        try {
            await attachNativeVideo_(url);
            return;
        } catch (e) {
            log_("page_video_attach_skip", {
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }

    if (message) {
        await sendPageText_(input.recipientId, message);
    }
    await sendPageMessage_({
        recipientId: input.recipientId,
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: waShortTitle_(message || "Tap below to watch the video:", 640),
                    buttons: [{ type: "web_url", url, title: "Watch video" }]
                }
            }
        }
    });
}

/**
 * @param {{ recipientId: string, sessionId: string, parts: CxReplyParts }} input
 */
async function sendPageCxReply_(input) {
    const parts = input.parts;
    const supplemental = supplementalTextBlocks_(parts, webChatUrl_());
    let leadText = [...parts.texts, ...supplemental].filter(Boolean).join("\n\n");

    if (!parts.gallery && !parts.cardCarousel && parts.images.length > 0) {
        if (leadText) {
            await sendPageText_(input.recipientId, leadText);
            leadText = "";
        }
        for (const url of parts.images) {
            try {
                await sendPageMessage_({
                    recipientId: input.recipientId,
                    message: {
                        attachment: {
                            type: "image",
                            payload: { url, is_reusable: false }
                        }
                    }
                });
            } catch (e) {
                log_("page_rich_image_skip", {
                    error: e && e.message ? String(e.message).slice(0, 160) : String(e)
                });
            }
        }
    }

    if (parts.cardCarousel?.cards?.length) {
        try {
            await sendPageGenericCarousel_({
                recipientId: input.recipientId,
                message: parts.cardCarousel.message || leadText,
                cards: parts.cardCarousel.cards
            });
        } catch (e) {
            log_("page_carousel_fallback", {
                error: e && e.message ? String(e.message).slice(0, 200) : String(e)
            });
            const lines = parts.cardCarousel.cards.map((c, i) => {
                const line = [c.title, c.subtitle].filter(Boolean).join(" — ");
                return `${i + 1}. ${line || `Option ${i + 1}`}`;
            });
            await sendPageText_(
                input.recipientId,
                `${parts.cardCarousel.message || leadText || "Choose an option:"}\n\n${lines.join("\n")}`
            );
        }
        if (parts.choices.length) {
            await sendPageChoicesFromParts_(input.recipientId, input.sessionId, parts);
        }
        return;
    }

    if (parts.gallery?.urls?.length) {
        const hasChoices = parts.choices.length > 0;
        let intro = trim_(leadText);
        if (!hasChoices) {
            intro = [intro, trim_(parts.gallery.message)].filter(Boolean).join("\n\n");
        }
        await sendPageGallery_({
            recipientId: input.recipientId,
            message: intro,
            urls: parts.gallery.urls
        });
        if (hasChoices) {
            await sendPageChoicesFromParts_(input.recipientId, input.sessionId, parts);
        }
        return;
    }

    if (parts.video?.url) {
        await sendPageVideo_({
            recipientId: input.recipientId,
            url: parts.video.url,
            message: parts.video.message || leadText
        });
        if (parts.choices.length) {
            await sendPageChoicesFromParts_(input.recipientId, input.sessionId, parts);
        }
        return;
    }

    if (leadText) {
        await sendPageText_(input.recipientId, leadText);
    }

    if (parts.choices.length) {
        await sendPageChoicesFromParts_(input.recipientId, input.sessionId, parts);
        return;
    }

    if (!leadText && parts.images.length === 0) {
        await sendPageText_(input.recipientId, "Sorry, I could not process that. Please try again.");
    }
}

/**
 * @param {unknown} event
 * @param {string} sessionId
 * @returns {string}
 */
function extractInboundPageText_(event, sessionId) {
    if (!event || typeof event !== "object") {
        return "";
    }
    if (event.postback && typeof event.postback === "object") {
        const payload = trim_(event.postback.payload);
        if (payload) {
            return payload;
        }
        const title = trim_(event.postback.title);
        if (title) {
            return resolveChoiceSelection_(sessionId, "", title) || title;
        }
    }
    const msg = event.message;
    if (!msg || typeof msg !== "object" || msg.is_echo) {
        return "";
    }
    if (msg.quick_reply && typeof msg.quick_reply === "object") {
        const payload = trim_(msg.quick_reply.payload);
        if (payload) {
            return payload;
        }
    }
    if (typeof msg.text === "string") {
        return trim_(msg.text);
    }
    return "";
}

/**
 * @param {{
 *   channel: "whatsapp" | "facebook" | "instagram",
 *   from: string,
 *   text: string,
 *   messageId: string,
 *   sessionId: string
 * }} input
 */
async function processInboundMetaMessage_(input) {
    const c = metaConfig_();
    const cx = await detectIntentCx_({
        sessionId: input.sessionId,
        text: input.text,
        languageCode: c.languageCode
    });
    const parts = extractCxResponse_(cx);

    if (input.channel === "whatsapp") {
        await sendWhatsappCxReply_({
            to: input.from,
            sessionId: input.sessionId,
            parts
        });
    } else {
        await sendPageCxReply_({
            recipientId: input.from,
            sessionId: input.sessionId,
            parts
        });
    }

    log_("reply_sent", {
        channel: input.channel,
        from_masked: input.from.length > 4 ? `***${input.from.slice(-4)}` : "***",
        sessionId: input.sessionId,
        text_chars: parts.texts.join(" ").length,
        choice_count: parts.choices.length,
        card_count: parts.cardCarousel?.cards?.length || 0,
        gallery_count: parts.gallery?.urls?.length || 0,
        video: !!parts.video?.url,
        video_title: trim_(parts.video?.title) || "",
        form: !!parts.form,
        live_agent: !!parts.liveAgent,
        image_count: parts.images.length
    });
    if (parts.video?.url && !trim_(parts.video?.title)) {
        /** @type {string[]} */
        const payloadKeys = [];
        const rawMsgs = cx?.queryResult?.responseMessages;
        if (Array.isArray(rawMsgs)) {
            for (const m of rawMsgs) {
                const p = m?.payload;
                if (p && typeof p === "object" && !Array.isArray(p)) {
                    payloadKeys.push(...Object.keys(/** @type {Record<string, unknown>} */ (p)));
                }
            }
        }
        log_("video_title_missing", {
            payload_keys: [...new Set(payloadKeys)].sort().join(",") || "(none)"
        });
    }
}

/**
 * @param {unknown} msg
 * @param {string} sessionId
 * @returns {string}
 */
function extractInboundWhatsappText_(msg, sessionId) {
    if (!msg || typeof msg !== "object") {
        return "";
    }
    if (msg.type === "text" && msg.text?.body) {
        return trim_(msg.text.body);
    }
    if (msg.type === "interactive" && msg.interactive) {
        const ir = msg.interactive;
        if (ir.type === "button_reply" && ir.button_reply) {
            return resolveChoiceSelection_(
                sessionId,
                trim_(ir.button_reply.id),
                trim_(ir.button_reply.title)
            );
        }
        if (ir.type === "list_reply" && ir.list_reply) {
            return resolveChoiceSelection_(
                sessionId,
                trim_(ir.list_reply.id),
                trim_(ir.list_reply.title)
            );
        }
    }
    return "";
}

function sessionIdForChannelUser_(channel, userId) {
    const prefix =
        channel === "instagram" ? "ig" : channel === "facebook" ? "fb" : "wa";
    const safe = String(userId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    return `${prefix}_${safe}`;
}

function sessionIdForWaUser_(waUserId) {
    return sessionIdForChannelUser_("whatsapp", waUserId);
}

async function getDialogflowAccessToken_() {
    const key = getDialogflowServiceAccountCredentials_();
    if (!key) {
        throw new Error("Missing service account JSON for Dialogflow CX");
    }
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: [DIALOGFLOW_SCOPE]
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token?.token;
    if (!accessToken) {
        throw new Error("Could not obtain Google access token for Dialogflow");
    }
    return accessToken;
}

/**
 * @param {{ sessionId: string, text: string, languageCode: string }} input
 */
async function detectIntentCx_(input) {
    const c = whatsappConfig_();
    const accessToken = await getDialogflowAccessToken_();
    const host = `${c.location}-dialogflow.googleapis.com`;
    const sessionPath = [
        "projects",
        c.projectId,
        "locations",
        c.location,
        "agents",
        c.agentId,
        "sessions",
        input.sessionId
    ].join("/");
    const url = `https://${host}/v3/${sessionPath}:detectIntent`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            queryInput: {
                text: { text: input.text },
                languageCode: input.languageCode
            }
        })
    });
    const raw = await res.text();
    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = {};
    }
    if (!res.ok) {
        const errMsg =
            data?.error?.message || data?.message || raw.slice(0, 400) || `HTTP ${res.status}`;
        throw new Error(`Dialogflow detectIntent failed: ${errMsg}`);
    }
    return data;
}

function verifyMetaSignature_(rawBody, signatureHeader, appSecret) {
    if (!appSecret) {
        return true;
    }
    const sig = trim_(signatureHeader);
    if (!sig.startsWith("sha256=")) {
        return false;
    }
    const expected =
        "sha256=" +
        crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        return false;
    }
}

/** GET — Meta webhook verification */
function handleVerify_(req, res) {
    const c = whatsappConfig_();
    const mode = trim_(req.query["hub.mode"]);
    const token = trim_(req.query["hub.verify_token"]);
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && token === c.verifyToken && challenge != null) {
        log_("verify_ok");
        return res.status(200).send(String(challenge));
    }
    log_("verify_failed", { mode, token_match: token === c.verifyToken });
    return res.sendStatus(403);
}

/** POST — incoming Meta events (WhatsApp, Facebook Page, Instagram) */
async function handleWebhookPost_(req, res) {
    const c = metaConfig_();
    const rawBody = req.rawBody;
    if (c.appSecret && rawBody) {
        const ok = verifyMetaSignature_(
            rawBody,
            req.get("x-hub-signature-256") || "",
            c.appSecret
        );
        if (!ok) {
            log_("signature_invalid");
            return res.sendStatus(403);
        }
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const objectType = trim_(body.object);

    if (objectType === "whatsapp_business_account") {
        const entries = Array.isArray(body.entry) ? body.entry : [];
        /** @type {Promise<void>[]} */
        const jobs = [];
        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const value = change?.value && typeof change.value === "object" ? change.value : {};
                const messages = Array.isArray(value.messages) ? value.messages : [];
                for (const msg of messages) {
                    const messageId = trim_(msg.id);
                    if (wasSeenMessage_(messageId)) {
                        continue;
                    }
                    const from = trim_(msg.from);
                    const sessionId = sessionIdForChannelUser_("whatsapp", from);
                    const text = extractInboundWhatsappText_(msg, sessionId);
                    if (!from || !text) {
                        continue;
                    }
                    jobs.push(
                        processInboundMetaMessage_({
                            channel: "whatsapp",
                            from,
                            text,
                            messageId,
                            sessionId
                        }).catch(async (e) => {
                            const errMsg = e && e.message ? e.message : String(e);
                            log_("message_error", { channel: "whatsapp", error: errMsg.slice(0, 300) });
                            try {
                                await sendWhatsappText_({
                                    to: from,
                                    body: "Sorry, something went wrong. Please try again in a moment."
                                });
                            } catch {
                                /* ignore */
                            }
                        })
                    );
                }
            }
        }
        res.sendStatus(200);
        if (jobs.length) {
            void Promise.allSettled(jobs);
        }
        return;
    }

    if (objectType === "page" || objectType === "instagram") {
        const channel = objectType === "instagram" ? "instagram" : "facebook";
        const entries = Array.isArray(body.entry) ? body.entry : [];
        /** @type {Promise<void>[]} */
        const jobs = [];
        for (const entry of entries) {
            const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
            for (const event of messaging) {
                const messageId =
                    trim_(event?.message?.mid)
                    || trim_(event?.postback?.mid)
                    || `${channel}_${event?.timestamp || ""}_${event?.sender?.id || ""}`;
                if (wasSeenMessage_(messageId)) {
                    continue;
                }
                const from = trim_(event?.sender?.id);
                const sessionId = sessionIdForChannelUser_(channel, from);
                const text = extractInboundPageText_(event, sessionId);
                if (!from || !text) {
                    continue;
                }
                jobs.push(
                    processInboundMetaMessage_({
                        channel,
                        from,
                        text,
                        messageId,
                        sessionId
                    }).catch(async (e) => {
                        const errMsg = e && e.message ? e.message : String(e);
                        log_("message_error", { channel, error: errMsg.slice(0, 300) });
                        try {
                            await sendPageText_(
                                from,
                                "Sorry, something went wrong. Please try again in a moment."
                            );
                        } catch {
                            /* ignore */
                        }
                    })
                );
            }
        }
        res.sendStatus(200);
        if (jobs.length) {
            void Promise.allSettled(jobs);
        }
        return;
    }

    return res.sendStatus(200);
}

/**
 * @param {string} accessToken
 * @param {string} phoneNumberId
 * @param {string} graphVersion
 */
async function probeWhatsappAccessToken_(accessToken, phoneNumberId, graphVersion) {
    if (!accessToken || !phoneNumberId) {
        return { valid: false, error: "missing_token_or_phone_number_id" };
    }
    try {
        const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const raw = await res.text();
        let data = {};
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = {};
        }
        if (!res.ok) {
            const err = data?.error && typeof data.error === "object" ? data.error : {};
            return {
                valid: false,
                http_status: res.status,
                code: err.code ?? null,
                type: err.type ?? null,
                message: err.message || raw.slice(0, 200) || `HTTP ${res.status}`
            };
        }
        return {
            valid: true,
            display_phone_number: data.display_phone_number ?? null,
            verified_name: data.verified_name ?? null
        };
    } catch (e) {
        return {
            valid: false,
            message: e && e.message ? String(e.message).slice(0, 200) : String(e)
        };
    }
}

async function handleHealth_(req, res) {
    const c = metaConfig_();
    const missing = missingWhatsappEnvKeys_();
    const dfKey = getDialogflowServiceAccountCredentials_();
    const dfProjectId =
        dfKey && typeof dfKey.project_id === "string" ? trim_(dfKey.project_id) : "";
    const dfClientEmail =
        dfKey && typeof dfKey.client_email === "string" ? trim_(dfKey.client_email) : "";
    const webhookUrlHint =
        trim_(process.env.CONVERSATIONS_PUBLIC_BASE_URL) ||
        (trim_(process.env.RAILWAY_PUBLIC_DOMAIN)
            ? `https://${trim_(process.env.RAILWAY_PUBLIC_DOMAIN)}`
            : "");
    const tokenProbe = await probeWhatsappAccessToken_(
        c.whatsapp.accessToken,
        c.whatsapp.phoneNumberId,
        c.graphVersion
    );
    return res.status(200).json({
        ok: missing.length === 0 && tokenProbe.valid !== false,
        webhook_path: WEBHOOK_PATH,
        webhook_url_example: webhookUrlHint
            ? `${webhookUrlHint.replace(/\/+$/, "")}${WEBHOOK_PATH}`
            : `https://YOUR-API.up.railway.app${WEBHOOK_PATH}`,
        missing_env: missing,
        dialogflow: {
            projectId: c.projectId,
            location: c.location,
            agentId: c.agentId ? `${c.agentId.slice(0, 8)}…` : "",
            languageCode: c.languageCode,
            credentials_source: trim_(process.env.DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON)
                ? "DIALOGFLOW_CX_SERVICE_ACCOUNT_JSON"
                : "FIREBASE_SERVICE_ACCOUNT_JSON",
            service_account_project_id: dfProjectId,
            service_account_email: dfClientEmail
                ? dfClientEmail.replace(/^(.{3}).*(@.+)$/, "$1…$2")
                : ""
        },
        whatsapp: {
            phone_number_id_set: !!c.whatsapp.phoneNumberId,
            phone_number_id_suffix: c.whatsapp.phoneNumberId ? c.whatsapp.phoneNumberId.slice(-6) : "",
            access_token_set: !!c.whatsapp.accessToken,
            access_token_prefix: c.whatsapp.accessToken ? c.whatsapp.accessToken.slice(0, 6) + "…" : "",
            access_token_valid: tokenProbe.valid === true,
            access_token_error: tokenProbe.valid ? null : (tokenProbe.message || tokenProbe.error || null),
            access_token_error_code: tokenProbe.valid ? null : (tokenProbe.code ?? null),
            graph_api_version: c.graphVersion,
            verify_token_set: !!c.verifyToken,
            app_secret_set: !!c.appSecret,
            token_fix_hint: tokenProbe.valid
                ? null
                : "Regenerate a permanent token in Meta → WhatsApp → API setup, update WHATSAPP_ACCESS_TOKEN on Railway, redeploy."
        },
        facebook_instagram: {
            page_id_set: !!c.page.pageId,
            page_id_suffix: c.page.pageId ? c.page.pageId.slice(-6) : "",
            page_access_token_set: !!c.page.accessToken,
            page_access_token_prefix: c.page.accessToken ? c.page.accessToken.slice(0, 6) + "…" : "",
            note: "Same webhook URL; subscribe Page (messages) and Instagram (messages) in Meta app"
        },
        supported_payloads: [
            "richContent: chips, info, accordion, description, image",
            "open_card_carousel",
            "open_gallery",
            "open_video",
            "open_form",
            "dfchat_inline_select",
            "request_live_agent"
        ],
        youtube_whatsapp: {
            mode: "link_preview",
            note: "YouTube cannot embed in WhatsApp like the web widget. open_video sends the YouTube URL with preview_url; tap opens YouTube to play.",
            native_mp4_player: "direct .mp4 URLs only (not YouTube)"
        }
    });
}

/**
 * @param {import("express").Express} app
 */
export function mountWhatsappRoutes(app) {
    const rawJson = express.raw({ type: "application/json", limit: "512kb" });

    app.get(WEBHOOK_PATH, handleVerify_);

    app.post(WEBHOOK_PATH, rawJson, (req, res, next) => {
        req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
        try {
            req.body = req.rawBody.length
                ? JSON.parse(req.rawBody.toString("utf8"))
                : {};
        } catch {
            req.body = {};
        }
        next();
    }, handleWebhookPost_);

    app.get("/api/whatsapp/health", handleHealth_);
}
