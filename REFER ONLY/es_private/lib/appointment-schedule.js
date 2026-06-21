/**
 * Per-form appointment schedule — edit data/appointment-schedule.json
 */

const fs = require('fs');
const path = require('path');
const { to24h, to12h } = require('./time-format');
const localTime = require('./local-time');
const clientPaths = require('./client-paths');

const SCHEDULE_PATH =
  process.env.APPOINTMENT_SCHEDULE_PATH || clientPaths.appointmentSchedulePath();

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const DEFAULT_FORM_ID = 'appointment';

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function defaultFormBlock() {
  return {
    slotMinutes: 30,
    slotCapacity: 1,
    /** false = aaj ki date calendar par select nahi hogi */
    allowToday: true,
    /** true = aaj ke liye jo time guzar chuka hai wo slots hide */
    hidePastTimesToday: true,
    /** Kitne din aage tak booking (aaj se; allowToday false ho to kal se) */
    maxBookingDays: 30,
    default: { periods: [{ start: '9:00 AM', end: '6:00 PM' }] },
    weekdays: { sunday: { closed: true } },
    dates: {},
  };
}

function pickBool(defaultVal, ...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (typeof c === 'boolean') return c;
    if (c === 'true' || c === 1 || c === '1') return true;
    if (c === 'false' || c === 0 || c === '0') return false;
  }
  return defaultVal;
}

