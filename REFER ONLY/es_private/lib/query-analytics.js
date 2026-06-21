/**
 * User query analytics — counts, time range, bot vs fallback vs handoff.
 * Logged on each /api/chat exchange; backfills from transcript user turns.
 */

const fs = require('fs');
const path = require('path');
const clientPaths = require('./client-paths');
const transcriptDisplay = require('./transcript-display-text');
const chatTranscript = require('./chat-transcript');
const dialogflow = require('./dialogflow');

const DATA_DIR =
  process.env.QUERY_ANALYTICS_DIR ||
  path.dirname(clientPaths.queryAnalyticsPath());
const LOG_PATH =
  process.env.QUERY_ANALYTICS_LOG ||
  clientPaths.queryAnalyticsPath();

const MAX_LOG_BYTES = 12 * 1024 * 1024;

const sessionBotCache = new Map();

function normalizeFilterBotId(raw) {
  try {
    const sitePresetsStore = require('./site-presets-store');
    const id = sitePresetsStore.normalizeBotId(raw);
    return /^\d{5}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function resolveSessionBotId(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  if (sessionBotCache.has(sid)) return sessionBotCache.get(sid);
  try {
    const doc = chatTranscript.getSessionDoc(sid);
    const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
    const botSheetTabs = require('./bot-sheet-tabs');
    const bid = botSheetTabs.resolveSheetBotIdFromMeta(meta);
    sessionBotCache.set(sid, bid);
    return bid;
  } catch {
    sessionBotCache.set(sid, '');
    return '';
  }
}

function enrichEventBotId(e) {
  if (!e || typeof e !== 'object') return e;
  const existing = normalizeFilterBotId(e.botId);
  if (existing) return { ...e, botId: existing };
  const fromSession = resolveSessionBotId(e.sessionId);
  return fromSession ? { ...e, botId: fromSession } : e;
}

function enrichEventsBotId(events) {
  return (Array.isArray(events) ? events : []).map(enrichEventBotId);
}

function filterByBotId(events, botId) {
  const filterId = normalizeFilterBotId(botId);
  if (!filterId) return enrichEventsBotId(events);
  return enrichEventsBotId(events).filter((e) => e.botId === filterId);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function mergeJsonlContentIntoTarget(sourceRaw, fileName) {
  if (!sourceRaw || !String(sourceRaw).trim()) return false;
  try {
    const runtimeLogSync = require('./runtime-log-sync');
    const current = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
    const merged = runtimeLogSync.mergeJsonlContent(current, sourceRaw, fileName);
    if (!merged || merged === current) return false;
    ensureDir();
    fs.writeFileSync(LOG_PATH, merged, 'utf8');
    return true;
  } catch (e) {
    console.warn('[query-analytics] merge jsonl:', e.message);
    return false;
  }
}

function mergeJsonlFiles(targetPath, sourcePath, fileName) {
  if (!sourcePath || targetPath === sourcePath || !fs.existsSync(sourcePath)) return false;
  try {
    return mergeJsonlContentIntoTarget(fs.readFileSync(sourcePath, 'utf8'), fileName);
  } catch (e) {
    console.warn('[query-analytics] merge legacy log:', e.message);
    return false;
  }
}

function migrateLegacyLogsIfNeeded() {
  const legacyRuntime = path.join(__dirname, '..', 'data', 'query-analytics.jsonl');
  let changed = mergeJsonlFiles(LOG_PATH, legacyRuntime, 'query-analytics.jsonl');
  if (changed) {
    console.log('[query-analytics] merged legacy runtime log into synced store');
    try {
      fs.renameSync(legacyRuntime, legacyRuntime + '.migrated');
    } catch {
      /* ok */
    }
  }
  return changed;
}

async function mergeLegacyGcsRuntimeLog() {
  try {
    const gcsUpload = require('./gcs-upload');
    const appEnv = require('./app-env');
    if (!appEnv.DATA_SYNC_GCS || !gcsUpload.isConfigured()) return false;
    const storage = gcsUpload.getStorage();
    if (!storage) return false;
    const prefix = appEnv.GCS_DATA_SYNC_PREFIX.replace(/^\/+|\/+$/g, '');
    const objectPath = `${prefix}/runtime/query-analytics.jsonl`;
    const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return false;
    const [buf] = await file.download();
    const changed = mergeJsonlContentIntoTarget(buf.toString('utf8'), 'query-analytics.jsonl');
    if (changed) {
      console.log('[query-analytics] merged legacy GCS runtime log into synced store');
    }
    return changed;
  } catch (e) {
    console.warn('[query-analytics] legacy GCS runtime merge:', e.message);
    return false;
  }
}

async function prepareSyncedStore() {
  migrateLegacyLogsIfNeeded();
  await mergeLegacyGcsRuntimeLog();
}

function normalizeQueryKey(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function shouldSkipQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (transcriptDisplay.isInternalActionToken(raw)) return true;
  if (transcriptDisplay.isFormSubmitPayload(raw)) return true;
  const display = transcriptDisplay.normalizeUserQueryText(raw);
  return !display;
}

function normalizeLoggedOutcome(event) {
  if (!event || typeof event !== 'object') return 'bot';
  if (event.outcome === 'handoff') return 'handoff';
  if (
    event.outcome === 'fallback' ||
    dialogflow.isFallbackIntent(event.intent, {
      displayName: event.intent,
      isFallback: false,
    })
  ) {
    return 'fallback';
  }
  return event.outcome === 'bot' ? 'bot' : 'bot';
}

function outcomeFromChatResult(result) {
  if (!result || typeof result !== 'object') return 'bot';
  if (result.liveAgent) return 'handoff';
  if (
    result.intentIsFallback ||
    dialogflow.isFallbackIntent(result.intent, {
      displayName: result.intent,
      isFallback: !!result.intentIsFallback,
    })
  ) {
    return 'fallback';
  }
  return 'bot';
}

function classifyTextOutcome(text) {
  if (transcriptDisplay.isHumanAgentHandoffToken(text)) return 'handoff';
  return 'bot';
}

function botTurnIsFallback(turn) {
  if (!turn || typeof turn !== 'object') return false;
  const meta = turn.meta && typeof turn.meta === 'object' ? turn.meta : {};
  if (meta.fallback === true || meta.fallback === 'yes') return true;
  if (meta.intentIsFallback === true || meta.isFallback === true) return true;
  const intent = String(meta.intent || meta.intentName || '').trim().toLowerCase();
  return intent === 'default fallback intent' || intent.endsWith('.fallback');
}

function classifyTranscriptUserOutcome(turns, userIndex) {
  const raw = String((turns[userIndex] && turns[userIndex].text) || '').trim();
  if (transcriptDisplay.isHumanAgentHandoffToken(raw)) return 'handoff';
  for (let i = userIndex + 1; i < turns.length; i += 1) {
    const next = turns[i];
    if (!next) continue;
    const role = String(next.role || '').toLowerCase();
    if (role === 'user') break;
    if (role === 'agent') return 'handoff';
    if (role === 'bot' || role === 'assistant') {
      return botTurnIsFallback(next) ? 'fallback' : 'bot';
    }
  }
  return null;
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
  } catch (e) {
    console.warn('[query-analytics] trim log:', e.message);
  }
}

/** @param {{ sessionId: string, query: string, outcome?: string, intent?: string, at?: string, source?: string }} row */
function recordQuery(row) {
  const query = transcriptDisplay.normalizeUserQueryText(row.query);
  if (!query || shouldSkipQuery(row.query)) return false;
  ensureDir();
  const sid = String(row.sessionId || '').trim();
  const botId =
    normalizeFilterBotId(row.botId) || resolveSessionBotId(sid) || '';
  const entry = {
    at: row.at || new Date().toISOString(),
    sessionId: sid,
    query,
    queryKey: normalizeQueryKey(query),
    outcome: row.outcome || 'bot',
    intent: row.intent ? String(row.intent).slice(0, 120) : '',
    source: row.source || 'chat',
  };
  if (botId) entry.botId = botId;
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  trimLogIfNeeded();
  try {
    require('./data-file-sync').scheduleSync('query-analytics.jsonl');
  } catch (err) {
    console.warn('[query-analytics] data sync schedule failed:', err.message);
  }
  return true;
}

function readLoggedEvents() {
  ensureDir();
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && e.query && e.at) {
          out.push({ ...e, outcome: normalizeLoggedOutcome(e) });
        }
      } catch {
        /* skip bad line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function sessionQueryKey(e) {
  return [
    e.sessionId || '',
    e.queryKey || normalizeQueryKey(e.query),
  ].join('|');
}

function eventDedupeKey(e) {
  return [
    e.sessionId || '',
    e.at || '',
    e.queryKey || normalizeQueryKey(e.query),
  ].join('|');
}

function eventMinuteBucketKey(e) {
  const t = Date.parse(e.at);
  const bucket = Number.isFinite(t) ? Math.floor(t / 60000) : 0;
  return [e.sessionId || '', e.queryKey || normalizeQueryKey(e.query), bucket].join(
    '|'
  );
}

function eventsFromTranscripts(sinceMs) {
  const index = chatTranscript.loadIndex();
  const sessions = Object.values(index.sessions || {});
  const events = [];
  for (const s of sessions) {
    const sid = s.sessionId;
    if (!sid) continue;
    const updatedMs = Date.parse(s.updatedAt || '') || 0;
    if (sinceMs && updatedMs < sinceMs) continue;
    let doc;
    try {
      doc = chatTranscript.getSessionDoc(sid);
    } catch {
      continue;
    }
    const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
    const botSheetTabs = require('./bot-sheet-tabs');
    const sessionBotId = botSheetTabs.resolveSheetBotIdFromMeta(meta);
    const turns = Array.isArray(doc.turns) ? doc.turns : [];
    for (let ti = 0; ti < turns.length; ti += 1) {
      const t = turns[ti];
      if (!t || t.role !== 'user') continue;
      const raw = String(t.text || '').trim();
      if (shouldSkipQuery(raw)) continue;
      const query = transcriptDisplay.normalizeUserQueryText(raw);
      if (!query) continue;
      const at = t.at || doc.updatedAt || s.updatedAt || new Date().toISOString();
      const atMs = Date.parse(at) || 0;
      if (sinceMs && atMs < sinceMs) continue;
      const outcome = classifyTranscriptUserOutcome(turns, ti);
      if (!outcome || outcome === 'handoff') continue;
      const row = {
        at,
        sessionId: sid,
        query,
        queryKey: normalizeQueryKey(query),
        outcome,
        intent: '',
        source: 'transcript',
      };
      if (sessionBotId) row.botId = sessionBotId;
      events.push(row);
    }
  }
  return events;
}

function mergeEvents(logged, transcriptEvents) {
  const loggedMinuteBuckets = new Set(logged.map(eventMinuteBucketKey));
  const loggedBySessionQuery = new Map();
  for (const e of logged) {
    const sq = sessionQueryKey(e);
    if (!loggedBySessionQuery.has(sq)) loggedBySessionQuery.set(sq, []);
    loggedBySessionQuery.get(sq).push(e);
  }

  const seen = new Set(logged.map(eventDedupeKey));
  const merged = logged.slice();

  for (const te of transcriptEvents) {
    if (loggedMinuteBuckets.has(eventMinuteBucketKey(te))) continue;

    const sq = sessionQueryKey(te);
    const siblings = loggedBySessionQuery.get(sq) || [];
    if (siblings.length) {
      const teTime = Date.parse(te.at) || 0;
      const nearLogged = siblings.some((le) => {
        const leTime = Date.parse(le.at) || 0;
        return Math.abs(leTime - teTime) < 5 * 60 * 1000;
      });
      if (nearLogged) continue;
      if (
        te.outcome === 'bot' &&
        siblings.some((le) => le.outcome === 'fallback')
      ) {
        continue;
      }
    }

    const key = eventDedupeKey(te);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(te);
  }
  return merged;
}

function parsePeriod(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const days = Math.min(Math.max(Number(o.days) || 30, 1), 365);
  const customFrom = o.from ? Date.parse(String(o.from)) : NaN;
  const customTo = o.to ? Date.parse(String(o.to)) : NaN;
  const now = Date.now();
  let fromMs = now - days * 24 * 60 * 60 * 1000;
  let toMs = now;
  if (Number.isFinite(customFrom)) {
    const fromStr = String(o.from || '').trim();
    fromMs = /^\d{4}-\d{2}-\d{2}$/.test(fromStr)
      ? Date.parse(fromStr + 'T00:00:00.000')
      : customFrom;
  }
  if (Number.isFinite(customTo)) {
    const toStr = String(o.to || '').trim();
    toMs = /^\d{4}-\d{2}-\d{2}$/.test(toStr)
      ? Date.parse(toStr + 'T23:59:59.999')
      : customTo;
  }
  if (Number.isFinite(customFrom) && Number.isFinite(customTo) && fromMs > toMs) {
    const swap = fromMs;
    fromMs = toMs;
    toMs = swap;
  }
  return { fromMs, toMs, days };
}

function filterByRange(events, fromMs, toMs) {
  return events.filter((e) => {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) return false;
    return t >= fromMs && t <= toMs;
  });
}

function aggregateQueries(events) {
  const byQuery = new Map();
  const byDay = new Map();
  let total = 0;
  let bot = 0;
  let fallback = 0;
  let handoff = 0;

  for (const e of events) {
    total += 1;
    if (e.outcome === 'fallback') fallback += 1;
    else if (e.outcome === 'handoff') handoff += 1;
    else bot += 1;

    const day = String(e.at || '').slice(0, 10);
    if (day) {
      const d = byDay.get(day) || { date: day, total: 0, bot: 0, fallback: 0, handoff: 0 };
      d.total += 1;
      if (e.outcome === 'fallback') d.fallback += 1;
      else if (e.outcome === 'handoff') d.handoff += 1;
      else d.bot += 1;
      byDay.set(day, d);
    }

    const key = e.queryKey || normalizeQueryKey(e.query);
    if (!key) continue;
    let row = byQuery.get(key);
    if (!row) {
      row = {
        query: e.query,
        queryKey: key,
        total: 0,
        bot: 0,
        fallback: 0,
        handoff: 0,
        lastAt: e.at,
        sessions: new Set(),
      };
      byQuery.set(key, row);
    }
    row.total += 1;
    if (e.outcome === 'fallback') row.fallback += 1;
    else if (e.outcome === 'handoff') row.handoff += 1;
    else row.bot += 1;
    if (String(e.at) > String(row.lastAt)) row.lastAt = e.at;
    if (e.sessionId) row.sessions.add(e.sessionId);
  }

  const queries = Array.from(byQuery.values())
    .map((r) => ({
      query: r.query,
      total: r.total,
      bot: r.bot,
      fallback: r.fallback,
      handoff: r.handoff,
      lastAt: r.lastAt,
      sessions: r.sessions.size,
    }))
    .sort((a, b) => b.total - a.total || String(b.lastAt).localeCompare(String(a.lastAt)));

  const daily = Array.from(byDay.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return { total, bot, fallback, handoff, queries, daily };
}

function eventsForOutcomeTable(events, outcome) {
  if (outcome === 'fallback') {
    return events.filter((e) => e.outcome === 'fallback');
  }
  if (outcome === 'bot') {
    const fallbackBuckets = new Set(
      events
        .filter((e) => e.outcome === 'fallback')
        .map(eventMinuteBucketKey)
    );
    return events.filter(
      (e) =>
        e.source === 'chat' &&
        e.outcome === 'bot' &&
        !fallbackBuckets.has(eventMinuteBucketKey(e))
    );
  }
  return events.filter((e) => e.outcome === outcome);
}

function aggregateQueriesForOutcome(events, outcome) {
  const byQuery = new Map();
  for (const e of eventsForOutcomeTable(events, outcome)) {
    const key = e.queryKey || normalizeQueryKey(e.query);
    if (!key) continue;
    let row = byQuery.get(key);
    if (!row) {
      row = {
        query: e.query,
        queryKey: key,
        times: 0,
        lastAt: e.at,
        sessions: new Set(),
      };
      byQuery.set(key, row);
    }
    row.times += 1;
    if (String(e.at) > String(row.lastAt)) row.lastAt = e.at;
    if (e.sessionId) row.sessions.add(e.sessionId);
  }
  return Array.from(byQuery.values())
    .map((r) => ({
      query: r.query,
      times: r.times,
      lastAt: r.lastAt,
      sessions: r.sessions.size,
    }))
    .sort(
      (a, b) =>
        b.times - a.times || String(b.lastAt).localeCompare(String(a.lastAt))
    );
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 300];

function normalizePageSize(raw) {
  const n = Number(raw);
  if (PAGE_SIZE_OPTIONS.includes(n)) return n;
  return 50;
}

function paginateList(list, page, limit) {
  const items = Array.isArray(list) ? list : [];
  const l = normalizePageSize(limit);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / l) || 1);
  const p = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const offset = (p - 1) * l;
  return {
    items: items.slice(offset, offset + l),
    page: p,
    limit: l,
    total,
    totalPages,
    hasPrev: p > 1,
    hasNext: p < totalPages,
  };
}

function markMostPopularAnswered(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!list.length || !(list[0].times > 0)) return list;
  list[0] = { ...list[0], isMostPopular: true };
  return list;
}

function getQueryAnalytics(opts) {
  const { fromMs, toMs, days } = parsePeriod(opts);
  const filterBotId = normalizeFilterBotId(opts && opts.botId);
  const logged = readLoggedEvents();
  const transcriptEvents = eventsFromTranscripts(fromMs);
  const merged = mergeEvents(logged, transcriptEvents);
  let inRange = filterByRange(merged, fromMs, toMs);
  if (filterBotId) {
    inRange = filterByBotId(inRange, filterBotId);
  } else {
    inRange = enrichEventsBotId(inRange);
  }
  const agg = aggregateQueries(inRange);
  const pageSize = normalizePageSize(opts && opts.limit);
  const answeredAll = markMostPopularAnswered(
    aggregateQueriesForOutcome(inRange, 'bot')
  );
  const unansweredAll = aggregateQueriesForOutcome(inRange, 'fallback');
  const answeredPage = paginateList(
    answeredAll,
    opts && opts.answeredPage,
    pageSize
  );
  const unansweredPage = paginateList(
    unansweredAll,
    opts && opts.unansweredPage,
    pageSize
  );

  return {
    ok: true,
    botId: filterBotId || null,
    period: {
      days,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
    summary: {
      totalQueries: agg.total,
      botAnswered: agg.bot,
      fallback: agg.fallback,
      handoff: agg.handoff,
      uniqueQueries: agg.queries.length,
      answeredUnique: answeredAll.length,
      unansweredUnique: unansweredAll.length,
    },
    daily: agg.daily,
    queries: agg.queries.slice(0, pageSize),
    answeredQueries: answeredPage.items,
    answeredPagination: {
      page: answeredPage.page,
      limit: answeredPage.limit,
      total: answeredPage.total,
      totalPages: answeredPage.totalPages,
      hasPrev: answeredPage.hasPrev,
      hasNext: answeredPage.hasNext,
    },
    unansweredQueries: unansweredPage.items,
    unansweredPagination: {
      page: unansweredPage.page,
      limit: unansweredPage.limit,
      total: unansweredPage.total,
      totalPages: unansweredPage.totalPages,
      hasPrev: unansweredPage.hasPrev,
      hasNext: unansweredPage.hasNext,
    },
    sources: {
      logged: logged.length,
      transcriptBackfill: transcriptEvents.length,
      inPeriod: inRange.length,
    },
  };
}

module.exports = {
  recordQuery,
  getQueryAnalytics,
  normalizeQueryKey,
  outcomeFromChatResult,
  prepareSyncedStore,
  migrateLegacyLogsIfNeeded,
};
