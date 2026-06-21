/**
 * @deprecated Use social-integration-store — kept for WhatsApp-specific imports.
 */
const social = require('./social-integration-store');

const CHANNEL = 'whatsapp';

module.exports = {
  FILE_NAME: social.FILE_NAME,
  PROVIDER_IDS: social.getProviderIds(CHANNEL),
  PROVIDER_SCHEMAS: social.CHANNEL_SCHEMAS[CHANNEL].providers,
  BOT_FIELD_SCHEMA: social.CHANNEL_SCHEMAS[CHANNEL].botFields.concat([
    { key: 'botId', label: 'Bot ID', placeholder: '10002', hint: '5-digit bot ID.' },
  ]),
  readBotConfig: (botId) => social.readChannelConfig(botId, CHANNEL),
  saveBotConfig: (botId, patch) => social.saveChannelConfig(botId, CHANNEL, patch),
  getPublicView: (botId, publicBaseUrl) =>
    social.getChannelView(botId, CHANNEL, publicBaseUrl),
  validateBotId: social.validateBotId,
  isBotConfigured: (cfg) => social.isChannelConfigured(cfg, CHANNEL),
  readConfig: () => social.readChannelConfig('10002', CHANNEL),
  saveConfig: (patch) => {
    const bid = (patch && patch.bot && patch.bot.botId) || '10002';
    return social.saveChannelConfig(bid, CHANNEL, patch);
  },
  defaultBotConfig: (botId) => social.readChannelConfig(botId, CHANNEL),
  defaultConfig: () => social.readChannelConfig('10002', CHANNEL),
};
