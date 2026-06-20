/**
 * Per-bot CRM integration — structured config (provider, auth, triggers, field map).
 */

const fs = require('fs');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');
const sitePresetsStore = require('./site-presets-store');

const FILE_NAME = 'crm-integration.json';

const PROVIDERS = [
  { id: 'zoho', label: 'Zoho CRM', baseUrl: 'https://www.zohoapis.in/crm/v2', module: 'Leads', path: '/Leads' },
  { id: 'salesforce', label: 'Salesforce', baseUrl: 'https://your-instance.salesforce.com', module: 'Lead', path: '/services/data/v58.0/sobjects/Lead' },
  { id: 'hubspot', label: 'HubSpot', baseUrl: 'https://api.hubapi.com', module: 'contacts', path: '/crm/v3/objects/contacts' },
  { id: 'pipedrive', label: 'Pipedrive', baseUrl: 'https://api.pipedrive.com/v1', module: 'persons', path: '/persons' },
  { id: 'custom', label: 'Custom REST API', baseUrl: '', module: '', path: '' },
];

const CHAT_FIELDS = [
  { id: 'name', label: 'Visitor name' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'email', label: 'Email' },
  { id: 'city', label: 'City' },
  { id: 'channel', label: 'Channel' },
  { id: 'sourceUrl', label: 'Source URL' },
  { id: 'repeatedUserLabel', label: 'First time / Repeated' },
  { id: 'appointmentDateDisplay', label: 'Appointment date' },
  { id: 'appointmentTimeDisplay', label: 'Appointment time' },
  { id: 'transcriptUrl', label: 'Transcript link' },
];

const DEFAULT_FIELD_MAP = {
  zoho: [
    { chatField: 'name', crmField: 'Last_Name' },
    { chatField: 'email', crmField: 'Email' },
    { chatField: 'mobile', crmField: 'Phone' },
    { chatField: 'city', crmField: 'City' },
  ],
  salesforce: [
    { chatField: 'name', crmField: 'LastName' },
    { chatField: 'email', crmField: 'Email' },
    { chatField: 'mobile', crmField: 'Phone' },
  ],
  hubspot: [
    { chatField: 'email', crmField: 'email' },
    { chatField: 'name', crmField: 'firstname' },
    { chatField: 'mobile', crmField: 'phone' },
  ],
  pipedrive: [
    { chatField: 'name', crmField: 'name' },
    { chatField: 'email', crmField: 'email' },
    { chatField: 'mobile', crmField: 'phone' },
  ],
  custom: [
    { chatField: 'name', crmField: 'name' },
    { chatField: 'email', crmField: 'email' },
    { chatField: 'mobile', crmField: 'mobile' },
  ],
};

function filePath() {
  return clientPaths.crmIntegrationPath();
}

function defaultBotConfig(provider) {
  const p = PROVIDERS.find((x) => x.id === provider) || PROVIDERS[0];
  return {
    enabled: false,
    provider: p.id,
    connection: {
      baseUrl: p.baseUrl,
      authType: 'api_key',
      apiKey: '',
      bearerToken: '',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
    },
    api: {
      method: 'POST',
      module: p.module,
      path: p.path,
    },
    triggers: {
      leadCapture: true,
      hotLead: true,
      appointmentBooked: true,
    },
    fieldMap: (DEFAULT_FIELD_MAP[p.id] || DEFAULT_FIELD_MAP.custom).map((row) => ({ ...row })),
    updatedAt: null,
  };
}

function defaultFileData() {
  return { updatedAt: null, bots: {} };
}

