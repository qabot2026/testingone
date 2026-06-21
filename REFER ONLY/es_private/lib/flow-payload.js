/**
 * Q&A flow builder blocks — serialize to Dialogflow fulfillment messages
 * and apply to chat API results (same shapes as rich-content.js parser).
 */

const richContent = require('./rich-content');

const NO_TEXT_PLACEHOLDER = '(No text response in Dialogflow)';

const ALL_CHANNELS = ['web', 'whatsapp', 'instagram', 'facebook'];

function isPlaceholderResponse(text) {
  return String(text || '').trim() === NO_TEXT_PLACEHOLDER;
}

/** Sheet text for DF rows: empty when the intent is payload-only (form, gallery, etc.). */
function normalizeProvisionResponse(text, blocks) {
  const trimmed = String(text || '').trim();
  if (trimmed && !isPlaceholderResponse(trimmed)) return trimmed;
  if (normalizeBlocks(blocks).length) return '';
  return '';
}

/** Dashboard label when there is no editable text response. */
function previewLabelForItem(item) {
  if (!item) return '';
  const draft = String(item.draftResponse || '').trim();
  const live = String(item.response || '').trim();
  const text = draft || live;
  if (text && !isPlaceholderResponse(text)) return text;

  const blocks = normalizeBlocks(item.payloadBlocks);
  const form = blocks.find((b) => b && b.type === 'form');
  if (form) {
    const id = String(form.formId || '').trim();
    const tag = String(form.tag || '').trim();
    if (id && tag) return `Form: ${id} (${tag})`;
    if (id) return `Form: ${id}`;
    return 'Dialogflow form';
  }
  if (blocks.length) return 'Dialogflow rich content';
  return '';
}

function normalizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((ch) => String(ch || '').trim().toLowerCase())
    .filter((ch) => ALL_CHANNELS.includes(ch));
}

function channelsApplyToPayload(block) {
  const channels = normalizeChannels(block && block.channels);
  if (!channels.length || channels.length >= ALL_CHANNELS.length) return undefined;
  return channels;
}

function isSafeHttpUrl(href) {
  return /^https?:\/\//i.test(String(href || '').trim());
}

function isNonemptyPlainObject(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      const type = String(block.type || '').trim().toLowerCase();
      if (!type) return null;
      return { ...block, type };
    })
    .filter(Boolean);
}

function payloadLabelFromPlain(plain, blockType) {
  if (!plain || typeof plain !== 'object') return '';
  const explicit = String(
    plain.name || plain.payloadName || plain.payload_name || plain.title || ''
  ).trim();
  if (explicit) return explicit;
  const action = String(plain.action || '').trim();
  if (blockType === 'form' || action === 'open_form') {
    const formId = String(plain.formId || plain.form_id || plain.form || '').trim();
    const tag = String(plain.tag || plain.upload_tag || '').trim();
    return [formId, tag].filter(Boolean).join(' · ') || action || 'form';
  }
  if (action) return action;
  return '';
}

