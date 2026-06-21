const fs = require('fs');
const path = require('path');
const botProjectFiles = require('./bot-project-files');
const botConfigFiles = require('./bot-config-files');
const botSheetTabs = require('./bot-sheet-tabs');
const dataFileSync = require('./data-file-sync');
const clientPaths = require('./client-paths');

const DATA_PATH = clientPaths.sitePresetsPath();
const REGISTRY_PATH = clientPaths.registryPath();

/** Seed used only when bot-registry.json is missing */
const BOT_PROJECTS_SEED = {
  '10001': {
    id: '10001',
    sitePreset: 'receptionist',
    name: 'Receptionist',
    welcomeEventName: '',
    themeKey: 'receptionist',
    sheetTab: 'Recep. Chats',
  },
  '10002': {
    id: '10002',
    sitePreset: 'greenValley',
    name: 'Green Valley',
    welcomeEventName: 'START_GREEN_VALLEY',
    themeKey: 'greenValley',
    sheetTab: 'Green Valley',
  },
  '10003': {
    id: '10003',
    sitePreset: 'lakeView',
    name: 'Lake View',
    welcomeEventName: 'START_LAKE_VIEW',
    themeKey: 'lakeView',
    sheetTab: 'Lake View',
  },
};

/** Old URLs only — not shown in UI */
const LEGACY_BOT_IDS = { '001': '10001', '002': '10002', '003': '10003' };

const DEFAULT_SITE_PRESETS = {
  receptionist: {
    common: {
      header: {
        title: 'Receptionist',
        subtitle: 'We are online to assist you',
      },
      botPersona: { label: 'Reception' },
      welcome: { enabled: false },
      features: {
        multiLanguage: { enabled: true },
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
      },
      dialogflow: {
        liveAgent: { enabled: true },
        forms: { enabled: true },
        endChatEvent: { enabled: true, idleTimeoutMs: 10000 },
      },
    },
    desk: {
      launcherStrip: { enabled: true, text: '👋 Welcome! How can we help?' },
      autoOpenChat: { enabled: true, delayMs: 10000 },
      restartButton: { enabled: true },
      poweredBy: { enabled: true },
      features: {
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
        restartChat: { enabled: false },
      },
    },
    mob: {
      launcherStrip: { enabled: true, text: '👋 Welcome! How can we help?' },
      autoOpenChat: { enabled: true, delayMs: 7000 },
      restartButton: { enabled: true },
      poweredBy: { enabled: true },
      features: {
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
        restartChat: { enabled: true },
      },
    },
  },
  greenValley: {
    common: {
      header: {
        title: 'Green Valley',
        subtitle: 'Explore your dream home',
      },
      botPersona: { label: 'Green Valley' },
      welcome: { enabled: false },
      features: {
        multiLanguage: { enabled: false },
        speechToText: { enabled: true },
        composerUpload: { enabled: false },
      },
      dialogflow: {
        liveAgent: { enabled: false },
        forms: { enabled: true },
        endChatEvent: { enabled: true, idleTimeoutMs: 15000 },
      },
    },
    desk: {
      launcherStrip: { enabled: false },
      autoOpenChat: { enabled: true, delayMs: 5000 },
      restartButton: { enabled: true },
      poweredBy: { enabled: false },
      features: {
        speechToText: { enabled: true },
        composerUpload: { enabled: false },
        restartChat: { enabled: false },
      },
    },
    mob: {
      launcherStrip: { enabled: false },
      autoOpenChat: { enabled: true, delayMs: 4000 },
      restartButton: { enabled: true },
      poweredBy: { enabled: false },
      features: {
        speechToText: { enabled: false },
        composerUpload: { enabled: false },
        restartChat: { enabled: true },
      },
    },
  },
  lakeView: {
    common: {
      header: {
        title: 'Lake View',
        subtitle: 'Luxury lakeside living',
      },
      botPersona: { label: 'Lake View' },
      welcome: { enabled: false },
      features: {
        multiLanguage: { enabled: true },
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
      },
      dialogflow: {
        liveAgent: { enabled: true },
        forms: { enabled: true },
        endChatEvent: { enabled: true, idleTimeoutMs: 12000 },
      },
    },
    desk: {
      launcherStrip: {
        enabled: true,
        text: '🌿 Discover Lake View homes',
      },
      autoOpenChat: { enabled: false },
      restartButton: { enabled: true },
      poweredBy: { enabled: true },
      features: {
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
        restartChat: { enabled: false },
      },
    },
    mob: {
      launcherStrip: {
        enabled: true,
        text: '🌿 Discover Lake View homes',
      },
      autoOpenChat: { enabled: false },
      restartButton: { enabled: true },
      poweredBy: { enabled: true },
      features: {
        speechToText: { enabled: true },
        composerUpload: { enabled: true },
        restartChat: { enabled: true },
      },
    },
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...(base || {}) };
  const o = over || {};
  Object.keys(o).forEach((k) => {
    if (isPlainObject(out[k]) && isPlainObject(o[k])) {
      out[k] = deepMerge(out[k], o[k]);
    } else {
      out[k] = o[k];
    }
  });
  return out;
}

