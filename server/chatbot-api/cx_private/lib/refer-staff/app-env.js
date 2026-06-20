/**
 * Single env config — all keys documented in root .env.example
 * Loads .env from project root when present (local dev).
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(ENV_PATH);

function str(name, fallback = '') {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function num(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, defaultTrue = true) {
  const v = str(name, '');
  if (!v) return defaultTrue;
  return v !== '0' && v.toLowerCase() !== 'false';
}

const PUBLIC_BASE_URL = str(
  'PUBLIC_BASE_URL',
  str('RAILWAY_PUBLIC_DOMAIN')
    ? `https://${str('RAILWAY_PUBLIC_DOMAIN').replace(/^https?:\/\//i, '')}`
    : 'https://es-based-chatbot-production.up.railway.app'
).replace(/\/$/, '');

module.exports = {
  PORT: num('PORT', 4567),
  PUBLIC_BASE_URL,
  DIALOGFLOW_PROJECT_ID: str('DIALOGFLOW_PROJECT_ID'),
  DIALOGFLOW_ALLOWED_PROJECTS: str('DIALOGFLOW_ALLOWED_PROJECTS'),

  GOOGLE_APPLICATION_CREDENTIALS: str('GOOGLE_APPLICATION_CREDENTIALS'),
  GOOGLE_CREDENTIALS_JSON: str('GOOGLE_CREDENTIALS_JSON'),
  GOOGLE_CREDENTIALS_JSON_BASE64: str('GOOGLE_CREDENTIALS_JSON_BASE64'),

  SHEETS_SPREADSHEET_ID: str('SHEETS_SPREADSHEET_ID'),
  SHEETS_RANGE: str('SHEETS_RANGE', 'Sheet1!A:AG'),
  SHEETS_DASHBOARD_RANGE: str('SHEETS_DASHBOARD_RANGE', 'Sheet2!A:M'),
  SHEETS_AGENT_TAB: str('SHEETS_AGENT_TAB'),
  SHEETS_CONV_DATETIME_TZ: str('SHEETS_CONV_DATETIME_TZ', 'Asia/Kolkata'),

  GCS_BUCKET_NAME: str('GCS_BUCKET_NAME'),
  GCS_UPLOAD_PREFIX: str('GCS_UPLOAD_PREFIX', 'user-uploads'),
  GCS_SIGNED_URL_DAYS: num('GCS_SIGNED_URL_DAYS', 7),
  GCS_DATA_SYNC_PREFIX: str('GCS_DATA_SYNC_PREFIX', 'config-data'),
  GCS_LIVE_AGENT_OBJECT: str('GCS_LIVE_AGENT_OBJECT', 'live-agent/live-agent-sessions.json'),
  GCS_LIVE_AGENT_SETTINGS_OBJECT: str(
    'GCS_LIVE_AGENT_SETTINGS_OBJECT',
    'live-agent/live-agent-settings.json'
  ),
  GCS_LIVE_AGENT_SIGNALS_OBJECT: str(
    'GCS_LIVE_AGENT_SIGNALS_OBJECT',
    'live-agent/live-agent-signals.json'
  ),

  GITHUB_REPO: str('GITHUB_REPO', 'qabot2026/ES_01'),
  GITHUB_BRANCH: str('GITHUB_BRANCH', 'main'),
  GITHUB_TOKEN: str('GITHUB_TOKEN') || str('GITHUB_PAT'),
  DATA_SYNC_GCS: bool('DATA_SYNC_GCS', true),
  DATA_SYNC_GITHUB: bool('DATA_SYNC_GITHUB', true),

  LIVE_AGENT_DESK_TOKEN: str('LIVE_AGENT_DESK_TOKEN'),
  CONVERSATIONS_SHEET_VIEW_SECRET: str('CONVERSATIONS_SHEET_VIEW_SECRET'),
  LIVE_AGENT_GCS: bool('LIVE_AGENT_GCS', true),

  CONTACT_FORM_SUBMISSION_TZ: str('CONTACT_FORM_SUBMISSION_TZ', 'Asia/Kolkata'),
  APPOINTMENT_TIMEZONE: str('APPOINTMENT_TIMEZONE'),
  APPOINTMENT_SCHEDULE_PATH: str('APPOINTMENT_SCHEDULE_PATH'),

  APPEARANCE_MENU_ICON_BUCKET: str('APPEARANCE_MENU_ICON_BUCKET', 'recep-bucket'),
  APPEARANCE_MENU_ICON_OBJECT: str(
    'APPEARANCE_MENU_ICON_OBJECT',
    'brand-data/appearence-logo.png'
  ),

  NODE_ENV: str('NODE_ENV'),

  META_APP_SECRET: str('META_APP_SECRET') || str('WHATSAPP_APP_SECRET'),
  META_VERIFY_TOKEN: str('META_VERIFY_TOKEN') || str('WHATSAPP_VERIFY_TOKEN'),
  WHATSAPP_ACCESS_TOKEN:
    str('WHATSAPP_ACCESS_TOKEN') || str('WHATSAPP_TOKEN'),
  WHATSAPP_PHONE_NUMBER_ID: str('WHATSAPP_PHONE_NUMBER_ID'),
  FB_PAGE_ACCESS_TOKEN: str('FB_PAGE_ACCESS_TOKEN'),
  INSTAGRAM_PAGE_ID: str('INSTAGRAM_PAGE_ID'),
};
