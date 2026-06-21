/**
 * Global Q&A provision — one shared sheet for all widget bots (single Dialogflow agent).
 * Chat runtime uses Dialogflow only; this sheet is the dashboard editor (pull → edit → push).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');
const sitePresetsStore = require('./site-presets-store');
const flowPayload = require('./flow-payload');

const FILE_NAME = 'qa-provision.json';
const FILE_PATH = () => clientPaths.qaProvisionPath();
const BACKUPS_FILE = () => path.join(clientPaths.dataDir(), 'qa-provision-backups.json');
/** One Dialogflow agent — all widget projects share this provision bucket. */
const SHARED_PROVISION_KEY = 'shared';
const MAX_BACKUPS = 20;

/** Last 20 live snapshots — kept in memory and persisted for restore. */
let memoryBackups = [];

function loadBackups_() {
  try {
    if (fs.existsSync(BACKUPS_FILE())) {
      const parsed = JSON.parse(fs.readFileSync(BACKUPS_FILE(), 'utf8'));
      memoryBackups = Array.isArray(parsed.backups) ? parsed.backups : [];
    }
  } catch (err) {
    console.warn('[qa-provision-store] backups read failed:', err.message);
    memoryBackups = [];
  }
  memoryBackups = memoryBackups.slice(0, MAX_BACKUPS);
}

function persistBackups_() {
  const dir = clientPaths.dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = BACKUPS_FILE() + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ updatedAt: new Date().toISOString(), backups: memoryBackups }, null, 2),
    'utf8'
  );
  fs.renameSync(tmp, BACKUPS_FILE());
  dataFileSync.scheduleSync('qa-provision-backups.json');
}

function snapshotItems_(items) {
  return (items || []).map((item) => ({
    id: item.id,
    intent: item.intent,
    response: item.response,
    draftResponse: item.draftResponse,
    synonyms: item.synonyms,
    order: item.order,
    updatedAt: item.updatedAt,
  }));
}

function effectiveResponse_(item) {
  if (!item) return '';
  const draft = String(item.draftResponse || '').trim();
  if (draft) return draft;
  return String(item.response || '').trim();
}

function hasDraft_(item) {
  if (!item) return false;
  const draft = String(item.draftResponse || '').trim();
  if (!draft) return false;
  return draft !== String(item.response || '').trim();
}

function createBackup(actor, note) {
  loadBackups_();
  const data = loadProvisionData_();
  const backup = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: String(actor || 'system').slice(0, 120),
    note: String(note || 'Backup').slice(0, 200),
    itemCount: sharedItems_(data).length,
    items: snapshotItems_(sharedItems_(data)),
  };
  memoryBackups.unshift(backup);
  if (memoryBackups.length > MAX_BACKUPS) {
    memoryBackups = memoryBackups.slice(0, MAX_BACKUPS);
  }
  persistBackups_();
  return backup;
}

function listBackups() {
  loadBackups_();
  return {
    ok: true,
    backups: memoryBackups.map((b) => ({
      id: b.id,
      at: b.at,
      actor: b.actor,
      note: b.note,
      itemCount: b.itemCount,
    })),
    maxBackups: MAX_BACKUPS,
  };
}

function restoreBackup(backupId, actor) {
  loadBackups_();
  const targetId = String(backupId || '').trim();
  const backup = memoryBackups.find((b) => b.id === targetId);
  if (!backup) return { ok: false, error: 'Backup not found' };

  createBackup(actor, 'Auto backup before restore');
  const data = loadProvisionData_();
  data.bots[SHARED_PROVISION_KEY].items = (backup.items || []).map((item) => ({
    ...item,
    published: true,
    updatedAt: new Date().toISOString(),
  }));
  writeFile_(data);
  return {
    ok: true,
    restoredId: backup.id,
    restoredAt: backup.at,
    itemCount: (backup.items || []).length,
  };
}

