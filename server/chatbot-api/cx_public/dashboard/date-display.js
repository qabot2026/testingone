/** DD/MM/YYYY helpers for dashboard pages (same as public/widget/date-display.js). */
(function (global) {
  'use strict';
  if (global.QADateDisplay) return;

  var ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DMY_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isoCalendarDayOk(year, month, day) {
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
      if (!isoCalendarDayOk(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return '';
      return iso[1] + '-' + iso[2] + '-' + iso[3];
    }
    var dmy = DMY_RE.exec(s);
    if (dmy) {
      if (!isoCalendarDayOk(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))) return '';
      return dmy[3] + '-' + pad2(dmy[2]) + '-' + pad2(dmy[1]);
    }
    return '';
  }

  function isoYmdToDdMmYyyy(raw) {
    var iso = parseToIsoYmd(raw);
    if (!iso) return String(raw == null ? '' : raw).trim();
    var m = ISO_YMD_RE.exec(iso);
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function formatDateDisplay(raw) {
    return isoYmdToDdMmYyyy(raw) || String(raw == null ? '' : raw).trim();
  }

  global.QADateDisplay = {
    parseToIsoYmd: parseToIsoYmd,
    isoYmdToDdMmYyyy: isoYmdToDdMmYyyy,
    formatDateDisplay: formatDateDisplay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
