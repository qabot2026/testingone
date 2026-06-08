/**
 * Chat transcript storage (JSON files) — user / bot / agent turns per session.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const transcriptDisplay = require('./transcript-display-text');
const qaMode = require('./qa-mode');
function scheduleSheetSync(sessionId) {
  try {
    require('./conversation-sheet').scheduleSheetSync(sessionId);
  } catch (e) {
    console.warn('[transcript→sheet]', e.message);
  }
}

const DATA_DIR =
  process.env.TRANSCRIPT_DATA_DIR ||
  path.join(__dirname, '..', 'data', 'transcripts');
const INDEX_PATH = path.join(DATA_DIR, '_index.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadIndex() {
  ensureDir();
  try {
    if (fs.existsSync(INDEX_PATH)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      if (raw && typeof raw.sessions === 'object') return raw;
    }
  } catch (e) {
    console.warn('[transcript] index load:', e.message);
  }
  return { sessions: {} };
}

function saveIndex(index) {
  ensureDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

function sessionPath(sessionId) {
  const safe = String(sessionId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return path.join(DATA_DIR, safe + '.json');
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'user' || r === 'visitor' || r === 'customer') return 'user';
  if (r === 'agent' || r === 'human' || r === 'staff') return 'agent';
  return 'bot';
}

/** True after visitor typed or tapped a chip/button (not welcome-only / panel open). */
function sessionHasUserEngagement(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  if (meta.userEngaged === true || meta.user_engaged === true) return true;
  const turns = Array.isArray(doc.turns) ? doc.turns : [];
  return turns.some(
    (t) => t && t.role === 'user' && String(t.text || '').trim()
  );
}

function shouldScheduleSheetForSession(sessionId, doc) {
  const d = doc || getSessionDoc(sessionId);
  return sessionHasUserEngagement(d);
}

function appendTurn(sessionId, role, text, meta, options) {
  const sid = String(sessionId || '').trim();
  if (qaMode.isQaSessionId(sid)) return null;
  let t = String(text || '').trim();
  if (!sid || !t) return null;
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'user') {
    const display = transcriptDisplay.normalizeUserQueryText(t);
    if (!display) return null;
    t = display;
  }
  const scheduleSheet = !options || options.scheduleSheet !== false;

  ensureDir();
  const file = sessionPath(sid);
  let doc = { sessionId: sid, turns: [], meta: {} };
  try {
    if (fs.existsSync(file)) {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(doc.turns)) doc.turns = [];
      if (!doc.meta || typeof doc.meta !== 'object') doc.meta = {};
    }
  } catch {
    doc = { sessionId: sid, turns: [], meta: {} };
  }

  const explicitId =
    options && typeof options.id === 'string' && options.id.trim()
      ? options.id.trim()
      : '';
  if (explicitId) {
    const existing = doc.turns.find((x) => x && x.id === explicitId);
    if (existing) return existing;
  }
  if (normalizedRole === 'user') {
    const last = doc.turns.length ? doc.turns[doc.turns.length - 1] : null;
    if (last && normalizeRole(last.role) === 'user' && String(last.text || '').trim() === t) {
      if (explicitId && !last.id) last.id = explicitId;
      return last;
    }
  }
  const turnId = explicitId || randomUUID();
  const turn = {
    id: turnId,
    role: normalizeRole(role),
    text: t,
    at: new Date().toISOString(),
    meta: meta || undefined,
  };
  doc.turns.push(turn);
  doc.updatedAt = turn.at;
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');

  const index = loadIndex();
  const prev = index.sessions[sid] || {};
  index.sessions[sid] = {
    sessionId: sid,
    updatedAt: turn.at,
    createdAt: prev.createdAt || turn.at,
    turnCount: doc.turns.length,
    lastRole: turn.role,
    preview: t.slice(0, 120),
  };
  saveIndex(index);

  if (scheduleSheet && shouldScheduleSheetForSession(sid, doc)) {
    scheduleSheetSync(sid);
  }

  return turn;
}

