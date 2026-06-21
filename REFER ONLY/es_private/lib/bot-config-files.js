const fs = require('fs');
const path = require('path');
const clientPaths = require('./client-paths');

const BOT_CONFIGS_DIR = clientPaths.botConfigsDir();
const MANIFEST_PATH = path.join(BOT_CONFIGS_DIR, 'manifest.json');

const DEFAULT_THEME = {
  '--es-primary': '#0284c7',
  '--es-primary-dark': '#0369a1',
  '--es-primary-deep': '#075985',
  '--es-accent': '#0ea5e9',
  '--es-accent-light': '#bae6fd',
  '--es-bg': '#e8f4fc',
  '--es-bg-2': '#f7fbff',
  '--es-border': '#dbe5ec',
  '--es-bot-bg': 'linear-gradient(168deg, #e8f6ff 0%, #bae6fd 100%)',
  '--es-bot-text': '#0c4a6e',
  '--es-user-bg': 'linear-gradient(145deg, #0284c7 0%, #0ea5e9 100%)',
  '--es-user-text': '#f0f9ff',
  '--es-header-bg':
    'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #38bdf8 0%, #0284c7 42%, #075985 100%)',
  '--es-shadow':
    '0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(14, 165, 233, 0.12)',
  '--es-launcher-shadow': '0 3px 10px -2px rgba(14, 165, 233, 0.2)',
  '--es-launcher-shadow-hover': '0 5px 14px -2px rgba(14, 165, 233, 0.28)',
  '--es-ring-color': '#0ea5e9',
};

const SEED_THEMES = {
  receptionist: DEFAULT_THEME,
  greenValley: {
    '--es-primary': '#ca8a04',
    '--es-primary-dark': '#a16207',
    '--es-primary-deep': '#854d0e',
    '--es-accent': '#eab308',
    '--es-accent-light': '#fef08a',
    '--es-bg': '#fefce8',
    '--es-bg-2': '#fffbeb',
    '--es-border': '#fde68a',
    '--es-bot-bg': 'linear-gradient(168deg, #fef9c3 0%, #fde047 100%)',
    '--es-bot-text': '#713f12',
    '--es-user-bg': 'linear-gradient(145deg, #ca8a04 0%, #eab308 100%)',
    '--es-user-text': '#fffbeb',
    '--es-header-bg':
      'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #fde047 0%, #ca8a04 42%, #854d0e 100%)',
    '--es-shadow':
      '0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(202, 138, 4, 0.12)',
    '--es-launcher-shadow': '0 3px 10px -2px rgba(202, 138, 4, 0.2)',
    '--es-launcher-shadow-hover': '0 5px 14px -2px rgba(202, 138, 4, 0.28)',
    '--es-ring-color': '#eab308',
  },
  lakeView: {
    '--es-primary': '#16a34a',
    '--es-primary-dark': '#15803d',
    '--es-primary-deep': '#166534',
    '--es-accent': '#22c55e',
    '--es-accent-light': '#bbf7d0',
    '--es-bg': '#f0fdf4',
    '--es-bg-2': '#f7fef9',
    '--es-border': '#bbf7d0',
    '--es-bot-bg': 'linear-gradient(168deg, #dcfce7 0%, #86efac 100%)',
    '--es-bot-text': '#14532d',
    '--es-user-bg': 'linear-gradient(145deg, #16a34a 0%, #22c55e 100%)',
    '--es-user-text': '#f0fdf4',
    '--es-header-bg':
      'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #4ade80 0%, #16a34a 42%, #166534 100%)',
    '--es-shadow':
      '0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(22, 163, 74, 0.12)',
    '--es-launcher-shadow': '0 3px 10px -2px rgba(22, 163, 74, 0.2)',
    '--es-launcher-shadow-hover': '0 5px 14px -2px rgba(22, 163, 74, 0.28)',
    '--es-ring-color': '#22c55e',
  },
};

