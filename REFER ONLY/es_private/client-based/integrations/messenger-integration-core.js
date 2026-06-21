/**
 * Shared Instagram / Facebook Messenger integration logic (WhatsApp parity).
 * Used by instagram.integration.js and facebook.integration.js.
 */

const channelSessions = require('../../lib/channels/channel-sessions');
const channelChat = require('../../lib/channels/channel-chat');
const { resolveWelcomeEventForBot } = require('../../lib/channels/generic-opener');
const meta = require('../../lib/channels/meta-shared');
const messengerRich = require('../../lib/channels/messenger-rich-outbound');
const messengerMediaUpload = require('../../lib/channels/messenger-media-upload');

const defaultLanguage = 'en';
const endChatEvent = {
  enabled: true,
  eventName: 'ENDCHAT',
  triggerOnIdle: true,
  idleTimeoutMs: 10000,
  showBotResponse: true,
  triggerOncePerIdleCycle: true,
};
const waitingForAgentMessage = 'Please wait — a team member will join shortly.';
const REJECTED_MEDIA_REPLY =
  'Video and audio files are not accepted. Please send images or documents (PDF, Word) only.';

const idleEndChatTimers = new Map();
const endChatSentThisCycle = new Set();

function trimText(text) {
  return String(text || '').trim();
}