function getSessionDoc(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { sessionId: '', turns: [], meta: {} };
  const file = sessionPath(sid);
  if (!fs.existsSync(file)) {
    return { sessionId: sid, turns: [], meta: {} };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(doc.turns)) doc.turns = [];
    if (!doc.meta || typeof doc.meta !== 'object') doc.meta = {};
    doc.sessionId = sid;
    return doc;
  } catch {
    return { sessionId: sid, turns: [], meta: {} };
  }
}

function mergeSessionMeta(sessionId, partial, options) {
  const sid = String(sessionId || '').trim();
  if (qaMode.isQaSessionId(sid)) return;
  if (!sid || !partial || typeof partial !== 'object') return;
  ensureDir();
  const file = sessionPath(sid);
  const doc = getSessionDoc(sid);
  doc.meta = Object.assign({}, doc.meta || {}, partial);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
  const schedule =
    !options || options.scheduleSheet !== false;
  if (schedule && shouldScheduleSheetForSession(sid, doc)) {
    scheduleSheetSync(sid);
  }
}

function setSheetRow(sessionId, rowNum) {
  const sid = String(sessionId || '').trim();
  if (!sid || !rowNum) return;
  const doc = getSessionDoc(sid);
  doc.sheetRow = rowNum;
  ensureDir();
  fs.writeFileSync(
    sessionPath(sid),
    JSON.stringify(doc, null, 2),
    'utf8'
  );
}

function markSheet1Excluded(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const doc = getSessionDoc(sid);
  doc.meta = Object.assign({}, doc.meta || {}, { sheet1_excluded: true });
  delete doc.sheetRow;
  ensureDir();
  fs.writeFileSync(sessionPath(sid), JSON.stringify(doc, null, 2), 'utf8');
}

function appendTurns(sessionId, turns) {
  if (!Array.isArray(turns)) return [];
  const out = [];
  turns.forEach((item) => {
    if (!item) return;
    const t = appendTurn(sessionId, item.role, item.text, item.meta);
    if (t) out.push(t);
  });
  return out;
}

function getTranscript(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { error: 'session_required' };
  const file = sessionPath(sid);
  if (!fs.existsSync(file)) {
    return { ok: true, sessionId: sid, turns: [] };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ok: true,
      sessionId: sid,
      turns: Array.isArray(doc.turns) ? doc.turns : [],
      updatedAt: doc.updatedAt || null,
    };
  } catch (e) {
    return { error: 'read_failed', message: e.message };
  }
}

function listSessions(limit = 100) {
  const index = loadIndex();
  const list = Object.values(index.sessions || {}).filter(
    (s) => !qaMode.isQaSessionId(s && s.sessionId)
  );
  list.sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
  return list.slice(0, Math.max(1, limit));
}

function getAnalyticsSummary(liveAgentQueue) {
  const index = loadIndex();
  const sessions = Object.values(index.sessions || {}).filter(
    (s) => !qaMode.isQaSessionId(s && s.sessionId)
  );
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let turnsToday = 0;
  let sessionsToday = 0;
  let totalTurns = 0;

  sessions.forEach((s) => {
    totalTurns += s.turnCount || 0;
    if (String(s.updatedAt || '').slice(0, 10) === today) {
      sessionsToday += 1;
      turnsToday += s.turnCount || 0;
    }
  });

  const waiting = (liveAgentQueue && liveAgentQueue.waiting) || [];
  const active = (liveAgentQueue && liveAgentQueue.active) || [];

  return {
    totalSessions: sessions.length,
    totalTurns,
    sessionsToday,
    turnsToday,
    liveWaiting: waiting.length,
    liveActive: active.length,
    recentSessions: listSessions(15),
  };
}

