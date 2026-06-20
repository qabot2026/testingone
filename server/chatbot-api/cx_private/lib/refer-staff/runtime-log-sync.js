/**
 * Persist append-only runtime logs (audits, API actions) to GCS so they survive Railway redeploys.
 */

const fs = require('fs');
const path = require('path');
const gcsUpload = require('./gcs-upload');
const appEnv = require('./app-env');

const RUNTIME_DIR = path.join(__dirname, '..', 'data');
const GCS_PREFIX = appEnv.GCS_DATA_SYNC_PREFIX.replace(/^\/+|\/+$/g, '');
const RUNTIME_GCS_PREFIX = `${GCS_PREFIX}/runtime`;

const RUNTIME_LOG_FILES = ['audit-log.jsonl', 'api-actions.jsonl'];

const pushTimers = {};

function useGcs() {
  return appEnv.DATA_SYNC_GCS && gcsUpload.isConfigured();
}

function localPath(fileName) {
  return path.join(RUNTIME_DIR, fileName);
}

function ensureDir() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function eventKey(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.changeId) return String(event.changeId);
  return [
    event.at || '',
    event.action || event.method || '',
    event.path || '',
    event.botId || '',
    event.summary || '',
  ].join('|');
}

function queryAnalyticsEventKey(event) {
  if (!event || typeof event !== 'object') return '';
  const queryKey =
    event.queryKey ||
    String(event.query || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 240);
  return [event.sessionId || '', event.at || '', queryKey].join('|');
}

function eventKeyForFile(fileName, event) {
  if (fileName === 'query-analytics.jsonl') return queryAnalyticsEventKey(event);
  return eventKey(event);
}

function mergeJsonlContent(localRaw, remoteRaw, fileName) {
  const map = new Map();
  function ingest(raw) {
    String(raw || '')
      .split('\n')
      .forEach((line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          const key = eventKeyForFile(fileName, event);
          if (!key) return;
          map.set(key, event);
        } catch {
          /* skip bad line */
        }
      });
  }
  ingest(remoteRaw);
  ingest(localRaw);
  const merged = [...map.values()].sort(
    (a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)
  );
  if (!merged.length) return '';
  return merged.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

function readLocal(fileName) {
  ensureDir();
  const file = localPath(fileName);
  if (!fs.existsSync(file)) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function writeLocal(fileName, content) {
  ensureDir();
  const file = localPath(fileName);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content || '', 'utf8');
  fs.renameSync(tmp, file);
}

async function pullRuntimeLog(fileName) {
  if (!RUNTIME_LOG_FILES.includes(fileName)) return false;
  if (!useGcs()) return false;

  const storage = gcsUpload.getStorage();
  if (!storage) return false;

  const objectPath = `${RUNTIME_GCS_PREFIX}/${fileName}`;
  const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return false;

  const [buf] = await file.download();
  const remote = buf.toString('utf8');
  const local = readLocal(fileName);
  const merged = mergeJsonlContent(local, remote, fileName);
  if (merged === local) return true;
  writeLocal(fileName, merged);
  console.log('[runtime-log-sync] merged from GCS', objectPath);
  return true;
}

async function pushRuntimeLog(fileName) {
  if (!RUNTIME_LOG_FILES.includes(fileName)) return false;
  if (!useGcs()) return false;

  const storage = gcsUpload.getStorage();
  if (!storage) return false;

  let local = readLocal(fileName);
  if (!local.trim()) return false;

  const objectPath = `${RUNTIME_GCS_PREFIX}/${fileName}`;
  const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
  try {
    const [exists] = await file.exists();
    if (exists) {
      const [buf] = await file.download();
      const remote = buf.toString('utf8');
      local = mergeJsonlContent(local, remote, fileName);
      if (local !== readLocal(fileName)) writeLocal(fileName, local);
    }
  } catch (err) {
    console.warn('[runtime-log-sync] merge before push skipped:', fileName, err.message);
  }

  await file.save(local, {
    contentType: 'application/x-ndjson',
    resumable: false,
  });
  console.log('[runtime-log-sync] pushed to GCS', objectPath);
  return true;
}

function schedulePush(fileName) {
  if (!RUNTIME_LOG_FILES.includes(fileName)) return;
  if (pushTimers[fileName]) clearTimeout(pushTimers[fileName]);
  pushTimers[fileName] = setTimeout(() => {
    pushTimers[fileName] = null;
    pushRuntimeLog(fileName).catch((err) => {
      console.warn('[runtime-log-sync] push failed:', fileName, err.message);
    });
  }, 2000);
}

async function pullAllOnStartup() {
  if (!useGcs()) return;
  for (const fileName of RUNTIME_LOG_FILES) {
    try {
      await pullRuntimeLog(fileName);
    } catch (err) {
      console.warn('[runtime-log-sync] pull failed:', fileName, err.message);
    }
  }
}

async function pushAllOnStartup() {
  if (!useGcs()) return;
  for (const fileName of RUNTIME_LOG_FILES) {
    try {
      await pushRuntimeLog(fileName);
    } catch (err) {
      console.warn('[runtime-log-sync] startup push failed:', fileName, err.message);
    }
  }
}

module.exports = {
  RUNTIME_LOG_FILES,
  localPath,
  schedulePush,
  pullAllOnStartup,
  pushAllOnStartup,
  pullRuntimeLog,
  pushRuntimeLog,
  mergeJsonlContent,
};
