/**
 * Per-bot social channel settings (WhatsApp, Instagram, Facebook).
 * Saved from Supersetting → social-integrations.json
 */

const fs = require('fs');
const path = require('path');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');

const FILE_NAME = 'social-integrations.json';
const LEGACY_FILE = 'whatsapp-integration.json';
const CHANNEL_IDS = ['whatsapp', 'instagram', 'facebook'];

const WHATSAPP_PROVIDERS = [
  'meta',
  'aisensy',
  'wati',
  'interakt',
  'gupshup',
  'dialog360',
  'twilio',
];

const META_MESSENGER_FIELDS = [
  {
    key: 'pageAccessToken',
    label: 'Page access token',
    placeholder: 'EAAxxxx…',
    secret: true,
    env: 'FB_PAGE_ACCESS_TOKEN',
    hint: 'Meta App → Messenger → Generate token for your Facebook Page.',
  },
  {
    key: 'appSecret',
    label: 'App secret',
    placeholder: 'Meta app secret',
    secret: true,
    env: 'META_APP_SECRET',
    hint: 'Meta App → Settings → Basic → App secret.',
  },
  {
    key: 'verifyToken',
    label: 'Webhook verify token',
    placeholder: 'your-verify-string',
    env: 'META_VERIFY_TOKEN',
    hint: 'Same string in Meta webhook setup.',
  },
];