function getBackupItems(backupId) {
  loadBackups_();
  const targetId = String(backupId || '').trim();
  const backup = memoryBackups.find((b) => b.id === targetId);
  if (!backup) return { ok: false, error: 'Backup not found' };
  const items = (backup.items || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    ok: true,
    id: backup.id,
    at: backup.at,
    itemCount: items.length,
    items,
  };
}

function makeLive(actor) {
  loadBackups_();
  const data = loadProvisionData_();
  const items = sharedItems_(data);
  const pending = items.filter((item) => hasDraft_(item));
  if (!pending.length) {
    return { ok: false, error: 'No draft changes to make live.' };
  }

  const backup = createBackup(actor, 'Before make live');
  const promotedItems = [];
  let promoted = 0;
  items.forEach((item) => {
    if (!hasDraft_(item)) return;
    item.response = String(item.draftResponse || '').trim();
    delete item.draftResponse;
    item.liveAt = new Date().toISOString();
    item.updatedAt = item.liveAt;
    promoted += 1;
    promotedItems.push({ ...item });
  });
  writeFile_(data);
  return {
    ok: true,
    promoted,
    backupId: backup.id,
    promotedItems,
    sharedProvision: true,
  };
}

loadBackups_();

function readFile_() {
  try {
    if (!fs.existsSync(FILE_PATH())) {
      return { updatedAt: null, bots: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH(), 'utf8'));
    return {
      updatedAt: parsed.updatedAt || null,
      _sharedProvision: !!parsed._sharedProvision,
      bots: parsed.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
    };
  } catch (err) {
    console.warn('[qa-provision-store] read failed:', err.message);
    return { updatedAt: null, bots: {} };
  }
}

function consolidateSharedProvision_(data) {
  if (!data.bots || typeof data.bots !== 'object') {
    data.bots = {};
  }

  const merged = new Map();

  function considerItem(item) {
    if (!item || !String(item.intent || '').trim()) return;
    const norm = normalizeIntent(item.intent);
    const existing = merged.get(norm);
    if (!existing) {
      merged.set(norm, { ...item });
      return;
    }
    const nextTs = String(item.updatedAt || '');
    const prevTs = String(existing.updatedAt || '');
    if (nextTs >= prevTs) merged.set(norm, { ...item });
  }

  (data.bots[SHARED_PROVISION_KEY]?.items || []).forEach(considerItem);
  Object.keys(data.bots).forEach((key) => {
    if (key === SHARED_PROVISION_KEY) return;
    const bucket = data.bots[key];
    if (!bucket || !Array.isArray(bucket.items)) return;
    bucket.items.forEach(considerItem);
  });

  const items = Array.from(merged.values()).sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );
  data.bots[SHARED_PROVISION_KEY] = { items };
  return items;
}

function loadProvisionData_() {
  const data = readFile_();
  const beforeLen = (data.bots[SHARED_PROVISION_KEY]?.items || []).length;
  consolidateSharedProvision_(data);
  const afterLen = (data.bots[SHARED_PROVISION_KEY]?.items || []).length;
  if (!data._sharedProvision || beforeLen !== afterLen) {
    data._sharedProvision = true;
    writeFile_(data);
  }
  return data;
}

function assertWidgetBot_(_botId) {
  return { ok: true };
}

function sharedItems_(data) {
  ensureBot_(data, SHARED_PROVISION_KEY);
  return data.bots[SHARED_PROVISION_KEY].items;
}

function writeFile_(data) {
  const dir = clientPaths.dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  const tmp = FILE_PATH() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, FILE_PATH());
  dataFileSync.scheduleSync(FILE_NAME);
}

function normalizeBotId(botId) {
  return sitePresetsStore.normalizeBotId(botId);
}

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s?]/g, '');
}

