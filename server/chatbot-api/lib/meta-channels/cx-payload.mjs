/**
 * Parse Dialogflow CX responseMessages into channel-neutral reply parts
 * (matches payloads handled by company.js on the web widget).
 */

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

/** @param {unknown} v */
export function payloadString_(v) {
    if (typeof v === "string") {
        return trim_(v);
    }
    if (v && typeof v === "object" && typeof v.stringValue === "string") {
        return trim_(v.stringValue);
    }
    if (typeof v === "number" || typeof v === "boolean") {
        return String(v);
    }
    return "";
}

/** @param {Record<string, unknown>} body */
function payloadMessage_(body) {
    return payloadString_(
        body.message ?? body.text ?? body.prompt ?? body.subtitle ?? body.description ?? body.caption
    );
}

/** @param {Record<string, unknown>} body */
function payloadVideoCaption_(body) {
    return payloadString_(
        body.message ?? body.text ?? body.prompt ?? body.description ?? body.caption
    );
}

/** @param {string} text */
function isGenericChoicePrompt_(text) {
    const n = trim_(text).toLowerCase().replace(/\s+/g, " ").replace(/[.:!?…]+$/g, "");
    return !n
        || n === "please choose an option"
        || n === "choose an option"
        || n === "select an option"
        || n === "select option"
        || n.startsWith("select an option")
        || n.startsWith("choose an option");
}

/** @param {string} a @param {string} b */
function promptsEquivalent_(a, b) {
    const na = trim_(a).toLowerCase().replace(/\s+/g, " ").replace(/[.:!?…]+$/g, "");
    const nb = trim_(b).toLowerCase().replace(/\s+/g, " ").replace(/[.:!?…]+$/g, "");
    return Boolean(na && nb && na === nb);
}

/** @param {Record<string, unknown>} body */
function videoTitleFromBody_(body) {
    const nested =
        body.video && typeof body.video === "object" && !Array.isArray(body.video)
            ? /** @type {Record<string, unknown>} */ (body.video)
            : null;
    const direct = payloadString_(
        body.title
        ?? body.videoTitle
        ?? body.video_title
        ?? body.name
        ?? body.heading
        ?? body.label
        ?? body.subtitle
        ?? body.videoLabel
        ?? body.video_label
    );
    if (direct) {
        return direct;
    }
    if (nested) {
        return payloadString_(
            nested.title ?? nested.label ?? nested.heading ?? nested.name ?? nested.subtitle
        );
    }
    const params = body.parameters;
    if (params && typeof params === "object" && !Array.isArray(params)) {
        return payloadString_(
            /** @type {Record<string, unknown>} */ (params).title
            ?? /** @type {Record<string, unknown>} */ (params).label
            ?? /** @type {Record<string, unknown>} */ (params).videoTitle
            ?? /** @type {Record<string, unknown>} */ (params).video_title
            ?? /** @type {Record<string, unknown>} */ (params).name
        );
    }
    return "";
}

/** @param {unknown} raw */
function parseJsonObject_(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw !== "string") {
        return null;
    }
    const s = raw.trim();
    if (!s) {
        return null;
    }
    try {
        const o = JSON.parse(s);
        return o && typeof o === "object" ? o : null;
    } catch {
        return null;
    }
}

/** @param {unknown} value */
function unwrapDialogflowValue_(value) {
    if (value == null || typeof value !== "object") {
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
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const [k, v] of Object.entries(value.structValue.fields)) {
            out[k] = unwrapDialogflowValue_(v);
        }
        return out;
    }
    if (value.listValue && Array.isArray(value.listValue.values)) {
        return value.listValue.values.map(unwrapDialogflowValue_);
    }
    return value;
}

