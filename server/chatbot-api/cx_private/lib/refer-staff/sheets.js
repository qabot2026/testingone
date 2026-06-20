/**
 * Google Sheets API — one row per conversation (see lib/conversation-sheet.js).
 */

const { google } = require('googleapis');
const googleCredentials = require('./google-credentials');
const sheetDateFormat = require('./sheet-date-format');

/** Must match lib/conversation-sheet.js row order. */
const SHEET_COL_HEADERS = [
  'Conv. Link',
  'Conv. Date',
  'Conv. Time',
  'Name',
  'Mobile',
  'Email',
  'Channel',
  'User Queries',
  'Repeated User',
  'Source URL',
  'Session ID',
  'Device',
  'Browser',
  'OS',
  'City',
  'IP Address',
  'App. Booked',
  'App. Date',
  'App. Time',
  'Document',
  'Sentiment',
  'Rating',
  'Feedback',
  'Duration',
  'CRM Push Status',
  'Message Count',
  'Average Response Time',
  'UtmCampaign',
  'UtmContent',
  'UtmMedium',
  'UtmSource',
  'UtmTerm',
  'Fall back',
];

const SPREADSHEET_ID = String(process.env.SHEETS_SPREADSHEET_ID || '').trim();
const RANGE = String(process.env.SHEETS_RANGE || "'All Conversations'!A:AG").trim();
const DASHBOARD_RANGE = String(
  process.env.SHEETS_DASHBOARD_RANGE || 'Sheet2!A:M'
).trim();

/** Same base URL as api-base.config.js — required for column A Chatscript / Conv. Link. */
function readApiBaseFromConfigFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(__dirname, '..', '..', 'api-base.config.js'),
      path.join(__dirname, '..', '..', '..', '..', 'api-base.config.js'),
    ];
    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue;
      const m = fs.readFileSync(filePath, 'utf8').match(
        /COMPANY_DEFAULT_API_BASE_URL\s*=\s*["']([^"']+)["']/
      );
      if (m && m[1]) return String(m[1]).trim().replace(/\/+$/, '');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function resolvePublicBaseUrl() {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const railway = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railway) {
    return `https://${railway.replace(/^https?:\/\//i, '')}`.replace(/\/$/, '');
  }
  const fromFile = readApiBaseFromConfigFile();
  if (fromFile) return fromFile;
  return '';
}

let headerWritten = false;
/** Tabs that already have dd/mm/yyyy on date columns. */
const dateColumnsFormatApplied = new Set();
let lastError = null;
let lastProbeAt = null;
let lastProbeOk = null;

function columnToLetter(n) {
  let col = n;
  let s = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s || 'A';
}

function tabFromRange(rangeStr) {
  const bang = rangeStr.indexOf('!');
  const raw = bang >= 0 ? rangeStr.slice(0, bang).replace(/^'|'$/g, '') : 'All Conversations';
  return stripEnvQuotes_(raw) || 'All Conversations';
}

