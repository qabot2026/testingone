/**
 * ============================================================================
 * WHATSAPP INTEGRATION — YAHAN EDIT KARO
 * ============================================================================
 * Session ID prefix: wa-  (example: wa-919876543210)
 *
 * Railway Variables (tumhare names OK):
 *   WHATSAPP_TOKEN
 *   WHATSAPP_APP_SECRET
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_VERIFY_TOKEN
 *
 * Meta App → Webhook URL:
 *   https://YOUR_DOMAIN/webhooks/meta
 *   (ya /webhooks/whatsapp)
 *
 * Neeche functions mein apna custom logic add kar sakte ho:
 *   - extractMessages  → webhook payload parse
 *   - handleInboundMessage → message aane par kya karna hai
 *   - sendOutboundReply → user ko reply kaise bhejna hai
 * ============================================================================
 */

const channelSessions = require('../../lib/channels/channel-sessions');
const channelChat = require('../../lib/channels/channel-chat');
const { resolveWelcomeEventForBot } = require('../../lib/channels/generic-opener');
const meta = require('../../lib/channels/meta-shared');
const waRich = require('../../lib/channels/whatsapp-rich-outbound');
const waMediaUpload = require('../../lib/channels/whatsapp-media-upload');

/** Integration on/off — false karo jab tak setup na ho */
const enabled = true;

const sessionPrefix = 'wa-';
const channelName = 'WhatsApp';
const webhookObject = 'whatsapp_business_account';
const defaultLanguage = 'en';
const botId = '10002';

/**
 * Web company.config endChatEvent jaisa — session clear NAHI, sirf goodbye message.
 * User baad mein message kare to same wa- session continue.
 */
const endChatEvent = {
  enabled: true,
  eventName: 'ENDCHAT',
  triggerOnIdle: true,
  idleTimeoutMs: 10000,
  showBotResponse: true,
  /** Web jaisa — ek user reply ke baad idle par sirf ek baar ENDCHAT */
  triggerOncePerIdleCycle: true,
};

/** sessionId → idle timer (ENDCHAT session se alag) */
const idleEndChatTimers = new Map();
/** sessionId set — is idle cycle mein ENDCHAT already bheja */
const endChatSentThisCycle = new Set();

/** Live agent queue message jab bot handoff kare */
const waitingForAgentMessage = 'Please wait — a team member will join shortly.';

function isConfigured() {
  return meta.isWhatsAppConfigured();
}

function mergeSessionMeta(sessionId, phone) {
  try {
    const chatTranscript = require('../../lib/chat-transcript');
    chatTranscript.mergeSessionMeta(sessionId, {
      channel: channelName,
      whatsappPhone: phone,
      sitePreset: 'greenValley',
      botId,
    });
  } catch {
    /* ignore */
  }
}

function trimText(text) {
  return String(text || '').trim();
}

function clearIdleEndChatTimer(sessionId) {
  const key = String(sessionId || '').trim();
  const entry = idleEndChatTimers.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  idleEndChatTimers.delete(key);
}

async function triggerIdleEndChat(sessionId, phone) {
  const cfg = endChatEvent;
  if (!cfg.enabled || !cfg.eventName) return;
  const key = String(sessionId || '').trim();
  if (cfg.triggerOncePerIdleCycle && endChatSentThisCycle.has(key)) return;

  try {
    const liveAgent = require('../../lib/live-agent');
    await liveAgent.refreshStore();
    if (liveAgent.isDialogflowBlockedForSession(sessionId)) return;
  } catch {
    /* ignore */
  }

  try {
    const result = await channelChat.processChatTurn({
      sessionId,
      event: cfg.eventName,
      languageCode: defaultLanguage,
      channel: 'whatsapp',
      skipTranscriptUser: true,
      botId,
    });
    if (cfg.showBotResponse !== false) {
      const text =
        result.outboundText ||
        result.reply ||
        (result.waitingForAgent ? waitingForAgentMessage : '');
      if (text || (result.chips && result.chips.length)) {
        await sendDialogflowResult(phone, result);
      }
    }
    if (cfg.triggerOncePerIdleCycle) endChatSentThisCycle.add(key);
  } catch (err) {
    console.error('[whatsapp.integration] ENDCHAT idle:', err.message);
  }
}

