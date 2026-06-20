/**
 * Google Sheets date cells: numeric serial + dd/mm/yyyy display (not US text dates).
 */

const TZ = process.env.SHEETS_CONV_DATETIME_TZ || 'Asia/Kolkata';

const SHEET_DD_MM_YYYY_NUMBER_FORMAT = { type: 'DATE', pattern: 'dd/mm/yyyy' };

function isoCalendarDayOk(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  const y = Math.trunc(year);
  const mo = Math.trunc(month);
  const d = Math.trunc(day);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === mo - 1 &&
    probe.getUTCDate() === d
  );
}

function conversationRowYmdInSheetTz(epochMs) {
  if (!Number.isFinite(epochMs)) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(epochMs));
  } catch {
    return '';
  }
}

/** Google Sheets serial (days since 1899-12-30) for calendar Y-M-D. */
function googleSheetsSerialFromIsoYmd(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isoCalendarDayOk(y, mo, d)) return null;
  const epoch = Date.UTC(1899, 11, 30, 0, 0, 0);
  return (Date.UTC(y, mo - 1, d, 12, 0, 0) - epoch) / 86400000;
}

function googleSheetsSerialFromEpochMs(epochMs) {
  if (!Number.isFinite(epochMs)) return null;
  const ymd = conversationRowYmdInSheetTz(epochMs);
  return ymd ? googleSheetsSerialFromIsoYmd(ymd) : null;
}

function parseDateCellToMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 600000) {
    const ms = Math.round((Math.floor(raw) - 25569) * 86400000) + 43200000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return NaN;

  const serialOnly = /^\d{5,6}(?:\.\d+)?$/.exec(s);
  if (serialOnly) {
    const ms = Math.round((Math.floor(parseFloat(serialOnly[0])) - 25569) * 86400000) + 43200000;
    if (!Number.isNaN(new Date(ms).getTime())) return ms;
  }

  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDay) {
    return Date.UTC(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]), 12, 0, 0);
  }

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]((?:\d{2})|(?:\d{4}))\b/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y >= 0 && y < 100) y += y >= 70 ? 1900 : 2000;
    if (dd >= 1 && dd <= 31 && mo >= 1 && mo <= 12) {
      return Date.UTC(y, mo - 1, dd, 12, 0, 0);
    }
  }

  const t = Date.parse(s.replace(/,/g, ''));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Conv. Date / App. Date cell value for Sheets API (numeric serial preferred).
 * @param {Date|string|number} [d]
 * @returns {number|string}
 */
function formatConversationDateForSheet(d = new Date()) {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const ser = googleSheetsSerialFromEpochMs(d.getTime());
    return ser != null ? ser : '';
  }
  const ms = parseDateCellToMs(d);
  if (Number.isFinite(ms)) {
    const ser = googleSheetsSerialFromEpochMs(ms);
    return ser != null ? ser : '';
  }
  return '';
}

/** DD/MM/YYYY text (fallback display / logs). */
function formatDateDdMmYyyySlash(d = new Date()) {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(dt);
  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  return `${map.day}/${map.month}/${map.year}`;
}

module.exports = {
  SHEET_DD_MM_YYYY_NUMBER_FORMAT,
  formatConversationDateForSheet,
  formatDateDdMmYyyySlash,
  parseDateCellToMs,
  conversationRowYmdInSheetTz,
  googleSheetsSerialFromEpochMs,
};
