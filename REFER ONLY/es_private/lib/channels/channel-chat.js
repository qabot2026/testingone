/**
 * Shared chat turn — Dialogflow + live agent + transcript (web + social).
 */

const dialogflow = require('../dialogflow');
const phraseTranslations = require('../phrase-translations');
const messageSyntax = require('../message-syntax');
const chatTranscript = require('../chat-transcript');

function liveAgent() {
  return require('../live-agent');
}
const esTestMode = require('../es-test-mode');
const channelSessions = require('./channel-sessions');
const localTime = require('../local-time');
const faqStore = require('../faq-store');
const flowPayload = require('../flow-payload');
const qaProvisionStore = require('../qa-provision-store');
const botSheetTabs = require('../bot-sheet-tabs');
const { isGenericOpener, resolveWelcomeEventForBot } = require('./generic-opener');

// Agent Training is an editor only: text edits reach Dialogflow on Make Live, and
// at runtime the reply comes purely from Dialogflow. Set QA_PROVISION_RUNTIME_OVERRIDE=true
// to re-enable the old behaviour where the stored sheet text/blocks override the DF reply.
const PROVISION_RUNTIME_OVERRIDE =
  String(process.env.QA_PROVISION_RUNTIME_OVERRIDE || '').trim().toLowerCase() === 'true';