function normalizeIntent(name) {
  return normalizeText(name).replace(/\s+/g, '.');
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function parseSynonyms(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || '').trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureBot_(data, botId) {
  if (!data.bots[botId]) data.bots[botId] = { items: [] };
  if (!Array.isArray(data.bots[botId].items)) data.bots[botId].items = [];
}

function scoreTextMatch(userText, phrase) {
  const userNorm = normalizeText(userText);
  const pNorm = normalizeText(phrase);
  if (!userNorm || !pNorm) return 0;
  if (userNorm === pNorm) return 100;
  if (userNorm.includes(pNorm) || pNorm.includes(userNorm)) return 90;

  const userTokens = tokenize(userText);
  const pTokens = tokenize(phrase);
  if (!userTokens.length || !pTokens.length) return 0;
  let overlap = 0;
  pTokens.forEach((t) => {
    if (userTokens.includes(t)) overlap += 1;
  });
  const ratio = overlap / Math.max(pTokens.length, 1);
  if (ratio >= 0.75) return 70 + Math.round(ratio * 20);
  if (ratio >= 0.5) return 50 + Math.round(ratio * 20);
  return 0;
}

function intentsMatchExact(dfIntent, sheetIntent) {
  const a = normalizeIntent(dfIntent);
  const b = normalizeIntent(sheetIntent);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/\./g, ' ') === b.replace(/\./g, ' ');
}

function intentsMatch(dfIntent, sheetIntent) {
  const a = normalizeIntent(dfIntent);
  const b = normalizeIntent(sheetIntent);
  if (!a || !b) return false;
  if (intentsMatchExact(dfIntent, sheetIntent)) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aFlat = a.replace(/\./g, ' ');
  const bFlat = b.replace(/\./g, ' ');
  if (aFlat.includes(bFlat) || bFlat.includes(aFlat)) return true;

  const aTokens = tokenize(aFlat);
  const bTokens = tokenize(bFlat);
  if (!aTokens.length || !bTokens.length) return false;
  let overlap = 0;
  bTokens.forEach((t) => {
    if (aTokens.includes(t)) overlap += 1;
  });
  const ratio = overlap / Math.max(bTokens.length, aTokens.length, 1);
  return overlap >= 1 && ratio >= 0.5;
}

function parsePayloadBlocks(raw) {
  const blocks = (() => {
    if (Array.isArray(raw)) return flowPayload.normalizeBlocks(raw);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return flowPayload.normalizeBlocks(parsed);
      } catch (_err) {
        return [];
      }
    }
    return [];
  })();
  return blocks.filter((block) => {
    if (!block || block.type !== 'custom') return flowPayload.blockProducesContent(block);
    return flowPayload.isNonemptyPlainObject(block.rawPayload);
  });
}

function hasSheetPayload(item) {
  return parsePayloadBlocks(item && item.payloadBlocks).length > 0;
}

function buildDfFields(row) {
  const source = row || {};
  return {
    events: parseSynonyms(source.events),
    action: String(source.action || '').trim(),
    parameters: String(source.parameters || '').trim(),
    inputContexts: parseSynonyms(source.inputContexts),
    outputContexts: String(source.outputContexts || '').trim(),
  };
}

function formatDfFieldsForExport(item) {
  const df = buildDfFields(item || {});
  return {
    events: df.events.join(', '),
    action: df.action,
    parameters: df.parameters,
    inputContexts: df.inputContexts.join(', '),
    outputContexts: df.outputContexts,
  };
}

function dfTextReplyIsUsable(result) {
  if (!result) return false;
  if (result.intentIsFallback) return false;
  if (typeof result.hasNativeTextReply === 'boolean') {
    return result.hasNativeTextReply;
  }
  if (dfHasPayload(result)) return false;
  const reply = String(result.reply || '').trim();
  if (reply && reply.toLowerCase() !== 'no response.') return true;
  const parts = Array.isArray(result.replyParts) ? result.replyParts : [];
  for (const p of parts) {
    const t = p && p.text ? String(p.text).trim() : '';
    if (t && t.toLowerCase() !== 'no response.') return true;
  }
  return false;
}

