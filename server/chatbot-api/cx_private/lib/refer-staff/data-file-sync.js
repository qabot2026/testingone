/**
 * Auto-sync runtime data/ files between Railway, GCS, and GitHub.
 * Also syncs bot public assets (config, settings, demo pages) on registry changes.
 * Triggered on Supersetting save — no manual pull commands needed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const gcsUpload = require('./gcs-upload');
const clientPaths = require('./client-paths');
const appEnv = require('./app-env');
const botProjectFiles = require('./bot-project-files');

const DATA_DIR = clientPaths.dataDir();
const PROJECT_ROOT = clientPaths.PROJECT_ROOT;
const REGISTRY_PATH = clientPaths.registryPath();
const GCS_PREFIX = appEnv.GCS_DATA_SYNC_PREFIX.replace(/^\/+|\/+$/g, '');
const GCS_ASSETS_PREFIX = `${GCS_PREFIX}/assets`;

const BOT_SYNC_MANIFEST = 'bot-sync-manifest.json';
const BOT_CONFIG_MANIFEST = 'cx_public/client-based/bot-configs/manifest.json';

const SYNC_FILES = [
  'bot-registry.json',
  'site-presets.json',
  'faqs.json',
  'qa-provision.json',
  'qa-provision-backups.json',
  'social-integrations.json',
  'whatsapp-integration.json',
  'email-integration.json',
  'email-templates.json',
  'lead-notifications.json',
  'crm-integration.json',
  'phrase-translations.json',
  'query-analytics.jsonl',
  BOT_SYNC_MANIFEST,
];

const JSONL_SYNC_FILES = ['query-analytics.jsonl'];

const GITHUB_REPO = appEnv.GITHUB_REPO;
const GITHUB_BRANCH = appEnv.GITHUB_BRANCH;
const GITHUB_TOKEN = appEnv.GITHUB_TOKEN;

const pendingJsonFiles = new Set();
let needsAssetPush = false;
let fullPushTimer = null;
let pushInFlight = null;
let lastPushError = '';
let syncDisabledLogged = false;

function useGcs() {
  return appEnv.DATA_SYNC_GCS && gcsUpload.isConfigured();
}

function useGithub() {
  return appEnv.DATA_SYNC_GITHUB && !!GITHUB_TOKEN;
}

function syncConfigured() {
  return useGcs() || useGithub();
}

function logSyncDisabledOnce() {
  if (syncDisabledLogged) return;
  syncDisabledLogged = true;
  console.warn(
    '[data-sync] DISABLED — set GITHUB_TOKEN on Railway (and DATA_SYNC_GITHUB=1) to push bots to GitHub.'
  );
  if (!gcsUpload.isConfigured()) {
    console.warn('[data-sync] GCS also unavailable — bot changes stay on server disk only.');
  }
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'es-chatbot-data-sync',
    'Content-Type': 'application/json',
  };
}

function readUpdatedAt(content) {
  try {
    const parsed = JSON.parse(content);
    const ts = Date.parse(String(parsed.updatedAt || ''));
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function isJsonlSyncFile(fileName) {
  return JSONL_SYNC_FILES.includes(fileName);
}

function mergeJsonlPull(fileName, localRaw, remoteRaw) {
  const runtimeLogSync = require('./runtime-log-sync');
  return runtimeLogSync.mergeJsonlContent(localRaw, remoteRaw, fileName);
}

function writeJsonlIfChanged(fileName, localRaw, remoteRaw) {
  const merged = mergeJsonlPull(fileName, localRaw, remoteRaw);
  if (merged === localRaw) return false;
  writeLocalFile(fileName, merged);
  return true;
}

function readLocalRegistryMeta() {
  try {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(content);
    return {
      content,
      updatedAt: String(parsed.updatedAt || ''),
      botCount: Array.isArray(parsed.bots) ? parsed.bots.length : 0,
    };
  } catch {
    return { content: '', updatedAt: '', botCount: 0 };
  }
}

function writeLocalFile(fileName, content) {
  const localPath = path.join(DATA_DIR, fileName);
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = localPath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, localPath);
}

function writeWorkspaceFile(repoPath, content) {
  const localPath = path.join(PROJECT_ROOT, repoPath);
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = localPath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, localPath);
}

function readRegistryBots() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.bots) ? parsed.bots : [];
  } catch {
    return [];
  }
}

function pathsForBot(bot) {
  if (!bot || !bot.id || !bot.sitePreset) return [];
  return [
    `cx_public/client-based/bot-configs/${bot.sitePreset}.config.js`,
    `cx_public/client-based/bot-settings/${bot.id}.html`,
    `cx_public/client-based/pages/${botProjectFiles.demoFileName(bot.name, bot.id)}`,
  ];
}

function buildAssetManifest() {
  const bots = readRegistryBots();
  const paths = new Set([BOT_CONFIG_MANIFEST]);
  bots.forEach((bot) => pathsForBot(bot).forEach((p) => paths.add(p)));
  return {
    paths: [...paths].sort(),
    updatedAt: new Date().toISOString(),
  };
}

function readAssetManifest() {
  const manifestPath = path.join(DATA_DIR, BOT_SYNC_MANIFEST);
  if (!fs.existsSync(manifestPath)) return buildAssetManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(parsed.paths) && parsed.paths.length) return parsed;
  } catch {
    /* fall through */
  }
  return buildAssetManifest();
}

