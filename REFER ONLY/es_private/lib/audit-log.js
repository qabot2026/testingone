/**
 * Dashboard change audit trail — append-only JSONL.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR =
  process.env.AUDIT_LOG_DIR || path.join(__dirname, '..', 'data');
const LOG_PATH =
  process.env.AUDIT_LOG_FILE || path.join(DATA_DIR, 'audit-log.jsonl');
const MAX_LOG_BYTES = 16 * 1024 * 1024;

const ACTION_META = {
  'faqs.save': { prefix: 'FAQ', label: 'FAQ saved' },
  'faqs.delete': { prefix: 'FAQ', label: 'FAQ deleted' },
  'bot-registry.create': { prefix: 'BOT', label: 'New bot' },
  'bot-registry.update': { prefix: 'BOT', label: 'Bot updated' },
  'bot-registry.delete': { prefix: 'BOT', label: 'Bot removed' },
  'bot-settings.save': { prefix: 'UI', label: 'Appearance saved' },
  'social-integration.save': { prefix: 'SOC', label: 'Social saved' },
  'email-integration.save': { prefix: 'EML', label: 'Email integration saved' },
  'crm-integration.save': { prefix: 'CRM', label: 'CRM integration saved' },
  'lead-notifications.save': { prefix: 'NTF', label: 'Email notifications saved' },
  'email-templates.save': { prefix: 'TPL', label: 'Email templates saved' },
  'documents.delete': { prefix: 'DOC', label: 'File deleted' },
  'qa-provision.save': { prefix: 'QAP', label: 'Agent training draft saved' },
  'qa-provision.make-live': { prefix: 'QAP', label: 'Agent training made live' },
  'qa-provision.restore': { prefix: 'QAP', label: 'Agent training restored' },
  'qa-provision.import': { prefix: 'QAP', label: 'Agent training imported' },
  'qa-provision.delete': { prefix: 'QAP', label: 'Agent training row deleted' },
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function trimLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const stat = fs.statSync(LOG_PATH);
    if (stat.size <= MAX_LOG_BYTES) return;
    const buf = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = buf.split('\n').filter(Boolean);
    const keep = lines.slice(-Math.floor(lines.length * 0.6));
    fs.writeFileSync(LOG_PATH, keep.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.warn('[audit-log] trim failed:', err.message);
  }
}

function resolveActor(req) {
  if (!req) return 'system';
  const email =
    String(req.headers['x-live-agent-email'] || req.headers['x-agent-email'] || '')
      .trim()
      .toLowerCase();
  if (email) return email;
  if (req && req.deskAuthOk) return 'desk-token';
  return 'anonymous';
}

function actionMeta(action) {
  return ACTION_META[String(action || '').trim()] || { prefix: 'CHG', label: 'Change' };
}

function buildChangeId(at, action) {
  const meta = actionMeta(action);
  const d = new Date(at || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
  return '#' + meta.prefix + '-' + stamp + suffix;
}

function buildSummary(action, detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  if (d.summary) return String(d.summary);

  if (action === 'faqs.save' && d.question) {
    return 'Saved: “' + d.question + '”';
  }
  if (action === 'faqs.delete' && d.question) {
    return 'Deleted: “' + d.question + '”';
  }
  if (action === 'faqs.delete') return 'Deleted an FAQ';

  if (action === 'bot-registry.create' && d.name) {
    return 'Created bot “' + d.name + '”';
  }
  if (action === 'bot-registry.delete') {
    const name = d.deleted && d.deleted.name;
    return name ? 'Removed bot “' + name + '”' : 'Removed a bot';
  }
  if (action === 'bot-registry.update') {
    const parts = [];
    if (d.name) parts.push('name → “' + d.name + '”');
    if (d.sheetTab) parts.push('sheet → “' + d.sheetTab + '”');
    if (d.welcomeEventName) parts.push('welcome → “' + d.welcomeEventName + '”');
    return parts.length ? parts.join(' · ') : 'Updated bot registry';
  }
  if (action === 'bot-settings.save' && d.project) {
    return 'Saved appearance for “' + d.project + '”';
  }
  if (action === 'social-integration.save' && d.channel) {
    return 'Saved ' + d.channel + ' settings';
  }
  if (action === 'documents.delete' && d.object) {
    const file = String(d.object).split('/').pop();
    return 'Deleted file “' + (file || d.object) + '”';
  }
  if (action === 'qa-provision.save' && d.intent) {
    return 'Draft saved for “' + d.intent + '”' + (d.actor ? ' by ' + d.actor : '');
  }
  if (action === 'qa-provision.make-live') {
    const n = d.promoted != null ? d.promoted : '';
    return 'Made ' + n + ' change(s) live' + (d.actor ? ' (' + d.actor + ')' : '');
  }
  if (action === 'qa-provision.restore' && d.restoredAt) {
    return 'Restored backup from ' + d.restoredAt + (d.actor ? ' by ' + d.actor : '');
  }
  if (action === 'qa-provision.import' && d.rowCount != null) {
    return 'Imported ' + d.rowCount + ' row(s)' + (d.actor ? ' by ' + d.actor : '');
  }

  return actionMeta(action).label;
}

function enrichEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const action = event.action || '';
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
  const meta = actionMeta(action);
  return {
    ...event,
    changeId: event.changeId || buildChangeId(event.at, action),
    label: event.label || meta.label,
    summary: event.summary || buildSummary(action, detail),
  };
}

/**
 * @param {object} entry
 * @param {string} entry.action
 * @param {string} [entry.page]
 * @param {string} [entry.botId]
 * @param {object} [entry.detail]
 * @param {string} [entry.actor]
 * @param {string} [entry.ip]
 */
