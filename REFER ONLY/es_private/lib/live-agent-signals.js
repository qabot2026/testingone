/**
 * Small revision/typing signal file — fast GCS sync vs full sessions blob.
 */

const fs = require('fs');
const path = require('path');
const gcsUpload = require('./gcs-upload');

const SIGNALS_PATH =
  process.env.LIVE_AGENT_SIGNALS_PATH ||
  path.join(__dirname, '..', 'data', 'live-agent-signals.json');
const GCS_OBJECT =
  process.env.GCS_LIVE_AGENT_SIGNALS_OBJECT || 'live-agent/live-agent-signals.json';

let signals = { sessions: {} };
let loaded = false;
let lastPullMs = 0;
const PULL_MIN_MS = Math.max(
  25,
  Number(process.env.LIVE_AGENT_SIGNALS_PULL_MS) || 35
);

function useGcs() {
  return process.env.LIVE_AGENT_GCS !== '0' && gcsUpload.isConfigured();
}

function reloadFromDisk() {
  try {
    if (fs.existsSync(SIGNALS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf8'));
      if (raw && typeof raw.sessions === 'object') {
        signals = raw;
        return;
      }
    }
  } catch (e) {
    console.warn('[live-agent-signals] load failed:', e.message);
  }
  signals = { sessions: {} };
}

function saveToDisk() {
  try {
    const dir = path.dirname(SIGNALS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = SIGNALS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(signals, null, 2), 'utf8');
    fs.renameSync(tmp, SIGNALS_PATH);
  } catch (e) {
    console.warn('[live-agent-signals] save failed:', e.message);
  }
}

async function pullSignals(options) {
  const force = !!(options && options.force);
  const maxAgeMs =
    options && Number.isFinite(options.maxAgeMs)
      ? options.maxAgeMs
      : PULL_MIN_MS;
  const now = Date.now();
  if (!useGcs()) {
    reloadFromDisk();
    loaded = true;
    return;
  }
  if (!force && loaded && now - lastPullMs < maxAgeMs) {
    return;
  }
  try {
    const storage = gcsUpload.getStorage();
    const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
    const file = bucket.file(GCS_OBJECT);
    const [exists] = await file.exists();
    if (exists) {
      const [buf] = await file.download();
      const raw = JSON.parse(buf.toString('utf8'));
      if (raw && typeof raw.sessions === 'object') {
        signals = raw;
        saveToDisk();
      }
    } else if (!loaded) {
      reloadFromDisk();
    }
    loaded = true;
    lastPullMs = now;
  } catch (e) {
    console.warn('[live-agent-signals] pull failed:', e.message);
    reloadFromDisk();
    loaded = true;
  }
}

async function pushSignals() {
  saveToDisk();
  loaded = true;
  if (!useGcs()) return;
  try {
    const storage = gcsUpload.getStorage();
    const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
    const file = bucket.file(GCS_OBJECT);
    await file.save(JSON.stringify(signals, null, 2), {
      contentType: 'application/json',
      resumable: false,
    });
    lastPullMs = Date.now();
  } catch (e) {
    console.warn('[live-agent-signals] push failed:', e.message);
  }
}

function patchSessionSignal(sessionId, patch) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const prev = signals.sessions[id] || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  signals.sessions[id] = next;
  return next;
}

function getSessionSignal(sessionId) {
  const id = String(sessionId || '').trim();
  return id ? signals.sessions[id] || null : null;
}

function syncSignalFromSession(session) {
  if (!session || !session.sessionId) return;
  const msgs = session.messages || [];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  patchSessionSignal(session.sessionId, {
    revision: Number(session.revision) || 0,
    visitorTyping: String(session.visitorTypingText || '').slice(0, 400),
    visitorTypingAt: session.visitorTypingAt || '',
    agentTyping: String(session.agentTypingText || '').slice(0, 400),
    agentTypingAt: session.agentTypingAt || '',
    lastMessageId: last && last.id ? String(last.id) : '',
    lastMessageRole: last && last.role ? String(last.role) : '',
  });
}

module.exports = {
  pullSignals,
  pushSignals,
  patchSessionSignal,
  getSessionSignal,
  syncSignalFromSession,
  useGcs,
};
