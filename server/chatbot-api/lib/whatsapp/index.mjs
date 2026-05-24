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
import { normalizeLeadChannel } from "../meta-channels/normalize-channel.mjs";
import {
    metaContactHintsForCxSession_,
    rememberMetaContact_,
    whatsappProfileNameFromContacts_
} from "../meta-channels/contact-profile.mjs";
import { syncMetaInboundMessageToSheet_ } from "../meta-channels/sheet-sync.mjs";

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

/** @param {number} ms */
function delayMs_(ms) {
    const n = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (n === 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        setTimeout(resolve, n);
    });
}

/** Gap between gallery images so WhatsApp groups them into one swipeable album. */
function galleryImageGapMs_() {
    const n = Number.parseInt(process.env.WHATSAPP_GALLERY_IMAGE_GAP_MS || "300", 10);
    return Number.isFinite(n) ? Math.max(0, n) : 300;
}

/** Wait after the last image before sending the options menu (images deliver slower than buttons). */
function galleryMenuDelayMs_(imageCount) {
    const base = Number.parseInt(process.env.WHATSAPP_GALLERY_MENU_DELAY_MS || "3500", 10);
    const perImage = Number.parseInt(process.env.WHATSAPP_GALLERY_MENU_DELAY_PER_IMAGE_MS || "900", 10);
    const count = Math.max(1, imageCount || 1);
    const b = Number.isFinite(base) ? Math.max(0, base) : 3500;
    const p = Number.isFinite(perImage) ? Math.max(0, perImage) : 900;
    return b + (count - 1) * p;
}

/** Gap between card-carousel cards so WhatsApp never groups them into one album. */
function cardCarouselGapMs_() {
    const n = Number.parseInt(process.env.WHATSAPP_CARD_CAROUSEL_GAP_MS || "1800", 10);
    return Number.isFinite(n) ? Math.max(0, n) : 1800;
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
    const id = trim_(choiceId);
    const m = /^(?:chip|card)_(\d+)$/.exec(id);
    if (m) {
        const idx = Number.parseInt(m[1], 10);
        return cached.values[idx] || cached.labels[idx] || fallbackTitle;
    }
    return resolveTextChoiceReply_(sessionId, fallbackTitle) || fallbackTitle;
}

/**
 * Map typed replies (1, 2, or option label) to the Dialogflow value from the last menu.
 * @param {string} sessionId
 * @param {string} text
 */
function resolveTextChoiceReply_(sessionId, text) {
    const cached = waSessionChoiceMap_.get(sessionId);
    if (!cached || Date.now() - cached.at > CHOICE_MAP_TTL_MS) {
        return text;
    }
    const t = trim_(text);
    if (!t) {
        return text;
    }
    const numMatch = /^#?(\d+)\.?$/.exec(t);
    if (numMatch) {
        const idx = Number.parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < cached.labels.length) {
            return cached.values[idx] || cached.labels[idx] || text;
        }
    }
    const lower = t.toLowerCase();
    for (let i = 0; i < cached.labels.length; i += 1) {
        if (trim_(cached.labels[i]).toLowerCase() === lower) {
            return cached.values[i] || cached.labels[i];
        }
    }
    for (let i = 0; i < cached.values.length; i += 1) {
        if (trim_(cached.values[i]).toLowerCase() === lower) {
            return cached.values[i];
        }
    }
    return text;
}

/** WhatsApp interactive menus require a body; omit option names when payload has no message. */
const WA_INTERACTIVE_BODY_PLACEHOLDER = "\u200b";

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
 * @param {{ to: string, body: string, labels: string[], idPrefix?: string }} input
 */
async function sendWhatsappChoiceMenu_(input) {
    const labels = input.labels.slice(0, 10);
    const idPrefix = input.idPrefix || "chip";
    const body = waShortTitle_(trim_(input.body), 1024);
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
        const label = c.title
            || c.ctaLabel
            || [c.subtitle].filter(Boolean).join("")
            || `Option ${i + 1}`;
        const value = c.ctaValue || c.title || c.subtitle || label;
        return { label, value };
    });
}