function extractBlocksFromMessages(messages) {
  const blocks = [];

  function pushBlock(block, plain) {
    if (!block) return;
    const channels = normalizeChannels(plain && plain.channels);
    if (channels.length) block.channels = channels;
    const label = payloadLabelFromPlain(plain, block.type);
    if (label) block.dfPayloadName = label;
    blocks.push(block);
  }

  (messages || []).forEach((msg) => {
    const plain = richContent.payloadToPlain(msg && msg.payload);
    const parsed = richContent.parseFulfillmentMessages([msg]);
    const beforeLen = blocks.length;

    if (parsed.chipHeading || (parsed.chips && parsed.chips.length)) {
      pushBlock(
        {
          type: 'chips',
          heading: parsed.chipHeading || '',
          items: (parsed.chips || []).map((chip) => ({
            label: String(chip.label || chip.message || '').trim(),
            message: String(chip.message || chip.label || '').trim(),
            href: String(chip.href || '').trim(),
          })),
        },
        plain
      );
    }

    (parsed.dropdowns || []).forEach((dd) => {
      pushBlock(
        {
          type: 'dropdown',
          message: dd.message || '',
          placeholder: dd.placeholder || '',
          options: (dd.options || []).map((opt) => ({
            value: opt.value || opt.label || '',
            label: opt.label || opt.value || '',
          })),
        },
        plain
      );
    });

    (parsed.galleries || []).forEach((gal) => {
      pushBlock(
        {
          type: 'gallery',
          message: gal.message || '',
          images: (gal.images || []).map((img) => ({
            url: img.url || '',
            name: img.name || 'Image',
          })),
        },
        plain
      );
    });

    (parsed.cardCarousels || []).forEach((car) => {
      pushBlock(
        {
          type: 'carousel',
          message: car.message || '',
          cards: (car.cards || []).map((card) => ({
            id: card.id || '',
            title: card.title || '',
            subtitle: card.subtitle || '',
            imageUrl: card.imageUrl || '',
            buttons: (card.buttons || []).map((btn) => ({
              label: btn.label || '',
              message: btn.message || btn.label || '',
              href: btn.href || '',
            })),
          })),
        },
        plain
      );
    });

    (parsed.infoCards || []).forEach((card) => {
      pushBlock(
        {
          type: 'infoCard',
          title: card.title || '',
          subtitle: card.subtitle || '',
          body: card.body || '',
          imageUrl: card.imageUrl || '',
          actionLink: card.actionLink || '',
          buttons: (card.buttons || []).map((btn) => ({
            label: btn.label || '',
            message: btn.message || btn.label || '',
            href: btn.href || '',
          })),
        },
        plain
      );
    });

    if (parsed.downloads && parsed.downloads.length) {
      pushBlock(
        {
          type: 'downloads',
          items: parsed.downloads.map((d) => ({
            label: d.label || '',
            href: d.href || '',
            iconUrl: d.iconUrl || '',
            fileName: d.fileName || '',
          })),
        },
        plain
      );
    }

    (parsed.forms || []).forEach((form) => {
      pushBlock(
        {
          type: 'form',
          formId: form.formId || '',
          message: form.message || '',
          onSubmit: form.onSubmit || '',
          onCancel: form.onCancel || '',
          onResend: form.onResend || '',
          tag: form.tag || '',
          nextFormId: form.nextFormId || '',
        },
        plain
      );
    });

    if (parsed.liveAgent) {
      pushBlock(
        {
          type: 'liveAgent',
          message: parsed.liveAgentMessage || '',
          department: parsed.liveAgentDepartment || '',
        },
        plain
      );
    }

    if (plain && isNonemptyPlainObject(plain) && blocks.length === beforeLen) {
      pushBlock(
        {
          type: 'custom',
          dfPayloadName: payloadLabelFromPlain(plain, 'custom') || 'custom payload',
          rawPayload: plain,
        },
        plain
      );
    }
  });

  return blocks;
}

function finalizePayload(payload, block) {
  const channels = channelsApplyToPayload(block);
  if (channels) payload.channels = channels;
  return { payload };
}

