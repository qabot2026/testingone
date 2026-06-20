/**
 * HTML + plain-text templates for lead notification emails.
 */

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailShell(title, bodyHtml) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">' +
    '<tr><td style="padding:24px 28px 8px;font-size:18px;font-weight:600;color:#0f172a;">' +
    escHtml(title) +
    '</td></tr>' +
    '<tr><td style="padding:8px 28px 28px;font-size:14px;line-height:1.6;color:#334155;">' +
    bodyHtml +
    '</td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

function detailRow(label, value) {
  return (
    '<tr>' +
    '<td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;width:120px;vertical-align:top;">' +
    escHtml(label) +
    '</td>' +
    '<td style="padding:8px 0 8px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;">' +
    escHtml(value || '—') +
    '</td></tr>'
  );
}

/**
 * Instant alert when a visitor leaves mobile or email.
 * @param {{ botName: string, name: string, mobile: string, email: string, channel: string, sessionId: string }} data
 */
function instantLeadCaptured(data) {
  const botName = String((data && data.botName) || 'Chatbot').trim();
  const name = String((data && data.name) || 'Visitor').trim() || 'Visitor';
  const mobile = String((data && data.mobile) || '').trim();
  const email = String((data && data.email) || '').trim();
  const channel = String((data && data.channel) || 'Web').trim();
  const sessionId = String((data && data.sessionId) || '').trim();

  const subject = `${botName} — new lead: ${name}`;
  const bodyHtml =
    '<p style="margin:0 0 16px;">A new lead was captured on <strong>' +
    escHtml(botName) +
    '</strong>.</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">' +
    detailRow('Name', name) +
    detailRow('Mobile', mobile) +
    detailRow('Email', email) +
    detailRow('Channel', channel) +
    detailRow('Session', sessionId) +
    '</table>' +
    '<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">Sent automatically when contact details are saved.</p>';

  const html = emailShell('New lead captured', bodyHtml);
  const text = [
    `New lead captured — ${botName}`,
    '',
    `Name: ${name}`,
    `Mobile: ${mobile || '—'}`,
    `Email: ${email || '—'}`,
    `Channel: ${channel}`,
    `Session: ${sessionId}`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  escHtml,
  instantLeadCaptured,
};