function addDaysIso(dateIso, days) {
  const parts = String(dateIso || '').split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateIso;
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getFormSettings(formId) {
  const block = getFormBlock(formId);
  return {
    allowToday: pickBool(true, block.allowToday),
    hidePastTimesToday: pickBool(true, block.hidePastTimesToday),
    maxBookingDays: pickInt(7, 365, block.maxBookingDays),
    timezone: localTime.normalizeTimezone(block.timezone),
  };
}

/** Inclusive bookable range [min, max] (ISO dates). */
function getBookingWindow(settings) {
  const s = settings || {};
  const today = localTime.todayIsoInZone(s.timezone);
  const span = pickInt(7, 365, s.maxBookingDays);
  const min = s.allowToday ? today : addDaysIso(today, 1);
  const max = addDaysIso(min, span - 1);
  return {
    min,
    max,
    maxBookingDays: span,
    allowToday: !!s.allowToday,
    hidePastTimesToday: !!s.hidePastTimesToday,
  };
}

function isWithinBookingWindow(dateIso, settings) {
  const w = getBookingWindow(settings);
  const d = String(dateIso || '').trim();
  return d >= w.min && d <= w.max;
}

function defaultSchedule() {
  return { forms: { [DEFAULT_FORM_ID]: defaultFormBlock() } };
}

function normalizeFormId(formId) {
  const id = String(formId || DEFAULT_FORM_ID).trim().toLowerCase();
  if (id === 'general' || id === 'appintmentformgeneral') return DEFAULT_FORM_ID;
  return id || DEFAULT_FORM_ID;
}

/** Migrate old top-level weekdays / scopes.doctor into forms.appointment once. */
function migrateLegacySchedule(raw) {
  if (!raw || typeof raw !== 'object') return defaultSchedule();
  if (raw.forms && typeof raw.forms === 'object') return raw;

  const block = {
    slotMinutes: raw.slotMinutes ?? 30,
    slotCapacity: raw.slotCapacity ?? 1,
    default: raw.default || { periods: [{ start: '9:00 AM', end: '6:00 PM' }] },
    weekdays: raw.weekdays || {},
    dates: raw.dates || {},
  };
  return { forms: { [DEFAULT_FORM_ID]: block } };
}

function loadSchedule() {
  const raw = loadJson(SCHEDULE_PATH, defaultSchedule());
  return migrateLegacySchedule(raw);
}

function getFormBlock(formId) {
  const schedule = loadSchedule();
  const id = normalizeFormId(formId);
  return (
    (schedule.forms && schedule.forms[id]) ||
    schedule.forms[DEFAULT_FORM_ID] ||
    defaultFormBlock()
  );
}

function parseTimeToMinutes(t) {
  const s24 = to24h(t);
  const m = String(s24 || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function buildSlotList(dayStart, dayEnd, slotMinutes) {
  const start = parseTimeToMinutes(dayStart) ?? 9 * 60;
  const end = parseTimeToMinutes(dayEnd) ?? 18 * 60;
  const step = Math.max(parseInt(slotMinutes, 10) || 30, 5);
  const slots = [];
  for (let t = start; t < end; t += step) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

function normalizePeriods(dayCfg) {
  if (!dayCfg || dayCfg.closed) return [];
  let raw = [];
  if (Array.isArray(dayCfg.periods) && dayCfg.periods.length) {
    raw = dayCfg.periods.map((p) => ({
      start: String(p.start || p.dayStart || '').trim(),
      end: String(p.end || p.dayEnd || '').trim(),
    }));
  } else {
    const start = dayCfg.dayStart || dayCfg.start;
    const end = dayCfg.dayEnd || dayCfg.end;
    if (start && end) raw = [{ start: String(start), end: String(end) }];
  }
  return raw
    .filter((p) => p.start && p.end)
    .map((p) => ({ start: to12h(p.start), end: to12h(p.end) }))
    .filter((p) => to24h(p.start) && to24h(p.end));
}

function weekdayNameFromIso(dateIso) {
  const parts = String(dateIso || '').split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 'monday';
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  return WEEKDAY_NAMES[d.getDay()] || 'monday';
}

function pickInt(minVal, maxVal, ...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const n = parseInt(candidates[i], 10);
    if (Number.isFinite(n)) return Math.min(Math.max(n, minVal), maxVal);
  }
  return minVal;
}

function applyDayLayer(base, layer) {
  if (!layer || typeof layer !== 'object') return base;
  if (layer.closed) {
    return {
      closed: true,
      slotMinutes: base.slotMinutes,
      slotCapacity: base.slotCapacity,
      periods: [],
    };
  }
  const next = {
    closed: false,
    slotMinutes: pickInt(5, 240, layer.slotMinutes, base.slotMinutes),
    slotCapacity: pickInt(1, 99, layer.slotCapacity, base.slotCapacity),
    periods: base.periods.slice(),
  };
  const periods = normalizePeriods(layer);
  if (periods.length) next.periods = periods;
  return next;
}

function resolveForDate(formId, dateIso) {
  const block = getFormBlock(formId);
  const id = normalizeFormId(formId);

  let slotMinutes = pickInt(5, 240, block.slotMinutes, 30);
  let slotCapacity = pickInt(1, 99, block.slotCapacity, 1);
  let periods = normalizePeriods(block.default);
  if (!periods.length) periods = [{ start: '9:00 AM', end: '6:00 PM' }];

  const weekday = weekdayNameFromIso(dateIso);
  const weekdayLayer = block.weekdays && block.weekdays[weekday];
  let resolved = applyDayLayer(
    { closed: false, slotMinutes, slotCapacity, periods },
    weekdayLayer
  );

  const dateLayer = block.dates && block.dates[dateIso];
  if (dateLayer) {
    resolved = applyDayLayer(resolved, dateLayer);
  }

  const settings = getFormSettings(id);

  return {
    closed: !!resolved.closed,
    slotMinutes: resolved.slotMinutes,
    slotCapacity: resolved.slotCapacity,
    periods: resolved.periods,
    weekday,
    date: dateIso,
    formId: id,
    allowToday: settings.allowToday,
    hidePastTimesToday: settings.hidePastTimesToday,
    maxBookingDays: settings.maxBookingDays,
    bookingWindow: getBookingWindow(settings),
  };
}

function buildAllSlots(resolved) {
  if (!resolved || resolved.closed || !resolved.periods.length) return [];
  const seen = {};
  const all = [];
  resolved.periods.forEach((per) => {
    buildSlotList(per.start, per.end, resolved.slotMinutes).forEach((slot) => {
      if (!seen[slot]) {
        seen[slot] = true;
        all.push(slot);
      }
    });
  });
  return all.sort();
}

function getScheduleForClient() {
  const schedule = loadSchedule();
  return {
    path: SCHEDULE_PATH,
    forms: schedule.forms || {},
    weekdayNames: WEEKDAY_NAMES,
  };
}

function listFormIds() {
  const schedule = loadSchedule();
  return Object.keys(schedule.forms || { appointment: true });
}

module.exports = {
  SCHEDULE_PATH,
  WEEKDAY_NAMES,
  DEFAULT_FORM_ID,
  normalizeFormId,
  loadSchedule,
  getFormBlock,
  getFormSettings,
  getBookingWindow,
  isWithinBookingWindow,
  addDaysIso,
  todayIsoInZone: (tz) => localTime.todayIsoInZone(tz),
  resolveForDate,
  buildAllSlots,
  buildSlotList,
  getScheduleForClient,
  listFormIds,
  normalizePeriods,
};
