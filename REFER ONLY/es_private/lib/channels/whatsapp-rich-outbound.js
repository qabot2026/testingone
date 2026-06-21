/**
 * Dialogflow rich payloads → WhatsApp Cloud API messages
 * (chips, lists, downloads, info cards, galleries, forms, carousels)
 */

const meta = require('./meta-shared');
const channelSessions = require('./channel-sessions');
const waMediaUpload = require('./whatsapp-media-upload');

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

function slugId(prefix, text, index) {
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

async function sendText(to, text) {
  const body = trim(text);
  if (!body) return null;
  return meta.sendWhatsAppText(to, body);
}

async function sendPayload(to, payload) {
  if (!meta.isWhatsAppConfigured()) throw new Error('WhatsApp not configured');
  return meta.sendWhatsAppPayload(to, payload);
}

async function sendImage(to, imageUrl, caption) {
  const link = trim(imageUrl);
  if (!SAFE_HTTP.test(link)) return null;
  return sendPayload(to, {
    type: 'image',
    image: {
      link,
      caption: truncate(caption, 1024) || undefined,
    },
  });
}

async function sendDocument(to, link, filename, caption) {
  const url = trim(link);
  if (!SAFE_HTTP.test(url)) return null;
  return sendPayload(to, {
    type: 'document',
    document: {
      link: url,
      filename: truncate(filename, 240) || 'file',
      caption: truncate(caption, 1024) || undefined,
    },
  });
}

async function sendReplyButtons(to, bodyText, options) {
  const opts = (options || []).slice(0, 3);
  if (!opts.length) return null;
  const body = truncate(bodyText || 'Please select an option', 1024);
  return sendPayload(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: opts.map((opt, i) => ({
          type: 'reply',
          reply: {
            id: slugId('chip', opt.sendText, i),
            title: truncate(opt.label, 20),
          },
        })),
      },
    },
  });
}

async function sendListMessage(to, bodyText, buttonLabel, rows, sectionTitle) {
  const listRows = (rows || []).slice(0, 10);
  if (!listRows.length) return null;
  const body = truncate(bodyText || 'Please select an option', 1024);
  return sendPayload(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: truncate(buttonLabel || 'Options', 20),
        sections: [
          {
            title: truncate(sectionTitle || 'Menu', 24),
            rows: listRows.map((row, i) => ({
              id: slugId('list', row.sendText, i),
              title: truncate(row.label, 24),
              description: row.description
                ? truncate(row.description, 72)
                : undefined,
            })),
          },
        ],
      },
    },
  });
}

async function sendSelectOptions(to, heading, placeholder, options) {
  const rows = (options || []).map((opt, i) => ({
    label: trim(opt.label || opt.value),
    sendText: trim(opt.value || opt.label),
    description: '',
  }));
  if (rows.length <= 3) {
    return sendReplyButtons(to, heading || placeholder, rows);
  }
  return sendListMessage(
    to,
    heading || placeholder,
    placeholder || 'Choose',
    rows,
    heading || 'Options'
  );
}

async function sendChips(to, heading, chips) {
  const actionChips = (chips || []).filter((c) => c && !isLinkChip(c));
  if (!actionChips.length) return null;

  const rows = actionChips.map((chip, i) => ({
    label: chipLabel(chip),
    sendText: chipMessage(chip),
    description:
      chipMessage(chip) !== chipLabel(chip) ? chipMessage(chip) : '',
  }));

  const fallbackText = () => {
    const lines = rows.map((r, i) => `${i + 1}. ${r.label}`);
    return [trim(heading), ...lines].filter(Boolean).join('\n');
  };

  try {
    if (rows.length <= 3) {
      return await sendReplyButtons(to, heading, rows);
    }
    return await sendListMessage(to, heading, 'Options', rows, heading || 'Menu');
  } catch (err) {
    console.warn('[whatsapp-rich] chips fallback:', err.message);
    return sendText(to, fallbackText());
  }
}

async function sendLinkChips(to, chips) {
  const links = (chips || [])
    .filter(isLinkChip)
    .map((c) => `• ${chipLabel(c)}: ${trim(c.href)}`);
  if (!links.length) return null;
  return sendText(to, links.join('\n'));
}

async function sendDownloads(to, downloads) {
  const items = Array.isArray(downloads) ? downloads : [];
  if (!items.length) return null;

  for (const item of items) {
    const label = trim(item.label || item.fileName || 'Download');
    const href = trim(item.href);
    if (!SAFE_HTTP.test(href)) continue;
    const lower = href.toLowerCase();
    const isDoc =
      /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|csv)(\?|$)/i.test(lower);
    if (isDoc) {
      await sendDocument(to, href, item.fileName || label, label);
    } else {
      await sendText(to, `${label}\n${href}`);
    }
  }
}

