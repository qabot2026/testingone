/**
 * ============================================================================
 * FACEBOOK MESSENGER INTEGRATION — YAHAN EDIT KARO
 * ============================================================================
 * Session ID prefix: fb-  (example: fb-1234567890123456)
 *
 * Railway Variables:
 *   META_VERIFY_TOKEN
 *   META_APP_SECRET
 *   FB_PAGE_ACCESS_TOKEN
 *
 * Meta App → Webhook: Page messaging subscribe karo
 * Webhook URL: https://YOUR_DOMAIN/webhooks/meta
 *
 * Setup guide: INSTAGRAM-FACEBOOK-PERMANENT-TOKEN-SETUP.md
 * ============================================================================
 */

const { createMessengerIntegration } = require('./messenger-integration-core');

module.exports = createMessengerIntegration({
  enabled: true,
  sessionPrefix: 'fb',
  channelName: 'Facebook',
  webhookObject: 'page',
  channelKey: 'facebook',
  userIdMetaKey: 'facebookPsid',
  botId: '10002',
  sitePreset: 'greenValley',
});
