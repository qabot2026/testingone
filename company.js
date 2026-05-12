let personaRefreshTimer = null;
let personaSequence = 0;
let lastUserPersonaRenderAt = 0;
let companyPersonaWindowListenersAttached = false;
let contactFormOpenTimer = null;
let contactFormOpenPending = false;
/** Extra keys from the latest `open_form` custom payload; applied when the contact form opens (e.g. name, mobile, email). */
let pendingOpenFormPrefill = /** @type {Record<string, string> | null} */ (null);
/**
 * Queue of form keys (`common.form.forms`) to open after each successful submit (FIFO).
 * Populated from Dialogflow `open_form` via `next_form_id`, `next_form_ids`, `following_form_id`, `third_form_id`, …
 * @type {string[]}
 */
let pendingNextFormIdsAfterSubmit = [];
/** Nullable strings parsed from Dialogflow `open_form` payloads — drive CX via Messenger after Submit or form ×. */
let pendingOpenFormFollowupSubmit = /** @type {string | null} */ (null);
let pendingOpenFormFollowupCancel = /** @type {string | null} */ (null);
/** @type {string | null} Which `common.form.forms[…]` is active; `null` until first `readContactFormConfig()`. */
let activeContactFormId = null;
let activeDfMessenger = null;
let activeBubbleNode = null;
let hasAutoStartedConversation = false;
let isChatWindowOpen = false;
/** Agent replies while the chat panel is closed; shown on the launcher bubble until the user opens chat. */
let bubbleUnreadCount = 0;
let isMessengerLoaded = false;
let shouldAutoOpenChat = false;
const PERSONA_TEXT_COLOR = "#8f1d56";
/** Emoji in persona badges are drawn in SVG `<text>`; Arial alone often omits glyphs — include OS emoji fonts. */
const PERSONA_FONT_FAMILY =
    'system-ui, "Segoe UI Emoji", "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif';
const PERSONA_FONT_SIZE = "9px";
const PERSONA_FONT_WEIGHT = "400";
const PERSONA_VERTICAL_PULL = "0";
const PERSONA_SOFT_BLUR = "0.35px";
const PERSONA_OPACITY = "0.84";
const USER_PERSONA_TOKEN = encodeURIComponent("🙂User");
const BOT_PERSONA_TOKEN = encodeURIComponent("Bot 🤖");
const CHAT_CLIENT_CONTEXT_ENDPOINT = "/chat-client-context";
const CHAT_CLIENT_CONTEXT_STORAGE_KEY = "company_chat_client_context";
const CONTACT_FORM_OPEN_DELAY_MS = 600;
const CONTACT_FORM_OPEN_ACTION = "open_form";
/** Keys stripped when treating an `open_form` payload as field prefill (`action`, `form_id`, … only). */
const OPEN_FORM_PAYLOAD_META_KEYS = new Set([
    "action",
    "form_id",
    "formId",
    "onSubmit",
    "onCancel",
    "on_submit",
    "on_cancel",
    "next_form_id",
    "nextFormId",
    "next_form_ids",
    "nextFormIds",
    "following_form_id",
    "followingFormId",
    "second_form_id",
    "secondFormId",
    "third_form_id",
    "thirdFormId",
    "fourth_form_id",
    "fourthFormId",
]);
const CONTACT_FORM_ENDPOINT = "/contact-form-submissions";
/** POST JSON: append Sheets row when chat captured mobile (no file upload). Matches contact-form-api. */
const CONTACT_FORM_MOBILE_SHEET_SYNC_ENDPOINT = "/contact-form-mobile-sheet-sync";
/** Live-sync user_queries to Sheets (User Queries column; optional secret matches Railway CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET). */
const CONTACT_FORM_SESSION_SHEET_SYNC_ENDPOINT = "/contact-form-session-sheet-sync";
/** Caps how long the Submit button waits for the API before aborting (Sheets/Firestore latency). */
const CONTACT_FORM_SUBMIT_FETCH_TIMEOUT_MS = 90000;
const API_BASE_URL_META_NAME = "dfchat-api-base-url";
const MOBILE_CHAT_BREAKPOINT_PX = 768;
/** Extra `nudgeRight` for Language / Restart + Powered by on small viewports only (see company.config.js mobile layout). */
const MOBILE_FOOTER_ICONS_NUDGE_RIGHT_EXTRA_PX = 30;
/** Shift "Powered by" right so it does not cover Language / Restart (`setPoweredByStripGeometry` deltaLeft). */
const POWERED_BY_STRIP_NUDGE_RIGHT_PX = 110;
/** Additional downward shift (px) for the strip (`setPoweredByStripGeometry` top). */
const POWERED_BY_STRIP_NUDGE_DOWN_PX = 5;
const APPOINTMENT_DATE_CONFIG = {
    allowToday: false, // Set to false to disable today's date
    maxDaysAhead: 7 // How many days ahead to allow selection
};
const AUTO_START_CHAT_EVENT_NAME = "FRESH";
const AUTO_START_CHAT_DELAY_MS = 600;
const AUTO_START_SENDREQUEST_POLL_MS = 120;
const AUTO_START_SENDREQUEST_POLL_MAX_MS = 20000;
const LANGUAGE_STORAGE_KEY = "company_ui_language";
if (typeof window === "object" && window != null && typeof window.COMPANY_CHAT_UI_CONFIG === "undefined") {
    // eslint-disable-next-line  no-console
    console.error(
        "Company: static/company.config.js did not run (script order: load `forms/*.js` before company.config.js, or a syntax error in those files). UI features and chat layout are disabled until it loads."
    );
}
const COMPANY_UI_CONFIG = readCompanyUiConfig();
const COMMON_CONFIG = COMPANY_UI_CONFIG.common && typeof COMPANY_UI_CONFIG.common === "object"
    ? COMPANY_UI_CONFIG.common
    : {};
/**
 * Explicit `generalAppointment.slotMinutes` from `company.config.js` (sent to API + form POST) so grids match
 * when the backend cannot read `company.config.js`.
 * @returns {number | null}
 */
function readConfiguredGeneralAppointmentSlotMinutes_() {
    const ga =
        COMMON_CONFIG.generalAppointment &&
        typeof COMMON_CONFIG.generalAppointment === "object"
            ? COMMON_CONFIG.generalAppointment
            : null;
    if (
        !ga ||
        !Object.prototype.hasOwnProperty.call(ga, "slotMinutes")
    ) {
        return null;
    }
    const n = Number(/** @type {{ slotMinutes?: unknown }} */ (ga).slotMinutes);
    if (!Number.isFinite(n) || n < 5 || n > 180) {
        return null;
    }
    return Math.floor(n);
}
const FOOTER_ACTION_BAR_LAYOUT = readFooterActionBarLayoutConfig();
/**
 * Pixels: added to `common.footerActionBar.nudgeUpPx` for the *fixed* (non-inline) action bar.
 * The inline (below-composer) bar used to ignore `nudgeUpPx` — see `applyChatActionBarInlineTransform`.
 */
const CHAT_ACTION_BAR_EXTRA_NUDGE_UP_PX = 10;
/**
 * Base vertical lift for the inline action bar, before `footerActionBar.nudgeUpPx`.
 * Prior visual was ~-25px (15 + CHAT_ACTION_BAR_EXTRA_NUDGE_UP_PX); this adds at least 5px more.
 */
const CHAT_ACTION_BAR_INLINE_BASE_UP_PX = 20;
/** Positive shifts Language/Restart **down** (px); applied in inline and fixed action-bar layout. */
const CHAT_ACTION_BAR_GLOBAL_DOWN_PX = 30;
/**
 * Positive shifts Language/Restart **right** (px), after `footerActionBar.nudgeRightPx` (fixed) or on the
 * same transform as the inline lift (see `applyChatActionBarInlineTransform`).
 */
const CHAT_ACTION_BAR_GLOBAL_RIGHT_PX = 10;
const CHAT_MESSAGELIST_CONFIG = COMMON_CONFIG.chatMessageList && typeof COMMON_CONFIG.chatMessageList === "object"
    ? COMMON_CONFIG.chatMessageList
    : {};
const CHAT_PANEL_CONFIG = COMMON_CONFIG.chatPanel && typeof COMMON_CONFIG.chatPanel === "object"
    ? COMMON_CONFIG.chatPanel
    : {};
/** @see common.chatMessageList.showScrollbar in `static/company.config.js` */
const SHOW_MESSAGELIST_SCROLLBAR = typeof CHAT_MESSAGELIST_CONFIG.showScrollbar === "boolean"
    ? CHAT_MESSAGELIST_CONFIG.showScrollbar
    : true;
const MESSAGE_LIST_SCROLLBAR_STYLE_ID = "dfchat-messagelist-scrollbar-style";
/** Message list pane corners (per-corner longhands; optional `common.chatMessageList.paneBorderRadius` in company.config.js) */
const MESSAGE_LIST_SQUARE_PANE_STYLE_ID = "dfchat-messagelist-square-pane";
/** Open whitish chat card (`.chat-wrapper`); optional `common.chatPanel.borderRadius` in company.config.js */
const CHAT_PANEL_CORNERS_STYLE_ID = "dfchat-chat-panel-corners";
const PERSONA_IMAGE_GUARD_STYLE_ID = "dfchat-persona-image-guard";
/** Dialogflow “jump to bottom” / scroll-hint UI; mirrored onto `df-messenger-chat-bubble` :host. */
const DF_MESSENGER_CHAT_SCROLL_JUMP_VAR_KEYS = [
    "--df-messenger-chat-scroll-button-enabled-display",
    "--df-messenger-chat-scroll-button-text-display",
    "--df-messenger-chat-messagelist-scroll-shadow-background"
];
const FOOTER_INPUT_BOX_CONFIG = COMMON_CONFIG.footerInputBox && typeof COMMON_CONFIG.footerInputBox === "object"
    ? COMMON_CONFIG.footerInputBox
    : {};
const FOOTER_INPUT_BOX_STYLE_ID = "dfchat-footer-input-box-overrides";
const COMPOSER_SPEECH_MIC_STYLE_ID = "dfchat-composer-speech-mic-style";
const COMPOSER_SPEECH_WRAP_CLASS = "dfchat-composer-speech-wrap";
const COMPOSER_SPEECH_BTN_SELECTOR = "[data-dfchat-composer-speech-mic=\"true\"]";
/** Keeps the closed launcher `.bubble` circular when Dialogflow rebuilds shadow DOM. */
const CHAT_BUBBLE_LAUNCHER_STYLE_ID = "dfchat-chat-bubble-launcher-circle";
const CHAT_BUBBLE_UNREAD_BADGE_ID = "dfchat-bubble-unread-badge";
const FOOTER_INPUT_BOX_ALIGN_ALLOWED = new Set(["flex-end", "flex-start", "center", "stretch", "baseline", "start", "end"]);
const FOOTER_INPUT_BOX_OVERFLOW_Y_ALLOWED = new Set(["auto", "hidden", "visible", "scroll", "clip"]);
const FEATURES_CONFIG = COMMON_CONFIG.features && typeof COMMON_CONFIG.features === "object"
    ? COMMON_CONFIG.features
    : {};
const MULTI_LANGUAGE_CONFIG = FEATURES_CONFIG.multiLanguage && typeof FEATURES_CONFIG.multiLanguage === "object"
    ? FEATURES_CONFIG.multiLanguage
    : {};
/** When `multiLanguage` is missing, default is false (turn on with `enabled: true`). Re-read so admin/runtime merges apply without reload. */
function isMultiLanguageEnabled() {
    return isFeatureEnabledFromConfig(MULTI_LANGUAGE_CONFIG, false);
}
/** When true, auto-translation (Google) may walk `document.body`; default false = only chat widget shadow roots. */
const AUTO_TRANSLATE_HOST_PAGE = typeof MULTI_LANGUAGE_CONFIG.autoTranslateHostPage === "boolean"
    ? MULTI_LANGUAGE_CONFIG.autoTranslateHostPage
    : false;
const RESTART_CHAT_CONFIG = FEATURES_CONFIG.restartChat && typeof FEATURES_CONFIG.restartChat === "object"
    ? FEATURES_CONFIG.restartChat
    : {};
function isRestartChatEnabled() {
    return isFeatureEnabledFromConfig(RESTART_CHAT_CONFIG, true);
}

const BLOCK_CHAT_WITHOUT_MOBILE_CONFIG = FEATURES_CONFIG.blockChatWithoutMobile && typeof FEATURES_CONFIG.blockChatWithoutMobile === "object"
    ? FEATURES_CONFIG.blockChatWithoutMobile
    : {};

function isBlockChatWithoutMobileEnabled() {
    return isFeatureEnabledFromConfig(BLOCK_CHAT_WITHOUT_MOBILE_CONFIG, false);
}

function getBlockChatWithoutMobileLimit_() {
    const n = BLOCK_CHAT_WITHOUT_MOBILE_CONFIG.maxUserQueries;
    if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
        return Math.min(500, Math.round(n));
    }
    return 20;
}

function getBlockChatWithoutMobileMessage_() {
    const t = typeof BLOCK_CHAT_WITHOUT_MOBILE_CONFIG.blockMessage === "string"
        ? BLOCK_CHAT_WITHOUT_MOBILE_CONFIG.blockMessage.trim()
        : "";
    return t
        ? t.slice(0, 2000)
        : "You've reached the message limit without a mobile number. Please share your mobile number to continue.";
}

function hasStoredMobileForChatBlockGate_() {
    const raw = readStoredClientContext();
    const m = dfParameterScalarToString(raw && raw.mobile != null ? raw.mobile : "").replace(/\D/g, "");
    return m.length >= 9;
}

function getUserQueryCountForChatBlockGate_() {
    const prev = readStoredClientContext();
    const qs = prev && Array.isArray(prev.user_queries) ? prev.user_queries : [];
    return qs.filter((x) => typeof x === "string" && x.trim()).length;
}

function shouldBlockOutgoingChatForMissingMobile_() {
    if (!isBlockChatWithoutMobileEnabled()) {
        return false;
    }
    if (hasStoredMobileForChatBlockGate_()) {
        return false;
    }
    return getUserQueryCountForChatBlockGate_() >= getBlockChatWithoutMobileLimit_();
}

/** Dedupe block UI when both `df-user-input-entered` and `df-request-sent` fire for the same utterance. */
let mobileGateLastSurfacedText_ = "";
let mobileGateLastSurfacedAt_ = 0;
/** After chat-captured mobile, block CX/parameter merges from overwriting it for this many ms (wrong Sheet column D). */
let skipCxMobileOverwriteUntilMs_ = 0;

/**
 * When the visitor is over the query limit without mobile, block the outbound CX request and show a bot line.
 * @param {Event | undefined | null} event
 * @param {string} queryText trimmed outbound text (skip when empty so internal messenger traffic still runs).
 * @returns {boolean} true when the send was blocked.
 */
function tryPreventChatSendForMissingMobileGate_(event, queryText) {
    if (!shouldBlockOutgoingChatForMissingMobile_()) {
        return false;
    }
    const t = typeof queryText === "string" ? queryText.trim() : "";
    if (!t) {
        return false;
    }
    const now = Date.now();
    if (t === mobileGateLastSurfacedText_ && now - mobileGateLastSurfacedAt_ < 2200) {
        try {
            if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
            }
        } catch {
            /* ignore */
        }
        scheduleClearDfMessengerComposerInput_();
        return true;
    }
    mobileGateLastSurfacedText_ = t;
    mobileGateLastSurfacedAt_ = now;
    try {
        if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
        }
    } catch {
        /* ignore */
    }
    try {
        const ms = activeDfMessenger;
        if (ms && typeof ms.renderCustomText === "function") {
            ms.renderCustomText(getBlockChatWithoutMobileMessage_(), true);
        }
    } catch {
        /* ignore */
    }
    openContactFormAfterMobileBlockGate_();
    scheduleClearDfMessengerComposerInput_();
    return true;
}

function resolveMobileBlockContactFormId_() {
    const cfg = BLOCK_CHAT_WITHOUT_MOBILE_CONFIG;
    const explicit = typeof cfg.formIdOnBlock === "string" ? cfg.formIdOnBlock.trim() : "";
    if (explicit) {
        return canonicalContactFormId_(explicit);
    }
    const merged = getRuntimeMergedFormDefinitions_();
    if (merged.contact) {
        return "contact";
    }
    return getDefaultContactFormId();
}

function focusMobileFieldInActiveContactForm_() {
    const defs = readContactFormConfig().fields;
    if (!Array.isArray(defs)) {
        return;
    }
    for (let i = 0; i < defs.length; i += 1) {
        const d = defs[i];
        if (!d || d.name !== "mobile" || !d.id) {
            continue;
        }
        const el = document.getElementById(d.id);
        if (el && typeof el.focus === "function") {
            el.focus();
            break;
        }
    }
}

/**
 * When the mobile gate fires, open the contact form (or configured form) so the visitor can enter a number.
 * Optional `dialogflowEventOnBlock` sends a CX custom event after the form opens (create matching event in the agent).
 */
function openContactFormAfterMobileBlockGate_() {
    const cfg = BLOCK_CHAT_WITHOUT_MOBILE_CONFIG;
    if (cfg && cfg.openContactFormOnBlock === false) {
        return;
    }
    try {
        /**
         * This overlay is not Dialogflow `open_form`. If an older turn left `onCancel` / `onSubmit` pending,
         * dismissing × would dispatch it and CX could leave the gated state while mobile is still missing.
         */
        pendingOpenFormFollowupSubmit = null;
        pendingOpenFormFollowupCancel = null;
        mountDfchatContactFormHostIfNeeded();
        const formEl = document.getElementById("dfchat-contact-form");
        if (formEl && formEl.classList.contains("dfchat-is-open")) {
            focusMobileFieldInActiveContactForm_();
            return;
        }
        const merged = getRuntimeMergedFormDefinitions_();
        const mergedKeys = Object.keys(merged);
        if (mergedKeys.length > 0) {
            let formId = resolveMobileBlockContactFormId_();
            if (!formId || !merged[formId]) {
                formId = getDefaultContactFormId();
            }
            if (formId && merged[formId]) {
                setActiveContactFormId(formId);
            }
        }
        contactFormOpenPending = false;
        window.setTimeout(() => {
            openContactForm();
            focusMobileFieldInActiveContactForm_();
            const ev = typeof cfg.dialogflowEventOnBlock === "string" ? cfg.dialogflowEventOnBlock.trim() : "";
            if (ev) {
                const ms = activeDfMessenger;
                if (ms && typeof ms.sendRequest === "function") {
                    ms.sendRequest("event", ev).catch(() => {});
                }
            }
        }, 0);
    } catch {
        /* ignore */
    }
}

const POWERED_BY_CONFIG = COMMON_CONFIG.poweredBy && typeof COMMON_CONFIG.poweredBy === "object"
    ? COMMON_CONFIG.poweredBy
    : {};
function isPoweredByFeatureEnabled() {
    return isFeatureEnabledFromConfig(POWERED_BY_CONFIG, false);
}
/** When true, POSTs session metadata to `getApiEndpoint("/chat-client-context")`. Static hosts have no route — set `enabled: false` in config. Default true keeps same-origin API behavior for existing backends. */
const CLIENT_CONTEXT_CAPTURE_CONFIG = FEATURES_CONFIG.clientContextCapture && typeof FEATURES_CONFIG.clientContextCapture === "object"
    ? FEATURES_CONFIG.clientContextCapture
    : {};
const IS_CLIENT_CONTEXT_CAPTURE_ENABLED = isFeatureEnabledFromConfig(CLIENT_CONTEXT_CAPTURE_CONFIG, true);
const POWERED_BY_PREFIX = typeof POWERED_BY_CONFIG.prefix === "string" ? POWERED_BY_CONFIG.prefix : "Powered by ";
const POWERED_BY_VALUE = typeof POWERED_BY_CONFIG.value === "string" && POWERED_BY_CONFIG.value.trim()
    ? POWERED_BY_CONFIG.value.trim()
    : "demo";
const POWERED_BY_STRIP_ID = "dfchat-powered-by-strip";
const POWERED_BY_STYLE = readPoweredByStyleConfig();
const HEADER_CONFIG = COMMON_CONFIG.header && typeof COMMON_CONFIG.header === "object" ? COMMON_CONFIG.header : {};
/** When not `false` (default in config), the chat **title** dismiss control is always ×, never an arrow, all languages. */
const IS_FORCE_TITLEBAR_CLOSE_X_ENABLED = HEADER_CONFIG.forceCloseIconX !== false;
const BOT_PERSONA_CONFIG = readBotPersonaConfig();
const CHAT_BUBBLE_LAUNCHER_CONFIG = readChatBubbleLauncherConfig();
const PERSONA_MARKER_BOT = "dfchat-persona-bot";
const PERSONA_MARKER_BOT_TIME = "dfchat-persona-bot-time";
const PERSONA_MARKER_USER = "dfchat-persona-user";
const PERSONA_URL_MARKER_BOT_IMG = "dfchat-bot-persona";

function readBotPersonaConfig() {
    const raw = COMMON_CONFIG.botPersona && typeof COMMON_CONFIG.botPersona === "object"
        ? COMMON_CONFIG.botPersona
        : {};
    const mode = raw.mode === "emojiTime" ? "emojiTime" : "image";
    const threadAvatarSizePx = typeof raw.threadAvatarSizePx === "number" && Number.isFinite(raw.threadAvatarSizePx) && raw.threadAvatarSizePx > 0
        ? raw.threadAvatarSizePx
        : 28;
    const emojiTime = raw.emojiTime && typeof raw.emojiTime === "object" ? raw.emojiTime : {};
    const image = raw.image && typeof raw.image === "object" ? raw.image : {};
    /** Extra px added to the baseline 250px margin so the user persona row sits farther right. */
    const userPersonaShiftRightPx = typeof raw.userPersonaShiftRightPx === "number" && Number.isFinite(raw.userPersonaShiftRightPx) && raw.userPersonaShiftRightPx >= 0
        ? raw.userPersonaShiftRightPx
        : 24;
    /** On narrow viewports, subtract from computed user persona `margin-left` to move strip left. */
    const userPersonaMobileNudgeLeftPx = typeof raw.userPersonaMobileNudgeLeftPx === "number" && Number.isFinite(raw.userPersonaMobileNudgeLeftPx) && raw.userPersonaMobileNudgeLeftPx >= 0
        ? raw.userPersonaMobileNudgeLeftPx
        : 28;
    /** Extra px toward the previous message (adds to baseline −6px margin-top on the user persona row). */
    const userPersonaNudgeUpPx = typeof raw.userPersonaNudgeUpPx === "number" && Number.isFinite(raw.userPersonaNudgeUpPx) && raw.userPersonaNudgeUpPx >= 0 && raw.userPersonaNudgeUpPx <= 32
        ? raw.userPersonaNudgeUpPx
        : 6;
    /** Wide viewports only: added to computed margin-left (mobile path ignores this; use `userPersonaMobileNudgeLeftPx` for phones). */
    const userPersonaShiftRightDeskExtraPx = typeof raw.userPersonaShiftRightDeskExtraPx === "number" && Number.isFinite(raw.userPersonaShiftRightDeskExtraPx) && raw.userPersonaShiftRightDeskExtraPx >= 0 && raw.userPersonaShiftRightDeskExtraPx <= 120
        ? raw.userPersonaShiftRightDeskExtraPx
        : 0;
    /** When true (default), bot persona clock shows calendar date + time for this reply; false = time only. */
    const messageTimeIncludesDate = raw.messageTimeIncludesDate !== false;
    return {
        mode,
        threadAvatarSizePx,
        messageTimeIncludesDate,
        userPersonaShiftRightPx,
        userPersonaMobileNudgeLeftPx,
        userPersonaNudgeUpPx,
        userPersonaShiftRightDeskExtraPx,
        emojiTime: {
            label: typeof emojiTime.label === "string" ? emojiTime.label : "🤖",
            showTime: emojiTime.showTime !== false,
            timeZone: typeof emojiTime.timeZone === "string" && emojiTime.timeZone.trim()
                ? emojiTime.timeZone.trim()
                : "Asia/Kolkata"
        },
        image: {
            url: (() => {
                const top = typeof raw.imageUrl === "string" && raw.imageUrl.trim() ? raw.imageUrl.trim() : "";
                const u =
                    typeof image.url === "string" && image.url.trim()
                        ? image.url.trim()
                        : typeof image.imageUrl === "string" && image.imageUrl.trim()
                            ? image.imageUrl.trim()
                            : top;
                return u || "https://storage.googleapis.com/companybucket/Images/cat.png";
            })(),
            widthPx: typeof image.widthPx === "number" && Number.isFinite(image.widthPx) ? image.widthPx : 32,
            heightPx: typeof image.heightPx === "number" && Number.isFinite(image.heightPx) ? image.heightPx : 32,
            showTime: image.showTime !== false,
            timeZone: typeof image.timeZone === "string" && image.timeZone.trim()
                ? image.timeZone.trim()
                : "Asia/Kolkata",
            /** Nudge bot avatar + time strip down (px). */
            offsetDownPx: typeof image.offsetDownPx === "number" && Number.isFinite(image.offsetDownPx) && image.offsetDownPx >= 0
                ? image.offsetDownPx
                : 6,
            /** Extra pull toward the reply bubble (adds to base −4px margin under persona row). */
            tightenBelowPx: typeof image.tightenBelowPx === "number" && Number.isFinite(image.tightenBelowPx) && image.tightenBelowPx >= 0
                ? image.tightenBelowPx
                : 8,
            /** Narrow viewports: translate bot persona imgs left by this many px (`translateX(-n)`). */
            mobileNudgeLeftPx: typeof image.mobileNudgeLeftPx === "number" && Number.isFinite(image.mobileNudgeLeftPx) && image.mobileNudgeLeftPx >= 0
                ? image.mobileNudgeLeftPx
                : 14
        }
    };
}

/**
 * Chat “user” row above outgoing bubbles (SVG badge). Layout nudges stay under {@link readBotPersonaConfig} `userPersona*` keys.
 * @returns {{ label: string, showTime: boolean, timeZone: string }}
 */
function readUserPersonaConfig() {
    const raw = COMMON_CONFIG.userPersona && typeof COMMON_CONFIG.userPersona === "object"
        ? COMMON_CONFIG.userPersona
        : {};
    const labelFrom = raw.label != null ? raw.label : raw.emoji;
    const label = typeof labelFrom === "string" && labelFrom.trim() ? labelFrom.trim() : "🙂User";
    const timeZone = typeof raw.timeZone === "string" && raw.timeZone.trim()
        ? raw.timeZone.trim()
        : "Asia/Kolkata";
    return {
        label,
        showTime: raw.showTime !== false,
        timeZone
    };
}

const USER_PERSONA_CONFIG = readUserPersonaConfig();

/** Horizontal nudge for user persona badge (px); replaces legacy large margin-left layout. */
function cssUserPersonaTranslateX() {
    const base = Math.max(0, Math.min(56, BOT_PERSONA_CONFIG.userPersonaShiftRightPx ?? 0));
    const deskExtra =
        typeof isMobileViewport === "function" && !isMobileViewport()
            ? Math.max(0, Math.min(48, BOT_PERSONA_CONFIG.userPersonaShiftRightDeskExtraPx ?? 0))
            : 0;
    const mobilePull =
        typeof isMobileViewport === "function" && isMobileViewport()
            ? -Math.max(0, Math.min(40, Math.floor((BOT_PERSONA_CONFIG.userPersonaMobileNudgeLeftPx ?? 0) * 0.5)))
            : 0;
    const tx = base + deskExtra + mobilePull;
    return Number.isFinite(tx) && tx !== 0 ? `translateX(${tx}px)` : "";
}

/** User persona baseline pull is −6px; config adds extra upward nudge (more negative margin-top). */
function cssUserPersonaMarginTop() {
    const extra = Math.max(0, Math.min(32, BOT_PERSONA_CONFIG.userPersonaNudgeUpPx ?? 6));
    return `-${6 + extra}px`;
}

/** Safe CSS border-radius for the floating launcher (blocks odd characters). */
function sanitizeChatBubbleCornerRoundness(value) {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s || s.length > 48) {
        return "50%";
    }
    if (/[^0-9.%a-zA-Z+\-()/\s,]/.test(s)) {
        return "50%";
    }
    return s;
}

/** Safe length for one corner of the message list pane (see `readMessageListPaneBorderRadiusConfig`). */
function sanitizeMessagePaneRadius(value, fallback) {
    const fb = typeof fallback === "string" ? fallback : "0";
    const s = typeof value === "string" ? value.trim() : "";
    if (!s || s.length > 32) {
        return fb;
    }
    if (/[^0-9.%a-zA-Z+\-()/\s,]/.test(s)) {
        return fb;
    }
    return s;
}

/**
 * Per-corner radii for `.message-list-wrapper`, `#message-list`, `df-messenger-message-list` (shadow). Longhands only
 * (no `border-radius` shorthand) so one corner can be set without the shorthand resetting the others
 * in the cascade, and you can “reduce” a corner from config without fighting `border-radius: 0 !important`.
 * @see common.chatMessageList.paneBorderRadius in `static/company.config.js`
 */
function readMessageListPaneBorderRadiusConfig() {
    const raw = CHAT_MESSAGELIST_CONFIG.paneBorderRadius && typeof CHAT_MESSAGELIST_CONFIG.paneBorderRadius === "object"
        ? CHAT_MESSAGELIST_CONFIG.paneBorderRadius
        : {};
    const one = (key) => sanitizeMessagePaneRadius(typeof raw[key] === "string" ? raw[key] : "", "0");
    return {
        topLeft: one("topLeft"),
        topRight: one("topRight"),
        bottomLeft: one("bottomLeft"),
        bottomRight: one("bottomRight")
    };
}

const MESSAGE_LIST_PANE_BORDER_RADIUS = readMessageListPaneBorderRadiusConfig();

/**
 * Per-corner radii for the open **chat panel** (`.chat-wrapper` in the bubble shadow), not individual bubbles.
 * @see common.chatPanel.borderRadius in `static/company.config.js`
 */
function readChatPanelBorderRadiusConfig() {
    const raw = CHAT_PANEL_CONFIG.borderRadius && typeof CHAT_PANEL_CONFIG.borderRadius === "object"
        ? CHAT_PANEL_CONFIG.borderRadius
        : null;
    if (!raw) {
        return null;
    }
    const one = (key) => sanitizeMessagePaneRadius(typeof raw[key] === "string" ? raw[key] : "", "0");
    return {
        topLeft: one("topLeft"),
        topRight: one("topRight"),
        bottomLeft: one("bottomLeft"),
        bottomRight: one("bottomRight")
    };
}

const CHAT_PANEL_BORDER_RADIUS = readChatPanelBorderRadiusConfig();

function getChatPanelBorderRadiusCss() {
    const r = CHAT_PANEL_BORDER_RADIUS;
    if (!r) {
        return "";
    }
    /* DF injects: `.chat-wrapper{border-radius:var(--df-messenger-chat-border-radius)}` (see gstatic df-messenger.js). Shorthand + longhands beat var(); order vs constructed styles is not reliable — we also set inline in applyChatPanelBorderRadiusToElements. */
    const quad = `${r.topLeft} ${r.topRight} ${r.bottomRight} ${r.bottomLeft}`;
    return `/* company.js: whitish open chat *panel* (not message bubbles) */
.chat-wrapper,
.min-chat-wrapper,
df-messenger-chat {
  border-radius: ${quad} !important;
  border-top-left-radius: ${r.topLeft} !important;
  border-top-right-radius: ${r.topRight} !important;
  border-bottom-right-radius: ${r.bottomRight} !important;
  border-bottom-left-radius: ${r.bottomLeft} !important;
}
`;
}

/**
 * Inline `border-radius` on the real panel nodes so it wins over Dialogflow’s constructed stylesheets
 * (which can load after our injected style tag in the same shadow root).
 * @param {Element | null} dfMessenger
 */
function applyChatPanelBorderRadiusToElements(dfMessenger) {
    if (!dfMessenger || !CHAT_PANEL_BORDER_RADIUS) {
        return;
    }
    const r = CHAT_PANEL_BORDER_RADIUS;
    const quad = `${r.topLeft} ${r.topRight} ${r.bottomRight} ${r.bottomLeft}`;
    // Only under this messenger’s shadow tree (do not use `document` from collectSearchRoots — a host page could use `.chat-wrapper` too).
    const roots = collectShadowRootsUnderHost(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        for (const el of root.querySelectorAll(".chat-wrapper, .min-chat-wrapper, df-messenger-chat")) {
            if (!el || !el.style) {
                continue;
            }
            el.style.setProperty("border-radius", quad, "important");
        }
    }
}

/** Conic gradient similar to Instagram story rings (orange → pink → purple → blue). */
const CHAT_BUBBLE_STORY_RING_GRADIENT = "conic-gradient(from 200deg at 50% 50%, #f09433 0%, #e6683c 14%, #dc2743 28%, #cc2366 42%, #bc1888 56%, #833ab4 70%, #515bd4 84%, #fcb045 100%)";

function readChatBubbleLauncherConfig() {
    const raw = COMMON_CONFIG.chatBubbleLauncher && typeof COMMON_CONFIG.chatBubbleLauncher === "object"
        ? COMMON_CONFIG.chatBubbleLauncher
        : {};
    const cornerRoundness = sanitizeChatBubbleCornerRoundness(
        typeof raw.cornerRoundness === "string" ? raw.cornerRoundness : "50%"
    );
    const keepRoundShape = raw.keepRoundShape !== false;
    const clipPictureToCircle = raw.clipPictureToCircle !== false;
    const hideOverflow = raw.hideOverflow !== false;
    let buttonSizePx = null;
    if (typeof raw.buttonSizePx === "number" && Number.isFinite(raw.buttonSizePx) && raw.buttonSizePx > 0) {
        buttonSizePx = Math.round(raw.buttonSizePx);
    }
    let iconSizePx = null;
    if (typeof raw.iconSizePx === "number" && Number.isFinite(raw.iconSizePx) && raw.iconSizePx > 0) {
        iconSizePx = Math.round(raw.iconSizePx);
    } else if (buttonSizePx != null) {
        iconSizePx = Math.max(20, Math.round(buttonSizePx * 0.92));
    }
    const storyRaw = raw.storyRing && typeof raw.storyRing === "object" ? raw.storyRing : {};
    const storyRingEnabled = keepRoundShape && storyRaw.enabled !== false;
    let storyRingWidthPx = 3;
    if (typeof storyRaw.widthPx === "number" && Number.isFinite(storyRaw.widthPx) && storyRaw.widthPx > 0) {
        storyRingWidthPx = Math.min(8, Math.max(1, Math.round(storyRaw.widthPx)));
    }
    let storyRingRotateSeconds = 5;
    if (typeof storyRaw.rotateSeconds === "number" && Number.isFinite(storyRaw.rotateSeconds)) {
        storyRingRotateSeconds = Math.min(60, Math.max(0, storyRaw.rotateSeconds));
    }
    let storyRingRevolutions = 4;
    if (typeof storyRaw.revolutions === "number" && Number.isFinite(storyRaw.revolutions) && storyRaw.revolutions >= 0) {
        storyRingRevolutions = Math.min(40, Math.round(storyRaw.revolutions));
    }
    const ub = raw.unreadBadge && typeof raw.unreadBadge === "object" ? raw.unreadBadge : {};
    const unreadBadge = {
        enabled: ub.enabled !== false,
        maxDisplay: typeof ub.maxDisplay === "number" && Number.isFinite(ub.maxDisplay) && ub.maxDisplay > 0
            ? Math.min(9999, Math.round(ub.maxDisplay))
            : 99,
        background: typeof ub.background === "string" && ub.background.trim() ? ub.background.trim() : "#e11d48",
        color: typeof ub.color === "string" && ub.color.trim() ? ub.color.trim() : "#ffffff",
        fontSizePx: typeof ub.fontSizePx === "number" && Number.isFinite(ub.fontSizePx) && ub.fontSizePx > 0
            ? Math.min(24, Math.round(ub.fontSizePx))
            : 12,
        minSizePx: typeof ub.minSizePx === "number" && Number.isFinite(ub.minSizePx) && ub.minSizePx > 0
            ? Math.min(40, Math.round(ub.minSizePx))
            : 20
    };
    return {
        keepRoundShape,
        cornerRoundness,
        clipPictureToCircle,
        hideOverflow,
        buttonSizePx,
        iconSizePx,
        storyRingEnabled,
        storyRingWidthPx,
        storyRingRotateSeconds,
        storyRingRevolutions,
        unreadBadge
    };
}

function isChatSurfaceOpenForUnread() {
    return !!(isChatWindowOpen || (activeDfMessenger && isChatExpanded(activeDfMessenger)));
}

function collectDfResponseMessagesForUnread(event) {
    const d = event && event.detail;
    if (!d) {
        return [];
    }
    const candidates = [
        d.data && Array.isArray(d.data.messages) ? d.data.messages : null,
        Array.isArray(d.messages) ? d.messages : null,
        d.data && d.data.queryResult && Array.isArray(d.data.queryResult.responseMessages)
            ? d.data.queryResult.responseMessages
            : null,
        d.raw && d.raw.queryResult && Array.isArray(d.raw.queryResult.responseMessages)
            ? d.raw.queryResult.responseMessages
            : null
    ];
    for (let i = 0; i < candidates.length; i += 1) {
        const arr = candidates[i];
        if (arr && arr.length > 0) {
            return arr;
        }
    }
    return [];
}

/**
 * Gallery / video: **only `queryResult.responseMessages`** — this DetectIntent fulfillment list is scoped
 * to the current webhook response. **`detail.data.messages`** is a Messenger UI mirror that commonly
 * re-attaches previously rendered payloads, which made `open_gallery` appear on every subsequent intent.
 *
 * Dedupes object refs shared between **`raw`** and **`data`** `queryResult.responseMessages`.
 *
 * @param {Event | null | undefined} event
 */
function mergeCxResponseEnvelopeForGallery(event) {
    /** @type {unknown[]} */
    const out = [];
    const seenObj = new WeakSet();
    const detail = event && event.detail;
    const add = /** @param {unknown[] | null | undefined} a */ (a) => {
        if (!Array.isArray(a) || a.length === 0) {
            return;
        }
        for (let i = 0; i < a.length; i += 1) {
            const item = a[i];
            if (item != null && typeof item === "object") {
                /** @type {object} */
                const obj = /** @type {object} */ (item);
                if (seenObj.has(obj)) {
                    continue;
                }
                seenObj.add(obj);
            }
            out.push(item);
        }
    };

    add(
        detail
        && detail.raw
        && detail.raw.queryResult
        && detail.raw.queryResult.responseMessages
    );
    add(
        detail
        && detail.data
        && detail.data.queryResult
        && detail.data.queryResult.responseMessages
    );

    return out;
}

/**
 * Only CX response messages carrying a **`payload`** (or Messenger `customPayload`) can produce
 * `extractPayload(...)`. Checking this avoids needless work on plain text blobs.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function messageHasFulfillmentPayload(message) {
    if (!message || typeof message !== "object") {
        return false;
    }
    /** @type {Record<string, unknown>} */
    const m = /** @type {Record<string, unknown>} */ (message);
    return (Object.prototype.hasOwnProperty.call(m, "payload") && m.payload != null)
        || (Object.prototype.hasOwnProperty.call(m, "customPayload") && m.customPayload != null);
}

/**
 * CX may expose intent under **`queryResult.intent`** or **`queryResult.match.intent`**.
 * @param {Record<string, unknown> | null} qr
 * @returns {string}
 */
function extractIntentDisplayNameFromQueryResult(qr) {
    if (!qr || typeof qr !== "object") {
        return "";
    }
    /** @param {unknown} node */
    const fromIntentLike = (node) => {
        if (!node || typeof node !== "object") {
            return "";
        }
        /** @type {{ displayName?: string, name?: string }} */
        const it = /** @type {{ displayName?: string, name?: string }} */ (node);
        if (typeof it.displayName === "string" && it.displayName.trim()) {
            return it.displayName.trim();
        }
        if (typeof it.name === "string" && it.name.trim()) {
            return it.name.trim();
        }
        return "";
    };
    const direct = fromIntentLike(qr.intent);
    if (direct) {
        return direct;
    }
    const qrWithMatch =
        qr && qr.match !== undefined && qr.match !== null && typeof qr.match === "object"
            ? /** @type {Record<string, unknown>} */ (qr.match)
            : null;
    if (qrWithMatch && qrWithMatch.intent !== undefined) {
        return fromIntentLike(qrWithMatch.intent);
    }
    return "";
}

/**
 * @param {Event | null | undefined} event
 * @returns {string}
 */
function getIntentDisplayNameFromDfEvent(event) {
    const d = event && event.detail;
    const qr =
        (d && d.raw && d.raw.queryResult)
        || (d && d.data && d.data.queryResult)
        || null;
    /** @type {Record<string, unknown> | null} */
    const qro = qr && typeof qr === "object" ? /** @type {Record<string, unknown>} */ (qr) : null;
    return extractIntentDisplayNameFromQueryResult(qro);
}

/**
 * `COMPANY_CHAT_UI_CONFIG.common.features.inlineGallery`:
 * - If **`features.inlineGallery` is omitted** → allow gallery/video whenever fulfillment sends payloads.
 * - **`allowGalleryOnAnyIntent: true`** (default) → same — no intent filter.
 * - **`allowGalleryOnAnyIntent: false`** → require a substring match on **`restrictToIntentDisplayNames`**
 *   vs CX intent display name (`match.intent` or `intent` on `queryResult`).
 *
 * @param {Event | null | undefined} event
 * @returns {boolean}
 */
function passesInlineRichMediaIntentGate(event) {
    const cfg = readCompanyUiConfig();
    const common =
        cfg && typeof cfg === "object" && /** @type {Record<string, unknown>} */ (cfg).common && typeof /** @type {Record<string, unknown>} */ (cfg).common === "object"
            ? /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (cfg)).common
            : null;
    const feats =
        common && typeof common.features === "object"
            ? /** @type {Record<string, unknown>} */ (common.features)
            : null;
    const ig =
        feats && typeof feats.inlineGallery === "object"
            ? /** @type {Record<string, unknown>} */ (feats.inlineGallery)
            : null;

    if (!ig) {
        return true;
    }

    if (ig.allowGalleryOnAnyIntent !== false) {
        return true;
    }

    const restriction = Array.isArray(ig.restrictToIntentDisplayNames) ? ig.restrictToIntentDisplayNames : [];
    const hay = getIntentDisplayNameFromDfEvent(event).toLowerCase();

    if (restriction.length === 0 || !hay) {
        return false;
    }
    for (let i = 0; i < restriction.length; i += 1) {
        const needle = String(restriction[i] || "").trim().toLowerCase();
        if (needle && hay.includes(needle)) {
            return true;
        }
    }
    return false;
}

function countAgentMessagesForUnread(event) {
    const messages = collectDfResponseMessagesForUnread(event);
    let n = 0;
    for (const m of messages) {
        if (!m || typeof m !== "object") {
            continue;
        }
        const t = typeof m.type === "string" ? m.type.toLowerCase().replace(/_/g, "") : "";
        if (t === "endinteraction") {
            continue;
        }
        n += 1;
    }
    if (n > 0) {
        return n;
    }
    const qr = event && event.detail && event.detail.raw && event.detail.raw.queryResult;
    if (qr && typeof qr.fulfillmentText === "string" && qr.fulfillmentText.trim()) {
        return 1;
    }
    if (qr && Array.isArray(qr.fulfillmentMessages) && qr.fulfillmentMessages.length > 0) {
        return qr.fulfillmentMessages.length;
    }
    return 0;
}

function scheduleBubbleUnreadBadgeSyncRetries() {
    if (bubbleUnreadCount <= 0) {
        return;
    }
    [0, 80, 300, 900, 2200].forEach((ms) => {
        window.setTimeout(() => {
            if (bubbleUnreadCount > 0 && CHAT_BUBBLE_LAUNCHER_CONFIG.unreadBadge && CHAT_BUBBLE_LAUNCHER_CONFIG.unreadBadge.enabled) {
                syncBubbleUnreadBadge(activeDfMessenger);
            }
        }, ms);
    });
}

function maybeIncrementBubbleUnreadFromResponse(event) {
    const cfg = CHAT_BUBBLE_LAUNCHER_CONFIG.unreadBadge;
    if (!cfg || !cfg.enabled) {
        return;
    }
    if (isChatSurfaceOpenForUnread()) {
        return;
    }
    const add = countAgentMessagesForUnread(event);
    if (add <= 0) {
        return;
    }
    bubbleUnreadCount += add;
    syncBubbleUnreadBadge(activeDfMessenger);
    scheduleBubbleUnreadBadgeSyncRetries();
}

function resetBubbleUnreadBadge() {
    bubbleUnreadCount = 0;
    syncBubbleUnreadBadge(activeDfMessenger);
}

function syncBubbleUnreadBadge(dfMessenger) {
    const cfg = CHAT_BUBBLE_LAUNCHER_CONFIG.unreadBadge;
    const ms = dfMessenger || activeDfMessenger;
    if (!ms || typeof ms.querySelector !== "function") {
        return;
    }
    const host = ms.querySelector("df-messenger-chat-bubble") || activeBubbleNode;
    if (!host || !host.shadowRoot) {
        return;
    }
    const root = host.shadowRoot;
    const existing = root.getElementById(CHAT_BUBBLE_UNREAD_BADGE_ID);
    if (!cfg || !cfg.enabled || bubbleUnreadCount <= 0) {
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
        return;
    }
    let el = existing;
    if (!el) {
        el = document.createElement("span");
        el.id = CHAT_BUBBLE_UNREAD_BADGE_ID;
        el.setAttribute("aria-live", "polite");
        el.setAttribute("data-dfchat-no-translate", "true");
        root.appendChild(el);
    } else if (el.parentNode !== root) {
        root.appendChild(el);
    }
    try {
        host.style.setProperty("position", "relative", "important");
    } catch (e) {
        /* no-op */
    }
    const cap = cfg.maxDisplay;
    el.textContent = bubbleUnreadCount > cap ? `${cap}+` : String(bubbleUnreadCount);
    const fontPx = cfg.fontSizePx;
    const minSide = cfg.minSizePx;
    el.style.cssText = [
        "position:absolute",
        "top:0",
        "right:0",
        "transform:translate(32%,-32%)",
        `min-width:${minSide}px`,
        `height:${minSide}px`,
        "padding:0 5px",
        "box-sizing:border-box",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        `font-size:${fontPx}px`,
        "font-weight:700",
        "line-height:1",
        `color:${cfg.color}`,
        `background:${cfg.background}`,
        "border-radius:999px",
        "box-shadow:0 1px 4px rgba(15,23,42,0.35)",
        "pointer-events:none",
        "z-index:2147483646",
        "border:2px solid #fff"
    ].join(";");
}

function buildChatBubbleLauncherInjectedCss(cfg) {
    const overflow = cfg.hideOverflow ? "hidden" : "visible";
    if (!cfg.storyRingEnabled) {
        return `.bubble{border-radius:${cfg.cornerRoundness}!important;overflow:${overflow}!important;box-sizing:border-box!important}`;
    }
    const w = cfg.storyRingWidthPx;
    const inner = "var(--df-messenger-chat-bubble-background,linear-gradient(150deg,#0369a1 0%,#0284c7 45%,#0ea5e9 100%))";
    const rotSec = cfg.storyRingRotateSeconds;
    const extraDeg = cfg.storyRingRevolutions * 360;
    const kfName = "dfchat-story-ring-spin";
    let ringGrad = CHAT_BUBBLE_STORY_RING_GRADIENT;
    let prelude = "";
    let animDecl = "";
    if (rotSec > 0 && extraDeg > 0) {
        prelude = "@property --dfchat-story-ring-angle{syntax:\"<angle>\";inherits:false;initial-value:200deg;}"
            + `@keyframes ${kfName}{to{--dfchat-story-ring-angle:${200 + extraDeg}deg}}`;
        ringGrad = CHAT_BUBBLE_STORY_RING_GRADIENT.replace("from 200deg", "from var(--dfchat-story-ring-angle,200deg)");
        animDecl = `animation:${kfName} ${rotSec}s linear forwards!important;`;
    }
    return prelude
        + `.bubble{`
        + `border-radius:${cfg.cornerRoundness}!important;`
        + `overflow:${overflow}!important;`
        + `box-sizing:border-box!important;`
        + `border:${w}px solid transparent!important;`
        + `background:${inner} padding-box,${ringGrad} border-box!important;`
        + `background-origin:border-box!important;`
        + `background-clip:padding-box,border-box!important;`
        + animDecl
        + `}`;
}

/** @type {number|null} */
let botWritingDotsTimerId = null;
let botWritingDotsPhase = 0;
let botWritingDotsWasTyping = false;

/**
 * Strips trailing dots so we can append animated "." / ".." / "..." (see `tickBotWritingDots`).
 * @returns {string}
 */
function getBotWritingTextBase() {
    const raw = HEADER_CONFIG.botWritingText;
    if (typeof raw === "string" && raw.trim()) {
        return raw.trim().replace(/\.+$/, "").trim() || "Typing";
    }
    return "Typing";
}

function readBotWritingDotsIntervalMs() {
    const t = HEADER_CONFIG.botWritingDotsIntervalMs;
    return typeof t === "number" && Number.isFinite(t) && t >= 200 && t <= 5000 ? t : 480;
}

/** Idle label when the agent is not typing (matches previous static `...` look). */
function resolveBotWritingTextFromConfig() {
    return `${getBotWritingTextBase()}...`;
}

/**
 * Cycles `bot-writing-text` through Typing. / Typing.. / Typing... while `.typing-message` is in the tree.
 */
function tickBotWritingDots() {
    const ms = activeDfMessenger;
    if (!ms || typeof ms.querySelector !== "function") {
        return;
    }
    const bubble = ms.querySelector("df-messenger-chat-bubble");
    if (!bubble || typeof bubble.setAttribute !== "function") {
        return;
    }
    let typing = false;
    try {
        const roots = collectSearchRoots(ms);
        for (let i = 0; i < roots.length; i++) {
            const r = roots[i];
            if (r && r.querySelector && r.querySelector(".typing-message")) {
                typing = true;
                break;
            }
        }
    } catch {
        typing = false;
    }
    const base = getBotWritingTextBase();
    if (typing) {
        if (!botWritingDotsWasTyping) {
            botWritingDotsPhase = 0;
        }
        botWritingDotsWasTyping = true;
        const dots = ".".repeat(botWritingDotsPhase + 1);
        bubble.setAttribute("bot-writing-text", `${base}${dots}`);
        botWritingDotsPhase = (botWritingDotsPhase + 1) % 3;
    } else {
        botWritingDotsWasTyping = false;
        botWritingDotsPhase = 0;
        bubble.setAttribute("bot-writing-text", resolveBotWritingTextFromConfig());
    }
}

function restartBotWritingDotsTimer() {
    if (botWritingDotsTimerId !== null) {
        window.clearInterval(botWritingDotsTimerId);
        botWritingDotsTimerId = null;
    }
    botWritingDotsPhase = 0;
    botWritingDotsWasTyping = false;
    botWritingDotsTimerId = window.setInterval(tickBotWritingDots, readBotWritingDotsIntervalMs());
}

function applyBotWritingTextToChatBubble(host) {
    const bubble = host && host.tagName === "DF-MESSENGER-CHAT-BUBBLE"
        ? host
        : host && typeof host.querySelector === "function"
            ? host.querySelector("df-messenger-chat-bubble")
            : null;
    if (!bubble || typeof bubble.setAttribute !== "function") {
        return;
    }
    bubble.setAttribute("bot-writing-text", resolveBotWritingTextFromConfig());
}

function getChatInputPlaceholder(languageCode) {
    const lang = normalizeLanguage(languageCode);
    const fromOptions = CHAT_LANGUAGE_OPTIONS.find((o) => normalizeLanguageCode(o && o.code) === lang);
    const rowPlaceholder = fromOptions && typeof fromOptions.inputPlaceholder === "string" && fromOptions.inputPlaceholder.trim()
        ? fromOptions.inputPlaceholder.trim()
        : "";
    const rawMap = MULTI_LANGUAGE_CONFIG.inputPlaceholderByLanguage;
    const map = rawMap && typeof rawMap === "object" && !Array.isArray(rawMap) ? rawMap : {};
    const mapVal = typeof map[lang] === "string" && map[lang].trim() ? map[lang].trim() : "";
    const explicit = rowPlaceholder || mapVal;
    if (explicit) {
        return explicit;
    }
    const dictKey = resolveUiDictionaryKey(lang);
    const table = UI_TRANSLATIONS[dictKey] || UI_TRANSLATIONS[DEFAULT_LANGUAGE];
    if (table && typeof table.chatInputPlaceholder === "string" && table.chatInputPlaceholder.trim()) {
        return table.chatInputPlaceholder.trim();
    }
    const fallback = UI_TRANSLATIONS.en && UI_TRANSLATIONS.en.chatInputPlaceholder;
    return typeof fallback === "string" && fallback.trim() ? fallback.trim() : "Ask something…";
}

function forgetTranslationCacheForComposerPlaceholder(element) {
    if (!element || !originalElementAttributes.has(element)) {
        return;
    }
    const attrs = originalElementAttributes.get(element);
    if (!attrs) {
        return;
    }
    delete attrs.placeholder;
    if (Object.keys(attrs).length === 0) {
        originalElementAttributes.delete(element);
    }
}

/** Sets `placeholder` on the real composer field(s); Dialogflow often ignores later `placeholder-text` updates without this. */
function syncNativeComposerPlaceholders(dfMessenger) {
    const text = getChatInputPlaceholder(activeLanguage);
    if (!dfMessenger || !text) {
        return;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        const hosts = root.querySelectorAll("df-messenger-user-input");
        for (let i = 0; i < hosts.length; i++) {
            const h = hosts[i];
            if (!h || !h.shadowRoot) {
                continue;
            }
            const ta = h.shadowRoot.querySelector("textarea");
            if (ta) {
                ta.setAttribute("placeholder", text);
                ta.placeholder = text;
                forgetTranslationCacheForComposerPlaceholder(ta);
            }
        }
    }
}

/**
 * Clears the Dialogflow Messenger composer (textarea / input inside `df-messenger-user-input` shadow).
 * @param {unknown} dfMessenger
 */
function clearDfMessengerComposerInput_(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    if (!ms || typeof ms !== "object") {
        return;
    }
    try {
        const roots = collectSearchRoots(ms);
        for (let r = 0; r < roots.length; r += 1) {
            const root = roots[r];
            if (!root || !root.querySelectorAll) {
                continue;
            }
            const hosts = root.querySelectorAll("df-messenger-user-input");
            for (let i = 0; i < hosts.length; i += 1) {
                const h = hosts[i];
                if (!h || !h.shadowRoot) {
                    continue;
                }
                const sr = h.shadowRoot;
                const ta = sr.querySelector("textarea");
                if (ta && "value" in ta) {
                    ta.value = "";
                    try {
                        ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                    } catch {
                        /* ignore */
                    }
                }
                const inp = sr.querySelector("input[type=\"text\"], input[type=\"search\"], input:not([type])");
                if (inp && "value" in inp) {
                    inp.value = "";
                    try {
                        inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                    } catch {
                        /* ignore */
                    }
                }
            }
        }
    } catch {
        /* ignore */
    }
}

function scheduleClearDfMessengerComposerInput_() {
    window.setTimeout(() => {
        clearDfMessengerComposerInput_(activeDfMessenger);
    }, 0);
}

function applyChatInputPlaceholderToChatBubble(host) {
    const text = getChatInputPlaceholder(activeLanguage);
    const bubble = host && host.tagName === "DF-MESSENGER-CHAT-BUBBLE"
        ? host
        : host && typeof host.querySelector === "function"
            ? host.querySelector("df-messenger-chat-bubble")
            : null;
    if (bubble && typeof bubble.setAttribute === "function") {
        bubble.setAttribute("placeholder-text", text);
    }
    if (host && host.tagName === "DF-MESSENGER" && typeof host.setAttribute === "function") {
        host.setAttribute("placeholder-text", text);
    }
    if (host && host.tagName === "DF-MESSENGER") {
        syncNativeComposerPlaceholders(host);
    }
}

function scheduleChatInputPlaceholderRefresh(host) {
    if (!host) {
        return;
    }
    const run = () => applyChatInputPlaceholderToChatBubble(host);
    run();
    [90, 260, 650, 1200, 2000, 3500].forEach((delay) => {
        window.setTimeout(() => {
            if (activeDfMessenger === host) {
                run();
            }
        }, delay);
    });
}

/** @returns {string} Normalized https URL or "" */
function readPoweredByLinkUrlFromConfig() {
    const u = typeof POWERED_BY_CONFIG.linkUrl === "string" ? POWERED_BY_CONFIG.linkUrl.trim() : "";
    if (!u) {
        return "";
    }
    const withScheme = u.startsWith("http://") || u.startsWith("https://") ? u : `https://${u.replace(/^\/+/, "")}`;
    try {
        // eslint-disable-next-line no-new
        new URL(withScheme);
        return withScheme;
    } catch {
        return "";
    }
}
const POWERED_BY_LINK_URL = readPoweredByLinkUrlFromConfig();
const DEFAULT_LANGUAGE = normalizeLanguageCode(MULTI_LANGUAGE_CONFIG.defaultLanguage
    ? MULTI_LANGUAGE_CONFIG.defaultLanguage
    : "en");
const CHAT_LANGUAGE_OPTIONS = Array.isArray(MULTI_LANGUAGE_CONFIG.enabledLanguages)
    ? MULTI_LANGUAGE_CONFIG.enabledLanguages
    : [
        { code: "en", label: "English" },
        { code: "hi", label: "Hindi" },
        { code: "mr", label: "Marathi" }
    ];
const SUPPORTED_LANGUAGES = CHAT_LANGUAGE_OPTIONS
    .map((option) => normalizeLanguageCode(option && option.code ? option.code : ""))
    .filter((value) => value);
const CHAT_LANGUAGE_DROPDOWN_ID = "dfchat-chat-language-dropdown";
const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const DOM_TRANSLATION_DEBOUNCE_MS = 180;
let activeLanguage = getInitialLanguage();

/**
 * Endonyms for the default Indic/English set (`label` in config stays an English gloss for reference).
 * Add `nativeLabel` on a row in `enabledLanguages` to override for custom locales.
 * @type {Record<string, string>}
 */
const LANGUAGE_OPTION_AUTONYMS = {
    en: "English",
    hi: "हिन्दी",
    mr: "मराठी"
};

/**
 * Text shown in the language menu, select `<option>`, and the current-language pill.
 * @param {Record<string, unknown> | null | undefined} optionData
 * @returns {string}
 */
function getLanguageOptionDisplayLabel(optionData) {
    if (!optionData || typeof optionData !== "object") {
        return "—";
    }
    const custom = optionData.nativeLabel;
    if (typeof custom === "string" && custom.trim()) {
        return custom.trim();
    }
    const code = optionData.code;
    const resolved = code ? resolveToSupportedLanguageCode(String(code)) : "";
    const base = (resolved || "").split(/[-_]/)[0] || "";
    if (base && Object.prototype.hasOwnProperty.call(LANGUAGE_OPTION_AUTONYMS, base)) {
        return LANGUAGE_OPTION_AUTONYMS[base];
    }
    if (typeof optionData.label === "string" && optionData.label.trim()) {
        return optionData.label.trim();
    }
    if (base.length > 0) {
        return base.length <= 5 ? base.toUpperCase() : base;
    }
    return "—";
}

/** Visible name for a chat language (from `enabledLanguages`). Omit `explicitCode` to use `activeLanguage`. */
function getActiveChatLanguageDisplayLabel(explicitCode) {
    const raw = explicitCode !== undefined ? explicitCode : activeLanguage;
    const lang = resolveToSupportedLanguageCode(raw);
    const row = CHAT_LANGUAGE_OPTIONS.find(
        (o) => resolveToSupportedLanguageCode(o && o.code) === lang
    );
    if (row) {
        return getLanguageOptionDisplayLabel(row);
    }
    if (typeof lang === "string" && lang.length > 0) {
        return lang.length <= 5 ? lang.toUpperCase() : lang;
    }
    return "—";
}

let latestTranslationRunId = 0;
let translationRefreshTimer = null;
const originalTextNodeContent = new Map();
const originalElementAttributes = new Map();
const googleTranslationCache = new Map();

const COMPANY_JS_BUILD_TAG = "20260512-03";
const COMPANY_DEBUG_QUERY_FLAG = "dfchatDebug";
let debugMountAttemptSeq = 0;
let debugBadgeLastRenderAt = 0;
let debugBadgePendingLines = null;
let debugBadgeTimer = null;
let debugLogLines = [];
let bubbleVisibilityTimer = null;
/** Single poller from `ensureCloseIconIsX` (avoid stacking intervals on language / remount). */
let closeIconXIntervalId = null;
/** While the chat **panel** is open: keeps the titlebar dismiss control as × (Dialogflow can re-inject an arrow). */
let closeXWhileOpenMaintainId = null;

/** Tells Dialogflow which image to use for the **collapse** (title) control — reduces arrow/chevron if the URL loads. */
const CHAT_COLLAPSE_X_ICON_DATA_URL
    = "data:image/svg+xml,"
    + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#0a0a0a" stroke-width="2.2" stroke-linecap="round">'
        + "<path d=\"M18 6L6 18M6 6l12 12\"/>"
        + "</svg>"
    );

const FOOTER_OVERLAY_ID = "dfchat-chat-footer-overlay";
const COMPANY_LAUNCHER_INPUT_STRIP_ID = "dfchat-chat-launcher-input-strip";
/** Max wait after opening chat before sending text from the launcher input strip (ms). */
const LAUNCHER_INPUT_SEND_MAX_WAIT_MS = 5000;
let companyLauncherInputStripWindowListenersAttached = false;
let companyLauncherStripsResizeAttached = false;
let footerOverlayMounted = false;
let footerOverlayLastPos = { left: null, bottom: null, visible: null };
let footerOverlayHealTimer = null;
let footerOverlayGlobalEnsureTimer = null;
let overlayStatusNode = null;
const CHAT_ACTION_BAR_ID = "dfchat-chat-action-bar";
/** @type {HTMLDivElement | null} */
let poweredByStripNode = null;
/** Shift the user input / footer row: positive = up (`translateY(-n)`), negative = down, 0 = default. */
const USER_INPUT_NUDGE_UP_PX = -20;
let chatActionBarSyncTimer = null;
/** @type {{ left: number, top: number } | null} */
let chatActionBarFixedPos = null;
let scheduleChatActionBarRaf = 0;
/** Measured width for send-anchored layout; monotonically max’d so `offsetWidth` 258↔260 does not wobble `left`. */
let chatActionBarSendWidthCache = 0;
/** Rounded `Send` `getBoundingClientRect().left`; ignores ±1–3px viewport noise so the bar stops sliding horizontally. */
let chatActionBarSendLeftSnap = null;
/** Last width used in horizontal clamp; ignores small `visualViewport.width` flicker. */
let chatActionBarClampVwWCache = 0;
/** Ignore subpixel drift vs current `style.left` before we apply jitter. */
const ACTION_BAR_STYLE_H_DEADBAND_PX = 3;
let chatActionBarSyncDebounceTimer = 0;
/** Fixed `top` while composer row is single-line; reused when row grows (multiline). */
let chatActionBarStableTopPx = null;
/** Mobile: resync fixed footer controls on an interval (was rAF @ ~10Hz, which wobbled Language/Restart). */
let mobileFooterChromeIntervalId = 0;
/** Slower resync: subpixel / anchor math is stable; tight loops made the bar “crawl” continuously. */
const MOBILE_FOOTER_CHROME_RESYNC_MS = 500;
let actionBarScrollThrottleAt = 0;
let actionBarScrollThrottleTimer = 0;
/** Max rate for window/document / visualViewport scroll → action bar sync (reduces constant micro-drift on desktop + mobile). */
const ACTION_BAR_SCROLL_TO_SYNC_THROTTLE_MS = 220;
let safeAreaTopInsetCache = /** @type {{ px: number, at: number } | null} */ (null);
/** @type {Array<{ el: EventTarget, fn: (e: Event) => void }>} */
let footerScrollParentBindings = [];

/**
 * iOS / notched devices: `env(safe-area-inset-top)` in px (0 when N/A), cached briefly.
 * @returns {number}
 */
function getEnvSafeAreaInsetTopPx() {
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    if (safeAreaTopInsetCache && (now - safeAreaTopInsetCache.at) < 1500) {
        return safeAreaTopInsetCache.px;
    }
    let px = 0;
    try {
        const p = document.createElement("div");
        p.setAttribute("data-dfchat-safe-probe", "true");
        p.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden;z-index:-1;padding:0;border:0;margin:0;padding-top:env(safe-area-inset-top, 0px);";
        document.body.appendChild(p);
        const pt = getComputedStyle(p).paddingTop;
        document.body.removeChild(p);
        const n = parseFloat(pt);
        if (Number.isFinite(n) && n >= 0) {
            px = n;
        }
    } catch {
        /* no-op */
    }
    safeAreaTopInsetCache = { px, at: now };
    return px;
}

if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
        safeAreaTopInsetCache = null;
    }, { passive: true });
    window.addEventListener("orientationchange", () => {
        safeAreaTopInsetCache = null;
    }, { passive: true });
}

function onFooterHostScroll() {
    throttledSyncChatActionBarFromUserScroll();
}

/**
 * Throttle high-frequency `scroll` (page, nested, visualViewport) so fixed Language/Restart are not
 * recomputed many times per second.
 */
function throttledSyncChatActionBarFromUserScroll() {
    const t = Date.now();
    if (t - actionBarScrollThrottleAt < ACTION_BAR_SCROLL_TO_SYNC_THROTTLE_MS) {
        if (!actionBarScrollThrottleTimer) {
            const delay = ACTION_BAR_SCROLL_TO_SYNC_THROTTLE_MS - (t - actionBarScrollThrottleAt);
            actionBarScrollThrottleTimer = window.setTimeout(() => {
                actionBarScrollThrottleTimer = 0;
                actionBarScrollThrottleAt = Date.now();
                scheduleSyncChatActionBarPosition();
            }, Math.max(0, delay));
        }
        return;
    }
    actionBarScrollThrottleAt = t;
    scheduleSyncChatActionBarPosition();
}

function clearFooterScrollParentListeners() {
    for (const b of footerScrollParentBindings) {
        try {
            b.el.removeEventListener("scroll", b.fn, { capture: true });
        } catch {
            /* no-op */
        }
    }
    footerScrollParentBindings = [];
}

/**
 * `scroll` does not bubble: nested `overflow:auto` main columns never reach `window`. Bind those ancestors.
 * @param {Node | null | undefined} start
 */
function bindFooterScrollParentsForChat(start) {
    clearFooterScrollParentListeners();
    if (!start || typeof Node === "undefined" || !(start instanceof Node)) {
        return;
    }
    let el = start.parentNode;
    while (el && el !== document.body && el !== document.documentElement) {
        if (el instanceof Element) {
            try {
                const cs = window.getComputedStyle(el);
                const oy = cs.overflowY;
                const ox = cs.overflowX;
                const canY = (oy === "auto" || oy === "scroll" || oy === "overlay")
                    && el.scrollHeight > el.clientHeight + 1;
                const canX = (ox === "auto" || ox === "scroll" || ox === "overlay")
                    && el.scrollWidth > el.clientWidth + 1;
                if (canY || canX) {
                    const fn = onFooterHostScroll;
                    el.addEventListener("scroll", fn, { passive: true, capture: true });
                    footerScrollParentBindings.push({ el, fn });
                }
            } catch {
                /* no-op */
            }
        }
        el = el.parentNode;
    }
}

function stopMobileFooterChromeLayoutLoop() {
    if (mobileFooterChromeIntervalId) {
        try {
            window.clearInterval(mobileFooterChromeIntervalId);
        } catch {
            /* no-op */
        }
        mobileFooterChromeIntervalId = 0;
    }
}

/**
 * Re-run footer geometry while mobile chat is open. Inner page scrollers do not fire window scroll.
 * Uses a slow interval (not rAF) so the Language/Restart row is not nudged every ~100ms.
 */
function startMobileFooterChromeLayoutLoop() {
    stopMobileFooterChromeLayoutLoop();
    if (!isMobileViewport() || !isChatWindowOpen) {
        return;
    }
    const tick = () => {
        if (!isChatWindowOpen || !isMobileViewport()) {
            stopMobileFooterChromeLayoutLoop();
            return;
        }
        syncChatActionBarPosition();
        syncPoweredByStripPosition();
    };
    window.setTimeout(tick, 0);
    mobileFooterChromeIntervalId = window.setInterval(tick, MOBILE_FOOTER_CHROME_RESYNC_MS);
}

/** @type {number} */
let hostPageScrollLockY = 0;
let hostPageScrollLockActive = false;

/**
 * When the chat panel is open on mobile, lock the host page so scrolling the message list
 * does not move the site behind it (iOS uses `position: fixed` + stored scrollY).
 */
function applyHostPageScrollLockForOpenChat() {
    if (!isMobileViewport() || hostPageScrollLockActive) {
        return;
    }
    hostPageScrollLockActive = true;
    hostPageScrollLockY = window.pageYOffset
        || document.documentElement.scrollTop
        || (document.body && document.body.scrollTop)
        || 0;
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) {
        hostPageScrollLockActive = false;
        return;
    }
    html.classList.add("dfchat-host-scroll-locked");
    html.style.setProperty("overflow", "hidden");
    body.style.setProperty("overflow", "hidden");
    body.style.setProperty("position", "fixed");
    body.style.setProperty("top", `-${hostPageScrollLockY}px`);
    body.style.setProperty("left", "0");
    body.style.setProperty("right", "0");
    body.style.setProperty("width", "100%");
    body.style.setProperty("overscroll-behavior", "none");
    html.style.setProperty("overscroll-behavior", "none");
}

function releaseHostPageScrollLockForOpenChat() {
    if (!hostPageScrollLockActive) {
        return;
    }
    const y = hostPageScrollLockY;
    hostPageScrollLockActive = false;
    hostPageScrollLockY = 0;
    const html = document.documentElement;
    const body = document.body;
    if (html) {
        html.classList.remove("dfchat-host-scroll-locked");
        html.style.removeProperty("overflow");
        html.style.removeProperty("overscroll-behavior");
    }
    if (body) {
        body.style.removeProperty("overflow");
        body.style.removeProperty("position");
        body.style.removeProperty("top");
        body.style.removeProperty("left");
        body.style.removeProperty("right");
        body.style.removeProperty("width");
        body.style.removeProperty("overscroll-behavior");
    }
    try {
        window.scrollTo(0, y);
    } catch {
        /* no-op */
    }
}

function resetChatActionBarPositionCaches() {
    chatActionBarFixedPos = null;
    chatActionBarSendWidthCache = 0;
    chatActionBarSendLeftSnap = null;
    chatActionBarStableTopPx = null;
    chatActionBarClampVwWCache = 0;
}

function scheduleSyncChatActionBarPosition() {
    window.clearTimeout(chatActionBarSyncDebounceTimer);
    chatActionBarSyncDebounceTimer = window.setTimeout(() => {
        chatActionBarSyncDebounceTimer = 0;
        if (scheduleChatActionBarRaf) {
            return;
        }
        scheduleChatActionBarRaf = window.requestAnimationFrame(() => {
            scheduleChatActionBarRaf = 0;
            syncChatActionBarPosition();
            // Contact form can change internal measurements; run Powered by after it so the strip stays on the real footer.
            syncContactFormPosition();
            syncPoweredByStripPosition();
        });
    }, 120);
}

/**
 * Language/Restart live in `#dfchat-chat-action-bar`. Full `applyLayout` on `focusin` (see mobile chat setup)
 * reflows the panel and was making these controls jump on every click.
 * @param {EventTarget | null} node
 * @returns {boolean}
 */
function isTargetInsideChatActionBar(node) {
    return !!(node && typeof node.closest === "function" && node.closest("#" + CHAT_ACTION_BAR_ID));
}

/**
 * @param {Element | null} el
 * @returns {boolean}
 */
function isChatActionBarInlineElement(el) {
    return !!(el && el.classList
        && el.classList.contains("dfchat-chat-action-bar--inline")
        && el.isConnected);
}

/**
 * Never rely on `document.getElementById` alone: the bar may live in a shadow root.
 * Do **not** yank a composer–inline bar back to `document.body` (that was undoing
 * `mountChatActionBarInline` and re-enabling `position: fixed` jiggle on every sync).
 */
function getChatActionBar() {
    let el = document.getElementById(CHAT_ACTION_BAR_ID);
    if (el) {
        if (isChatActionBarInlineElement(el)) {
            return el;
        }
        if (el.parentElement !== document.body) {
            try {
                document.body.appendChild(el);
            } catch {
                // ignore
            }
        }
        return el;
    }
    // After `mountChatActionBarInline`, the bar may live in a *nested* shadow (below composer) — the top-level
    // `df-messenger.shadowRoot.getElementById` does not see IDs inside child components' shadow roots.
    const ms = activeDfMessenger || document.querySelector("df-messenger");
    if (ms) {
        const roots = collectSearchRoots(ms);
        for (let i = 0; i < roots.length; i += 1) {
            const root = roots[i];
            if (!root || typeof root.getElementById !== "function" || root === document) {
                continue;
            }
            const found = root.getElementById(CHAT_ACTION_BAR_ID);
            if (found) {
                el = found;
                break;
            }
        }
    }
    if (el) {
        if (isChatActionBarInlineElement(el)) {
            return el;
        }
        if (el.parentElement !== document.body) {
            try {
                document.body.appendChild(el);
            } catch {
                // ignore
            }
        }
        return el;
    }
    return null;
}

/** Restart control: ↻ (inherits `color` / `currentColor`). */
function getRestartIconHtml(sizePx) {
    const s = Number.isFinite(sizePx) && sizePx > 0 ? Math.round(sizePx) : 16;
    return (
        "<span class=\"dfchat-restart-icon-glyph\" style=\"font-size:" + s + "px\" aria-hidden=\"true\">↻</span>"
    );
}
let embeddedFooterControlsTimer = null;

function updateOverlayStatus(text) {
    // Status overlay disabled.
}

function isCompanyDebugFrozen() {
    try {
        return window.localStorage.getItem("dfchat_debug_freeze") === "1";
    } catch {
        return false;
    }
}

function toggleCompanyDebugFrozen() {
    try {
        const nextValue = isCompanyDebugFrozen() ? "0" : "1";
        window.localStorage.setItem("dfchat_debug_freeze", nextValue);
    } catch {
        // ignore
    }
}

function isCompanyDebugEnabled() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        if (params.get(COMPANY_DEBUG_QUERY_FLAG) === "1") {
            return true;
        }
        if (window.__dfchatDebug === true) {
            return true;
        }
        return window.localStorage.getItem("dfchat_debug_footer") === "1";
    } catch {
        return false;
    }
}

function updateCompanyDebugBadge(lines) {
    if (!isCompanyDebugEnabled()) {
        return;
    }

    if (isCompanyDebugFrozen()) {
        return;
    }

    const id = "dfchat-debug-badge";
    let badge = document.getElementById(id);
    if (!badge) {
        badge = document.createElement("pre");
        badge.id = id;
        badge.style.position = "fixed";
        badge.style.left = "10px";
        badge.style.bottom = "10px";
        badge.style.zIndex = "2147483647";
        badge.style.background = "rgba(15, 23, 42, 0.92)";
        badge.style.color = "#e2e8f0";
        badge.style.padding = "10px 12px";
        badge.style.borderRadius = "10px";
        badge.style.font = "12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
        badge.style.boxShadow = "0 12px 30px rgba(0,0,0,0.30)";
        badge.style.maxWidth = "min(520px, calc(100vw - 20px))";
        badge.style.whiteSpace = "pre-wrap";
        badge.style.pointerEvents = "auto";
        badge.style.userSelect = "text";
        badge.style.cursor = "pointer";
        badge.title = "Click to freeze/unfreeze debug text";
        badge.addEventListener("click", () => {
            toggleCompanyDebugFrozen();
            // Force one immediate render so state is obvious.
            const frozen = isCompanyDebugFrozen();
            if (frozen) {
                badge.textContent = `${badge.textContent}\n\n[DEBUG FROZEN - click to unfreeze]`;
            } else if (debugBadgePendingLines) {
                badge.textContent = debugBadgePendingLines.join("\n");
            }
        });
        document.body.appendChild(badge);
    }

    const safeLines = Array.isArray(lines) ? lines : [];

    // Append to an in-memory log so we can see *why* something failed.
    // Keep last ~80 lines so it stays readable.
    const timestamp = new Date().toLocaleTimeString();
    debugLogLines.push(`[${timestamp}] ${safeLines[0] || "debug"}`);
    for (let i = 1; i < safeLines.length; i += 1) {
        debugLogLines.push(`  ${safeLines[i]}`);
    }
    if (debugLogLines.length > 80) {
        debugLogLines = debugLogLines.slice(debugLogLines.length - 80);
    }

    // Throttle updates so the user can select/copy.
    debugBadgePendingLines = debugLogLines.slice();
    const now = Date.now();
    const minIntervalMs = 1000;
    const dueInMs = Math.max(0, minIntervalMs - (now - debugBadgeLastRenderAt));

    if (dueInMs === 0) {
        badge.textContent = debugBadgePendingLines.join("\n");
        debugBadgeLastRenderAt = Date.now();
        return;
    }

    if (!debugBadgeTimer) {
        debugBadgeTimer = window.setTimeout(() => {
            debugBadgeTimer = null;
            if (isCompanyDebugFrozen()) {
                return;
            }
            const element = document.getElementById(id);
            if (element && debugBadgePendingLines) {
                element.textContent = debugBadgePendingLines.join("\n");
                debugBadgeLastRenderAt = Date.now();
            }
        }, dueInMs);
    }
}

const UI_TRANSLATIONS = {
    en: {
        contactFormTitle: "Contact Form",
        contactFormSubtitle: "Share your contact details.",
        closeFormAria: "Close form",
        namePlaceholder: "Name",
        mobilePlaceholder: "Mobile number",
        emailPlaceholder: "Email",
        messagePlaceholder: "How can we help?",
        otpCodePlaceholder: "Enter OTP",
        summaryNameLabel: "Name",
        summaryMobileLabel: "Mobile",
        summaryEmailLabel: "Email",
        summaryDateLabel: "Date",
        summaryBirthDateLabel: "Date of birth",
        birthDatePlaceholder: "Select your date of birth",
        summaryTimeLabel: "Time",
        summaryDoctorIdLabel: "Doctor",
        summaryLocationLabel: "Location",
        summaryOtpLabel: "OTP",
        submitButton: "Submit",
        languageLabel: "Language",
        restartButtonLabel: "Restart",
        chatInputPlaceholder: "Ask something…",
        statusOpenViaFlask: "Open this page through the Flask app URL to submit the form.",
        statusSubmitting: "Submitting...",
        statusSubmitted: "Submitted successfully.",
        statusSubmissionFailed: "Submission failed. Please try again.",
        contactResponseThanks: "Thank you for sharing.",
        fieldRequired: "Please fill in this field.",
        invalidEmail: "Please enter a valid email address.",
        invalidPhone: "Please enter a valid phone number.",
        invalidPattern: "This value does not match the required format.",
        invalidPastBirthDate: "Please choose a date of birth in the past (not today or a future date).",
        invalidOtp: "Enter a valid OTP (4–8 digits).",
        changeMobileButton: "Change mobile number",
        backToOtpButton: "Back to OTP",
        resendOtpButton: "Didn't receive? Send OTP again",
        statusOtpResent: "A new code has been sent. Check your messages.",
        statusMobileNumberSaved: "Number updated. Enter the new code below.",
        otpFormSubtitleMobile: "Enter your mobile number and submit.",
        documentUploadAria: "Choose a file to upload",
        summaryDocumentLabel: "Document",
        invalidVideoFile: "Video files are not allowed. Use images, PDF, Word, or other documents.",
        clearFileSelectionButton: "Cancel selection",
        appointmentSlotAlreadyBooked: "This time slot is already booked. Please choose another.",
        appointmentPickerSelected: "Selected",
        appointmentPickerPickDayIntro: "Pick a day, then a time slot.",
        appointmentPickerChooseTime: "Choose a time slot below.",
        appointmentPickTimeSlot: "Please pick a time slot.",
        appointmentPickDate: "Please pick a date on the calendar.",
        appointmentPickDateAndTime: "Please choose a date and a time slot."
    },
    hi: {
        contactFormTitle: "संपर्क करें",
        contactFormSubtitle: "अपनी जानकारी साझा करें, हम आपसे संपर्क करेंगे।",
        closeFormAria: "फॉर्म बंद करें",
        namePlaceholder: "नाम",
        mobilePlaceholder: "मोबाइल नंबर",
        emailPlaceholder: "ईमेल",
        messagePlaceholder: "हम आपकी कैसे मदद कर सकते हैं?",
        otpCodePlaceholder: "OTP दर्ज करें",
        summaryNameLabel: "नाम",
        summaryMobileLabel: "मोबाइल",
        summaryEmailLabel: "ईमेल",
        summaryDateLabel: "तिथि",
        summaryBirthDateLabel: "जन्म तिथि",
        birthDatePlaceholder: "अपनी जन्म तिथि चुनें",
        summaryTimeLabel: "समय",
        summaryDoctorIdLabel: "डॉक्टर",
        summaryLocationLabel: "स्थान",
        summaryOtpLabel: "OTP",
        submitButton: "जमा करें",
        languageLabel: "भाषा",
        restartButtonLabel: "रीस्टार्ट",
        chatInputPlaceholder: "कुछ पूछें…",
        statusOpenViaFlask: "फॉर्म जमा करने के लिए इस पेज को Flask ऐप URL से खोलें।",
        statusSubmitting: "जमा किया जा रहा है...",
        statusSubmitted: "सफलतापूर्वक जमा किया गया।",
        statusSubmissionFailed: "जमा नहीं हो सका। कृपया फिर से प्रयास करें।",
        contactResponseThanks: "जानकारी साझा करने के लिए धन्यवाद",
        fieldRequired: "कृपया यह भरें।",
        invalidEmail: "कृपया मान्य ईमेल दर्ज करें।",
        invalidPhone: "कृपया मान्य फोन नंबर दर्ज करें।",
        invalidPattern: "यह मान आवश्यक प्रारूप से मेल नहीं खाता।",
        invalidPastBirthDate: "कृपया अतीत की जन्म तिथि चुनें (आज या भविष्य की तारीख मान्य नहीं)।",
        invalidOtp: "मान्य OTP दर्ज करें (4–8 अंक)।",
        changeMobileButton: "मोबाइल नंबर बदलें",
        backToOtpButton: "OTP पर वापस",
        resendOtpButton: "नहीं मिला? फिर से OTP भेजें",
        statusOtpResent: "नया कोड भेज दिया गया। संदेश देखें।",
        statusMobileNumberSaved: "नंबर अपडेट। नया कोड ऊपर दर्ज करें।",
        otpFormSubtitleMobile: "मोबाइल नंबर दर्ज करें और जमा करें।",
        documentUploadAria: "अपलोड के लिए फ़ाइल चुनें",
        summaryDocumentLabel: "दस्तावेज़",
        invalidVideoFile: "वीडियो फ़ाइलें मान्य नहीं। छवि, PDF या Word आदि भेजें।",
        clearFileSelectionButton: "चयन रद्द करें",
        appointmentSlotAlreadyBooked: "यह समय पहले से बुक है। कृपया कोई और समय चुनें।",
        appointmentPickerSelected: "चयनित",
        appointmentPickerPickDayIntro: "पहले दिन चुनें, फिर समय।",
        appointmentPickerChooseTime: "नीचे समय चुनें।",
        appointmentPickTimeSlot: "कृपया समय चुनें।",
        appointmentPickDate: "कृपया कैलेंडर से तारीख चुनें।",
        appointmentPickDateAndTime: "कृपया तारीख और समय चुनें।"
    },
    mr: {
        contactFormTitle: "आमच्याशी संपर्क करा",
        contactFormSubtitle: "तुमची माहिती शेअर करा, आम्ही तुमच्याशी संपर्क करू.",
        closeFormAria: "फॉर्म बंद करा",
        namePlaceholder: "नाव",
        mobilePlaceholder: "मोबाईल नंबर",
        emailPlaceholder: "ईमेल",
        messagePlaceholder: "आम्ही तुम्हाला कशी मदत करू शकतो?",
        otpCodePlaceholder: "OTP टाका",
        summaryNameLabel: "नाव",
        summaryMobileLabel: "मोबाईल",
        summaryEmailLabel: "ईमेल",
        summaryDateLabel: "तारीख",
        summaryBirthDateLabel: "जन्मतारीख",
        birthDatePlaceholder: "तुमची जन्मतारीख निवडा",
        summaryTimeLabel: "वेळ",
        summaryDoctorIdLabel: "डॉक्टर",
        summaryLocationLabel: "ठिकाण",
        summaryOtpLabel: "OTP",
        submitButton: "सबमिट",
        languageLabel: "भाषा",
        restartButtonLabel: "रीस्टार्ट",
        chatInputPlaceholder: "इथे टाइप करा…",
        statusOpenViaFlask: "फॉर्म सबमिट करण्यासाठी हा पेज Flask अ‍ॅप URL वरून उघडा.",
        statusSubmitting: "सबमिट होत आहे...",
        statusSubmitted: "यशस्वीरित्या सबमिट झाले.",
        statusSubmissionFailed: "सबमिट झाले नाही. कृपया पुन्हा प्रयत्न करा.",
        contactResponseThanks: "माहिती शेअर केल्याबद्दल धन्यवाद",
        fieldRequired: "कृपया हे क्षेत्र भरा.",
        invalidEmail: "कृपया वैध ईमेल टाका.",
        invalidPhone: "कृपया वैध फोन क्रमांक टाका.",
        invalidPattern: "हे मूल्य आवश्यक स्वरूपाशी जुळत नाही.",
        invalidPastBirthDate: "कृपया भूतकाळातील जन्मतारीख निवडा (आज किंवा भविष्यातील तारीख मान्य नाही).",
        invalidOtp: "वैध OTP टाका (४–८ अंक).",
        changeMobileButton: "मोबाईल क्रमांक बदला",
        backToOtpButton: "OTPकडे परत",
        resendOtpButton: "मिळाला नाही? पुन्हा OTP पाठवा",
        statusOtpResent: "नवा कोड पाठवला. मेसेज पहा.",
        statusMobileNumberSaved: "नंबर अपडेट. नवा कोड वर टाका.",
        otpFormSubtitleMobile: "मोबाईल क्रमांक टाका आणि सबमिट करा.",
        documentUploadAria: "अपलोडसाठी फाइल निवडा",
        summaryDocumentLabel: "दस्तऐवज",
        invalidVideoFile: "व्हिडिओ फाइल्सना परवानगी नाही. प्रतिमा, PDF किंवा Word वापरा.",
        clearFileSelectionButton: "निवड रद्द करा",
        appointmentSlotAlreadyBooked: "ही वेळ आधीच बुक आहे. कृपया दुसरी वेळ निवडा.",
        appointmentPickerSelected: "निवडलेले",
        appointmentPickerPickDayIntro: "आधी दिवस निवडा, मग वेळ.",
        appointmentPickerChooseTime: "खाली वेळ निवडा.",
        appointmentPickTimeSlot: "कृपया वेळ निवडा.",
        appointmentPickDate: "कृपया दिनदर्शिकेतून तारीख निवडा.",
        appointmentPickDateAndTime: "कृपया तारीख आणि वेळ निवडा."
    }
};

/**
 * Production embeds: no contact-form markup in HTML. Inject once if missing (idempotent).
 * Scoped styles live in `company.css`.
 */
function mountDfchatContactFormHostIfNeeded() {
    if (document.getElementById("dfchat-contact-form")) {
        return;
    }
    const section = document.createElement("section");
    section.id = "dfchat-contact-form";
    section.className = "dfchat-contact-form";
    section.setAttribute("aria-hidden", "true");
    section.innerHTML = ""
        + "<div class=\"dfchat-contact-form__card\">"
        + "<div class=\"dfchat-contact-form__header\">"
        + "<div>"
        + "<h2 class=\"dfchat-contact-form__title\" data-i18n=\"contactFormTitle\">Contact Us</h2>"
        + "<p class=\"dfchat-contact-form__subtitle\" data-i18n=\"contactFormSubtitle\">Share your details and we will contact you.</p>"
        + "</div>"
        + "<button id=\"dfchat-contact-form-close\" class=\"dfchat-contact-form__icon-button\" type=\"button\" "
        + "aria-label=\"Close form\" data-i18n-aria-label=\"closeFormAria\" data-dfchat-no-translate=\"true\">X</button>"
        + "</div>"
        + "<form id=\"dfchat-contact-form-fields\" class=\"dfchat-contact-form__fields dfchat-contact-form__fields--stacked\">"
        + "<div id=\"dfchat-contact-form-inputs\" class=\"dfchat-contact-form__inputs\" data-i18n-aria-label=\"contactFormTitle\"></div>"
        + "<p id=\"dfchat-contact-form-status\" class=\"dfchat-contact-form__status\" aria-live=\"polite\"></p>"
        + "<button id=\"dfchat-contact-form-submit\" class=\"dfchat-contact-form__submit\" type=\"submit\" data-i18n=\"submitButton\">Submit</button>"
        + "</form>"
        + "</div>";
    document.body.appendChild(section);
}

const DFCHAT_COMPOSER_TYPING = "dfchat-composer-typing";
let dfchatComposerHeaderBehaviorBound = false;

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isMessageComposerField(el) {
    if (!el || el.nodeType !== 1) {
        return false;
    }
    const t = (el.tagName || "").toLowerCase();
    if (t === "textarea") {
        return true;
    }
    if (t === "input") {
        const ty = (String(el.getAttribute("type") || "text")).toLowerCase();
        if (ty === "hidden" || ty === "checkbox" || ty === "radio" || ty === "file" || ty === "button" || ty === "submit" || ty === "reset" || ty === "image") {
            return false;
        }
        return true;
    }
    return false;
}

/**
 * @param {Node | null} m
 * @param {Node | null} [active]
 * @returns {boolean}
 */
function isFocusInMessenger(m, active) {
    const a = active || document.activeElement;
    if (!m || !a) {
        return false;
    }
    const p = typeof a.composedPath === "function" ? a.composedPath() : [];
    return p.indexOf(m) >= 0;
}

function syncDfMessengerComposerTypingClass() {
    const m = activeDfMessenger || document.querySelector("df-messenger");
    if (!m) {
        return;
    }
    const a = document.activeElement;
    if (!isFocusInMessenger(m, a)) {
        m.classList.remove(DFCHAT_COMPOSER_TYPING);
        return;
    }
    if (isMessageComposerField(a)) {
        m.classList.add(DFCHAT_COMPOSER_TYPING);
    } else {
        m.classList.remove(DFCHAT_COMPOSER_TYPING);
    }
}

/**
 * On mobile, hide the chat title bar while the user types in the composer; show again on blur.
 */
function ensureComposerHeaderCollapseBehavior() {
    if (dfchatComposerHeaderBehaviorBound) {
        return;
    }
    dfchatComposerHeaderBehaviorBound = true;
    document.addEventListener("focusin", (e) => {
        const m = activeDfMessenger || document.querySelector("df-messenger");
        if (!m || !e.target) {
            return;
        }
        if (!e.composedPath || e.composedPath().indexOf(m) < 0) {
            return;
        }
        if (isMessageComposerField(/** @type {Element} */(e.target))) {
            m.classList.add(DFCHAT_COMPOSER_TYPING);
        }
    }, true);
    document.addEventListener("focusout", () => {
        window.setTimeout(syncDfMessengerComposerTypingClass, 60);
    }, true);
}

function runCompanyDomReadyInit() {
    mountDfchatContactFormHostIfNeeded();
    applyThemeConfig(COMPANY_UI_CONFIG);
    if (!isMultiLanguageEnabled()) {
        activeLanguage = DEFAULT_LANGUAGE;
    }
    window.addEventListener("resize", () => {
        syncMobileLightboxParkStateFromChat();
    }, { passive: true });
    attachImageLightboxClickHandler();
    ensureComposerHeaderCollapseBehavior();
    // Mount chat before the inline form and other UI — if form init throws, the bubble should still show.
    runMessengerMountWhenCustomElementReady();
    // Contact fields mount from config; applyLanguage must run after so placeholders/labels apply.
    initializeContactForm();
    applyLanguage(activeLanguage);
    // Initialize hard bar after messenger mounts.
    // (removed status overlay)
    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `multiLanguage enabled: ${isMultiLanguageEnabled()}`,
        `restart enabled: ${isRestartChatEnabled()}`,
        `activeLanguage: ${activeLanguage}`,
        `debug: add ?${COMPANY_DEBUG_QUERY_FLAG}=1`
    ]);
    initializeClientContextCapture();
}

/**
 * The widget bundle can load in the same turn as `df-messenger.js` onload. In some browsers the
 * `df-messenger` custom element is not yet defined when this script first runs; wait for it
 * (embed / Flask `test-embed` and similar).
 */
function runMessengerMountWhenCustomElementReady() {
    if (typeof customElements === "undefined" || typeof customElements.get !== "function") {
        createAndMountMessenger();
        return;
    }
    if (customElements.get("df-messenger")) {
        createAndMountMessenger();
        return;
    }
    if (typeof customElements.whenDefined !== "function") {
        createAndMountMessenger();
        return;
    }
    let didMount = false;
    const tryMount = () => {
        if (didMount) {
            return;
        }
        if (!customElements.get("df-messenger")) {
            // eslint-disable-next-line no-console
            console.error("[company chat] df-messenger is still undefined — check Network tab: df-messenger.js must load from Google (not blocked by ad blocker / CSP).");
        }
        didMount = true;
        createAndMountMessenger();
    };
    const failSafeMs = 12000;
    const timer = window.setTimeout(() => {
        if (!didMount) {
            // eslint-disable-next-line no-console
            console.warn("[company chat] df-messenger not registered after " + failSafeMs + "ms; attempting mount.");
        }
        tryMount();
    }, failSafeMs);
    customElements.whenDefined("df-messenger").then(() => {
        window.clearTimeout(timer);
        tryMount();
    }).catch((e) => {
        window.clearTimeout(timer);
        // eslint-disable-next-line no-console
        console.error("[company chat] whenDefined(df-messenger) failed; mounting anyway.", e);
        tryMount();
    });
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", runCompanyDomReadyInit);
} else {
    // Script loaded after DOMContentLoaded (e.g. async `company-loader.js` on /test-embed) — run now.
    runCompanyDomReadyInit();
}

function initializeHardActionBar() {
    const messenger = activeDfMessenger || document.querySelector("df-messenger");
    if (!messenger) {
        return;
    }

    // Create header controls container
    let headerControls = document.querySelector("df-messenger-header df-messenger-header-controls");
    if (!headerControls) {
        // Try to find the header
        const header = messenger.querySelector("df-messenger-header");
        if (!header) {
            setTimeout(initializeHardActionBar, 500);
            return;
        }
        headerControls = header.querySelector("df-messenger-header-controls");
    }

    if (!headerControls) {
        setTimeout(initializeHardActionBar, 500);
        return;
    }

    if (isMultiLanguageEnabled()) {
        const langWrap = document.createElement("div");
        langWrap.id = "dfchat-hard-language-wrap";
        langWrap.style.position = "relative";

        const langButton = document.createElement("button");
        langButton.id = "dfchat-hard-language-btn";
        langButton.type = "button";
        langButton.setAttribute("aria-label", "Language");
        langButton.setAttribute("title", "Language");
        langButton.textContent = "🌐";
        langButton.style.cssText = "width: 34px; height: 34px; border: none; border-radius: 10px; background: transparent; color: #0369a1; display: grid; place-items: center; padding: 0; cursor: pointer; font-size: 22px; margin: 0; transition: background 0.2s ease;";

        const menu = document.createElement("div");
        menu.id = "dfchat-hard-language-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Language options");
        menu.style.cssText = "position: absolute; right: 0; bottom: 42px; min-width: 148px; border: 1px solid rgba(203, 213, 225, 0.95); border-radius: 12px; background: #ffffff; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18); padding: 6px; display: none;";

        for (const lang of CHAT_LANGUAGE_OPTIONS) {
            const option = document.createElement("button");
            option.type = "button";
            option.setAttribute("data-lang", lang.code);
            option.textContent = getLanguageOptionDisplayLabel(lang);
            option.style.cssText = "width: 100%; height: auto; text-align: left; border: 0; background: transparent; color: #0f172a; border-radius: 10px; padding: 8px 10px; font: 600 12px 'Manrope', 'Segoe UI', sans-serif; cursor: pointer; transition: background 0.2s ease;";

            option.addEventListener("click", () => {
                const code = option.getAttribute("data-lang") || "en";
                applyLanguage(code);
                menu.style.display = "none";
            });

            menu.appendChild(option);
        }

        langButton.addEventListener("click", (event) => {
            event.stopPropagation();
            menu.style.display = menu.style.display === "none" ? "block" : "none";
        });

        langWrap.appendChild(langButton);
        langWrap.appendChild(menu);
        headerControls.appendChild(langWrap);

        /* Bubble phase: capture would run before the button and clear the menu, breaking toggle on 2nd click. */
        document.addEventListener("click", () => {
            menu.style.display = "none";
        }, false);
    }

    if (isRestartChatEnabled()) {
        const restartButton = document.createElement("button");
        restartButton.id = "dfchat-hard-restart-btn";
        restartButton.type = "button";
        restartButton.setAttribute("aria-label", "Restart");
        restartButton.setAttribute("title", "Restart");
        restartButton.setAttribute("data-dfchat-no-translate", "true");
        restartButton.style.cssText = "width: 34px; height: 34px; border: none; border-radius: 10px; background: transparent; color: #0369a1; display: grid; place-items: center; padding: 0; cursor: pointer; margin: 0; transition: background 0.2s ease;";
        restartButton.innerHTML = getRestartIconHtml(22);

        restartButton.addEventListener("click", () => {
            restartChatSession();
        });
        headerControls.appendChild(restartButton);
    }

    // Create close button
    const closeButton = document.createElement("button");
    closeButton.id = "dfchat-contact-form-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.setAttribute("title", "Close");
    closeButton.setAttribute("data-dfchat-close-icon", "x");
    closeButton.setAttribute("data-dfchat-no-translate", "true");
    closeButton.textContent = "X";
    closeButton.style.cssText = "width: 44px; height: 44px; border: none; border-radius: 12px; background: transparent; color: #0369a1; display: grid; place-items: center; padding: 0; cursor: pointer; font-size: 28px; margin: 0; transition: background 0.2s ease; font-weight: 500; line-height: 1;";

    closeButton.addEventListener("click", () => closeForm({ userDismissedForm: true }));

    headerControls.appendChild(closeButton);

    // Keep Latin "X" if DOM translation (or re-renders) try to script-localize the glyph.
    const ensureCloseButtonIsX = () => {
        if (closeButton && closeButton.textContent !== "X") {
            closeButton.textContent = "X";
            closeButton.style.setProperty("font-weight", "500", "important");
            closeButton.style.setProperty("line-height", "1", "important");
            closeButton.style.setProperty("font-size", "28px", "important");
        }
    };

    // Check every 500ms to ensure close button stays as ×
    setInterval(ensureCloseButtonIsX, 500);
}

function createAndMountMessenger() {
    if (botWritingDotsTimerId !== null) {
        window.clearInterval(botWritingDotsTimerId);
        botWritingDotsTimerId = null;
    }
    botWritingDotsPhase = 0;
    botWritingDotsWasTyping = false;
    if (closeIconXIntervalId) {
        window.clearInterval(closeIconXIntervalId);
        closeIconXIntervalId = null;
    }
    stopCloseXWhileChatOpenMonitor();
    const df = document.createElement("df-messenger");
    activeDfMessenger = df;
    const dialogflowConfig = COMMON_CONFIG.dialogflow || {};
    df.setAttribute("project-id", dialogflowConfig.projectId || "qabot01");
    df.setAttribute("location", dialogflowConfig.location || "us-central1");
    df.setAttribute("agent-id", dialogflowConfig.agentId || "05ce7add-9025-4534-990c-fd7a25dadde1");
    if (typeof dialogflowConfig.oauthClientId === "string" && dialogflowConfig.oauthClientId.trim()) {
        df.setAttribute("oauth-client-id", dialogflowConfig.oauthClientId.trim());
    }
    df.setAttribute("language-code", getChatLanguageCode(activeLanguage));
    df.setAttribute("max-query-length", "-1");
    df.setAttribute("url-allowlist", "*");
    df.setAttribute("storage-option", "none");

    const bubble = document.createElement("df-messenger-chat-bubble");
    activeBubbleNode = bubble;
    const headerConfig = COMMON_CONFIG.header || {};
    const chatIconUrl = headerConfig.chatIconUrl || "https://storage.googleapis.com/companybucket/Images/cat.png";
    const chatTitleIconUrl = headerConfig.chatTitleIconUrl || chatIconUrl;

    // Ensure bubble icon uses configured URL.
    df.setAttribute("chat-icon", chatIconUrl);
    df.setAttribute("chat-title-icon", chatTitleIconUrl);
    bubble.setAttribute("chat-icon", chatIconUrl);
    bubble.setAttribute("chat-title-icon", chatTitleIconUrl);
    bubble.setAttribute("chat-title", headerConfig.title || "Chat Support");
    bubble.setAttribute("chat-subtitle", headerConfig.subtitle || "🟢 Online");
    {
        const collapseUrl = (typeof headerConfig.chatCollapseIconUrl === "string" && headerConfig.chatCollapseIconUrl.trim())
            ? headerConfig.chatCollapseIconUrl.trim()
            : CHAT_COLLAPSE_X_ICON_DATA_URL;
        try {
            bubble.setAttribute("chat-collapse-icon", collapseUrl);
        } catch (e) {
            /* no-op */
        }
    }

    const m0 = isMobileViewport();
    const devWin0 = getDeviceSection(COMPANY_UI_CONFIG, m0);
    const dWin0 = devWin0.chatWindow && typeof devWin0.chatWindow === "object" ? devWin0.chatWindow : {};
    const raw0 = dWin0 && typeof dWin0.bubblePosition === "object" ? dWin0.bubblePosition : {};
    const side0 = resolveChatLayoutSide(COMPANY_UI_CONFIG);
    const bpos0 = coalesceBubblePositionForChatSide(
        raw0,
        side0,
        m0
            ? { leftPx: 12, rightPx: 12, bottomPx: 10, topPx: null }
            : { leftPx: 20, rightPx: 20, bottomPx: 20, topPx: null }
    );
    const anchor0 = resolveMessengerBubbleAnchor(side0, bpos0);
    applyDfMessengerBubbleAnchorString(bubble, anchor0);

    initializeMessengerReadyState(df, bubble);
    df.appendChild(bubble);
    applyBotWritingTextToChatBubble(bubble);
    scheduleChatInputPlaceholderRefresh(df);
    document.body.appendChild(df);

    restartBotWritingDotsTimer();

    applyDfMessengerThemeConfig(df, COMPANY_UI_CONFIG);
    applyBotPersonaToMessenger(df, bubble);
    scheduleChatBubbleLauncherCircleStyle(df);
    ensureCircularBubbleIcon(df);
    startBubbleVisibilityWatcher(df);
    [200, 500, 1200, 2500, 4000].forEach((ms) => {
        window.setTimeout(() => {
            if (activeDfMessenger !== df) {
                return;
            }
            ensureBubbleVisible(df);
            applyChatBubbleLauncherCircleStyle(df);
        }, ms);
    });
    if (IS_FORCE_TITLEBAR_CLOSE_X_ENABLED) {
        ensureCloseIconIsX(df);
    }
    const isMobile = isMobileViewport();
    const devAuto = getDeviceSection(COMPANY_UI_CONFIG, isMobile);
    const autoOpenConfig = devAuto.autoOpenChat && typeof devAuto.autoOpenChat === "object" ? devAuto.autoOpenChat : null;
    if (isDeviceShowChatbotEnabled(COMPANY_UI_CONFIG)
        && (!autoOpenConfig || isFeatureEnabledFromConfig(autoOpenConfig, true))) {
        const delayMs = autoOpenConfig && typeof autoOpenConfig.delayMs === "number" && Number.isFinite(autoOpenConfig.delayMs)
            ? autoOpenConfig.delayMs
            : 5000;
        autoOpenChatWindow(df, bubble, delayMs);
    }

    initializeLauncherStrip(df, bubble, COMPANY_UI_CONFIG);
    initializeLauncherInputStrip(df, bubble, COMPANY_UI_CONFIG);
    ensureLauncherStripsResizeListener();
    scheduleLauncherStripsStackSync(df);
    initializeMobileChatLayout(df, COMPANY_UI_CONFIG);
    initializeChatStateSync(df);
    attachPersonaHandlers(df);
    // Lightbox is handled via a global click handler (shadow-DOM safe composedPath checks).
    ensureChatActionBar();
    ensurePoweredByStrip();
    scheduleUserInputVerticalNudge(df);
    scheduleFooterInputBoxShadowOverrides(df);
    ensureComposerSpeechMicResizeObserver();
    scheduleComposerSpeechMicAttach(df);
    scheduleChatMessageListScrollbarReapply(df);
    // Message list shadow often mounts *after* df-messenger-loaded / first reapplies; re-inject pane radius when panel opens and on short delays (MO on df-messenger may not see inner shadow mutations).
    window.addEventListener("df-chat-open-changed", () => {
        if (activeDfMessenger !== df) {
            return;
        }
        scheduleChatMessageListScrollbarReapply(df);
        scheduleComposerSpeechMicAttach(df);
        [50, 200, 500, 1200].forEach((ms) => {
            window.setTimeout(() => {
                if (activeDfMessenger === df) {
                    scheduleChatMessageListScrollbarReapply(df);
                    scheduleComposerSpeechMicAttach(df);
                }
            }, ms);
        });
    });
    scheduleSyncChatActionBarPosition();
    window.setTimeout(scheduleSyncChatActionBarPosition, 120);
    applyDeviceChatbotVisibility(COMPANY_UI_CONFIG, df);
    startPersonaDecorator(df);

    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `df-messenger mounted: true`,
        `multiLanguage enabled: ${isMultiLanguageEnabled()}`,
        `restart enabled: ${isRestartChatEnabled()}`,
        `activeLanguage: ${activeLanguage}`
    ]);

    return { messenger: df, bubble };
}

function initializeFooterOverlayControls(dfMessenger, commonConfig) {
    if (!dfMessenger) {
        return;
    }

    const features = commonConfig && commonConfig.features && typeof commonConfig.features === "object"
        ? commonConfig.features
        : {};
    const restartConfig = features.restartChat && typeof features.restartChat === "object"
        ? features.restartChat
        : null;

    if (!isMultiLanguageEnabled() && !isRestartChatEnabled()) {
        return;
    }

    const ensure = () => {
        mountFooterOverlayControls(restartConfig, isRestartChatEnabled());
        updateFooterOverlayVisibility(dfMessenger);
        updateFooterOverlayPosition(dfMessenger);
    };

    ensure();
    window.addEventListener("df-chat-open-changed", () => {
        window.setTimeout(ensure, 180);
    });
    window.addEventListener("resize", ensure);
    window.setInterval(ensure, 1200);

    // Track expand/collapse reliably (avoids cases where open event is missed).
    try {
        const observer = new MutationObserver(() => ensure());
        observer.observe(dfMessenger, { attributes: true, attributeFilter: ["expand"] });
    } catch {
        // ignore
    }

    if (!footerOverlayHealTimer) {
        footerOverlayHealTimer = window.setInterval(() => {
            if (!document.getElementById(FOOTER_OVERLAY_ID)) {
                footerOverlayMounted = false;
                ensure();
            }
        }, 2000);
    }
}

function ensureGlobalFooterOverlayControls() {
    // Mount overlay controls even before df-messenger exists.
    const features = COMMON_CONFIG && COMMON_CONFIG.features && typeof COMMON_CONFIG.features === "object"
        ? COMMON_CONFIG.features
        : {};
    const restartConfig = features.restartChat && typeof features.restartChat === "object"
        ? features.restartChat
        : null;

    if (!isMultiLanguageEnabled() && !isRestartChatEnabled()) {
        return;
    }

    mountFooterOverlayControls(restartConfig, isRestartChatEnabled());
    updateFooterOverlayVisibility(activeDfMessenger);
    updateFooterOverlayPosition(activeDfMessenger);
}

function mountFooterOverlayControls(restartConfig, restartEnabled) {

    let overlay = document.getElementById(FOOTER_OVERLAY_ID);
    if (overlay) {
        footerOverlayMounted = true;
        return;
    }

    overlay = document.createElement("div");
    overlay.id = FOOTER_OVERLAY_ID;
    overlay.style.setProperty("position", "fixed", "important");
    overlay.style.setProperty("z-index", "2147483646", "important");
    overlay.style.setProperty("display", "inline-flex", "important");
    overlay.style.setProperty("visibility", "visible", "important");
    overlay.style.setProperty("opacity", "1", "important");
    overlay.style.setProperty("pointer-events", "auto", "important");
    overlay.style.alignItems = "center";
    overlay.style.gap = "8px";
    // Visually blend into the existing footer instead of looking like a floating chip.
    overlay.style.padding = "0";
    overlay.style.borderRadius = "0";
    overlay.style.background = "transparent";
    overlay.style.border = "0";
    overlay.style.boxShadow = "none";
    overlay.style.backdropFilter = "none";
    overlay.style.pointerEvents = "auto";
    // Start hidden + positioned once chat is open.
    overlay.style.setProperty("left", "16px", "important");
    overlay.style.setProperty("top", "16px", "important");
    overlay.style.setProperty("right", "auto", "important");
    overlay.style.setProperty("bottom", "auto", "important");
    overlay.style.setProperty("background", "rgba(255,255,255,0.92)", "important");
    overlay.style.setProperty("border", "2px solid rgba(20,184,166,0.55)", "important");
    overlay.style.setProperty("border-radius", "12px", "important");
    overlay.style.setProperty("padding", "6px", "important");

    const makeIconButton = (ariaLabel, title) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", ariaLabel);
        button.title = title;
        button.style.border = "1px solid rgba(203, 213, 225, 0.9)";
        button.style.borderRadius = "10px";
        button.style.background = "rgba(255,255,255,0.92)";
        button.style.padding = "0";
        button.style.width = "34px";
        button.style.height = "34px";
        button.style.cursor = "pointer";
        button.style.display = "grid";
        button.style.placeItems = "center";
        button.style.pointerEvents = "auto";
        button.style.color = "#0369a1";
        button.addEventListener("mouseenter", () => {
            button.style.background = "#ffffff";
        });
        button.addEventListener("mouseleave", () => {
            button.style.background = "rgba(255,255,255,0.92)";
        });
        return button;
    };

    if (isMultiLanguageEnabled()) {
        const languageButton = makeIconButton(getTranslation("languageLabel"), getTranslation("languageLabel"));
        languageButton.textContent = "L";
        languageButton.innerHTML =
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='22' height='22' fill='none' aria-hidden='true'>" +
            "<path d='M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z' stroke='%230369a1' stroke-width='2'/>" +
            "<path d='M2 12h20' stroke='%230369a1' stroke-width='2'/>" +
            "<path d='M12 2c3.5 3 3.5 17 0 20' stroke='%230369a1' stroke-width='2'/>" +
            "<path d='M12 2c-3.5 3-3.5 17 0 20' stroke='%230369a1' stroke-width='2'/>" +
            "</svg>";

        const menu = document.createElement("div");
        menu.setAttribute("data-dfchat-language-menu", "true");
        menu.style.position = "absolute";
        menu.style.right = "0";
        menu.style.bottom = "44px";
        menu.style.display = "none";
        menu.style.minWidth = "150px";
        menu.style.padding = "6px";
        menu.style.borderRadius = "12px";
        menu.style.background = "#ffffff";
        menu.style.border = "1px solid rgba(203, 213, 225, 0.9)";
        menu.style.boxShadow = "0 14px 28px rgba(15,23,42,0.18)";

        const buildMenuItem = (optionData) => {
            const item = document.createElement("button");
            item.type = "button";
            item.textContent = getLanguageOptionDisplayLabel(optionData);
            item.style.width = "100%";
            item.style.textAlign = "left";
            item.style.border = "0";
            item.style.background = "transparent";
            item.style.padding = "8px 10px";
            item.style.borderRadius = "10px";
            item.style.cursor = "pointer";
            item.style.font = "600 12px Manrope, Segoe UI, sans-serif";
            item.style.color = normalizeLanguage(optionData.code) === activeLanguage ? "#0369a1" : "#0f172a";
            item.addEventListener("click", () => {
                menu.style.display = "none";
                applyLanguage(optionData.code);
            });
            item.addEventListener("mouseenter", () => {
                item.style.background = "rgba(15, 118, 110, 0.08)";
            });
            item.addEventListener("mouseleave", () => {
                item.style.background = "transparent";
            });
            return item;
        };

        for (const optionData of CHAT_LANGUAGE_OPTIONS) {
            menu.appendChild(buildMenuItem(optionData));
        }

        overlay.style.userSelect = "none";
        overlay.style.isolation = "isolate";
        overlay.style.contain = "layout style paint";
        overlay.style.touchAction = "manipulation";

        // Use a relative wrapper for menu positioning.
        const langWrapper = document.createElement("div");
        langWrapper.style.position = "relative";
        langWrapper.style.width = "34px";
        langWrapper.style.height = "34px";
        langWrapper.appendChild(languageButton);
        langWrapper.appendChild(menu);

        const toggleMenu = () => {
            menu.style.display = menu.style.display === "none" ? "block" : "none";
        };
        languageButton.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleMenu();
        });

        document.addEventListener("click", () => {
            menu.style.display = "none";
        }, false);

        overlay.appendChild(langWrapper);
    }

    if (restartEnabled) {
        const button = makeIconButton("Restart", "Restart");
        button.setAttribute("data-dfchat-no-translate", "true");
        button.innerHTML = getRestartIconHtml(22);
        button.addEventListener("click", () => restartChatSession());
        overlay.appendChild(button);
    }

    document.body.appendChild(overlay);
    footerOverlayMounted = true;
    updateFooterOverlayVisibility(activeDfMessenger);

    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `overlay mounted: true`,
        `overlay languages: ${isMultiLanguageEnabled()}`,
        `overlay restart: ${restartEnabled}`
    ]);
}

function updateFooterOverlayVisibility(dfMessenger) {
    const overlay = document.getElementById(FOOTER_OVERLAY_ID);
    if (!overlay) {
        return;
    }

    // Always visible. (We position it near the footer continuously.)
    overlay.style.display = "inline-flex";
    footerOverlayLastPos.visible = true;
}

function updateFooterOverlayPosition(dfMessenger) {
    const overlay = document.getElementById(FOOTER_OVERLAY_ID);
    if (!overlay) {
        return;
    }

    const messenger = dfMessenger || activeDfMessenger || document.querySelector("df-messenger");
    if (!messenger) {
        return;
    }

    const footerHost = resolveFooterMountHost(messenger);
    const anchorRect = footerHost && typeof footerHost.getBoundingClientRect === "function"
        ? footerHost.getBoundingClientRect()
        : messenger.getBoundingClientRect();

    if (!anchorRect || !Number.isFinite(anchorRect.right) || !Number.isFinite(anchorRect.bottom)) {
        return;
    }

    // Anchor near the composer row (bottom-left of chat window).
    const left = Math.max(10, Math.min(window.innerWidth - 10, Math.round(anchorRect.left + 12)));
    const bottom = Math.max(72, Math.min(window.innerHeight - 18, Math.round(window.innerHeight - anchorRect.bottom + 74)));

    // Avoid jitter: only update if changed meaningfully.
    if (footerOverlayLastPos.left !== left) {
        overlay.style.left = `${left}px`;
        footerOverlayLastPos.left = left;
    }
    if (footerOverlayLastPos.bottom !== bottom) {
        overlay.style.bottom = `${bottom}px`;
        footerOverlayLastPos.bottom = bottom;
    }

    overlay.style.right = "";
    overlay.style.top = "";
}

/**
 * Page-level CSS does not apply to `#dfchat-chat-action-bar` once it is moved under `df-messenger` shadow.
 * Inject rules on the bar itself so Language / Restart pills stay white with correct hover.
 */
function ensureChatActionBarEncapsulatedSkin(bar) {
    if (!bar || bar.querySelector("style[data-dfchat-action-bar-skin]")) {
        return;
    }
    const skin = document.createElement("style");
    skin.setAttribute("data-dfchat-action-bar-skin", "true");
    skin.textContent = ""
        + "#dfchat-chat-action-bar .dfchat-chat-action-pill,\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-icon.dfchat-chat-action-pill {\n"
        + "  background-color: #ffffff !important;\n"
        + "  color: #0f172a !important;\n"
        + "  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06) !important;\n"
        + "  border: none !important;\n"
        + "  -webkit-appearance: none;\n"
        + "  appearance: none;\n"
        + "}\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-pill:hover,\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-icon.dfchat-chat-action-pill:hover {\n"
        + "  background-color: #f8fafc !important;\n"
        + "}\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-pill:active,\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-icon.dfchat-chat-action-pill:active {\n"
        + "  background-color: #f1f5f9 !important;\n"
        + "}\n"
        + "#dfchat-chat-action-bar .dfchat-chat-action-pill__icon {\n"
        + "  color: #0369a1 !important;\n"
        + "}\n";
    bar.insertBefore(skin, bar.firstChild);
}

function ensureChatActionBar() {
    // Hide legacy overlay if present.
    const legacyOverlay = document.getElementById(FOOTER_OVERLAY_ID);
    if (legacyOverlay) {
        legacyOverlay.style.display = "none";
    }

    if (!isMultiLanguageEnabled() && !isRestartChatEnabled()) {
        const strip = getChatActionBar();
        if (strip) {
            strip.remove();
        }
        resetChatActionBarPositionCaches();
        return;
    }

    let bar = getChatActionBar();
    if (bar) {
        const wantLang = isMultiLanguageEnabled();
        const wantRestart = isRestartChatEnabled();
        const hasLang = !!bar.querySelector("[data-dfchat-lang-pill]");
        const hasRestart = !!bar.querySelector("[data-dfchat-restart-pill], button[data-i18n-aria-label=\"restartButtonLabel\"]");
        if (wantLang !== hasLang || wantRestart !== hasRestart) {
            try {
                bar.remove();
            } catch {
                /* no-op */
            }
            resetChatActionBarPositionCaches();
            bar = null;
        }
    }

    if (bar) {
        try {
            bar.setAttribute("data-dfchat-no-translate", "true");
        } catch {
            /* no-op */
        }
        ensureChatActionBarEncapsulatedSkin(bar);
        refreshChatActionBarLanguageState(bar);
        syncChatActionBarPosition();
        return;
    }

    resetChatActionBarPositionCaches();
    bar = document.createElement("div");
    bar.id = CHAT_ACTION_BAR_ID;
    bar.className = "dfchat-chat-action-bar";
    // Skip Google `applyDomTranslation` here — it overwrote the language *name* and broke menu `data-active` matching.
    bar.setAttribute("data-dfchat-no-translate", "true");
    // Hidden until mounted inline in footer row.
    bar.style.position = "static";
    bar.style.zIndex = "2147483647";
    bar.style.display = "none";
    bar.style.alignItems = "center";
    bar.style.gap = "8px";
    bar.style.pointerEvents = "auto";

    ensureChatActionBarEncapsulatedSkin(bar);

    if (isMultiLanguageEnabled()) {
        const langWrapper = document.createElement("div");
        langWrapper.className = "dfchat-chat-action-menu-wrapper";
        langWrapper.style.position = "relative";

        const languageButton = document.createElement("button");
        languageButton.type = "button";
        languageButton.className = "dfchat-chat-action-icon dfchat-chat-action-pill";
        languageButton.setAttribute("data-dfchat-lang-pill", "true");
        applyChatActionButtonStyles(languageButton);
        const languageIcon = document.createElement("span");
        languageIcon.className = "dfchat-chat-action-pill__icon";
        languageIcon.setAttribute("aria-hidden", "true");
        languageIcon.innerHTML =
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='20' height='20' fill='none'>" +
            "<path d='M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z' stroke='currentColor' stroke-width='2'/>" +
            "<path d='M2 12h20' stroke='currentColor' stroke-width='2'/>" +
            "<path d='M12 2c3.5 3 3.5 17 0 20' stroke='currentColor' stroke-width='2'/>" +
            "<path d='M12 2c-3.5 3-3.5 17 0 20' stroke='currentColor' stroke-width='2'/>" +
            "</svg>";
        const languageText = document.createElement("span");
        languageText.className = "dfchat-chat-action-pill__text";
        languageText.id = "dfchat-active-lang-label";
        languageText.setAttribute("data-dfchat-active-lang-label", "true");
        languageText.setAttribute("data-dfchat-no-translate", "true");
        languageText.textContent = getActiveChatLanguageDisplayLabel();
        languageButton.appendChild(languageIcon);
        languageButton.appendChild(languageText);
        {
            const name = getActiveChatLanguageDisplayLabel();
            const hint = getTranslation("languageLabel");
            languageButton.setAttribute("aria-label", `${hint}: ${name}`);
            languageButton.title = `${hint}: ${name}`;
        }

        const languageMenu = document.createElement("div");
        languageMenu.className = "dfchat-chat-action-menu";
        languageMenu.style.display = "none";
        languageMenu.style.position = "absolute";
        languageMenu.style.left = "0";
        languageMenu.style.right = "auto";
        languageMenu.style.bottom = "42px";
        languageMenu.style.minWidth = "148px";
        languageMenu.style.padding = "6px";
        languageMenu.style.border = "1px solid rgba(203, 213, 225, 0.95)";
        languageMenu.style.borderRadius = "12px";
        languageMenu.style.background = "#ffffff";
        languageMenu.style.boxShadow = "0 12px 28px rgba(15, 23, 42, 0.18)";
        languageMenu.style.zIndex = "2147483647";

        const buildLanguageMenu = () => {
            languageMenu.innerHTML = "";
            for (const optionData of CHAT_LANGUAGE_OPTIONS) {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.className = "dfchat-chat-action-menu-item";
                optionButton.dataset.dfchatLangCode = resolveToSupportedLanguageCode(optionData.code);
                optionButton.textContent = getLanguageOptionDisplayLabel(optionData);
                optionButton.style.width = "100%";
                optionButton.style.textAlign = "left";
                optionButton.style.border = "0";
                optionButton.style.background = "transparent";
                optionButton.style.color = "#0f172a";
                optionButton.style.borderRadius = "10px";
                optionButton.style.padding = "8px 10px";
                optionButton.style.font = "600 12px Manrope, Segoe UI, sans-serif";
                optionButton.style.cursor = "pointer";
                if (normalizeLanguage(optionData.code) === activeLanguage) {
                    optionButton.dataset.active = "true";
                    optionButton.style.color = "#0369a1";
                }
                optionButton.addEventListener("click", () => {
                    applyLanguage(optionData.code);
                    languageMenu.style.display = "none";
                    buildLanguageMenu();
                });
                optionButton.addEventListener("mouseenter", () => {
                    optionButton.style.background = "rgba(15, 118, 110, 0.08)";
                });
                optionButton.addEventListener("mouseleave", () => {
                    optionButton.style.background = "transparent";
                });
                languageMenu.appendChild(optionButton);
            }
        };
        buildLanguageMenu();

        languageButton.addEventListener("click", (event) => {
            event.stopPropagation();
            languageMenu.style.display = languageMenu.style.display === "none" ? "block" : "none";
        });

        langWrapper.appendChild(languageButton);
        langWrapper.appendChild(languageMenu);
        bar.appendChild(langWrapper);

        document.addEventListener("click", () => {
            languageMenu.style.display = "none";
        }, false);
    }

    if (isRestartChatEnabled()) {
        const restartButton = document.createElement("button");
        restartButton.type = "button";
        restartButton.className = "dfchat-chat-action-icon dfchat-chat-action-pill";
        restartButton.setAttribute("data-dfchat-restart-pill", "true");
        restartButton.setAttribute("data-i18n-aria-label", "restartButtonLabel");
        restartButton.setAttribute("aria-label", getTranslation("restartButtonLabel"));
        restartButton.title = getTranslation("restartButtonLabel");
        applyChatActionButtonStyles(restartButton);
        const restartIcon = document.createElement("span");
        restartIcon.className = "dfchat-chat-action-pill__icon";
        restartIcon.setAttribute("aria-hidden", "true");
        restartIcon.innerHTML = getRestartIconHtml(20);
        const restartText = document.createElement("span");
        restartText.className = "dfchat-chat-action-pill__text";
        restartText.setAttribute("data-i18n", "restartButtonLabel");
        restartText.textContent = getTranslation("restartButtonLabel");
        restartButton.appendChild(restartIcon);
        restartButton.appendChild(restartText);
        restartButton.addEventListener("click", () => restartChatSession());
        bar.appendChild(restartButton);
    }

    document.body.appendChild(bar);

    if (bar.dataset.companyMounted !== "true") {
        bar.dataset.companyMounted = "true";
        window.addEventListener("df-chat-open-changed", () => {
            resetChatActionBarPositionCaches();
            window.setTimeout(scheduleSyncChatActionBarPosition, 120);
        });
        // Resize / viewport: reset caches (width + anchor insets can change a lot). Do **not** reset on scroll
        // — that cleared stabilization every frame and made Language/Restart “blink” while the user scrolled.
        const onActionBarLayoutResize = () => {
            resetChatActionBarPositionCaches();
            scheduleSyncChatActionBarPosition();
        };
        const onActionBarLayoutScroll = () => {
            throttledSyncChatActionBarFromUserScroll();
        };
        window.addEventListener("resize", onActionBarLayoutResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", onActionBarLayoutResize);
        }
        // Page or nested scroll: Send row moves in viewport; re-sync `position:fixed` Language / Restart / Powered by.
        // (`visualViewport` scroll is wired in `initializeMobileChatLayout` to avoid clobbering the panel on keyboard.)
        window.addEventListener("scroll", onActionBarLayoutScroll, { passive: true, capture: true });
        document.addEventListener("scroll", onActionBarLayoutScroll, { passive: true, capture: true });
    }
}

function applyChatActionButtonStyles(button) {
    if (!button) {
        return;
    }
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.gap = "6px";
    button.style.minHeight = "0";
    button.style.height = "auto";
    button.style.minWidth = "0";
    button.style.width = "auto";
    button.style.maxWidth = "220px";
    button.style.boxSizing = "border-box";
    button.style.borderRadius = "10px";
    button.style.border = "none";
    button.style.cursor = "pointer";
    button.style.padding = "0 12px";
    button.style.userSelect = "none";
    button.style.setProperty("font-weight", "700", "important");
    button.style.setProperty("background-color", "#ffffff", "important");
    button.style.setProperty("color", "#0f172a", "important");
    button.style.setProperty("box-shadow", "0 1px 2px rgba(15, 23, 42, 0.06)", "important");
}

function refreshChatActionBarLanguageState(bar) {
    if (!bar || !bar.querySelectorAll) {
        return;
    }
    const pillBtn = bar.querySelector("button[data-dfchat-lang-pill]");
    if (pillBtn) {
        const name = getActiveChatLanguageDisplayLabel();
        const hint = getTranslation("languageLabel");
        pillBtn.setAttribute("aria-label", `${hint}: ${name}`);
        pillBtn.title = `${hint}: ${name}`;
        const labelSpan = bar.querySelector("#dfchat-active-lang-label, [data-dfchat-active-lang-label]")
            || pillBtn.querySelector(".dfchat-chat-action-pill__text");
        if (labelSpan) {
            labelSpan.textContent = name;
        }
    }
    const menuItems = bar.querySelectorAll(".dfchat-chat-action-menu-item");
    for (const item of menuItems) {
        if (!item) {
            continue;
        }
        const fromData = item.dataset && item.dataset.dfchatLangCode
            ? resolveToSupportedLanguageCode(item.dataset.dfchatLangCode)
            : null;
        const isActive = fromData
            ? fromData === activeLanguage
            : (() => {
                const match = CHAT_LANGUAGE_OPTIONS.find((option) => {
                    return getLanguageOptionDisplayLabel(option) === item.textContent
                        || (typeof option.label === "string" && option.label === item.textContent);
                });
                return !!(match && resolveToSupportedLanguageCode(match.code) === activeLanguage);
            })();
        if (isActive) {
            item.dataset.active = "true";
        } else {
            item.removeAttribute("data-active");
        }
    }
}

/**
 * Inline action bar lives in the composer; only `transform: translateY` moves it — `footerActionBar.nudgeUpPx`
 * must be applied here (page CSS alone could not see shadow, and the fixed `top` math never runs on this path).
 * Same sign as fixed: **larger positive** `nudgeUpPx` moves the bar **up** (more negative translateY).
 */
function applyChatActionBarInlineTransform(bar) {
    if (!bar) {
        return;
    }
    const nu = FOOTER_ACTION_BAR_LAYOUT.nudgeUpPx;
    const nudge = typeof nu === "number" && Number.isFinite(nu) ? nu : 0;
    const totalUpPx = Math.max(
        0,
        CHAT_ACTION_BAR_INLINE_BASE_UP_PX
            + CHAT_ACTION_BAR_EXTRA_NUDGE_UP_PX
            + nudge
            - CHAT_ACTION_BAR_GLOBAL_DOWN_PX
    );
    const rx = CHAT_ACTION_BAR_GLOBAL_RIGHT_PX;
    try {
        bar.style.setProperty("transform", `translate(${rx}px, -${totalUpPx}px)`, "important");
    } catch {
        bar.style.transform = `translate(${rx}px, -${totalUpPx}px)`;
    }
}

function syncChatActionBarPosition() {
    const bar = getChatActionBar();
    if (!bar) {
        return;
    }

    const messenger = activeDfMessenger || document.querySelector("df-messenger");
    if (!messenger) {
        bar.style.display = "none";
        bar.removeAttribute("data-dfchat-anchor");
        resetChatActionBarPositionCaches();
        return;
    }

    if (!isChatWindowOpen) {
        bar.style.display = "none";
        bar.removeAttribute("data-dfchat-anchor");
        resetChatActionBarPositionCaches();
        return;
    }

    // Prefer mounting *below* the type-your-message row (`.input-box-wrapper`); not beside Send (that sits inside the input strip).
    if (mountChatActionBarInline(messenger, bar)) {
        bar.classList.remove("dfchat-chat-action-bar--body-fixed");
        bar.setAttribute("data-dfchat-anchor", "below-input");
        bar.style.zIndex = "";
        refreshChatActionBarLanguageState(bar);
        bar.style.display = "inline-flex";
        applyChatActionBarInlineTransform(bar);
        return;
    }

    // Inline `transform: translateY(...)` (below) is `!important`; clear before fixed positioning.
    try {
        bar.style.removeProperty("transform");
    } catch {
        // ignore
    }

    const insertionPoint = findFooterInlineInsertionPoint(messenger);
    const targetRow = insertionPoint && insertionPoint.parent ? insertionPoint.parent : null;
    const footerHost = resolveFooterMountHost(messenger) || findChatFooterHost(messenger);

    const btnSize = 38;
    const padX = 6;
    const nudgeDownPx = FOOTER_ACTION_BAR_LAYOUT.nudgeDownPx;
    const nudgeLeftPx = FOOTER_ACTION_BAR_LAYOUT.nudgeLeftPx;
    const mFooterNudge = (() => {
        if (!isMobileViewport()) {
            return 0;
        }
        const m = getDeviceSection(readCompanyUiConfig(), true);
        const fb = m.footerActionBar && typeof m.footerActionBar === "object" ? m.footerActionBar : null;
        return fb && typeof fb.nudgeRightExtraPx === "number" && Number.isFinite(fb.nudgeRightExtraPx)
            ? fb.nudgeRightExtraPx
            : 0;
    })();
    const nudgeActionBarRightPx = FOOTER_ACTION_BAR_LAYOUT.nudgeRightPx
        + (isMobileViewport() ? MOBILE_FOOTER_ICONS_NUDGE_RIGHT_EXTRA_PX : 0)
        + mFooterNudge;
    const nudgeActionBarUpPx = FOOTER_ACTION_BAR_LAYOUT.nudgeUpPx + CHAT_ACTION_BAR_EXTRA_NUDGE_UP_PX;
    const gapBeforeSend = FOOTER_ACTION_BAR_LAYOUT.gapBeforeSendPx;

    let left;
    let top;
    let anchoredToSend = false;

    let sendButton = null;
    if (insertionPoint && insertionPoint.beforeNode) {
        const bn = insertionPoint.beforeNode;
        if (bn && typeof bn.getBoundingClientRect === "function") {
            sendButton = bn;
        }
    }
    if (!sendButton && footerHost) {
        sendButton = findSendButton(footerHost);
    }

    if (sendButton) {
        const s = sendButton.getBoundingClientRect();
        if (s && s.width > 0 && s.height > 0) {
            const wMeas = bar.offsetWidth > 0 ? bar.offsetWidth : 0;
            if (wMeas > 0) {
                const prevW = chatActionBarSendWidthCache || 0;
                if (!prevW) {
                    chatActionBarSendWidthCache = wMeas;
                } else if (wMeas > prevW) {
                    chatActionBarSendWidthCache = wMeas;
                } else if (prevW - wMeas > 8) {
                    chatActionBarSendWidthCache = wMeas;
                }
            }
            const estBarW = chatActionBarSendWidthCache > 0 ? chatActionBarSendWidthCache : 260;
            const curSendLeft = Math.round(s.left);
            if (chatActionBarSendLeftSnap == null || Math.abs(curSendLeft - chatActionBarSendLeftSnap) >= 4) {
                chatActionBarSendLeftSnap = curSendLeft;
            }
            // Anchor from snapped Send X + max width so flex/label reflow cannot rock the bar left-right.
            left = Math.max(4, chatActionBarSendLeftSnap - Math.round(estBarW) - gapBeforeSend);
            // Vertical: center on the full composer row when we have it (taller than Send), else center on Send.
            let vCenterY = s.top + (s.height - btnSize) / 2;
            if (targetRow && typeof targetRow.getBoundingClientRect === "function") {
                const rowR = targetRow.getBoundingClientRect();
                if (rowR && rowR.height > 0) {
                    vCenterY = rowR.top + (rowR.height - btnSize) / 2;
                }
            }
            top = Math.max(4, Math.round(vCenterY) + nudgeDownPx);
            anchoredToSend = true;
        }
    }

    if (!anchoredToSend) {
        let anchorRect = null;
        let mode = "window";

        if (targetRow && typeof targetRow.getBoundingClientRect === "function") {
            const r = targetRow.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
                anchorRect = r;
                mode = "row";
            }
        }
        if (!anchorRect && footerHost && typeof footerHost.getBoundingClientRect === "function") {
            const r2 = footerHost.getBoundingClientRect();
            if (r2 && r2.width > 0 && r2.height > 0) {
                anchorRect = r2;
                mode = "footer";
            }
        }
        if (!anchorRect) {
            anchorRect = findChatWindowRect(messenger);
            mode = "window";
        }
        if (!anchorRect && typeof messenger.getBoundingClientRect === "function") {
            const r3 = messenger.getBoundingClientRect();
            if (r3 && r3.width > 0 && r3.height > 0) {
                anchorRect = r3;
                mode = "window";
            }
        }
        if (!anchorRect) {
            bar.style.display = "none";
            bar.removeAttribute("data-dfchat-anchor");
            chatActionBarFixedPos = null;
            chatActionBarStableTopPx = null;
            return;
        }

        if (mode === "row" || mode === "footer") {
            left = Math.max(4, Math.round(anchorRect.left + padX) - nudgeLeftPx);
            top = Math.max(4, Math.round(anchorRect.top + (anchorRect.height - btnSize) / 2) + nudgeDownPx);
        } else {
            left = Math.max(4, Math.round(anchorRect.left + 8) - nudgeLeftPx);
            top = Math.max(4, Math.round(anchorRect.bottom - 44) + nudgeDownPx);
        }
    }

    left = Math.max(4, left + nudgeActionBarRightPx + CHAT_ACTION_BAR_GLOBAL_RIGHT_PX);
    top = Math.max(4, top - nudgeActionBarUpPx + CHAT_ACTION_BAR_GLOBAL_DOWN_PX);

    const rowLockPx = FOOTER_ACTION_BAR_LAYOUT.lockVerticalWhenComposerRowTallerThanPx;
    if (rowLockPx > 0) {
        const rowEl = targetRow || (sendButton && sendButton.parentElement);
        if (rowEl && typeof rowEl.getBoundingClientRect === "function") {
            const rh = rowEl.getBoundingClientRect().height;
            if (rh >= 14 && rh <= rowLockPx) {
                chatActionBarStableTopPx = top;
            } else if (rh > rowLockPx && chatActionBarStableTopPx != null) {
                top = chatActionBarStableTopPx;
            }
        }
    }

    if (bar.parentElement !== document.body) {
        document.body.appendChild(bar);
    }

    const curStyleLeft = parseFloat(bar.style.left);
    if (Number.isFinite(curStyleLeft) && bar.style.left && String(bar.style.left).length > 0) {
        if (Math.abs(left - curStyleLeft) < ACTION_BAR_STYLE_H_DEADBAND_PX) {
            left = Math.round(curStyleLeft);
        }
    }

    // Separate X/Y so horizontal micro-jitter (send anchor + clamp) does not retrigger position updates every frame.
    const jitterEpsX = isMobileViewport() ? 64 : 56;
    const jitterEpsY = isMobileViewport() ? 16 : 12;
    if (chatActionBarFixedPos) {
        const closeEnough =
            Math.abs(left - chatActionBarFixedPos.left) < jitterEpsX
            && Math.abs(top - chatActionBarFixedPos.top) < jitterEpsY;
        if (closeEnough) {
            left = chatActionBarFixedPos.left;
            top = chatActionBarFixedPos.top;
        } else {
            chatActionBarFixedPos = { left, top };
        }
    } else {
        chatActionBarFixedPos = { left, top };
    }

    if (anchoredToSend) {
        bar.setAttribute("data-dfchat-anchor", "send");
    } else {
        bar.removeAttribute("data-dfchat-anchor");
    }

    bar.classList.remove("dfchat-chat-action-bar--inline");
    bar.classList.add("dfchat-chat-action-bar--body-fixed");
    bar.style.position = "fixed";
    const nextLeft = `${left}px`;
    const nextTop = `${top}px`;
    if (bar.style.left !== nextLeft) {
        bar.style.left = nextLeft;
    }
    if (bar.style.top !== nextTop) {
        bar.style.top = nextTop;
    }
    bar.style.right = "auto";
    bar.style.bottom = "auto";
    bar.style.zIndex = "2147483647";
    bar.style.display = "inline-flex";
    bar.style.alignItems = "center";
    bar.style.gap = "8px";
    bar.style.pointerEvents = "auto";
    bar.style.margin = "0";
    bar.style.order = "";
    if (bar.offsetWidth > 0) {
        const w = bar.offsetWidth;
        const prevW = chatActionBarSendWidthCache || 0;
        if (!prevW) {
            chatActionBarSendWidthCache = w;
        } else if (w > prevW) {
            chatActionBarSendWidthCache = w;
        } else if (prevW - w > 8) {
            chatActionBarSendWidthCache = w;
        }
    }
    clampChatActionBarInViewport(bar);
    if (bar.style.display !== "none" && bar.classList.contains("dfchat-chat-action-bar--body-fixed")) {
        const fl = Math.round(parseFloat(bar.style.left) || 0);
        const ft = Math.round(parseFloat(bar.style.top) || 0);
        if (Number.isFinite(fl) && Number.isFinite(ft)) {
            chatActionBarFixedPos = { left: fl, top: ft };
        }
    }
}

/**
 * Stable “viewport width” for horizontal clamp: `visualViewport.width` can tick ±1px and fight `getBoundingClientRect()`.
 * @returns {number}
 */
function resolveClampViewportWidthForActionBar() {
    const raw = window.visualViewport && Number.isFinite(window.visualViewport.width)
        ? window.visualViewport.width
        : window.innerWidth;
    const r = Math.max(1, Math.round(raw));
    if (!chatActionBarClampVwWCache || Math.abs(r - chatActionBarClampVwWCache) >= 4) {
        chatActionBarClampVwWCache = r;
    }
    return chatActionBarClampVwWCache;
}

/**
 * Nudge the fixed chat action bar (Language/Restart) so it stays in the visual viewport
 * (send-anchor width estimates can be too small, or nudges can push it past the right edge).
 * @param {HTMLElement} bar
 */
function clampChatActionBarInViewport(bar) {
    if (!bar || bar.style.display === "none") {
        return;
    }
    const br = bar.getBoundingClientRect();
    if (!br.width) {
        return;
    }
    const vwW = resolveClampViewportWidthForActionBar();
    const margin = 4;
    let curLeft = parseFloat(bar.style.left);
    if (!Number.isFinite(curLeft)) {
        curLeft = 0;
    }
    let dx = 0;
    if (br.right > vwW - margin) {
        dx = (vwW - margin) - br.right;
    }
    if (br.left + dx < margin) {
        dx = margin - br.left;
    }
    if (Math.abs(dx) < 2) {
        return;
    }
    const next = Math.round(curLeft + dx);
    bar.style.left = `${next}px`;
    if (chatActionBarFixedPos) {
        chatActionBarFixedPos = { left: next, top: chatActionBarFixedPos.top };
    }
}

function ensurePoweredByStrip() {
    if (!isPoweredByFeatureEnabled()) {
        return;
    }
    if (poweredByStripNode && document.getElementById(POWERED_BY_STRIP_ID)) {
        return;
    }
    const withLink = POWERED_BY_LINK_URL.length > 0;
    const el = withLink ? document.createElement("a") : document.createElement("div");
    el.id = POWERED_BY_STRIP_ID;
    el.setAttribute("data-dfchat-no-translate", "true");
    if (withLink) {
        el.href = POWERED_BY_LINK_URL;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        el.setAttribute("role", "link");
    } else {
        el.setAttribute("role", "note");
    }
    el.textContent = `${POWERED_BY_PREFIX}${POWERED_BY_VALUE}`.trim();
    el.style.display = "none";
    if (withLink) {
        el.style.textDecoration = "none";
    }
    applyPoweredByStripVisuals(el);
    document.body.appendChild(el);
    poweredByStripNode = el;
}

function applyPoweredByStripVisuals(el) {
    if (!el) {
        return;
    }
    const s = POWERED_BY_STYLE;
    el.style.setProperty("color", s.color, "important");
    el.style.setProperty("font-size", `${s.fontSizePx}px`, "important");
    el.style.setProperty("line-height", `${s.lineHeightPx}px`, "important");
    el.style.setProperty("text-align", s.textAlign, "important");
    if (POWERED_BY_LINK_URL && el instanceof HTMLAnchorElement) {
        el.style.setProperty("cursor", "pointer", "important");
    }
}

/**
 * Nudge a fixed "Powered by" strip so it stays inside the horizontal viewport
 * (after width: max-content and translateX centring).
 * @param {HTMLElement} el
 */
function clampPoweredByStripInViewport(el) {
    if (!el) {
        return;
    }
    if (el.style.display === "none") {
        return;
    }
    const br = el.getBoundingClientRect();
    if (!br.width) {
        return;
    }
    let dx = 0;
    const vwW = window.visualViewport && Number.isFinite(window.visualViewport.width)
        ? window.visualViewport.width
        : window.innerWidth;
    if (br.right > vwW - 4) {
        dx = (vwW - 4) - br.right;
    }
    if (br.left + dx < 4) {
        dx = 4 - br.left;
    }
    if (Math.abs(dx) < 0.25) {
        return;
    }
    const cur = parseFloat(el.style.left) || 0;
    if (!Number.isFinite(cur)) {
        return;
    }
    el.style.left = `${cur + dx}px`;
}

/**
 * @param {HTMLElement} el
 * @param {ReturnType<typeof readPoweredByStyleConfig>} L
 * @param {DOMRect} fr
 * @param {number} topPx
 */
function setPoweredByStripGeometry(el, L, fr, topPx) {
    const lineH = L.lineHeightPx;
    const nudgeRight = L.nudgeRightPx + (isMobileViewport() ? MOBILE_FOOTER_ICONS_NUDGE_RIGHT_EXTRA_PX : 0);
    const deltaLeft = L.offsetLeftPx + nudgeRight - L.nudgeLeftPx + POWERED_BY_STRIP_NUDGE_RIGHT_PX;
    const textAlign = L.textAlign || "center";
    const vwW = window.visualViewport && Number.isFinite(window.visualViewport.width)
        ? window.visualViewport.width
        : window.innerWidth;
    const wMax = Math.max(120, vwW - 8);
    el.style.position = "fixed";
    el.style.zIndex = "2147483642";
    el.style.top = `${Math.round(topPx + POWERED_BY_STRIP_NUDGE_DOWN_PX)}px`;
    el.style.bottom = "auto";
    el.style.setProperty("width", "max-content", "important");
    el.style.setProperty("max-width", `${wMax}px`, "important");
    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("white-space", "nowrap", "important");
    el.style.setProperty("min-height", `${lineH}px`, "important");
    el.style.removeProperty("height");
    el.style.setProperty("display", "block", "important");
    if (L.marginPx > 0) {
        el.style.setProperty("margin", `${L.marginPx}px`, "important");
    } else {
        el.style.removeProperty("margin");
    }
    el.style.removeProperty("padding");
    if (textAlign === "right") {
        el.style.left = `${Math.round(fr.left + fr.width) + deltaLeft}px`;
        el.style.setProperty("transform", "translateX(-100%)", "important");
    } else if (textAlign === "left") {
        el.style.left = `${Math.round(fr.left) + deltaLeft}px`;
        el.style.removeProperty("transform");
    } else {
        el.style.left = `${Math.round(fr.left + fr.width / 2) + deltaLeft}px`;
        el.style.setProperty("transform", "translateX(-50%)", "important");
    }
    window.requestAnimationFrame(() => {
        clampPoweredByStripInViewport(el);
    });
}

/**
 * Rect to anchor “Powered by” above the composer. Prefer `.input-box-wrapper` (stable while typing) over
 * the send-button row parent, whose `getBoundingClientRect()` can jump toward y≈0 on mobile reflow / keyboard.
 * @param {Element} dfMessenger
 * @returns {DOMRect | null}
 */
function getPoweredByComposerAnchorRect(dfMessenger) {
    if (!dfMessenger) {
        return null;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (!root || typeof root.querySelector !== "function") {
            continue;
        }
        const wrap = root.querySelector(".input-box-wrapper");
        if (wrap && !isNodeInsidePageContactForm(wrap) && typeof wrap.getBoundingClientRect === "function") {
            const r = wrap.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
                return r;
            }
        }
    }
    const insertion = findFooterInlineInsertionPoint(dfMessenger);
    const targetRow = insertion && insertion.parent ? insertion.parent : null;
    if (targetRow && typeof targetRow.getBoundingClientRect === "function") {
        const rowR = targetRow.getBoundingClientRect();
        if (rowR && rowR.width > 0 && rowR.height > 0) {
            return rowR;
        }
    }
    const footerHost = resolveFooterMountHost(dfMessenger) || findChatFooterHost(dfMessenger);
    if (footerHost && typeof footerHost.getBoundingClientRect === "function") {
        const r2 = footerHost.getBoundingClientRect();
        if (r2 && r2.width > 0 && r2.height > 0) {
            return r2;
        }
    }
    return null;
}

function syncPoweredByStripPosition() {
    if (!isPoweredByFeatureEnabled()) {
        if (poweredByStripNode) {
            poweredByStripNode.style.display = "none";
        }
        return;
    }
    const el = poweredByStripNode || document.getElementById(POWERED_BY_STRIP_ID);
    if (!el) {
        return;
    }
    const messenger = activeDfMessenger || document.querySelector("df-messenger");
    if (!messenger) {
        el.style.display = "none";
        return;
    }
    // Rely on `df-messenger#expand` / `.expand` as well as the custom event — some runtimes
    // omit or reshape `df-chat-open-changed`, which left `isChatWindowOpen` false and hid this strip.
    const chatShellOpen = isChatWindowOpen || isChatExpanded(messenger);
    if (!chatShellOpen) {
        el.style.display = "none";
        return;
    }
    applyPoweredByStripVisuals(el);
    const L = POWERED_BY_STYLE;
    const lineH = L.lineHeightPx;
    const deltaTop = L.offsetTopPx + L.nudgeDownPx - L.nudgeUpPx;
    const fr = getPoweredByComposerAnchorRect(messenger);
    if (fr) {
        const rawTop = Math.round(fr.top - lineH - L.gapAboveComposerPx) + deltaTop;
        const vv0 = window.visualViewport;
        const vhP = vv0 && Number.isFinite(vv0.height) ? vv0.height : window.innerHeight;
        // Row − lineH can be negative; keep the strip in the viewport. On mobile, Y must be clamped to the
        // *visual* viewport (keyboard) using offsetTop+height, not vhP alone, or the strip drifts.
        let top;
        if (isMobileViewport() && vv0 && Number.isFinite(vv0.height)) {
            const oTop = Number.isFinite(vv0.offsetTop) ? vv0.offsetTop : 0;
            const visBottomY = oTop + vv0.height;
            top = Math.max(
                oTop + 4,
                Math.min(rawTop, visBottomY - lineH - 4)
            );
        } else {
            top = Math.max(4, Math.min(rawTop, vhP - lineH - 4));
        }
        if (isMobileViewport()) {
            const winR = findChatWindowRect(messenger);
            if (winR && winR.height > 80) {
                // Typing can skew the anchor so the label shoots to the top; keep it in the lower ~2/3 of the chat card.
                const minTop = Math.round(winR.top + winR.height * 0.32);
                const maxTop = Math.round(winR.bottom - lineH - 4);
                if (minTop < maxTop) {
                    top = Math.min(maxTop, Math.max(top, minTop));
                }
            }
        }
        setPoweredByStripGeometry(el, L, fr, top);
        return;
    }
    const r = findChatWindowRect(messenger);
    if (!r || r.width < 80) {
        el.style.display = "none";
        return;
    }
    const rawTopFb = Math.round(r.bottom - lineH - L.fallbackGapFromWindowBottomPx) + deltaTop;
    const vh0 = window.visualViewport && Number.isFinite(window.visualViewport.height)
        ? window.visualViewport.height
        : window.innerHeight;
    const topClamped = Math.max(4, Math.min(rawTopFb, vh0 - lineH - 4));
    setPoweredByStripGeometry(el, L, r, topClamped);
}

function mountChatActionBarInline(messenger, bar) {
    const mp = findFooterBelowInputMountPoint(messenger);
    if (!mp || !mp.parent || !mp.afterEl) {
        return false;
    }
    const { parent, afterEl } = mp;
    if (typeof parent.insertBefore !== "function" || !parent.contains(afterEl)) {
        return false;
    }

    const sameSlot = bar.classList.contains("dfchat-chat-action-bar--inline")
        && bar.parentElement === parent
        && bar.previousElementSibling === afterEl;
    if (sameSlot) {
        bar.classList.remove("dfchat-chat-action-bar--body-fixed");
        bar.style.position = "static";
        bar.style.left = "";
        bar.style.right = "";
        bar.style.bottom = "";
        bar.style.top = "auto";
        bar.style.zIndex = "";
        return true;
    }

    const cs = window.getComputedStyle(parent);
    if (cs.display === "flex" && (cs.flexDirection === "row" || cs.flexDirection === "row-reverse")) {
        try {
            parent.style.flexDirection = "column";
            parent.style.alignItems = "stretch";
        } catch {
            /* no-op */
        }
    }

    bar.classList.add("dfchat-chat-action-bar--inline");
    bar.classList.remove("dfchat-chat-action-bar--body-fixed");
    bar.style.position = "static";
    bar.style.left = "";
    bar.style.right = "";
    bar.style.bottom = "";
    bar.style.top = "auto";
    bar.style.zIndex = "";
    bar.style.marginLeft = "0";
    bar.style.marginRight = "0";
    bar.style.display = "inline-flex";

    try {
        if (bar.parentNode === parent && bar.previousElementSibling === afterEl) {
            return true;
        }
        if (afterEl.nextSibling) {
            parent.insertBefore(bar, afterEl.nextSibling);
        } else {
            parent.appendChild(bar);
        }
    } catch {
        return false;
    }
    return true;
}

/**
 * @param {HTMLElement} stripElement
 */
function clearLauncherStripTypingTimers(stripElement) {
    if (!stripElement) {
        return;
    }
    if (Array.isArray(stripElement._companyLauncherTypingTimers)) {
        for (const id of stripElement._companyLauncherTypingTimers) {
            window.clearTimeout(id);
        }
    }
    stripElement._companyLauncherTypingTimers = null;
}

/**
 * @param {HTMLElement} stripElement
 */
function clearLauncherStripSwapTimer(stripElement) {
    if (!stripElement || typeof stripElement._companyLauncherSwapTimer !== "number") {
        return;
    }
    window.clearTimeout(stripElement._companyLauncherSwapTimer);
    stripElement._companyLauncherSwapTimer = null;
}

/**
 * Parses delay for launcher strip swap (allows numeric strings from tooling).
 * @param {unknown} raw
 * @returns {number}
 */
function readLauncherStripSwapDelayMs(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    if (typeof raw === "string" && raw.trim()) {
        const n = parseInt(raw.trim(), 10);
        if (Number.isFinite(n) && n > 0) {
            return n;
        }
    }
    return 0;
}

/**
 * After `swapTextDelayMs`, replaces typing text with `swapText`. Always reads **`window.COMPANY_CHAT_UI_CONFIG`**
 * at schedule time and when the timer fires (avoids stale `COMPANY_UI_CONFIG` / deploy skew). Desk + mob via `readLauncherStripConfig`.
 * @param {HTMLElement} stripElement
 */
function scheduleLauncherStripTextSwap(stripElement) {
    clearLauncherStripSwapTimer(stripElement);
    if (!stripElement) {
        return;
    }
    const stripConfig = readLauncherStripConfig(readCompanyUiConfig());
    if (!stripConfig || typeof stripConfig !== "object") {
        return;
    }
    const ms = readLauncherStripSwapDelayMs(stripConfig.swapTextDelayMs);
    if (ms <= 0) {
        return;
    }
    stripElement._companyLauncherSwapTimer = window.setTimeout(() => {
        stripElement._companyLauncherSwapTimer = null;
        if (!stripElement.isConnected) {
            return;
        }
        const cfg = readLauncherStripConfig(readCompanyUiConfig());
        const label = cfg && typeof cfg.swapText === "string" ? cfg.swapText.trim() : "";
        if (!label) {
            return;
        }
        clearLauncherStripTypingTimers(stripElement);
        stripElement.textContent = label;
        stripElement.setAttribute("aria-label", label);
    }, ms);
}

/**
 * Reveal `fullText` one word at a time; last word appears at `durationMs` (linear spacing).
 * @param {HTMLElement} stripElement
 * @param {string} fullText
 * @param {number} durationMs
 */
function startLauncherStripWordReveal(stripElement, fullText, durationMs) {
    if (!stripElement) {
        return;
    }
    clearLauncherStripTypingTimers(stripElement);
    const trimmed = (fullText || "").trim();
    if (!trimmed) {
        stripElement.textContent = "";
        return;
    }
    const words = trimmed.split(/\s+/).filter((w) => w.length);
    if (words.length === 0) {
        stripElement.textContent = "";
        return;
    }
    if (words.length === 1 || !Number.isFinite(durationMs) || durationMs <= 0) {
        stripElement.textContent = trimmed;
        return;
    }
    stripElement.textContent = "";
    const total = Math.max(1, Math.floor(durationMs));
    const n = words.length;
    /** @type {number[]} */
    const ids = [];
    for (let i = 0; i < n; i++) {
        const delay = n <= 1 ? 0 : (i * total) / (n - 1);
        const id = window.setTimeout(() => {
            stripElement.textContent = words.slice(0, i + 1).join(" ");
        }, delay);
        ids.push(id);
    }
    stripElement._companyLauncherTypingTimers = ids;
}

function readLauncherStripTypingDurationMs(stripConfig) {
    if (!stripConfig || typeof stripConfig !== "object") {
        return 2000;
    }
    const t = stripConfig.typingDurationMs;
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) {
        return t;
    }
    return 2000;
}

function initializeLauncherStrip(dfMessenger, bubbleNode, config) {
    const stripConfig = readLauncherStripConfig(config);

    if (!stripConfig || !isFeatureEnabledFromConfig(stripConfig, true)) {
        return;
    }

    const text = typeof stripConfig.text === "string" && stripConfig.text.trim()
        ? stripConfig.text.trim()
        : "Hey, there 👋";
    const typingDurationMs = readLauncherStripTypingDurationMs(stripConfig);

    const existing = document.getElementById("dfchat-chat-launcher-strip");
    if (existing) {
        existing.setAttribute("aria-label", text);
        clearLauncherStripTypingTimers(existing);
        clearLauncherStripSwapTimer(existing);
        existing.textContent = "";
        existing.style.display = isChatWindowOpen ? "none" : "block";
        applyLauncherStripPosition(existing, stripConfig);
        applyLauncherStripStyle(existing, stripConfig);
        startLauncherStripWordReveal(existing, text, typingDurationMs);
        scheduleLauncherStripTextSwap(existing);
        window.setTimeout(() => {
            scheduleLauncherStripsStackSync(dfMessenger);
        }, typingDurationMs + 150);
        return;
    }

    const strip = document.createElement("div");
    strip.id = "dfchat-chat-launcher-strip";
    strip.className = "dfchat-chat-launcher-strip";
    strip.setAttribute("role", "button");
    strip.setAttribute("tabindex", "0");
    strip.setAttribute("aria-label", text);
    strip.style.display = isChatWindowOpen ? "none" : "block";
    strip.style.pointerEvents = "auto";
    strip.style.cursor = "pointer";
    applyLauncherStripPosition(strip, stripConfig);
    applyLauncherStripStyle(strip, stripConfig);
    document.body.appendChild(strip);
    startLauncherStripWordReveal(strip, text, typingDurationMs);
    scheduleLauncherStripTextSwap(strip);

    const openChat = () => {
        openChatWindow(dfMessenger, bubbleNode);
    };

    strip.addEventListener("click", openChat);
    strip.addEventListener("keydown", (event) => {
        if (!event) {
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openChat();
        }
    });

    window.addEventListener("df-chat-open-changed", (event) => {
        const open = !!(event && event.detail && event.detail.isOpen);
        strip.style.display = open ? "none" : "block";
    });

    window.setTimeout(() => {
        scheduleLauncherStripsStackSync(dfMessenger);
    }, typingDurationMs + 150);
}

function readLauncherStripConfig(config) {
    const isMobile = isMobileViewport();
    const section = getDeviceSection(config, isMobile);
    if (!section || typeof section !== "object") {
        return null;
    }
    return section.launcherStrip && typeof section.launcherStrip === "object"
        ? section.launcherStrip
        : null;
}

function applyLauncherStripPosition(stripElement, stripConfig) {
    if (!stripElement || !stripConfig) {
        return;
    }

    const position = stripConfig.position && typeof stripConfig.position === "object"
        ? stripConfig.position
        : {};

    const applyPx = (cssProp, value) => {
        if (typeof value === "number" && Number.isFinite(value)) {
            stripElement.style[cssProp] = `${value}px`;
        } else if (value === null || typeof value === "undefined") {
            stripElement.style[cssProp] = "";
        }
    };

    applyPx("right", position.rightPx);
    applyPx("bottom", position.bottomPx);
    applyPx("left", position.leftPx);
    applyPx("top", position.topPx);

    // Same "left" / "right" as `common.chatLayout.side` (clears the opposite edge so fixed strip + chat line up).
    const layoutSide = resolveChatLayoutSide(readCompanyUiConfig());
    if (layoutSide === "right") {
        applyPx("left", null);
    } else {
        applyPx("right", null);
    }

    // If both left and right are set, center the text nicely.
    if (typeof position.leftPx === "number" && typeof position.rightPx === "number") {
        stripElement.style.textAlign = "center";
    } else {
        stripElement.style.textAlign = "";
    }
}

function applyLauncherStripStyle(stripElement, stripConfig) {
    if (!stripElement || !stripConfig) {
        return;
    }

    const styleConfig = stripConfig.style && typeof stripConfig.style === "object"
        ? stripConfig.style
        : {};

    if (typeof styleConfig.fontSizePx === "number" && Number.isFinite(styleConfig.fontSizePx)) {
        stripElement.style.fontSize = `${styleConfig.fontSizePx}px`;
    } else {
        stripElement.style.fontSize = "";
    }

    const paddingY = typeof styleConfig.paddingYpx === "number" && Number.isFinite(styleConfig.paddingYpx)
        ? styleConfig.paddingYpx
        : null;
    const paddingX = typeof styleConfig.paddingXpx === "number" && Number.isFinite(styleConfig.paddingXpx)
        ? styleConfig.paddingXpx
        : null;
    if (paddingY !== null && paddingX !== null) {
        stripElement.style.padding = `${paddingY}px ${paddingX}px`;
    } else {
        stripElement.style.padding = "";
    }

    if (typeof styleConfig.maxWidthPx === "number" && Number.isFinite(styleConfig.maxWidthPx)) {
        stripElement.style.maxWidth = `${styleConfig.maxWidthPx}px`;
        stripElement.style.overflow = "hidden";
        stripElement.style.textOverflow = "ellipsis";
        stripElement.style.whiteSpace = "nowrap";
    } else {
        stripElement.style.maxWidth = "";
        stripElement.style.overflow = "";
        stripElement.style.textOverflow = "";
        stripElement.style.whiteSpace = "";
    }
}

function readLauncherInputStripConfig(config) {
    const isMobile = isMobileViewport();
    const section = getDeviceSection(config, isMobile);
    if (!section || typeof section !== "object") {
        return null;
    }
    return section.launcherInputStrip && typeof section.launcherInputStrip === "object"
        ? section.launcherInputStrip
        : null;
}

function scheduleLauncherStripsStackSync(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            syncLauncherStripsStackLayout(ms);
        });
    });
}

/**
 * Places the input strip `gapAboveBubblePx` below the chat bubble (viewport), then the greeting strip
 * `gapBelowGreetingPx` above the input strip.
 */
function syncLauncherStripsStackLayout(dfMessenger) {
    const ui = readCompanyUiConfig();
    const inputCfg = readLauncherInputStripConfig(ui);
    const greetingEl = document.getElementById("dfchat-chat-launcher-strip");
    const inputEl = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);

    if (!inputCfg || !isFeatureEnabledFromConfig(inputCfg, true) || !inputEl) {
        if (greetingEl) {
            const sc = readLauncherStripConfig(ui);
            if (sc) {
                applyLauncherStripPosition(greetingEl, sc);
            }
        }
        return;
    }

    const inputCs = window.getComputedStyle(inputEl);
    if (inputCs.display === "none" || inputCs.visibility === "hidden") {
        return;
    }

    const ms = dfMessenger || activeDfMessenger;
    const bubbleHost = ms && typeof ms.querySelector === "function"
        ? ms.querySelector("df-messenger-chat-bubble")
        : null;

    const gapBubble = typeof inputCfg.gapAboveBubblePx === "number" && Number.isFinite(inputCfg.gapAboveBubblePx)
        ? Math.max(0, inputCfg.gapAboveBubblePx)
        : 5;
    const gapGreet = typeof inputCfg.gapBelowGreetingPx === "number" && Number.isFinite(inputCfg.gapBelowGreetingPx)
        ? Math.max(0, inputCfg.gapBelowGreetingPx)
        : 8;

    const layoutSide = resolveChatLayoutSide(ui);
    const position = inputCfg.position && typeof inputCfg.position === "object" ? inputCfg.position : {};

    const applySideInsets = (el) => {
        if (layoutSide === "right") {
            el.style.left = "";
            if (typeof position.rightPx === "number" && Number.isFinite(position.rightPx)) {
                el.style.right = `${position.rightPx}px`;
            }
        } else {
            el.style.right = "";
            if (typeof position.leftPx === "number" && Number.isFinite(position.leftPx)) {
                el.style.left = `${position.leftPx}px`;
            }
        }
    };

    let bubbleTop = null;
    if (bubbleHost && typeof bubbleHost.getBoundingClientRect === "function") {
        const br = bubbleHost.getBoundingClientRect();
        if (br.width > 0 && br.height > 0) {
            bubbleTop = br.top;
        }
    }

    if (bubbleTop != null && window.innerHeight > 0) {
        const bottomCss = window.innerHeight - bubbleTop + gapBubble;
        inputEl.style.bottom = `${Math.round(Math.max(0, bottomCss))}px`;
    } else {
        const fb = typeof inputCfg.fallbackBottomPx === "number" && Number.isFinite(inputCfg.fallbackBottomPx)
            ? inputCfg.fallbackBottomPx
            : 54;
        inputEl.style.bottom = `${fb}px`;
    }
    applySideInsets(inputEl);
    if (typeof position.topPx === "number" && Number.isFinite(position.topPx)) {
        inputEl.style.top = `${position.topPx}px`;
    } else {
        inputEl.style.top = "";
    }

    if (greetingEl) {
        const gCs = window.getComputedStyle(greetingEl);
        if (gCs.display !== "none" && gCs.visibility !== "hidden") {
            const ir = inputEl.getBoundingClientRect();
            if (ir.height > 0 && window.innerHeight > 0) {
                const greetBottomCss = window.innerHeight - ir.top + gapGreet;
                greetingEl.style.bottom = `${Math.round(Math.max(0, greetBottomCss))}px`;
                applySideInsets(greetingEl);
            }
        }
    }
}

function ensureLauncherStripsResizeListener() {
    if (companyLauncherStripsResizeAttached) {
        return;
    }
    companyLauncherStripsResizeAttached = true;
    window.addEventListener("resize", () => {
        syncLauncherStripsStackLayout(activeDfMessenger);
        // Language/Restart: only `ensureChatActionBar` resize (resets caches + schedules). Duplicating here caused double sync and drift.
        const ui = readCompanyUiConfig();
        const sc = readLauncherStripConfig(ui);
        const g = document.getElementById("dfchat-chat-launcher-strip");
        if (g && sc) {
            applyLauncherStripStyle(g, sc);
        }
        const ic = readLauncherInputStripConfig(ui);
        const iw = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
        if (iw && ic) {
            applyLauncherInputStripStyle(iw, ic);
        }
    });
}

function applyLauncherInputStripStyle(wrapEl, inputConfig) {
    if (!wrapEl || !inputConfig) {
        return;
    }
    const styleConfig = inputConfig.style && typeof inputConfig.style === "object"
        ? inputConfig.style
        : {};
    if (typeof styleConfig.fontSizePx === "number" && Number.isFinite(styleConfig.fontSizePx)) {
        wrapEl.style.setProperty("--dfchat-launcher-input-font-size", `${styleConfig.fontSizePx}px`);
    } else {
        wrapEl.style.removeProperty("--dfchat-launcher-input-font-size");
    }
    if (typeof styleConfig.maxWidthPx === "number" && Number.isFinite(styleConfig.maxWidthPx)) {
        wrapEl.style.maxWidth = `${styleConfig.maxWidthPx}px`;
    } else {
        wrapEl.style.maxWidth = "";
    }
}

function syncLauncherInputStripI18n() {
    const wrap = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
    if (!wrap) {
        return;
    }
    const cfg = readLauncherInputStripConfig(readCompanyUiConfig());
    const input = wrap.querySelector("input");
    const btn = wrap.querySelector("button[type=\"button\"]");
    if (!input || !cfg) {
        return;
    }
    if (typeof cfg.placeholder === "string" && cfg.placeholder.trim()) {
        input.placeholder = cfg.placeholder.trim();
    } else {
        input.placeholder = getChatInputPlaceholder(activeLanguage);
    }
    if (btn && typeof cfg.sendLabel === "string" && cfg.sendLabel.trim()) {
        btn.textContent = cfg.sendLabel.trim();
    }
}

/** Dedupes overlapping `df-user-input-entered` + `df-request-sent` triggers for typed “restart”. */
let restartFromUserPhraseTimerId = null;

/** Keep in sync with server `collectUserQueriesLinesFromContext_` per-line ceiling (truncation, not omission). */
const MAX_STORED_CHAT_USER_QUERY_CHARS = 500;
/** Last typed line from `df-user-input-entered` when `df-request-sent` omits text in `detail` (gate + thanks need it). */
let dfchatPendingTypedUtteranceForGate_ = "";

/** @param {unknown} maybeBody */
function extractOutboundQueryTextFromMessengerRequestBody_(maybeBody) {
    if (!maybeBody || typeof maybeBody !== "object") {
        return "";
    }
    const body = /** @type {Record<string, unknown>} */ (maybeBody);
    const qi = body.queryInput || body.query_input;
    if (!qi || typeof qi !== "object") {
        return "";
    }
    const q = /** @type {Record<string, unknown>} */ (qi);
    const tBlock = q.text;
    if (tBlock && typeof tBlock === "object") {
        const tb = /** @type {Record<string, unknown>} */ (tBlock);
        if (typeof tb.text === "string" && tb.text.trim()) {
            return tb.text.trim();
        }
        if (typeof tb.stringValue === "string" && tb.stringValue.trim()) {
            return tb.stringValue.trim();
        }
    }
    if (typeof tBlock === "string" && tBlock.trim()) {
        return tBlock.trim();
    }
    if (typeof q.text === "string" && q.text.trim()) {
        return q.text.trim();
    }
    // Do not synthesize phrases from `queryInput.event` (custom event IDs are not user utterances).
    return "";
}

/** @param {Event | undefined | null} event */
function extractQueryTextFromDfRequestSentEvent_(event) {
    const d = event && event.detail;
    if (!d || typeof d !== "object") {
        return "";
    }
    /** @type {unknown[]} */
    const candidates = [];
    const dn = /** @type {Record<string, unknown>} */ (d);
    if (dn.data && typeof dn.data === "object") {
        const data = /** @type {Record<string, unknown>} */ (dn.data);
        candidates.push(data.requestBody);
        candidates.push(data.body);
        candidates.push(data.rawRequest);
        if (data.queryInput || data.query_input) {
            candidates.push(data);
        }
    }
    candidates.push(dn.requestBody);
    for (let i = 0; i < candidates.length; i += 1) {
        const t = extractOutboundQueryTextFromMessengerRequestBody_(candidates[i]);
        if (t) {
            return t;
        }
    }
    return "";
}

/** @param {unknown} detail `event.detail` for chip / button / list rich-reply selectors (CX messenger). */
function dfMessengerRichChoiceDetailToPhrase_(detail) {
    if (!detail || typeof detail !== "object") {
        return "";
    }
    const o = /** @type {Record<string, unknown>} */ (detail);
    const txt = typeof o.text === "string" ? o.text.trim() : "";
    if (txt) {
        return txt;
    }
    const title = typeof o.title === "string" ? o.title.trim() : "";
    return title || "";
}

function extractDfUserInputEnteredText(event) {
    try {
        const d = event && event.detail;
        if (!d) {
            return "";
        }
        if (typeof d.input === "string") {
            return d.input;
        }
        if (d.input != null && typeof d.input !== "object") {
            const coerced = String(d.input).trim();
            if (coerced) {
                return coerced;
            }
        }
        if (typeof d.message === "string") {
            return d.message;
        }
        if (typeof d.text === "string" && d.text.trim()) {
            return d.text.trim();
        }
        if (typeof d.value === "string" && d.value.trim()) {
            return d.value.trim();
        }
        const dd = /** @type {Record<string, unknown>} */ (d).detail;
        if (dd && typeof dd === "object") {
            const inner = /** @type {Record<string, unknown>} */ (dd).input;
            if (typeof inner === "string" && inner.trim()) {
                return inner.trim();
            }
        }
        const data = d.data && typeof d.data === "object" ? d.data : null;
        if (data && typeof data.input === "string") {
            return data.input;
        }
        if (data && data.queryInput && typeof data.queryInput.text === "object"
            && typeof data.queryInput.text.text === "string") {
            return data.queryInput.text.text;
        }
    } catch {
        /* ignore */
    }
    return "";
}

/** Normalizes a single-turn “command-style” phrase (restart, language name, …). */
function normalizeWholeMessageIntentPhrase(raw) {
    let s = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/^[`'"“”‘’«»\s()[\]{}]+/g, "")
        .replace(/[`'"“”‘’«»\s.!?,;:)+]+$/g, "")
        .trim();
    s = s.replace(/\s+/g, " ").trim();
    return s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function stripTrailingCourtesyWholeMessage(raw) {
    let s = String(raw || "").trim();
    if (!s) {
        return s;
    }
    s = s.replace(/\s*,\s*(please|pls|thanks|thank you)\s*[!?.]*\s*$/i, "").trim();
    s = s.replace(/\s+(please|pls|thanks|thank you)\s*[!?.]*\s*$/i, "").trim();
    return s;
}

/**
 * Bare ISO-style tags ("mr", "hi", "en") must not switch language alone; full names ("marathi", "hindi") still do.
 * @param {string} piece
 * @param {string} resolved
 * @returns {boolean}
 */
function isBareIsoLanguageTagFlowAlias(piece, resolved) {
    const normalized = normalizeWholeMessageIntentPhrase(piece);
    if (!normalized || normalized.indexOf(" ") !== -1) {
        return false;
    }
    const base = (resolved.split(/[-_]/)[0] || resolved).toLowerCase();
    if (normalized !== base) {
        return false;
    }
    return /^[a-z]{2,3}$/.test(normalized);
}

/** Cached: normalized spoken phrase → `enabledLanguages` code (normalized). Built from codes, labels, `nativeLabel`, autonyms. */
let chatLanguageFlowAliasMapCache = null;

function getChatLanguageFlowAliasMap() {
    if (chatLanguageFlowAliasMapCache) {
        return chatLanguageFlowAliasMapCache;
    }
    /** @type {Map<string, string>} */
    const map = new Map();
    /**
     * @param {string} phrase
     * @param {string} code
     */
    function alias(phrase, code) {
        const key = normalizeWholeMessageIntentPhrase(phrase);
        if (key.length < 2) {
            return;
        }
        if (!map.has(key)) {
            map.set(key, code);
        }
    }

    try {
        for (let i = 0; i < CHAT_LANGUAGE_OPTIONS.length; i += 1) {
            const opt = CHAT_LANGUAGE_OPTIONS[i];
            if (!opt || typeof opt !== "object") {
                continue;
            }
            const resolved = normalizeLanguage(resolveToSupportedLanguageCode(opt.code ? String(opt.code) : ""));
            if (!resolved || !SUPPORTED_LANGUAGES.includes(resolved)) {
                continue;
            }
            const variants = [];
            variants.push(resolved);
            const baseOnly = resolved.split(/[-_]/)[0];
            if (baseOnly && baseOnly !== resolved) {
                variants.push(baseOnly);
            }
            const gloss = typeof opt.label === "string" && opt.label.trim() ? opt.label.trim() : "";
            if (gloss) {
                variants.push(gloss);
            }
            const display = getLanguageOptionDisplayLabel(opt);
            if (display && typeof display === "string" && display.trim()) {
                variants.push(display.trim());
            }
            const seenPhrase = new Set();
            for (let v = 0; v < variants.length; v += 1) {
                const piece = variants[v];
                seenPhrase.add(piece);
            }
            for (const piece of seenPhrase) {
                if (!isBareIsoLanguageTagFlowAlias(piece, resolved)) {
                    alias(piece, resolved);
                }
                const n = normalizeWholeMessageIntentPhrase(piece);
                if (n.length < 3) {
                    continue;
                }
                alias(`${n} language`, resolved);
                alias(`speak ${n}`, resolved);
                alias(`talk in ${n}`, resolved);
                alias(`switch to ${n}`, resolved);
                alias(`change to ${n}`, resolved);
                alias(`show in ${n}`, resolved);
                alias(`use ${n}`, resolved);
                alias(`in ${n}`, resolved);
                alias(`${n} please`, resolved);
            }
        }
        /** Roman-keyboard / speech-style typos when the gloss language is enabled (full-name intent, not short codes). */
        const flowTyposToBaseLang = [
            ["hinid", "hi"],
            ["hendi", "hi"],
            ["maarghi", "mr"],
            ["marati", "mr"],
            ["marthi", "mr"]
        ];
        for (let ti = 0; ti < flowTyposToBaseLang.length; ti += 1) {
            const typo = flowTyposToBaseLang[ti][0];
            const baseGuess = flowTyposToBaseLang[ti][1];
            const rTypo = normalizeLanguage(resolveToSupportedLanguageCode(baseGuess));
            if (rTypo && SUPPORTED_LANGUAGES.includes(rTypo)) {
                alias(typo, rTypo);
            }
        }
    } catch {
        /* ignore */
    }
    chatLanguageFlowAliasMapCache = map;
    return chatLanguageFlowAliasMapCache;
}

/**
 * Whole-message language switch (“hindi”, “marathi”, “speak english”, …) when multiLanguage is enabled.
 * Bare tags like “mr” / “hi” / “en” alone do not switch; use the full language name (or a listed typo).
 * @param {string} text
 * @returns {string} Resolved language code, or ""
 */
function tryResolveSupportedLanguageFromUserFlowPhrase(text) {
    if (!isMultiLanguageEnabled()) {
        return "";
    }
    const prepared = normalizeWholeMessageIntentPhrase(stripTrailingCourtesyWholeMessage(text));
    if (!prepared) {
        return "";
    }
    const map = getChatLanguageFlowAliasMap();
    const hit = map.get(prepared);
    return typeof hit === "string" && hit ? normalizeLanguage(hit) : "";
}

/**
 * Clears the messenger composer — `preventDefault` on consumed flow phrases leaves text in the box otherwise.
 */
function clearMessengerComposerText(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    if (!ms) {
        return;
    }
    try {
        const roots = collectSearchRoots(ms);
        for (let ri = 0; ri < roots.length; ri += 1) {
            const root = roots[ri];
            if (!root || typeof root.querySelectorAll !== "function") {
                continue;
            }
            const hosts = root.querySelectorAll("df-messenger-user-input");
            for (let hi = 0; hi < hosts.length; hi += 1) {
                const h = hosts[hi];
                const sr = h && h.shadowRoot;
                if (!sr) {
                    continue;
                }
                const ta = sr.querySelector("textarea");
                if (ta && "value" in ta) {
                    ta.value = "";
                    ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                }
                const inp = sr.querySelector("input[type=\"text\"], input[type=\"search\"], input:not([type])");
                if (inp && "value" in inp) {
                    inp.value = "";
                    inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                }
                const editable = sr.querySelector("[contenteditable=\"true\"]");
                if (editable) {
                    editable.textContent = "";
                    editable.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                }
            }
        }
    } catch {
        /* ignore */
    }
}

/** Dialogflow can re-apply the draft string once after `preventDefault` — clear a few times. */
function scheduleClearMessengerComposerAfterFlowCommand(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    if (!ms) {
        return;
    }
    [0, 45, 160, 380].forEach((delayMs) => {
        window.setTimeout(() => clearMessengerComposerText(ms), delayMs);
    });
}

/**
 * Whole-message phrases that map to `enabledLanguages` (“hindi”, “speak marathi”, …).
 * Applies `applyLanguage`, optionally `preventDefault` so Dialogflow never sees command text.
 * @param {string} userText
 * @param {Event | null} [optionalEventForPreventDefault]
 * @param {Element | null} [dfMessengerForComposer] Messenger whose composer to clear (default `activeDfMessenger`).
 * @returns {boolean} true if the utterance was consumed.
 */
function consumeLanguageSwitchFromUserFlowPhrase(userText, optionalEventForPreventDefault, dfMessengerForComposer) {
    if (!isMultiLanguageEnabled()) {
        return false;
    }
    const target = tryResolveSupportedLanguageFromUserFlowPhrase(userText);
    if (!target) {
        return false;
    }
    try {
        if (optionalEventForPreventDefault && typeof optionalEventForPreventDefault.preventDefault === "function") {
            optionalEventForPreventDefault.preventDefault();
        }
    } catch {
        /* ignore */
    }
    if (normalizeLanguage(activeLanguage) !== normalizeLanguage(target)) {
        applyLanguage(target);
    }
    scheduleClearMessengerComposerAfterFlowCommand(dfMessengerForComposer || activeDfMessenger);
    return true;
}

/** Whole-message intents that reopen the bot like footer Restart (`common.features.restartChat`). */
const USER_RESTART_CHAT_PHRASE_SET = new Set([
    "restart",
    "re start",
    "reset",
    "start again",
    "fresh chat"
]);

/** True when the whole message matches a restart / reset alias (typed in chat). */
function isUserTypingRestartChatCommand(text) {
    const n = normalizeWholeMessageIntentPhrase(text);
    return n.length > 0 && USER_RESTART_CHAT_PHRASE_SET.has(n);
}

function scheduleRestartChatSessionFromUserPhrase() {
    if (!isRestartChatEnabled()) {
        return;
    }
    if (restartFromUserPhraseTimerId !== null) {
        return;
    }
    restartFromUserPhraseTimerId = window.setTimeout(() => {
        restartFromUserPhraseTimerId = null;
        restartChatSession();
    }, 0);
}

function sendUserTextViaDfMessenger(dfMessenger, text, shouldRenderCustomTextNow) {
    const t = (text || "").trim();
    if (!t || !dfMessenger) {
        return;
    }
    if (isRestartChatEnabled() && isUserTypingRestartChatCommand(t)) {
        scheduleRestartChatSessionFromUserPhrase();
        return;
    }
    if (consumeLanguageSwitchFromUserFlowPhrase(t, null, dfMessenger)) {
        return;
    }
    const hadM0 = hasStoredMobileForChatBlockGate_();
    const prev0 = readStoredClientContext();
    const hadE0 = !!(dfParameterScalarToString(prev0 && prev0.email != null ? prev0.email : "").trim());
    mergeLikelyContactHintsFromChatText_(t);
    if (tryRenderThanksAfterMergeSuppressDf_(null, t, { hadMobile: hadM0, hadEmail: hadE0 })) {
        return;
    }
    if (tryPreventChatSendForMissingMobileGate_(null, t)) {
        return;
    }
    const renderCustom =
        typeof shouldRenderCustomTextNow === "boolean"
            ? shouldRenderCustomTextNow
            : true;

    /**
     * Dialogflow's `sendQuery/sendRequest` sometimes does not render the user bubble immediately.
     * When `renderCustom` is false, we schedule a fallback render after a short delay
     * (only if the message text is not already present in the transcript).
     */
    function messageListAlreadyContainsText(ml, needle) {
        try {
            if (!ml || !needle || typeof needle !== "string") {
                return false;
            }
            const children = ml.children ? Array.from(ml.children) : [];
            const tail = children.slice(Math.max(0, children.length - 6));
            for (let i = 0; i < tail.length; i += 1) {
                const el = tail[i];
                if (!el || typeof el.textContent !== "string") {
                    continue;
                }
                if (el.textContent.includes(needle)) {
                    return true;
                }
            }
        } catch {
            /* ignore */
        }
        return false;
    }

    try {
        // Programmatic `sendQuery` / `sendRequest` does not always add a user bubble; mirror in-chat UX.
        if (renderCustom && typeof dfMessenger.renderCustomText === "function") {
            dfMessenger.renderCustomText(t, false);
        }
        const shouldFallbackRender = !renderCustom && typeof dfMessenger.renderCustomText === "function";
        if (shouldFallbackRender) {
            window.setTimeout(() => {
                try {
                    const ml = findMessengerMessageListRoot(dfMessenger);
                    if (!messageListAlreadyContainsText(ml, t)) {
                        dfMessenger.renderCustomText(t, false);
                    }
                } catch {
                    /* ignore */
                }
            }, 650);
        }
        if (typeof dfMessenger.sendQuery === "function") {
            const r = dfMessenger.sendQuery(t);
            if (r && typeof r.catch === "function") {
                r.catch(() => {});
            }
            scheduleClearDfMessengerComposerInput_();
            return;
        }
        if (typeof dfMessenger.sendRequest === "function") {
            const r = dfMessenger.sendRequest("query", t);
            if (r && typeof r.catch === "function") {
                r.catch(() => {});
            }
        }
        scheduleClearDfMessengerComposerInput_();
    } catch (e) {
        /* no-op */
    }
}

function openChatAndSendUserText(dfMessenger, bubbleNode, rawText) {
    const text = (rawText || "").trim();
    if (!text) {
        return;
    }
    const ms = dfMessenger || activeDfMessenger;
    const bub = bubbleNode || activeBubbleNode;
    if (!ms) {
        return;
    }
    openChatWindow(ms, bub);

    const started = Date.now();
    const attempt = () => {
        if (Date.now() - started > LAUNCHER_INPUT_SEND_MAX_WAIT_MS) {
            return;
        }
        const open = !!(isChatWindowOpen || (ms && isChatExpanded(ms)));
        const canSend = ms && (typeof ms.sendQuery === "function" || typeof ms.sendRequest === "function");
        if (open && canSend) {
            sendUserTextViaDfMessenger(ms, text);
            return;
        }
        window.setTimeout(attempt, 90);
    };
    window.setTimeout(attempt, 120);
}

function ensureLauncherInputStripWindowListeners() {
    if (companyLauncherInputStripWindowListenersAttached) {
        return;
    }
    companyLauncherInputStripWindowListenersAttached = true;

    window.addEventListener("df-chat-open-changed", (event) => {
        const wrap = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
        if (!wrap) {
            return;
        }
        const open = !!(event && event.detail && event.detail.isOpen);
        wrap.style.display = open ? "none" : "flex";
        if (!open) {
            scheduleLauncherStripsStackSync(activeDfMessenger);
        }
    });
}

function initializeLauncherInputStrip(dfMessenger, bubbleNode, config) {
    void dfMessenger;
    void bubbleNode;
    const inputConfig = readLauncherInputStripConfig(config);
    if (!inputConfig || !isFeatureEnabledFromConfig(inputConfig, true)) {
        const dead = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
        if (dead) {
            dead.remove();
        }
        return;
    }

    ensureLauncherInputStripWindowListeners();

    let wrap = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = COMPANY_LAUNCHER_INPUT_STRIP_ID;
        wrap.className = "dfchat-chat-launcher-input-strip";
        wrap.setAttribute("data-dfchat-no-translate", "true");

        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.className = "dfchat-chat-launcher-input-strip__field";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dfchat-chat-launcher-input-strip__send";

        wrap.appendChild(input);
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
    }

    const input = wrap.querySelector("input");
    const btn = wrap.querySelector("button[type=\"button\"]");
    if (!input || !btn) {
        return;
    }

    wrap.style.display = isChatWindowOpen ? "none" : "flex";
    applyLauncherInputStripStyle(wrap, inputConfig);
    syncLauncherInputStripI18n();

    const submit = () => {
        const text = (input.value || "").trim();
        if (!text) {
            return;
        }
        openChatAndSendUserText(activeDfMessenger, activeBubbleNode, text);
        input.value = "";
    };

    if (!wrap._companyLauncherInputBound) {
        wrap._companyLauncherInputBound = true;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            submit();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submit();
            }
        });
        input.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    scheduleLauncherStripsStackSync(activeDfMessenger);
}

function readCompanyUiConfig() {
    const config = window.COMPANY_CHAT_UI_CONFIG;
    if (config && typeof config === "object") {
        return config;
    }
    return {};
}

/**
 * Device UI block: `mob` (or legacy `mobile`) vs `desk` (or legacy `desktop`).
 * @param {Record<string, unknown> | null | undefined} config
 * @param {boolean} mobile
 * @returns {Record<string, unknown>}
 */
function getDeviceSection(config, mobile) {
    if (!config || typeof config !== "object") {
        return {};
    }
    if (mobile) {
        return (config.mob && typeof config.mob === "object" ? config.mob : null)
            || (config.mobile && typeof config.mobile === "object" ? config.mobile : null)
            || {};
    }
    return (config.desk && typeof config.desk === "object" ? config.desk : null)
        || (config.desktop && typeof config.desktop === "object" ? config.desktop : null)
        || {};
}

/**
 * @param {Record<string, unknown> | null | undefined} config
 * @returns {boolean}
 */
function isDeviceShowChatbotEnabled(config) {
    const sec = getDeviceSection(config, isMobileViewport());
    if (sec && typeof sec === "object" && typeof sec.showChatbot === "boolean") {
        return sec.showChatbot;
    }
    return true;
}

/**
 * Per-device form layout (dock/insets) for contact / appointment / upload / … — not field definitions.
 * Legacy: `mobile.contactForm` insets; still supported.
 * @param {Record<string, unknown> | null | undefined} ui
 * @returns {Record<string, unknown> | null}
 */
function getDeviceFormOverlay(ui) {
    const sec = getDeviceSection(ui, isMobileViewport());
    if (!sec || typeof sec !== "object") {
        return null;
    }
    if (sec.form && typeof sec.form === "object") {
        return sec.form;
    }
    if (sec.contactForm && typeof sec.contactForm === "object") {
        return sec.contactForm;
    }
    return null;
}

/**
 * @returns {Record<string, unknown>}
 */
function readCommonFormConfigRoot() {
    if (COMMON_CONFIG.form && typeof COMMON_CONFIG.form === "object") {
        return COMMON_CONFIG.form;
    }
    if (COMMON_CONFIG.contactForm && typeof COMMON_CONFIG.contactForm === "object") {
        return COMMON_CONFIG.contactForm;
    }
    return {};
}

/**
 * `common.form.forms` is often `Object.assign({}, window.__DFCHAT_FORMS__)` at config parse time; `forms/*.js`
 * may register after that, leaving a frozen empty object. Merge snapshot + live registry for lookups.
 * @returns {Record<string, Record<string, unknown>>}
 */
function getRuntimeMergedFormDefinitions_() {
    const fr = readCommonFormConfigRoot();
    const fromConfig = fr.forms && typeof fr.forms === "object" ? fr.forms : {};
    const g = typeof globalThis !== "undefined" ? globalThis : /** @type {Window} */ (window);
    const live = g && g.__DFCHAT_FORMS__ && typeof g.__DFCHAT_FORMS__ === "object" ? g.__DFCHAT_FORMS__ : {};
    return Object.assign({}, fromConfig, live);
}

/**
 * @param {unknown} v
 * @param {boolean} defaultBool
 * @returns {boolean}
 */
function coalesceFormLayoutBool(v, defaultBool) {
    return typeof v === "boolean" ? v : defaultBool;
}

/**
 * Hides the whole chat widget (bubble + window + host strips) when `showChatbot: false` for this device.
 * @param {Record<string, unknown> | null | undefined} config
 * @param {Element | null} dfMessenger
 */
function applyDeviceChatbotVisibility(config, dfMessenger) {
    const show = isDeviceShowChatbotEnabled(config);
    const hide = !show;
    if (dfMessenger) {
        dfMessenger.style.display = hide ? "none" : "";
        try {
            dfMessenger.setAttribute("aria-hidden", hide ? "true" : "false");
        } catch (e) {
            /* no-op */
        }
    }
    const strip = document.getElementById("dfchat-chat-launcher-strip");
    if (strip) {
        strip.style.display = hide ? "none" : "";
    }
    const inputStrip = document.getElementById(COMPANY_LAUNCHER_INPUT_STRIP_ID);
    if (inputStrip) {
        inputStrip.style.display = hide ? "none" : "";
    }
    const powered = document.getElementById("dfchat-powered-by-strip");
    if (powered) {
        powered.style.display = hide ? "none" : "";
    }
    const actionBar = document.getElementById("dfchat-chat-action-bar");
    if (actionBar) {
        actionBar.style.display = hide ? "none" : "";
    }
}

function readFooterActionBarLayoutConfig() {
    const c = COMMON_CONFIG.footerActionBar && typeof COMMON_CONFIG.footerActionBar === "object"
        ? COMMON_CONFIG.footerActionBar
        : {};
    const n = (value, defaultValue) => (typeof value === "number" && Number.isFinite(value) ? value : defaultValue);
    // `nudgeUpPx` is subtracted from the computed `top` — larger values move the bar UP on the screen.
    // Defaults are neutral; set small nudges in `company.config.js` only when tuning a specific layout.
    return {
        nudgeRightPx: n(c.nudgeRightPx, 0),
        nudgeUpPx: n(c.nudgeUpPx, 8),
        nudgeDownPx: n(c.nudgeDownPx, 0),
        nudgeLeftPx: n(c.nudgeLeftPx, 0),
        gapBeforeSendPx: n(c.gapBeforeSendPx, 8),
        // 0 = disable “stable top” when the textarea goes multiline (avoids a stuck, too-high Y).
        lockVerticalWhenComposerRowTallerThanPx: n(c.lockVerticalWhenComposerRowTallerThanPx, 0)
    };
}

const CONTACT_FORM_SVG_ICONS = {
    user: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    phone: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    email: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    message: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    star: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    url: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
    map: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    location: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    key: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.5 9.5"/><path d="m15.5 7.5 3 3L22 4l-3-3"/></svg>',
    file: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
};

const CONTACT_FORM_INPUT_TYPES = new Set([
    "text", "email", "tel", "date", "time", "datetime-local", "number", "url", "password", "search", "week", "month", "color", "hidden"
]);

const EMAIL_VALIDATION_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DEFAULT_PATTERN = "^[+]?[0-9\\s\\-]{7,20}$";

/** @type {Set<string>} Lowercase extension without dot — blocks common video types (server should still verify). */
const CONTACT_FORM_VIDEO_UPLOAD_EXTENSIONS = new Set([
    "mp4", "m4v", "webm", "ogv", "mov", "avi", "mkv", "wmv", "flv", "3gp", "3g2", "ts", "mts", "m2ts", "vob", "asf", "f4v", "mpeg", "mpg", "divx", "xvid"
]);

/**
 * @param {File} file
 * @returns {boolean}
 */
function isContactFormVideoUploadFile(file) {
    if (!file || typeof file !== "object") {
        return false;
    }
    const mt = typeof file.type === "string" ? file.type.toLowerCase() : "";
    if (mt.indexOf("video/") === 0) {
        return true;
    }
    const nm = typeof file.name === "string" ? file.name : "";
    const m = nm.toLowerCase().match(/\.([^.]+)$/);
    return Boolean(m && CONTACT_FORM_VIDEO_UPLOAD_EXTENSIONS.has(m[1]));
}

/**
 * @returns {boolean}
 */
function contactFormConfigHasFileField() {
    const fields = readContactFormConfig().fields;
    if (!Array.isArray(fields)) {
        return false;
    }
    for (let i = 0; i < fields.length; i += 1) {
        const d = fields[i];
        if (d && String(d.type || "").toLowerCase() === "file") {
            return true;
        }
    }
    return false;
}

function getBuiltinDefaultContactFormFields() {
    return [
        { id: "contact-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
        { id: "contact-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
        { id: "contact-email", name: "email", type: "email", required: true, icon: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" },
        { id: "contact-message", name: "message", type: "textarea", required: true, icon: "message", i18nPlaceholder: "messagePlaceholder", rows: 2 }
    ];
}

/**
 * @returns {string} Key in `common.form.forms` (or "default" for legacy `fields` only).
 */
function getDefaultContactFormId() {
    const c = readCommonFormConfigRoot();
    const merged = getRuntimeMergedFormDefinitions_();
    const keys = Object.keys(merged);
    if (keys.length === 0) {
        return "default";
    }
    const want = typeof c.defaultFormId === "string" ? c.defaultFormId.trim() : "";
    if (want && merged[want]) {
        return want;
    }
    return keys[0];
}

/**
 * @returns {{ formKey: string, block: Record<string, unknown> }}
 */
function getResolvedContactFormBlock() {
    const c = readCommonFormConfigRoot();
    const merged = getRuntimeMergedFormDefinitions_();
    if (activeContactFormId == null) {
        activeContactFormId = getDefaultContactFormId();
    }
    if (Object.keys(merged).length > 0) {
        let key = activeContactFormId;
        if (!merged[key]) {
            key = getDefaultContactFormId();
            activeContactFormId = key;
        }
        const f = merged[key];
        return { formKey: key, block: f && typeof f === "object" ? f : {} };
    }
    return {
        formKey: "default",
        block: {
            titleI18nKey: "contactFormTitle",
            subtitleI18nKey: "contactFormSubtitle",
            fields: Array.isArray(c.fields) && c.fields.length > 0
                ? c.fields
                : getBuiltinDefaultContactFormFields()
        }
    };
}

function readContactFormConfig() {
    const c = readCommonFormConfigRoot();
    const n = (value, defaultValue) => (typeof value === "number" && Number.isFinite(value) ? value : defaultValue);
    const resolved = getResolvedContactFormBlock();
    const b = resolved.block;
    const rawFields = Array.isArray(b.fields) ? b.fields : [];
    const fields = rawFields.length > 0 ? rawFields : getBuiltinDefaultContactFormFields();
    const titleI18nKey = typeof b.titleI18nKey === "string" && b.titleI18nKey.trim()
        ? b.titleI18nKey.trim()
        : "contactFormTitle";
    const subtitleI18nKey = typeof b.subtitleI18nKey === "string" && b.subtitleI18nKey.trim()
        ? b.subtitleI18nKey.trim()
        : "contactFormSubtitle";
    const uiForForm = readCompanyUiConfig();
    const o = getDeviceFormOverlay(uiForForm);
    const showSubtitle = typeof b.showSubtitle === "boolean"
        ? b.showSubtitle
        : (typeof (o && o.showSubtitle) === "boolean"
            ? o.showSubtitle
            : c.showSubtitle !== false);
    const chatNames = Array.isArray(b.chatSummaryFieldNames) && b.chatSummaryFieldNames.length
        ? b.chatSummaryFieldNames.slice()
        : (Array.isArray(c.chatSummaryFieldNames) && c.chatSummaryFieldNames.length
            ? c.chatSummaryFieldNames.slice()
            : ["name", "mobile"]);
    const maxFromBlock = typeof b.maxCardHeightPx === "number" && Number.isFinite(b.maxCardHeightPx) && b.maxCardHeightPx > 0
        ? b.maxCardHeightPx
        : null;
    const titleByLanguage = b.titleByLanguage && typeof b.titleByLanguage === "object" ? b.titleByLanguage : null;
    const subtitleByLanguage = b.subtitleByLanguage && typeof b.subtitleByLanguage === "object" ? b.subtitleByLanguage : null;
    const layoutSideDefault = n(
        o && typeof o.sideInsetPx === "number" ? o.sideInsetPx : c.sideInsetPx,
        15
    );
    let sideInsetLeftPx = layoutSideDefault;
    let sideInsetRightPx = layoutSideDefault;
    if (o && typeof o === "object") {
        const mL = o.insetLeftPx;
        const mR = o.insetRightPx;
        const mS = o.sideInsetPx;
        if (typeof mL === "number" && Number.isFinite(mL)) {
            sideInsetLeftPx = mL;
        } else if (typeof mS === "number" && Number.isFinite(mS)) {
            sideInsetLeftPx = mS;
        }
        if (typeof mR === "number" && Number.isFinite(mR)) {
            sideInsetRightPx = mR;
        } else if (typeof mS === "number" && Number.isFinite(mS)) {
            sideInsetRightPx = mS;
        }
    }
    const sideInsetPx = (sideInsetLeftPx + sideInsetRightPx) / 2;
    const dockToChatWindow = coalesceFormLayoutBool(
        o && Object.prototype.hasOwnProperty.call(o, "dockToChatWindow") ? o.dockToChatWindow : c.dockToChatWindow,
        true
    );
    const dockAboveFooter = coalesceFormLayoutBool(
        o && Object.prototype.hasOwnProperty.call(o, "dockAboveFooter") ? o.dockAboveFooter : c.dockAboveFooter,
        true
    );
    const maxCardFallback = n(
        o && typeof o.maxCardHeightPx === "number" ? o.maxCardHeightPx : c.maxCardHeightPx,
        300
    );
    const rawDockMaxW = o && typeof o.formDockMaxWidthPx === "number" && o.formDockMaxWidthPx > 0
        ? o.formDockMaxWidthPx
        : (typeof c.formDockMaxWidthPx === "number" && c.formDockMaxWidthPx > 0 ? c.formDockMaxWidthPx : undefined);
    const formDockMaxWidthPx = n(rawDockMaxW, isMobileViewport() ? 340 : 420);
    return {
        formKey: resolved.formKey,
        maxCardHeightPx: maxFromBlock != null ? maxFromBlock : maxCardFallback,
        showSubtitle,
        dockToChatWindow,
        dockAboveFooter,
        titleInsetPx: n(
            o && typeof o.titleInsetPx === "number" ? o.titleInsetPx : c.titleInsetPx,
            48
        ),
        dockNudgeDownPx: n(
            o && typeof o.dockNudgeDownPx === "number" ? o.dockNudgeDownPx : c.dockNudgeDownPx,
            0
        ),
        gapAboveFooterPx: n(
            o && typeof o.gapAboveFooterPx === "number" ? o.gapAboveFooterPx : c.gapAboveFooterPx,
            8
        ),
        sideInsetPx,
        sideInsetLeftPx,
        sideInsetRightPx,
        formDockMaxWidthPx,
        chatSummaryFieldNames: chatNames,
        fields,
        titleI18nKey,
        subtitleI18nKey,
        titleByLanguage,
        subtitleByLanguage
    };
}

/**
 * @param {Record<string, unknown> | null} map
 * @param {string} lang
 * @returns {string | null}
 */
function pickContactFormLocalizedLine(map, lang) {
    if (!map || typeof map !== "object") {
        return null;
    }
    const L = normalizeLanguage(lang);
    const tryKeys = [L, lang, "en", DEFAULT_LANGUAGE];
    for (let i = 0; i < tryKeys.length; i += 1) {
        const k = tryKeys[i];
        const v = map[k];
        if (typeof v === "string" && v.trim()) {
            return v;
        }
    }
    return null;
}

/**
 * @returns {"otp" | "mobile"}
 */
function getOtpFormStep() {
    const root = document.querySelector("#dfchat-contact-form-inputs .dfchat-contact-form-otp-views");
    if (!root) {
        return "otp";
    }
    return root.getAttribute("data-otp-form-step") === "mobile" ? "mobile" : "otp";
}

/**
 * @param {"otp" | "mobile"} step
 */
function applyOtpFormStepSubtitle(step) {
    const s = document.querySelector("#dfchat-contact-form .dfchat-contact-form__subtitle");
    if (!s) {
        return;
    }
    const fr = readCommonFormConfigRoot();
    const c = fr && typeof fr.forms === "object" ? fr.forms.otp : null;
    const lang = activeLanguage;
    const show = readContactFormConfig().showSubtitle;
    if (step === "mobile") {
        const inline = c && c.subtitleMobileByLanguage && typeof c.subtitleMobileByLanguage === "object"
            ? pickContactFormLocalizedLine(c.subtitleMobileByLanguage, lang)
            : null;
        s.textContent = inline != null ? inline : getTranslation("otpFormSubtitleMobile");
    } else {
        const inline = c && c.subtitleByLanguage && typeof c.subtitleByLanguage === "object"
            ? pickContactFormLocalizedLine(c.subtitleByLanguage, lang)
            : null;
        s.textContent = inline != null ? inline : getTranslation("contactFormSubtitle");
    }
    s.removeAttribute("data-i18n");
    s.style.display = show ? "" : "none";
}

/**
 * @param {"otp" | "mobile"} step
 */
function setOtpFormStep(step) {
    const root = document.querySelector("#dfchat-contact-form-inputs .dfchat-contact-form-otp-views");
    if (!root) {
        return;
    }
    root.setAttribute("data-otp-form-step", step);
    const otpPanel = root.querySelector('[data-otp-step="otp"]');
    const mobilePanel = root.querySelector('[data-otp-step="mobile"]');
    if (otpPanel) {
        otpPanel.hidden = step !== "otp";
    }
    if (mobilePanel) {
        mobilePanel.hidden = step !== "mobile";
    }
    applyOtpFormStepSubtitle(step);
    const oOtp = document.getElementById("o-otp");
    const oMobile = document.getElementById("o-mobile");
    if (step === "otp" && oOtp && typeof oOtp.focus === "function") {
        oOtp.focus();
    } else if (step === "mobile" && oMobile && typeof oMobile.focus === "function") {
        oMobile.focus();
    }
}

function syncContactFormNoValidateForActiveForm() {
    const form = document.getElementById("dfchat-contact-form-fields");
    if (!form) {
        return;
    }
    if (readContactFormConfig().formKey === "otp" || contactFormConfigHasFileField()) {
        form.setAttribute("novalidate", "novalidate");
    } else {
        form.removeAttribute("novalidate");
    }
}

function submitOtpResendRequest(clickedButton) {
    const endpoint = getApiEndpoint(CONTACT_FORM_ENDPOINT);
    const status = document.getElementById("dfchat-contact-form-status");
    if (!endpoint) {
        if (status) {
            status.textContent = getTranslation("statusOpenViaFlask");
            status.classList.add("is-error");
            status.classList.remove("is-success");
        }
        return;
    }
    const mEl = document.getElementById("o-mobile");
    const mRaw = mEl && "value" in mEl ? mEl.value : "";
    const mobile = typeof mRaw === "string" ? mRaw.trim() : "";
    const payload = {
        client_context: getClientContext(),
        _contactFormId: "otp",
        _contactFormAction: "resend_otp"
    };
    if (mobile) {
        payload.mobile = mobile;
    }
    if (status) {
        status.textContent = getTranslation("statusSubmitting");
        status.classList.remove("is-success", "is-error");
    }
    if (clickedButton && "disabled" in clickedButton) {
        clickedButton.disabled = true;
    }
    fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
        .then(async (response) => {
            const responseText = await response.text();
            let responsePayload = {};
            try {
                responsePayload = responseText ? JSON.parse(responseText) : {};
            } catch {
                responsePayload = {};
            }
            if (!response.ok) {
                const fallbackMessage = responseText
                    ? `Unable to send. HTTP ${response.status}: ${responseText.slice(0, 160)}`
                    : `Unable to send. HTTP ${response.status}`;
                throw new Error(responsePayload.error || responsePayload.message || fallbackMessage);
            }
            if (status) {
                status.textContent = responsePayload.message || getTranslation("statusOtpResent");
                status.classList.add("is-success");
                status.classList.remove("is-error");
            }
        })
        .catch((error) => {
            if (status) {
                status.textContent = error.message || getTranslation("statusSubmissionFailed");
                status.classList.add("is-error");
                status.classList.remove("is-success");
            }
        })
        .finally(() => {
            if (clickedButton && "disabled" in clickedButton) {
                clickedButton.disabled = false;
            }
        });
}

function setupOtpFormTwoStepIfNeeded() {
    const cfg = readContactFormConfig();
    if (cfg.formKey !== "otp") {
        return;
    }
    const slot = document.getElementById("dfchat-contact-form-inputs");
    if (!slot) {
        return;
    }
    const otpEl = document.getElementById("o-otp");
    const mobileEl = document.getElementById("o-mobile");
    const otpRow = otpEl && otpEl.closest && otpEl.closest(".dfchat-contact-form__row");
    const mobileRow = mobileEl && mobileEl.closest && mobileEl.closest(".dfchat-contact-form__row");
    if (!otpRow || !mobileRow) {
        return;
    }

    const wrap = document.createElement("div");
    wrap.className = "dfchat-contact-form-otp-views";
    wrap.setAttribute("data-otp-form-step", "otp");

    const panelOtp = document.createElement("div");
    panelOtp.className = "dfchat-contact-form-otp-views__panel";
    panelOtp.setAttribute("data-otp-step", "otp");

    const panelMobile = document.createElement("div");
    panelMobile.className = "dfchat-contact-form-otp-views__panel";
    panelMobile.setAttribute("data-otp-step", "mobile");
    panelMobile.hidden = true;

    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "dfchat-contact-form-otp-change-mobile";
    changeBtn.setAttribute("data-i18n", "changeMobileButton");
    changeBtn.textContent = getTranslation("changeMobileButton");

    const resendBtn = document.createElement("button");
    resendBtn.type = "button";
    resendBtn.className = "dfchat-contact-form-otp-resend";
    resendBtn.setAttribute("data-i18n", "resendOtpButton");
    resendBtn.textContent = getTranslation("resendOtpButton");
    resendBtn.addEventListener("click", () => {
        submitOtpResendRequest(resendBtn);
    });

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "dfchat-contact-form-otp-back";
    backBtn.setAttribute("data-i18n", "backToOtpButton");
    backBtn.textContent = getTranslation("backToOtpButton");

    const linkRow = document.createElement("div");
    linkRow.className = "dfchat-contact-form-otp-views__links";
    linkRow.appendChild(resendBtn);
    linkRow.appendChild(changeBtn);

    changeBtn.addEventListener("click", () => {
        setOtpFormStep("mobile");
    });
    backBtn.addEventListener("click", () => {
        setOtpFormStep("otp");
    });

    slot.insertBefore(wrap, otpRow);
    panelOtp.appendChild(otpRow);
    panelOtp.appendChild(linkRow);
    panelMobile.appendChild(mobileRow);
    panelMobile.appendChild(backBtn);
    wrap.appendChild(panelOtp);
    wrap.appendChild(panelMobile);

    setOtpFormStep("otp");
}

/**
 * Map common CX typos / short names to keys in `common.form.forms` (e.g. `upload` → `uploadDocument`).
 * @param {string} requestedId
 * @returns {string}
 */
function canonicalContactFormId_(requestedId) {
    const merged = getRuntimeMergedFormDefinitions_();
    const raw = String(requestedId || "").trim();
    if (!raw || Object.keys(merged).length === 0) {
        return raw;
    }
    if (merged[raw]) {
        return raw;
    }
    const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
    /** @type {Record<string, string>} */
    const aliases = {
        upload: "uploadDocument",
        uploaddocument: "uploadDocument",
        documentupload: "uploadDocument",
        documents: "uploadDocument",
        fileupload: "uploadDocument",
        attach: "uploadDocument",
        attachment: "uploadDocument"
    };
    const mapped = aliases[compact];
    if (mapped && merged[mapped]) {
        return mapped;
    }
    return raw;
}

/**
 * When Dialogflow sends `{ "action": "open_form" }` without `form_id`, use `common.form.defaultFormId`.
 * Also used when `form_id` is invalid — infer upload vs contact from intent name / recent user text.
 * @param {Event} [event]
 */
function applyDefaultContactFormForBareOpenFormAction(event) {
    const merged = getRuntimeMergedFormDefinitions_();
    if (!Object.keys(merged).length) {
        return;
    }
    try {
        const intentName = getIntentDisplayNameFromDfEvent(event);
        if (
            intentName
            && merged.uploadDocument
            && /\b(upload|uploading|document|documents|file|files|attachment|attachments)\b/i.test(intentName)
        ) {
            setActiveContactFormId("uploadDocument");
            return;
        }
    } catch {
        /* ignore */
    }
    // Heuristic: infer from recent user lines when payload omits form_id (chips / follow-ups may not repeat "upload").
    try {
        const prev = readStoredClientContext();
        const qs = prev && Array.isArray(prev.user_queries) ? prev.user_queries : [];
        const recent = qs.slice(-8).map((q) => String(q || "").trim().toLowerCase());
        const uploadRe = /\b(upload|uploading|document|documents|docs|pdf|file|files|attachment|attachments)\b/i;
        if (merged.uploadDocument && recent.some((line) => line && uploadRe.test(line))) {
            setActiveContactFormId("uploadDocument");
            return;
        }
    } catch {
        /* ignore */
    }
    const defId = getDefaultContactFormId();
    if (defId && merged[defId]) {
        setActiveContactFormId(defId);
    }
}

/**
 * Switch which named form in `common.form.forms` is shown. There is no fixed limit on how
 * many forms you define — use any string key that exists on `forms` (e.g. `contact`, `appointment`, `otp`, `uploadDocument`, `newsletter`).
 * No-op when only legacy top-level `form.fields` / `contactForm.fields` is used (no `forms` object).
 * @param {string} formId
 */
function setActiveContactFormId(formId) {
    if (typeof formId !== "string" || !formId.trim()) {
        return;
    }
    let id = canonicalContactFormId_(formId.trim());
    /** Historically misspelled; map to canonical doctor appointment form key. */
    if (id === "appintmentformdocot") {
        id = "appintmentformdoctor";
    }
    const c = readCommonFormConfigRoot();
    const merged = getRuntimeMergedFormDefinitions_();
    const alias = typeof c.legacyAppointmentFormAlias === "string" ? c.legacyAppointmentFormAlias.trim() : "";
    if (id === "appointment" && alias && merged[alias]) {
        id = alias;
    }
    if (activeContactFormId === id) {
        return;
    }
    if (!merged[id]) {
        return;
    }
    activeContactFormId = id;
    mountContactFormFieldsFromConfig();
    applyContactFormLayoutFromConfig();
    applyContactFormHeaderFromConfig();
    applyLanguage(activeLanguage);
}

function applyContactFormHeaderFromConfig() {
    const cfg = readContactFormConfig();
    const lang = activeLanguage;
    const titleInline = pickContactFormLocalizedLine(cfg.titleByLanguage, lang);
    const subInline = pickContactFormLocalizedLine(cfg.subtitleByLanguage, lang);
    const t = document.querySelector("#dfchat-contact-form .dfchat-contact-form__title");
    const s = document.querySelector("#dfchat-contact-form .dfchat-contact-form__subtitle");
    if (t) {
        if (titleInline != null) {
            t.removeAttribute("data-i18n");
            t.textContent = titleInline;
        } else {
            t.setAttribute("data-i18n", cfg.titleI18nKey);
            t.textContent = getTranslation(cfg.titleI18nKey);
        }
    }
    if (s) {
        if (subInline != null) {
            s.removeAttribute("data-i18n");
            s.textContent = subInline;
        } else {
            s.setAttribute("data-i18n", cfg.subtitleI18nKey);
            s.textContent = getTranslation(cfg.subtitleI18nKey);
        }
        s.style.display = cfg.showSubtitle ? "" : "none";
    }
    const slot = document.getElementById("dfchat-contact-form-inputs");
    if (slot) {
        if (titleInline != null) {
            slot.removeAttribute("data-i18n-aria-label");
            slot.setAttribute("aria-label", titleInline);
        } else {
            slot.setAttribute("data-i18n-aria-label", cfg.titleI18nKey);
            slot.setAttribute("aria-label", getTranslation(cfg.titleI18nKey));
        }
    }
    if (cfg.formKey === "otp") {
        applyOtpFormStepSubtitle(getOtpFormStep());
    }
}

/**
 * @param {Record<string, unknown>} def
 * @param {string} raw
 * @returns {{ valid: boolean, messageKey?: string }}
 */
function validateContactFormField(def, raw) {
    if (!def || typeof def !== "object") {
        return { valid: true };
    }
    const v = typeof raw === "string" ? raw.trim() : "";
    const required = def.required !== false;
    if (required && v === "") {
        return { valid: false, messageKey: typeof def.i18nRequiredMessage === "string" && def.i18nRequiredMessage.trim()
            ? def.i18nRequiredMessage.trim()
            : "fieldRequired" };
    }
    if (v === "") {
        return { valid: true };
    }
    const t = (def.type || "text").toLowerCase();
    const validateAs = (typeof def.validateAs === "string" && def.validateAs.trim()
        ? def.validateAs
        : (t === "email" ? "email" : t === "tel" ? "phone" : ""))
        .toLowerCase();
    if (def.pattern) {
        try {
            if (!new RegExp(def.pattern).test(v)) {
                return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                    ? def.i18nInvalidMessage.trim()
                    : "invalidPattern" };
            }
        } catch {
            return { valid: false, messageKey: "invalidPattern" };
        }
    } else {
        if (validateAs === "email" && !EMAIL_VALIDATION_RE.test(v)) {
            return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                ? def.i18nInvalidMessage.trim()
                : "invalidEmail" };
        }
        if (validateAs === "phone") {
            const pat = typeof def.defaultPattern === "string" && def.defaultPattern.trim() ? def.defaultPattern.trim() : PHONE_DEFAULT_PATTERN;
            if (!new RegExp(pat).test(v)) {
                return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                    ? def.i18nInvalidMessage.trim()
                    : "invalidPhone" };
            }
        }
    }
    if (t === "date" && def.pastDateOnly === true && v !== "") {
        const picked = parseLocalYMDDate(v);
        if (!picked) {
            return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                ? def.i18nInvalidMessage.trim()
                : "invalidPastBirthDate" };
        }
        const today0 = new Date();
        today0.setHours(0, 0, 0, 0);
        if (picked >= today0) {
            return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                ? def.i18nInvalidMessage.trim()
                : "invalidPastBirthDate" };
        }
        const minStr = typeof def.pastDateMin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(def.pastDateMin.trim())
            ? def.pastDateMin.trim()
            : "1900-01-01";
        const minD = parseLocalYMDDate(minStr);
        if (minD && picked < minD) {
            return { valid: false, messageKey: typeof def.i18nInvalidMessage === "string" && def.i18nInvalidMessage.trim()
                ? def.i18nInvalidMessage.trim()
                : "invalidPastBirthDate" };
        }
    }
    return { valid: true };
}

function getContactFormFieldByPayloadName(name) {
    if (typeof name !== "string" || !name) {
        return null;
    }
    const defs = readContactFormConfig().fields;
    for (const def of defs) {
        if (def && def.name === name) {
            return def;
        }
    }
    return null;
}

function resolveContactFormFieldIconKey(field) {
    if (field && typeof field.icon === "string" && field.icon && CONTACT_FORM_SVG_ICONS[field.icon]) {
        return field.icon;
    }
    const t = (field && field.type || "text").toLowerCase();
    if (t === "textarea") {
        return "message";
    }
    if (t === "email") {
        return "email";
    }
    if (t === "tel") {
        return "phone";
    }
    if (t === "file") {
        return "file";
    }
    const nm = field && typeof field.name === "string" ? field.name : "";
    if (nm === "name") {
        return "user";
    }
    if (nm === "email") {
        return "email";
    }
    if (nm === "mobile" || nm === "phone") {
        return "phone";
    }
    if (nm === "url" || nm === "website" || nm === "link") {
        return "url";
    }
    if (t === "date" || t === "datetime-local" || t === "week" || t === "month") {
        return "calendar";
    }
    if (t === "appointmentdoctor" || t === "appointmentgeneral") {
        return "calendar";
    }
    if (t === "time") {
        return "clock";
    }
    if (nm === "location" || nm === "address" || nm === "venue") {
        return "location";
    }
    if (nm === "otp" || nm === "otpcode" || nm === "otp_code") {
        return "key";
    }
    return "user";
}

/**
 * Local calendar `YYYY-MM-DD` for `<input type="date">` (avoids UTC shift from `toISOString()`).
 * @param {Date} d
 * @returns {string}
 */
function formatLocalDateYMD(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
}

/**
 * Parse `YYYY-MM-DD` as local midnight.
 * @param {string} ymd
 * @returns {Date | null}
 */
function parseLocalYMDDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
    if (!m) {
        return null;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
        return null;
    }
    const dt = new Date(y, mo - 1, d);
    dt.setHours(0, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
        return null;
    }
    return dt;
}

function refreshContactFormPlaceholdersFromConfig() {
    const cfg = readContactFormConfig();
    if (!Array.isArray(cfg.fields)) {
        return;
    }
    for (const field of cfg.fields) {
        if (!field || !field.id || !field.placeholderByLanguage || typeof field.placeholderByLanguage !== "object") {
            continue;
        }
        const el = document.getElementById(field.id);
        if (!el || !("setAttribute" in el)) {
            continue;
        }
        const t = pickContactFormLocalizedLine(field.placeholderByLanguage, activeLanguage);
        if (t != null) {
            if (el.type === "file") {
                el.setAttribute("aria-label", t);
            } else {
                el.setAttribute("placeholder", t);
            }
        }
    }
}

function buildContactFormFieldRow(field) {
    if (!field || typeof field !== "object" || !field.id) {
        return null;
    }

    const t = (field.type || "text").toLowerCase();
    const phKey = field.i18nPlaceholder || "namePlaceholder";
    const pl0 = field.placeholderByLanguage && typeof field.placeholderByLanguage === "object"
        ? pickContactFormLocalizedLine(field.placeholderByLanguage, activeLanguage)
        : null;
    const required = field.required !== false;
    const iconKey = resolveContactFormFieldIconKey(field);

    const row = document.createElement("div");
    row.className = "dfchat-contact-form__row";
    row.setAttribute("data-icon", iconKey);

    const iconWrap = document.createElement("span");
    iconWrap.className = "dfchat-contact-form__row-icon";
    if (field.iconHtml && typeof field.iconHtml === "string" && field.iconHtml.indexOf("<") !== -1) {
        iconWrap.innerHTML = field.iconHtml;
    } else {
        const iconSvg = CONTACT_FORM_SVG_ICONS[iconKey] || CONTACT_FORM_SVG_ICONS.user;
        iconWrap.innerHTML = iconSvg;
    }

    let control;
    /** @type {HTMLDivElement | null} */
    let fileWrap = null;
    if (t === "textarea") {
        control = document.createElement("textarea");
        control.id = field.id;
        control.className = "dfchat-contact-form__control";
        control.name = typeof field.name === "string" ? field.name : field.id;
        const rows = typeof field.rows === "number" && field.rows > 0 ? field.rows : 2;
        control.setAttribute("rows", String(Math.min(rows, 6)));
        if (pl0 != null) {
            control.setAttribute("placeholder", pl0);
        } else {
            control.setAttribute("data-i18n-placeholder", phKey);
        }
        if (typeof field.i18nTitleKey === "string" && field.i18nTitleKey.trim()) {
            control.setAttribute("data-i18n-title", field.i18nTitleKey.trim());
        }
        if (typeof field.pattern === "string" && field.pattern.trim()) {
            control.setAttribute("pattern", field.pattern.trim());
        }
        if (typeof field.maxLength === "number" && field.maxLength > 0) {
            control.setAttribute("maxlength", String(field.maxLength));
        }
        if (typeof field.minLength === "number" && field.minLength > 0) {
            control.setAttribute("minlength", String(field.minLength));
        }
        if (required) {
            control.setAttribute("required", "");
        }
    } else if (t === "select") {
        control = document.createElement("select");
        control.id = field.id;
        control.className = "dfchat-contact-form__control";
        control.name = typeof field.name === "string" ? field.name : field.id;
        if (required) {
            control.setAttribute("required", "");
        }

        /** @type {Array<{ label: string, value: string }>} */
        const opts = Array.isArray(field.options)
            ? field.options
                .map((o) => ({
                    label: String(o && o.label != null ? o.label : "").trim(),
                    value: String(o && o.value != null ? o.value : "").trim()
                }))
                .filter((o) => o.label && o.value)
            : [];

        const placeholderText =
            pl0 != null
                ? pl0
                : (field.placeholderByLanguage && typeof field.placeholderByLanguage === "object"
                    ? pickContactFormLocalizedLine(field.placeholderByLanguage, activeLanguage)
                    : null);

        if (placeholderText) {
            const ph = document.createElement("option");
            ph.value = "";
            ph.textContent = placeholderText;
            ph.disabled = true;
            ph.selected = true;
            control.appendChild(ph);
        }

        for (const o of opts) {
            const op = document.createElement("option");
            op.value = o.value;
            op.textContent = o.label;
            control.appendChild(op);
        }
    } else if (t === "file") {
        control = document.createElement("input");
        control.type = "file";
        control.id = field.id;
        control.className = "dfchat-contact-form__control dfchat-contact-form__control--file dfchat-contact-form__control--file-lg";
        control.name = typeof field.name === "string" ? field.name : field.id;
        if (field.multiple === true) {
            control.setAttribute("multiple", "multiple");
        }
        if (typeof field.accept === "string" && field.accept.trim()) {
            control.setAttribute("accept", field.accept.trim());
        }
        const ariaKey = typeof field.i18nAriaKey === "string" && field.i18nAriaKey.trim()
            ? field.i18nAriaKey.trim()
            : "documentUploadAria";
        if (pl0 != null) {
            control.setAttribute("aria-label", pl0);
        } else {
            control.setAttribute("data-i18n-aria-label", ariaKey);
            control.setAttribute("aria-label", getTranslation(ariaKey));
        }
        if (required) {
            control.setAttribute("required", "");
        }
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "dfchat-contact-form__file-clear";
        clearBtn.setAttribute("data-i18n", "clearFileSelectionButton");
        clearBtn.textContent = getTranslation("clearFileSelectionButton");
        clearBtn.hidden = true;
        const syncFileClearVisible = () => {
            clearBtn.hidden = !control.files || control.files.length === 0;
        };
        clearBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            control.value = "";
            clearBtn.hidden = true;
            const st = document.getElementById("dfchat-contact-form-status");
            if (st) {
                st.textContent = "";
                st.classList.remove("is-error", "is-success");
            }
        });
        control.addEventListener("change", () => {
            const st = document.getElementById("dfchat-contact-form-status");
            if (!control.files || !control.files.length) {
                syncFileClearVisible();
                return;
            }
            for (let fi = 0; fi < control.files.length; fi += 1) {
                if (isContactFormVideoUploadFile(control.files[fi])) {
                    if (st) {
                        st.textContent = getTranslation("invalidVideoFile");
                        st.classList.add("is-error");
                        st.classList.remove("is-success");
                    }
                    control.value = "";
                    syncFileClearVisible();
                    return;
                }
            }
            if (st) {
                st.textContent = "";
                st.classList.remove("is-error", "is-success");
            }
            syncFileClearVisible();
        });
        fileWrap = document.createElement("div");
        fileWrap.className = "dfchat-contact-form__file-wrap";
        fileWrap.appendChild(control);
        fileWrap.appendChild(clearBtn);
    } else if (t === "hidden") {
        control = document.createElement("input");
        control.type = "hidden";
        control.id = field.id;
        control.className = "dfchat-contact-form__control";
        control.name = typeof field.name === "string" ? field.name : field.id;
        if (typeof field.value === "string" && field.value) {
            control.value = field.value;
        }
        row.style.display = "none";
        row.appendChild(control);
        return row;
    } else if (t === "appointmentdoctor" || t === "appointmentgeneral") {
        const shell = document.createElement("div");
        shell.className = "dfchat-contact-form__appointment-shell";
        shell.style.cssText = "width:100%;max-width:100%;box-sizing:border-box";
        row.classList.add("dfchat-contact-form__row--appointment");
        row.appendChild(iconWrap);
        row.appendChild(shell);
        window.queueMicrotask(() => {
            mountContactFormAppointmentPicker(shell, field, t === "appointmentdoctor");
        });
        return row;
    } else {
        control = document.createElement("input");
        control.id = field.id;
        control.className = "dfchat-contact-form__control";
        control.name = typeof field.name === "string" ? field.name : field.id;
        control.type = CONTACT_FORM_INPUT_TYPES.has(t) ? t : "text";
        if (t === "date") {
            if (field.pastDateOnly === true) {
                const today0 = new Date();
                today0.setHours(0, 0, 0, 0);
                const yesterday = new Date(today0);
                yesterday.setDate(yesterday.getDate() - 1);
                const minRaw = typeof field.pastDateMin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(field.pastDateMin.trim())
                    ? field.pastDateMin.trim()
                    : "1900-01-01";
                control.min = minRaw;
                control.max = formatLocalDateYMD(yesterday);
            } else {
                const today = new Date();
                const minDate = new Date(today);
                if (!APPOINTMENT_DATE_CONFIG.allowToday) {
                    minDate.setDate(today.getDate() + 1);
                }
                const maxDate = new Date(today);
                maxDate.setDate(today.getDate() + APPOINTMENT_DATE_CONFIG.maxDaysAhead);
                control.min = minDate.toISOString().split('T')[0];
                control.max = maxDate.toISOString().split('T')[0];
            }
        }
        if (pl0 != null) {
            control.setAttribute("placeholder", pl0);
        } else {
            control.setAttribute("data-i18n-placeholder", phKey);
        }
        if (typeof field.autocomplete === "string" && field.autocomplete) {
            control.setAttribute("autocomplete", field.autocomplete);
        }
        if (typeof field.inputMode === "string" && field.inputMode) {
            control.setAttribute("inputmode", field.inputMode);
        }
        if (typeof field.i18nTitleKey === "string" && field.i18nTitleKey.trim()) {
            control.setAttribute("data-i18n-title", field.i18nTitleKey.trim());
        }
        if (typeof field.pattern === "string" && field.pattern.trim()) {
            control.setAttribute("pattern", field.pattern.trim());
        }
        if (typeof field.maxLength === "number" && field.maxLength > 0) {
            control.setAttribute("maxlength", String(field.maxLength));
        }
        if (typeof field.minLength === "number" && field.minLength > 0) {
            control.setAttribute("minlength", String(field.minLength));
        }
        if (required) {
            control.setAttribute("required", "");
        }
    }

    row.appendChild(iconWrap);
    row.appendChild(fileWrap != null ? fileWrap : control);
    return row;
}

/**
 * Value stored in the hidden field and sent as `appointmentdate`: DD-MM-YYYY.
 * Slot APIs still use YYYY-MM-DD from the calendar grid.
 * @param {string} dateISO
 * @returns {string}
 */
function formatAppointmentDateCapturedFromIso_(dateISO) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || "").trim());
    if (!m) {
        return String(dateISO || "").trim();
    }
    return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Month + slot picker for contact-form appointment fields (doctor-specific or shared general pool).
 * @param {HTMLElement} hostEl
 * @param {Record<string, unknown>} field
 * @param {boolean} isDoctor
 */
function mountContactFormAppointmentPicker(hostEl, field, isDoctor) {
    const hidD = document.createElement("input");
    hidD.type = "hidden";
    hidD.id = typeof field.hiddenDateId === "string" && field.hiddenDateId.trim()
        ? field.hiddenDateId.trim()
        : `${field.id}__date`;
    hidD.value = "";

    const hidT = document.createElement("input");
    hidT.type = "hidden";
    hidT.id = typeof field.hiddenTimeId === "string" && field.hiddenTimeId.trim()
        ? field.hiddenTimeId.trim()
        : `${field.id}__time`;
    hidT.value = "";

    hostEl.appendChild(hidD);
    hostEl.appendChild(hidT);

    const doctorId = isDoctor && typeof window !== "undefined" && window.__dfchatBookingDoctorId
        ? String(window.__dfchatBookingDoctorId).trim()
        : "";

    if (isDoctor && !doctorId) {
        const w = document.createElement("div");
        w.style.cssText = "font:600 12px/1.35 Manrope,sans-serif;color:#b45309;padding:6px 0";
        w.textContent = "Choose a doctor from the chat carousel first, then open this form again.";
        hostEl.appendChild(w);
        return;
    }

    const legend = document.createElement("div");
    legend.style.cssText = "font:600 11px/1.3 Manrope,sans-serif;color:rgba(15,23,42,0.7);margin:0 0 8px";
    legend.textContent = "Green = available · Red = booked · Grey = closed";

    const nav = document.createElement("div");
    nav.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin:0 0 6px";

    const monthLabel = document.createElement("div");
    monthLabel.style.cssText = "font:700 12px/1.2 Manrope,sans-serif";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "◀";
    prevBtn.style.cssText = "appearance:none;border:1px solid rgba(148,163,184,0.45);border-radius:8px;background:#fff;padding:2px 8px;cursor:pointer;font-size:12px";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "▶";
    nextBtn.style.cssText = prevBtn.style.cssText;

    nav.appendChild(prevBtn);
    nav.appendChild(monthLabel);
    nav.appendChild(nextBtn);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:8px";

    const slotsHint = document.createElement("div");
    slotsHint.setAttribute("role", "status");
    slotsHint.setAttribute("aria-live", "polite");
    slotsHint.style.cssText = "font:600 11px/1.35 Manrope,sans-serif;color:rgba(15,23,42,0.75);margin:6px 0 4px;min-height:1.35em";
    slotsHint.textContent = getTranslation("appointmentPickerPickDayIntro");

    const slotsFlex = document.createElement("div");
    slotsFlex.style.cssText = "display:flex;flex-wrap:wrap;gap:5px";

    hostEl.appendChild(legend);
    hostEl.appendChild(nav);
    hostEl.appendChild(grid);
    hostEl.appendChild(slotsHint);
    hostEl.appendChild(slotsFlex);

    const view = { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };

    /** YYYY-MM-DD of the day cell currently highlighted as chosen (must match a working day). */
    let selectedCalendarDateISO = "";

    /** @type {HTMLButtonElement | null} */
    let selectedSlotEl = null;

    const STYLE_APPT_SLOT_FREE =
        "appearance:none;border-radius:8px;padding:6px 10px;min-width:52px;font:800 11px/1.2 Manrope,sans-serif;"
        + "border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.14);color:#166534;cursor:pointer;"
        + "transition:box-shadow .15s ease,transform .12s ease,border-color .15s ease";
    const STYLE_APPT_SLOT_BOOKED =
        "appearance:none;border-radius:8px;padding:6px 10px;min-width:52px;font:800 11px/1.2 Manrope,sans-serif;"
        + "border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.2);color:#991b1b;cursor:not-allowed;"
        + "opacity:0.95";
    const STYLE_APPT_SLOT_SELECTED =
        "appearance:none;border-radius:8px;padding:6px 10px;min-width:52px;font:800 11px/1.2 Manrope,sans-serif;"
        + "border:2px solid rgba(37,99,235,0.95);background:rgba(59,130,246,0.3);color:#1e3a8a;cursor:pointer;"
        + "box-shadow:0 0 0 3px rgba(37,99,235,0.4),0 3px 10px rgba(37,99,235,0.22);transform:scale(1.04);"
        + "z-index:1;position:relative";

    /** @type {Record<string, { working?: boolean, bookedCount?: number, totalSlots?: number }> | null} */
    let overviewDays = null;

    async function fetchOverview() {
        const monthKey = `${view.y}-${String(view.m).padStart(2, "0")}`;
        const ep = isDoctor ? "/api/doctor-month-overview" : "/api/general-month-overview";
        const apiBase = getApiEndpoint(ep);
        if (!apiBase) {
            overviewDays = null;
            return;
        }
        const u = new URL(apiBase);
        if (isDoctor) {
            u.searchParams.set("doctorId", doctorId);
        }
        u.searchParams.set("month", monthKey);
        if (!isDoctor) {
            const gsm = readConfiguredGeneralAppointmentSlotMinutes_();
            if (gsm != null) {
                u.searchParams.set("generalSlotMinutes", String(gsm));
            }
        }
        try {
            const r = await fetch(u.toString(), { credentials: "omit" });
            const j = await r.json();
            overviewDays = j && j.ok && j.days ? /** @type {Record<string, { working?: boolean, bookedCount?: number, totalSlots?: number }>} */ (j.days) : null;
        } catch {
            overviewDays = null;
        }
    }

    function monthLabelFmt() {
        return new Date(view.y, view.m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    }

    async function renderCal() {
        monthLabel.textContent = monthLabelFmt();
        while (grid.firstChild) {
            grid.removeChild(grid.firstChild);
        }
        await fetchOverview();

        const dow = document.createElement("div");
        dow.style.cssText = "grid-column:1/-1;display:grid;grid-template-columns:repeat(7,1fr);gap:3px;font:600 9px/1 Manrope,sans-serif;color:rgba(15,23,42,0.5);text-align:center;margin-bottom:2px";
        ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d) => {
            const x = document.createElement("div");
            x.textContent = d;
            dow.appendChild(x);
        });
        grid.appendChild(dow);

        const firstDow = new Date(view.y, view.m - 1, 1).getDay();
        const monOffset = (firstDow + 6) % 7;
        const dim = new Date(view.y, view.m, 0).getDate();
        for (let i = 0; i < monOffset; i += 1) {
            grid.appendChild(document.createElement("div"));
        }
        const ty = new Date().getFullYear();
        const tm = new Date().getMonth() + 1;
        const td = new Date().getDate();

        for (let day = 1; day <= dim; day += 1) {
            const dateISO = `${view.y}-${String(view.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dateObj = new Date(view.y, view.m - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const minDate = new Date(today);
            if (!APPOINTMENT_DATE_CONFIG.allowToday) {
                minDate.setDate(today.getDate() + 1);
            }
            const maxDate = new Date(today);
            maxDate.setDate(today.getDate() + APPOINTMENT_DATE_CONFIG.maxDaysAhead);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = String(day);
            btn.style.cssText = "border-radius:6px;padding:4px 0;font:700 11px/1 Manrope,sans-serif;border:1px solid transparent";
            if (dateObj < minDate || dateObj > maxDate) {
                btn.style.background = "rgba(148,163,184,0.22)";
                btn.style.color = "rgba(15,23,42,0.35)";
                btn.disabled = true;
                grid.appendChild(btn);
                continue;
            }
            const info = overviewDays ? overviewDays[dateISO] : null;
            if (!info || !info.working) {
                btn.style.background = "rgba(148,163,184,0.22)";
                btn.style.color = "rgba(15,23,42,0.35)";
                btn.disabled = true;
            } else {
                const booked = Number(info.bookedCount || 0);
                const total = Number(info.totalSlots || 0);
                if (total > 0 && booked >= total) {
                    btn.style.background = "rgba(239,68,68,0.18)";
                    btn.style.borderColor = "rgba(239,68,68,0.35)";
                    btn.style.color = "#991b1b";
                } else if (booked > 0) {
                    btn.style.background = "rgba(234,179,8,0.15)";
                    btn.style.borderColor = "rgba(234,179,8,0.4)";
                } else {
                    btn.style.background = "rgba(34,197,94,0.14)";
                    btn.style.borderColor = "rgba(34,197,94,0.4)";
                    btn.style.color = "#166534";
                }
                if (ty === view.y && tm === view.m && td === day) {
                    btn.style.boxShadow = "0 0 0 2px rgba(3,105,161,0.35)";
                }
                if (selectedCalendarDateISO && dateISO === selectedCalendarDateISO) {
                    btn.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.55),0 2px 8px rgba(37,99,235,0.2)";
                    btn.style.borderColor = "rgba(37,99,235,0.95)";
                    btn.style.borderWidth = "2px";
                    btn.style.transform = "scale(1.06)";
                    btn.style.zIndex = "2";
                    btn.style.position = "relative";
                    btn.setAttribute("aria-pressed", "true");
                } else {
                    btn.setAttribute("aria-pressed", "false");
                }
                btn.addEventListener("click", () => {
                    selectedCalendarDateISO = dateISO;
                    void (async () => {
                        await renderCal();
                        await loadSlots(dateISO);
                    })();
                });
            }
            grid.appendChild(btn);
        }
    }

    async function loadSlots(dateISO) {
        selectedSlotEl = null;
        const capturedDate = formatAppointmentDateCapturedFromIso_(dateISO);
        hidD.value = capturedDate;
        hidT.value = "";
        slotsFlex.innerHTML = "";
        slotsHint.style.color = "";
        slotsHint.style.fontWeight = "";
        slotsHint.textContent =
            `${getTranslation("appointmentPickerChooseTime")} (${capturedDate})`;
        const apiUrl = getApiEndpoint(isDoctor ? "/api/slots" : "/api/general-slots");
        if (!apiUrl) {
            return;
        }
        const u = new URL(apiUrl);
        if (isDoctor) {
            u.searchParams.set("doctorId", doctorId);
        }
        u.searchParams.set("date", dateISO);
        if (!isDoctor) {
            const gsmLs = readConfiguredGeneralAppointmentSlotMinutes_();
            if (gsmLs != null) {
                u.searchParams.set("generalSlotMinutes", String(gsmLs));
            }
        }
        try {
            const r = await fetch(u.toString(), { credentials: "omit" });
            const j = await r.json();
            const statuses = j && Array.isArray(j.slotStatuses) ? j.slotStatuses : [];
            if (!statuses.length) {
                slotsHint.textContent = "No slots this day.";
                return;
            }
            statuses.forEach((row) => {
                const label = row && row.label ? String(row.label) : "";
                if (!label) {
                    return;
                }
                const booked = row && row.status === "booked";
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = label;
                b.setAttribute("aria-pressed", "false");
                if (booked) {
                    b.style.cssText = STYLE_APPT_SLOT_BOOKED;
                    b.setAttribute("aria-disabled", "true");
                    b.title = getTranslation("appointmentSlotAlreadyBooked");
                    b.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        slotsHint.textContent = getTranslation("appointmentSlotAlreadyBooked");
                        slotsHint.style.color = "#991b1b";
                        slotsHint.style.fontWeight = "700";
                        window.setTimeout(() => {
                            slotsHint.style.color = "";
                            slotsHint.style.fontWeight = "";
                        }, 5000);
                    });
                } else {
                    b.style.cssText = STYLE_APPT_SLOT_FREE;
                    b.addEventListener("click", () => {
                        if (selectedSlotEl && selectedSlotEl !== b) {
                            selectedSlotEl.style.cssText = STYLE_APPT_SLOT_FREE;
                            selectedSlotEl.setAttribute("aria-pressed", "false");
                        }
                        selectedSlotEl = b;
                        b.style.cssText = STYLE_APPT_SLOT_SELECTED;
                        b.setAttribute("aria-pressed", "true");
                        hidT.value = label;
                        slotsHint.style.color = "";
                        slotsHint.style.fontWeight = "";
                        slotsHint.textContent =
                            `${getTranslation("appointmentPickerSelected")}: ${capturedDate} · ${label}`;
                    });
                }
                slotsFlex.appendChild(b);
            });
            window.requestAnimationFrame(() => {
                try {
                    slotsFlex.scrollIntoView({ block: "nearest", behavior: "smooth" });
                } catch {
                    slotsFlex.scrollIntoView({ block: "nearest" });
                }
                const firstPick = slotsFlex.querySelector("button:not([aria-disabled=\"true\"])");
                if (firstPick && typeof firstPick.focus === "function") {
                    firstPick.focus({ preventScroll: true });
                }
            });
        } catch {
            slotsHint.textContent = "Could not load slots.";
        }
    }

    function resetAppointmentPickerMonthNav_() {
        selectedCalendarDateISO = "";
        selectedSlotEl = null;
        hidD.value = "";
        hidT.value = "";
        slotsFlex.innerHTML = "";
        slotsHint.style.color = "";
        slotsHint.style.fontWeight = "";
        slotsHint.textContent = getTranslation("appointmentPickerPickDayIntro");
    }

    prevBtn.addEventListener("click", () => {
        view.m -= 1;
        if (view.m < 1) {
            view.m = 12;
            view.y -= 1;
        }
        resetAppointmentPickerMonthNav_();
        void renderCal();
    });
    nextBtn.addEventListener("click", () => {
        view.m += 1;
        if (view.m > 12) {
            view.m = 1;
            view.y += 1;
        }
        resetAppointmentPickerMonthNav_();
        void renderCal();
    });

    void renderCal();
}

function syncAppointmentDoctorHiddenFromSession() {
    try {
        const cfg = readContactFormConfig();
        if (cfg.formKey !== "appintmentformdoctor") {
            return;
        }
        const docEl = document.getElementById("afd-doctor");
        if (docEl && typeof window !== "undefined" && window.__dfchatBookingDoctorId) {
            docEl.value = String(window.__dfchatBookingDoctorId).trim();
        }
    } catch {
        /* ignore */
    }
}

/** Hide name/mobile/email rows on appointment forms when session already has name + mobile (email optional). */
function syncSuppressAppointmentContactRows_() {
    try {
        const cfg = readContactFormConfig();
        const fk = cfg.formKey;
        if (fk !== "appintmentformdoctor" && fk !== "appintmentformgeneral") {
            return;
        }
        const suppress = sessionHasNameAndMobileForSkip_();
        const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        for (let i = 0; i < fields.length; i += 1) {
            const field = fields[i];
            if (!field || !field.id || typeof field.name !== "string") {
                continue;
            }
            const nm = String(field.name).trim().toLowerCase();
            if (nm !== "name" && nm !== "mobile" && nm !== "email") {
                continue;
            }
            const el = document.getElementById(field.id);
            const row = el && el.closest(".dfchat-contact-form__row");
            if (row) {
                row.style.display = suppress ? "none" : "";
            }
        }
    } catch {
        /* ignore */
    }
}

/**
 * Wider/taller scroll area for appointment forms — base CSS caps `#dfchat-contact-form-inputs` at 220px
 * and docked layout used to cap at 240px, which hid slot chips below the calendar.
 */
function syncContactFormAppointmentModeClass_() {
    const formRoot = document.getElementById("dfchat-contact-form");
    if (!formRoot) {
        return;
    }
    const fields = readContactFormConfig().fields;
    let hasAppointment = false;
    if (Array.isArray(fields)) {
        for (let i = 0; i < fields.length; i += 1) {
            const f = fields[i];
            const t = String(f && f.type || "").toLowerCase();
            if (t === "appointmentdoctor" || t === "appointmentgeneral") {
                hasAppointment = true;
                break;
            }
        }
    }
    formRoot.classList.toggle("dfchat-contact-form--has-appointment", hasAppointment);
}

/**
 * Before replacing inline form markup, persist name/mobile/email typed in the current form into
 * `client_context` so opening the appointment form (or another form step) keeps what the visitor already entered.
 */
function mergeContactIdentityFieldsFromLiveDomIntoStoredContext_() {
    try {
        const slot = document.getElementById("dfchat-contact-form-inputs");
        if (!slot) {
            return;
        }
        const prev = readStoredClientContext();
        /** @type {Record<string, unknown>} */
        const next = Object.assign({}, prev);
        let changed = false;
        /** @type {Record<string, true>} */
        const tracked = { name: true, email: true, mobile: true };
        const nodes = slot.querySelectorAll(
            "input.dfchat-contact-form__control[name], textarea.dfchat-contact-form__control[name]"
        );
        for (let i = 0; i < nodes.length; i += 1) {
            const el = nodes[i];
            const nmRaw = typeof el.getAttribute === "function" ? el.getAttribute("name") : "";
            const nm = typeof nmRaw === "string" ? nmRaw.trim() : "";
            if (!nm || !tracked[nm]) {
                continue;
            }
            const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
            const typ = typeof input.type === "string" ? input.type.toLowerCase() : "";
            if (typ === "hidden" || typ === "file") {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(input, "value")) {
                continue;
            }
            const v = dfParameterScalarToString(input.value);
            if (!v) {
                continue;
            }
            if (nm === "email" && !EMAIL_VALIDATION_RE.test(v)) {
                continue;
            }
            if (String(next[nm] || "").trim() !== v) {
                next[nm] = v;
                changed = true;
            }
        }
        if (changed) {
            persistClientContext(next);
        }
    } catch {
        /* ignore */
    }
}

function mountContactFormFieldsFromConfig() {
    mergeContactIdentityFieldsFromLiveDomIntoStoredContext_();
    const slot = document.getElementById("dfchat-contact-form-inputs");
    if (!slot) {
        return;
    }
    while (slot.firstChild) {
        slot.removeChild(slot.firstChild);
    }

    for (const field of readContactFormConfig().fields) {
        const row = buildContactFormFieldRow(field);
        if (row) {
            slot.appendChild(row);
        }
    }
    syncContactFormNoValidateForActiveForm();
    setupOtpFormTwoStepIfNeeded();
    syncContactFormAppointmentModeClass_();
    syncAppointmentDoctorHiddenFromSession();
    applyStoredContactHintsToOpenContactForm_();
    syncSuppressAppointmentContactRows_();
}

function applyContactFormLayoutFromConfig() {
    const cfg = readContactFormConfig();
    const cf = document.getElementById("dfchat-contact-form");
    const card = document.querySelector("#dfchat-contact-form .dfchat-contact-form__card");
    if (card && (!cf || !cf.classList.contains("dfchat-contact-form--docked"))) {
        card.style.maxHeight = `${cfg.maxCardHeightPx}px`;
    }

    const subtitle = document.querySelector("#dfchat-contact-form .dfchat-contact-form__subtitle");
    if (subtitle) {
        subtitle.style.display = cfg.showSubtitle ? "" : "none";
    }
    syncContactFormAppointmentModeClass_();
}

function stripContactFormDocking() {
    const el = document.getElementById("dfchat-contact-form");
    if (!el) {
        return;
    }
    el.classList.remove("dfchat-contact-form--docked");
    el.style.removeProperty("position");
    el.style.removeProperty("left");
    el.style.removeProperty("right");
    el.style.removeProperty("top");
    el.style.removeProperty("bottom");
    el.style.removeProperty("width");
    el.style.removeProperty("max-height");
    el.style.removeProperty("z-index");
    const card = el.querySelector(".dfchat-contact-form__card");
    if (card) {
        card.style.removeProperty("max-height");
    }
    const inputs = el.querySelector(".dfchat-contact-form__inputs");
    if (inputs) {
        inputs.style.removeProperty("max-height");
        inputs.style.removeProperty("min-height");
    }
    applyContactFormLayoutFromConfig();
}

/** When chat is minimized, dock coords are cleared — inline `position:fixed` without insets sticks to 0,0. Pin like company.css defaults. */
function applyContactFormFallbackFixedPosition(el) {
    if (!el) {
        return;
    }
    const mobile = typeof isMobileViewport === "function" && isMobileViewport();
    const side = resolveChatLayoutSide(readCompanyUiConfig());
    const c0 = readContactFormConfig();
    const deskPad = 33;
    el.style.position = "fixed";
    el.style.zIndex = "2147483630";
    if (mobile) {
        const pl = typeof c0.sideInsetLeftPx === "number" && Number.isFinite(c0.sideInsetLeftPx) ? c0.sideInsetLeftPx : 15;
        const pr = typeof c0.sideInsetRightPx === "number" && Number.isFinite(c0.sideInsetRightPx) ? c0.sideInsetRightPx : 15;
        el.style.left = `${pl}px`;
        el.style.right = `${pr}px`;
        el.style.width = "auto";
        /* Match company.css: 92px → 100px lower (toward bottom) */
        el.style.bottom = "8px";
    } else if (side === "left") {
        el.style.right = "auto";
        el.style.left = `${deskPad}px`;
        el.style.width = "";
        el.style.bottom = "6px";
    } else {
        el.style.left = "auto";
        el.style.right = `${deskPad}px`;
        el.style.width = "";
        el.style.bottom = "6px";
    }
    el.style.top = "auto";
    el.style.removeProperty("max-height");
}

function syncContactFormPosition() {
    const el = document.getElementById("dfchat-contact-form");
    if (!el || !el.classList.contains("dfchat-is-open")) {
        if (el && el.classList.contains("dfchat-contact-form--docked")) {
            stripContactFormDocking();
        }
        return;
    }

    syncContactFormAppointmentModeClass_();

    const cfg = readContactFormConfig();
    if (!cfg.dockToChatWindow) {
        if (el.classList.contains("dfchat-contact-form--docked")) {
            stripContactFormDocking();
        }
        return;
    }

    if (!isChatWindowOpen) {
        if (el.classList.contains("dfchat-contact-form--docked")) {
            stripContactFormDocking();
        }
        applyContactFormFallbackFixedPosition(el);
        return;
    }

    const messenger = activeDfMessenger || document.querySelector("df-messenger");
    if (!messenger) {
        return;
    }

    const rect = findChatWindowRect(messenger);
    if (!rect || rect.width < 80) {
        return;
    }

    const side = resolveChatLayoutSide(readCompanyUiConfig());
    const padL = typeof cfg.sideInsetLeftPx === "number" && Number.isFinite(cfg.sideInsetLeftPx) ? cfg.sideInsetLeftPx : cfg.sideInsetPx;
    const padR = typeof cfg.sideInsetRightPx === "number" && Number.isFinite(cfg.sideInsetRightPx) ? cfg.sideInsetRightPx : cfg.sideInsetPx;
    const pad = (padL + padR) / 2;
    const formMaxOuter = typeof cfg.formDockMaxWidthPx === "number" && Number.isFinite(cfg.formDockMaxWidthPx) && cfg.formDockMaxWidthPx > 0
        ? cfg.formDockMaxWidthPx
        : (isMobileViewport() ? 340 : 420);
    const formW = Math.min(formMaxOuter, Math.max(200, rect.width - padL - padR));
    const card = el.querySelector(".dfchat-contact-form__card");
    const inputs = el.querySelector(".dfchat-contact-form__inputs");

    let fromTop;
    let sectionMaxH;
    let useBottom = false;
    const gap = cfg.gapAboveFooterPx;

    if (cfg.dockAboveFooter) {
        const insertion = findFooterInlineInsertionPoint(messenger);
        const targetRow = insertion && insertion.parent ? insertion.parent : null;
        const footerHost0 = resolveFooterMountHost(messenger) || findChatFooterHost(messenger);
        let anchorTopY = null;
        if (targetRow && typeof targetRow.getBoundingClientRect === "function") {
            const r0 = targetRow.getBoundingClientRect();
            if (r0 && r0.width > 0 && r0.height > 0) {
                anchorTopY = r0.top;
            }
        }
        if (anchorTopY == null && footerHost0 && typeof footerHost0.getBoundingClientRect === "function") {
            const r1 = footerHost0.getBoundingClientRect();
            if (r1 && r1.height > 0) {
                anchorTopY = r1.top;
            }
        }
        if (anchorTopY == null) {
            anchorTopY = Math.max(rect.top, rect.bottom - 100);
        }

        const formBottomY = anchorTopY - gap;
        const roomAbove = formBottomY - rect.top;
        if (formBottomY > rect.top + 10 && roomAbove > 0) {
            useBottom = true;
            fromTop = formBottomY;
            sectionMaxH = Math.max(160, Math.min(cfg.maxCardHeightPx + 80, roomAbove - 2));
        }
    }

    if (!useBottom) {
        fromTop = rect.top + cfg.titleInsetPx + cfg.dockNudgeDownPx;
        const availableBelowTop = Math.floor(rect.bottom - fromTop - pad);
        const panelH = Math.max(220, Math.min(availableBelowTop, rect.height - cfg.titleInsetPx));
        sectionMaxH = Math.max(180, Math.min(cfg.maxCardHeightPx + 80, panelH));
    }

    const cardMax = Math.max(150, Math.min(cfg.maxCardHeightPx, sectionMaxH - 6));
    const hasAppointment = el.classList.contains("dfchat-contact-form--has-appointment");
    /** Undocked CSS raises appointment strip; docked used to cap ~240px — too small for calendar + slots + fields. */
    let inputsMax = hasAppointment
        ? Math.min(560, Math.max(120, cardMax - 85))
        : Math.max(100, Math.min(240, cardMax - 160));
    /** Reserve space for header + status + Submit (appointment calendar needs more vertical slack than plain fields). */
    const cardFooterReserve = hasAppointment ? 118 : 64;
    inputsMax = Math.min(inputsMax, Math.max(100, Math.floor(cardMax - cardFooterReserve)));

    el.classList.add("dfchat-contact-form--docked");
    el.style.position = "fixed";
    // Below Powered by (2147483642), above the page; language bar stays 2147483647.
    el.style.zIndex = "2147483630";
    el.style.width = `${formW}px`;
    if (side === "right") {
        el.style.left = "auto";
        el.style.right = `${Math.max(0, window.innerWidth - rect.right + padR)}px`;
    } else {
        el.style.right = "auto";
        el.style.left = `${Math.max(0, rect.left + padL)}px`;
    }

    if (useBottom) {
        el.style.top = "auto";
        el.style.bottom = `${window.innerHeight - fromTop}px`;
        el.style.maxHeight = `${sectionMaxH}px`;
    } else {
        el.style.removeProperty("bottom");
        el.style.removeProperty("max-height");
        el.style.top = `${fromTop}px`;
    }

    if (card) {
        card.style.maxHeight = `${cardMax}px`;
    }
    if (inputs) {
        inputs.style.maxHeight = `${inputsMax}px`;
        if (hasAppointment) {
            /** Never set min-height above max-height — otherwise flex clips status + Submit below the card. */
            const minWant = Math.min(340, Math.max(120, inputsMax - 4));
            inputs.style.minHeight = `${Math.min(minWant, inputsMax)}px`;
        } else {
            inputs.style.removeProperty("min-height");
        }
    }
}

function readPoweredByStyleConfig() {
    const c = POWERED_BY_CONFIG;
    const n = (value, defaultValue) => (typeof value === "number" && Number.isFinite(value) ? value : defaultValue);
    const colorRaw = c && typeof c.color === "string" ? c.color.trim() : "";
    const alignRaw = c && typeof c.textAlign === "string" ? c.textAlign.trim().toLowerCase() : "";
    const textAlign = alignRaw === "left" || alignRaw === "right" || alignRaw === "center" ? alignRaw : "center";
    return {
        offsetTopPx: n(c && c.offsetTopPx, 0),
        offsetLeftPx: n(c && c.offsetLeftPx, 0),
        nudgeUpPx: n(c && c.nudgeUpPx, 0),
        nudgeDownPx: n(c && c.nudgeDownPx, 0),
        nudgeLeftPx: n(c && c.nudgeLeftPx, 0),
        nudgeRightPx: n(c && c.nudgeRightPx, 0),
        widthOffsetPx: n(c && c.widthOffsetPx, 0),
        lineHeightPx: Math.max(12, n(c && c.lineHeightPx, 18)),
        marginPx: Math.max(0, n(c && c.marginPx, 0)),
        gapAboveComposerPx: n(c && c.gapAboveComposerPx, 2),
        fallbackGapFromWindowBottomPx: n(c && c.fallbackGapFromWindowBottomPx, 4),
        color: colorRaw || "#94a3b8",
        fontSizePx: Math.max(8, n(c && c.fontSizePx, 10)),
        textAlign
    };
}

function isFeatureEnabled(value, defaultValue = true) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return defaultValue;
        }
        return value !== 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return defaultValue;
        }

        if (["false", "0", "no", "off", "disabled"].includes(normalized)) {
            return false;
        }

        if (["true", "1", "yes", "on", "enabled"].includes(normalized)) {
            return true;
        }
    }

    return defaultValue;
}

function isFeatureEnabledFromConfig(config, defaultValue = true) {
    if (!config || typeof config !== "object") {
        return defaultValue;
    }

    if (Object.prototype.hasOwnProperty.call(config, "enabled")) {
        return isFeatureEnabled(config.enabled, defaultValue);
    }

    if (Object.prototype.hasOwnProperty.call(config, "enable")) {
        return isFeatureEnabled(config.enable, defaultValue);
    }

    if (Object.prototype.hasOwnProperty.call(config, "disabled")) {
        return !isFeatureEnabled(config.disabled, false);
    }

    if (Object.prototype.hasOwnProperty.call(config, "disable")) {
        return !isFeatureEnabled(config.disable, false);
    }

    return defaultValue;
}

function normalizeLanguageCode(code) {
    return typeof code === "string" ? code.trim().toLowerCase() : "";
}

function applyThemeConfig(config) {
    if (!config || typeof config !== "object") {
        return;
    }

    const common = config.common && typeof config.common === "object" ? config.common : {};
    const theme = common.theme && typeof common.theme === "object" ? common.theme : null;
    if (theme) {
        for (const [key, value] of Object.entries(theme)) {
            if (typeof key === "string" && key.startsWith("--") && typeof value === "string") {
                document.documentElement.style.setProperty(key, value);
            }
        }
    }

    // Chat window sizes are applied on the df-messenger element at runtime.
}

/**
 * Sets the only Dialogflow control for bubble↔card spacing: `--df-messenger-chat-window-offset`.
 * (See df-messenger v1: `.chat-wrapper { bottom: … + offset }` inside the chat-bubble shadow.)
 * Must be applied on `df-messenger-chat-bubble` (the :host that owns that CSS), not only the outer
 * `df-messenger`, or the gap may not change.
 * @param {number|undefined} offsetPx
 */
function setDfMessengerChatWindowOffsetPx(dfMessenger, offsetPx) {
    if (!dfMessenger) {
        return;
    }

    const applyTo = (el) => {
        if (!el) {
            return;
        }
        if (typeof offsetPx === "number" && Number.isFinite(offsetPx)) {
            el.style.setProperty("--df-messenger-chat-window-offset", `${offsetPx}px`);
        } else {
            el.style.removeProperty("--df-messenger-chat-window-offset");
        }
    };

    applyTo(dfMessenger);
    const fromTree = typeof dfMessenger.querySelector === "function"
        ? dfMessenger.querySelector("df-messenger-chat-bubble")
        : null;
    applyTo(fromTree);
    if (activeBubbleNode && activeBubbleNode !== fromTree) {
        applyTo(activeBubbleNode);
    }
}

function reapplyChatWindowOffsetFromConfig(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const root = typeof COMPANY_UI_CONFIG === "object" && COMPANY_UI_CONFIG != null
        ? COMPANY_UI_CONFIG
        : {};
    const dev = getDeviceSection(root, isMobileViewport());
    const chatWindow = dev.chatWindow && typeof dev.chatWindow === "object" ? dev.chatWindow : {};
    setDfMessengerChatWindowOffsetPx(dfMessenger, chatWindow.chatWindowOffsetPx);
}

/** @param {unknown} value @returns {"left"|"right"} */
function normalizeChatHorizontalDock(value) {
    if (value === "left" || value === "right") {
        return value;
    }
    return "right";
}

/**
 * Single "left" / "right" control for the chat widget + hello strip. Reads `common.chatLayout.side` first, then per-viewport `chatWindow.horizontalDock` (legacy).
 * @param {object} [config]
 * @returns {"left"|"right"}
 */
function resolveChatLayoutSide(config) {
    const c = (config && typeof config === "object" ? config : null) || readCompanyUiConfig();
    const cl = c && c.common && c.common.chatLayout && typeof c.common.chatLayout === "object"
        ? c.common.chatLayout
        : null;
    if (cl && (cl.side === "left" || cl.side === "right")) {
        return cl.side;
    }
    const isMobile = isMobileViewport();
    const devBlock = getDeviceSection(c, isMobile);
    const cwin = devBlock.chatWindow && typeof devBlock.chatWindow === "object" ? devBlock.chatWindow : null;
    if (cwin && (cwin.horizontalDock === "left" || cwin.horizontalDock === "right")) {
        return cwin.horizontalDock;
    }
    return "right";
}

/**
 * Picks a Dialogflow `df-messenger-chat-bubble` `anchor` (see Google’s HTML customizations for
 * df-messenger-chat-bubble). Valid pairs are e.g. `top-left`, `top-right`, `bottom-left`, `bottom-right`
 * (vertical–horizontal, not `left-bottom`). The default `top-left` expands left from the bubble — wrong
 * for a left-docked bubble; use `top-right` so the panel opens above the bubble and grows to the right.
 * @param {"left"|"right"} horizontalDock
 * @param {object} [bubblePos]
 * @returns {"top-left"|"top-right"|"bottom-left"|"bottom-right"}
 */
function resolveMessengerBubbleAnchor(horizontalDock, bubblePos) {
    const b = bubblePos && typeof bubblePos === "object" ? bubblePos : {};
    const pinTop = typeof b.topPx === "number" && typeof b.bottomPx !== "number";
    if (pinTop) {
        // Bubble pinned to top: panel hangs below, expansion aims toward the viewport center.
        return horizontalDock === "left" ? "bottom-right" : "bottom-left";
    }
    // Bubble on bottom: panel above bubble; expansion toward center (left or right of bubble).
    return horizontalDock === "left" ? "top-right" : "top-left";
}

/**
 * @param {unknown} [horizontalDock]
 * @param {object} [bubblePos]
 * @param {{ horizontalInset?: number, bottomInset?: number, topInset?: number }} [insets]
 */
function applyDfMessengerBubbleAnchorString(bubble, anchorValueOrNull) {
    if (!bubble) {
        return;
    }
    const want = (anchorValueOrNull == null || anchorValueOrNull === "") ? null : String(anchorValueOrNull);
    const have = (typeof bubble.getAttribute === "function" && bubble.getAttribute("anchor")) || null;
    if (want == null) {
        if (have == null) {
            return;
        }
        if (typeof bubble.removeAttribute === "function") {
            bubble.removeAttribute("anchor");
        }
        return;
    }
    if (have === want) {
        return;
    }
    if (typeof bubble.setAttribute === "function") {
        bubble.setAttribute("anchor", want);
    }
    try {
        if ("anchor" in bubble) {
            (bubble).anchor = want;
        }
    } catch {
        // ignore
    }
}

// Chat-bubble shadow: .chat-wrapper gets corner classes matching `anchor` (e.g. top-right). If the
// `anchor` attribute is ignored, patching the class can fix off-screen panel placement.
const DF_CHAT_WRAPPER_CORNER_CLASSES = [
    "right-bottom", "right-top", "left-bottom", "left-top",
    "top-right", "top-left", "bottom-right", "bottom-left", "fullscreen-always", "fullscreen-small"
];

/**
 * @param {Element | null} bubble
 * @param {string} cornerClass  e.g. "top-right" | "top-left"
 */
function applyChatPanelCornerClassInBubbleShadow(bubble, cornerClass) {
    if (!bubble || !cornerClass || typeof cornerClass !== "string") {
        return;
    }
    const root = bubble.shadowRoot;
    if (!root || typeof root.querySelector !== "function") {
        return;
    }
    const patch = (el) => {
        if (!el) {
            return;
        }
        for (const c of DF_CHAT_WRAPPER_CORNER_CLASSES) {
            if (c !== cornerClass) {
                el.classList.remove(c);
            }
        }
        el.classList.add(cornerClass);
    };
    patch(root.querySelector(".chat-wrapper"));
    patch(root.querySelector(".min-chat-wrapper"));
}

/**
 * @param {object} [raw] — user `bubblePosition` (may list wrong edge for `side`)
 * @param {"left"|"right"} side
 * @param {{ leftPx: number, rightPx: number, bottomPx: number, topPx: number | null }} defaults
 * @returns {object}
 */
function coalesceBubblePositionForChatSide(raw, side, defaults) {
    const b = raw && typeof raw === "object" ? raw : {};
    const d = defaults && typeof defaults === "object" ? defaults : { leftPx: 20, rightPx: 20, bottomPx: 20, topPx: null };
    if (side === "left") {
        return {
            leftPx: typeof b.leftPx === "number" && Number.isFinite(b.leftPx) ? b.leftPx : d.leftPx,
            rightPx: null,
            bottomPx: typeof b.bottomPx === "number" && Number.isFinite(b.bottomPx) ? b.bottomPx : d.bottomPx,
            topPx: typeof b.topPx === "number" && Number.isFinite(b.topPx) ? b.topPx : d.topPx
        };
    }
    return {
        rightPx: typeof b.rightPx === "number" && Number.isFinite(b.rightPx) ? b.rightPx : d.rightPx,
        leftPx: null,
        bottomPx: typeof b.bottomPx === "number" && Number.isFinite(b.bottomPx) ? b.bottomPx : d.bottomPx,
        topPx: typeof b.topPx === "number" && Number.isFinite(b.topPx) ? b.topPx : d.topPx
    };
}

function setDfMessengerChatBubbleAnchorFromDock(dfMessenger, horizontalDock, bubblePos) {
    const bubble = (dfMessenger && typeof dfMessenger.querySelector === "function" && dfMessenger.querySelector("df-messenger-chat-bubble"))
        || activeBubbleNode;
    if (!bubble) {
        return;
    }
    const dock = normalizeChatHorizontalDock(horizontalDock);
    if (dock === "right") {
        applyDfMessengerBubbleAnchorString(bubble, resolveMessengerBubbleAnchor("right", bubblePos));
        return;
    }
    // Side "left" needs `top-right` (or `bottom-right` if bubble is top-pinned) per Dialogflow `anchor` API;
    // invalid values fall back to default `top-left` and the panel can extend off the left edge.
    const anchor = resolveMessengerBubbleAnchor("left", bubblePos);
    applyDfMessengerBubbleAnchorString(bubble, anchor);
    window.setTimeout(() => {
        const b2 = (dfMessenger && dfMessenger.querySelector("df-messenger-chat-bubble")) || activeBubbleNode;
        applyChatPanelCornerClassInBubbleShadow(b2, anchor);
    }, 0);
    window.setTimeout(() => {
        const b2 = (dfMessenger && dfMessenger.querySelector("df-messenger-chat-bubble")) || activeBubbleNode;
        applyChatPanelCornerClassInBubbleShadow(b2, anchor);
    }, 200);
}

/**
 * Fixed-corner placement for the outer `df-messenger` (bubble host). One horizontal edge + one vertical.
 * @param {object} [bubblePos] — use rightPx+… when dock is right, leftPx+… when dock is left
 * @param {"left"|"right"} horizontalDock
 * @param {{ horizontalInset?: number, bottomInset?: number, topInset?: number }} insets
 */
function applyFixedCornerToMessengerForDock(dfMessenger, bubblePos, horizontalDock, insets) {
    if (!dfMessenger) {
        return;
    }
    const b = bubblePos && typeof bubblePos === "object" ? bubblePos : {};
    const dock = horizontalDock === "left" ? "left" : "right";
    const hIn = typeof insets.horizontalInset === "number" && Number.isFinite(insets.horizontalInset) ? insets.horizontalInset : 20;
    const bIn = typeof insets.bottomInset === "number" && Number.isFinite(insets.bottomInset) ? insets.bottomInset : 20;
    const pinTop = typeof b.topPx === "number" && typeof b.bottomPx !== "number";

    if (dock === "right") {
        const r = typeof b.rightPx === "number" && Number.isFinite(b.rightPx) ? b.rightPx : hIn;
        dfMessenger.style.setProperty("right", `${r}px`);
        dfMessenger.style.setProperty("left", "auto");
    } else {
        const l = typeof b.leftPx === "number" && Number.isFinite(b.leftPx) ? b.leftPx : hIn;
        dfMessenger.style.setProperty("left", `${l}px`);
        dfMessenger.style.setProperty("right", "auto");
    }

    if (pinTop) {
        const tIn = typeof insets.topInset === "number" && Number.isFinite(insets.topInset) ? insets.topInset : 20;
        const t = typeof b.topPx === "number" && Number.isFinite(b.topPx) ? b.topPx : tIn;
        dfMessenger.style.setProperty("top", `${t}px`);
        dfMessenger.style.removeProperty("bottom");
    } else {
        const bot = typeof b.bottomPx === "number" && Number.isFinite(b.bottomPx) ? b.bottomPx : bIn;
        dfMessenger.style.setProperty("bottom", `${bot}px`);
        dfMessenger.style.removeProperty("top");
    }
}

/** So desktop `--df-messenger-chat-window-width` is never wider than the viewport. */
function capDialogflowChatWindowWidthPx(want) {
    const base = typeof want === "number" && Number.isFinite(want) ? want : 420;
    const vw = typeof window.innerWidth === "number" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1200;
    return Math.max(280, Math.min(base, Math.floor(vw - 32)));
}

/**
 * Dialogflow sets `#message-list { overflow: var(--df-messenger-chat-overflow, hidden scroll); }` — the
 * fallback `hidden scroll` is two-value: y is `scroll`, which always reserves/shows a scrollbar. Use
 * `hidden auto` when we want a thin/overlay or hidden track; pair with `chatMessageList` CSS in apply.
 */
function applyChatMessageListOverflowVar(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const bubble = (typeof dfMessenger.querySelector === "function" && dfMessenger.querySelector("df-messenger-chat-bubble"))
        || activeBubbleNode;
    const common = COMPANY_UI_CONFIG && typeof COMPANY_UI_CONFIG === "object" && COMPANY_UI_CONFIG.common;
    const theme = common && common.dfMessengerTheme && typeof common.dfMessengerTheme === "object" ? common.dfMessengerTheme : null;
    const fromTheme = theme && typeof theme["--df-messenger-chat-overflow"] === "string"
        ? theme["--df-messenger-chat-overflow"].trim()
        : "";
    const setOn = (el, value) => {
        if (el && typeof el.style !== "undefined" && typeof el.style.setProperty === "function") {
            el.style.setProperty("--df-messenger-chat-overflow", value);
        }
    };
    const clearOn = (el) => {
        if (el && typeof el.style !== "undefined" && typeof el.style.removeProperty === "function") {
            el.style.removeProperty("--df-messenger-chat-overflow");
        }
    };
    if (SHOW_MESSAGELIST_SCROLLBAR) {
        if (fromTheme) {
            setOn(dfMessenger, fromTheme);
            setOn(bubble, fromTheme);
        } else {
            clearOn(dfMessenger);
            clearOn(bubble);
        }
    } else {
        setOn(dfMessenger, "hidden auto");
        setOn(bubble, "hidden auto");
    }
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {string | null}
 */
function buildFooterInputBoxPaddingValue(cfg) {
    if (!cfg || typeof cfg !== "object") {
        return null;
    }
    if (typeof cfg.padding === "string" && cfg.padding.trim()) {
        return cfg.padding.trim();
    }
    const top = Number.isFinite(cfg.paddingTopPx) ? `${cfg.paddingTopPx}px` : null;
    const right = Number.isFinite(cfg.paddingRightPx) ? `${cfg.paddingRightPx}px` : null;
    const bottom = Number.isFinite(cfg.paddingBottomPx) ? `${cfg.paddingBottomPx}px` : null;
    const left = Number.isFinite(cfg.paddingLeftPx) ? `${cfg.paddingLeftPx}px` : null;
    if (!top && !right && !bottom && !left) {
        return null;
    }
    return `${top || "0"} ${right || "0"} ${bottom || "0"} ${left || "0"}`;
}

function getDfMessengerInnerPaddingShorthandFromTheme() {
    const theme = COMMON_CONFIG.dfMessengerTheme && typeof COMMON_CONFIG.dfMessengerTheme === "object"
        ? COMMON_CONFIG.dfMessengerTheme
        : {};
    const raw = theme["--df-messenger-input-inner-padding"];
    if (typeof raw === "string" && raw.trim()) {
        return raw.trim();
    }
    return "0 46px 10px 10px";
}

/** Keeps `--df-messenger-input-inner-padding` right edge in sync with `sendButtonWrapperPx` (46px base + overflow). */
function applySendButtonSizeHostVars(dfMessenger) {
    if (!dfMessenger || !dfMessenger.style) {
        return;
    }
    const cfg = FOOTER_INPUT_BOX_CONFIG;
    if (!cfg || typeof cfg !== "object") {
        return;
    }
    const wrapSz = Number(cfg.sendButtonWrapperPx);
    if (!Number.isFinite(wrapSz) || wrapSz <= 48) {
        return;
    }
    const rightPad = 46 + Math.round(wrapSz - 48);
    let base = (dfMessenger.style.getPropertyValue("--df-messenger-input-inner-padding") || "").trim();
    if (!base) {
        base = getDfMessengerInnerPaddingShorthandFromTheme();
    }
    const parts = base.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        parts[1] = `${rightPad}px`;
        dfMessenger.style.setProperty("--df-messenger-input-inner-padding", parts.join(" "));
    }
}

function applyFooterInputBoxHostVars(dfMessenger) {
    if (!dfMessenger || !dfMessenger.style) {
        return;
    }
    const cfg = FOOTER_INPUT_BOX_CONFIG;
    if (!cfg || typeof cfg !== "object") {
        return;
    }
    const padding = buildFooterInputBoxPaddingValue(cfg);
    if (padding) {
        dfMessenger.style.setProperty("--df-messenger-input-padding", padding);
    }
    if (typeof cfg.scrollbarGutter === "string" && cfg.scrollbarGutter.trim()) {
        dfMessenger.style.setProperty("--df-messenger-input-gutter", cfg.scrollbarGutter.trim());
    }
    if (typeof cfg.inputMaxWidth === "string" && cfg.inputMaxWidth.trim()) {
        dfMessenger.style.setProperty("--df-messenger-input-max-width", cfg.inputMaxWidth.trim());
    }
    if (typeof cfg.chatMaxWidth === "string" && cfg.chatMaxWidth.trim()) {
        dfMessenger.style.setProperty("--df-messenger-chat-max-width", cfg.chatMaxWidth.trim());
    }
    if (Number.isFinite(cfg.sendOffsetYpx)) {
        dfMessenger.style.setProperty("--df-messenger-send-icon-offset-y", `${Math.round(cfg.sendOffsetYpx)}px`);
    }
    applySendButtonSizeHostVars(dfMessenger);
}

function removeFooterInputBoxShadowOverrides(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        const hosts = root.querySelectorAll("df-messenger-user-input");
        for (const host of hosts) {
            if (!host || !host.shadowRoot || typeof host.shadowRoot.getElementById !== "function") {
                continue;
            }
            const tag = host.shadowRoot.getElementById(FOOTER_INPUT_BOX_STYLE_ID);
            if (tag && tag.parentNode) {
                tag.parentNode.removeChild(tag);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Composer speech-to-text (Web Speech API) — toggle per desk/mob (`speechToText.enabled`).
// -----------------------------------------------------------------------------

/**
 * @param {boolean} mobile
 * @returns {Record<string, unknown> | null}
 */
function readSpeechToTextConfigForViewport(mobile) {
    const sec = getDeviceSection(COMPANY_UI_CONFIG, mobile);
    if (!sec || typeof sec !== "object") {
        return null;
    }
    return sec.speechToText && typeof sec.speechToText === "object" ? sec.speechToText : null;
}

/** True when **this** viewport’s `desk.speechToText` / `mob.speechToText` has `{ enabled: true }`. */
function isComposerSpeechToTextEnabledForViewport() {
    const cfg = readSpeechToTextConfigForViewport(isMobileViewport());
    if (!cfg) {
        return false;
    }
    return isFeatureEnabledFromConfig(cfg, false);
}

function getSpeechRecognitionConstructor() {
    /* global SpeechRecognition webkitSpeechRecognition */
    const w = typeof window !== "undefined" ? window : null;
    if (!w) {
        return null;
    }
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** BCP-47 hint for recognition (best-effort vs `activeLanguage`). */
function localeForComposerSpeechRecognition() {
    try {
        const base = (normalizeLanguage(activeLanguage).split(/[-_]/)[0] || "en").toLowerCase();
        if (base === "hi") {
            return "hi-IN";
        }
        if (base === "mr") {
            return "mr-IN";
        }
        return "en-US";
    } catch {
        return "en-US";
    }
}

function getComposerSpeechMicIconSvgHtml() {
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\""
        + " fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\""
        + " aria-hidden=\"true\"><path d=\"M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z\"/>"
        + "<path d=\"M19 11a7 7 0 0 1-14 0M12 18v3\"/></svg>";
}

/** Single active Web Speech dictate session (`SpeechRecognition`). */
let composerSpeechSession = {
    recognition: null,
    button: null,
    textarea: null,
    snapshot: ""
};

function stopComposerSpeechRecognition() {
    if (composerSpeechSession.recognition) {
        try {
            composerSpeechSession.recognition.onresult = null;
            composerSpeechSession.recognition.onerror = null;
            composerSpeechSession.recognition.onend = null;
            composerSpeechSession.recognition.stop();
        } catch {
            try {
                composerSpeechSession.recognition.abort();
            } catch {
                /* ignore */
            }
        }
        composerSpeechSession.recognition = null;
    }
    if (composerSpeechSession.button) {
        composerSpeechSession.button.removeAttribute("data-listening");
        composerSpeechSession.button.setAttribute("aria-pressed", "false");
    }
    composerSpeechSession.button = null;
    composerSpeechSession.textarea = null;
    composerSpeechSession.snapshot = "";
}

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLButtonElement} btn
 */
function startComposerSpeechRecognition(textarea, btn) {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor || !textarea || !btn) {
        return;
    }
    stopComposerSpeechRecognition();
    const snapshot = typeof textarea.value === "string" ? textarea.value : "";
    composerSpeechSession.textarea = textarea;
    composerSpeechSession.button = btn;
    composerSpeechSession.snapshot = snapshot;

    const rec = new Ctor();
    composerSpeechSession.recognition = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = localeForComposerSpeechRecognition();

    /** @type {string} */
    let committed = "";

    btn.setAttribute("data-listening", "true");
    btn.setAttribute("aria-pressed", "true");

    rec.onresult = (event) => {
        try {
            const ta = composerSpeechSession.textarea;
            if (!ta) {
                return;
            }
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const row = event.results[i];
                const piece = row && row[0] && typeof row[0].transcript === "string" ? row[0].transcript : "";
                if (row.isFinal) {
                    committed += piece;
                } else {
                    interim += piece;
                }
            }
            const base = composerSpeechSession.snapshot;
            ta.value = base + committed + interim;
            ta.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        } catch {
            /* ignore */
        }
    };
    rec.onerror = () => {
        stopComposerSpeechRecognition();
    };
    rec.onend = () => {
        stopComposerSpeechRecognition();
    };
    try {
        rec.start();
    } catch {
        stopComposerSpeechRecognition();
    }
}

/**
 * @param {Event} ev
 */
function onComposerSpeechMicButtonClick(ev) {
    const btn = ev.currentTarget;
    if (!btn || !(btn instanceof HTMLButtonElement)) {
        return;
    }
    const root = typeof btn.getRootNode === "function" ? btn.getRootNode() : null;
    const sr = root && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root : null;
    if (!sr) {
        return;
    }
    const textarea = sr.querySelector("textarea");
    if (!textarea) {
        return;
    }
    if (composerSpeechSession.recognition && composerSpeechSession.button === btn) {
        stopComposerSpeechRecognition();
        return;
    }
    startComposerSpeechRecognition(textarea, btn);
}

function ensureComposerSpeechMicShadowStyle(shadowRoot) {
    if (!shadowRoot || typeof shadowRoot.getElementById !== "function") {
        return;
    }
    let tag = shadowRoot.getElementById(COMPOSER_SPEECH_MIC_STYLE_ID);
    if (!tag) {
        tag = document.createElement("style");
        tag.id = COMPOSER_SPEECH_MIC_STYLE_ID;
        shadowRoot.appendChild(tag);
    }
    tag.textContent = `.input-box-wrapper.dfchat-has-composer-speech-mic { gap: 6px !important; }
.${COMPOSER_SPEECH_WRAP_CLASS} { display: flex !important; align-items: center !important; flex-shrink: 0 !important; }
${COMPOSER_SPEECH_BTN_SELECTOR} {
  flex-shrink: 0 !important; width: 40px !important; height: 40px !important; margin: 0 !important; padding: 0 !important;
  border: none !important; border-radius: 10px !important; background: transparent !important; color: #0369a1 !important;
  cursor: pointer !important; display: grid !important; place-items: center !important; line-height: 0 !important;
}
${COMPOSER_SPEECH_BTN_SELECTOR}:hover { background: rgba(14, 165, 233, 0.12) !important; }
${COMPOSER_SPEECH_BTN_SELECTOR}[data-listening="true"] { color: #dc2626 !important; background: rgba(248, 113, 113, 0.15) !important; }`;
}

function removeComposerSpeechMicsInsideMessenger(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (let ri = 0; ri < roots.length; ri += 1) {
        const root = roots[ri];
        if (!root || typeof root.querySelectorAll !== "function") {
            continue;
        }
        const hosts = root.querySelectorAll("df-messenger-user-input");
        for (let hi = 0; hi < hosts.length; hi += 1) {
            const host = hosts[hi];
            const sr = host && host.shadowRoot;
            if (!sr) {
                continue;
            }
            const wraps = sr.querySelectorAll(`.${COMPOSER_SPEECH_WRAP_CLASS}`);
            wraps.forEach((w) => {
                if (w && w.parentNode) {
                    w.parentNode.removeChild(w);
                }
            });
            const box = sr.querySelector(".input-box-wrapper");
            if (box && box.classList) {
                box.classList.remove("dfchat-has-composer-speech-mic");
            }
            const staleStyle = sr.getElementById && sr.getElementById(COMPOSER_SPEECH_MIC_STYLE_ID);
            if (staleStyle && staleStyle.parentNode) {
                staleStyle.parentNode.removeChild(staleStyle);
            }
        }
    }
}

/** Mount or remove microphone next to Dialogflow textarea (inside `df-messenger-user-input` shadow roots). */
function applyComposerSpeechMicToMessenger(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    if (!isComposerSpeechToTextEnabledForViewport()) {
        stopComposerSpeechRecognition();
        removeComposerSpeechMicsInsideMessenger(dfMessenger);
        return;
    }
    if (!getSpeechRecognitionConstructor()) {
        removeComposerSpeechMicsInsideMessenger(dfMessenger);
        return;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (let ri = 0; ri < roots.length; ri += 1) {
        const root = roots[ri];
        if (!root || typeof root.querySelectorAll !== "function") {
            continue;
        }
        const hosts = root.querySelectorAll("df-messenger-user-input");
        for (let hi = 0; hi < hosts.length; hi += 1) {
            const host = hosts[hi];
            const sr = host && host.shadowRoot;
            if (!sr || typeof sr.querySelector !== "function") {
                continue;
            }
            const box = sr.querySelector(".input-box-wrapper");
            if (!box || !box.appendChild || !box.insertBefore || !box.classList) {
                continue;
            }
            ensureComposerSpeechMicShadowStyle(sr);
            let wrap = sr.querySelector(`.${COMPOSER_SPEECH_WRAP_CLASS}`);
            let btn = wrap ? wrap.querySelector(COMPOSER_SPEECH_BTN_SELECTOR) : null;
            if (!wrap) {
                wrap = document.createElement("div");
                wrap.className = COMPOSER_SPEECH_WRAP_CLASS;
                wrap.setAttribute("data-dfchat-no-translate", "true");
                btn = document.createElement("button");
                btn.type = "button";
                btn.setAttribute("data-dfchat-composer-speech-mic", "true");
                btn.setAttribute("data-dfchat-no-translate", "true");
                btn.setAttribute("aria-label", "Dictate message");
                btn.setAttribute("title", "Speak to type");
                btn.setAttribute("aria-pressed", "false");
                btn.innerHTML = getComposerSpeechMicIconSvgHtml();
                btn.addEventListener("click", onComposerSpeechMicButtonClick);
                wrap.appendChild(btn);
                const inputElWrap = sr.querySelector(".input-element-wrapper");
                if (inputElWrap && inputElWrap.parentNode === box) {
                    box.insertBefore(wrap, inputElWrap);
                } else {
                    box.insertBefore(wrap, box.firstChild || null);
                }
            }
            box.classList.add("dfchat-has-composer-speech-mic");
        }
    }
}

function scheduleComposerSpeechMicAttach(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => applyComposerSpeechMicToMessenger(dfMessenger);
    run();
    [120, 400, 900, 1700, 3200].forEach((ms) => {
        window.setTimeout(() => {
            if (activeDfMessenger === dfMessenger || dfMessenger.isConnected) {
                run();
            }
        }, ms);
    });
}

let composerSpeechMicResizeHooked = false;
/** @type {number | null} */
let composerSpeechMicResizeDebouncerId = null;

function ensureComposerSpeechMicResizeObserver() {
    if (composerSpeechMicResizeHooked) {
        return;
    }
    composerSpeechMicResizeHooked = true;
    window.addEventListener("resize", () => {
        if (composerSpeechMicResizeDebouncerId !== null) {
            window.clearTimeout(composerSpeechMicResizeDebouncerId);
            composerSpeechMicResizeDebouncerId = null;
        }
        composerSpeechMicResizeDebouncerId = window.setTimeout(() => {
            composerSpeechMicResizeDebouncerId = null;
            if (activeDfMessenger) {
                scheduleComposerSpeechMicAttach(activeDfMessenger);
            }
        }, 160);
    });
}

/**
 * Inline send sizing (Dialogflow shadow styles can lose specificity).
 * @param {HTMLElement} dfMessenger
 */
function applySendButtonSizeInline(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const cfg = FOOTER_INPUT_BOX_CONFIG;
    if (!cfg || typeof cfg !== "object") {
        return;
    }
    const wrapSz = Number(cfg.sendButtonWrapperPx);
    let iconSz = Number(cfg.sendIconPx);
    if (!Number.isFinite(wrapSz) || wrapSz <= 48) {
        return;
    }
    if (!Number.isFinite(iconSz) || iconSz <= 0) {
        iconSz = Math.round((24 * wrapSz) / 48);
    }
    const icon = Math.max(20, Math.min(wrapSz - 4, iconSz));
    const margin = Math.max(0, Math.round((wrapSz - icon) / 2));
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || root === document || typeof root.querySelectorAll !== "function") {
            continue;
        }
        let wrappers;
        try {
            wrappers = root.querySelectorAll(".send-icon-button-wrapper");
        } catch {
            continue;
        }
        for (let i = 0; i < wrappers.length; i++) {
            const wrap = wrappers[i];
            if (!wrap || !wrap.style) {
                continue;
            }
            wrap.style.setProperty("width", `${wrapSz}px`, "important");
            wrap.style.setProperty("height", `${wrapSz}px`, "important");
            wrap.style.setProperty("min-width", `${wrapSz}px`, "important");
            wrap.style.setProperty("min-height", `${wrapSz}px`, "important");
            wrap.style.setProperty(
                "margin-left",
                `calc(-${wrapSz}px + var(--df-messenger-send-icon-offset-x, 0px))`,
                "important"
            );
            wrap.style.setProperty(
                "transform",
                "translateY(var(--df-messenger-send-icon-offset-y, 0px))",
                "important"
            );
            const btn = wrap.querySelector("#send-icon-button");
            if (btn && btn.style) {
                btn.style.setProperty("display", "flex", "important");
                btn.style.setProperty("align-items", "center", "important");
                btn.style.setProperty("justify-content", "center", "important");
                btn.style.setProperty("width", "100%", "important");
                btn.style.setProperty("height", "100%", "important");
            }
            const iconEl = wrap.querySelector("#send-icon");
            if (iconEl && iconEl.style) {
                iconEl.style.setProperty("width", `${icon}px`, "important");
                iconEl.style.setProperty("height", `${icon}px`, "important");
                iconEl.style.setProperty("margin", `${margin}px`, "important");
            }
            wrap.querySelectorAll("svg").forEach((svg) => {
                if (svg && svg.style) {
                    svg.style.setProperty("width", `${icon}px`, "important");
                    svg.style.setProperty("height", `${icon}px`, "important");
                }
            });
        }
    }
}

/**
 * Injects `.input-box-wrapper` rules (align-items, overflow-y) into each `df-messenger-user-input` shadow root.
 * @param {HTMLElement} dfMessenger
 */
function applyFooterInputBoxShadowOverrides(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const cfg = FOOTER_INPUT_BOX_CONFIG;
    if (!cfg || typeof cfg !== "object") {
        removeFooterInputBoxShadowOverrides(dfMessenger);
        return;
    }
    const decl = [];
    if (typeof cfg.alignItems === "string" && cfg.alignItems.trim()) {
        const a = cfg.alignItems.trim().toLowerCase();
        if (FOOTER_INPUT_BOX_ALIGN_ALLOWED.has(a)) {
            decl.push(`align-items: ${a} !important;`);
        }
    }
    if (typeof cfg.overflowY === "string" && cfg.overflowY.trim()) {
        const o = cfg.overflowY.trim().toLowerCase();
        if (FOOTER_INPUT_BOX_OVERFLOW_Y_ALLOWED.has(o)) {
            decl.push(`overflow-y: ${o} !important;`);
        }
    }
    const cssParts = [];
    if (decl.length > 0) {
        cssParts.push(`.input-box-wrapper { ${decl.join(" ")} }`);
    }
    // Shadow on the input container (textarea wrapper) instead of the whole footer strip.
    cssParts.push(
        ".input-element-wrapper {"
        + " box-shadow: 0 8px 18px -16px rgba(15, 23, 42, 0.55) !important;"
        + " }"
    );
    if (Number.isFinite(cfg.sendOffsetYpx) && Math.round(cfg.sendOffsetYpx) !== 0) {
        cssParts.push(`.send-icon-button-wrapper { transform: translateY(var(--df-messenger-send-icon-offset-y, 0px)) !important; }`);
    }
    const wrapSz = Number(cfg.sendButtonWrapperPx);
    let iconSz = Number(cfg.sendIconPx);
    if (Number.isFinite(wrapSz) && wrapSz > 48) {
        if (!Number.isFinite(iconSz) || iconSz <= 0) {
            iconSz = Math.round((24 * wrapSz) / 48);
        }
        const icon = Math.max(20, Math.min(wrapSz - 4, iconSz));
        const margin = Math.max(0, Math.round((wrapSz - icon) / 2));
        cssParts.push(
            `.send-icon-button-wrapper { width: ${wrapSz}px !important; height: ${wrapSz}px !important; `
            + `min-width: ${wrapSz}px !important; min-height: ${wrapSz}px !important; `
            + `margin-left: calc(-${wrapSz}px + var(--df-messenger-send-icon-offset-x, 0px)) !important; `
            + `transform: translateY(var(--df-messenger-send-icon-offset-y, 0px)) !important; } `
            + `#send-icon-button { display: flex !important; align-items: center !important; justify-content: center !important; `
            + `width: 100% !important; height: 100% !important; } `
            + `#send-icon, .send-icon-button-wrapper svg { width: ${icon}px !important; height: ${icon}px !important; `
            + `min-width: ${icon}px !important; min-height: ${icon}px !important; box-sizing: border-box !important; } `
            + `#send-icon { margin: ${margin}px !important; }`
        );
    }
    if (cssParts.length === 0) {
        removeFooterInputBoxShadowOverrides(dfMessenger);
        return;
    }
    const css = cssParts.join("\n");
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        const hosts = root.querySelectorAll("df-messenger-user-input");
        for (const host of hosts) {
            if (!host || !host.shadowRoot) {
                continue;
            }
            let tag = host.shadowRoot.getElementById(FOOTER_INPUT_BOX_STYLE_ID);
            if (!tag) {
                tag = document.createElement("style");
                tag.id = FOOTER_INPUT_BOX_STYLE_ID;
                host.shadowRoot.appendChild(tag);
            }
            tag.textContent = css;
        }
    }
}

function scheduleFooterInputBoxShadowOverrides(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => {
        applyFooterInputBoxShadowOverrides(dfMessenger);
        applySendButtonSizeInline(dfMessenger);
    };
    run();
    [200, 600, 1200, 2500, 4000].forEach((ms) => {
        window.setTimeout(run, ms);
    });
}

function applyFooterInputBoxConfig(dfMessenger) {
    applyFooterInputBoxHostVars(dfMessenger);
    scheduleFooterInputBoxShadowOverrides(dfMessenger);
}

function applyDfMessengerThemeConfig(dfMessenger, config) {
    if (!dfMessenger || !config || typeof config !== "object") {
        return;
    }

    const common = config.common && typeof config.common === "object" ? config.common : {};
    const desk = getDeviceSection(config, false);
    const desktopWindow = desk.chatWindow && typeof desk.chatWindow === "object" ? desk.chatWindow : {};
    if (typeof desktopWindow.widthPx === "number" && Number.isFinite(desktopWindow.widthPx)) {
        const w = capDialogflowChatWindowWidthPx(desktopWindow.widthPx);
        dfMessenger.style.setProperty("--df-messenger-chat-window-width", `${w}px`);
    }
    if (typeof desktopWindow.heightPx === "number" && Number.isFinite(desktopWindow.heightPx)) {
        dfMessenger.style.setProperty("--df-messenger-chat-window-height", `${desktopWindow.heightPx}px`);
    }

    const theme = common.dfMessengerTheme && typeof common.dfMessengerTheme === "object" ? common.dfMessengerTheme : null;
    if (theme) {
        for (const [key, value] of Object.entries(theme)) {
            if (typeof key === "string" && key.startsWith("--") && typeof value === "string") {
                dfMessenger.style.setProperty(key, value);
            }
        }
    }

    // After `dfMessengerTheme`: footer/composer wrapper variables + shadow overrides.
    applyFooterInputBoxConfig(dfMessenger);

    // After theme so this wins over a stray `--df-messenger-chat-window-offset` in dfMessengerTheme.
    setDfMessengerChatWindowOffsetPx(dfMessenger, desktopWindow.chatWindowOffsetPx);
    // After theme: `common.chatMessageList.showScrollbar` controls --df-messenger-chat-overflow (see above).
    applyChatMessageListOverflowVar(dfMessenger);
    const bubble = typeof dfMessenger.querySelector === "function"
        ? dfMessenger.querySelector("df-messenger-chat-bubble")
        : null;
    if (bubble && bubble.style) {
        for (const key of DF_MESSENGER_CHAT_SCROLL_JUMP_VAR_KEYS) {
            const v = dfMessenger.style.getPropertyValue(key);
            if (v && String(v).trim()) {
                bubble.style.setProperty(key, v.trim());
            }
        }
    }
    applyChatBubbleLauncherCircleStyle(dfMessenger);
    applyBotPersonaToMessenger(dfMessenger, bubble);
}

function applyBotPersonaToMessenger(dfMessenger, bubble) {
    if (!dfMessenger) {
        return;
    }
    const cfg = BOT_PERSONA_CONFIG;
    const size = `${cfg.threadAvatarSizePx}px`;

    if (cfg.mode === "image") {
        dfMessenger.style.setProperty("--df-messenger-message-actor-image-size", "0px");
        dfMessenger.style.setProperty("--df-messenger-message-actor-padding", "0px");
        dfMessenger.style.setProperty("--df-messenger-message-actor-spacing", "0px");
        if (bubble && bubble.style) {
            bubble.style.setProperty("--df-messenger-message-actor-image-size", "0px");
            bubble.style.setProperty("--df-messenger-message-actor-padding", "0px");
            bubble.style.setProperty("--df-messenger-message-actor-spacing", "0px");
        }
    } else {
        dfMessenger.style.removeProperty("--df-messenger-message-actor-padding");
        dfMessenger.style.removeProperty("--df-messenger-message-actor-spacing");
        dfMessenger.style.setProperty("--df-messenger-message-actor-image-size", size);
        if (bubble && bubble.style) {
            bubble.style.removeProperty("--df-messenger-message-actor-padding");
            bubble.style.removeProperty("--df-messenger-message-actor-spacing");
            bubble.style.setProperty("--df-messenger-message-actor-image-size", size);
        }
    }

    if (!bubble || typeof bubble.removeAttribute !== "function") {
        return;
    }
    bubble.removeAttribute("bot-actor-image");
}

function applyChatBubbleLauncherCircleStyle(dfMessenger) {
    if (!dfMessenger || typeof dfMessenger.querySelector !== "function") {
        return;
    }
    const cfg = CHAT_BUBBLE_LAUNCHER_CONFIG;
    const host = dfMessenger.querySelector("df-messenger-chat-bubble") || activeBubbleNode;
    if (!host) {
        return;
    }
    try {
        host.style.setProperty("--df-messenger-chat-bubble-border-radius", cfg.cornerRoundness);
        dfMessenger.style.setProperty("--df-messenger-chat-bubble-border-radius", cfg.cornerRoundness);
        if (cfg.buttonSizePx != null) {
            const s = `${cfg.buttonSizePx}px`;
            host.style.setProperty("--df-messenger-chat-bubble-size", s);
            dfMessenger.style.setProperty("--df-messenger-chat-bubble-size", s);
        }
        if (cfg.iconSizePx != null) {
            const s = `${cfg.iconSizePx}px`;
            host.style.setProperty("--df-messenger-chat-bubble-icon-size", s);
            dfMessenger.style.setProperty("--df-messenger-chat-bubble-icon-size", s);
        }
    } catch (e) {
        /* no-op */
    }
    const root = host.shadowRoot;
    if (!root || typeof root.getElementById !== "function") {
        return;
    }
    const existing = root.getElementById(CHAT_BUBBLE_LAUNCHER_STYLE_ID);
    if (!cfg.keepRoundShape) {
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
        return;
    }
    const css = buildChatBubbleLauncherInjectedCss(cfg);
    let tag = existing;
    if (!tag) {
        tag = document.createElement("style");
        tag.id = CHAT_BUBBLE_LAUNCHER_STYLE_ID;
        root.appendChild(tag);
    }
    if (tag.textContent !== css) {
        tag.textContent = css;
    }
    syncBubbleUnreadBadge(dfMessenger);
}

function scheduleChatBubbleLauncherCircleStyle(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => {
        applyChatBubbleLauncherCircleStyle(dfMessenger);
    };
    run();
    [80, 200, 500, 1200, 2800].forEach((ms) => {
        window.setTimeout(run, ms);
    });
}

function ensureCircularBubbleIcon(dfMessenger) {
    const startTime = Date.now();
    const maxWaitMs = 10000;
    const intervalMs = 250;

    const cfg = CHAT_BUBBLE_LAUNCHER_CONFIG;
    const applyBubbleIconStyle = () => {
        const roots = collectSearchRoots(dfMessenger);
        let styled = false;

        const bubbleHost = typeof dfMessenger.querySelector === "function"
            ? dfMessenger.querySelector("df-messenger-chat-bubble")
            : null;
        if (bubbleHost && bubbleHost.shadowRoot) {
            const bubbleBtn = bubbleHost.shadowRoot.querySelector(".bubble");
            if (bubbleBtn && bubbleBtn.style) {
                bubbleBtn.style.setProperty("border-radius", cfg.cornerRoundness, "important");
                styled = true;
            }
        }

        if (cfg.clipPictureToCircle) {
            for (const root of roots) {
                if (!root || !root.querySelectorAll) {
                    continue;
                }

                const launcherSelectors = [
                    "button[aria-label*='Open'] img",
                    "button[aria-label*='open'] img",
                    "button[aria-label*='Chat'] img",
                    "button[aria-label*='chat'] img",
                    "div[role='button'][aria-label*='Open'] img",
                    "div[role='button'][aria-label*='open'] img",
                    "div[role='button'][aria-label*='Chat'] img",
                    "div[role='button'][aria-label*='chat'] img"
                ];

                for (const selector of launcherSelectors) {
                    const images = root.querySelectorAll(selector);
                    for (const image of images) {
                        image.style.setProperty("border-radius", cfg.cornerRoundness, "important");
                        image.style.setProperty("clip-path", "circle(50%)", "important");
                        image.style.setProperty("object-fit", "cover", "important");
                        image.style.setProperty("aspect-ratio", "1 / 1", "important");
                        image.style.setProperty("overflow", "hidden", "important");
                        image.style.setProperty("display", "block", "important");

                        if (image.parentElement) {
                            image.parentElement.style.setProperty("border-radius", cfg.cornerRoundness, "important");
                            image.parentElement.style.setProperty("overflow", "hidden", "important");
                        }

                        styled = true;
                    }
                }
            }
        }

        return styled;
    };

    if (applyBubbleIconStyle()) {
        return;
    }

    const timer = window.setInterval(() => {
        const styled = applyBubbleIconStyle();
        const timedOut = Date.now() - startTime > maxWaitMs;

        if (styled || timedOut) {
            window.clearInterval(timer);
        }
    }, intervalMs);
}

function ensureBubbleVisible(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);
    let found = false;

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        const candidates = root.querySelectorAll(
            "df-messenger-chat-bubble, [data-testid*='bubble'], [class*='bubble']"
        );

        for (const node of candidates) {
            if (!node || typeof node.style === "undefined") {
                continue;
            }

            node.removeAttribute?.("hidden");
            node.style.setProperty("display", "block", "important");
            node.style.setProperty("visibility", "visible", "important");
            node.style.setProperty("opacity", "1", "important");
            node.style.pointerEvents = "auto";
            found = true;
        }
    }

    if (activeBubbleNode) {
        activeBubbleNode.removeAttribute?.("hidden");
        activeBubbleNode.style.setProperty("display", "block", "important");
        activeBubbleNode.style.setProperty("visibility", "visible", "important");
        activeBubbleNode.style.setProperty("opacity", "1", "important");
        activeBubbleNode.style.pointerEvents = "auto";
        found = true;
    }

    return found;
}

function startBubbleVisibilityWatcher(dfMessenger) {
    if (bubbleVisibilityTimer) {
        window.clearInterval(bubbleVisibilityTimer);
        bubbleVisibilityTimer = null;
    }

    const ensure = () => {
        if (activeDfMessenger !== dfMessenger) {
            return;
        }
        ensureBubbleVisible(dfMessenger);
        applyChatBubbleLauncherCircleStyle(dfMessenger);
        // Only while the launcher is showing — polling stack sync here was re-syncing Language/Restart every ~1.2s during open chat.
        const chatOpen = isChatWindowOpen || (dfMessenger && isChatExpanded(dfMessenger));
        const lip = readLauncherInputStripConfig(readCompanyUiConfig());
        if (lip && isFeatureEnabledFromConfig(lip, true) && !chatOpen) {
            scheduleLauncherStripsStackSync(dfMessenger);
        }
    };

    ensure();
    bubbleVisibilityTimer = window.setInterval(ensure, 1200);
}

function isCompanyHeaderChromeButton(button) {
    if (!button) {
        return false;
    }
    const id = (button.id && String(button.id)) || "";
    if (id === "dfchat-contact-form-close" || id === "dfchat-hard-language-btn" || id === "dfchat-hard-restart-btn") {
        return true;
    }
    if (typeof button.closest === "function" && button.closest("#dfchat-hard-language-wrap")) {
        return true;
    }
    return false;
}

/**
 * Dismiss / collapse controls in the open chat titlebar. Dialogflow often uses `df-icon-button` with the
 * graphic in **shadow DOM** (or Material icons) — a “down” chevron is still a single end-slot (or a pair).
 * We collect every small native control in the header control row, excluding our buttons.
 * @param {Element | null} headerHost
 * @returns {Element[]}
 */
function getHeaderTitlebarCloseButtonCandidates(headerHost) {
    if (!headerHost || typeof headerHost.querySelectorAll !== "function") {
        return [];
    }
    const controls = headerHost.querySelector("df-messenger-header-controls")
        || headerHost.querySelector("[class*='header-controls']");
    const scope = controls || headerHost;
    const raw = Array.from(scope.querySelectorAll("button, [role='button'], df-icon-button, [is='df-icon-button']"));
    const filtered = raw.filter((b) => {
        if (!b) {
            return false;
        }
        if (typeof b.closest === "function" && b.closest("df-messenger-chat-bubble")) {
            return false;
        }
        if (isCompanyHeaderChromeButton(b)) {
            return false;
        }
        return true;
    });
    if (filtered.length === 0) {
        return [];
    }
    const rtl = document.documentElement && document.documentElement.getAttribute("dir") === "rtl";
    const sorted = filtered.slice().sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (rtl) {
            return ar.left - br.left;
        }
        return br.right - ar.right;
    });
    return sorted;
}

/**
 * Whether the host still has Material/arrow art (light or open shadow). `textContent` on the host
 * does not include shadow, so we query shadow explicitly.
 * @param {Element | null} el
 * @returns {boolean}
 */
function titlebarHostStillHasNonCloseArt(el) {
    if (!el) {
        return true;
    }
    try {
        if (el.querySelector("svg, img, picture, canvas, i, [class*='icon' i], [class*='mdc' i]")) {
            return true;
        }
        if (el.shadowRoot && typeof el.shadowRoot.querySelector === "function") {
            if (el.shadowRoot.querySelector("svg, img, path, [class*='icon' i], [class*='mdc' i]")) {
                return true;
            }
        }
    } catch (e) {
        return true;
    }
    return false;
}

/**
 * @param {Element | null} el
 * @returns {boolean} true if our × is already the only content and no SVG/icon is present.
 */
function isTitlebarCloseXAlreadyApplied(el) {
    if (!el || isCompanyHeaderChromeButton(el)) {
        return true;
    }
    if (titlebarHostStillHasNonCloseArt(el)) {
        return false;
    }
    if (el.dataset && el.dataset.companyCloseIcon !== "x") {
        return false;
    }
    const lightT = (el.textContent && el.textContent.replace(/\s/g, "")) || "";
    if (lightT && lightT !== "×" && lightT !== "✕") {
        return false;
    }
    if (el.shadowRoot) {
        const t = (el.shadowRoot.textContent && el.shadowRoot.textContent.replace(/\s/g, "")) || "";
        if (t && t !== "×" && t !== "✕") {
            return false;
        }
    }
    return true;
}

/**
 * Clear light DOM, **open** shadow (Material / `df-icon-button` down-arrow lives here), and show × only.
 * @param {Element} host
 * @param {string} closeTapPx
 * @param {string} closeFontPx
 */
function clearOpenShadowRootForCloseGlyph(host, closeFontPx) {
    const r = host && host.shadowRoot;
    if (!r) {
        return;
    }
    // Open shadow only — if closed, the host still gets × + styles; user may need browser that exposes open.
    while (r.firstChild) {
        try {
            r.removeChild(r.firstChild);
        } catch (e) {
            break;
        }
    }
    const span = document.createElement("span");
    span.setAttribute("data-dfchat-close-x", "1");
    span.textContent = "×";
    span.style.setProperty("font-size", closeFontPx, "important");
    span.style.setProperty("line-height", "1", "important");
    span.style.setProperty("font-weight", "500", "important");
    span.style.setProperty("display", "grid", "important");
    span.style.setProperty("place-items", "center", "important");
    span.style.setProperty("font-family", "Manrope, Segoe UI, Arial, sans-serif", "important");
    span.style.setProperty("color", "inherit", "important");
    r.appendChild(span);
}

/**
 * Strip SVG / chevron (light or shadow) and show × only. Used for the open chat **title** dismiss, all languages.
 * @param {Element} button
 * @param {string} closeTapPx
 * @param {string} closeFontPx
 */
function replaceCloseButtonWithXGlyph(button, closeTapPx, closeFontPx) {
    if (!button) {
        return;
    }
    if (isCompanyHeaderChromeButton(button)) {
        return;
    }
    if (typeof button.closest === "function" && button.closest("df-messenger-chat-bubble")) {
        return;
    }
    while (button.firstChild) {
        try {
            button.removeChild(button.firstChild);
        } catch (e) {
            break;
        }
    }
    if (button.shadowRoot) {
        clearOpenShadowRootForCloseGlyph(button, closeFontPx);
    }
    // Remove Material / icon font backgrounds that can read as a chevron/arrow
    try {
        button.style.setProperty("background", "none", "important");
        button.style.setProperty("background-image", "none", "important");
        button.style.setProperty("-webkit-mask", "none", "important");
        button.style.setProperty("mask", "none", "important");
    } catch (e) {
        /* no-op */
    }
    if (!button.shadowRoot) {
        button.textContent = "×";
    }
    button.style.setProperty("font-size", closeFontPx, "important");
    button.style.setProperty("line-height", "1", "important");
    button.style.setProperty("font-weight", "500", "important");
    button.style.setProperty("width", closeTapPx, "important");
    button.style.setProperty("height", closeTapPx, "important");
    button.style.setProperty("min-width", closeTapPx, "important");
    button.style.setProperty("min-height", closeTapPx, "important");
    button.style.setProperty("box-sizing", "border-box", "important");
    button.style.setProperty("border-radius", "12px", "important");
    button.style.setProperty("padding", "0", "important");
    button.style.setProperty("display", "grid", "important");
    button.style.setProperty("place-items", "center", "important");
    button.style.setProperty("font-family", "Manrope, Segoe UI, Arial, sans-serif", "important");
    button.setAttribute("aria-label", "Close");
    button.setAttribute("data-dfchat-no-translate", "true");
    button.setAttribute("data-dfchat-native-close-override", "1");
    if (button.dataset) {
        button.dataset.companyCloseIcon = "x";
    }
}

/**
 * @param {Element} button
 * @param {string} closeTapPx
 * @param {string} closeFontPx
 * @returns {boolean} true if a change was applied
 */
function applyCloseXGlyphToButtonIfNeeded(button, closeTapPx, closeFontPx) {
    if (!button || isCompanyHeaderChromeButton(button)) {
        return false;
    }
    if (typeof button.closest === "function" && button.closest("df-messenger-chat-bubble")) {
        return false;
    }
    if (isTitlebarCloseXAlreadyApplied(button)) {
        return false;
    }
    replaceCloseButtonWithXGlyph(button, closeTapPx, closeFontPx);
    return true;
}

function shouldTreatAsHeaderCloseByLabel(button) {
    const ariaLabel = (button.getAttribute("aria-label") || "").toLowerCase();
    const dataTestId = (button.getAttribute("data-testid") || "").toLowerCase();
    // English + many locales + common "back" / chevron a11y text when Dialogflow swaps icon for arrow.
    const t = `${ariaLabel} ${dataTestId}`;
    if (/minimize|collapse|dismiss|close|shut|exit|quitter|zur(ü|u)ck|retour|volver|sluit|sulje|lukk|kapat|chiudi|ferm|schlie(ß|s|)/i.test(t)) {
        return true;
    }
    if (/(close|dismiss|minimize|back|return|arrow)/i.test(t) && (button.querySelector("svg") || t.length < 64)) {
        return true;
    }
    return false;
}

/**
 * @param {Element} button
 * @param {Element | null} headerHost
 * @param {string} closeTapPx
 * @param {string} closeFontPx
 * @returns {boolean}
 */
function tryApplyCloseXInHeaderContext(button, headerHost, closeTapPx, closeFontPx) {
    if (!button || button.id === "dfchat-contact-form-close" || !headerHost) {
        return false;
    }
    if (typeof button.closest === "function" && button.closest("df-messenger-chat-bubble")) {
        return false;
    }
    if (!headerHost.contains(button)) {
        return false;
    }
    if (isCompanyHeaderChromeButton(button)) {
        return false;
    }
    if (shouldTreatAsHeaderCloseByLabel(button)) {
        return applyCloseXGlyphToButtonIfNeeded(button, closeTapPx, closeFontPx);
    }
    let r = { width: 0, height: 0 };
    try {
        r = button.getBoundingClientRect();
    } catch (e) {
        return false;
    }
    if (button.querySelector("svg") && r.width > 0 && r.width < 80 && r.height < 80) {
        return applyCloseXGlyphToButtonIfNeeded(button, closeTapPx, closeFontPx);
    }
    return false;
}

function stopCloseXWhileChatOpenMonitor() {
    if (closeXWhileOpenMaintainId) {
        window.clearInterval(closeXWhileOpenMaintainId);
        closeXWhileOpenMaintainId = null;
    }
}

/**
 * One pass: titlebar dismiss = × only (language-neutral), never chevron/arrow SVG.
 * @param {Element | null} dfMessenger
 * @returns {boolean} whether any node was updated
 */
function runTitlebarCloseXSync(dfMessenger) {
    if (!IS_FORCE_TITLEBAR_CLOSE_X_ENABLED || !dfMessenger) {
        return false;
    }
    const CHAT_WINDOW_CLOSE_PX = 52;
    const CHAT_WINDOW_CLOSE_FONT_PX = 34;
    const closeTapPx = `${CHAT_WINDOW_CLOSE_PX}px`;
    const closeFontPx = `${CHAT_WINDOW_CLOSE_FONT_PX}px`;
    const headerHost = findChatHeaderHost(dfMessenger);
    let changed = false;

    if (headerHost) {
        for (const b of getHeaderTitlebarCloseButtonCandidates(headerHost)) {
            replaceCloseButtonWithXGlyph(b, closeTapPx, closeFontPx);
            changed = true;
        }
        const sub = headerHost.querySelectorAll("button, [role='button'], df-icon-button");
        for (const button of sub) {
            if (tryApplyCloseXInHeaderContext(button, headerHost, closeTapPx, closeFontPx)) {
                changed = true;
            }
        }
    }

    return changed;
}

function startCloseXWhileChatOpenMonitor(dfMessenger) {
    stopCloseXWhileChatOpenMonitor();
    if (!IS_FORCE_TITLEBAR_CLOSE_X_ENABLED || !dfMessenger) {
        return;
    }
    closeXWhileOpenMaintainId = window.setInterval(() => {
        if (!isChatWindowOpen || activeDfMessenger !== dfMessenger) {
            return;
        }
        runTitlebarCloseXSync(dfMessenger);
    }, 400);
}

function ensureCloseIconIsX(dfMessenger) {
    if (!IS_FORCE_TITLEBAR_CLOSE_X_ENABLED) {
        return;
    }
    if (closeIconXIntervalId) {
        window.clearInterval(closeIconXIntervalId);
        closeIconXIntervalId = null;
    }

    const startTime = Date.now();
    const maxWaitMs = 12000;
    const intervalMs = 300;

    if (runTitlebarCloseXSync(dfMessenger)) {
        return;
    }

    closeIconXIntervalId = window.setInterval(() => {
        const applied = runTitlebarCloseXSync(dfMessenger);
        const timedOut = Date.now() - startTime > maxWaitMs;

        if (applied || timedOut) {
            if (closeIconXIntervalId) {
                window.clearInterval(closeIconXIntervalId);
                closeIconXIntervalId = null;
            }
        }
    }, intervalMs);
}

function findChatCloseButton(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        const candidates = root.querySelectorAll(
            "button[aria-label*='Close'], button[aria-label*='close'], button[data-testid*='close'], button[data-testid*='Close']"
        );

        for (const button of candidates) {
            if (!button || button.id === "dfchat-contact-form-close") {
                continue;
            }

            const ariaLabel = (button.getAttribute("aria-label") || "").toLowerCase();
            const dataTestId = (button.getAttribute("data-testid") || "").toLowerCase();
            const looksLikeChatClose = /close|minimize|collapse/.test(ariaLabel) || /close|minimize|collapse/.test(dataTestId);
            if (!looksLikeChatClose) {
                continue;
            }

            if (typeof button.getBoundingClientRect !== "function") {
                continue;
            }

            const rect = button.getBoundingClientRect();
            if (!rect || rect.width < 8 || rect.height < 8) {
                continue;
            }

            const style = window.getComputedStyle(button);
            if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                continue;
            }

            return button;
        }
    }

    return null;
}

function findChatCloseButtonRect(dfMessenger) {
    const button = findChatCloseButton(dfMessenger);
    if (!button || typeof button.getBoundingClientRect !== "function") {
        return null;
    }

    return button.getBoundingClientRect();
}

function findChatHeaderHost(dfMessenger) {
    const closeButton = findChatCloseButton(dfMessenger);
    if (closeButton && typeof closeButton.closest === "function") {
        const closeHost = closeButton.closest(
            "header, [part*='header'], [data-testid*='header'], [class*='header'], [class*='titlebar'], [class*='toolbar'], [class*='title-bar']"
        );
        if (closeHost) {
            return closeHost;
        }
    }

    const roots = collectSearchRoots(dfMessenger);
    const selectors = [
        "header",
        "[part*='header']",
        "[data-testid*='header']",
        "[class*='header']",
        "[class*='titlebar']",
        "[class*='toolbar']",
        "[class*='title-bar']"
    ];

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (!node || typeof node.getBoundingClientRect !== "function") {
                continue;
            }
            const rect = node.getBoundingClientRect();
            if (!rect || rect.width < 120 || rect.height < 22) {
                continue;
            }
            const style = window.getComputedStyle(node);
            if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                continue;
            }
            return node;
        }
    }

    return null;
}

function autoOpenChatWindow(dfMessenger, bubbleNode, delayMs) {
    window.setTimeout(() => {
        shouldAutoOpenChat = true;

        if (isMessengerLoaded) {
            openChatWindow(dfMessenger, bubbleNode);
        }
    }, delayMs);
}

function initializeMessengerReadyState(dfMessenger, bubbleNode) {
    window.addEventListener("df-messenger-loaded", () => {
        if (activeDfMessenger !== dfMessenger) {
            return;
        }

        isMessengerLoaded = true;
        syncDfMessengerSessionParametersFromClientContext(dfMessenger);
        reapplyChatWindowOffsetFromConfig(dfMessenger);
        scheduleChatMessageListScrollbarReapply(dfMessenger);
        schedulePersonaShadowFix(dfMessenger);

        if (shouldAutoOpenChat) {
            openChatWindow(dfMessenger, bubbleNode);
        }
    });
}

function openChatWindow(dfMessenger, bubbleNode) {
    const targetMessenger = dfMessenger || activeDfMessenger;
    const targetBubble = bubbleNode || activeBubbleNode;

    if (targetBubble && typeof targetBubble.openChat === "function") {
        targetBubble.openChat();
    }

    if (!isChatWindowOpen) {
        tryOpenChatByClick(targetMessenger);
    }

    window.setTimeout(() => {
        if (!isChatWindowOpen) {
            tryOpenChatByClick(targetMessenger);
        }
    }, 250);
}

function scheduleAutoStartConversation(dfMessenger) {
    if (!dfMessenger || hasAutoStartedConversation) {
        return;
    }

    if (dfMessenger._companyAutoStartPollId) {
        window.clearInterval(dfMessenger._companyAutoStartPollId);
        dfMessenger._companyAutoStartPollId = null;
    }
    if (dfMessenger._companyAutoStartDelayId) {
        window.clearTimeout(dfMessenger._companyAutoStartDelayId);
        dfMessenger._companyAutoStartDelayId = null;
    }

    const triggerConversationStart = () => {
        dfMessenger._companyAutoStartDelayId = window.setTimeout(() => {
            dfMessenger._companyAutoStartDelayId = null;
            startConversationWithWelcomeEvent(dfMessenger);
        }, AUTO_START_CHAT_DELAY_MS);
    };

    const stopPolling = () => {
        if (dfMessenger._companyAutoStartPollId) {
            window.clearInterval(dfMessenger._companyAutoStartPollId);
            dfMessenger._companyAutoStartPollId = null;
        }
    };

    const onMessengerLoaded = () => {
        if (tryArm()) {
            window.removeEventListener("df-messenger-loaded", onMessengerLoaded);
        }
    };

    function tryArm() {
        if (!dfMessenger || activeDfMessenger !== dfMessenger || hasAutoStartedConversation) {
            stopPolling();
            window.removeEventListener("df-messenger-loaded", onMessengerLoaded);
            return true;
        }
        if (typeof dfMessenger.sendRequest !== "function") {
            return false;
        }
        stopPolling();
        window.removeEventListener("df-messenger-loaded", onMessengerLoaded);
        triggerConversationStart();
        return true;
    }

    if (tryArm()) {
        return;
    }

    window.addEventListener("df-messenger-loaded", onMessengerLoaded);

    const pollStart = Date.now();
    dfMessenger._companyAutoStartPollId = window.setInterval(() => {
        if (Date.now() - pollStart > AUTO_START_SENDREQUEST_POLL_MAX_MS) {
            stopPolling();
            window.removeEventListener("df-messenger-loaded", onMessengerLoaded);
            return;
        }
        if (tryArm()) {
            window.removeEventListener("df-messenger-loaded", onMessengerLoaded);
        }
    }, AUTO_START_SENDREQUEST_POLL_MS);
}

function startConversationWithWelcomeEvent(dfMessenger) {
    if (!dfMessenger || hasAutoStartedConversation || typeof dfMessenger.sendRequest !== "function") {
        return;
    }

    hasAutoStartedConversation = true;
    syncDfMessengerSessionParametersFromClientContext(dfMessenger);

    dfMessenger.sendRequest("event", AUTO_START_CHAT_EVENT_NAME).catch(() => {
        hasAutoStartedConversation = false;
    });
}

function tryOpenChatByClick(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);
    const buttonSelectors = [
        "button[aria-label*='Open']",
        "button[aria-label*='open']",
        "button[aria-label*='Chat']",
        "button[aria-label*='chat']",
        "div[role='button'][aria-label*='Open']",
        "div[role='button'][aria-label*='open']",
        "div[role='button'][aria-label*='Chat']",
        "div[role='button'][aria-label*='chat']"
    ];

    for (const root of roots) {
        if (!root || !root.querySelector) {
            continue;
        }

        for (const selector of buttonSelectors) {
            const openButton = root.querySelector(selector);
            if (openButton && typeof openButton.click === "function") {
                openButton.click();
                return true;
            }
        }
    }

    return false;
}

function initializeMobileChatLayout(dfMessenger, config) {
    if (!dfMessenger) {
        return;
    }

    const applyLayout = () => {
        const desktopConfig = getDeviceSection(config, false);
        const desktopWindow = desktopConfig.chatWindow && typeof desktopConfig.chatWindow === "object" ? desktopConfig.chatWindow : {};
        const mobileRoot = getDeviceSection(config, true);
        const mobileConfig = mobileRoot.chatWindow && typeof mobileRoot.chatWindow === "object" ? mobileRoot.chatWindow : {};

        if (!isMobileViewport()) {
            const desktopDock = resolveChatLayoutSide(config);
            const rawDb = desktopWindow.bubblePosition && typeof desktopWindow.bubblePosition === "object"
                ? desktopWindow.bubblePosition
                : {};
            const desktopBubble = coalesceBubblePositionForChatSide(rawDb, desktopDock, { leftPx: 20, rightPx: 20, bottomPx: 20, topPx: null });

            applyFixedCornerToMessengerForDock(
                dfMessenger,
                desktopBubble,
                desktopDock,
                { horizontalInset: 20, bottomInset: 20, topInset: 20 }
            );
            setDfMessengerChatBubbleAnchorFromDock(dfMessenger, desktopDock, desktopBubble);

            // Keep desktop width/height from config instead of clearing them.
            const desktopWidth = typeof desktopWindow.widthPx === "number" && Number.isFinite(desktopWindow.widthPx)
                ? desktopWindow.widthPx
                : 420;
            const desktopBaseHeight = typeof desktopWindow.heightPx === "number" && Number.isFinite(desktopWindow.heightPx)
                ? desktopWindow.heightPx
                : 620;
            const desktopExtraH = typeof desktopWindow.extraHeightTowardBubblePx === "number" && Number.isFinite(desktopWindow.extraHeightTowardBubblePx)
                ? desktopWindow.extraHeightTowardBubblePx
                : 0;
            const desktopHeight = Math.max(200, Math.round(desktopBaseHeight + desktopExtraH));
            dfMessenger.style.setProperty("--df-messenger-chat-window-width", `${capDialogflowChatWindowWidthPx(desktopWidth)}px`);
            dfMessenger.style.setProperty("--df-messenger-chat-window-height", `${desktopHeight}px`);
            setDfMessengerChatWindowOffsetPx(dfMessenger, desktopWindow.chatWindowOffsetPx);
            scheduleSyncChatActionBarPosition();
            applyDeviceChatbotVisibility(config, dfMessenger);
            return;
        }

        if (!isFeatureEnabledFromConfig(mobileRoot, true)) {
            scheduleSyncChatActionBarPosition();
            applyDeviceChatbotVisibility(config, dfMessenger);
            return;
        }

        const viewport = window.visualViewport;
        const viewportWidth = viewport ? viewport.width : window.innerWidth;
        const viewportHeight = viewport ? viewport.height : window.innerHeight;
        const horizontalInset = typeof mobileConfig.horizontalInsetPx === "number" ? mobileConfig.horizontalInsetPx : 12;
        const bottomInset = typeof mobileConfig.bottomInsetPx === "number" ? mobileConfig.bottomInsetPx : 10;
        const topInset = typeof mobileConfig.topInsetPx === "number" ? mobileConfig.topInsetPx : 14;
        const minWidth = typeof mobileConfig.minWidthPx === "number" ? mobileConfig.minWidthPx : 280;
        const minHeight = typeof mobileConfig.minHeightPx === "number" ? mobileConfig.minHeightPx : 200;
        const mobileExtraH = typeof mobileConfig.extraHeightTowardBubblePx === "number" && Number.isFinite(mobileConfig.extraHeightTowardBubblePx)
            ? mobileConfig.extraHeightTowardBubblePx
            : 0;
        const safeTopReserve = typeof mobileConfig.safeAreaTopReservePx === "number" && Number.isFinite(mobileConfig.safeAreaTopReservePx)
            ? mobileConfig.safeAreaTopReservePx
            : 28;
        const safeInsetTop = getEnvSafeAreaInsetTopPx();
        const titlebarExtra = typeof mobileConfig.titlebarChromeReservePx === "number" && Number.isFinite(mobileConfig.titlebarChromeReservePx)
            ? mobileConfig.titlebarChromeReservePx
            : 48;
        const availableWidth = Math.max(minWidth, Math.floor(viewportWidth - horizontalInset * 2));
        const availableHeight = Math.max(
            minHeight,
            Math.floor(
                viewportHeight
                    - topInset
                    - bottomInset
                    - safeTopReserve
                    - safeInsetTop
                    - titlebarExtra
                    + mobileExtraH
            )
        );

        const mobileDock = resolveChatLayoutSide(config);
        const rawMb = mobileConfig.bubblePosition && typeof mobileConfig.bubblePosition === "object"
            ? mobileConfig.bubblePosition
            : {};
        const mobileBubble = coalesceBubblePositionForChatSide(
            rawMb,
            mobileDock,
            { leftPx: horizontalInset, rightPx: horizontalInset, bottomPx: bottomInset, topPx: null }
        );

        applyFixedCornerToMessengerForDock(
            dfMessenger,
            mobileBubble,
            mobileDock,
            { horizontalInset, bottomInset, topInset }
        );
        setDfMessengerChatBubbleAnchorFromDock(dfMessenger, mobileDock, mobileBubble);

        dfMessenger.style.setProperty("--df-messenger-chat-window-width", `${availableWidth}px`);
        dfMessenger.style.setProperty("--df-messenger-chat-window-height", `${availableHeight}px`);
        setDfMessengerChatWindowOffsetPx(dfMessenger, mobileConfig.chatWindowOffsetPx);
        scheduleSyncChatActionBarPosition();
        applyDeviceChatbotVisibility(config, dfMessenger);
    };

    applyLayout();
    window.addEventListener("resize", applyLayout);
    window.addEventListener("df-messenger-loaded", () => {
        if (activeDfMessenger === dfMessenger) {
            applyLayout();
            scheduleChatMessageListScrollbarReapply(dfMessenger);
        }
    });

    if (window.visualViewport) {
        const onVisualViewportResize = () => {
            applyLayout();
            if (isMobileViewport()) {
                resetChatActionBarPositionCaches();
                [50, 160, 420].forEach((delay) => {
                    window.setTimeout(() => {
                        if (activeDfMessenger === dfMessenger) {
                            scheduleSyncChatActionBarPosition();
                        }
                    }, delay);
                });
            }
        };
        window.visualViewport.addEventListener("resize", onVisualViewportResize);
        // Do not re-run full `applyLayout` on vV scroll — it can fight the runtime and jiggle the panel;
        // only re-anchor fixed footer chrome to the moving composer.
        window.visualViewport.addEventListener("scroll", throttledSyncChatActionBarFromUserScroll, { passive: true });
    }

    document.addEventListener("focusin", (ev) => {
        if (isTargetInsideChatActionBar(ev.target)) {
            return;
        }
        applyLayout();
        if (isMobileViewport() && isMessageComposerField(/** @type {Element} */(ev.target)) && isFocusInMessenger(dfMessenger, ev.target)) {
            resetChatActionBarPositionCaches();
            [0, 90, 220, 500].forEach((delay) => {
                window.setTimeout(() => {
                    if (activeDfMessenger === dfMessenger) {
                        scheduleSyncChatActionBarPosition();
                    }
                }, delay);
            });
        }
    });
    document.addEventListener("focusout", () => {
        window.setTimeout(() => {
            if (isTargetInsideChatActionBar(document.activeElement)) {
                return;
            }
            applyLayout();
        }, 120);
    });
}

function isMobileViewport() {
    return window.innerWidth <= MOBILE_CHAT_BREAKPOINT_PX;
}

function initializeChatStateSync(dfMessenger) {
    if (!dfMessenger) {
        return;
    }

    window.addEventListener("df-chat-open-changed", (event) => {
        isChatWindowOpen = !!(event && event.detail && event.detail.isOpen);
        ensureBubbleVisible(dfMessenger);
        if (isChatWindowOpen) {
            if (activeDfMessenger === dfMessenger && IS_FORCE_TITLEBAR_CLOSE_X_ENABLED) {
                ensureCloseIconIsX(dfMessenger);
                [90, 240, 550].forEach((d) => {
                    window.setTimeout(() => {
                        if (activeDfMessenger === dfMessenger) {
                            ensureCloseIconIsX(dfMessenger);
                        }
                    }, d);
                });
                startCloseXWhileChatOpenMonitor(dfMessenger);
            }
            resetChatActionBarPositionCaches();
            scheduleChatMessageListScrollbarReapply(dfMessenger);
            const ui0 = readCompanyUiConfig();
            if (resolveChatLayoutSide(ui0) === "left") {
                const cwin0 = (() => {
                    const s = getDeviceSection(ui0, isMobileViewport());
                    return s.chatWindow && typeof s.chatWindow === "object" ? s.chatWindow : {};
                })();
                const rawBp0 = cwin0 && typeof cwin0.bubblePosition === "object" ? cwin0.bubblePosition : {};
                const mView0 = isMobileViewport();
                const defaults0 = mView0
                    ? { leftPx: 12, rightPx: 12, bottomPx: 10, topPx: null }
                    : { leftPx: 20, rightPx: 20, bottomPx: 20, topPx: null };
                const coalesced0 = coalesceBubblePositionForChatSide(rawBp0, "left", defaults0);
                window.setTimeout(() => {
                    setDfMessengerChatBubbleAnchorFromDock(dfMessenger, "left", coalesced0);
                }, 0);
            }
        }
        window.setTimeout(scheduleSyncChatActionBarPosition, 0);
        if (isChatWindowOpen) {
            resetBubbleUnreadBadge();
            scheduleUserInputVerticalNudge(dfMessenger);
            scheduleFooterInputBoxShadowOverrides(dfMessenger);
            scheduleAutoStartConversation(dfMessenger);
            window.setTimeout(scheduleSyncChatActionBarPosition, 120);
            if (isMobileViewport()) {
                safeAreaTopInsetCache = null;
                bindFooterScrollParentsForChat(dfMessenger);
                startMobileFooterChromeLayoutLoop();
                applyHostPageScrollLockForOpenChat();
            }
            syncMobileLightboxParkStateFromChat();
            return;
        }

        stopMobileFooterChromeLayoutLoop();
        clearFooterScrollParentListeners();
        releaseHostPageScrollLockForOpenChat();
        stopCloseXWhileChatOpenMonitor();
        // When the panel closes, dismiss any open (or scheduled) inline form (contact / appointment / upload) so it
        // does not float without the chat. Restart also clears the form (see restartChatSession).
        window.setTimeout(() => {
            closeForm();
        }, 0);
        syncMobileLightboxParkStateFromChat();
    });

    document.addEventListener("click", (event) => {
        if (didUserCloseChat(event)) {
            suppressDfchatLightboxAfterChatDismiss();
            window.setTimeout(() => {
                closeForm();
            }, 0);
        }
    }, true);

    const observer = new MutationObserver(() => {
        const wasOpen = isChatWindowOpen;
        isChatWindowOpen = isChatExpanded(dfMessenger);
        if (isChatWindowOpen) {
            resetBubbleUnreadBadge();
        }
        if (!isChatWindowOpen) {
            window.setTimeout(() => {
                closeForm();
            }, 0);
        }
        if (isChatWindowOpen && isMobileViewport()) {
            if (!wasOpen) {
                safeAreaTopInsetCache = null;
            }
            bindFooterScrollParentsForChat(dfMessenger);
            startMobileFooterChromeLayoutLoop();
            applyHostPageScrollLockForOpenChat();
        } else {
            stopMobileFooterChromeLayoutLoop();
            clearFooterScrollParentListeners();
            releaseHostPageScrollLockForOpenChat();
        }
        scheduleSyncChatActionBarPosition();
        syncMobileLightboxParkStateFromChat();
    });

    observer.observe(dfMessenger, {
        attributes: true,
        attributeFilter: ["expand"]
    });
}

function didUserCloseChat(event) {
    const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];

    // Ignore clicks inside the fullscreen image / video overlays; never treat them as closing the chat.
    for (const node of eventPath) {
        if (!node) {
            continue;
        }
        if (typeof node.id === "string" && (node.id === IMAGE_LIGHTBOX_ID || node.id === VIDEO_LIGHTBOX_ID)) {
            return false;
        }
        if (typeof node.getAttribute === "function") {
            const idAttr = node.getAttribute("id");
            if (idAttr === IMAGE_LIGHTBOX_ID || idAttr === VIDEO_LIGHTBOX_ID) {
                return false;
            }
        }
    }

    return eventPath.some((node) => {
        if (!node || typeof node.getAttribute !== "function") {
            return false;
        }

        const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
        const dataTestId = (node.getAttribute("data-testid") || "").toLowerCase();
        // Never scan full subtree textContent on large hosts (e.g. df-messenger) — it contains all messages
        // and matches "close" inside words like "closest", or any reply mentioning "close".
        if (/\b(close|collapse|minimize)\b/i.test(ariaLabel) || /\b(close|collapse|minimize)\b/i.test(dataTestId)) {
            return true;
        }

        const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
        const isSmallControl = tag === "button" || tag === "df-icon-button" || tag === "svg" || tag === "path";
        if (isSmallControl && typeof node.textContent === "string") {
            const trimmed = node.textContent.replace(/\s+/g, " ").trim().toLowerCase();
            if (trimmed.length > 0 && trimmed.length <= 48) {
                if (/\b(close|collapse|minimize)\b/.test(trimmed)) {
                    return true;
                }
                if (trimmed === "×" || trimmed === "✕") {
                    return true;
                }
            }
        }

        return false;
    });
}

/** True when the click path includes the real title/header strip (collapse/×). Omit broad tags (e.g. chat-header) that can wrap chips/carousels. */
function isClickInMessengerChatTitlebar(eventPath) {
    if (!Array.isArray(eventPath)) {
        return false;
    }
    for (const node of eventPath) {
        if (!node || typeof node.tagName !== "string") {
            continue;
        }
        const tag = node.tagName.toLowerCase();
        if (
            tag === "df-messenger-header"
            || tag === "df-messenger-header-controls"
            || tag === "df-messenger-titlebar"
        ) {
            return true;
        }
        try {
            if (typeof node.getAttribute === "function") {
                if (node.getAttribute("data-dfchat-native-close-override") === "1") {
                    return true;
                }
            }
        } catch {
            /* ignore */
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Image lightbox (fullscreen overlay) for rich HTML image carousels.
// ---------------------------------------------------------------------------

const IMAGE_LIGHTBOX_ID = "dfchat-image-lightbox";
const IMAGE_LIGHTBOX_IMG_ID = "dfchat-image-lightbox-img";
const IMAGE_LIGHTBOX_CLOSE_ID = "dfchat-image-lightbox-close";
const IMAGE_LIGHTBOX_PREV_ID = "dfchat-image-lightbox-prev";
const IMAGE_LIGHTBOX_NEXT_ID = "dfchat-image-lightbox-next";

const VIDEO_LIGHTBOX_ID = "dfchat-video-lightbox";
const VIDEO_LIGHTBOX_PANEL_ID = "dfchat-video-lightbox-panel";
const VIDEO_LIGHTBOX_IFRAME_ID = "dfchat-video-lightbox-iframe";
const VIDEO_LIGHTBOX_CLOSE_ID = "dfchat-video-lightbox-close";

/** Block stray lightbox/chrome after dismiss; works on desktop + mobile. */
const DFCHAT_LIGHTBOX_SUPPRESS_AFTER_CLOSE_MS = 1500;
let dfchatLightboxSuppressUntilMs = 0;

function ensureMobileLightboxParkStyle() {
    if (!document.head && !document.documentElement) {
        return;
    }
    if (document.getElementById("dfchat-mobile-lb-park-style")) {
        return;
    }
    const tag = document.createElement("style");
    tag.id = "dfchat-mobile-lb-park-style";
    tag.textContent = `
html.dfchat-mobile-lb-off #${IMAGE_LIGHTBOX_ID},
html.dfchat-mobile-lb-off #${VIDEO_LIGHTBOX_ID} {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`.trim();
    (document.head || document.documentElement).appendChild(tag);
}

function suppressDfchatLightboxAfterChatDismiss() {
    ensureMobileLightboxParkStyle();
    try {
        document.documentElement.classList.add("dfchat-mobile-lb-off");
    } catch {
        /* ignore */
    }
    try {
        closeImageLightbox();
        closeVideoLightbox();
    } catch {
        /* ignore */
    }
    dfchatLightboxSuppressUntilMs = Date.now() + DFCHAT_LIGHTBOX_SUPPRESS_AFTER_CLOSE_MS;
}

function dfchatLightboxShouldStayClosed() {
    // Only block opens briefly after a dismiss (close chat / park). Do not gate on isChatExpanded here —
    // that flag can desync and block carousel/gallery opens while the panel is visually open.
    return Date.now() < dfchatLightboxSuppressUntilMs;
}

function syncMobileLightboxParkStateFromChat() {
    ensureMobileLightboxParkStyle();
    const ms = activeDfMessenger || document.querySelector("df-messenger");
    const expanded = ms && isChatExpanded(ms);
    if (expanded) {
        try {
            document.documentElement.classList.remove("dfchat-mobile-lb-off");
        } catch {
            /* ignore */
        }
        return;
    }
    suppressDfchatLightboxAfterChatDismiss();
}

/** @type {string[]} */
let imageLightboxSrcs = [];
let imageLightboxIndex = 0;

function setImageLightboxIndex(nextIndex) {
    if (!Array.isArray(imageLightboxSrcs) || imageLightboxSrcs.length === 0) {
        return;
    }
    const overlay = document.getElementById(IMAGE_LIGHTBOX_ID);
    const img = document.getElementById(IMAGE_LIGHTBOX_IMG_ID);
    const prev = document.getElementById(IMAGE_LIGHTBOX_PREV_ID);
    const next = document.getElementById(IMAGE_LIGHTBOX_NEXT_ID);
    if (!overlay || !img) {
        return;
    }
    const n = imageLightboxSrcs.length;
    const i = ((nextIndex % n) + n) % n;
    imageLightboxIndex = i;
    img.src = imageLightboxSrcs[i];
    if (prev) {
        prev.style.display = n > 1 ? "grid" : "none";
    }
    if (next) {
        next.style.display = n > 1 ? "grid" : "none";
    }
}

function stepImageLightbox(delta) {
    if (!imageLightboxSrcs || imageLightboxSrcs.length <= 1) {
        return;
    }
    setImageLightboxIndex(imageLightboxIndex + delta);
}

function isInShadowHostChain(el, tagNameLower) {
    try {
        let cur = el;
        while (cur) {
            if (cur.tagName && String(cur.tagName).toLowerCase() === tagNameLower) {
                return true;
            }
            const root = cur.getRootNode && cur.getRootNode();
            cur = root && root.host ? root.host : null;
        }
    } catch {
        /* ignore */
    }
    return false;
}

/**
 * Same-document “parent”, then crossing a shadow boundary to the shadow host (`… -> host`).
 * @param {Element} elem
 * @returns {Element | null}
 */
function composedParentElement(elem) {
    if (!elem || !(elem instanceof Element)) {
        return null;
    }
    if (elem.parentElement) {
        return elem.parentElement;
    }
    const r =
        typeof elem.getRootNode === "function"
            ? /** @type {Node} */ (elem.getRootNode())
            : null;
    return r instanceof ShadowRoot && r.host instanceof Element ? r.host : null;
}

/**
 * True only for the floating launcher FAB chrome (`.bubble`), not the expanded chat transcript.
 * `isInShadowHostChain(..., "df-messenger-chat-bubble")` is too broad: bot messages often live under
 * that custom element, which broke lightbox for inline gallery and other chat images.
 * @param {Node | null | undefined} el
 * @returns {boolean}
 */
function isInsideMessengerLauncherBubbleGraphic(el) {
    if (!(el instanceof Element)) {
        return false;
    }
    try {
        /** @type {Element | null} */
        let cur = /** @type {Element} */ (el);
        while (cur) {
            if (cur.classList && cur.classList.contains("bubble")) {
                return true;
            }
            cur = composedParentElement(cur);
        }
    } catch {
        /* ignore */
    }
    return false;
}

function bindLightboxToMessengerImages(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    if (!ms) {
        return;
    }
    const roots = collectSearchRoots(ms);
    for (const root of roots) {
        if (!root || typeof root.querySelectorAll !== "function") {
            continue;
        }
        let imgs;
        try {
            imgs = root.querySelectorAll("img");
        } catch {
            continue;
        }
        for (const img of imgs) {
            if (!img || img.dataset?.dfchatLightboxBound === "1") {
                continue;
            }
            const src = img.getAttribute ? (img.getAttribute("src") || "") : "";
            if (!src) {
                continue;
            }
            // Never bind inside widget chrome (launcher FAB, header, footer input).
            if (isInsideMessengerLauncherBubbleGraphic(img)
                || isInShadowHostChain(img, "df-messenger-header")
                || isInShadowHostChain(img, "df-messenger-user-input")) {
                continue;
            }
            if (src.includes("dfchat-")) {
                continue;
            }
            // Bind for any chat message image (rich content, HTML payload, markdown image, etc.).
            // (We avoid restricting by attributes because CX HTML sanitizer can strip them.)
            img.dataset.dfchatLightboxBound = "1";
            img.style.cursor = "zoom-in";
            img.addEventListener("click", (e) => {
                const ep = typeof e.composedPath === "function" ? e.composedPath() : [];
                try {
                    if (didUserCloseChat(e) || isClickInMessengerChatTitlebar(ep)) {
                        suppressDfchatLightboxAfterChatDismiss();
                        return;
                    }
                } catch {
                    /* ignore */
                }
                if (dfchatLightboxShouldStayClosed()) {
                    return;
                }
                e.preventDefault?.();
                e.stopPropagation?.();
                // Safety: never open for launcher FAB / chrome even if bound somehow.
                if (isInsideMessengerLauncherBubbleGraphic(img)
                    || isInShadowHostChain(img, "df-messenger-header")
                    || isInShadowHostChain(img, "df-messenger-user-input")) {
                    return;
                }
                // Same carousel/gallery strip only — not the whole transcript (see attachImageLightboxClickHandler).
                /** @type {Element | null} */
                let scopeEl = img.parentElement;
                /** @type {Element | null} */
                let walk = img;
                while (walk && walk instanceof Element) {
                    if (walk.classList
                        && (walk.classList.contains(`${DFCHAT_INLINE_CARD_CAROUSEL_CLASS}__track`)
                            || walk.classList.contains(`${DFCHAT_INLINE_GALLERY_CLASS}__track`))) {
                        scopeEl = walk;
                        break;
                    }
                    walk = walk.parentElement;
                }
                let srcs = [];
                if (scopeEl && typeof scopeEl.querySelectorAll === "function") {
                    try {
                        srcs = Array.from(scopeEl.querySelectorAll("img"))
                            .map((el) => (el.getAttribute ? (el.getAttribute("src") || "") : ""))
                            .filter((u) => u && !u.includes("dfchat-"));
                    } catch {
                        srcs = [];
                    }
                }
                if (!srcs.length) {
                    srcs = [src];
                }
                const idx = Math.max(0, srcs.indexOf(src));
                openImageLightbox(srcs, idx, img.getAttribute ? img.getAttribute("alt") : "");
            }, true);
        }
    }
}

function ensureLightboxImageObserver(dfMessenger) {
    const ms = dfMessenger || activeDfMessenger;
    if (!ms || ms._dfchatLightboxMO) {
        return;
    }
    try {
        let scheduled = false;
        const mo = new MutationObserver(() => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            window.requestAnimationFrame(() => {
                scheduled = false;
                bindLightboxToMessengerImages(ms);
            });
        });
        mo.observe(ms, { childList: true, subtree: true });
        ms._dfchatLightboxMO = mo;
    } catch {
        /* ignore */
    }
}

function ensureImageLightboxMounted() {
    if (document.getElementById(IMAGE_LIGHTBOX_ID)) {
        return;
    }
    const overlay = document.createElement("div");
    overlay.id = IMAGE_LIGHTBOX_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "padding:18px",
        "background:rgba(2, 6, 23, 0.72)",
        "backdrop-filter:blur(2px)",
        "z-index:2147483647"
    ].join(";");

    const img = document.createElement("img");
    img.id = IMAGE_LIGHTBOX_IMG_ID;
    img.alt = "";
    img.style.cssText = [
        "max-width:min(96vw, 1100px)",
        "max-height:92vh",
        "width:auto",
        "height:auto",
        "display:block",
        "border-radius:14px",
        "box-shadow:0 24px 80px rgba(0,0,0,0.55)",
        "background:#fff"
    ].join(";");

    const closeBtn = document.createElement("button");
    closeBtn.id = IMAGE_LIGHTBOX_CLOSE_ID;
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = [
        "position:absolute",
        "top:14px",
        "right:14px",
        "width:44px",
        "height:44px",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.22)",
        "background:rgba(15,23,42,0.55)",
        "color:#fff",
        "font-size:28px",
        "line-height:1",
        "display:grid",
        "place-items:center",
        "cursor:pointer"
    ].join(";");

    const mkArrow = (id, label, dir) => {
        const b = document.createElement("button");
        b.id = id;
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.textContent = dir;
        b.style.cssText = [
            "position:absolute",
            "top:50%",
            "transform:translateY(-50%)",
            id === IMAGE_LIGHTBOX_PREV_ID ? "left:12px" : "right:12px",
            "width:46px",
            "height:46px",
            "border-radius:999px",
            "border:1px solid rgba(255,255,255,0.22)",
            "background:rgba(15,23,42,0.55)",
            "color:#fff",
            "font-size:22px",
            "display:grid",
            "place-items:center",
            "cursor:pointer"
        ].join(";");
        return b;
    };
    const prevBtn = mkArrow(IMAGE_LIGHTBOX_PREV_ID, "Previous image", "‹");
    const nextBtn = mkArrow(IMAGE_LIGHTBOX_NEXT_ID, "Next image", "›");

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        // Click outside the image closes.
        if (e.target === overlay) {
            closeImageLightbox();
        }
    });

    closeBtn.addEventListener("click", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        closeImageLightbox();
    });
    prevBtn.addEventListener("click", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        stepImageLightbox(-1);
    });
    nextBtn.addEventListener("click", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        stepImageLightbox(1);
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const videoOverlay = document.getElementById(VIDEO_LIGHTBOX_ID);
            if (videoOverlay && videoOverlay.style.display === "flex") {
                closeVideoLightbox();
                return;
            }
            closeImageLightbox();
            return;
        }
        const overlay = document.getElementById(IMAGE_LIGHTBOX_ID);
        if (!overlay || overlay.style.display === "none") {
            return;
        }
        if (e.key === "ArrowLeft") {
            stepImageLightbox(-1);
        } else if (e.key === "ArrowRight") {
            stepImageLightbox(1);
        }
    });
}

function openImageLightbox(srcs, index, alt) {
    ensureMobileLightboxParkStyle();
    if (dfchatLightboxShouldStayClosed()) {
        return;
    }
    try {
        document.documentElement.classList.remove("dfchat-mobile-lb-off");
    } catch {
        /* ignore */
    }
    ensureImageLightboxMounted();
    const overlay = document.getElementById(IMAGE_LIGHTBOX_ID);
    const img = document.getElementById(IMAGE_LIGHTBOX_IMG_ID);
    if (!overlay || !img) {
        return;
    }
    imageLightboxSrcs = Array.isArray(srcs) ? srcs.filter(Boolean) : [];
    imageLightboxIndex = Number.isFinite(index) ? index : 0;
    if (imageLightboxSrcs.length === 0) {
        return;
    }
    img.alt = typeof alt === "string" ? alt : "";
    setImageLightboxIndex(imageLightboxIndex);
    img.alt = typeof alt === "string" ? alt : "";
    overlay.style.display = "flex";
    try {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
    } catch {
        /* ignore */
    }
}

function closeImageLightbox() {
    const overlay = document.getElementById(IMAGE_LIGHTBOX_ID);
    const img = document.getElementById(IMAGE_LIGHTBOX_IMG_ID);
    if (img) {
        img.removeAttribute("src");
    }
    imageLightboxSrcs = [];
    imageLightboxIndex = 0;
    if (overlay) {
        overlay.style.display = "none";
    }
    try {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
    } catch {
        /* ignore */
    }
}

function ensureVideoLightboxMounted() {
    if (document.getElementById(VIDEO_LIGHTBOX_ID)) {
        return;
    }
    const overlay = document.createElement("div");
    overlay.id = VIDEO_LIGHTBOX_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Video");
    overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "display:none",
        "flex-direction:column",
        "align-items:center",
        "justify-content:center",
        "padding:16px",
        "background:rgba(2, 6, 23, 0.78)",
        "backdrop-filter:blur(3px)",
        "z-index:2147483646",
        "box-sizing:border-box"
    ].join(";");

    const panel = document.createElement("div");
    panel.id = VIDEO_LIGHTBOX_PANEL_ID;
    panel.style.cssText = [
        "position:relative",
        "width:min(96vw, 1100px)",
        "max-width:100%"
    ].join(";");

    const ratio = document.createElement("div");
    ratio.style.cssText = [
        "position:relative",
        "width:100%",
        "padding-bottom:56.25%",
        "height:0",
        "overflow:hidden",
        "border-radius:14px",
        "background:#000",
        "box-shadow:0 24px 80px rgba(0,0,0,0.55)"
    ].join(";");

    const iframe = document.createElement("iframe");
    iframe.id = VIDEO_LIGHTBOX_IFRAME_ID;
    iframe.setAttribute("title", "YouTube video (fullscreen)");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
        "allow",
        [
            "accelerometer",
            "autoplay",
            "clipboard-write",
            "encrypted-media",
            "gyroscope",
            "picture-in-picture",
            "web-share",
            "fullscreen",
        ].join("; ")
    );
    iframe.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "border:0",
        "display:block"
    ].join(";");

    ratio.appendChild(iframe);

    const closeBtn = document.createElement("button");
    closeBtn.id = VIDEO_LIGHTBOX_CLOSE_ID;
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close video");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = [
        "width:44px",
        "height:44px",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.22)",
        "background:rgba(15,23,42,0.55)",
        "color:#fff",
        "font-size:28px",
        "line-height:1",
        "display:grid",
        "place-items:center",
        "cursor:pointer",
        "flex:0 0 auto"
    ].join(";");

    const ctr = document.createElement("div");
    ctr.style.cssText = [
        "display:flex",
        "width:100%",
        "justify-content:flex-end",
        "marginBottom:12px",
        "box-sizing:border-box"
    ].join(";");
    ctr.appendChild(closeBtn);
    panel.appendChild(ctr);
    panel.appendChild(ratio);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
        e.preventDefault?.();
        if (/** @type {Node} */ (e.target) === overlay) {
            closeVideoLightbox();
        }
    });
    closeBtn.addEventListener("click", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        closeVideoLightbox();
    });
}

/**
 * Same embed URL as inline player — opens fullscreen-style overlay inside the page (not exiting chat).
 * @param {string} embedHttpsUrl
 */
function openVideoLightbox(embedHttpsUrl) {
    const src = typeof embedHttpsUrl === "string" ? embedHttpsUrl.trim() : "";
    if (!src || !/^https:\/\/www\.youtube\.com\/embed\//i.test(src)) {
        return;
    }
    ensureMobileLightboxParkStyle();
    if (dfchatLightboxShouldStayClosed()) {
        return;
    }
    try {
        document.documentElement.classList.remove("dfchat-mobile-lb-off");
    } catch {
        /* ignore */
    }
    ensureVideoLightboxMounted();
    /** @type {HTMLElement | null} */
    const overlay = document.getElementById(VIDEO_LIGHTBOX_ID);
    /** @type {HTMLIFrameElement | null} */
    const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById(VIDEO_LIGHTBOX_IFRAME_ID));

    /** @type {HTMLElement | null} */
    const imageLb = document.getElementById(IMAGE_LIGHTBOX_ID);
    try {
        if (imageLb && imageLb.style.display === "flex") {
            closeImageLightbox();
        }
    } catch {
        /* ignore */
    }

    if (!overlay || !iframe) {
        return;
    }

    try {
        const embedUrl = new URL(src);
        if (!embedUrl.searchParams.get("autoplay")) {
            embedUrl.searchParams.set("autoplay", "1");
        }
        iframe.src = embedUrl.toString();
    } catch {
        iframe.src = src;
    }
    overlay.style.display = "flex";

    try {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
    } catch {
        /* ignore */
    }
}

/**
 * Inline video wrappers are under `df-messenger` shadow DOM — `document.querySelectorAll` misses them,
 * which broke restoring the chat iframe after closing the fullscreen panel.
 *
 * @returns {HTMLElement[]}
 */
function queryInlineVideoWrapsAwaitingLightboxRestore() {
    /** @type {HTMLElement[]} */
    const out = [];
    /** @type {HTMLElement | null} */
    const ms =
        (typeof activeDfMessenger !== "undefined" && activeDfMessenger)
            ? activeDfMessenger
            : (typeof document !== "undefined" ? /** @type {HTMLElement | null} */ (document.querySelector("df-messenger"))
                : null);
    /** @type {Array<Document | ShadowRoot>} */
    const roots = ms ? collectSearchRoots(ms) : (typeof document !== "undefined" ? [document] : []);
    for (let ri = 0; ri < roots.length; ri += 1) {
        const root = roots[ri];
        if (!root || typeof root.querySelectorAll !== "function") {
            continue;
        }
        let nodes;
        try {
            nodes = root.querySelectorAll(".dfchat-inline-video[data-dfc-await-restore]");
        } catch {
            continue;
        }
        nodes.forEach((node) => {
            if (node instanceof HTMLElement) {
                out.push(node);
            }
        });
    }
    return out;
}

function closeVideoLightbox() {
    /** @type {HTMLIFrameElement | null} */
    const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById(VIDEO_LIGHTBOX_IFRAME_ID));
    /** @type {HTMLElement | null} */
    const overlay = document.getElementById(VIDEO_LIGHTBOX_ID);

    if (iframe) {
        iframe.removeAttribute("src");
        try {
            iframe.src = "";
        } catch {
            /* ignore */
        }
    }
    if (overlay) {
        overlay.style.display = "none";
    }

    /** Resume inline embed if the user expanded from chat (avoids two players at once). */
    try {
        queryInlineVideoWrapsAwaitingLightboxRestore().forEach((wrap) => {
            const emb = wrap.dataset ? wrap.dataset.dfcYtEmbed : "";
            const el =
                typeof wrap.querySelector === "function" ? wrap.querySelector("iframe") : null;
            if (emb && el instanceof HTMLIFrameElement) {
                el.src = emb;
            }
            if (wrap.dataset && wrap.dataset.dfcAwaitRestore !== undefined) {
                delete wrap.dataset.dfcAwaitRestore;
            }
        });
    } catch {
        /* ignore */
    }

    try {
        /** Don’t unblock scroll if image lightbox is still supposed to dim the page */

        /** @type {HTMLElement | null} */
        const imageLb = document.getElementById(IMAGE_LIGHTBOX_ID);
        if (!imageLb || imageLb.style.display !== "flex") {
            document.documentElement.style.overflow = "";
            document.body.style.overflow = "";
        }
    } catch {
        /* ignore */
    }
}

const DFCHAT_INLINE_GALLERY_CLASS = "dfchat-inline-gallery";
const DFCHAT_INLINE_VIDEO_CLASS = "dfchat-inline-video";
const DFCHAT_INLINE_CARD_CAROUSEL_CLASS = "dfchat-inline-card-carousel";
const DFCHAT_INLINE_SELECT_CLASS = "dfchat-inline-select";
const DFCHAT_INLINE_BOOKING_CAL_CLASS = "dfchat-inline-booking-calendar";

/**
 * Remove ALL injected inline galleries across messenger roots.
 * (The message-list shadow root can remount; removing only from the "current" list can miss older nodes.)
 * @param {HTMLElement | null | undefined} dfMessenger
 */
function removeAllDfchatInlineGalleries(dfMessenger) {
    const ms =
        dfMessenger
        || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
        || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);
    /** @type {Array<Document | ShadowRoot | HTMLElement>} */
    const roots = ms ? collectSearchRoots(ms) : [];
    if (typeof document !== "undefined") {
        roots.push(document);
    }
    for (const root of roots) {
        if (!root || typeof root.querySelectorAll !== "function") {
            continue;
        }
        let nodes = [];
        try {
            nodes = Array.from(root.querySelectorAll(`.${DFCHAT_INLINE_GALLERY_CLASS}`));
        } catch {
            nodes = [];
        }
        for (const el of nodes) {
            try {
                el.remove?.();
            } catch {
                try {
                    if (el && el.parentNode) {
                        el.parentNode.removeChild(el);
                    }
                } catch {
                    /* ignore */
                }
            }
        }
    }
    dfchatLastInlineGalleryWrapEl = null;
}

/**
 * Locate the Messenger scroll pane so we can append a horizontally scrollable carousel.
 * @param {HTMLElement | null | undefined} dfMessenger
 * @returns {HTMLElement | null}
 */
function findMessengerMessageListRoot(dfMessenger) {
    const ms =
        dfMessenger
        || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
        || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);
    if (!ms) {
        return null;
    }
    const roots = collectSearchRoots(ms);
    for (let ri = 0; ri < roots.length; ri += 1) {
        const root = roots[ri];
        if (!root || typeof root.querySelector !== "function") {
            continue;
        }
        /** @type {HTMLElement | null} */
        let el =
            root.querySelector("#message-list")
            || root.querySelector('[data-testid="message-list"]')
            || root.querySelector("df-message-list")
            ;
        try {
            if (!el && root.getElementById) {
                el = /** @type {HTMLElement | null} */ (root.getElementById("message-list"));
            }
        } catch {
            /* ignore */
        }
        if (el) {
            return el;
        }
    }
    return null;
}

/**
 * @param {Element | null | undefined} el
 * @returns {boolean}
 */
function isDfchatInlineSyntheticRow(el) {
    return !!(el
        && el instanceof Element
        && el.classList
        && (el.classList.contains(DFCHAT_INLINE_GALLERY_CLASS)
            || el.classList.contains(DFCHAT_INLINE_VIDEO_CLASS)
            || el.classList.contains(DFCHAT_INLINE_BOOKING_CAL_CLASS)));
}

/**
 * Place gallery between visible bot rows when possible:
 * - if there are at least 2 real rows, insert before the last one
 * - otherwise append at the end
 *
 * @param {HTMLElement} messageList
 * @returns {Element | null}
 */
function resolveGalleryInsertBeforeByCxOrder(messageList) {
    const realRows = Array.from(messageList.children).filter((el) => !isDfchatInlineSyntheticRow(el));
    if (realRows.length < 2) {
        return null;
    }
    return /** @type {Element} */ (realRows[realRows.length - 1]);
}

/**
 * Append a horizontal image strip inside the chat transcript (`open_gallery`).
 * Uses inline styles because Dialogflow Messenger lives under shadow DOM (external CSS rarely applies).
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {string[]} urls
 * @param {unknown[]} [messages]
 */
function scheduleInjectInlineGalleryCarousel(dfMessenger, urls, messages, options, messageText) {
    const list = Array.isArray(urls)
        ? urls
            .map((u) => String(u || "").trim())
            .filter((u) => u.startsWith("https://") || u.startsWith("http://"))
        : [];
    if (list.length === 0) {
        return;
    }

    // Turn-local sequence token so delayed timers from previous turns don't inject stale gallery.
    const injectSeq = (dfchatInlineGalleryInjectSeq += 1);

    let injected = false;
    /** @type {ReturnType<typeof setTimeout>[] | undefined} */
    let pendingTimers;
    /** @type {HTMLElement | null} */
    let msResolved =
        dfMessenger
        || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
        || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);

    /** @returns {HTMLElement | null} */
    function listRoot() {
        return findMessengerMessageListRoot(msResolved);
    }

    /** @returns {void} */
    function tryAppend() {
        if (injectSeq !== dfchatInlineGalleryInjectSeq) {
            return;
        }
        if (injected) {
            return;
        }
        const ml = listRoot();
        if (!ml || typeof ml.appendChild !== "function") {
            return;
        }

        // Replace: remove any previously injected inline gallery so only the latest is visible.
        removeAllDfchatInlineGalleries(msResolved);

        const wrap = document.createElement("div");
        wrap.className = DFCHAT_INLINE_GALLERY_CLASS;
        wrap.setAttribute("data-dfchat-no-translate", "true");
        wrap.style.cssText = [
            "box-sizing:border-box",
            "margin:8px 0 10px",
            "padding:0 2px",
            "width:100%",
            "max-width:100%"
        ].join(";");

        const track = document.createElement("div");
        track.className = `${DFCHAT_INLINE_GALLERY_CLASS}__track`;
        track.style.cssText = [
            "display:flex",
            "flex-direction:row",
            "flex-wrap:nowrap",
            "gap:10px",
            "overflow-x:auto",
            "overflow-y:hidden",
            "-webkit-overflow-scrolling:touch",
            "scroll-snap-type:x mandatory",
            "scrollbar-width:thin",
            "padding:2px 0 8px",
            "box-sizing:border-box",
            "max-width:100%"
        ].join(";");

        for (let i = 0; i < list.length; i += 1) {
            const cell = document.createElement("div");
            cell.style.cssText = [
                "flex:0 0 auto",
                "scroll-snap-align:start",
                "width:min(76vw,200px)",
                "max-width: min(76vw,200px)",
                "box-sizing:border-box"
            ].join(";");

            const img = document.createElement("img");
            img.src = list[i];
            img.alt = "";
            img.setAttribute("draggable", "false");
            img.loading = i < 3 ? "eager" : "lazy";
            img.decoding = "async";
            img.style.cssText = [
                "display:block",
                "width:100%",
                "height:126px",
                "object-fit:cover",
                "border-radius:10px",
                "cursor:zoom-in",
                "background:rgba(148,163,184,0.18)",
                "border:1px solid rgba(148,163,184,0.35)",
                "box-sizing:border-box"
            ].join(";");

            cell.appendChild(img);
            track.appendChild(cell);
        }

        wrap.appendChild(track);

        const opts = Array.isArray(options) ? options : [];
        const msg = typeof messageText === "string" ? messageText.trim() : "";
        // Optional message + opt-in buttons directly below the image strip.
        if (msg) {
            const messageEl = document.createElement("div");
            messageEl.textContent = msg;
            messageEl.style.cssText = [
                "width:100%",
                "box-sizing:border-box",
                "color:#000",
                "font-size:13px",
                "line-height:1.35",
                "margin:6px 0 -2px",
                "padding:0 2px"
            ].join(";");
            wrap.appendChild(messageEl);
        }
        if (opts.length > 0) {
            const chips = document.createElement("div");
            chips.style.cssText = [
                "display:flex",
                "flex-wrap:wrap",
                "gap:8px",
                "margin-top:10px",
                "padding:0 2px",
                "box-sizing:border-box",
                "width:100%"
            ].join(";");

            const ms = msResolved || activeDfMessenger;
            for (let oi = 0; oi < opts.length; oi += 1) {
                const opt = opts[oi];
                const label = String(opt && opt.label ? opt.label : "").trim();
                const value = String(opt && opt.value ? opt.value : "").trim();
                if (!label || !value) {
                    continue;
                }
                const chip = document.createElement("button");
                chip.type = "button";
                chip.setAttribute("data-dfchat-opt-key", value.toLowerCase());
                chip.textContent = resolveInlineOptionLabel(label, value, activeLanguage);
                chip.style.cssText = [
                    "appearance:none",
                    "-webkit-appearance:none",
                    "border:1px solid rgba(148,163,184,0.48)",
                    "border-radius:999px",
                    "background:#fff",
                    "color:#000",
                    "padding:7px 12px",
                    "font-size:13px",
                    "line-height:1.2",
                    "cursor:pointer",
                    "pointer-events:auto"
                ].join(";");
                chip.addEventListener("click", (e) => {
                    e.preventDefault?.();
                    e.stopPropagation?.();
                    if (!ms) {
                        return;
                    }
                    try {
                        removeDfchatLastInlineGalleryIfPresent();
                        removeDfchatLastInlineVideoIfPresent();
                    } catch {
                        /* ignore */
                    }
                    sendUserTextViaDfMessenger(ms, value, true);
                });
                chips.appendChild(chip);
            }
            if (chips.childElementCount > 0) {
                wrap.appendChild(chips);
            }
        }

        const beforeNode = resolveGalleryInsertBeforeByCxOrder(ml);
        if (beforeNode && beforeNode.parentNode === ml && typeof ml.insertBefore === "function") {
            ml.insertBefore(wrap, beforeNode);
        } else {
            ml.appendChild(wrap);
        }
        dfchatLastInlineGalleryWrapEl = wrap;

        injected = true;
        try {
            ml.scrollTop = ml.scrollHeight;
        } catch {
            /* ignore */
        }
        const host = msResolved;
        try {
            if (host && typeof requestAnimationFrame === "function") {
                requestAnimationFrame(() => bindLightboxToMessengerImages(host));
            }
        } catch {
            /* ignore */
        }
        if (Array.isArray(pendingTimers)) {
            for (let ti = 0; ti < pendingTimers.length; ti += 1) {
                clearTimeout(pendingTimers[ti]);
            }
            pendingTimers = undefined;
        }
    }

    const delaysMs = [72, 180, 400, 800, 1600];

    delaysMs.forEach((delayMs) => {
        const tid = window.setTimeout(() => {
            tryAppend();
        }, delayMs);
        if (!pendingTimers) {
            pendingTimers = [];
        }
        pendingTimers.push(tid);
    });

    window.setTimeout(() => {
        if (!injected) {
            try {
                openImageLightbox(list, 0, "");
            } catch {
                /* ignore */
            }
        }
    }, 1750);
}

/**
 * Update an existing inline gallery wrap:
 * - rebuild thumbnails from `urls`
 * - rebuild message + option buttons
 * (Used when dedupe blocks reinjection, but we still want the newest gallery content.)
 *
 * @param {HTMLElement} wrapEl
 * @param {string[]} urls Normalized HTTPS URLs
 * @param {Array<{label: string, value: string}> | null | undefined} options
 * @param {string | null | undefined} messageText
 * @returns {void}
 */
function updateInlineGalleryWrapUnderTrack(wrapEl, urls, options, messageText) {
    try {
        const track = wrapEl.querySelector(`.${DFCHAT_INLINE_GALLERY_CLASS}__track`);
        if (!track) {
            return;
        }

        // Remove everything except the track, then rebuild track cells.
        const children = Array.from(wrapEl.children);
        for (let i = 0; i < children.length; i += 1) {
            const ch = children[i];
            if (ch && ch !== track) {
                try {
                    ch.remove();
                } catch {
                    /* ignore */
                }
            }
        }
        try {
            track.innerHTML = "";
        } catch {
            /* ignore */
        }

        for (let i = 0; i < urls.length; i += 1) {
            const cell = document.createElement("div");
            cell.style.cssText = [
                "flex:0 0 auto",
                "scroll-snap-align:start",
                "width:min(76vw,200px)",
                "max-width: min(76vw,200px)",
                "box-sizing:border-box"
            ].join(";");

            const img = document.createElement("img");
            img.src = urls[i];
            img.alt = "";
            img.setAttribute("draggable", "false");
            img.loading = i < 3 ? "eager" : "lazy";
            img.decoding = "async";
            img.style.cssText = [
                "display:block",
                "width:100%",
                "height:126px",
                "object-fit:cover",
                "border-radius:10px",
                "cursor:zoom-in",
                "background:rgba(148,163,184,0.18)",
                "border:1px solid rgba(148,163,184,0.35)",
                "box-sizing:border-box"
            ].join(";");

            cell.appendChild(img);
            track.appendChild(cell);
        }

        const opts = Array.isArray(options) ? options : [];
        const msg = typeof messageText === "string" ? messageText.trim() : "";

        if (msg) {
            const messageEl = document.createElement("div");
            messageEl.textContent = msg;
            messageEl.style.cssText = [
                "width:100%",
                "box-sizing:border-box",
                "color:#000",
                "font-size:13px",
                "line-height:1.35",
                "margin:6px 0 -2px",
                "padding:0 2px"
            ].join(";");
            wrapEl.appendChild(messageEl);
        }

        if (opts.length > 0) {
            const chips = document.createElement("div");
            chips.style.cssText = [
                "display:flex",
                "flex-wrap:wrap",
                "gap:8px",
                "margin-top:10px",
                "padding:0 2px",
                "box-sizing:border-box",
                "width:100%"
            ].join(";");

            const ms = activeDfMessenger;
            for (let oi = 0; oi < opts.length; oi += 1) {
                const opt = opts[oi];
                const label = String(opt && opt.label ? opt.label : "").trim();
                const value = String(opt && opt.value ? opt.value : "").trim();
                if (!label || !value) {
                    continue;
                }
                const chip = document.createElement("button");
                chip.type = "button";
                chip.setAttribute("data-dfchat-opt-key", value.toLowerCase());
                chip.textContent = resolveInlineOptionLabel(label, value, activeLanguage);
                chip.style.cssText = [
                    "appearance:none",
                    "-webkit-appearance:none",
                    "border:1px solid rgba(148,163,184,0.48)",
                    "border-radius:999px",
                    "background:#fff",
                    "color:#000",
                    "padding:7px 12px",
                    "font-size:13px",
                    "line-height:1.2",
                    "cursor:pointer",
                    "pointer-events:auto"
                ].join(";");
                chip.addEventListener("click", (e) => {
                    e.preventDefault?.();
                    e.stopPropagation?.();
                    if (!ms) {
                        return;
                    }
                    try {
                        removeDfchatLastInlineGalleryIfPresent();
                        removeDfchatLastInlineVideoIfPresent();
                    } catch {
                        /* ignore */
                    }
                    sendUserTextViaDfMessenger(ms, value, true);
                });
                chips.appendChild(chip);
            }

            if (chips.childElementCount > 0) {
                wrapEl.appendChild(chips);
            }
        }
    } catch {
        /* ignore */
    }
}

/**
 * When dedupe blocks reinjection, we still want the existing gallery to be moved
 * near the latest bot rows and updated with new message/options.
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {Array<{label: string, value: string}> | null | undefined} options
 * @param {string | null | undefined} messageText
 * @returns {void}
 */
function scheduleEnsureExistingInlineGalleryPosition(dfMessenger, urls, options, messageText) {
    let moved = false;
    let msResolved =
        dfMessenger
        || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
        || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);

    function listRoot() {
        return findMessengerMessageListRoot(msResolved);
    }

    const delaysMs = [72, 180, 400, 800, 1600];
    delaysMs.forEach((delayMs) => {
        window.setTimeout(() => {
            if (moved) {
                return;
            }
            if (!dfchatLastInlineGalleryWrapEl || !dfchatLastInlineGalleryWrapEl.isConnected) {
                return;
            }
            const ml = listRoot();
            if (!ml) {
                return;
            }

            updateInlineGalleryWrapUnderTrack(dfchatLastInlineGalleryWrapEl, urls, options, messageText);

            const beforeNode = resolveGalleryInsertBeforeByCxOrder(ml);
            if (beforeNode && beforeNode.parentNode === ml && typeof ml.insertBefore === "function") {
                ml.insertBefore(dfchatLastInlineGalleryWrapEl, beforeNode);
            } else if (typeof ml.appendChild === "function") {
                ml.appendChild(dfchatLastInlineGalleryWrapEl);
            }
            moved = true;
        }, delayMs);
    });
}

/**
 * Turn a YouTube watch / shorts / embed URL into an `https://www.youtube.com/embed/…` URL for iframes.
 * @param {string} raw
 * @returns {string} Empty if not a supported YouTube link.
 */
function normalizeYoutubeVideoEmbedUrl(raw) {
    if (!raw || typeof raw !== "string") {
        return "";
    }
    const s = raw.trim();
    if (!s) {
        return "";
    }
    try {
        const u = new URL(s, "https://www.youtube.com");
        const host = u.hostname.replace(/^www\./i, "").toLowerCase();

        if (host === "youtu.be") {
            const id = u.pathname.replace(/^\//, "").split(/[/?#]/)[0];
            if (id && /^[\w-]{11}$/.test(id)) {
                return `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1`;
            }
            return "";
        }

        if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
            const embedM = u.pathname.match(/\/embed\/([\w-]{11})/);
            if (embedM && embedM[1]) {
                return `https://www.youtube.com/embed/${encodeURIComponent(embedM[1])}?rel=0&modestbranding=1`;
            }
            const shortsM = u.pathname.match(/\/shorts\/([\w-]{11})/);
            if (shortsM && shortsM[1]) {
                return `https://www.youtube.com/embed/${encodeURIComponent(shortsM[1])}?rel=0&modestbranding=1`;
            }
            const v = u.searchParams.get("v");
            if (v && /^[\w-]{11}$/.test(v)) {
                return `https://www.youtube.com/embed/${encodeURIComponent(v)}?rel=0&modestbranding=1`;
            }
        }
    } catch {
        /* ignore */
    }
    return "";
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function unwrapPayloadStringField(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "object" && v != null && typeof /** @type {{ stringValue?: string }} */ (v).stringValue === "string") {
        return String(/** @type {{ stringValue?: string }} */ (v).stringValue).trim();
    }
    return String(v).trim();
}

/**
 * @param {unknown} rawOptions
 * @returns {Array<{label: string, value: string}>}
 */
function normalizeOpenVideoOptions(rawOptions) {
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
        return [];
    }
    /** @type {Array<{label: string, value: string}>} */
    const out = [];
    for (let i = 0; i < rawOptions.length; i += 1) {
        const item = rawOptions[i];
        if (typeof item === "string") {
            const t = item.trim();
            if (t) {
                out.push({ label: t, value: t });
            }
            continue;
        }
        if (!item || typeof item !== "object") {
            continue;
        }
        /** @type {Record<string, unknown>} */
        const o = /** @type {Record<string, unknown>} */ (item);
        const label = unwrapPayloadStringField(
            Object.prototype.hasOwnProperty.call(o, "label") ? o.label
                : Object.prototype.hasOwnProperty.call(o, "title") ? o.title
                    : Object.prototype.hasOwnProperty.call(o, "text") ? o.text
                        : ""
        );
        const value = unwrapPayloadStringField(
            Object.prototype.hasOwnProperty.call(o, "value") ? o.value
                : Object.prototype.hasOwnProperty.call(o, "payload") ? o.payload
                    : Object.prototype.hasOwnProperty.call(o, "query") ? o.query
                        : label
        );
        if (!label && !value) {
            continue;
        }
        out.push({
            label: label || value,
            value: value || label
        });
    }
    return out;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeOpenVideoMessage(raw) {
    if (raw == null) {
        return "";
    }
    // Accept plain string or common protobuf-ish { stringValue }.
    const t = unwrapPayloadStringField(raw);
    return typeof t === "string" ? t.trim() : "";
}

/**
 * Inline YouTube embed in the chat transcript (`open_video`).
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {string} embedHttpsUrl
 * @param {Array<{label: string, value: string}>} [options]
 * @param {string} [messageText]
 */
function scheduleInjectInlineVideoPlayer(dfMessenger, embedHttpsUrl, options, messageText) {
    const src = typeof embedHttpsUrl === "string" ? embedHttpsUrl.trim() : "";
    if (!src || !/^https:\/\/www\.youtube\.com\/embed\//i.test(src)) {
        return;
    }

    // Turn-local sequence token so delayed timers from previous turns don't inject stale video.
    const injectSeq = (dfchatInlineVideoInjectSeq += 1);

    let injected = false;
    /** @type {ReturnType<typeof setTimeout>[] | undefined} */
    let pendingTimers;
    /** @type {HTMLElement | null} */
    let msResolved =
        dfMessenger
        || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
        || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);

    /** @returns {HTMLElement | null} */
    function listRoot() {
        return findMessengerMessageListRoot(msResolved);
    }

    /** @returns {void} */
    function tryAppend() {
        if (injectSeq !== dfchatInlineVideoInjectSeq) {
            return;
        }
        if (injected) {
            return;
        }
        const ml = listRoot();
        if (!ml || typeof ml.appendChild !== "function") {
            return;
        }

        // Replace: remove any previously injected inline video so only the "current" one is visible.
        try {
            if (ml.children && typeof ml.children.length === "number") {
                const children = Array.from(ml.children);
                for (let i = 0; i < children.length; i += 1) {
                    const el = children[i];
                    if (el && el instanceof HTMLElement && el.classList && el.classList.contains(DFCHAT_INLINE_VIDEO_CLASS)) {
                        try {
                            el.remove();
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }
        } catch {
            /* ignore */
        }
        dfchatLastInlineVideoWrapEl = null;

        const wrap = document.createElement("div");
        wrap.className = DFCHAT_INLINE_VIDEO_CLASS;
        wrap.setAttribute("data-dfchat-no-translate", "true");
        wrap.dataset.dfcYtEmbed = src;
        wrap.style.cssText = [
            "box-sizing:border-box",
            "margin:8px 0 12px",
            "padding:0 2px",
            "width:100%",
            "max-width:100%"
        ].join(";");

        const actions = document.createElement("div");
        actions.style.cssText = [
            "display:flex",
            "width:100%",
            "justify-content:flex-end",
            "align-items:center",
            "gap:8px",
            "marginBottom:8px",
            "padding:0 2px",
            "box-sizing:border-box"
        ].join(";");

        const expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.setAttribute("aria-label", "Fullscreen");
        expandBtn.setAttribute("data-dfchat-video-expand-inline", "1");
        expandBtn.textContent = "⛶";
        expandBtn.title = "Open larger";
        expandBtn.style.cssText = [
            "appearance:none",
            "-webkit-appearance:none",
            "padding:6px 12px",
            "border-radius:999px",
            "border:1px solid rgba(148,163,184,0.45)",
            "background:rgba(15,23,42,0.45)",
            "color:rgba(248,250,252,0.95)",
            "font-size:14px",
            "line-height:1.15",
            "cursor:pointer",
            "pointer-events:auto"
        ].join(";");
        expandBtn.addEventListener("click", (e) => {
            e.preventDefault?.();
            e.stopPropagation?.();
            e.stopImmediatePropagation?.();
            try {
                wrap.dataset.dfcAwaitRestore = "1";
                iframe.removeAttribute("src");
                iframe.setAttribute("src", "about:blank");
                openVideoLightbox(src);
            } catch {
                /* ignore */
            }
        });

        actions.appendChild(expandBtn);
        wrap.appendChild(actions);

        const ratio = document.createElement("div");
        ratio.style.cssText = [
            "position:relative",
            "width:100%",
            "max-width:100%",
            "padding-bottom:56.25%",
            "height:0",
            "overflow:hidden",
            "border-radius:12px",
            "background:rgba(15,23,42,0.35)",
            "border:1px solid rgba(148,163,184,0.35)"
        ].join(";");

        const iframe = document.createElement("iframe");
        iframe.setAttribute("title", "YouTube video");
        iframe.setAttribute("allowfullscreen", "");
        iframe.setAttribute(
            "allow",
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        );
        iframe.setAttribute("loading", "lazy");
        iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        iframe.style.cssText = [
            "position:absolute",
            "inset:0",
            "width:100%",
            "height:100%",
            "border:0",
            "display:block"
        ].join(";");
        iframe.src = src;

        ratio.appendChild(iframe);
        wrap.appendChild(ratio);

        const opts = Array.isArray(options) ? options : [];
        const msg = typeof messageText === "string" ? messageText.trim() : "";
        if (opts.length > 0) {
            const chips = document.createElement("div");
            chips.style.cssText = [
                "display:flex",
                "flex-wrap:wrap",
                "gap:8px",
                "margin-top:10px",
                "padding:0 2px",
                "box-sizing:border-box",
                "width:100%"
            ].join(";");
            for (let oi = 0; oi < opts.length; oi += 1) {
                const opt = opts[oi];
                const label = String(opt && opt.label ? opt.label : "").trim();
                const value = String(opt && opt.value ? opt.value : "").trim();
                if (!label || !value) {
                    continue;
                }
                const chip = document.createElement("button");
                chip.type = "button";
                chip.setAttribute("data-dfchat-opt-key", value.toLowerCase());
                chip.textContent = resolveInlineOptionLabel(label, value, activeLanguage);
                chip.style.cssText = [
                    "appearance:none",
                    "-webkit-appearance:none",
                    "border:1px solid rgba(148,163,184,0.48)",
                    "border-radius:999px",
                    "background:#fff",
                    "color:#000",
                    "padding:7px 12px",
                    "font-size:13px",
                    "line-height:1.2",
                    "cursor:pointer",
                    "pointer-events:auto"
                ].join(";");
                chip.addEventListener("click", (e) => {
                    e.preventDefault?.();
                    e.stopPropagation?.();
                    const ms = msResolved || activeDfMessenger;
                    if (!ms) {
                        return;
                    }
                    try {
                        removeDfchatLastInlineGalleryIfPresent();
                        removeDfchatLastInlineVideoIfPresent();
                    } catch {
                        /* ignore */
                    }
                    sendUserTextViaDfMessenger(ms, value, true);
                });
                chips.appendChild(chip);
            }
            // If message text exists, render it above the option buttons.
            if (msg) {
                const messageEl = document.createElement("div");
                messageEl.textContent = msg;
                messageEl.style.cssText = [
                    "width:100%",
                    "box-sizing:border-box",
                    "color:#000",
                    "font-size:13px",
                    "line-height:1.35",
                    "margin:6px 0 -2px",
                    "padding:0 2px"
                ].join(";");
                wrap.appendChild(messageEl);
            }
            if (chips.childElementCount > 0) {
                wrap.appendChild(chips);
            }
        } else if (msg) {
            // If no options but message exists, still show the prompt under the video.
            const messageEl = document.createElement("div");
            messageEl.textContent = msg;
            messageEl.style.cssText = [
                "width:100%",
                "box-sizing:border-box",
                "color:#000",
                "font-size:13px",
                "line-height:1.35",
                "margin:6px 0 -2px",
                "padding:0 2px"
            ].join(";");
            wrap.appendChild(messageEl);
        }

        ml.appendChild(wrap);
        dfchatLastInlineVideoWrapEl = wrap;

        injected = true;
        try {
            ml.scrollTop = ml.scrollHeight;
        } catch {
            /* ignore */
        }
        if (Array.isArray(pendingTimers)) {
            for (let ti = 0; ti < pendingTimers.length; ti += 1) {
                clearTimeout(pendingTimers[ti]);
            }
            pendingTimers = undefined;
        }
    }

    const delaysMs = [72, 180, 400, 800, 1600];

    delaysMs.forEach((delayMs) => {
        const tid = window.setTimeout(() => {
            tryAppend();
        }, delayMs);
        if (!pendingTimers) {
            pendingTimers = [];
        }
        pendingTimers.push(tid);
    });
}

/**
 * First `open_video` custom payload from merged CX fulfillment messages (`extractPayload`).
 * Intent gate applied in callers.
 *
 * @param {unknown[]} messages
 * @returns {{ embed: string, options: Array<{label: string, value: string}>, messageText: string } | null}
 */
function extractFirstOpenYoutubeEmbedFromCxMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    for (let vx = 0; vx < messages.length; vx += 1) {
        const vm = messages[vx];
        if (!messageHasFulfillmentPayload(vm)) {
            continue;
        }
        /** @type {Record<string, unknown> | null} */
        let pl = null;
        try {
            pl = extractPayload(/** @type {unknown} */ (vm));
        } catch {
            pl = null;
        }
        let av =
            /** @type {Record<string, unknown> | null} */ (pl) && Object.prototype.hasOwnProperty.call(pl, "action")
                ? /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (pl).action)
                : null;
        if (typeof av === "object" && av != null && typeof /** @type {{ stringValue?: string }} */ (av).stringValue === "string") {
            av = /** @type {{ stringValue?: string }} */ (av).stringValue;
        }
        const actionStrVid = typeof av === "string" ? av.trim().toLowerCase() : "";
        if (!pl || actionStrVid !== "open_video") {
            continue;
        }
        const rawUrl =
            Object.prototype.hasOwnProperty.call(pl, "url")
                ? pl.url
                : Object.prototype.hasOwnProperty.call(pl, "video_url")
                    ? pl.video_url
                    : Object.prototype.hasOwnProperty.call(pl, "videoUrl")
                        ? pl.videoUrl
                        : null;
        const pageUrl = unwrapPayloadStringField(rawUrl);
        const embed = normalizeYoutubeVideoEmbedUrl(pageUrl);
        if (embed) {
            const rawOptions =
                Object.prototype.hasOwnProperty.call(pl, "options") ? pl.options
                    : Object.prototype.hasOwnProperty.call(pl, "option") ? pl.option
                        : Object.prototype.hasOwnProperty.call(pl, "chips") ? pl.chips
                            : null;
            const options = normalizeOpenVideoOptions(rawOptions);
            const rawMessage =
                Object.prototype.hasOwnProperty.call(pl, "message") ? pl.message
                    : Object.prototype.hasOwnProperty.call(pl, "text") ? pl.text
                        : Object.prototype.hasOwnProperty.call(pl, "prompt") ? pl.prompt
                            : Object.prototype.hasOwnProperty.call(pl, "subtitle") ? pl.subtitle
                                : Object.prototype.hasOwnProperty.call(pl, "description") ? pl.description
                                    : Object.prototype.hasOwnProperty.call(pl, "caption") ? pl.caption
                                        : null;
            const messageText = normalizeOpenVideoMessage(rawMessage);
            return { embed, options, messageText };
        }
    }
    return null;
}

/**
 * Remove the last inline iframe when this turn does not ship `open_video` (or gate blocks rich media).
 *
 * @param {unknown[]} messages
 * @param {Event | null | undefined} event
 * @returns {void}
 */
function pruneStaleInlineVideoForCxResponse(messages, event) {
    try {
        const videoPayload = extractFirstOpenYoutubeEmbedFromCxMessages(messages);
        const hasPayload = !!(videoPayload && videoPayload.embed);
        const gateOk = passesInlineRichMediaIntentGate(event);
        if (hasPayload && gateOk) {
            return;
        }
        removeDfchatLastInlineVideoIfPresent();
    } catch {
        /* ignore */
    }
}

/**
 * `{ "action": "open_video", "url": "https://www.youtube.com/watch?v=…" }` → inline iframe in chat (YouTube only).
 *
 * Same merge envelope as gallery: use `mergeCxResponseEnvelopeForGallery(event)`.
 *
 * @param {unknown[]} messages
 * @param {Event | null | undefined} [event]
 */
function tryOpenVideoFromBotResponseMessages(messages, event) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            return;
        }
        if (!passesInlineRichMediaIntentGate(event)) {
            return;
        }
        const videoPayload = extractFirstOpenYoutubeEmbedFromCxMessages(messages);
        if (!videoPayload || !videoPayload.embed) {
            return;
        }
        scheduleInjectInlineVideoPlayer(activeDfMessenger, videoPayload.embed, videoPayload.options, videoPayload.messageText);
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[company.js] Video payload skipped (never breaks bot replies)", e);
        }
    }
}

/**
 * Base64(JSON.stringify(url[])) — same encoding as wellness.html iframe ?p=
 */
function decodeDfGalleryBase64Param(pRaw) {
    if (!pRaw || typeof pRaw !== "string") {
        return [];
    }
    let s = String(pRaw).replace(/[\s\u200b\ufeff]/g, "").trim();
    try {
        s = decodeURIComponent(s);
    } catch {
        /* ignore */
    }
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) {
        b64 += "=";
    }
    try {
        const jsonStr = atob(b64);
        const j = JSON.parse(jsonStr);
        if (!Array.isArray(j)) {
            return [];
        }
        return j.map((x) => String(x).trim()).filter((u) => u.length > 0);
    } catch {
        return [];
    }
}

function extractGalleryUrlsFromHtmlString(html) {
    if (!html || typeof html !== "string") {
        return [];
    }
    const out = [];
    const seen = {};

    /** iframe src=?p=… or img=… (Messenger often blocks nested iframes; we still parse URLs) */
    const iframeMatch = /<iframe[^>]*\ssrc\s*=\s*["']([^"'>\s]+)["']/gi;
    let m;
    while ((m = iframeMatch.exec(html)) !== null) {
        try {
            const u = new URL(m[1], "https://local.invalid/");
            const pEnc = u.searchParams.get("p");
            if (pEnc) {
                for (const uu of decodeDfGalleryBase64Param(pEnc)) {
                    if (uu && !seen[uu]) {
                        seen[uu] = 1;
                        out.push(uu);
                    }
                }
            }
            for (const im of u.searchParams.getAll("img")) {
                const t = String(im).trim();
                if (t && !seen[t]) {
                    seen[t] = 1;
                    out.push(t);
                }
            }
        } catch {
            /* ignore */
        }
    }

    const imgRe = /<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = imgRe.exec(html)) !== null) {
        const u = String(m[1] || "").trim();
        if (u && !seen[u]) {
            seen[u] = 1;
            out.push(u);
        }
    }
    return out;
}

/**
 * Dedupe URLs for `open_gallery` payloads. Explicit `open_gallery` stays the gate (no HTML scraping).
 * @param {string[]} urls
 * @returns {string[]}
 */
function normalizeOpenGalleryUrlList(urls) {
    if (!Array.isArray(urls)) {
        return [];
    }
    const out = [];
    const seen = {};
    for (let i = 0; i < urls.length; i += 1) {
        const t = String(urls[i] || "").trim();
        if (!t || seen[t]) {
            continue;
        }
        if (!t.startsWith("http://") && !t.startsWith("https://")) {
            continue;
        }
        seen[t] = true;
        out.push(t);
    }
    return out;
}

/** @type {Set<string>} */
let dfchatOpenGalleryUrlSetSignaturesSeen = new Set();

/** @type {Set<string>} */
let dfchatOpenCardCarouselSignaturesSeen = new Set();

/** Most recent `.dfchat-inline-gallery` node we appended (for stale-DOM prune on non-gallery turns). */
/** @type {HTMLElement | null} */
let dfchatLastInlineGalleryWrapEl = null;

/** Most recent `.dfchat-inline-video` node we appended (for stale-DOM prune on non-video turns). */
/** @type {HTMLElement | null} */
let dfchatLastInlineVideoWrapEl = null;

/** Most recent `.dfchat-inline-card-carousel` node we appended (for stale-DOM prune on non-carousel turns). */
/** @type {HTMLElement | null} */
let dfchatLastInlineCardCarouselWrapEl = null;

/** Invalidate pending inline-video append attempts between turns. */
let dfchatInlineVideoInjectSeq = 0;

/** Invalidate pending inline-gallery append attempts between turns. */
let dfchatInlineGalleryInjectSeq = 0;

/** Invalidate pending inline-card-carousel append attempts between turns. */
let dfchatInlineCardCarouselInjectSeq = 0;

/** Most recent booking calendar strip (doctor slots). */
/** @type {HTMLElement | null} */
let dfchatLastInlineBookingCalWrapEl = null;

/** Invalidate pending booking-calendar append attempts between turns. */
let dfchatInlineBookingCalendarInjectSeq = 0;

/** Most recent `.dfchat-inline-select` node (city dropdown, etc.). */
/** @type {HTMLElement | null} */
let dfchatLastInlineSelectWrapEl = null;

/** Invalidate pending inline-select append attempts between turns. */
let dfchatInlineSelectInjectSeq = 0;

/** Dedupe repeated identical option lists in one session (CX may echo fulfillment). */
/** @type {Set<string>} */
let dfchatInlineSelectSignaturesSeen = new Set();

function clearOpenGalleryUrlDedupeState() {
    dfchatOpenGalleryUrlSetSignaturesSeen = new Set();
    dfchatLastInlineGalleryWrapEl = null;
    dfchatLastInlineVideoWrapEl = null;
    dfchatOpenCardCarouselSignaturesSeen = new Set();
    dfchatLastInlineCardCarouselWrapEl = null;
    dfchatInlineSelectInjectSeq += 1;
    dfchatLastInlineSelectWrapEl = null;
    dfchatInlineSelectSignaturesSeen = new Set();
    dfchatInlineBookingCalendarInjectSeq += 1;
    dfchatLastInlineBookingCalWrapEl = null;
}

/**
 * Detach the last inline gallery strip if still connected (e.g. user moved to a non-gallery intent).
 * @returns {void}
 */
function removeDfchatLastInlineGalleryIfPresent() {
    // Invalidate any older scheduled inject timers for this turn.
    dfchatInlineGalleryInjectSeq += 1;
    // Remove ALL connected galleries (shadow roots can remount; "last" pointer can go stale).
    removeAllDfchatInlineGalleries(activeDfMessenger);
    // Same URL set can show again after a non-gallery turn removed the strip; otherwise dedupe blocks forever.
    try {
        dfchatOpenGalleryUrlSetSignaturesSeen.clear();
    } catch {
        /* ignore */
    }
}

/**
 * Detach the last inline card carousel when the bot reply is plain text / another intent.
 * @returns {void}
 */
function removeDfchatLastInlineCardCarouselIfPresent() {
    const el = dfchatLastInlineCardCarouselWrapEl;
    dfchatLastInlineCardCarouselWrapEl = null;
    // Invalidate any older scheduled inject timers for this turn.
    dfchatInlineCardCarouselInjectSeq += 1;
    if (!el) {
        return;
    }
    try {
        if (typeof el.remove === "function") {
            el.remove();
        } else if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    } catch {
        /* ignore */
    }
    try {
        dfchatOpenCardCarouselSignaturesSeen.clear();
    } catch {
        /* ignore */
    }
}

/**
 * Detach the last injected inline select control when the bot reply is plain text / another intent.
 * @returns {void}
 */
function removeDfchatLastInlineSelectIfPresent() {
    const el = dfchatLastInlineSelectWrapEl;
    dfchatLastInlineSelectWrapEl = null;
    dfchatInlineSelectInjectSeq += 1;
    if (!el) {
        try {
            dfchatInlineSelectSignaturesSeen.clear();
        } catch {
            /* ignore */
        }
        return;
    }
    try {
        if (typeof el.remove === "function") {
            el.remove();
        } else if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    } catch {
        /* ignore */
    }
    try {
        dfchatInlineSelectSignaturesSeen.clear();
    } catch {
        /* ignore */
    }
}

/**
 * Detach the last inline YouTube block when the bot reply is plain text / another intent.
 * @returns {void}
 */
function removeDfchatLastInlineVideoIfPresent() {
    const el = dfchatLastInlineVideoWrapEl;
    dfchatLastInlineVideoWrapEl = null;
    // Invalidate any older scheduled inject timers for this turn.
    dfchatInlineVideoInjectSeq += 1;
    if (!el) {
        return;
    }
    try {
        if (typeof el.remove === "function") {
            el.remove();
        } else if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    } catch {
        /* ignore */
    }
}

/**
 * Stable key for `{ open_gallery, urls: [...] }` so stale repeated payloads skip a second carousel.
 * @param {string[]} normalizedHttpsUrls Output of `normalizeOpenGalleryUrlList`.
 * @returns {string}
 */
function openGalleryUrlSetSignature(normalizedHttpsUrls) {
    if (!normalizedHttpsUrls || normalizedHttpsUrls.length === 0) {
        return "";
    }
    return normalizedHttpsUrls
        .slice()
        .map((u) => String(u || "").trim())
        .sort()
        .join("\u0001");
}

/**
 * Honors `COMMON.features.inlineGallery.suppressRepeatedOpenGalleryUrls` (default true): same URL set twice
 * in one session skips the duplicate (common when fulfillment echoes `open_gallery` after the first gallery intent).
 *
 * @param {string[]} normalizedHttpsUrls
 * @returns {boolean}
 */
function shouldScheduleInlineGalleryCarouselForNormalizedUrls(normalizedHttpsUrls) {
    const cfg = readCompanyUiConfig();
    const common =
        cfg && typeof cfg === "object" && /** @type {Record<string, unknown>} */ (cfg).common && typeof /** @type {Record<string, unknown>} */ (cfg).common === "object"
            ? /** @type {Record<string, unknown>} */ (cfg).common
            : null;
    const feats =
        common && typeof common.features === "object"
            ? /** @type {Record<string, unknown>} */ (common.features)
            : null;
    const ig =
        feats && typeof feats.inlineGallery === "object"
            ? /** @type {Record<string, unknown>} */ (feats.inlineGallery)
            : /** @type {Record<string, unknown> | null} */ (null);
    const suppress =
        !ig
        || typeof ig.suppressRepeatedOpenGalleryUrls === "undefined"
        || ig.suppressRepeatedOpenGalleryUrls !== false;
    if (!suppress) {
        return true;
    }
    const sig = openGalleryUrlSetSignature(normalizedHttpsUrls);
    if (!sig) {
        return false;
    }
    // If dedupe state survived but no inline gallery is currently mounted, reopen for this turn.
    try {
        const hasMountedInlineGallery =
            !!(dfchatLastInlineGalleryWrapEl
                && dfchatLastInlineGalleryWrapEl.isConnected);
        if (!hasMountedInlineGallery && dfchatOpenGalleryUrlSetSignaturesSeen.size > 0) {
            dfchatOpenGalleryUrlSetSignaturesSeen.clear();
        }
    } catch {
        /* ignore */
    }
    if (dfchatOpenGalleryUrlSetSignaturesSeen.has(sig)) {
        return false;
    }
    dfchatOpenGalleryUrlSetSignaturesSeen.add(sig);
    return true;
}

/**
 * First `open_gallery` custom payload from merged CX fulfillment messages (`extractPayload`).
 * Dedupe/intent gates are applied elsewhere.
 *
 * @param {unknown[]} messages
 * @returns {{ urls: string[], options: Array<{label: string, value: string}>, messageText: string } | null}
 */
function extractFirstOpenGalleryNormalizedUrlsFromCxMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    /** Fast path — same protobuf → JSON flattening as Contact form / language (extractPayload). */
    for (let gx = 0; gx < messages.length; gx += 1) {
        const cand = messages[gx];
        if (!messageHasFulfillmentPayload(cand)) {
            continue;
        }
        /** @type {Record<string, unknown> | null} */
        let pl = null;
        try {
            pl = extractPayload(/** @type {unknown} */ (cand));
        } catch {
            pl = null;
        }
        const act =
            pl && typeof /** @type {{ action?: unknown }} */ (pl).action !== "undefined"
                ? /** @type {{ action?: unknown }} */ (pl).action
                : null;
        const actionStr =
            typeof act === "string"
                ? act.trim().toLowerCase()
                : act != null && typeof act === "object" && typeof /** @type {{ stringValue?: string }} */ (act).stringValue === "string"
                    ? /** @type {{ stringValue?: string }} */ (act).stringValue.trim().toLowerCase()
                    : "";
        if (!pl || actionStr !== "open_gallery") {
            continue;
        }
        /** @type {unknown} */
        const rawUrls = Object.prototype.hasOwnProperty.call(pl, "urls") ? pl.urls : null;
        /** @type {string[]} */
        const list = [];
        if (Array.isArray(rawUrls)) {
            for (let uidx = 0; uidx < rawUrls.length; uidx += 1) {
                const rawU = rawUrls[uidx];
                const s =
                    rawU != null && typeof rawU === "object" && typeof rawU.stringValue === "string"
                        ? rawU.stringValue
                        : typeof rawU === "string"
                            ? rawU
                            : "";
                const t = String(s).trim();
                if (t.startsWith("http://") || t.startsWith("https://")) {
                    list.push(t);
                }
            }
        }
        const allowed = normalizeOpenGalleryUrlList(list);
        if (allowed.length > 0) {
            const rawOptions =
                Object.prototype.hasOwnProperty.call(pl, "options") ? pl.options
                    : Object.prototype.hasOwnProperty.call(pl, "option") ? pl.option
                        : Object.prototype.hasOwnProperty.call(pl, "chips") ? pl.chips
                            : null;
            const options = normalizeOpenVideoOptions(rawOptions);

            const rawMessage =
                Object.prototype.hasOwnProperty.call(pl, "message") ? pl.message
                    : Object.prototype.hasOwnProperty.call(pl, "text") ? pl.text
                        : Object.prototype.hasOwnProperty.call(pl, "prompt") ? pl.prompt
                            : Object.prototype.hasOwnProperty.call(pl, "subtitle") ? pl.subtitle
                                : Object.prototype.hasOwnProperty.call(pl, "description") ? pl.description
                                    : Object.prototype.hasOwnProperty.call(pl, "caption") ? pl.caption
                                        : null;
            const messageText = normalizeOpenVideoMessage(rawMessage);

            return { urls: allowed, options, messageText };
        }
    }
    return null;
}

/**
 * Drop the previous inline strip when this turn has no allowed `open_gallery` (or intent gate blocks it),
 * so plain-text turns do not keep the last carousel visible.
 *
 * @param {unknown[]} messages Merged CX `responseMessages` (see `mergeCxResponseEnvelopeForGallery`).
 * @param {Event | null | undefined} event
 * @returns {void}
 */
function pruneStaleInlineGalleryForCxResponse(messages, event) {
    try {
        const payload = extractFirstOpenGalleryNormalizedUrlsFromCxMessages(messages);
        const hasPayload = !!(payload && payload.urls && payload.urls.length > 0);
        const gateOk = passesInlineRichMediaIntentGate(event);
        if (hasPayload && gateOk) {
            return;
        }
        removeDfchatLastInlineGalleryIfPresent();
    } catch {
        /* ignore */
    }
}

/**
 * Walk webhook / CX payloads for gallery data (no iframe embedding required inside Messenger).
 *
 * Only `{ "action": "open_gallery", "urls": ["https://…", …] }` — no richContent / HTML `<img>` fallback.
 *
 * @param {unknown[]} messages
 * @param {Event | null | undefined} [event]
 */
function tryOpenGalleryFromBotResponseMessages(messages, event) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            return;
        }
        if (!passesInlineRichMediaIntentGate(event)) {
            return;
        }
        const payload = extractFirstOpenGalleryNormalizedUrlsFromCxMessages(messages);
        if (!payload || !payload.urls || payload.urls.length === 0) {
            return;
        }
        const shouldInject = shouldScheduleInlineGalleryCarouselForNormalizedUrls(payload.urls);
        if (!shouldInject) {
            // Dedupe blocked reinjection: still move/update existing gallery so it appears in the right place.
            scheduleEnsureExistingInlineGalleryPosition(
                activeDfMessenger,
                payload.urls,
                payload.options,
                payload.messageText
            );
            return;
        }

        scheduleInjectInlineGalleryCarousel(
            activeDfMessenger,
            payload.urls,
            messages,
            payload.options,
            payload.messageText
        );
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[company.js] Gallery payload skipped (never breaks bot replies)", e);
        }
    }
}

/**
 * @typedef {{ id: string, title: string, subtitle: string, imageUrl: string, ctaLabel: string, ctaValue: string }} InlineCardCarouselCard
 */

/**
 * @param {unknown} rawCards
 * @returns {InlineCardCarouselCard[]}
 */
function normalizeOpenCardCarouselCards(rawCards) {
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
        return [];
    }
    /** @type {InlineCardCarouselCard[]} */
    const out = [];
    for (let i = 0; i < rawCards.length; i += 1) {
        const row = rawCards[i];
        if (!row || typeof row !== "object") {
            continue;
        }
        /** @type {Record<string, unknown>} */
        const r = /** @type {Record<string, unknown>} */ (row);
        const id = unwrapPayloadStringField(r.id || r.key || r.card_id || r.cardId || `${i + 1}`);
        const title = unwrapPayloadStringField(r.title || r.name || r.heading || "");
        const subtitle = unwrapPayloadStringField(r.subtitle || r.description || r.text || "");
        const imageUrl = unwrapPayloadStringField(r.imageUrl || r.image_url || r.image || r.img || "");
        const ctaLabel = unwrapPayloadStringField(r.ctaLabel || r.cta_label || r.button || r.buttonLabel || "Select");
        const ctaValue = unwrapPayloadStringField(r.ctaValue || r.cta_value || r.value || r.query || title);
        if (!title && !subtitle && !imageUrl) {
            continue;
        }
        out.push({
            id: id || `${i + 1}`,
            title,
            subtitle,
            imageUrl,
            ctaLabel,
            ctaValue
        });
    }
    return out;
}

/**
 * @param {InlineCardCarouselCard[]} cards
 * @returns {string}
 */
function openCardCarouselSignature(cards) {
    if (!cards || cards.length === 0) {
        return "";
    }
    return cards
        .slice(0, 8)
        .map((c) => `${String(c.id || "").trim()}\u0002${String(c.title || "").trim()}`)
        .join("\u0001");
}

/**
 * Extract the first `{ action: "open_card_carousel", cards: [...] }` payload from merged CX fulfillment messages.
 *
 * @param {unknown[]} messages
 * @returns {{ cards: InlineCardCarouselCard[], messageText: string } | null}
 */
function extractFirstOpenCardCarouselFromCxMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    for (let cx = 0; cx < messages.length; cx += 1) {
        const cand = messages[cx];
        if (!messageHasFulfillmentPayload(cand)) {
            continue;
        }
        /** @type {Record<string, unknown> | null} */
        let pl = null;
        try {
            pl = extractPayload(/** @type {unknown} */ (cand));
        } catch {
            pl = null;
        }
        const actionStr = unwrapPayloadStringField(pl && Object.prototype.hasOwnProperty.call(pl, "action") ? pl.action : "").toLowerCase();
        if (!pl || actionStr !== "open_card_carousel") {
            continue;
        }
        const rawCards = Object.prototype.hasOwnProperty.call(pl, "cards")
            ? pl.cards
            : Object.prototype.hasOwnProperty.call(pl, "items")
                ? pl.items
                : Object.prototype.hasOwnProperty.call(pl, "list")
                    ? pl.list
                    : null;
        const cards = normalizeOpenCardCarouselCards(rawCards);
        if (cards.length === 0) {
            continue;
        }
        const rawMessage =
            Object.prototype.hasOwnProperty.call(pl, "message") ? pl.message
                : Object.prototype.hasOwnProperty.call(pl, "text") ? pl.text
                    : Object.prototype.hasOwnProperty.call(pl, "prompt") ? pl.prompt
                        : Object.prototype.hasOwnProperty.call(pl, "subtitle") ? pl.subtitle
                            : Object.prototype.hasOwnProperty.call(pl, "description") ? pl.description
                                : null;
        const messageText = normalizeOpenVideoMessage(rawMessage);
        return { cards, messageText };
    }
    return null;
}

/**
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {InlineCardCarouselCard[]} cards
 * @param {string | null | undefined} messageText
 * @returns {void}
 */
function scheduleInjectInlineCardCarousel(dfMessenger, cards, messageText) {
    const injectSeq = (dfchatInlineCardCarouselInjectSeq += 1);
    let injected = false;
    /** @type {number[] | undefined} */
    let pendingTimers = undefined;

    const list = Array.isArray(cards) ? cards.slice(0, 12) : [];
    const msg = typeof messageText === "string" ? messageText.trim() : "";

    function tryAppend() {
        if (injected) {
            return;
        }
        if (injectSeq !== dfchatInlineCardCarouselInjectSeq) {
            return;
        }
        const msResolved =
            dfMessenger
            || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
            || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);
        const ml = findMessengerMessageListRoot(msResolved);
        if (!ml) {
            return;
        }

        try {
            removeDfchatLastInlineCardCarouselIfPresent();
        } catch {
            /* ignore */
        }

        const wrap = document.createElement("div");
        wrap.className = DFCHAT_INLINE_CARD_CAROUSEL_CLASS;
        wrap.style.cssText = [
            "width:100%",
            "box-sizing:border-box",
            "margin:10px 0 0",
            "padding:0 10px 10px",
            "pointer-events:auto"
        ].join(";");

        if (msg) {
            const messageEl = document.createElement("div");
            messageEl.textContent = msg;
            messageEl.style.cssText = [
                "width:100%",
                "box-sizing:border-box",
                "color:#000",
                "font-size:13px",
                "line-height:1.35",
                "margin:0 0 8px",
                "padding:0 2px"
            ].join(";");
            wrap.appendChild(messageEl);
        }

        const track = document.createElement("div");
        track.className = `${DFCHAT_INLINE_CARD_CAROUSEL_CLASS}__track`;
        track.style.cssText = [
            "display:flex",
            "gap:10px",
            "overflow-x:auto",
            "overflow-y:hidden",
            "scroll-snap-type:x mandatory",
            "padding:2px 2px 6px",
            "box-sizing:border-box",
            "width:100%",
            "-webkit-overflow-scrolling:touch"
        ].join(";");

        const ms = msResolved || activeDfMessenger;

        for (let i = 0; i < list.length; i += 1) {
            const c = list[i];

            const cell = document.createElement("div");
            cell.style.cssText = [
                "flex:0 0 auto",
                "scroll-snap-align:start",
                "width:min(80vw,260px)",
                "max-width:min(80vw,260px)",
                "box-sizing:border-box"
            ].join(";");

            const card = document.createElement("button");
            card.type = "button";
            card.setAttribute("data-dfchat-card-id", String(c.id || ""));
            card.style.cssText = [
                "appearance:none",
                "-webkit-appearance:none",
                "border:1px solid rgba(148,163,184,0.35)",
                "border-radius:14px",
                "background:#ffffff",
                "padding:0",
                "margin:0",
                "width:100%",
                "text-align:left",
                "cursor:pointer",
                "pointer-events:auto",
                "box-shadow:0 10px 26px rgba(15,23,42,0.08)",
                "overflow:hidden"
            ].join(";");

            if (c.imageUrl) {
                const img = document.createElement("img");
                img.src = c.imageUrl;
                img.alt = "";
                img.loading = i < 3 ? "eager" : "lazy";
                img.decoding = "async";
                img.setAttribute("draggable", "false");
                img.style.cssText = [
                    "display:block",
                    "width:100%",
                    "height:120px",
                    "object-fit:cover",
                    "background:rgba(148,163,184,0.18)"
                ].join(";");
                card.appendChild(img);
            }

            const body = document.createElement("div");
            body.style.cssText = [
                "padding:10px 12px 12px",
                "box-sizing:border-box"
            ].join(";");

            if (c.title) {
                const t = document.createElement("div");
                t.textContent = c.title;
                t.style.cssText = [
                    "font:700 13px/1.25 Manrope, Segoe UI, system-ui, sans-serif",
                    "color:#0f172a",
                    "margin:0 0 4px"
                ].join(";");
                body.appendChild(t);
            }
            if (c.subtitle) {
                const s = document.createElement("div");
                s.textContent = c.subtitle;
                s.style.cssText = [
                    "font:600 12px/1.25 Manrope, Segoe UI, system-ui, sans-serif",
                    "color:rgba(15,23,42,0.68)",
                    "margin:0 0 10px"
                ].join(";");
                body.appendChild(s);
            }

            const cta = document.createElement("div");
            cta.textContent = c.ctaLabel || "Select";
            cta.style.cssText = [
                "display:inline-flex",
                "align-items:center",
                "justify-content:center",
                "padding:8px 10px",
                "border-radius:10px",
                "background:linear-gradient(135deg,#0369a1,#0284c7)",
                "color:#f0f9ff",
                "font:800 12px/1 Manrope, Segoe UI, system-ui, sans-serif",
                "width:100%",
                "box-sizing:border-box"
            ].join(";");
            body.appendChild(cta);

            card.appendChild(body);

            card.addEventListener("click", (e) => {
                e.preventDefault?.();
                e.stopPropagation?.();

                const clickPayload = {
                    action: "card_carousel_click",
                    clicked: c,
                    cards: list.map((x) => ({
                        id: x.id,
                        title: x.title,
                        subtitle: x.subtitle,
                        imageUrl: x.imageUrl,
                        ctaLabel: x.ctaLabel,
                        ctaValue: x.ctaValue
                    }))
                };

                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: "dfchat_card_carousel_click", payload: clickPayload }, "*");
                    }
                } catch {
                    /* ignore */
                }
                try {
                    window.dispatchEvent(new CustomEvent("dfchat-card-carousel-click", { detail: clickPayload }));
                } catch {
                    /* ignore */
                }

                try {
                    const idRaw = String(c.id || "").replace(/^doctor_/i, "").trim();
                    if (idRaw && /^\d+$/.test(idRaw)) {
                        window.__dfchatBookingDoctorId = idRaw;
                    } else if (c.ctaValue && /^\d+$/.test(String(c.ctaValue).trim())) {
                        window.__dfchatBookingDoctorId = String(c.ctaValue).trim();
                    }
                } catch {
                    /* ignore */
                }

                if (ms && c.ctaValue) {
                    try {
                        removeDfchatLastInlineGalleryIfPresent();
                        removeDfchatLastInlineVideoIfPresent();
                    } catch {
                        /* ignore */
                    }
                    sendUserTextViaDfMessenger(ms, c.ctaValue, true);
                }
            });

            cell.appendChild(card);
            track.appendChild(cell);
        }

        wrap.appendChild(track);

        const beforeNode = resolveGalleryInsertBeforeByCxOrder(ml);
        if (beforeNode && beforeNode.parentNode === ml && typeof ml.insertBefore === "function") {
            ml.insertBefore(wrap, beforeNode);
        } else {
            ml.appendChild(wrap);
        }
        dfchatLastInlineCardCarouselWrapEl = wrap;

        injected = true;
        try {
            ml.scrollTop = ml.scrollHeight;
        } catch {
            /* ignore */
        }

        if (Array.isArray(pendingTimers)) {
            for (let ti = 0; ti < pendingTimers.length; ti += 1) {
                clearTimeout(pendingTimers[ti]);
            }
            pendingTimers = undefined;
        }
    }

    const delaysMs = [72, 180, 400, 800, 1600];
    delaysMs.forEach((delayMs) => {
        const tid = window.setTimeout(() => {
            tryAppend();
        }, delayMs);
        if (!pendingTimers) {
            pendingTimers = [];
        }
        pendingTimers.push(tid);
    });
}

/**
 * Drop the previous inline card carousel when this turn has no allowed `open_card_carousel`,
 * so plain-text turns do not keep the last carousel visible.
 *
 * @param {unknown[]} messages Merged CX `responseMessages` (see `mergeCxResponseEnvelopeForGallery`).
 * @param {Event | null | undefined} event
 * @returns {void}
 */
function pruneStaleInlineCardCarouselForCxResponse(messages, event) {
    try {
        const payload = extractFirstOpenCardCarouselFromCxMessages(messages);
        const hasPayload = !!(payload && payload.cards && payload.cards.length > 0);
        const gateOk = passesInlineRichMediaIntentGate(event);
        if (hasPayload && gateOk) {
            return;
        }
        removeDfchatLastInlineCardCarouselIfPresent();
    } catch {
        /* ignore */
    }
}

/**
 * Walk webhook / CX payloads for card-carousel data.
 *
 * Only `{ "action": "open_card_carousel", "cards": [ ... ] }`.
 *
 * @param {unknown[]} messages
 * @param {Event | null | undefined} [event]
 */
function tryOpenCardCarouselFromBotResponseMessages(messages, event) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            return;
        }
        if (!passesInlineRichMediaIntentGate(event)) {
            return;
        }
        const payload = extractFirstOpenCardCarouselFromCxMessages(messages);
        if (!payload || !payload.cards || payload.cards.length === 0) {
            return;
        }
        const sig = openCardCarouselSignature(payload.cards);
        if (sig && dfchatOpenCardCarouselSignaturesSeen.has(sig)) {
            return;
        }
        if (sig) {
            dfchatOpenCardCarouselSignaturesSeen.add(sig);
        }
        scheduleInjectInlineCardCarousel(activeDfMessenger, payload.cards, payload.messageText);
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[company.js] Card carousel payload skipped (never breaks bot replies)", e);
        }
    }
}

/**
 * @param {unknown} raw
 * @returns {{ label: string, value: string }[]}
 */
function normalizeDfchatInlineSelectOptions(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    /** @type {{ label: string, value: string }[]} */
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (typeof item === "string") {
            const t = item.trim();
            if (t) {
                out.push({ label: t, value: t });
            }
            continue;
        }
        if (item && typeof item === "object") {
            /** @type {Record<string, unknown>} */
            const o = /** @type {Record<string, unknown>} */ (item);
            const label = unwrapPayloadStringField(o.label ?? o.text ?? "").trim();
            let value = unwrapPayloadStringField(o.value ?? o.label ?? "").trim();
            if (!value && label) {
                value = label;
            }
            if (label && value) {
                out.push({ label, value });
            }
        }
    }
    return out;
}

/**
 * @param {{ label: string, value: string }[]} options
 * @returns {string}
 */
function inlineSelectOptionsSignature(options) {
    if (!options || options.length === 0) {
        return "";
    }
    return options
        .slice()
        .map((o) => String(o.value || "").trim())
        .sort()
        .join("\u0001");
}

/**
 * Extract `{ action: "dfchat_inline_select", options: [...] }` from merged CX fulfillment messages.
 *
 * @param {unknown[]} messages
 * @returns {{ options: { label: string, value: string }[], placeholder: string, messageText: string } | null}
 */
function extractFirstDfchatInlineSelectFromCxMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return null;
    }
    for (let cx = 0; cx < messages.length; cx += 1) {
        const cand = messages[cx];
        if (!messageHasFulfillmentPayload(cand)) {
            continue;
        }
        /** @type {Record<string, unknown> | null} */
        let pl = null;
        try {
            pl = extractPayload(cand);
        } catch {
            pl = null;
        }
        const actionStr = unwrapPayloadStringField(pl && pl.action).toLowerCase();
        if (!pl || actionStr !== "dfchat_inline_select") {
            continue;
        }
        const rawMessage =
            Object.prototype.hasOwnProperty.call(pl, "message") ? pl.message
                : Object.prototype.hasOwnProperty.call(pl, "text") ? pl.text
                    : Object.prototype.hasOwnProperty.call(pl, "prompt") ? pl.prompt
                        : null;
        const messageText = normalizeOpenVideoMessage(rawMessage);
        const placeholderRaw = Object.prototype.hasOwnProperty.call(pl, "placeholder") ? pl.placeholder : "";
        const placeholder = unwrapPayloadStringField(placeholderRaw).trim() || "Choose…";
        const opts = normalizeDfchatInlineSelectOptions(pl.options);
        if (opts.length === 0) {
            continue;
        }
        return { options: opts, placeholder, messageText };
    }
    return null;
}

/**
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {{ label: string, value: string }[]} options
 * @param {string} placeholder
 * @param {string} messageText
 * @returns {void}
 */
function scheduleInjectInlineSelectDropdown(dfMessenger, options, placeholder, messageText) {
    const injectSeq = (dfchatInlineSelectInjectSeq += 1);
    let injected = false;
    /** @type {number[] | undefined} */
    let pendingTimers = undefined;

    const list = Array.isArray(options) ? options.slice(0, 300) : [];
    const ph = typeof placeholder === "string" && placeholder.trim() ? placeholder.trim() : "Choose…";
    const msg = typeof messageText === "string" ? messageText.trim() : "";

    function tryAppend() {
        if (injected) {
            return;
        }
        if (injectSeq !== dfchatInlineSelectInjectSeq) {
            return;
        }
        const msResolved =
            dfMessenger
            || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
            || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);
        const ml = findMessengerMessageListRoot(msResolved);
        if (!ml) {
            return;
        }

        try {
            removeDfchatLastInlineSelectIfPresent();
        } catch {
            /* ignore */
        }

        const wrap = document.createElement("div");
        wrap.className = DFCHAT_INLINE_SELECT_CLASS;
        wrap.style.cssText = [
            "width:100%",
            "box-sizing:border-box",
            "margin:10px 0 0",
            "padding:0 10px 12px",
            "pointer-events:auto"
        ].join(";");

        if (msg) {
            const messageEl = document.createElement("div");
            messageEl.style.cssText = "font-size:14px;line-height:1.35;margin:0 0 8px;color:rgba(0,0,0,.82)";
            messageEl.textContent = msg;
            wrap.appendChild(messageEl);
        }

        const sel = document.createElement("select");
        sel.setAttribute("aria-label", ph);
        sel.style.cssText = [
            "width:100%",
            "max-width:100%",
            "box-sizing:border-box",
            "font-size:15px",
            "line-height:1.3",
            "padding:10px 12px",
            "border-radius:8px",
            "border:1px solid rgba(0,0,0,.14)",
            "background:#fff",
            "color:rgba(0,0,0,.87)",
            "cursor:pointer"
        ].join(";");

        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = ph;
        opt0.disabled = true;
        opt0.selected = true;
        sel.appendChild(opt0);

        for (let i = 0; i < list.length; i += 1) {
            const o = list[i];
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label || o.value;
            sel.appendChild(opt);
        }

        sel.addEventListener("change", () => {
            const v = (sel.value || "").trim();
            if (!v) {
                return;
            }
            sendUserTextViaDfMessenger(msResolved, v, true);
            try {
                if (wrap.parentNode && typeof wrap.remove === "function") {
                    wrap.remove();
                } else if (wrap.parentNode) {
                    wrap.parentNode.removeChild(wrap);
                }
            } catch {
                /* ignore */
            }
            dfchatLastInlineSelectWrapEl = null;
        });

        wrap.appendChild(sel);

        const beforeNode = resolveGalleryInsertBeforeByCxOrder(ml);
        if (beforeNode && beforeNode.parentNode === ml && typeof ml.insertBefore === "function") {
            ml.insertBefore(wrap, beforeNode);
        } else {
            ml.appendChild(wrap);
        }
        dfchatLastInlineSelectWrapEl = wrap;

        injected = true;
        try {
            ml.scrollTop = ml.scrollHeight;
        } catch {
            /* ignore */
        }

        if (Array.isArray(pendingTimers)) {
            for (let ti = 0; ti < pendingTimers.length; ti += 1) {
                clearTimeout(pendingTimers[ti]);
            }
            pendingTimers = undefined;
        }
    }

    const delaysMs = [72, 180, 400, 800, 1600];
    delaysMs.forEach((delayMs) => {
        const tid = window.setTimeout(() => {
            tryAppend();
        }, delayMs);
        if (!pendingTimers) {
            pendingTimers = [];
        }
        pendingTimers.push(tid);
    });
}

/**
 * Drop the previous inline city dropdown when this turn has no allowed `dfchat_inline_select`.
 *
 * @param {unknown[]} messages Merged CX `responseMessages` (see `mergeCxResponseEnvelopeForGallery`).
 * @param {Event | null | undefined} event
 * @returns {void}
 */
function pruneStaleInlineSelectForCxResponse(messages, event) {
    try {
        const payload = extractFirstDfchatInlineSelectFromCxMessages(messages);
        const hasPayload = !!(payload && payload.options && payload.options.length > 0);
        const gateOk = passesInlineRichMediaIntentGate(event);
        if (hasPayload && gateOk) {
            return;
        }
        removeDfchatLastInlineSelectIfPresent();
    } catch {
        /* ignore */
    }
}

/**
 * Custom payload: `{ action: "dfchat_inline_select", options: [...] }` → native `select` in the transcript.
 *
 * @param {unknown[]} messages
 * @param {Event | null | undefined} [event]
 */
function tryDfchatInlineSelectFromBotResponseMessages(messages, event) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            return;
        }
        if (!passesInlineRichMediaIntentGate(event)) {
            return;
        }
        const payload = extractFirstDfchatInlineSelectFromCxMessages(messages);
        if (!payload || !payload.options || payload.options.length === 0) {
            return;
        }
        const sig = inlineSelectOptionsSignature(payload.options);
        if (sig && dfchatInlineSelectSignaturesSeen.has(sig)) {
            return;
        }
        if (sig) {
            dfchatInlineSelectSignaturesSeen.add(sig);
        }
        scheduleInjectInlineSelectDropdown(
            activeDfMessenger,
            payload.options,
            payload.placeholder,
            payload.messageText
        );
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[company.js] Inline select payload skipped (never breaks bot replies)", e);
        }
    }
}

/**
 * @param {unknown[]} messages
 * @returns {string[]}
 */
function collectCxResponsePlainTexts(messages) {
    /** @type {string[]} */
    const out = [];
    if (!Array.isArray(messages)) {
        return out;
    }
    for (let i = 0; i < messages.length; i += 1) {
        const message = messages[i];
        if (!message || typeof message !== "object") {
            continue;
        }
        /** @type {Record<string, unknown>} */
        const m = /** @type {Record<string, unknown>} */ (message);
        const txt = m.text && typeof m.text === "object" ? /** @type {{ text?: unknown }} */ (m.text).text : null;
        if (Array.isArray(txt)) {
            for (let j = 0; j < txt.length; j += 1) {
                out.push(String(txt[j] || ""));
            }
        }
    }
    return out;
}

/**
 * Bot asks for appointment/consultation date (Book Consultation flow page 5).
 * @param {string[]} texts
 * @returns {boolean}
 */
function shouldOpenBookingCalendarFromTexts(texts) {
    const blob = texts.join("\n").toLowerCase();
    return (/preferred date/.test(blob) && (/consultation/.test(blob) || /appointment/.test(blob)))
        || (/pick/.test(blob) && /date/.test(blob) && /time/.test(blob));
}

function removeDfchatLastBookingCalendarIfPresent() {
    dfchatInlineBookingCalendarInjectSeq += 1;
    const el = dfchatLastInlineBookingCalWrapEl;
    dfchatLastInlineBookingCalWrapEl = null;
    if (el && el.parentNode) {
        try {
            el.parentNode.removeChild(el);
        } catch {
            /* ignore */
        }
    }
}

/**
 * @param {unknown[]} messages
 * @param {Event | null | undefined} event
 */
function pruneStaleInlineBookingCalendarForCxResponse(messages, event) {
    try {
        const texts = collectCxResponsePlainTexts(messages);
        const gateOk = passesInlineRichMediaIntentGate(event);
        const promptOk = gateOk && shouldOpenBookingCalendarFromTexts(texts);
        const doctorReady =
            typeof window !== "undefined"
            && typeof window.__dfchatBookingDoctorId === "string"
            && window.__dfchatBookingDoctorId.trim().length > 0;
        if (promptOk && doctorReady) {
            return;
        }
        removeDfchatLastBookingCalendarIfPresent();
    } catch {
        /* ignore */
    }
}

/**
 * @param {HTMLElement | null | undefined} dfMessenger
 * @param {string} doctorId
 * @param {string} [doctorTitle]
 */
function scheduleInjectBookingCalendar(dfMessenger, doctorId, doctorTitle) {
    const did = String(doctorId || "").trim();
    if (!did) {
        return;
    }
    const injectSeq = (dfchatInlineBookingCalendarInjectSeq += 1);
    /** @type {ReturnType<typeof setTimeout>[] | undefined} */
    let pendingTimers;

    async function tryAppend() {
        if (injectSeq !== dfchatInlineBookingCalendarInjectSeq) {
            return;
        }
        const msResolved =
            dfMessenger
            || (typeof activeDfMessenger !== "undefined" ? activeDfMessenger : null)
            || (typeof document !== "undefined" ? document.querySelector("df-messenger") : null);
        const ml = findMessengerMessageListRoot(msResolved);
        if (!ml || typeof ml.appendChild !== "function") {
            return;
        }

        const prevWrap = dfchatLastInlineBookingCalWrapEl;
        if (prevWrap && prevWrap.parentNode) {
            try {
                prevWrap.parentNode.removeChild(prevWrap);
            } catch {
                /* ignore */
            }
        }
        dfchatLastInlineBookingCalWrapEl = null;

        let resolvedTitle = typeof doctorTitle === "string" ? doctorTitle.trim() : "";
        if (!resolvedTitle) {
            try {
                const url = getApiEndpoint("/api/doctors");
                if (url) {
                    const r = await fetch(url, { credentials: "omit" });
                    const j = await r.json();
                    const docs = j && j.doctors;
                    if (Array.isArray(docs)) {
                        const row = docs.find((x) => String(x.DoctorId || "").trim() === did);
                        if (row) {
                            resolvedTitle = String(row.DisplayDoctorName || row.DoctorName || "").trim();
                        }
                    }
                }
            } catch {
                /* ignore */
            }
        }

        const wrap = document.createElement("div");
        wrap.className = DFCHAT_INLINE_BOOKING_CAL_CLASS;
        wrap.setAttribute("data-dfchat-no-translate", "true");
        wrap.style.cssText = [
            "box-sizing:border-box",
            "margin:10px 0 12px",
            "padding:12px",
            "width:100%",
            "max-width:100%",
            "border-radius:14px",
            "border:1px solid rgba(148,163,184,0.35)",
            "background:#fff",
            "color:#0f172a",
            "pointer-events:auto",
            "font-family:Manrope,Segoe UI,system-ui,sans-serif"
        ].join(";");

        const head = document.createElement("div");
        head.textContent = `${resolvedTitle || `Doctor ${did}`} — pick a date, then a time slot`;
        head.style.cssText = "font:700 13px/1.3 Manrope,Segoe UI,sans-serif;margin:0 0 10px;color:#0f172a";

        const legend = document.createElement("div");
        legend.style.cssText =
            "display:flex;gap:12px;flex-wrap:wrap;font:600 11px/1.2 Manrope,sans-serif;margin:0 0 10px;color:rgba(15,23,42,0.75)";
        legend.innerHTML =
            "<span><span style=\"display:inline-block;width:10px;height:10px;border-radius:3px;background:#22c55e;vertical-align:middle;margin-right:6px\"></span>Available</span>"
            + "<span><span style=\"display:inline-block;width:10px;height:10px;border-radius:3px;background:#ef4444;vertical-align:middle;margin-right:6px\"></span>Booked</span>"
            + "<span><span style=\"display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(148,163,184,0.45);vertical-align:middle;margin-right:6px\"></span>Closed</span>";

        const nav = document.createElement("div");
        nav.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin:0 0 8px";

        const monthLabel = document.createElement("div");
        monthLabel.style.cssText = "font:700 13px/1.2 Manrope,sans-serif";

        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.setAttribute("aria-label", "Previous month");
        prevBtn.textContent = "◀";
        prevBtn.style.cssText =
            "appearance:none;border:1px solid rgba(148,163,184,0.45);border-radius:8px;background:#fff;padding:4px 10px;cursor:pointer;font-size:14px";

        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.setAttribute("aria-label", "Next month");
        nextBtn.textContent = "▶";
        nextBtn.style.cssText = prevBtn.style.cssText;

        nav.appendChild(prevBtn);
        nav.appendChild(monthLabel);
        nav.appendChild(nextBtn);

        const gridWrap = document.createElement("div");
        gridWrap.style.cssText = "margin-bottom:10px";

        const dow = document.createElement("div");
        dow.style.cssText =
            "display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font:600 10px/1 Manrope,sans-serif;color:rgba(15,23,42,0.55);margin-bottom:4px;text-align:center";
        ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((dLabel) => {
            const c0 = document.createElement("div");
            c0.textContent = dLabel;
            dow.appendChild(c0);
        });

        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:4px";

        const slotsPanel = document.createElement("div");
        slotsPanel.style.cssText =
            "margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.35);min-height:48px";

        const slotsHint = document.createElement("div");
        slotsHint.style.cssText =
            "font:600 11px/1.3 Manrope,sans-serif;color:rgba(15,23,42,0.65);margin-bottom:8px";
        slotsHint.textContent = "Select a date to load time slots.";

        const slotsFlex = document.createElement("div");
        slotsFlex.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";

        slotsPanel.appendChild(slotsHint);
        slotsPanel.appendChild(slotsFlex);

        gridWrap.appendChild(dow);
        gridWrap.appendChild(grid);

        wrap.appendChild(head);
        wrap.appendChild(legend);
        wrap.appendChild(nav);
        wrap.appendChild(gridWrap);
        wrap.appendChild(slotsPanel);

        /** @type {{ y: number, m: number }} */
        const view = { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };

        /** @type {Record<string, { working?: boolean, bookedCount?: number, totalSlots?: number }> | null} */
        let overviewDays = null;

        function monthKeyStr() {
            return `${view.y}-${String(view.m).padStart(2, "0")}`;
        }

        function fmtMonthLabel() {
            const dt = new Date(view.y, view.m - 1, 1);
            return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
        }

        async function fetchOverview() {
            const apiUrl = getApiEndpoint("/api/doctor-month-overview");
            if (!apiUrl) {
                overviewDays = null;
                return;
            }
            const u = new URL(apiUrl);
            u.searchParams.set("doctorId", did);
            u.searchParams.set("month", monthKeyStr());
            try {
                const r = await fetch(u.toString(), { credentials: "omit" });
                const j = await r.json();
                if (j && j.ok && j.days && typeof j.days === "object") {
                    overviewDays = /** @type {Record<string, { working?: boolean, bookedCount?: number, totalSlots?: number }>} */ (j.days);
                } else {
                    overviewDays = null;
                }
            } catch {
                overviewDays = null;
            }
        }

        /**
         * @param {HTMLElement} el
         * @param {{ working?: boolean, bookedCount?: number, totalSlots?: number } | null | undefined} info
         * @param {boolean} isToday
         */
        function styleDayCell(el, info, isToday) {
            el.style.cssText =
                "border-radius:8px;padding:6px 0;text-align:center;font:700 12px/1 Manrope,sans-serif;cursor:pointer;border:1px solid transparent";
            if (!info || !info.working) {
                el.style.background = "rgba(148,163,184,0.22)";
                el.style.color = "rgba(15,23,42,0.35)";
                el.style.cursor = "default";
                return;
            }
            const booked = Number(info.bookedCount || 0);
            const total = Number(info.totalSlots || 0);
            if (total > 0 && booked >= total) {
                el.style.background = "rgba(239,68,68,0.18)";
                el.style.borderColor = "rgba(239,68,68,0.45)";
                el.style.color = "#991b1b";
            } else if (booked > 0) {
                el.style.background = "rgba(234,179,8,0.15)";
                el.style.borderColor = "rgba(234,179,8,0.45)";
                el.style.color = "#92400e";
            } else {
                el.style.background = "rgba(34,197,94,0.14)";
                el.style.borderColor = "rgba(34,197,94,0.45)";
                el.style.color = "#166534";
            }
            if (isToday) {
                el.style.boxShadow = "0 0 0 2px rgba(3,105,161,0.45)";
            }
        }

        async function loadSlotsForDate(dateISO) {
            slotsFlex.innerHTML = "";
            slotsHint.textContent = `Time slots for ${dateISO}`;
            const apiUrl = getApiEndpoint("/api/slots");
            if (!apiUrl) {
                slotsHint.textContent = "API base URL not configured.";
                return;
            }
            const u = new URL(apiUrl);
            u.searchParams.set("doctorId", did);
            u.searchParams.set("date", dateISO);
            try {
                const r = await fetch(u.toString(), { credentials: "omit" });
                const j = await r.json();
                if (!j || !j.ok) {
                    slotsHint.textContent = "Could not load slots.";
                    return;
                }
                const statuses = Array.isArray(j.slotStatuses) ? j.slotStatuses : [];
                if (statuses.length === 0) {
                    slotsHint.textContent = "No slots on this day.";
                    return;
                }
                for (let si = 0; si < statuses.length; si += 1) {
                    const row = statuses[si];
                    const label = row && row.label ? String(row.label) : "";
                    const booked = row && row.status === "booked";
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.textContent = label;
                    btn.style.cssText = [
                        "appearance:none",
                        "border-radius:10px",
                        "padding:8px 10px",
                        "font:700 11px/1 Manrope,sans-serif",
                        "cursor:pointer",
                        "border:1px solid rgba(148,163,184,0.45)",
                        booked
                            ? "background:rgba(239,68,68,0.2);color:#991b1b;cursor:not-allowed"
                            : "background:rgba(34,197,94,0.18);color:#166534"
                    ].join(";");
                    if (booked) {
                        btn.disabled = true;
                    } else {
                        btn.addEventListener("click", () => {
                            const ms = msResolved || activeDfMessenger;
                            if (!ms || !dateISO || !label) {
                                return;
                            }
                            sendUserTextViaDfMessenger(ms, dateISO, true);
                            window.setTimeout(() => {
                                sendUserTextViaDfMessenger(ms, label, true);
                            }, 380);
                            try {
                                removeDfchatLastBookingCalendarIfPresent();
                            } catch {
                                /* ignore */
                            }
                        });
                    }
                    slotsFlex.appendChild(btn);
                }
            } catch {
                slotsHint.textContent = "Could not load slots.";
            }
        }

        async function renderCalendar() {
            monthLabel.textContent = fmtMonthLabel();
            grid.innerHTML = "";
            await fetchOverview();

            const firstDow = new Date(view.y, view.m - 1, 1).getDay();
            const monOffset = (firstDow + 6) % 7;
            const dim = new Date(view.y, view.m, 0).getDate();

            for (let i = 0; i < monOffset; i += 1) {
                const ph = document.createElement("div");
                ph.style.cssText = "visibility:hidden";
                grid.appendChild(ph);
            }

            const today = new Date();
            const ty = today.getFullYear();
            const tm = today.getMonth() + 1;
            const td = today.getDate();

            for (let day = 1; day <= dim; day += 1) {
                const dateISO = `${view.y}-${String(view.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const cell = document.createElement("button");
                cell.type = "button";
                cell.textContent = String(day);
                const info = overviewDays ? overviewDays[dateISO] : null;
                const isToday = ty === view.y && tm === view.m && td === day;
                styleDayCell(cell, info, isToday);

                if (!info || !info.working) {
                    cell.disabled = true;
                } else {
                    cell.addEventListener("click", () => {
                        void loadSlotsForDate(dateISO);
                    });
                }
                grid.appendChild(cell);
            }
        }

        prevBtn.addEventListener("click", () => {
            view.m -= 1;
            if (view.m < 1) {
                view.m = 12;
                view.y -= 1;
            }
            void renderCalendar();
        });
        nextBtn.addEventListener("click", () => {
            view.m += 1;
            if (view.m > 12) {
                view.m = 1;
                view.y += 1;
            }
            void renderCalendar();
        });

        await renderCalendar();

        const beforeNode = resolveGalleryInsertBeforeByCxOrder(ml);
        if (beforeNode && beforeNode.parentNode === ml && typeof ml.insertBefore === "function") {
            ml.insertBefore(wrap, beforeNode);
        } else {
            ml.appendChild(wrap);
        }
        dfchatLastInlineBookingCalWrapEl = wrap;

        try {
            ml.scrollTop = ml.scrollHeight;
        } catch {
            /* ignore */
        }

        if (Array.isArray(pendingTimers)) {
            for (let ti = 0; ti < pendingTimers.length; ti += 1) {
                clearTimeout(pendingTimers[ti]);
            }
            pendingTimers = undefined;
        }
    }

    const delaysMs = [72, 180, 400, 800, 1600];
    delaysMs.forEach((delayMs) => {
        const tid = window.setTimeout(() => {
            void tryAppend();
        }, delayMs);
        if (!pendingTimers) {
            pendingTimers = [];
        }
        pendingTimers.push(tid);
    });
}

/**
 * @param {unknown[]} messages
 * @param {Event | null | undefined} [event]
 */
function tryOpenBookingCalendarFromBotResponse(messages, event) {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            return;
        }
        if (!passesInlineRichMediaIntentGate(event)) {
            return;
        }
        const texts = collectCxResponsePlainTexts(messages);
        if (!shouldOpenBookingCalendarFromTexts(texts)) {
            return;
        }
        const doctorId =
            typeof window !== "undefined" && typeof window.__dfchatBookingDoctorId === "string"
                ? window.__dfchatBookingDoctorId.trim()
                : "";
        if (!doctorId) {
            return;
        }
        scheduleInjectBookingCalendar(activeDfMessenger, doctorId, "");
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[company.js] Booking calendar skipped", e);
        }
    }
}

function attachImageLightboxClickHandler() {
    if (window.__dfchatImageLightboxBound === true) {
        return;
    }
    window.__dfchatImageLightboxBound = true;

    document.addEventListener("click", (event) => {
        const path = event && typeof event.composedPath === "function" ? event.composedPath() : [];
        ensureMobileLightboxParkStyle();
        try {
            // Dismiss our overlays only — never block the native collapse/close handler on df-messenger.
            if (didUserCloseChat(event) || isClickInMessengerChatTitlebar(path)) {
                suppressDfchatLightboxAfterChatDismiss();
                return;
            }
        } catch {
            /* ignore */
        }
        /** @type {HTMLElement | null} */
        let img = null;
        for (const node of path) {
            if (node && typeof node.tagName === "string" && node.tagName.toLowerCase() === "img") {
                img = /** @type {HTMLElement} */ (node);
                break;
            }
        }
        const t = img || (event && event.target);
        if (!t || typeof t.tagName !== "string" || t.tagName.toLowerCase() !== "img") {
            return;
        }
        // Only inside the messenger UI (works with shadow DOM retargeting).
        const inMessenger = path.some((n) => n && typeof n.tagName === "string" && n.tagName.toLowerCase() === "df-messenger")
            || (!!t.closest && !!t.closest("df-messenger"));
        if (!inMessenger) {
            return;
        }
        // Never open for the launcher FAB only (not expanded chat — that lives under df-messenger-chat-bubble too).
        if (isInsideMessengerLauncherBubbleGraphic(t)) {
            return;
        }

        // If the payload links to wellness.html or legacy image-viewer URLs, intercept and open the in-page lightbox
        // so the chat stays open and the conversation is not reset.
        for (const node of path) {
            if (!node || typeof node.tagName !== "string" || node.tagName.toLowerCase() !== "a") {
                continue;
            }
            const href = typeof node.getAttribute === "function" ? (node.getAttribute("href") || "") : "";
            if (!href || !/(?:image-viewer|wellness)\.html/i.test(href)) {
                continue;
            }
            try {
                const u = new URL(href, window.location.href);
                const imgs = u.searchParams.getAll("img").filter(Boolean);
                const iRaw = u.searchParams.get("i");
                const idx = iRaw != null ? Math.max(0, parseInt(iRaw, 10) || 0) : 0;
                if (imgs.length > 0) {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    event.stopImmediatePropagation?.();
                    openImageLightbox(imgs, idx, "");
                    return;
                }
            } catch {
                /* ignore */
            }
        }

        const src = (t.getAttribute && t.getAttribute("src")) || "";
        if (!src) {
            return;
        }
        // Skip marker images / internal assets.
        if (src.includes("dfchat-")) {
            return;
        }
        // Try to treat the clicked image as part of a carousel row (detect before URL allowlist).
        /** @type {HTMLElement | null} */
        let row = null;
        for (const node of path) {
            if (!node || typeof node.querySelectorAll !== "function") {
                continue;
            }
            try {
                // Prefer our injected horizontal strips. Otherwise when a carousel row has only one <img>
                // (e.g. one doctor card with ImageUrl), the first ancestor with 2+ images becomes the whole
                // transcript (#message-list), pulling in bot persona / chrome images into the lightbox.
                if (node instanceof Element && node.classList
                    && (node.classList.contains(`${DFCHAT_INLINE_CARD_CAROUSEL_CLASS}__track`)
                        || node.classList.contains(`${DFCHAT_INLINE_GALLERY_CLASS}__track`))) {
                    row = /** @type {HTMLElement} */ (node);
                    break;
                }
                const imgs = node.querySelectorAll("img");
                if (imgs && imgs.length >= 2) {
                    if (node instanceof Element) {
                        const id = typeof node.id === "string" ? node.id : "";
                        const tag = node.tagName ? String(node.tagName).toLowerCase() : "";
                        if (id === "message-list" || tag === "df-message-list") {
                            continue;
                        }
                    }
                    row = /** @type {HTMLElement} */ (node);
                    break;
                }
            } catch {
                /* ignore */
            }
        }
        let srcs = [];
        if (row) {
            try {
                srcs = Array.from(row.querySelectorAll("img"))
                    .map((el) => (el && el.getAttribute ? el.getAttribute("src") : "") || "")
                    .filter((u) => u && !u.includes("dfchat-"));
            } catch {
                srcs = [];
            }
        }
        if (!srcs || srcs.length === 0) {
            srcs = [src];
        }
        const fromCarouselRow = !!(row && srcs.length >= 2);
        const fromApprovedBucket = /storage\.googleapis\.com\/companybucket\/Images\//i.test(src);
        if (!fromCarouselRow && !fromApprovedBucket) {
            return;
        }
        const idx = Math.max(0, srcs.indexOf(src));
        event.preventDefault?.();
        event.stopPropagation?.();
        openImageLightbox(srcs, idx, t.getAttribute ? t.getAttribute("alt") : "");
    }, true);
}

function isChatExpanded(dfMessenger) {
    if (!dfMessenger) {
        return false;
    }

    if (typeof dfMessenger.expand === "boolean") {
        return dfMessenger.expand;
    }

    const expandAttribute = (dfMessenger.getAttribute("expand") || "").toLowerCase();
    return expandAttribute === "true";
}

/**
 * Pick a digit-only mobile from prose (e.g. “call me on 98 98 123456”, “no. 9876543210”, +91 …).
 * @param {string} raw
 * @returns {string}
 */
function extractLikelyMobileDigitsForMerge_(raw) {
    const spaced = typeof raw === "string" ? raw.replace(/\u00a0/g, " ").trim() : "";
    if (!spaced || spaced.length > 520) {
        return "";
    }

    const found = [];

    /**
     * Indian-style 10 digits after optional +91 / leading 0; digits may be separated by spaces / punctuation.
     */
    const reIN = /(?:^|[^\d])(?:\+?91[\s\-.()/]*|0[\s\-.()/]*)?([6-9](?:[\s\-.()/]*\d){9})(?![\d])/g;
    let m;
    while ((m = reIN.exec(spaced)) !== null) {
        const d = m[1].replace(/\D/g, "");
        if (d.length === 10) {
            found.push(d);
        }
    }

    const keywordRe =
        /(?:^|[^\w])(?:mobile|mob|mobs?|cell|phones?|whatsapp|whatsapp\s*no|whatsapp\s*number|call\s*me|contact|numbers?|\bno\.|\btel\b|handphone|reach\s*(?:me|us)|at\s*\+?|my\s+number|digit|संपर्क|फोन|मोबाइल)/i;

    const withKeywordWindow = (idxStart, idxEnd) => {
        const a = Math.max(0, idxStart - 56);
        const b = Math.min(spaced.length, idxEnd + 32);
        return keywordRe.test(spaced.slice(a, b));
    };

    const rePlain = /(?:^|[^\d])(\+?\d[\d\s().\-/]{8,}\d)(?=$|[^\d])/g;
    while ((m = rePlain.exec(spaced)) !== null) {
        let d = m[1].replace(/\D/g, "");
        if (d.length === 12 && d.startsWith("91")) {
            d = d.slice(2);
        }
        if (d.length === 11 && d.startsWith("0")) {
            d = d.slice(1);
        }
        if (d.length === 10 && withKeywordWindow(m.index, m.index + m[0].length)) {
            found.push(d);
        } else if (d.length >= 11 && d.length <= 13 && withKeywordWindow(m.index, m.index + m[0].length)) {
            const tail = d.slice(-10);
            if (/^[6-9]\d{9}$/.test(tail)) {
                found.push(tail);
            }
        }
    }

    if (found.length) {
        return found[found.length - 1];
    }

    const allD = spaced.replace(/\D/g, "");
    if (allD.length >= 10 && allD.length <= 13) {
        for (let end = allD.length; end >= 10; end -= 1) {
            const tail = allD.slice(end - 10, end);
            if (/^[6-9]\d{9}$/.test(tail)) {
                return tail;
            }
        }
    }
    if (allD.length >= 10 && keywordRe.test(spaced)) {
        for (let end = allD.length; end >= 10; end -= 1) {
            const tail = allD.slice(end - 10, end);
            if (/^[1-9]\d{9}$/.test(tail)) {
                return tail;
            }
        }
    }
    return "";
}

/**
 * Persist mobile from chat: bare numeric lines (legacy) or numbers embedded in natural language.
 * @param {string} raw
 */
function mergeLikelyMobileFromChatText(raw) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t || t.length > 520) {
        return;
    }
    const normalized = t.replace(/\u00a0/g, " ");
    const digitsOnly = normalized.replace(/\D/g, "");

    /** Legacy: whole message is basically a phone token (digits / + / space / parens / dashes). */
    if (
        t.length <= 48
        && digitsOnly.length >= 9
        && digitsOnly.length <= 15
        && /^[\d\s+().\-]+$/i.test(normalized)
    ) {
        mergeVisitorMobileIntoStoredContext(digitsOnly, { syncSheet: false, fromChat: true });
        return;
    }

    const extracted = extractLikelyMobileDigitsForMerge_(t);
    if (extracted && extracted.replace(/\D/g, "").length >= 9) {
        mergeVisitorMobileIntoStoredContext(extracted.replace(/\D/g, ""), { syncSheet: false, fromChat: true });
    }
}

/**
 * Capture `user@domain.tld` style emails typed in chat into `client_context.email`.
 * @param {string} raw
 */
function mergeLikelyEmailFromChatText(raw) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t || t.length > 520) {
        return;
    }
    const re =
        /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g;
    let m;
    let chosen = "";
    while ((m = re.exec(t)) !== null) {
        const s = (m[0] || "").trim();
        if (s && EMAIL_VALIDATION_RE.test(s)) {
            chosen = s;
        }
    }
    if (chosen) {
        mergeVisitorEmailIntoStoredContext(chosen);
    }
}

/**
 * Merge phone / email hints from outgoing chat text before mobile gate and query counting.
 * @param {string} raw
 */
function mergeLikelyContactHintsFromChatText_(raw) {
    mergeLikelyMobileFromChatText(raw);
    mergeLikelyEmailFromChatText(raw);
}

/**
 * True when the line is mostly a phone share (digits + short filler) so we can thank the user and skip CX.
 * @param {string} raw
 * @param {{ gainedMobile: boolean, gainedEmail: boolean }} hints
 * @returns {boolean}
 */
function isLikelyContactCaptureOnlyInputForThankYou_(raw, hints) {
    const t = typeof raw === "string" ? raw.replace(/\u00a0/g, " ").trim() : "";
    if (!t || t.length > 200) {
        return false;
    }
    if (!hints || !hints.gainedMobile) {
        return false;
    }
    const ext = extractLikelyMobileDigitsForMerge_(t);
    if (!ext || ext.length < 10) {
        return false;
    }
    const allD = t.replace(/\D/g, "");
    if (!allD.includes(ext)) {
        return false;
    }
    if (allD.length > ext.length + 3) {
        return false;
    }
    const residue = t
        .toLowerCase()
        .replace(/[0-9+().\-/\s@]/g, " ")
        .replace(
            /\b(my|the|is|are|am|was|no|on|at|me|pls|please|kindly|call|calling|mobile|mob|phone|whatsapp|whatsapp\s*no|number|numbers|contact|email|sir|madam|hi|hello|hey|dear|thanks|thank\s*you|thx|ok|okay|here|this|that|give|sharing|shared|share|reach|digit|num|no\.|india|country|code)\b/gi,
            " "
        );
    const cleaned = residue.replace(/[a-z0-9._%+-]+\.[a-z]{2,}\b/gi, " ").replace(/\s+/g, " ").trim();
    return cleaned.length <= 28;
}

/**
 * After {@link mergeLikelyContactHintsFromChatText_}, optionally thank the visitor and block the outbound CX
 * request when the line was essentially only a mobile share (avoids Default Fallback / “no match”).
 * Still records the line in `user_queries` so session→Sheets sync can upsert one row (chat mobile no longer POSTs `/contact-form-mobile-sheet-sync` separately).
 *
 * @param {Event | null | undefined} event
 * @param {string} raw trimmed text
 * @param {{ hadMobile: boolean, hadEmail: boolean }} before merge snapshot (9+ digit rule for mobile)
 * @returns {boolean} true when the Dialogflow request should be skipped for this line
 */
function tryRenderThanksAfterMergeSuppressDf_(event, raw, before) {
    const t = typeof raw === "string" ? raw.replace(/\u00a0/g, " ").trim() : "";
    if (!t) {
        return false;
    }
    const hasMobile = hasStoredMobileForChatBlockGate_();
    const next = readStoredClientContext();
    const hasEmail = !!(dfParameterScalarToString(next && next.email != null ? next.email : "").trim());
    const gainedMobile = !before.hadMobile && hasMobile;
    const gainedEmail = !before.hadEmail && hasEmail;
    if (!gainedMobile || !isLikelyContactCaptureOnlyInputForThankYou_(t, { gainedMobile, gainedEmail })) {
        return false;
    }
    try {
        if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
        }
    } catch {
        /* ignore */
    }
    const ms = activeDfMessenger;
    const thanks = getTranslation("contactResponseThanks");
    const line = typeof thanks === "string" && thanks.trim() ? thanks.trim() : "Thank you for sharing.";
    if (ms && typeof ms.renderCustomText === "function") {
        ms.renderCustomText(line, true);
    }
    trackChatUserQueryInSessionContext_(t);
    if (ms && typeof ms.renderUserPersona === "function") {
        renderUserPersona(ms);
    }
    markContactOnlyThanksSuppressQuery_(t);
    scheduleClearDfMessengerComposerInput_();
    return true;
}

function handleDfResponseReceived(event) {
    const messages = event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    const cxResponseMessagesMerged = mergeCxResponseEnvelopeForGallery(event);
    pruneStaleInlineGalleryForCxResponse(cxResponseMessagesMerged, event);
    tryOpenGalleryFromBotResponseMessages(cxResponseMessagesMerged, event);
    pruneStaleInlineVideoForCxResponse(cxResponseMessagesMerged, event);
    tryOpenVideoFromBotResponseMessages(cxResponseMessagesMerged, event);
    pruneStaleInlineCardCarouselForCxResponse(cxResponseMessagesMerged, event);
    tryOpenCardCarouselFromBotResponseMessages(cxResponseMessagesMerged, event);
    pruneStaleInlineSelectForCxResponse(cxResponseMessagesMerged, event);
    tryDfchatInlineSelectFromBotResponseMessages(cxResponseMessagesMerged, event);
    pruneStaleInlineBookingCalendarForCxResponse(cxResponseMessagesMerged, event);
    tryOpenBookingCalendarFromBotResponse(cxResponseMessagesMerged, event);

    const requestedLanguage = extractLanguageFromResponse(event);
    if (requestedLanguage) {
        applyLanguage(requestedLanguage);
    }

    mergePhoneFromDialogflowParametersIntoStoredContext(event);

    const willOpenForm = shouldOpenContactForm(event);
    const rawOpenFormId = extractOpenFormIdFromEvent(event);
    const openFormId = rawOpenFormId ? canonicalContactFormId_(rawOpenFormId) : "";
    const mergedOpen = getRuntimeMergedFormDefinitions_();
    const formRegistered = !!(openFormId && mergedOpen[openFormId]);
    if (formRegistered) {
        setActiveContactFormId(openFormId);
        setTimeout(() => applyFormPrefillFromSession(openFormId), 100);
    } else if (willOpenForm) {
        applyDefaultContactFormForBareOpenFormAction(event);
    }

    if (willOpenForm) {
        pendingOpenFormPrefill = extractOpenFormPrefillFromEvent(event);
        /** Skip only when name+mobile were already stored before this turn — not when this payload prefills them. */
        const hadNameAndMobileBeforeThisOpenForm = sessionHasNameAndMobileForSkip_();
        if (pendingOpenFormPrefill) {
            mergePhoneFromOpenFormPrefillIntoStoredContext(pendingOpenFormPrefill);
            mergeContactHintsFromOpenFormPrefillIntoStoredContext(pendingOpenFormPrefill);
        }
        pendingNextFormIdsAfterSubmit = extractNextFormChainFromOpenFormEvent_(event);
        const messengerFollowups = extractOpenFormMessengerFollowupsFromEvent_(event);
        pendingOpenFormFollowupSubmit = messengerFollowups.submit;
        pendingOpenFormFollowupCancel = messengerFollowups.cancel;
        const skipContactUi =
            readContactFormConfig().formKey === "contact" && hadNameAndMobileBeforeThisOpenForm;
        if (skipContactUi) {
            pendingOpenFormFollowupSubmit = null;
            pendingOpenFormFollowupCancel = null;
            contactFormOpenPending = false;
            const formsSkip = getRuntimeMergedFormDefinitions_();
            const chainNext = consumeNextRegisteredFormFromPendingChain_(formsSkip);
            if (chainNext) {
                // Contact already satisfied in session (e.g. filled in another intent) — open first queued form now.
                setActiveContactFormId(chainNext);
                contactFormOpenPending = true;
            } else {
                pendingNextFormIdsAfterSubmit = [];
                pendingOpenFormPrefill = null;
            }
        } else {
            contactFormOpenPending = true;
        }
    }

    if (messages.length > 0) {
        const ms = activeDfMessenger;
        if (ms && typeof ms.renderCustomText === "function") {
            // Defer until after the messenger appends this turn’s bot rows so the persona strip is not lost or reordered.
            const messageInstantMs = Date.now();
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (activeDfMessenger === ms) {
                        renderBotPersona(ms, messageInstantMs);
                    }
                });
            });
        }
    }

    if (contactFormOpenPending) {
        scheduleContactFormOpen();
    }

    maybeIncrementBubbleUnreadFromResponse(event);

    scheduleDomTranslationRefresh();
}

function attachPersonaHandlers(dfMessenger) {
    void dfMessenger;
    if (companyPersonaWindowListenersAttached) {
        return;
    }
    companyPersonaWindowListenersAttached = true;

    /** Capture phase: typed input often originates under `df-messenger` shadow; bubble listeners can miss `detail.input`. */
    window.addEventListener(
        "df-user-input-entered",
        (event) => {
            const typed = extractDfUserInputEnteredText(event);
            const typedTrim = typeof typed === "string" ? typed.trim() : "";
            if (consumeContactOnlyThanksSuppressForQuery_(event, typedTrim)) {
                dfchatPendingTypedUtteranceForGate_ = "";
                return;
            }
            if (typedTrim) {
                dfchatPendingTypedUtteranceForGate_ = typedTrim;
            }
            if (isRestartChatEnabled() && isUserTypingRestartChatCommand(typed)) {
                dfchatPendingTypedUtteranceForGate_ = "";
                try {
                    if (typeof event.preventDefault === "function") {
                        event.preventDefault();
                    }
                } catch {
                    /* ignore */
                }
                scheduleRestartChatSessionFromUserPhrase();
                return;
            }
            if (consumeLanguageSwitchFromUserFlowPhrase(typed, event)) {
                dfchatPendingTypedUtteranceForGate_ = "";
                return;
            }
            const hadM1 = hasStoredMobileForChatBlockGate_();
            const prev1 = readStoredClientContext();
            const hadE1 = !!(dfParameterScalarToString(prev1 && prev1.email != null ? prev1.email : "").trim());
            mergeLikelyContactHintsFromChatText_(typedTrim);
            if (tryRenderThanksAfterMergeSuppressDf_(event, typedTrim, { hadMobile: hadM1, hadEmail: hadE1 })) {
                return;
            }
            if (tryPreventChatSendForMissingMobileGate_(event, typedTrim)) {
                return;
            }
            trackChatUserQueryInSessionContext_(typedTrim);
            const ms = activeDfMessenger;
            if (ms && typeof ms.renderCustomText === "function") {
                renderUserPersona(ms);
            }
        },
        true
    );

    window.addEventListener(
        "df-request-sent",
        (event) => {
            const queryRaw = extractQueryTextFromDfRequestSentEvent_(event);
            const fromReq = typeof queryRaw === "string" ? queryRaw.trim() : "";
            const pendingSnap =
                typeof dfchatPendingTypedUtteranceForGate_ === "string"
                    ? dfchatPendingTypedUtteranceForGate_.trim()
                    : "";
            dfchatPendingTypedUtteranceForGate_ = "";
            const effectiveQuery = fromReq || pendingSnap;

            if (consumeContactOnlyThanksSuppressForQuery_(event, effectiveQuery)) {
                return;
            }

            if (typeof effectiveQuery === "string"
                && isRestartChatEnabled()
                && isUserTypingRestartChatCommand(effectiveQuery)) {
                dfchatPendingTypedUtteranceForGate_ = "";
                scheduleRestartChatSessionFromUserPhrase();
                return;
            }

            if (consumeLanguageSwitchFromUserFlowPhrase(effectiveQuery || "")) {
                dfchatPendingTypedUtteranceForGate_ = "";
                return;
            }

            const hadM2 = hasStoredMobileForChatBlockGate_();
            const prev2 = readStoredClientContext();
            const hadE2 = !!(dfParameterScalarToString(prev2 && prev2.email != null ? prev2.email : "").trim());
            mergeLikelyContactHintsFromChatText_(effectiveQuery);
            if (tryRenderThanksAfterMergeSuppressDf_(event, effectiveQuery, { hadMobile: hadM2, hadEmail: hadE2 })) {
                return;
            }
            if (tryPreventChatSendForMissingMobileGate_(event, effectiveQuery)) {
                return;
            }

            trackChatUserQueryInSessionContext_(effectiveQuery);

            if (effectiveQuery) {
                const ms = activeDfMessenger;
                if (ms && typeof ms.renderCustomText === "function") {
                    renderUserPersona(ms);
                }
                scheduleClearDfMessengerComposerInput_();
            }
        },
        true
    );

    /** Fallback when rich controls emit selection events whose payload does not replay as `detail.input`. */
    const trackRichMessengerPhraseAndPersona = (phrase) => {
        const q = typeof phrase === "string" ? phrase.trim() : "";
        if (!q) {
            return;
        }
        mergeLikelyContactHintsFromChatText_(q);
        if (tryPreventChatSendForMissingMobileGate_(null, q)) {
            return;
        }
        trackChatUserQueryInSessionContext_(q);
        const ms = activeDfMessenger;
        if (ms && typeof ms.renderCustomText === "function") {
            renderUserPersona(ms);
        }
        scheduleClearDfMessengerComposerInput_();
    };
    ["df-chip-clicked", "df-button-clicked"].forEach((evtName) => {
        window.addEventListener(evtName, (event) => {
            const phrase = dfMessengerRichChoiceDetailToPhrase_(event && event.detail);
            if (phrase) {
                trackRichMessengerPhraseAndPersona(phrase);
            }
        }, true);
    });
    window.addEventListener("df-list-element-clicked", (event) => {
        const phrase = dfMessengerRichChoiceDetailToPhrase_(event && event.detail);
        if (phrase) {
            trackRichMessengerPhraseAndPersona(phrase);
        }
    }, true);

    /** Capture:true helps when messenger dispatches inside shadow/custom element trees. */
    window.addEventListener("df-response-received", handleDfResponseReceived, true);
}

function trackChatUserQueryInSessionContext_(raw) {
    const tRaw = typeof raw === "string" ? raw.trim() : "";
    if (!tRaw) {
        return;
    }
    const t = tRaw.length > MAX_STORED_CHAT_USER_QUERY_CHARS
        ? `${tRaw.slice(0, MAX_STORED_CHAT_USER_QUERY_CHARS)}…`
        : tRaw;
    try {
        const prev = readStoredClientContext();
        const existing = prev && Array.isArray(prev.user_queries) ? prev.user_queries : [];
        const next = existing.filter((x) => typeof x === "string" && x.trim());

        // Deduplicate: `df-user-input-entered` and `df-request-sent` can fire for the same user message.
        const last = next.length ? String(next[next.length - 1]).trim() : "";
        if (last && last === t) {
            return;
        }
        const now = Date.now();

        next.push(t);
        // Cap to keep long sessions useful (matches server-side merge limit).
        const capped = next.slice(Math.max(0, next.length - 120));
        persistClientContext({
            ...prev,
            user_queries: capped,
            user_queries_last_at: now
        });
        scheduleSessionQueriesSheetSync_();
    } catch {
        /* ignore */
    }
}

let sessionSheetSyncDebounceTimer = 0;

function scheduleSessionQueriesSheetSync_() {
    if (sessionSheetSyncDebounceTimer) {
        window.clearTimeout(sessionSheetSyncDebounceTimer);
    }
    sessionSheetSyncDebounceTimer = window.setTimeout(() => {
        sessionSheetSyncDebounceTimer = 0;
        postSessionQueriesToSheetRow_();
    }, 600);
}

function postSessionQueriesToSheetRow_() {
    const endpoint = getApiEndpoint(CONTACT_FORM_SESSION_SHEET_SYNC_ENDPOINT);
    if (!endpoint || typeof fetch !== "function") {
        return;
    }
    /** @type {Record<string, string>} */
    const headers = {
        "Content-Type": "application/json"
    };
    try {
        const metaNode =
            typeof document !== "undefined"
                ? document.querySelector('meta[name="dfchat-contact-form-mobile-sync-secret"]')
                : null;
        const mv = metaNode && metaNode instanceof HTMLMetaElement ? metaNode.getAttribute("content") : null;
        const sec = typeof mv === "string" ? mv.trim() : "";
        if (sec) {
            headers["X-Contact-Form-Mobile-Sync-Secret"] = sec;
        }
    } catch {
        /* ignore */
    }
    try {
        const client_context = getClientContext();
        /** Use resolved form key (default form when overlay never opened — not literal "chat"). */
        const sessCfg = readContactFormConfig();
        const fk = typeof sessCfg.formKey === "string" ? sessCfg.formKey.trim() : "";
        fetch(endpoint, {
            method: "POST",
            headers,
            credentials: "omit",
            body: JSON.stringify({
                client_context,
                _contactFormId: fk || getDefaultContactFormId()
            }),
            keepalive: true
        })
            .then(async (resp) => {
                if (resp.ok) {
                    return;
                }
                let detail = "";
                try {
                    detail = (await resp.text()).slice(0, 240);
                } catch {
                    /* ignore */
                }
                if (typeof console !== "undefined" && console.warn) {
                    console.warn(
                        "[dfchat] Session query sheet sync failed:",
                        resp.status,
                        detail || resp.statusText,
                        "— check API base URL, CORS, and X-Contact-Form-Mobile-Sync-Secret if Railway sets CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET."
                    );
                }
            })
            .catch(() => {});
    } catch {
        /* ignore */
    }
}

/**
 * Prefill contact fields from session `client_context` when Dialogflow already captured mobile / name / email.
 */
function applyStoredContactHintsToOpenContactForm_() {
    try {
        const stored = readStoredClientContext();
        const hints = {
            mobile: dfParameterScalarToString(stored && stored.mobile != null ? stored.mobile : ""),
            name: dfParameterScalarToString(stored && stored.name != null ? stored.name : ""),
            email: dfParameterScalarToString(stored && stored.email != null ? stored.email : "")
        };
        const cfg = readContactFormConfig();
        const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        for (let i = 0; i < fields.length; i += 1) {
            const def = fields[i];
            if (!def || !def.name || !def.id) {
                continue;
            }
            const nm = String(def.name).trim();
            const hint = nm === "mobile" ? hints.mobile : nm === "name" ? hints.name : nm === "email" ? hints.email : "";
            if (!hint) {
                continue;
            }
            const el = document.getElementById(def.id);
            if (el && "value" in el && !String(el.value || "").trim()) {
                el.value = hint;
            }
        }
    } catch {
        /* ignore */
    }
}

function initializeContactForm() {
    mountContactFormFieldsFromConfig();
    applyContactFormLayoutFromConfig();
    applyContactFormHeaderFromConfig();

    const form = document.getElementById("dfchat-contact-form-fields");
    const closeButton = document.getElementById("dfchat-contact-form-close");

    if (form) {
        form.addEventListener("submit", submitContactForm);
    }

    if (closeButton) {
        try {
            closeButton.setAttribute("data-dfchat-no-translate", "true");
            closeButton.textContent = "X";
        } catch {
            /* no-op */
        }
        closeButton.addEventListener("click", () => closeForm({ userDismissedForm: true }));
    }

    window.addEventListener("dfchat-open-contact-form", (e) => {
        const d = (e && e.detail) || {};
        if (d.formId) {
            setActiveContactFormId(String(d.formId).trim());
        }
        openContactForm();
    });
}

function initializeClientContextCapture() {
    if (!IS_CLIENT_CONTEXT_CAPTURE_ENABLED) {
        return;
    }
    const endpoint = getApiEndpoint(CHAT_CLIENT_CONTEXT_ENDPOINT);
    const clientContext = getClientContext();

    if (!endpoint || !clientContext.client_session_id) {
        return;
    }

    fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ client_context: clientContext }),
        keepalive: true
    }).catch(() => {
        // Ignore telemetry failures so the chat UI stays responsive.
    });
}

function shouldOpenContactForm(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];

    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    return [...responseMessages, ...messengerMessages].some(messageContainsOpenFormAction);
}

function extractLanguageFromResponse(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];

    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    for (const message of [...responseMessages, ...messengerMessages]) {
        const payload = extractPayload(message);
        if (!payload || payload.action !== "set_language") {
            continue;
        }

        const languageCode = typeof payload.language_code === "string"
            ? payload.language_code.trim().toLowerCase()
            : "";

        if (SUPPORTED_LANGUAGES.includes(languageCode)) {
            return languageCode;
        }
    }

    return "";
}

function messageContainsOpenFormAction(message) {
    if (!message || typeof message !== "object") {
        return false;
    }

    const payload = extractPayload(message);
    return payload && payload.action === CONTACT_FORM_OPEN_ACTION;
}

/**
 * @param {Event} event
 * @returns {string} `form_id` from agent payload, or "".
 */
function extractOpenFormIdFromEvent(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];

    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    for (const message of [...responseMessages, ...messengerMessages]) {
        const payload = extractPayload(message);
        if (!payload || payload.action !== CONTACT_FORM_OPEN_ACTION) {
            continue;
        }
        const id = (payload.form_id != null && String(payload.form_id).trim() ? String(payload.form_id).trim() : null)
            || (payload.formId != null && String(payload.formId).trim() ? String(payload.formId).trim() : null);
        if (id) {
            return id;
        }
    }

    return "";
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, string> | null}
 */
function shallowPrefillFromOpenFormPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
        if (!key || OPEN_FORM_PAYLOAD_META_KEYS.has(key)) {
            continue;
        }
        if (typeof value === "string") {
            const t = dfParameterScalarToString(value);
            if (t) {
                out[key] = t;
            }
        } else if (typeof value === "number" && Number.isFinite(value)) {
            const t = dfParameterScalarToString(value);
            if (t) {
                out[key] = t;
            }
        }
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Merge string/number field hints from every `open_form` payload on this turn (later messages override).
 * @param {Event} event
 * @returns {Record<string, string> | null}
 */
function extractOpenFormPrefillFromEvent(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];

    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    /** @type {Record<string, string>} */
    let merged = {};
    for (const message of [...responseMessages, ...messengerMessages]) {
        const payload = extractPayload(message);
        if (!payload || payload.action !== CONTACT_FORM_OPEN_ACTION) {
            continue;
        }
        const slice = shallowPrefillFromOpenFormPayload(payload);
        if (slice) {
            merged = Object.assign(merged, slice);
        }
    }
    return Object.keys(merged).length ? merged : null;
}

/**
 * Canonical form keys queued for after-submit opens (FIFO). Unknown ids are skipped at consume time.
 * @param {string} raw
 */
function pushCanonicalChainId_(chain, raw) {
    const s = raw != null && String(raw).trim() ? String(raw).trim() : "";
    if (!s) {
        return;
    }
    chain.push(canonicalContactFormId_(s));
}

/**
 * Read chained form ids from any `open_form` payload — supports 2+ forms in one intent.
 *
 * Accepted shapes (combined in order when present):
 * - `next_form_ids` / `nextFormIds`: array of form keys (preferred for arbitrary length).
 * - `next_form_id` / `nextFormId`: first follower.
 * - `following_form_id` / `followingFormId` / `second_form_id` / `secondFormId`: next after that.
 * - `third_form_id` / `thirdFormId` (and `fourth_form_id` / `fourthFormId` for a 4-step chain).
 *
 * @param {Event} event
 * @returns {string[]}
 */
function extractNextFormChainFromOpenFormEvent_(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];
    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];
    for (const message of [...responseMessages, ...messengerMessages]) {
        const payload = extractPayload(message);
        if (!payload || payload.action !== CONTACT_FORM_OPEN_ACTION) {
            continue;
        }
        /** @type {string[]} */
        const chain = [];
        const arr = payload.next_form_ids != null ? payload.next_form_ids : payload.nextFormIds;
        let builtFromExplicitArrayOnly = false;
        if (Array.isArray(arr)) {
            for (let i = 0; i < arr.length; i += 1) {
                pushCanonicalChainId_(chain, arr[i]);
            }
            builtFromExplicitArrayOnly = chain.length > 0;
        }

        if (!builtFromExplicitArrayOnly) {
            pushCanonicalChainId_(chain,
                payload.next_form_id != null && String(payload.next_form_id).trim()
                    ? String(payload.next_form_id).trim()
                    : payload.nextFormId != null && String(payload.nextFormId).trim()
                        ? String(payload.nextFormId).trim()
                        : "");
            pushCanonicalChainId_(chain,
                payload.following_form_id != null && String(payload.following_form_id).trim()
                    ? String(payload.following_form_id).trim()
                    : payload.followingFormId != null && String(payload.followingFormId).trim()
                        ? String(payload.followingFormId).trim()
                        : payload.second_form_id != null && String(payload.second_form_id).trim()
                            ? String(payload.second_form_id).trim()
                            : payload.secondFormId != null && String(payload.secondFormId).trim()
                                ? String(payload.secondFormId).trim()
                                : "");
            pushCanonicalChainId_(chain,
                payload.third_form_id != null && String(payload.third_form_id).trim()
                    ? String(payload.third_form_id).trim()
                    : payload.thirdFormId != null && String(payload.thirdFormId).trim()
                        ? String(payload.thirdFormId).trim()
                        : "");
            pushCanonicalChainId_(chain,
                payload.fourth_form_id != null && String(payload.fourth_form_id).trim()
                    ? String(payload.fourth_form_id).trim()
                    : payload.fourthFormId != null && String(payload.fourthFormId).trim()
                        ? String(payload.fourthFormId).trim()
                        : "");
        }

        if (chain.length) {
            /** De-dupe consecutive duplicates often caused by overlapping keys. */
            const deduped = [];
            let prev = "";
            for (let d = 0; d < chain.length; d += 1) {
                const cur = chain[d];
                if (cur && cur !== prev) {
                    deduped.push(cur);
                    prev = cur;
                }
            }
            return deduped.length ? deduped : [];
        }
    }
    return [];
}

/** @param {unknown} raw */
function stringifyOpenFormFollowupSlot_(raw) {
    return dfParameterScalarToString(raw != null ? raw : "").trim();
}

/**
 * Map payload string to Messenger `sendRequest`/`sendQuery` (CX custom events vs training phrase).
 * Prefix `event:` or `e:` forces custom event; `query:` / `q:` forces text; strings starting `CUSTOM.` / `SYS.` use event mode.
 *
 * @param {string} s
 * @returns {{ mode: string, value: string } | null}
 */
function coerceOpenFormMessengerFollowup_(s) {
    const t = typeof s === "string" ? s.trim() : "";
    if (!t) {
        return null;
    }
    if (/^event:/i.test(t)) {
        const v = t.slice("event:".length).trim();
        return v ? { mode: "event", value: v } : null;
    }
    if (/^e:/i.test(t)) {
        const v = t.slice(2).trim();
        return v ? { mode: "event", value: v } : null;
    }
    if (/^query:/i.test(t)) {
        const v = t.slice("query:".length).trim();
        return v ? { mode: "query", value: v } : null;
    }
    if (/^q:/i.test(t)) {
        const v = t.slice(2).trim();
        return v ? { mode: "query", value: v } : null;
    }
    if (/^CUSTOM\./i.test(t) || /^SYS\./i.test(t)) {
        return { mode: "event", value: t };
    }
    return { mode: "query", value: t };
}

/**
 * Optional `open_form.onSubmit` / `onCancel` (snake_case allowed) consumed by Messenger after Submit or ×.
 *
 * @param {Event} event
 * @returns {{ submit: string | null, cancel: string | null }}
 */
function extractOpenFormMessengerFollowupsFromEvent_(event) {
    const responseMessages = event && event.detail && event.detail.raw && event.detail.raw.queryResult
        && Array.isArray(event.detail.raw.queryResult.responseMessages)
        ? event.detail.raw.queryResult.responseMessages
        : [];

    const messengerMessages = event && event.detail && event.detail.data && Array.isArray(event.detail.data.messages)
        ? event.detail.data.messages
        : [];

    /** @type {string | null} */
    let submit = null;
    /** @type {string | null} */
    let cancel = null;

    for (const message of [...responseMessages, ...messengerMessages]) {
        const payload = extractPayload(message);
        if (!payload || payload.action !== CONTACT_FORM_OPEN_ACTION) {
            continue;
        }
        const pl = /** @type {Record<string, unknown>} */ (payload);
        if ("onSubmit" in pl || "on_submit" in pl) {
            const rawSubmit = Object.prototype.hasOwnProperty.call(pl, "onSubmit")
                ? pl.onSubmit
                : pl.on_submit;
            const st = stringifyOpenFormFollowupSlot_(rawSubmit);
            submit = st || null;
        }
        if ("onCancel" in pl || "on_cancel" in pl) {
            const rawCancel = Object.prototype.hasOwnProperty.call(pl, "onCancel")
                ? pl.onCancel
                : pl.on_cancel;
            const ct = stringifyOpenFormFollowupSlot_(rawCancel);
            cancel = ct || null;
        }
    }

    return { submit: submit, cancel: cancel };
}

/**
 * Clears only the follow-up that was invoked; invokes CX via Dialogflow Messenger (`sendQuery` / `sendRequest`).
 * Cancel is not cleared on submit so `onCancel` still works when the next form in a client-side chain is closed (×).
 *
 * @param {"submit" | "cancel"} kind
 */
function dispatchPendingOpenFormFollowup_(kind) {
    const raw =
        kind === "submit" ? pendingOpenFormFollowupSubmit : pendingOpenFormFollowupCancel;
    if (kind === "submit") {
        pendingOpenFormFollowupSubmit = null;
    } else {
        pendingOpenFormFollowupCancel = null;
    }
    if (!raw) {
        return;
    }
    const coerced = coerceOpenFormMessengerFollowup_(raw);
    if (!coerced || !coerced.value) {
        return;
    }
    const ms = activeDfMessenger;
    if (!ms) {
        return;
    }
    try {
        if (coerced.mode === "event") {
            if (typeof /** @type {{ sendRequest?: (t: string, p: string) => unknown }} */ (ms).sendRequest === "function") {
                /** @type {{ sendRequest: (t: string, p: string) => unknown }} */ (ms).sendRequest("event", coerced.value);
                return;
            }
        }
        if (typeof /** @type {{ sendQuery?: (q: string) => unknown }} */ (ms).sendQuery === "function") {
            /** @type {{ sendQuery: (q: string) => unknown }} */ (ms).sendQuery(coerced.value);
            return;
        }
        if (typeof /** @type {{ sendRequest?: (t: string, p: string) => unknown }} */ (ms).sendRequest === "function") {
            /** @type {{ sendRequest: (t: string, p: string) => unknown }} */ (ms).sendRequest("query", coerced.value);
        }
    } catch {
        /* ignore */
    }
}

/**
 * Pop until the head is registered in `forms`; mutates {@link pendingNextFormIdsAfterSubmit}.
 * @param {Record<string, unknown> | null} forms `common.form.forms`
 * @returns {string} canonical registered id or ""
 */
function consumeNextRegisteredFormFromPendingChain_(forms) {
    if (!forms || typeof forms !== "object" || !pendingNextFormIdsAfterSubmit.length) {
        return "";
    }
    while (pendingNextFormIdsAfterSubmit.length) {
        const head = pendingNextFormIdsAfterSubmit.shift();
        const id = head ? canonicalContactFormId_(String(head).trim()) : "";
        if (id && Object.prototype.hasOwnProperty.call(forms, id)) {
            return id;
        }
    }
    return "";
}

/**
 * @param {Record<string, string>} values
 */
function applyContactFormPrefill(values) {
    if (!values || typeof values !== "object") {
        return;
    }
    const cfg = readContactFormConfig();
    const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    for (const def of fields) {
        if (!def || !def.id || !def.name) {
            continue;
        }
        const v = values[def.name];
        const s = dfParameterScalarToString(v != null ? v : "");
        if (!s) {
            continue;
        }
        const el = document.getElementById(def.id);
        if (el && "value" in el) {
            el.value = s;
        }
    }
}

function applyFormPrefillFromSession(formId) {
    const stored = readStoredClientContext();
    const merged = getRuntimeMergedFormDefinitions_();
    const formDef = merged[formId];
    if (!formDef || !formDef.fields || !Array.isArray(formDef.fields)) {
        return;
    }
    for (const def of formDef.fields) {
        if (!def || !def.id || !def.name) {
            continue;
        }
        const v = stored[def.name];
        const s = dfParameterScalarToString(v != null ? v : "");
        if (!s) {
            continue;
        }
        const el = document.getElementById(def.id);
        if (el && "value" in el) {
            el.value = s;
        }
    }
}

function extractPayload(message) {
    if (!message || typeof message !== "object") {
        return null;
    }

    let raw = message.payload;
    if (raw == null && message.customPayload != null) {
        raw = message.customPayload;
    }
    if (typeof raw === "string") {
        const t = raw.trim();
        if (t.startsWith("{")) {
            try {
                const o = JSON.parse(t);
                if (o && typeof o === "object") {
                    const unpacked = extractPayload({ payload: o });
                    return unpacked ?? null;
                }
            } catch (e) {
                /* ignore */
            }
        }
        return null;
    }
    if (!raw || typeof raw !== "object") {
        return null;
    }

    /** @type {Record<string, unknown>} */
    const rec = /** @type {Record<string, unknown>} */ (raw);

    if (rec.fields) {
        const c = convertStructFieldsToObject(rec.fields);
        const unpacked = extractPayload({ payload: c });
        return unpacked ?? /** @type {Record<string, unknown>} */ (c);
    }

    if (rec.structValue && rec.structValue.fields) {
        const c = convertStructFieldsToObject(rec.structValue.fields);
        const unpacked = extractPayload({ payload: c });
        return unpacked ?? /** @type {Record<string, unknown>} */ (c);
    }

    if (typeof rec.action === "string") {
        return rec;
    }

    /**
     * CX often sends a single `payload` whose body is the webhook-shaped envelope
     * `{ fulfillment_response: { messages: [ { text }, { payload: { action, ... } } ] } }`
     * instead of putting `action` on the top-level payload. Peel it so `dfchat_inline_select`
     * and other actions are found.
     */
    const fr = rec.fulfillment_response;
    if (fr && typeof fr === "object") {
        const msgs = /** @type {{ messages?: unknown[] }} */ (fr).messages;
        if (Array.isArray(msgs)) {
            for (let mi = 0; mi < msgs.length; mi += 1) {
                const m = msgs[mi];
                if (!m || typeof m !== "object") {
                    continue;
                }
                const ip = /** @type {Record<string, unknown>} */ (m).payload;
                if (ip == null) {
                    continue;
                }
                const unpacked = extractPayload({ payload: ip });
                if (unpacked) {
                    return unpacked;
                }
            }
        }
    }

    return null;
}

function convertStructFieldsToObject(fields) {
    const result = {};

    for (const [key, value] of Object.entries(fields)) {
        result[key] = convertDialogflowValue(value);
    }

    return result;
}

function convertDialogflowValue(value) {
    if (!value || typeof value !== "object") {
        return value;
    }

    if (Object.prototype.hasOwnProperty.call(value, "stringValue")) {
        return value.stringValue;
    }

    if (Object.prototype.hasOwnProperty.call(value, "numberValue")) {
        return value.numberValue;
    }

    if (Object.prototype.hasOwnProperty.call(value, "boolValue")) {
        return value.boolValue;
    }

    if (value.structValue && value.structValue.fields) {
        return convertStructFieldsToObject(value.structValue.fields);
    }

    if (value.listValue && Array.isArray(value.listValue.values)) {
        return value.listValue.values.map(convertDialogflowValue);
    }

    return null;
}

function openContactForm() {
    const form = document.getElementById("dfchat-contact-form");
    const status = document.getElementById("dfchat-contact-form-status");

    if (!form) {
        return;
    }

    if (status) {
        status.textContent = "";
        status.classList.remove("is-success", "is-error");
    }

    form.classList.add("dfchat-is-open");
    form.setAttribute("aria-hidden", "false");
    contactFormOpenPending = false;
    resetChatActionBarPositionCaches();
    window.setTimeout(() => {
        syncContactFormPosition();
    }, 0);
    scheduleSyncChatActionBarPosition();

    if (pendingOpenFormPrefill) {
        applyContactFormPrefill(pendingOpenFormPrefill);
        pendingOpenFormPrefill = null;
    }
    window.setTimeout(() => {
        applyStoredContactHintsToOpenContactForm_();
        syncSuppressAppointmentContactRows_();
    }, 0);
    syncContactFormAppointmentModeClass_();
    syncAppointmentDoctorHiddenFromSession();
}

/**
 * Collapse the overlay contact/form panel. Passing `{ userDismissedForm: true }` fires `onCancel` when set on `open_form`.
 *
 * @param {{ userDismissedForm?: boolean }} [options]
 */
function closeForm(options) {
    const opts = options && typeof options === "object" ? options : {};
    contactFormOpenPending = false;
    if (contactFormOpenTimer) {
        window.clearTimeout(contactFormOpenTimer);
        contactFormOpenTimer = null;
    }

    const form = document.getElementById("dfchat-contact-form");

    if (!form) {
        return;
    }

    stripContactFormDocking();
    form.classList.remove("dfchat-is-open");
    form.setAttribute("aria-hidden", "true");
    resetChatActionBarPositionCaches();
    scheduleSyncChatActionBarPosition();

    if (opts.userDismissedForm === true) {
        dispatchPendingOpenFormFollowup_("cancel");
    }
}

function scheduleContactFormOpen() {
    if (contactFormOpenTimer) {
        window.clearTimeout(contactFormOpenTimer);
    }

    contactFormOpenTimer = window.setTimeout(() => {
        contactFormOpenTimer = null;

        if (!contactFormOpenPending) {
            return;
        }

        openContactForm();
    }, CONTACT_FORM_OPEN_DELAY_MS);
}

function submitContactForm(event) {
    event.preventDefault();

    const cfg0 = readContactFormConfig();
    const fieldDefs = cfg0.fields;
    const submitButton = document.getElementById("dfchat-contact-form-submit");
    const status = document.getElementById("dfchat-contact-form-status");

    const isOtpForm = cfg0.formKey === "otp";
    const otpStep = isOtpForm ? getOtpFormStep() : "otp";
    const isOtpUpdateMobile = isOtpForm && otpStep === "mobile";

    const payload = { client_context: getClientContext(), _contactFormId: cfg0.formKey };
    let chatSummaryPayload = /** @type {Record<string, string> | null} */ (null);
    let useMultipart = false;
    for (let fi = 0; fi < fieldDefs.length; fi += 1) {
        const fd = fieldDefs[fi];
        if (fd && String(fd.type || "").toLowerCase() === "file") {
            useMultipart = true;
            break;
        }
    }

    if (isOtpUpdateMobile) {
        const mobileDef = fieldDefs.find((d) => d && d.name === "mobile");
        const el = document.getElementById("o-mobile");
        const raw = el && "value" in el ? el.value : "";
        const v = typeof raw === "string" ? raw.trim() : "";
        const mobileField = mobileDef
            ? Object.assign({}, mobileDef, { required: true })
            : { required: true, name: "mobile", type: "tel", validateAs: "phone" };
        const check = validateContactFormField(mobileField, v);
        if (!check.valid) {
            if (status) {
                status.textContent = getTranslation(check.messageKey || "invalidPattern");
                status.classList.add("is-error");
                status.classList.remove("is-success");
            }
            if (el && typeof el.focus === "function") {
                el.focus();
            }
            return;
        }
        payload._contactFormAction = "update_mobile";
        payload.mobile = v;
    } else {
        chatSummaryPayload = {};
        const stored = readStoredClientContext();
        const storedMobile = dfParameterScalarToString(stored && stored.mobile != null ? stored.mobile : "");
        const storedName = dfParameterScalarToString(stored && stored.name != null ? stored.name : "");
        const storedEmail = dfParameterScalarToString(stored && stored.email != null ? stored.email : "");
        for (const def of fieldDefs) {
            if (!def || !def.id || !def.name) {
                continue;
            }
            if (isOtpForm && otpStep === "otp" && def.name === "mobile") {
                continue;
            }
            const apptType = String(def.type || "").toLowerCase();
            if (apptType === "appointmentdoctor" || apptType === "appointmentgeneral") {
                const hidDateId = typeof def.hiddenDateId === "string" && def.hiddenDateId.trim()
                    ? def.hiddenDateId.trim()
                    : `${def.id}__date`;
                const hidTimeId = typeof def.hiddenTimeId === "string" && def.hiddenTimeId.trim()
                    ? def.hiddenTimeId.trim()
                    : `${def.id}__time`;
                const dEl = document.getElementById(hidDateId);
                const tEl = document.getElementById(hidTimeId);
                const dv = dEl && "value" in dEl ? String(dEl.value).trim() : "";
                const tv = tEl && "value" in tEl ? String(tEl.value).trim() : "";
                if (def.required !== false) {
                    if (!dv && !tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickDateAndTime");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        return;
                    }
                    if (dv && !tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickTimeSlot");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        return;
                    }
                    if (!dv && tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickDate");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        return;
                    }
                }
                payload.appointmentdate = dv;
                payload.appointmenttime = tv;
                if (String(apptType) === "appointmentgeneral") {
                    const gsmSubmit = readConfiguredGeneralAppointmentSlotMinutes_();
                    if (gsmSubmit != null) {
                        payload.generalAppointmentSlotMinutes = String(gsmSubmit);
                    }
                }
                if (chatSummaryPayload) {
                    chatSummaryPayload.appointmentdate = dv;
                    chatSummaryPayload.appointmenttime = tv;
                }
                continue;
            }
            const el = document.getElementById(def.id);
            const fieldType = String(def.type || "text").toLowerCase();
            if (fieldType === "file") {
                const n = el && el.files ? el.files.length : 0;
                if (def.required !== false && n === 0) {
                    if (status) {
                        status.textContent = getTranslation("fieldRequired");
                        status.classList.add("is-error");
                        status.classList.remove("is-success");
                    }
                    if (el && typeof el.focus === "function") {
                        el.focus();
                    }
                    return;
                }
                for (let fi = 0; fi < n; fi += 1) {
                    if (isContactFormVideoUploadFile(el.files[fi])) {
                        if (status) {
                            status.textContent = getTranslation("invalidVideoFile");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        if (el && typeof el.focus === "function") {
                            el.focus();
                        }
                        return;
                    }
                }
                if (n > 0) {
                    const names = [];
                    for (let fi = 0; fi < n; fi += 1) {
                        names.push(el.files[fi].name);
                    }
                    chatSummaryPayload[def.name] = names.join(", ");
                } else {
                    chatSummaryPayload[def.name] = "";
                }
                continue;
            }
            let v = dfParameterScalarToString(el && "value" in el ? el.value : "");
            // If mobile is already known for this session, reuse it and don't force the user to type again.
            if (!v && def.name === "mobile" && storedMobile) {
                v = storedMobile;
                try {
                    if (el && "value" in el) {
                        el.value = v;
                    }
                } catch {
                    /* ignore */
                }
            }
            if (!v && def.name === "name" && storedName) {
                v = storedName;
                try {
                    if (el && "value" in el) {
                        el.value = v;
                    }
                } catch {
                    /* ignore */
                }
            }
            if (!v && def.name === "email" && storedEmail) {
                v = storedEmail;
                try {
                    if (el && "value" in el) {
                        el.value = v;
                    }
                } catch {
                    /* ignore */
                }
            }
            const check = validateContactFormField(def, v);
            if (!check.valid) {
                if (status) {
                    status.textContent = getTranslation(check.messageKey || "invalidPattern");
                    status.classList.add("is-error");
                    status.classList.remove("is-success");
                }
                if (el && typeof el.focus === "function") {
                    el.focus();
                }
                return;
            }
            payload[def.name] = v;
            chatSummaryPayload[def.name] = v;
        }
        if (isOtpForm && otpStep === "otp") {
            const mEl = document.getElementById("o-mobile");
            const mRaw = mEl && "value" in mEl ? mEl.value : "";
            const m = typeof mRaw === "string" ? mRaw.trim() : "";
            if (m) {
                payload.mobile = m;
                chatSummaryPayload.mobile = m;
            }
        }
        const sessionMobileForPayload =
            payload.client_context && typeof payload.client_context === "object"
                && typeof payload.client_context.mobile === "string"
                ? payload.client_context.mobile.trim()
                : "";
        const payloadMobileStr =
            payload.mobile !== undefined && payload.mobile !== null ? String(payload.mobile).trim() : "";
        if (sessionMobileForPayload && !payloadMobileStr) {
            payload.mobile = sessionMobileForPayload;
            if (chatSummaryPayload) {
                chatSummaryPayload.mobile = sessionMobileForPayload;
            }
        }
        const cx = payload.client_context && typeof payload.client_context === "object"
            ? payload.client_context
            : null;
        const sessionNameForPayload =
            cx && typeof cx.name === "string" ? cx.name.trim() : "";
        const payloadNameStr =
            payload.name !== undefined && payload.name !== null ? String(payload.name).trim() : "";
        if (sessionNameForPayload && !payloadNameStr) {
            payload.name = sessionNameForPayload;
            if (chatSummaryPayload) {
                chatSummaryPayload.name = sessionNameForPayload;
            }
        }
        const sessionEmailForPayload =
            cx && typeof cx.email === "string" ? cx.email.trim() : "";
        const payloadEmailStr =
            payload.email !== undefined && payload.email !== null ? String(payload.email).trim() : "";
        if (sessionEmailForPayload && !payloadEmailStr) {
            payload.email = sessionEmailForPayload;
            if (chatSummaryPayload) {
                chatSummaryPayload.email = sessionEmailForPayload;
            }
        }
    }

    const endpoint = getApiEndpoint(CONTACT_FORM_ENDPOINT);

    if (!endpoint) {
        if (status) {
            status.textContent = getTranslation("statusOpenViaFlask");
            status.classList.add("is-error");
            status.classList.remove("is-success");
        }
        return;
    }

    if (status) {
        status.textContent = getTranslation("statusSubmitting");
        status.classList.remove("is-success", "is-error");
    }

    if (submitButton) {
        submitButton.disabled = true;
    }

    let fetchBody;
    /** @type {Record<string, string> | undefined} */
    let fetchHeaders;
    if (!isOtpUpdateMobile && useMultipart) {
        const clientSnapshot = getClientContext();
        const fd = new FormData();
        fd.append("client_context", JSON.stringify(clientSnapshot));
        fd.append("_contactFormId", cfg0.formKey);
        /** Form `mobile` field value if any (may be empty when chatbot collected the number). */
        let formMobileValue = "";
        let formNameValue = "";
        let formEmailValue = "";
        for (const def of fieldDefs) {
            if (!def || !def.id || !def.name) {
                continue;
            }
            if (isOtpForm && otpStep === "otp" && def.name === "mobile") {
                continue;
            }
            const apptType = String(def.type || "").toLowerCase();
            if (apptType === "appointmentdoctor" || apptType === "appointmentgeneral") {
                const hidDateId = typeof def.hiddenDateId === "string" && def.hiddenDateId.trim()
                    ? def.hiddenDateId.trim()
                    : `${def.id}__date`;
                const hidTimeId = typeof def.hiddenTimeId === "string" && def.hiddenTimeId.trim()
                    ? def.hiddenTimeId.trim()
                    : `${def.id}__time`;
                const dEl = document.getElementById(hidDateId);
                const tEl = document.getElementById(hidTimeId);
                const dv = dEl && "value" in dEl ? String(dEl.value).trim() : "";
                const tv = tEl && "value" in tEl ? String(tEl.value).trim() : "";
                if (def.required !== false) {
                    if (!dv && !tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickDateAndTime");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        if (submitButton) {
                            submitButton.disabled = false;
                        }
                        return;
                    }
                    if (dv && !tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickTimeSlot");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        if (submitButton) {
                            submitButton.disabled = false;
                        }
                        return;
                    }
                    if (!dv && tv) {
                        if (status) {
                            status.textContent = getTranslation("appointmentPickDate");
                            status.classList.add("is-error");
                            status.classList.remove("is-success");
                        }
                        if (submitButton) {
                            submitButton.disabled = false;
                        }
                        return;
                    }
                }
                fd.append("appointmentdate", dv);
                fd.append("appointmenttime", tv);
                if (String(apptType) === "appointmentgeneral") {
                    const gsmFd = readConfiguredGeneralAppointmentSlotMinutes_();
                    if (gsmFd != null) {
                        fd.append("generalAppointmentSlotMinutes", String(gsmFd));
                    }
                }
                continue;
            }
            const el = document.getElementById(def.id);
            const fieldType = String(def.type || "text").toLowerCase();
            if (fieldType === "file") {
                if (el && el.files && el.files.length) {
                    for (let fi = 0; fi < el.files.length; fi += 1) {
                        const f = el.files[fi];
                        fd.append(def.name, f, f.name);
                    }
                }
            } else {
                let v = dfParameterScalarToString(el && "value" in el ? el.value : "");
                fd.append(def.name, v);
                if (def.name === "mobile") {
                    formMobileValue = v;
                }
                if (def.name === "name") {
                    formNameValue = v;
                }
                if (def.name === "email") {
                    formEmailValue = v;
                }
            }
        }
        if (isOtpForm && otpStep === "otp") {
            const mEl = document.getElementById("o-mobile");
            const m = dfParameterScalarToString(mEl && "value" in mEl ? mEl.value : "");
            if (m) {
                fd.append("mobile", m);
                formMobileValue = m;
            }
        }
        const sessionMobile =
            dfParameterScalarToString(
                clientSnapshot && clientSnapshot.mobile != null ? clientSnapshot.mobile : ""
            );
        if (sessionMobile && !formMobileValue) {
            fd.append("mobile", sessionMobile);
        }
        const snapNameTrim =
            dfParameterScalarToString(clientSnapshot && clientSnapshot.name != null ? clientSnapshot.name : "");
        const snapEmailTrim =
            dfParameterScalarToString(clientSnapshot && clientSnapshot.email != null ? clientSnapshot.email : "");
        if (snapNameTrim && !String(formNameValue || "").trim()) {
            fd.append("name", snapNameTrim);
        }
        if (
            snapEmailTrim
            && !String(formEmailValue || "").trim()
            && EMAIL_VALIDATION_RE.test(snapEmailTrim)
        ) {
            fd.append("email", snapEmailTrim);
        }
        fetchBody = fd;
        fetchHeaders = undefined;
    } else {
        payload.client_context = getClientContext();
        fetchBody = JSON.stringify(payload);
        fetchHeaders = { "Content-Type": "application/json" };
    }

    const fetchInit = { method: "POST", body: fetchBody };
    if (fetchHeaders) {
        fetchInit.headers = fetchHeaders;
    }

    /** So a slow Google API cannot leave “Submitting…” forever (button re-enables in `finally`). */
    let submitFetchTimeoutId = 0;
    if (typeof AbortController !== "undefined") {
        const submitAbort = new AbortController();
        /** @type {{ signal?: AbortSignal }} */ (fetchInit).signal = submitAbort.signal;
        submitFetchTimeoutId = window.setTimeout(() => {
            try {
                submitAbort.abort();
            } catch {
                /* ignore */
            }
        }, CONTACT_FORM_SUBMIT_FETCH_TIMEOUT_MS);
    }

    fetch(endpoint, fetchInit)
        .then(async (response) => {
            const responseText = await response.text();
            let responsePayload = {};

            try {
                responsePayload = responseText ? JSON.parse(responseText) : {};
            } catch {
                responsePayload = {};
            }

            if (!response.ok) {
                const fallbackMessage = responseText
                    ? `Unable to submit the form. HTTP ${response.status}: ${responseText.slice(0, 160)}`
                    : `Unable to submit the form. HTTP ${response.status}`;
                throw new Error(responsePayload.error || responsePayload.message || fallbackMessage);
            }

            if (isOtpUpdateMobile) {
                if (status) {
                    status.textContent = responsePayload.message || getTranslation("statusMobileNumberSaved");
                    status.classList.add("is-success");
                    status.classList.remove("is-error");
                }
                if (payload && typeof payload.mobile === "string" && payload.mobile.trim()) {
                    mergeVisitorMobileIntoStoredContext(payload.mobile, { syncSheet: false, force: true });
                }
                setOtpFormStep("otp");
                const oOtpEl = document.getElementById("o-otp");
                if (oOtpEl) {
                    oOtpEl.value = "";
                }
                return;
            }

            if (status) {
                let line = responsePayload.message || getTranslation("statusSubmitted");
                const si =
                    responsePayload.sheet_integration && typeof responsePayload.sheet_integration === "object"
                        ? responsePayload.sheet_integration
                        : null;
                const sh =
                    responsePayload.sheet && typeof responsePayload.sheet === "object"
                        ? responsePayload.sheet
                        : null;
                if (si && si.enabled === false) {
                    const r = typeof si.reason === "string" ? si.reason.trim() : "";
                    const h = typeof si.hint === "string" ? si.hint.trim() : "";
                    line = `${line} • Sheets: OFF — ${r}${h ? ` ${h}` : ""}`.trim();
                    status.textContent = line;
                    status.classList.remove("is-success");
                    status.classList.add("is-error");
                } else {
                    if (
                        sh
                        && sh.action === "duplicate_noop"
                        && sh.patched === false
                    ) {
                        const tabHint =
                            typeof sh.tab === "string" && sh.tab.trim()
                                ? ` (${sh.tab})`
                                : "";
                        line += ` Sheet: no cell changes (duplicate session row)${tabHint}. Check column F matches this visit or verify Railway SHEETS_RANGE / spreadsheet tab.`;
                    }
                    status.textContent = line;
                    status.classList.add("is-success");
                    status.classList.remove("is-error");
                }
            }

            const summaryForChat = chatSummaryPayload != null ? chatSummaryPayload : payload;
            let mobileToRemember = "";
            if (summaryForChat && typeof summaryForChat.mobile === "string") {
                mobileToRemember = summaryForChat.mobile.trim();
            } else if (payload && typeof payload.mobile === "string") {
                mobileToRemember = payload.mobile.trim();
            }
            if (mobileToRemember) {
                mergeVisitorMobileIntoStoredContext(mobileToRemember, { syncSheet: false, force: true });
            }
            const updatedContext = { ...readStoredClientContext() };
            for (const key in payload) {
                if (typeof payload[key] === 'string' && payload[key].trim()) {
                    updatedContext[key] = payload[key];
                }
            }
            persistClientContext(updatedContext);
            syncDfMessengerSessionParametersFromClientContext(activeDfMessenger);
            renderContactFormSubmissionResponse(summaryForChat);

            for (const def of fieldDefs) {
                if (!def || !def.id) {
                    continue;
                }
                const apptReset = String(def.type || "").toLowerCase();
                if (apptReset === "appointmentdoctor" || apptReset === "appointmentgeneral") {
                    const hidDateId = typeof def.hiddenDateId === "string" && def.hiddenDateId.trim()
                        ? def.hiddenDateId.trim()
                        : `${def.id}__date`;
                    const hidTimeId = typeof def.hiddenTimeId === "string" && def.hiddenTimeId.trim()
                        ? def.hiddenTimeId.trim()
                        : `${def.id}__time`;
                    const dEl = document.getElementById(hidDateId);
                    const tEl = document.getElementById(hidTimeId);
                    if (dEl && "value" in dEl) {
                        dEl.value = "";
                    }
                    if (tEl && "value" in tEl) {
                        tEl.value = "";
                    }
                    continue;
                }
                const el = document.getElementById(def.id);
                if (el && "value" in el) {
                    el.value = "";
                }
            }

            closeForm();
            dispatchPendingOpenFormFollowup_("submit");
            // Optional chaining: open the next queued form after each successful submit (FIFO).
            try {
                const forms = getRuntimeMergedFormDefinitions_();
                let resolvedNext = consumeNextRegisteredFormFromPendingChain_(forms);
                if (!resolvedNext && cfg0 && typeof cfg0.nextFormId === "string" && cfg0.nextFormId.trim()) {
                    const cand = canonicalContactFormId_(cfg0.nextFormId.trim());
                    if (forms[cand]) {
                        resolvedNext = cand;
                    }
                }
                if (resolvedNext && forms[resolvedNext]) {
                    window.setTimeout(() => {
                        setActiveContactFormId(resolvedNext);
                        openContactForm();
                    }, 250);
                }
            } catch {
                /* ignore */
            }
        })
        .catch((error) => {
            if (status) {
                let line = error.message || getTranslation("statusSubmissionFailed");
                if (error && error.name === "AbortError") {
                    line =
                        "Request timed out (90s) — the server or Google APIs are very slow. Try again. "
                        + "On Railway you can set CONTACT_FORM_DEFER_FIRESTORE_AFTER_RESPONSE=1 to return faster after Sheets.";
                }
                status.textContent = line;
                status.classList.add("is-error");
                status.classList.remove("is-success");
            }
        })
        .finally(() => {
            if (submitFetchTimeoutId) {
                window.clearTimeout(submitFetchTimeoutId);
            }
            if (submitButton) {
                submitButton.disabled = false;
            }
        });
}

function renderContactFormSubmissionResponse(payload) {
    if (!activeDfMessenger || typeof activeDfMessenger.renderCustomText !== "function") {
        return;
    }

    const cfg = readContactFormConfig();
    const lines = [];
    for (const key of cfg.chatSummaryFieldNames) {
        const v = payload && key in payload ? String(payload[key] || "").trim() : "";
        const field = getContactFormFieldByPayloadName(key);
        const labelKey = field && field.i18nSummaryLabel;
        let label;
        if (labelKey) {
            label = getTranslation(labelKey);
        } else if (key === "appointmenttime") {
            label = getTranslation("summaryTimeLabel");
        } else if (key === "appointmentdate") {
            label = getTranslation("summaryDateLabel");
        } else if (key === "doctorId") {
            label = getTranslation("summaryDoctorIdLabel");
        } else {
            label = String(key);
        }
        lines.push(`${label} - ${v || "-"}`);
    }
    lines.push(getTranslation("contactResponseThanks"));
    const responseText = lines.join("  \n");

    renderBotPersona(activeDfMessenger, Date.now());
    activeDfMessenger.renderCustomText(responseText, true);
}

/**
 * `data-i18n` and similar apply only under chat/contact UI, not the host page, so the site language
 * stays independent of the chatbot / Dialogflow `language-code`.
 */
function isNodeInsideChatLanguageUiScope(node) {
    if (!node || !node.closest) {
        return false;
    }
    return !!node.closest(
        "df-messenger, df-messenger-chat-bubble, #dfchat-contact-form, #dfchat-chat-action-bar, "
        + "#dfchat-chat-footer-overlay, #dfchat-powered-by-strip, #dfchat-chat-launcher-input-strip, "
        + ".dfchat-chat-launcher-strip, .dfchat-contact-form, #dfchat-debug-badge, #dfchat-hard-language-wrap"
    );
}

/**
 * `document.querySelectorAll` does not match nodes inside shadow roots. `#dfchat-chat-action-bar` is
 * often mounted under `df-messenger` (see `mountChatActionBarInline`); merge those elements with
 * light-DOM matches so `applyLanguage` updates labels (e.g. Restart) in every layout.
 * @param {string} selector
 * @returns {Element[]}
 */
function queryChatLanguageScopedI18nElements(selector) {
    /** @type {Element[]} */
    const out = [];
    const seen = new Set();
    try {
        for (const node of document.querySelectorAll(selector)) {
            if (node && !seen.has(node)) {
                seen.add(node);
                out.push(/** @type {Element} */ (node));
            }
        }
    } catch {
        /* no-op */
    }
    const actionBar = getChatActionBar();
    if (actionBar && typeof actionBar.querySelectorAll === "function") {
        try {
            for (const node of actionBar.querySelectorAll(selector)) {
                if (node && !seen.has(node)) {
                    seen.add(node);
                    out.push(/** @type {Element} */ (node));
                }
            }
        } catch {
            /* no-op */
        }
    }
    return out;
}

function applyLanguage(languageCode) {
    const nextLanguage = normalizeLanguage(languageCode);
    activeLanguage = nextLanguage;
    persistLanguage(nextLanguage);

    for (const node of queryChatLanguageScopedI18nElements("[data-i18n]")) {
        if (!isNodeInsideChatLanguageUiScope(node)) {
            continue;
        }
        if (node.id === "dfchat-active-lang-label" || node.hasAttribute("data-dfchat-active-lang-label")) {
            continue;
        }
        const key = node.getAttribute("data-i18n") || "";
        node.textContent = getTranslation(key);
    }

    for (const node of queryChatLanguageScopedI18nElements("[data-i18n-placeholder]")) {
        if (!isNodeInsideChatLanguageUiScope(node)) {
            continue;
        }
        const key = node.getAttribute("data-i18n-placeholder") || "";
        node.setAttribute("placeholder", getTranslation(key));
    }
    refreshContactFormPlaceholdersFromConfig();

    for (const node of queryChatLanguageScopedI18nElements("[data-i18n-title]")) {
        if (!isNodeInsideChatLanguageUiScope(node)) {
            continue;
        }
        const key = node.getAttribute("data-i18n-title") || "";
        node.setAttribute("title", getTranslation(key));
    }

    for (const node of queryChatLanguageScopedI18nElements("[data-i18n-aria-label]")) {
        if (!isNodeInsideChatLanguageUiScope(node)) {
            continue;
        }
        const key = node.getAttribute("data-i18n-aria-label") || "";
        const t = getTranslation(key);
        node.setAttribute("aria-label", t);
        if (node && node.tagName === "BUTTON") {
            node.title = t;
        }
    }

    syncChatLanguageDropdownValue(nextLanguage);

    const actionBar = getChatActionBar();
    if (actionBar) {
        refreshChatActionBarLanguageState(actionBar);
    }

    if (activeDfMessenger && IS_FORCE_TITLEBAR_CLOSE_X_ENABLED) {
        const ms = activeDfMessenger;
        ms.setAttribute("language-code", getChatLanguageCode(nextLanguage));
        applyBotWritingTextToChatBubble(ms);
        scheduleChatInputPlaceholderRefresh(ms);
        ensureCloseIconIsX(ms);
        // Dialogflow may re-render the titlebar (arrow/SVG) asynchronously after `language-code` changes.
        [100, 280, 650, 1200].forEach((delay) => {
            window.setTimeout(() => {
                if (activeDfMessenger === ms) {
                    ensureCloseIconIsX(ms);
                }
            }, delay);
        });
    } else if (activeDfMessenger) {
        activeDfMessenger.setAttribute("language-code", getChatLanguageCode(nextLanguage));
        applyBotWritingTextToChatBubble(activeDfMessenger);
        scheduleChatInputPlaceholderRefresh(activeDfMessenger);
    }

    applyContactFormHeaderFromConfig();
    syncLauncherInputStripI18n();
    refreshInlineSyntheticOptionButtonLabels();
    scheduleDomTranslationRefresh();
    // `applyDomTranslation` can run after this and touch `placeholder`; snap composer back to config.
    [450, 1100, 2200].forEach((delay) => {
        window.setTimeout(() => {
            if (activeDfMessenger) {
                applyChatInputPlaceholderToChatBubble(activeDfMessenger);
            }
        }, delay);
    });
    // Re-apply the language name on the pill after `data-i18n` / other async work.
    [0, 10, 80].forEach((d) => {
        window.setTimeout(() => {
            const ab2 = getChatActionBar();
            if (ab2) {
                refreshChatActionBarLanguageState(ab2);
            }
        }, d);
    });
}

function readInlineOptionLabelByLanguageMap() {
    try {
        const feats = COMMON_CONFIG && typeof COMMON_CONFIG.features === "object" ? COMMON_CONFIG.features : null;
        const ig = feats && typeof feats.inlineGallery === "object" ? feats.inlineGallery : null;
        const map = ig && typeof ig.optionLabelByLanguage === "object" ? ig.optionLabelByLanguage : null;
        return map && typeof map === "object" ? map : null;
    } catch {
        return null;
    }
}

function resolveInlineOptionLabel(label, value, lang) {
    const fallback = typeof label === "string" && label.trim() ? label.trim() : (typeof value === "string" ? value.trim() : "");
    const key = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!key) {
        return fallback;
    }
    const map = readInlineOptionLabelByLanguageMap();
    if (!map) {
        return fallback;
    }
    const row = map[key];
    if (!row || typeof row !== "object") {
        return fallback;
    }
    const t = pickContactFormLocalizedLine(row, lang);
    return t != null ? t : fallback;
}

function refreshInlineSyntheticOptionButtonLabels() {
    const map = readInlineOptionLabelByLanguageMap();
    if (!map) {
        return;
    }
    const nodes = document.querySelectorAll(
        `.${DFCHAT_INLINE_GALLERY_CLASS} button[data-dfchat-opt-key], .${DFCHAT_INLINE_VIDEO_CLASS} button[data-dfchat-opt-key], .${DFCHAT_INLINE_CARD_CAROUSEL_CLASS} button[data-dfchat-opt-key]`
    );
    for (const node of nodes) {
        if (!node || typeof node.getAttribute !== "function") {
            continue;
        }
        const key = (node.getAttribute("data-dfchat-opt-key") || "").trim().toLowerCase();
        if (!key) {
            continue;
        }
        const row = map[key];
        if (!row || typeof row !== "object") {
            continue;
        }
        const next = pickContactFormLocalizedLine(row, activeLanguage);
        if (next != null) {
            node.textContent = next;
        }
    }
}

function initializeChatLanguageDropdown(dfMessenger) {
    const ensureMounted = () => {
        debugMountAttemptSeq += 1;
        mountChatLanguageDropdown(dfMessenger);
    };

    ensureMounted();

    window.addEventListener("df-chat-open-changed", () => {
        window.setTimeout(ensureMounted, 120);
    });

    window.setInterval(ensureMounted, 1200);
}

function mountChatLanguageDropdown(dfMessenger) {
    if (!isMultiLanguageEnabled()) {
        return;
    }
    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `mountChatLanguageDropdown called: true`,
        `chatOpen: ${!!isChatWindowOpen}`
    ]);
    if (!dfMessenger) {
        return;
    }

    const footerHost = resolveFooterMountHost(dfMessenger);
    if (!footerHost) {
        updateCompanyDebugBadge([
            `company.js build: ${COMPANY_JS_BUILD_TAG}`,
            `language mounted: false`,
            `reason: footerHost not found`,
            `chatOpen: ${!!isChatWindowOpen}`
        ]);
        return;
    }
    const mountHost = resolveFooterInlineControlsHost(dfMessenger) || footerHost;

    if (mountHost.querySelector(`#${CHAT_LANGUAGE_DROPDOWN_ID}`)) {
        syncChatLanguageDropdownValue(activeLanguage);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-dfchat-chat-language", "true");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "6px";
    wrapper.style.marginRight = "0";
    wrapper.style.marginLeft = "0";
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.bottom = "0";

    const label = document.createElement("label");
    label.setAttribute("for", CHAT_LANGUAGE_DROPDOWN_ID);
    label.textContent = getActiveChatLanguageDisplayLabel();
    label.style.fontSize = "11px";
    label.style.fontWeight = "700";
    label.style.color = "#0369a1";
    label.style.whiteSpace = "nowrap";

    const select = document.createElement("select");
    select.id = CHAT_LANGUAGE_DROPDOWN_ID;
    select.setAttribute(
        "aria-label",
        `${getTranslation("languageLabel")}: ${getActiveChatLanguageDisplayLabel()}`
    );
    select.style.border = "1px solid #cfe0e8";
    select.style.borderRadius = "10px";
    select.style.background = "#ffffff";
    select.style.color = "#0f172a";
    select.style.font = "700 12px Manrope, Segoe UI, sans-serif";
    select.style.padding = "5px 8px";
    select.style.outline = "none";
    select.style.cursor = "pointer";

    for (const optionData of CHAT_LANGUAGE_OPTIONS) {
        const option = document.createElement("option");
        option.value = optionData.code;
        option.textContent = getLanguageOptionDisplayLabel(optionData);
        select.appendChild(option);
    }

    select.value = activeLanguage;
    select.addEventListener("change", (event) => {
        const selectedValue = event.target && event.target.value ? event.target.value : DEFAULT_LANGUAGE;
        applyLanguage(selectedValue);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);

    const insertionPoint = findFooterInlineInsertionPoint(dfMessenger);
    const inlineInserted = insertionPoint && insertionPoint.parent && typeof insertionPoint.parent.insertBefore === "function";
    if (inlineInserted) {
        insertionPoint.parent.insertBefore(wrapper, insertionPoint.parent.firstChild);
    } else {
        // Fallback: keep it visible even if footer layout is column-based.
        wrapper.style.display = "flex";
        wrapper.style.marginRight = "auto";
        wrapper.style.marginTop = "6px";
        wrapper.style.justifyContent = "flex-start";
        wrapper.style.width = "auto";
        mountHost.insertBefore(wrapper, mountHost.firstChild);
    }

    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `language mounted: true`,
        `inlineInserted: ${!!inlineInserted}`,
        `footerHost found: ${!!footerHost}`,
        `mountHost tag: ${mountHost && mountHost.tagName ? mountHost.tagName.toLowerCase() : "?"}`,
        `activeLanguage: ${activeLanguage}`
    ]);
}

function initializeChatRestartButton(dfMessenger, commonConfig) {
    const features = commonConfig && commonConfig.features && typeof commonConfig.features === "object"
        ? commonConfig.features
        : {};
    const restartConfig = features.restartChat && typeof features.restartChat === "object"
        ? features.restartChat
        : null;

    if (!restartConfig || !isFeatureEnabledFromConfig(restartConfig, true)) {
        return;
    }

    const ensureMounted = () => {
        debugMountAttemptSeq += 1;
        mountRestartButton(dfMessenger, restartConfig);
    };

    ensureMounted();

    window.addEventListener("df-chat-open-changed", () => {
        window.setTimeout(ensureMounted, 120);
    });

    window.setInterval(ensureMounted, 1500);
}

function mountRestartButton(dfMessenger, restartConfig) {
    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `mountRestartButton called: true`,
        `chatOpen: ${!!isChatWindowOpen}`
    ]);
    if (!dfMessenger) {
        return;
    }

    const host = resolveFooterInlineControlsHost(dfMessenger) || resolveFooterMountHost(dfMessenger);
    if (!host) {
        updateCompanyDebugBadge([
            `company.js build: ${COMPANY_JS_BUILD_TAG}`,
            `restart mounted: false`,
            `reason: footerHost not found`,
            `chatOpen: ${!!isChatWindowOpen}`
        ]);
        return;
    }

    if (host.querySelector("[data-dfchat-chat-restart='true']")) {
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-dfchat-chat-restart", "true");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.marginRight = "0";
    wrapper.style.marginLeft = "56px";
    wrapper.style.position = "absolute";
    wrapper.style.left = "0";
    wrapper.style.bottom = "0";

    const labelText = typeof restartConfig.label === "string" && restartConfig.label.trim()
        ? restartConfig.label.trim()
        : "Restart";

    const button = document.createElement("button");
    button.type = "button";
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.gap = "6px";
    button.style.border = "1px solid #cfe0e8";
    button.style.borderRadius = "10px";
    button.style.background = "#ffffff";
    button.style.color = "#0f172a";
    button.style.font = "700 12px Manrope, Segoe UI, sans-serif";
    button.style.padding = "6px 10px";
    button.style.cursor = "pointer";

    const iconWrap = document.createElement("span");
    iconWrap.style.display = "inline-flex";
    iconWrap.style.color = "#0369a1";
    iconWrap.innerHTML = getRestartIconHtml(18);
    const labelEl = document.createElement("span");
    labelEl.textContent = labelText;
    button.appendChild(iconWrap);
    button.appendChild(labelEl);

    button.addEventListener("click", () => {
        restartChatSession();
    });

    wrapper.appendChild(button);

    const insertionPoint = findFooterInlineInsertionPoint(dfMessenger);
    const inlineInserted = insertionPoint && insertionPoint.parent && typeof insertionPoint.parent.insertBefore === "function";
    if (inlineInserted) {
        insertionPoint.parent.insertBefore(wrapper, insertionPoint.parent.firstChild);
    } else {
        wrapper.style.display = "flex";
        wrapper.style.marginRight = "auto";
        wrapper.style.marginTop = "6px";
        wrapper.style.justifyContent = "flex-start";
        wrapper.style.width = "auto";
        host.insertBefore(wrapper, host.firstChild);
    }

    updateCompanyDebugBadge([
        `company.js build: ${COMPANY_JS_BUILD_TAG}`,
        `restart mounted: true`,
        `inlineInserted: ${!!inlineInserted}`,
        `footerHost found: ${!!resolveFooterMountHost(dfMessenger)}`
    ]);
}

function resolveFooterMountHost(dfMessenger) {
    const detectedFooter = findChatFooterHost(dfMessenger);
    if (!detectedFooter) {
        return null;
    }

    // Dialogflow's composer/footer can momentarily report 0x0 during open/animate
    // or when measured across shadow roots. Prefer mounting anyway once detected.
    if (isUsableFooterHost(detectedFooter) || isChatWindowOpen) {
        return detectedFooter;
    }

    return detectedFooter;
}

function resolveFooterInlineControlsHost(dfMessenger) {
    const footerHost = resolveFooterMountHost(dfMessenger);
    if (!footerHost || !footerHost.querySelector) {
        return null;
    }

    // Try to find the row that contains the Send button so we can mount inline.
    const sendButton = findSendButton(footerHost);
    if (sendButton && sendButton.parentElement && sendButton.parentElement.querySelector) {
        return sendButton.parentElement;
    }

    return null;
}

function isNodeInsidePageContactForm(node) {
    return node && node.closest && node.closest("#dfchat-contact-form");
}

function findSendButton(scope) {
    if (!scope || !scope.querySelectorAll) {
        return null;
    }

    const raw = Array.from(scope.querySelectorAll("button, [role='button'], df-icon-button"));
    const candidates = raw.filter((button) => !isNodeInsidePageContactForm(button));

    const labeledSend = candidates.find((button) => {
        const aria = (button.getAttribute && (button.getAttribute("aria-label") || "").toLowerCase()) || "";
        const testId = (button.getAttribute && (button.getAttribute("data-testid") || "").toLowerCase()) || "";
        const title = (button.getAttribute && (button.getAttribute("title") || "").toLowerCase()) || "";
        const id = (button.id || "").toLowerCase();
        const className = (typeof button.className === "string" ? button.className : "").toLowerCase();
        return /send/.test(aria)
            || /send/.test(testId)
            || /send/.test(title)
            || /send/.test(id)
            || /send/.test(className);
    });
    if (labeledSend) {
        return labeledSend;
    }

    // Fallback: in most composers, the send button is the submit button.
    const submitButtons = candidates.filter((button) => {
        const type = button.getAttribute ? (button.getAttribute("type") || "").toLowerCase() : "";
        return type === "submit";
    });
    if (submitButtons.length) {
        return submitButtons[submitButtons.length - 1];
    }

    return null;
}

function findFooterInlineInsertionPoint(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);

    for (const root of roots) {
        if (!root || !root.querySelector) {
            continue;
        }

        // First, try the nearest footer host in this root.
        // `document` + `form` would otherwise match the page #dfchat-contact-form-fields before the chat widget.
        const footerLike = root.querySelector(
            "footer, form:not(#dfchat-contact-form-fields), [data-testid*='footer'], [data-testid*='composer'], [part*='footer'], [part*='composer'], [class*='composer'], [class*='footer']"
        );
        if (footerLike && isNodeInsidePageContactForm(footerLike)) {
            continue;
        }
        const sendInFooter = footerLike ? findSendButton(footerLike) : null;
        if (sendInFooter && sendInFooter.parentElement) {
            return { parent: sendInFooter.parentElement, beforeNode: sendInFooter };
        }

        // Then, any send button at all in this root.
        const sendButton = findSendButton(root);
        if (sendButton && sendButton.parentElement) {
            return { parent: sendButton.parentElement, beforeNode: sendButton };
        }
    }

    return null;
}

/**
 * Place Language/Restart **under** the typing row, not in the same flex row as Send.
 * Tries Dialogflow’s `.input-box-wrapper` first; else the full composer row (Send’s parent) after the row.
 * @param {Element} dfMessenger
 * @returns {{ parent: Element, afterEl: Element } | null}
 */
function findFooterBelowInputMountPoint(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelector) {
            continue;
        }
        const wrap = root.querySelector(".input-box-wrapper");
        if (wrap && wrap.parentElement && !isNodeInsidePageContactForm(wrap)) {
            if (typeof wrap.getBoundingClientRect === "function") {
                const r = wrap.getBoundingClientRect();
                if (r && r.width > 0) {
                    return { parent: wrap.parentElement, afterEl: wrap };
                }
            }
        }
    }
    const ip = findFooterInlineInsertionPoint(dfMessenger);
    if (ip && ip.parent && ip.parent.parentElement && !isNodeInsidePageContactForm(ip.parent)) {
        const row = ip.parent;
        const p = row.parentElement;
        if (p && typeof row.getBoundingClientRect === "function") {
            const r = row.getBoundingClientRect();
            if (r && r.width > 0) {
                return { parent: p, afterEl: row };
            }
        }
    }
    return null;
}

function isUsableFooterHost(host) {
    if (!host || host.nodeType !== Node.ELEMENT_NODE || !host.isConnected) {
        return false;
    }

    // When the chat is open, allow mounting even if bounding box is small/0
    // due to shadow DOM composition/animations.
    if (!isChatWindowOpen) {
        if (typeof host.getBoundingClientRect !== "function") {
            return false;
        }

        const rect = host.getBoundingClientRect();
        if (!rect || rect.width < 40 || rect.height < 20) {
            return false;
        }
    }

    const style = window.getComputedStyle(host);
    if (!style) {
        return false;
    }

    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
    }

    return true;
}

function restartChatSession() {
    try {
        clearOpenGalleryUrlDedupeState();
    } catch {
        /* ignore */
    }
    skipCxMobileOverwriteUntilMs_ = 0;
    try {
        stopComposerSpeechRecognition();
    } catch {
        /* ignore */
    }
    closeForm();
    const wasOpen = !!isChatWindowOpen || (activeDfMessenger && isChatExpanded(activeDfMessenger));
    const previousMessenger = activeDfMessenger;
    if (previousMessenger && previousMessenger.parentElement) {
        previousMessenger.parentElement.removeChild(previousMessenger);
    }

    hasAutoStartedConversation = false;
    isMessengerLoaded = false;
    shouldAutoOpenChat = false;
    isChatWindowOpen = false;
    activeDfMessenger = null;
    activeBubbleNode = null;

    const result = createAndMountMessenger();
    const m = result && result.messenger;

    if (wasOpen) {
        window.setTimeout(() => {
            openChatWindow(m, result && result.bubble);
            window.setTimeout(() => {
                if (!m || activeDfMessenger !== m) {
                    return;
                }
                hasAutoStartedConversation = false;
                scheduleAutoStartConversation(m);
            }, 400);
            window.setTimeout(() => {
                if (!m || activeDfMessenger !== m || hasAutoStartedConversation) {
                    return;
                }
                scheduleAutoStartConversation(m);
            }, 1400);
        }, 200);
    }
}

function findChatFooterHost(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);
    const inputSelector = "textarea, input[type='text'], [contenteditable='true']";

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        const inputs = root.querySelectorAll(inputSelector);
        for (const inputNode of inputs) {
            if (!inputNode || typeof inputNode.closest !== "function") {
                continue;
            }

            const host = inputNode.closest(
                "form, footer, [data-testid*='footer'], [data-testid*='composer'], [data-testid*='input'], [part*='footer'], [part*='input'], [class*='input'], [class*='composer']"
            );

            if (host) {
                return host;
            }

            if (inputNode.parentElement) {
                return inputNode.parentElement;
            }
        }

        const directFooterSelectors = [
            "footer",
            "[data-testid*='footer']",
            "[data-testid*='composer']",
            "[data-testid*='input']",
            "[part*='footer']",
            "[part*='composer']",
            "[part*='input']",
            "[class*='footer']",
            "[class*='composer']",
            "[class*='input']"
        ];
        for (const selector of directFooterSelectors) {
            const directHost = root.querySelector(selector);
            if (directHost) {
                return directHost;
            }
        }

        // Dialogflow CX messenger variants: look for known elements in the composer.
        const dfComposerCandidates = [
            "df-messenger-user-input",
            "df-messenger-message-input",
            "df-messenger-input",
            "df-icon-button",
            "df-messenger-send-button",
            "button[aria-label*='Send']",
            "button[aria-label*='send']"
        ];
        for (const selector of dfComposerCandidates) {
            const node = root.querySelector(selector);
            if (!node) {
                continue;
            }
            if (typeof node.closest === "function") {
                const host = node.closest("form, footer, [part*='footer'], [part*='composer'], [data-testid*='composer'], [data-testid*='footer']");
                if (host) {
                    return host;
                }
            }
            if (node.parentElement) {
                return node.parentElement;
            }
            return node;
        }
    }

    return null;
}

function findChatWindowRect(dfMessenger) {
    if (!dfMessenger) {
        return null;
    }

    const roots = collectSearchRoots(dfMessenger);
    // Prefer the real chat shell so we do not pick a large inner scroller as the "window" rect.
    for (const root of roots) {
        if (!root || typeof root.querySelector !== "function") {
            continue;
        }
        const win0 = root.querySelector("df-messenger-chat-window");
        if (win0 && typeof win0.getBoundingClientRect === "function") {
            const r0 = win0.getBoundingClientRect();
            const s0 = window.getComputedStyle(win0);
            if (r0 && r0.width >= 100 && r0.height >= 100 && s0
                && s0.display !== "none" && s0.visibility !== "hidden" && s0.opacity !== "0") {
                return r0;
            }
        }
    }

    const selectors = [
        "df-messenger-chat-window",
        "df-messenger-chat",
        "[part*='chat']",
        "[part*='window']",
        "[part*='panel']",
        "[class*='chat']",
        "[class*='window']",
        "[class*='panel']",
        "[data-testid*='chat']",
        "[data-testid*='panel']"
    ];

    let bestRect = null;
    let bestArea = 0;

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        for (const selector of selectors) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
                if (!node || typeof node.getBoundingClientRect !== "function") {
                    continue;
                }
                const rect = node.getBoundingClientRect();
                if (!rect || rect.width < 100 || rect.height < 100) {
                    continue;
                }
                const style = window.getComputedStyle(node);
                if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                    continue;
                }
                const area = rect.width * rect.height;
                if (area > bestArea) {
                    bestArea = area;
                    bestRect = rect;
                }
            }
        }
    }

    return bestRect;
}

function syncChatLanguageDropdownValue(languageCode) {
    const dropdowns = document.querySelectorAll(`#${CHAT_LANGUAGE_DROPDOWN_ID}`);
    const hint = getTranslation("languageLabel");
    const display = getActiveChatLanguageDisplayLabel(languageCode);
    const aria = `${hint}: ${display}`;

    for (const dropdown of dropdowns) {
        dropdown.value = normalizeLanguage(languageCode);
        dropdown.setAttribute("aria-label", aria);

        const label = dropdown.previousElementSibling;
        if (label && label.tagName === "LABEL") {
            label.textContent = display;
        }
    }

    if (activeDfMessenger && activeDfMessenger.shadowRoot) {
        const shadowDropdown = activeDfMessenger.shadowRoot.querySelector(`#${CHAT_LANGUAGE_DROPDOWN_ID}`);
        if (shadowDropdown) {
            shadowDropdown.value = normalizeLanguage(languageCode);
            shadowDropdown.setAttribute("aria-label", aria);

            const label = shadowDropdown.previousElementSibling;
            if (label && label.tagName === "LABEL") {
                label.textContent = display;
            }
        }
    }
}

/**
 * `UI_TRANSLATIONS` only ships `en` / `hi` / `mr`. `enabledLanguages` may use BCP-47 tags (`mr-IN`, `hi-IN`)
 * so that Dialogflow and labels match; map those to the same table as `mr` / `hi`.
 * @param {string} [languageCode] If omitted, uses `activeLanguage`.
 * @returns {string}
 */
function resolveUiDictionaryKey(languageCode) {
    const raw = languageCode !== undefined && languageCode !== null
        ? String(languageCode).trim().toLowerCase()
        : String(activeLanguage || "").trim().toLowerCase();
    if (!raw) {
        return DEFAULT_LANGUAGE;
    }
    if (UI_TRANSLATIONS[raw]) {
        return raw;
    }
    const base = raw.split(/[-_]/)[0] || raw;
    if (UI_TRANSLATIONS[base]) {
        return base;
    }
    return DEFAULT_LANGUAGE;
}

function getTranslation(key) {
    const dictKey = resolveUiDictionaryKey(activeLanguage);
    const translationTable = UI_TRANSLATIONS[dictKey] || UI_TRANSLATIONS[DEFAULT_LANGUAGE];
    return translationTable[key] || UI_TRANSLATIONS[DEFAULT_LANGUAGE][key] || key;
}

function scheduleDomTranslationRefresh() {
    if (!isMultiLanguageEnabled()) {
        return;
    }

    if (translationRefreshTimer) {
        window.clearTimeout(translationRefreshTimer);
    }

    translationRefreshTimer = window.setTimeout(() => {
        translationRefreshTimer = null;
        applyDomTranslation(activeLanguage);
    }, DOM_TRANSLATION_DEBOUNCE_MS);
}

async function applyDomTranslation(languageCode) {
    if (!isMultiLanguageEnabled()) {
        return;
    }

    const normalizedLanguage = normalizeLanguage(languageCode);
    const runId = latestTranslationRunId + 1;
    latestTranslationRunId = runId;

    if (normalizedLanguage === DEFAULT_LANGUAGE) {
        restoreOriginalDomContent();
        const actionBarRest = getChatActionBar();
        if (actionBarRest) {
            refreshChatActionBarLanguageState(actionBarRest);
        }
        return;
    }

    const targets = collectTranslationTargets();
    if (!targets.length) {
        return;
    }

    const uniqueTexts = [...new Set(targets.map((target) => target.text))];
    const translatedLookup = new Map();

        await Promise.all(uniqueTexts.map(async (sourceText) => {
        const translatedText = await translateTextUsingGoogle(sourceText, normalizedLanguage);
        translatedLookup.set(sourceText, translatedText || sourceText);
    }));

    if (runId !== latestTranslationRunId) {
        return;
    }

    for (const target of targets) {
        const translatedText = translatedLookup.get(target.text) || target.text;

        if (target.type === "text") {
            target.node.nodeValue = translatedText;
            continue;
        }

        if (target.type === "attr") {
            target.element.setAttribute(target.attribute, translatedText);
        }
    }

    const actionBarAfter = getChatActionBar();
    if (actionBarAfter) {
        refreshChatActionBarLanguageState(actionBarAfter);
    }
}

function collectTranslationTargets() {
    const targets = [];
    const roots = getTranslationRoots();

    for (const root of roots) {
        if (!root) {
            continue;
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let currentTextNode = walker.nextNode();

        while (currentTextNode) {
            const parentElement = currentTextNode.parentElement;

            if (isTranslatableTextNode(currentTextNode, parentElement)) {
                if (!originalTextNodeContent.has(currentTextNode)) {
                    originalTextNodeContent.set(currentTextNode, currentTextNode.nodeValue || "");
                }

                const sourceText = (originalTextNodeContent.get(currentTextNode) || "").trim();
                if (sourceText) {
                    targets.push({
                        type: "text",
                        node: currentTextNode,
                        text: sourceText
                    });
                }
            }

            currentTextNode = walker.nextNode();
        }

        if (root.querySelectorAll) {
            const attributeElements = root.querySelectorAll("input[placeholder], textarea[placeholder], button[aria-label], [title]");

            for (const element of attributeElements) {
                if (shouldSkipTranslationElement(element)) {
                    continue;
                }
                if (element.hasAttribute
                    && (element.hasAttribute("data-i18n")
                        || element.hasAttribute("data-i18n-placeholder")
                        || element.hasAttribute("data-i18n-aria-label")
                        || element.hasAttribute("data-i18n-title"))) {
                    continue;
                }

                const attributesToTranslate = ["placeholder", "aria-label", "title"];

                for (const attribute of attributesToTranslate) {
                    const currentValue = element.getAttribute(attribute);
                    if (!currentValue || !isLikelyNaturalLanguage(currentValue)) {
                        continue;
                    }

                    if (!originalElementAttributes.has(element)) {
                        originalElementAttributes.set(element, {});
                    }

                    const originalAttributes = originalElementAttributes.get(element);
                    if (!Object.prototype.hasOwnProperty.call(originalAttributes, attribute)) {
                        originalAttributes[attribute] = currentValue;
                    }

                    const sourceText = (originalAttributes[attribute] || "").trim();
                    if (sourceText) {
                        targets.push({
                            type: "attr",
                            element,
                            attribute,
                            text: sourceText
                        });
                    }
                }
            }
        }
    }

    return targets;
}

function getTranslationRoots() {
    const roots = [];
    if (AUTO_TRANSLATE_HOST_PAGE) {
        roots.push(document.body);
    }
    if (activeDfMessenger) {
        const messengerRoots = collectShadowRootsUnderHost(activeDfMessenger);
        for (const root of messengerRoots) {
            if (root && !roots.includes(root)) {
                roots.push(root);
            }
        }
    }
    if (!AUTO_TRANSLATE_HOST_PAGE) {
        const lightDomChatRootIds = [
            "dfchat-contact-form",
            CHAT_ACTION_BAR_ID,
            FOOTER_OVERLAY_ID,
            POWERED_BY_STRIP_ID,
            COMPANY_LAUNCHER_INPUT_STRIP_ID,
            "dfchat-chat-launcher-strip"
        ];
        for (let i = 0; i < lightDomChatRootIds.length; i++) {
            const el = document.getElementById(lightDomChatRootIds[i]);
            if (el && !roots.includes(el)) {
                roots.push(el);
            }
        }
    }
    return roots;
}

function isTranslatableTextNode(textNode, parentElement) {
    if (!textNode || !parentElement) {
        return false;
    }

    if (typeof parentElement.closest === "function" && parentElement.closest("[data-i18n]")) {
        return false;
    }

    if (!textNode.nodeValue || !isLikelyNaturalLanguage(textNode.nodeValue)) {
        return false;
    }

    if (shouldSkipTranslationElement(parentElement)) {
        return false;
    }

    return true;
}

function shouldSkipTranslationElement(element) {
    if (!element || !element.closest) {
        return true;
    }

    if (element.closest("script, style, noscript, code, pre, svg, .persona-badge")) {
        return true;
    }

    if (element.closest("#dfchat-contact-form-fields") && element.matches("input, textarea")) {
        return true;
    }

    if (element.closest("[data-dfchat-no-translate='true']")) {
        return true;
    }

    // Latin "X" only — never run Google text translation on the contact-form close glyph.
    if (element.id === "dfchat-contact-form-close") {
        return true;
    }

    // Chat composer placeholder is driven by `getChatInputPlaceholder` + `syncNativeComposerPlaceholders`.
    // Auto-translate used a frozen "original" placeholder and fought language switches.
    if (element.matches && element.matches("textarea") && activeDfMessenger) {
        const roots = collectSearchRoots(activeDfMessenger);
        for (let r = 0; r < roots.length; r++) {
            const root = roots[r];
            if (root && typeof root.contains === "function" && root.contains(element)) {
                if (!element.closest("#dfchat-contact-form")) {
                    return true;
                }
            }
        }
    }

    return false;
}

function isLikelyNaturalLanguage(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        return false;
    }

    if (/^[\d\s.,:;!?()\-_/\\]+$/.test(text)) {
        return false;
    }

    if (/^https?:\/\//i.test(text)) {
        return false;
    }

    return true;
}

function restoreOriginalDomContent() {
    for (const [textNode, originalValue] of originalTextNodeContent.entries()) {
        if (textNode && textNode.isConnected) {
            textNode.nodeValue = originalValue;
        }
    }

    for (const [element, attributes] of originalElementAttributes.entries()) {
        if (!element || !element.isConnected) {
            continue;
        }

        for (const [attribute, originalValue] of Object.entries(attributes)) {
            if (typeof originalValue === "string") {
                element.setAttribute(attribute, originalValue);
            }
        }
    }
}

/**
 * gtx/translate is most reliable with short codes; `mr-IN` / `hi-IN` map to `mr` / `hi`.
 * @param {string} [code]
 * @returns {string}
 */
function googleTranslateTargetLanguageCode(code) {
    const s = typeof code === "string" ? code.trim() : "";
    if (!s) {
        return "en";
    }
    if (s.includes("-") || s.includes("_")) {
        return s.split(/[-_]/)[0] || s;
    }
    return s;
}

function readTranslationOverridesForLanguage(targetLanguage) {
    try {
        const feats = MULTI_LANGUAGE_CONFIG && typeof MULTI_LANGUAGE_CONFIG === "object" ? MULTI_LANGUAGE_CONFIG : null;
        const map = feats && typeof feats.translationOverridesByLanguage === "object"
            ? feats.translationOverridesByLanguage
            : null;
        if (!map || typeof map !== "object") {
            return null;
        }
        const tl = googleTranslateTargetLanguageCode(targetLanguage);
        const row = map[tl];
        return row && typeof row === "object" ? row : null;
    } catch {
        return null;
    }
}

function translateOverrideIfAny(sourceText, targetLanguage) {
    const s = typeof sourceText === "string" ? sourceText.trim() : "";
    if (!s) {
        return null;
    }
    const overrides = readTranslationOverridesForLanguage(targetLanguage);
    if (!overrides) {
        return null;
    }
    // 1) Exact match
    const vExact = overrides[s];
    if (typeof vExact === "string" && vExact.trim()) {
        return vExact.trim();
    }
    return null;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace matching override phrases with stable tokens so Google Translate does NOT translate them,
 * then re-insert the override text after translation.
 * @returns {{ text: string, tokenMap: Record<string, string> }}
 */
function applyTranslationOverrideTokens(sourceText, targetLanguage) {
    const s0 = typeof sourceText === "string" ? sourceText : "";
    const overrides = readTranslationOverridesForLanguage(targetLanguage);
    if (!overrides) {
        return { text: s0, tokenMap: {} };
    }
    let text = s0;
    /** @type {Record<string, string>} */
    const tokenMap = {};
    try {
        const keys = Object.keys(overrides)
            .filter((k) => typeof k === "string" && k.trim())
            .sort((a, b) => b.length - a.length);
        let tokenSeq = 0;
        for (const rawKey of keys) {
            const key = rawKey.trim();
            if (!key) {
                continue;
            }
            const replacement = overrides[rawKey];
            if (typeof replacement !== "string" || !replacement.trim()) {
                continue;
            }
            const re = new RegExp(escapeRegExp(key), "gi");
            if (!re.test(text)) {
                continue;
            }
            const token = `\uE000DFOVR${tokenSeq += 1}\uE001`;
            tokenMap[token] = replacement.trim();
            text = text.replace(re, token);
        }
    } catch {
        return { text: s0, tokenMap: {} };
    }
    return { text, tokenMap };
}

function restoreTranslationOverrideTokens(translatedText, tokenMap) {
    let out = typeof translatedText === "string" ? translatedText : "";
    const keys = tokenMap && typeof tokenMap === "object" ? Object.keys(tokenMap) : [];
    if (keys.length === 0) {
        return out;
    }
    for (const token of keys) {
        const val = tokenMap[token];
        if (typeof val !== "string") {
            continue;
        }
        out = out.split(token).join(val);
    }
    return out;
}

async function translateTextUsingGoogle(sourceText, targetLanguage) {
    const tl = googleTranslateTargetLanguageCode(targetLanguage);
    const exactOverride = translateOverrideIfAny(sourceText, tl);
    if (exactOverride != null) {
        return exactOverride;
    }

    const tokenized = applyTranslationOverrideTokens(sourceText, tl);
    const cacheKey = `${tl}::${tokenized.text}`;
    if (googleTranslationCache.has(cacheKey)) {
        const cached = googleTranslationCache.get(cacheKey);
        return restoreTranslationOverrideTokens(cached, tokenized.tokenMap);
    }

    try {
        const queryParams = new URLSearchParams({
            client: "gtx",
            sl: "auto",
            tl,
            dt: "t",
            q: tokenized.text
        });
        const endpoint = `${GOOGLE_TRANSLATE_ENDPOINT}?${queryParams.toString()}`;
        const response = await fetch(endpoint, { method: "GET" });

        if (!response.ok) {
            googleTranslationCache.set(cacheKey, tokenized.text);
            return restoreTranslationOverrideTokens(sourceText, tokenized.tokenMap);
        }

        const payload = await response.json();
        const translatedText = extractGoogleTranslatedText(payload) || tokenized.text;
        googleTranslationCache.set(cacheKey, translatedText);
        return restoreTranslationOverrideTokens(translatedText, tokenized.tokenMap);
    } catch {
        googleTranslationCache.set(cacheKey, tokenized.text);
        return restoreTranslationOverrideTokens(sourceText, tokenized.tokenMap);
    }
}

function extractGoogleTranslatedText(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
        return "";
    }

    return payload[0]
        .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
        .join("")
        .trim();
}

function getInitialLanguage() {
    if (!isMultiLanguageEnabled()) {
        return DEFAULT_LANGUAGE;
    }

    try {
        const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (storedLanguage) {
            return resolveToSupportedLanguageCode(storedLanguage);
        }
    } catch {
        // Ignore storage failures and fall back to defaults.
    }

    const browserLanguage = (navigator.language || "").toLowerCase();
    if (browserLanguage.startsWith("hi")) {
        return resolveToSupportedLanguageCode("hi");
    }

    if (browserLanguage.startsWith("mr")) {
        return resolveToSupportedLanguageCode("mr");
    }

    return DEFAULT_LANGUAGE;
}

function getChatLanguageCode(languageCode) {
    const normalizedLanguage = normalizeLanguage(languageCode);
    const base = (normalizedLanguage || "").split(/[-_]/)[0] || "";
    if (base === "hi" || base === "mr") {
        return base;
    }
    return "en";
}

function persistLanguage(languageCode) {
    try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(languageCode));
    } catch {
        // Ignore storage failures in restricted browser modes.
    }
}

/**
 * Map a BCP-47 tag (e.g. `mr-IN`, `en-US`) or short code to a code from `enabledLanguages`.
 * Pairs `mr` with `mr-IN` in config, etc., so the pill label matches the selected option.
 * @param {string} [languageCode]
 * @returns {string}
 */
function resolveToSupportedLanguageCode(languageCode) {
    const raw = typeof languageCode === "string" ? languageCode.trim().toLowerCase() : "";
    if (!raw) {
        return DEFAULT_LANGUAGE;
    }
    if (SUPPORTED_LANGUAGES.includes(raw)) {
        return raw;
    }
    const base = raw.split(/[-_]/)[0] || raw;
    for (let i = 0; i < CHAT_LANGUAGE_OPTIONS.length; i++) {
        const opt = CHAT_LANGUAGE_OPTIONS[i];
        const oc = normalizeLanguageCode(opt && opt.code);
        if (!oc) {
            continue;
        }
        const optBase = oc.split(/[-_]/)[0] || oc;
        if (raw === oc || raw.startsWith(`${oc}-`) || base === optBase) {
            return oc;
        }
    }
    if (SUPPORTED_LANGUAGES.includes(base)) {
        return base;
    }
    for (let j = 0; j < SUPPORTED_LANGUAGES.length; j++) {
        const s = SUPPORTED_LANGUAGES[j];
        if (s && (raw === s || raw.startsWith(`${s}-`))) {
            return s;
        }
    }
    return DEFAULT_LANGUAGE;
}

function normalizeLanguage(languageCode) {
    return resolveToSupportedLanguageCode(languageCode);
}


function getApiEndpoint(pathname) {
    if (window.location.protocol === "file:") {
        return null;
    }

    const configuredBaseUrl = getConfiguredApiBaseUrl();
    const baseUrl = configuredBaseUrl || window.location.origin;

    return new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function getConfiguredApiBaseUrl() {
    const globalBaseUrl = typeof window.COMPANY_API_BASE_URL === "string"
        ? window.COMPANY_API_BASE_URL.trim()
        : "";

    if (globalBaseUrl) {
        return globalBaseUrl;
    }

    const metaTag = document.querySelector(`meta[name="${API_BASE_URL_META_NAME}"]`)
        || document.querySelector('meta[name="company-api-base-url"]');
    const metaBaseUrl = metaTag && typeof metaTag.content === "string"
        ? metaTag.content.trim()
        : "";

    return metaBaseUrl || "";
}

function getEmbedParentPageUrl() {
    try {
        if (typeof window.COMPANY_EMBED_PARENT_URL === "string") {
            const s = window.COMPANY_EMBED_PARENT_URL.trim();
            if (s) {
                return s;
            }
        }
    } catch {
        /* no-op */
    }
    return "";
}

function derivePagePartsFromHref(href) {
    try {
        const u = new URL(href);
        return {
            origin: u.origin || "",
            path: u.pathname || "",
            hostname: u.hostname || ""
        };
    } catch {
        return { origin: "", path: "", hostname: "" };
    }
}

function getClientContext() {
    const storedContext = readStoredClientContext();
    const persistedSessionId =
        typeof storedContext.client_session_id === "string"
            ? storedContext.client_session_id.trim()
            : "";
    const userAgent = navigator.userAgent || "";
    const browserName = detectBrowserName(userAgent);
    const browserVersion = detectBrowserVersion(userAgent);
    const osName = detectOperatingSystem(userAgent, navigator.platform || "");
    const deviceType = detectDeviceType(userAgent);
    const embedParentHref = getEmbedParentPageUrl();
    const pageFromParent = embedParentHref ? derivePagePartsFromHref(embedParentHref) : null;
    const clientContext = {
        ...storedContext,
        // Whitespace-only ids used to break chat→Sheet sync (postCapturedMobileToSheetRow required a non-empty sid).
        client_session_id: persistedSessionId || createClientSessionId(),
        source_url: embedParentHref || window.location.href || "",
        page_origin: pageFromParent ? pageFromParent.origin : window.location.origin || "",
        page_path: pageFromParent ? pageFromParent.path : window.location.pathname || "",
        page_hostname: pageFromParent ? pageFromParent.hostname : window.location.hostname || "",
        referrer_url: document.referrer || "",
        user_agent: userAgent,
        browser_name: browserName,
        browser_version: browserVersion,
        os_name: osName,
        device_type: deviceType,
        device_name: buildDeviceName(deviceType, osName, browserName),
        browser_language: navigator.language || "",
        browser_languages: Array.isArray(navigator.languages)
            ? navigator.languages.filter((value) => typeof value === "string" && value.trim())
            : [],
        platform: navigator.platform || "",
        timezone: getBrowserTimeZone(),
        screen_resolution: getScreenResolution(),
        viewport_size: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
        channel: "web"
    };

    persistClientContext(clientContext);
    return clientContext;
}

function readStoredClientContext() {
    try {
        const rawValue = window.sessionStorage.getItem(CHAT_CLIENT_CONTEXT_STORAGE_KEY);
        if (!rawValue) {
            return {};
        }

        const parsedValue = JSON.parse(rawValue);
        if (!parsedValue || typeof parsedValue !== "object") {
            return {};
        }
        const out = /** @type {Record<string, unknown>} */ ({ ...parsedValue });
        for (const key of ["name", "email", "mobile"]) {
            if (!(key in out)) {
                continue;
            }
            const cleaned = dfParameterScalarToString(out[key]);
            if (!cleaned) {
                delete out[key];
                continue;
            }
            out[key] = cleaned;
        }
        return out;
    } catch {
        return {};
    }
}

function persistClientContext(clientContext) {
    try {
        window.sessionStorage.setItem(
            CHAT_CLIENT_CONTEXT_STORAGE_KEY,
            JSON.stringify(clientContext)
        );
    } catch {
        // Session storage can fail in privacy-restricted browsers.
    }
}

/**
 * Copies widget `client_context` fields into Dialogflow CX **session parameters** for this chat session,
 * so flows can reference **`$session.params.device_type`**, **`$session.params.browser_name`**, etc.
 * Uses Messenger {@link https://cloud.google.com/dialogflow/cx/docs/concept/integration/dialogflow-messenger/javascript-functions#setqueryparameters setQueryParameters} (`QueryParameters.parameters`).
 *
 * In CX, use the same parameter ids (e.g. session parameter **`device_type`**).
 *
 * @param {unknown} dfMessenger
 */
function syncDfMessengerSessionParametersFromClientContext(dfMessenger) {
    if (!dfMessenger || typeof /** @type {{ setQueryParameters?: (q: unknown) => void }} */ (dfMessenger).setQueryParameters !== "function") {
        return;
    }
    try {
        const cx = getClientContext();
        if (!cx || typeof cx !== "object") {
            return;
        }
        /** @param {string} k */
        const pick = (k) => {
            const v = /** @type {Record<string, unknown>} */ (cx)[k];
            if (v == null) {
                return "";
            }
            const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
            return s.length > 500 ? s.slice(0, 500) : s;
        };
        /** @type {Record<string, string>} */
        const parameters = {};
        /** @param {string} key */
        const add = (key) => {
            const t = pick(key);
            if (t) {
                parameters[key] = t;
            }
        };
        add("device_type");
        add("browser_name");
        add("browser_version");
        add("os_name");
        add("device_name");
        add("page_hostname");
        add("page_path");
        add("source_url");
        add("channel");
        add("timezone");
        add("client_session_id");
        add("browser_language");
        add("screen_resolution");
        add("viewport_size");
        add("name");
        add("mobile");
        add("email");
        add("birthdate");
        add("city");
        add("user_agent");
        add("platform");
        add("referrer_url");
        add("appointmentdate");
        add("appointmenttime");
        add("rating");
        add("message");
        const spRaw = /** @type {Record<string, unknown>} */ (cx).session_params;
        if (spRaw && typeof spRaw === "object" && !Array.isArray(spRaw)) {
            for (const [k, val] of Object.entries(spRaw)) {
                const nk = String(k || "")
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "");
                if (!nk || Object.prototype.hasOwnProperty.call(parameters, nk)) {
                    continue;
                }
                const s = dfParameterScalarToString(val);
                if (s && s.length <= 500) {
                    parameters[nk] = s;
                }
            }
        }
        if (!Object.keys(parameters).length) {
            return;
        }
        /** @type {{ setQueryParameters: (q: { parameters: Record<string, string> }) => void }} */ (dfMessenger).setQueryParameters({
            parameters
        });
    } catch {
        /* Messenger version may omit setQueryParameters; ignore. */
    }
}

let chatMobileSheetSyncDebounceTimer = 0;
/** Dedupe after a successful Sheet sync for the same session + mobile string. */
let chatMobileSheetSyncLastOkKey = "";
/** Prevent duplicate posts before the first one completes. */
let chatMobileSheetSyncInFlightKey = "";
/** When contact-only thanks short-circuits CX on `df-user-input-entered`, swallow the paired `df-request-sent` for the same text. */
let contactOnlyThanksSuppressQueryRef_ = "";
let contactOnlyThanksSuppressTimer_ = 0;

function markContactOnlyThanksSuppressQuery_(normalizedTrimmed) {
    const q = typeof normalizedTrimmed === "string" ? normalizedTrimmed.trim() : "";
    if (!q) {
        return;
    }
    contactOnlyThanksSuppressQueryRef_ = q;
    if (contactOnlyThanksSuppressTimer_) {
        window.clearTimeout(contactOnlyThanksSuppressTimer_);
    }
    contactOnlyThanksSuppressTimer_ = window.setTimeout(() => {
        contactOnlyThanksSuppressTimer_ = 0;
        contactOnlyThanksSuppressQueryRef_ = "";
    }, 5000);
}

/**
 * @param {Event | null | undefined} event
 * @param {string} queryTrimmed
 * @returns {boolean} true when this event should not run the rest of the outbound pipeline
 */
function consumeContactOnlyThanksSuppressForQuery_(event, queryTrimmed) {
    const q = typeof queryTrimmed === "string" ? queryTrimmed.trim() : "";
    if (!q || !contactOnlyThanksSuppressQueryRef_) {
        return false;
    }
    if (contactOnlyThanksSuppressQueryRef_ !== q) {
        return false;
    }
    try {
        if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
        }
    } catch {
        /* ignore */
    }
    contactOnlyThanksSuppressQueryRef_ = "";
    return true;
}

/**
 * When Dialogflow/chat captures mobile, POST a Sheets-only row without waiting for the contact form.
 * Optional meta: `<meta name="dfchat-contact-form-mobile-sync-secret" content="…">` if Railway sets CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET.
 * @param {string} normalizedMobile
 */
function scheduleSheetRowForCapturedChatMobile(normalizedMobile) {
    const raw = typeof normalizedMobile === "string" ? normalizedMobile.trim() : "";
    if (!raw || !/\d/.test(raw)) {
        return;
    }
    if (chatMobileSheetSyncDebounceTimer) {
        window.clearTimeout(chatMobileSheetSyncDebounceTimer);
    }
    chatMobileSheetSyncDebounceTimer = window.setTimeout(() => {
        chatMobileSheetSyncDebounceTimer = 0;
        postCapturedMobileToSheetRow(raw);
    }, 450);
}

function postCapturedMobileToSheetRow(mobileValue) {
    const endpoint = getApiEndpoint(CONTACT_FORM_MOBILE_SHEET_SYNC_ENDPOINT);
    if (!endpoint || typeof fetch !== "function") {
        return;
    }

    /** @type {Record<string, string>} */
    const headers = {
        "Content-Type": "application/json"
    };
    try {
        const metaNode =
            typeof document !== "undefined"
                ? document.querySelector('meta[name="dfchat-contact-form-mobile-sync-secret"]')
                : null;
        const mv = metaNode && metaNode instanceof HTMLMetaElement ? metaNode.getAttribute("content") : null;
        const sec = typeof mv === "string" ? mv.trim() : "";
        if (sec) {
            headers["X-Contact-Form-Mobile-Sync-Secret"] = sec;
        }
    } catch {
        /* ignore */
    }

    let clientSnapshot = getClientContext();
    let sid =
        typeof clientSnapshot.client_session_id === "string" ? clientSnapshot.client_session_id.trim() : "";
    if (!sid) {
        try {
            persistClientContext({
                ...readStoredClientContext(),
                client_session_id: createClientSessionId()
            });
            clientSnapshot = getClientContext();
            sid =
                typeof clientSnapshot.client_session_id === "string"
                    ? clientSnapshot.client_session_id.trim()
                    : "";
        } catch {
            /* ignore */
        }
    }
    const mobileDigits = String(mobileValue || "").replace(/\D/g, "");
    const dedupeKey = `${sid}|${mobileDigits}`;
    if (!sid || !mobileDigits) {
        return;
    }
    if (dedupeKey === chatMobileSheetSyncLastOkKey || dedupeKey === chatMobileSheetSyncInFlightKey) {
        return;
    }
    chatMobileSheetSyncInFlightKey = dedupeKey;

    const cfg = readContactFormConfig();
    const formKey = cfg && typeof cfg.formKey === "string" ? cfg.formKey : "unknown";

    fetch(endpoint, {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({
            mobile: mobileDigits,
            client_context: clientSnapshot,
            _contactFormId: formKey,
            _source: "dialogflow_chat"
        }),
        keepalive: true
    })
        .then(async (resp) => {
            if (!resp.ok) {
                let detail = "";
                try {
                    detail = (await resp.text()).slice(0, 240);
                } catch {
                    /* ignore */
                }
                if (typeof console !== "undefined" && console.warn) {
                    console.warn(
                        "[dfchat] Mobile sheet sync failed:",
                        resp.status,
                        detail || resp.statusText,
                        resp.status === 401
                            ? "— add <meta name=\"dfchat-contact-form-mobile-sync-secret\" content=\"…\"> matching Railway CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET, or remove the secret on the server."
                            : "— check API base URL (meta dfchat-api-base-url), CORS, and Railway logs."
                    );
                }
                return;
            }
            chatMobileSheetSyncLastOkKey = dedupeKey;
        })
        .catch(() => {
            /* network / CORS; user can retry with next capture */
        })
        .finally(() => {
            if (chatMobileSheetSyncInFlightKey === dedupeKey) {
                chatMobileSheetSyncInFlightKey = "";
            }
        });
}

/**
 * Remember the visitor’s mobile after Contact / OTP forms so document uploads (no tel field)
 * still send `mobile` inside `client_context` for backend Drive folder naming.
 * @param {string} rawMobile
 * @param {{ syncSheet?: boolean, fromChat?: boolean, force?: boolean }} [opts] — `syncSheet: false` after contact form submit; `fromChat: true` when parsed from chat (CX merges skip briefly); `force: true` for form submit / explicit saves.
 */
function mergeVisitorMobileIntoStoredContext(rawMobile, opts) {
    const v = typeof rawMobile === "string" ? rawMobile.trim() : "";
    if (!v || !/\d/.test(v)) {
        return;
    }
    const o = opts && typeof opts === "object" ? opts : {};
    const syncSheet = o.syncSheet !== false;
    const fromChat = o.fromChat === true;
    const force = o.force === true;

    if (!fromChat && !force && Date.now() < skipCxMobileOverwriteUntilMs_) {
        return;
    }
    if (fromChat) {
        skipCxMobileOverwriteUntilMs_ = Date.now() + 120000;
    }
    if (force) {
        skipCxMobileOverwriteUntilMs_ = 0;
    }

    try {
        const prev = readStoredClientContext();
        persistClientContext({
            ...prev,
            mobile: v
        });
        if (syncSheet) {
            scheduleSheetRowForCapturedChatMobile(v);
        }
    } catch {
        /* ignore */
    }
}

/**
 * Persist an email parsed from chat or other loose sources into `client_context.email`.
 * @param {string} rawEmail
 */
function mergeVisitorEmailIntoStoredContext(rawEmail) {
    const es = typeof rawEmail === "string" ? rawEmail.trim().slice(0, 240) : "";
    if (!es || !EMAIL_VALIDATION_RE.test(es)) {
        return;
    }
    try {
        const prev = readStoredClientContext();
        persistClientContext({
            ...prev,
            email: es
        });
    } catch {
        /* ignore */
    }
}

/**
 * When the bot sends `open_form` with phone hints, persist them to `client_context` immediately so a later
 * file-only or minimal submit (no mobile field on the form) still posts `mobile` to Sheets / the API.
 * @param {Record<string, string | number | unknown> | null} prefill
 * @returns {boolean} true if a phone was merged from known keys / aliases
 */
function mergePhoneFromOpenFormPrefillIntoStoredContext(prefill) {
    if (!prefill || typeof prefill !== "object") {
        return false;
    }
    const strict = [
        "mobile",
        "phone",
        "phone-number",
        "tel",
        "whatsapp",
        "whatsapp_number",
        "contact_phone",
        "mobile_number",
        "phone_number",
        "cell",
        "cell_phone"
    ];
    for (let i = 0; i < strict.length; i += 1) {
        const k = strict[i];
        const raw = prefill[k];
        const v = dfParameterScalarToString(raw);
        if (v && /\d/.test(v)) {
            mergeVisitorMobileIntoStoredContext(v);
            return true;
        }
    }
    const alias = {
        mobile: true,
        phonenumber: true,
        phone: true,
        tel: true,
        whatsapp: true,
        whatsappnumber: true,
        contactnumber: true,
        contactphone: true,
        contactmobile: true,
        cell: true,
        cellphone: true,
        mobilenumber: true,
        mobilephone: true,
        usermobile: true,
        yourmobile: true,
        customermobile: true
    };
    const keys = Object.keys(prefill);
    for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        const nk = String(key || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        if (!alias[nk]) {
            continue;
        }
        const raw2 = prefill[key];
        const v2 = dfParameterScalarToString(raw2);
        if (v2 && /\d/.test(v2)) {
            mergeVisitorMobileIntoStoredContext(v2);
            return true;
        }
    }
    return false;
}

/**
 * Persist name / email hints from `open_form` payload into session storage (same turn as skip-open check).
 * @param {Record<string, string | number | unknown> | null} prefill
 */
function mergeContactHintsFromOpenFormPrefillIntoStoredContext(prefill) {
    if (!prefill || typeof prefill !== "object") {
        return;
    }
    try {
        const prev = readStoredClientContext();
        const next = Object.assign({}, prev);
        const nameRaw =
            prefill.name ?? prefill.customer_name ?? prefill.full_name ?? prefill.person_name;
        let ns = dfParameterScalarToString(nameRaw != null ? nameRaw : "").slice(0, 200);
        if (!ns) {
            const g = dfParameterScalarToString(
                prefill.given_name
                ?? prefill["given-name"]
                ?? prefill.givenname
                ?? prefill.first_name
                ?? prefill.firstname
            );
            const f = dfParameterScalarToString(
                prefill.family_name
                ?? prefill["family-name"]
                ?? prefill.lastname
                ?? prefill.last_name
                ?? prefill.surname
            );
            if (g && f) {
                ns = `${g} ${f}`.trim().slice(0, 200);
            } else if (g || f) {
                ns = (g || f).trim().slice(0, 200);
            }
        }
        if (ns) {
            next.name = ns;
        }
        const emRaw = prefill.email ?? prefill.user_email;
        const es = dfParameterScalarToString(emRaw != null ? emRaw : "");
        if (es && EMAIL_VALIDATION_RE.test(es)) {
            next.email = es;
        }
        persistClientContext(next);
    } catch {
        /* ignore */
    }
}

/** True when session already has both visitor name and mobile (skip opening default contact form). */
function sessionHasNameAndMobileForSkip_() {
    const s = readStoredClientContext();
    const n = dfParameterScalarToString(s && s.name != null ? s.name : "");
    const m = dfParameterScalarToString(s && s.mobile != null ? s.mobile : "");
    return !!(n && m);
}

/** When parameter names are custom (not phone aliases), pick the longest plausible mobile digit span. */
function mergeDfParameterDigitsFallback(prefill) {
    if (!prefill || typeof prefill !== "object") {
        return;
    }
    var pk = Object.keys(prefill);
    var bestRun = "";
    for (var p = 0; p < pk.length; p += 1) {
        var vx = dfParameterScalarToString(prefill[pk[p]]);
        if (!vx) {
            continue;
        }
        var runs = String(vx).match(/\d+/g);
        if (!runs) {
            continue;
        }
        for (var r = 0; r < runs.length; r += 1) {
            if (runs[r].length >= 9 && runs[r].length <= 15 && runs[r].length > bestRun.length) {
                bestRun = runs[r];
            }
        }
    }
    if (bestRun) {
        mergeVisitorMobileIntoStoredContext(bestRun);
    }
}

/**
 * Normalize one Dialogflow parameter value (Cx fullfillment / ES detect) to a display string for phone merging.
 * @param {unknown} val
 * @returns {string}
 */
function dfParameterScalarToString(val) {
    if (val == null) {
        return "";
    }
    if (typeof val === "string") {
        var t = val.trim();
        // Guard: CX sometimes sends unresolved template refs (literal text, not resolved parameters).
        if (/^\$session\.params\.[a-z0-9_]+$/i.test(t) || t.indexOf("$session.params.") !== -1) {
            return "";
        }
        if (/^\$request\.[\w.]+\.[a-z0-9_]+$/i.test(t) || /\$parameter\.\w+/i.test(t)) {
            return "";
        }
        return t;
    }
    if (typeof val === "number" && Number.isFinite(val)) {
        return String(val);
    }
    if (Array.isArray(val) && val.length > 0) {
        return dfParameterScalarToString(val[0]);
    }
    if (typeof val === "object") {
        var o = /** @type {Record<string, unknown>} */ (val);
        if (typeof o.stringValue === "string") {
            return dfParameterScalarToString(o.stringValue);
        }
        if (typeof o.numberValue === "number" && Number.isFinite(o.numberValue)) {
            return String(o.numberValue);
        }
        if (typeof o.original === "string") {
            return dfParameterScalarToString(o.original);
        }
        if (typeof o.resolved === "string") {
            return dfParameterScalarToString(o.resolved);
        }
        try {
            var c = convertDialogflowValue(val);
            if (typeof c === "string" && c.trim()) {
                return dfParameterScalarToString(c);
            }
            if (typeof c === "number" && Number.isFinite(c)) {
                return String(c);
            }
        } catch (_e) {
            /* ignore */
        }
    }
    return "";
}

/**
 * Flatten queryResult.parameters to plain string map (handles protobuf structs and @sys.phone-number shapes).
 * @param {unknown} parameters
 * @returns {Record<string, string> | null}
 */
function stringMapFromDfParametersObject(parameters) {
    if (!parameters || typeof parameters !== "object") {
        return null;
    }
    var src =
        parameters.fields && typeof parameters.fields === "object" && !Array.isArray(parameters.fields)
            ? convertStructFieldsToObject(parameters.fields)
            : parameters;
    if (!src || typeof src !== "object") {
        return null;
    }
    /** @type {Record<string, string>} */
    var out = {};
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        var s = dfParameterScalarToString(src[k]);
        if (s) {
            out[k] = s;
        }
    }
    return Object.keys(out).length ? out : null;
}

/**
 * CX diagnostic `Execution Sequence[].Step *.InitialState.SessionParameters` (mirrors $session.params).
 * @param {unknown} diagnosticInfo
 * @returns {Record<string, string> | null}
 */
function sessionParametersFromCxDiagnosticInfo(diagnosticInfo) {
    if (!diagnosticInfo || typeof diagnosticInfo !== "object") {
        return null;
    }
    /** @type {Record<string, string>} */
    var merged = {};
    var diag = /** @type {Record<string, unknown>} */ (diagnosticInfo);

    var seq = diag["Execution Sequence"];
    if (Array.isArray(seq)) {
        for (var i = 0; i < seq.length; i += 1) {
            var entry = seq[i];
            if (!entry || typeof entry !== "object") {
                continue;
            }
            var stepIds = Object.keys(entry);
            for (var j = 0; j < stepIds.length; j += 1) {
                var step = /** @type {Record<string, unknown>} */ (entry)[stepIds[j]];
                if (!step || typeof step !== "object") {
                    continue;
                }
                var initial = /** @type {Record<string, unknown>} */ (step).InitialState;
                if (initial && typeof initial.SessionParameters === "object") {
                    var layer = stringMapFromDfParametersObject(initial.SessionParameters);
                    if (layer) {
                        var lk = Object.keys(layer);
                        for (var l = 0; l < lk.length; l += 1) {
                            var key = lk[l];
                            if (layer[key]) {
                                merged[key] = layer[key];
                            }
                        }
                    }
                }
            }
        }
    }

    var alt = diag["Alternative Matched Intents"];
    if (Array.isArray(alt)) {
        for (var a = 0; a < alt.length; a += 1) {
            var intent = alt[a];
            if (intent && typeof intent === "object" && /** @type {Record<string, unknown>} */ (intent).Parameters) {
                var pm = stringMapFromDfParametersObject(
                    /** @type {{ Parameters: unknown }} */ (intent).Parameters
                );
                if (pm) {
                    var pmk = Object.keys(pm);
                    for (var b = 0; b < pmk.length; b += 1) {
                        var kk = pmk[b];
                        if (pm[kk]) {
                            merged[kk] = pm[kk];
                        }
                    }
                }
            }
        }
    }

    return Object.keys(merged).length ? merged : null;
}

/** @param {Event | undefined | null} event */
function getQueryResultObjectFromDfEvent(event) {
    var d = event && event.detail;
    return (
        (d && d.raw && d.raw.queryResult)
        || (d && d.data && d.data.queryResult)
        || null
    );
}

/**
 * CX `$session.params.*` surfaces in DetectIntent payloads under `parameters` inside `queryResult`
 * but some builds also send `sessionInfo.parameters`, root `parameters`, etc. Merge all into one map.
 * @param {unknown} branch `event.detail.raw` | `event.detail.data`
 * @returns {Record<string, string> | null}
 */
function mergedParameterStringMapFromResponseBranch(branch) {
    if (!branch || typeof branch !== "object") {
        return null;
    }
    /** @type {Record<string, unknown>} */
    var r = branch;
    var slices = [];

    slices.push(stringMapFromDfParametersObject(r.parameters));
    slices.push(stringMapFromDfParametersObject(r.sessionParameters));

    var sInfo =
        r.sessionInfo && typeof r.sessionInfo === "object"
            ? /** @type {{ parameters?: unknown }} */ (r.sessionInfo).parameters
            : undefined;
    slices.push(stringMapFromDfParametersObject(sInfo));

    var qr =
        r.queryResult && typeof r.queryResult === "object"
            ? /** @type {Record<string, unknown>} */ (r.queryResult)
            : null;
    if (qr) {
        slices.push(stringMapFromDfParametersObject(qr.parameters));
        var qs =
            qr.sessionInfo && typeof qr.sessionInfo === "object"
                ? /** @type {{ parameters?: unknown }} */ (qr.sessionInfo).parameters
                : undefined;
        slices.push(stringMapFromDfParametersObject(qs));
        var mt =
            qr.match && typeof qr.match === "object"
                ? /** @type {{ parameters?: unknown }} */ (qr.match).parameters
                : undefined;
        slices.push(stringMapFromDfParametersObject(mt));
        slices.push(sessionParametersFromCxDiagnosticInfo(qr.diagnosticInfo));
    }

    /** @type {Record<string, string>} */
    var merged = {};
    for (var i = 0; i < slices.length; i += 1) {
        if (!slices[i]) {
            continue;
        }
        var keys = Object.keys(slices[i]);
        for (var j = 0; j < keys.length; j += 1) {
            var k = keys[j];
            var v = slices[i][k];
            if (v) {
                merged[k] = v;
            }
        }
    }
    return Object.keys(merged).length ? merged : null;
}

/** @param {string} raw */
function digitRunFromDigitsOnlyUtterance(raw) {
    var t = String(raw || "").trim();
    if (!t || t.length > 48) {
        return "";
    }
    var digits = t.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) {
        return "";
    }
    if (!/^[\d\s+().\-]+$/i.test(t.replace(/\u00a0/g, " "))) {
        return "";
    }
    return digits;
}

/** When the user sends only a phone number, CX fills `mobile` asynchronously; utterance appears on `queryResult.text` / `match.resolvedInput`. */
function mergeVisitorMobileFromQueryResultUtterance(qr) {
    if (!qr || typeof qr !== "object") {
        return;
    }
    /** @type {Record<string, unknown>} */
    var q = qr;

    var t1 = typeof q.text === "string" ? q.text : "";
    var d = digitRunFromDigitsOnlyUtterance(t1);
    if (d) {
        mergeVisitorMobileIntoStoredContext(d);
        return;
    }

    var match = q.match && typeof q.match === "object" ? /** @type {Record<string, unknown>} */ (q.match) : null;
    var ri = match && typeof match.resolvedInput === "string" ? match.resolvedInput : "";
    d = digitRunFromDigitsOnlyUtterance(ri);
    if (d) {
        mergeVisitorMobileIntoStoredContext(d);
    }
}

/**
 * Persist name / email from CX parameters into session storage when the bot fills them (alongside mobile).
 * @param {Record<string, string>} slice
 */
function mergeOptionalContactFieldsFromParameterSlice_(slice) {
    if (!slice || typeof slice !== "object") {
        return;
    }
    try {
        const prev = readStoredClientContext();
        /** @type {Record<string, unknown>} */
        const next = Object.assign({}, prev);
        /** @type {Record<string, string>} */
        const norm = {};
        const keys = Object.keys(slice);
        for (let ki = 0; ki < keys.length; ki += 1) {
            const kk = keys[ki];
            const raw = slice[kk];
            const s = dfParameterScalarToString(raw);
            if (s && String(s).trim()) {
                norm[String(kk).toLowerCase().replace(/[^a-z0-9]/g, "")] = String(s).trim();
            }
        }
        const nameKeys = [
            "name",
            "customername",
            "fullname",
            "personname",
            "username",
            "guestname",
            "displayname"
        ];
        let nameFromKeys = "";
        for (let ni = 0; ni < nameKeys.length; ni += 1) {
            if (norm[nameKeys[ni]]) {
                const nm = norm[nameKeys[ni]];
                if (nm.length <= 200) {
                    nameFromKeys = nm;
                }
                break;
            }
        }
        if (!nameFromKeys) {
            const gn =
                norm.givenname ||
                norm.firstname ||
                norm.first ||
                norm.fname ||
                "";
            const fn =
                norm.familyname ||
                norm.lastname ||
                norm.surname ||
                norm.lname ||
                norm.secondname ||
                "";
            if (gn && fn) {
                nameFromKeys = `${gn} ${fn}`.trim().slice(0, 200);
            } else if (gn || fn) {
                nameFromKeys = (gn || fn).trim().slice(0, 200);
            }
        }
        if (nameFromKeys) {
            next.name = nameFromKeys;
        }
        const em = norm.email || norm.useremail || norm.mail || norm.contactemail;
        if (em && EMAIL_VALIDATION_RE.test(em)) {
            next.email = em;
        }
        const cityPick =
            norm.city
            || norm.visitorcity
            || norm.usercity
            || norm.selectedcity
            || norm.geocity
            || norm.homecity
            || "";
        if (!cityPick && norm.location && norm.location.length <= 96) {
            const locStr = norm.location;
            if (locStr && !/^https?:\/\//i.test(locStr)) {
                next.city = locStr.trim().slice(0, 200);
            }
        } else if (cityPick && cityPick.length <= 200) {
            next.city = cityPick;
        }
        /** Preserve CX session parameters (e.g. coursename) for Sheets `valueFrom` paths like `session_params.coursename`. */
        const prevSp =
            prev.session_params && typeof prev.session_params === "object" && !Array.isArray(prev.session_params)
                ? /** @type {Record<string, string>} */ ({ .../** @type {Record<string, unknown>} */ (prev.session_params) })
                : /** @type {Record<string, string>} */ ({});
        const nextSp = /** @type {Record<string, string>} */ ({ ...prevSp });
        const sn = Object.keys(norm);
        for (let si = 0; si < sn.length; si += 1) {
            const nk = sn[si];
            const nv = norm[nk];
            if (nv && String(nv).trim()) {
                nextSp[nk] = String(nv).trim();
            }
        }
        if (Object.keys(nextSp).length) {
            next.session_params = nextSp;
            if (nextSp.coursename) {
                next.coursename = nextSp.coursename;
            }
        }
        persistClientContext(next);
    } catch {
        /* ignore */
    }
}

/**
 * CX often keeps session values only under `queryResult.sessionInfo.parameters`; they may not appear in the flat
 * merged parameter map used elsewhere — merge them into `session_params` for Sheet `valueFrom` paths.
 * @param {unknown} qr `queryResult`
 */
function mergeSessionParamsFromQueryResultIntoStoredContext_(qr) {
    if (!qr || typeof qr !== "object") {
        return;
    }
    const si = /** @type {Record<string, unknown>} */ (qr).sessionInfo;
    const params = si && typeof si === "object" ? /** @type {{ parameters?: unknown }} */ (si).parameters : undefined;
    const sm = stringMapFromDfParametersObject(params);
    if (!sm || !Object.keys(sm).length) {
        return;
    }
    try {
        const prev = readStoredClientContext();
        /** @type {Record<string, unknown>} */
        const next = Object.assign({}, prev);
        const prevSp =
            prev.session_params && typeof prev.session_params === "object" && !Array.isArray(prev.session_params)
                ? /** @type {Record<string, unknown>} */ ({ ...prev.session_params })
                : {};
        const sk = Object.keys(sm);
        for (let i = 0; i < sk.length; i += 1) {
            const kk = sk[i];
            if (sm[kk]) {
                const nk = String(kk).toLowerCase().replace(/[^a-z0-9]/g, "");
                if (nk) {
                    prevSp[nk] = sm[kk];
                }
            }
        }
        next.session_params = prevSp;
        if (prevSp.coursename) {
            next.coursename = prevSp.coursename;
        }
        persistClientContext(next);
    } catch {
        /* ignore */
    }
}

/**
 * When the bot fills Dialogflow/CX parameters (e.g. $session.params.mobile / @sys.phone-number),
 * persist a phone-like value into session `client_context` so Sheets uploads see column D without `open_form`.
 * @param {Event | undefined | null} event
 */
function mergePhoneFromDialogflowParametersIntoStoredContext(event) {
    var d = event && event.detail;
    /** @type {Record<string, string>} */
    var mergedSlice = {};

    ["raw", "data"].forEach(function (branch) {
        /** @type {unknown} */
        var obj = branch === "raw" ? d && d.raw : d && d.data;
        var part = mergedParameterStringMapFromResponseBranch(obj);
        if (!part) {
            return;
        }
        var pk = Object.keys(part);
        for (var x = 0; x < pk.length; x += 1) {
            var key = pk[x];
            if (part[key]) {
                mergedSlice[key] = part[key];
            }
        }
    });

    var sliceMerged = Object.keys(mergedSlice).length ? mergedSlice : null;

    if (sliceMerged) {
        mergeOptionalContactFieldsFromParameterSlice_(sliceMerged);
        var fromAliases = mergePhoneFromOpenFormPrefillIntoStoredContext(sliceMerged);
        if (!fromAliases) {
            mergeDfParameterDigitsFallback(sliceMerged);
        }
    }

    var qr = getQueryResultObjectFromDfEvent(event);
    mergeSessionParamsFromQueryResultIntoStoredContext_(qr);
    if (qr) {
        mergeVisitorMobileFromQueryResultUtterance(qr);
    }
}

function createClientSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function detectBrowserName(userAgent) {
    const browserMatchers = [
        [/Edg\/([\d.]+)/, "Edge"],
        [/OPR\/([\d.]+)/, "Opera"],
        [/Chrome\/([\d.]+)/, "Chrome"],
        [/Firefox\/([\d.]+)/, "Firefox"],
        [/Version\/([\d.]+).*Safari/, "Safari"],
        [/MSIE\s([\d.]+)/, "Internet Explorer"],
        [/Trident\/.*rv:([\d.]+)/, "Internet Explorer"]
    ];

    for (const [matcher, browserName] of browserMatchers) {
        if (matcher.test(userAgent)) {
            return browserName;
        }
    }

    return "Unknown";
}

function detectBrowserVersion(userAgent) {
    const versionMatchers = [
        /Edg\/([\d.]+)/,
        /OPR\/([\d.]+)/,
        /Chrome\/([\d.]+)/,
        /Firefox\/([\d.]+)/,
        /Version\/([\d.]+).*Safari/,
        /MSIE\s([\d.]+)/,
        /Trident\/.*rv:([\d.]+)/
    ];

    for (const matcher of versionMatchers) {
        const match = userAgent.match(matcher);
        if (match && match[1]) {
            return match[1];
        }
    }

    return "";
}

function detectOperatingSystem(userAgent, platform) {
    const normalizedUserAgent = userAgent.toLowerCase();
    const normalizedPlatform = platform.toLowerCase();

    if (normalizedUserAgent.includes("windows") || normalizedPlatform.includes("win")) {
        return "Windows";
    }

    if (normalizedUserAgent.includes("android")) {
        return "Android";
    }

    if (/iphone|ipad|ipod/.test(normalizedUserAgent)) {
        return "iOS";
    }

    if (normalizedUserAgent.includes("mac os") || normalizedPlatform.includes("mac")) {
        return "macOS";
    }

    if (normalizedUserAgent.includes("linux") || normalizedPlatform.includes("linux")) {
        return "Linux";
    }

    return "Unknown";
}

function detectDeviceType(userAgent) {
    const normalizedUserAgent = userAgent.toLowerCase();

    if (/ipad|tablet/.test(normalizedUserAgent)) {
        return "tablet";
    }

    if (/mobi|iphone|android/.test(normalizedUserAgent)) {
        return "mobile";
    }

    return "desktop";
}

function buildDeviceName(deviceType, osName, browserName) {
    return [deviceType, osName, browserName]
        .filter((value) => typeof value === "string" && value && value !== "Unknown")
        .join(" / ");
}

function getBrowserTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
        return "";
    }
}

function getScreenResolution() {
    if (!window.screen) {
        return "";
    }

    return `${window.screen.width || 0}x${window.screen.height || 0}`;
}

function renderUserPersona(dfMessenger) {
    const ms = dfMessenger && dfMessenger === activeDfMessenger ? dfMessenger : activeDfMessenger;
    if (!ms || typeof ms.renderCustomText !== "function") {
        return;
    }
    const now = Date.now();
    if (now - lastUserPersonaRenderAt < 300) {
        return;
    }

    lastUserPersonaRenderAt = now;
    const u = USER_PERSONA_CONFIG;
    const timeLabel = u.showTime ? getPersonaTimeLabel(u.timeZone) : "";
    renderPersona(ms, "user", u.label, timeLabel);
}

function renderPersona(dfMessenger, personaType, label, timeLabelForUser) {
    if (personaType === "bot") {
        renderBotPersona(dfMessenger, Date.now());
        return;
    }
    const nonce = `${personaType}-${Date.now()}-${personaSequence += 1}`;
    const timeLabel =
        typeof timeLabelForUser === "string"
            ? timeLabelForUser
            : getIstTimeLabel();
    // `false` = end-user message (right column). `true` would render as agent and breaks layout/CSS.
    dfMessenger.renderCustomText(createPersonaBadgeMarkdown(label, timeLabel, nonce, PERSONA_MARKER_USER), false);
    schedulePersonaShadowFix(dfMessenger);
}

/**
 * External avatar + message time as markdown bold (same line as the image so one `<p>`; HTML spans are often stripped).
 * @param {string} baseUrl
 * @param {string} timeLabel
 */
function buildBotPersonaImageMarkdownWithTime_(baseUrl, timeLabel) {
    const imgMd = `![](${baseUrl}#${PERSONA_URL_MARKER_BOT_IMG})`;
    const t = typeof timeLabel === "string" ? timeLabel.trim() : "";
    if (!t) {
        return imgMd;
    }
    const safeBold = t.replace(/\*\*/g, "").replace(/\*/g, "×");
    return `${imgMd} **${safeBold}**`;
}

function renderBotPersona(dfMessenger, messageInstantMs) {
    if (!dfMessenger || typeof dfMessenger.renderCustomText !== "function") {
        return;
    }
    const when =
        typeof messageInstantMs === "number" && Number.isFinite(messageInstantMs)
            ? messageInstantMs
            : Date.now();
    const nonce = `bot-${Date.now()}-${personaSequence += 1}`;
    const cfg = BOT_PERSONA_CONFIG;
    const incDate = cfg.messageTimeIncludesDate !== false;
    if (cfg.mode === "emojiTime") {
        const label = cfg.emojiTime.label;
        const timeLabel = cfg.emojiTime.showTime
            ? getBotPersonaMessageTimeLabel(cfg.emojiTime.timeZone, when, incDate)
            : "";
        dfMessenger.renderCustomText(
            createPersonaBadgeMarkdown(label, timeLabel, nonce, PERSONA_MARKER_BOT, true),
            true
        );
        schedulePersonaShadowFix(dfMessenger);
        return;
    }
    const img = cfg.image;
    const baseUrl = img.url.split("#")[0].trim();
    if (img.showTime) {
        const timeLabel = getBotPersonaMessageTimeLabel(img.timeZone, when, incDate);
        const md = buildBotPersonaImageMarkdownWithTime_(baseUrl, timeLabel);
        dfMessenger.renderCustomText(md, true);
    } else {
        dfMessenger.renderCustomText(`![](${baseUrl}#${PERSONA_URL_MARKER_BOT_IMG})`, true);
    }
    schedulePersonaShadowFix(dfMessenger);
}

function getIstTimeLabel() {
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(new Date());
}

function getPersonaTimeLabel(timeZone, instant) {
    const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "Asia/Kolkata";
    let d = new Date();
    if (instant instanceof Date && !Number.isNaN(instant.getTime())) {
        d = instant;
    } else if (typeof instant === "number" && Number.isFinite(instant)) {
        d = new Date(instant);
    }
    try {
        return new Intl.DateTimeFormat("en-IN", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        }).format(d);
    } catch {
        return getIstTimeLabel();
    }
}

/**
 * Clock shown on the bot persona row for this reply (`instant` = when the response was handled).
 * @param {string} timeZone
 * @param {number | Date | undefined} instant
 * @param {boolean} includeDate
 */
function getBotPersonaMessageTimeLabel(timeZone, instant, includeDate) {
    const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "Asia/Kolkata";
    let d = new Date();
    if (instant instanceof Date && !Number.isNaN(instant.getTime())) {
        d = instant;
    } else if (typeof instant === "number" && Number.isFinite(instant)) {
        d = new Date(instant);
    }
    try {
        if (includeDate) {
            return new Intl.DateTimeFormat("en-IN", {
                timeZone: tz,
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            }).format(d);
        }
        return new Intl.DateTimeFormat("en-IN", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        }).format(d);
    } catch {
        return getPersonaTimeLabel(tz, d);
    }
}

function createPersonaBadgeMarkdown(label, timeLabel, nonce = "", personaDescMarker = "", compactBadge = false) {
    const imageUrl = createPersonaBadgeDataUrl(label, timeLabel, nonce, personaDescMarker, compactBadge);
    return `![](${imageUrl})`;
}

function createPersonaBadgeDataUrl(label, timeLabel, nonce = "", personaDescMarker = "", compactBadge = false) {
    const content = timeLabel && String(timeLabel).trim() ? `${label}  ${timeLabel}` : label;
    const svgH = compactBadge ? 18 : 28;
    const textY = compactBadge ? 13 : 19;
    const fontPx = compactBadge ? "8px" : PERSONA_FONT_SIZE;
    const charW = compactBadge ? 4.75 : 6.1;
    const minW = compactBadge ? 72 : 128;
    const pad = compactBadge ? 16 : 24;
    const width = Math.max(minW, Math.round(content.length * charW + pad));
    const desc = personaDescMarker ? `${personaDescMarker}|${nonce}` : nonce;
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgH}" viewBox="0 0 ${width} ${svgH}">
            <desc>${escapeXml(desc)}</desc>
            <defs>
                <filter id="softBlur" x="-10%" y="-10%" width="120%" height="120%">
                    <feGaussianBlur stdDeviation="0.25" />
                </filter>
            </defs>
            <text x="6" y="${textY}" font-family="${PERSONA_FONT_FAMILY}" font-size="${fontPx}" font-weight="${PERSONA_FONT_WEIGHT}" fill="${PERSONA_TEXT_COLOR}" opacity="0.84" filter="url(#softBlur)">${escapeXml(content)}</text>
        </svg>
    `;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getPersonaImageGuardCss() {
    const cfg = BOT_PERSONA_CONFIG;
    const img = cfg.image;
    const catW = cfg.mode === "image" ? `${img.widthPx}px` : "32px";
    const catH = cfg.mode === "image" ? `${img.heightPx}px` : "32px";
    const personaDown = cfg.mode === "image" ? `${img.offsetDownPx}px` : "0px";
    const mobY = `${cfg.mode === "image" ? img.offsetDownPx : 0}`;
    const mobX = `${img.mobileNudgeLeftPx}`;
    return `
img[src*="dfchat-bot-persona"],
img[src*="%23dfchat-bot-persona"] {
  width: ${catW} !important;
  height: ${catH} !important;
  max-width: ${catW} !important;
  max-height: ${catH} !important;
  object-fit: contain !important;
  display: inline-block !important;
  vertical-align: middle !important;
  box-sizing: border-box !important;
  transform: translateY(${personaDown}) !important;
}
.message.bot-message.markdown:has(img[src*="dfchat-bot-persona"]) p + p,
.message.bot-message.markdown:has(img[src*="%23dfchat-bot-persona"]) p + p {
  color: ${PERSONA_TEXT_COLOR} !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  margin: 0 !important;
  padding: 0 !important;
  line-height: 1.25 !important;
}
.message.bot-message.markdown:has(img[src*="dfchat-bot-persona"]) p strong,
.message.bot-message.markdown:has(img[src*="%23dfchat-bot-persona"]) p strong {
  color: ${PERSONA_TEXT_COLOR} !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  filter: blur(${PERSONA_SOFT_BLUR}) !important;
  opacity: ${PERSONA_OPACITY} !important;
}
img[src*="dfchat-persona-bot-time"] {
  height: 28px !important;
  width: auto !important;
  max-width: min(320px, 100%) !important;
  max-height: 28px !important;
  display: inline-block !important;
  vertical-align: middle !important;
  object-fit: contain !important;
  box-sizing: border-box !important;
  transform: translateY(${cfg.mode === "image" ? personaDown : "0px"}) !important;
}
@media (max-width: ${MOBILE_CHAT_BREAKPOINT_PX}px) {
img[src*="dfchat-bot-persona"],
img[src*="%23dfchat-bot-persona"] {
  transform: translateY(${mobY}px) translateX(-${mobX}px) !important;
}
img[src*="dfchat-persona-bot-time"] {
  transform: translateY(${mobY}px) translateX(-${mobX}px) !important;
}
}
img[src*="dfchat-persona-user|"],
img[src*="dfchat-persona-user%7C"],
img[src*="dfchat-persona-bot|"],
img[src*="dfchat-persona-bot%7C"] {
  max-height: ${BOT_PERSONA_CONFIG.mode === "emojiTime" ? "28" : "36"}px !important;
  max-width: 100% !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain !important;
  display: inline-block !important;
  vertical-align: middle !important;
  box-sizing: border-box !important;
}
${BOT_PERSONA_CONFIG.mode === "emojiTime" ? `
/* .entry:has(img) cannot see into df-messenger-utterance shadow — class set in applyBotEmojiPersonaCaptionChrome */
.entry.bot.dfchat-bot-emoji-caption-entry:not(:first-child) {
  margin-top: -44px !important;
}
/* Caption sits in df-markdown-message after df-text-message in same stack — pull host up */
df-markdown-message.dfchat-bot-emoji-caption-md-host {
  margin-top: -22px !important;
  margin-bottom: 0 !important;
}
/* Stack gap inside an utterance (~10px via --df-messenger-message-stack-spacing) */
.message-stack:has(img[src*="dfchat-persona-bot|"]):not(:first-child),
.message-stack:has(img[src*="dfchat-persona-bot%7C"]):not(:first-child) {
  margin-top: -30px !important;
}
.message-stack:has(img[src*="dfchat-persona-bot|"]),
.message-stack:has(img[src*="dfchat-persona-bot%7C"]) {
  margin-bottom: 0 !important;
}
/* Inner bubble + markdown wrapper (12px bot padding + p margins read as “gap”) */
.message.bot-message.markdown:has(img[src*="dfchat-persona-bot|"]),
.message.bot-message.markdown:has(img[src*="dfchat-persona-bot%7C"]) {
  background: transparent !important;
  background-color: transparent !important;
  padding: 0 8px !important;
  margin: 0 !important;
  min-height: 0 !important;
  line-height: 1 !important;
  transform: translateY(-12px) !important;
  border: none !important;
  box-shadow: none !important;
}
.message.bot-message.markdown:has(img[src*="dfchat-persona-bot|"]) > *,
.message.bot-message.markdown:has(img[src*="dfchat-persona-bot%7C"]) > * {
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}
/* Bubble chrome (non-markdown path) */
.message.bot-message:has(img[src*="dfchat-persona-bot|"]):not(.markdown),
.message.bot-message:has(img[src*="dfchat-persona-bot%7C"]):not(.markdown) {
  background: transparent !important;
  background-color: transparent !important;
  padding: 0 8px 0 8px !important;
  margin: 0 !important;
  transform: translateY(-20px) !important;
  border: none !important;
  box-shadow: none !important;
}
` : ""}
`;
}

function applyPersonaImageGuardToMessenger(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const css = getPersonaImageGuardCss();
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !(root instanceof ShadowRoot) || typeof root.appendChild !== "function") {
            continue;
        }
        let style = root.getElementById(PERSONA_IMAGE_GUARD_STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = PERSONA_IMAGE_GUARD_STYLE_ID;
            root.appendChild(style);
        }
        style.textContent = css;
    }
}

function schedulePersonaShadowFix(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => {
        applyPersonaImageGuardToMessenger(dfMessenger);
        decoratePersonaMessages(dfMessenger);
    };
    run();
    window.requestAnimationFrame(run);
    [0, 24, 80, 200, 500, 750, 1200].forEach((ms) => {
        window.setTimeout(run, ms);
    });
}

function startPersonaDecorator(dfMessenger) {
    const refresh = () => {
        const ms = activeDfMessenger || dfMessenger;
        if (!ms) {
            return;
        }
        applyPersonaImageGuardToMessenger(ms);
        decoratePersonaMessages(ms);
    };

    refresh();

    if (!personaRefreshTimer) {
        personaRefreshTimer = window.setInterval(refresh, 500);
    }

    if (dfMessenger && !dfMessenger._companyPersonaMO) {
        try {
            let moScheduled = false;
            const mo = new MutationObserver(() => {
                if (moScheduled) {
                    return;
                }
                moScheduled = true;
                window.requestAnimationFrame(() => {
                    moScheduled = false;
                    const ms = activeDfMessenger || dfMessenger;
                    if (ms) {
                        applyPersonaImageGuardToMessenger(ms);
                        decoratePersonaMessages(ms);
                    }
                });
            });
            mo.observe(dfMessenger, { childList: true, subtree: true });
            dfMessenger._companyPersonaMO = mo;
        } catch {
            // ignore
        }
    }
}

function collectSearchRoots(dfMessenger) {
    const roots = [document];
    const queue = [document, dfMessenger].filter(Boolean);

    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (!current) {
            continue;
        }

        if (current.shadowRoot && !roots.includes(current.shadowRoot)) {
            roots.push(current.shadowRoot);
            queue.push(current.shadowRoot);
        }

        if (!current.querySelectorAll) {
            continue;
        }

        for (const node of current.querySelectorAll("*")) {
            if (node.shadowRoot && !roots.includes(node.shadowRoot)) {
                roots.push(node.shadowRoot);
                queue.push(node.shadowRoot);
            }
        }
    }

    return roots;
}

/**
 * Shadow roots under `host` only (BFS). Does **not** include `document`, so it is safe for chat-only
 * translation. `collectSearchRoots` intentionally starts from `document` for scrollbar/persona tools;
 * using that output in `getTranslationRoots` was still translating the whole website.
 */
function collectShadowRootsUnderHost(host) {
    if (!host) {
        return [];
    }
    const roots = [];
    const queue = [host];
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (!current) {
            continue;
        }
        if (current.shadowRoot && !roots.includes(current.shadowRoot)) {
            roots.push(current.shadowRoot);
            queue.push(current.shadowRoot);
        }
        if (!current.querySelectorAll) {
            continue;
        }
        for (const node of current.querySelectorAll("*")) {
            if (node.shadowRoot && !roots.includes(node.shadowRoot)) {
                roots.push(node.shadowRoot);
                queue.push(node.shadowRoot);
            }
        }
    }
    return roots;
}

const MESSAGELIST_SCROLLBAR_CLASS = "dfchat-messagelist-hide-scrollbar";
const MESSAGELIST_SCROLLBAR_SKIP = new Set(["TEXTAREA", "INPUT", "SELECT", "BUTTON"]);

function getMessageListPaneSquareCornersCss() {
    const r = MESSAGE_LIST_PANE_BORDER_RADIUS;
    return `/* company.js: middle strip — Dialogflow sets .message-list-wrapper { border-radius: var(--df-messenger-chat-border-radius) }; override per corner below. */
.message-list-wrapper {
  border-top-left-radius: ${r.topLeft} !important;
  border-top-right-radius: ${r.topRight} !important;
  border-bottom-left-radius: ${r.bottomLeft} !important;
  border-bottom-right-radius: ${r.bottomRight} !important;
}
df-messenger-message-list {
  border-top-left-radius: ${r.topLeft} !important;
  border-top-right-radius: ${r.topRight} !important;
  border-bottom-left-radius: ${r.bottomLeft} !important;
  border-bottom-right-radius: ${r.bottomRight} !important;
}
#message-list,
#messageList {
  border-top-left-radius: ${r.topLeft} !important;
  border-top-right-radius: ${r.topRight} !important;
  border-bottom-left-radius: ${r.bottomLeft} !important;
  border-bottom-right-radius: ${r.bottomRight} !important;
}
/* DF sometimes nests the strip under .chat-wrapper only (same shadow). */
.chat-wrapper .message-list-wrapper {
  border-top-left-radius: ${r.topLeft} !important;
  border-top-right-radius: ${r.topRight} !important;
  border-bottom-left-radius: ${r.bottomLeft} !important;
  border-bottom-right-radius: ${r.bottomRight} !important;
}
`;
}

/**
 * Injected into each shadow under `df-messenger` so the message list can hide its scrollbar (scroll still works).
 * Dialogflow does not document one variable; we combine broad selectors + a run-time pass on true overflow nodes.
 */
function getMessageListHideScrollbarCss() {
    // Dialogflow v1: `<div id="message-list">` (hyphen) inside `df-messenger-message-list` shadow. Using
    // `#messageList` (wrong) never matched, so the scrollbar could not be hidden. Force overflow + track removal.
    return `
#message-list {
  overflow: hidden auto !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
  scrollbar-gutter: auto !important;
}
#message-list::-webkit-scrollbar {
  -webkit-appearance: none !important;
  appearance: none !important;
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  background: transparent !important;
}
#messageList,
#message-list,
#scroll,
#messages,
.scroll,
[role="log"],
[role="listbox"],
[data-testid="messageList"],
[data-testid="message-list"],
[data-testid="messages"],
df-messenger-message-list,
df-message-list,
df-messenger-messages,
.message-list,
.message-container,
[class*="message-list" i],
[class*="MessageList" i],
[class*="scroll" i][class*="container" i] {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
#messageList::-webkit-scrollbar,
#message-list::-webkit-scrollbar,
#scroll::-webkit-scrollbar,
#messages::-webkit-scrollbar,
.scroll::-webkit-scrollbar,
[role="log"]::-webkit-scrollbar,
[role="listbox"]::-webkit-scrollbar,
[data-testid="messageList"]::-webkit-scrollbar,
[data-testid="message-list"]::-webkit-scrollbar,
df-messenger-message-list::-webkit-scrollbar,
df-message-list::-webkit-scrollbar,
df-messenger-messages::-webkit-scrollbar,
.message-list::-webkit-scrollbar,
.message-container::-webkit-scrollbar,
[class*="message-list" i]::-webkit-scrollbar,
[class*="MessageList" i]::-webkit-scrollbar {
  -webkit-appearance: none !important;
  appearance: none !important;
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  background: transparent !important;
}
.${MESSAGELIST_SCROLLBAR_CLASS} {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
.${MESSAGELIST_SCROLLBAR_CLASS}::-webkit-scrollbar {
  -webkit-appearance: none !important;
  appearance: none !important;
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  background: transparent !important;
}
`;
}

/**
 * Find nodes that are actually doing vertical scrolling (so ::-webkit rules apply) and not the composer.
 */
function markMessageListScrollablesInRoots(roots) {
    for (const root of roots) {
        if (!root || !root.querySelectorAll || root === document) {
            continue;
        }
        for (const el of root.querySelectorAll("*")) {
            if (!el || el.nodeType !== 1) {
                continue;
            }
            if (MESSAGELIST_SCROLLBAR_SKIP.has(el.tagName)) {
                continue;
            }
            if (el.closest && el.closest("df-messenger-user-input")) {
                continue;
            }
            let o;
            try {
                o = window.getComputedStyle(el);
            } catch {
                continue;
            }
            const ox = o.overflowX;
            const oy = o.overflowY;
            const of = o.overflow;
            const yScroll = oy === "auto" || oy === "scroll" || of === "auto" || of === "scroll" || of === "overlay";
            if (!yScroll) {
                continue;
            }
            if (el.scrollHeight <= (el.clientHeight || 0) + 1) {
                continue;
            }
            const xonly = (ox === "auto" || ox === "scroll") && !(oy === "auto" || oy === "scroll");
            if (xonly && el.scrollWidth > (el.clientWidth || 0) + 1 && el.scrollHeight <= (el.clientHeight || 0) + 1) {
                continue;
            }
            el.classList.add(MESSAGELIST_SCROLLBAR_CLASS);
        }
    }
}

function clearMessageListScrollbarHiding(roots) {
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        if (root === document) {
            continue;
        }
        for (const el of root.querySelectorAll(`.${MESSAGELIST_SCROLLBAR_CLASS}`)) {
            if (el && el.classList) {
                el.classList.remove(MESSAGELIST_SCROLLBAR_CLASS);
            }
        }
    }
}

function disconnectMessageListScrollbarWatchers(messenger) {
    if (!messenger) {
        return;
    }
    if (messenger._companyListScrollObserver) {
        try {
            messenger._companyListScrollObserver.disconnect();
        } catch {
            // ignore
        }
        messenger._companyListScrollObserver = null;
    }
    if (messenger._companyListScrollRO) {
        try {
            messenger._companyListScrollRO.disconnect();
        } catch {
            // ignore
        }
        messenger._companyListScrollRO = null;
    }
}

function applyChatMessageListScrollbarToMessenger(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    applyChatMessageListOverflowVar(dfMessenger);
    disconnectMessageListScrollbarWatchers(dfMessenger);
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (root && root instanceof ShadowRoot && typeof root.getElementById === "function") {
            const rem = (id) => {
                const t = root.getElementById(id);
                if (t) {
                    t.remove();
                }
            };
            rem(MESSAGE_LIST_SCROLLBAR_STYLE_ID);
            rem(MESSAGE_LIST_SQUARE_PANE_STYLE_ID);
            rem(CHAT_PANEL_CORNERS_STYLE_ID);
        }
    }
    clearMessageListScrollbarHiding(roots);
    const panelCornersCss = getChatPanelBorderRadiusCss();
    for (const root of roots) {
        if (!root || !(root instanceof ShadowRoot) || typeof root.appendChild !== "function") {
            continue;
        }
        const styleSq = document.createElement("style");
        styleSq.id = MESSAGE_LIST_SQUARE_PANE_STYLE_ID;
        styleSq.textContent = getMessageListPaneSquareCornersCss();
        root.appendChild(styleSq);
        if (panelCornersCss) {
            const stylePl = document.createElement("style");
            stylePl.id = CHAT_PANEL_CORNERS_STYLE_ID;
            stylePl.textContent = panelCornersCss;
            root.appendChild(stylePl);
        }
    }
    if (SHOW_MESSAGELIST_SCROLLBAR) {
        return;
    }
    const css = getMessageListHideScrollbarCss();
    for (const root of roots) {
        if (!root || !(root instanceof ShadowRoot) || typeof root.appendChild !== "function") {
            continue;
        }
        const style = document.createElement("style");
        style.id = MESSAGE_LIST_SCROLLBAR_STYLE_ID;
        style.textContent = css;
        root.appendChild(style);
    }
    markMessageListScrollablesInRoots(roots);
    let reMarkTimer = 0;
    const reMark = () => {
        window.clearTimeout(reMarkTimer);
        reMarkTimer = window.setTimeout(() => {
            reMarkTimer = 0;
            const r2 = collectSearchRoots(dfMessenger);
            markMessageListScrollablesInRoots(r2);
        }, 100);
    };
    try {
        const mo = new MutationObserver(reMark);
        mo.observe(dfMessenger, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ["class", "style", "open", "hidden"]
        });
        dfMessenger._companyListScrollObserver = mo;
    } catch {
        // ignore
    }
    if (typeof ResizeObserver === "function") {
        try {
            const ro = new ResizeObserver(reMark);
            ro.observe(dfMessenger);
            dfMessenger._companyListScrollRO = ro;
        } catch {
            // ignore
        }
    }
    applyChatPanelBorderRadiusToElements(dfMessenger);
}

function scheduleChatMessageListScrollbarReapply(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => {
        applyChatMessageListScrollbarToMessenger(dfMessenger);
    };
    run();
    [50, 150, 400, 900, 1800, 3500, 7000, 12000].forEach((ms) => {
        window.setTimeout(run, ms);
    });
}

function applyUserInputVerticalNudge(dfMessenger) {
    if (!dfMessenger || !Number.isFinite(USER_INPUT_NUDGE_UP_PX)) {
        return;
    }
    const roots = collectSearchRoots(dfMessenger);
    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }
        const userInputHosts = root.querySelectorAll("df-messenger-user-input");
        for (const el of userInputHosts) {
            if (!el || !el.style) {
                continue;
            }
            if (USER_INPUT_NUDGE_UP_PX === 0) {
                el.style.removeProperty("transform");
                el.style.removeProperty("position");
            } else {
                el.style.setProperty("transform", `translateY(-${USER_INPUT_NUDGE_UP_PX}px)`, "important");
                el.style.setProperty("position", "relative", "important");
            }
        }
    }
    window.setTimeout(scheduleSyncChatActionBarPosition, 60);
}

function scheduleUserInputVerticalNudge(dfMessenger) {
    if (!dfMessenger) {
        return;
    }
    const run = () => {
        applyUserInputVerticalNudge(dfMessenger);
    };
    run();
    [200, 600, 1200, 2500].forEach((ms) => {
        window.setTimeout(run, ms);
    });
}

/** Cross shadow boundaries (parentElement is null when parent is a ShadowRoot). */
function getComposedParentElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }
    const p = node.parentElement;
    if (p) {
        return p;
    }
    const rn = node.getRootNode && node.getRootNode();
    if (rn instanceof ShadowRoot) {
        return rn.host || null;
    }
    return null;
}

function applyBotEmojiPersonaCaptionChrome(imageNode) {
    if (!imageNode || BOT_PERSONA_CONFIG.mode !== "emojiTime" || getPersonaType(imageNode) !== "bot") {
        return;
    }
    let el = getComposedParentElement(imageNode);
    for (let i = 0; el && i < 28; i += 1) {
        const tag = el.tagName ? el.tagName.toUpperCase() : "";
        if (tag === "BODY" || tag === "HTML") {
            break;
        }
        if (tag === "DF-MESSENGER-MESSAGE-LIST" || tag === "DF-MESSENGER-CHAT") {
            break;
        }
        const isBotMessageDiv = el.classList && el.classList.contains("message") && el.classList.contains("bot-message");
        const isMessageStack = el.classList && el.classList.contains("message-stack");
        const isBotEntry = el.classList && el.classList.contains("entry") && el.classList.contains("bot");
        const isMarkdownMessageHost = tag === "DF-MARKDOWN-MESSAGE";
        try {
            if (isMarkdownMessageHost && el.previousElementSibling) {
                try {
                    el.classList.add("dfchat-bot-emoji-caption-md-host");
                } catch (eMd) {
                    /* ignore */
                }
                el.style.setProperty("margin-top", "-22px", "important");
                el.style.setProperty("margin-bottom", "0", "important");
            }
            if (isBotEntry && el.previousElementSibling) {
                try {
                    el.classList.add("dfchat-bot-emoji-caption-entry");
                } catch (eCls) {
                    /* ignore */
                }
                el.style.setProperty("margin-top", "-44px", "important");
            }
            if (isMessageStack) {
                if (el.previousElementSibling) {
                    try {
                        el.classList.add("none");
                    } catch (e0) {
                        /* ignore */
                    }
                    el.style.setProperty("margin-top", "-30px", "important");
                }
                el.style.setProperty("margin-bottom", "0", "important");
            }
            if (isBotMessageDiv) {
                const mdBubble = el.classList && el.classList.contains("markdown");
                el.style.setProperty("background", "transparent", "important");
                el.style.setProperty("background-color", "transparent", "important");
                el.style.setProperty("background-image", "none", "important");
                el.style.setProperty("padding", "0 8px", "important");
                el.style.setProperty("margin", "0", "important");
                el.style.setProperty("transform", mdBubble ? "translateY(-12px)" : "translateY(-20px)", "important");
                el.style.setProperty("box-shadow", "none", "important");
                el.style.setProperty("border", "none", "important");
                el.style.setProperty("outline", "none", "important");
            } else {
                el.style.setProperty("background", "transparent", "important");
                el.style.setProperty("background-color", "transparent", "important");
                el.style.setProperty("box-shadow", "none", "important");
                el.style.setProperty("border", "none", "important");
                el.style.setProperty("outline", "none", "important");
                if (i === 0) {
                    el.style.setProperty("padding", "0", "important");
                    el.style.setProperty("margin", "0", "important");
                } else if (i <= 3) {
                    el.style.setProperty("padding", "0", "important");
                }
            }
        } catch (e) {
            /* ignore */
        }
        el = getComposedParentElement(el);
    }
}

/**
 * @param {HTMLImageElement} imageNode
 * @returns {HTMLElement | null}
 */
function resolvePersonaBotMessageElement_(imageNode) {
    if (!imageNode) {
        return null;
    }
    let personaMessage = typeof imageNode.closest === "function"
        ? /** @type {HTMLElement | null} */ (/** @type {unknown} */ (imageNode.closest(".message.bot-message.markdown")))
        : null;
    if (!personaMessage) {
        let el = imageNode.parentElement;
        for (let i = 0; el && i < 26; i += 1) {
            if (el.classList && el.classList.contains("message") && el.classList.contains("bot-message")) {
                personaMessage = el;
                break;
            }
            el = el.parentElement;
        }
    }
    return personaMessage || null;
}

/**
 * CX often renders each bot snippet as its own `.entry.bot`; persona `renderCustomText` then becomes another entry below those chunks.
 * Move that entry above the contiguous `.entry.bot` block immediately preceding it so the persona appears before the reply text.
 * @param {HTMLImageElement} imageNode
 * @returns {boolean}
 */
function reorderBotPersonaEntryBeforeContiguousBotChunks_(imageNode) {
    const personaType = getPersonaType(imageNode);
    if (personaType !== "bot") {
        return false;
    }
    if (BOT_PERSONA_CONFIG.mode !== "emojiTime") {
        const src = imageNode.getAttribute("src") || "";
        if (!src.includes(`#${PERSONA_URL_MARKER_BOT_IMG}`)) {
            return false;
        }
    }
    const personaMessage = resolvePersonaBotMessageElement_(imageNode);
    if (!personaMessage) {
        return false;
    }
    const entry = resolveBotPersonaEntry_(personaMessage);
    if (!entry || entry.dataset.dfchatBotPersonaEntryMoved === "1") {
        return false;
    }
    const parent = entry.parentElement;
    if (!parent) {
        return false;
    }

    /** @type {HTMLElement | null} */
    let earliestContiguousBot = null;
    let probe = entry.previousElementSibling;
    while (probe && probe.nodeType === Node.ELEMENT_NODE) {
        const h = /** @type {HTMLElement} */ (probe);
        if (h.classList && h.classList.contains("entry")) {
            if (h.classList.contains("bot")) {
                earliestContiguousBot = h;
                probe = h.previousElementSibling;
                continue;
            }
            break;
        }
        probe = probe.previousElementSibling;
    }
    if (!earliestContiguousBot || earliestContiguousBot === entry) {
        return false;
    }
    try {
        parent.insertBefore(entry, earliestContiguousBot);
        entry.dataset.dfchatBotPersonaEntryMoved = "1";
        return true;
    } catch {
        return false;
    }
}

/** @param {HTMLElement} anywhere */
function resolveBotPersonaEntry_(anywhere) {
    if (!anywhere) {
        return null;
    }
    if (typeof anywhere.closest === "function") {
        const byClosest = anywhere.closest(".entry.bot");
        if (byClosest) {
            return /** @type {HTMLElement} */ (byClosest);
        }
    }
    let el = anywhere;
    for (let i = 0; el && i < 32; i += 1) {
        if (
            el.classList
            && el.classList.contains("entry")
            && el.classList.contains("bot")
        ) {
            return el;
        }
        el = el.parentElement || null;
    }
    return null;
}

/**
 * Moves the bot persona markdown bubble to the top of `.message-stack` so it sits above assistant text when
 * {@link renderCustomText} appended it after CX messages (common).
 * @param {HTMLImageElement} imageNode
 * @returns {boolean} true when a node was moved
 */
function reorderBotPersonaMarkdownToTopOfStack_(imageNode) {
    const personaType = getPersonaType(imageNode);
    if (personaType !== "bot") {
        return false;
    }
    if (BOT_PERSONA_CONFIG.mode !== "emojiTime") {
        const src = imageNode.getAttribute("src") || "";
        if (!src.includes(`#${PERSONA_URL_MARKER_BOT_IMG}`)) {
            return false;
        }
    }

    const personaMessage = resolvePersonaBotMessageElement_(imageNode);
    if (!personaMessage || personaMessage.dataset.dfchatBotPersonaReordered === "1") {
        return false;
    }
    let stack = typeof personaMessage.closest === "function"
        ? personaMessage.closest(".message-stack")
        : null;
    // Some builds wrap stacks; walk up briefly if `.message-stack` is not on personaMessage ancestry.
    if (!stack && typeof personaMessage.closest === "function") {
        let p = personaMessage.parentElement;
        for (let j = 0; p && j < 10; j += 1) {
            if (p.classList && p.classList.contains("message-stack")) {
                stack = p;
                break;
            }
            p = p.parentElement;
        }
    }
    if (!stack || !stack.children || stack.children.length < 2) {
        return false;
    }

    /** @type {HTMLElement[]} */
    const botMsgs = [];
    for (let k = 0; k < stack.children.length; k += 1) {
        const c = stack.children[k];
        if (
            c
            && c.classList
            && c.classList.contains("message")
            && c.classList.contains("bot-message")
        ) {
            botMsgs.push(/** @type {HTMLElement} */ (c));
        }
    }
    if (botMsgs.length < 2) {
        return false;
    }
    const first = botMsgs[0];
    if (first === personaMessage) {
        personaMessage.dataset.dfchatBotPersonaReordered = "1";
        return false;
    }
    try {
        stack.insertBefore(personaMessage, first);
        personaMessage.dataset.dfchatBotPersonaReordered = "1";
        return true;
    } catch {
        return false;
    }
}

function decoratePersonaMessages(dfMessenger) {
    const roots = collectSearchRoots(dfMessenger);

    for (const root of roots) {
        if (!root || !root.querySelectorAll) {
            continue;
        }

        const personaImages = root.querySelectorAll(
            [
                `img[src*='#${PERSONA_URL_MARKER_BOT_IMG}']`,
                `img[src*='${PERSONA_MARKER_BOT_TIME}']`,
                `img[src*='${PERSONA_MARKER_USER}|']`,
                `img[src*='${PERSONA_MARKER_USER}%7C']`,
                `img[src*='${PERSONA_MARKER_BOT}|']`,
                `img[src*='${PERSONA_MARKER_BOT}%7C']`,
                `img[src*='${USER_PERSONA_TOKEN}']`,
                `img[src*='${BOT_PERSONA_TOKEN}']`
            ].join(", ")
        );
        for (const image of personaImages) {
            const personaType = getPersonaType(image);
            if (!personaType) {
                continue;
            }
            if (personaType === "bot") {
                reorderBotPersonaMarkdownToTopOfStack_(image);
                reorderBotPersonaEntryBeforeContiguousBotChunks_(image);
            }
            if (personaType === "bot" && BOT_PERSONA_CONFIG.mode === "emojiTime") {
                applyBotEmojiPersonaCaptionChrome(image);
            }
            const container = findPersonaContainer(image, root);
            if (!container) {
                continue;
            }

            if (image.dataset.companyPersonaStyled === personaType) {
                continue;
            }

            stylePersonaContainer(container, image, personaType);
            if (personaType === "bot" && BOT_PERSONA_CONFIG.mode === "emojiTime") {
                applyBotEmojiPersonaCaptionChrome(image);
            }
        }
    }
}

function getPersonaType(imageNode) {
    const source = imageNode && imageNode.getAttribute ? imageNode.getAttribute("src") || "" : "";
    if (source.includes(USER_PERSONA_TOKEN)) {
        return "user";
    }

    if (source.includes(`#${PERSONA_URL_MARKER_BOT_IMG}`)) {
        return "bot";
    }

    if (source.includes(BOT_PERSONA_TOKEN)) {
        return "bot";
    }

    if (source.includes(PERSONA_MARKER_BOT_TIME)) {
        return "bot";
    }

    if (source.startsWith("data:image/svg+xml")) {
        try {
            const raw = source.replace(/^data:image\/svg\+xml;utf8,/, "").replace(/^data:image\/svg\+xml,/, "");
            const decoded = decodeURIComponent(raw);
            if (decoded.includes(`<desc>${PERSONA_MARKER_USER}`) || decoded.includes(`${PERSONA_MARKER_USER}|`)) {
                return "user";
            }
            if (decoded.includes(`<desc>${PERSONA_MARKER_BOT}`) || decoded.includes(`${PERSONA_MARKER_BOT}|`)) {
                return "bot";
            }
        } catch {
            // ignore
        }
    }

    return null;
}

function findPersonaContainer(imageNode, root) {
    let current = imageNode;

    while (current && current !== root && current !== document.body) {
        if (looksLikeMessageContainer(current)) {
            return current;
        }

        current = current.parentElement || current.parentNode;
    }

    return imageNode.parentElement;
}

function looksLikeMessageContainer(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }

    const tokens = [
        node.className || "",
        node.getAttribute("data-message-id") || "",
        node.getAttribute("data-testid") || "",
        node.getAttribute("aria-label") || "",
        node.getAttribute("role") || ""
    ].join(" ").toLowerCase();

    if (/message|article|response|bot|agent/.test(tokens)) {
        return true;
    }

    const style = window.getComputedStyle(node);
    return parseFloat(style.paddingLeft) > 0 || parseFloat(style.paddingRight) > 0 || style.borderRadius !== "0px";
}

function stylePersonaContainer(container, imageNode, personaType) {
    let current = container;
    let depth = 0;

    imageNode.dataset.companyPersonaStyled = personaType;
    imageNode.style.filter = `blur(${PERSONA_SOFT_BLUR})`;
    imageNode.style.opacity = PERSONA_OPACITY;

    const src = imageNode.getAttribute("src") || "";
    if (personaType === "bot" && BOT_PERSONA_CONFIG.mode === "image") {
        const { widthPx, heightPx, showTime } = BOT_PERSONA_CONFIG.image;
        const isCat = src.includes(`#${PERSONA_URL_MARKER_BOT_IMG}`);
        const isTime = src.includes(PERSONA_MARKER_BOT_TIME);
        imageNode.style.display = "inline-block";
        imageNode.style.verticalAlign = "middle";
        if (isCat) {
            imageNode.style.height = `${heightPx}px`;
            imageNode.style.width = `${widthPx}px`;
            imageNode.style.objectFit = "contain";
            if (showTime) {
                imageNode.style.marginRight = "6px";
            }
        } else if (isTime) {
            imageNode.style.height = "28px";
            imageNode.style.width = "auto";
        } else {
            const hPx = showTime ? Math.max(heightPx, 28) : heightPx;
            imageNode.style.height = `${hPx}px`;
            imageNode.style.width = "auto";
            imageNode.style.objectFit = "contain";
        }
    } else if (personaType === "bot" && BOT_PERSONA_CONFIG.mode === "emojiTime") {
        /* Same inline sizing as bot time image — avoids extra row height / gap vs image mode */
        imageNode.style.display = "inline-block";
        imageNode.style.verticalAlign = "middle";
        imageNode.style.height = "28px";
        imageNode.style.width = "auto";
        imageNode.style.objectFit = "contain";
        if (BOT_PERSONA_CONFIG.emojiTime.showTime) {
            imageNode.style.marginRight = "6px";
        }
    } else {
        imageNode.style.display = "block";
        imageNode.style.maxWidth = "100%";
        imageNode.style.height = "28px";
        imageNode.style.width = "auto";
    }

    if (personaType === "user") {
        imageNode.style.marginLeft = "auto";
        imageNode.style.marginRight = "4px";
        imageNode.style.marginTop = cssUserPersonaMarginTop();
        imageNode.style.marginBottom = "0px";
        {
            const t = cssUserPersonaTranslateX();
            imageNode.style.transform = t || "";
        }
    }

    const isBotEmojiCaption = personaType === "bot" && BOT_PERSONA_CONFIG.mode === "emojiTime";

    while (current && current !== document.body && depth < 3) {
        current.dataset.companyPersonaStyled = personaType;
        if (!isBotEmojiCaption) {
            current.style.background = "transparent";
            current.style.backgroundColor = "transparent";
            current.style.boxShadow = "none";
            current.style.border = "0";
            current.style.outline = "0";
            current.style.padding = "0";
        }

        if (depth === 0) {
            current.style.marginBottom = PERSONA_VERTICAL_PULL;
            if (personaType === "user") {
                current.style.marginLeft = "0";
                current.style.marginRight = "0";
                current.style.marginTop = cssUserPersonaMarginTop();
                current.style.marginBottom = "0px";
                current.style.textAlign = "right";
            }
        }


        if (personaType === "user") {
            current.style.display = "flex";
            current.style.width = "100%";
            current.style.maxWidth = "100%";
            current.style.justifyContent = "flex-end";
            current.style.marginLeft = "0";
            current.style.marginRight = "0";
            current.style.marginTop = cssUserPersonaMarginTop();
            current.style.marginBottom = "0px";
            current.style.alignSelf = "flex-end";
            current.style.justifySelf = "end";
            current.style.textAlign = "right";
            current.style.float = "none";
        } else {
            current.style.display = depth === 0 ? "block" : "flex";
            current.style.width = depth === 0 ? "fit-content" : "100%";
            current.style.maxWidth = "100%";
            current.style.justifyContent = "flex-start";
            current.style.marginTop = "0px";
            {
                const tighten = BOT_PERSONA_CONFIG.mode === "image"
                    ? 4 + BOT_PERSONA_CONFIG.image.tightenBelowPx
                    : 4;
                current.style.marginBottom = `-${tighten}px`;
            }
            current.style.marginLeft = "0px";
            current.style.marginRight = "auto";
        }

        const tokens = [
            current.className || "",
            current.getAttribute("role") || "",
            current.getAttribute("data-testid") || ""
        ].join(" ").toLowerCase();

        if (/chat|window|list|panel|container/.test(tokens) && depth > 0) {
            break;
        }

        current = current.parentElement;
        depth += 1;
    }
}

function escapeXml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// --- Company admin preview: merge flat settings into live config (no iframe reload) ---
function dfchatIsPlainObject(v) {
    return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function dfchatDeepMerge(dst, src) {
    if (!dfchatIsPlainObject(dst) || !dfchatIsPlainObject(src)) {
        return dst;
    }
    for (const k of Object.keys(src)) {
        const sv = src[k];
        if (dfchatIsPlainObject(sv)) {
            if (!dfchatIsPlainObject(dst[k])) {
                dst[k] = {};
            }
            dfchatDeepMerge(dst[k], sv);
        } else {
            dst[k] = sv;
        }
    }
    return dst;
}

/** Maps the admin UI flat object to the same nested shape as `settings-public.json` from the admin host. */
function buildCompanyAdminFlatSettingsPatch(flat) {
    const s = dfchatIsPlainObject(flat) ? flat : {};
    const asAdminFeatureBoolOrNull = (key) => {
        if (!Object.prototype.hasOwnProperty.call(s, key)) {
            return null;
        }
        return isFeatureEnabled(s[key], false);
    };
    const asNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const asStr = (v) => (typeof v === "string" ? v : "");

    function parseHexRgb(hex) {
        if (typeof hex !== "string") return null;
        const m = String(hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (!m) return null;
        const int = parseInt(m[1], 16);
        return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
    }

    function mixRgb(a, b, w) {
        return {
            r: Math.round(a.r * (1 - w) + b.r * w),
            g: Math.round(a.g * (1 - w) + b.g * w),
            b: Math.round(a.b * (1 - w) + b.b * w),
        };
    }

    function toRgbCss(rgb) {
        return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    }

    function tintHex(hex, w) {
        const rgb = parseHexRgb(hex);
        if (!rgb) return null;
        return toRgbCss(mixRgb(rgb, { r: 255, g: 255, b: 255 }, w));
    }

    function shadeHex(hex, w) {
        const rgb = parseHexRgb(hex);
        if (!rgb) return null;
        return toRgbCss(mixRgb(rgb, { r: 0, g: 0, b: 0 }, w));
    }

    const width = asNum(s.chatWidthPx);
    const height = asNum(s.chatHeightPx);
    const enableMultiLanguage = asAdminFeatureBoolOrNull("enableMultiLanguage");
    const enableRestart = asAdminFeatureBoolOrNull("enableRestart");
    const enablePoweredBy = asAdminFeatureBoolOrNull("enablePoweredBy");
    const enableMic = asAdminFeatureBoolOrNull("enableMic");
    const autoOpenDeskEnabled = asAdminFeatureBoolOrNull("autoOpenDeskEnabled");
    const autoOpenMobEnabled = asAdminFeatureBoolOrNull("autoOpenMobEnabled");

    const autoOpenDeskDelayMs = asNum(s.autoOpenDeskDelayMs);
    const autoOpenMobDelayMs = asNum(s.autoOpenMobDelayMs);

    const launcherStripDeskEnabled = asAdminFeatureBoolOrNull("launcherStripDeskEnabled");
    const launcherStripMobEnabled = asAdminFeatureBoolOrNull("launcherStripMobEnabled");
    const launcherStripDeskTypingDurationMs = asNum(s.launcherStripDeskTypingDurationMs);
    const launcherStripDeskSwapTextDelayMs = asNum(s.launcherStripDeskSwapTextDelayMs);
    const launcherStripMobTypingDurationMs = asNum(s.launcherStripMobTypingDurationMs);
    const launcherStripMobSwapTextDelayMs = asNum(s.launcherStripMobSwapTextDelayMs);

    const defaultLanguageRaw = typeof s.defaultLanguage === "string" ? s.defaultLanguage.trim() : "";
    let enabledLanguages = null;
    if (typeof s.enabledLanguagesJson === "string" && s.enabledLanguagesJson.trim()) {
        try {
            const parsed = JSON.parse(s.enabledLanguagesJson);
            if (Array.isArray(parsed)) {
                enabledLanguages = parsed;
            }
        } catch {
            // ignore invalid JSON
        }
    }

    const primaryHex = typeof s.chatbotPrimaryColor === "string" ? s.chatbotPrimaryColor.trim() : "";
    const userMsgBgHex = typeof s.userMessageBg === "string" ? s.userMessageBg.trim() : "";
    const botMsgBgHex = typeof s.botMessageBg === "string" ? s.botMessageBg.trim() : "";
    const userMsgTextHex = typeof s.userMessageText === "string" ? s.userMessageText.trim() : "";
    const botMsgTextHex = typeof s.botMessageText === "string" ? s.botMessageText.trim() : "";

    const primaryLight = tintHex(primaryHex, 0.35);
    const primaryDark = shadeHex(primaryHex, 0.35);
    const titlebarGradient = (primaryLight && primaryDark)
        ? `linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.1) 24%, transparent 46%), linear-gradient(168deg, ${primaryLight} 0%, ${primaryHex} 42%, ${primaryDark} 100%)`
        : undefined;

    const chatBubbleGradient = (primaryLight && primaryDark)
        ? `linear-gradient(160deg, ${primaryLight} 0%, ${primaryHex} 48%, ${primaryDark} 100%)`
        : undefined;

    const chipsBgRgba = (() => {
        const rgb = parseHexRgb(primaryHex);
        if (!rgb) return undefined;
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.92)`;
    })();

    const buttonBorder = (() => {
        const rgb = parseHexRgb(primaryHex);
        if (!rgb) return undefined;
        return `1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`;
    })();

    const userMsgBackgroundGradient = (() => {
        const shade = shadeHex(userMsgBgHex, 0.25);
        const tint = tintHex(userMsgBgHex, 0.45);
        if (!shade || !tint) return undefined;
        return `linear-gradient(145deg, ${shade} 0%, ${tint} 100%)`;
    })();

    const botMsgBackgroundGradient = (() => {
        const shade = shadeHex(botMsgBgHex, 0.15);
        const tint = tintHex(botMsgBgHex, 0.70);
        if (!shade || !tint) return undefined;
        return `linear-gradient(168deg, ${shade} 0%, ${tint} 100%)`;
    })();

    return {
        common: {
            header: {
                ...(typeof s.headerTitle === "string" ? { title: asStr(s.headerTitle) } : null),
                ...(typeof s.headerSubtitle === "string" ? { subtitle: asStr(s.headerSubtitle) } : null),
                ...(typeof s.chatIconUrl === "string" ? { chatIconUrl: asStr(s.chatIconUrl).trim() } : null),
                ...(typeof s.chatTitleIconUrl === "string" ? { chatTitleIconUrl: asStr(s.chatTitleIconUrl).trim() } : null),
            },
            dfMessengerTheme: {
                ...(typeof s.chatbotPrimaryColor === "string" ? { "--df-messenger-primary-color": primaryHex } : null),
                ...(userMsgBackgroundGradient ? { "--df-messenger-message-user-background": userMsgBackgroundGradient } : (typeof s.userMessageBg === "string" ? { "--df-messenger-message-user-background": userMsgBgHex } : null)),
                ...(typeof s.userMessageText === "string" ? { "--df-messenger-message-user-font-color": userMsgTextHex } : null),
                ...(botMsgBackgroundGradient ? { "--df-messenger-message-bot-background": botMsgBackgroundGradient } : (typeof s.botMessageBg === "string" ? { "--df-messenger-message-bot-background": botMsgBgHex } : null)),
                ...(typeof s.botMessageText === "string" ? { "--df-messenger-message-bot-font-color": botMsgTextHex } : null),

                // Apply primary color to other visible theme parts too.
                ...(titlebarGradient ? { "--df-messenger-titlebar-background": titlebarGradient } : null),
                ...(chatBubbleGradient ? { "--df-messenger-chat-bubble-background": chatBubbleGradient } : null),
                ...(chipsBgRgba ? { "--df-messenger-chips-background": chipsBgRgba } : null),
                ...(buttonBorder ? { "--df-messenger-button-border": buttonBorder } : null),
            },
            features: {
                ...(enableMultiLanguage == null ? null : {
                    multiLanguage: {
                        enabled: enableMultiLanguage,
                        ...(defaultLanguageRaw ? { defaultLanguage: defaultLanguageRaw } : null),
                        ...(enabledLanguages ? { enabledLanguages } : null)
                    }
                }),
                ...(enableRestart == null ? null : { restartChat: { enabled: enableRestart } }),
            },
            ...(enablePoweredBy == null ? null : { poweredBy: { enabled: enablePoweredBy } }),
        },
        desk: {
            chatWindow: {
                ...(width == null ? null : { widthPx: width }),
                ...(height == null ? null : { heightPx: height }),
            },
            ...(enableMic == null ? null : { speechToText: { enabled: enableMic } }),
            ...((autoOpenDeskEnabled == null && autoOpenDeskDelayMs == null) ? null : {
                autoOpenChat: {
                    ...(autoOpenDeskEnabled == null ? null : { enabled: autoOpenDeskEnabled }),
                    ...(autoOpenDeskDelayMs == null ? null : { delayMs: autoOpenDeskDelayMs })
                }
            }),
            ...((launcherStripDeskEnabled == null
                && typeof s.launcherStripDeskText !== "string"
                && launcherStripDeskTypingDurationMs == null
                && launcherStripDeskSwapTextDelayMs == null
                && typeof s.launcherStripDeskSwapText !== "string") ? null : {
                launcherStrip: {
                    ...(launcherStripDeskEnabled == null ? null : { enabled: launcherStripDeskEnabled }),
                    ...(typeof s.launcherStripDeskText === "string" ? { text: asStr(s.launcherStripDeskText) } : null),
                    ...(launcherStripDeskTypingDurationMs == null ? null : { typingDurationMs: launcherStripDeskTypingDurationMs }),
                    ...(launcherStripDeskSwapTextDelayMs == null ? null : { swapTextDelayMs: launcherStripDeskSwapTextDelayMs }),
                    ...(typeof s.launcherStripDeskSwapText === "string" ? { swapText: asStr(s.launcherStripDeskSwapText) } : null),
                }
            }),
        },
        mob: {
            chatWindow: {
                ...(width == null ? null : { widthPx: width }),
                ...(height == null ? null : { heightPx: height }),
            },
            ...(enableMic == null ? null : { speechToText: { enabled: enableMic } }),
            ...((autoOpenMobEnabled == null && autoOpenMobDelayMs == null) ? null : {
                autoOpenChat: {
                    ...(autoOpenMobEnabled == null ? null : { enabled: autoOpenMobEnabled }),
                    ...(autoOpenMobDelayMs == null ? null : { delayMs: autoOpenMobDelayMs })
                }
            }),
            ...((launcherStripMobEnabled == null
                && typeof s.launcherStripMobText !== "string"
                && launcherStripMobTypingDurationMs == null
                && launcherStripMobSwapTextDelayMs == null
                && typeof s.launcherStripMobSwapText !== "string") ? null : {
                launcherStrip: {
                    ...(launcherStripMobEnabled == null ? null : { enabled: launcherStripMobEnabled }),
                    ...(typeof s.launcherStripMobText === "string" ? { text: asStr(s.launcherStripMobText) } : null),
                    ...(launcherStripMobTypingDurationMs == null ? null : { typingDurationMs: launcherStripMobTypingDurationMs }),
                    ...(launcherStripMobSwapTextDelayMs == null ? null : { swapTextDelayMs: launcherStripMobSwapTextDelayMs }),
                    ...(typeof s.launcherStripMobSwapText === "string" ? { swapText: asStr(s.launcherStripMobSwapText) } : null),
                }
            }),
        },
    };
}

function dfchatApplyCompanyAdminFlatSettingsNow() {
    const df = activeDfMessenger || document.querySelector("df-messenger");
    if (!df) {
        return false;
    }
    applyDfMessengerThemeConfig(df, readCompanyUiConfig());
    const bubble = df.querySelector("df-messenger-chat-bubble");
    const h = COMMON_CONFIG.header || {};
    if (bubble) {
        if (typeof h.title === "string") {
            bubble.setAttribute("chat-title", h.title || "Chat Support");
        }
        if (typeof h.subtitle === "string") {
            bubble.setAttribute("chat-subtitle", h.subtitle);
        }
    }
    ensureChatActionBar();
    scheduleSyncChatActionBarPosition();
    ensurePoweredByStrip();
    syncPoweredByStripPosition();
    scheduleComposerSpeechMicAttach(df);
    return true;
}

/**
 * Called from `chat-frame.html` via `postMessage` so the admin preview updates **without** reloading the iframe.
 * @param {Record<string, unknown>} flat
 */
window.__dfchatApplyCompanyAdminFlatSettings = function __dfchatApplyCompanyAdminFlatSettings(flat) {
    const patch = buildCompanyAdminFlatSettingsPatch(flat);
    dfchatDeepMerge(window.COMPANY_CHAT_UI_CONFIG, patch);
    // Advanced: merge full nested patch JSON if present.
    try {
        if (flat && typeof flat.advancedPatchJson === "string" && flat.advancedPatchJson.trim()) {
            const adv = JSON.parse(flat.advancedPatchJson);
            if (dfchatIsPlainObject(adv)) {
                dfchatDeepMerge(window.COMPANY_CHAT_UI_CONFIG, adv);
            }
        }
    } catch {
        /* ignore invalid JSON */
    }
    if (dfchatApplyCompanyAdminFlatSettingsNow()) {
        return;
    }
    let n = 0;
    const tick = window.setInterval(() => {
        n += 1;
        if (dfchatApplyCompanyAdminFlatSettingsNow() || n > 40) {
            window.clearInterval(tick);
        }
    }, 120);
};