function writeAssetManifest(manifest) {
  const content = JSON.stringify(manifest, null, 2) + '\n';
  writeLocalFile(BOT_SYNC_MANIFEST, content);
  return content;
}

function gcsAssetObjectPath(repoPath) {
  return `${GCS_ASSETS_PREFIX}/${repoPath}`;
}

function scheduleSync(fileName) {
  if (!SYNC_FILES.includes(fileName)) return;
  pendingJsonFiles.add(fileName);
  scheduleFullPush();
}

function scheduleBotAssetsPush() {
  if (!syncConfigured()) {
    logSyncDisabledOnce();
    return;
  }
  needsAssetPush = true;
  scheduleFullPush();
}

function scheduleFullPush() {
  if (!syncConfigured()) return;
  if (fullPushTimer) clearTimeout(fullPushTimer);
  fullPushTimer = setTimeout(() => {
    fullPushTimer = null;
    flushFullPush().catch((err) => {
      console.warn('[data-sync] full push failed:', err.message);
    });
  }, 3000);
}

async function readGithubContent(repoPath) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return null;
  const meta = await res.json();
  return Buffer.from(meta.content || '', 'base64').toString('utf8');
}

/** One GitHub commit for all changed files — avoids multiple Railway deploys. */
async function pushBatchToGithub(changes, message) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) throw new Error('Invalid GITHUB_REPO');

  const treeEntries = [];
  for (const change of changes) {
    if (change.delete) {
      const exists = await readGithubContent(change.path);
      if (exists != null) {
        treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      }
      continue;
    }
    const remote = await readGithubContent(change.path);
    if (remote === change.content) continue;
    treeEntries.push({
      path: change.path,
      mode: '100644',
      type: 'blob',
      content: change.content,
    });
  }

  if (!treeEntries.length) return { ok: true, skipped: true, files: 0 };

  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}`;
  const refRes = await fetch(refUrl, { headers: githubHeaders() });
  if (!refRes.ok) {
    throw new Error(`GitHub ref read: HTTP ${refRes.status} ${await refRes.text()}`);
  }
  const refData = await refRes.json();
  const baseCommitSha = refData.object.sha;

  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
    { headers: githubHeaders() }
  );
  if (!commitRes.ok) {
    throw new Error(`GitHub commit read: HTTP ${commitRes.status}`);
  }
  const commitData = await commitRes.json();

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({
      base_tree: commitData.tree.sha,
      tree: treeEntries,
    }),
  });
  if (!treeRes.ok) {
    throw new Error(`GitHub tree create: HTTP ${treeRes.status} ${await treeRes.text()}`);
  }
  const treeData = await treeRes.json();

  const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!newCommitRes.ok) {
    throw new Error(`GitHub commit create: HTTP ${newCommitRes.status} ${await newCommitRes.text()}`);
  }
  const newCommit = await newCommitRes.json();

  const updateRefRes = await fetch(refUrl, {
    method: 'PATCH',
    headers: githubHeaders(),
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (updateRefRes.status === 422) {
    const retry = await fetch(refUrl, { headers: githubHeaders() });
    if (retry.ok) {
      const latest = await retry.json();
      const retryCommit = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/commits`,
        {
          method: 'POST',
          headers: githubHeaders(),
          body: JSON.stringify({
            message,
            tree: treeData.sha,
            parents: [latest.object.sha],
          }),
        }
      );
      if (retryCommit.ok) {
        const retryData = await retryCommit.json();
        const retryRef = await fetch(refUrl, {
          method: 'PATCH',
          headers: githubHeaders(),
          body: JSON.stringify({ sha: retryData.sha, force: false }),
        });
        if (retryRef.ok) {
          console.log('[data-sync] GitHub batch commit (retry):', treeEntries.length, 'file(s)');
          return { ok: true, files: treeEntries.length };
        }
      }
    }
  }
  if (!updateRefRes.ok) {
    throw new Error(`GitHub ref update: HTTP ${updateRefRes.status} ${await updateRefRes.text()}`);
  }

  console.log('[data-sync] GitHub batch commit:', treeEntries.length, 'file(s)');
  return { ok: true, files: treeEntries.length };
}

