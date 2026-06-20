/**
 * Organization-wide email settings — SMTP or Resend API (HTTPS, works on Railway Hobby).
 */

const fs = require('fs');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');

const FILE_NAME = 'email-integration.json';

function filePath() {
  return clientPaths.emailIntegrationPath();
}

function defaultFileData() {
  return {
    updatedAt: null,
    enabled: false,
    provider: 'smtp',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      fromName: 'Chatbot Leads',
      fromEmail: '',
    },
    resend: {
      enabled: false,
      apiKey: '',
      fromName: 'Chatbot Leads',
      fromEmail: '',
    },
    replyTo: '',
    testRecipient: '',
  };
}

function readFile_() {
  const p = filePath();
  if (!fs.existsSync(p)) return defaultFileData();
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      ...defaultFileData(),
      ...data,
      smtp: { ...defaultFileData().smtp, ...(data.smtp || {}) },
      resend: { ...defaultFileData().resend, ...(data.resend || {}) },
    };
  } catch (err) {
    console.warn('[email-integration] read failed:', err.message);
    return defaultFileData();
  }
}

function writeFile_(data) {
  const p = filePath();
  fs.mkdirSync(clientPaths.dataDir(), { recursive: true });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  dataFileSync.scheduleSync(FILE_NAME);
}

function normalizeSmtpPassword(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '');
}

function normalizeSmtpTransport(smtp) {
  const raw = smtp && typeof smtp === 'object' ? smtp : {};
  const port = Number(raw.port) || 587;
  const secure = port === 465 ? true : port === 587 || port === 25 ? false : !!raw.secure;
  return {
    host: String(raw.host || '').trim(),
    port,
    secure,
    user: String(raw.user || '').trim(),
    password: normalizeSmtpPassword(raw.password),
    fromName: String(raw.fromName || 'Chatbot Leads').trim(),
    fromEmail: String(raw.fromEmail || raw.user || '').trim(),
  };
}

function envSmtp() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = normalizeSmtpPassword(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '');
  if (!host || !user || !pass) return null;
  return normalizeSmtpTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587) || 587,
    secure: String(process.env.SMTP_SECURE || '').trim() === '1',
    user,
    password: pass,
    fromName: String(process.env.SMTP_FROM_NAME || 'Chatbot Leads').trim(),
    fromEmail: String(process.env.SMTP_FROM_EMAIL || user).trim(),
  });
}

function envResend() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || '').trim();
  if (!apiKey || !fromEmail) return null;
  return {
    apiKey,
    fromName: String(process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || 'Chatbot Leads').trim(),
    fromEmail,
  };
}

