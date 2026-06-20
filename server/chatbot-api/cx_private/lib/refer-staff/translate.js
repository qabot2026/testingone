/**
 * Bot reply translation — uses Google Cloud Translation (billable, same GCP project).
 * Set GOOGLE_CREDENTIALS_JSON + enable Cloud Translation API on the project.
 */

const { Translate } = require('@google-cloud/translate').v2;

let client = null;
let initError = null;

function loadClient() {
  if (client || initError) return client;
  try {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (raw && String(raw).trim()) {
      const credentials = JSON.parse(String(raw).trim());
      client = new Translate({ credentials });
    } else {
      client = new Translate();
    }
    return client;
  } catch (err) {
    initError = err;
    throw err;
  }
}

function isConfigured() {
  try {
    loadClient();
    return true;
  } catch {
    return false;
  }
}

function normalizeLang(code) {
  const c = String(code || '')
    .trim()
    .toLowerCase();
  if (!c || c === 'en') return 'en';
  return c.split('-')[0];
}

/**
 * @param {string[]} texts
 * @param {string} targetLanguageCode e.g. hi, mr
 * @param {string} [sourceLanguageCode='en']
 * @returns {Promise<string[]>}
 */
async function translateTexts(texts, targetLanguageCode, sourceLanguageCode = 'en') {
  const list = Array.isArray(texts) ? texts : [];
  const target = normalizeLang(targetLanguageCode);
  const source = normalizeLang(sourceLanguageCode);
  if (!list.length) return [];
  if (!target || target === source) return list.map(String);

  const c = loadClient();
  const toTranslate = [];
  const mapIndex = [];

  list.forEach((raw, i) => {
    const t = String(raw == null ? '' : raw);
    if (!t.trim()) {
      mapIndex.push({ i, skip: true, text: t });
    } else {
      mapIndex.push({ i, skip: false, text: t });
      toTranslate.push(t);
    }
  });

  if (!toTranslate.length) return list.map(String);

  const [translations] = await c.translate(toTranslate, {
    from: source,
    to: target,
  });
  const out = list.map(String);
  let j = 0;
  mapIndex.forEach((entry) => {
    if (entry.skip) {
      out[entry.i] = entry.text;
    } else {
      out[entry.i] = translations[j] != null ? String(translations[j]) : entry.text;
      j += 1;
    }
  });
  return out;
}

module.exports = {
  translateTexts,
  isConfigured,
  normalizeLang,
};