function writeFileAtomic_(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function configFileName(sitePreset) {
  return sitePreset + '.config.js';
}

function configFilePath(sitePreset) {
  return path.join(BOT_CONFIGS_DIR, configFileName(sitePreset));
}

function renderBotConfigJs(bot, theme, sitePresetBlock) {
  const key = bot.sitePreset;
  const pack = {
    botId: bot.id,
    name: bot.name,
    welcomeEventName: bot.welcomeEventName || '',
    theme: theme || DEFAULT_THEME,
    sitePreset: sitePresetBlock,
  };
  const json = JSON.stringify(pack, null, 2);
  return (
    '/** UI/UX config — ' +
    bot.name +
    ' (Bot ID ' +
    bot.id +
    ', sitePreset: ' +
    key +
    ') */\n' +
    '(function (g) {\n' +
    "  g.ES_BOT_PRESETS = g.ES_BOT_PRESETS || {};\n" +
    '  g.ES_BOT_PRESETS[' +
    JSON.stringify(key) +
    '] = ' +
    json +
    ';\n' +
    "})(typeof window !== 'undefined' ? window : this);\n"
  );
}

function readManifest_() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return { configs: [], updatedAt: null };
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    console.warn('[bot-config-files] manifest read failed:', err.message);
    return { configs: [], updatedAt: null };
  }
}

function writeManifest_(configs) {
  writeFileAtomic_(
    MANIFEST_PATH,
    JSON.stringify(
      {
        configs: configs.slice().sort(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function addToManifest_(sitePreset) {
  const file = configFileName(sitePreset);
  const manifest = readManifest_();
  if (!manifest.configs.includes(file)) {
    manifest.configs.push(file);
    writeManifest_(manifest.configs);
  }
}

function removeFromManifest_(sitePreset) {
  const file = configFileName(sitePreset);
  const manifest = readManifest_();
  writeManifest_(manifest.configs.filter((f) => f !== file));
}

function readBotConfigPack(sitePreset) {
  const filePath = configFilePath(sitePreset);
  if (!fs.existsSync(filePath)) return null;
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    const m = src.match(/ES_BOT_PRESETS\[[^\]]+\]\s*=\s*(\{[\s\S]*\})\s*;/);
    if (!m) return null;
    return JSON.parse(m[1]);
  } catch (err) {
    console.warn('[bot-config-files] read failed:', sitePreset, err.message);
    return null;
  }
}

function patchSitePresetDisplayName(sitePresetBlock, botName) {
  const label = String(botName || '').trim();
  if (!label || !sitePresetBlock || typeof sitePresetBlock !== 'object') {
    return sitePresetBlock;
  }
  const out = JSON.parse(JSON.stringify(sitePresetBlock));
  if (!out.common) out.common = {};
  if (!out.common.header) out.common.header = {};
  if (!out.common.botPersona) out.common.botPersona = {};
  out.common.header.title = label;
  out.common.botPersona.label = label;
  return out;
}

/** Keep public bot-config JS in sync with bot-registry.json (name, welcome event). */
function syncFromRegistry(bot) {
  if (!bot || !bot.sitePreset) return { ok: false, skipped: true };
  const existing = readBotConfigPack(bot.sitePreset) || {};
  const theme =
    existing.theme || SEED_THEMES[bot.sitePreset] || DEFAULT_THEME;
  const sitePresetBlock = patchSitePresetDisplayName(
    existing.sitePreset || {},
    bot.name
  );
  const filePath = configFilePath(bot.sitePreset);
  writeFileAtomic_(
    filePath,
    renderBotConfigJs(
      {
        id: bot.id,
        sitePreset: bot.sitePreset,
        name: bot.name,
        welcomeEventName: bot.welcomeEventName || '',
      },
      theme,
      sitePresetBlock
    )
  );
  addToManifest_(bot.sitePreset);
  return { ok: true, configPath: '/bot-configs/' + configFileName(bot.sitePreset) };
}

function createBotConfigFile(bot, sitePresetBlock) {
  const theme = SEED_THEMES[bot.sitePreset] || DEFAULT_THEME;
  const block = patchSitePresetDisplayName(sitePresetBlock || {}, bot.name);
  writeFileAtomic_(
    configFilePath(bot.sitePreset),
    renderBotConfigJs(bot, theme, block)
  );
  addToManifest_(bot.sitePreset);
  return '/bot-configs/' + configFileName(bot.sitePreset);
}

function removeBotConfigFile(bot) {
  const filePath = configFilePath(bot.sitePreset);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[bot-config-files] unlink failed:', err.message);
  }
  removeFromManifest_(bot.sitePreset);
  return '/bot-configs/' + configFileName(bot.sitePreset);
}

function listConfigFiles() {
  return readManifest_().configs || [];
}

module.exports = {
  BOT_CONFIGS_DIR,
  MANIFEST_PATH,
  DEFAULT_THEME,
  SEED_THEMES,
  configFileName,
  configFilePath,
  renderBotConfigJs,
  readBotConfigPack,
  patchSitePresetDisplayName,
  syncFromRegistry,
  createBotConfigFile,
  removeBotConfigFile,
  listConfigFiles,
  readManifest_,
  writeManifest_,
};