function readRegistryFile_() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) {
      const seedBots = Object.values(BOT_PROJECTS_SEED);
      writeRegistryFile_(seedBots);
      return seedBots;
    }
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const bots = Array.isArray(parsed.bots) ? parsed.bots : [];
    const migrated = botSheetTabs.ensureBotSheetTabsOnRegistry_(bots);
    if (migrated.changed) writeRegistryFile_(migrated.bots);
    return migrated.bots;
  } catch (err) {
    console.warn('[bot-registry] read failed:', err.message);
    return Object.values(BOT_PROJECTS_SEED);
  }
}

function ensureBotSheetTab_(tab) {
  const name = botSheetTabs.normalizeSheetTab(tab);
  if (!name) return Promise.resolve({ ok: false, skipped: true });
  try {
    const sheets = require('./sheets');
    const conversationSheet = require('./conversation-sheet');
    if (!sheets.isConfigured()) return Promise.resolve({ ok: false, skipped: true });
    return sheets
      .ensureTabExists(name)
      .then(() =>
        sheets.ensureHeaderRowOnTab(name, conversationSheet.SHEET_HEADERS)
      )
      .then(() => ({ ok: true, tab: name }))
      .catch((err) => {
        console.warn('[site-presets] sheet tab ensure failed:', err.message);
        return { ok: false, error: err.message };
      });
  } catch (err) {
    return Promise.resolve({ ok: false, error: err.message });
  }
}

function listSyncedPathsForBot_(bot) {
  if (!bot || !bot.sitePreset) return [];
  const sp = bot.sitePreset;
  return [
    'es_private/client-based/data/bot-registry.json',
    'es_private/client-based/data/site-presets.json',
    `es_public/client-based/bot-configs/${sp}.config.js`,
    `es_public/client-based/bot-settings/${bot.id}.html`,
    `es_public/client-based/pages/${botProjectFiles.demoFileName(bot.name, bot.id)}`,
  ];
}

function writeRegistryFile_(bots, opts) {
  opts = opts || {};
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ bots, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  fs.renameSync(tmp, REGISTRY_PATH);
  let overrides = readOverrides_();
  if (opts.syncBotId) {
    const bot = bots.find((b) => b.id === opts.syncBotId);
    if (bot) {
      overrides = syncBotDerivedFiles_(bot, overrides, { batch: true }) || overrides;
    }
  } else {
    bots.forEach((bot) => {
      overrides = syncBotDerivedFiles_(bot, overrides, { batch: true }) || overrides;
    });
  }
  writeOverrides_(overrides);
  void dataFileSync.pushRegistryNow().catch((err) => {
    console.error('[bot-registry] GitHub sync failed:', err.message);
  });
}

function syncBotDerivedFiles_(bot, overrides, opts) {
  opts = opts || {};
  if (!bot || !bot.sitePreset) return overrides;
  try {
    botConfigFiles.syncFromRegistry(bot);
    botProjectFiles.syncFromRegistry(bot);
    const o = overrides || readOverrides_();
    const key = bot.sitePreset;
    if (!o[key]) o[key] = {};
    if (!o[key].common) o[key].common = {};
    if (!o[key].common.header) o[key].common.header = {};
    if (!o[key].common.botPersona) o[key].common.botPersona = {};
    o[key].common.header.title = bot.name;
    o[key].common.botPersona.label = bot.name;
    if (!opts.batch) writeOverrides_(o);
    return o;
  } catch (err) {
    console.warn('[bot-registry] sync derived files failed:', bot.id, err.message);
    return overrides;
  }
}

