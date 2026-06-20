/**
 * Business timezone for appointments (server on UTC/Railway still uses this).
 */

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

module.exports = {
  DEFAULT_TZ,
  normalizeTimezone,
  todayIsoInZone,
  nowMinutesInZone,
};
