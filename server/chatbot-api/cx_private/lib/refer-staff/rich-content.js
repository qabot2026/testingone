/**
 * Parse Dialogflow ES / Messenger-style richContent from fulfillment payload.
 * GREEN: reads JSON already returned by detectIntent — no extra API cost.
 */

function structValueToJs(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  if (Object.prototype.hasOwnProperty.call(v, 'stringValue')) {
    return v.stringValue;
  }
  if (Object.prototype.hasOwnProperty.call(v, 'numberValue')) {
    return v.numberValue;
  }
  if (Object.prototype.hasOwnProperty.call(v, 'boolValue')) {
    return v.boolValue;
  }
  if (v.listValue && Array.isArray(v.listValue.values)) {
    return v.listValue.values.map(structValueToJs);
  }
  if (v.structValue) return structToJs(v.structValue);
  return v;
}

function structToJs(struct) {
  if (!struct || typeof struct !== 'object') return struct;
  if (struct.fields && typeof struct.fields === 'object') {
    const out = {};
    Object.keys(struct.fields).forEach((key) => {
      out[key] = structValueToJs(struct.fields[key]);
    });
    return out;
  }
  return struct;
}

function payloadToPlain(payload) {
  if (!payload) return null;
  if (payload.fields) return structToJs(payload);
  return payload;
}

function isSafeHttpUrl(href) {
  return /^https?:\/\//i.test(String(href || '').trim());
}

function infoImageUrl(item) {
  if (!item || typeof item !== 'object') return '';
  const direct = String(item.imageUrl || item.image_url || '').trim();
  if (isSafeHttpUrl(direct)) return direct;
  if (!item.image) return '';
  const img = item.image;
  return String(
    img.src?.rawUrl ||
      img.src?.url ||
      (typeof img.src === 'string' ? img.src : '') ||
      img.url ||
      img.rawUrl ||
      ''
  ).trim();
}

function parseAnchorHref(item) {
  if (!item || typeof item !== 'object') return '';
  const anchor = item.anchor || item.link;
  if (anchor && typeof anchor === 'object') {
    return String(anchor.href || anchor.url || '').trim();
  }
  if (typeof anchor === 'string') return anchor.trim();
  return String(item.href || item.url || item.link || item.fileUri || '').trim();
}

function parseDownloadEntry(item, fallbackLabel) {
  const href = parseAnchorHref(item);
  if (!isSafeHttpUrl(href)) return null;
  const fileName = String(item.name || item.fileName || item.title || '').trim();
  const label = String(
    item.text || item.label || fallbackLabel || fileName || 'Download'
  ).trim();
  const iconUrl = infoImageUrl(item);
  return {
    label: label || 'Download',
    href,
    iconUrl,
    fileName: fileName || label,
  };
}

function absorbDownloadList(items, downloads) {
  const list = Array.isArray(items) ? items : items ? [items] : [];
  list.forEach((item) => {
    const entry = parseDownloadEntry(item);
    if (entry) downloads.push(entry);
  });
}

/** Image gallery — open_gallery with urls[] */
function parseGallery(plain) {
  if (!plain || typeof plain !== 'object') return null;
  const action = String(plain.action || plain.type || '').trim();
  const rawUrls = plain.urls || plain.images || plain.gallery;
  if (!Array.isArray(rawUrls) || !rawUrls.length) return null;

  const isGallery =
    action === 'open_gallery' ||
    action === 'gallery' ||
    plain.type === 'open_gallery' ||
    plain.type === 'gallery' ||
    Object.prototype.hasOwnProperty.call(plain, 'urls');

  if (
    !isGallery &&
    action &&
    action !== 'open_gallery' &&
    action !== 'gallery'
  ) {
    return null;
  }

  const images = rawUrls
    .map((item) => {
      const url = String(
        item.url || item.src || item.image || item.href || ''
      ).trim();
      const name = String(item.name || item.title || item.label || '').trim();
      if (!isSafeHttpUrl(url)) return null;
      return { url, name: name || 'Image' };
    })
    .filter(Boolean);

  if (!images.length) return null;

  return {
    message: String(plain.message || plain.title || plain.prompt || '').trim(),
    action: action || 'open_gallery',
    images,
  };
}

