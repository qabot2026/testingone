/**
 * Outbound mail — Resend API (HTTPS) or SMTP.
 */

const emailIntegrationStore = require('./email-integration-store');

let transporterPromise = null;
let transporterKey = '';

function configKey(smtp) {
  const s = smtp || {};
  return [s.host, s.port, s.user, s.password, s.fromEmail, s.secure].join('|');
}

function createSmtpTransport(nodemailer, smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
    requireTLS: !smtp.secure && smtp.port === 587,
    family: 4,
    pool: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 25000,
  });
}

async function getSmtpTransport(smtp) {
  const key = configKey(smtp);
  if (transporterPromise && transporterKey === key) return transporterPromise;

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    throw new Error('nodemailer is not installed on the server');
  }

  transporterKey = key;
  transporterPromise = createSmtpTransport(nodemailer, smtp);
  return transporterPromise;
}

function resetSmtpPool() {
  transporterPromise = null;
  transporterKey = '';
}

function smtpErrorHint(errMsg, smtp) {
  const msg = String(errMsg || '');
  if (!/timeout|ETIMEDOUT|ECONNREFUSED|wrong version number/i.test(msg)) return msg;

  if (smtp.port === 587 && smtp.secure) {
    return (
      msg +
      ' — Port 587 needs SSL/TLS unchecked. Or switch to Resend API (works on Railway Hobby).'
    );
  }

  return (
    msg +
    ' — Your Gmail password is likely fine. Railway Hobby/Trial/Free blocks outbound SMTP (ports 587/465). ' +
    'Use Email integration → Resend API, or upgrade to Railway Pro and redeploy. ' +
    'Local/dev SMTP still works.'
  );
}

async function sendViaResend(resend, mail) {
  const fromName = resend.fromName || 'Chatbot Leads';
  const fromEmail = resend.fromEmail;
  const payload = {
    from: `"${fromName}" <${fromEmail}>`,
    to: mail.to,
    subject: mail.subject,
  };
  if (mail.html) payload.html = mail.html;
  if (mail.text) payload.text = mail.text;
  if (mail.replyTo) payload.reply_to = mail.replyTo;
  if (mail.cc && mail.cc.length) payload.cc = mail.cc;
  if (mail.bcc && mail.bcc.length) payload.bcc = mail.bcc;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + resend.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (body && body.message) ||
      (body && body.error) ||
      (typeof body === 'string' ? body : '') ||
      'Resend API error HTTP ' + res.status;
    return { ok: false, error: detail };
  }
  return { ok: true, messageId: body && body.id, provider: 'resend' };
}

async function sendViaSmtp(resolved, mail) {
  const smtp = resolved.smtp;
  const attempts = [
    smtp,
    smtp.port === 587 && !smtp.secure
      ? { ...smtp, port: 465, secure: true }
      : null,
  ].filter(Boolean);

  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const cfg = attempts[i];
    try {
      if (i > 0) resetSmtpPool();
      const transport = await getSmtpTransport(cfg);
      const info = await transport.sendMail({
        from: `"${cfg.fromName || 'Chatbot Leads'}" <${cfg.fromEmail || cfg.user}>`,
        to: mail.to.join(', '),
        cc: mail.cc && mail.cc.length ? mail.cc.join(', ') : undefined,
        bcc: mail.bcc && mail.bcc.length ? mail.bcc.join(', ') : undefined,
        replyTo: mail.replyTo || undefined,
        subject: mail.subject,
        text: mail.text || undefined,
        html: mail.html || undefined,
      });
      return { ok: true, messageId: info && info.messageId, provider: 'smtp' };
    } catch (err) {
      lastErr = err;
      resetSmtpPool();
    }
  }

  const msg = String((lastErr && lastErr.message) || 'Send failed');
  return { ok: false, error: smtpErrorHint(msg, smtp) };
}

function isConfigured() {
  return emailIntegrationStore.resolveOutboundConfig().ok;
}

async function sendMail(opts) {
  const resolved = emailIntegrationStore.resolveOutboundConfig();
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || 'Email not configured' };
  }

  const toList = []
    .concat(opts.to || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (!toList.length) return { ok: false, error: 'No recipients' };

  const ccList = []
    .concat(opts.cc || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  const bccList = []
    .concat(opts.bcc || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean);

  const subject = String(opts.subject || '').trim() || 'Lead notification';
  const text = String(opts.text || '').trim();
  const html = String(opts.html || '').trim();
  const mail = {
    to: toList,
    cc: ccList,
    bcc: bccList,
    subject,
    text: text || undefined,
    html: html || undefined,
    replyTo: resolved.replyTo || undefined,
  };

  try {
    if (resolved.provider === 'resend') {
      return await sendViaResend(resolved.resend, mail);
    }
    return await sendViaSmtp(resolved, mail);
  } catch (err) {
    resetSmtpPool();
    const msg = String(err.message || 'Send failed');
    console.warn('[email-sender]', msg);
    return {
      ok: false,
      error:
        resolved.provider === 'smtp' ? smtpErrorHint(msg, resolved.smtp) : msg,
    };
  }
}

async function sendTest(to, opts) {
  const botName = String((opts && opts.botName) || '').trim();
  const forLine = botName ? ` for Agent — ${botName}.` : '.';
  const text =
    'This is a test message from your chatbot dashboard email integration' + forLine;
  const htmlBot = botName
    ? ` for <strong>Agent — ${botName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong>.`
    : '.';
  const html =
    '<p>This is a <strong>test message</strong> from your chatbot dashboard email integration' +
    htmlBot +
    '</p>';
  const subject = botName
    ? `Chatbot email test — ${botName}`
    : 'Chatbot email integration test';
  return sendMail({ to: [to], subject, text, html });
}

module.exports = {
  isConfigured,
  sendMail,
  sendTest,
};