function blockToFulfillmentMessage(block) {
  if (!block || !block.type) return null;

  switch (block.type) {
    case 'chips': {
      const items = (block.items || []).filter((item) => item && (item.label || item.message));
      if (!items.length) return null;
      const rows = [];
      const heading = String(block.heading || '').trim();
      if (heading) rows.push([{ type: 'list', title: heading }]);
      rows.push([
        {
          type: 'chips',
          options: items.map((item) => {
            const label = String(item.label || item.message || '').trim();
            const message = String(item.message || item.label || '').trim() || label;
            const href = String(item.href || '').trim();
            const opt = { text: label, message };
            if (isSafeHttpUrl(href)) opt.link = href;
            return opt;
          }),
        },
      ]);
      return finalizePayload({ richContent: rows }, block);
    }

    case 'dropdown': {
      const options = (block.options || [])
        .map((opt) => {
          const value = String((opt && opt.value) || (opt && opt.label) || '').trim();
          const label = String((opt && opt.label) || value).trim();
          if (!value && !label) return null;
          return { value: value || label, label: label || value };
        })
        .filter(Boolean);
      if (!options.length) return null;
      return finalizePayload(
        {
          action: 'dfchat_inline_select',
          message: String(block.message || '').trim(),
          placeholder: String(block.placeholder || '').trim() || 'Choose…',
          options,
        },
        block
      );
    }

    case 'gallery': {
      const images = (block.images || [])
        .map((img) => {
          const url = String((img && img.url) || '').trim();
          if (!isSafeHttpUrl(url)) return null;
          return {
            url,
            name: String((img && img.name) || 'Image').trim() || 'Image',
          };
        })
        .filter(Boolean);
      if (!images.length) return null;
      return finalizePayload(
        {
          action: 'open_gallery',
          message: String(block.message || '').trim(),
          urls: images,
        },
        block
      );
    }

    case 'carousel': {
      const cards = (block.cards || [])
        .map((card) => {
          if (!card) return null;
          const title = String(card.title || '').trim();
          const subtitle = String(card.subtitle || '').trim();
          const imageUrl = String(card.imageUrl || '').trim();
          const buttons = (card.buttons || [])
            .map((btn) => {
              const label = String((btn && btn.label) || '').trim();
              if (!label) return null;
              return {
                label,
                message: String((btn && btn.message) || label).trim(),
                href: String((btn && btn.href) || '').trim(),
              };
            })
            .filter(Boolean);
          if (!title && !subtitle && !imageUrl && !buttons.length) return null;
          const next = { title, subtitle, buttons };
          if (card.id) next.id = String(card.id).trim();
          if (isSafeHttpUrl(imageUrl)) next.imageUrl = imageUrl;
          if (buttons[0]) {
            next.ctaLabel = buttons[0].label;
            next.ctaValue = buttons[0].message;
          }
          return next;
        })
        .filter(Boolean);
      if (!cards.length) return null;
      return finalizePayload(
        {
          action: 'open_card_carousel',
          message: String(block.message || '').trim(),
          cards,
        },
        block
      );
    }

    case 'infoCard': {
      const title = String(block.title || '').trim();
      const subtitle = String(block.subtitle || '').trim();
      const body = String(block.body || '').trim();
      const imageUrl = String(block.imageUrl || '').trim();
      const actionLink = String(block.actionLink || '').trim();
      const buttons = (block.buttons || [])
        .map((btn) => {
          const label = String((btn && btn.label) || '').trim();
          if (!label) return null;
          return {
            text: label,
            message: String((btn && btn.message) || label).trim(),
            link: String((btn && btn.href) || '').trim(),
          };
        })
        .filter(Boolean);
      if (!title && !subtitle && !body && !imageUrl && !buttons.length && !actionLink) {
        return null;
      }
      const card = {
        type: 'info',
        title,
        subtitle,
        description: body,
      };
      if (isSafeHttpUrl(imageUrl)) {
        card.image = { src: { rawUrl: imageUrl } };
      }
      if (isSafeHttpUrl(actionLink)) card.actionLink = actionLink;
      if (buttons.length) card.buttons = buttons;
      return finalizePayload({ richContent: [[card]] }, block);
    }

    case 'downloads': {
      const items = (block.items || [])
        .map((item) => {
          const href = String((item && item.href) || '').trim();
          if (!isSafeHttpUrl(href)) return null;
          const label = String((item && item.label) || 'Download').trim();
          const next = {
            text: label,
            anchor: { href },
            name: String((item && item.fileName) || label).trim(),
          };
          const iconUrl = String((item && item.iconUrl) || '').trim();
          if (isSafeHttpUrl(iconUrl)) next.imageUrl = iconUrl;
          return next;
        })
        .filter(Boolean);
      if (!items.length) return null;
      return finalizePayload({ downloads: items }, block);
    }

    case 'form': {
      const formId = String(block.formId || '').trim();
      if (!formId) return null;
      const payload = {
        action: 'open_form',
        form_id: formId,
        message: String(block.message || '').trim(),
      };
      if (block.onSubmit) payload.onSubmit = String(block.onSubmit).trim();
      if (block.onCancel) payload.onCancel = String(block.onCancel).trim();
      if (block.onResend) payload.onResend = String(block.onResend).trim();
      if (block.tag) payload.tag = String(block.tag).trim();
      if (block.nextFormId) payload.next_form_id = String(block.nextFormId).trim();
      return finalizePayload(payload, block);
    }

    case 'liveAgent': {
      const payload = { action: 'request_live_agent' };
      if (block.message) payload.message = String(block.message).trim();
      if (block.department) payload.department = String(block.department).trim();
      return finalizePayload(payload, block);
    }

    case 'custom': {
      if (!isNonemptyPlainObject(block.rawPayload)) return null;
      const payload = { ...block.rawPayload };
      const label = String(block.dfPayloadName || '').trim();
      if (label && !payload.name && !payload.payloadName) payload.name = label;
      return finalizePayload(payload, block);
    }

    default:
      return null;
  }
}

