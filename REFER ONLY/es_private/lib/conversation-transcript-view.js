/**
 * Staff conversation transcript API (Only Refer–style viewer).
 */

const chatTranscript = require('./chat-transcript');
const sheets = require('./sheets');
const liveAgent = require('./live-agent');
const liveAgentStore = require('./live-agent-store');
const documentDisplay = require('./document-display');
const transcriptDisplay = require('./transcript-display-text');

const TZ =
  process.env.CONVERSATIONS_TRANSCRIPT_TZ ||
  process.env.SHEETS_CONV_DATETIME_TZ ||
  'Asia/Kolkata';

function parseAtMs(iso) {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function mapRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'user' || r === 'visitor' || r === 'customer') return 'user';
  if (r === 'agent' || r === 'human' || r === 'staff') return 'agent';
  if (
    r === 'bot' ||
    r === 'assistant' ||
    r === 'model' ||
    r === 'system' ||
    r === 'ai'
  ) {
    return 'assistant';
  }
  return 'assistant';
}

function turnHasRichMeta(t) {
  if (!t || !t.meta || typeof t.meta !== 'object') return false;
  return Boolean(t.meta.rich || t.meta.rich_json);
}

function turnsFromSessionDoc(doc) {
  const turns = Array.isArray(doc.turns) ? doc.turns : [];
  return turns
    .map((t, index) => {
      const rawText = t && t.text != null ? String(t.text).trim() : '';
      const text = transcriptDisplay.displayTurnText(t.role, rawText) || rawText;
      if (!text && !turnHasRichMeta(t)) return null;
      const row = {
        role: mapRole(t.role),
        text,
        _seq: index,
        _msgId: t.id ? String(t.id) : '',
      };
      const at = parseAtMs(t.at);
      if (at !== undefined) row.at = at;
      if (t.meta && typeof t.meta === 'object') {
        if (t.meta.rich && typeof t.meta.rich === 'object') {
          row.rich = t.meta.rich;
        }
        if (t.meta.rich_json) {
          row.rich_json = t.meta.rich_json;
        } else if (row.rich) {
          try {
            row.rich_json = JSON.stringify(row.rich);
          } catch {
            /* ignore */
          }
        }
      }
      return row;
    })
    .filter(Boolean);
}

function userTurnsFromSheetQueries(csv) {
  const raw = String(csv || '').trim();
  if (!raw) return [];

  /* Sheet column stores queries joined with " | " (see conversation-sheet userQueriesFromTurns). */
  const chunks = raw.includes('|')
    ? raw.split(/\s*\|\s*/)
    : raw.split(/\r?\n/);

  return chunks
    .map((ln) => String(ln || '').trim())
    .filter(Boolean)
    .map((text) => {
      const display = transcriptDisplay.normalizeUserQueryText(text);
      return display ? { role: 'user', text: display } : null;
    })
    .filter(Boolean);
}

/** Drop one bubble that is the whole Sheet "User Queries" column duplicated per-turn. */
function dropRedundantCombinedUserTurn(turns) {
  const list = Array.isArray(turns) ? turns : [];
  const userTexts = new Set(
    list
      .filter((t) => t && t.role === 'user' && t.text)
      .map((t) => String(t.text).trim().toLowerCase())
  );
  if (userTexts.size < 2) return list;

  return list.filter((t) => {
    if (!t || t.role !== 'user' || !t.text) return true;
    const text = String(t.text).trim();
    if (!text.includes('|')) return true;
    const parts = text
      .split(/\s*\|\s*/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length < 2) return true;
    const others = new Set(userTexts);
    others.delete(text.toLowerCase());
    if (others.size < parts.length) return true;
    const allPartsElsewhere = parts.every((p) => others.has(p));
    return !allPartsElsewhere;
  });
}

function turnDedupeKey(t) {
  if (t && t._msgId) return `id\x1e${String(t._msgId)}`;
  const role = t && t.role ? t.role : 'assistant';
  let text = String((t && t.text) || '').trim();
  if (role === 'user') {
    const normalized = transcriptDisplay.normalizeUserQueryText(text);
    if (normalized) text = normalized;
  }
  return `${role}\x1e${text.toLowerCase()}`;
}

function mergeTranscriptTurns(primary, extra) {
  const out = [...(primary || [])];
  const seen = new Set();
  out.forEach((t) => {
    seen.add(turnDedupeKey(t));
  });
  (extra || []).forEach((t) => {
    if (!t || !t.text) return;
    const key = turnDedupeKey(t);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  });
  return out.sort((a, b) => {
    const ax = a.at != null ? a.at : 0;
    const ay = b.at != null ? b.at : 0;
    if (ax !== ay) return ax - ay;
    const sx = a._seq != null ? a._seq : 0;
    const sy = b._seq != null ? b._seq : 0;
    return sx - sy;
  });
}

function transcriptStatsFromDoc(doc, turns) {
  const stored = Array.isArray(doc.turns) ? doc.turns : [];
  return {
    turn_count: turns.length,
    assistant_count: turns.filter((t) => t.role === 'assistant').length,
    user_count: turns.filter((t) => t.role === 'user').length,
    agent_count: turns.filter((t) => t.role === 'agent').length,
    stored_session_bot_rows: stored.filter((t) => t && t.role === 'bot').length,
    stored_session_assistant_rows: stored.filter(
      (t) => t && (t.role === 'bot' || t.role === 'assistant')
    ).length,
    stored_session_user_rows: stored.filter((t) => t && t.role === 'user').length,
  };
}

