/**
 * Shared Google service account loader (Dialogflow, Sheets, Translate).
 */

const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__dirname, '..', 'credentials.json');

function parseServiceAccountJson(raw) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('GOOGLE_CREDENTIALS_JSON is empty');

  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      text = JSON.parse(text);
    } catch {
      /* use original */
    }
  }

  try {
    return JSON.parse(text);
  } catch (firstErr) {
    try {
      return JSON.parse(text.replace(/\r?\n/g, '\\n'));
    } catch {
      throw new Error(
        `Invalid service account JSON: ${firstErr.message}. ` +
          'Paste the full JSON as one line in Railway Variables.'
      );
    }
  }
}

function getServiceAccountCredentials() {
  const base64 = process.env.GOOGLE_CREDENTIALS_JSON_BASE64;
  if (base64 && base64.trim()) {
    try {
      const decoded = Buffer.from(base64.trim(), 'base64').toString('utf8');
      const parsed = parseServiceAccountJson(decoded);
      if (parsed && parsed.type === 'service_account') return parsed;
    } catch (e) {
      console.warn('[google-credentials] BASE64 decode failed:', e.message);
    }
  }

  const jsonCandidates = [
    process.env.GOOGLE_CREDENTIALS_JSON,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  ];
  for (const jsonEnv of jsonCandidates) {
    if (!jsonEnv || !String(jsonEnv).trim()) continue;
    try {
      const parsed = parseServiceAccountJson(jsonEnv);
      if (parsed && parsed.type === 'service_account') return parsed;
    } catch (e) {
      console.warn('[google-credentials] JSON env parse failed:', e.message);
    }
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      if (parsed && parsed.type === 'service_account') return parsed;
    } catch (e) {
      console.warn('[google-credentials] file read failed:', e.message);
    }
  }

  return null;
}

function isCredentialsConfigured() {
  if (process.env.GOOGLE_CREDENTIALS_JSON_BASE64?.trim()) return true;
  if (process.env.GOOGLE_CREDENTIALS_JSON?.trim()) return true;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) return true;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return true;
  return fs.existsSync(CREDENTIALS_PATH);
}

function getClientEmail() {
  const c = getServiceAccountCredentials();
  return c && c.client_email ? String(c.client_email) : '';
}

module.exports = {
  getServiceAccountCredentials,
  isCredentialsConfigured,
  getClientEmail,
  parseServiceAccountJson,
  CREDENTIALS_PATH,
};