function dfHasPayload(result) {
  if (!result) return false;
  return (
    (Array.isArray(result.chips) && result.chips.length > 0) ||
    (Array.isArray(result.forms) && result.forms.length > 0) ||
    (Array.isArray(result.dropdowns) && result.dropdowns.length > 0) ||
    (Array.isArray(result.galleries) && result.galleries.length > 0) ||
    (Array.isArray(result.cardCarousels) && result.cardCarousels.length > 0) ||
    (Array.isArray(result.infoCards) && result.infoCards.length > 0) ||
    (Array.isArray(result.downloads) && result.downloads.length > 0) ||
    !!(result.chipHeading && String(result.chipHeading).trim())
  );
}

function acceptNextIntentResult(result, expectedIntentName, options) {
  if (!result || result.intentIsFallback) return false;
  if (!hasUsableDfContent(result)) return false;
  if (options && options.trustPhrase) return true;
  return resultMatchesNextIntent(result, expectedIntentName);
}

function dfReplyIsUsable(result) {
  if (!result) return false;
  if (result.intentIsFallback) return false;
  const reply = String(result.reply || '').trim();
  if (reply && reply.toLowerCase() !== 'no response.') return true;
  const hasRich =
    (Array.isArray(result.chips) && result.chips.length > 0) ||
    (Array.isArray(result.forms) && result.forms.length > 0) ||
    (Array.isArray(result.dropdowns) && result.dropdowns.length > 0) ||
    (Array.isArray(result.galleries) && result.galleries.length > 0) ||
    (Array.isArray(result.cardCarousels) && result.cardCarousels.length > 0) ||
    (Array.isArray(result.infoCards) && result.infoCards.length > 0);
  return hasRich;
}

function scoreTrainingPhrases(userText, item) {
  const synonyms = parseSynonyms(item.synonyms);
  let best = 0;
  synonyms.forEach((syn) => {
    const score = scoreTextMatch(userText, syn);
    if (score > best) best = score;
  });
  if (!synonyms.length && item && item.intent) {
    best = Math.max(best, scoreTextMatch(userText, item.intent));
  }
  return best;
}

function scoreSynonyms(userText, item) {
  return scoreTrainingPhrases(userText, item);
}

function resultMatchesNextIntent(dfResult, nextIntentName) {
  if (!dfResult || !nextIntentName) return false;
  if (intentsMatchExact(dfResult.intent, nextIntentName)) return true;
  return intentsMatch(dfResult.intent, nextIntentName);
}

function hasUsableDfContent(result) {
  if (!result) return false;
  const reply = String(result.reply || '').trim();
  if (reply && reply.toLowerCase() !== 'no response.') return true;
  return dfHasPayload(result);
}

function isValidNextIntentResult(result, expectedIntentName) {
  if (!result || result.intentIsFallback) return false;
  if (!resultMatchesNextIntent(result, expectedIntentName)) return false;
  return hasUsableDfContent(result);
}

function phraseVariantsFromIntentName(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const norm = normalizeText(raw);
  const variants = [raw, norm];
  if (norm.endsWith('s') && norm.length > 3) {
    variants.push(norm.replace(/s$/, ''));
  } else if (!norm.endsWith('s')) {
    variants.push(norm + 's');
  }
  variants.push('show ' + norm);
  variants.push('tell me about ' + norm);
  return [...new Set(variants.filter(Boolean))];
}

