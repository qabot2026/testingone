/**
 * Dialogflow rich payloads → Messenger / Instagram Send API
 * (quick replies, button templates, generic templates, text)
 */

const meta = require('./meta-shared');
const channelSessions = require('./channel-sessions');
const messengerMediaUpload = require('./messenger-media-upload');

const SAFE_HTTP = /^https?:\/\//i;

function trim(v) {
  return String(v == null ? '' : v).trim();
}

function truncate(str, max) {
  const s = trim(str);
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function slugPayload(prefix, text, index) {
  const base = trim(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 180);
  return `${prefix}_${index}_${base || 'opt'}`.slice(0, 256);
}

function isLinkChip(chip) {
  const href = trim(chip && chip.href);
  return SAFE_HTTP.test(href);
}

function chipMessage(chip) {
  return trim((chip && chip.message) || (chip && chip.label)) || 'Option';
}

function chipLabel(chip) {
  return trim((chip && chip.label) || chipMessage(chip)) || 'Option';
}

function mainBodyText(result) {
  return trim(
    result.replyChannel || result.outboundText || result.reply || ''
  );
}

async function sendText(recipientId, text) {
  const body = trim(text);
  if (!body) return null;
  return meta.sendMessengerText(recipientId, body);
}

async function sendPayload(recipientId, message) {
  if (!meta.isMessengerConfigured()) throw new Error('Messenger not configured');
  return meta.sendMessengerPayload(recipientId, message);
}

async function sendQuickReplies(recipientId, bodyText, options) {
  const opts = (options || []).slice(0, 13);
  if (!opts.length) return null;
  const text = truncate(bodyText || 'Please select an option', 2000);
  return sendPayload(recipientId, {
    text,
    quick_replies: opts.map((opt, i) => ({
      content_type: 'text',
      title: truncate(opt.label, 20),
      payload: truncate(opt.sendText || opt.label, 1000) || slugPayload('chip', opt.sendText, i),
    })),
  });
}

async function sendButtonTemplate(recipientId, bodyText, buttons) {
  const btns = (buttons || []).slice(0, 3);
  if (!btns.length) return null;
  const text = truncate(bodyText || 'Please select an option', 640);
  return sendPayload(recipientId, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: btns.map((btn, i) => {
          if (btn.url && SAFE_HTTP.test(btn.url)) {
            return {
              type: 'web_url',
              title: truncate(btn.label, 20),
              url: btn.url,
            };
          }
          return {
            type: 'postback',
            title: truncate(btn.label, 20),
            payload: truncate(btn.sendText || btn.label, 1000) || slugPayload('btn', btn.sendText || btn.label, i),
          };
        }),
      },
    },
  });
}

async function sendGenericElements(recipientId, elements) {
  const list = (elements || []).slice(0, 10);
  if (!list.length) return null;
  return sendPayload(recipientId, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: list,
      },
    },
  });
}

async function sendImage(recipientId, imageUrl) {
  const link = trim(imageUrl);
  if (!SAFE_HTTP.test(link)) return null;
  return sendPayload(recipientId, {
    attachment: {
      type: 'image',
      payload: { url: link, is_reusable: true },
    },
  });
}

async function sendSelectOptions(recipientId, heading, placeholder, options) {
  const rows = (options || []).map((opt, i) => ({
    label: trim(opt.label || opt.value),
    sendText: trim(opt.value || opt.label),
  }));
  if (rows.length <= 13) {
    return sendQuickReplies(recipientId, heading || placeholder, rows);
  }
  const lines = rows.map((r, i) => `${i + 1}. ${r.label}`);
  return sendText(
    recipientId,
    [trim(heading || placeholder), ...lines].filter(Boolean).join('\n')
  );
}

async function sendChips(recipientId, heading, chips) {
  const actionChips = (chips || []).filter((c) => c && !isLinkChip(c));
  if (!actionChips.length) return null;

  const rows = actionChips.map((chip) => ({
    label: chipLabel(chip),
    sendText: chipMessage(chip),
  }));

  const fallbackText = () => {
    const lines = rows.map((r, i) => `${i + 1}. ${r.label}`);
    return [trim(heading), ...lines].filter(Boolean).join('\n');
  };

  try {
    if (rows.length <= 3) {
      return await sendButtonTemplate(
        recipientId,
        heading,
        rows.map((r) => ({ label: r.label, sendText: r.sendText }))
      );
    }
    if (rows.length <= 13) {
      return await sendQuickReplies(recipientId, heading, rows);
    }
    return await sendText(recipientId, fallbackText());
  } catch (err) {
    console.warn('[messenger-rich] chips fallback:', err.message);
    return sendText(recipientId, fallbackText());
  }
}

async function sendLinkChips(recipientId, chips) {
  const links = (chips || [])
    .filter(isLinkChip)
    .map((c) => `• ${chipLabel(c)}: ${trim(c.href)}`);
  if (!links.length) return null;
  return sendText(recipientId, links.join('\n'));
}

async function sendDownloads(recipientId, downloads) {
  const items = Array.isArray(downloads) ? downloads : [];
  if (!items.length) return null;

  for (const item of items) {
    const label = trim(item.label || item.fileName || 'Download');
    const href = trim(item.href);
    if (!SAFE_HTTP.test(href)) continue;
    await sendText(recipientId, `${label}\n${href}`);
  }
}