function fulfillmentMessagesFromRow(row) {
  const messages = [];
  const text = String((row && row.response) || '').trim();
  if (text && text !== NO_TEXT_PLACEHOLDER) {
    messages.push({ text: { text: [text] } });
  }
  const blocks = normalizeBlocks(row && row.payloadBlocks);
  blocks.forEach((block) => {
    if (!blockProducesContent(block)) return;
    const msg = blockToFulfillmentMessage(block);
    if (msg) messages.push(msg);
  });
  return messages;
}

function mergeIntentMessages(existingMessages, row) {
  const blocks = normalizeBlocks(row && row.payloadBlocks);
  if (blocks.length) {
    const messages = fulfillmentMessagesFromRow(row);
    const hasUsable =
      messages.some((msg) => msg && msg.text) ||
      messages.some((msg) => msg && isNonemptyPlainObject(msg.payload));
    if (hasUsable) return messages;
  }
  const nonText = (existingMessages || []).filter((msg) => !msg.text);
  const text = String((row && row.response) || '').trim();
  if (!text || text === NO_TEXT_PLACEHOLDER) {
    return existingMessages || [];
  }
  return [{ text: { text: [text] } }, ...nonText];
}

function applyBlocksToResult(result, blocks, channel) {
  if (!result || !blocks.length) return result;
  const normalized = normalizeBlocks(blocks);

  normalized.forEach((block) => {
    switch (block.type) {
      case 'chips': {
        if (!Array.isArray(result.chips)) result.chips = [];
        const heading = String(block.heading || '').trim();
        if (heading && !result.chipHeading) result.chipHeading = heading;
        (block.items || []).forEach((item) => {
          const label = String((item && item.label) || '').trim();
          const message = String((item && item.message) || label).trim();
          if (!label && !message) return;
          result.chips.push({
            label: label || message,
            message: message || label,
            href: String((item && item.href) || '').trim(),
          });
        });
        break;
      }
      case 'dropdown': {
        if (!Array.isArray(result.dropdowns)) result.dropdowns = [];
        const options = (block.options || [])
          .map((opt) => ({
            value: String((opt && opt.value) || (opt && opt.label) || '').trim(),
            label: String((opt && opt.label) || (opt && opt.value) || '').trim(),
          }))
          .filter((opt) => opt.value || opt.label);
        if (!options.length) break;
        result.dropdowns.push({
          message: String(block.message || '').trim(),
          placeholder: String(block.placeholder || '').trim() || 'Choose…',
          action: 'dfchat_inline_select',
          options,
        });
        break;
      }
      case 'gallery': {
        if (!Array.isArray(result.galleries)) result.galleries = [];
        const images = (block.images || [])
          .map((img) => ({
            url: String((img && img.url) || '').trim(),
            name: String((img && img.name) || 'Image').trim(),
          }))
          .filter((img) => isSafeHttpUrl(img.url));
        if (!images.length) break;
        result.galleries.push({
          message: String(block.message || '').trim(),
          action: 'open_gallery',
          images,
        });
        break;
      }
      case 'carousel': {
        if (!Array.isArray(result.cardCarousels)) result.cardCarousels = [];
        const cards = (block.cards || [])
          .map((card) => ({
            id: String((card && card.id) || '').trim(),
            title: String((card && card.title) || '').trim(),
            subtitle: String((card && card.subtitle) || '').trim(),
            imageUrl: isSafeHttpUrl(card && card.imageUrl) ? String(card.imageUrl).trim() : '',
            buttons: (card && card.buttons) || [],
          }))
          .filter((card) => card.title || card.subtitle || card.imageUrl || card.buttons.length);
        if (!cards.length) break;
        result.cardCarousels.push({
          message: String(block.message || '').trim(),
          action: 'open_card_carousel',
          cards,
        });
        break;
      }
      case 'infoCard': {
        if (!Array.isArray(result.infoCards)) result.infoCards = [];
        result.infoCards.push({
          title: String(block.title || '').trim(),
          subtitle: String(block.subtitle || '').trim(),
          body: String(block.body || '').trim(),
          imageUrl: isSafeHttpUrl(block.imageUrl) ? String(block.imageUrl).trim() : '',
          actionLink: String(block.actionLink || '').trim(),
          buttons: (block.buttons || []).map((btn) => ({
            label: String((btn && btn.label) || '').trim(),
            message: String((btn && btn.message) || (btn && btn.label) || '').trim(),
            href: String((btn && btn.href) || '').trim(),
          })),
        });
        break;
      }
      case 'downloads': {
        if (!Array.isArray(result.downloads)) result.downloads = [];
        (block.items || []).forEach((item) => {
          const href = String((item && item.href) || '').trim();
          if (!isSafeHttpUrl(href)) return;
          result.downloads.push({
            label: String((item && item.label) || 'Download').trim(),
            href,
            iconUrl: isSafeHttpUrl(item && item.iconUrl) ? String(item.iconUrl).trim() : '',
            fileName: String((item && item.fileName) || '').trim(),
          });
        });
        break;
      }
      case 'form': {
        if (!Array.isArray(result.forms)) result.forms = [];
        const formId = String(block.formId || '').trim();
        if (!formId) break;
        result.forms.push({
          formId,
          message: String(block.message || '').trim(),
          onSubmit: String(block.onSubmit || '').trim(),
          onCancel: String(block.onCancel || '').trim(),
          onResend: String(block.onResend || '').trim(),
          tag: String(block.tag || '').trim(),
          nextFormId: String(block.nextFormId || '').trim(),
          nextFormIds: block.nextFormId ? [String(block.nextFormId).trim()] : [],
          prefill: {},
        });
        break;
      }
      case 'liveAgent': {
        result.liveAgent = true;
        if (block.message) result.liveAgentMessage = String(block.message).trim();
        if (block.department) result.liveAgentDepartment = String(block.department).trim();
        break;
      }
      default:
        break;
    }
  });

  return result;
}

