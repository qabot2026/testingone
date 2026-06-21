/**
 * Per-upload folder names in GCS (Only Refer pattern).
 * With mobile: {digits}_{dd}_{mm}_{yyyy}_{n}
 */

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatSubmissionFolderDate(d, timeZone) {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const tz =
    timeZone ||
    process.env.CONTACT_FORM_SUBMISSION_TZ ||
    process.env.SHEETS_CONV_DATETIME_TZ ||
    'Asia/Kolkata';
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(dt)
    .forEach((p) => {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
  return `${parts.day || '01'}_${parts.month || '01'}_${parts.year || '1970'}`;
}

function normalizeMobileDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length ? d : '';
}

function mobileDigitsWithCountry(mobile, dialCode) {
  const local = normalizeMobileDigits(mobile);
  if (!local) return '';
  const dial = normalizeMobileDigits(dialCode);
  if (dial && local.length === 10 && !local.startsWith(dial)) {
    return dial + local;
  }
  if (local.length >= 11) return local;
  if (dial) return dial + local;
  if (local.length === 10) return '91' + local;
  return local;
}

function nextMobileSubmissionFolderName(digits, folderNames, dateLabel) {
  const ranks = new Set();
  const re = new RegExp(
    `^${escapeRegExp(digits)}_${escapeRegExp(dateLabel)}_(\\d+)$`
  );
  folderNames.forEach((n) => {
    const m = String(n).match(re);
    if (m) {
      const r = parseInt(m[1], 10);
      if (!Number.isNaN(r)) ranks.add(r);
    }
  });
  const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
  const seq = String(nextRank).padStart(2, '0');
  return `${digits}_${dateLabel}_${seq}`;
}

function sanitizeSessionFolderBase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || '';
}

function nextSessionSubmissionFolderName(sessionBase, folderNames, dateLabel) {
  if (!sessionBase) return `unknown_${dateLabel}_01`;
  const ranks = new Set();
  const esc = escapeRegExp(sessionBase);
  const escD = escapeRegExp(dateLabel);
  const reNew = new RegExp(`^${esc}__${escD}_(\\d+)$`);
  folderNames.forEach((n) => {
    const m = String(n).match(reNew);
    if (m) {
      const r = parseInt(m[1], 10);
      if (!Number.isNaN(r)) ranks.add(r);
    }
  });
  const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
  const seq = String(nextRank).padStart(2, '0');
  return `${sessionBase}__${dateLabel}_${seq}`;
}

function nextSubmissionFolderName({ mobile, dialCode, clientSessionId, folderNames, submittedAt }) {
  const dateLabel = formatSubmissionFolderDate(submittedAt);
  const digits = mobileDigitsWithCountry(mobile, dialCode);
  if (digits) {
    return nextMobileSubmissionFolderName(digits, folderNames, dateLabel);
  }
  const sessionBase = sanitizeSessionFolderBase(clientSessionId);
  if (sessionBase) {
    return nextSessionSubmissionFolderName(sessionBase, folderNames, dateLabel);
  }
  return `unknown_${dateLabel}_01`;
}

function sanitizeFilename(name) {
  const base = String(name || 'file').replace(/[/\\]/g, '_').replace(/\0/g, '');
  return base.slice(0, 200) || 'file';
}

module.exports = {
  formatSubmissionFolderDate,
  normalizeMobileDigits,
  mobileDigitsWithCountry,
  nextSubmissionFolderName,
  sanitizeFilename,
};