/** Push bot-registry.json names into bot-config, bot-settings, and site-presets. */
function syncAllBotsFromRegistry() {
  const bots = readRegistryFile_();
  let overrides = readOverrides_();
  bots.forEach((bot) => {
    overrides = syncBotDerivedFiles_(bot, overrides, { batch: true }) || overrides;
  });
  writeOverrides_(overrides);
  return { ok: true, count: bots.length };
}

function toSitePresetKey(name, botId) {
  const parts = String(name || '')
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return 'bot' + String(botId || '').slice(-3);
  const key =
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('');
  return key || 'bot' + String(botId || '').slice(-3);
}

function uniqueSitePresetKey(baseKey, bots) {
  let key = baseKey;
  let n = 2;
  const used = new Set(bots.map((b) => b.sitePreset));
  while (used.has(key)) {
    key = baseKey + n;
    n += 1;
  }
  return key;
}

function cloneDefaultPresetForBot(name) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SITE_PRESETS.receptionist));
  const label = String(name || 'New bot').trim() || 'New bot';
  if (base.common) {
    if (base.common.header) {
      base.common.header.title = label;
      base.common.header.subtitle = 'We are online to assist you';
    }
    if (base.common.botPersona) {
      base.common.botPersona.label = label;
    }
    base.common.welcome = { enabled: true };
    base.common.features = {
      multiLanguage: { enabled: true },
      speechToText: { enabled: true },
      composerUpload: { enabled: true },
    };
    base.common.dialogflow = {
      liveAgent: { enabled: true },
      forms: { enabled: true },
      endChatEvent: { enabled: true, idleTimeoutMs: 10000 },
    };
  }
  if (base.desk) {
    base.desk.showChatbot = true;
    base.desk.launcherStrip = {
      enabled: true,
      text: '👋 Welcome! How can we help?',
    };
    base.desk.autoOpenChat = { enabled: true, delayMs: 10000 };
    base.desk.restartButton = { enabled: true };
    base.desk.poweredBy = { enabled: true };
    base.desk.features = {
      speechToText: { enabled: true },
      composerUpload: { enabled: true },
      restartChat: { enabled: false },
    };
  }
  if (base.mob) {
    base.mob.showChatbot = true;
    base.mob.launcherStrip = {
      enabled: true,
      text: '👋 Welcome! How can we help?',
    };
    base.mob.autoOpenChat = { enabled: true, delayMs: 7000 };
    base.mob.restartButton = { enabled: true };
    base.mob.poweredBy = { enabled: true };
    base.mob.features = {
      speechToText: { enabled: true },
      composerUpload: { enabled: true },
      restartChat: { enabled: true },
    };
  }
  return base;
}

function readOverrides_() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return parsed && typeof parsed.sitePresets === 'object' ? parsed.sitePresets : {};
  } catch (err) {
    console.warn('[site-presets] read failed:', err.message);
    return {};
  }
}

function writeOverrides_(sitePresets) {
  try {
    const existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (JSON.stringify(existing.sitePresets || {}) === JSON.stringify(sitePresets)) {
      return false;
    }
  } catch {
    /* new file */
  }
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ sitePresets, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  fs.renameSync(tmp, DATA_PATH);
  dataFileSync.scheduleSync('site-presets.json');
  return true;
}

function getMergedSitePresets() {
  const overrides = readOverrides_();
  const out = {};
  Object.keys(DEFAULT_SITE_PRESETS).forEach((key) => {
    out[key] = deepMerge(
      DEFAULT_SITE_PRESETS[key],
      overrides[key] || {}
    );
  });
  return out;
}

/** Saved overrides only — merged with company.config.js in the browser */
function getPublicOverrides() {
  return readOverrides_();
}

function listProjects() {
  return readRegistryFile_().map((p) => ({
    ...p,
    settingsPath: `/bid=${p.id}/uiux-setting`,
    botSettingsPath: `/bot-settings/${p.id}.html`,
    configPath: '/bot-configs/' + botConfigFiles.configFileName(p.sitePreset),
    demoPath: '/' + botProjectFiles.demoFileName(p.name, p.id),
  }));
}

function normalizeBotId(botId) {
  const id = String(botId || '').trim();
  return LEGACY_BOT_IDS[id] || id;
}

