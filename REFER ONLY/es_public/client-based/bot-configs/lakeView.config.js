/** UI/UX config — Lake Viev (Bot ID 10003, sitePreset: lakeView) */
(function (g) {
  g.ES_BOT_PRESETS = g.ES_BOT_PRESETS || {};
  g.ES_BOT_PRESETS["lakeView"] = {
  "botId": "10003",
  "name": "Lake Viev",
  "welcomeEventName": "START_LAKE_VIEV",
  "theme": {
    "--es-primary": "#16a34a",
    "--es-primary-dark": "#15803d",
    "--es-primary-deep": "#166534",
    "--es-accent": "#22c55e",
    "--es-accent-light": "#bbf7d0",
    "--es-bg": "#f0fdf4",
    "--es-bg-2": "#f7fef9",
    "--es-border": "#bbf7d0",
    "--es-bot-bg": "linear-gradient(168deg, #dcfce7 0%, #86efac 100%)",
    "--es-bot-text": "#14532d",
    "--es-user-bg": "linear-gradient(145deg, #16a34a 0%, #22c55e 100%)",
    "--es-user-text": "#f0fdf4",
    "--es-header-bg": "linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #4ade80 0%, #16a34a 42%, #166534 100%)",
    "--es-shadow": "0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(22, 163, 74, 0.12)",
    "--es-launcher-shadow": "0 3px 10px -2px rgba(22, 163, 74, 0.2)",
    "--es-launcher-shadow-hover": "0 5px 14px -2px rgba(22, 163, 74, 0.28)",
    "--es-ring-color": "#22c55e"
  },
  "sitePreset": {
    "common": {
      "header": {
        "title": "Lake Viev",
        "subtitle": "Luxury lakeside living"
      },
      "botPersona": {
        "label": "Lake Viev",
        "mode": "image",
        "imageUrl": ""
      },
      "welcome": {
        "enabled": false
      },
      "features": {
        "multiLanguage": {
          "enabled": true
        },
        "speechToText": {
          "enabled": true
        },
        "composerUpload": {
          "enabled": true
        }
      },
      "dialogflow": {
        "liveAgent": {
          "enabled": true
        },
        "forms": {
          "enabled": true
        },
        "endChatEvent": {
          "enabled": true,
          "idleTimeoutMs": 12000
        }
      }
    },
    "desk": {
      "launcherStrip": {
        "enabled": true,
        "text": "≡ƒî┐ Discover Lake View homes"
      },
      "autoOpenChat": {
        "enabled": false
      },
      "restartButton": {
        "enabled": true
      },
      "poweredBy": {
        "enabled": true
      },
      "features": {
        "speechToText": {
          "enabled": true
        },
        "composerUpload": {
          "enabled": true
        },
        "restartChat": {
          "enabled": false
        }
      }
    },
    "mob": {
      "launcherStrip": {
        "enabled": true,
        "text": "≡ƒî┐ Discover Lake View homes"
      },
      "autoOpenChat": {
        "enabled": false
      },
      "restartButton": {
        "enabled": true
      },
      "poweredBy": {
        "enabled": true
      },
      "features": {
        "speechToText": {
          "enabled": true
        },
        "composerUpload": {
          "enabled": true
        },
        "restartChat": {
          "enabled": true
        }
      }
    }
  }
};
})(typeof window !== 'undefined' ? window : this);
