/**
 * One Google Sheet row per conversation (session) — canonical headers.
 */

const sheets = require('./sheets');
const chatTranscript = require('./chat-transcript');
const sentiment = require('./sentiment');
const documentDisplay = require('./document-display');
const sheetDateFormat = require('./sheet-date-format');
const dateDisplay = require('./date-display');
const transcriptDisplay = require('./transcript-display-text');

const TZ = process.env.SHEETS_CONV_DATETIME_TZ || 'Asia/Kolkata';

/** Row 1 headers — match your Google Sheet exactly. */
const SHEET_HEADERS = [
  'Conv. Link',
  'Conv. Date',
  'Conv. Time',
  'Name',
  'Mobile',
  'Email',
  'Channel',
  'User Queries',
  'Repeated User',
  'Source URL',
  'Session ID',
  'Device',
  'Browser',
  'OS',
  'City',
  'IP Address',
  'App. Booked',
  'App. Date',
  'App. Time',
  'Document',
  'Sentiment',
  'Rating',
  'Feedback',
  'Duration',
  'CRM Push Status',
  'Message Count',
  'Average Response Time',
  'UtmCampaign',
  'UtmContent',
  'UtmMedium',
  'UtmSource',
  'UtmTerm',
  'Fall back',
];

const syncTimers = new Map();
/** One in-flight sync per session — prevents duplicate Sheet rows. */
const syncChains = new Map();

/** Sheets date column: numeric serial + dd/mm/yyyy display (not ambiguous US text). */
function formatDateForSheet(d) {
  const v = sheetDateFormat.formatConversationDateForSheet(d);
  return v === '' ? '' : v;
}

function formatAppointmentDateForSheet(raw) {
  if (raw == null || raw === '') return '';
  const v = sheetDateFormat.formatConversationDateForSheet(raw);
  return v === '' ? scalar(raw) : v;
}

/** e.g. 09:02:24PM */
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
    if (p.type === 'minute') minute = p.value;
    if (p.type === 'second') second = p.value;
    if (p.type === 'dayPeriod') dayPeriod = p.value.toUpperCase();
  });
  const h = hour.padStart(2, '0');
  const m = minute.padStart(2, '0');
  const s = second.padStart(2, '0');
  const ap = dayPeriod ? ` ${dayPeriod}` : '';
  return `${h}:${m}:${s}${ap}`;
}

function scalar(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v).trim();
}

function normalizeUserQueryText(text) {
  return transcriptDisplay.normalizeUserQueryText(text);
}

function userQueriesFromTurns(turns) {
  const items = turns
    .filter((t) => t.role === 'user')
    .map((t) => normalizeUserQueryText(t.text))
    .filter(Boolean);

  // De-dupe consecutive duplicates after normalization
  const deduped = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i === 0 || items[i] !== items[i - 1]) deduped.push(items[i]);
  }

  return deduped.join(' | ').slice(0, 2000);
}

function computeMetrics(turns) {
  const userBot = turns.filter((t) => t.role === 'user' || t.role === 'bot');
  const count = userBot.length;
  if (!turns.length) {
    return { duration: '', messageCount: '0', avgResponse: '' };
  }
  const t0 = Date.parse(turns[0].at || '');
  const t1 = Date.parse(turns[turns.length - 1].at || '');
  let duration = '';
  if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) {
    const sec = Math.round((t1 - t0) / 1000);
    duration = sec < 60 ? sec + 's' : Math.round(sec / 60) + 'm';
  }
  const gaps = [];
  for (let i = 0; i < turns.length - 1; i += 1) {
    if (turns[i].role !== 'user') continue;
    const next = turns[i + 1];
    if (!next || next.role !== 'bot') continue;
    const a = Date.parse(turns[i].at || '');
    const b = Date.parse(next.at || '');
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      gaps.push((b - a) / 1000);
    }
  }
  let avgResponse = '';
  if (gaps.length) {
    const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    avgResponse = avg < 60 ? Math.round(avg) + 's' : (avg / 60).toFixed(1) + 'm';
  }
  return {
    duration,
    messageCount: String(count),
    avgResponse,
  };
}