function summarizeBlocks(blocks) {
  const list = normalizeBlocks(blocks);
  if (!list.length) return '';
  const counts = {};
  list.forEach((b) => {
    counts[b.type] = (counts[b.type] || 0) + 1;
  });
  return Object.keys(counts)
    .map((type) => counts[type] + ' ' + type)
    .join(', ');
}

function mergeParsedFulfillmentIntoResult(result, parsed) {
  if (!result || !parsed) return result;
  if (parsed.chips && parsed.chips.length) {
    result.chips = parsed.chips;
  }
  if (parsed.chipHeading) result.chipHeading = parsed.chipHeading;
  if (parsed.infoCards && parsed.infoCards.length) {
    result.infoCards = parsed.infoCards;
  }
  if (parsed.downloads && parsed.downloads.length) {
    result.downloads = parsed.downloads;
  }
  if (parsed.dropdowns && parsed.dropdowns.length) {
    result.dropdowns = parsed.dropdowns;
  }
  if (parsed.galleries && parsed.galleries.length) {
    result.galleries = parsed.galleries;
  }
  if (parsed.cardCarousels && parsed.cardCarousels.length) {
    result.cardCarousels = parsed.cardCarousels;
  }
  if (parsed.forms && parsed.forms.length) {
    result.forms = parsed.forms;
  }
  if (parsed.replyParts && parsed.replyParts.length) {
    result.replyParts = parsed.replyParts;
  }
  if (parsed.replyText) {
    result.reply = parsed.replyText;
  }
  if (parsed.liveAgent) {
    result.liveAgent = true;
    if (parsed.liveAgentMessage) result.liveAgentMessage = parsed.liveAgentMessage;
    if (parsed.liveAgentDepartment) {
      result.liveAgentDepartment = parsed.liveAgentDepartment;
    }
  }
  return result;
}

