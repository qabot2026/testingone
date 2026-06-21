/** UI/UX config — Receptionist (Bot ID 10001, sitePreset: receptionist) */
(function (g) {
  g.ES_BOT_PRESETS = g.ES_BOT_PRESETS || {};
  g.ES_BOT_PRESETS["receptionist"] = {
  "botId": "10001",
  "name": "Receptionist",
  "welcomeEventName": "",
  "theme": {
    "--es-primary": "#0284c7",
    "--es-primary-dark": "#0369a1",
    "--es-primary-deep": "#075985",
    "--es-accent": "#0ea5e9",
    "--es-accent-light": "#bae6fd",
    "--es-bg": "#e8f4fc",
    "--es-bg-2": "#f7fbff",
    "--es-border": "#dbe5ec",
    "--es-bot-bg": "linear-gradient(168deg, #e8f6ff 0%, #bae6fd 100%)",
    "--es-bot-text": "#0c4a6e",
    "--es-user-bg": "linear-gradient(145deg, #0284c7 0%, #0ea5e9 100%)",
    "--es-user-text": "#f0f9ff",
    "--es-header-bg": "linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #38bdf8 0%, #0284c7 42%, #075985 100%)",
    "--es-shadow": "0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(14, 165, 233, 0.12)",
    "--es-launcher-shadow": "0 3px 10px -2px rgba(14, 165, 233, 0.2)",
    "--es-launcher-shadow-hover": "0 5px 14px -2px rgba(14, 165, 233, 0.28)",
    "--es-ring-color": "#0ea5e9"
  },
  "sitePreset": {
    "common": {
      "header": {
        "title": "Receptionist"
      },
      "botPersona": {
        "label": "Receptionist"
      }
    }
  }
};
})(typeof window !== 'undefined' ? window : this);