function documentForSheet(meta) {
  return documentDisplay.documentStorageLinksFromMeta(meta || {});
}

/** App. Booked column: yes only when staff accepted (or legacy rows without status). */
function appointmentBookedForSheet(meta) {
  const m = meta || {};
  const status = String(m.appointmentStatus || '').trim().toLowerCase();
  if (status === 'accepted') return 'yes';
  if (status === 'declined') return 'no';
  if (status === 'pending') return 'pending';
  const apptDate = m.appointmentdate || m.appointment_date || '';
  const apptTime = m.appointmenttime || m.appointment_time || '';
  if (apptDate || apptTime) return 'yes';
  return scalar(m.appointmentBooked);
}

/** Sheet display: "91 9966006600" (country code without +) using dial_code + mobile. */
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

/** "Repeated" if this mobile exists on another sheet row; else "First Time". */
async function resolveRepeatedUserLabel(doc) {
  const meta = doc.meta || {};
  const norm = sheets.normalizeMobile(formatMobileForSheet(meta));
  if (!norm) return '';

  const excludeRow =
    doc.sheetRow && Number(doc.sheetRow) >= 2 ? Number(doc.sheetRow) : null;
  const existing = await sheets.listSheetMobiles(excludeRow);
  const isRepeat = existing.some((m) => m === norm);
  return isRepeat ? 'Repeated' : 'First Time';
}

function buildRowValues(doc) {
  const meta = doc.meta || {};
  const turns = doc.turns || [];
  const sid = doc.sessionId || '';
  const started = turns[0] && turns[0].at ? new Date(turns[0].at) : new Date();
  const metrics = computeMetrics(turns);
  const chatscriptCell = sheets.chatscriptSheetCell(sid);

  const apptDate = meta.appointmentdate || meta.appointment_date || '';
  const apptTime = meta.appointmenttime || meta.appointment_time || '';

  return [
    chatscriptCell,
    formatDateForSheet(started),
    formatTime(started),
    scalar(meta.name),
    formatMobileForSheet(meta),
    scalar(meta.email),
    scalar(meta.channel || 'Web'),
    userQueriesFromTurns(turns),
    scalar(meta.repeatedUserLabel || meta.repeatedUser),
    scalar(meta.sourceUrl || meta.pageUrl || meta.url),
    sid,
    scalar(meta.device),
    scalar(meta.browser),
    scalar(meta.os),
    scalar(meta.city),
    scalar(meta.ip || meta.ipAddress),
    appointmentBookedForSheet(meta),
    formatAppointmentDateForSheet(meta.appointmentDateDisplay || apptDate),
    scalar(meta.appointmentTimeDisplay || apptTime),
    documentForSheet(meta),
    sentiment.sentimentLabelFromDoc(doc),
    scalar(meta.rating || meta.feedbackRating),
    scalar(meta.feedback || meta.feedbackMessage || meta.message_feedback),
    metrics.duration,
    scalar(meta.crmPushStatus),
    metrics.messageCount,
    metrics.avgResponse,
    scalar(meta.utm_campaign || meta.utmCampaign),
    scalar(meta.utm_content || meta.utmContent),
    scalar(meta.utm_medium || meta.utmMedium),
    scalar(meta.utm_source || meta.utmSource),
    scalar(meta.utm_term || meta.utmTerm),
    scalar(meta.fallback || meta.fallBack),
  ];
}