async function sendInfoCards(to, cards) {
  const list = Array.isArray(cards) ? cards : [];
  for (const card of list) {
    const title = trim(card.title);
    const subtitle = trim(card.subtitle);
    const body = trim(card.body);
    const caption = [title, subtitle, body].filter(Boolean).join('\n');
    const imageUrl = trim(card.imageUrl);

    if (SAFE_HTTP.test(imageUrl)) {
      await sendImage(to, imageUrl, caption);
    } else if (caption) {
      await sendText(to, caption);
    }

    const buttons = Array.isArray(card.buttons) ? card.buttons : [];
    const btnChips = buttons.map((b) => ({
      label: trim(b.label || 'Open'),
      message: trim(b.message || b.label || 'Open'),
      href: trim(b.href),
    }));
    await sendLinkChips(to, btnChips.filter(isLinkChip));
    await sendChips(to, '', btnChips.filter((b) => !isLinkChip(b)));
  }
}

async function sendGalleries(to, galleries) {
  const list = Array.isArray(galleries) ? galleries : [];
  for (const gallery of list) {
    const prompt = trim(gallery.message);
    if (prompt) await sendText(to, prompt);
    const images = Array.isArray(gallery.images) ? gallery.images : [];
    for (const img of images.slice(0, 5)) {
      const url = trim(typeof img === 'string' ? img : img.url || img.src);
      if (SAFE_HTTP.test(url)) {
        await sendImage(to, url, trim(img.caption || img.title || ''));
      }
    }
    const urls = images
      .map((img) => trim(typeof img === 'string' ? img : img.url || img.src))
      .filter((u) => SAFE_HTTP.test(u));
    if (urls.length > 5) {
      await sendText(to, urls.map((u, i) => `${i + 1}. ${u}`).join('\n'));
    }
  }
}

async function sendCardCarousels(to, carousels) {
  const list = Array.isArray(carousels) ? carousels : [];
  for (const carousel of list) {
    const prompt = trim(carousel.message);
    if (prompt) await sendText(to, prompt);
    const cards = Array.isArray(carousel.cards) ? carousel.cards : [];
    for (const card of cards) {
      await sendInfoCards(to, [card]);
    }
  }
}

async function sendForms(to, forms) {
  const list = Array.isArray(forms) ? forms : [];
  const phone = String(to || '').replace(/\D/g, '');
  if (phone && list.length) {
    const sessionId = channelSessions.sessionIdFor('wa', phone);
    waMediaUpload.markWaUploadForms(sessionId, list);
  }
  for (const form of list) {
    const lines = [];
    const title = trim(form.title || form.formId || form.form_id);
    const prompt = trim(form.message || form.prompt);
    if (title) lines.push(`*${title}*`);
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
        'You can send photos or documents (PDF, Word) here anytime (attachment icon) — videos are not accepted.'
      );
    }
    await sendText(to, lines.join('\n'));
  }
}

/**
 * Send full Dialogflow result to WhatsApp (text + all rich types).
 */
async function deliverDialogflowResult(to, result) {
  if (!result || !meta.isWhatsAppConfigured()) return [];

  const sent = [];
  const parts = Array.isArray(result.replyParts)
    ? result.replyParts.filter((p) => p && trim(p.text))
    : [];

  if (parts.length > 1) {
    for (const part of parts) {
      await sendText(to, part.text);
      sent.push({ type: 'text', part: true });
    }
  } else {
    const body = mainBodyText(result);
    if (body) {
      await sendText(to, body);
      sent.push({ type: 'text' });
    }
  }

  const heading = trim(result.chipHeading);
  const chips = Array.isArray(result.chips) ? result.chips : [];

  await sendLinkChips(to, chips);
  const chipInteractive = await sendChips(
    to,
    heading || (chips.length ? 'Please select an option' : ''),
    chips
  );
  if (chipInteractive) sent.push({ type: 'chips' });

  for (const dropdown of result.dropdowns || []) {
    await sendSelectOptions(
      to,
      trim(dropdown.message),
      trim(dropdown.placeholder || 'Choose'),
      dropdown.options || []
    );
    sent.push({ type: 'dropdown' });
  }

  await sendDownloads(to, result.downloads);
  if (result.downloads && result.downloads.length) sent.push({ type: 'downloads' });

  await sendInfoCards(to, result.infoCards);
  if (result.infoCards && result.infoCards.length) sent.push({ type: 'infoCards' });

  await sendGalleries(to, result.galleries);
  if (result.galleries && result.galleries.length) sent.push({ type: 'galleries' });

  await sendCardCarousels(to, result.cardCarousels);
  if (result.cardCarousels && result.cardCarousels.length) {
    sent.push({ type: 'cardCarousels' });
  }

  await sendForms(to, result.forms);
  if (result.forms && result.forms.length) sent.push({ type: 'forms' });

  return sent;
}

module.exports = {
  deliverDialogflowResult,
  sendText,
  sendChips,
  sendReplyButtons,
  sendListMessage,
};