function normalizeBotId(botId) {
  return sitePresetsStore.normalizeBotId(botId);
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

function normalizeFieldMap(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((row) => ({
      chatField: String((row && row.chatField) || '').trim(),
      crmField: String((row && row.crmField) || '').trim(),
    }))
    .filter((row) => row.chatField && row.crmField);
}

function normalizeBotConfig(raw, fallbackProvider) {
  const c = raw && typeof raw === 'object' ? raw : {};

  if (c.source && !c.provider && !c.connection) {
    try {
      let body = String(c.source).trim();
      body = body.replace(/^export\s+default\s+/, '');
      body = body.replace(/^module\.exports\s*=\s*/, '');
      body = body.replace(/;\s*$/, '');
      const legacy = JSON.parse(body);
      if (legacy && typeof legacy === 'object') {
        return normalizeBotConfig(
          {
            enabled: c.enabled,
            provider: legacy.provider,
            connection: {
              baseUrl: legacy.baseUrl || (legacy.connection && legacy.connection.baseUrl),
              authType: (legacy.auth && legacy.auth.type) || 'api_key',
              refreshToken: legacy.auth && legacy.auth.refreshToken,
              clientId: legacy.auth && legacy.auth.clientId,
              clientSecret: legacy.auth && legacy.auth.clientSecret,
            },
            api: legacy.triggers && legacy.triggers.leadCapture ? legacy.triggers.leadCapture : legacy.api,
            triggers: {
              leadCapture: true,
              hotLead: true,
              appointmentBooked: true,
            },
            fieldMap:
              legacy.triggers &&
              legacy.triggers.leadCapture &&
              legacy.triggers.leadCapture.map
                ? Object.keys(legacy.triggers.leadCapture.map).map(function (crmField) {
                    return {
                      crmField,
                      chatField: String(legacy.triggers.leadCapture.map[crmField])
                        .replace(/^\{\{|\}\}$/g, '')
                        .trim(),
                    };
                  })
                : undefined,
          },
          legacy.provider
        );
      }
    } catch (_e) {
      /* fall through */
    }
  }

  const base = defaultBotConfig(fallbackProvider || 'zoho');
  const provider = PROVIDERS.some((p) => p.id === c.provider) ? c.provider : base.provider;
  const merged = defaultBotConfig(provider);
  merged.enabled = c.enabled != null ? !!c.enabled : merged.enabled;

  const conn = c.connection && typeof c.connection === 'object' ? c.connection : {};
  merged.connection.baseUrl = String(conn.baseUrl != null ? conn.baseUrl : merged.connection.baseUrl).trim();
  merged.connection.authType =
    ['api_key', 'bearer', 'oauth'].indexOf(conn.authType) >= 0 ? conn.authType : merged.connection.authType;
  if (conn.apiKey != null && String(conn.apiKey).trim()) merged.connection.apiKey = String(conn.apiKey).trim();
  if (conn.bearerToken != null && String(conn.bearerToken).trim()) {
    merged.connection.bearerToken = String(conn.bearerToken).trim();
  }
  if (conn.clientId != null) merged.connection.clientId = String(conn.clientId || '').trim();
  if (conn.clientSecret != null && String(conn.clientSecret).trim()) {
    merged.connection.clientSecret = String(conn.clientSecret).trim();
  }
  if (conn.refreshToken != null && String(conn.refreshToken).trim()) {
    merged.connection.refreshToken = String(conn.refreshToken).trim();
  }

  const api = c.api && typeof c.api === 'object' ? c.api : {};
  merged.api.method = String(api.method || merged.api.method || 'POST').toUpperCase();
  merged.api.module = String(api.module != null ? api.module : merged.api.module).trim();
  merged.api.path = String(api.path != null ? api.path : merged.api.path).trim();

  const triggers = c.triggers && typeof c.triggers === 'object' ? c.triggers : {};
  merged.triggers.leadCapture = triggers.leadCapture !== false;
  merged.triggers.hotLead = triggers.hotLead !== false;
  merged.triggers.appointmentBooked = triggers.appointmentBooked !== false;

  if (Array.isArray(c.fieldMap) && c.fieldMap.length) {
    merged.fieldMap = normalizeFieldMap(c.fieldMap);
  }

  merged.updatedAt = c.updatedAt || null;
  return merged;
}

function readFile_() {
  const p = filePath();
  if (!fs.existsSync(p)) return defaultFileData();
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...defaultFileData(), ...data, bots: { ...(data.bots || {}) } };
  } catch (err) {
    console.warn('[crm-integration] read failed:', err.message);
    return defaultFileData();
  }
}