/** Rich payload for staff transcript (matches conversation-transcript.html resolveRich). */
function richMetaFromDialogflowResult(result) {
  if (!result || typeof result !== 'object') return undefined;
  const rich = {};
  let has = false;
  if (Array.isArray(result.chips) && result.chips.length) {
    rich.chips = result.chips;
    has = true;
  }
  if (result.chipHeading && String(result.chipHeading).trim()) {
    rich.chipHeading = String(result.chipHeading).trim();
    has = true;
  }
  if (Array.isArray(result.infoCards) && result.infoCards.length) {
    rich.infoCards = result.infoCards;
    has = true;
  }
  if (Array.isArray(result.downloads) && result.downloads.length) {
    rich.downloads = result.downloads;
    has = true;
  }
  if (Array.isArray(result.dropdowns) && result.dropdowns.length) {
    const d0 = result.dropdowns[0];
    rich.action = 'dfchat_inline_select';
    rich.options = d0 && d0.options ? d0.options : [];
    rich.placeholder = (d0 && d0.message) || '';
    has = true;
  }
  if (Array.isArray(result.galleries) && result.galleries.length) {
    const g0 = result.galleries[0];
    rich.action = 'open_gallery';
    rich.urls = g0 && g0.urls ? g0.urls : [];
    rich.message = (g0 && g0.message) || '';
    has = true;
  }
  if (Array.isArray(result.cardCarousels) && result.cardCarousels.length) {
    const c0 = result.cardCarousels[0];
    rich.action = 'open_card_carousel';
    rich.cards = c0 && c0.cards ? c0.cards : [];
    rich.message = (c0 && c0.message) || '';
    has = true;
  }
  if (Array.isArray(result.forms) && result.forms.length) {
    const f0 = result.forms[0];
    rich.action = 'open_form';
    rich.form_id = (f0 && (f0.formId || f0.form_id)) || '';
    rich.message = (f0 && f0.message) || '';
    has = true;
  }
  if (result.liveAgent) {
    rich.action = 'request_live_agent';
    if (result.liveAgentMessage) rich.message = String(result.liveAgentMessage);
    if (result.liveAgentDepartment) {
      rich.department = String(result.liveAgentDepartment);
    }
    has = true;
  }
  return has ? { rich } : undefined;
}

