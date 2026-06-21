/**
 * Deliver agent / system text replies to WhatsApp, Instagram, Facebook sessions.
 */

const channelSessions = require('./channel-sessions');

function integrationFor(channel) {
  if (channel === 'whatsapp') return require('./whatsapp');
  if (channel === 'instagram') return require('./instagram');
  if (channel === 'facebook') return require('./facebook');
  return null;
}

async function deliverAgentReply(sessionId, text) {
  const sid = String(sessionId || '').trim();
  const body = text == null ? '' : String(text).trim();
  if (!sid || !body) return { sent: false, reason: 'empty' };

  const { channel, externalId } = channelSessions.parseSessionId(sid);
  const integration = integrationFor(channel);
  if (!integration || !integration.enabled) {
    return { sent: false, reason: 'not_social_session' };
  }
  if (!integration.isConfigured()) {
    return { sent: false, reason: `${channel}_not_configured` };
  }
  await integration.sendOutboundReply(externalId, body);
  return { sent: true, channel };
}

module.exports = {
  deliverAgentReply,
};