/** Strip surrounding quotes Railway users sometimes include in env values. */
function stripEnvQuotes_(s) {
  return String(s || '').trim().replace(/^["']+|["']+$/g, '');
}

/** A1 notation tab prefix (quoted for names with spaces/special chars). */
function sheetTabA1Prefix_(tabTitle) {
  const t = stripEnvQuotes_(tabTitle).replace(/'/g, "''");
  if (!t) return "'Sheet'";
  return `'${t}'`;
}

function sheetTabRange_(tabTitle, a1Suffix) {
  return `${sheetTabA1Prefix_(tabTitle)}!${a1Suffix}`;
}

function colEndFromRange(rangeStr) {
  const bang = rangeStr.indexOf('!');
  if (bang < 0) return 'AG';
  const part = rangeStr.slice(bang + 1);
  const colon = part.indexOf(':');
  if (colon < 0) return part.replace(/[0-9]/g, '') || 'AG';
  return part.slice(colon + 1).replace(/[0-9]/g, '') || 'AG';
}

function tabName() {
  return tabFromRange(RANGE);
}

function dashboardTabName() {
  return tabFromRange(DASHBOARD_RANGE);
}

/** Human-agent handoff rows (ua-conversations) — live-agent sync tab, not the web KPI dashboard. */
function liveAgentTabName() {
  const custom = stripEnvQuotes_(process.env.SHEETS_LIVE_AGENT_TAB || '');
  if (custom) return custom;
  return 'Agent Handoffs';
}

function isConfigured() {
  return !!(SPREADSHEET_ID && googleCredentials.isCredentialsConfigured());
}

function isClientReady() {
  return !!getSheetsClient();
}

function loadAuth() {
  const credentials = googleCredentials.getServiceAccountCredentials();
  if (!credentials) return null;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  const auth = loadAuth();
  if (!auth) return null;
  return google.sheets({ version: 'v4', auth });
}

function logSheetError(op, err) {
  const extra =
    err.response && err.response.data
      ? err.response.data.error || err.response.data
      : err.errors;
  const msg = [err.message || String(err), extra ? JSON.stringify(extra) : '']
    .filter(Boolean)
    .join(' ');
  lastError = { op, message: msg, at: new Date().toISOString() };
  console.warn('[sheets]', op + ':', msg);
}

function transcriptUrl(sessionId) {
  const base = resolvePublicBaseUrl();
  const sid = String(sessionId || '').trim();
  if (!base || !sid) return '';
  return (
    base +
    '/conversation-transcript?session=' +
    encodeURIComponent(sid)
  );
}

/** Column A (Conv. Link): clickable Chatscript label → transcript page. */
function chatscriptSheetCell(sessionId) {
  const url = transcriptUrl(sessionId);
  if (!url) {
    const sid = String(sessionId || '').trim();
    if (sid) {
      console.warn(
        '[sheets] Conv. Link empty for session',
        sid,
        '— set PUBLIC_BASE_URL on Railway'
      );
    }
    return '';
  }
  const escUrl = String(url).replace(/"/g, '""');
  return `=HYPERLINK("${escUrl}","Chatscript")`;
}

/** Plain URL fallback (always clickable in Sheets if formula fails). */
function chatscriptPlainUrl(sessionId) {
  return transcriptUrl(sessionId);
}

/** Write only column A — fixes append/table offset when A was empty on older rows. */
async function writeConvLinkForRow(rowNumber1Based, sessionId) {
  if (!isConfigured() || !rowNumber1Based) return false;
  const formula = chatscriptSheetCell(sessionId);
  const plain = chatscriptPlainUrl(sessionId);
  const cell = formula || plain;
  if (!cell) return false;

  const client = getSheetsClient();
  if (!client) return false;
  const tab = tabName();
  try {
    await client.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `A${rowNumber1Based}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[cell]] },
    });
    lastError = null;
    return true;
  } catch (err) {
    logSheetError('writeConvLinkForRow', err);
    if (plain && plain !== cell) {
      try {
        await client.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: sheetTabRange_(tab, `A${rowNumber1Based}`),
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[plain]] },
        });
        return true;
      } catch (err2) {
        logSheetError('writeConvLinkForRow/plain', err2);
      }
    }
    return false;
  }
}

/** Next empty row (row 1 = headers). Uses full width so empty column A still counts. */
async function getNextDataRowNumber() {
  if (!isConfigured()) return 2;
  const client = getSheetsClient();
  if (!client) return 2;
  const tab = tabName();
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A:AG'),
    });
    const rows = res.data.values || [];
    return Math.max(2, rows.length + 1);
  } catch (err) {
    logSheetError('getNextDataRowNumber', err);
    return 2;
  }
}

function rowToColumnMap(row) {
  const columns = {};
  for (let c = 0; c < SHEET_COL_HEADERS.length; c++) {
    const h = SHEET_COL_HEADERS[c];
    const v = row && row[c] != null ? String(row[c]).trim() : '';
    if (h && v) columns[h] = v;
  }
  return columns;
}

/**
 * Find sheet row by Session ID column.
 * @returns {Promise<{ rowNumber: number, columns: Record<string, string> } | null>}
 */
async function fetchSheetRowBySessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !isConfigured()) return null;
  const client = getSheetsClient();
  if (!client) return null;
  const tab = tabName();
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A2:AG'),
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const columns = rowToColumnMap(row);
      const rowHasSid =
        columns['Session ID'] === sid ||
        (row || []).some((cell) => String(cell || '').trim() === sid);
      if (!rowHasSid) continue;
      return { rowNumber: i + 2, columns };
    }
  } catch (err) {
    logSheetError('fetchSheetRowBySessionId', err);
  }
  return null;
}

async function getSheetIdForTab(sheetsClient, tab) {
  const meta = await sheetsClient.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.sheetId,sheets.properties.title',
  });
  for (const s of meta.data.sheets || []) {
    const title = s.properties && s.properties.title;
    if (s.properties && typeof s.properties.sheetId === 'number' && title === tab) {
      return s.properties.sheetId;
    }
  }
  throw new Error(`Sheet tab not found: ${tab}`);
}

/** Conv. Date + App. Date columns display as DD/MM/YYYY in Sheets. */
async function ensureSheetDateColumnsFormat() {
  if (!isConfigured()) return;
  const tab = tabName();
  const key = tab.toLowerCase();
  if (dateColumnsFormatApplied.has(key)) return;
  const client = getSheetsClient();
  if (!client) return;
  const dateColIdxs = [
    SHEET_COL_HEADERS.indexOf('Conv. Date'),
    SHEET_COL_HEADERS.indexOf('App. Date'),
  ].filter((i) => i >= 0);
  if (!dateColIdxs.length) return;
  try {
    const sheetId = await getSheetIdForTab(client, tab);
    const requests = dateColIdxs.map((colIdx) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 200000,
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: sheetDateFormat.SHEET_DD_MM_YYYY_NUMBER_FORMAT,
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    }));
    await client.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
    dateColumnsFormatApplied.add(key);
  } catch (err) {
    logSheetError('ensureSheetDateColumnsFormat', err);
  }
}

async function ensureHeaderRowOnTab(tab, headers) {
  if (!isConfigured()) return;
  const client = getSheetsClient();
  if (!client) {
    logSheetError('ensureHeaderRowOnTab', new Error('Sheets client not created — check credentials'));
    return;
  }
  const headerRange = sheetTabRange_(tab, `A1:${columnToLetter(headers.length)}1`);
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: headerRange,
    });
    const row = (res.data.values && res.data.values[0]) || [];
    if (row.length && String(row[0] || '').trim()) return;
    await client.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    lastError = null;
  } catch (err) {
    logSheetError('ensureHeaderRowOnTab', err);
  }
}

async function ensureHeaderRow(headers) {
  if (!isConfigured()) return;
  const client = getSheetsClient();
  if (!client) {
    logSheetError('ensureHeaderRow', new Error('Sheets client not created — check credentials'));
    return;
  }
  const tab = tabName();
  const headerRange = sheetTabRange_(tab, `A1:${columnToLetter(headers.length)}1`);
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: headerRange,
    });
    const row = (res.data.values && res.data.values[0]) || [];
    if (row.length && String(row[0] || '').trim()) {
      headerWritten = true;
      await ensureSheetDateColumnsFormat();
      return;
    }
    await client.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    headerWritten = true;
    await ensureSheetDateColumnsFormat();
  } catch (err) {
    logSheetError('ensureHeaderRow', err);
  }
}

/** @returns {Promise<number|null>} 1-based row number — always writes from column A. */
async function appendRowValues(values) {
  if (!isConfigured()) return null;
  try {
    const rowNum = await getNextDataRowNumber();
    const ok = await updateRow(rowNum, values);
    if (!ok) return null;
    lastError = null;
    return rowNum;
  } catch (err) {
    logSheetError('append', err);
    return null;
  }
}

async function updateRowOnTab(tab, rowNumber1Based, values) {
  if (!isConfigured() || !rowNumber1Based || !tab) return false;
  const client = getSheetsClient();
  if (!client) return false;
  const endCol = columnToLetter(values.length);
  const range = sheetTabRange_(tab, `A${rowNumber1Based}:${endCol}${rowNumber1Based}`);
  try {
    await client.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
    lastError = null;
    return true;
  } catch (err) {
    logSheetError('updateRowOnTab', err);
    return false;
  }
}

async function updateRow(rowNumber1Based, values) {
  if (!isConfigured() || !rowNumber1Based) return false;
  await ensureSheetDateColumnsFormat();
  return updateRowOnTab(tabName(), rowNumber1Based, values);
}

async function getNextDataRowNumberOnTab(tab, colEnd) {
  if (!isConfigured()) return 2;
  const client = getSheetsClient();
  if (!client) return 2;
  const end = colEnd || 'AG';
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `A:${end}`),
    });
    const rows = res.data.values || [];
    return Math.max(2, rows.length + 1);
  } catch (err) {
    logSheetError('getNextDataRowNumberOnTab', err);
    return 2;
  }
}

async function appendRowValuesOnTab(tab, values) {
  if (!isConfigured()) return null;
  const colEnd = columnToLetter(values.length);
  try {
    const rowNum = await getNextDataRowNumberOnTab(tab, colEnd);
    const ok = await updateRowOnTab(tab, rowNum, values);
    if (!ok) return null;
    lastError = null;
    return rowNum;
  } catch (err) {
    logSheetError('appendRowValuesOnTab', err);
    return null;
  }
}

async function writeChatscriptForRowOnTab(tab, rowNumber1Based, sessionId) {
  if (!isConfigured() || !rowNumber1Based || !tab) return false;
  const formula = chatscriptSheetCell(sessionId);
  const plain = chatscriptPlainUrl(sessionId);
  const cell = formula || plain;
  if (!cell) return false;

  const client = getSheetsClient();
  if (!client) return false;
  try {
    await client.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `A${rowNumber1Based}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[cell]] },
    });
    lastError = null;
    return true;
  } catch (err) {
    logSheetError('writeChatscriptForRowOnTab', err);
    if (plain && plain !== cell) {
      try {
        await client.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: sheetTabRange_(tab, `A${rowNumber1Based}`),
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[plain]] },
        });
        return true;
      } catch (err2) {
        logSheetError('writeChatscriptForRowOnTab/plain', err2);
      }
    }
    return false;
  }
}

