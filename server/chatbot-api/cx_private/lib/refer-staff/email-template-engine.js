/**
 * Email template defaults, variable context, and rendering.
 * Templates are plain text; HTML is generated automatically when sending.
 */

const appEnv = require('./app-env');
const emailIntegrationStore = require('./email-integration-store');
const sitePresetsStore = require('./site-presets-store');
const sheets = require('./sheets');

const TEMPLATE_KEYS = [
  'leadCapture',
  'hotLead',
  'appointmentClient',
  'appointmentUserReceived',
  'appointmentUserConfirmed',
];

/** client = Email Notifications recipients; user = visitor email ($session.params.email) */
const TEMPLATE_META = {
  leadCapture: { audience: 'client', label: 'Lead capture (first-time visitor)' },
  hotLead: { audience: 'client', label: 'Hot lead (returning visitor)' },
  appointmentClient: { audience: 'client', label: 'Appointment request (for client)' },
  appointmentUserReceived: { audience: 'user', label: 'Appointment request received (for user)' },
  appointmentUserConfirmed: { audience: 'user', label: 'Appointment confirmed (for user)' },
};

/** When each template fires automatically (for dashboard UI + developer reference). */
const TEMPLATE_TRIGGERS = {
  leadCapture: {
    when: 'Sheet sync when instant lead conditions pass (optional delay). Repeated User = First Time.',
    requires: 'Email Notifications → instantLead enabled + conditions + leadCapture/hotLead recipients',
    hook: 'conversation-sheet → lead-notifications-runner.onConversationSynced',
  },
  hotLead: {
    when: 'Same as lead capture, but Repeated User = Repeated.',
    requires: 'Email Notifications → instantLead enabled + conditions + leadCapture/hotLead recipients',
    hook: 'conversation-sheet → lead-notifications-runner.onConversationSynced',
  },
  appointmentClient: {
    when: 'Visitor books an appointment slot (/api/appointment-book).',
    requires: 'Email Notifications → appointmentClient enabled + recipients',
    hook: 'appointment-book → lead-notifications-runner.onAppointmentBooked',
  },
  appointmentUserReceived: {
    when: 'Same appointment book event — sent to the visitor.',
    requires: 'Email Notifications → template enabled; visitor email in session',
    hook: 'appointment-book → lead-notifications-runner.onAppointmentBooked',
  },
  appointmentUserConfirmed: {
    when: 'Staff accepts appointment in dashboard (appointments action = accept).',
    requires: 'Email Notifications → template enabled; visitor email in session',
    hook: 'appointments/action accept → lead-notifications-runner.onAppointmentConfirmed',
  },
};

const VARIABLE_HINTS = [
  { token: '$session.params.name', desc: 'Visitor name' },
  { token: '$session.params.mobile', desc: 'Mobile number' },
  { token: '$session.params.email', desc: 'Email address' },
  { token: '$session.id', desc: 'Session ID' },
  { token: '$project.name', desc: 'Project / bot display name' },
  { token: '$bot.id', desc: 'Bot ID' },
  { token: '$meta.channel', desc: 'Channel (Web, WhatsApp, …)' },
  { token: '$meta.city', desc: 'Visitor city / location' },
  { token: '$meta.repeatedUser', desc: 'First Time or Repeated' },
  { token: '$meta.sourceUrl', desc: 'Page URL where chat started' },
  { token: '$chatscript.link', desc: 'Conversation transcript link' },
  { token: '$appointment.date', desc: 'Appointment date' },
  { token: '$appointment.time', desc: 'Appointment time' },
  { token: '$company.fromName', desc: 'Sender name (SMTP)' },
  { token: '$company.fromEmail', desc: 'Sender email (SMTP)' },
];

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

function defaultLeadBody(intro) {
  return (
    intro +
    ' for $project.name\n\n' +
    'Name: $session.params.name\n' +
    'Mobile: $session.params.mobile\n' +
    'Email: $session.params.email\n' +
    'Location: $meta.city\n' +
    'Channel: $meta.channel\n' +
    'Repeated: $meta.repeatedUser\n\n' +
    'View conversation: $chatscript.link\n\n' +
    'Session: $session.id'
  );
}