function parseCarouselCardButtons(card) {
  const buttons = [];
  const raw = card.buttons || card.ctas;
  if (Array.isArray(raw)) {
    raw.forEach((btn) => {
      if (!btn || typeof btn !== 'object') return;
      const label = String(
        btn.label ?? btn.ctaLabel ?? btn.cta_label ?? btn.text ?? ''
      ).trim();
      const message = String(
        btn.value ??
          btn.ctaValue ??
          btn.cta_value ??
          btn.message ??
          btn.postback ??
          label
      ).trim();
      const href = String(btn.href ?? btn.url ?? btn.link ?? '').trim();
      if (!label) return;
      buttons.push({
        label,
        message: message || label,
        href: isSafeHttpUrl(href) ? href : '',
      });
    });
  }
  if (!buttons.length) {
    const ctaLabel = String(card.ctaLabel || card.cta_label || '').trim();
    if (ctaLabel) {
      const ctaMessage = String(
        card.ctaValue ??
          card.cta_value ??
          card.message ??
          card.postback ??
          ctaLabel
      ).trim();
      buttons.push({
        label: ctaLabel,
        message: ctaMessage || ctaLabel,
        href: '',
      });
    }
  }
  return buttons;
}

/** Property listing / product cards — open_card_carousel with cards[] */
function parseCardCarousel(plain) {
  if (!plain || typeof plain !== 'object') return null;
  const action = String(plain.action || plain.type || '').trim();
  if (action !== 'open_card_carousel') return null;
  const rawCards = plain.cards;
  if (!Array.isArray(rawCards) || !rawCards.length) return null;

  const cards = rawCards
    .map((card) => {
      if (!card || typeof card !== 'object') return null;
      const title = String(card.title || '').trim();
      const subtitle = String(card.subtitle || '').trim();
      const imageUrl = infoImageUrl(card);
      const buttons = parseCarouselCardButtons(card);
      const id = String(card.id || '').trim();
      if (!title && !subtitle && !imageUrl && !buttons.length) return null;
      const primary = buttons[0] || {};
      return {
        id,
        title,
        subtitle,
        imageUrl: isSafeHttpUrl(imageUrl) ? imageUrl : '',
        buttons,
        ctaLabel: primary.label || '',
        ctaMessage: primary.message || '',
      };
    })
    .filter(Boolean);

  if (!cards.length) return null;

  return {
    message: String(plain.message || plain.title || plain.prompt || '').trim(),
    action: 'open_card_carousel',
    cards,
  };
}

/** dfchat_inline_select — dropdown that sends selected value to Dialogflow */
function parseInlineSelect(plain) {
  if (!plain || typeof plain !== 'object') return null;
  const action = String(plain.action || plain.type || '').trim();
  const rawOptions = plain.options;
  if (!Array.isArray(rawOptions) || !rawOptions.length) return null;

  const isSelect =
    action === 'dfchat_inline_select' ||
    action === 'open_gallery' ||
    plain.type === 'dfchat_inline_select' ||
    plain.type === 'open_gallery' ||
    plain.type === 'select' ||
    plain.inlineSelect === true ||
    Object.prototype.hasOwnProperty.call(plain, 'placeholder');

  if (
    !isSelect &&
    action &&
    action !== 'dfchat_inline_select' &&
    action !== 'select' &&
    action !== 'open_gallery'
  ) {
    return null;
  }

  const options = rawOptions
    .map((opt) => {
      const value = String(
        opt.value ?? opt.text ?? opt.label ?? opt.message ?? ''
      ).trim();
      const label = String(
        opt.label ?? opt.text ?? opt.value ?? opt.message ?? ''
      ).trim();
      if (!value && !label) return null;
      return {
        value: value || label,
        label: label || value,
      };
    })
    .filter(Boolean);

  if (!options.length) return null;

  const message = String(plain.message || plain.title || plain.prompt || '').trim();
  const hasExplicitPlaceholder =
    plain.placeholder != null && String(plain.placeholder).trim() !== '';
  const explicitPlaceholder = hasExplicitPlaceholder
    ? String(plain.placeholder).trim()
    : '';
  const placeholder = message || explicitPlaceholder || 'Choose…';

  return {
    message,
    placeholder,
    action: action || 'dfchat_inline_select',
    options,
  };
}