/**
 * @param {WaCarouselCard} card
 */
function formatCardBodyText_(card) {
    const title = trim_(card.title);
    const subtitle = trim_(card.subtitle);
    if (title && subtitle) {
        return `${title}\n${subtitle}`;
    }
    return title || subtitle || "";
}

/**
 * One carousel card: image header + title/subtitle body + single reply button.
 * @param {{ to: string, card: WaCarouselCard, index: number }} input
 */
async function sendWhatsappCardInteractive_(input) {
    const bodyText = formatCardBodyText_(input.card)
        || trim_(input.card.ctaLabel)
        || `Option ${input.index + 1}`;
    const buttonLabel = waShortTitle_(trim_(input.card.ctaLabel) || trim_(input.card.title) || "Select", 20);
    if (!bodyText || !buttonLabel) {
        return null;
    }
    /** @type {Record<string, unknown>} */
    const interactive = {
        type: "button",
        body: { text: bodyText.slice(0, 1024) },
        action: {
            buttons: [
                {
                    type: "reply",
                    reply: {
                        id: `card_${input.index}`,
                        title: buttonLabel
                    }
                }
            ]
        }
    };
    if (isHttpsUrl_(input.card.imageUrl)) {
        interactive.header = {
            type: "image",
            image: { link: input.card.imageUrl }
        };
    }
    return whatsappGraphPost_({
        messaging_product: "whatsapp",
        to: input.to,
        type: "interactive",
        interactive
    });
}

/**
 * One card as separate messages: title/subtitle text, then image (never batched into an album).
 * @param {string} to
 * @param {WaCarouselCard} card
 */
async function sendWhatsappCardDisplay_(to, card) {
    const caption = formatCardBodyText_(card);
    if (caption) {
        await sendWhatsappText_({ to, body: caption });
    }
    if (!isHttpsUrl_(card.imageUrl)) {
        return;
    }
    try {
        await sendWhatsappImage_({ to, link: card.imageUrl });
    } catch (e) {
        log_("card_image_skip", {
            error: e && e.message ? String(e.message).slice(0, 160) : String(e)
        });
    }
}

/**
 * Card carousel cards one-by-one with spacing — never grouped as a WhatsApp album.
 * @param {string} to
 * @param {WaCarouselCard[]} cards
 */
async function sendWhatsappCardCarouselSeparated_(to, cards) {
    const list = cards.slice(0, 10);
    const gapMs = cardCarouselGapMs_();
    for (let i = 0; i < list.length; i += 1) {
        if (i > 0 && gapMs > 0) {
            await delayMs_(gapMs);
        }
        await sendWhatsappCardDisplay_(to, list[i]);
    }
}

/**
 * @param {string} to
 * @param {string} sessionId
 * @param {WaCarouselCard[]} cards
 * @param {CxReplyParts} parts
 */