function scheduleIdleEndChat(sessionId, phone) {
  const cfg = endChatEvent;
  clearIdleEndChatTimer(sessionId);
  if (!cfg.enabled || !cfg.triggerOnIdle) return;
  const key = String(sessionId || '').trim();
  if (cfg.triggerOncePerIdleCycle && endChatSentThisCycle.has(key)) return;
  const ms = Math.max(0, Number(cfg.idleTimeoutMs) || 0);
  if (ms <= 0) return;

  const timer = setTimeout(() => {
    idleEndChatTimers.delete(key);
    void triggerIdleEndChat(key, phone);
  }, ms);
  idleEndChatTimers.set(key, { timer, phone });
}

const REJECTED_MEDIA_REPLY =
  'Video and audio files are not accepted. Please send images or documents (PDF, Word) only.';

function detectRejectedMedia(msg) {
  if (!msg || !msg.type) return null;
  if (msg.type === 'video' || (msg.video && msg.video.id)) return 'video';
  if (msg.type === 'audio' || (msg.audio && msg.audio.id)) return 'audio';
  return null;
}

function extractMediaPayload(msg) {
  if (!msg || !msg.type) return null;
  if (detectRejectedMedia(msg)) return null;
  if (msg.type === 'document' && msg.document && msg.document.id) {
    return {
      type: 'document',
      id: msg.document.id,
      mimeType: msg.document.mime_type || '',
      filename: msg.document.filename || '',
      caption: msg.document.caption || '',
    };
  }
  if (msg.type === 'image' && msg.image && msg.image.id) {
    return {
      type: 'image',
      id: msg.image.id,
      mimeType: msg.image.mime_type || '',
      caption: msg.image.caption || '',
    };
  }
  /** Kuch clients document ko alag type se bhejte hain — fallback */
  if (msg.document && msg.document.id) {
    return {
      type: 'document',
      id: msg.document.id,
      mimeType: msg.document.mime_type || '',
      filename: msg.document.filename || '',
      caption: msg.document.caption || '',
    };
  }
  if (msg.image && msg.image.id && msg.type !== 'sticker') {
    return {
      type: 'image',
      id: msg.image.id,
      mimeType: msg.image.mime_type || '',
      caption: msg.image.caption || '',
    };
  }
  return null;
}

/**
 * Meta webhook body se messages nikalo (text, buttons, document, image, …).
 */
function extractMessages(body) {
  const out = [];
  const entries = Array.isArray(body && body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        if (!msg || msg.type === 'reaction' || msg.type === 'unsupported') continue;
        let text = '';
        if (msg.type === 'text' && msg.text && msg.text.body) {
          text = msg.text.body;
        } else if (msg.type === 'interactive' && msg.interactive) {
          const ir = msg.interactive;
          if (ir.type === 'button_reply' && ir.button_reply) {
            text = ir.button_reply.title || ir.button_reply.id || '';
          } else if (ir.type === 'list_reply' && ir.list_reply) {
            text = ir.list_reply.title || ir.list_reply.id || '';
          }
        }

        const rejectedMedia = detectRejectedMedia(msg);
        const media = rejectedMedia ? null : extractMediaPayload(msg);
        if (media && media.caption && !trimText(text)) {
          text = String(media.caption).trim();
        }

        if (!trimText(text) && !media && !rejectedMedia) continue;
        out.push({
          from: msg.from,
          text: trimText(text),
          media,
          rejectedMedia,
          messageId: msg.id,
          phoneNumberId: value.metadata && value.metadata.phone_number_id,
        });
      }
    }
  }
  return out;
}

async function captureInboundMedia(sessionId, phone, media, phoneNumberId) {
  if (!media || !media.id) return null;
  return waMediaUpload.uploadInboundMedia({
    sessionId,
    phone,
    media,
    phoneNumberId,
    botId: '10002',
    logTranscript: true,
  });
}

/** Background — Meta CDN kabhi webhook ke turant baad ready nahi hota */
function scheduleInboundMediaUpload(sessionId, phone, media, phoneNumberId) {
  void (async () => {
    try {
      const result = await captureInboundMedia(
        sessionId,
        phone,
        media,
        phoneNumberId
      );
      if (result && result.ok && result.ackMessage) {
        await sendOutboundReply(phone, result.ackMessage);
      } else if (result && !result.ok) {
        await sendOutboundReply(
          phone,
          result.message ||
            'Sorry, we could not save your file. Please try again.'
        );
      }
    } catch (err) {
      console.error('[whatsapp.integration] media background:', err.message);
      await sendOutboundReply(
        phone,
        'Sorry, we could not save your file. Please try again.'
      );
    } finally {
      scheduleIdleEndChat(sessionId, phone);
    }
  })();
}