function eventVariantsFromIntentName(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const snake = raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_');
  const upper = snake.toUpperCase();
  const tight = raw.replace(/\s+/g, '');
  const variants = [
    raw,
    snake,
    upper,
    raw.replace(/\s+/g, '_'),
    raw.replace(/\s+/g, '_').toUpperCase(),
    tight,
    tight.toUpperCase(),
    'INTENT_' + upper,
    'NEXT_' + upper,
  ];
  const words = raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const dropPrefixes = new Set(['gv', 'lv', 'bot']);
  let core = words.slice();
  while (core.length && dropPrefixes.has(core[0])) core = core.slice(1);
  if (core.length) {
    variants.push(core.join('_'));
    variants.push(core.join('_').toUpperCase());
  }
  return [...new Set(variants.filter(Boolean))];
}

function resolveNextIntentTrigger(botId, nextIntentName, nextIntentPhrases) {
  const name = String(nextIntentName || '').trim();
  if (!name) return null;

  const data = loadProvisionData_();
  const items = sharedItems_(data).filter((item) => item && item.published !== false);
  const targetRow = items.find(
    (item) =>
      intentsMatchExact(name, item.intent) || intentsMatch(name, item.intent)
  );
  const rowPhrases = targetRow ? parseSynonyms(targetRow.synonyms) : [];
  const explicit = parseSynonyms(nextIntentPhrases);
  const explicitText = explicit.filter((p) => !/^event:/i.test(p));

  return {
    expectedIntent: name,
    explicitPhrases: explicitText,
    textCandidates: [
      ...new Set([
        ...explicitText,
        ...rowPhrases,
        name,
        ...phraseVariantsFromIntentName(name),
      ]),
    ],
  };
}

function listItems(botId) {
  const check = assertWidgetBot_(botId);
  if (!check.ok) return check;
  const data = loadProvisionData_();
  const items = sharedItems_(data)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((item) => ({
      ...item,
      preview: flowPayload.previewLabelForItem(item) || effectiveResponse_(item),
      hasDraft: hasDraft_(item),
    }));
  const draftCount = items.filter((item) => item.hasDraft).length;
  return {
    ok: true,
    items,
    draftCount,
    sharedProvision: true,
    updatedAt: data.updatedAt,
  };
}

function upsertItem(_botId, payload) {
  const check = assertWidgetBot_(_botId);
  if (!check.ok) return check;
  const intent = String((payload && payload.intent) || '').trim();
  const incoming = String((payload && payload.response) || '').trim();
  if (!intent) return { ok: false, error: 'Intent is required' };
  if (!incoming) return { ok: false, error: 'Response text is required' };

  const data = loadProvisionData_();
  const items = sharedItems_(data);
  const itemId =
    String((payload && payload.id) || '').trim() || crypto.randomUUID();
  const index = items.findIndex((item) => item.id === itemId);
  const prev = index >= 0 ? items[index] : null;
  const liveResponse = prev ? String(prev.response || '').trim() : incoming;

  const next = {
    id: itemId,
    intent,
    synonyms: prev ? prev.synonyms || [] : parseSynonyms(payload && payload.synonyms),
    response: liveResponse,
    nextIntent: prev ? prev.nextIntent || '' : '',
    nextIntentPhrases: prev ? prev.nextIntentPhrases || [] : [],
    events: prev ? prev.events || [] : [],
    action: prev ? prev.action || '' : '',
    parameters: prev ? prev.parameters || '' : '',
    inputContexts: prev ? prev.inputContexts || [] : [],
    outputContexts: prev ? prev.outputContexts || '' : '',
    payloadBlocks: prev ? prev.payloadBlocks || [] : [],
    published: true,
    order:
      payload && payload.order != null
        ? Number(payload.order) || 0
        : index >= 0
          ? items[index].order || 0
          : items.length + 1,
    updatedAt: new Date().toISOString(),
  };

  if (incoming !== liveResponse) {
    next.draftResponse = incoming;
  }

  if (index >= 0) items[index] = next;
  else items.push(next);
  writeFile_(data);
  return {
    ok: true,
    item: next,
    sharedProvision: true,
    hasDraft: hasDraft_(next),
    preview: effectiveResponse_(next),
  };
}