function createMessengerIntegration(config) {
  const {
    enabled = true,
    sessionPrefix,
    channelName,
    webhookObject,
    channelKey,
    userIdMetaKey,
    botId = '10002',
    sitePreset = 'greenValley',
  } = config;

  function isConfigured() {
    return meta.isMessengerConfigured();
  }

  function mergeSessionMeta(sessionId, userId) {
    try {
      const chatTranscript = require('../../lib/chat-transcript');
      chatTranscript.mergeSessionMeta(sessionId, {
        channel: channelName,
        [userIdMetaKey]: userId,
        sitePreset,
        botId,
      });
    } catch {
      /* ignore */
    }
  }

  function clearIdleEndChatTimer(sessionId) {
    const key = String(sessionId || '').trim();
    const entry = idleEndChatTimers.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    idleEndChatTimers.delete(key);
  }

  async function triggerIdleEndChat(sessionId, userId) {
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
        channel: channelKey,
        skipTranscriptUser: true,
        botId,
      });
      if (cfg.showBotResponse !== false) {
        const text =
          result.outboundText ||
          result.reply ||
          (result.waitingForAgent ? waitingForAgentMessage : '');
        if (text || (result.chips && result.chips.length)) {
          await sendDialogflowResult(userId, result);
        }
      }
      if (cfg.triggerOncePerIdleCycle) endChatSentThisCycle.add(key);
    } catch (err) {
      console.error(`[${channelKey}.integration] ENDCHAT idle:`, err.message);
    }
  }

  function scheduleIdleEndChat(sessionId, userId) {
    const cfg = endChatEvent;
    clearIdleEndChatTimer(sessionId);
    if (!cfg.enabled || !cfg.triggerOnIdle) return;
    const key = String(sessionId || '').trim();
    if (cfg.triggerOncePerIdleCycle && endChatSentThisCycle.has(key)) return;
    const ms = Math.max(0, Number(cfg.idleTimeoutMs) || 0);
    if (ms <= 0) return;

    const timer = setTimeout(() => {
      idleEndChatTimers.delete(key);
      void triggerIdleEndChat(key, userId);
    }, ms);
    idleEndChatTimers.set(key, { timer, userId });
  }

  function detectRejectedMedia(attachment) {
    if (!attachment || !attachment.type) return null;
    const type = String(attachment.type).toLowerCase();
    if (type === 'video') return 'video';
    if (type === 'audio') return 'audio';
    return null;
  }

  function extractMediaPayload(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    for (const att of list) {
      const rejected = detectRejectedMedia(att);
      if (rejected) return { rejectedMedia: rejected };
      const type = String((att && att.type) || '').toLowerCase();
      const payload = att && att.payload ? att.payload : {};
      const url = trimText(payload.url);
      if (!url) continue;
      if (type === 'image') {
        return {
          media: {
            type: 'image',
            url,
            mimeType: '',
          },
        };
      }
      if (type === 'file') {
        return {
          media: {
            type: 'file',
            url,
            mimeType: '',
            filename: trimText(payload.title || payload.name),
          },
        };
      }
    }
    return null;
  }

  function extractMessages(body) {
    const out = [];
    const entries = Array.isArray(body && body.entry) ? body.entry : [];
    for (const entry of entries) {
      const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
      for (const ev of messaging) {
        const sender = ev.sender && ev.sender.id;
        if (!sender) continue;

        if (ev.postback) {
          const text =
            trimText(ev.postback.payload) || trimText(ev.postback.title);
          if (text) {
            out.push({
              from: sender,
              text,
              messageId: ev.postback.mid || '',
            });
          }
          continue;
        }

        const msg = ev.message;
        if (!msg || msg.is_echo) continue;

        let text = trimText(msg.text);
        if (!text && msg.quick_reply && msg.quick_reply.payload) {
          text = trimText(msg.quick_reply.payload);
        }

        const mediaInfo = extractMediaPayload(msg.attachments);
        const rejectedMedia =
          mediaInfo && mediaInfo.rejectedMedia ? mediaInfo.rejectedMedia : null;
        const media = mediaInfo && mediaInfo.media ? mediaInfo.media : null;

        if (!trimText(text) && !media && !rejectedMedia) continue;
        out.push({
          from: sender,
          text,
          media,
          rejectedMedia,
          messageId: msg.mid,
        });
      }
    }
    return out;
  }

  async function captureInboundMedia(sessionId, userId, media) {
    if (!media || !media.url) return null;
    return messengerMediaUpload.uploadInboundMedia({
      sessionId,
      userId,
      media,
      channelName,
      botId,
      logTranscript: true,
    });
  }

  function scheduleInboundMediaUpload(sessionId, userId, media) {
    void (async () => {
      try {
        const result = await captureInboundMedia(sessionId, userId, media);
        if (result && result.ok && result.ackMessage) {
          await sendOutboundReply(userId, result.ackMessage);
        } else if (result && !result.ok) {
          await sendOutboundReply(
            userId,
            result.message ||
              'Sorry, we could not save your file. Please try again.'
          );
        }
      } catch (err) {
        console.error(`[${channelKey}.integration] media background:`, err.message);
        await sendOutboundReply(
          userId,
          'Sorry, we could not save your file. Please try again.'
        );
      } finally {
        scheduleIdleEndChat(sessionId, userId);
      }
    })();
  }

  async function handleInboundMessage(from, inbound, opts) {
    const userId = String(from || '').trim();
    const payload =
      inbound && typeof inbound === 'object'
        ? inbound
        : { text: String(inbound || '').trim() };
    let text = trimText(payload.text || '');
    const media = payload.media || null;
    const rejectedMedia = payload.rejectedMedia || null;

    if (!userId || (!text && !media && !rejectedMedia)) return null;

    const sessionId = channelSessions.sessionIdFor(sessionPrefix, userId);
    mergeSessionMeta(sessionId, userId);
    clearIdleEndChatTimer(sessionId);
    endChatSentThisCycle.delete(String(sessionId || '').trim());

    if (rejectedMedia) {
      await sendOutboundReply(userId, REJECTED_MEDIA_REPLY);
      scheduleIdleEndChat(sessionId, userId);
      return { sessionId, rejected: rejectedMedia };
    }

    if (media && media.url) {
      scheduleInboundMediaUpload(sessionId, userId, media);
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
        channel: channelKey,
        botId,
      });
    } catch (err) {
      console.error(`[${channelKey}.integration]`, err.message);
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
        messengerMediaUpload.markUploadForms(sessionId, result.forms);
      }
      if (result.waitingForAgent && !hasRich) {
        await sendOutboundReply(userId, reply);
      } else {
        await sendDialogflowResult(userId, result);
        if (result.followUp) {
          await sendDialogflowResult(userId, result.followUp);
        }
      }
    }

    if (!result.waitingForAgent && !result.liveAgent) {
      scheduleIdleEndChat(sessionId, userId);
    }
    return { sessionId, reply };
  }

  async function sendDialogflowResult(recipientId, result) {
    if (!isConfigured()) return null;
    try {
      return await messengerRich.deliverDialogflowResult(recipientId, result, {
        sessionPrefix,
      });
    } catch (err) {
      console.error(`[${channelKey}.integration] rich send:`, err.message);
      const fallback =
        (result && (result.outboundText || result.reply)) || '';
      if (fallback) return sendOutboundReply(recipientId, fallback);
      return null;
    }
  }

  async function sendOutboundReply(recipientId, text) {
    if (!isConfigured()) return null;
    return meta.sendMessengerText(recipientId, text);
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

  return {
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
}

module.exports = {
  createMessengerIntegration,
  endChatEvent,
};
