/**
 * Lead notification emails — report building and send helpers.
 */

const conversationsSheetView = require('./conversations-sheet-view');
const emailSender = require('./email-sender');
const emailNotificationsMail = require('./email-notifications-mail');
const emailTemplateEngine = require('./email-template-engine');
const leadNotificationsStore = require('./lead-notifications-store');
const sitePresetsStore = require('./site-presets-store');

const WEEKDAY_TO_JS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || leadNotificationsStore.DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '';
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: parseInt(get('hour'), 10) || 0,
    minute: parseInt(get('minute'), 10) || 0,
    weekday: get('weekday'),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function previousWeekRangeMonSun(todayYmd) {
  const [y, m, d] = todayYmd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const thisMonday = addDaysYmd(todayYmd, -daysSinceMonday);
  const prevMonday = addDaysYmd(thisMonday, -7);
  const prevSunday = addDaysYmd(thisMonday, -1);
  return { from: prevMonday, to: prevSunday };
}

function rowIsLead(row) {
  if (!row || typeof row !== 'object') return false;
  const mobile = String(row.Mobile || row.mobile || '').trim();
  const email = String(row.Email || row.email || '').trim();
  return !!(mobile || email);
}

const escHtml = require('./email-template-engine').escHtml;

function formatLeadRowsHtml(rows) {
  if (!rows.length) {
    return '<p>No leads with mobile or email in this period.</p>';
  }
  const head =
    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">' +
    '<thead><tr><th>Date</th><th>Time</th><th>Name</th><th>Mobile</th><th>Email</th><th>Channel</th></tr></thead><tbody>';
  const body = rows
    .map((r) => {
      return (
        '<tr><td>' +
        escHtml(r['Conv. Date'] || '') +
        '</td><td>' +
        escHtml(r['Conv. Time'] || '') +
        '</td><td>' +
        escHtml(r.Name || '') +
        '</td><td>' +
        escHtml(r.Mobile || '') +
        '</td><td>' +
        escHtml(r.Email || '') +
        '</td><td>' +
        escHtml(r.Channel || '') +
        '</td></tr>'
      );
    })
    .join('');
  return head + body + '</tbody></table>';
}

function formatLeadRowsText(rows) {
  if (!rows.length) return 'No leads with mobile or email in this period.';
  return rows
    .map((r) => {
      return [
        r['Conv. Date'] || '',
        r['Conv. Time'] || '',
        r.Name || '',
        r.Mobile || '',
        r.Email || '',
        r.Channel || '',
      ].join(' | ');
    })
    .join('\n');
}

async function fetchLeadRows(botId, fromIso, toIso) {
  const preview = await conversationsSheetView.fetchConversationSheetPreview({
    botId,
    from: fromIso,
    to: toIso,
    maxRows: 5000,
    allInRange: true,
    includeStats: false,
  });
  const rows = preview.conversations || [];
  return rows.filter(rowIsLead);
}

async function sendDailyReport(botId, cfg, reportDateYmd, opts) {
  const skipMark = opts && opts.skipMark;
  const mail = leadNotificationsStore.getReportMailRecipients(cfg);
  if (!leadNotificationsStore.hasMailTo(mail)) {
    return { ok: false, error: 'No daily report To recipients' };
  }
  const project = sitePresetsStore.resolveProject(botId);
  const botName = (project && project.name) || botId;
  const rows = await fetchLeadRows(botId, reportDateYmd, reportDateYmd);
  const label = reportDateYmd;
  const subject = `${botName} — daily lead report (${label})`;
  const html =
    `<p>Daily lead report for <strong>${escHtml(botName)}</strong> — ${escHtml(label)}</p>` +
    `<p>${rows.length} lead(s) with mobile or email.</p>` +
    formatLeadRowsHtml(rows);
  const text =
    `Daily lead report for ${botName} — ${label}\n` +
    `${rows.length} lead(s)\n\n` +
    formatLeadRowsText(rows);
  const sent = await emailSender.sendMail({
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject,
    html,
    text,
  });
  if (sent.ok && !skipMark) leadNotificationsStore.markDailySent(botId, label);
  return sent;
}

async function sendWeeklyReport(botId, cfg, fromIso, toIso, weekKey, opts) {
  const skipMark = opts && opts.skipMark;
  const mail = leadNotificationsStore.getReportMailRecipients(cfg);
  if (!leadNotificationsStore.hasMailTo(mail)) {
    return { ok: false, error: 'No weekly report To recipients' };
  }
  const project = sitePresetsStore.resolveProject(botId);
  const botName = (project && project.name) || botId;
  const rows = await fetchLeadRows(botId, fromIso, toIso);
  const subject = `${botName} — weekly lead report (${fromIso} to ${toIso})`;
  const html =
    `<p>Weekly lead report for <strong>${escHtml(botName)}</strong><br>` +
    `Period: ${escHtml(fromIso)} to ${escHtml(toIso)} (Monday–Sunday)</p>` +
    `<p>${rows.length} lead(s) with mobile or email.</p>` +
    formatLeadRowsHtml(rows);
  const text =
    `Weekly lead report for ${botName}\n` +
    `Period: ${fromIso} to ${toIso}\n` +
    `${rows.length} lead(s)\n\n` +
    formatLeadRowsText(rows);
  const sent = await emailSender.sendMail({
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject,
    html,
    text,
  });
  if (sent.ok && !skipMark) leadNotificationsStore.markWeeklySent(botId, weekKey);
  return sent;
}

async function sendInstantLead(botId, meta, sessionId, opts) {
  const skipMark = opts && opts.skipMark;
  const cfg = leadNotificationsStore.getRawBotStored(botId).instantLead;
  if (!cfg || !cfg.enabled) return { ok: false, skipped: true, reason: 'disabled' };
  if (leadNotificationsStore.wasInstantSent(botId, sessionId)) {
    return { ok: false, skipped: true, reason: 'already_sent' };
  }
  const mobile = String((meta && meta.mobile) || '').trim();
  const email = String((meta && meta.email) || '').trim();
  if (!mobile && !email) return { ok: false, skipped: true, reason: 'no_contact' };

  const templateKey = emailTemplateEngine.pickLeadTemplateKey(meta);
  const delivery = leadNotificationsStore.getTemplateDelivery(botId, templateKey);
  if (delivery.enabled === false) {
    return { ok: false, skipped: true, reason: 'delivery_disabled' };
  }
  const recipients = leadNotificationsStore.getClientMailRecipients(botId, templateKey);
  if (!leadNotificationsStore.hasMailTo(recipients)) {
    return { ok: false, error: 'No To recipients for ' + templateKey };
  }

  const sent = await emailNotificationsMail.sendLeadNotification(botId, meta, sessionId, opts);
  if (sent.ok && !skipMark) leadNotificationsStore.markInstantSent(botId, sessionId);
  return sent;
}

function timeMatches(nowParts, timeStr) {
  const m = String(timeStr || '10:00').match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  return nowParts.hour === parseInt(m[1], 10) && nowParts.minute === parseInt(m[2], 10);
}

function weekdayMatches(nowParts, dayOfWeek) {
  const jsDay = WEEKDAY_TO_JS[nowParts.weekday];
  if (jsDay == null) return false;
  return jsDay === Number(dayOfWeek);
}

module.exports = {
  zonedParts,
  addDaysYmd,
  previousWeekRangeMonSun,
  fetchLeadRows,
  sendDailyReport,
  sendWeeklyReport,
  sendInstantLead,
  timeMatches,
  weekdayMatches,
};
