/**
 * @deprecated Use public/company.config.js — kept for old script tags.
 * Loads company.config if present; otherwise minimal production defaults.
 */
(function () {
  if (window.ES_CHAT_UI_CONFIG) return;
  window.ES_CHAT_UI_CONFIG = {
    common: {
      deploy: {
        publicBaseUrl: 'https://es-based-chatbot-production.up.railway.app',
        embedScript:
          'https://es-based-chatbot-production.up.railway.app/embed.js',
      },
      header: {
        title: 'ES Chatbot',
        subtitle: 'We are online to assist you',
      },
    },
  };
  window.ES_CONFIG = {
    apiBase: window.ES_CHAT_UI_CONFIG.common.deploy.publicBaseUrl,
    embedScript: window.ES_CHAT_UI_CONFIG.common.deploy.embedScript,
  };
})();
