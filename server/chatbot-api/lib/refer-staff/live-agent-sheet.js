/**
 * Google Sheet2 — one row per live-agent handoff with Chatscript link (column A).
 */

const sheets = require('./sheets');
const chatTranscript = require('./chat-transcript');
const sheetDateFormat = require('./sheet-date-format');
const transcriptDisplay = require('./transcript-display-text');

const TZ = process.env.SHEETS_CONV_DATETIME_TZ || 'Asia/Kolkata';

/** Row 1 on Sheet2 — match your spreadsheet tab. */
const LIVE_AGENT_SHEET_HEADERS = [
  'Chatscript',
  'Conv. Date',
  'Conv. Time',
  'Name',
  'Mobile',
  'Email',
  'Agent',
  'Department',
  'Status',
  'User Queries',
  'Session ID',
  'Message Count',
  'Duration',
];

const syncTimers = new Map();
const syncChains = new Map();

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function scalar(v) {
  if (v == null) return '';
  return String(v).trim();
}

function tabName() {
  return sheets.liveAgentTabName();
}

function formatDateForSheet(d) {
  const v = sheetDateFormat.formatConversationDateForSheet(d);
  return v === '' ? '' : v;
}

function formatTime(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(d);
  let hour = '';
  let minute = '';
  let second = '';
  let dayPeriod = '';
  parts.forEach((p) => {
    if (p.type === 'hour') hour = p.value;
    else if (p.type === 'minute') minute = p.value;
    else if (p.type === 'second') second = p.value;
    else if (p.type === 'dayPeriod') dayPeriod = p.value;
  });
  if (!hour) return '';
  return `${hour}:${minute}:${second}${dayPeriod}`;
}

function formatMobileForSheet(meta) {
  const rawMobile = String(meta.mobile || meta.phone || '').trim();
  if (!rawMobile) return '';

  const compact = rawMobile.replace(/\s+/g, '');
  if (/^\+?\d{11,}$/.test(compact)) {
    const digits = compact.replace(/\D/g, '');
    const local = digits.slice(-10);
    const dialDigits = digits.slice(0, digits.length - 10);
    if (dialDigits && local) return `${dialDigits} ${local}`;
    return digits;
  }

  let dialDigits = String(
    meta.dial_code || meta.dialCode || meta.country_dial_code || ''
  )
    .trim()
    .replace(/\D/g, '');

  if (!dialDigits) {
    const digits = rawMobile.replace(/\D/g, '');
    if (digits.length === 10) dialDigits = '91';
  }

  let local = rawMobile.replace(/\D/g, '');
  if (dialDigits) {
    if (local.startsWith(dialDigits) && local.length > dialDigits.length) {
      local = local.slice(dialDigits.length);
    }
    if (local.length > 10) local = local.slice(-10);
    return `${dialDigits} ${local}`;
  }

  return rawMobile.replace(/^\+/, '').trim();
}

function sessionQualifies(session) {
  if (!session || !session.sessionId) return false;
  if (session.requestedAt || session.createdAt) return true;
  const msgs = session.messages || [];
  return msgs.some((m) => {
    const role = trim(m && m.role);
    if (role !== 'visitor' && role !== 'system') return false;
    return transcriptDisplay.isHandoffRequestLine(m.text);
  });
}

function liveAgentSheetUserQueries_(session) {
  const handoff = buildSheet1LiveAgentHandoffQueries(session);
  if (handoff) return handoff;
  return liveAgentQueriesFromSession(session);
}

function resolveAgentNameForSheet_(session) {
  const display = trim(session && session.assignedAgentDisplayName);
  if (display) return display;
  const email =
    trim(session && session.acceptedByEmail) ||
    trim(session && session.assignedAgentEmail) ||
    trim(session && session.currentAssigneeEmail);
  return email;
}

