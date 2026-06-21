/**
 * Per-bot lead email notification schedules and recipients.
 */

const fs = require('fs');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');
const sitePresetsStore = require('./site-presets-store');
const leadInstantRules = require('./lead-instant-rules');
const emailTemplateEngine = require('./email-template-engine');

const FILE_NAME = 'lead-notifications.json';
const TEMPLATE_DELIVERY_KEYS = emailTemplateEngine.TEMPLATE_KEYS;
const DEFAULT_TZ = process.env.SHEETS_CONV_DATETIME_TZ || 'Asia/Kolkata';

function filePath() {
  return clientPaths.leadNotificationsPath();
}

function defaultInstantLead() {
  return {
    enabled: false,
    delayMinutes: 0,
    conditions: leadInstantRules.defaultConditions(),
    recipients: [],
  };
}

function defaultTemplateDeliveryEntry(templateKey) {
  const audience = emailTemplateEngine.templateAudience(templateKey);
  if (audience === 'user') {
    return { enabled: true };
  }
  return { enabled: true, to: [], cc: [], bcc: [] };
}

function defaultTemplateDelivery() {
  const out = {};
  TEMPLATE_DELIVERY_KEYS.forEach((key) => {
    out[key] = defaultTemplateDeliveryEntry(key);
  });
  return out;
}

function migrateTemplateDelivery(stored) {
  const base = defaultTemplateDelivery();
  const raw = (stored && stored.templateDelivery) || {};
  TEMPLATE_DELIVERY_KEYS.forEach((key) => {
    const entry = Object.assign({}, base[key], raw[key] || {});
    if (entry.enabled == null) entry.enabled = true;
    if (emailTemplateEngine.templateAudience(key) === 'client') {
      const mail = normalizeMailRecipients(entry);
      entry.to = mail.to;
      entry.cc = mail.cc;
      entry.bcc = mail.bcc;
      delete entry.recipients;
    } else {
      delete entry.recipients;
      delete entry.to;
      delete entry.cc;
      delete entry.bcc;
    }
    base[key] = entry;
  });
  const legacy = normalizeRecipients(
    stored && stored.instantLead && stored.instantLead.recipients
  );
  if (legacy.length) {
    ['leadCapture', 'hotLead', 'appointmentClient'].forEach((key) => {
      if (!base[key].to.length) base[key].to = legacy.slice();
    });
  }
  return base;
}

function defaultDailyReport() {
  return {
    enabled: false,
    time: '10:00',
    timezone: DEFAULT_TZ,
    to: [],
    cc: [],
    bcc: [],
    lastSentAt: null,
    lastSentForDate: null,
  };
}

function defaultWeeklyReport() {
  return {
    enabled: false,
    dayOfWeek: 1,
    time: '10:00',
    timezone: DEFAULT_TZ,
    to: [],
    cc: [],
    bcc: [],
    lastSentAt: null,
    lastSentWeekKey: null,
  };
}

function normalizeReportSection(section) {
  const base = { ...section };
  const mail = normalizeMailRecipients(section);
  base.to = mail.to;
  base.cc = mail.cc;
  base.bcc = mail.bcc;
  delete base.recipients;
  return base;
}

function defaultBotConfig() {
  return {
    instantLead: defaultInstantLead(),
    templateDelivery: defaultTemplateDelivery(),
    dailyReport: defaultDailyReport(),
    weeklyReport: defaultWeeklyReport(),
    sentInstantSessions: {},
  };
}

function readFile_() {
  const p = filePath();
  if (!fs.existsSync(p)) return { updatedAt: null, bots: {} };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data.bots || typeof data.bots !== 'object') data.bots = {};
    return data;
  } catch (err) {
    console.warn('[lead-notifications] read failed:', err.message);
    return { updatedAt: null, bots: {} };
  }
}

function writeFile_(data) {
  fs.mkdirSync(clientPaths.dataDir(), { recursive: true });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
  dataFileSync.scheduleSync(FILE_NAME);
}

function normalizeBotId(botId) {
  return sitePresetsStore.normalizeBotId(botId);
}