async function collectBotAssetChanges() {
  const previous = readAssetManifest();
  const manifest = buildAssetManifest();
  const previousSet = new Set(previous.paths || []);
  const nextSet = new Set(manifest.paths);
  const changes = [];

  for (const repoPath of manifest.paths) {
    const localPath = path.join(PROJECT_ROOT, repoPath);
    if (!fs.existsSync(localPath)) {
      console.warn('[data-sync] skip push (missing locally):', repoPath);
      continue;
    }
    const content = fs.readFileSync(localPath, 'utf8');
    if (useGcs()) {
      try {
        await pushAssetToGcs(repoPath, content);
      } catch (err) {
        console.warn('[data-sync] GCS asset push failed:', repoPath, err.message);
      }
    }
    changes.push({ path: repoPath, content });
  }

  for (const repoPath of previousSet) {
    if (nextSet.has(repoPath) || repoPath === BOT_CONFIG_MANIFEST) continue;
    changes.push({ path: repoPath, delete: true });
  }

  const manifestContent = writeAssetManifest(manifest);
  changes.push({
    path: `cx_private/client-based/data/${BOT_SYNC_MANIFEST}`,
    content: manifestContent,
  });

  return { changes, assetCount: manifest.paths.length };
}

async function pushChangesIndividuallyToGithub(changes, message) {
  let pushed = 0;
  for (const change of changes) {
    if (change.delete) {
      try {
        await deleteFromGithub(change.path, message);
        pushed += 1;
      } catch (err) {
        console.warn('[data-sync] individual delete failed:', change.path, err.message);
      }
      continue;
    }
    const remote = await readGithubContent(change.path);
    if (remote === change.content) continue;
    try {
      await pushToGithub(change.path, change.content, message);
      pushed += 1;
    } catch (err) {
      console.warn('[data-sync] individual push failed:', change.path, err.message);
      throw err;
    }
  }
  return { ok: true, files: pushed };
}

async function buildGithubChangeSet() {
  const githubChanges = [];

  for (const fileName of SYNC_FILES) {
    if (fileName === BOT_SYNC_MANIFEST) continue;
    const localPath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(localPath)) continue;
    const content = fs.readFileSync(localPath, 'utf8');
    if (useGcs()) {
      try {
        await pushToGcs(fileName, content);
      } catch (err) {
        console.warn('[data-sync] GCS push failed:', fileName, err.message);
      }
    }
    if (useGithub()) {
      githubChanges.push({
        path: `cx_private/client-based/data/${fileName}`,
        content,
      });
    }
  }

  const assets = await collectBotAssetChanges();
  if (useGithub()) githubChanges.push(...assets.changes);

  return { githubChanges, assetCount: assets.assetCount };
}

async function pushAllDataToRemotes() {
  if (!useGithub() && !useGcs()) {
    logSyncDisabledOnce();
    return { ok: false, error: 'sync not configured' };
  }

  const { githubChanges, assetCount } = await buildGithubChangeSet();
  let pushedFiles = 0;

  if (useGithub() && githubChanges.length) {
    try {
      const batch = await pushBatchToGithub(
        githubChanges,
        'sync: update bot data from Supersetting'
      );
      pushedFiles = batch.files || 0;
    } catch (err) {
      console.warn('[data-sync] batch push failed, using individual pushes:', err.message);
      const individual = await pushChangesIndividuallyToGithub(
        githubChanges,
        'sync: update bot data from Supersetting'
      );
      pushedFiles = individual.files || 0;
    }
  }

  lastPushError = '';
  return { ok: true, assets: assetCount, pushedFiles };
}