function deleteItem(_botId, itemId) {
  const check = assertWidgetBot_(_botId);
  if (!check.ok) return check;
  const targetId = String(itemId || '').trim();
  if (!targetId) return { ok: false, error: 'Item id is required' };

  const data = loadProvisionData_();
  const removed = sharedItems_(data).find((item) => item.id === targetId);
  if (!removed) {
    return { ok: false, error: 'Item not found' };
  }
  data.bots[SHARED_PROVISION_KEY].items = sharedItems_(data).filter(
    (item) => item.id !== targetId
  );
  writeFile_(data);
  return {
    ok: true,
    deletedId: targetId,
    intent: removed.intent || '',
    sharedProvision: true,
  };
}

function replaceItems(_botId, rows, mode) {
  const check = assertWidgetBot_(_botId);
  if (!check.ok) return check;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'No rows to import' };
  }

  const data = loadProvisionData_();
  const existing = sharedItems_(data).slice();
  const importMode = mode === 'merge' ? 'merge' : 'replace';

  // Index the current live rows by normalized intent so an upload can reuse the
  // existing identity/Dialogflow metadata and compare against the live response.
  const existingByIntent = new Map();
  existing.forEach((item) => {
    const norm = normalizeIntent(item.intent);
    if (!existingByIntent.has(norm)) existingByIntent.set(norm, item);
  });

  let items = importMode === 'replace' ? [] : existing.slice();
  let added = 0;
  let updated = 0;
  let drafted = 0;

  rows.forEach((row, idx) => {
    const intent = String(row.intent || '').trim();
    const response = String(row.response || '').trim();
    if (!intent || !response) return;

    const intentNorm = normalizeIntent(intent);
    const prev = existingByIntent.get(intentNorm) || null;
    const rowSynonyms = parseSynonyms(row.synonyms);

    // Live response is whatever is currently published for this intent. Edited
    // uploads stay as drafts (like a single-row Save) and only reach Dialogflow
    // once Make Live is clicked, instead of silently overwriting the live value.
    const liveResponse = prev ? String(prev.response || '').trim() : response;

    const next = {
      id: prev ? prev.id : crypto.randomUUID(),
      intent,
      synonyms: rowSynonyms.length ? rowSynonyms : prev ? prev.synonyms || [] : [],
      response: liveResponse,
      nextIntent: prev ? prev.nextIntent || '' : '',
      nextIntentPhrases: prev ? prev.nextIntentPhrases || [] : [],
      events: prev ? prev.events || [] : [],
      action: prev ? prev.action || '' : '',
      parameters: prev ? prev.parameters || '' : '',
      inputContexts: prev ? prev.inputContexts || [] : [],
      outputContexts: prev ? prev.outputContexts || '' : '',
      payloadBlocks: prev ? prev.payloadBlocks || [] : [],
      published: true,
      order: prev && prev.order ? prev.order : idx + 1,
      updatedAt: new Date().toISOString(),
    };

    if (response !== liveResponse) {
      next.draftResponse = response;
      drafted += 1;
    }

    const existIdx = items.findIndex(
      (item) => normalizeIntent(item.intent) === intentNorm
    );
    if (existIdx >= 0) {
      next.order = items[existIdx].order || next.order;
      items[existIdx] = next;
      updated += 1;
    } else {
      items.push(next);
      added += 1;
    }
  });

  data.bots[SHARED_PROVISION_KEY].items = items;
  writeFile_(data);
  return {
    ok: true,
    added,
    updated,
    drafted,
    total: items.length,
    mode: importMode,
    sharedProvision: true,
  };
}

/**
 * Merge rows pulled from Dialogflow. Preserves nextIntent on existing rows when merging.
 */
