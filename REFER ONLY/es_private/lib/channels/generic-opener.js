/**
 * Generic chat openers (Hi, Hello, …) → bot welcome event from registry.
 * Used by channel-chat and all inbound integrations.
 */

const sitePresetsStore = require('../site-presets-store');

const GENERIC_OPENER_RE = /^(hi|hello|hey|hii|hola|namaste|start)$/i;

function isGenericOpener(text) {
  return GENERIC_OPENER_RE.test(String(text || '').trim());
}

function resolveWelcomeEventForBot(botId) {
  const bot = sitePresetsStore.resolveProject(botId);
  if (!bot) return '';
  return String(bot.welcomeEventName || '').trim();
}

module.exports = {
  isGenericOpener,
  resolveWelcomeEventForBot,
};