const CHANNEL_SCHEMAS = {
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    tagline: 'Business API — multiple BSP vendors',
    sessionPrefix: 'wa-',
    accent: '#25D366',
    defaultProvider: 'meta',
    providerIds: WHATSAPP_PROVIDERS,
    providers: {
      meta: {
        id: 'meta',
        label: 'Meta Cloud API',
        webhookPath: '/webhooks/meta',
        docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
        fields: [
          {
            key: 'accessToken',
            label: 'Access token',
            placeholder: 'EAAxxxx…',
            secret: true,
            env: 'WHATSAPP_TOKEN',
            hint: 'Meta App → WhatsApp → API setup.',
          },
          {
            key: 'phoneNumberId',
            label: 'Phone number ID',
            placeholder: '123456789012345',
            env: 'WHATSAPP_PHONE_NUMBER_ID',
            hint: 'WABA → Phone numbers → Phone number ID.',
          },
          {
            key: 'appSecret',
            label: 'App secret',
            placeholder: 'Meta app secret',
            secret: true,
            env: 'WHATSAPP_APP_SECRET',
            hint: 'Webhook signature verification.',
          },
          {
            key: 'verifyToken',
            label: 'Webhook verify token',
            placeholder: 'your-verify-string',
            env: 'WHATSAPP_VERIFY_TOKEN',
            hint: 'Any string — same in Meta webhook.',
          },
        ],
      },
      aisensy: {
        id: 'aisensy',
        label: 'AiSensy',
        webhookPath: '/webhooks/aisensy',
        docsUrl: 'https://docs.aisensy.com/',
        fields: [
          { key: 'apiKey', label: 'API key', placeholder: 'Partner key', secret: true, env: 'AISENSY_API_KEY', hint: 'AiSensy dashboard → API.' },
          { key: 'projectId', label: 'Project ID', placeholder: 'Optional', env: 'AISENSY_PROJECT_ID', hint: 'Campaign / project ID if provided.' },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'Optional', secret: true, env: 'AISENSY_WEBHOOK_SECRET', hint: 'Inbound webhook verification.' },
        ],
      },
      wati: {
        id: 'wati',
        label: 'WATI',
        webhookPath: '/webhooks/wati',
        docsUrl: 'https://docs.wati.io/',
        fields: [
          { key: 'apiBaseUrl', label: 'API base URL', placeholder: 'https://live-server-xxxx.wati.io/api/v1', env: 'WATI_API_BASE_URL', hint: 'WATI → API docs → server URL.' },
          { key: 'accessToken', label: 'Bearer token', placeholder: 'WATI token', secret: true, env: 'WATI_ACCESS_TOKEN', hint: 'WATI API bearer token.' },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'Optional', secret: true, env: 'WATI_WEBHOOK_SECRET', hint: 'Optional signing secret.' },
        ],
      },
      interakt: {
        id: 'interakt',
        label: 'Interakt',
        webhookPath: '/webhooks/interakt',
        docsUrl: 'https://www.interakt.shop/resource-center/',
        fields: [
          { key: 'apiKey', label: 'API key', placeholder: 'Interakt key', secret: true, env: 'INTERAKT_API_KEY', hint: 'Developer settings → API key.' },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'Signing secret', secret: true, env: 'INTERAKT_WEBHOOK_SECRET', hint: 'Verify Interakt callbacks.' },
        ],
      },
      gupshup: {
        id: 'gupshup',
        label: 'Gupshup',
        webhookPath: '/webhooks/gupshup',
        docsUrl: 'https://docs.gupshup.io/',
        fields: [
          { key: 'apiKey', label: 'API key', placeholder: 'Gupshup key', secret: true, env: 'GUPSHUP_API_KEY', hint: 'Dashboard → API keys.' },
          { key: 'appName', label: 'App name', placeholder: 'App name', env: 'GUPSHUP_APP_NAME', hint: 'Send API src.name.' },
          { key: 'sourceNumber', label: 'Source number', placeholder: '91XXXXXXXXXX', env: 'GUPSHUP_SOURCE_NUMBER', hint: 'WhatsApp number without +.' },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'Optional', secret: true, env: 'GUPSHUP_WEBHOOK_SECRET', hint: 'Optional verification.' },
        ],
      },
      dialog360: {
        id: 'dialog360',
        label: '360dialog',
        webhookPath: '/webhooks/360dialog',
        docsUrl: 'https://docs.360dialog.com/',
        fields: [
          { key: 'apiKey', label: 'D360 API key', placeholder: 'D360-API-KEY', secret: true, env: 'DIALOG360_API_KEY', hint: '360dialog Hub → API keys.' },
          { key: 'phoneNumberId', label: 'Phone number ID', placeholder: 'Optional', env: 'DIALOG360_PHONE_NUMBER_ID', hint: 'WABA phone ID if separate.' },
          { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'Optional', secret: true, env: 'DIALOG360_WEBHOOK_SECRET', hint: 'Webhook verification.' },
        ],
      },
      twilio: {
        id: 'twilio',
        label: 'Twilio',
        webhookPath: '/webhooks/twilio',
        docsUrl: 'https://www.twilio.com/docs/whatsapp',
        fields: [
          { key: 'accountSid', label: 'Account SID', placeholder: 'ACxxxxxxxx', env: 'TWILIO_ACCOUNT_SID', hint: 'Twilio Console → Account SID.' },
          { key: 'authToken', label: 'Auth token', placeholder: 'Auth token', secret: true, env: 'TWILIO_AUTH_TOKEN', hint: 'Twilio auth token.' },
          { key: 'whatsappFrom', label: 'WhatsApp sender', placeholder: 'whatsapp:+14155238886', env: 'TWILIO_WHATSAPP_FROM', hint: 'whatsapp:+E164 format.' },
          { key: 'messagingServiceSid', label: 'Messaging service SID', placeholder: 'MGxxx (optional)', env: 'TWILIO_MESSAGING_SERVICE_SID', hint: 'Optional Messaging Service.' },
        ],
      },
    },
    botFields: [
      { key: 'welcomeEventName', label: 'Welcome event', placeholder: 'START_GREEN_VALLEY', hint: 'Dialogflow event on Hi/Hello.' },
      { key: 'sitePreset', label: 'Site preset', placeholder: 'greenValley', hint: 'Sheet / analytics routing.' },
      { key: 'idleTimeoutMs', label: 'ENDCHAT idle (ms)', placeholder: '10000', hint: '0 = no idle goodbye.' },
    ],
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    tagline: 'Instagram DM via Meta Messenger API',
    sessionPrefix: 'ig-',
    accent: '#E4405F',
    defaultProvider: 'meta',
    providerIds: ['meta'],
    providers: {
      meta: {
        id: 'meta',
        label: 'Meta (Instagram Messaging)',
        webhookPath: '/webhooks/meta',
        docsUrl: 'https://developers.facebook.com/docs/messenger-platform/instagram',
        fields: META_MESSENGER_FIELDS.concat([
          {
            key: 'instagramAccountId',
            label: 'Instagram account ID',
            placeholder: '17841400…',
            env: 'INSTAGRAM_PAGE_ID',
            hint: 'Connected Instagram professional account ID (optional).',
          },
        ]),
      },
    },
    botFields: [
      { key: 'welcomeEventName', label: 'Welcome event', placeholder: 'Optional', hint: 'Dialogflow event for conversation start.' },
      { key: 'sitePreset', label: 'Site preset', placeholder: 'greenValley', hint: 'Sheet / analytics routing.' },
    ],
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    tagline: 'Facebook Page Messenger',
    sessionPrefix: 'fb-',
    accent: '#1877F2',
    defaultProvider: 'meta',
    providerIds: ['meta'],
    providers: {
      meta: {
        id: 'meta',
        label: 'Meta (Page Messaging)',
        webhookPath: '/webhooks/meta',
        docsUrl: 'https://developers.facebook.com/docs/messenger-platform',
        fields: META_MESSENGER_FIELDS.concat([
          {
            key: 'pageId',
            label: 'Facebook Page ID',
            placeholder: '123456789012345',
            env: 'FB_PAGE_ID',
            hint: 'Your Facebook Page numeric ID.',
          },
        ]),
      },
    },
    botFields: [
      { key: 'welcomeEventName', label: 'Welcome event', placeholder: 'Optional', hint: 'Dialogflow event for conversation start.' },
      { key: 'sitePreset', label: 'Site preset', placeholder: 'receptionist', hint: 'Sheet / analytics routing.' },
    ],
  },
};