function mergeDialogflowPull(_botId, rows, options) {
  const check = assertWidgetBot_(_botId);
  if (!check.ok) return check;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'No Dialogflow intents to import' };
  }

  const opts = options || {};
  const importMode = opts.mode === 'replace' ? 'replace' : 'merge';
  const overwriteResponse = opts.overwriteResponse === true;
  const clearDrafts = opts.clearDrafts === true;
  const pruneMissing = opts.pruneMissing === true;

  const data = loadProvisionData_();
  const existing = sharedItems_(data).slice();
  let items = importMode === 'replace' ? [] : existing.slice();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;

  const pulledIntentNorms = new Set(
    rows
      .map((row) => normalizeIntent(String((row && row.intent) || '').trim()))
      .filter(Boolean)
  );

  rows.forEach((row, idx) => {
    const intent = String(row.intent || '').trim();
    const dfResponse = String(row.response || '').trim();
    const dfSynonyms = parseSynonyms(row.synonyms);
    if (!intent) {
      skipped += 1;
      return;
    }

    const pulledBlocks = parsePayloadBlocks(row.payloadBlocks);
    const response = flowPayload.normalizeProvisionResponse(dfResponse, pulledBlocks);
    const intentNorm = normalizeIntent(intent);
    const existIdx = items.findIndex(
      (item) => normalizeIntent(item.intent) === intentNorm
    );

    if (existIdx >= 0) {
      const prev = items[existIdx];
      const localDraft = hasDraft_(prev);
      const dfFields = buildDfFields(row);
      const prevBlocks = parsePayloadBlocks(prev.payloadBlocks);
      const prevLive = String(prev.response || '').trim();
      const prevLiveClean = flowPayload.isPlaceholderResponse(prevLive) ? '' : prevLive;
      const applyDfResponse = overwriteResponse && (!localDraft || clearDrafts);
      const merged = {
        ...prev,
        intent,
        synonyms: dfSynonyms.length ? dfSynonyms : prev.synonyms,
        response: applyDfResponse ? response : prevLiveClean || response,
        payloadBlocks: pulledBlocks.length
          ? pulledBlocks
          : applyDfResponse
            ? []
            : prevBlocks,
        events: dfFields.events,
        action: dfFields.action,
        parameters: dfFields.parameters,
        inputContexts: dfFields.inputContexts,
        outputContexts: dfFields.outputContexts,
        updatedAt: new Date().toISOString(),
      };
      // Explicit Pull Live Changes only: DF wins over local drafts.
      if (clearDrafts) delete merged.draftResponse;
      items[existIdx] = merged;
      updated += 1;
    } else {
      const dfFields = buildDfFields(row);
      items.push({
        id: crypto.randomUUID(),
        intent,
        synonyms: dfSynonyms,
        response,
        nextIntent: String(row.nextIntent || '').trim(),
        nextIntentPhrases: parseSynonyms(row.nextIntentPhrases),
        events: dfFields.events,
        action: dfFields.action,
        parameters: dfFields.parameters,
        inputContexts: dfFields.inputContexts,
        outputContexts: dfFields.outputContexts,
        payloadBlocks: parsePayloadBlocks(row.payloadBlocks),
        published: row.published !== false,
        order: items.length + 1,
        updatedAt: new Date().toISOString(),
      });
      added += 1;
    }
  });

  if (pruneMissing) {
    const before = items.length;
    items = items.filter((item) =>
      pulledIntentNorms.has(normalizeIntent(String((item && item.intent) || '').trim()))
    );
    removed = Math.max(0, before - items.length);
  }

  data.bots[SHARED_PROVISION_KEY].items = items;
  writeFile_(data);
  return {
    ok: true,
    added,
    updated,
    skipped,
    removed,
    total: items.length,
    mode: importMode,
    sharedProvision: true,
  };
}

/**
 * Match by Dialogflow intent and/or training phrases (synonyms column).
 */
