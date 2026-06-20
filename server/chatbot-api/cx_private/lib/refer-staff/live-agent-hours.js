/**
 * Live agent business hours — stored in live-agent-settings.json (businessHours).
 */

const localTime = require('./local-time');
const { to24h } = require('./time-format');

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DEFAULT_MESSAGE =
  'Our live support team is currently unavailable. We are online Monday through Friday, 9:00 AM to 5:00 PM (IST). Please continue with the assistant, or try again during business hours.';

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function parseTimeToMinutes(t) {
  const s24 = to24h(t);
  const m = String(s24 || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function defaultBusinessHours() {
  return {
    enabled: false,
    timezone: localTime.DEFAULT_TZ,
    workDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    start: '9:00 AM',
    end: '5:00 PM',
    outsideHoursMessage: DEFAULT_MESSAGE,
  };
}

function normalizeWorkDays(days) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(days) ? days : [];
  for (const raw of list) {
    const d = trim(raw).toLowerCase();
    if (!WEEKDAYS.includes(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.length ? out : defaultBusinessHours().workDays;
}

function normalizeBusinessHours(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const def = defaultBusinessHours();
  const startM = parseTimeToMinutes(src.start || def.start);
  const endM = parseTimeToMinutes(src.end || def.end);
  let start = trim(src.start) || def.start;
  let end = trim(src.end) || def.end;
  if (startM != null && endM != null && startM >= endM) {
    start = def.start;
    end = def.end;
  }
  const msg = trim(src.outsideHoursMessage) || def.outsideHoursMessage;
  return {
    enabled: src.enabled === true,
    timezone: localTime.normalizeTimezone(src.timezone || def.timezone),
    workDays: normalizeWorkDays(src.workDays),
    start,
    end,
    outsideHoursMessage: msg.slice(0, 2000),
  };
}

function weekdayNameInZone(tz) {
  const zone = localTime.normalizeTimezone(tz);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
  }).format(new Date());
  return name.toLowerCase();
}

/**
 * @param {object} settings full live-agent settings
 * @returns {{ available: boolean, message: string, reason?: string }}
 */
function checkAvailability(settings) {
  const bh = normalizeBusinessHours(
    settings && settings.businessHours
  );
  if (!bh.enabled) {
    return { available: true, message: '' };
  }
  const day = weekdayNameInZone(bh.timezone);
  if (!bh.workDays.includes(day)) {
    return {
      available: false,
      message: bh.outsideHoursMessage,
      reason: 'closed_day',
    };
  }
  const startM = parseTimeToMinutes(bh.start);
  const endM = parseTimeToMinutes(bh.end);
  if (startM == null || endM == null || startM >= endM) {
    return { available: true, message: '' };
  }
  const nowM = localTime.nowMinutesInZone(bh.timezone);
  if (nowM < startM || nowM >= endM) {
    return {
      available: false,
      message: bh.outsideHoursMessage,
      reason: 'outside_hours',
    };
  }
  return { available: true, message: '' };
}

module.exports = {
  WEEKDAYS,
  DEFAULT_MESSAGE,
  defaultBusinessHours,
  normalizeBusinessHours,
  checkAvailability,
};
