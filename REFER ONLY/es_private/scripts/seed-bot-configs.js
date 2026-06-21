const botConfigFiles = require('../lib/bot-config-files');
const registry = require('../client-based/data/bot-registry.json');

const sitePresets = {
  receptionist: {
    common: {
      header: { title: 'Receptionist', subtitle: 'We are online to assist you' },
      botPersona: { label: 'Reception', mode: 'image', imageUrl: '' },
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
      header: { title: 'Green Valley', subtitle: 'Explore your dream home' },
      botPersona: { label: 'Green Valley', mode: 'image', imageUrl: '' },
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
      header: { title: 'Lake View', subtitle: 'Luxury lakeside living' },
      botPersona: { label: 'Lake View', mode: 'image', imageUrl: '' },
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
      launcherStrip: { enabled: true, text: '🌿 Discover Lake View homes' },
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
      launcherStrip: { enabled: true, text: '🌿 Discover Lake View homes' },
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

registry.bots.forEach(function (bot) {
  const block = sitePresets[bot.sitePreset];
  if (!block) return;
  const path = botConfigFiles.createBotConfigFile(bot, block);
  console.log('created', path);
});

console.log('manifest', botConfigFiles.listConfigFiles());