function normalizeRecipients(list) {
  if (!Array.isArray(list)) return [];
  const seen = {};
  const out = [];
  list.forEach((item) => {
    const email = String(item || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (seen[email]) return;
    seen[email] = true;
    out.push(email);
  });
  return out;
}

function defaultMailRecipients() {
  return { to: [], cc: [], bcc: [] };
}

/** Normalize To/Cc/Bcc; legacy `recipients` array maps to To. */
function normalizeMailRecipients(raw) {
  const base = defaultMailRecipients();
  if (!raw || typeof raw !== 'object') return base;
  if (Array.isArray(raw)) {
    base.to = normalizeRecipients(raw);
    return base;
  }
  if (Array.isArray(raw.recipients) && raw.recipients.length) {
    base.to = normalizeRecipients(raw.recipients);
  }
  if (raw.to != null) base.to = normalizeRecipients(raw.to);
  if (raw.cc != null) base.cc = normalizeRecipients(raw.cc);
  if (raw.bcc != null) base.bcc = normalizeRecipients(raw.bcc);
  return base;
}

function hasMailTo(fields) {
  return !!(fields && fields.to && fields.to.length);
}

function normalizeTime(value, fallback) {
  const s = String(value || fallback || '10:00').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback || '10:00';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function mergeTemplateDelivery(current, patch) {
  const base = migrateTemplateDelivery({ templateDelivery: current, instantLead: {} });
  const p = patch && typeof patch === 'object' ? patch : {};
  TEMPLATE_DELIVERY_KEYS.forEach((key) => {
    if (!p[key]) return;
    const entry = Object.assign({}, base[key], p[key]);
    if (entry.enabled != null) entry.enabled = !!entry.enabled;
    if (emailTemplateEngine.templateAudience(key) === 'client') {
      const mail = normalizeMailRecipients(entry);
      entry.to = mail.to;
      entry.cc = mail.cc;
      entry.bcc = mail.bcc;
      delete entry.recipients;
    } else {
      delete entry.recipients;
      delete entry.to;
      delete entry.cc;
      delete entry.bcc;
    }
    base[key] = entry;
  });
  return base;
}

function mergeInstantLead(current, patch) {
  const base = { ...defaultInstantLead(), ...(current || {}) };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.enabled != null) base.enabled = !!p.enabled;
  if (p.recipients != null) base.recipients = normalizeRecipients(p.recipients);
  if (p.delayMinutes != null) {
    base.delayMinutes = leadInstantRules.normalizeDelayMinutes(p.delayMinutes);
  }
  if (p.conditions != null) {
    base.conditions = leadInstantRules.normalizeConditions(
      Object.assign({}, base.conditions, p.conditions)
    );
  }
  return base;
}

function mergeSection(current, patch, defaultsFn) {
  const base = normalizeReportSection({ ...defaultsFn(), ...(current || {}) });
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.enabled != null) base.enabled = !!p.enabled;
  if (p.to != null || p.cc != null || p.bcc != null || p.recipients != null) {
    const mail = normalizeMailRecipients(Object.assign({}, base, p));
    base.to = mail.to;
    base.cc = mail.cc;
    base.bcc = mail.bcc;
  }
  delete base.recipients;
  if (p.time != null) base.time = normalizeTime(p.time, base.time);
  if (p.timezone != null) base.timezone = String(p.timezone || DEFAULT_TZ).trim() || DEFAULT_TZ;
  if (p.dayOfWeek != null) {
    const d = parseInt(p.dayOfWeek, 10);
    base.dayOfWeek = d >= 0 && d <= 6 ? d : 1;
  }
  return base;
}

function getBotConfig(botId) {
  const id = normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = data.bots[id] || {};
  const cfg = {
    botId: id,
    botName: project.name,
    instantLead: mergeInstantLead(stored.instantLead, null),
    templateDelivery: migrateTemplateDelivery(stored),
    dailyReport: mergeSection(stored.dailyReport, null, defaultDailyReport),
    weeklyReport: mergeSection(stored.weeklyReport, null, defaultWeeklyReport),
    templateMeta: emailTemplateEngine.TEMPLATE_META,
  };
  return { ok: true, config: cfg, updatedAt: data.updatedAt || null };
}

function saveBotConfig(botId, patch) {
  const id = normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = { ...defaultBotConfig(), ...(data.bots[id] || {}) };
  const body = patch && typeof patch === 'object' ? patch : {};

  if (body.instantLead) {
    stored.instantLead = mergeInstantLead(stored.instantLead, body.instantLead);
  }
  if (body.templateDelivery) {
    stored.templateDelivery = mergeTemplateDelivery(stored.templateDelivery, body.templateDelivery);
  }
  if (body.dailyReport) {
    stored.dailyReport = mergeSection(stored.dailyReport, body.dailyReport, defaultDailyReport);
  }
  if (body.weeklyReport) {
    stored.weeklyReport = mergeSection(
      stored.weeklyReport,
      body.weeklyReport,
      defaultWeeklyReport
    );
  }

  data.bots[id] = stored;
  writeFile_(data);
  return getBotConfig(id);
}

