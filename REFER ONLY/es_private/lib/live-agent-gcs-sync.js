/**
 * Optional GCS persistence for live-agent sessions + settings (shared across Railway instances).
 */

const gcsUpload = require('./gcs-upload');

const OBJECT_PATH =
  process.env.GCS_LIVE_AGENT_OBJECT || 'live-agent/live-agent-sessions.json';
const SETTINGS_OBJECT_PATH =
  process.env.GCS_LIVE_AGENT_SETTINGS_OBJECT ||
  'live-agent/live-agent-settings.json';

function useGcs() {
  return process.env.LIVE_AGENT_GCS !== '0' && gcsUpload.isConfigured();
}

async function pullStore() {
  if (!useGcs()) return null;
  const storage = gcsUpload.getStorage();
  if (!storage) return null;
  const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
  const file = bucket.file(OBJECT_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const raw = JSON.parse(buf.toString('utf8'));
  if (!raw || typeof raw.sessions !== 'object') {
    return { sessions: {} };
  }
  return raw;
}

async function pushStore(store) {
  if (!useGcs() || !store) return false;
  const storage = gcsUpload.getStorage();
  if (!storage) return false;
  const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
  const file = bucket.file(OBJECT_PATH);
  await file.save(JSON.stringify(store, null, 2), {
    contentType: 'application/json',
    resumable: false,
  });
  return true;
}

async function pullSettings() {
  if (!useGcs()) return null;
  const storage = gcsUpload.getStorage();
  if (!storage) return null;
  const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
  const file = bucket.file(SETTINGS_OBJECT_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const raw = JSON.parse(buf.toString('utf8'));
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

async function pushSettings(settings) {
  if (!useGcs() || !settings) return false;
  const storage = gcsUpload.getStorage();
  if (!storage) return false;
  const bucket = storage.bucket(gcsUpload.BUCKET_NAME);
  const file = bucket.file(SETTINGS_OBJECT_PATH);
  await file.save(JSON.stringify(settings, null, 2), {
    contentType: 'application/json',
    resumable: false,
  });
  return true;
}

module.exports = {
  useGcs,
  pullStore,
  pushStore,
  pullSettings,
  pushSettings,
  OBJECT_PATH,
  SETTINGS_OBJECT_PATH,
};