/** Push registry + all bot files to GitHub/GCS immediately (after Supersetting save). */
async function pushRegistryNow() {
  if (!syncConfigured()) {
    logSyncDisabledOnce();
    return { ok: false, error: 'sync not configured' };
  }
  if (pushInFlight) return pushInFlight;
  if (fullPushTimer) {
    clearTimeout(fullPushTimer);
    fullPushTimer = null;
  }
  pendingJsonFiles.clear();
  needsAssetPush = true;

  pushInFlight = (async () => {
    try {
      const result = await pushAllDataToRemotes();
      if (result.pushedFiles > 0) {
        console.log('[data-sync] pushed', result.pushedFiles, 'file(s) to GitHub');
      } else if (useGithub()) {
        console.log('[data-sync] GitHub already up to date');
      }
      return result;
    } catch (err) {
      lastPushError = err.message;
      console.error('[data-sync] pushRegistryNow failed:', err.message);
      throw err;
    } finally {
      pushInFlight = null;
    }
  })();

  return pushInFlight;
}

async function flushFullPush() {
  const githubChanges = [];
  const jsonFiles = [...pendingJsonFiles];
  pendingJsonFiles.clear();

  for (const fileName of jsonFiles) {
    const localPath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(localPath)) continue;
    const content = fs.readFileSync(localPath, 'utf8');
    if (useGcs()) {
      try {
        await pushToGcs(fileName, content);
      } catch (err) {
        console.warn('[data-sync] GCS push failed:', fileName, err.message);
      }
    }
    if (useGithub()) {
      githubChanges.push({
        path: `cx_private/client-based/data/${fileName}`,
        content,
      });
    }
  }

  let assetCount = 0;
  if (needsAssetPush) {
    needsAssetPush = false;
    const assets = await collectBotAssetChanges();
    assetCount = assets.assetCount;
    if (useGithub()) githubChanges.push(...assets.changes);
  }

  if (useGithub() && githubChanges.length) {
    try {
      await pushBatchToGithub(githubChanges, 'sync: update bot data from Supersetting');
    } catch (err) {
      console.warn('[data-sync] debounced batch failed, using individual pushes:', err.message);
      await pushChangesIndividuallyToGithub(
        githubChanges,
        'sync: update bot data from Supersetting'
      );
    }
  }

  return { ok: true, assets: assetCount, githubFiles: githubChanges.length };
}

async function pushToGcs(fileName, content) {
  const storage = gcsUpload.getStorage();
  if (!storage) return;
  const objectPath = `${GCS_PREFIX}/${fileName}`;
  await storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath).save(content, {
    contentType: 'application/json',
    resumable: false,
  });
  console.log('[data-sync] GCS pushed', objectPath);
}

async function pushAssetToGcs(repoPath, content) {
  const storage = gcsUpload.getStorage();
  if (!storage) return;
  const objectPath = gcsAssetObjectPath(repoPath);
  const contentType = repoPath.endsWith('.json')
    ? 'application/json'
    : repoPath.endsWith('.html')
      ? 'text/html'
      : 'text/javascript';
  await storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath).save(content, {
    contentType,
    resumable: false,
  });
  console.log('[data-sync] GCS pushed asset', objectPath);
}

async function pushToGithub(repoPath, content, message) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) throw new Error('Invalid GITHUB_REPO');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  const getRes = await fetch(`${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: githubHeaders(),
  });
  let sha;
  if (getRes.ok) {
    const meta = await getRes.json();
    sha = meta.sha;
    const remote = Buffer.from(meta.content || '', 'base64').toString('utf8');
    if (remote === content) return;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub read ${repoPath}: HTTP ${getRes.status}`);
  }
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    throw new Error(`GitHub write ${repoPath}: HTTP ${putRes.status} ${await putRes.text()}`);
  }
  console.log('[data-sync] GitHub pushed', repoPath);
}