function buildGenericElement(card) {
  const title = truncate(trim(card.title) || 'Info', 80);
  const subtitle = truncate(
    [trim(card.subtitle), trim(card.body)].filter(Boolean).join('\n'),
    80
  );
  const imageUrl = trim(card.imageUrl);
  const element = { title, subtitle };
  if (SAFE_HTTP.test(imageUrl)) element.image_url = imageUrl;

  const buttons = Array.isArray(card.buttons) ? card.buttons : [];
  const mapped = buttons.slice(0, 3).map((b, i) => {
    const href = trim(b.href);
    if (SAFE_HTTP.test(href)) {
      return {
        type: 'web_url',
        title: truncate(trim(b.label || 'Open'), 20),
        url: href,
      };
    }
    return {
      type: 'postback',
      title: truncate(trim(b.label || 'Select'), 20),
      payload: truncate(trim(b.message || b.label), 1000) || slugPayload('card', trim(b.message || b.label), i),
    };
  });
  if (mapped.length) element.buttons = mapped;
  return element;
}

async function sendInfoCards(recipientId, cards) {
  const list = Array.isArray(cards) ? cards : [];
  const elements = list.map(buildGenericElement).filter((e) => e.title);
  if (elements.length) {
    await sendGenericElements(recipientId, elements);
  }
}

async function sendGalleries(recipientId, galleries) {
  const list = Array.isArray(galleries) ? galleries : [];
  for (const gallery of list) {
    const prompt = trim(gallery.message);
    if (prompt) await sendText(recipientId, prompt);
    const images = Array.isArray(gallery.images) ? gallery.images : [];
    for (const img of images.slice(0, 5)) {
      const url = trim(typeof img === 'string' ? img : img.url || img.src);
      if (SAFE_HTTP.test(url)) await sendImage(recipientId, url);
    }
    const urls = images
      .map((img) => trim(typeof img === 'string' ? img : img.url || img.src))
      .filter((u) => SAFE_HTTP.test(u));
    if (urls.length > 5) {
      await sendText(
        recipientId,
        urls.map((u, i) => `${i + 1}. ${u}`).join('\n')
      );
    }
  }
}

async function sendCardCarousels(recipientId, carousels) {
  const list = Array.isArray(carousels) ? carousels : [];
  for (const carousel of list) {
    const prompt = trim(carousel.message);
    if (prompt) await sendText(recipientId, prompt);
    const cards = Array.isArray(carousel.cards) ? carousel.cards : [];
    const elements = cards.map(buildGenericElement).filter((e) => e.title);
    if (elements.length) await sendGenericElements(recipientId, elements);
  }
}

async function sendForms(recipientId, forms, sessionPrefix) {
  const list = Array.isArray(forms) ? forms : [];
  const uid = String(recipientId || '').trim();
  if (uid && list.length && sessionPrefix) {
    const sessionId = channelSessions.sessionIdFor(sessionPrefix, uid);
    messengerMediaUpload.markUploadForms(sessionId, list);
  }
  for (const form of list) {
    const lines = [];
    const title = trim(form.title || form.formId || form.form_id);
    const prompt = trim(form.message || form.prompt);
    if (title) lines.push(title);
    if (prompt) lines.push(prompt);
    const fields = Array.isArray(form.fields) ? form.fields : [];
    fields.forEach((field, i) => {
      const label = trim(field.label || field.name || field.id || `Field ${i + 1}`);
      const required = field.required ? ' (required)' : '';
      lines.push(`${i + 1}. ${label}${required}`);
    });
    if (fields.length) {
      lines.push('');
      lines.push(
        'You can send photos or documents (PDF, Word) here anytime — videos are not accepted.'
      );
    }
    await sendText(recipientId, lines.join('\n'));
  }
}

/**
 * Send full Dialogflow result to Instagram / Facebook.
 * @param {string} recipientId
 * @param {object} result
 * @param {{ sessionPrefix?: string }} [opts]
 */
async function deliverDialogflowResult(recipientId, result, opts) {
  if (!result || !meta.isMessengerConfigured()) return [];

  const sessionPrefix = opts && opts.sessionPrefix ? opts.sessionPrefix : '';
  const sent = [];
  const parts = Array.isArray(result.replyParts)
    ? result.replyParts.filter((p) => p && trim(p.text))
    : [];

  if (parts.length > 1) {
    for (const part of parts) {
      await sendText(recipientId, part.text);
      sent.push({ type: 'text', part: true });
    }
  } else {
    const body = mainBodyText(result);
    if (body) {
      await sendText(recipientId, body);
      sent.push({ type: 'text' });
    }
  }

  const heading = trim(result.chipHeading);
  const chips = Array.isArray(result.chips) ? result.chips : [];

  await sendLinkChips(recipientId, chips);
  const chipInteractive = await sendChips(
    recipientId,
    heading || (chips.length ? 'Please select an option' : ''),
    chips
  );
  if (chipInteractive) sent.push({ type: 'chips' });

  for (const dropdown of result.dropdowns || []) {
    await sendSelectOptions(
      recipientId,
      trim(dropdown.message),
      trim(dropdown.placeholder || 'Choose'),
      dropdown.options || []
    );
    sent.push({ type: 'dropdown' });
  }

  await sendDownloads(recipientId, result.downloads);
  if (result.downloads && result.downloads.length) sent.push({ type: 'downloads' });

  await sendInfoCards(recipientId, result.infoCards);
  if (result.infoCards && result.infoCards.length) sent.push({ type: 'infoCards' });

  await sendGalleries(recipientId, result.galleries);
  if (result.galleries && result.galleries.length) sent.push({ type: 'galleries' });

  await sendCardCarousels(recipientId, result.cardCarousels);
  if (result.cardCarousels && result.cardCarousels.length) {
    sent.push({ type: 'cardCarousels' });
  }

  await sendForms(recipientId, result.forms, sessionPrefix);
  if (result.forms && result.forms.length) sent.push({ type: 'forms' });

  return sent;
}

module.exports = {
  deliverDialogflowResult,
  sendText,
  sendChips,
  sendQuickReplies,
  sendButtonTemplate,
};