function blockProducesContent(block) {
  if (!block || !block.type) return false;
  switch (block.type) {
    case 'chips':
      return (block.items || []).some((item) =>
        String((item && item.label) || (item && item.message) || '').trim()
      );
    case 'dropdown':
      return (block.options || []).some((opt) =>
        String((opt && opt.value) || (opt && opt.label) || '').trim()
      );
    case 'gallery':
      return (block.images || []).some((img) => isSafeHttpUrl(img && img.url));
    case 'carousel':
      return (block.cards || []).some(
        (card) =>
          String((card && card.title) || '').trim() ||
          String((card && card.subtitle) || '').trim() ||
          isSafeHttpUrl(card && card.imageUrl) ||
          (card && card.buttons && card.buttons.length)
      );
    case 'infoCard':
      return (
        String(block.title || '').trim() ||
        String(block.subtitle || '').trim() ||
        String(block.body || '').trim() ||
        isSafeHttpUrl(block.imageUrl) ||
        (block.buttons || []).some((btn) => String((btn && btn.label) || '').trim())
      );
    case 'downloads':
      return (block.items || []).some((item) => isSafeHttpUrl(item && item.href));
    case 'form':
      return !!String(block.formId || '').trim();
    case 'liveAgent':
      return !!(String(block.message || '').trim() || String(block.department || '').trim());
    case 'custom':
      return isNonemptyPlainObject(block.rawPayload);
    default:
      return false;
  }
}

function clearRichFields(result) {
  if (!result) return;
  result.chips = [];
  result.chipHeading = '';
  result.infoCards = [];
  result.downloads = [];
  result.dropdowns = [];
  result.galleries = [];
  result.cardCarousels = [];
  result.forms = [];
}

function applySheetBlocksToChatResult(result, blocks, channel) {
  if (!result || !blocks || !blocks.length) return result;
  const normalized = normalizeBlocks(blocks).filter((block) => blockProducesContent(block));
  if (!normalized.length) return result;

  clearRichFields(result);
  applyBlocksToResult(result, normalized, channel);

  normalized
    .filter((block) => block.type === 'custom')
    .forEach((block) => {
      const msg = blockToFulfillmentMessage(block);
      if (!msg) return;
      mergeParsedFulfillmentIntoResult(
        result,
        richContent.parseFulfillmentMessages([msg], { channel })
      );
    });

  const hasRich =
    (result.chips && result.chips.length) ||
    (result.infoCards && result.infoCards.length) ||
    (result.downloads && result.downloads.length) ||
    (result.dropdowns && result.dropdowns.length) ||
    (result.galleries && result.galleries.length) ||
    (result.cardCarousels && result.cardCarousels.length) ||
    (result.forms && result.forms.length);
  const replyTrim = String(result.reply || '').trim();
  if (hasRich && (replyTrim === '{}' || replyTrim === '[]')) {
    result.reply = '';
    result.replyParts = [];
  }

  return result;
}

module.exports = {
  normalizeBlocks,
  extractBlocksFromMessages,
  fulfillmentMessagesFromRow,
  mergeIntentMessages,
  applyBlocksToResult,
  applySheetBlocksToChatResult,
  summarizeBlocks,
  blockProducesContent,
  isNonemptyPlainObject,
  isPlaceholderResponse,
  normalizeProvisionResponse,
  previewLabelForItem,
  NO_TEXT_PLACEHOLDER,
};