/**
 * Find row on a tab by Session ID column.
 * @returns {Promise<{ rowNumber: number, columns: Record<string, string> } | null>}
 */
async function fetchSheetRowBySessionIdOnTab(tab, sessionId, headers) {
  const sid = String(sessionId || '').trim();
  if (!sid || !isConfigured() || !tab) return null;
  const client = getSheetsClient();
  if (!client) return null;
  const hdrs = Array.isArray(headers) ? headers : SHEET_COL_HEADERS;
  const sidIdx = hdrs.indexOf('Session ID');
  const colEnd = columnToLetter(hdrs.length);
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `A2:${colEnd}`),
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const columns = rowToColumnMap(row);
      const rowHasSid =
        columns['Session ID'] === sid ||
        (sidIdx >= 0 && String((row || [])[sidIdx] || '').trim() === sid) ||
        (row || []).some((cell) => String(cell || '').trim() === sid);
      if (!rowHasSid) continue;
      return { rowNumber: i + 2, columns };
    }
  } catch (err) {
    logSheetError('fetchSheetRowBySessionIdOnTab', err);
  }
  return null;
}

async function probe() {
  lastProbeAt = new Date().toISOString();
  if (!isConfigured()) {
    lastProbeOk = false;
    return {
      ok: false,
      error: 'not_configured',
      spreadsheetIdSet: !!SPREADSHEET_ID,
      credentialsSet: googleCredentials.isCredentialsConfigured(),
      clientReady: false,
    };
  }
  const sheets = getSheetsClient();
  if (!sheets) {
    lastProbeOk = false;
    return {
      ok: false,
      error: 'credentials_parse_failed',
      clientEmail: googleCredentials.getClientEmail(),
      clientReady: false,
    };
  }
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'properties.title,sheets.properties.title',
    });
    const titles = (meta.data.sheets || []).map(
      (s) => s.properties && s.properties.title
    );
    const tab = tabName();
    lastProbeOk = true;
    lastError = null;
    return {
      ok: true,
      title: meta.data.properties && meta.data.properties.title,
      tabNames: titles,
      configuredTab: tab,
      tabExists: titles.includes(tab),
      range: RANGE,
      clientEmail: googleCredentials.getClientEmail(),
    };
  } catch (err) {
    lastProbeOk = false;
    logSheetError('probe', err);
    return {
      ok: false,
      error: err.message,
      clientEmail: googleCredentials.getClientEmail(),
      lastError,
    };
  }
}