function defaultAppointmentClientBody() {
  return (
    'Appointment request for $project.name\n\n' +
    'Name: $session.params.name\n' +
    'Mobile: $session.params.mobile\n' +
    'Email: $session.params.email\n' +
    'Date: $appointment.date\n' +
    'Time: $appointment.time\n' +
    'Location: $meta.city\n\n' +
    'View conversation: $chatscript.link\n\n' +
    'Session: $session.id'
  );
}

function defaultTemplates() {
  return {
    leadCapture: {
      enabled: true,
      subject: 'New lead — $project.name — $session.params.name',
      body: defaultLeadBody('New lead captured'),
    },
    hotLead: {
      enabled: true,
      subject: 'Hot lead (returning visitor) — $project.name — $session.params.name',
      body: defaultLeadBody('Returning visitor lead'),
    },
    appointmentClient: {
      enabled: true,
      subject: 'Appointment request — $project.name — $session.params.name',
      body: defaultAppointmentClientBody(),
    },
    appointmentUserReceived: {
      enabled: true,
      subject: 'Appointment request received — $project.name',
      body:
        'Dear $session.params.name,\n\n' +
        'We have received your appointment request for $project.name.\n\n' +
        'Date: $appointment.date\n' +
        'Time: $appointment.time\n\n' +
        'We will confirm your appointment shortly.\n\n' +
        'View your conversation: $chatscript.link',
    },
    appointmentUserConfirmed: {
      enabled: true,
      subject: 'Appointment confirmed — $project.name',
      body:
        'Dear $session.params.name,\n\n' +
        'Your appointment at $project.name is confirmed.\n\n' +
        'Date: $appointment.date\n' +
        'Time: $appointment.time\n\n' +
        'We look forward to seeing you.\n\n' +
        'View your conversation: $chatscript.link',
    },
  };
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTemplateShape(stored, defaults) {
  const d = defaults || {};
  const s = stored && typeof stored === 'object' ? stored : {};
  let body = String(s.body || s.bodyText || '').trim();
  if (!body && s.bodyHtml) body = htmlToPlainText(s.bodyHtml);
  if (!body) body = String(d.body || '').trim();
  return {
    enabled: s.enabled != null ? !!s.enabled : d.enabled !== false,
    subject: String(s.subject != null ? s.subject : d.subject || ''),
    body,
  };
}

function textToHtml(plain) {
  const lines = String(plain || '').split('\n');
  const parts = [];
  let para = [];

  function flushPara() {
    if (!para.length) return;
    const inner = para
      .map((line) => {
        const esc = escHtml(line);
        return esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
      })
      .join('<br>');
    parts.push('<p style="margin:0 0 12px;">' + inner + '</p>');
    para = [];
  }

  lines.forEach((line) => {
    if (!String(line).trim()) flushPara();
    else para.push(line);
  });
  flushPara();
  return parts.join('') || '<p style="margin:0;"></p>';
}

function buildVariableMap(opts) {
  const botId = String((opts && opts.botId) || '').trim();
  const sessionId = String((opts && opts.sessionId) || '').trim();
  const meta = (opts && opts.meta) || {};
  const project = sitePresetsStore.resolveProject(botId);
  const smtpView = emailIntegrationStore.publicView();
  const smtp = smtpView.smtp || {};

  const name = String(meta.name || '').trim() || 'Visitor';
  const mobile = String(meta.mobile || '').trim();
  const email = String(meta.email || '').trim();
  const channel = String(meta.channel || 'Web').trim();
  const city = String(meta.city || meta.location || '').trim();
  const repeatedUser = String(meta.repeatedUserLabel || meta.repeatedUser || '').trim();
  const sourceUrl = String(meta.sourceUrl || meta.pageUrl || meta.url || '').trim();
  const apptDate = String(
    meta.appointmentDateDisplay || meta.appointmentdate || meta.appointment_date || ''
  ).trim();
  const apptTime = String(
    meta.appointmentTimeDisplay || meta.appointmenttime || meta.appointment_time || ''
  ).trim();
  const transcriptLink =
    sheets.chatscriptPlainUrl(sessionId) ||
    (appEnv.PUBLIC_BASE_URL
      ? appEnv.PUBLIC_BASE_URL.replace(/\/$/, '') +
        '/conversation-transcript?session=' +
        encodeURIComponent(sessionId)
      : '');

  return {
    'session.params.name': name,
    'session.params.mobile': mobile,
    'session.params.email': email,
    'session.params.channel': channel,
    'session.id': sessionId,
    'project.name': (project && project.name) || botId,
    'bot.name': (project && project.name) || botId,
    'bot.id': botId,
    'meta.channel': channel,
    'meta.city': city,
    'meta.repeatedUser': repeatedUser,
    'meta.sourceUrl': sourceUrl,
    'chatscript.link': transcriptLink,
    'transcript.link': transcriptLink,
    'appointment.date': apptDate,
    'appointment.time': apptTime,
    'company.fromName': smtp.fromName || 'Chatbot Leads',
    'company.fromEmail': smtp.fromEmail || smtp.user || '',
  };
}

function renderString(template, variableMap) {
  let out = String(template || '');
  const keys = Object.keys(variableMap).sort((a, b) => b.length - a.length);
  keys.forEach((key) => {
    const val = variableMap[key] == null ? '' : String(variableMap[key]);
    const re = new RegExp('\\$' + key.replace(/\./g, '\\.') + '(?![a-zA-Z0-9_])', 'g');
    out = out.replace(re, val);
  });
  out = out.replace(/\$session\.params\.([a-zA-Z0-9_]+)(?![a-zA-Z0-9_])/g, (_, k) => {
    const lk = 'session.params.' + k;
    return variableMap[lk] != null ? String(variableMap[lk]) : '';
  });
  return out;
}

function renderTemplate(templateDef, context) {
  const variableMap = buildVariableMap(context);
  const subject = renderString(templateDef.subject, variableMap).trim();
  const bodyText = renderString(templateDef.body, variableMap).trim();
  const title = subject.split('—')[0].trim() || 'Notification';
  const bodyInner = textToHtml(bodyText);
  const html = emailShell(title, bodyInner);

  return { subject, html, text: bodyText, variableMap };
}

function isHotLead(meta) {
  const label = String(
    (meta && (meta.repeatedUserLabel || meta.repeatedUser)) || ''
  )
    .trim()
    .toLowerCase();
  return label === 'repeated' || label.indexOf('repeat') >= 0;
}

function pickLeadTemplateKey(meta) {
  return isHotLead(meta) ? 'hotLead' : 'leadCapture';
}

function templateAudience(templateKey) {
  const meta = TEMPLATE_META[templateKey];
  return (meta && meta.audience) || 'client';
}

function getTemplateCatalog() {
  return TEMPLATE_KEYS.map((key, index) => {
    const meta = TEMPLATE_META[key] || {};
    const trigger = TEMPLATE_TRIGGERS[key] || {};
    return {
      key,
      number: index + 1,
      label: meta.label || key,
      audience: meta.audience || 'client',
      audienceLabel:
        meta.audience === 'user'
          ? 'To: visitor ($session.params.email)'
          : 'To: client (Email Notifications recipients)',
      when: trigger.when || '',
      requires: trigger.requires || '',
      hook: trigger.hook || '',
    };
  });
}

module.exports = {
  TEMPLATE_KEYS,
  TEMPLATE_META,
  TEMPLATE_TRIGGERS,
  VARIABLE_HINTS,
  defaultTemplates,
  normalizeTemplateShape,
  buildVariableMap,
  renderString,
  renderTemplate,
  textToHtml,
  isHotLead,
  pickLeadTemplateKey,
  templateAudience,
  getTemplateCatalog,
  escHtml,
  emailShell,
  htmlToPlainText,
};
