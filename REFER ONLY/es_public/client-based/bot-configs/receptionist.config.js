/** UI/UX config — Receputytt (Bot ID 10001, sitePreset: receptionist) */
(function (g) {
  g.ES_BOT_PRESETS = g.ES_BOT_PRESETS || {};
  g.ES_BOT_PRESETS["receptionist"] = {
  "botId": "10001",
  "name": "Receputytt",
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
        "title": "Receputytt",
        "subtitle": "We are online to assist you"
      },
      "botPersona": {
        "label": "Receputytt",
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
          "idleTimeoutMs": 10000
        }
      }
    },
    "desk": {
      "launcherStrip": {
        "enabled": true,
        "text": "≡ƒæï Welcome! How can we help?"
      },
      "autoOpenChat": {
        "enabled": true,
        "delayMs": 10000
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
        "text": "≡ƒæï Welcome! How can we help?"
      },
      "autoOpenChat": {
        "enabled": true,
        "delayMs": 7000
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