/** Normalize mobile for comparison (last 10 digits). */
function normalizeMobile(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Mobile numbers already in the sheet (Mobile column), excluding one row when updating.
 * @param {number|null} excludeRowNumber1Based
 * @returns {Promise<string[]>} normalized mobiles
 */
async function listSheetMobiles(excludeRowNumber1Based) {
  if (!isConfigured()) return [];
  const client = getSheetsClient();
  if (!client) return [];
  const tab = tabName();
  const exclude = excludeRowNumber1Based
    ? Number(excludeRowNumber1Based)
    : null;
  try {
    const mobileIdx = SHEET_COL_HEADERS.indexOf('Mobile');
    const mobileCol =
      mobileIdx >= 0 ? columnToLetter(mobileIdx + 1) : 'E';
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `${mobileCol}2:${mobileCol}`),
    });
    const rows = res.data.values || [];
    const out = [];
    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      if (exclude && rowNum === exclude) return;
      const norm = normalizeMobile(row && row[0]);
      if (norm) out.push(norm);
    });
    return out;
  } catch (err) {
    logSheetError('listSheetMobiles', err);
    return [];
  }
}

function getStatus() {
  return {
    configured: isConfigured(),
    clientReady: isClientReady(),
    spreadsheetIdSet: !!SPREADSHEET_ID,
    range: RANGE,
    publicBaseUrl: resolvePublicBaseUrl(),
    publicBaseUrlFromEnv: !!String(process.env.PUBLIC_BASE_URL || '').trim(),
    clientEmail: googleCredentials.getClientEmail(),
    lastProbeAt,
    lastProbeOk,
    lastError,
  };
}