function writeFile_(data) {
  const p = filePath();
  fs.mkdirSync(clientPaths.dataDir(), { recursive: true });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  dataFileSync.scheduleSync(FILE_NAME);
}

function connectionReady(cfg) {
  const conn = cfg.connection || {};
  if (!String(conn.baseUrl || '').trim()) return false;
  if (conn.authType === 'oauth') {
    return !!(String(conn.refreshToken || '').trim() || String(conn.clientId || '').trim());
  }
  if (conn.authType === 'bearer') {
    return !!String(conn.bearerToken || '').trim();
  }
  return !!String(conn.apiKey || '').trim();
}

function statusLabel(cfg) {
  if (!cfg.enabled) return 'Disabled';
  if (!connectionReady(cfg)) return 'Not connected';
  if (!normalizeFieldMap(cfg.fieldMap).length) return 'Add field mapping';
  return 'Ready';
}

function publicConnection(conn) {
  const c = conn || {};
  return {
    baseUrl: c.baseUrl || '',
    authType: c.authType || 'api_key',
    apiKeySet: !!String(c.apiKey || '').trim(),
    apiKeyHint: maskSecret(c.apiKey),
    bearerTokenSet: !!String(c.bearerToken || '').trim(),
    bearerTokenHint: maskSecret(c.bearerToken),
    clientId: c.clientId || '',
    clientSecretSet: !!String(c.clientSecret || '').trim(),
    clientSecretHint: maskSecret(c.clientSecret),
    refreshTokenSet: !!String(c.refreshToken || '').trim(),
    refreshTokenHint: maskSecret(c.refreshToken),
  };
}

function publicView(cfg) {
  return {
    enabled: !!cfg.enabled,
    provider: cfg.provider,
    connection: publicConnection(cfg.connection),
    api: { ...(cfg.api || {}) },
    triggers: { ...(cfg.triggers || {}) },
    fieldMap: normalizeFieldMap(cfg.fieldMap),
    status: statusLabel(cfg),
    updatedAt: cfg.updatedAt || null,
  };
}

function getBotConfig(botId) {
  const id = normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = data.bots[id] || {};
  const cfg = normalizeBotConfig(stored);
  return {
    ok: true,
    botId: id,
    botName: project.name,
    config: publicView(cfg),
    providers: PROVIDERS,
    chatFields: CHAT_FIELDS,
    defaultFieldMap: DEFAULT_FIELD_MAP,
  };
}