const OPEN_FORM_RESERVED_KEYS = new Set([
  'action',
  'type',
  'form_id',
  'formId',
  'form',
  'message',
  'title',
  'prompt',
  'onSubmit',
  'on_submit',
  'onCancel',
  'on_cancel',
  'onResend',
  'on_resend',
  'resendOtp',
  'next_form_id',
  'nextFormId',
  'following_form_id',
  'followingFormId',
  'third_form_id',
  'thirdFormId',
  'next_form_ids',
  'nextFormIds',
  'tag',
  'upload_tag',
  'prefill',
  'field_values',
  'defaults',
  'context',
]);

function isSessionPlaceholder(val) {
  const s = String(val || '').trim();
  return (
    !s ||
    /^\$session\.params\./i.test(s) ||
    /^\{\{/.test(s) ||
    /^#[A-Za-z0-9_.-]+/.test(s)
  );
}

function sessionPlaceholderKey(val) {
  const s = String(val || '').trim();
  const m = s.match(/^\$session\.params\.([A-Za-z0-9_.-]+)$/i);
  return m ? m[1] : '';
}

/** ES: #parameter or #context-name.parameter → parameter key */
function parameterReferenceKey(val) {
  const s = String(val || '').trim();
  const cx = sessionPlaceholderKey(s);
  if (cx) return cx;
  const es = s.match(/^#(?:[A-Za-z0-9_-]+\.)?([A-Za-z0-9_.-]+)$/);
  return es ? es[1] : '';
}

/** Dialogflow ES/CX struct parameters → plain object for widget prefill. */
function parametersStructToPlain(params) {
  if (!params || typeof params !== 'object') return {};
  if (params.fields && typeof params.fields === 'object') {
    const out = {};
    Object.keys(params.fields).forEach((key) => {
      const v = structValueToJs(params.fields[key]);
      if (v == null) return;
      if (typeof v === 'object') {
        out[key] = JSON.stringify(v);
        return;
      }
      const s = String(v).trim();
      if (s) out[key] = s;
    });
    return out;
  }
  const out = {};
  Object.keys(params).forEach((key) => {
    const v = params[key];
    if (v == null) return;
    if (typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'stringValue')) {
      const s = String(v.stringValue || '').trim();
      if (s) out[key] = s;
      return;
    }
    const s = String(v).trim();
    if (s) out[key] = s;
  });
  return out;
}

function resolvePrefillValue(raw, sessionParams) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const key = parameterReferenceKey(s);
  if (key && sessionParams && sessionParams[key] != null) {
    return String(sessionParams[key]).trim();
  }
  return s;
}

/** Dialogflow ES: intent parameters + active output context parameters. */
function collectEsSessionParameters(queryResult) {
  const out = {};
  if (!queryResult || typeof queryResult !== 'object') return out;
  Object.assign(out, parametersStructToPlain(queryResult.parameters));
  (queryResult.outputContexts || []).forEach((ctx) => {
    if (!ctx || typeof ctx !== 'object') return;
    Object.assign(out, parametersStructToPlain(ctx.parameters));
  });
  return out;
}

/** Merge DF session/intent params into open_form prefill (ES contexts / CX session params). */
function enrichOpenFormWithSessionParams(form, sessionParams) {
  if (!form || typeof form !== 'object') return form;
  const params = sessionParams && typeof sessionParams === 'object' ? sessionParams : {};
  const prefill = { ...(form.prefill && typeof form.prefill === 'object' ? form.prefill : {}) };

  Object.keys(prefill).forEach((key) => {
    prefill[key] = resolvePrefillValue(prefill[key], params);
  });

  const mergeKeys = [
    'name',
    'mobile',
    'phone',
    'email',
    'appointmentdate',
    'appointment_date',
    'appointmenttime',
    'appointment_time',
  ];
  mergeKeys.forEach((key) => {
    if (params[key] == null) return;
    const val = String(params[key]).trim();
    if (!val) return;
    if (!prefill[key]) prefill[key] = val;
  });
  if (!prefill.appointmentdate && prefill.appointment_date) {
    prefill.appointmentdate = prefill.appointment_date;
  }
  if (!prefill.appointmenttime && prefill.appointment_time) {
    prefill.appointmenttime = prefill.appointment_time;
  }
  if (!prefill.mobile && prefill.phone) prefill.mobile = prefill.phone;

  return { ...form, prefill };
}

function extractOpenFormPrefill(plain) {
  const prefill = {
    ...(plain.prefill && typeof plain.prefill === 'object' ? plain.prefill : {}),
    ...(plain.field_values && typeof plain.field_values === 'object'
      ? plain.field_values
      : {}),
    ...(plain.defaults && typeof plain.defaults === 'object' ? plain.defaults : {}),
    ...(plain.context && typeof plain.context === 'object' ? plain.context : {}),
  };
  Object.keys(plain).forEach((key) => {
    if (OPEN_FORM_RESERVED_KEYS.has(key)) return;
    const val = plain[key];
    if (val == null || typeof val === 'object') return;
    const s = String(val).trim();
    if (isSessionPlaceholder(s)) return;
    prefill[key] = s;
  });
  return prefill;
}

/** open_form — in-chat form card (definitions in /public/forms/*.js) */
function parseOpenForm(plain) {
  if (!plain || typeof plain !== 'object') return null;
  const action = String(plain.action || plain.type || '').trim().toLowerCase();
  const formId = String(
    plain.form_id || plain.formId || plain.form || ''
  ).trim();
  const isForm =
    action === 'open_form' ||
    plain.type === 'open_form' ||
    !!formId;
  if (!isForm || !formId) return null;

  const chainRaw = [
    plain.next_form_id,
    plain.nextFormId,
    plain.following_form_id,
    plain.followingFormId,
    plain.third_form_id,
    plain.thirdFormId,
  ];
  const nextFormIds = chainRaw
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (Array.isArray(plain.next_form_ids || plain.nextFormIds)) {
    (plain.next_form_ids || plain.nextFormIds).forEach((id) => {
      const s = String(id || '').trim();
      if (s && nextFormIds.indexOf(s) < 0) nextFormIds.push(s);
    });
  }

  return {
    formId,
    message: String(plain.message || plain.title || plain.prompt || '').trim(),
    nextFormId: nextFormIds[0] || '',
    nextFormIds,
    onSubmit: String(plain.onSubmit || plain.on_submit || '').trim(),
    onCancel: String(plain.onCancel || plain.on_cancel || '').trim(),
    onResend: String(plain.onResend || plain.on_resend || plain.resendOtp || '').trim(),
    tag: String(plain.tag || plain.upload_tag || '').trim(),
    prefill: extractOpenFormPrefill(plain),
  };
}

function isCardRichType(type) {
  const t = (type || '').toLowerCase();
  return t === 'info' || t === 'description' || t === 'accordion' || t === 'card';
}

function parseInfoCard(item, rowChipOptions) {
  const title = String(item.title || '').trim();
  const subtitle = String(item.subtitle || '').trim();
  const body = String(
    item.text || item.description || item.body || ''
  ).trim();
  const imageUrl = infoImageUrl(item);
  const actionLink = String(
    item.actionLink || item.actionUri || item.url || ''
  ).trim();
  const buttons = [];

  (item.buttons || []).forEach((btn) => {
    const label = String(btn.text || btn.label || '').trim();
    if (!label) return;
    let href = String(btn.link || btn.url || btn.actionLink || '').trim();
    if (!href && actionLink && /\b(view|map|location|open|visit|website)\b/i.test(label)) {
      href = actionLink;
    }
    buttons.push({
      label,
      message: String(btn.message || btn.postback || label).trim(),
      href,
      download: isSafeHttpUrl(href),
    });
  });

  (rowChipOptions || []).forEach((opt) => {
    const label = String(opt.text || opt.label || '').trim();
    if (!label) return;
    const href = parseAnchorHref(opt) || String(opt.link || opt.url || '').trim();
    buttons.push({
      label,
      message: String(opt.message || opt.postback || opt.text || opt.label).trim() || label,
      href,
      download: isSafeHttpUrl(href),
    });
  });

  if (!buttons.length && actionLink) {
    buttons.push({
      label: 'View',
      message: '',
      href: actionLink,
    });
  }

  if (!title && !subtitle && !body && !imageUrl && !buttons.length) return null;

  return { title, subtitle, body, imageUrl, actionLink, buttons };
}

function parseRichContentRows(richContent) {
  const chips = [];
  const infoCards = [];
  const downloads = [];
  let chipHeading = '';

  if (!Array.isArray(richContent)) {
    return { chips, chipHeading, infoCards, downloads };
  }

  richContent.forEach((row) => {
    if (!Array.isArray(row)) return;

    const rowChipOptions = [];
    let rowHasCard = false;

    row.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const type = (item.type || '').toLowerCase();

      if (type === 'chips' && Array.isArray(item.options)) {
        item.options.forEach((opt) => rowChipOptions.push(opt));
      }

      if (type === 'list' && item.title) {
        const t = String(item.title).trim();
        if (t && !chipHeading) chipHeading = t;
      }

      if (isCardRichType(type)) rowHasCard = true;

      if (type === 'button') {
        const entry = parseDownloadEntry(item);
        if (entry) downloads.push(entry);
      }

      if (type === 'files' && Array.isArray(item.files)) {
        item.files.forEach((f) => {
          const entry = parseDownloadEntry(f);
          if (entry) downloads.push(entry);
        });
      }

      if (type === 'file') {
        const entry = parseDownloadEntry(item);
        if (entry) downloads.push(entry);
      }
    });

    row.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const type = (item.type || '').toLowerCase();

      if (isCardRichType(type)) {
        const card = parseInfoCard(item, rowChipOptions);
        if (card) infoCards.push(card);
      }
    });

    if (!rowHasCard && rowChipOptions.length) {
      rowChipOptions.forEach((opt) => {
        const label = String(opt.text || opt.label || '').trim();
        if (!label) return;
        const href = parseAnchorHref(opt) || String(opt.link || opt.url || '').trim();
        if (isSafeHttpUrl(href)) {
          const entry = parseDownloadEntry(
            { ...opt, text: label, anchor: { href } },
            label
          );
          if (entry) {
            downloads.push(entry);
            return;
          }
        }
        chips.push({
          label,
          message: String(opt.message || opt.text || opt.label).trim() || label,
          href,
        });
      });
    }
  });

  return { chips, chipHeading, infoCards, downloads };
}