const STORAGE_FOLDER_INLINE_RE =
  /(\d{10,}_\d{2}_\d{2}_\d{4}_\d{2,})|([a-zA-Z0-9][a-zA-Z0-9_-]*__\d{2}_\d{2}_\d{4}_\d{2,})/;

/** Extract GCS submission folder from sheet Document cell (folder id or URL). */
function extractStorageFolderFromDocumentCell(cell) {
  const s = String(cell || '').trim();
  if (!s) return '';
  if (!s.includes('://')) {
    const exact = s.match(/^(\d{10,}_\d{2}_\d{2}_\d{4}_\d{2,})$/) ||
      s.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]*__\d{2}_\d{2}_\d{4}_\d{2,})$/);
    if (exact) return exact[1] || exact[2];
  }
  const pathM =
    s.match(/\/uploads\/([^/?]+)/i) ||
    s.match(/uploads%2F([^/?%]+)/i) ||
    s.match(/storage\.googleapis\.com\/[^/]+\/(?:uploads%2F|uploads\/)([^/?]+)/i);
  if (pathM) {
    try {
      return decodeURIComponent(pathM[1]);
    } catch {
      return pathM[1];
    }
  }
  const inline = s.match(STORAGE_FOLDER_INLINE_RE);
  if (inline) return inline[1] || inline[2];
  return '';
}