function filePath() {
  return clientPaths.socialIntegrationsPath();
}

function legacyWhatsappPath() {
  return clientPaths.whatsappIntegrationSettingsPath();
}

function ensureDir() {
  const dir = clientPaths.dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function registryBot(botId) {
  try {
    const sitePresetsStore = require('./site-presets-store');
    return sitePresetsStore.listProjects().find((b) => b.id === botId) || null;
  } catch {
    return null;
  }
}

function validateBotId(botId) {
  const bid = String(botId || '').trim();
  if (!/^\d{5}$/.test(bid)) return { ok: false, error: 'Invalid bot ID' };
  const bot = registryBot(bid);
  if (!bot) return { ok: false, error: 'Bot not found' };
  return { ok: true, botId: bid, bot };
}

function validateChannel(channel) {
  const ch = String(channel || '').trim().toLowerCase();
  if (!CHANNEL_IDS.includes(ch)) return { ok: false, error: 'Unknown channel' };
  return { ok: true, channel: ch };
}

function channelSchema(channel) {
  return CHANNEL_SCHEMAS[channel] || null;
}

function getProviderIds(channel) {
  const schema = channelSchema(channel);
  return schema ? schema.providerIds : [];
}

function defaultProviderValues(channel) {
  const schema = channelSchema(channel);
  const out = {};
  if (!schema) return out;
  for (const id of schema.providerIds) {
    const prov = schema.providers[id];
    const row = { notes: '' };
    for (const f of prov.fields) row[f.key] = '';
    out[id] = row;
  }
  return out;
}

function defaultChannelConfig(botId, channel) {
  const bid = String(botId || '').trim();
  const schema = channelSchema(channel);
  const reg = registryBot(bid);
  const bot = {
    welcomeEventName: reg ? String(reg.welcomeEventName || '').trim() : '',
    sitePreset: reg ? String(reg.sitePreset || '').trim() : '',
    botId: bid,
  };
  if (channel === 'whatsapp') bot.idleTimeoutMs = 10000;
  return {
    enabled: false,
    activeProvider: schema ? schema.defaultProvider : 'meta',
    providers: defaultProviderValues(channel),
    bot,
  };
}

function normalizeChannelConfig(raw, botId, channel) {
  const base = defaultChannelConfig(botId, channel);
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const schema = channelSchema(channel);
  const providers = defaultProviderValues(channel);
  const incoming =
    cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  if (schema) {
    for (const id of schema.providerIds) {
      const row = incoming[id] && typeof incoming[id] === 'object' ? incoming[id] : {};
      providers[id] = Object.assign({}, providers[id], row);
    }
  }
  const botIn = cfg.bot && typeof cfg.bot === 'object' ? cfg.bot : {};
  const bot = Object.assign({}, base.bot, botIn, { botId: String(botId || '').trim() });
  if (channel === 'whatsapp' && bot.idleTimeoutMs == null) bot.idleTimeoutMs = 10000;
  return {
    enabled: Boolean(cfg.enabled),
    activeProvider:
      schema && schema.providerIds.includes(cfg.activeProvider)
        ? cfg.activeProvider
        : base.activeProvider,
    providers,
    bot,
  };
}

function hasChannelCredentials(cfg, channel) {
  if (!cfg) return false;
  const schema = channelSchema(channel);
  if (!schema) return false;
  const providers = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  for (const id of schema.providerIds) {
    const row = providers[id];
    if (!row || typeof row !== 'object') continue;
    for (const f of schema.providers[id].fields) {
      if (String(row[f.key] || '').trim()) return true;
    }
  }
  return false;
}

function isChannelStored(botId, channel) {
  const doc = readFileDoc();
  const bid = String(botId || '').trim();
  const ch = String(channel || '').trim();
  const entry = doc.bots[bid];
  return !!(entry && entry[ch] && typeof entry[ch] === 'object');
}

/** @deprecated use hasChannelCredentials / isChannelStored + enabled */
function isChannelConfigured(cfg, channel) {
  return hasChannelCredentials(cfg, channel);
}

function normalizeBotEntry(raw, botId) {
  const bid = String(botId || '').trim();
  const entry = raw && typeof raw === 'object' ? raw : {};
  if (entry.providers && !entry.whatsapp && !entry.instagram && !entry.facebook) {
    return { whatsapp: normalizeChannelConfig(entry, bid, 'whatsapp') };
  }
  const out = {};
  for (const ch of CHANNEL_IDS) {
    out[ch] = normalizeChannelConfig(entry[ch], bid, ch);
  }
  return out;
}

function migrateLegacyWhatsapp() {
  const legacy = legacyWhatsappPath();
  if (!fs.existsSync(legacy)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    if (!raw || !raw.bots || typeof raw.bots !== 'object') return null;
    const bots = {};
    for (const [bid, stored] of Object.entries(raw.bots)) {
      bots[bid] = normalizeBotEntry(stored, bid);
    }
    return { updatedAt: raw.updatedAt || new Date().toISOString(), bots };
  } catch {
    return null;
  }
}

function readFileDoc() {
  ensureDir();
  const fp = filePath();
  if (!fs.existsSync(fp)) {
    const migrated = migrateLegacyWhatsapp();
    const seed = migrated || { updatedAt: new Date().toISOString(), bots: {} };
    fs.writeFileSync(fp, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (raw && raw.bots && typeof raw.bots === 'object') {
      const bots = {};
      for (const [bid, stored] of Object.entries(raw.bots)) {
        bots[bid] = normalizeBotEntry(stored, bid);
      }
      return { updatedAt: raw.updatedAt || new Date().toISOString(), bots };
    }
    return { updatedAt: new Date().toISOString(), bots: {} };
  } catch (err) {
    console.warn('[social-integration] read failed:', err.message);
    return { updatedAt: new Date().toISOString(), bots: {} };
  }
}

function writeFileDoc(doc) {
  const next = {
    updatedAt: new Date().toISOString(),
    bots: doc && doc.bots && typeof doc.bots === 'object' ? doc.bots : {},
  };
  ensureDir();
  fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8');
  dataFileSync.scheduleSync(FILE_NAME);
  return next;
}

function readChannelConfig(botId, channel) {
  const bid = String(botId || '').trim();
  const ch = String(channel || '').trim();
  const doc = readFileDoc();
  const entry = doc.bots[bid];
  if (!entry) return defaultChannelConfig(bid, ch);
  return normalizeChannelConfig(entry[ch], bid, ch);
}

function saveChannelConfig(botId, channel, patch) {
  const botCheck = validateBotId(botId);
  if (!botCheck.ok) return botCheck;
  const chCheck = validateChannel(channel);
  if (!chCheck.ok) return chCheck;

  const bid = botCheck.botId;
  const ch = chCheck.channel;
  const schema = channelSchema(ch);
  const doc = readFileDoc();
  if (!doc.bots[bid]) doc.bots[bid] = normalizeBotEntry({}, bid);
  const current = readChannelConfig(bid, ch);
  const next = normalizeChannelConfig(current, bid, ch);

  if (patch && typeof patch === 'object') {
    if ('enabled' in patch) next.enabled = Boolean(patch.enabled);
    if (patch.activeProvider && schema.providerIds.includes(patch.activeProvider)) {
      next.activeProvider = patch.activeProvider;
    }
    if (patch.providers && typeof patch.providers === 'object') {
      for (const id of schema.providerIds) {
        if (!patch.providers[id] || typeof patch.providers[id] !== 'object') continue;
        const prov = schema.providers[id];
        const allowed = new Set(prov.fields.map((f) => f.key).concat(['notes']));
        for (const [key, val] of Object.entries(patch.providers[id])) {
          if (!allowed.has(key)) continue;
          next.providers[id][key] = val == null ? '' : String(val).trim();
        }
      }
    }
    if (patch.bot && typeof patch.bot === 'object') {
      for (const f of schema.botFields) {
        if (patch.bot[f.key] == null) continue;
        if (f.key === 'idleTimeoutMs') {
          const n = parseInt(patch.bot.idleTimeoutMs, 10);
          next.bot.idleTimeoutMs = Number.isFinite(n) ? Math.max(0, n) : 0;
        } else {
          next.bot[f.key] = String(patch.bot[f.key]).trim();
        }
      }
    }
  }

  next.bot.botId = bid;
  doc.bots[bid][ch] = next;
  writeFileDoc(doc);
  return { ok: true, config: next, botId: bid, channel: ch };
}

function buildWebhookUrl(publicBaseUrl, channel, providerId, botId) {
  const schema = channelSchema(channel);
  const prov = schema && schema.providers[providerId];
  const webhookPath = (prov && prov.webhookPath) || '/webhooks/meta';
  const base = String(publicBaseUrl || '').replace(/\/$/, '');
  const q = `?bid=${encodeURIComponent(botId)}&channel=${encodeURIComponent(channel)}`;
  return base ? `${base}${webhookPath}${q}` : `${webhookPath}${q}`;
}

function getChannelView(botId, channel, publicBaseUrl) {
  const botCheck = validateBotId(botId);
  if (!botCheck.ok) return botCheck;
  const chCheck = validateChannel(channel);
  if (!chCheck.ok) return chCheck;

  const bid = botCheck.botId;
  const ch = chCheck.channel;
  const schema = channelSchema(ch);
  const cfg = readChannelConfig(bid, ch);
  const providerId = cfg.activeProvider || schema.defaultProvider;

  return {
    ok: true,
    botId: bid,
    botName: botCheck.bot.name,
    channel: ch,
    channelMeta: {
      label: schema.label,
      tagline: schema.tagline,
      sessionPrefix: schema.sessionPrefix,
      accent: schema.accent,
    },
    enabled: !!cfg.enabled,
    hasCredentials: hasChannelCredentials(cfg, ch),
    stored: isChannelStored(bid, ch),
    /** true if form should show (saved before or has credentials) */
    configured: isChannelStored(bid, ch) || hasChannelCredentials(cfg, ch),
    config: cfg,
    schema: {
      providerIds: schema.providerIds,
      providers: schema.providers,
      botFields: schema.botFields,
    },
    publicBaseUrl: publicBaseUrl || '',
    webhookUrl: buildWebhookUrl(publicBaseUrl, ch, providerId, bid),
    webhookPath: schema.providers[providerId].webhookPath,
  };
}

function getBotSummary(botId, publicBaseUrl) {
  const botCheck = validateBotId(botId);
  if (!botCheck.ok) return botCheck;
  const bid = botCheck.botId;
  const channels = {};
  for (const ch of CHANNEL_IDS) {
    const cfg = readChannelConfig(bid, ch);
    const schema = channelSchema(ch);
    channels[ch] = {
      label: schema.label,
      enabled: !!cfg.enabled,
      hasCredentials: hasChannelCredentials(cfg, ch),
      stored: isChannelStored(bid, ch),
      configured: isChannelStored(bid, ch) || hasChannelCredentials(cfg, ch),
      activeProvider: cfg.activeProvider,
      sessionPrefix: schema.sessionPrefix,
      accent: schema.accent,
    };
  }
  return {
    ok: true,
    botId: bid,
    botName: botCheck.bot.name,
    channels,
    publicBaseUrl: publicBaseUrl || '',
  };
}

module.exports = {
  FILE_NAME,
  CHANNEL_IDS,
  CHANNEL_SCHEMAS,
  validateBotId,
  validateChannel,
  getProviderIds,
  readChannelConfig,
  saveChannelConfig,
  getChannelView,
  getBotSummary,
  isChannelConfigured,
  hasChannelCredentials,
  isChannelStored,
  buildWebhookUrl,
};
