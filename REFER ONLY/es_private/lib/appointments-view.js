/**
 * Staff appointments list — chatbot form submissions with date + time.
 */

const chatTranscript = require('./chat-transcript');
const conversationsSheetView = require('./conversations-sheet-view');
const sheets = require('./sheets');
const dateDisplay = require('./date-display');
const localTime = require('./local-time');
const appointmentStatus = require('./appointment-status-store');

const APPT_TZ =
  process.env.SHEETS_CONV_DATETIME_TZ ||
  process.env.APPOINTMENT_TIMEZONE ||
  localTime.DEFAULT_TZ;

function todayIso() {
  return localTime.todayIsoInZone(APPT_TZ);
}

function resolveAppointmentDateRange(opts) {
  const fromIn = opts && typeof opts.from === 'string' ? opts.from.trim() : '';
  const toIn = opts && typeof opts.to === 'string' ? opts.to.trim() : '';
  let fromIso = fromIn ? dateDisplay.parseToIsoYmd(fromIn) : '';
  let toIso = toIn ? dateDisplay.parseToIsoYmd(toIn) : '';

  if (!fromIso && !toIso) {
    const t = todayIso();
    fromIso = t;
    toIso = t;
  } else if (fromIso && !toIso) {
    toIso = fromIso;
  } else if (!fromIso && toIso) {
    fromIso = toIso;
  }

  if (fromIso > toIso) {
    const swap = fromIso;
    fromIso = toIso;
    toIso = swap;
  }

  return { fromIso, toIso };
}

function appointmentDateIso(row) {
  return dateDisplay.parseToIsoYmd(row && row.appointmentDate);
}

function filterByAppointmentDate(items, fromIso, toIso) {
  return (Array.isArray(items) ? items : []).filter((row) => {
    const d = appointmentDateIso(row);
    if (!d) return false;
    return d >= fromIso && d <= toIso;
  });
}

function isAppointmentSheetRow(row) {
  if (!row || typeof row !== 'object') return false;
  const booked = String(row['App. Booked'] || '')
    .trim()
    .toLowerCase();
  const date = String(row['App. Date'] || '').trim();
  const time = String(row['App. Time'] || '').trim();
  return booked === 'yes' || !!date || !!time;
}

function attachStatus(row, statusMap) {
  const sid = String((row && row.sessionId) || '').trim();
  const rec = sid && statusMap ? statusMap[sid] : null;
  const status = rec && rec.status ? rec.status : sid ? 'pending' : '';
  return Object.assign({}, row, {
    status,
    statusUpdatedAt: rec && rec.updatedAt ? rec.updatedAt : null,
    statusUpdatedBy: rec && rec.updatedBy ? rec.updatedBy : '',
    statusNote: rec && rec.note ? rec.note : '',
  });
}

/** Sheet HYPERLINK cells often return label "Chatscript" — always build path from session id. */
function parseConvLinkUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const formula = s.match(/^=HYPERLINK\("([^"]+)"/i);
  if (formula) return formula[1];
  if (/^https?:\/\//i.test(s) && /conversation-transcript/i.test(s)) return s;
  if (s.startsWith('/') && /conversation-transcript/i.test(s)) return s;
  return '';
}

function transcriptPathForSession(sessionId, convLinkRaw) {
  const fromSheet = parseConvLinkUrl(convLinkRaw);
  if (fromSheet) {
    if (fromSheet.startsWith('/')) return fromSheet;
    try {
      const u = new URL(fromSheet);
      return u.pathname + u.search;
    } catch {
      return fromSheet;
    }
  }
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  return `/conversation-transcript?session=${encodeURIComponent(sid)}`;
}

function mapSheetRow(row) {
  const sessionId = String(row['Session ID'] || '').trim();
  const link = String(row['Conv. Link'] || '').trim();
  return {
    source: 'sheet',
    name: String(row.Name || '').trim(),
    mobile: String(row.Mobile || '').trim(),
    email: String(row.Email || '').trim(),
    appointmentDate: dateDisplay.formatDateDisplay(row['App. Date'] || ''),
    appointmentTime: String(row['App. Time'] || '').trim(),
    conversationDate: String(row['Conv. Date'] || '').trim(),
    conversationTime: String(row['Conv. Time'] || '').trim(),
    channel: String(row.Channel || '').trim(),
    sessionId,
    transcriptUrl: transcriptPathForSession(sessionId, link),
  };
}

