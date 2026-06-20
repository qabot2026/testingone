/**
 * Calendar display: DD/MM/YYYY everywhere user-facing.
 * Internal APIs may still use ISO YYYY-MM-DD — use parseToIsoYmd / isoYmdToDdMmYyyy to convert.
 */

const ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoCalendarDayOk(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  const y = Math.trunc(year);
  const mo = Math.trunc(month);
  const d = Math.trunc(day);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, mo - 1, d, 12, 0, 0);
  return (
    probe.getFullYear() === y &&
    probe.getMonth() === mo - 1 &&
    probe.getDate() === d
  );
}

/** Parse ISO or DD/MM/YYYY (also DD-MM-YYYY) → YYYY-MM-DD, or '' if invalid. */
function parseToIsoYmd(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';

  const iso = ISO_YMD_RE.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (!isoCalendarDayOk(y, mo, d)) return '';
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const dmy = DMY_RE.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (!isoCalendarDayOk(y, mo, dd)) return '';
    return `${y}-${pad2(mo)}-${pad2(dd)}`;
  }

  return '';
}

/** YYYY-MM-DD (or parseable date) → DD/MM/YYYY. */
function isoYmdToDdMmYyyy(raw) {
  const iso = parseToIsoYmd(raw);
  if (!iso) return String(raw == null ? '' : raw).trim();
  const m = ISO_YMD_RE.exec(iso);
  if (!m) return String(raw || '').trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** User-facing date string (always DD/MM/YYYY when parseable). */
function formatDateDisplay(raw) {
  const dmy = isoYmdToDdMmYyyy(raw);
  return dmy || String(raw == null ? '' : raw).trim();
}

/** Format Date or epoch ms as DD/MM/YYYY in optional IANA timezone. */
function formatDateFromMs(epochMs, tz) {
  if (!Number.isFinite(epochMs)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || undefined,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(new Date(epochMs));
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    if (map.day && map.month && map.year) {
      return `${map.day}/${map.month}/${map.year}`;
    }
  } catch {
    /* fall through */
  }
  return isoYmdToDdMmYyyy(new Date(epochMs).toISOString().slice(0, 10));
}

module.exports = {
  parseToIsoYmd,
  isoYmdToDdMmYyyy,
  formatDateDisplay,
  formatDateFromMs,
  ISO_YMD_RE,
  DMY_RE,
};