function sheetDateToFolderLabel(dateCell) {
  const m = String(dateCell || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${dd}_${mm}_${m[3]}`;
}

/**
 * Sheet rows indexed for document dashboard enrichment.
 * @returns {Promise<{ byFolder: object, bySession: object, byMobileDate: object[] }>}
 */
async function loadDocumentEnrichmentByFolder() {
  const byFolder = {};
  const bySession = {};
  const byMobileDate = [];
  if (!isConfigured()) return { byFolder, bySession, byMobileDate };
  const client = getSheetsClient();
  if (!client) return { byFolder, bySession, byMobileDate };
  const tab = tabName();
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A2:AG'),
    });
    const rows = res.data.values || [];
    rows.forEach((row) => {
      const columns = rowToColumnMap(row);
      const name = columns.Name || '';
      const mobile = columns.Mobile || '';
      const sessionId = columns['Session ID'] || '';
      const document = columns.Document || '';
      const date = columns['Conv. Date'] || '';
      const time = columns['Conv. Time'] || '';
      const updatedAt = [date, time].filter(Boolean).join(' ');
      const entry = {
        sessionId,
        name,
        mobile,
        dial_code: '',
        email: columns.Email || '',
        updatedAt,
      };
      const folder = extractStorageFolderFromDocumentCell(document);
      if (folder) byFolder[folder] = entry;
      if (sessionId) bySession[sessionId] = entry;

      const dateLabel = sheetDateToFolderLabel(date);
      const mobDigits = mobile.replace(/\D/g, '');
      if (dateLabel && mobDigits.length >= 10) {
        const digits =
          mobDigits.length >= 11 ? mobDigits : '91' + mobDigits.slice(-10);
        byMobileDate.push({ digits, dateLabel, entry });
      }
    });
  } catch (err) {
    logSheetError('loadDocumentEnrichmentByFolder', err);
  }
  return { byFolder, bySession, byMobileDate };
}

/**
 * Sheet rows with a Document cell — for documents dashboard (all channels).
 * @returns {Promise<Array<object>>}
 */
async function loadSheetDocumentEntries() {
  const out = [];
  if (!isConfigured()) return out;
  const client = getSheetsClient();
  if (!client) return out;
  const tab = tabName();
  const documentDisplay = require('./document-display');
  const gcsUpload = require('./gcs-upload');
  const bucket = gcsUpload.BUCKET_NAME || '';
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, 'A2:AG'),
    });
    const rows = res.data.values || [];
    rows.forEach((row) => {
      const columns = rowToColumnMap(row);
      const document = String(columns.Document || '').trim();
      if (!document) return;
      const sessionId = String(columns['Session ID'] || '').trim();
      const seed = {
        sessionId,
        name: columns.Name || '',
        mobile: columns.Mobile || '',
        dial_code: '',
        email: columns.Email || '',
        channel: columns.Channel || '',
        tag: '',
        storage_folder: extractStorageFolderFromDocumentCell(document),
        updatedAt: [columns['Conv. Date'], columns['Conv. Time']]
          .filter(Boolean)
          .join(' '),
      };
      const parts = document.includes('\n') ? document.split('\n') : [document];
      parts.forEach((part, idx) => {
        const link = String(part || '').trim();
        if (!link) return;
        if (!link.includes('://') && seed.storage_folder) return;
        const gcsObject = documentDisplay.gcsObjectFromStorageUrl(link, bucket);
        if (gcsObject) {
          out.push(
            Object.assign({}, seed, {
              gcs_object: gcsObject,
              file_name:
                documentDisplay.filenameFromGcsUrl(link) ||
                documentDisplay.parseStoredObjectFileName(
                  gcsObject.split('/').pop()
                ),
              source: 'sheet',
            })
          );
          return;
        }
        if (/^https?:\/\//i.test(link)) {
          out.push(
            Object.assign({}, seed, {
              gcs_object: `external:${sessionId || 'sheet'}:${idx}`,
              file_name: documentDisplay.filenameFromGcsUrl(link) || 'document',
              external_url: link,
              source: 'sheet-external',
            })
          );
        }
      });
    });
  } catch (err) {
    logSheetError('loadSheetDocumentEntries', err);
  }
  return out;
}

/** Fill column A for all rows that have a Session ID (fixes legacy empty Conv. Link cells). */
async function backfillConvLinkColumn() {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  const client = getSheetsClient();
  if (!client) return { ok: false, error: 'no_client' };
  const tab = tabName();
  const sidCol = columnToLetter(SHEET_COL_HEADERS.indexOf('Session ID') + 1);
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTabRange_(tab, `${sidCol}2:${sidCol}`),
    });
    const rows = res.data.values || [];
    let updated = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const sid = String(rows[i][0] || '').trim();
      if (!sid) {
        skipped += 1;
        continue;
      }
      const ok = await writeConvLinkForRow(i + 2, sid);
      if (ok) updated += 1;
      else skipped += 1;
    }
    return { ok: true, updated, skipped, total: rows.length };
  } catch (err) {
    logSheetError('backfillConvLinkColumn', err);
    return { ok: false, error: err.message };
  }
}

/** @deprecated use conversation-sheet sync */
async function appendRow() {
  return { ok: false, skipped: true };
}

/**
 * Full Sheet1 grid for staff conversations viewer (header + data rows).
 * @returns {Promise<{ tab: string, title: string, headers: string[], dataRows: string[][] }>}
 */
async function fetchConversationGrid() {
  if (!isConfigured()) {
    throw new Error('SHEETS_SPREADSHEET_ID is not set.');
  }
  const client = getSheetsClient();
  if (!client) {
    throw new Error(
      'Missing service account credentials — same as Sheets writes.'
    );
  }
  const tab = tabName();
  const meta = await client.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'properties.title',
  });
  const title =
    meta.data.properties && meta.data.properties.title
      ? String(meta.data.properties.title).trim()
      : '';
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTabRange_(tab, 'A:AG'),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const rows = res.data.values || [];
  const dataRows = rows.length > 1 ? rows.slice(1) : [];
  return { tab, title, headers: [...SHEET_COL_HEADERS], dataRows };
}

/**
 * Sheet2 grid for live-agent handoffs (staff viewer).
 * @returns {Promise<{ tab: string, title: string, headers: string[], dataRows: string[][] }>}
 */
async function fetchLiveAgentGrid() {
  if (!isConfigured()) {
    throw new Error('SHEETS_SPREADSHEET_ID is not set.');
  }
  const client = getSheetsClient();
  if (!client) {
    throw new Error(
      'Missing service account credentials — same as Sheets writes.'
    );
  }
  const tab = liveAgentTabName();
  /** All Conversations (33) + Agent / Department / Status = 36 columns. */
  const colEnd = columnToLetter(36);
  const meta = await client.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'properties.title',
  });
  const title =
    meta.data.properties && meta.data.properties.title
      ? String(meta.data.properties.title).trim()
      : '';
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTabRange_(tab, `A:${colEnd}`),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const rows = res.data.values || [];
  const headerRow = rows.length ? rows[0] : [];
  const headers = headerRow
    .map((h) => String(h == null ? '' : h).trim())
    .filter((h, i, arr) => h || i < arr.length);
  const dataRows = rows.length > 1 ? rows.slice(1) : [];
  return { tab, title, headers, dataRows };
}

module.exports = {
  isConfigured,
  isClientReady,
  ensureHeaderRow,
  ensureHeaderRowOnTab,
  appendRowValues,
  appendRowValuesOnTab,
  updateRow,
  updateRowOnTab,
  appendRow,
  probe,
  getStatus,
  normalizeMobile,
  listSheetMobiles,
  loadDocumentEnrichmentByFolder,
  loadSheetDocumentEntries,
  extractStorageFolderFromDocumentCell,
  fetchSheetRowBySessionId,
  fetchSheetRowBySessionIdOnTab,
  fetchConversationGrid,
  fetchLiveAgentGrid,
  chatscriptSheetCell,
  chatscriptPlainUrl,
  writeConvLinkForRow,
  writeChatscriptForRowOnTab,
  backfillConvLinkColumn,
  applySheetDateColumnFormat: ensureSheetDateColumnsFormat,
  transcriptUrl,
  resolvePublicBaseUrl,
  dashboardTabName,
  liveAgentTabName,
  tabName,
  SHEET_COL_HEADERS,
  SPREADSHEET_ID,
  RANGE,
  DASHBOARD_RANGE,
};