function mapTranscriptDoc(doc) {
  const meta = (doc && doc.meta) || {};
  const sessionId = String((doc && doc.sessionId) || '').trim();
  const apptDate = String(meta.appointmentdate || meta.appointment_date || meta.appointmentDateDisplay || '').trim();
  const apptTime = String(meta.appointmenttime || meta.appointment_time || meta.appointmentTimeDisplay || '').trim();
  if (!apptDate && !apptTime && String(meta.appointmentBooked || '').toLowerCase() !== 'yes') {
    return null;
  }
  return {
    source: 'transcript',
    name: String(meta.name || '').trim(),
    mobile: String(meta.mobile || meta.phone || '').trim(),
    email: String(meta.email || '').trim(),
    appointmentDate: dateDisplay.formatDateDisplay(apptDate),
    appointmentTime: apptTime,
    conversationDate: dateDisplay.formatDateDisplay(
      String(doc.updatedAt || '').slice(0, 10)
    ),
    conversationTime: '',
    channel: String(meta.channel || 'Web').trim(),
    sessionId,
    transcriptUrl: transcriptPathForSession(sessionId, ''),
    updatedAt: doc.updatedAt || null,
  };
}

function listFromTranscripts(limit) {
  const index = chatTranscript.loadIndex();
  const items = [];
  const sessions = index.sessions || {};
  Object.keys(sessions).forEach((sid) => {
    const doc = chatTranscript.getSessionDoc(sid);
    const row = mapTranscriptDoc(doc);
    if (row) items.push(row);
  });
  items.sort((a, b) =>
    String(b.updatedAt || b.conversationDate || '').localeCompare(
      String(a.updatedAt || a.conversationDate || '')
    )
  );
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  return items.slice(0, cap);
}

async function listFromSheet() {
  const preview = await conversationsSheetView.fetchConversationSheetPreview({
    maxRows: 50000,
    offset: 0,
    allInRange: true,
    includeStats: false,
  });
  return (preview.conversations || [])
    .filter(isAppointmentSheetRow)
    .map(mapSheetRow);
}

function dedupeBySession(items) {
  const seen = new Set();
  const out = [];
  items.forEach((row) => {
    const key = row.sessionId || `${row.mobile}|${row.appointmentDate}|${row.appointmentTime}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function filterByStatus(items, statusFilter) {
  const want = String(statusFilter || '')
    .trim()
    .toLowerCase();
  if (!want || want === 'all') return items;
  return (Array.isArray(items) ? items : []).filter((row) => {
    const st = String(row.status || '').toLowerCase();
    if (want === 'pending') return !st || st === 'pending';
    return st === want;
  });
}

async function fetchAppointmentsList(opts) {
  const { fromIso, toIso } = resolveAppointmentDateRange(opts);
  const statusFilter =
    opts && typeof opts.status === 'string' ? opts.status.trim() : '';
  const statusMap = appointmentStatus.listStatusMap();
  let sheetRows = [];
  let source = 'transcript';

  if (sheets.isConfigured()) {
    try {
      sheetRows = await listFromSheet();
      source = sheetRows.length ? 'sheet' : 'sheet_empty';
    } catch (err) {
      sheetRows = [];
      source = 'sheet_error';
    }
  }

  let items = sheetRows.length ? sheetRows : listFromTranscripts(2000);
  if (sheetRows.length) {
    const transcriptRows = listFromTranscripts(2000);
    items = dedupeBySession(sheetRows.concat(transcriptRows));
  }

  items = filterByAppointmentDate(items, fromIso, toIso);
  items = items.map((row) => attachStatus(row, statusMap));
  items = filterByStatus(items, statusFilter);
  items.sort((a, b) => {
    const da = appointmentDateIso(a) || '';
    const db = appointmentDateIso(b) || '';
    if (da !== db) return da.localeCompare(db);
    return String(a.appointmentTime || '').localeCompare(String(b.appointmentTime || ''));
  });

  return {
    ok: true,
    source,
    sheetsConfigured: sheets.isConfigured(),
    total: items.length,
    appointments: items,
    statusFilter: statusFilter || 'all',
    dateFilter: {
      from: dateDisplay.formatDateDisplay(fromIso),
      to: dateDisplay.formatDateDisplay(toIso),
      fromIso,
      toIso,
      defaultToday: !(
        (opts && opts.from && String(opts.from).trim()) ||
        (opts && opts.to && String(opts.to).trim())
      ),
    },
  };
}

module.exports = {
  fetchAppointmentsList,
  isAppointmentSheetRow,
};