function botDisplayTextFromDialogflowResult(result) {
  if (!result) return '';
  const parts = Array.isArray(result.replyParts) ? result.replyParts : [];
  if (parts.length) {
    const joined = parts
      .map((p) => (p && p.text != null ? String(p.text).trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  const reply = String(result.reply || '').trim();
  if (reply && reply !== 'No response.') return reply;
  if (result.liveAgentMessage && String(result.liveAgentMessage).trim()) {
    return String(result.liveAgentMessage).trim();
  }
  if (result.chipHeading && String(result.chipHeading).trim()) {
    return String(result.chipHeading).trim();
  }
  if (Array.isArray(result.chips) && result.chips.length) {
    const chipText = result.chips
      .map((c) => {
        if (!c) return '';
        if (typeof c === 'string') return c.trim();
        return String(c.message || c.text || '').trim();
      })
      .filter(Boolean)
      .join(' · ');
    if (chipText) return chipText;
  }
  if (Array.isArray(result.forms) && result.forms.length) {
    const fm = result.forms[0] && result.forms[0].message;
    if (fm && String(fm).trim()) return String(fm).trim();
  }
  if (Array.isArray(result.cardCarousels) && result.cardCarousels.length) {
    const m = result.cardCarousels[0] && result.cardCarousels[0].message;
    if (m && String(m).trim()) return String(m).trim();
  }
  if (Array.isArray(result.galleries) && result.galleries.length) {
    const m = result.galleries[0] && result.galleries[0].message;
    if (m && String(m).trim()) return String(m).trim();
  }
  if (Array.isArray(result.dropdowns) && result.dropdowns.length) {
    const m = result.dropdowns[0] && result.dropdowns[0].message;
    if (m && String(m).trim()) return String(m).trim();
  }
  return '';
}

/** Record user + bot lines from /api/chat (server-side; does not rely on widget patch). */
function logDialogflowExchange(sessionId, userMessage, result, options) {
  const sid = String(sessionId || '').trim();
  if (qaMode.isQaSessionId(sid)) return;
  if (!sid || !result) return;
  const opts = options && typeof options === 'object' ? options : {};
  const noSchedule = { scheduleSheet: false };
  const userText =
    userMessage != null ? String(userMessage).trim() : '';
  const formSubmit = transcriptDisplay.isFormSubmitPayload(userText);

  /* Form submit user line: widget logs before thank-you; skip duplicate on silent DF post. */
  if (userText && formSubmit && !opts.skipTranscriptUser) {
    const displayUser = transcriptDisplay.normalizeUserQueryText(userText);
    if (displayUser) {
      appendTurn(sid, 'user', displayUser, undefined, noSchedule);
    }
  }

  if (userText && !formSubmit) {
    try {
      let queryAt = new Date().toISOString();
      const normalizedUser = transcriptDisplay.normalizeUserQueryText(userText);
      try {
        const existing = getSessionDoc(sid);
        const turns = Array.isArray(existing.turns) ? existing.turns : [];
        for (let i = turns.length - 1; i >= 0; i -= 1) {
          const turn = turns[i];
          if (!turn || turn.role !== 'user') continue;
          const display = transcriptDisplay.normalizeUserQueryText(turn.text);
          if (display && display === normalizedUser) {
            queryAt = turn.at || queryAt;
            break;
          }
        }
      } catch {
        /* use now */
      }
      const queryAnalytics = require('./query-analytics');
      queryAnalytics.recordQuery({
        sessionId: sid,
        query: userText,
        at: queryAt,
        outcome: queryAnalytics.outcomeFromChatResult(result),
        intent: result.intent || '',
        source: 'chat',
      });
    } catch (e) {
      console.warn('[query-analytics] record:', e.message);
    }
  }

  /* Bot lines are logged from the widget when appendMessage renders them (matches chat UI). */

  if (result.intentIsFallback) {
    mergeSessionMeta(sid, { fallback: 'yes' }, { scheduleSheet: false });
  }

  const doc = getSessionDoc(sid);
  if (userText || sessionHasUserEngagement(doc)) {
    scheduleSheetSync(sid);
  }
}

/**
 * Skip duplicate file bytes when the same session uploads again within a short window
 * (double submit or contact→upload creating a second folder).
 */
function filterDuplicateUploadFilesForSession(sessionId, files) {
  const sid = String(sessionId || '').trim();
  const list = Array.isArray(files) ? files : [];
  if (!sid || !list.length) return list;

  const byKey = new Set();
  const unique = list.filter((f) => {
    if (!f) return false;
    const k = `${f.originalname || ''}\0${f.size || 0}`;
    if (byKey.has(k)) return false;
    byKey.add(k);
    return true;
  });

  const doc = getSessionDoc(sid);
  const meta = doc.meta || {};
  const prev = Array.isArray(meta.uploaded_files) ? meta.uploaded_files : [];
  if (!prev.length) return unique;

  const lastAt = Date.parse(doc.updatedAt || meta.last_upload_at || '') || 0;
  if (!lastAt || Date.now() - lastAt > 5 * 60 * 1000) return unique;

  return unique.filter((f) => {
    const name = String(f.originalname || '').trim();
    const size = Number(f.size) || 0;
    return !prev.some((p) => {
      const pn = String((p && p.original_name) || '').trim();
      const ps = Number((p && p.size_bytes) || (p && p.size) || 0) || 0;
      return pn === name && ps === size;
    });
  });
}

module.exports = {
  loadIndex,
  appendTurn,
  appendTurns,
  logDialogflowExchange,
  getTranscript,
  getSessionDoc,
  filterDuplicateUploadFilesForSession,
  mergeSessionMeta,
  setSheetRow,
  markSheet1Excluded,
  listSessions,
  getAnalyticsSummary,
  sessionHasUserEngagement,
  shouldScheduleSheetForSession,
};
