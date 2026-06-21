/**
 * Persist chat transcripts to GCS so Customer Questions backfill survives redeploys.
 */

const fs = require('fs');
const path = require('path');
const gcsUpload = require('./gcs-upload');
const appEnv = require('./app-env');

const TRANSCRIPT_DIR = path.join(__dirname, '..', 'data', 'transcripts');
const GCS_PREFIX = appEnv.GCS_DATA_SYNC_PREFIX.replace(/^\/+|\/+$/g, '');
const TRANSCRIPT_GCS_PREFIX = `${GCS_PREFIX}/runtime/transcripts`;

const pushTimer = { all: null };
const pendingSessions = new Set();
let pullInFlight = null;

function useGcs() {
  return appEnv.DATA_SYNC_GCS && gcsUpload.isConfigured();
}

function ensureDir() {
  if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

function localFilePath(name) {
  return path.join(TRANSCRIPT_DIR, name);
}

function gcsObjectPath(name) {
  return `${TRANSCRIPT_GCS_PREFIX}/${name}`;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir();
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function sessionUpdatedAt(doc) {
  const t = Date.parse(String((doc && doc.updatedAt) || ''));
  return Number.isFinite(t) ? t : 0;
}

function mergeSessionDocs(localDoc, remoteDoc) {
  if (!remoteDoc || typeof remoteDoc !== 'object') return localDoc;
  if (!localDoc || typeof localDoc !== 'object') return remoteDoc;
  const localTs = sessionUpdatedAt(localDoc);
  const remoteTs = sessionUpdatedAt(remoteDoc);
  if (remoteTs > localTs) return remoteDoc;
  if (localTs > remoteTs) return localDoc;

  const turnsById = new Map();
  (Array.isArray(remoteDoc.turns) ? remoteDoc.turns : []).forEach((turn) => {
    if (turn && turn.id) turnsById.set(turn.id, turn);
  });
  (Array.isArray(localDoc.turns) ? localDoc.turns : []).forEach((turn) => {
    if (turn && turn.id) turnsById.set(turn.id, turn);
  });
  const turns = [...turnsById.values()].sort(
    (a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0)
  );
  const meta = Object.assign({}, remoteDoc.meta || {}, localDoc.meta || {});
  const updatedAt =
    [localDoc.updatedAt, remoteDoc.updatedAt].sort().reverse()[0] ||
    new Date().toISOString();
  return {
    sessionId: localDoc.sessionId || remoteDoc.sessionId,
    turns,
    meta,
    updatedAt,
    sheetRow: localDoc.sheetRow || remoteDoc.sheetRow,
    sheetRows: Object.assign({}, remoteDoc.sheetRows || {}, localDoc.sheetRows || {}),
  };
}

function mergeIndexDocs(localIndex, remoteIndex) {
  const out = { sessions: {} };
  const locals = (localIndex && localIndex.sessions) || {};
  const remotes = (remoteIndex && remoteIndex.sessions) || {};
  const ids = new Set([...Object.keys(locals), ...Object.keys(remotes)]);
  ids.forEach((sid) => {
    const local = locals[sid];
    const remote = remotes[sid];
    if (!local) {
      out.sessions[sid] = remote;
      return;
    }
    if (!remote) {
      out.sessions[sid] = local;
      return;
    }
    const localTs = Date.parse(local.updatedAt || '') || 0;
    const remoteTs = Date.parse(remote.updatedAt || '') || 0;
    out.sessions[sid] = remoteTs >= localTs ? remote : local;
  });
  return out;
}

async function downloadRemoteJson(name) {
  const storage = gcsUpload.getStorage();
  if (!storage) return null;
  const file = storage.bucket(gcsUpload.BUCKET_NAME).file(gcsObjectPath(name));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

async function uploadJson(name, data) {
  const storage = gcsUpload.getStorage();
  if (!storage) return false;
  const content = JSON.stringify(data, null, 2);
  await storage
    .bucket(gcsUpload.BUCKET_NAME)
    .file(gcsObjectPath(name))
    .save(content, { contentType: 'application/json', resumable: false });
  return true;
}

async function mergeRemoteSessionFile(name) {
  const remoteDoc = await downloadRemoteJson(name);
  if (!remoteDoc) return false;
  const localPath = localFilePath(name);
  const localDoc = readJsonFile(localPath, null);
  const merged = mergeSessionDocs(localDoc, remoteDoc);
  if (JSON.stringify(merged) === JSON.stringify(localDoc)) return false;
  writeJsonFile(localPath, merged);
  return true;
}

async function pullAllOnStartup() {
  if (!useGcs()) return;
  if (pullInFlight) return pullInFlight;

  pullInFlight = (async () => {
    const storage = gcsUpload.getStorage();
    if (!storage) return;
    ensureDir();

    const [files] = await storage.bucket(gcsUpload.BUCKET_NAME).getFiles({
      prefix: `${TRANSCRIPT_GCS_PREFIX}/`,
    });

    let mergedCount = 0;
    for (const file of files) {
      const name = path.basename(file.name);
      if (!name || name.startsWith('.')) continue;
      try {
        const [buf] = await file.download();
        const remote = JSON.parse(buf.toString('utf8'));
        if (name === '_index.json') {
          const local = readJsonFile(localFilePath(name), { sessions: {} });
          const merged = mergeIndexDocs(local, remote);
          if (JSON.stringify(merged) !== JSON.stringify(local)) {
            writeJsonFile(localFilePath(name), merged);
            mergedCount += 1;
          }
          continue;
        }
        if (!name.endsWith('.json')) continue;
        const local = readJsonFile(localFilePath(name), null);
        const merged = mergeSessionDocs(local, remote);
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          writeJsonFile(localFilePath(name), merged);
          mergedCount += 1;
        }
      } catch (err) {
        console.warn('[transcript-sync] pull file failed:', name, err.message);
      }
    }

    if (mergedCount) {
      console.log('[transcript-sync] merged', mergedCount, 'transcript file(s) from GCS');
    }
  })()
    .catch((err) => {
      console.warn('[transcript-sync] startup pull failed:', err.message);
    })
    .finally(() => {
      pullInFlight = null;
    });

  return pullInFlight;
}

async function pushSessionFile(name) {
  if (!useGcs()) return false;
  const localPath = localFilePath(name);
  if (!fs.existsSync(localPath)) return false;

  const localDoc = readJsonFile(localPath, null);
  if (!localDoc) return false;

  if (name === '_index.json') {
    const remote = await downloadRemoteJson(name);
    const merged = mergeIndexDocs(localDoc, remote || { sessions: {} });
    writeJsonFile(localPath, merged);
    await uploadJson(name, merged);
    return true;
  }

  const remoteDoc = await downloadRemoteJson(name);
  const merged = mergeSessionDocs(localDoc, remoteDoc);
  if (JSON.stringify(merged) !== JSON.stringify(localDoc)) {
    writeJsonFile(localPath, merged);
  }
  await uploadJson(name, merged);
  return true;
}

async function flushPendingPush() {
  if (!useGcs()) return;
  const names = new Set(['_index.json', ...pendingSessions]);
  pendingSessions.clear();
  for (const name of names) {
    try {
      await pushSessionFile(name);
    } catch (err) {
      console.warn('[transcript-sync] push failed:', name, err.message);
    }
  }
}

function scheduleSync(sessionId) {
  if (!useGcs()) return;
  if (sessionId) {
    const safe = String(sessionId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 120);
    if (safe) pendingSessions.add(`${safe}.json`);
  }
  if (pushTimer.all) clearTimeout(pushTimer.all);
  pushTimer.all = setTimeout(() => {
    pushTimer.all = null;
    flushPendingPush().catch((err) => {
      console.warn('[transcript-sync] flush failed:', err.message);
    });
  }, 3000);
}

async function pushAllOnStartup() {
  if (!useGcs()) return;
  ensureDir();
  const names = ['_index.json'];
  try {
    names.push(
      ...fs
        .readdirSync(TRANSCRIPT_DIR)
        .filter((name) => name.endsWith('.json') && name !== '_index.json')
    );
  } catch {
    /* ok */
  }
  for (const name of names) {
    try {
      await pushSessionFile(name);
    } catch (err) {
      console.warn('[transcript-sync] startup push failed:', name, err.message);
    }
  }
}

module.exports = {
  scheduleSync,
  pullAllOnStartup,
  pushAllOnStartup,
};
