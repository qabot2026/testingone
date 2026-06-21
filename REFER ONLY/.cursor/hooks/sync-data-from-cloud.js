/**
 * Cursor hooks — auto npm install + git pull from origin/main when GitHub is ahead.
 * Runs on sessionStart (always) and beforeSubmitPrompt (throttled).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STAMP_FILE = path.join(__dirname, '..', '.last-git-pull');
const PROMPT_PULL_INTERVAL_MS = 2 * 60 * 1000;

function log(msg) {
  process.stderr.write('[cursor-sync] ' + msg + '\n');
}

function ensureDependencies() {
  const nodeModules = path.join(ROOT, 'node_modules');
  const packageJson = path.join(ROOT, 'package.json');
  const packageLock = path.join(ROOT, 'package-lock.json');
  if (!fs.existsSync(packageJson)) return;

  let needsInstall = !fs.existsSync(nodeModules);
  if (!needsInstall && fs.existsSync(packageLock)) {
    try {
      needsInstall = fs.statSync(packageLock).mtimeMs > fs.statSync(nodeModules).mtimeMs;
    } catch {
      needsInstall = true;
    }
  }
  if (!needsInstall) return;

  try {
    execSync('npm install --no-audit --no-fund', {
      cwd: ROOT,
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch {
    /* offline or npm missing — ignore */
  }
}

function hasBlockingLocalChanges() {
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
    return status
      .split('\n')
      .filter(Boolean)
      .some((line) => {
        const code = line.slice(0, 2);
        return code !== '??' && code.trim() !== '';
      });
  } catch {
    return true;
  }
}

function commitsBehindMain() {
  try {
    execSync('git fetch origin main --quiet', { cwd: ROOT, stdio: 'pipe', windowsHide: true });
    const out = execSync('git rev-list --count HEAD..origin/main', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function pullFromGitHub(force) {
  if (!force && fs.existsSync(STAMP_FILE)) {
    try {
      const last = Number(fs.readFileSync(STAMP_FILE, 'utf8'));
      if (Date.now() - last < PROMPT_PULL_INTERVAL_MS) return { pulled: false, skipped: 'throttled' };
    } catch {
      /* continue */
    }
  }

  const behind = commitsBehindMain();
  if (behind === 0) {
    fs.writeFileSync(STAMP_FILE, String(Date.now()));
    return { pulled: false, behind: 0 };
  }

  if (hasBlockingLocalChanges()) {
    log(
      'GitHub has ' +
        behind +
        ' new commit(s) but local has uncommitted changes — run: git stash && git pull origin main'
    );
    return { pulled: false, behind, blocked: true };
  }

  try {
    execSync('git pull --ff-only origin main', {
      cwd: ROOT,
      stdio: 'pipe',
      windowsHide: true,
    });
    fs.writeFileSync(STAMP_FILE, String(Date.now()));
    log('Pulled ' + behind + ' commit(s) from origin/main');
    return { pulled: true, behind };
  } catch (err) {
    log('git pull failed: ' + (err.message || err));
    return { pulled: false, behind, error: String(err.message || err) };
  }
}

async function pullBotAssetsFromApi() {
  try {
    const dataFileSync = require(path.join(ROOT, 'es_private', 'lib', 'data-file-sync'));
    if (!dataFileSync.useGcs() && !dataFileSync.useGithub()) return;
    await dataFileSync.pullAllForWorkspace();
  } catch {
    /* optional — git pull is the main path for local dev */
  }
}

async function main() {
  const mode = process.argv[2] || 'sessionStart';
  ensureDependencies();
  const force = mode === 'sessionStart';
  pullFromGitHub(force);
  if (force) await pullBotAssetsFromApi();
}

main().catch(() => {});
