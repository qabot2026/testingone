/** Yahi file edit karo. common = Dialogflow/language. desk/mob = har device ki alag UI. showChatbot: false = us device par chatbot hide. composerUpload.enabled: false = 📎 upload button hide. */

/** Floating chat bubble icon (bottom-right launcher) */
var DEFAULT_CHAT_LAUNCHER_ICON_URL =
  'https://storage.googleapis.com/companybucket/Images/cat.png';
/** Chat header logo + default bot persona avatar */
var DEFAULT_CHAT_HEADER_ICON_URL =
  'https://storage.googleapis.com/companybucket/Images/cat-icon.png';

window.ES_CHAT_UI_CONFIG = {
  common: {
    dialogflow: {
      projectId: 'recebot-ptav',
      agentId: '5ea01258-d01b-44eb-9b2a-9f6338d43d63',
      /**
       * Single agent (recommended): sab flows ek hi agent (recebot-ptav) mein contexts se.
       * Landing pages: ES_CONFIG.welcomeEventName + sitePreset per site.
       * Multi-agent (purana): agentOrchestration.enabled = true
       */
      agentOrchestration: {
        enabled: false,
        role: 'receptionist',
        childWelcomeEvent: 'FRESH',
        returnWelcomeEvent: 'FRESH',
        returnTriggers: [
          'Main menu',
          'main menu',
          'Back',
          'back',
          'Menu',
          'menu',
          'Receptionist',
          'receptionist',
        ],
        children: [],
      },
      /** Dialogflow events — not the ↻ button (see desk/mob restartButton). */
      welcomeEvent: {
        enabled: true,
        eventName: 'FRESH',
        triggerOnChatOpen: true,
        /** User clicks ↻ Restart: send FRESH to Dialogflow? */
        triggerOnRestart: true,
        triggerOncePerSession: true,
      },
      endChatEvent: {
        enabled: true,
        eventName: 'ENDCHAT',
        triggerOnIdle: true,
        idleTimeoutMs: 10000,
        triggerOnChatClose: false,
        /** User clicks ↻ Restart: send ENDCHAT before new session? */
        triggerOnRestart: false,
        showBotResponse: true,
        closePanelAfterEnd: false,
        closePanelAfterMs: 2500,
        triggerOncePerSession: true,
        requireUserInteraction: true,
      },
      richContentChips: {
        enabled: true,
        infoCardImage: {
          cardWidthPx: 220,
          imageMaxHeightPx: 220,
          objectFit: 'contain',
          background: '#e8f4fc',
        },
        scrollStrip: {
          autoScroll: true,
          autoScrollSecondsPerItem: 4,
          stopAutoScrollOnInteraction: true,
        },
        cardCarousel: {
          cardWidthPx: 200,
          imageHeightPx: 140,
          objectFit: 'cover',
          background: '#e8f4fc',
        },
        galleryImage: {
          itemWidthPx: 120,
          imageHeightPx: 90,
          objectFit: 'cover',
          background: '#e8f4fc',
        },
        inlineSelect: { display: 'chips' },
      },
      /** In-chat forms — definitions in /public/forms/*.js */
      /**
       * Live agent desk — team chats at /live-agent/
       * Dialogflow: intent "Live Agent" or parameter live_agent=true
       */
      liveAgent: {
        enabled: true,
        pollIntervalMs: 600,
        deskUrl: '/live-agent/',
        dashboardUrl: '/dashboard/',
      },
      forms: {
        enabled: true,
        /**
         * Appointment form_id: "appointment" — edit on server:
         *   data/appointment-schedule.json  (forms.appointment)
         *   data/appointment-booked.json    (booked counts per slot)
         * weekdays + periods (9:00 AM–5:00 PM), slotMinutes, slotCapacity per day.
         */
        appointment: {
          scheduleFile: 'data/appointment-schedule.json',
        },
      },
    },

    deploy: {
      publicBaseUrl: 'https://es-based-chatbot-production.up.railway.app',
      embedScript: 'https://es-based-chatbot-production.up.railway.app/embed.js',
    },

    typography: {
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    },

    header: {
      title: 'Quality Testing Assistant',
      subtitle: 'We are online to assist you',
      chatIconUrl: DEFAULT_CHAT_LAUNCHER_ICON_URL,
      chatTitleIconUrl: DEFAULT_CHAT_HEADER_ICON_URL,
      headerIconUrl: DEFAULT_CHAT_HEADER_ICON_URL,
      showHeaderIcon: true,
      iconShape: 'square',
      header3dGradient: true,
      botWritingText: 'Typing',
      botWritingDotsIntervalMs: 480,
    },

    welcome: {
      enabled: false,
      title: 'Welcome',
      body: 'Select an option',
      restartTitle: 'Restarted',
      restartBody: 'Select an option.',
      suggestionChips: {
        enabled: false,
        items: [
          { label: 'Main Menu', message: 'Main Menu' },
          { label: 'DisplayName', message: 'TriggerName' },
          { label: 'DisplayName', message: 'TriggerName' },
          { label: 'DisplayName', message: 'TriggerName' },
        ],
      },
    },

    botPersona: {
      mode: 'image',
      imageUrl: DEFAULT_CHAT_HEADER_ICON_URL,
      label: 'Quality',
      avatarSizePx: 32,
      avatarShape: 'circle',
      gapBelowPx: 4,
      showTime: true,
      showSeconds: true,
      timeZone: 'Asia/Kolkata',
      messageTimeIncludesDate: false,
    },

    /** Shown when a human agent joins (live-agent handoff). */
    agentPersona: {
      mode: 'icon',
      label: 'Support Agent',
      imageUrl: '',
    },

    userPersona: {
      label: 'You',
      avatarSizePx: 18,
      gapBelowPx: 4,
      showTime: true,
      showSeconds: true,
      timeZone: 'Asia/Kolkata',
      messageTimeIncludesDate: false,
    },

    personaDisplay: {
      nameFontSizePx: 11,
      timeFontSizePx: 10,
      blurPx: 0.35,
      opacity: 0.82,
    },

    features: {
      multiLanguage: {
        enabled: true,
        defaultLanguage: 'en',
        alwaysUseDialogflowLanguage: 'en',
        usePhraseTranslationFile: true,
        autoTranslateBotReplies: false,
        translationSourceLanguage: 'en',
        translationOverridesByLanguage: { hi: {}, mr: {} },
        selectWidthCh: 10,
        selectWidthExtraPx: 15,
        showSelectBorder: false,
        languages: [
          {
            code: 'en',
            label: 'English',
            nativeLabel: 'English',
            speech: 'en-IN',
            dialogflow: 'en',
          },
          {
            code: 'hi',
            label: 'Hindi',
            nativeLabel: 'हिन्दी',
            speech: 'hi-IN',
            dialogflow: 'en',
          },
          {
            code: 'mr',
            label: 'Marathi',
            nativeLabel: 'मराठी',
            speech: 'mr-IN',
            dialogflow: 'en',
          },
        ],
      },
      speechToText: { enabled: true }, // mic button on/off
      /**
       * 📎 in composer — upload without Dialogflow upload form
       * enabled: false = button off (global). desk/mob.features.composerUpload se alag device par off.
       * display: 'rich' = clear SVG clip | 'emoji' = 📎 emoji
       * tiltDeg: icon tilt (e.g. -18)
       */
      composerUpload: {
        enabled: true,
        display: 'rich',
        emoji: '📎',
        tiltDeg: -18,
        /** false = no bot “Upload successful!” message after 📎 upload */
        showSuccessAck: false,
        /** false = no “Uploading…” bot message while upload runs */
        showUploadingStatus: false,
        accept:
          'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip,application/x-zip-compressed',
        successByLanguage: {
          en: '✅ Upload successful! We received your document(s): {files}',
          hi: '✅ अपलोड सफल! हमें आपके दस्तावेज़ मिल गए: {files}',
          mr: '✅ अपलोड यशस्वी! आम्हाला तुमचे दस्तऐवज मिळाले: {files}',
        },
        duplicateByLanguage: {
          en: '✅ We already received your document(s): {files}',
          hi: '✅ ये दस्तावेज़ पहले से प्राप्त हैं: {files}',
          mr: '✅ हे दस्तऐवज आधीच मिळाले आहेत: {files}',
        },
        failedByLanguage: {
          en: 'Could not upload. Please try again or use Contact us first.',
          hi: 'अपलोड नहीं हो सका। दोबारा कोशिश करें या पहले संपर्क फॉर्म भरें।',
          mr: 'अपलोड झाले नाही. पुन्हा प्रयत्न करा किंवा आधी संपर्क फॉर्म भरा.',
        },
        uploadingByLanguage: {
          en: 'Uploading your document(s)…',
          hi: 'आपके दस्तावेज़ अपलोड हो रहे हैं…',
          mr: 'तुमचे दस्तऐवज अपलोड होत आहेत…',
        },
      },
      inputPlaceholderByLanguage: {
        en: 'Type your message here…',
        hi: 'अपना संदेश लिखें…',
        mr: 'तुमचा संदेश लिहा…',
      },
    },

    /** Gap between language dropdown and ↻ button (desk + mob). */
    restartButton: { gapAfterLanguagePx: 10 },

    theme: {
      '--es-primary': '#0284c7',
      '--es-primary-dark': '#0369a1',
      '--es-primary-deep': '#075985',
      '--es-accent': '#0ea5e9',
      '--es-accent-light': '#bae6fd',
      '--es-bg': '#e8f4fc',
      '--es-bg-2': '#f7fbff',
      '--es-surface': '#ffffff',
      '--es-text': '#0f172a',
      '--es-text-soft': '#475569',
      '--es-muted': '#475569',
      '--es-border': '#dbe5ec',
      '--es-composer-bg': '#f7fbff',
      '--es-composer-border': '#dbe5ec',
      '--es-bot-bg': 'linear-gradient(168deg, #e8f6ff 0%, #bae6fd 100%)',
      '--es-bot-text': '#0c4a6e',
      '--es-user-bg': 'linear-gradient(145deg, #0284c7 0%, #0ea5e9 100%)',
      '--es-user-text': '#f0f9ff',
      '--es-header-color': '#0284c7',
      '--es-header-bg':
        'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), linear-gradient(168deg, #38bdf8 0%, #0284c7 42%, #075985 100%)',
      '--es-shadow':
        '0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(14, 165, 233, 0.12)',
      '--es-launcher-shadow': '0 3px 10px -2px rgba(14, 165, 233, 0.2)',
      '--es-launcher-shadow-hover': '0 5px 14px -2px rgba(14, 165, 233, 0.28)',
      '--es-radius': '22px',
      '--es-ring-color': '#0ea5e9',
    },

    /** Per-bot colors — loaded from public/bot-configs/*.config.js */
    themePresets: {},

    /**
     * Per-bot UI — loaded from public/bot-configs/*.config.js
     * Dashboard overrides merge from data/site-presets.json
     */
    sitePresets: {},

    chatPanel: {
      borderRadius: {
        topLeft: '22px',
        topRight: '22px',
        bottomLeft: '20px',
        bottomRight: '20px',
      },
      backgroundImageUrl: '',
      backgroundImageFit: 'cover',
    },
  },

  /** Desktop (screen > 768px) — poori UI yahan */
  desk: {
    showChatbot: true,

    chatLayout: { side: 'right' },

    header: {
      titleFontSizePx: 18,
      subtitleFontSizePx: 13,
      iconSizePx: 44,
      titlebarIconSizePx: 40,
      expandPanel: {
        enabled: true,
        heightIncreasePercent: 30,
        widthIncreasePercent: 100,
      },
    },

    launcher: {
      sizePx: 64,
      iconUrl: DEFAULT_CHAT_LAUNCHER_ICON_URL,
      cornerRoundness: '50%',
      iconZoomPercent: 100,
      /** enabled: true = bubble+X | false = bubble hide, panel niche (panelBottomPx) */
      closeBubbleWhenOpen: { enabled: true, panelBottomPx: 8 },
      storyRing: {
        enabled: true,
        widthPx: 2.5,
        rotateSeconds: 3,
        colorRingMotionEnabled: true,
        instagramStyle: true,
      },
    },

    launcherStrip: {
      enabled: true,
      text: '👋Hey, how are you?😊',
      /** delayMs = page load ke kitne sec baad haath wave; durationMs = wave kitni der */
      wavePopup: { enabled: true, delayMs: 3000, durationMs: 3000, scale: 3 },
      position: { rightPx: 5, bottomPx: 66 },
      style: { fontSizePx: 13, paddingYpx: 10, paddingXpx: 14, maxWidthPx: 260 },
    },

    chatWindow: {
      widthPx: 400,
      heightPx: 520,
      minHeightPx: 360,
      topInsetPx: 16,
      position: { rightPx: 10, bottomPx: 20, leftPx: null },
    },

    autoOpenChat: { enabled: true, delayMs: 10000 },

    restartButton: { enabled: true, label: 'Restart' },

    poweredBy: {
      enabled: true,
      prefix: '⚡by ',
      brandName: 'ES Chatbot',
      logoUrl:
        'https://www.vhv.rs/dpng/d/6-68550_hanuman-ji-png-transparent-png.png',
      linkUrl: 'www.google.com',
      color: '#0369a1',
      fontSizePx: 9,
      logoHeightPx: 12,
      align: 'right',
      offsetDownPx: 15,
      offsetUpPx: 0,
      offsetLeftPx: 0,
      offsetRightPx: 0,
    },

    features: {
      speechToText: { enabled: true },
      composerUpload: { enabled: true },
      restartChat: { enabled: false, label: 'Restart' },
    },
  },

  /** Mobile (screen ≤ 768px) — poori UI yahan */
  mob: {
    showChatbot: true,

    chatLayout: { side: 'right' },

    header: {
      titleFontSizePx: 15,
      subtitleFontSizePx: 11,
      iconSizePx: 32,
      titlebarIconSizePx: 36,
      expandPanel: {
        enabled: true,
        heightIncreasePercent: 30,
        widthIncreasePercent: 100,
      },
    },

    launcher: {
      sizePx: 58,
      iconUrl: DEFAULT_CHAT_LAUNCHER_ICON_URL,
      cornerRoundness: '50%',
      iconZoomPercent: 100,
      closeBubbleWhenOpen: {
        enabled: true,
        panelBottomPx: 10,
        panelHeightExtraPx: 35,
      },
      storyRing: {
        enabled: true,
        widthPx: 2.5,
        rotateSeconds: 3,
        colorRingMotionEnabled: true,
        instagramStyle: true,
      },
    },

    launcherStrip: {
      enabled: true,
      text: '👋Hey, how are you?😊',
      wavePopup: { enabled: true, delayMs: 3000, durationMs: 3000, scale: 3 },
      position: { rightPx: 10, bottomPx: 60, leftPx: null },
      style: { fontSizePx: 12, paddingYpx: 8, paddingXpx: 12, maxWidthPx: 220 },
    },

    chatWindow: {
      widthPx: null,
      heightPx: null,
      minHeightPx: 480,
      horizontalInsetPx: 12,
      bottomInsetPx: 10,
      topInsetPx: 26,
      position: { rightPx: 12, bottomPx: 10, leftPx: null },
    },

    autoOpenChat: { enabled: true, delayMs: 7000 },

    restartButton: { enabled: true, label: 'Restart' },

    poweredBy: {
      enabled: true,
      prefix: '⚡by ',
      brandName: 'ES Chatbot',
      logoUrl:
        'https://www.vhv.rs/dpng/d/6-68550_hanuman-ji-png-transparent-png.png',
      linkUrl: 'www.google.com',
      color: '#0369a1',
      fontSizePx: 9,
      logoHeightPx: 12,
      align: 'right',
      offsetDownPx: 15,
      offsetUpPx: 0,
      offsetLeftPx: 0,
      offsetRightPx: 0,
    },

    features: {
      speechToText: { enabled: true },
      composerUpload: { enabled: true },
      restartChat: { enabled: true, label: 'Restart' },
    },
  },
};