async function sendWhatsappCardCarouselWithOptions_(to, sessionId, cards, parts) {
    const list = cards.slice(0, 10);
    const opts = cardCarouselChoiceOptions_(list);
    if (!opts.length) {
        return;
    }
    rememberChoiceOptions_(sessionId, opts.map((o) => o.label), opts.map((o) => o.value));

    const intro = trim_(parts.choicePrompt) || trim_(parts.cardCarousel?.message) || "";
    if (intro) {
        await sendWhatsappText_({ to, body: intro });
    }

    const gapMs = cardCarouselGapMs_();
    for (let i = 0; i < list.length; i += 1) {
        if (i > 0 && gapMs > 0) {
            await delayMs_(gapMs);
        }
        const card = list[i];
        const caption = formatCardBodyText_(card);
        const buttonLabel = trim_(card.ctaLabel) || trim_(card.title) || "Select";
        try {
            const sent = await sendWhatsappCardInteractive_({ to, card, index: i });
            if (!sent) {
                throw new Error("card_interactive_empty");
            }
        } catch (e) {
            await sendWhatsappCardDisplay_(to, card);
            try {
                const body = caption || buttonLabel;
                await whatsappGraphPost_({
                    messaging_product: "whatsapp",
                    to,
                    type: "interactive",
                    interactive: {
                        type: "button",
                        body: { text: body.slice(0, 1024) },
                        action: {
                            buttons: [
                                {
                                    type: "reply",
                                    reply: {
                                        id: `card_${i}`,
                                        title: waShortTitle_(buttonLabel, 20)
                                    }
                                }
                            ]
                        }
                    }
                });
            } catch (btnErr) {
                await sendWhatsappText_({
                    to,
                    body: `${caption || buttonLabel}\n\nReply: ${buttonLabel}`
                });
                log_("card_button_fallback", {
                    index: i,
                    error: btnErr && btnErr.message ? String(btnErr.message).slice(0, 200) : String(btnErr)
                });
            }
            log_("card_interactive_fallback", {
                index: i,
                error: e && e.message ? String(e.message).slice(0, 200) : String(e)
            });
        }
    }
}

/**
 * @param {{ to: string, message: string, cards: WaCarouselCard[] }} input
 * @deprecated Use sendWhatsappCardCarouselSeparated_ — plain image batches group in WhatsApp.
 */
async function sendWhatsappCardCarousel_(input) {
    const message = trim_(input.message);
    if (message) {
        await sendWhatsappText_({ to: input.to, body: message });
    }
    await sendWhatsappCardCarouselSeparated_(input.to, input.cards);
}

/**
 * @param {"numbered" | "carousel"} displayMode
 * @param {string} to
 * @param {string} sessionId
 * @param {{ label: string, value: string }[]} options
 * @param {string} menuPrompt
 */
async function sendWhatsappOptions_(to, sessionId, options, menuPrompt, displayMode) {
    if (!options.length) {
        return;
    }
    rememberChoiceOptions_(
        sessionId,
        options.map((o) => o.label),
        options.map((o) => o.value)
    );
    const prompt = trim_(menuPrompt);
    const labels = options.map((o) => o.label);
    const numbered = options.map((opt, i) => `${i + 1}. ${opt.label}`).join("\n");
    const mode = displayMode === "numbered" ? "numbered" : "carousel";

    if (mode === "numbered") {
        await sendWhatsappText_({
            to,
            body: prompt ? `${prompt}\n\n${numbered}` : numbered
        });
        return;
    }

    const menuBody = prompt || WA_INTERACTIVE_BODY_PLACEHOLDER;
    const sent = await sendWhatsappChoiceMenu_({
        to,
        body: menuBody,
        labels,
        idPrefix: "chip"
    });
    if (!sent) {
        log_("choice_menu_empty", { mode: "carousel" });
    }
}

/**
 * @param {string} to
 * @param {string} sessionId
 * @param {{ label: string, value: string }[]} options
 * @param {string} menuPrompt
 * @param {"numbered" | "carousel"} displayMode
 */
async function sendWhatsappChoiceMenuFromOptions_(to, sessionId, options, menuPrompt, displayMode) {
    await sendWhatsappOptions_(to, sessionId, options, menuPrompt, displayMode);
}

/**
 * @param {{ urls?: string[], items?: Array<{ url?: string, title?: string }> } | null | undefined} gallery
 * @returns {Array<{ url: string, title: string }>}
 */
function galleryItemsFromParts_(gallery) {
    if (!gallery) {
        return [];
    }
    if (Array.isArray(gallery.items) && gallery.items.length > 0) {
        /** @type {Array<{ url: string, title: string }>} */
        const out = [];
        for (let i = 0; i < gallery.items.length; i += 1) {
            const row = gallery.items[i];
            const url = trim_(row && row.url);
            if (!isHttpsUrl_(url)) {
                continue;
            }
            out.push({ url, title: trim_(row && row.title).slice(0, 120) });
        }
        return out;
    }
    const urls = Array.isArray(gallery.urls) ? gallery.urls : [];
    return urls
        .map((u) => trim_(u))
        .filter((u) => isHttpsUrl_(u))
        .map((url) => ({ url, title: "" }));
}