async function deleteFromGithub(repoPath, message) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) throw new Error('Invalid GITHUB_REPO');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  const getRes = await fetch(`${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: githubHeaders(),
  });
  if (getRes.status === 404) return;
  if (!getRes.ok) {
    throw new Error(`GitHub read ${repoPath}: HTTP ${getRes.status}`);
  }
  const meta = await getRes.json();
  const delRes = await fetch(url, {
    method: 'DELETE',
    headers: githubHeaders(),
    body: JSON.stringify({
      message,
      sha: meta.sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!delRes.ok) {
    throw new Error(`GitHub delete ${repoPath}: HTTP ${delRes.status} ${await delRes.text()}`);
  }
  console.log('[data-sync] GitHub deleted', repoPath);
}

async function readRemoteRegistryTimestamp() {
  let remoteTs = 0;

  if (useGcs()) {
    try {
      const storage = gcsUpload.getStorage();
      if (storage) {
        const objectPath = `${GCS_PREFIX}/bot-registry.json`;
        const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
        const [exists] = await file.exists();
        if (exists) {
          const [buf] = await file.download();
          remoteTs = Math.max(remoteTs, readUpdatedAt(buf.toString('utf8')));
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (useGithub()) {
    try {
      const [owner, repo] = GITHUB_REPO.split('/');
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/cx_private/client-based/data/bot-registry.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
      const res = await fetch(url, { headers: githubHeaders() });
      if (res.ok) {
        const meta = await res.json();
        const remote = Buffer.from(meta.content || '', 'base64').toString('utf8');
        remoteTs = Math.max(remoteTs, readUpdatedAt(remote));
      }
    } catch {
      /* ignore */
    }
  }

  return remoteTs;
}

async function pullFromGcs(fileName) {
  const storage = gcsUpload.getStorage();
  if (!storage) return false;
  const objectPath = `${GCS_PREFIX}/${fileName}`;
  const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return false;
  const [buf] = await file.download();
  const remote = buf.toString('utf8');
  const localPath = path.join(DATA_DIR, fileName);
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  if (local === remote) return true;
  if (isJsonlSyncFile(fileName)) {
    if (writeJsonlIfChanged(fileName, local, remote)) {
      console.log('[data-sync] GCS merged jsonl', objectPath);
    }
    return true;
  }
  if (local && readUpdatedAt(remote) < readUpdatedAt(local)) return true;
  writeLocalFile(fileName, remote);
  console.log('[data-sync] GCS pulled', objectPath);
  return true;
}

async function pullAssetFromGcs(repoPath) {
  const storage = gcsUpload.getStorage();
  if (!storage) return false;
  const objectPath = gcsAssetObjectPath(repoPath);
  const file = storage.bucket(gcsUpload.BUCKET_NAME).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) return false;
  const [buf] = await file.download();
  const remote = buf.toString('utf8');
  const localPath = path.join(PROJECT_ROOT, repoPath);
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  if (local === remote) return true;
  writeWorkspaceFile(repoPath, remote);
  console.log('[data-sync] GCS pulled asset', objectPath);
  return true;
}

async function pullFromGithub(fileName) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) return false;
  const repoPath = `cx_private/client-based/data/${fileName}`;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return false;
  const meta = await res.json();
  const remote = Buffer.from(meta.content || '', 'base64').toString('utf8');
  const localPath = path.join(DATA_DIR, fileName);
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  if (local === remote) return true;
  if (isJsonlSyncFile(fileName)) {
    if (writeJsonlIfChanged(fileName, local, remote)) {
      console.log('[data-sync] GitHub merged jsonl', repoPath);
    }
    return true;
  }
  if (local && readUpdatedAt(remote) < readUpdatedAt(local)) return true;
  writeLocalFile(fileName, remote);
  console.log('[data-sync] GitHub pulled', repoPath);
  return true;
}

async function pullRepoPath(repoPath) {
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) return false;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return false;
  const meta = await res.json();
  const remote = Buffer.from(meta.content || '', 'base64').toString('utf8');
  const localPath = path.join(PROJECT_ROOT, repoPath);
  const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  if (local === remote) return true;
  writeWorkspaceFile(repoPath, remote);
  console.log('[data-sync] GitHub pulled', repoPath);
  return true;
}

async function pushAllBotAssets() {
  if (!syncConfigured()) {
    logSyncDisabledOnce();
    return { ok: false, error: 'sync not configured' };
  }
  needsAssetPush = true;
  return flushFullPush();
}

async function pullAllBotAssetsFromGithub() {
  if (!useGithub()) return;
  const manifest = readAssetManifest();
  for (const repoPath of manifest.paths) {
    try {
      await pullRepoPath(repoPath);
    } catch (err) {
      console.warn('[data-sync] bot asset pull failed:', repoPath, err.message);
    }
  }
}

async function pullAllBotAssetsFromGcs() {
  if (!useGcs()) return;
  const manifest = readAssetManifest();
  for (const repoPath of manifest.paths) {
    try {
      await pullAssetFromGcs(repoPath);
    } catch (err) {
      console.warn('[data-sync] GCS asset pull failed:', repoPath, err.message);
    }
  }
}

function restoreBotAssetsFromGit() {
  try {
    execSync('git fetch origin main --quiet', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    execSync(
      'git restore --source=origin/main cx_public/client-based/bot-configs cx_public/client-based/bot-settings',
      { cwd: PROJECT_ROOT, stdio: 'pipe' }
    );
    const manifest = readAssetManifest();
    for (const repoPath of manifest.paths) {
      if (!repoPath.includes('/pages/')) continue;
      try {
        execSync(`git restore --source=origin/main "${repoPath}"`, {
          cwd: PROJECT_ROOT,
          stdio: 'pipe',
        });
      } catch {
        /* page may not exist on remote yet */
      }
    }
    console.log('[data-sync] git restored bot assets from origin/main');
  } catch {
    /* offline or no git remote */
  }
}

async function pullFile(fileName) {
  if (useGcs()) {
    try {
      await pullFromGcs(fileName);
    } catch (err) {
      console.warn('[data-sync] GCS pull failed', fileName, err.message);
    }
  }
  if (useGithub()) {
    try {
      await pullFromGithub(fileName);
    } catch (err) {
      console.warn('[data-sync] GitHub pull failed', fileName, err.message);
    }
  }
}

async function pullAllOnStartup() {
  if (!syncConfigured()) {
    logSyncDisabledOnce();
    return;
  }
  for (const fileName of SYNC_FILES) {
    await pullFile(fileName);
  }
}

async function pushAllIfLocalNewer() {
  if (!syncConfigured()) return { ok: false, pushed: false, reason: 'sync not configured' };

  const local = readLocalRegistryMeta();
  if (!local.content) return { ok: false, pushed: false, reason: 'no local registry' };

  const remoteTs = await readRemoteRegistryTimestamp();
  const localTs = readUpdatedAt(local.content);
  if (localTs <= remoteTs) {
    return { ok: true, pushed: false, reason: 'remote is up to date', localBots: local.botCount };
  }

  console.log(
    '[data-sync] local registry newer — pushing',
    local.botCount,
    'bot(s) to',
    [useGithub() ? 'GitHub' : null, useGcs() ? 'GCS' : null].filter(Boolean).join(' + ')
  );

  return pushAllDataToRemotes().then((result) => ({
    ok: true,
    pushed: true,
    localBots: local.botCount,
    assets: result.assets || 0,
  }));
}

async function pushAllAfterStartup() {
  if (!syncConfigured()) {
    logSyncDisabledOnce();
    return { ok: false, pushed: false, reason: 'sync not configured' };
  }
  const result = await pushAllDataToRemotes();
  if (result.pushedFiles > 0) {
    console.log('[data-sync] startup pushed', result.pushedFiles, 'file(s) to GitHub/GCS');
  }
  return { ok: true, pushed: result.pushedFiles > 0, ...result };
}

async function forcePushAll() {
  if (!syncConfigured()) return { ok: false, error: 'sync not configured — set GITHUB_TOKEN on Railway' };
  return pushAllDataToRemotes();
}

function getSyncStatus() {
  const local = readLocalRegistryMeta();
  return {
    ok: true,
    configured: syncConfigured(),
    github: {
      enabled: useGithub(),
      repo: GITHUB_REPO,
      branch: GITHUB_BRANCH,
      tokenSet: !!GITHUB_TOKEN,
    },
    gcs: {
      enabled: useGcs(),
      bucket: gcsUpload.BUCKET_NAME || null,
    },
    local: {
      botCount: local.botCount,
      registryUpdatedAt: local.updatedAt,
    },
    lastPushError: lastPushError || null,
    hint: !GITHUB_TOKEN
      ? 'Add GITHUB_TOKEN (repo write) to Railway Variables, redeploy, then POST /api/data-sync/push'
      : null,
  };
}

async function pullAllForWorkspace() {
  for (const fileName of SYNC_FILES) {
    await pullFile(fileName);
  }
  if (useGcs()) {
    await pullAllBotAssetsFromGcs();
  } else if (useGithub()) {
    await pullAllBotAssetsFromGithub();
  } else {
    restoreBotAssetsFromGit();
  }
}

module.exports = {
  SYNC_FILES,
  scheduleSync,
  scheduleBotAssetsPush,
  pushRegistryNow,
  pullAllOnStartup,
  pushAllIfLocalNewer,
  pushAllAfterStartup,
  forcePushAll,
  getSyncStatus,
  pullAllForWorkspace,
  useGcs,
  useGithub,
  syncConfigured,
};