/** Flatten Dialogflow `{ fields: { key: { stringValue } } }` payloads. @param {unknown} body */
function flattenPayloadRecord_(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
    }
    let rec = /** @type {Record<string, unknown>} */ (body);
    if (
        rec.fields
        && typeof rec.fields === "object"
        && !Array.isArray(rec.fields)
        && !payloadString_(rec.action)
    ) {
        /** @type {Record<string, unknown>} */
        const fromFields = {};
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (rec.fields))) {
            fromFields[k] = unwrapDialogflowValue_(v);
        }
        rec = fromFields;
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
        out[k] = unwrapDialogflowValue_(v);
    }
    return out;
}

/** @param {unknown} payload */
function normalizePayloadBody_(payload) {
    let body = unwrapDialogflowValue_(payload);
    body = parseJsonObject_(body) || (body && typeof body === "object" ? body : null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
    }
    body = flattenPayloadRecord_(body);
    if (!body) {
        return null;
    }
    if (payloadString_(body.action)) {
        return body;
    }
    /** @type {Record<string, unknown>} */
    const rec = body;
    const fr = rec.fulfillment_response;
    if (fr && typeof fr === "object") {
        const msgs = /** @type {{ messages?: unknown[] }} */ (fr).messages;
        if (Array.isArray(msgs)) {
            for (const m of msgs) {
                if (!m || typeof m !== "object") {
                    continue;
                }
                const inner = normalizePayloadBody_(/** @type {{ payload?: unknown }} */ (m).payload);
                if (inner && payloadString_(inner.action)) {
                    return inner;
                }
            }
        }
    }
    return rec;
}

function isHttpsUrl_(raw) {
    return /^https:\/\/.+/i.test(trim_(raw));
}

/**
 * @param {unknown} opts
 * @returns {{ label: string, value: string }[]}
 */
