/**
 * API request/response log for dashboard Actions page — append-only JSONL.
 */

const fs = require('fs');
const path = require('path');
const auditLog = require('./audit-log');

const DATA_DIR =
  process.env.API_ACTIONS_LOG_DIR || path.join(__dirname, '..', 'data');
const LOG_PATH =
  process.env.API_ACTIONS_LOG_FILE || path.join(DATA_DIR, 'api-actions.jsonl');
const MAX_LOG_BYTES = 24 * 1024 * 1024;
const MAX_BODY_CHARS = 4000;

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
    console.warn('[api-actions] trim failed:', err.message);
  }
}

function truncateValue(value) {
  if (value == null) return null;
  try {
    const text =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= MAX_BODY_CHARS) return value;
    return text.slice(0, MAX_BODY_CHARS) + '…';
  } catch {
    return String(value).slice(0, MAX_BODY_CHARS);
  }
}

function extractBotId(req, reqBody, resBody) {
  const fromParams = req && req.params && (req.params.botId || req.params.id);
  if (fromParams) return String(fromParams).trim();
  const fromQuery = req && req.query && req.query.bid;
  if (fromQuery) return String(fromQuery).trim();
  if (reqBody && reqBody.botId) return String(reqBody.botId).trim();
  if (resBody && resBody.bot && resBody.bot.id) return String(resBody.bot.id).trim();
  if (resBody && resBody.botId) return String(resBody.botId).trim();
  return '';
}

function recordApiAction(row) {
  ensureDir();
  const entry = {
    at: row.at || new Date().toISOString(),
    method: String(row.method || 'GET').slice(0, 12),
    path: String(row.path || '').slice(0, 240),
    status: Number(row.status) || 0,
    durationMs: Number(row.durationMs) || 0,
    actor: row.actor ? String(row.actor).slice(0, 120) : 'anonymous',
    botId: row.botId ? String(row.botId).slice(0, 12) : '',
    request: truncateValue(row.request),
    response: truncateValue(row.response),
  };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  trimLogIfNeeded();
  try {
    require('./runtime-log-sync').schedulePush('api-actions.jsonl');
  } catch (err) {
    console.warn('[api-actions] cloud sync schedule failed:', err.message);
  }
}

function readApiActions(opts) {
  opts = opts || {};
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const botId = String(opts.botId || '').trim();
  const pathFilter = String(opts.path || '').trim().toLowerCase();
  const days = Math.min(Math.max(Number(opts.days) || 7, 1), 90);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  ensureDir();
  if (!fs.existsSync(LOG_PATH)) {
    return { ok: true, events: [], summary: [], total: 0 };
  }

  const events = [];
  const summaryMap = {};
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (!e || !e.at || !e.path) continue;
        const atMs = Date.parse(e.at);
        if (Number.isFinite(atMs) && atMs < sinceMs) continue;
        if (botId && String(e.botId || '') !== botId) continue;
        if (pathFilter && String(e.path || '').toLowerCase().indexOf(pathFilter) < 0) {
          continue;
        }
        events.push(e);
        const key = e.method + ' ' + e.path;
        if (!summaryMap[key]) {
          summaryMap[key] = { method: e.method, path: e.path, count: 0 };
        }
        summaryMap[key].count += 1;
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    return { ok: true, events: [], summary: [], total: 0 };
  }

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const summary = Object.values(summaryMap).sort((a, b) => b.count - a.count);
  return {
    ok: true,
    events: events.slice(0, limit),
    summary: summary.slice(0, 50),
    total: events.length,
    limit,
    days,
  };
}

function mountApiActionLogger(app) {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const started = Date.now();
    let responseBody;
    const originalJson = res.json.bind(res);
    res.json = function jsonWithCapture(body) {
      responseBody = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      try {
        recordApiAction({
          method: req.method,
          path: req.originalUrl || req.url || req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
          actor: auditLog.resolveActor(req),
          botId: extractBotId(req, req.body, responseBody),
          request: {
            query: req.query || {},
            body: req.body || {},
          },
          response: responseBody,
        });
      } catch (err) {
        console.warn('[api-actions] record failed:', err.message);
      }
    });
    next();
  });
}

module.exports = {
  recordApiAction,
  readApiActions,
  mountApiActionLogger,
};
