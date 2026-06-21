/** UI/UX config — Green Valley (Bot ID 10002, sitePreset: greenValley) */
(function (g) {
  g.ES_BOT_PRESETS = g.ES_BOT_PRESETS || {};
  g.ES_BOT_PRESETS["greenValley"] = {
  "botId": "10002",
  "name": "Green Valley",
  "welcomeEventName": "START_GREEN_VALLEY",
  "theme": {
    "--es-primary": "#ca8a04",
    "--es-primary-dark": "#a16207",
    "--es-primary-deep": "#854d0e",
    "--es-accent": "#eab308",
    "--es-accent-light": "#fef08a",
    "--es-bg": "#fefce8",
    "--es-bg-2": "#fffbeb",
    "--es-border": "#fde68a",
    "--es-bot-bg": "linear-gradient(168deg, #fef9c3 0%, #fde047 100%)",
    "--es-bot-text": "#713f12",
    "--es-user-bg": "linear-gradient(145deg, #ca8a04 0%, #eab308 100%)",
    "--es-user-text": "#fffbeb",
    "--es-header-bg": "linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #fde047 0%, #ca8a04 42%, #854d0e 100%)",
    "--es-shadow": "0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(202, 138, 4, 0.12)",
    "--es-launcher-shadow": "0 3px 10px -2px rgba(202, 138, 4, 0.2)",
    "--es-launcher-shadow-hover": "0 5px 14px -2px rgba(202, 138, 4, 0.28)",
    "--es-ring-color": "#eab308"
  },
  "sitePreset": {
    "common": {
      "header": {
        "title": "Green Valley"
      },
      "botPersona": {
        "label": "Green Valley"
      }
    }
  }
};
})(typeof window !== 'undefined' ? window : this);