function recordAudit(entry, req) {
  if (!entry || !entry.action) return false;
  ensureDir();
  const at = new Date().toISOString();
  const action = String(entry.action).slice(0, 120);
  const detail =
    entry.detail && typeof entry.detail === 'object' ? { ...entry.detail } : {};
  const summary = buildSummary(action, detail);
  const meta = actionMeta(action);
  const row = enrichEvent({
    at,
    changeId: buildChangeId(at, action),
    label: meta.label,
    summary,
    actor: entry.actor || resolveActor(req),
    action,
    page: entry.page ? String(entry.page).slice(0, 120) : '',
    botId: entry.botId ? String(entry.botId).slice(0, 12) : '',
    detail: { ...detail, summary },
    ip: entry.ip ? String(entry.ip).slice(0, 64) : '',
  });
  fs.appendFileSync(LOG_PATH, JSON.stringify(row) + '\n', 'utf8');
  trimLogIfNeeded();
  try {
    require('./runtime-log-sync').schedulePush('audit-log.jsonl');
  } catch (err) {
    console.warn('[audit-log] cloud sync schedule failed:', err.message);
  }
  return true;
}

function readAuditEvents(opts) {
  opts = opts || {};
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const botId = String(opts.botId || '').trim();
  const page = String(opts.page || '').trim().toLowerCase();
  const days = Math.min(Math.max(Number(opts.days) || 30, 1), 365);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  ensureDir();
  if (!fs.existsSync(LOG_PATH)) {
    return { ok: true, events: [], total: 0 };
  }

  const events = [];
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (!e || !e.at || !e.action) continue;
        const atMs = Date.parse(e.at);
        if (Number.isFinite(atMs) && atMs < sinceMs) continue;
        if (botId && String(e.botId || '') !== botId) continue;
        if (page && String(e.page || '').toLowerCase().indexOf(page) < 0) continue;
        events.push(enrichEvent(e));
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    return { ok: true, events: [], total: 0 };
  }

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const slice = events.slice(0, limit);
  return { ok: true, events: slice, total: events.length, limit, days };
}

module.exports = {
  recordAudit,
  readAuditEvents,
  resolveActor,
  buildChangeId,
  buildSummary,
  enrichEvent,
};
