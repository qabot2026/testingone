/**
 * Per-bot Google Sheet tab names — stored in bot-registry.json (Supersetting).
 * Agent chats tab: SHEETS_AGENT_TAB on Railway (one tab for all bots).
 *
 * Lead routing:
 * - Green Valley site embed → Green Valley tab
 * - Lake View site embed → Lake View tab
 * - Receptionist embed (incl. GV/LV chosen inside receptionist chat) → Receptionist tab
 */

const DEFAULT_BOT_ID = '10001';
const DEFAULT_SITE_PRESET = 'receptionist';

/** Default tab names for seeded bots (used when sheetTab is empty). */
const DEFAULT_SHEET_TABS = {
  '10001': 'Recep. Chats',
  '10002': 'Green Valley',
  '10003': 'Lake View',
};

function sitePresetsStore() {
  return require('./site-presets-store');
}

function normalizeSheetTab(tab) {
  return String(tab || '').trim();
}

function agentTabName() {
  const env = String(process.env.SHEETS_AGENT_TAB || '').trim();
  if (env) return env;
  try {
    const sheets = require('./sheets');
    return sheets.dashboardTabName();
  } catch {
    return 'Agent Chats';
  }
}

function suggestSheetTabForBot(name) {
  return String(name || '').trim() || 'Bot';
}

function resolveConversationTabForBot(bot) {
  if (!bot) return null;
  const tab = normalizeSheetTab(bot.sheetTab);
  if (tab) return tab;
  const fallback = DEFAULT_SHEET_TABS[bot.id];
  if (fallback) return fallback;
  try {
    const sheets = require('./sheets');
    return sheets.tabName();
  } catch {
    return null;
  }
}

function resolveConversationTabForBotId(botId) {
  return resolveConversationTabForBot(sitePresetsStore().resolveProject(botId));
}

function resolveConversationTabForSitePreset(sitePreset) {
  const key = String(sitePreset || '').trim();
  if (!key) return null;
  const bots = sitePresetsStore().listProjects();
  const bot = bots.find((b) => b.sitePreset === key);
  return resolveConversationTabForBot(bot);
}

/**
 * Which bot owns this lead for sheet routing.
 * Child landing pages (sitePreset greenValley/lakeView) win over default botId 10001.
 */
function resolveSheetBotIdFromMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const sitePreset = String(m.sitePreset || '').trim();

  if (sitePreset && sitePreset !== DEFAULT_SITE_PRESET) {
    const bot = sitePresetsStore()
      .listProjects()
      .find((b) => b.sitePreset === sitePreset);
    if (bot) return bot.id;
  }

  if (m.sheetBotId) {
    return sitePresetsStore().normalizeBotId(m.sheetBotId);
  }
  if (m.botId) {
    return sitePresetsStore().normalizeBotId(m.botId);
  }
  return DEFAULT_BOT_ID;
}

function resolveConversationTabForMeta(meta) {
  return resolveConversationTabForBotId(resolveSheetBotIdFromMeta(meta));
}

const LEGACY_SHEET_TAB_RENAME = {
  Receptionist: 'Recep. Chats',
  'Green Valley Conv.': 'Green Valley',
  'Lake Valley Leads': 'Lake View',
};

function ensureBotSheetTabsOnRegistry_(bots) {
  let changed = false;
  const out = bots.map((b) => {
    const updates = { ...b };
    let rowChanged = false;
    const tab = normalizeSheetTab(b.sheetTab);
    const renamed = LEGACY_SHEET_TAB_RENAME[tab];
    if (renamed && renamed !== tab) {
      updates.sheetTab = renamed;
      rowChanged = true;
    } else if (!tab) {
      const fallback = DEFAULT_SHEET_TABS[b.id];
      if (fallback) {
        updates.sheetTab = fallback;
        rowChanged = true;
      }
    }
    if (rowChanged) changed = true;
    return updates;
  });
  return { bots: out, changed };
}

module.exports = {
  DEFAULT_BOT_ID,
  DEFAULT_SITE_PRESET,
  DEFAULT_SHEET_TABS,
  agentTabName,
  suggestSheetTabForBot,
  normalizeSheetTab,
  resolveConversationTabForBot,
  resolveConversationTabForBotId,
  resolveConversationTabForSitePreset,
  resolveSheetBotIdFromMeta,
  resolveConversationTabForMeta,
  ensureBotSheetTabsOnRegistry_,
};