function pickReplyText(result) {
  if (!result) return '';
  const main = result.reply && String(result.reply).trim();
  if (main) return main;
  const parts = Array.isArray(result.replyParts) ? result.replyParts : [];
  return parts
    .map((p) => (p && p.text ? String(p.text).trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function resolveBotId_(opts) {
  const fromOpt = String((opts && opts.botId) || '').trim();
  if (fromOpt) return fromOpt;
  const sid = String((opts && opts.sessionId) || '').trim();
  if (sid) {
    const meta = chatTranscript.getSessionDoc(sid).meta || {};
    if (meta.botId) return String(meta.botId).trim();
    if (meta.sheetBotId) return String(meta.sheetBotId).trim();
  }
  return botSheetTabs.DEFAULT_BOT_ID;
}

function buildFaqResult(faqItem) {
  const text = String((faqItem && faqItem.answer) || '').trim();
  return {
    reply: text,
    replyParts: text ? [{ text }] : [],
    chips: [],
    forms: [],
    messages: [],
    intent: 'faq.match',
    faqMatch: true,
  };
}

function hasRealFollowUpBody(result) {
  if (!result) return false;
  const probe = { ...result, chipHeading: '' };
  return qaProvisionStore.hasUsableDfContent(probe);
}

async function resolveFollowUpFromTrainingPhrase(phrase, ctx) {
  const raw = String(phrase || '').trim();
  if (!raw) return null;

  const accept = (attempt) => {
    if (!attempt || attempt.intentIsFallback) return null;
    if (!hasRealFollowUpBody(attempt)) return null;
    return attempt;
  };

  if (/^event:/i.test(raw)) {
    const eventName = raw.replace(/^event:/i, '').trim();
    if (!eventName) return null;
    return accept(
      await dialogflow.detectEvent(
        ctx.sid,
        eventName,
        ctx.languageCode,
        ctx.dfProjectId,
        { channel: ctx.channel }
      )
    );
  }

  return accept(
    await dialogflow.detectIntent(
      ctx.sid,
      raw,
      ctx.languageCode,
      ctx.dfProjectId,
      { channel: ctx.channel }
    )
  );
}

function faqFollowUpPhrase(faqItem) {
  const phrase = String((faqItem && faqItem.nextIntentPhrase) || '').trim();
  if (phrase) return phrase;
  const legacyIntent = String((faqItem && faqItem.nextIntent) || '').trim();
  if (!legacyIntent) return '';
  const trigger = qaProvisionStore.resolveNextIntentTrigger('', legacyIntent, '');
  const candidates = trigger ? trigger.textCandidates || [] : [];
  const first = candidates.find((t) => String(t || '').trim() && !/^event:/i.test(t));
  return first ? String(first).trim() : legacyIntent;
}

async function attachFaqNextIntentFollowUp(result, faqItem, ctx) {
  const phrase = faqFollowUpPhrase(faqItem);
  if (!phrase || !result) return result;

  const followUp = await resolveFollowUpFromTrainingPhrase(phrase, ctx);
  if (!followUp) return result;

  localTime.applyChatPlaceholdersToResult(followUp);
  if (PROVISION_RUNTIME_OVERRIDE) {
    applyProvisionSheetToResult_(followUp, ctx.channel, '');
  }

  result.followUp = followUp;
  return result;
}

function isBogusPayloadReplyText(text) {
  const trimmed = String(text || '').trim();
  return trimmed === '{}' || trimmed === '[]';
}

function applyProvisionSheetToResult_(result, channel, userText) {
  if (!result) return;
  const dfIntent = result.intentIsFallback ? '' : result.intent;
  const item = qaProvisionStore.resolveItemForChat(dfIntent, userText);
  if (!item) return;
  const blocks = qaProvisionStore.parsePayloadBlocks(item.payloadBlocks);
  if (result.faqMatch && !blocks.length) return;

  const sheetText = String(item.response || '').trim();
  const hasText =
    !!sheetText && sheetText !== flowPayload.NO_TEXT_PLACEHOLDER;

  if (blocks.length) {
    flowPayload.applySheetBlocksToChatResult(result, blocks, channel);
    if (isBogusPayloadReplyText(result.reply)) {
      result.reply = '';
      result.replyParts = [];
      delete result.replyHtml;
      delete result.replyFormatted;
      delete result.replyChannel;
    }
  }

  if (hasText) {
    result.reply = sheetText;
    result.replyParts = [];
  } else if (isBogusPayloadReplyText(result.reply)) {
    result.reply = '';
    result.replyParts = [];
    delete result.replyHtml;
    delete result.replyFormatted;
    delete result.replyChannel;
  }

  if (
    blocks.length &&
    !hasText &&
    !String(result.reply || '').trim() &&
    Array.isArray(result.replyParts) &&
    !result.replyParts.length
  ) {
    const prompts = []
      .concat(String(result.chipHeading || '').trim())
      .concat((result.galleries || []).map((g) => g.message))
      .concat((result.dropdowns || []).map((d) => d.message))
      .concat((result.cardCarousels || []).map((c) => c.message))
      .concat((result.forms || []).map((f) => f.message))
      .filter(Boolean);
    if (prompts.length) {
      result.reply = [...new Set(prompts)].join('\n').trim();
      result.replyParts = [{ type: 'text', text: result.reply }];
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} [opts.message]
 * @param {string} [opts.event]
 * @param {string} [opts.languageCode]
 * @param {string} [opts.uiLanguageCode]
 * @param {string} [opts.dialogflowProjectId]
 * @param {string} [opts.channel] web | whatsapp | instagram | facebook
 * @param {boolean} [opts.skipTranscriptUser]
 */
async function processChatTurn(opts) {
  const {
    sessionId,
    message,
    languageCode = 'en',
    uiLanguageCode,
    event,
    dialogflowProjectId,
    channel = 'web',
    skipTranscriptUser = false,
    req,
    orchestrationMode,
    orchestrationChildId,
  } = opts || {};

  const sid = String(sessionId || '').trim();
  const isEsTest = req ? esTestMode.isEsTestRequest(req, sid) : false;
  const eventName =
    typeof event === 'string' && event.trim() ? event.trim() : null;
  const uiLang = uiLanguageCode || languageCode;
  const sheetChannel = channelSessions.sheetChannelName(sid);

  const la = liveAgent();
  await la.refreshStore();

  if (!isEsTest && la.isDialogflowBlockedForSession(sid)) {
    const conv = la.getConversation(sid);
    const agentName = conv
      ? la.resolveAgentDisplayName(conv.assignedAgentEmail)
      : '';
    if (!eventName && message && typeof message === 'string' && message.trim()) {
      try {
        await la.postUserMessage(sid, message.trim());
      } catch (postErr) {
        console.warn('[live-agent] visitor message during handoff:', postErr.message);
      }
    }
    return {
      sessionId: sid,
      reply: '',
      replyParts: [],
      chips: [],
      forms: [],
      messages: [],
      liveAgent: true,
      humanActive: true,
      skipBot: true,
      agentConnected: !!(conv && conv.status === 'active' && conv.assignedAgentEmail),
      assignedAgentDisplayName: agentName,
      connectedMessage: agentName
        ? `You are now chatting with ${agentName}.`
        : '',
      outboundText: '',
    };
  }

  if (!eventName) {
    if (!message || typeof message !== 'string' || !message.trim()) {
      const err = new Error('message or event is required');
      err.status = 400;
      throw err;
    }
  }

  const dfProjectId =
    typeof dialogflowProjectId === 'string' && dialogflowProjectId.trim()
      ? dialogflowProjectId.trim()
      : undefined;

  const botId = resolveBotId_(opts);
  const trimmedMessage =
    !eventName && message && typeof message === 'string' ? message.trim() : '';

  let result = null;

  const welcomeEventName = resolveWelcomeEventForBot(botId);
  if (!eventName && trimmedMessage && isGenericOpener(trimmedMessage) && welcomeEventName) {
    result = await dialogflow.detectEvent(
      sid,
      welcomeEventName,
      languageCode,
      dfProjectId,
      { channel }
    );
  }

  // Published FAQs — strong match only, before Dialogflow (never override DF fallback).
  if (!result && !eventName && trimmedMessage) {
    const faqHit = faqStore.matchFaq(botId, trimmedMessage);
    if (faqHit && faqHit.item) {
      result = buildFaqResult(faqHit.item);
      result = await attachFaqNextIntentFollowUp(result, faqHit.item, {
        botId,
        sid,
        languageCode,
        dfProjectId,
        channel,
      });
    }
  }

  if (!result) {
    if (eventName) {
      result = await dialogflow.detectEvent(sid, eventName, languageCode, dfProjectId, {
        channel,
      });
    } else if (trimmedMessage) {
      result = await dialogflow.detectIntent(
        sid,
        trimmedMessage,
        languageCode,
        dfProjectId,
        { channel }
      );
    }
  }

  localTime.applyChatPlaceholdersToResult(result);

  if (PROVISION_RUNTIME_OVERRIDE) {
    const userTextForProvision = eventName ? '' : trimmedMessage || '';
    applyProvisionSheetToResult_(result, channel, userTextForProvision);
  }

  if (phraseTranslations.isEnabled()) {
    result = phraseTranslations.applyToResult(result, uiLang);
    if (result.followUp) {
      result.followUp = phraseTranslations.applyToResult(result.followUp, uiLang);
    }
  }

  if (result.liveAgent && isEsTest) {
    result.liveAgent = false;
    result.waitingForAgent = false;
    result.humanActive = false;
    result.skipBot = false;
    const qaNote =
      'QA test mode: live agent handoff is disabled and nothing is saved.';
    if (!result.reply || !String(result.reply).trim()) {
      result.reply = qaNote;
    } else {
      result.reply = String(result.reply).trim() + '\n\n' + qaNote;
    }
  } else if (result.liveAgent) {
    let handoffVisitorName = '';
    try {
      const doc = chatTranscript.getSessionDoc(sid);
      const meta = doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
      handoffVisitorName =
        (typeof meta.name === 'string' && meta.name.trim()) ||
        (typeof meta.visitorName === 'string' && meta.visitorName.trim()) ||
        '';
    } catch {
      /* ignore */
    }
    const handoff = await la.requestHandoff(sid, {
      userLanguage: uiLang,
      previewMessage: message ? message.trim() : '',
      visitorName: handoffVisitorName,
      department:
        (result.liveAgentDepartment && String(result.liveAgentDepartment).trim()) ||
        '',
    });
    if (handoff && handoff.outsideHours) {
      const closedMsg =
        (handoff.message && String(handoff.message).trim()) ||
        'Our live support team is currently unavailable. Please try again during business hours.';
      return {
        sessionId: sid,
        reply: closedMsg,
        replyParts: [],
        chips: [],
        forms: [],
        messages: [],
        liveAgent: false,
        humanActive: false,
        skipBot: false,
        outsideHours: true,
        outboundText: closedMsg,
      };
    }
    if (handoff && handoff.dismissed) {
      const dismissedMsg =
        'This chat was closed by our team. You can continue with the assistant below.';
      return {
        sessionId: sid,
        reply: dismissedMsg,
        replyParts: [],
        chips: [],
        forms: [],
        messages: [],
        liveAgent: false,
        humanActive: false,
        skipBot: false,
        outboundText: dismissedMsg,
      };
    }
    chatTranscript.mergeSessionMeta(sid, {
      channel: sheetChannel,
      liveAgentRequested: true,
      liveAgentActive: true,
    });
    result.reply = '';
    result.replyParts = [];
    result.chips = [];
    result.chipHeading = '';
    result.forms = [];
    result.infoCards = [];
    result.downloads = [];
    result.dropdowns = [];
    result.galleries = [];
    result.cardCarousels = [];
    result.liveAgent = true;
    result.waitingForAgent = true;
    result.humanActive = false;
    result.skipBot = false;
  }

  const userText = eventName ? '' : message && message.trim();
  if (!isEsTest) {
    chatTranscript.logDialogflowExchange(sid, userText, result, {
      skipTranscriptUser,
    });
    if (sheetChannel && sheetChannel !== 'Web') {
      chatTranscript.mergeSessionMeta(sid, { channel: sheetChannel });
    }
  }

  messageSyntax.applyFormattedReplyFields(result, channel);

  const outboundText = pickReplyText(result);

  return {
    ...result,
    sessionId: sid,
    esTestMode: isEsTest,
    orchestrationMode: typeof orchestrationMode === 'string' ? orchestrationMode : '',
    orchestrationChildId:
      typeof orchestrationChildId === 'string' ? orchestrationChildId : '',
    outboundText,
  };
}

module.exports = {
  processChatTurn,
  pickReplyText,
  isGenericOpener,
  resolveWelcomeEventForBot,
};
