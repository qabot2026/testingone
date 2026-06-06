/**
 * Live-agent store for refer-staff sheet sync — backed by Firestore on ES.
 */

const store = { sessions: {} };
let loaded = false;
let loadPromise = null;

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function safeId(id) {
  const s = trim(id);
  if (!s) throw new Error('Invalid conversation id');
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

async function reloadFromFirestore_() {
  const bridge = await import('../live-agent/firestore-bridge.mjs');
  const list = await bridge.listSessionsForLiveAgentSheet({ limit: 500 });
  store.sessions = {};
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    if (s && s.sessionId) store.sessions[s.sessionId] = s;
  }
  loaded = true;
}

function storageReady() {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = reloadFromFirestore_().catch((e) => {
    loadPromise = null;
    throw e;
  });
  return loadPromise;
}

function getSession(sessionId) {
  const key = safeId(sessionId);
  return store.sessions[key] || null;
}

async function getSessionAsync(sessionId) {
  await storageReady();
  const key = safeId(sessionId);
  let s = store.sessions[key] || null;
  if (s && Array.isArray(s.messages) && s.messages.length) return s;
  const bridge = await import('../live-agent/firestore-bridge.mjs');
  s = await bridge.loadSessionForLiveAgentSheet(key);
  if (s) store.sessions[key] = s;
  return s;
}

function listAllSessions() {
  return Object.values(store.sessions).filter(Boolean);
}

function saveStore() {
  /* Firestore is source of truth — sheet2Row persisted via persistSheet2Row. */
}

function persistSheet2Row(sessionId, rowNum) {
  const key = safeId(sessionId);
  const s = store.sessions[key];
  if (s) s.sheet2Row = rowNum;
  import('../live-agent/firestore-bridge.mjs')
    .then((bridge) => bridge.persistSheet2Row_(key, rowNum))
    .catch((e) => {
      console.warn('[live-agent-store] persist sheet2Row:', e.message || e);
    });
}

module.exports = {
  storageReady,
  getSession,
  getSessionAsync,
  listAllSessions,
  saveStore,
  persistSheet2Row,
};
