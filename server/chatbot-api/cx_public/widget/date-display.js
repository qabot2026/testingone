/**
 * DD/MM/YYYY date helpers (browser) — load before chat-form.js.
 */
(function (global) {
  'use strict';

  var ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DMY_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isoCalendarDayOk(year, month, day) {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return false;
    }
    var y = Math.trunc(year);
    var mo = Math.trunc(month);
    var d = Math.trunc(day);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    var probe = new Date(y, mo - 1, d, 12, 0, 0);
    return (
      probe.getFullYear() === y &&
      probe.getMonth() === mo - 1 &&
      probe.getDate() === d
    );
  }

  function parseToIsoYmd(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';

    var iso = ISO_YMD_RE.exec(s);
    if (iso) {
      var y = Number(iso[1]);
      var mo = Number(iso[2]);
      var d = Number(iso[3]);
      if (!isoCalendarDayOk(y, mo, d)) return '';
      return iso[1] + '-' + iso[2] + '-' + iso[3];
    }

    var dmy = DMY_RE.exec(s);
    if (dmy) {
      var dd = Number(dmy[1]);
      var mo2 = Number(dmy[2]);
      var y2 = Number(dmy[3]);
      if (!isoCalendarDayOk(y2, mo2, dd)) return '';
      return y2 + '-' + pad2(mo2) + '-' + pad2(dd);
    }

    return '';
  }

  function isoYmdToDdMmYyyy(raw) {
    var iso = parseToIsoYmd(raw);
    if (!iso) return String(raw == null ? '' : raw).trim();
    var m = ISO_YMD_RE.exec(iso);
    if (!m) return String(raw || '').trim();
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function formatDateDisplay(raw) {
    var dmy = isoYmdToDdMmYyyy(raw);
    return dmy || String(raw == null ? '' : raw).trim();
  }

  function formatDateFromMs(epochMs, tz) {
    if (!Number.isFinite(epochMs)) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || undefined,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).formatToParts(new Date(epochMs));
      var map = {};
      parts.forEach(function (p) {
        if (p.type !== 'literal') map[p.type] = p.value;
      });
      if (map.day && map.month && map.year) {
        return map.day + '/' + map.month + '/' + map.year;
      }
    } catch (e) {
      /* ignore */
    }
    return isoYmdToDdMmYyyy(new Date(epochMs).toISOString().slice(0, 10));
  }

  global.QADateDisplay = {
    parseToIsoYmd: parseToIsoYmd,
    isoYmdToDdMmYyyy: isoYmdToDdMmYyyy,
    formatDateDisplay: formatDateDisplay,
    formatDateFromMs: formatDateFromMs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