async function loadSessionForSheet_(sessionId) {
  const sid = trim(sessionId);
  if (!sid) return null;
  try {
    const bridge = await import('../live-agent/firestore-bridge.mjs');
    const fresh = await bridge.loadSessionForLiveAgentSheet(sid);
    if (fresh) return fresh;
  } catch (e) {
    console.warn('[live-agent-sheet] loadSessionForLiveAgentSheet:', e.message);
  }
  const liveAgentStore = require('./live-agent-store');
  return typeof liveAgentStore.getSessionAsync === 'function'
    ? await liveAgentStore.getSessionAsync(sid)
    : liveAgentStore.getSession(sid);
}

/** Visitor lines during live-agent chat — for Sheet1 User Queries (not bot transcript). */
function liveAgentVisitorQueriesFromSession(session) {
  const msgs = (session && session.messages) || [];
  const lines = [];
  msgs.forEach((m) => {
    if (!m) return;
    const role = trim(m.role).toLowerCase();
    if (role !== 'visitor') return;
    const raw = trim(m.text);
    if (!raw) return;
    if (transcriptDisplay.isHandoffRequestLine(raw)) return;
    const text = transcriptDisplay.normalizeUserQueryText(raw) || raw;
    if (!text || transcriptDisplay.isInternalActionToken(text)) return;
    lines.push(text);
  });
  return lines.join(' | ').slice(0, 2000);
}

/** User + agent lines from the handoff only — not the full bot transcript (see chatscript link). */
function liveAgentQueriesFromSession(session) {
  const msgs = (session && session.messages) || [];
  const lines = [];
  msgs.forEach((m) => {
    if (!m) return;
    const role = trim(m.role).toLowerCase();
    const raw = trim(m.text);
    if (!raw || role === 'internal' || role === 'system') return;
    if (role === 'visitor') {
      if (transcriptDisplay.isHandoffRequestLine(raw)) return;
      const text = transcriptDisplay.normalizeUserQueryText(raw) || raw;
      if (!text || transcriptDisplay.isInternalActionToken(text)) return;
      lines.push(text);
      return;
    }
    if (role === 'agent' || role === 'staff') {
      let body = raw;
      const who =
        trim(m.senderDisplayName) ||
        trim(session.assignedAgentDisplayName) ||
        '';
      if (who) {
        const prefix = `${who}:`;
        if (body.toLowerCase().startsWith(prefix.toLowerCase())) {
          body = trim(body.slice(prefix.length));
        }
      }
      body = trim(body.replace(/^[^:]{1,48}:\s+/, '')) || raw;
      if (!body || transcriptDisplay.isInternalActionToken(body)) return;
      if (/^typing(\.{0,3})?$/i.test(body)) return;
      lines.push(body);
    }
  });
  return lines.join(' | ').slice(0, 2000);
}

/** Sheet1 User Queries tail after bot lines — connected marker plus handoff chat (not queue status). */
function buildSheet1LiveAgentHandoffQueries(session) {
  const parts = [];
  const status = trim(session && session.status).toLowerCase();
  if (
    status === 'active'
    || trim(session && session.acceptedAt)
    || trim(session && session.claimedAt)
    || trim(session && session.assignedAgentEmail)
  ) {
    parts.push('Connected with Agent');
  }
  const chatBody = liveAgentVisitorQueriesFromSession(session);
  if (chatBody) {
    chatBody.split(' | ').forEach((line) => {
      const t = trim(line);
      if (t) parts.push(t);
    });
  }
  return parts.join(', ');
}