/** [label](https://...) in bot text or custom payload `message` */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function parseMarkdownMessage(raw) {
  const str = String(raw || '').trim();
  if (!str) return { parts: [], plainText: '' };

  const parts = [];
  let lastIndex = 0;
  let hasLink = false;
  let match;

  MARKDOWN_LINK_RE.lastIndex = 0;
  while ((match = MARKDOWN_LINK_RE.exec(str)) !== null) {
    hasLink = true;
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: str.slice(lastIndex, match.index) });
    }
    const label = String(match[1] || '').trim();
    const href = String(match[2] || '').trim();
    if (label && isSafeHttpUrl(href)) {
      parts.push({ type: 'link', text: label, href });
    } else {
      parts.push({ type: 'text', text: match[0] });
    }
    lastIndex = MARKDOWN_LINK_RE.lastIndex;
  }

  if (!hasLink) {
    return { parts: [{ type: 'text', text: str }], plainText: str };
  }

  if (lastIndex < str.length) {
    parts.push({ type: 'text', text: str.slice(lastIndex) });
  }

  const plainText = parts
    .map((p) => (p.type === 'link' ? p.text : p.text))
    .join('');

  return { parts, plainText };
}

/** Dialogflow ES Text response — keep newlines / nested list indent inside one block. */
function absorbMessageLine(line, textParts, replyParts) {
  const str = String(line ?? '');
  if (!str.trim() && !/\u200B/.test(str)) {
    textParts.push('');
    return;
  }
  const block = str.trim();
  if (block === '{}' || block === '[]') return;
  const md = parseMarkdownMessage(block);
  if (md.parts.some((p) => p.type === 'link')) {
    md.parts.forEach((p) => replyParts.push(p));
    return;
  }
  if (md.plainText) textParts.push(block);
}