function listAllBotConfigs() {
  const data = readFile_();
  const bots = sitePresetsStore.listProjects();
  return bots.map((b) => {
    const stored = { ...defaultBotConfig(), ...(data.bots[b.id] || {}) };
    return { botId: b.id, botName: b.name, config: stored };
  });
}

function markInstantSent(botId, sessionId) {
  const id = normalizeBotId(botId);
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const data = readFile_();
  if (!data.bots[id]) data.bots[id] = defaultBotConfig();
  if (!data.bots[id].sentInstantSessions) data.bots[id].sentInstantSessions = {};
  data.bots[id].sentInstantSessions[sid] = new Date().toISOString();
  const keys = Object.keys(data.bots[id].sentInstantSessions);
  if (keys.length > 5000) {
    keys
      .sort()
      .slice(0, keys.length - 4000)
      .forEach((k) => delete data.bots[id].sentInstantSessions[k]);
  }
  writeFile_(data);
}

function wasInstantSent(botId, sessionId) {
  const id = normalizeBotId(botId);
  const sid = String(sessionId || '').trim();
  const data = readFile_();
  return !!(data.bots[id] && data.bots[id].sentInstantSessions && data.bots[id].sentInstantSessions[sid]);
}

function markDailySent(botId, dateYmd) {
  const id = normalizeBotId(botId);
  const data = readFile_();
  if (!data.bots[id]) data.bots[id] = defaultBotConfig();
  data.bots[id].dailyReport = data.bots[id].dailyReport || defaultDailyReport();
  data.bots[id].dailyReport.lastSentAt = new Date().toISOString();
  data.bots[id].dailyReport.lastSentForDate = String(dateYmd || '');
  writeFile_(data);
}

function markWeeklySent(botId, weekKey) {
  const id = normalizeBotId(botId);
  const data = readFile_();
  if (!data.bots[id]) data.bots[id] = defaultBotConfig();
  data.bots[id].weeklyReport = data.bots[id].weeklyReport || defaultWeeklyReport();
  data.bots[id].weeklyReport.lastSentAt = new Date().toISOString();
  data.bots[id].weeklyReport.lastSentWeekKey = String(weekKey || '');
  writeFile_(data);
}

function getRawBotStored(botId) {
  const id = normalizeBotId(botId);
  const data = readFile_();
  const stored = { ...defaultBotConfig(), ...(data.bots[id] || {}) };
  stored.instantLead = mergeInstantLead(stored.instantLead, null);
  stored.templateDelivery = migrateTemplateDelivery(stored);
  return stored;
}

function getTemplateDelivery(botId, templateKey) {
  const stored = getRawBotStored(botId);
  const key = String(templateKey || '').trim();
  const td = stored.templateDelivery || defaultTemplateDelivery();
  return td[key] || defaultTemplateDeliveryEntry(key);
}

function getClientMailRecipients(botId, templateKey) {
  const cfg = getTemplateDelivery(botId, templateKey);
  if (cfg.enabled === false) return defaultMailRecipients();
  let fields = normalizeMailRecipients(cfg);
  if (!fields.to.length) {
    const legacy = normalizeRecipients(getRawBotStored(botId).instantLead.recipients);
    if (
      legacy.length &&
      (templateKey === 'leadCapture' || templateKey === 'hotLead')
    ) {
      fields = { to: legacy.slice(), cc: [], bcc: [] };
    }
  }
  return fields;
}

function getClientRecipients(botId, templateKey) {
  return getClientMailRecipients(botId, templateKey).to;
}

function getReportMailRecipients(reportCfg) {
  return normalizeMailRecipients(reportCfg || {});
}

module.exports = {
  FILE_NAME,
  DEFAULT_TZ,
  TEMPLATE_DELIVERY_KEYS,
  defaultBotConfig,
  defaultTemplateDelivery,
  getBotConfig,
  saveBotConfig,
  listAllBotConfigs,
  markInstantSent,
  wasInstantSent,
  markDailySent,
  markWeeklySent,
  getRawBotStored,
  getTemplateDelivery,
  getClientRecipients,
  getClientMailRecipients,
  getReportMailRecipients,
  normalizeRecipients,
  normalizeMailRecipients,
  defaultMailRecipients,
  hasMailTo,
};