/** Map widget / form POST body into transcript meta keys. */
function metaFromClientBody(body) {
  if (!body || typeof body !== 'object') return {};
  const b = body;
  const out = {};
  const pick = (keys, target) => {
    keys.forEach((k) => {
      if (b[k] != null && String(b[k]).trim() !== '') out[target || k] = b[k];
    });
  };
  pick(['name'], 'name');
  pick(['mobile', 'phone'], 'mobile');
  pick(['dial_code', 'dialCode', 'country_dial_code'], 'dial_code');
  pick(['email'], 'email');
  pick(['channel'], 'channel');
  pick(['sourceUrl', 'pageUrl', 'url'], 'sourceUrl');
  pick(['device'], 'device');
  pick(['browser'], 'browser');
  pick(['os'], 'os');
  pick(['city'], 'city');
  pick(['ip', 'ipAddress'], 'ip');
  pick(['document', 'upload'], 'document');
  pick(['tag', 'upload_tag'], 'tag');
  pick(['document_link'], 'document_link');
  pick(['document_links'], 'document_links');
  pick(['storage_folder'], 'storage_folder');
  pick(['rating', 'feedbackRating'], 'rating');
  pick(['feedback', 'feedbackMessage', 'message'], 'feedback');
  pick(['crmPushStatus'], 'crmPushStatus');
  pick(['fallback', 'fallBack'], 'fallback');
  if (b.userEngaged === true || b.user_engaged === true) {
    out.userEngaged = true;
  }
  pick(
    [
      'utm_campaign',
      'utmCampaign',
      'utm_content',
      'utmContent',
      'utm_medium',
      'utmMedium',
      'utm_source',
      'utmSource',
      'utm_term',
      'utmTerm',
    ],
    null
  );
  if (
    b.form_id === 'appointment' ||
    b.form_id === 'appintmentformgeneral' ||
    b.form_id === 'appintmentformdoctor' ||
    b.appointmentdate ||
    b.appointment_date
  ) {
    out.appointmentBooked = 'yes';
    const apptRaw = b.appointmentdate || b.appointment_date || '';
    const apptDmy = dateDisplay.formatDateDisplay(apptRaw);
    if (apptDmy) {
      out.appointmentdate = apptDmy;
      out.appointmentDateDisplay = apptDmy;
    }
    if (b.appointmenttime) out.appointmenttime = b.appointmenttime;
    if (b.appointment_time) out.appointmenttime = b.appointment_time;
    if (b.appointmentTimeDisplay) out.appointmentTimeDisplay = b.appointmentTimeDisplay;
  }
  return out;
}

function mergeSessionMeta(sessionId, partial) {
  return chatTranscript.mergeSessionMeta(sessionId, partial);
}

function scheduleSheetSync(sessionId) {
  if (!sheets.isConfigured()) return;
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  void import('../sheet-sync-gate.mjs')
    .then((gate) => {
      gate.scheduleSheetSyncJob_(sid, 'sheet1', () => syncSessionToSheet(sid));
    })
    .catch((err) => {
      console.warn('[conversation-sheet] schedule gate:', err.message || err);
    });
}

function sessionHasUploadMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return !!(
    m.last_upload_at ||
    m.document_link ||
    m.document_links ||
    m.document_names ||
    m.document ||
    m.storage_folder ||
    (Array.isArray(m.uploaded_files) && m.uploaded_files.length)
  );
}