function mergeBotConfig(current, patch) {
  const base = normalizeBotConfig(current);
  const p = patch && typeof patch === 'object' ? patch : {};

  if (p.enabled != null) base.enabled = !!p.enabled;
  if (p.provider && PROVIDERS.some((x) => x.id === p.provider)) {
    if (p.provider !== base.provider && !p.connection && !p.api && !p.fieldMap) {
      const fresh = defaultBotConfig(p.provider);
      base.provider = fresh.provider;
      base.connection.baseUrl = fresh.connection.baseUrl;
      base.api = fresh.api;
      base.fieldMap = fresh.fieldMap;
    } else {
      base.provider = p.provider;
    }
  }

  if (p.connection) {
    const conn = p.connection;
    if (conn.baseUrl != null) base.connection.baseUrl = String(conn.baseUrl).trim();
    if (conn.authType != null) base.connection.authType = conn.authType;
    if (conn.apiKey != null && String(conn.apiKey).trim()) {
      base.connection.apiKey = String(conn.apiKey).trim();
    }
    if (conn.bearerToken != null && String(conn.bearerToken).trim()) {
      base.connection.bearerToken = String(conn.bearerToken).trim();
    }
    if (conn.clientId != null) base.connection.clientId = String(conn.clientId).trim();
    if (conn.clientSecret != null && String(conn.clientSecret).trim()) {
      base.connection.clientSecret = String(conn.clientSecret).trim();
    }
    if (conn.refreshToken != null && String(conn.refreshToken).trim()) {
      base.connection.refreshToken = String(conn.refreshToken).trim();
    }
  }

  if (p.api) {
    if (p.api.method != null) base.api.method = String(p.api.method).toUpperCase();
    if (p.api.module != null) base.api.module = String(p.api.module).trim();
    if (p.api.path != null) base.api.path = String(p.api.path).trim();
  }

  if (p.triggers) {
    if (p.triggers.leadCapture != null) base.triggers.leadCapture = !!p.triggers.leadCapture;
    if (p.triggers.hotLead != null) base.triggers.hotLead = !!p.triggers.hotLead;
    if (p.triggers.appointmentBooked != null) {
      base.triggers.appointmentBooked = !!p.triggers.appointmentBooked;
    }
  }

  if (p.fieldMap != null) base.fieldMap = normalizeFieldMap(p.fieldMap);

  base.updatedAt = new Date().toISOString();
  return base;
}

function saveBotConfig(botId, patch) {
  const id = normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = data.bots[id] || {};
  const merged = mergeBotConfig(stored, patch);
  data.bots[id] = merged;
  writeFile_(data);
  return getBotConfig(id);
}

function buildAuthHeaders(cfg) {
  const conn = cfg.connection || {};
  if (conn.authType === 'bearer' && conn.bearerToken) {
    return { Authorization: 'Bearer ' + conn.bearerToken };
  }
  if (conn.authType === 'oauth' && conn.refreshToken) {
    return { Authorization: 'Zoho-oauthtoken ' + conn.refreshToken };
  }
  if (conn.apiKey) {
    if (cfg.provider === 'zoho') return { Authorization: 'Zoho-oauthtoken ' + conn.apiKey };
    if (cfg.provider === 'hubspot') return { Authorization: 'Bearer ' + conn.apiKey };
    return { 'X-API-Key': conn.apiKey };
  }
  return {};
}

async function testConnection(botId) {
  const result = getBotConfig(botId);
  if (!result.ok) return result;
  const data = readFile_();
  const cfg = normalizeBotConfig(data.bots[normalizeBotId(botId)]);
  if (!cfg.enabled) return { ok: false, error: 'Enable CRM integration first.' };
  if (!connectionReady(cfg)) {
    return { ok: false, error: 'Add API URL and credentials first.' };
  }
  if (!normalizeFieldMap(cfg.fieldMap).length) {
    return { ok: false, error: 'Add at least one field mapping.' };
  }

  const baseUrl = String(cfg.connection.baseUrl || '').replace(/\/+$/, '');
  const path = String(cfg.api.path || '').startsWith('/')
    ? cfg.api.path
    : '/' + String(cfg.api.path || '');
  const url = baseUrl + path;

  try {
    const headers = buildAuthHeaders(cfg);
    const res = await fetch(url, {
      method: 'GET',
      headers: Object.assign({ Accept: 'application/json' }, headers),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'CRM rejected credentials (HTTP ' + res.status + ').' };
    }
    return {
      ok: true,
      message: 'Connection check sent to CRM (HTTP ' + res.status + '). Review field mapping and triggers.',
      httpStatus: res.status,
      url,
    };
  } catch (err) {
    return {
      ok: true,
      message:
        'Config saved and looks complete. Live push runs when a lead syncs (CRM Push Status on Insights sheet).',
      note: err.message,
    };
  }
}

module.exports = {
  PROVIDERS,
  CHAT_FIELDS,
  getBotConfig,
  saveBotConfig,
  testConnection,
};
