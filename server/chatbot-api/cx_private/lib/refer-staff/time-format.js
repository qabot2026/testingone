/**
 * Appointment times: 12-hour in config/UI (9:00 AM). Legacy 24h (09:00) still accepted.
 */

function parseTime24(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

/** Normalize any supported time to 24h HH:mm (for slot matching). */
function to24h(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  const p24 = parseTime24(s);
  if (p24) {
    return (
      String(p24.h).padStart(2, '0') + ':' + String(p24.min).padStart(2, '0')
    );
  }
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m12) return '';
  let h = parseInt(m12[1], 10);
  const min = m12[2];
  const pm = m12[3].toUpperCase() === 'PM';
  if (h < 1 || h > 12) return s;
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return String(h).padStart(2, '0') + ':' + min;
}

/** 12-hour display: 9:00 AM, 2:30 PM */
function to12h(t) {
  const s24 = to24h(t);
  const p = parseTime24(s24);
  if (!p) return String(t || '').trim();
  const pm = p.h >= 12;
  let h12 = p.h % 12;
  if (h12 === 0) h12 = 12;
  const min = String(p.min).padStart(2, '0');
  return h12 + ':' + min + ' ' + (pm ? 'PM' : 'AM');
}

module.exports = {
  to24h,
  to12h,
  parseTime24,
};