function resolveProject(botId) {
  const id = normalizeBotId(botId);
  return readRegistryFile_().find((b) => b.id === id) || null;
}

const DEFAULT_BOT_ID = '10001';

function deleteProject(botId) {
  const id = normalizeBotId(botId);
  if (!/^\d{5}$/.test(id)) {
    return { ok: false, error: 'Invalid bot ID' };
  }
  if (id === DEFAULT_BOT_ID) {
    return { ok: false, error: 'Cannot delete the default Receptionist bot (10001)' };
  }

  const bots = readRegistryFile_();
  const index = bots.findIndex((b) => b.id === id);
  if (index < 0) {
    return { ok: false, error: 'Bot not found' };
  }
  if (bots.length <= 1) {
    return { ok: false, error: 'At least one bot must remain' };
  }

  const [removed] = bots.splice(index, 1);
  writeRegistryFile_(bots);
  botProjectFiles.removeForBot(removed);

  const presetKey = removed.sitePreset;
  if (presetKey) {
    const overrides = readOverrides_();
    const stillUsed = bots.some((b) => b.sitePreset === presetKey);
    if (!stillUsed && overrides[presetKey]) {
      delete overrides[presetKey];
      writeOverrides_(overrides);
    }
  }

  return { ok: true, deleted: removed, remaining: bots.length };
}

function addProject({ id, name, welcomeEventName, sheetTab }) {
  const botId = String(id || '').trim();
  const botName = String(name || '').trim();
  const eventName = String(welcomeEventName || '').trim();
  const tabName =
    botSheetTabs.normalizeSheetTab(sheetTab) ||
    botSheetTabs.suggestSheetTabForBot(botName);

  if (!/^\d{5}$/.test(botId)) {
    return { ok: false, error: 'Bot ID must be exactly 5 digits (e.g. 10004)' };
  }
  if (!botName) {
    return { ok: false, error: 'Display name is required' };
  }

  const bots = readRegistryFile_();
  if (bots.some((b) => b.id === botId)) {
    return { ok: false, error: 'Bot ID already exists' };
  }

  const sitePreset = uniqueSitePresetKey(toSitePresetKey(botName, botId), bots);
  const bot = {
    id: botId,
    name: botName,
    sitePreset,
    welcomeEventName: eventName,
    themeKey: sitePreset,
    sheetTab: tabName,
  };

  const overrides = readOverrides_();
  const preset = cloneDefaultPresetForBot(botName);
  overrides[sitePreset] = preset;
  writeOverrides_(overrides);

  bots.push(bot);
  writeRegistryFile_(bots);

  const filesResult = botProjectFiles.createForBot(bot, preset);
  ensureBotSheetTab_(tabName);

  return {
    ok: true,
    bot: {
      ...bot,
      settingsPath: `/bid=${bot.id}/uiux-setting`,
      demoPath: filesResult.demoPath,
      botSettingsPath: filesResult.settingsPath,
      configPath: filesResult.configPath,
    },
    filesCreated: filesResult.files,
  };
}

function getProjectPreset(botId) {
  const project = resolveProject(botId);
  if (!project) return null;
  const overrides = readOverrides_();
  return {
    project,
    preset: overrides[project.sitePreset] || {},
  };
}

function updateProjectSettings(botId, fields) {
  const id = normalizeBotId(botId);
  const patch = fields && typeof fields === 'object' ? fields : {};
  if (!/^\d{5}$/.test(id)) {
    return { ok: false, error: 'Invalid bot ID' };
  }
  const hasSheetTab = patch.sheetTab != null;
  const hasWelcome = patch.welcomeEventName != null;
  const hasName = patch.name != null;
  if (!hasSheetTab && !hasWelcome && !hasName) {
    return { ok: false, error: 'No supported fields to update' };
  }

  const bots = readRegistryFile_();
  const index = bots.findIndex((b) => b.id === id);
  if (index < 0) {
    return { ok: false, error: 'Bot not found' };
  }

  const next = { ...bots[index] };
  if (hasName) {
    const botName = String(patch.name || '').trim();
    if (!botName) {
      return { ok: false, error: 'Display name is required' };
    }
    next.name = botName;
  }
  if (hasSheetTab) {
    const tabName = botSheetTabs.normalizeSheetTab(patch.sheetTab);
    if (!tabName) {
      return { ok: false, error: 'Sheet tab name is required' };
    }
    next.sheetTab = tabName;
  }
  if (hasWelcome) {
    next.welcomeEventName = String(patch.welcomeEventName || '').trim();
  }

  bots[index] = next;
  writeRegistryFile_(bots, { syncBotId: id });
  if (hasSheetTab) ensureBotSheetTab_(next.sheetTab);
  return {
    ok: true,
    bot: next,
    syncedPaths: listSyncedPathsForBot_(next),
  };
}

