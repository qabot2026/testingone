/**
 * WhatsApp upload filename sequence — {phone}_{DDMM}_01, _02, …
 * Local JSON counter (no GCS list API). Bootstraps once from transcript meta.
 */

const fs = require('fs');
const path = require('path');
const chatTranscript = require('./chat-transcript');
const clientPaths = require('./client-paths');

const STORE_PATH = path.join(clientPaths.dataDir(), 'wa-upload-sequences.json');

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (err) {
    console.warn('[wa-upload-seq] load:', err.message);
  }
  return {};
}

function saveStore(store) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[wa-upload-seq] save:', err.message);
  }
}

function collectFilenamesFromMeta(meta) {
  const names = [];
  if (!meta || typeof meta !== 'object') return names;
  if (Array.isArray(meta.uploaded_files)) {
    meta.uploaded_files.forEach((f) => {
      if (f && f.original_name) names.push(String(f.original_name).trim());
    });
  }
  String(meta.document_names || meta.document || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((n) => names.push(n));
  return names;
}

function maxSeqFromNames(names, waNo, dateStr) {
  const re = new RegExp(
    `^${escapeRe(waNo)}_${escapeRe(dateStr)}_(\\d+)`,
    'i'
  );
  let maxSeq = 0;
  for (const name of names) {
    const m = String(name).match(re);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10) || 0);
  }
  return maxSeq;
}

/** Scan transcript files on disk — no GCS API. */
function bootstrapMaxFromTranscripts(waNo, dateStr) {
  const phone = String(waNo || '').replace(/\D/g, '').slice(-10);
  let maxSeq = 0;
  try {
    const index = chatTranscript.loadIndex();
    for (const sid of Object.keys(index.sessions || {})) {
      if (!String(sid).includes(phone)) continue;
      const doc = chatTranscript.getSessionDoc(sid);
      const prev =
        doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
      maxSeq = Math.max(
        maxSeq,
        maxSeqFromNames(collectFilenamesFromMeta(prev), phone, dateStr)
      );
    }
  } catch {
    /* ignore */
  }
  return maxSeq;
}

/**
 * Reserve next _NN for phone+date. Persists to wa-upload-sequences.json.
 * @returns {string} e.g. "01", "02"
 */
function reserveNext(waNo, dateStr) {
  const phone = String(waNo || '').replace(/\D/g, '').slice(-10);
  const date = String(dateStr || '').trim();
  if (!phone || !date) return '01';

  const key = `${phone}_${date}`;
  const bootKey = `_boot_${key}`;
  const store = loadStore();
  let max = Number(store[key]) || 0;

  if (!store[bootKey]) {
    max = Math.max(max, bootstrapMaxFromTranscripts(phone, dateStr));
    store[bootKey] = true;
  }

  const next = max + 1;
  store[key] = next;
  saveStore(store);
  return String(next).padStart(2, '0');
}

module.exports = {
  reserveNext,
};