(function () {
  var c = window.ES_CHAT_UI_CONFIG;
  if (!c || !c.common) return;

  var packs = window.ES_BOT_PRESETS || {};
  c.common.themePresets = c.common.themePresets || {};
  c.common.sitePresets = c.common.sitePresets || {};
  Object.keys(packs).forEach(function (key) {
    var pack = packs[key];
    if (!pack) return;
    if (pack.theme) c.common.themePresets[key] = pack.theme;
    if (pack.sitePreset) c.common.sitePresets[key] = pack.sitePreset;
  });

  /* Merge — landing pages set welcomeEventName + sitePreset before embed.js loads this file */
  var qaExisting = window.ES_CONFIG || {};
  var sitePreset = qaExisting.sitePreset || 'receptionist';
  var botId = qaExisting.botId || '';
  if (!botId && sitePreset && window.ES_BOT_PRESETS && window.ES_BOT_PRESETS[sitePreset]) {
    botId = window.ES_BOT_PRESETS[sitePreset].botId || '';
  }
  if (!botId) botId = '10001';
  window.ES_CONFIG = Object.assign({}, qaExisting, {
    apiBase: c.common.deploy.publicBaseUrl,
    embedScript: c.common.deploy.embedScript,
    sitePreset: sitePreset,
    botId: botId,
  });
})();
