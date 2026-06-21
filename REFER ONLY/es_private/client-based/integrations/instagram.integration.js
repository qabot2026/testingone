/**
 * ============================================================================
 * INSTAGRAM DM INTEGRATION — YAHAN EDIT KARO
 * ============================================================================
 * Session ID prefix: ig-  (example: ig-17841400123456789)
 *
 * Railway Variables:
 *   META_VERIFY_TOKEN
 *   META_APP_SECRET
 *   FB_PAGE_ACCESS_TOKEN  (Instagram same Page token use karta hai)
 *   INSTAGRAM_PAGE_ID     (optional)
 *
 * Meta App → Webhook: instagram messaging subscribe karo
 * Webhook URL: https://YOUR_DOMAIN/webhooks/meta
 *
 * Setup guide: INSTAGRAM-FACEBOOK-PERMANENT-TOKEN-SETUP.md
 * ============================================================================
 */

const { createMessengerIntegration } = require('./messenger-integration-core');

module.exports = createMessengerIntegration({
  enabled: true,
  sessionPrefix: 'ig',
  channelName: 'Instagram',
  webhookObject: 'instagram',
  channelKey: 'instagram',
  userIdMetaKey: 'instagramUserId',
  botId: '10002',
  sitePreset: 'greenValley',
});