function looksLikeMessageSyntax(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  return (
    /\*\*[^*]+\*\*/.test(s) ||
    /(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)/.test(s) ||
    /~~[^~]+~~/.test(s) ||
    /`[^`\n]+`/.test(s) ||
    /^#{1,6}\s/m.test(s) ||
    /^\s*[-*]\s/m.test(s) ||
    /^\s*\d+\.\s/m.test(s) ||
    /^\s*\u200B\s*$/m.test(s) ||
    /\[([^\]]+)\]\(([^)]+)\)/.test(s)
  );
}

function finalizeDialogflowText(textParts) {
  const joined = textParts.join('\n');
  if (looksLikeMessageSyntax(joined)) return joined.trim();
  return dedupeLines(textParts).join('\n').trim();
}

function dedupeLines(lines) {
  const out = [];
  const seen = new Set();
  (lines || []).forEach((line) => {
    const t = String(line || '').trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  });
  return out;
}

function payloadMatchesChannel(plain, channel) {
  if (!plain || !channel) return true;
  const raw = plain.channels || plain.showOn;
  if (!raw) return true;
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((ch) => String(ch || '').trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  const normalized = String(channel).trim().toLowerCase();
  return list.includes(normalized);
}

function parseFulfillmentMessages(fulfillmentMessages, options) {
  const textParts = [];
  const replyParts = [];
  const chips = [];
  const infoCards = [];
  const downloads = [];
  const dropdowns = [];
  const galleries = [];
  const cardCarousels = [];
  const forms = [];
  const chipSeen = new Set();
  const downloadSeen = new Set();
  let chipHeading = '';
  let liveAgent = false;
  let liveAgentMessage = '';
  let liveAgentDepartment = '';
  let hasDfTextResponse = false;

  (fulfillmentMessages || []).forEach((msg) => {
    /* Dialogflow ES: intent → Text response(s) → fulfillmentMessages[].text.text[] */
    if (msg.text && Array.isArray(msg.text.text)) {
      msg.text.text.forEach((t) => {
        if (String(t || '').trim()) hasDfTextResponse = true;
        absorbMessageLine(t, textParts, replyParts);
      });
    }

    const plain = payloadToPlain(msg.payload);
    if (!plain) return;
    if (!payloadMatchesChannel(plain, options && options.channel)) return;

    if (plain.action === 'request_live_agent') {
      liveAgent = true;
      if (plain.message) {
        liveAgentMessage = String(plain.message).trim();
      }
      const dept =
        plain.department ||
        plain.departmentName ||
        plain.departmentId ||
        plain.dept;
      if (dept != null && String(dept).trim()) {
        liveAgentDepartment = String(dept).trim();
      }
    }

    const gallery = parseGallery(plain);
    const inlineSelect = parseInlineSelect(plain);
    const cardCarousel = parseCardCarousel(plain);
    const openForm = parseOpenForm(plain);
    if (gallery) galleries.push(gallery);
    if (inlineSelect) dropdowns.push(inlineSelect);
    if (cardCarousel) cardCarousels.push(cardCarousel);
    if (openForm) forms.push(openForm);
    if (
      !gallery &&
      !inlineSelect &&
      !cardCarousel &&
      !openForm &&
      plain.message
    ) {
      absorbMessageLine(String(plain.message), textParts, replyParts);
    }

    absorbDownloadList(plain.download || plain.downloads || plain.document, downloads);
    absorbDownloadList(plain.files, downloads);

    const rich =
      plain.richContent ||
      (plain.google && plain.google.richContent) ||
      null;

    if (!rich) return;

    const parsed = parseRichContentRows(rich);
    if (parsed.chipHeading && !chipHeading) {
      chipHeading = parsed.chipHeading;
    }
    parsed.chips.forEach((chip) => {
      const key = chip.message.toLowerCase();
      if (chipSeen.has(key)) return;
      chipSeen.add(key);
      chips.push(chip);
    });
    parsed.infoCards.forEach((card) => infoCards.push(card));
    parsed.downloads.forEach((entry) => {
      const key = entry.href.toLowerCase();
      if (downloadSeen.has(key)) return;
      downloadSeen.add(key);
      downloads.push(entry);
    });
  });

  return {
    textParts,
    replyText: finalizeDialogflowText(textParts),
    replyParts,
    hasDfTextResponse,
    chips,
    chipHeading,
    infoCards,
    downloads,
    dropdowns,
    galleries,
    cardCarousels,
    forms,
    liveAgent,
    liveAgentMessage,
    liveAgentDepartment,
  };
}

module.exports = {
  parseFulfillmentMessages,
  parseGallery,
  parseCardCarousel,
  parseInlineSelect,
  parseOpenForm,
  parseMarkdownMessage,
  payloadToPlain,
  parseRichContentRows,
  parseInfoCard,
  parametersStructToPlain,
  enrichOpenFormWithSessionParams,
};