/**
 * Gallery: batch all images (WhatsApp groups them into a swipeable album), then options menu.
 * @param {string} to
 * @param {string} sessionId
 * @param {CxReplyParts} parts
 */
async function sendWhatsappGalleryFull_(to, sessionId, parts) {
    const gallery = parts.gallery;
    const items = galleryItemsFromParts_(gallery);
    if (!items.length) {
        return;
    }
    const gapMs = galleryImageGapMs_();

    for (let i = 0; i < items.length; i += 1) {
        if (i > 0 && gapMs > 0) {
            await delayMs_(gapMs);
        }
        try {
            const caption = trim_(items[i].title);
            await sendWhatsappImage_({
                to,
                link: items[i].url,
                ...(caption ? { caption } : {})
            });
        } catch (e) {
            log_("gallery_image_skip", {
                index: i,
                error: e && e.message ? String(e.message).slice(0, 160) : String(e)
            });
        }
    }

    const options = gallery?.options?.length ? gallery.options : parts.choices;
    const menuPrompt = trim_(gallery?.prompt) || trim_(parts.choicePrompt) || "";

    if (options.length || trim_(gallery?.message)) {
        await delayMs_(galleryMenuDelayMs_(items.length));
    }

    if (options.length) {
        await sendWhatsappChoiceMenuFromOptions_(
            to,
            sessionId,
            options,
            menuPrompt,
            parts.optionsDisplay || "carousel"
        );
    } else if (trim_(gallery.message)) {
        await sendWhatsappText_({ to, body: trim_(gallery.message) });
    }
}

/**
 * @param {{ to: string, message: string, urls: string[], items?: Array<{ url: string, title?: string }> }} input
 */
