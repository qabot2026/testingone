/**
 * Per-bot editable email templates (plain text; HTML auto-generated on send).
 */

const fs = require('fs');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');
const emailTemplateEngine = require('./email-template-engine');
const sitePresetsStore = require('./site-presets-store');

const FILE_NAME = 'email-templates.json';

function filePath() {
  return clientPaths.emailTemplatesPath();
}

function readFile_() {
  const p = filePath();
  if (!fs.existsSync(p)) return { updatedAt: null, bots: {} };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data.bots || typeof data.bots !== 'object') data.bots = {};
    return data;
  } catch (err) {
    console.warn('[email-templates] read failed:', err.message);
    return { updatedAt: null, bots: {} };
  }
}

function writeFile_(data) {
  fs.mkdirSync(clientPaths.dataDir(), { recursive: true });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
  dataFileSync.scheduleSync(FILE_NAME);
}

function mergeTemplate(current, patch, defaults) {
  const merged = emailTemplateEngine.normalizeTemplateShape(
    { ...current, ...(patch || {}) },
    defaults
  );
  if (patch && patch.enabled != null) merged.enabled = !!patch.enabled;
  if (patch && patch.subject != null) merged.subject = String(patch.subject);
  if (patch && patch.body != null) merged.body = String(patch.body);
  return merged;
}

function migrateStoredBot(stored) {
  const defaults = emailTemplateEngine.defaultTemplates();
  const s = stored && typeof stored === 'object' ? stored : {};
  const legacyAppt = s.appointment;
  const appointmentClientSource = s.appointmentClient || legacyAppt;

  const sentFlags = s.sentFlags && typeof s.sentFlags === 'object' ? { ...s.sentFlags } : {};
  if (!sentFlags.appointmentClient && s.sentAppointmentSessions) {
    sentFlags.appointmentClient = { ...s.sentAppointmentSessions };
  }

  const templates = {};
  emailTemplateEngine.TEMPLATE_KEYS.forEach((key) => {
    templates[key] = mergeTemplate(s[key], null, defaults[key]);
  });
  if (legacyAppt && !s.appointmentClient) {
    templates.appointmentClient = mergeTemplate(legacyAppt, null, defaults.appointmentClient);
  } else if (appointmentClientSource) {
    templates.appointmentClient = mergeTemplate(
      appointmentClientSource,
      null,
      defaults.appointmentClient
    );
  }

  return { templates, sentFlags };
}

function botStoredTemplates(stored) {
  return migrateStoredBot(stored).templates;
}

function getSentFlags(stored) {
  return migrateStoredBot(stored).sentFlags;
}

function getBotTemplates(botId) {
  const id = sitePresetsStore.normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = data.bots[id] || {};
  return {
    ok: true,
    botId: id,
    botName: project.name,
    templates: botStoredTemplates(stored),
    templateCatalog: emailTemplateEngine.getTemplateCatalog(),
    templateMeta: emailTemplateEngine.TEMPLATE_META,
    variableHints: emailTemplateEngine.VARIABLE_HINTS,
    updatedAt: data.updatedAt || null,
  };
}

function saveBotTemplates(botId, patch) {
  const id = sitePresetsStore.normalizeBotId(botId);
  const project = sitePresetsStore.resolveProject(id);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  const data = readFile_();
  const stored = data.bots[id] || {};
  const templates = botStoredTemplates(stored);
  const sentFlags = getSentFlags(stored);
  const body = patch && typeof patch === 'object' ? patch : {};
  const defaults = emailTemplateEngine.defaultTemplates();

  emailTemplateEngine.TEMPLATE_KEYS.forEach((key) => {
    if (body[key]) {
      templates[key] = mergeTemplate(templates[key], body[key], defaults[key]);
    }
  });

  const out = { sentFlags };
  emailTemplateEngine.TEMPLATE_KEYS.forEach((key) => {
    out[key] = templates[key];
  });
  data.bots[id] = Object.assign({}, stored, out);
  writeFile_(data);
  return getBotTemplates(id);
}

function getTemplateForSend(botId, templateKey) {
  const result = getBotTemplates(botId);
  if (!result.ok) return result;
  const tpl = result.templates[templateKey];
  if (!tpl) return { ok: false, error: 'Unknown template' };
  return { ok: true, template: tpl };
}

function wasSent(botId, templateKey, sessionId) {
  const id = sitePresetsStore.normalizeBotId(botId);
  const sid = String(sessionId || '').trim();
  const data = readFile_();
  const flags = getSentFlags(data.bots[id] || {});
  return !!(flags[templateKey] && flags[templateKey][sid]);
}

function markSent(botId, templateKey, sessionId) {
  const id = sitePresetsStore.normalizeBotId(botId);
  const sid = String(sessionId || '').trim();
  if (!sid || !templateKey) return;
  const data = readFile_();
  if (!data.bots[id]) data.bots[id] = {};
  if (!data.bots[id].sentFlags) data.bots[id].sentFlags = {};
  if (!data.bots[id].sentFlags[templateKey]) data.bots[id].sentFlags[templateKey] = {};
  data.bots[id].sentFlags[templateKey][sid] = new Date().toISOString();
  const keys = Object.keys(data.bots[id].sentFlags[templateKey]);
  if (keys.length > 5000) {
    keys
      .sort()
      .slice(0, keys.length - 4000)
      .forEach((k) => delete data.bots[id].sentFlags[templateKey][k]);
  }
  writeFile_(data);
}

module.exports = {
  FILE_NAME,
  getBotTemplates,
  saveBotTemplates,
  getTemplateForSend,
  wasSent,
  markSent,
};