function updateProjectSheetTab(botId, sheetTab) {
  return updateProjectSettings(botId, { sheetTab });
}

function isLegacyStockIconUrl(url) {
  const s = String(url == null ? '' : url).toLowerCase();
  return (
    !s ||
    s.includes('companybucket/images/cat') ||
    s.includes('/images/cat.png') ||
    s.includes('/images/cat-icon')
  );
}

function syncIconFieldsInPreset_(preset) {
  if (!preset || typeof preset !== 'object') return preset;
  if (!preset.common) preset.common = {};
  if (!preset.common.header) preset.common.header = {};
  const header = preset.common.header;
  let chatIcon = String(header.chatIconUrl || '').trim();
  const headerIcon = String(header.headerIconUrl || '').trim();
  const titleIcon = String(header.chatTitleIconUrl || '').trim();

  if (headerIcon && (isLegacyStockIconUrl(chatIcon) || !chatIcon)) {
    header.chatIconUrl = headerIcon;
    chatIcon = headerIcon;
  }
  if (headerIcon && isLegacyStockIconUrl(titleIcon)) {
    header.chatTitleIconUrl = headerIcon;
  }

  const fallbackIcon = chatIcon || headerIcon;
  ['desk', 'mob'].forEach((branch) => {
    if (!preset[branch]) preset[branch] = {};
    if (!preset[branch].launcher) preset[branch].launcher = {};
    const branchHeader =
      (preset[branch].common && preset[branch].common.header) || header;
    const branchIcon = String(
      (branchHeader && branchHeader.chatIconUrl) || fallbackIcon || ''
    ).trim();
    if (!String(preset[branch].launcher.iconUrl || '').trim() && branchIcon) {
      preset[branch].launcher.iconUrl = branchIcon;
    }
  });
  return preset;
}

function saveProjectPreset(botId, preset) {
  const project = resolveProject(botId);
  if (!project) return { ok: false, error: 'Unknown bot ID' };
  if (!preset || typeof preset !== 'object') {
    return { ok: false, error: 'Invalid preset payload' };
  }
  const overrides = readOverrides_();
  const merged = syncIconFieldsInPreset_(
    deepMerge(overrides[project.sitePreset] || {}, preset)
  );
  if (!merged.common) merged.common = {};
  if (!merged.common.header) merged.common.header = {};
  if (!merged.common.botPersona) merged.common.botPersona = {};

  const titleFromPreset = String(
    (merged.desk &&
      merged.desk.common &&
      merged.desk.common.header &&
      merged.desk.common.header.title) ||
      merged.common.header.title ||
      ''
  ).trim();
  const botName = titleFromPreset || String(project.name || '').trim();
  if (botName) {
    merged.common.header.title = botName;
    merged.common.botPersona.label =
      String(merged.common.botPersona.label || '').trim() || botName;
    if (titleFromPreset && titleFromPreset !== String(project.name || '').trim()) {
      updateProjectSettings(botId, { name: titleFromPreset });
    }
  }
  overrides[project.sitePreset] = merged;
  writeOverrides_(overrides);
  const freshProject = resolveProject(botId) || project;
  return {
    ok: true,
    project: freshProject,
    preset: overrides[project.sitePreset],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  BOT_PROJECTS: BOT_PROJECTS_SEED,
  LEGACY_BOT_IDS,
  DATA_PATH,
  REGISTRY_PATH,
  getMergedSitePresets,
  getPublicOverrides,
  listSyncedPathsForBot_,
  listProjects,
  addProject,
  updateProjectSheetTab,
  updateProjectSettings,
  syncAllBotsFromRegistry,
  deleteProject,
  normalizeBotId,
  resolveProject,
  getProjectPreset,
  saveProjectPreset,
  deepMerge,
};
