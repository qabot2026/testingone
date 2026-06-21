/**
 * Business timezone for appointments (server on UTC/Railway still uses this).
 */

const dateDisplay = require('./date-display');

const DEFAULT_TZ = 'Asia/Kolkata';

function normalizeTimezone(tz) {
  const s = String(tz || process.env.APPOINTMENT_TIMEZONE || '').trim() || DEFAULT_TZ;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s });
    return s;
  } catch {
    return DEFAULT_TZ;
  }
}

function chatPlaceholderTimezone(tz) {
  return normalizeTimezone(
    tz || process.env.CHAT_TIMEZONE || process.env.APPOINTMENT_TIMEZONE
  );
}

/** YYYY-MM-DD in the given IANA timezone. */
function todayIsoInZone(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: normalizeTimezone(tz) });
}

/** Minutes since midnight in the given timezone. */
function nowMinutesInZone(tz) {
  const zone = normalizeTimezone(tz);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  let h = 0;
  let min = 0;
  parts.forEach((p) => {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') min = parseInt(p.value, 10);
  });
  return h * 60 + min;
}

/** Hour 0–23 in the given IANA timezone. */
function nowHourInZone(tz) {
  return Math.floor(nowMinutesInZone(tz) / 60);
}

function formatChatTime(tz) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: chatPlaceholderTimezone(tz),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());
}

/** morning | afternoon | evening | night */
function timeOfDayFromHour(hour) {
  const h = Number(hour);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function greetingForTimeOfDay(timeOfDay) {
  switch (String(timeOfDay || '').toLowerCase()) {
    case 'morning':
      return 'Good morning';
    case 'afternoon':
      return 'Good afternoon';
    case 'evening':
      return 'Good evening';
    default:
      return 'Hello';
  }
}

/** Placeholders: $greeting, $date, $time (+ $time-of-day for conditions). */
function getChatPlaceholders(tz) {
  const timezone = chatPlaceholderTimezone(tz);
  const dateIso = todayIsoInZone(timezone);
  const hour = nowHourInZone(timezone);
  const timeOfDay = timeOfDayFromHour(hour);
  return {
    greeting: greetingForTimeOfDay(timeOfDay),
    timeOfDay,
    hour,
    timezone,
    date: dateDisplay.isoYmdToDdMmYyyy(dateIso),
    time: formatChatTime(timezone),
  };
}

const PLACEHOLDER_KEYS = [
  'time-of-day',
  'local-hour',
  'greeting',
  'timezone',
  'date',
  'time',
];

function applyChatPlaceholders(text, ctx) {
  const s = String(text == null ? '' : text);
  if (!s || !s.includes('$')) return s;
  const c = ctx || getChatPlaceholders();
  let out = s;
  PLACEHOLDER_KEYS.forEach((key) => {
    let val;
    if (key === 'time-of-day') val = c.timeOfDay;
    else if (key === 'local-hour') val = c.hour;
    else val = c[key];
    if (val == null) return;
    const re = new RegExp(`\\$${key.replace(/-/g, '\\-')}`, 'gi');
    out = out.replace(re, String(val));
  });
  return out;
}

function mapChatPlaceholderField(obj, key, ctx) {
  if (!obj || obj[key] == null) return;
  obj[key] = applyChatPlaceholders(obj[key], ctx);
}

/** Substitute $greeting, $date, $time in Dialogflow bot text (all channels). */
function applyChatPlaceholdersToResult(result, ctx) {
  if (!result || typeof result !== 'object') return result;
  const c = ctx || getChatPlaceholders();
  mapChatPlaceholderField(result, 'reply', c);
  mapChatPlaceholderField(result, 'chipHeading', c);
  mapChatPlaceholderField(result, 'liveAgentMessage', c);
  if (Array.isArray(result.replyParts)) {
    result.replyParts.forEach((part) => {
      if (part && part.text != null) {
        part.text = applyChatPlaceholders(part.text, c);
      }
    });
  }
  ['chips', 'forms', 'dropdowns', 'galleries', 'cardCarousels', 'infoCards', 'downloads'].forEach(
    (listKey) => {
      const list = result[listKey];
      if (!Array.isArray(list)) return;
      list.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        [
          'message',
          'label',
          'title',
          'subtitle',
          'description',
          'sendText',
          'chipHeading',
        ].forEach((key) => mapChatPlaceholderField(item, key, c));
      });
    }
  );
  return result;
}

module.exports = {
  DEFAULT_TZ,
  normalizeTimezone,
  todayIsoInZone,
  nowMinutesInZone,
  nowHourInZone,
  timeOfDayFromHour,
  greetingForTimeOfDay,
  getChatPlaceholders,
  getGreetingContext: getChatPlaceholders,
  applyChatPlaceholders,
  applyChatPlaceholdersToResult,
  PLACEHOLDER_KEYS,
  /** @deprecated use applyChatPlaceholders */
  applyGreetingPlaceholders: applyChatPlaceholders,
  /** @deprecated use applyChatPlaceholdersToResult */
  applyGreetingPlaceholdersToResult: applyChatPlaceholdersToResult,
};
