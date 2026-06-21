/**
 * Parse Excel/CSV Q&A provision sheets: Intent | synonyms | Response
 */

const XLSX = require('xlsx');

const HEADER_ALIASES = {
  intent: ['intent', 'column1', 'intent name', 'intent_name'],
  synonyms: ['synonyms', 'synonym', 'column2', 'training phrases', 'phrases', 'training_phrases'],
  response: ['response', 'answer', 'column3', 'reply', 'text'],
  priority: ['priority', 'column4', 'prio'],
  nextIntent: ['next intent', 'next_intent', 'nextintent', 'column5', 'follow up intent'],
  nextIntentPhrases: [
    'next intent phrases',
    'nextintentphrases',
    'next intent training phrases',
    'column6',
  ],
  events: ['events', 'event', 'event names', 'eventnames', 'column7'],
  action: ['action', 'column8'],
  parameters: ['parameters', 'parameter', 'params', 'column9'],
  inputContexts: [
    'input contexts',
    'input context',
    'inputcontexts',
    'in contexts',
    'column10',
  ],
  outputContexts: [
    'output contexts',
    'output context',
    'outputcontexts',
    'out contexts',
    'column11',
  ],
};

function normalizeHeader(cell) {
  return String(cell || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (aliases.includes(norm)) map[field] = idx;
    });
  });
  return map;
}

function hasRequiredHeaders(map) {
  return map.intent != null && map.response != null;
}

function rowToItem(row, map) {
  const intent = String(row[map.intent] ?? '').trim();
  const response = String(row[map.response] ?? '').trim();
  const synonyms =
    map.synonyms != null ? String(row[map.synonyms] ?? '').trim() : '';
  const priority =
    map.priority != null ? String(row[map.priority] ?? '').trim() : '0';
  const nextIntent =
    map.nextIntent != null ? String(row[map.nextIntent] ?? '').trim() : '';
  const nextIntentPhrases =
    map.nextIntentPhrases != null
      ? String(row[map.nextIntentPhrases] ?? '').trim()
      : '';
  const events = map.events != null ? String(row[map.events] ?? '').trim() : '';
  const action = map.action != null ? String(row[map.action] ?? '').trim() : '';
  const parameters =
    map.parameters != null ? String(row[map.parameters] ?? '').trim() : '';
  const inputContexts =
    map.inputContexts != null ? String(row[map.inputContexts] ?? '').trim() : '';
  const outputContexts =
    map.outputContexts != null ? String(row[map.outputContexts] ?? '').trim() : '';
  if (!intent || !response) return null;
  return {
    intent,
    synonyms,
    response,
    priority,
    nextIntent,
    nextIntentPhrases,
    events,
    action,
    parameters,
    inputContexts,
    outputContexts,
    published: true,
  };
}

function parseSheetRows(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) return { ok: false, error: 'Sheet is empty' };

  let headerIdx = -1;
  let map = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const candidate = mapHeaders(rows[i]);
    if (hasRequiredHeaders(candidate)) {
      headerIdx = i;
      map = candidate;
      break;
    }
  }
  if (headerIdx < 0 || !map) {
    return {
      ok: false,
      error: 'Could not find headers (Intent, synonyms, Response) in sheet',
    };
  }

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((c) => String(c || '').trim())) continue;
    const item = rowToItem(row, map);
    if (item) items.push(item);
  }
  if (!items.length) {
    return { ok: false, error: 'No data rows found below header' };
  }
  return { ok: true, items, headerRow: headerIdx + 1 };
}

function listSheetNames(workbook) {
  return (workbook.SheetNames || []).slice();
}

function parseWorkbook(buffer, sheetName) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    return { ok: false, error: 'Could not read Excel file: ' + err.message };
  }

  const names = listSheetNames(workbook);
  if (!names.length) {
    return { ok: false, error: 'Workbook has no sheets' };
  }

  const requested = String(sheetName || '').trim();
  let targetName = requested;
  let autoDetected = false;

  if (requested) {
    const match = names.find(
      (n) => n.toLowerCase() === requested.toLowerCase()
    );
    if (!match) {
      return {
        ok: false,
        error: 'Sheet "' + requested + '" not found. Available: ' + names.join(', '),
        sheetNames: names,
      };
    }
    targetName = match;
  } else {
    for (const name of names) {
      const parsed = parseSheetRows(workbook.Sheets[name]);
      if (parsed.ok) {
        targetName = name;
        autoDetected = true;
        return {
          ok: true,
          sheetName: targetName,
          autoDetected,
          sheetNames: names,
          items: parsed.items,
        };
      }
    }
    return {
      ok: false,
      error:
        'No sheet with Intent/Response columns found. Available sheets: ' +
        names.join(', '),
      sheetNames: names,
    };
  }

  const parsed = parseSheetRows(workbook.Sheets[targetName]);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, sheetNames: names };
  }
  return {
    ok: true,
    sheetName: targetName,
    autoDetected,
    sheetNames: names,
    items: parsed.items,
  };
}

function previewSheets(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    return { ok: false, error: 'Could not read Excel file: ' + err.message };
  }
  const names = listSheetNames(workbook);
  const sheets = names.map((name) => {
    const parsed = parseSheetRows(workbook.Sheets[name]);
    return {
      name,
      valid: parsed.ok,
      rowCount: parsed.ok ? parsed.items.length : 0,
      error: parsed.ok ? null : parsed.error,
    };
  });
  return { ok: true, sheetNames: names, sheets };
}

const EXPORT_HEADERS = ['Intent', 'Response'];
const DEFAULT_SHEET_NAME = 'Q&A provision';

function formatSynonymsForExport(synonyms) {
  if (Array.isArray(synonyms)) return synonyms.join(', ');
  return String(synonyms || '');
}

function sanitizeSheetTabName(name) {
  const raw = String(name || DEFAULT_SHEET_NAME).trim() || DEFAULT_SHEET_NAME;
  return raw.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || DEFAULT_SHEET_NAME;
}

function buildExportBuffer(items, sheetName) {
  const qaProvisionStore = require('./qa-provision-store');
  const rows = [
    EXPORT_HEADERS,
    ...(items || []).map((item) => [
      String(item.intent || ''),
      String(qaProvisionStore.effectiveResponse_(item) || item.response || ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetTabName(sheetName));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  parseWorkbook,
  previewSheets,
  buildExportBuffer,
  DEFAULT_SHEET_NAME,
};