function findItemByIntent(intentName) {
  const intent = String(intentName || '').trim();
  if (!intent) return null;
  const data = loadProvisionData_();
  const items = sharedItems_(data).filter((item) => item && item.published !== false);
  const exact = items.find((item) => intentsMatchExact(intent, item.intent));
  if (exact) return exact;
  return items.find((item) => intentsMatch(intent, item.intent)) || null;
}

/** Best published row for an intent — prefers payload blocks over text-only duplicates. */
function findRichestItemByIntent(intentName) {
  const intent = String(intentName || '').trim();
  if (!intent) return null;
  const data = readFile_();
  const all = [];
  if (data.bots && typeof data.bots === 'object') {
    Object.keys(data.bots).forEach((key) => {
      const bucket = data.bots[key];
      if (bucket && Array.isArray(bucket.items)) all.push(...bucket.items);
    });
  }
  const matches = all.filter(
    (row) => row && row.published !== false && intentsMatchExact(intent, row.intent)
  );
  if (!matches.length) {
    const dataLoaded = loadProvisionData_();
    const items = sharedItems_(dataLoaded).filter((item) => item && item.published !== false);
    return (
      items.find((item) => intentsMatchExact(intent, item.intent)) ||
      items.find((item) => intentsMatch(intent, item.intent)) ||
      null
    );
  }
  const rich = matches.find((row) => hasSheetPayload(row));
  if (rich) return rich;
  return matches.sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  )[0];
}

function resolveItemForChat(dfIntent, userText) {
  const intent = String(dfIntent || '').trim();
  const text = String(userText || '').trim();
  if (intent) {
    const byIntent = findItemByIntent(intent);
    if (byIntent) return byIntent;
  }
  if (text) {
    const hit = matchProvision(null, text, intent);
    if (hit && hit.item) return hit.item;
  }
  if (!intent) return null;
  const data = loadProvisionData_();
  const withPayload = sharedItems_(data).filter(
    (item) => item && item.published !== false && hasSheetPayload(item)
  );
  return withPayload.find((item) => intentsMatch(intent, item.intent)) || null;
}

function matchProvision(botId, userText, dfIntent) {
  const data = loadProvisionData_();
  const items = sharedItems_(data).filter((item) => item && item.published !== false);
  if (!items.length) return null;

  const text = String(userText || '').trim();
  if (!text) return null;

  let best = null;
  let bestScore = 0;
  let bestMatchType = null;

  items.forEach((item) => {
    const phraseScore = scoreTrainingPhrases(text, item);
    const intentAligned = dfIntent ? intentsMatch(dfIntent, item.intent) : false;

    let score = 0;
    let itemMatchType = null;
    if (intentAligned) {
      score = 90 + Math.min(10, Math.round(phraseScore / 10));
      itemMatchType = 'intent';
    } else if (phraseScore >= 50) {
      score = phraseScore;
      itemMatchType = 'training-phrase';
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
      bestMatchType = itemMatchType;
    }
  });

  if (!best || bestScore < 50) return null;
  return {
    item: best,
    score: bestScore,
    matchType: bestMatchType,
  };
}

module.exports = {
  listItems,
  upsertItem,
  deleteItem,
  replaceItems,
  mergeDialogflowPull,
  matchProvision,
  findItemByIntent,
  findRichestItemByIntent,
  resolveItemForChat,
  normalizeBotId,
  SHARED_PROVISION_KEY,
  parsePayloadBlocks,
  hasSheetPayload,
  acceptNextIntentResult,
  resolveNextIntentTrigger,
  isValidNextIntentResult,
  hasUsableDfContent,
  resultMatchesNextIntent,
  parseSynonyms,
  buildDfFields,
  formatDfFieldsForExport,
  dfReplyIsUsable,
  dfTextReplyIsUsable,
  dfHasPayload,
  intentsMatchExact,
  makeLive,
  listBackups,
  restoreBackup,
  getBackupItems,
  createBackup,
  effectiveResponse_,
  hasDraft_,
  MAX_BACKUPS,
};