async function runSheetSync(sessionId) {
  if (!sheets.isConfigured()) return { skipped: true };
  const sid = String(sessionId || '').trim();
  const doc = chatTranscript.getSessionDoc(sid);
  doc.meta = doc.meta || {};
  if (doc.meta.sheet1_excluded) {
    return { skipped: true, reason: 'sheet1_excluded' };
  }
  const hasUpload = sessionHasUploadMeta(doc.meta);
  if (!chatTranscript.sessionHasUserEngagement(doc) && !hasUpload) {
    return { skipped: true, reason: 'no_user_engagement' };
  }
  if (!doc.turns || !doc.turns.length) {
    if (!hasUpload) return { skipped: true, reason: 'no_turns' };
    const at = doc.meta.last_upload_at || new Date().toISOString();
    const label =
      doc.meta.document_names ||
      doc.meta.document ||
      'Document upload';
    doc.turns = [
      {
        role: 'user',
        text: String(label).trim(),
        at,
      },
    ];
  }

  doc.meta = doc.meta || {};
  doc.meta.repeatedUserLabel = await resolveRepeatedUserLabel(doc);

  const values = buildRowValues(doc);
  await sheets.ensureHeaderRow(SHEET_HEADERS);

  const writeRow = async (rowNum) => {
    await sheets.updateRow(rowNum, values);
    await sheets.writeConvLinkForRow(rowNum, sid);
  };

  let suppression = null;
  try {
    suppression = await import('../sheet-sync-suppression.mjs');
  } catch {
    suppression = null;
  }
  if (suppression && typeof suppression.fetchSheet1SyncState_ === 'function') {
    const sheet1State = await suppression.fetchSheet1SyncState_(sid);
    if (sheet1State.excluded) {
      return { skipped: true, reason: 'sheet1_excluded' };
    }
    if (sheet1State.sheet1Row >= 2) {
      await writeRow(sheet1State.sheet1Row);
      chatTranscript.setSheetRow(sid, sheet1State.sheet1Row);
      if (typeof suppression.persistSheet1Row_ === 'function') {
        await suppression.persistSheet1Row_(sid, sheet1State.sheet1Row);
      }
      return { ok: true, updated: sheet1State.sheet1Row, cached: true };
    }
  }

  const priorCached = doc.sheetRow && Number(doc.sheetRow);
  if (priorCached >= 2) {
    await writeRow(priorCached);
    chatTranscript.setSheetRow(sid, priorCached);
    return { ok: true, updated: priorCached, cached: true };
  }

  const found = await sheets.fetchSheetRowBySessionId(sid);
  if (found && found.rowNumber >= 2) {
    await writeRow(found.rowNumber);
    chatTranscript.setSheetRow(sid, found.rowNumber);
    if (suppression && typeof suppression.persistSheet1Row_ === 'function') {
      await suppression.persistSheet1Row_(sid, found.rowNumber);
    }
    return { ok: true, updated: found.rowNumber, convLink: values[0] ? 'yes' : 'no' };
  }

  const priorRow = doc.sheetRow && Number(doc.sheetRow);
  if (priorRow >= 2) {
    chatTranscript.markSheet1Excluded(sid);
    return { skipped: true, reason: 'sheet1_row_removed' };
  }

  const rowNum = await sheets.appendRowValues(values);
  if (!rowNum) {
    console.warn('[conversation-sheet] append returned no row for', sid);
    return { ok: false, error: 'append_failed' };
  }

  await sheets.writeConvLinkForRow(rowNum, sid);
  chatTranscript.setSheetRow(sid, rowNum);
  if (suppression && typeof suppression.persistSheet1Row_ === 'function') {
    await suppression.persistSheet1Row_(sid, rowNum);
  }

  const after = chatTranscript.getSessionDoc(sid);
  if (after.sheetRow && Number(after.sheetRow) !== rowNum) {
    await writeRow(Number(after.sheetRow));
    return { ok: true, updated: after.sheetRow, deduped: true };
  }

  return { ok: true, appended: rowNum, convLink: values[0] ? 'yes' : 'no' };
}

async function syncSessionToSheet(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { skipped: true };

  const prev = syncChains.get(sid) || Promise.resolve();
  const job = prev
    .then(() => runSheetSync(sid))
    .catch((e) => {
      console.warn('[conversation-sheet] sync failed:', e.message);
      throw e;
    });
  syncChains.set(sid, job);
  try {
    return await job;
  } finally {
    if (syncChains.get(sid) === job) syncChains.delete(sid);
  }
}

module.exports = {
  SHEET_HEADERS,
  metaFromClientBody,
  mergeSessionMeta,
  scheduleSheetSync,
  syncSessionToSheet,
  buildRowValues,
  resolveRepeatedUserLabel,
};
