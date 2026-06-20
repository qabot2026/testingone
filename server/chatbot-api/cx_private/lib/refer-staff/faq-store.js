/**
 * Per-bot FAQ entries — edited from dashboard, matched in /api/chat before Dialogflow.
 */

const fs = require('fs');
const crypto = require('crypto');
const clientPaths = require('./client-paths');
const dataFileSync = require('./data-file-sync');
const sitePresetsStore = require('./site-presets-store');

const FILE_NAME = 'faqs.json';
const FILE_PATH = () => clientPaths.faqsPath();

function readFile_() {
  try {
    if (!fs.existsSync(FILE_PATH())) {
      return { updatedAt: null, bots: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH(), 'utf8'));
    return {
      updatedAt: parsed.updatedAt || null,
      bots: parsed.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
    };
  } catch (err) {
    console.warn('[faq-store] read failed:', err.message);
    return { updatedAt: null, bots: {} };
  }
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

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function ensureBot_(data, botId) {
  if (!data.bots[botId]) data.bots[botId] = { items: [] };
  if (!Array.isArray(data.bots[botId].items)) data.bots[botId].items = [];
}

function listFaqs(botId) {
  const id = normalizeBotId(botId);
  if (!sitePresetsStore.resolveProject(id)) {
    return { ok: false, error: 'Bot not found' };
  }
  const data = readFile_();
  ensureBot_(data, id);
  const items = data.bots[id].items
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return { ok: true, botId: id, items, updatedAt: data.updatedAt };
}

function upsertFaq(botId, payload) {
  const id = normalizeBotId(botId);
  if (!sitePresetsStore.resolveProject(id)) {
    return { ok: false, error: 'Bot not found' };
  }
  const question = String((payload && payload.question) || '').trim();
  const answer = String((payload && payload.answer) || '').trim();
  if (!question) return { ok: false, error: 'Question is required' };
  if (!answer) return { ok: false, error: 'Answer is required' };

  const data = readFile_();
  ensureBot_(data, id);
  const items = data.bots[id].items;
  const faqId = String((payload && payload.id) || '').trim() || crypto.randomUUID();
  const index = items.findIndex((item) => item.id === faqId);
  const prev = index >= 0 ? items[index] : null;
  const next = {
    id: faqId,
    question,
    answer,
    published: payload && payload.published === false ? false : true,
    nextIntentPhrase:
      payload && payload.nextIntentPhrase != null
        ? String(payload.nextIntentPhrase || '').trim()
        : prev
          ? String(prev.nextIntentPhrase || '').trim()
          : '',
    nextIntent:
      payload && payload.nextIntentPhrase != null
        ? ''
        : payload && payload.nextIntent != null
          ? String(payload.nextIntent || '').trim()
          : prev
            ? String(prev.nextIntent || '').trim()
            : '',
    order:
      payload && payload.order != null
        ? Number(payload.order) || 0
        : index >= 0
          ? items[index].order || 0
          : items.length + 1,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) items[index] = next;
  else items.push(next);
  writeFile_(data);
  return { ok: true, botId: id, item: next };
}

function deleteFaq(botId, faqId) {
  const id = normalizeBotId(botId);
  if (!sitePresetsStore.resolveProject(id)) {
    return { ok: false, error: 'Bot not found' };
  }
  const targetId = String(faqId || '').trim();
  if (!targetId) return { ok: false, error: 'FAQ id is required' };

  const data = readFile_();
  ensureBot_(data, id);
  const removed = data.bots[id].items.find((item) => item.id === targetId);
  if (!removed) {
    return { ok: false, error: 'FAQ not found' };
  }
  data.bots[id].items = data.bots[id].items.filter((item) => item.id !== targetId);
  writeFile_(data);
  return {
    ok: true,
    botId: id,
    deletedId: targetId,
    question: removed.question || '',
  };
}

/** Minimum score (0–100) required to return an FAQ instead of Dialogflow. */
const FAQ_MIN_MATCH_SCORE = 90;

function scoreMatch(userText, faq) {
  const userNorm = normalizeText(userText);
  const qNorm = normalizeText(faq.question);
  if (!userNorm || !qNorm) return 0;
  if (userNorm === qNorm) return 100;
  if (userNorm.length >= 8 && (userNorm.includes(qNorm) || qNorm.includes(userNorm))) return 90;

  const userTokens = tokenize(userText);
  const qTokens = tokenize(faq.question);
  if (!userTokens.length || !qTokens.length) return 0;
  let overlap = 0;
  qTokens.forEach((t) => {
    if (userTokens.includes(t)) overlap += 1;
  });
  const ratio = overlap / Math.max(qTokens.length, 1);
  if (ratio >= 0.75) return 70 + Math.round(ratio * 20);
  if (ratio >= 0.5) return 50 + Math.round(ratio * 20);
  return 0;
}

function matchFaq(botId, userText) {
  const id = normalizeBotId(botId);
  const data = readFile_();
  ensureBot_(data, id);
  const items = (data.bots[id].items || []).filter(
    (item) => item && item.published !== false
  );
  let best = null;
  let bestScore = 0;
  items.forEach((item) => {
    const score = scoreMatch(userText, item);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  if (!best || bestScore < FAQ_MIN_MATCH_SCORE) return null;
  return { item: best, score: bestScore };
}

function hasPublishedFaqMatch(botId, userText) {
  const id = normalizeBotId(botId);
  if (!id) return false;
  const data = readFile_();
  ensureBot_(data, id);
  const items = (data.bots[id].items || []).filter(
    (item) => item && item.published !== false
  );
  for (let i = 0; i < items.length; i += 1) {
    if (scoreMatch(userText, items[i]) >= FAQ_MIN_MATCH_SCORE) return true;
  }
  return false;
}

module.exports = {
  listFaqs,
  upsertFaq,
  deleteFaq,
  matchFaq,
  hasPublishedFaqMatch,
  FAQ_MIN_MATCH_SCORE,
};