export function normalizeSelectOptions_(opts) {
    if (!Array.isArray(opts)) {
        return [];
    }
    /** @type {{ label: string, value: string }[]} */
    const out = [];
    for (const opt of opts) {
        if (typeof opt === "string") {
            const t = trim_(opt);
            if (t) {
                out.push({ label: t, value: t });
            }
            continue;
        }
        if (opt && typeof opt === "object") {
            const label = payloadString_(opt.text ?? opt.label ?? opt.title);
            let value = payloadString_(opt.value ?? opt.payload ?? opt.ctaValue ?? opt.query);
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
 * @typedef {{ id: string, title: string, subtitle: string, imageUrl: string, ctaLabel: string, ctaValue: string }} CarouselCard
 * @typedef {{ label: string, value: string }} ChoiceOption
 * @typedef {{
 *   texts: string[],
 *   infoLines: string[],
 *   images: string[],
 *   choices: ChoiceOption[],
 *   choicePrompt: string,
 *   cardCarousel: { message: string, cards: CarouselCard[], explicitOptions?: boolean } | null,
 *   gallery: { message: string, prompt: string, urls: string[], options: ChoiceOption[] } | null,
 *   video: { title: string, message: string, url: string, choices: ChoiceOption[] } | null,
 *   form: { message: string, formId: string, formKey: string } | null,
 *   liveAgent: { message: string } | null
 * }} CxReplyParts
 */

/**
 * @param {unknown} rawCards
 * @returns {CarouselCard[]}
 */
function normalizeCarouselCards_(rawCards) {
    if (!Array.isArray(rawCards)) {
        return [];
    }
    /** @type {CarouselCard[]} */
    const out = [];
    for (let i = 0; i < rawCards.length; i += 1) {
        const row = rawCards[i];
        if (!row || typeof row !== "object") {
            continue;
        }
        const title = payloadString_(row.title ?? row.name ?? row.heading);
        const subtitle = payloadString_(row.subtitle ?? row.description ?? row.text);
        const imageUrl = payloadString_(row.imageUrl ?? row.image_url ?? row.image ?? row.img);
        const ctaLabel = payloadString_(row.ctaLabel ?? row.cta_label ?? row.button ?? row.buttonLabel) || "Select";
        const ctaValue = payloadString_(row.ctaValue ?? row.cta_value ?? row.value ?? row.query) || title;
        const id = payloadString_(row.id ?? row.key ?? row.card_id ?? row.cardId) || `${i + 1}`;
        if (!title && !subtitle && !imageUrl) {
            continue;
        }
        out.push({ id, title, subtitle, imageUrl, ctaLabel, ctaValue });
    }
    return out;
}

/**
 * @param {CxReplyParts} parts
 * @param {{ label: string, value: string }} opt
 */
function pushChoice_(parts, opt) {
    const label = trim_(opt.label);
    const value = trim_(opt.value);
    if (!label || !value) {
        return;
    }
    if (parts.choices.some((c) => c.value === value)) {
        return;
    }
    parts.choices.push({ label, value });
}

/**
 * @param {CxReplyParts} parts
 * @param {Record<string, unknown>} item
 */
function mergeVideoFromItem_(parts, item) {
    const url = payloadString_(
        item.url ?? item.videoUrl ?? item.video_url ?? item.link ?? item.src ?? item.href
    );
    if (!url) {
        return;
    }
    const title = payloadString_(item.title ?? item.label ?? item.name ?? item.heading);
    const caption = payloadVideoCaption_(item);
    const prev = parts.video;
    parts.video = {
        title: title || prev?.title || "",
        message: caption || prev?.message || "",
        url: url || prev?.url || "",
        choices: prev?.choices || []
    };
    const opts = normalizeSelectOptions_(item.options ?? item.option ?? item.chips);
    for (const o of opts) {
        pushChoice_(parts, o);
    }
    if (opts.length) {
        parts.video.choices = opts;
    }
}

/**
 * @param {CxReplyParts} parts
 * @param {Record<string, unknown>} body
 */
function absorbActionPayload_(parts, body) {
    const action = payloadString_(body.action).toLowerCase();
    if (!action) {
        return;
    }

    const msg = payloadMessage_(body);

    if (action === "open_card_carousel") {
        const cards = normalizeCarouselCards_(body.cards ?? body.items ?? body.list).slice(0, 10);
        const opts = normalizeSelectOptions_(body.options ?? body.option ?? body.chips);
        if (cards.length) {
            parts.cardCarousel = { message: msg, cards, explicitOptions: opts.length > 0 };
        }
        for (const o of opts) {
            pushChoice_(parts, o);
        }
        if (msg && !parts.choicePrompt && opts.length) {
            parts.choicePrompt = msg;
        } else if (msg && !parts.choicePrompt && cards.length) {
            parts.choicePrompt = msg;
        }
        return;
    }

    if (action === "open_gallery") {
        const urls = [];
        const rawUrls = body.urls;
        if (Array.isArray(rawUrls)) {
            for (const u of rawUrls) {
                const s = payloadString_(u);
                if (isHttpsUrl_(s)) {
                    urls.push(s);
                }
            }
        }
        const opts = normalizeSelectOptions_(body.options ?? body.option ?? body.chips);
        if (urls.length) {
            parts.gallery = {
                message: opts.length ? "" : msg,
                prompt: msg,
                urls: urls.slice(0, 10),
                options: [...opts]
            };
        }
        for (const o of opts) {
            pushChoice_(parts, o);
        }
        if (opts.length) {
            parts.choicePrompt = msg || parts.choicePrompt || "";
        } else if (msg && !parts.choicePrompt) {
            parts.choicePrompt = msg;
        }
        return;
    }

    if (action === "open_video") {
        const url = payloadString_(body.url ?? body.video_url ?? body.videoUrl);
        if (url) {
            const choices = normalizeSelectOptions_(body.options ?? body.option ?? body.chips);
            const caption = payloadVideoCaption_(body);
            let title = videoTitleFromBody_(body);
            let message = caption;

            if (!title && caption && choices.length && !isGenericChoicePrompt_(caption)) {
                title = caption;
                message = "";
            } else if (caption && isGenericChoicePrompt_(caption)) {
                message = "";
            } else if (caption && title && payloadString_(caption) === title) {
                message = "";
            }

            const prev = parts.video;
            parts.video = {
                title: title || prev?.title || "",
                message: message || prev?.message || "",
                url,
                choices: choices.length ? choices : (prev?.choices || [])
            };
            for (const o of parts.video.choices) {
                pushChoice_(parts, o);
            }
            if (choices.length) {
                if (
                    caption
                    && !isGenericChoicePrompt_(caption)
                    && !(title && payloadString_(caption) === title)
                ) {
                    parts.choicePrompt = caption;
                }
            }
        }
        return;
    }

    if (action === "open_form") {
        parts.form = {
            message: msg,
            formId: payloadString_(body.form_id ?? body.formId),
            formKey: payloadString_(body.form_key ?? body.formKey)
        };
        return;
    }

    if (action === "dfchat_inline_select") {
        const opts = normalizeSelectOptions_(body.options);
        for (const o of opts) {
            pushChoice_(parts, o);
        }
        if (msg) {
            parts.choicePrompt = msg;
        } else if (payloadString_(body.placeholder)) {
            parts.choicePrompt = payloadString_(body.placeholder);
        }
        return;
    }

    if (
        action === "request_live_agent"
        || action === "live_agent"
        || action === "human_agent"
        || action === "request_human_agent"
    ) {
        parts.liveAgent = {
            message: msg || "Connecting you with an agent. Please wait…"
        };
    }
}

/**
 * @param {CxReplyParts} parts
 * @param {Record<string, unknown>} body
 */
function absorbRichContent_(parts, body) {
    const rc = body.richContent;
    if (!Array.isArray(rc)) {
        if (Array.isArray(body.options)) {
            for (const o of normalizeSelectOptions_(body.options)) {
                pushChoice_(parts, o);
            }
        }
        return;
    }
    for (const row of rc) {
        if (!Array.isArray(row)) {
            continue;
        }
        for (const item of row) {
            if (!item || typeof item !== "object") {
                continue;
            }
            const type = payloadString_(item.type).toLowerCase();
            if (type === "chips") {
                for (const o of normalizeSelectOptions_(item.options)) {
                    pushChoice_(parts, o);
                }
            } else if (type === "info" || type === "accordion") {
                const title = payloadString_(item.title);
                const subtitle = payloadString_(item.subtitle);
                if (title && subtitle) {
                    parts.infoLines.push(`${title} — ${subtitle}`);
                } else if (title) {
                    parts.infoLines.push(title);
                } else if (subtitle) {
                    parts.infoLines.push(subtitle);
                }
            } else if (type === "description") {
                const title = payloadString_(item.title);
                if (title) {
                    parts.infoLines.push(title);
                }
                const textParts = item.text;
                if (Array.isArray(textParts)) {
                    for (const t of textParts) {
                        const s = payloadString_(t);
                        if (s) {
                            parts.infoLines.push(s);
                        }
                    }
                }
            } else if (type === "image") {
                const imgUrl = payloadString_(
                    item.rawUrl ?? item.accessRawUrl ?? item.url ?? item.imageUrl ?? item.image
                );
                if (isHttpsUrl_(imgUrl)) {
                    parts.images.push(imgUrl);
                }
                const alt = payloadString_(item.accessibilityText ?? item.alt);
                if (alt) {
                    parts.infoLines.push(alt);
                }
            } else if (type === "video") {
                mergeVideoFromItem_(parts, item);
            }
        }
    }
}

/**
 * @param {unknown} data Dialogflow detectIntent response
 * @returns {CxReplyParts}
 */
export function extractCxResponse_(data) {
    /** @type {CxReplyParts} */
    const parts = {
        texts: [],
        infoLines: [],
        images: [],
        choices: [],
        choicePrompt: "",
        cardCarousel: null,
        gallery: null,
        video: null,
        form: null,
        liveAgent: null
    };

    const messages = data?.queryResult?.responseMessages;
    if (!Array.isArray(messages)) {
        return parts;
    }

    for (const m of messages) {
        const textParts = m?.text?.text;
        if (Array.isArray(textParts)) {
            for (const t of textParts) {
                const s = trim_(t);
                if (s) {
                    parts.texts.push(s);
                }
            }
        }

        const body = normalizePayloadBody_(m?.payload);
        if (!body) {
            continue;
        }

        absorbActionPayload_(parts, body);
        absorbRichContent_(parts, body);

        const lateMsg = payloadString_(body.message);
        if (lateMsg && parts.choices.length && !parts.choicePrompt && !isGenericChoicePrompt_(lateMsg)) {
            parts.choicePrompt = lateMsg;
        }
    }

    if (parts.choices.length && (parts.gallery || parts.cardCarousel || parts.video)) {
        const prompt = trim_(parts.choicePrompt);
        if (isGenericChoicePrompt_(parts.choicePrompt)) {
            parts.choicePrompt = "";
        }
        parts.texts = parts.texts.filter((t) => {
            const s = trim_(t);
            return s && !isGenericChoicePrompt_(s) && !(prompt && promptsEquivalent_(s, prompt));
        });
    }

    return parts;
}

/** @param {CxReplyParts} parts */
export function choiceLabels_(parts) {
    return parts.choices.map((c) => c.label);
}

/** @param {CxReplyParts} parts */
export function choiceValues_(parts) {
    return parts.choices.map((c) => c.value);
}

/**
 * Build combined plain-text blocks (info lines, form/live-agent notices).
 * @param {CxReplyParts} parts
 * @param {string} [webChatUrl]
 */
export function supplementalTextBlocks_(parts, webChatUrl) {
    /** @type {string[]} */
    const blocks = [...parts.infoLines];
    if (parts.form) {
        const formName = parts.form.formId || parts.form.formKey || "details";
        let line = parts.form.message || `Please share your ${formName}.`;
        if (webChatUrl) {
            line += `\n\nOpen our chat form: ${webChatUrl}`;
        } else {
            line += "\n\nReply here with the information requested (name, mobile, email, etc.).";
        }
        blocks.push(line);
    }
    if (parts.liveAgent) {
        blocks.push(parts.liveAgent.message);
    }
    return blocks.filter(Boolean);
}

/** @param {string} raw */
export function parseYoutubeVideoId_(raw) {
    const s = trim_(raw);
    if (!s) {
        return "";
    }
    try {
        const u = new URL(s, "https://www.youtube.com");
        const host = u.hostname.replace(/^www\./i, "").toLowerCase();
        if (host === "youtu.be") {
            const id = u.pathname.replace(/^\//, "").split(/[/?#]/)[0];
            return id && /^[\w-]{11}$/.test(id) ? id : "";
        }
        if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
            const embedM = u.pathname.match(/\/embed\/([\w-]{11})/);
            if (embedM?.[1]) {
                return embedM[1];
            }
            const shortsM = u.pathname.match(/\/shorts\/([\w-]{11})/);
            if (shortsM?.[1]) {
                return shortsM[1];
            }
            const v = u.searchParams.get("v");
            if (v && /^[\w-]{11}$/.test(v)) {
                return v;
            }
        }
    } catch {
        /* ignore */
    }
    return "";
}

/** @param {string} videoId */
export function youtubeWatchUrl_(videoId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** @param {string} videoId */
export function youtubeThumbnailUrl_(videoId) {
    return `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/** @param {string} raw */
export function isDirectVideoFileUrl_(raw) {
    return /^https:\/\/.+\.(mp4|mov|m4v|webm)(\?|$)/i.test(trim_(raw));
}