async function sendWhatsappGallery_(input) {
    const message = trim_(input.message);
    if (message) {
        await sendWhatsappText_({ to: input.to, body: message });
    }
    const items = Array.isArray(input.items) && input.items.length
        ? input.items
        : (input.urls || []).map((url) => ({ url, title: "" }));
    for (const row of items) {
        const link = trim_(row && row.url);
        if (!isHttpsUrl_(link)) {
            continue;
        }
        try {
            const caption = trim_(row && row.title);
            await sendWhatsappImage_({
                to: input.to,
                link,
                ...(caption ? { caption } : {})
            });
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
    const menuPrompt = resolveChoiceMenuPrompt_(parts, opts.alreadyShown || "");
    await sendWhatsappOptions_(
        to,
        sessionId,
        parts.choices,
        menuPrompt,
        parts.optionsDisplay || "carousel"
    );
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
        if (parts.cardCarousel.explicitOptions && parts.choices.length) {
            const intro = trim_(parts.choicePrompt) || trim_(parts.cardCarousel?.message) || "";
            if (intro) {
                await sendWhatsappText_({ to: input.to, body: intro });
            }
            await sendWhatsappCardCarouselSeparated_(input.to, parts.cardCarousel.cards);
            await sendWhatsappChoicesFromParts_(input.to, input.sessionId, parts, {
                alreadyShown: intro
            });
        } else if (parts.optionsDisplay === "numbered") {
            const intro = trim_(parts.choicePrompt) || trim_(parts.cardCarousel?.message) || "";
            if (intro) {
                await sendWhatsappText_({ to: input.to, body: intro });
            }
            await sendWhatsappCardCarouselSeparated_(input.to, parts.cardCarousel.cards);
            const cardOpts = cardCarouselChoiceOptions_(parts.cardCarousel.cards);
            await sendWhatsappOptions_(
                input.to,
                input.sessionId,
                cardOpts,
                "",
                "numbered"
            );
        } else {
            await sendWhatsappCardCarouselWithOptions_(
                input.to,
                input.sessionId,
                parts.cardCarousel.cards,
                parts
            );
        }
        return;
    }

    if (parts.gallery?.urls?.length) {
        const agentText = agentTextBeforePayload_(parts);
        if (agentText) {
            await sendWhatsappText_({ to: input.to, body: agentText });
        }
        await sendWhatsappGalleryFull_(input.to, input.sessionId, parts);
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
    const payloadPrompt =
        trim_(parts.choicePrompt)
        || trim_(parts.gallery?.prompt)
        || trim_(parts.cardCarousel?.message)
        || "";
    const hasChoices =
        parts.choices.length > 0
        || (parts.gallery?.options?.length ?? 0) > 0;
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
        if (hasChoices && payloadPrompt && promptsEquivalent_(s, payloadPrompt)) {
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
 * Choice menu body from payload message only — no backend default prompts.
 * @param {CxReplyParts} parts
 * @param {string} [alreadyShown]
 */
function resolveChoiceMenuPrompt_(parts, alreadyShown) {
    const fromPayload = trim_(parts.choicePrompt);
    if (!fromPayload || promptAlreadyShown_(fromPayload, alreadyShown)) {
        return "";
    }
    return fromPayload;
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
    const prompt = trim_(input.prompt);
    const text = prompt || labels.map((label, i) => `${i + 1}. ${label}`).join("\n");
    return sendPageMessage_({
        recipientId: input.recipientId,
        message: {
            text: waShortTitle_(text, 2000),
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
 * @param {{ recipientId: string, message: string, urls: string[], items?: Array<{ url: string, title?: string }> }} input
 */
async function sendPageGallery_(input) {
    if (input.message) {
        await sendPageText_(input.recipientId, input.message);
    }
    const items = Array.isArray(input.items) && input.items.length
        ? input.items.filter((row) => isHttpsUrl_(trim_(row && row.url))).slice(0, 10)
        : input.urls.filter(isHttpsUrl_).slice(0, 10).map((url) => ({ url, title: "" }));
    if (items.length >= 2) {
        const elements = items.map((row, i) => ({
            title: trim_(row.title) || `Image ${i + 1}`,
            image_url: row.url,
            buttons: [
                {
                    type: "web_url",
                    url: row.url,
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
    for (const row of items) {
        try {
            await sendPageMessage_({
                recipientId: input.recipientId,
                message: {
                    attachment: {
                        type: "image",
                        payload: { url: row.url, is_reusable: false }
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
    const prompt =
        trim_(parts.choicePrompt)
        || trim_(parts.gallery?.prompt)
        || trim_(parts.cardCarousel?.message)
        || "";
    const numbered = parts.choices.map((opt, i) => `${i + 1}. ${opt.label}`).join("\n");
    const mode = parts.optionsDisplay === "numbered" ? "numbered" : "carousel";

    if (mode === "numbered") {
        await sendPageText_(
            recipientId,
            prompt ? `${prompt}\n\n${numbered}` : numbered
        );
        rememberChoiceOptions_(sessionId, choiceLabels_(parts), choiceValues_(parts));
        return;
    }

    try {
        await sendPageQuickReplies_({
            recipientId,
            sessionId,
            prompt,
            labels: choiceLabels_(parts),
            values: choiceValues_(parts)
        });
    } catch (e) {
        await sendPageText_(
            recipientId,
            prompt ? `${prompt}\n\n${numbered}\n\nReply with the option text.` : `${numbered}\n\nReply with the option text.`
        );
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
            const header = trim_(parts.cardCarousel.message || leadText);
            await sendPageText_(
                input.recipientId,
                header ? `${header}\n\n${lines.join("\n")}` : lines.join("\n")
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
            urls: parts.gallery.urls,
            items: parts.gallery.items
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
        return resolveTextChoiceReply_(sessionId, trim_(msg.text));
    }
    return "";
}

/** @type {Map<string, { name: string, at: number }>} */
const graphProfileNameCache_ = new Map();
const GRAPH_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Facebook / Instagram display name via Graph API (Page access token).
 * @param {string} userId PSID / IGSID
 */
async function fetchGraphUserProfileName_(userId) {
    const id = trim_(userId);
    if (!id) {
        return "";
    }
    const cached = graphProfileNameCache_.get(id);
    if (cached && Date.now() - cached.at < GRAPH_PROFILE_TTL_MS) {
        return cached.name;
    }
    const c = metaConfig_();
    const token = c.page.accessToken;
    if (!token) {
        return "";
    }
    const url =
        `https://graph.facebook.com/${c.graphVersion}/${encodeURIComponent(id)}`
        + "?fields=name,first_name,last_name";
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            log_("graph_profile_skip", {
                status: res.status,
                error: trim_(data?.error?.message).slice(0, 120)
            });
            return "";
        }
        const name =
            trim_(data.name)
            || [trim_(data.first_name), trim_(data.last_name)].filter(Boolean).join(" ");
        if (name) {
            graphProfileNameCache_.set(id, { name, at: Date.now() });
        }
        return name;
    } catch (e) {
        log_("graph_profile_skip", {
            error: e && e.message ? String(e.message).slice(0, 120) : String(e)
        });
        return "";
    }
}

/**
 * @param {{
 *   channel: "whatsapp" | "facebook" | "instagram",
 *   from: string,
 *   text: string,
 *   messageId: string,
 *   sessionId: string,
 *   profileName?: string
 * }} input
 */
function cxSessionParams_(cx) {
    const qr = cx && typeof cx === "object" ? /** @type {Record<string, unknown>} */ (cx).queryResult : null;
    if (!qr || typeof qr !== "object") {
        return {};
    }
    const direct = /** @type {Record<string, unknown>} */ (qr).parameters;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return /** @type {Record<string, unknown>} */ (direct);
    }
    const si = /** @type {Record<string, unknown>} */ (qr).sessionInfo;
    const nested =
        si && typeof si === "object" && si.parameters && typeof si.parameters === "object"
            ? si.parameters
            : null;
    return nested && !Array.isArray(nested) ? /** @type {Record<string, unknown>} */ (nested) : {};
}

async function processInboundMetaMessage_(input) {
    const c = metaConfig_();
    const channel = normalizeLeadChannel(input.channel);
    let profileName = trim_(input.profileName);
    if (!profileName && (channel === "instagram" || channel === "facebook")) {
        profileName = await fetchGraphUserProfileName_(input.from);
    }
    if (profileName) {
        rememberMetaContact_(input.sessionId, { name: profileName, channel });
    }

    const contactHints = metaContactHintsForCxSession_({
        sessionId: input.sessionId,
        channel,
        from: input.from,
        profileName
    });

    const cx = await detectIntentCx_({
        sessionId: input.sessionId,
        text: input.text,
        languageCode: c.languageCode,
        channel,
        contactHints
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

    void syncMetaInboundMessageToSheet_({
        channel,
        sessionId: input.sessionId,
        from: input.from,
        userText: input.text,
        profileName,
        cxParams: cxSessionParams_(cx)
    }).then((out) => {
        if (out.ok) {
            log_("sheet_sync", {
                channel: out.channel,
                mode: out.result?.mode || "",
                has_name: Boolean(out.contact?.name),
                has_email: Boolean(out.contact?.email)
            });
        }
    });

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
        return resolveTextChoiceReply_(sessionId, trim_(msg.text.body));
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
 * @param {{ sessionId: string, text: string, languageCode: string, channel?: string, contactHints?: Record<string, string> }} input
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
    const channel = normalizeLeadChannel(input.channel);
    /** @type {Record<string, string>} */
    const sessionParameters = { channel };
    const hints = input.contactHints && typeof input.contactHints === "object" ? input.contactHints : {};
    for (const [k, v] of Object.entries(hints)) {
        const s = trim_(v);
        if (s) {
            sessionParameters[k] = s;
        }
    }
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
            },
            queryParams: {
                parameters: sessionParameters
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
    log_("webhook_post", { object: objectType || "(none)" });

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
                    const profileName = whatsappProfileNameFromContacts_(value.contacts, from);
                    jobs.push(
                        processInboundMetaMessage_({
                            channel: "whatsapp",
                            from,
                            text,
                            messageId,
                            sessionId,
                            profileName
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
                    log_("message_skip", {
                        channel,
                        reason: !from ? "no_sender" : "no_text",
                        is_echo: Boolean(event?.message?.is_echo),
                        has_postback: Boolean(event?.postback)
                    });
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
async function probePageAccessToken_(accessToken, pageId, graphVersion) {
    if (!accessToken || !pageId) {
        return { valid: false, error: "missing_token_or_page_id" };
    }
    try {
        const fields = "name,instagram_business_account{id,username}";
        const url =
            `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}` +
            `?fields=${encodeURIComponent(fields)}`;
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
        const ig =
            data.instagram_business_account && typeof data.instagram_business_account === "object"
                ? data.instagram_business_account
                : null;
        return {
            valid: true,
            page_name: typeof data.name === "string" ? data.name : null,
            instagram_business_account_id:
                ig && typeof ig.id === "string" ? ig.id : null,
            instagram_username:
                ig && typeof ig.username === "string" ? ig.username : null
        };
    } catch (e) {
        return {
            valid: false,
            message: e && e.message ? String(e.message).slice(0, 200) : String(e)
        };
    }
}

async function probePageSubscribedApps_(accessToken, pageId, graphVersion) {
    if (!accessToken || !pageId) {
        return { ok: false, error: "missing_token_or_page_id" };
    }
    try {
        const url =
            `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/subscribed_apps`;
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
                ok: false,
                code: err.code ?? null,
                message: err.message || raw.slice(0, 200) || `HTTP ${res.status}`
            };
        }
        const apps = Array.isArray(data.data) ? data.data : [];
        return {
            ok: true,
            apps: apps.map((app) => ({
                id: app?.id ?? null,
                subscribed_fields: Array.isArray(app?.subscribed_fields)
                    ? app.subscribed_fields
                    : []
            }))
        };
    } catch (e) {
        return {
            ok: false,
            message: e && e.message ? String(e.message).slice(0, 200) : String(e)
        };
    }
}

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
    const pageProbe = await probePageAccessToken_(
        c.page.accessToken,
        c.page.pageId,
        c.graphVersion
    );
    const subProbe =
        pageProbe.valid === true
            ? await probePageSubscribedApps_(
                  c.page.accessToken,
                  c.page.pageId,
                  c.graphVersion
              )
            : null;
    const channelReady =
        tokenProbe.valid === true || pageProbe.valid === true;
    return res.status(200).json({
        ok: missing.length === 0 && channelReady,
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
            page_access_token_valid: pageProbe.valid === true,
            page_access_token_error: pageProbe.valid ? null : (pageProbe.message || pageProbe.error || null),
            page_access_token_error_code: pageProbe.valid ? null : (pageProbe.code ?? null),
            page_name: pageProbe.valid ? (pageProbe.page_name ?? null) : null,
            instagram_business_account_id: pageProbe.valid
                ? (pageProbe.instagram_business_account_id ?? null)
                : null,
            instagram_username: pageProbe.valid ? (pageProbe.instagram_username ?? null) : null,
            subscribed_apps: subProbe?.ok ? (subProbe.apps ?? []) : null,
            subscribed_apps_error: subProbe?.ok === false ? (subProbe.message || subProbe.error || null) : null,
            token_fix_hint: pageProbe.valid
                ? null
                : "Messenger API Setup → Generate token for your Page → update META_PAGE_ACCESS_TOKEN on Railway → redeploy.",
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