/**
 * Ek incoming message handle karo → media GCS (anytime) / Dialogflow → reply.
 */
async function handleInboundMessage(from, inbound, opts) {
  const phone = String(from || '').replace(/\D/g, '');
  const payload =
    inbound && typeof inbound === 'object'
      ? inbound
      : { text: String(inbound || '').trim() };
  let text = trimText(payload.text || '');
  const media = payload.media || null;
  const rejectedMedia = payload.rejectedMedia || null;

  if (!phone || (!text && !media && !rejectedMedia)) return null;

  const sessionId = channelSessions.sessionIdFor('wa', phone);
  mergeSessionMeta(sessionId, phone);
  clearIdleEndChatTimer(sessionId);
  endChatSentThisCycle.delete(String(sessionId || '').trim());

  if (rejectedMedia) {
    await sendOutboundReply(phone, REJECTED_MEDIA_REPLY);
    scheduleIdleEndChat(sessionId, phone);
    return { sessionId, rejected: rejectedMedia };
  }

  /** Form flow ke bina bhi — attachment background mein GCS par (CDN retries) */
  if (media && media.id) {
    scheduleInboundMediaUpload(sessionId, phone, media, payload.phoneNumberId);
    if (!text) {
      return { sessionId, uploadPending: true };
    }
  }

  /** Hi/Hello → welcome event handled in channel-chat (all channels) */
  let result;
  try {
    result = await channelChat.processChatTurn({
      sessionId,
      message: text,
      languageCode: (opts && opts.languageCode) || defaultLanguage,
      channel: 'whatsapp',
      botId,
    });
  } catch (err) {
    console.error('[whatsapp.integration]', err.message);
    return null;
  }

  const reply =
    result.outboundText ||
    (result.waitingForAgent ? waitingForAgentMessage : '');

  const hasRich =
    (result.chips && result.chips.length) ||
    (result.dropdowns && result.dropdowns.length) ||
    (result.downloads && result.downloads.length) ||
    (result.infoCards && result.infoCards.length) ||
    (result.galleries && result.galleries.length) ||
    (result.cardCarousels && result.cardCarousels.length) ||
    (result.forms && result.forms.length) ||
    (result.replyParts && result.replyParts.length > 1);

  if (reply || hasRich) {
    if (result.forms && result.forms.length) {
      waMediaUpload.markWaUploadForms(sessionId, result.forms);
    }
    if (result.waitingForAgent && !hasRich) {
      await sendOutboundReply(phone, reply);
    } else {
      await sendDialogflowResult(phone, result);
      if (result.followUp) {
        await sendDialogflowResult(phone, result.followUp);
      }
    }
  }

  if (!result.waitingForAgent && !result.liveAgent) {
    scheduleIdleEndChat(sessionId, phone);
  }
  return { sessionId, reply };
}

/** Dialogflow result — text + chips/lists/images/forms */
async function sendDialogflowResult(recipientId, result) {
  if (!isConfigured()) return null;
  try {
    return await waRich.deliverDialogflowResult(recipientId, result);
  } catch (err) {
    console.error('[whatsapp.integration] rich send:', err.message);
    const fallback =
      (result && (result.outboundText || result.reply)) || '';
    if (fallback) return sendOutboundReply(recipientId, fallback);
    return null;
  }
}

/** Agent desk / simple text reply */
async function sendOutboundReply(recipientId, text) {
  if (!isConfigured()) return null;
  return meta.sendWhatsAppText(recipientId, text);
}

async function processWebhookPayload(body) {
  if (!enabled) return { handled: false, count: 0, disabled: true };
  if (!body || body.object !== webhookObject) {
    return { handled: false, count: 0 };
  }
  const messages = extractMessages(body);
  for (const m of messages) {
    await handleInboundMessage(m.from, m, {});
  }
  return { handled: true, count: messages.length };
}

module.exports = {
  enabled,
  sessionPrefix,
  channelName,
  webhookObject,
  isConfigured,
  get welcomeEventName() {
    return resolveWelcomeEventForBot(botId);
  },
  extractMessages,
  handleInboundMessage,
  sendDialogflowResult,
  sendOutboundReply,
  processWebhookPayload,
};
