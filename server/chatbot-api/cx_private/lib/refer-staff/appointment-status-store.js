/**
 * Staff appointment request status (pending / accepted / declined).
 */

const fs = require('fs');
const path = require('path');

const STATUS_PATH =
  process.env.APPOINTMENT_STATUS_PATH ||
  path.join(__dirname, '..', 'data', 'appointment-status.json');

const VALID_STATUSES = new Set(['pending', 'accepted', 'declined']);
const VALID_ACTIONS = new Set(['accept', 'decline']);

let cache = null;

function loadStore() {
  if (cache) return cache;
  try {
    if (fs.existsSync(STATUS_PATH)) {
      cache = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
    } else {
      cache = { sessions: {} };
    }
  } catch {
    cache = { sessions: {} };
  }
  if (!cache.sessions || typeof cache.sessions !== 'object') {
    cache.sessions = {};
  }
  return cache;
}

function saveStore() {
  const dir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(loadStore(), null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function actionToStatus(action) {
  const a = trim(action).toLowerCase();
  if (a === 'accept') return 'accepted';
  if (a === 'decline') return 'declined';
  return '';
}

function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const status = trim(rec.status).toLowerCase();
  if (!VALID_STATUSES.has(status)) return null;
  return {
    status,
    sessionId: trim(rec.sessionId),
    formId: trim(rec.formId) || 'appointment',
    appointmentDate: trim(rec.appointmentDate),
    appointmentTime: trim(rec.appointmentTime),
    name: trim(rec.name),
    mobile: trim(rec.mobile),
    email: trim(rec.email),
    note: trim(rec.note),
    slotBooked: !!rec.slotBooked,
    updatedAt: rec.updatedAt || null,
    updatedBy: trim(rec.updatedBy),
    createdAt: rec.createdAt || rec.updatedAt || null,
  };
}

function getStatus(sessionId) {
  const sid = trim(sessionId);
  if (!sid) return null;
  const rec = loadStore().sessions[sid];
  return normalizeRecord(rec);
}

function listStatusMap() {
  const out = {};
  const sessions = loadStore().sessions || {};
  Object.keys(sessions).forEach((sid) => {
    const rec = normalizeRecord(sessions[sid]);
    if (rec) out[sid] = rec;
  });
  return out;
}

function upsertPendingOnBook(opts) {
  const sid = trim(opts && opts.sessionId);
  if (!sid) return null;
  const store = loadStore();
  const existing = store.sessions[sid];
  if (existing && VALID_STATUSES.has(trim(existing.status).toLowerCase())) {
    return normalizeRecord(existing);
  }
  const t = nowIso();
  const rec = {
    status: 'pending',
    sessionId: sid,
    formId: trim(opts.formId) || 'appointment',
    appointmentDate: trim(opts.appointmentDate),
    appointmentTime: trim(opts.appointmentTime),
    name: trim(opts.name),
    mobile: trim(opts.mobile),
    email: trim(opts.email),
    createdAt: t,
    updatedAt: t,
    updatedBy: '',
    note: '',
    slotBooked: !!opts.slotBooked,
  };
  store.sessions[sid] = rec;
  saveStore();
  return normalizeRecord(rec);
}

function markSlotBooked(sessionId) {
  const sid = trim(sessionId);
  if (!sid) return null;
  const store = loadStore();
  const rec = store.sessions[sid];
  if (!rec) return null;
  rec.slotBooked = true;
  rec.updatedAt = nowIso();
  saveStore();
  return normalizeRecord(rec);
}

function applyAction(opts) {
  const sid = trim(opts && opts.sessionId);
  const action = trim(opts && opts.action).toLowerCase();
  if (!sid) throw new Error('sessionId required');
  if (!VALID_ACTIONS.has(action)) {
    throw new Error('action must be accept or decline');
  }
  const store = loadStore();
  let rec = store.sessions[sid];
  if (!rec) {
    rec = {
      status: 'pending',
      sessionId: sid,
      formId: trim(opts.formId) || 'appointment',
      appointmentDate: trim(opts.appointmentDate),
      appointmentTime: trim(opts.appointmentTime),
      name: trim(opts.name),
      mobile: trim(opts.mobile),
      email: trim(opts.email),
      createdAt: nowIso(),
    };
    store.sessions[sid] = rec;
  }
  const nextStatus = actionToStatus(action);
  const t = nowIso();
  rec.status = nextStatus;
  rec.updatedAt = t;
  rec.updatedBy = trim(opts.updatedBy) || trim(opts.agentEmail) || '';
  if (opts.note) rec.note = trim(opts.note);
  store.sessions[sid] = rec;
  saveStore();
  return normalizeRecord(rec);
}

module.exports = {
  VALID_STATUSES,
  VALID_ACTIONS,
  getStatus,
  listStatusMap,
  upsertPendingOnBook,
  markSlotBooked,
  applyAction,
};
