/**
 * Session IDs per channel:
 *   web-  website widget
 *   wa-   WhatsApp
 *   ig-   Instagram DM
 *   fb-   Facebook Messenger
 *   es-test-  ES test sandbox (unchanged)
 */

const { randomUUID } = require('crypto');

const PREFIX = {
  web: 'web-',
  wa: 'wa-',
  ig: 'ig-',
  fb: 'fb-',
  test: 'es-test-',
};

const CHANNEL_BY_PREFIX = {
  'web-': 'web',
  'wa-': 'whatsapp',
  'ig-': 'instagram',
  'fb-': 'facebook',
  'es-test-': 'test',
};

const SHEET_CHANNEL = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  test: 'Web',
};

function sanitizeExternalId(id) {
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9._+-]/g, '');
}

function sessionIdFor(channelKey, externalId) {
  const prefix = PREFIX[channelKey];
  if (!prefix) throw new Error(`Unknown channel key: ${channelKey}`);
  const key = sanitizeExternalId(externalId);
  if (!key) throw new Error('externalId required for session');
  return prefix + key;
}

function parseSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  for (const [pfx, channel] of Object.entries(CHANNEL_BY_PREFIX)) {
    if (sid.startsWith(pfx)) {
      return {
        channel,
        prefix: pfx,
        externalId: sid.slice(pfx.length),
        sessionId: sid,
      };
    }
  }
  return { channel: 'web', prefix: '', externalId: sid, sessionId: sid };
}

function channelFromSessionId(sessionId) {
  return parseSessionId(sessionId).channel;
}

function sheetChannelName(sessionId) {
  const ch = channelFromSessionId(sessionId);
  return SHEET_CHANNEL[ch] || 'Web';
}

function resolveWebSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return sessionIdFor('web', randomUUID());
  if (sid.startsWith(PREFIX.test)) return sid;
  if (sid.startsWith(PREFIX.web)) return sid;
  if (sid.startsWith(PREFIX.wa) || sid.startsWith(PREFIX.ig) || sid.startsWith(PREFIX.fb)) {
    return sid;
  }
  // Legacy es- prefix from older widget builds
  if (sid.startsWith('es-')) return PREFIX.web + sid.slice(3);
  return PREFIX.web + sid;
}

function newWebSessionId() {
  return sessionIdFor('web', randomUUID());
}

module.exports = {
  PREFIX,
  CHANNEL_BY_PREFIX,
  SHEET_CHANNEL,
  sessionIdFor,
  parseSessionId,
  channelFromSessionId,
  sheetChannelName,
  resolveWebSessionId,
  newWebSessionId,
};