function turnsFromLiveAgent(sessionId) {
  const detail = liveAgent.getSessionDetail(sessionId);
  if (!detail.ok) return [];
  const conversation = liveAgent.getConversation(sessionId);
  const msgs = detail.messages || [];
  return msgs
    .map((m) => {
      const msgRole = String(m.role || '').toLowerCase();
      if (msgRole === 'internal') return null;
      const raw = m && m.text != null ? String(m.text).trim() : '';
      if (!raw) return null;
      const from = String(m.from || '').toLowerCase();
      let role = 'assistant';
      if (from === 'agent' || msgRole === 'agent' || msgRole === 'staff') {
        role = 'agent';
      } else if (
        from === 'user' ||
        msgRole === 'visitor' ||
        msgRole === 'user' ||
        msgRole === 'customer'
      ) {
        role = 'user';
      } else if (msgRole === 'system' || from === 'system') {
        role = 'assistant';
      }
      let text = raw;
      if (msgRole === 'system' || from === 'system') {
        text =
          liveAgentStore.formatSystemMessageForVisitor(raw, conversation, m) ||
          transcriptDisplay.formatLiveAgentMarkerText(raw) ||
          raw;
      } else if (role === 'user') {
        text = transcriptDisplay.normalizeUserQueryText(raw) || raw;
      }
      if (!text) return null;
      const row = { role, text, _msgId: m.id ? String(m.id) : '' };
      const at = parseAtMs(m.createdAt || m.at);
      if (at !== undefined) row.at = at;
      return row;
    })
    .filter(Boolean);
}

function metaFromDoc(doc) {
  const m = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  return {
    name: m.name || '',
    email: m.email || '',
    mobile: m.mobile || m.phone || '',
    channel: m.channel || 'Web',
    device: m.device || '',
    browser: m.browser || '',
    form_id: m.form_id || '',
  };
}

async function getConversationTranscript(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) {
    return { ok: false, error: 'Missing session query parameter.' };
  }

  const doc = chatTranscript.getSessionDoc(sid);
  let turns = turnsFromSessionDoc(doc);
  const liveTurns = turnsFromLiveAgent(sid);
  if (liveTurns.length) {
    turns = mergeTranscriptTurns(turns, liveTurns);
  }

  const meta = metaFromDoc(doc);
  const docMeta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  meta.document = documentDisplay.documentNamesFromMeta(docMeta) || meta.document;
  let sheet = null;

  if (sheets.isConfigured()) {
    const row = await sheets.fetchSheetRowBySessionId(sid);
    if (row) {
      const columns = { ...row.columns };
      if (columns.Document != null) {
        columns.Document = documentDisplay.formatDocumentFieldForDisplay(
          columns.Document
        );
      }
      sheet = { rowNumber: row.rowNumber, columns };
      sheet.columns = columns;
      if (!meta.name && row.columns.Name) meta.name = row.columns.Name;
      if (!meta.email && row.columns.Email) meta.email = row.columns.Email;
      if (!meta.mobile && row.columns.Mobile) meta.mobile = row.columns.Mobile;
      const uq = row.columns['User Queries'] || '';
      const storedUserTurns = turns.filter((t) => t && t.role === 'user').length;
      /* Avoid duplicate first line: sheet User Queries is a summary column, not a separate turn. */
      if (uq && storedUserTurns === 0) {
        const sheetUserTurns = userTurnsFromSheetQueries(uq);
        if (sheetUserTurns.length) {
          turns = mergeTranscriptTurns(turns, sheetUserTurns);
        }
      }
    }
  }

  turns = dropRedundantCombinedUserTurn(turns);

  const timeIncludesDate =
    String(process.env.CONVERSATIONS_TRANSCRIPT_TIME_INCLUDES_DATE || '')
      .trim()
      .toLowerCase() === 'true' ||
    String(process.env.CONVERSATIONS_TRANSCRIPT_TIME_INCLUDES_DATE || '')
      .trim() === '1';

  return {
    ok: true,
    session: sid,
    source: liveTurns.length ? 'transcript+live_agent' : 'transcript',
    meta,
    sheet,
    turns,
    transcript_time_zone: TZ,
    transcript_time_includes_date: timeIncludesDate,
    transcript_stats: transcriptStatsFromDoc(doc, turns),
  };
}

function verifyViewerAuth(req) {
  const sheetSecret = String(
    process.env.CONVERSATIONS_SHEET_VIEW_SECRET || ''
  ).trim();
  const deskToken = String(process.env.LIVE_AGENT_DESK_TOKEN || '').trim();

  const sheetHdr = String(
    req.headers['x-conversations-sheet-secret'] || ''
  ).trim();
  const agentHdr =
    String(req.headers['x-agent-token'] || '').trim() ||
    String(req.headers['x-desk-token'] || '').trim();
  let bearer = '';
  const auth = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(auth)) bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const querySecret = String(req.query.secret || '').trim();
  const candidates = [sheetHdr, agentHdr, bearer, querySecret].filter(Boolean);

  if (sheetSecret && candidates.some((c) => c === sheetSecret)) {
    return { ok: true };
  }
  if (deskToken && candidates.some((c) => c === deskToken)) {
    return { ok: true };
  }
  if (liveAgent.verifyDeskToken(req)) return { ok: true };

  if (!sheetSecret && !deskToken && !liveAgent.isDeskTokenRequired()) {
    return { ok: true };
  }

  return {
    ok: false,
    error:
      'Unauthorized — use desk token (X-Agent-Token) or conversations viewer secret.',
  };
}

module.exports = {
  getConversationTranscript,
  verifyViewerAuth,
};