function maskSecret(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

function publicView(raw) {
  const data = raw && typeof raw === 'object' ? raw : readFile_();
  const envS = envSmtp();
  const envR = envResend();
  const smtp = normalizeSmtpTransport(data.smtp || {});
  const resend = data.resend || {};
  const provider = envR ? 'resend' : envS ? 'smtp' : data.provider === 'resend' ? 'resend' : 'smtp';

  return {
    ok: true,
    updatedAt: data.updatedAt || null,
    enabled: !!(data.enabled || envS || envR),
    provider,
    source: envR ? 'resend-env' : envS ? 'smtp-env' : 'file',
    railwayHint:
      'On Railway Hobby/Trial/Free plans, outbound SMTP (ports 587/465) is blocked — use Resend API below or upgrade to Railway Pro.',
    smtp: {
      host: envS ? envS.host : smtp.host,
      port: envS ? envS.port : smtp.port,
      secure: envS ? envS.secure : smtp.secure,
      user: envS ? envS.user : smtp.user,
      passwordSet: !!(envS ? envS.password : smtp.password),
      passwordHint: maskSecret(envS ? envS.password : smtp.password),
      fromName: envS ? envS.fromName : smtp.fromName,
      fromEmail: envS ? envS.fromEmail : smtp.fromEmail,
    },
    resend: {
      enabled: !!(envR || (provider === 'resend' && data.enabled && resend.enabled !== false)),
      apiKeySet: !!(envR ? envR.apiKey : String(resend.apiKey || '').trim()),
      apiKeyHint: maskSecret(envR ? envR.apiKey : resend.apiKey),
      fromName: envR ? envR.fromName : String(resend.fromName || 'Chatbot Leads'),
      fromEmail: envR ? envR.fromEmail : String(resend.fromEmail || ''),
    },
    replyTo: String(data.replyTo || '').trim(),
    testRecipient: String(data.testRecipient || '').trim(),
  };
}

function resolveSmtpConfig() {
  const outbound = resolveOutboundConfig();
  if (!outbound.ok) return outbound;
  if (outbound.provider === 'resend') {
    return {
      ok: true,
      provider: 'resend',
      resend: outbound.resend,
      replyTo: outbound.replyTo,
    };
  }
  return {
    ok: true,
    provider: 'smtp',
    smtp: outbound.smtp,
    replyTo: outbound.replyTo,
  };
}

function resolveOutboundConfig() {
  const envR = envResend();
  if (envR) {
    return { ok: true, provider: 'resend', resend: envR, replyTo: '' };
  }

  const envS = envSmtp();
  if (envS) {
    return { ok: true, provider: 'smtp', smtp: envS, replyTo: '' };
  }

  const data = readFile_();
  if (!data.enabled) return { ok: false, error: 'Email integration is disabled' };

  if (data.provider === 'resend') {
    const r = data.resend || {};
    const apiKey = String(r.apiKey || '').trim();
    const fromEmail = String(r.fromEmail || '').trim();
    if (!apiKey || !fromEmail) {
      return { ok: false, error: 'Resend API key and from email are required' };
    }
    return {
      ok: true,
      provider: 'resend',
      resend: {
        apiKey,
        fromName: String(r.fromName || 'Chatbot Leads').trim(),
        fromEmail,
      },
      replyTo: String(data.replyTo || '').trim(),
    };
  }

  const smtp = normalizeSmtpTransport(data.smtp || {});
  if (!smtp.host || !smtp.user || !smtp.password || !smtp.fromEmail) {
    return { ok: false, error: 'SMTP host, user, password, and from email are required' };
  }
  return {
    ok: true,
    provider: 'smtp',
    smtp,
    replyTo: String(data.replyTo || '').trim(),
  };
}

function saveConfig(patch) {
  const data = readFile_();
  if (envSmtp() || envResend()) {
    return {
      ok: false,
      error:
        'Email is configured via environment variables on the server — file settings are read-only.',
    };
  }
  const body = patch && typeof patch === 'object' ? patch : {};
  if (body.enabled != null) data.enabled = !!body.enabled;
  if (body.provider != null) {
    const p = String(body.provider).trim();
    data.provider = p === 'resend' ? 'resend' : 'smtp';
  }
  if (!data.smtp) data.smtp = {};
  if (!data.resend) data.resend = {};
  if (body.smtp && typeof body.smtp === 'object') {
    const s = body.smtp;
    if (s.host != null) data.smtp.host = String(s.host).trim();
    if (s.port != null) data.smtp.port = Number(s.port) || 587;
    if (s.secure != null) data.smtp.secure = !!s.secure;
    if (s.user != null) data.smtp.user = String(s.user).trim();
    if (s.password != null && String(s.password).trim()) {
      data.smtp.password = normalizeSmtpPassword(s.password);
    }
    if (s.fromName != null) data.smtp.fromName = String(s.fromName).trim();
    if (s.fromEmail != null) data.smtp.fromEmail = String(s.fromEmail).trim();
    const normalized = normalizeSmtpTransport(data.smtp);
    data.smtp.port = normalized.port;
    data.smtp.secure = normalized.secure;
    if (data.smtp.password) data.smtp.password = normalized.password;
  }
  if (body.resend && typeof body.resend === 'object') {
    const r = body.resend;
    if (r.enabled != null) data.resend.enabled = !!r.enabled;
    if (r.apiKey != null && String(r.apiKey).trim()) {
      data.resend.apiKey = String(r.apiKey).trim();
    }
    if (r.fromName != null) data.resend.fromName = String(r.fromName).trim();
    if (r.fromEmail != null) data.resend.fromEmail = String(r.fromEmail).trim();
  }
  if (body.replyTo != null) data.replyTo = String(body.replyTo).trim();
  if (body.testRecipient != null) data.testRecipient = String(body.testRecipient).trim();
  writeFile_(data);
  return { ok: true, config: publicView(data) };
}

module.exports = {
  FILE_NAME,
  publicView,
  resolveSmtpConfig,
  resolveOutboundConfig,
  saveConfig,
  envSmtp,
  envResend,
};