function liveAgentMetrics(session) {
  const msgs = (session && session.messages) || [];
  let count = 0;
  msgs.forEach((m) => {
    const role = trim(m && m.role);
    if (role === 'visitor' || role === 'agent') count += 1;
  });

  const startMs = Date.parse(session.requestedAt || session.createdAt || '');
  const endRaw = session.closedAt || session.lastMessageAt || session.updatedAt || '';
  const endMs = Date.parse(endRaw);
  let duration = '';
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    const sec = Math.round((endMs - startMs) / 1000);
    duration = sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`;
  }
  return { messageCount: String(count), duration };
}

function buildRowValues(session) {
  const sid = trim(session.sessionId);
  const doc = chatTranscript.getSessionDoc(sid);
  const meta =
    (session._sheetMeta && typeof session._sheetMeta === 'object'
      ? session._sheetMeta
      : null) ||
    (doc && doc.meta) ||
    {};
  const startedRaw =
    session.requestedAt || session.createdAt || (doc.turns && doc.turns[0] && doc.turns[0].at);
  const started = startedRaw ? new Date(startedRaw) : new Date();
  const metrics = liveAgentMetrics(session);
  const name =
    trim(session.visitorName) || trim(meta.name) || trim(meta.visitorName);

  return [
    sheets.chatscriptSheetCell(sid),
    formatDateForSheet(started),
    formatTime(started),
    name,
    formatMobileForSheet(meta),
    scalar(meta.email),
    trim(session.assignedAgentDisplayName) ||
      resolveAgentNameForSheet_(session) ||
      '',
    trim(session.departmentName) || trim(session.departmentId) || 'General',
    trim(session.status) || 'waiting',
    liveAgentSheetUserQueries_(session),
    sid,
    metrics.messageCount,
    metrics.duration,
  ];
}

function sessionYmdInTz(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  if (map.year && map.month && map.day) {
    return `${map.year}-${map.month}-${map.day}`;
  }
  return '';
}

function isoYyyyMmDdOk(s) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(s || '').trim());
}

function scheduleSheet2Sync(sessionId) {
  if (!sheets.isConfigured()) return;
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (syncTimers.has(sid)) clearTimeout(syncTimers.get(sid));
  syncTimers.set(
    sid,
    setTimeout(() => {
      syncTimers.delete(sid);
      syncSessionToSheet2(sid).catch((e) => {
        console.warn('[live-agent-sheet] sync failed:', e.message);
      });
    }, 2500)
  );
}

function persistSheet2Row(session, rowNum) {
  if (!session || !rowNum) return;
  session.sheet2Row = rowNum;
  try {
    const liveAgentStore = require('./live-agent-store');
    if (typeof liveAgentStore.persistSheet2Row === 'function') {
      liveAgentStore.persistSheet2Row(session.sessionId, rowNum);
    } else {
      liveAgentStore.saveStore();
    }
  } catch {
    /* ignore */
  }
}

async function runSheet2Sync(sessionId) {
  if (!sheets.isConfigured()) return { skipped: true, reason: 'not_configured' };
  const sid = String(sessionId || '').trim();
  if (!sid) return { skipped: true, reason: 'no_session' };

  const suppression = await import('../sheet-sync-suppression.mjs');
  if (await suppression.isSheet2SyncExcluded_(sid)) {
    return { skipped: true, reason: 'sheet2_excluded' };
  }

  const liveAgentStore = require('./live-agent-store');
  let session = await loadSessionForSheet_(sid);
  if (!session) {
    session =
      typeof liveAgentStore.getSessionAsync === 'function'
        ? await liveAgentStore.getSessionAsync(sid)
        : liveAgentStore.getSession(sid);
  }
  if (!session || !sessionQualifies(session)) {
    return { skipped: true, reason: 'not_live_agent' };
  }

  const values = buildRowValues(session);
  const tab = tabName();
  await sheets.ensureHeaderRowOnTab(tab, LIVE_AGENT_SHEET_HEADERS);

  const writeRow = async (rowNum) => {
    await sheets.updateRowOnTab(tab, rowNum, values);
    await sheets.writeChatscriptForRowOnTab(tab, rowNum, sid);
  };

  const found = await sheets.fetchSheetRowBySessionIdOnTab(
    tab,
    sid,
    LIVE_AGENT_SHEET_HEADERS
  );
  if (found && found.rowNumber >= 2) {
    await writeRow(found.rowNumber);
    persistSheet2Row(session, found.rowNumber);
    return { ok: true, updated: found.rowNumber };
  }

  const priorRow = session.sheet2Row && Number(session.sheet2Row);
  const sheet2State = await suppression.fetchSheet2SyncState_(sid);
  if (sheet2State.excluded) {
    return { skipped: true, reason: 'sheet2_excluded' };
  }
  if (priorRow >= 2 || sheet2State.sheet2Row >= 2) {
    await suppression.markSheet2SyncExcluded_(sid, 'row_removed');
    return { skipped: true, reason: 'sheet2_row_removed' };
  }

  const appended = await sheets.appendRowValuesOnTab(tab, values);
  if (!appended) {
    return { ok: false, error: 'append_failed' };
  }
  await sheets.writeChatscriptForRowOnTab(tab, appended, sid);
  persistSheet2Row(session, appended);
  return { ok: true, appended };
}

async function syncSessionToSheet2(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { skipped: true };

  const prev = syncChains.get(sid) || Promise.resolve();
  const job = prev
    .then(() => runSheet2Sync(sid))
    .catch((e) => {
      console.warn('[live-agent-sheet] sync failed:', e.message);
      throw e;
    });
  syncChains.set(sid, job);
  try {
    return await job;
  } finally {
    if (syncChains.get(sid) === job) syncChains.delete(sid);
  }
}

/**
 * Bulk sync live-agent rows to Sheet2 (used by conversations-sheet "Sync dashboard").
 * @param {{ from?: string, to?: string }} [opts] YYYY-MM-DD in sheet TZ
 */
async function syncDashboardToSheet2(opts = {}) {
  if (!sheets.isConfigured()) {
    return { ok: false, error: 'not_configured' };
  }

  const fromIn = trim(opts.from);
  const toIn = trim(opts.to);
  const filterActive = !!(fromIn || toIn);
  let fromEff = '1900-01-01';
  let toEff = '9999-12-31';
  if (filterActive) {
    if (fromIn) {
      if (!isoYyyyMmDdOk(fromIn)) throw new Error('Invalid from date (use YYYY-MM-DD).');
      fromEff = fromIn;
    }
    if (toIn) {
      if (!isoYyyyMmDdOk(toIn)) throw new Error('Invalid to date (use YYYY-MM-DD).');
      toEff = toIn;
    }
  }

  const liveAgentStore = require('./live-agent-store');
  await Promise.resolve(liveAgentStore.storageReady());
  const tab = tabName();
  await sheets.ensureHeaderRowOnTab(tab, LIVE_AGENT_SHEET_HEADERS);

  let sessions = [];
  try {
    sessions = liveAgentStore.listAllSessions();
  } catch (e) {
    return { ok: false, error: e.message || 'list_failed' };
  }

  let synced = 0;
  let skipped = 0;
  for (let i = 0; i < sessions.length; i += 1) {
    const s = sessions[i];
    if (!sessionQualifies(s)) {
      skipped += 1;
      continue;
    }
    if (filterActive) {
      const ymd = sessionYmdInTz(s.requestedAt || s.createdAt);
      if (!ymd || ymd < fromEff || ymd > toEff) {
        skipped += 1;
        continue;
      }
    }
    const result = await syncSessionToSheet2(s.sessionId);
    if (result && result.ok) synced += 1;
    else skipped += 1;
  }

  return {
    ok: true,
    tab,
    synced,
    skipped,
    total: sessions.length,
    dateFilter: filterActive ? { from: fromEff, to: toEff } : null,
  };
}

module.exports = {
  LIVE_AGENT_SHEET_HEADERS,
  scheduleSheet2Sync,
  syncSessionToSheet2,
  syncDashboardToSheet2,
  buildRowValues,
  buildSheet1LiveAgentHandoffQueries,
  liveAgentQueriesFromSession,
  sessionQualifies,
};
