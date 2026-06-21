/**
 * Live agent knowledge base — canned replies for agents (stored in live-agent-settings.json).
 */

const { randomUUID } = require('crypto');

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeArticle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = trim(raw.title);
  const answer = trim(raw.answer);
  if (!title || !answer) return null;
  return {
    id: trim(raw.id) || randomUUID(),
    title: title.slice(0, 200),
    keywords: trim(raw.keywords).slice(0, 500),
    answer: answer.slice(0, 8000),
    departmentId: trim(raw.departmentId).toLowerCase() || '',
    enabled: raw.enabled !== false,
    updatedAt: trim(raw.updatedAt) || new Date().toISOString(),
  };
}

function normalizeKnowledgeBase(kb) {
  const src = kb && typeof kb === 'object' ? kb : {};
  const articles = Array.isArray(src.articles) ? src.articles : [];
  const out = [];
  const seen = new Set();
  for (const raw of articles) {
    const a = normalizeArticle(raw);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return {
    enabled: src.enabled !== false,
    articles: out,
  };
}

function tokenizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function articleMatchesDepartment(article, departmentId) {
  const dept = trim(departmentId).toLowerCase() || 'general';
  const ad = trim(article.departmentId).toLowerCase();
  if (!ad || ad === 'all') return true;
  return ad === dept;
}

function scoreArticle(article, tokens) {
  if (!tokens.length) return 0;
  const hay = [
    article.title,
    article.keywords,
    article.answer,
  ]
    .join(' ')
    .toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (article.title.toLowerCase().includes(t)) score += 8;
    if (trim(article.keywords).toLowerCase().includes(t)) score += 5;
    if (hay.includes(t)) score += 2;
  }
  return score;
}

function searchKnowledgeBase(kb, { query, departmentId, limit }) {
  const base = normalizeKnowledgeBase(kb);
  if (!base.enabled) return [];
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];
  const max = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const dept = trim(departmentId).toLowerCase() || 'general';
  const hits = base.articles
    .filter((a) => a.enabled && articleMatchesDepartment(a, dept))
    .map((a) => ({ article: a, score: scoreArticle(a, tokens) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((h) => ({
      id: h.article.id,
      title: h.article.title,
      keywords: h.article.keywords,
      answer: h.article.answer,
      departmentId: h.article.departmentId,
      score: h.score,
    }));
  return hits;
}

module.exports = {
  normalizeKnowledgeBase,
  normalizeArticle,
  searchKnowledgeBase,
};
