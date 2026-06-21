/**
 * Send templated notification emails (client + user audiences).
 */

const emailSender = require('./email-sender');
const emailTemplateEngine = require('./email-template-engine');
const emailTemplatesStore = require('./email-templates-store');
const leadNotificationsStore = require('./lead-notifications-store');

function sampleMeta(overrides) {
  return Object.assign(
    {
      name: 'Sample Visitor',
      mobile: '+91 98765 43210',
      email: 'visitor@example.com',
      channel: 'Web',
      city: 'Mumbai',
      repeatedUserLabel: 'First Time',
      sourceUrl: 'https://example.com',
      appointmentDateDisplay: '20/06/2026',
      appointmentTimeDisplay: '11:00 AM',
    },
    overrides || {}
  );
}

async function sendTemplated(botId, templateKey, sessionId, meta, opts) {
  const skipMark = opts && opts.skipMark;
  const tplResult = emailTemplatesStore.getTemplateForSend(botId, templateKey);
  if (!tplResult.ok) return tplResult;
  const tpl = tplResult.template;
  if (!tpl.enabled) return { ok: false, skipped: true, reason: 'template_disabled' };

  const audience = emailTemplateEngine.templateAudience(templateKey);
  let recipients = { to: [], cc: [], bcc: [] };

  if (audience === 'user') {
    const email = String((meta && meta.email) || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, skipped: true, reason: 'no_visitor_email' };
    }
    recipients = { to: [email], cc: [], bcc: [] };
  } else {
    const delivery = leadNotificationsStore.getTemplateDelivery(botId, templateKey);
    if (delivery.enabled === false) {
      return { ok: false, skipped: true, reason: 'delivery_disabled' };
    }
    recipients = leadNotificationsStore.getClientMailRecipients(botId, templateKey);
    if (!leadNotificationsStore.hasMailTo(recipients)) {
      return {
        ok: false,
        error: 'No To recipients — set under Email Notifications → ' + templateKey,
      };
    }
  }

  const rendered = emailTemplateEngine.renderTemplate(tpl, {
    botId,
    sessionId,
    meta: meta || {},
  });

  const sent = await emailSender.sendMail({
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (sent.ok && !skipMark) {
    emailTemplatesStore.markSent(botId, templateKey, sessionId);
  }

  const toLabel = recipients.to.join(', ');
  return {
    ...sent,
    templateKey,
    subject: rendered.subject,
    to: toLabel,
    cc: (recipients.cc || []).join(', '),
    bcc: (recipients.bcc || []).join(', '),
  };
}

async function sendLeadNotification(botId, meta, sessionId, opts) {
  const templateKey = emailTemplateEngine.pickLeadTemplateKey(meta);
  return sendTemplated(botId, templateKey, sessionId, meta, opts);
}

async function sendAppointmentBookedNotifications(botId, meta, sessionId, opts) {
  const skipMark = opts && opts.skipMark;
  const results = [];

  if (!skipMark && emailTemplatesStore.wasSent(botId, 'appointmentClient', sessionId)) {
    results.push({ templateKey: 'appointmentClient', skipped: true, reason: 'already_sent' });
  } else {
    results.push(await sendTemplated(botId, 'appointmentClient', sessionId, meta, opts));
  }

  if (!skipMark && emailTemplatesStore.wasSent(botId, 'appointmentUserReceived', sessionId)) {
    results.push({
      templateKey: 'appointmentUserReceived',
      skipped: true,
      reason: 'already_sent',
    });
  } else {
    results.push(await sendTemplated(botId, 'appointmentUserReceived', sessionId, meta, opts));
  }

  const anyOk = results.some((r) => r.ok);
  return { ok: anyOk, results };
}

async function sendAppointmentConfirmedNotification(botId, meta, sessionId, opts) {
  const skipMark = opts && opts.skipMark;
  if (!skipMark && emailTemplatesStore.wasSent(botId, 'appointmentUserConfirmed', sessionId)) {
    return { ok: false, skipped: true, reason: 'already_sent' };
  }
  return sendTemplated(botId, 'appointmentUserConfirmed', sessionId, meta, opts);
}

async function sendTemplateTest(botId, templateKey, to, metaOverride) {
  const toEmail = String(to || '').trim();
  if (!toEmail) return { ok: false, error: 'Test recipient required' };

  const tplResult = emailTemplatesStore.getTemplateForSend(botId, templateKey);
  if (!tplResult.ok) return tplResult;

  let meta = sampleMeta();
  if (templateKey === 'hotLead') {
    meta = sampleMeta({ repeatedUserLabel: 'Repeated', name: 'Returning Visitor' });
  } else if (
    templateKey === 'appointmentClient' ||
    templateKey === 'appointmentUserReceived' ||
    templateKey === 'appointmentUserConfirmed'
  ) {
    meta = sampleMeta({ name: 'Appointment Guest' });
  }
  Object.assign(meta, metaOverride || {});

  const rendered = emailTemplateEngine.renderTemplate(tplResult.template, {
    botId,
    sessionId: 'test-session-00001',
    meta,
  });

  return emailSender.sendMail({
    to: [toEmail],
    subject: '[TEST] ' + rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

module.exports = {
  sendLeadNotification,
  sendAppointmentBookedNotifications,
  sendAppointmentConfirmedNotification,
  sendTemplateTest,
  sendTemplated,
};
