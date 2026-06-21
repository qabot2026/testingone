(function (global) {
  'use strict';

  var DEFAULT_MAX_UPLOAD_MB = 15;

  var ICONS = {
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7v1h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H6a2 2 0 01-2-2v-1H3a1 1 0 01-1-1v-3a1 1 0 011-1h1v-1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2z"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9 17h6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
    send: '<svg class="qa-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M6 11l6-6 6 6" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mic: '<svg class="qa-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12a6 6 0 0 0 12 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    panelExpand:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    panelCollapse:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    header: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>',
    agentHuman:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5 20v-.75C5 16.13 8.13 14 12 14s7 2.13 7 5.25V20"/><path d="M16.5 9.5l1.2 1.2 2.3-2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    attach:
      '<svg class="qa-attach__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.25 8.25v7.5a2.75 2.75 0 1 1-5.5 0V7a4.25 4.25 0 1 1 8.5 0v8.75a6.25 6.25 0 0 1-12.5 0V8.5" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function getSitePresetKey_() {
    var qa = global.ES_CONFIG || {};
    return qa.sitePreset ? String(qa.sitePreset).trim() : '';
  }

  function getBotId_() {
    var qa = global.ES_CONFIG || {};
    var key = getSitePresetKey_() || 'receptionist';
    if (key !== 'receptionist' && global.ES_BOT_PRESETS && global.ES_BOT_PRESETS[key]) {
      var childPreset = global.ES_BOT_PRESETS[key];
      if (childPreset && childPreset.botId) return String(childPreset.botId).trim();
    }
    if (qa.botId) return String(qa.botId).trim();
    if (key === 'receptionist') return '10001';
    return '';
  }

  function getSitePresetBlock_() {
    var key = getSitePresetKey_();
    if (!key) return null;
    var presets =
      (global.ES_CHAT_UI_CONFIG &&
        global.ES_CHAT_UI_CONFIG.common &&
        global.ES_CHAT_UI_CONFIG.common.sitePresets) ||
      {};
    return presets[key] || null;
  }

  function applyThemeOverrides_(merged, common, qa) {
    var themeKey =
      (qa.themePreset && String(qa.themePreset).trim()) || getSitePresetKey_();
    var presets = common.themePresets || {};
    var theme = Object.assign({}, common.theme || {});
    if (themeKey && presets[themeKey]) {
      theme = Object.assign(theme, presets[themeKey]);
    }
    if (merged.theme && typeof merged.theme === 'object') {
      theme = Object.assign(theme, merged.theme);
    }
    if (qa.theme && typeof qa.theme === 'object') {
      theme = Object.assign(theme, qa.theme);
    }
    merged.theme = theme;
    return merged;
  }

  function getRootCfg() {
    var common =
      (global.ES_CHAT_UI_CONFIG && global.ES_CHAT_UI_CONFIG.common) || {};
    var qa = global.ES_CONFIG || {};
    var siteBlock = getSitePresetBlock_();
    var hasOverride =
      siteBlock ||
      (qa.ui && qa.ui.common) ||
      qa.themePreset ||
      qa.theme;
    if (!hasOverride) return common;

    var merged = deepMerge(common, {});
    if (siteBlock && siteBlock.common) {
      merged = deepMerge(merged, siteBlock.common);
    }
    var branch = isMobileViewport() ? 'mob' : 'desk';
    if (siteBlock && siteBlock[branch] && siteBlock[branch].common) {
      merged = deepMerge(merged, siteBlock[branch].common);
    }
    if (qa.ui && qa.ui.common) {
      merged = deepMerge(merged, qa.ui.common);
    }
    if (qa.ui && qa.ui[branch] && qa.ui[branch].common) {
      merged = deepMerge(merged, qa.ui[branch].common);
    }
    if (qa.themePreset || qa.sitePreset || qa.theme) {
      merged = applyThemeOverrides_(merged, common, qa);
    }
    return merged;
  }

  function isMobileViewport() {
    var qa = global.ES_CONFIG || {};
    if (qa.previewViewport === 'desk') return false;
    if (qa.previewViewport === 'mob') return true;
    return !!(global.matchMedia && global.matchMedia('(max-width: 768px)').matches);
  }

  function getViewportCfg() {
    var root = global.ES_CHAT_UI_CONFIG || {};
    var branch = isMobileViewport() ? 'mob' : 'desk';
    var base = root[branch] || {};
    var siteBlock = getSitePresetBlock_();
    var qa = global.ES_CONFIG || {};
    var hasOverride = siteBlock || (qa.ui && qa.ui[branch]);
    if (!hasOverride) return base;

    var merged = deepMerge(base, {});
    if (siteBlock && siteBlock[branch]) {
      merged = deepMerge(merged, siteBlock[branch]);
    }
    if (qa.ui && qa.ui[branch]) {
      merged = deepMerge(merged, qa.ui[branch]);
    }
    return merged;
  }

  function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  var GOOGLE_FONT_API_NAMES = {
    Inter: 'Inter',
    Roboto: 'Roboto',
    'Open Sans': 'Open+Sans',
    Lato: 'Lato',
    Montserrat: 'Montserrat',
    Poppins: 'Poppins',
    Nunito: 'Nunito',
    Raleway: 'Raleway',
    'Source Sans 3': 'Source+Sans+3',
    'Work Sans': 'Work+Sans',
    'DM Sans': 'DM+Sans',
    Outfit: 'Outfit',
    'Plus Jakarta Sans': 'Plus+Jakarta+Sans',
    Ubuntu: 'Ubuntu',
    'Noto Sans': 'Noto+Sans',
    Merriweather: 'Merriweather',
    'Playfair Display': 'Playfair+Display',
    Oswald: 'Oswald',
    Rubik: 'Rubik',
    Manrope: 'Manrope',
    'IBM Plex Sans': 'IBM+Plex+Sans',
    Figtree: 'Figtree',
    'Public Sans': 'Public+Sans',
    Lexend: 'Lexend',
    'Fira Sans': 'Fira+Sans',
  };

  function getPrimaryFontName_(fontFamily) {
    var s = String(fontFamily || '').trim();
    if (!s) return '';
    var quoted = s.match(/^"([^"]+)"/);
    if (quoted) return quoted[1].trim();
    return s.split(',')[0].replace(/^['"]|['"]$/g, '').trim();
  }

  function ensureGoogleFontLoaded_(fontFamily) {
    var name = getPrimaryFontName_(fontFamily);
    var apiName = GOOGLE_FONT_API_NAMES[name];
    if (!apiName || typeof document === 'undefined') return;
    var id =
      'es-google-font-' +
      apiName.replace(/\+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      apiName +
      ':wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  function parseHexColor_(raw) {
    var s = String(raw || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    var m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      var h = m[1];
      return ('#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toLowerCase();
    }
    return '';
  }

  function hexToRgb_(hex) {
    hex = parseHexColor_(hex);
    if (!hex) return null;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function rgbToHex_(r, g, b) {
    function clamp(n) {
      return Math.max(0, Math.min(255, Math.round(n)));
    }
    return (
      '#' +
      [clamp(r), clamp(g), clamp(b)]
        .map(function (n) {
          return n.toString(16).padStart(2, '0');
        })
        .join('')
    );
  }

  function mixHex_(hex, target, amount) {
    var src = hexToRgb_(hex);
    var dst = hexToRgb_(target);
    if (!src || !dst) return hex;
    var t = Math.max(0, Math.min(1, amount));
    return rgbToHex_(
      src.r + (dst.r - src.r) * t,
      src.g + (dst.g - src.g) * t,
      src.b + (dst.b - src.b) * t
    );
  }

  function lightenHex_(hex, amount) {
    return mixHex_(hex, '#ffffff', amount);
  }

  function darkenHex_(hex, amount) {
    return mixHex_(hex, '#000000', amount);
  }

  function buildHeader3dGradient_(baseHex) {
    var base = parseHexColor_(baseHex) || '#0284c7';
    var light = lightenHex_(base, 0.24);
    var deep = darkenHex_(base, 0.34);
    return (
      'linear-gradient(180deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.1) 24%, transparent 46%), ' +
      'linear-gradient(168deg, ' +
      light +
      ' 0%, ' +
      base +
      ' 42%, ' +
      deep +
      ' 100%)'
    );
  }

  function resolveHeaderBackground_(common) {
    common = common || getRootCfg();
    var theme = common.theme || {};
    var hdr = common.header || {};
    var baseColor = parseHexColor_(theme['--es-header-color']);
    var legacyBg = theme['--es-header-bg'];
    var use3d = hdr.header3dGradient !== false;
    if (baseColor) {
      return use3d ? buildHeader3dGradient_(baseColor) : baseColor;
    }
    if (legacyBg) return legacyBg;
    return buildHeader3dGradient_('#0284c7');
  }

  function applyHeaderBackground_(root) {
    if (!root) return;
    root.style.setProperty('--es-header-bg', resolveHeaderBackground_(getRootCfg()));
  }

  function deepMerge(base, over) {
    var out = {};
    var b = base || {};
    var o = over || {};
    Object.keys(b).forEach(function (k) {
      out[k] = b[k];
    });
    Object.keys(o).forEach(function (k) {
      if (isPlainObject(b[k]) && isPlainObject(o[k])) {
        out[k] = deepMerge(b[k], o[k]);
      } else {
        out[k] = o[k];
      }
    });
    return out;
  }

  function isSpeechToTextEnabled() {
    var root = getRootCfg();
    var eff = getEffectiveCfg();
    if (
      root.features &&
      root.features.speechToText &&
      root.features.speechToText.enabled === false
    ) {
      return false;
    }
    var stt = eff.features && eff.features.speechToText;
    return !(stt && stt.enabled === false);
  }

  function getTypingIndicatorCfg() {
    var hdr = getRootCfg().header || {};
    var text = String(hdr.botWritingText != null ? hdr.botWritingText : 'Typing').trim();
    var ms = parseInt(hdr.botWritingDotsIntervalMs, 10);
    if (!isFinite(ms) || ms < 120) ms = 480;
    return { text: text, dotsIntervalMs: ms };
  }

  function normalizeIconUrl(raw) {
    var url = String(raw == null ? '' : raw).trim();
    if (!url) return '';
    if (/^data:image\//i.test(url)) return url;
    if (/^\/\//.test(url)) return 'https:' + url;
    var base =
      (global.ES_CONFIG && global.ES_CONFIG.apiBase) ||
      (global.location && global.location.origin) ||
      '';
    if (/^\/[^/]/.test(url)) {
      return String(base).replace(/\/$/, '') + url;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return 'https://' + url.replace(/^\/+/, '');
    }
    return url;
  }

  function pickFirstIconUrl() {
    for (var i = 0; i < arguments.length; i++) {
      var url = normalizeIconUrl(arguments[i]);
      if (url) return url;
    }
    return '';
  }

  function isLegacyStockIconUrl(url) {
    var s = String(url == null ? '' : url).toLowerCase();
    return (
      !s ||
      s.indexOf('companybucket/images/cat') >= 0 ||
      s.indexOf('/images/cat.png') >= 0 ||
      s.indexOf('/images/cat-icon') >= 0
    );
  }

  function resolveHeaderIconUrl(hdr) {
    hdr = hdr || {};
    var headerIcon = normalizeIconUrl(hdr.headerIconUrl);
    var titleIcon = normalizeIconUrl(hdr.chatTitleIconUrl);
    var bubbleIcon = normalizeIconUrl(hdr.chatIconUrl);
    if (headerIcon) {
      if (!titleIcon || isLegacyStockIconUrl(hdr.chatTitleIconUrl)) {
        return headerIcon;
      }
      return titleIcon;
    }
    return pickFirstIconUrl(titleIcon, bubbleIcon);
  }

  function resolveLauncherIconUrl(launch, hdr) {
    launch = launch || {};
    hdr = hdr || {};
    var launchIcon = normalizeIconUrl(launch.iconUrl);
    var bubbleIcon = normalizeIconUrl(hdr.chatIconUrl);
    var headerIcon = normalizeIconUrl(hdr.headerIconUrl);
    if (launchIcon && !isLegacyStockIconUrl(launch.iconUrl)) {
      return launchIcon;
    }
    if (bubbleIcon && !isLegacyStockIconUrl(hdr.chatIconUrl)) {
      return bubbleIcon;
    }
    if (headerIcon) {
      return headerIcon;
    }
    return pickFirstIconUrl(launchIcon, bubbleIcon, headerIcon);
  }

  /** common + current device (desk | mob) */
  function getEffectiveCfg() {
    return deepMerge(getRootCfg(), getViewportCfg());
  }

  function isChatbotEnabledForViewport() {
    return getViewportCfg().showChatbot !== false;
  }

  function isChatbotEnabledAnywhere() {
    var root = global.ES_CHAT_UI_CONFIG || {};
    var desk = root.desk || {};
    var mob = root.mob || {};
    return desk.showChatbot !== false || mob.showChatbot !== false;
  }

  function getChatLayoutSide() {
    var cl = getViewportCfg().chatLayout || {};
    return String(cl.side || 'right').toLowerCase() === 'left' ? 'left' : 'right';
  }

  function getRestartCfg() {
    var eff = getEffectiveCfg();
    var rb = eff.restartButton || {};
    var rootRb = getRootCfg().restartButton || {};
    var feat = eff.features || {};
    var restartChat = feat.restartChat || {};
    var labelRaw =
      rb.label != null
        ? rb.label
        : rootRb.label != null
          ? rootRb.label
          : restartChat.label != null
            ? restartChat.label
            : 'Restart';
    var enabled =
      rb.enabled !== undefined
        ? rb.enabled !== false
        : rootRb.enabled !== undefined
          ? rootRb.enabled !== false
          : true;
    return {
      enabled: enabled,
      label: String(labelRaw).trim() || 'Restart',
    };
  }

  function getHeaderLayoutCfg() {
    var hdr = getEffectiveCfg().header || {};
    return {
      titleFontSizePx: hdr.titleFontSizePx,
      subtitleFontSizePx: hdr.subtitleFontSizePx,
      iconSizePx: hdr.iconSizePx != null ? hdr.iconSizePx : hdr.titlebarIconSizePx,
    };
  }

  function getExpandPanelCfg() {
    var ep = (getEffectiveCfg().header || {}).expandPanel || {};
    var h = ep.heightIncreasePercent;
    var w = ep.widthIncreasePercent;
    return {
      enabled: ep.enabled === true,
      heightIncreasePercent:
        h != null && h !== ''
          ? Math.max(0, parseInt(h, 10) || 0)
          : 30,
      widthIncreasePercent:
        w != null && w !== ''
          ? Math.max(0, parseInt(w, 10) || 0)
          : 100,
    };
  }

  function getLangList() {
    var ml = getRootCfg().features && getRootCfg().features.multiLanguage;
    if (ml && ml.languages && ml.languages.length) return ml.languages;
    return [
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
        dialogflow: 'hi',
      },
      {
        code: 'mr',
        label: 'Marathi',
        nativeLabel: 'मराठी',
        speech: 'mr-IN',
        dialogflow: 'mr',
      },
    ];
  }

  function langMapFromList(list) {
    var map = {};
    list.forEach(function (L) {
      map[L.code] = {
        label: L.label,
        speech: L.speech || 'en-IN',
        df: L.dialogflow || L.code,
      };
    });
    return map;
  }

  function shallowMerge(base, over) {
    var out = {};
    var b = base || {};
    var o = over || {};
    Object.keys(b).forEach(function (k) {
      out[k] = b[k];
    });
    Object.keys(o).forEach(function (k) {
      out[k] = o[k];
    });
    return out;
  }

  function getLauncherStripCfg() {
    return getViewportCfg().launcherStrip || {};
  }

  /** Chat open hone par niche launcher bubble par X — desk/mob launcher.closeBubbleWhenOpen */
  function isLauncherCloseBubbleEnabled() {
    var launch = getEffectiveCfg().launcher || {};
    var cfg = launch.closeBubbleWhenOpen;
    if (cfg && cfg.enabled === false) return false;
    return true;
  }

  function getLauncherCloseBubbleCfg() {
    var launch = getEffectiveCfg().launcher || {};
    return launch.closeBubbleWhenOpen || {};
  }

  /** Launcher bubble height + gap used to position the open panel above it */
  function getLauncherStackPx() {
    var launch = getEffectiveCfg().launcher || {};
    var size = launch.sizePx != null ? launch.sizePx : 60;
    return size + 12;
  }

  function getOpenLauncherStackPx() {
    var stackPx = getLauncherStackPx();
    if (!isLauncherCloseBubbleEnabled()) return stackPx;
    var closeCfg = getLauncherCloseBubbleCfg();
    var gap =
      closeCfg.panelBottomPx != null ? parseInt(closeCfg.panelBottomPx, 10) : 8;
    if (isNaN(gap)) gap = 8;
    return stackPx + gap;
  }

  function getOpenPanelStackPx() {
    if (isLauncherCloseBubbleEnabled()) return getOpenLauncherStackPx();
    var closeCfg = getLauncherCloseBubbleCfg();
    var niche =
      closeCfg.panelBottomPx != null ? parseInt(closeCfg.panelBottomPx, 10) : 8;
    if (isNaN(niche)) niche = 8;
    return niche;
  }

  function getViewportAnchorVars_() {
    var win = getEffectiveCfg().chatWindow || {};
    var pos = win.position || {};
    var launch = getEffectiveCfg().launcher || {};
    var isPreview = !!(global.ES_CONFIG && global.ES_CONFIG.previewViewport);
    var inset = win.horizontalInsetPx != null ? win.horizontalInsetPx : 12;
    var side = getChatLayoutSide();
    var bottomPad = isPreview
      ? pos.bottomPx != null
        ? pos.bottomPx
        : 14
      : pos.bottomPx != null
        ? pos.bottomPx
        : 24;
    var sidePx = isPreview
      ? side === 'left'
        ? pos.leftPx != null
          ? pos.leftPx
          : inset
        : pos.rightPx != null
          ? pos.rightPx
          : inset
      : side === 'left'
        ? pos.leftPx != null
          ? pos.leftPx
          : inset
        : pos.rightPx != null
          ? pos.rightPx
          : inset;
    var ringExtra =
      launch.storyRing && launch.storyRing.enabled
        ? (launch.storyRing.widthPx != null ? launch.storyRing.widthPx : 2.5) + 4
        : 0;
    var stripCfg = getLauncherStripCfg();
    var stripLift =
      stripCfg.position && stripCfg.position.bottomPx != null
        ? stripCfg.position.bottomPx
        : 48;
    return {
      isPreview: isPreview,
      bottomPad: bottomPad,
      sidePx: sidePx,
      bubbleBottom: bottomPad + ringExtra,
      stackPx: getLauncherStackPx(),
      stripLift: stripLift,
      side: side,
    };
  }

  function getPanelHeightExtraPx(whenChatOpen) {
    var cfg = getLauncherCloseBubbleCfg();
    if (!isLauncherCloseBubbleEnabled()) return 0;
    if (!whenChatOpen) return 0;
    if (cfg.panelHeightExtraPx == null) return 0;
    var extra = parseInt(cfg.panelHeightExtraPx, 10);
    return isNaN(extra) ? 0 : extra;
  }

  function computeOpenPanelHeightPx(expanded) {
    var eff = getEffectiveCfg();
    var win = eff.chatWindow || {};
    var topInset = win.topInsetPx != null ? win.topInsetPx : 16;
    var pos = win.position || {};
    var widgetBottom = pos.bottomPx != null ? pos.bottomPx : 24;
    var stackPx = getOpenPanelStackPx();
    var boost = getPanelHeightExtraPx(true);
    var viewportMax =
      (global.innerHeight || 800) -
      topInset -
      stackPx -
      widgetBottom -
      8 +
      boost;
    var ep = getExpandPanelCfg();
    var heightMult =
      expanded && ep.enabled ? 1 + ep.heightIncreasePercent / 100 : 1;
    if (win.heightPx) {
      return Math.min(Math.round(win.heightPx * heightMult) + boost, viewportMax);
    }
    var minH =
      Math.round(
        (win.minHeightPx != null ? win.minHeightPx : 360) * heightMult
      ) + boost;
    return Math.min(Math.max(minH, viewportMax), Math.round(viewportMax * heightMult));
  }

  function hasLauncherStripTextAnywhere() {
    var root = global.ES_CHAT_UI_CONFIG || {};
    var d = (root.desk || {}).launcherStrip || {};
    var m = (root.mob || {}).launcherStrip || {};
    return !!(d.text || m.text);
  }

  function splitEmojiGraphemes(text) {
    var s = String(text || '');
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        return Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s),
          function (x) {
            return x.segment;
          }
        );
      }
    } catch (e) {
      /* Segmenter unavailable */
    }
    return Array.from(s);
  }

  function isEmojiGrapheme(segment) {
    if (!segment) return false;
    try {
      return /\p{Extended_Pictographic}/u.test(segment);
    } catch (e) {
      return /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/.test(segment);
    }
  }

  function extractLeadingEmoji(text) {
    var s = String(text || '').trim();
    if (!s) return '';
    var parts = splitEmojiGraphemes(s);
    if (parts.length && isEmojiGrapheme(parts[0])) return parts[0];
    return '';
  }

  function findWaveHandEmoji(text) {
    var s = String(text || '');
    var lead = extractLeadingEmoji(s);
    if (lead) return lead;
    var parts = splitEmojiGraphemes(s);
    for (var i = 0; i < parts.length; i++) {
      if (isEmojiGrapheme(parts[i])) return parts[i];
    }
    return '';
  }

  function stripTextWithoutWaveEmoji(text, waveEmoji) {
    var s = String(text || '');
    waveEmoji = waveEmoji || findWaveHandEmoji(s);
    if (!waveEmoji) return s;
    var idx = s.indexOf(waveEmoji);
    if (idx < 0) return s;
    return (s.slice(0, idx) + s.slice(idx + waveEmoji.length)).replace(/^\s+/, '');
  }

  function getStripWaveState(stripCfg) {
    stripCfg = stripCfg || {};
    var fullText = String(stripCfg.text || '');
    var waveCfg = stripCfg.wavePopup || {};
    var waveEnabled = waveCfg.enabled !== false;
    var waveEmoji = findWaveHandEmoji(fullText);
    var waveOn = waveEnabled && !!waveEmoji;
    return {
      fullText: fullText,
      waveOn: waveOn,
      waveEmoji: waveOn ? waveEmoji : '',
      bodyText: waveOn ? stripTextWithoutWaveEmoji(fullText, waveEmoji) : fullText,
    };
  }

  var ES_RING_GRADIENT_INSTAGRAM =
    'conic-gradient(from 180deg, #f09433 0deg, #e6683c 72deg, #dc2743 144deg, #cc2366 216deg, #bc1888 252deg, #833ab4 288deg, #5851db 324deg, #405de6 360deg, #f09433 360deg)';

  function getStoryRingGradient(ring) {
    if (ring && ring.gradient) return ring.gradient;
    if (ring && ring.instagramStyle === true) return ES_RING_GRADIENT_INSTAGRAM;
    var theme = getRootCfg().theme || {};
    var c1 = theme['--es-ring-color'] || '#0ea5e9';
    var c2 = theme['--es-accent'] || '#0ea5e9';
    var c3 = theme['--es-primary'] || '#0284c7';
    var c4 = theme['--es-primary-dark'] || '#0369a1';
    var c5 = theme['--es-primary-deep'] || '#075985';
    return (
      'conic-gradient(from 0deg, ' +
      c1 +
      ' 0deg, ' +
      c2 +
      ' 72deg, ' +
      c3 +
      ' 144deg, ' +
      c4 +
      ' 216deg, ' +
      c5 +
      ' 288deg, ' +
      c1 +
      ' 360deg)'
    );
  }

  function normalizeExternalUrl(url) {
    if (!url || typeof url !== 'string') return '';
    var trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }

  function langOptionLabel(lang) {
    return lang.nativeLabel || lang.label || lang.code;
  }

  function isWelcomeEnabled() {
    var welcome = getRootCfg().welcome || {};
    return welcome.enabled !== false;
  }

  function getWelcomeEventCfg() {
    var df = getRootCfg().dialogflow || {};
    return df.welcomeEvent || {};
  }

  /** Home = FRESH; landing pages: ES_CONFIG.welcomeEventName on that page's embed script */
  function resolveWelcomeEventName_() {
    var cfg = getWelcomeEventCfg();
    var override =
      global.ES_CONFIG && global.ES_CONFIG.welcomeEventName
        ? String(global.ES_CONFIG.welcomeEventName).trim()
        : '';
    if (override) return override;
    return String(cfg.eventName || 'FRESH').trim();
  }

  function getEndChatEventCfg() {
    var df = getRootCfg().dialogflow || {};
    return df.endChatEvent || {};
  }

  function getAgentOrchestrationCfg() {
    var df = getRootCfg().dialogflow || {};
    var orch = Object.assign({}, df.agentOrchestration || {});
    var qaGlobal = global.ES_CONFIG && global.ES_CONFIG.agentOrchestration;
    if (qaGlobal && typeof qaGlobal === 'object') {
      Object.assign(orch, qaGlobal);
    }
    return orch;
  }

  function normalizeOrchText_(text) {
    return String(text || '').trim().toLowerCase();
  }

  function matchOrchTrigger_(text, triggers) {
    var needle = normalizeOrchText_(text);
    if (!needle || !Array.isArray(triggers)) return false;
    for (var i = 0; i < triggers.length; i++) {
      if (normalizeOrchText_(triggers[i]) === needle) return true;
    }
    return false;
  }

  function findChildByOpenTrigger_(text, orch) {
    if (!orch || orch.enabled === false || orch.role !== 'receptionist') return null;
    var children = orch.children || [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (matchOrchTrigger_(text, child.openTriggers || [])) return child;
    }
    return null;
  }

  function isReturnToReceptionistTrigger_(text, orch) {
    if (!orch || orch.enabled === false) return false;
    var triggers = orch.returnTriggers || [
      'main menu',
      'back',
      'menu',
      'receptionist',
      'back to menu',
      '← main menu',
    ];
    return matchOrchTrigger_(text, triggers);
  }

  function isRichContentEnabled() {
    var df = getRootCfg().dialogflow || {};
    var rc = df.richContentChips || {};
    return rc.enabled !== false;
  }

  /** 'chips' | 'dropdown' — how payload options are shown */
  function getInlineSelectDisplay() {
    var rc = (getRootCfg().dialogflow || {}).richContentChips || {};
    var mode = String((rc.inlineSelect && rc.inlineSelect.display) || 'chips')
      .toLowerCase()
      .trim();
    return mode === 'dropdown' ? 'dropdown' : 'chips';
  }

  /**
   * autoScroll — turn slow strip scrolling on/off.
   * stopAutoScrollOnInteraction — when autoScroll is on, user tap/arrow/scrollbar
   * stops auto-scroll for that one gallery/carousel only (default true).
   */
  function getScrollStripOpts(kind) {
    var rc = (getRootCfg().dialogflow || {}).richContentChips || {};
    var shared = rc.scrollStrip || {};
    var cfg =
      kind === 'cardCarousel'
        ? rc.cardCarousel || {}
        : rc.galleryImage || {};
    var autoScrollEnabled =
      cfg.autoScroll !== false && shared.autoScroll !== false;
    var stopOnInteract = true;
    if (cfg.stopAutoScrollOnInteraction === false) {
      stopOnInteract = false;
    } else if (shared.stopAutoScrollOnInteraction === false) {
      stopOnInteract = false;
    }
    return {
      autoScroll: autoScrollEnabled,
      secondsPerItem:
        cfg.autoScrollSecondsPerItem != null
          ? Number(cfg.autoScrollSecondsPerItem) || 4
          : shared.autoScrollSecondsPerItem != null
            ? Number(shared.autoScrollSecondsPerItem) || 4
            : 4,
      stopAutoScrollOnInteraction: autoScrollEnabled && stopOnInteract,
    };
  }

  function getWelcomeChips() {
    if (!isWelcomeEnabled()) return [];
    var welcome = getRootCfg().welcome || {};
    var chips = welcome.suggestionChips;
    if (!chips || chips.enabled === false) return [];
    var items = Array.isArray(chips) ? chips : chips.items || [];
    return items
      .map(function (c) {
        if (typeof c === 'string') return { label: c, message: c };
        return {
          label: c.label || c.message || '',
          message: c.message || c.label || '',
        };
      })
      .filter(function (c) {
        return c.label && c.message;
      });
  }

  function formatPersonaTime(persona) {
    if (!persona || !persona.showTime) return '';
    var tz = persona.timeZone || 'Asia/Kolkata';
    var opts = {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
    if (persona.showSeconds !== false) {
      opts.second = '2-digit';
    }
    if (persona.messageTimeIncludesDate) {
      opts.day = '2-digit';
      opts.month = 'short';
    }
    try {
      return new Date().toLocaleString('en-IN', opts);
    } catch (e) {
      return new Date().toLocaleTimeString('en-IN', { hour12: true });
    }
  }

  function ESChatWidget(options) {
    var common = getRootCfg();
    var header = common.header || {};
    var welcome = common.welcome || {};
    var deploy = common.deploy || {};

    this.cfg = global.ES_CHAT_UI_CONFIG || {};
    this.langList = getLangList();
    this.langMap = langMapFromList(this.langList);

    this.apiBase =
      (options && options.apiBase) ||
      (global.ES_CONFIG && global.ES_CONFIG.apiBase) ||
      deploy.publicBaseUrl ||
      '';
    this.esTestMode = !!(options && options.esTestMode);
    this.maxUploadMb = DEFAULT_MAX_UPLOAD_MB;
    this.maxUploadBytes = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

    this.title = header.title || 'ES Chatbot';
    this.subtitle = header.subtitle || 'Your quality & compliance guide';
    /* Use ?? so empty string "" in config is kept (|| wrongly showed defaults). */
    this.welcomeTitle =
      welcome.title ?? 'Welcome to ' + this.title;
    this.welcomeBody =
      welcome.body ??
      'Ask about quality standards, procedures, or compliance.';
    this.restartTitle = welcome.restartTitle ?? 'Conversation restarted';
    this.restartBody = welcome.restartBody ?? 'How can I help you today?';

    this.sessionId = this.newSessionId();
    this.language =
      (common.features &&
        common.features.multiLanguage &&
        common.features.multiLanguage.defaultLanguage) ||
      'en';
    this.isOpen = false;
    this.panelExpanded = false;
    this.isSending = false;
    this._welcomeEventSent = false;
    this._welcomeEventInFlight = false;
    this._endChatEventSent = false;
    this._endChatEventInFlight = false;
    this._endChatCloseTimer = null;
    this._idleTimer = null;
    this._idleActivityAt = 0;
    /** true after user sends a message / chip / dropdown (not just opening chat) */
    this.clientContext = {};
    this.recognition = null;
    this.root = null;
    this.els = {};
    this.liveAgentMode = false;
    this._liveAgentHumanActive = false;
    this._liveAgentWaiting = false;
    this._liveAgentBotCopilotActive = false;
    this.resetOrchestrationState();
    this.init();
  }

  ESChatWidget.prototype.resetOrchestrationState = function () {
    var orch = getAgentOrchestrationCfg();
    var df = getRootCfg().dialogflow || {};
    var overridePid =
      global.ES_CONFIG && global.ES_CONFIG.dialogflowProjectId
        ? String(global.ES_CONFIG.dialogflowProjectId).trim()
        : '';
    this._orchMode =
      orch.enabled !== false && orch.role === 'receptionist' ? 'receptionist' : 'standalone';
    this._orchChildId = '';
    this._orchChildLabel = '';
    this._activeDialogflowProjectId = overridePid || String(df.projectId || '').trim();
  };

  ESChatWidget.prototype.getDialogflowProjectId = function () {
    return this._activeDialogflowProjectId || '';
  };

  ESChatWidget.prototype.isOrchestrationReceptionistHost = function () {
    var orch = getAgentOrchestrationCfg();
    return !!(
      orch.enabled !== false &&
      orch.role === 'receptionist' &&
      Array.isArray(orch.children) &&
      orch.children.length
    );
  };

  ESChatWidget.prototype.withDialogflowRouting_ = function (body) {
    var payload = Object.assign({}, body || {});
    var pid = this.getDialogflowProjectId();
    if (pid) payload.dialogflowProjectId = pid;
    if (this._orchMode) payload.orchestrationMode = this._orchMode;
    if (this._orchChildId) payload.orchestrationChildId = this._orchChildId;
    var botId = getBotId_();
    if (botId) payload.botId = botId;
    return payload;
  };

  ESChatWidget.prototype.switchToChildAgent = function (child) {
    var orch = getAgentOrchestrationCfg();
    var welcome = String(
      child.welcomeEvent || orch.childWelcomeEvent || 'FRESH'
    ).trim();
    this._orchMode = 'child';
    this._orchChildId = child.id || '';
    this._orchChildLabel = child.label || child.id || '';
    this._activeDialogflowProjectId = String(child.projectId || '').trim();
    this.sessionId = this.newSessionId();
    this._welcomeEventSent = false;
    this._welcomeEventInFlight = false;
    return this.postToDialogflow(
      this.withDialogflowRouting_({
        event: welcome,
        sessionId: this.sessionId,
        languageCode: this.getDialogflowLang(),
      })
    );
  };

  ESChatWidget.prototype.switchToReceptionist = function () {
    var orch = getAgentOrchestrationCfg();
    var df = getRootCfg().dialogflow || {};
    var welcome = String(orch.returnWelcomeEvent || 'FRESH').trim();
    this._orchMode = 'receptionist';
    this._orchChildId = '';
    this._orchChildLabel = '';
    this._activeDialogflowProjectId = String(df.projectId || '').trim();
    this.sessionId = this.newSessionId();
    this._welcomeEventSent = false;
    this._welcomeEventInFlight = false;
    return this.postToDialogflow(
      this.withDialogflowRouting_({
        event: welcome,
        sessionId: this.sessionId,
        languageCode: this.getDialogflowLang(),
      })
    );
  };

  ESChatWidget.prototype.isHumanChatActive = function () {
    if (this._liveAgentBotCopilotActive) return false;
    return !!this._liveAgentHumanActive;
  };

  ESChatWidget.prototype.newSessionId = function () {
    var prefix = this.esTestMode ? 'es-test-' : 'web-';
    return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  };

  ESChatWidget.prototype.esTestApiHeaders = function (extra) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (this.esTestMode) headers['X-ES-Test-Mode'] = '1';
    return headers;
  };

  ESChatWidget.prototype.withEsTestBody = function (body) {
    var payload = Object.assign({}, body || {});
    if (this.esTestMode) payload.esTestMode = true;
    return payload;
  };

  ESChatWidget.prototype.init = function () {
    var isPreview = !!(global.ES_CONFIG && global.ES_CONFIG.previewViewport);
    if (!isPreview && !isChatbotEnabledAnywhere()) return;

    this.root = document.createElement('div');
    this.root.className = 'qa-widget';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.root.classList.add('qa-widget--preview');
    }
    this.updateChatbotVisibility();
    this.applyTheme();
    this.applyLayout();
    this.applyViewportAnchors_();
    this.cacheElements();
    this.applyHeaderIcon_(getRootCfg().header || {});
    if (this.els.launcher) {
      this.applyLauncherIcon_(
        this.els.launcher,
        getEffectiveCfg().launcher || {},
        getRootCfg().header || {}
      );
    }
    this.syncLauncherStripContent_();
    this.updateLauncherStripVisibility();
    this.applyFeatureToggles();
    this.bindEvents();
    this.bindViewportRestartToggle();
    this.fetchConfig();
    this.scheduleStripHandPop();
    this.maybeAutoOpen();
    this._bootLiveAgentScript();
  };

  ESChatWidget.prototype._bootLiveAgentScript = function () {
    var cfg = getRootCfg();
    var la = (cfg.common && cfg.common.liveAgent) || cfg.liveAgent || {};
    if (la.enabled === false || !this.apiBase) {
      return;
    }
    var self = this;
    if (typeof this.startLiveAgentMode === 'function') {
      setTimeout(function () {
        if (self._liveAgentResumeIfNeeded) {
          self._liveAgentResumeIfNeeded();
        }
      }, 400);
      return;
    }
    if (global.__qaLiveAgentScriptDone) {
      setTimeout(function () {
        if (typeof global.ES_LIVE_AGENT_PATCH === 'function') {
          global.ES_LIVE_AGENT_PATCH();
        }
        if (self._liveAgentResumeIfNeeded) {
          self._liveAgentResumeIfNeeded();
        }
      }, 100);
      return;
    }
    if (global.__qaLiveAgentScriptLoading) {
      return;
    }
    global.__qaLiveAgentScriptLoading = true;
    var base = String(this.apiBase).replace(/\/$/, '');
    var s = document.createElement('script');
    s.src = base + '/widget/live-agent-client.js?v=20260603-typing-handoff';
    s.onload = function () {
      global.__qaLiveAgentScriptDone = true;
      global.__qaLiveAgentScriptLoading = false;
      if (typeof global.ES_LIVE_AGENT_PATCH === 'function') {
        global.ES_LIVE_AGENT_PATCH();
      }
      if (self._liveAgentResumeIfNeeded) {
        self._liveAgentResumeIfNeeded();
      }
    };
    s.onerror = function () {
      global.__qaLiveAgentScriptLoading = false;
    };
    document.head.appendChild(s);
  };

  ESChatWidget.prototype.updateRestartVisibility = function () {
    if (!this.els || !this.els.restart) return;
    this.els.restart.style.display = getRestartCfg().enabled ? '' : 'none';
  };

  ESChatWidget.prototype.updateChatbotVisibility = function () {
    if (!this.root) return;
    var isPreview = !!(global.ES_CONFIG && global.ES_CONFIG.previewViewport);
    if (isPreview) {
      this.root.style.display = '';
      return;
    }
    this.root.style.display = isChatbotEnabledForViewport() ? '' : 'none';
  };

  ESChatWidget.prototype.syncLauncherStripContent_ = function () {
    var stripCfg = getLauncherStripCfg();
    var strip = this.root && this.root.querySelector('.qa-launcher-strip');
    if (!strip) return null;
    var wave = getStripWaveState(stripCfg);
    var waveEl = strip.querySelector('.qa-launcher-strip__wave');
    if (wave.waveOn) {
      if (!waveEl) {
        waveEl = document.createElement('span');
        waveEl.className = 'qa-launcher-strip__wave';
        waveEl.setAttribute('aria-hidden', 'true');
        strip.insertBefore(waveEl, strip.firstChild);
      }
      waveEl.textContent = wave.waveEmoji;
      waveEl.style.display = '';
    } else if (waveEl) {
      waveEl.textContent = '';
      waveEl.style.display = 'none';
    }
    var textEl = strip.querySelector('.qa-launcher-strip__text');
    if (!textEl) {
      textEl = document.createElement('span');
      textEl.className = 'qa-launcher-strip__text';
      strip.appendChild(textEl);
    }
    textEl.textContent = wave.bodyText;
    return wave;
  };

  ESChatWidget.prototype.updateLauncherStripVisibility = function () {
    var wrap =
      this.root && this.root.querySelector('.qa-launcher-strip-wrap');
    var strip = this.root && this.root.querySelector('.qa-launcher-strip');
    var host = wrap || strip;
    if (!host) return;
    var stripCfg = getLauncherStripCfg();
    var active = stripCfg.enabled !== false && stripCfg.text;
    if (!active) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    this.syncLauncherStripContent_();
    host.classList.toggle('qa-launcher-strip--hidden', !!this.isOpen);
  };

  ESChatWidget.prototype.scheduleStripHandPop = function () {
    var self = this;
    if (self._stripHandPopTimer) {
      clearTimeout(self._stripHandPopTimer);
      self._stripHandPopTimer = null;
    }
    var stripCfg = getLauncherStripCfg();
    var waveCfg = stripCfg.wavePopup || {};
    if (waveCfg.enabled === false || !stripCfg.text) return;
    var delay = Math.max(0, parseInt(waveCfg.delayMs, 10) || 0);
    self._stripHandPopTimer = setTimeout(function () {
      self._stripHandPopTimer = null;
      self.playStripHandPop();
    }, delay);
  };

  ESChatWidget.prototype.playStripHandPop = function () {
    if (this._stripHandPopPlayed) return;
    var stripCfg = getLauncherStripCfg();
    if (stripCfg.enabled === false || !stripCfg.text) return;
    var waveCfg = stripCfg.wavePopup || {};
    if (waveCfg.enabled === false) return;
    this.syncLauncherStripContent_();
    var wave = this.root && this.root.querySelector('.qa-launcher-strip__wave');
    if (!wave || !wave.textContent) return;
    this._stripHandPopPlayed = true;
    var scale = Math.max(1.5, parseFloat(waveCfg.scale) || 3);
    var ms = Math.max(200, parseInt(waveCfg.durationMs, 10) || 1000);
    wave.style.setProperty('--es-hand-pop-scale', String(scale));
    wave.style.setProperty('--es-hand-pop-duration', ms / 1000 + 's');
    wave.classList.remove('qa-launcher-strip__wave--pop');
    void wave.offsetWidth;
    wave.classList.add('qa-launcher-strip__wave--pop');
    setTimeout(function () {
      wave.classList.remove('qa-launcher-strip__wave--pop');
    }, ms);
  };

  ESChatWidget.prototype.applyChatSide = function () {
    if (!this.root) return;
    var side = getChatLayoutSide();
    this.root.classList.toggle('qa-widget--left', side === 'left');
  };

  ESChatWidget.prototype.bindViewportRestartToggle = function () {
    var self = this;
    this.updateRestartVisibility();
    this.updateLauncherStripVisibility();
    this.updateChatbotVisibility();
    if (!global.matchMedia) return;
    var mq = global.matchMedia('(max-width: 768px)');
    var onChange = function () {
      self.updateChatbotVisibility();
      self.updateRestartVisibility();
      self.updateLauncherStripVisibility();
      self.applyChatSide();
      self.applyLayout();
      self.applyFeatureToggles();
      self.updateLauncherCloseBubble();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  };

  ESChatWidget.prototype.applyTheme = function () {
    var common = getRootCfg();
    var theme = common.theme || {};
    var typo = common.typography || {};
    if (typo.fontFamily) {
      ensureGoogleFontLoaded_(typo.fontFamily);
      this.root.style.setProperty('--es-font', typo.fontFamily);
      this.root.style.fontFamily = typo.fontFamily;
    }
    Object.keys(theme).forEach(
      function (key) {
        if (key === 'cost' || key === '--es-header-color') return;
        if (key === '--es-header-bg') return;
        var val = theme[key];
        if (val == null || val === '') {
          this.root.style.removeProperty(key);
          return;
        }
        this.root.style.setProperty(key, val);
      }.bind(this)
    );
    applyHeaderBackground_(this.root);
    var bgVal = theme['--es-bg'];
    var bg2Val = theme['--es-bg-2'];
    var surfaceVal = theme['--es-surface'];
    if ((bgVal == null || bgVal === '') && surfaceVal != null && surfaceVal !== '') {
      bgVal = surfaceVal;
    }
    if (bgVal != null && bgVal !== '') {
      this.root.style.setProperty('--es-bg', bgVal);
      if (bg2Val != null && bg2Val !== '') {
        this.root.style.setProperty('--es-bg-2', bg2Val);
      } else {
        this.root.style.setProperty('--es-bg-2', bgVal);
      }
    } else {
      this.root.style.removeProperty('--es-bg');
      this.root.style.removeProperty('--es-bg-2');
    }
    var ml = common.features && common.features.multiLanguage;
    if (ml) {
      var ch = ml.selectWidthCh != null ? ml.selectWidthCh : 10;
      var extra = ml.selectWidthExtraPx != null ? ml.selectWidthExtraPx : 5;
      this.root.style.setProperty('--es-lang-width', 'calc(' + ch + 'ch + ' + extra + 'px)');
      if (ml.showSelectBorder === false) {
        this.root.classList.add('qa-lang--no-border');
      }
    }
    this.applyChatSide();

    var panel = common.chatPanel && common.chatPanel.borderRadius;
    if (panel) {
      this.root.style.setProperty('--es-panel-tl', panel.topLeft || '16px');
      this.root.style.setProperty('--es-panel-tr', panel.topRight || '16px');
      this.root.style.setProperty('--es-panel-bl', panel.bottomLeft || '16px');
      this.root.style.setProperty('--es-panel-br', panel.bottomRight || '16px');
    }

    var cp = common.chatPanel || {};
    var wallUrl = normalizeIconUrl(cp.backgroundImageUrl);
    if (wallUrl) {
      var fit = String(cp.backgroundImageFit || 'cover').trim().toLowerCase();
      if (fit !== 'contain' && fit !== 'repeat') fit = 'cover';
      this.root.style.setProperty(
        '--es-panel-bg-image',
        'url("' + wallUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")'
      );
      if (fit === 'repeat') {
        this.root.style.setProperty('--es-panel-bg-size', 'auto');
        this.root.style.setProperty('--es-panel-bg-repeat', 'repeat');
      } else {
        this.root.style.setProperty('--es-panel-bg-size', fit);
        this.root.style.setProperty('--es-panel-bg-repeat', 'no-repeat');
      }
      this.root.classList.add('qa-panel-has-wallpaper');
    } else {
      this.root.style.removeProperty('--es-panel-bg-image');
      this.root.style.removeProperty('--es-panel-bg-size');
      this.root.style.removeProperty('--es-panel-bg-repeat');
      this.root.classList.remove('qa-panel-has-wallpaper');
    }

    var hdrLayout = getHeaderLayoutCfg();
    if (hdrLayout.titleFontSizePx != null) {
      this.root.style.setProperty(
        '--es-header-title-size',
        hdrLayout.titleFontSizePx + 'px'
      );
    }
    if (hdrLayout.subtitleFontSizePx != null) {
      this.root.style.setProperty(
        '--es-header-subtitle-size',
        hdrLayout.subtitleFontSizePx + 'px'
      );
    }
    var iconPx = hdrLayout.iconSizePx != null ? hdrLayout.iconSizePx : 40;
    this.root.style.setProperty('--es-header-icon-size', iconPx + 'px');

    var bp = common.botPersona || {};
    var up = common.userPersona || {};
    if (bp.avatarSizePx) {
      this.root.style.setProperty('--es-bot-avatar-size', bp.avatarSizePx + 'px');
    }
    var botAvatarShape = String(bp.avatarShape || 'circle').trim().toLowerCase();
    this.root.style.setProperty(
      '--es-bot-avatar-radius',
      botAvatarShape === 'square' ? '0' : '50%'
    );
    if (up.avatarSizePx) {
      this.root.style.setProperty('--es-user-avatar-size', up.avatarSizePx + 'px');
    }
    if (bp.gapBelowPx != null) {
      this.root.style.setProperty('--es-bot-gap', bp.gapBelowPx + 'px');
    }

    var pd = common.personaDisplay || {};
    if (pd.nameFontSizePx != null) {
      this.root.style.setProperty(
        '--es-persona-name-size',
        pd.nameFontSizePx + 'px'
      );
    }
    if (pd.timeFontSizePx != null) {
      this.root.style.setProperty(
        '--es-persona-time-size',
        pd.timeFontSizePx + 'px'
      );
    }
    var typingCfg = getTypingIndicatorCfg();
    this.root.style.setProperty(
      '--es-typing-dot-duration',
      Math.max(0.45, typingCfg.dotsIntervalMs / 1000) + 's'
    );
    var themeExtra = common.theme || {};
    if (themeExtra['--es-bot-msg-radius']) {
      this.root.style.setProperty('--es-bot-msg-radius', themeExtra['--es-bot-msg-radius']);
    }
    if (themeExtra['--es-user-msg-radius']) {
      this.root.style.setProperty('--es-user-msg-radius', themeExtra['--es-user-msg-radius']);
    }
    if (pd.blurPx != null) {
      this.root.style.setProperty('--es-persona-blur', pd.blurPx + 'px');
    }
    if (pd.opacity != null) {
      this.root.style.setProperty('--es-persona-meta-opacity', String(pd.opacity));
    }

    var pb = deepMerge(common.poweredBy || {}, getEffectiveCfg().poweredBy || {});
    if (pb.color) this.root.style.setProperty('--es-powered-color', pb.color);
    if (pb.fontSizePx) {
      this.root.style.setProperty('--es-powered-size', pb.fontSizePx + 'px');
    }
    if (pb.logoHeightPx != null) {
      this.root.style.setProperty('--es-powered-logo-height', pb.logoHeightPx + 'px');
    }
    var align = String(pb.align || 'right').toLowerCase();
    var justify =
      align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end';
    this.root.style.setProperty('--es-powered-toolbar-justify', justify);
    this.root.style.setProperty(
      '--es-powered-offset-down',
      (pb.offsetDownPx != null ? pb.offsetDownPx : 0) + 'px'
    );
    this.root.style.setProperty(
      '--es-powered-offset-up',
      (pb.offsetUpPx != null ? pb.offsetUpPx : 0) + 'px'
    );
    this.root.style.setProperty(
      '--es-powered-offset-left',
      (pb.offsetLeftPx != null ? pb.offsetLeftPx : 0) + 'px'
    );
    this.root.style.setProperty(
      '--es-powered-offset-right',
      (pb.offsetRightPx != null ? pb.offsetRightPx : 0) + 'px'
    );
    var rb = common.restartButton || {};
    var restartGap =
      rb.gapAfterLanguagePx != null
        ? rb.gapAfterLanguagePx
        : rb.offsetLeftPx;
    if (restartGap != null) {
      this.root.style.setProperty('--es-restart-gap-after-lang', restartGap + 'px');
    }

    var rc = common.dialogflow && common.dialogflow.richContentChips;
    var imgCfg = (rc && rc.infoCardImage) || {};
    if (imgCfg.cardWidthPx != null) {
      this.root.style.setProperty(
        '--es-rich-card-width',
        imgCfg.cardWidthPx + 'px'
      );
    }
    if (imgCfg.imageMaxHeightPx != null) {
      this.root.style.setProperty(
        '--es-rich-card-img-max-height',
        imgCfg.imageMaxHeightPx + 'px'
      );
    }
    if (imgCfg.imageHeightPx != null) {
      this.root.style.setProperty(
        '--es-rich-card-img-height',
        imgCfg.imageHeightPx + 'px'
      );
    }
    if (imgCfg.objectFit) {
      this.root.style.setProperty('--es-rich-card-img-fit', imgCfg.objectFit);
    }
    if (imgCfg.background) {
      this.root.style.setProperty('--es-rich-card-img-bg', imgCfg.background);
    }

    var galCfg = (rc && rc.galleryImage) || {};
    if (galCfg.itemWidthPx != null) {
      this.root.style.setProperty(
        '--es-gallery-item-width',
        galCfg.itemWidthPx + 'px'
      );
    }
    if (galCfg.itemMaxWidthVw != null) {
      this.root.style.setProperty(
        '--es-gallery-item-max-vw',
        galCfg.itemMaxWidthVw + 'vw'
      );
    }
    if (galCfg.imageHeightPx != null) {
      this.root.style.setProperty(
        '--es-gallery-img-height',
        galCfg.imageHeightPx + 'px'
      );
    }
    if (galCfg.objectFit) {
      this.root.style.setProperty('--es-gallery-img-fit', galCfg.objectFit);
    }
    if (galCfg.background) {
      this.root.style.setProperty('--es-gallery-img-bg', galCfg.background);
    }

    var carouselCfg = (rc && rc.cardCarousel) || {};
    if (carouselCfg.cardWidthPx != null) {
      this.root.style.setProperty(
        '--es-carousel-card-width',
        carouselCfg.cardWidthPx + 'px'
      );
    }
    if (carouselCfg.imageHeightPx != null) {
      this.root.style.setProperty(
        '--es-carousel-img-height',
        carouselCfg.imageHeightPx + 'px'
      );
    }
    if (carouselCfg.objectFit) {
      this.root.style.setProperty('--es-carousel-img-fit', carouselCfg.objectFit);
    }
    if (carouselCfg.background) {
      this.root.style.setProperty('--es-carousel-img-bg', carouselCfg.background);
    }
  };

  ESChatWidget.prototype.applyLayout = function () {
    var eff = getEffectiveCfg();
    var win = eff.chatWindow || {};
    var panel = this.root.querySelector('.qa-panel');
    var launcher = this.root.querySelector('.qa-launcher');
    if (!panel) return;

    var pos = win.position || {};
    var topInset = win.topInsetPx != null ? win.topInsetPx : 16;
    var widgetBottom = pos.bottomPx != null ? pos.bottomPx : 24;
    this.root.style.setProperty('--es-panel-top-inset', topInset + 'px');
    this.root.style.setProperty('--es-widget-bottom', widgetBottom + 'px');

    var isPreview = !!(global.ES_CONFIG && global.ES_CONFIG.previewViewport);
    this.applyChatSide();

    var launch = eff.launcher || {};
    var hdr = getRootCfg().header || eff.header || {};
    if (launcher) {
      if (launch.sizePx) {
        launcher.style.width = launch.sizePx + 'px';
        launcher.style.height = launch.sizePx + 'px';
      }
      if (launch.cornerRoundness) {
        launcher.style.borderRadius = launch.cornerRoundness;
      }
      this.applyLauncherIcon_(launcher, launch, hdr);
    }
    var wrap = this.root.querySelector('.qa-launcher-wrap');
    this.applyLauncherRingStyles_(wrap, launch);

    this.applyLauncherStripStyles_();

    this.applyPanelSize_();

    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.root.classList.add('qa-widget--preview');
      this.applyPreviewPanelLayout_();
    }

    this.applyHeaderIcon_(hdr);
    this.applyViewportAnchors_();
    this.syncLauncherStack();

    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.applyPreviewPanelLayout_();
      this.syncPreviewStageLayout_();
    }
  };

  ESChatWidget.prototype.applyPreviewPanelLayout_ = function () {
    if (!global.ES_CONFIG || !global.ES_CONFIG.previewViewport || !this.root) return;
    this.applyPanelSize_();
  };

  ESChatWidget.prototype.getBasePanelDimensions_ = function () {
    var win = getEffectiveCfg().chatWindow || {};
    var isMob = isMobileViewport();
    var isPreview = !!(global.ES_CONFIG && global.ES_CONFIG.previewViewport);
    var isMobPreview = isPreview && global.ES_CONFIG.previewViewport === 'mob';
    var w = win.widthPx;
    var h = win.heightPx;

    if (!w) {
      if (isMobPreview) {
        w = Math.max(
          300,
          390 - (win.horizontalInsetPx != null ? win.horizontalInsetPx : 12) * 2
        );
      } else if (isMob && win.horizontalInsetPx != null) {
        var vw = isPreview
          ? isMobPreview
            ? 390
            : window.innerWidth || 800
          : window.innerWidth || 800;
        w = Math.max(300, vw - win.horizontalInsetPx * 2);
      } else if (isPreview) {
        w = 400;
      }
    }

    if (!h) {
      h =
        isMobPreview || (isMob && win.heightPx == null)
          ? win.minHeightPx || 480
          : 520;
    }

    return {
      widthPx: w,
      heightPx: h,
      minHeightPx: win.minHeightPx != null ? win.minHeightPx : 360,
      horizontalInsetPx: win.horizontalInsetPx,
      useMobileCalcWidth:
        isMob &&
        win.horizontalInsetPx != null &&
        win.widthPx == null &&
        !this.panelExpanded,
    };
  };

  ESChatWidget.prototype.applyPanelSize_ = function () {
    var panel = this.els.panel || this.root.querySelector('.qa-panel');
    if (!panel || !this.root) return;

    var cfg = getExpandPanelCfg();
    if (!cfg.enabled && this.panelExpanded) {
      this.panelExpanded = false;
    }

    var base = this.getBasePanelDimensions_();
    var w = base.widthPx;
    var h = base.heightPx;

    if (this.panelExpanded && cfg.enabled) {
      if (w) w = Math.round(w * (1 + cfg.widthIncreasePercent / 100));
      h = Math.round(h * (1 + cfg.heightIncreasePercent / 100));
    }

    if (this.panelExpanded && cfg.enabled) {
      var win = getEffectiveCfg().chatWindow || {};
      var topInset = win.topInsetPx != null ? win.topInsetPx : 16;
      var pos = win.position || {};
      var widgetBottom = pos.bottomPx != null ? pos.bottomPx : 24;
      var stackPx = this.isOpen ? getOpenPanelStackPx() : getLauncherStackPx();
      var maxH =
        (window.innerHeight || 800) -
        topInset -
        stackPx -
        widgetBottom -
        8 +
        getPanelHeightExtraPx(this.isOpen);
      var maxW = (window.innerWidth || 800) - 16;
      if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
        var previewCap =
          global.ES_CONFIG.previewViewport === 'mob'
            ? Math.max(280, 390 - 16)
            : this.panelExpanded && cfg.enabled
              ? 960
              : 720;
        maxW =
          global.ES_CONFIG.previewViewport === 'mob'
            ? previewCap
            : Math.min(maxW, previewCap);
        maxH = Math.min(maxH, global.ES_CONFIG.previewViewport === 'mob' ? 640 : maxH);
      }
      if (w) w = Math.min(w, maxW);
      h = Math.min(h, maxH);
    }

    if (base.useMobileCalcWidth) {
      panel.style.width =
        'calc(100vw - ' + base.horizontalInsetPx * 2 + 'px)';
      panel.style.maxWidth = panel.style.width;
    } else if (w) {
      panel.style.width = w + 'px';
      panel.style.maxWidth = w + 'px';
    }

    this.root.style.setProperty('--es-panel-height', h + 'px');
    this.root.style.setProperty(
      '--es-panel-min-height',
      base.minHeightPx + 'px'
    );

    panel.classList.toggle(
      'qa-panel--expanded',
      !!(this.panelExpanded && cfg.enabled)
    );
    this.root.classList.toggle(
      'qa-widget--panel-expanded',
      !!(this.panelExpanded && cfg.enabled)
    );

    if (this.isOpen) {
      var openH = computeOpenPanelHeightPx(this.panelExpanded);
      panel.style.height = openH + 'px';
      panel.style.maxHeight = openH + 'px';
    } else if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      panel.style.height = h + 'px';
      panel.style.maxHeight = h + 'px';
    } else {
      panel.style.height = '';
      panel.style.maxHeight = '';
    }

    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      var previewPanelW = w;
      if (!previewPanelW && !base.useMobileCalcWidth) {
        var previewWin = getEffectiveCfg().chatWindow || {};
        previewPanelW = base.widthPx;
        if (!previewPanelW) {
          var insetPx =
            previewWin.horizontalInsetPx != null ? previewWin.horizontalInsetPx : 12;
          previewPanelW =
            global.ES_CONFIG.previewViewport === 'mob'
              ? Math.max(300, 390 - insetPx * 2)
              : 400;
        }
        if (this.panelExpanded && cfg.enabled) {
          previewPanelW = Math.round(
            previewPanelW * (1 + cfg.widthIncreasePercent / 100)
          );
        }
      }
      if (previewPanelW) {
        var previewMaxW =
          global.ES_CONFIG.previewViewport === 'mob'
            ? Math.max(280, 390 - 16)
            : this.panelExpanded && cfg.enabled
              ? 960
              : Math.min(global.innerWidth || 800, 720);
        previewPanelW = Math.min(previewPanelW, previewMaxW);
        this.root.style.setProperty('--es-preview-panel-w', previewPanelW + 'px');
      }
    }

    this.syncExpandPanelControl_();
  };

  ESChatWidget.prototype.syncExpandPanelControl_ = function () {
    var btn = this.els.panelExpand;
    if (!btn) return;
    var cfg = getExpandPanelCfg();
    btn.hidden = !cfg.enabled;
    btn.setAttribute('aria-pressed', this.panelExpanded ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      this.panelExpanded ? 'Collapse chat panel' : 'Expand chat panel'
    );
    var expandIcon = btn.querySelector('.qa-header__expand-icon--expand');
    var collapseIcon = btn.querySelector('.qa-header__expand-icon--collapse');
    if (expandIcon) {
      expandIcon.hidden = this.panelExpanded;
      expandIcon.setAttribute('aria-hidden', this.panelExpanded ? 'true' : 'false');
    }
    if (collapseIcon) {
      collapseIcon.hidden = !this.panelExpanded;
      collapseIcon.setAttribute(
        'aria-hidden',
        this.panelExpanded ? 'false' : 'true'
      );
    }
  };

  ESChatWidget.prototype.togglePanelExpand = function () {
    if (!getExpandPanelCfg().enabled) return;
    this.panelExpanded = !this.panelExpanded;
    this.applyPanelSize_();
    this.syncLauncherStack();
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.syncPreviewStageLayout_();
    }
  };

  ESChatWidget.prototype.applyViewportAnchors_ = function () {
    if (!this.root) return;
    var v = getViewportAnchorVars_();
    var stackPx = this.isOpen ? getOpenPanelStackPx() : v.stackPx;
    var panelBottom = this.isOpen ? v.bubbleBottom + stackPx : v.bubbleBottom;

    this.root.style.setProperty('--es-bubble-bottom', v.bubbleBottom + 'px');
    this.root.style.setProperty('--es-bubble-side', v.sidePx + 'px');
    this.root.style.setProperty('--es-strip-bottom', v.bubbleBottom + v.stripLift + 'px');
    this.root.style.setProperty('--es-launcher-stack', stackPx + 'px');
    this.root.style.setProperty('--es-panel-bottom', panelBottom + 'px');
    this.root.style.setProperty('--es-widget-bottom', v.bottomPad + 'px');

    var stripCfg = getLauncherStripCfg();
    var sp = stripCfg.position || {};
    var stripSidePx =
      v.side === 'left'
        ? sp.leftPx != null
          ? sp.leftPx
          : v.sidePx
        : sp.rightPx != null
          ? sp.rightPx
          : v.sidePx;
    this.root.style.setProperty('--es-strip-side', stripSidePx + 'px');

    var launcherWrap = this.root.querySelector('.qa-launcher-wrap');
    if (!v.isPreview && launcherWrap) {
      launcherWrap.style.position = 'fixed';
      launcherWrap.style.bottom = v.bubbleBottom + 'px';
      if (v.side === 'left') {
        launcherWrap.style.left = v.sidePx + 'px';
        launcherWrap.style.right = 'auto';
      } else {
        launcherWrap.style.right = v.sidePx + 'px';
        launcherWrap.style.left = 'auto';
      }
    } else if (launcherWrap) {
      launcherWrap.style.bottom = '';
      launcherWrap.style.left = '';
      launcherWrap.style.right = '';
      launcherWrap.style.position = '';
    }

    var stripWrap = this.root.querySelector('.qa-launcher-strip-wrap');
    if (stripWrap) {
      if (!v.isPreview) {
        stripWrap.style.position = 'fixed';
        stripWrap.style.bottom = v.bubbleBottom + v.stripLift + 'px';
        if (v.side === 'left') {
          stripWrap.style.left = stripSidePx + 'px';
          stripWrap.style.right = 'auto';
        } else {
          stripWrap.style.right = stripSidePx + 'px';
          stripWrap.style.left = 'auto';
        }
      } else {
        stripWrap.style.bottom = '';
        stripWrap.style.left = '';
        stripWrap.style.right = '';
        stripWrap.style.position = '';
      }
    }

    var panel = this.els.panel || this.root.querySelector('.qa-panel');
    if (panel) {
      if (!v.isPreview) {
        panel.style.position = 'fixed';
        panel.style.bottom = panelBottom + 'px';
        if (v.side === 'left') {
          panel.style.left = v.sidePx + 'px';
          panel.style.right = 'auto';
        } else {
          panel.style.right = v.sidePx + 'px';
          panel.style.left = 'auto';
        }
      } else {
        panel.style.bottom = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.position = '';
      }
    }

    if (v.isPreview) {
      var win = getEffectiveCfg().chatWindow || {};
      var previewW = win.widthPx;
      if (!previewW) {
        previewW =
          global.ES_CONFIG.previewViewport === 'mob'
            ? Math.max(
                300,
                390 - (win.horizontalInsetPx != null ? win.horizontalInsetPx : 12) * 2
              )
            : 400;
      }
      var expandCfg = getExpandPanelCfg();
      if (this.panelExpanded && expandCfg.enabled) {
        previewW = Math.round(previewW * (1 + expandCfg.widthIncreasePercent / 100));
      }
      this.root.style.setProperty('--es-preview-panel-w', previewW + 'px');
    }
  };

  ESChatWidget.prototype.syncPreviewStageLayout_ = function () {
    var qa = global.ES_CONFIG || {};
    if (!qa.previewViewport || !this.root) return;

    var embeddedH = 0;
    try {
      if (global.frameElement) {
        embeddedH =
          global.frameElement.clientHeight ||
          Math.round(global.frameElement.getBoundingClientRect().height) ||
          0;
      }
    } catch (e) {
      /* ignore */
    }
    if (embeddedH > 0) {
      global.previewDocHeightPx = embeddedH;
      document.documentElement.style.setProperty('--es-preview-vh', embeddedH + 'px');
    }

    var win = getEffectiveCfg().chatWindow || {};
    var panelH = win.heightPx;
    if (!panelH) {
      panelH = qa.previewViewport === 'mob' ? win.minHeightPx || 480 : 520;
    }
    var v = getViewportAnchorVars_();
    var launch = getEffectiveCfg().launcher || {};
    var launchSize = launch.sizePx != null ? launch.sizePx : 64;
    var stageH = global.previewDocHeightPx;
    if (!stageH || stageH < 120) {
      stageH = panelH + v.stackPx + v.bottomPad + 24;
    }

    document.documentElement.style.setProperty('--es-preview-vh', stageH + 'px');
    var availPanelH = Math.max(240, stageH - v.bubbleBottom - launchSize - 16);
    panelH = Math.min(panelH, availPanelH);
    this.root.style.setProperty('--es-panel-height', panelH + 'px');

    this.applyViewportAnchors_();
    this.applyPanelSize_();
  };

  ESChatWidget.prototype.isComposerUploadEnabled = function () {
    var cfg = (getEffectiveCfg().features || {}).composerUpload || {};
    return cfg.enabled !== false;
  };

  ESChatWidget.prototype.buildComposerUploadHtml = function () {
    if (!this.isComposerUploadEnabled()) return '';
    var uploadCfg = (getEffectiveCfg().features || {}).composerUpload || {};
    var display = String(uploadCfg.display || 'rich').toLowerCase();
    var emoji = String(uploadCfg.emoji || '📎').trim() || '📎';
    var accept = uploadCfg.accept ? String(uploadCfg.accept) : '';
    var tilt = Number(uploadCfg.tiltDeg);
    if (!isFinite(tilt)) tilt = -18;
    var glyph =
      display === 'emoji'
        ? '<span class="qa-attach__emoji" aria-hidden="true">' +
          this.escape(emoji) +
          '</span>'
        : '<span class="qa-attach__icon-wrap" aria-hidden="true">' + ICONS.attach + '</span>';
    return (
      '<button type="button" class="qa-attach" aria-label="Upload document" title="Upload document" style="--es-attach-tilt:' +
      tilt +
      'deg">' +
      '<span class="qa-attach__glyph">' +
      glyph +
      '</span></button>' +
      '<input type="file" class="qa-attach-input" hidden multiple' +
      (accept ? ' accept="' + this.escape(accept) + '"' : '') +
      ' />'
    );
  };

  ESChatWidget.prototype.applyFeatureToggles = function () {
    var eff = getEffectiveCfg();
    var feats = eff.features || {};
    if (this.els.mic) {
      this.els.mic.style.display = isSpeechToTextEnabled() ? '' : 'none';
    }
    if (this.els.attach) {
      this.els.attach.style.display = this.isComposerUploadEnabled() ? '' : 'none';
    }
    this.updateRestartVisibility();
    var ml =
      (getRootCfg().features && getRootCfg().features.multiLanguage) ||
      feats.multiLanguage ||
      {};
    if (this.els.lang) {
      this.els.lang.style.display = ml.enabled === false ? 'none' : '';
    }
    var pb = eff.poweredBy;
    var powered = this.root.querySelector('.qa-powered');
    if (powered) {
      powered.style.display = pb && pb.enabled === false ? 'none' : '';
    }
  };

  ESChatWidget.prototype.setIconSlot_ = function (container, url, fallbackSvg) {
    if (!container) return;
    var normalized = normalizeIconUrl(url);
    container.innerHTML = '';
    if (!normalized) {
      container.innerHTML = fallbackSvg || '';
      return;
    }
    var img = document.createElement('img');
    img.className = 'qa-icon-img';
    img.alt = '';
    img.decoding = 'sync';
    img.loading = 'eager';
    var apiBase = String(
      (global.ES_CONFIG && global.ES_CONFIG.apiBase) ||
        (global.location && global.location.origin) ||
        ''
    ).replace(/\/$/, '');
    var candidates = [];
    function pushCandidate(raw) {
      var n = normalizeIconUrl(raw);
      if (!n) return;
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] === n) return;
      }
      candidates.push(n);
    }
    pushCandidate(normalized);
    if (/^https?:\/\//i.test(normalized)) {
      try {
        var parsed = new URL(normalized);
        pushCandidate(parsed.pathname + parsed.search);
        if (apiBase) {
          pushCandidate(apiBase + parsed.pathname + parsed.search);
        }
      } catch (e) {
        /* ignore */
      }
    }
    var attempt = 0;
    img.onerror = function () {
      attempt += 1;
      if (attempt < candidates.length) {
        img.src = candidates[attempt];
        return;
      }
      if (attempt === candidates.length) {
        var sep = normalized.indexOf('?') >= 0 ? '&' : '?';
        img.src = normalized + sep + 't=' + Date.now();
        attempt += 1;
        return;
      }
      img.onerror = null;
      container.innerHTML = fallbackSvg || '';
    };
    img.src = candidates[0];
    container.appendChild(img);
  };

  ESChatWidget.prototype.ensureHeaderIconElement_ = function () {
    var hdrEl = this.root && this.root.querySelector('.qa-header');
    if (!hdrEl) return null;
    var iconWrap = hdrEl.querySelector('.qa-header__icon');
    if (!iconWrap) {
      iconWrap = document.createElement('div');
      iconWrap.className = 'qa-header__icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      hdrEl.insertBefore(iconWrap, hdrEl.firstChild);
    }
    return iconWrap;
  };

  ESChatWidget.prototype.applyHeaderIconShape_ = function (hdr) {
    hdr = hdr || getRootCfg().header || {};
    var iconWrap = this.root && this.root.querySelector('.qa-header__icon');
    if (!iconWrap) return;
    iconWrap.classList.remove(
      'qa-header__icon--circle',
      'qa-header__icon--square',
      'qa-header__icon--curved',
      'qa-header__icon--cutting-edge'
    );
    var shape = String(hdr.iconShape || 'square').toLowerCase();
    if (shape === 'circle' || shape === 'circular') {
      iconWrap.classList.add('qa-header__icon--circle');
    } else if (
      shape === 'curved' ||
      shape === 'curved-edge' ||
      shape === 'cutting-edge' ||
      shape === 'cuttingedge'
    ) {
      iconWrap.classList.add('qa-header__icon--curved');
    } else {
      iconWrap.classList.add('qa-header__icon--square');
    }
  };

  ESChatWidget.prototype.applyHeaderIcon_ = function (hdr) {
    hdr = hdr || getRootCfg().header || {};
    var iconWrap =
      this.root && (this.root.querySelector('.qa-header__icon') || this.ensureHeaderIconElement_());
    if (!iconWrap) return;
    if (hdr.showHeaderIcon === false) {
      iconWrap.style.display = 'none';
      iconWrap.setAttribute('aria-hidden', 'true');
      return;
    }
    iconWrap.style.display = '';
    iconWrap.removeAttribute('aria-hidden');
    this.setIconSlot_(iconWrap, resolveHeaderIconUrl(hdr), ICONS.header);
    this.applyHeaderIconShape_(hdr);
  };

  ESChatWidget.prototype.getLauncherIconZoomFactor_ = function (launch) {
    launch = launch || (getEffectiveCfg().launcher || {});
    var zoomRaw = launch.iconZoomPercent;
    var zoom = 1;
    if (zoomRaw != null && zoomRaw !== '') {
      var n = parseInt(zoomRaw, 10);
      if (!isNaN(n)) {
        zoom = Math.max(1, Math.min(4, n / 100));
      }
    }
    return zoom;
  };

  ESChatWidget.prototype.applyLauncherIcon_ = function (launcher, launch, hdr) {
    if (!launcher) return;
    launch = launch || (getEffectiveCfg().launcher || {});
    hdr = hdr || getRootCfg().header || {};
    var openState = launcher.querySelector('.qa-launcher__state--open');
    if (!openState) return;
    var url = resolveLauncherIconUrl(launch, hdr);
    var normalized = normalizeIconUrl(url) || '';
    var existingImg = openState.querySelector('img.qa-icon-img');
    if (existingImg && existingImg.dataset.iconNormalized === normalized && normalized) {
      this.applyLauncherIconStyle_(launch, launcher);
      return;
    }
    if (normalized) {
      launcher.classList.add('qa-launcher--has-icon');
    } else {
      launcher.classList.remove('qa-launcher--has-icon');
    }
    this.setIconSlot_(openState, url, ICONS.chat);
    var img = openState.querySelector('img.qa-icon-img');
    if (img && normalized) {
      img.dataset.iconNormalized = normalized;
      var self = this;
      var launchCopy = launch;
      var launcherCopy = launcher;
      img.addEventListener(
        'load',
        function () {
          self.applyLauncherIconStyle_(launchCopy, launcherCopy);
        },
        { once: true }
      );
    }
    this.applyLauncherIconStyle_(launch, launcher);
  };

  ESChatWidget.prototype.applyLauncherIconStyle_ = function (launch, launcher) {
    if (!this.root) return;
    launch = launch || (getEffectiveCfg().launcher || {});
    launcher = launcher || this.root.querySelector('.qa-launcher');
    if (!launcher) return;
    var openState = launcher.querySelector('.qa-launcher__state--open');
    var img = openState && openState.querySelector('img');
    if (img) {
      launcher.classList.add('qa-launcher--has-icon');
    } else if (!normalizeIconUrl(resolveLauncherIconUrl(launch))) {
      launcher.classList.remove('qa-launcher--has-icon');
    }
    var zoom = this.getLauncherIconZoomFactor_(launch);
    var zoomStr = String(zoom);
    this.root.style.setProperty('--es-launcher-icon-zoom', zoomStr);
    launcher.style.setProperty('--es-launcher-icon-zoom', zoomStr);
    if (!img) return;
    img.style.removeProperty('width');
    img.style.removeProperty('height');
    img.style.removeProperty('min-width');
    img.style.removeProperty('min-height');
    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center';
  };

  ESChatWidget.prototype.applyLauncherRingStyles_ = function (wrap, launch) {
    wrap = wrap || (this.root && this.root.querySelector('.qa-launcher-wrap'));
    if (!wrap) return;
    launch = launch || (getEffectiveCfg().launcher || {});
    wrap.classList.remove(
      'qa-launcher-wrap--ring',
      'qa-launcher-wrap--ring-ig',
      'qa-launcher-wrap--ring-brand',
      'qa-launcher-wrap--ring-spin'
    );
    wrap.style.removeProperty('--es-ring-width');
    wrap.style.removeProperty('--es-ring-gradient');
    wrap.style.removeProperty('--es-ring-duration');

    var ring = launch.storyRing;
    if (!ring || ring.enabled === false) return;

    wrap.classList.add('qa-launcher-wrap--ring');
    var ringW = ring.widthPx != null ? ring.widthPx : 2.5;
    wrap.style.setProperty('--es-ring-width', ringW + 'px');
    wrap.style.setProperty('--es-ring-gradient', getStoryRingGradient(ring));
    if (ring.instagramStyle === true) {
      wrap.classList.add('qa-launcher-wrap--ring-ig');
    } else {
      wrap.classList.add('qa-launcher-wrap--ring-brand');
    }
    var motionOn = ring.colorRingMotionEnabled !== false;
    var rotateSecs = ring.rotateSeconds != null ? ring.rotateSeconds : 3;
    if (motionOn && rotateSecs > 0) {
      wrap.classList.add('qa-launcher-wrap--ring-spin');
      wrap.style.setProperty('--es-ring-duration', rotateSecs + 's');
    }
  };

  ESChatWidget.prototype.applyLauncherStripStyles_ = function () {
    var strip = this.root && this.root.querySelector('.qa-launcher-strip');
    if (!strip) return;
    var stripCfg = getLauncherStripCfg();
    var st = stripCfg.style || {};
    if (st.fontSizePx != null) {
      strip.style.fontSize = st.fontSizePx + 'px';
    } else {
      strip.style.fontSize = '';
    }
    if (st.paddingXpx != null || st.paddingYpx != null) {
      strip.style.padding =
        (st.paddingYpx != null ? st.paddingYpx : 8) +
        'px ' +
        (st.paddingXpx != null ? st.paddingXpx : 12) +
        'px';
    } else {
      strip.style.padding = '';
    }
    if (st.maxWidthPx != null) {
      strip.style.maxWidth = st.maxWidthPx + 'px';
    } else {
      strip.style.maxWidth = '';
    }
  };

  function resolveInputPlaceholder_(widget) {
    var feats = getEffectiveCfg().features || {};
    var rootFeats = getRootCfg().features || {};
    var base = String(
      feats.inputPlaceholder ||
        rootFeats.inputPlaceholder ||
        (feats.inputPlaceholderByLanguage && feats.inputPlaceholderByLanguage.en) ||
        (rootFeats.inputPlaceholderByLanguage && rootFeats.inputPlaceholderByLanguage.en) ||
        ''
    ).trim();
    if (!base) base = 'Type your message here…';
    var lang = (widget && widget.language) || 'en';
    if (lang === 'en') return base;
    if (widget && widget._phraseI18n && widget._phraseI18n.inputPlaceholder) {
      return String(widget._phraseI18n.inputPlaceholder);
    }
    if (usePhraseTranslationFile() && widget && widget._phraseMap) {
      var translated = clientPhraseLine(base, widget._phraseMap);
      if (translated) return translated;
    }
    var byLang =
      feats.inputPlaceholderByLanguage || rootFeats.inputPlaceholderByLanguage || {};
    if (byLang[lang]) return String(byLang[lang]);
    return base;
  }

  ESChatWidget.prototype.syncInputPlaceholder_ = function () {
    if (!this.els || !this.els.input) return;
    this.els.input.placeholder = resolveInputPlaceholder_(this);
  };

  ESChatWidget.prototype.refreshUiFromConfig = function () {
    if (!this.root) return;
    var root = getRootCfg();
    var hdr = root.header || {};
    var welcome = root.welcome || {};

    this.title = hdr.title || this.title;
    this.subtitle = hdr.subtitle || this.subtitle;
    if (welcome.title != null) this.welcomeTitle = welcome.title;
    if (welcome.body != null) this.welcomeBody = welcome.body;

    var titleEl = this.root.querySelector('.qa-header__title');
    var subEl = this.root.querySelector('.qa-header__subtitle');
    var panelEl = this.root.querySelector('.qa-panel');
    if (titleEl) titleEl.textContent = this.title;
    if (subEl) subEl.textContent = this.subtitle;
    if (panelEl) panelEl.setAttribute('aria-label', this.title + ' chat');

    this.applyHeaderIcon_(hdr);

    var eff = getEffectiveCfg();
    var launch = eff.launcher || {};
    var launcher = this.root.querySelector('.qa-launcher');
    if (launcher) {
      this.applyLauncherIcon_(launcher, launch, hdr);
    }

    this.updateChatbotVisibility();
    this.applyTheme();
    this.applyLayout();
    this.updateLauncherCloseBubble();
    this.syncLauncherStripContent_();
    this.updateLauncherStripVisibility();
    this._stripHandPopPlayed = false;
    this.scheduleStripHandPop();
    this.applyFeatureToggles();
    this.syncInputPlaceholder_();
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.applyPreviewPanelLayout_();
      this.syncPreviewStageLayout_();
    }
  };

  ESChatWidget.prototype.maybeAutoOpen = function () {
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) return;
    if (!isChatbotEnabledForViewport()) return;
    var ao = getViewportCfg().autoOpenChat;
    if (!ao || !ao.enabled) return;
    var self = this;
    setTimeout(function () {
      self.open();
    }, ao.delayMs || 0);
  };

  ESChatWidget.prototype.template = function () {
    var eff = getEffectiveCfg();
    var header = eff.header || {};
    var rootHdr = getRootCfg().header || {};
    var feats = eff.features || {};
    var ml = feats.multiLanguage || {};
    var restart = getRestartCfg();
    var pb = eff.poweredBy || {};
    var placeholder = resolveInputPlaceholder_(this);

    var langOptions = this.langList
      .map(function (L) {
        return (
          '<option value="' +
          L.code +
          '">' +
          langOptionLabel(L) +
          '</option>'
        );
      })
      .join('');

    var titleIconUrl = resolveHeaderIconUrl(rootHdr);
    var headerIcon =
      rootHdr.showHeaderIcon === false
        ? ''
        : '<div class="qa-header__icon" aria-hidden="true"></div>';

    var logoSrc =
      pb.logoUrl ||
      (this.apiBase ? this.apiBase + '/widget/logo-powered.svg' : '');
    var poweredLink = normalizeExternalUrl(pb.linkUrl);
    var poweredHtml = '';
    if (pb.enabled !== false) {
      var logoImg = logoSrc
        ? '<img class="qa-powered__logo" src="' +
          this.escape(logoSrc) +
          '" alt="" width="90" height="18" onerror="this.style.display=\'none\'"/>'
        : '';
      var logoBlock = logoImg;
      if (logoImg && poweredLink) {
        logoBlock =
          '<a class="qa-powered__logo-link" href="' +
          this.escape(poweredLink) +
          '" target="_blank" rel="noopener noreferrer" aria-label="' +
          this.escape(pb.brandName || 'ES Chatbot') +
          '">' +
          logoImg +
          '</a>';
      }
      var brandName = pb.brandName || 'ES Chatbot';
      var brandBlock =
        '<strong class="qa-powered__brand">' +
        this.escape(brandName) +
        '</strong>';
      if (poweredLink) {
        brandBlock =
          '<a class="qa-powered__brand-link" href="' +
          this.escape(poweredLink) +
          '" target="_blank" rel="noopener noreferrer">' +
          brandBlock +
          '</a>';
      }
      var inner =
        '<span>' +
        this.escape(pb.prefix || 'Powered by') +
        '</span>' +
        logoBlock +
        brandBlock;
      poweredHtml = '<div class="qa-powered">' + inner + '</div>';
    }

    var stripCfg = getLauncherStripCfg();
    var stripHtml = '';
    if (hasLauncherStripTextAnywhere()) {
      var stripWave = getStripWaveState(stripCfg);
      stripHtml =
        '<div class="qa-launcher-strip-wrap">' +
        '<div class="qa-launcher-strip" role="note">' +
        (stripWave.waveOn
          ? '<span class="qa-launcher-strip__wave" aria-hidden="true"></span>'
          : '') +
        '<span class="qa-launcher-strip__text"></span></div></div>';
    }

    var launch = eff.launcher || {};
    var launcherOpenInner = '';

    return (
      stripHtml +
      '<div class="qa-launcher-wrap">' +
      '<span class="qa-launcher-ring-bg" aria-hidden="true"></span>' +
      '<button type="button" class="qa-launcher" aria-label="Open chat">' +
      '<span class="qa-launcher__state qa-launcher__state--open">' +
      launcherOpenInner +
      '</span>' +
      '<span class="qa-launcher__state qa-launcher__state--close" hidden aria-hidden="true">' +
      ICONS.close +
      '</span>' +
      '</button></div>' +
      '<div class="qa-panel" role="dialog" aria-label="' +
      this.escape(this.title) +
      ' chat">' +
      '<header class="qa-header">' +
      (rootHdr.showHeaderIcon !== false
        ? '<div class="qa-header__icon" aria-hidden="true">' +
          (headerIcon || ICONS.header) +
          '</div>'
        : '') +
      '<div class="qa-header__text">' +
      '<h2 class="qa-header__title">' +
      this.escape(this.title) +
      '</h2>' +
      '<p class="qa-header__subtitle">' +
      this.escape(this.subtitle) +
      '</p></div>' +
      '<div class="qa-header__actions">' +
      '<button type="button" class="qa-header__expand" aria-label="Expand chat panel" aria-pressed="false">' +
      '<span class="qa-header__expand-icon qa-header__expand-icon--expand">' +
      ICONS.panelExpand +
      '</span>' +
      '<span class="qa-header__expand-icon qa-header__expand-icon--collapse" hidden aria-hidden="true">' +
      ICONS.panelCollapse +
      '</span>' +
      '</button>' +
      '<button type="button" class="qa-header__close" aria-label="Close chat">' +
      ICONS.close +
      '</button></div></header>' +
      '<div class="qa-messages" role="log" aria-live="polite">' +
      this.buildWelcomeHtml(this.welcomeTitle, this.welcomeBody) +
      '</div>' +
      '<footer class="qa-footer">' +
      '<div class="qa-input-row">' +
      '<textarea class="qa-input" rows="1" placeholder="' +
      this.escape(placeholder) +
      '" aria-label="Message"></textarea>' +
      this.buildComposerUploadHtml() +
      '<button type="button" class="qa-mic" aria-label="Speech to text">' +
      ICONS.mic +
      '</button>' +
      '<button type="button" class="qa-send" aria-label="Send message">' +
      ICONS.send +
      '</button></div>' +
      '<div class="qa-toolbar">' +
      '<div class="qa-toolbar__start">' +
      (ml.enabled !== false
        ? '<select class="qa-lang" aria-label="Language">' + langOptions + '</select>'
        : '') +
      '<button type="button" class="qa-restart" style="display:none">' +
      ICONS.restart +
      ' ' +
      this.escape(restart.label) +
      '</button>' +
      '</div>' +
      (poweredHtml ? '<div class="qa-toolbar__end">' + poweredHtml + '</div>' : '') +
      '</div>' +
      '<p class="qa-error" hidden></p></footer></div>'
    );
  };

  ESChatWidget.prototype.cacheElements = function () {
    this.els = {
      launcherWrap: this.root.querySelector('.qa-launcher-wrap'),
      launcher: this.root.querySelector('.qa-launcher'),
      panel: this.root.querySelector('.qa-panel'),
      panelClose: this.root.querySelector('.qa-header__close'),
      panelExpand: this.root.querySelector('.qa-header__expand'),
      close: this.root.querySelector('.qa-launcher'),
      messages: this.root.querySelector('.qa-messages'),
      input: this.root.querySelector('.qa-input'),
      send: this.root.querySelector('.qa-send'),
      mic: this.root.querySelector('.qa-mic'),
      attach: this.root.querySelector('.qa-attach'),
      attachInput: this.root.querySelector('.qa-attach-input'),
      lang: this.root.querySelector('.qa-lang'),
      restart: this.root.querySelector('.qa-restart'),
      error: this.root.querySelector('.qa-error'),
      welcome: this.root.querySelector('.qa-welcome'),
    };
    if (this.els.lang) this.els.lang.value = this.language;
  };

  ESChatWidget.prototype.bindEvents = function () {
    var self = this;

    this.els.launcher.addEventListener('click', function () {
      if (self.isOpen) self.close();
      else self.open();
    });
    if (this.els.panelClose) {
      this.els.panelClose.addEventListener('click', function () {
        self.close();
      });
    }
    if (this.els.panelExpand) {
      this.els.panelExpand.addEventListener('click', function () {
        self.togglePanelExpand();
      });
    }
    this.els.send.addEventListener('click', function () {
      self.sendMessage();
    });
    this.els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        self.sendMessage();
      }
    });
    this.els.input.addEventListener('input', function () {
      self.els.input.style.height = 'auto';
      self.els.input.style.height =
        Math.min(self.els.input.scrollHeight, 100) + 'px';
      self.noteUserActivity();
    });
    this.els.input.addEventListener('keydown', function () {
      self.noteUserActivity();
    });
    if (this.els.panel) {
      var panelActivity = function () {
        self.noteUserActivity();
      };
      this.els.panel.addEventListener('mousedown', panelActivity);
      this.els.panel.addEventListener('touchstart', panelActivity, { passive: true });
      this.els.panel.addEventListener('scroll', panelActivity, true);
    }
    if (this.els.lang) {
      this.els.lang.addEventListener('change', function () {
        self.language = self.els.lang.value;
        self._phraseMapLang = null;
        self.ensurePhraseMap().then(function () {
          self.syncInputPlaceholder_();
        });
      });
    }
    if (this.els.restart) {
      this.els.restart.addEventListener('click', function () {
        self.restart();
      });
    }
    this.els.messages.addEventListener('click', function (e) {
      var chip = e.target.closest('.qa-chip[data-message]');
      if (!chip || self.isSending) return;
      var msg = chip.getAttribute('data-message');
      if (msg) self.sendMessageWithText(msg, { fromRichAction: true });
    });
    if (this.els.mic) {
      this.els.mic.addEventListener('click', function () {
        self.toggleSpeech();
      });
    }
    if (this.els.attach && this.els.attachInput) {
      this.els.attach.addEventListener('click', function () {
        if (self._uploadInFlight) return;
        self.els.attachInput.click();
      });
      this.els.attachInput.addEventListener('change', function () {
        var files = self.els.attachInput.files;
        self.els.attachInput.value = '';
        self.handleComposerUploadPick(files);
      });
    }
  };

  function parseUaBrowser(ua) {
    ua = String(ua || '');
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/Chrome\//i.test(ua) && !/Edg/i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
    return '';
  }

  function parseUaOs(ua) {
    ua = String(ua || '');
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return '';
  }

  ESChatWidget.prototype.buildSessionContextPayload = function () {
    var loc = global.location || {};
    var ua = (global.navigator && global.navigator.userAgent) || '';
    var params = new URLSearchParams(loc.search || '');
    var ctx = Object.assign({}, this.clientContext || {});
    var sitePreset = getSitePresetKey_() || 'receptionist';
    var botId = getBotId_() || '10001';
    return Object.assign(ctx, {
      sessionId: this.sessionId,
      userEngaged: !!this._userHasInteracted,
      sitePreset: sitePreset,
      botId: botId,
      sourceUrl: loc.href || '',
      device: /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop',
      browser: parseUaBrowser(ua),
      os: parseUaOs(ua),
      channel: ctx.channel || 'Web',
      utm_campaign: params.get('utm_campaign') || ctx.utm_campaign || '',
      utm_content: params.get('utm_content') || ctx.utm_content || '',
      utm_medium: params.get('utm_medium') || ctx.utm_medium || '',
      utm_source: params.get('utm_source') || ctx.utm_source || '',
      utm_term: params.get('utm_term') || ctx.utm_term || '',
    });
  };

  ESChatWidget.prototype.pushSessionContext = function () {
    if (!this.apiBase || !this.sessionId || this.esTestMode) return;
    var payload = this.buildSessionContextPayload();
    fetch(this.apiBase + '/api/session-context', {
      method: 'POST',
      headers: this.esTestApiHeaders(),
      body: JSON.stringify(this.withEsTestBody(payload)),
    }).catch(function () {});
  };

  ESChatWidget.prototype.fetchConfig = function () {
    var self = this;
    if (!this.apiBase) return;
    this.pushSessionContext();
    fetch(this.apiBase + '/api/config')
      .then(function (r) {
        return r.json();
      })
      .then(function (cfg) {
        /* Title/subtitle: edit company.config.js → common.header (not /api/config). */
        if (!cfg.dialogflowReady) {
          self.showError(
            'Server credentials missing. Set GOOGLE_CREDENTIALS_JSON on Railway.'
          );
        }
      })
      .catch(function () {});
    this.fetchUploadLimits();
    this.ensurePhraseMap();
  };

  ESChatWidget.prototype.fetchUploadLimits = function () {
    var self = this;
    if (!this.apiBase) return;
    fetch(this.apiBase + '/api/upload/status')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var mb = Number(data && data.maxUploadMb);
        if (mb > 0) {
          self.maxUploadMb = mb;
          self.maxUploadBytes = mb * 1024 * 1024;
        }
      })
      .catch(function () {});
  };

  ESChatWidget.prototype.validateUploadFiles = function (files) {
    var maxBytes = this.maxUploadBytes || DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
    var maxMb = this.maxUploadMb || DEFAULT_MAX_UPLOAD_MB;
    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      if (!file || !file.size) continue;
      if (file.size > maxBytes) {
        var msg = 'File is too large. Maximum size is ' + maxMb + ' MB.';
        return { ok: false, message: file.name ? file.name + ': ' + msg : msg };
      }
    }
    return { ok: true };
  };

  function getMultiLanguageCfg() {
    return (getRootCfg().features || {}).multiLanguage || {};
  }

  function getTranslationOverrides(lang) {
    var ml = getMultiLanguageCfg();
    var map = ml.translationOverridesByLanguage || {};
    return map[lang] || null;
  }

  function applyTranslationOverride(text, lang) {
    var t = String(text == null ? '' : text).trim();
    if (!t || lang === 'en' || !lang) return text;
    var overrides = getTranslationOverrides(lang);
    if (overrides && overrides[t] != null) return String(overrides[t]);
    return text;
  }

  function usePhraseTranslationFile() {
    var ml = getMultiLanguageCfg();
    return ml.usePhraseTranslationFile === true;
  }

  function clientPhraseLine(text, map) {
    if (!map || text == null) return text;
    var k = String(text)
      .trim()
      .replace(/\u2026/g, '...')
      .replace(/\s+/g, ' ');
    if (!k) return text;
    if (map[k] != null) return String(map[k]);
    var lower = k.toLowerCase();
    if (map[lower] != null) return String(map[lower]);
    return text;
  }

  ESChatWidget.prototype.ensurePhraseMap = function () {
    var self = this;
    var lang = this.language || 'en';
    if (!usePhraseTranslationFile() || lang === 'en' || !this.apiBase) {
      this._phraseMap = null;
      this._phraseMapLang = null;
      return Promise.resolve();
    }
    if (this._phraseMapLang === lang && this._phraseMap) {
      return Promise.resolve();
    }
    return fetch(
      this.apiBase +
        '/api/phrase-translations?lang=' +
        encodeURIComponent(lang)
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        self._phraseMap = (data && data.map) || {};
        self._phraseI18n = (data && data.i18n) || {};
        self._phraseMapLang = lang;
        if (typeof global !== 'undefined') {
          global.__ES_PHRASE_I18N__ = { lang: lang, map: self._phraseI18n || {} };
        }
      })
      .catch(function () {
        self._phraseMap = null;
        self._phraseI18n = null;
        self._phraseMapLang = null;
        if (typeof global !== 'undefined') {
          global.__ES_PHRASE_I18N__ = null;
        }
      });
  };

  ESChatWidget.prototype.applyClientPhrasePayload = function (data) {
    if (!data || !this._phraseMap || this.language === 'en') return data;
    var map = this._phraseMap;
    var t = function (s) {
      return clientPhraseLine(s, map);
    };

    if (data.reply) data.reply = String(data.reply).split('\n').map(t).join('\n');
    if (data.reply) {
      delete data.replyHtml;
      delete data.replyFormatted;
    }
    if (data.chipHeading) data.chipHeading = t(data.chipHeading);

    (data.chips || []).forEach(function (c) {
      var send = c.sendMessage || c.message || c.label || '';
      c.sendMessage = send;
      c.message = send;
      c.label = t(c.label || c.message || '');
    });

    (data.dropdowns || []).forEach(function (d) {
      if (d.message) d.message = t(d.message);
      if (d.placeholder) d.placeholder = t(d.placeholder);
      (d.options || []).forEach(function (opt) {
        opt.label = t(opt.label || opt.value || '');
      });
    });

    (data.galleries || []).forEach(function (g) {
      if (g.message) g.message = t(g.message);
      (g.images || []).forEach(function (img) {
        if (img.name) img.name = t(img.name);
        if (img.title) img.title = t(img.title);
      });
    });

    (data.cardCarousels || []).forEach(function (car) {
      if (car.message) car.message = t(car.message);
      (car.cards || []).forEach(function (card) {
        if (card.title) card.title = t(card.title);
        if (card.subtitle) card.subtitle = t(card.subtitle);
        if (card.ctaLabel) card.ctaLabel = t(card.ctaLabel);
        (card.buttons || []).forEach(function (btn) {
          var send = btn.message || btn.label || '';
          btn.message = send;
          btn.label = t(btn.label || '');
        });
      });
    });

    (data.infoCards || []).forEach(function (card) {
      if (card.title) card.title = t(card.title);
      if (card.subtitle) card.subtitle = t(card.subtitle);
      if (card.body) card.body = t(card.body);
      (card.buttons || []).forEach(function (btn) {
        var send = btn.message || btn.label || '';
        btn.message = send;
        btn.label = t(btn.label || '');
      });
    });

    (data.downloads || []).forEach(function (d) {
      if (d.label) d.label = t(d.label);
    });

    (data.replyParts || []).forEach(function (p) {
      if (p.text) p.text = t(p.text);
    });

    return data;
  };

  ESChatWidget.prototype.shouldAutoTranslateReplies = function () {
    var ml = getMultiLanguageCfg();
    if (ml.usePhraseTranslationFile === true) return false;
    if (ml.autoTranslateBotReplies !== true) return false;
    var ui = this.language || 'en';
    return ui !== 'en';
  };

  ESChatWidget.prototype.maybeTranslateBotPayload = function (data) {
    var self = this;
    if (
      !data ||
      data.localizedFromFile ||
      data.localizedFromPhrases ||
      !this.shouldAutoTranslateReplies() ||
      !this.apiBase
    ) {
      return Promise.resolve(data);
    }
    var ml = getMultiLanguageCfg();
    var lang = this.language;
    var source =
      String(
        ml.translationSourceLanguage ||
          ml.alwaysUseDialogflowLanguage ||
          ml.intentLanguage ||
          'en'
      ).trim() || 'en';
    var jobs = [];

    function queue(text, applyFn) {
      var raw = String(text == null ? '' : text);
      if (!raw.trim()) return;
      var overridden = applyTranslationOverride(raw, lang);
      if (overridden !== raw) {
        applyFn(overridden);
        return;
      }
      jobs.push({ text: raw.trim(), apply: applyFn });
    }

    queue(data.reply, function (t) {
      data.reply = t;
    });
    (data.replyParts || []).forEach(function (p, i) {
      if (p.type === 'text' && p.text) {
        queue(p.text, function (t) {
          data.replyParts[i].text = t;
        });
      }
      if (p.type === 'link' && p.text) {
        queue(p.text, function (t) {
          data.replyParts[i].text = t;
        });
      }
    });
    queue(data.chipHeading, function (t) {
      data.chipHeading = t;
    });
    (data.chips || []).forEach(function (c, i) {
      queue(c.label, function (t) {
        data.chips[i].label = t;
      });
    });
    (data.dropdowns || []).forEach(function (d, i) {
      queue(d.message, function (t) {
        data.dropdowns[i].message = t;
      });
      queue(d.placeholder, function (t) {
        data.dropdowns[i].placeholder = t;
      });
      (d.options || []).forEach(function (opt, j) {
        queue(opt.label, function (t) {
          data.dropdowns[i].options[j].label = t;
        });
      });
    });
    (data.galleries || []).forEach(function (g, i) {
      queue(g.message, function (t) {
        data.galleries[i].message = t;
      });
    });
    (data.cardCarousels || []).forEach(function (car, ci) {
      queue(car.message, function (t) {
        data.cardCarousels[ci].message = t;
      });
      (car.cards || []).forEach(function (card, ki) {
        queue(card.title, function (t) {
          data.cardCarousels[ci].cards[ki].title = t;
        });
        queue(card.subtitle, function (t) {
          data.cardCarousels[ci].cards[ki].subtitle = t;
        });
        queue(card.ctaLabel, function (t) {
          data.cardCarousels[ci].cards[ki].ctaLabel = t;
        });
        (card.buttons || []).forEach(function (btn, bi) {
          queue(btn.label, function (t) {
            data.cardCarousels[ci].cards[ki].buttons[bi].label = t;
          });
        });
      });
    });

    if (!jobs.length) return Promise.resolve(data);

    var texts = jobs.map(function (j) {
      return j.text;
    });

    return fetch(self.apiBase + '/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts: texts,
        targetLanguageCode: lang,
        sourceLanguageCode: source,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body || !Array.isArray(result.body.translations)) {
          return data;
        }
        result.body.translations.forEach(function (translated, idx) {
          if (jobs[idx]) jobs[idx].apply(String(translated));
        });
        delete data.replyHtml;
        delete data.replyFormatted;
        return data;
      })
      .catch(function () {
        return data;
      });
  };

  ESChatWidget.prototype.getDialogflowLang = function () {
    var ml = (getRootCfg().features || {}).multiLanguage || {};
    var fixed = String(
      ml.alwaysUseDialogflowLanguage || ml.intentLanguage || ''
    ).trim();
    if (fixed) return fixed;
    return this.langMap[this.language]
      ? this.langMap[this.language].df
      : 'en';
  };

  ESChatWidget.prototype.buildBotMessagePayload = function (payload) {
    var richOn = isRichContentEnabled();
    var chips = richOn && payload.chips ? payload.chips : [];
    var infoCards = richOn && payload.infoCards ? payload.infoCards : [];
    var downloads = richOn && payload.downloads ? payload.downloads : [];
    var dropdowns = payload.dropdowns || [];
    var galleries = payload.galleries || [];
    var cardCarousels =
      richOn && payload.cardCarousels ? payload.cardCarousels : [];
    var forms = richOn && payload.forms ? payload.forms : [];
    forms = this.resolveFormRequestsForDisplay(forms);
    var reply = (payload.reply || '').trim();
    if (reply === '{}' || reply === '[]') reply = '';
    var replyParts = payload.replyParts || [];
    var chipHeading = (payload.chipHeading || '').trim();
    var hasContent =
      reply ||
      replyParts.length ||
      chips.length ||
      chipHeading ||
      infoCards.length ||
      downloads.length ||
      dropdowns.length ||
      galleries.length ||
      cardCarousels.length ||
      forms.length;
    if (!hasContent) {
      reply = 'No response.';
      hasContent = true;
    }
    return {
      reply: reply,
      replyParts: replyParts,
      replyHtml: payload.replyHtml || '',
      chips: chips,
      chipHeading: chipHeading,
      infoCards: infoCards,
      downloads: downloads,
      dropdowns: dropdowns,
      galleries: galleries,
      cardCarousels: cardCarousels,
      forms: forms,
      intentIsFallback: !!payload.intentIsFallback,
      intent: payload.intent || '',
    };
  };

  ESChatWidget.prototype.normalizeBotPayloadFormatting = function (payload) {
    if (!payload || typeof payload !== 'object') return payload;
    var reply = payload.reply == null ? '' : String(payload.reply).trim();
    if (!reply) return payload;
    var ms = global.QAMessageSyntax;
    if (!ms || typeof ms.applyFormattedReplyFields !== 'function') return payload;
    delete payload.replyHtml;
    delete payload.replyFormatted;
    ms.applyFormattedReplyFields(payload, 'web');
    return payload;
  };

  ESChatWidget.prototype.appendBotPayload = function (payload) {
    this.normalizeBotPayloadFormatting(payload);
    var msg = this.buildBotMessagePayload(payload);
    this.appendMessage('bot', msg.reply, {
      replyParts: msg.replyParts,
      replyHtml: msg.replyHtml,
      chips: msg.chips,
      chipHeading: msg.chipHeading,
      infoCards: msg.infoCards,
      downloads: msg.downloads,
      dropdowns: msg.dropdowns,
      galleries: msg.galleries,
      cardCarousels: msg.cardCarousels,
      forms: msg.forms,
      intentIsFallback: msg.intentIsFallback,
      intent: msg.intent,
    });
  };

  ESChatWidget.prototype.applyDialogflowResult = function (result) {
    var self = this;
    if (!result.ok) {
      this.appendMessage(
        'bot',
        result.data.message ||
          'Sorry, I could not connect right now. Please try again.'
      );
      if (result.data.message) this.showError(result.data.message);
      return;
    }
    if (result.data.sessionId) this.sessionId = result.data.sessionId;

    var data = result.data || {};
    if (data.dialogflowProjectId) {
      this._activeDialogflowProjectId = String(data.dialogflowProjectId).trim();
    }
    if (data.orchestrationMode) this._orchMode = data.orchestrationMode;
    if (data.orchestrationChildId != null) {
      this._orchChildId = String(data.orchestrationChildId || '');
    }
    if (data.sessionParameters) {
      this.mergeSessionParameters(data.sessionParameters);
    }
    if (data.humanActive || data.agentConnected) {
      this._liveAgentHumanActive = true;
      this._liveAgentWaiting = false;
    }
    if (data.liveAgent) {
      if (data.humanActive || data.agentConnected) {
        this._liveAgentHumanActive = true;
        this._liveAgentWaiting = false;
      } else {
        this._liveAgentHumanActive = false;
        this._liveAgentWaiting = true;
      }
      if (typeof this.startLiveAgentMode === 'function') {
        this.startLiveAgentMode(data);
      }
      return;
    }
    if (this.isHumanChatActive()) {
      return;
    }

    this.ensurePhraseMap()
      .then(function () {
        if (!result.data.localizedFromPhrases) {
          self.applyClientPhrasePayload(result.data);
        }
        return self.maybeTranslateBotPayload(result.data);
      })
      .then(function (payload) {
      self.appendBotPayload(payload);
      if (payload.followUp) {
        if (payload.followUp.sessionParameters) {
          self.mergeSessionParameters(payload.followUp.sessionParameters);
        }
        self.appendBotPayload(payload.followUp);
      }
    });
  };

  ESChatWidget.prototype.postToDialogflow = function (body, opts) {
    opts = opts || {};
    var self = this;
    if (this.isHumanChatActive()) {
      return Promise.resolve();
    }
    if (!this.apiBase) {
      return Promise.resolve();
    }
    body.uiLanguageCode = body.uiLanguageCode || this.language || 'en';
    if (!body.languageCode) {
      body.languageCode = this.getDialogflowLang();
    }
    if (opts.skipIfSending && this.isSending) {
      return Promise.resolve();
    }
    if (!opts.silent && this.isSending && !opts.allowWhileSending) {
      return Promise.resolve();
    }

    var showTyping = opts.showTyping !== false && !opts.silent;
    var applyResponse = opts.applyResponse !== false && !opts.silent;

    if (!opts.silent) {
      this.hideError();
      this.isSending = true;
      this.els.send.disabled = true;
    }
    var typing = showTyping ? this.showTyping() : null;

    return fetch(this.apiBase + '/api/chat', {
      method: 'POST',
      headers: this.esTestApiHeaders(),
      body: JSON.stringify(this.withEsTestBody(this.withDialogflowRouting_(body))),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (typing) {
          if (typing._stopTyping) typing._stopTyping();
          typing.remove();
        }
        if (applyResponse) self.applyDialogflowResult(result);
      })
      .catch(function () {
        if (typing) {
          if (typing._stopTyping) typing._stopTyping();
          typing.remove();
        }
        if (applyResponse) {
          self.appendMessage(
            'bot',
            'Network error. Check your connection and try again.'
          );
          self.showError('Could not reach chat server.');
        }
      })
      .finally(function () {
        if (!opts.silent) {
          self.isSending = false;
          self.els.send.disabled = false;
        }
        if (self.isOpen) self.resetIdleTimer();
      });
  };

  ESChatWidget.prototype.triggerWelcomeEvent = function () {
    if (this.isHumanChatActive()) return;
    var cfg = getWelcomeEventCfg();
    if (cfg.enabled === false) return;
    if (this._welcomeEventSent || this._welcomeEventInFlight || this.isSending) {
      return;
    }
    var name = resolveWelcomeEventName_();
    if (!name) return;
    var self = this;
    this._welcomeEventInFlight = true;
    this.postToDialogflow(
      this.withDialogflowRouting_({
        event: name,
        sessionId: this.sessionId,
        languageCode: this.getDialogflowLang(),
      })
    ).finally(function () {
      self._welcomeEventInFlight = false;
      self._welcomeEventSent = true;
    });
  };

  ESChatWidget.prototype.triggerEndChatEvent = function (opts) {
    opts = opts || {};
    if (this.isHumanChatActive()) return Promise.resolve();
    var cfg = getEndChatEventCfg();
    if (cfg.enabled === false) return Promise.resolve();
    if (this._endChatEventInFlight) return Promise.resolve();
    if (cfg.triggerOncePerSession && this._endChatEventSent) {
      return Promise.resolve();
    }

    var name = (cfg.eventName || 'ENDCHAT').trim();
    if (!name) return Promise.resolve();

    var self = this;
    var showBotResponse = cfg.showBotResponse !== false;
    this._endChatEventInFlight = true;

    return this.postToDialogflow(
      {
        event: name,
        sessionId: this.sessionId,
        languageCode: this.getDialogflowLang(),
      },
      {
        silent: !showBotResponse,
        showTyping: showBotResponse,
        applyResponse: showBotResponse,
        skipIfSending: false,
      }
    )
      .finally(function () {
        self._endChatEventInFlight = false;
        self._endChatEventSent = true;
      });
  };

  ESChatWidget.prototype.getIdleTimeoutMs = function () {
    var cfg = getEndChatEventCfg();
    if (cfg.idleTimeoutMs != null) {
      return Math.max(0, parseInt(cfg.idleTimeoutMs, 10) || 0);
    }
    return 20000;
  };

  ESChatWidget.prototype.clearIdleTimer = function () {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  };

  ESChatWidget.prototype.noteUserActivity = function () {
    var cfg = getEndChatEventCfg();
    if (cfg.enabled === false || cfg.triggerOnIdle === false) return;
    if (!this.isOpen) return;
    var now = Date.now();
    if (now - this._idleActivityAt < 800) return;
    this._idleActivityAt = now;
    this.resetIdleTimer();
  };

  ESChatWidget.prototype.markUserInteracted = function () {
    this._userHasInteracted = true;
  };

  ESChatWidget.prototype.resetIdleTimer = function () {
    var cfg = getEndChatEventCfg();
    if (cfg.enabled === false || cfg.triggerOnIdle === false) return;
    if (!this.isOpen) return;
    if (cfg.requireUserInteraction !== false && !this._userHasInteracted) {
      this.clearIdleTimer();
      return;
    }
    if (cfg.triggerOncePerSession && this._endChatEventSent) return;

    var ms = this.getIdleTimeoutMs();
    if (ms <= 0) return;

    var self = this;
    this.clearIdleTimer();
    this._idleTimer = setTimeout(function () {
      self._idleTimer = null;
      self.onUserIdle();
    }, ms);
  };

  ESChatWidget.prototype.onUserIdle = function () {
    var cfg = getEndChatEventCfg();
    if (cfg.enabled === false || cfg.triggerOnIdle === false) return;
    if (!this.isOpen) return;
    if (cfg.requireUserInteraction !== false && !this._userHasInteracted) {
      return;
    }
    if (cfg.triggerOncePerSession && this._endChatEventSent) return;
    if (this.isSending || this._endChatEventInFlight) {
      this.resetIdleTimer();
      return;
    }

    var self = this;
    this.triggerEndChatEvent().finally(function () {
      if (cfg.closePanelAfterEnd === true) {
        self.scheduleFinishClose();
      }
    });
  };

  ESChatWidget.prototype.finishClose = function () {
    this.clearIdleTimer();
    this.isOpen = false;
    if (this.panelExpanded) {
      this.panelExpanded = false;
    }
    this.root.classList.remove('qa-widget--chat-open');
    this.els.panel.classList.remove('qa-panel--open');
    this.updateLauncherCloseBubble();
    this.updateLauncherStripVisibility();
    this.applyViewportAnchors_();
    this.applyPanelSize_();
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.syncPreviewStageLayout_();
    }
    this.stopSpeech();
  };

  ESChatWidget.prototype.maybeTriggerWelcomeEvent = function () {
    var cfg = getWelcomeEventCfg();
    if (cfg.enabled === false || cfg.triggerOnChatOpen === false) return;
    if (this._welcomeEventSent || this._welcomeEventInFlight) return;
    var self = this;
    setTimeout(function () {
      self.triggerWelcomeEvent();
    }, 0);
  };

  ESChatWidget.prototype.setLauncherCloseMode = function (isClose) {
    var btn = this.els.launcher;
    if (!btn) return;
    var openEl = btn.querySelector('.qa-launcher__state--open');
    var closeEl = btn.querySelector('.qa-launcher__state--close');
    if (openEl) {
      openEl.hidden = !!isClose;
      openEl.setAttribute('aria-hidden', isClose ? 'true' : 'false');
    }
    if (closeEl) {
      closeEl.hidden = !isClose;
      closeEl.setAttribute('aria-hidden', isClose ? 'false' : 'true');
    }
    btn.setAttribute('aria-label', isClose ? 'Close chat' : 'Open chat');
  };

  ESChatWidget.prototype.syncLauncherStack = function () {
    if (!this.root) return;
    var closeBubble = isLauncherCloseBubbleEnabled();
    var stackPx = this.isOpen ? getOpenPanelStackPx() : getLauncherStackPx();
    this.root.style.setProperty('--es-launcher-stack', stackPx + 'px');
    this.root.classList.toggle(
      'qa-widget--no-close-bubble',
      this.isOpen && !closeBubble
    );

    var boostPx = this.isOpen ? getPanelHeightExtraPx(true) : 0;
    this.root.style.setProperty('--es-panel-height-boost', boostPx + 'px');

    if (this.isOpen) {
      var v = getViewportAnchorVars_();
      this.root.style.setProperty(
        '--es-panel-bottom',
        v.bubbleBottom + stackPx + 'px'
      );
    }

    var panel = this.els.panel || this.root.querySelector('.qa-panel');
    if (!panel) return;
    if (this.isOpen && (boostPx > 0 || this.panelExpanded)) {
      var openH = computeOpenPanelHeightPx(this.panelExpanded);
      panel.style.height = openH + 'px';
      panel.style.maxHeight = openH + 'px';
    } else if (!(global.ES_CONFIG && global.ES_CONFIG.previewViewport)) {
      panel.style.height = '';
      panel.style.maxHeight = '';
    }
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.applyPreviewPanelLayout_();
      this.syncPreviewStageLayout_();
    }
  };

  ESChatWidget.prototype.updateLauncherCloseBubble = function () {
    var wrap = this.els.launcherWrap;
    if (!wrap) return;

    wrap.classList.remove('qa-launcher--hidden');

    if (!this.isOpen) {
      this.setLauncherCloseMode(false);
      this.syncLauncherStack();
      return;
    }

    if (isLauncherCloseBubbleEnabled()) {
      wrap.classList.remove('qa-launcher--hidden');
      this.setLauncherCloseMode(true);
    } else {
      wrap.classList.add('qa-launcher--hidden');
      this.setLauncherCloseMode(false);
      this.applyLauncherIcon_(
        this.els.launcher,
        getEffectiveCfg().launcher || {},
        getRootCfg().header || {}
      );
    }
    this.syncLauncherStack();
  };

  ESChatWidget.prototype.open = function () {
    this.isOpen = true;
    this.root.classList.add('qa-widget--chat-open');
    this.els.panel.classList.add('qa-panel--open');
    this.updateLauncherCloseBubble();
    this.updateLauncherStripVisibility();
    this.applyViewportAnchors_();
    this.applyPanelSize_();
    this.syncLauncherStack();
    if (global.ES_CONFIG && global.ES_CONFIG.previewViewport) {
      this.syncPreviewStageLayout_();
    }
    this.els.input.focus();
    this.maybeTriggerWelcomeEvent();
  };

  ESChatWidget.prototype.scheduleFinishClose = function () {
    var self = this;
    var cfg = getEndChatEventCfg();
    if (cfg.closePanelAfterEnd !== true) {
      self.finishClose();
      return;
    }
    var delay = 0;
    if (cfg.showBotResponse !== false && cfg.closePanelAfterMs != null) {
      delay = Math.max(0, parseInt(cfg.closePanelAfterMs, 10) || 0);
    }
    if (self._endChatCloseTimer) {
      clearTimeout(self._endChatCloseTimer);
      self._endChatCloseTimer = null;
    }
    if (delay > 0) {
      self._endChatCloseTimer = setTimeout(function () {
        self._endChatCloseTimer = null;
        self.finishClose();
      }, delay);
      return;
    }
    self.finishClose();
  };

  ESChatWidget.prototype.close = function () {
    var self = this;
    var cfg = getEndChatEventCfg();
    var shouldEnd =
      cfg.enabled !== false &&
      cfg.triggerOnChatClose !== false &&
      !(cfg.triggerOncePerSession && this._endChatEventSent);

    if (shouldEnd && !this._endChatEventInFlight) {
      this.triggerEndChatEvent().finally(function () {
        self.scheduleFinishClose();
      });
      return;
    }
    this.finishClose();
  };

  ESChatWidget.prototype.restart = function () {
    var self = this;
    var endCfg = getEndChatEventCfg();
    var runRestart = function () {
      self.sessionId = self.newSessionId();
      self.resetOrchestrationState();
      self._welcomeEventSent = false;
      self._welcomeEventInFlight = false;
      self._endChatEventSent = false;
      self._endChatEventInFlight = false;
      self._userHasInteracted = false;
      self.clientContext = {};
      self.els.messages.innerHTML = self.buildWelcomeHtml(
        self.restartTitle,
        self.restartBody
      );
      self.els.welcome = isWelcomeEnabled()
        ? self.root.querySelector('.qa-welcome')
        : null;
      self.hideError();
      self.els.input.focus();
      var ev = getWelcomeEventCfg();
      if (ev.enabled !== false && ev.triggerOnRestart !== false) {
        self.triggerWelcomeEvent();
      }
    };

    this.clearIdleTimer();
    if (
      endCfg.enabled !== false &&
      endCfg.triggerOnRestart !== false &&
      !this._endChatEventInFlight
    ) {
      this.triggerEndChatEvent().finally(runRestart);
      return;
    }
    runRestart();
  };

  ESChatWidget.prototype.botAvatarHtml = function () {
    var bp = getRootCfg().botPersona || {};
    var imageUrl = normalizeIconUrl(bp.imageUrl);
    if ((bp.mode === 'image' || imageUrl) && imageUrl) {
      return (
        '<img class="qa-icon-img" src="' +
        this.escape(imageUrl) +
        '" alt="" decoding="async" referrerpolicy="no-referrer"/>'
      );
    }
    if (bp.label && bp.mode !== 'icon') {
      return '<span style="font-size:0.65rem;font-weight:700">' + this.escape(bp.label) + '</span>';
    }
    return ICONS.bot;
  };

  ESChatWidget.prototype.userAvatarHtml = function () {
    return ICONS.user;
  };

  ESChatWidget.prototype.agentHumanAvatarHtml = function () {
    var ap = getRootCfg().agentPersona || {};
    var imageUrl = normalizeIconUrl(ap.imageUrl);
    if ((ap.mode === 'image' || imageUrl) && imageUrl) {
      return (
        '<img class="qa-icon-img" src="' +
        this.escape(imageUrl) +
        '" alt="" decoding="async" referrerpolicy="no-referrer"/>'
      );
    }
    return ICONS.agentHuman;
  };

  ESChatWidget.prototype.buildPersonaRow = function (role, options) {
    options = options || {};
    var bp = getRootCfg().botPersona || {};
    var up = getRootCfg().userPersona || {};
    var p = role === 'bot' ? bp : up;
    var name =
      options.personaLabel ||
      p.label ||
      (role === 'bot' ? 'Quality' : 'You');
    var timeStr = formatPersonaTime(p);

    var row = document.createElement('div');
    row.className = 'qa-msg__persona-row';

    var avatar = document.createElement('div');
    avatar.className = 'qa-msg__avatar qa-msg__avatar--' + role;
    if (options.liveAgentHuman) {
      avatar.classList.add('qa-msg__avatar--agent-human');
    } else if (role === 'bot' && bp.mode === 'image' && bp.imageUrl) {
      avatar.classList.add('qa-msg__avatar--image');
    }
    if (role === 'user') {
      avatar.classList.add('qa-msg__avatar--sm');
    }
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = options.liveAgentHuman
      ? this.agentHumanAvatarHtml()
      : role === 'bot'
        ? this.botAvatarHtml()
        : this.userAvatarHtml();

    var meta = document.createElement('div');
    meta.className = 'qa-msg__persona-meta';

    var nameEl = document.createElement('span');
    nameEl.className = 'qa-msg__persona-name';
    nameEl.textContent = name;
    meta.appendChild(nameEl);

    if (timeStr) {
      var timeEl = document.createElement('span');
      timeEl.className = 'qa-msg__persona-time';
      timeEl.textContent = timeStr;
      meta.appendChild(timeEl);
    }

    row.appendChild(avatar);
    row.appendChild(meta);
    return row;
  };

  ESChatWidget.prototype.buildWelcomeHtml = function (title, body) {
    if (!isWelcomeEnabled()) return '';
    var titleStr = (title == null ? '' : String(title)).trim();
    var bodyStr = (body == null ? '' : String(body)).trim();
    var chips = getWelcomeChips();
    if (!titleStr && !bodyStr && !chips.length) return '';
    var html = '<div class="qa-welcome">';
    if (titleStr) {
      html += '<strong>' + this.escape(titleStr) + '</strong>';
    }
    if (bodyStr) {
      html += this.escape(bodyStr);
    }
    if (chips.length) {
      html +=
        '<div class="qa-welcome-chips" role="group" aria-label="Suggested questions">';
      var self = this;
      chips.forEach(function (c) {
        html +=
          '<button type="button" class="qa-chip" data-message="' +
          self.escape(c.message) +
          '">' +
          self.escape(c.label) +
          '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  };

  ESChatWidget.prototype.buildInfoCardsEl = function (cards) {
    var wrap = document.createElement('div');
    wrap.className = 'qa-rich-cards';
    wrap.setAttribute('role', 'list');
    var self = this;

    cards.forEach(function (card) {
      var article = document.createElement('article');
      article.className = 'qa-rich-card';
      article.setAttribute('role', 'listitem');

      if (card.imageUrl) {
        var imgWrap = document.createElement('div');
        imgWrap.className = 'qa-rich-card__media';
        var img = document.createElement('img');
        img.className = 'qa-rich-card__img';
        img.src = card.imageUrl;
        img.alt = card.title || '';
        img.loading = 'lazy';
        img.onerror = function () {
          imgWrap.style.display = 'none';
        };
        if (card.actionLink) {
          var imgLink = document.createElement('a');
          imgLink.href = card.actionLink;
          imgLink.target = '_blank';
          imgLink.rel = 'noopener noreferrer';
          imgLink.appendChild(img);
          imgWrap.appendChild(imgLink);
        } else {
          imgWrap.appendChild(img);
        }
        article.appendChild(imgWrap);
      }

      if (card.title) {
        var titleEl = document.createElement('div');
        titleEl.className = 'qa-rich-card__title';
        titleEl.textContent = card.title;
        article.appendChild(titleEl);
      }

      if (card.subtitle) {
        var subEl = document.createElement('div');
        subEl.className = 'qa-rich-card__subtitle';
        subEl.textContent = card.subtitle;
        article.appendChild(subEl);
      }

      if (card.body) {
        var bodyEl = document.createElement('div');
        bodyEl.className = 'qa-rich-card__body';
        bodyEl.textContent = card.body;
        article.appendChild(bodyEl);
      }

      var buttons = card.buttons || [];
      if (buttons.length) {
        var actions = document.createElement('div');
        actions.className = 'qa-rich-card__actions';
        buttons.forEach(function (btn) {
          var label = btn.label || '';
          if (!label) return;
          if (
            btn.href &&
            btn.download &&
            self.appendDownloadLink(actions, {
              href: btn.href,
              label: label,
              download: true,
              fileName: btn.fileName || label,
            })
          ) {
            /* download link */
          } else if (btn.href) {
            var link = document.createElement('a');
            link.className = 'qa-chip qa-chip--bot qa-chip--link';
            link.href = btn.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label;
            actions.appendChild(link);
          } else {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'qa-chip qa-chip--bot';
            b.setAttribute('data-message', btn.message || label);
            b.textContent = label;
            actions.appendChild(b);
          }
        });
        if (actions.childNodes.length) article.appendChild(actions);
      }

      wrap.appendChild(article);
    });

    return wrap;
  };

  ESChatWidget.prototype.wrapScrollTrack = function (track, options) {
    options = options || {};
    var shell = document.createElement('div');
    shell.className = 'qa-scroll-strip';

    var viewport = document.createElement('div');
    viewport.className = 'qa-scroll-strip__viewport';
    viewport.appendChild(track);

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'qa-scroll-strip__nav qa-scroll-strip__prev';
    prev.setAttribute('aria-label', 'Previous');
    prev.innerHTML = '&#8249;';

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'qa-scroll-strip__nav qa-scroll-strip__next';
    next.setAttribute('aria-label', 'Next');
    next.innerHTML = '&#8250;';

    shell.appendChild(viewport);
    shell.appendChild(prev);
    shell.appendChild(next);

    var autoScrollActive = options.autoScroll !== false;
    var stopOnInteraction = options.stopAutoScrollOnInteraction === true;
    var autoScrollStopped = false;

    function stopAutoScrollPermanent() {
      if (!autoScrollActive || autoScrollStopped) return;
      autoScrollStopped = true;
      shell.classList.remove('qa-scroll-strip--auto');
      shell.setAttribute('data-auto-scroll', 'stopped');
    }

    shell.stopAutoScrollPermanent = stopAutoScrollPermanent;

    function onUserInteraction() {
      if (stopOnInteraction) stopAutoScrollPermanent();
    }

    function scrollStep(delta) {
      onUserInteraction();
      var first = track.firstElementChild;
      var gap = 10;
      var step = first
        ? first.getBoundingClientRect().width + gap
        : Math.max(100, viewport.clientWidth * 0.8);
      viewport.scrollBy({ left: delta * step, behavior: 'smooth' });
    }

    prev.addEventListener('click', function () {
      scrollStep(-1);
    });
    next.addEventListener('click', function () {
      scrollStep(1);
    });

    if (stopOnInteraction) {
      track.addEventListener('click', onUserInteraction);
      viewport.addEventListener('pointerdown', onUserInteraction);
      viewport.addEventListener(
        'wheel',
        function (e) {
          if (e && e.isTrusted !== false) onUserInteraction();
        },
        { passive: true }
      );
      viewport.addEventListener('touchstart', onUserInteraction, { passive: true });
    }

    function updateNav() {
      var maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      var show = maxScroll > 4;
      prev.hidden = !show;
      next.hidden = !show;
      prev.disabled = viewport.scrollLeft <= 2;
      next.disabled = viewport.scrollLeft >= maxScroll - 2;
    }

    viewport.addEventListener('scroll', updateNav, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(updateNav);
      ro.observe(viewport);
      ro.observe(track);
    }
    setTimeout(updateNav, 0);
    setTimeout(updateNav, 400);

    if (autoScrollActive) {
      shell.setAttribute('data-auto-scroll', 'on');
      var secondsPerItem =
        options.secondsPerItem != null ? Number(options.secondsPerItem) : 4;
      if (!secondsPerItem || secondsPerItem < 0.5) secondsPerItem = 4;

      var respectReducedMotion = options.respectReducedMotion === true;
      var reduceMotion =
        respectReducedMotion &&
        global.matchMedia &&
        global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!reduceMotion) {
        shell.classList.add('qa-scroll-strip--auto');
        var autoLastTime = 0;

        function getMaxScroll() {
          return Math.max(
            0,
            track.scrollWidth - viewport.clientWidth,
            viewport.scrollWidth - viewport.clientWidth
          );
        }

        function itemStepPx() {
          var first = track.firstElementChild;
          if (!first) return 200;
          var w = first.offsetWidth || first.getBoundingClientRect().width;
          return (w > 0 ? w : 200) + 10;
        }

        function autoScrollTick(now) {
          global.requestAnimationFrame(autoScrollTick);
          if (autoScrollStopped) return;
          var maxScroll = getMaxScroll();
          if (maxScroll <= 4) {
            autoLastTime = 0;
            return;
          }
          if (!autoLastTime) {
            autoLastTime = now;
            return;
          }
          var dt = Math.min(now - autoLastTime, 48);
          autoLastTime = now;
          var step = itemStepPx();
          var pxPerMs = step / (secondsPerItem * 1000);
          viewport.scrollLeft += pxPerMs * dt;
          if (viewport.scrollLeft >= maxScroll - 1) {
            viewport.scrollLeft = 0;
          }
          updateNav();
        }

        global.requestAnimationFrame(autoScrollTick);
        setTimeout(updateNav, 100);
        setTimeout(updateNav, 800);
      }
    }

    return shell;
  };

  ESChatWidget.prototype.buildCardCarouselEl = function (carousel) {
    var wrap = document.createElement('div');
    wrap.className = 'qa-card-carousel';
    var track = document.createElement('div');
    track.className = 'qa-card-carousel__track';
    track.setAttribute('role', 'list');
    var self = this;

    var lightboxImages = (carousel.cards || [])
      .filter(function (c) {
        return c && c.imageUrl;
      })
      .map(function (c) {
        var name = [c.title, c.subtitle].filter(Boolean).join(' — ');
        return { url: c.imageUrl, name: name || '' };
      });
    var lightboxIndex = 0;

    (carousel.cards || []).forEach(function (card) {
      var article = document.createElement('article');
      article.className = 'qa-card-carousel__card';
      article.setAttribute('role', 'listitem');
      if (card.id) article.setAttribute('data-card-id', card.id);

      if (card.imageUrl) {
        var currentLbIndex = lightboxIndex;
        lightboxIndex += 1;
        var mediaBtn = document.createElement('button');
        mediaBtn.type = 'button';
        mediaBtn.className =
          'qa-card-carousel__media qa-card-carousel__media-btn';
        mediaBtn.setAttribute(
          'aria-label',
          'View full image' + (card.title ? ': ' + card.title : '')
        );
        mediaBtn.addEventListener('click', function () {
          var strip = mediaBtn.closest('.qa-scroll-strip');
          if (strip && strip.stopAutoScrollPermanent) {
            strip.stopAutoScrollPermanent();
          }
          self.openGalleryLightbox(lightboxImages, currentLbIndex);
        });
        var img = document.createElement('img');
        img.className = 'qa-card-carousel__img';
        img.src = card.imageUrl;
        img.alt = card.title || '';
        img.loading = 'lazy';
        img.draggable = false;
        img.onerror = function () {
          mediaBtn.style.display = 'none';
        };
        mediaBtn.appendChild(img);
        article.appendChild(mediaBtn);
      }

      if (card.title) {
        var titleEl = document.createElement('div');
        titleEl.className = 'qa-card-carousel__title';
        titleEl.textContent = card.title;
        article.appendChild(titleEl);
      }

      if (card.subtitle) {
        var subEl = document.createElement('div');
        subEl.className = 'qa-card-carousel__subtitle';
        subEl.textContent = card.subtitle;
        article.appendChild(subEl);
      }

      var buttons = card.buttons || [];
      if (!buttons.length && card.ctaLabel) {
        buttons = [
          {
            label: card.ctaLabel,
            message: card.ctaMessage || card.ctaLabel,
            href: '',
          },
        ];
      }
      if (buttons.length) {
        var actions = document.createElement('div');
        actions.className = 'qa-card-carousel__actions';
        buttons.forEach(function (btn) {
          var label = String(btn.label || '').trim();
          if (!label) return;
          var message = String(btn.message || label).trim();
          if (btn.href && /^https?:\/\//i.test(btn.href)) {
            var link = document.createElement('a');
            link.className = 'qa-chip qa-chip--bot qa-card-carousel__cta';
            link.href = btn.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label;
            actions.appendChild(link);
            return;
          }
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'qa-chip qa-chip--bot qa-card-carousel__cta';
          chip.setAttribute('data-message', message);
          chip.textContent = label;
          actions.appendChild(chip);
        });
        if (actions.childNodes.length) article.appendChild(actions);
      }

      track.appendChild(article);
    });

    if (track.childNodes.length) {
      wrap.appendChild(this.wrapScrollTrack(track, getScrollStripOpts('cardCarousel')));
    }
    return wrap;
  };

  ESChatWidget.prototype.createDownloadLink = function (entry) {
    var a = document.createElement('a');
    a.className = 'qa-download-btn';
    a.href = entry.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    var fileName = entry.fileName || entry.label || '';
    if (fileName) a.setAttribute('download', fileName);
    if (entry.iconUrl) {
      var icon = document.createElement('img');
      icon.className = 'qa-download-btn__icon';
      icon.src = entry.iconUrl;
      icon.alt = '';
      icon.loading = 'lazy';
      icon.onerror = function () {
        icon.remove();
      };
      a.appendChild(icon);
    }
    var labelEl = document.createElement('span');
    labelEl.className = 'qa-download-btn__label';
    labelEl.textContent = entry.label || 'Download';
    a.appendChild(labelEl);
    return a;
  };

  ESChatWidget.prototype.ensureGalleryLightbox = function () {
    if (this._lightboxEl) return this._lightboxEl;

    var lb = document.createElement('div');
    lb.className = 'qa-lightbox';
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image gallery');
    lb.innerHTML =
      '<button type="button" class="qa-lightbox__backdrop" aria-label="Close gallery"></button>' +
      '<div class="qa-lightbox__panel">' +
      '<button type="button" class="qa-lightbox__close" aria-label="Close">&times;</button>' +
      '<button type="button" class="qa-lightbox__nav qa-lightbox__prev" aria-label="Previous image">&#8249;</button>' +
      '<button type="button" class="qa-lightbox__nav qa-lightbox__next" aria-label="Next image">&#8250;</button>' +
      '<figure class="qa-lightbox__figure">' +
      '<img class="qa-lightbox__img" alt="" />' +
      '<figcaption class="qa-lightbox__caption"></figcaption>' +
      '</figure>' +
      '</div>';

    var self = this;
    lb.querySelector('.qa-lightbox__backdrop').addEventListener('click', function () {
      self.closeGalleryLightbox();
    });
    lb.querySelector('.qa-lightbox__close').addEventListener('click', function () {
      self.closeGalleryLightbox();
    });
    lb.querySelector('.qa-lightbox__prev').addEventListener('click', function () {
      self.stepGalleryLightbox(-1);
    });
    lb.querySelector('.qa-lightbox__next').addEventListener('click', function () {
      self.stepGalleryLightbox(1);
    });

    if (!this._lightboxKeyHandler) {
      this._lightboxKeyHandler = function (e) {
        if (!self._lightboxEl || self._lightboxEl.hidden) return;
        if (e.key === 'Escape') self.closeGalleryLightbox();
        if (e.key === 'ArrowLeft') self.stepGalleryLightbox(-1);
        if (e.key === 'ArrowRight') self.stepGalleryLightbox(1);
      };
      document.addEventListener('keydown', this._lightboxKeyHandler);
    }

    document.body.appendChild(lb);
    this._lightboxEl = lb;
    this._lightboxImages = [];
    this._lightboxIndex = 0;
    return lb;
  };

  ESChatWidget.prototype.renderGalleryLightbox = function () {
    var lb = this._lightboxEl;
    var images = this._lightboxImages || [];
    if (!lb || !images.length) return;

    var index = this._lightboxIndex;
    if (index < 0) index = 0;
    if (index >= images.length) index = images.length - 1;
    this._lightboxIndex = index;

    var current = images[index];
    var imgEl = lb.querySelector('.qa-lightbox__img');
    var capEl = lb.querySelector('.qa-lightbox__caption');
    imgEl.src = current.url;
    imgEl.alt = current.name || '';
    capEl.textContent = current.name || '';
    capEl.hidden = !current.name;

    var multi = images.length > 1;
    lb.querySelector('.qa-lightbox__prev').hidden = !multi;
    lb.querySelector('.qa-lightbox__next').hidden = !multi;
  };

  ESChatWidget.prototype.openGalleryLightbox = function (images, startIndex) {
    var list = (images || []).filter(function (img) {
      return img && img.url;
    });
    if (!list.length) return;

    this.ensureGalleryLightbox();
    this._lightboxImages = list;
    this._lightboxIndex =
      typeof startIndex === 'number' && startIndex >= 0 ? startIndex : 0;
    this.renderGalleryLightbox();
    this._lightboxEl.hidden = false;
    document.body.classList.add('qa-lightbox-open');
    this._lightboxEl.querySelector('.qa-lightbox__close').focus();
  };

  ESChatWidget.prototype.closeGalleryLightbox = function () {
    if (!this._lightboxEl) return;
    this._lightboxEl.hidden = true;
    document.body.classList.remove('qa-lightbox-open');
    var imgEl = this._lightboxEl.querySelector('.qa-lightbox__img');
    if (imgEl) imgEl.removeAttribute('src');
  };

  ESChatWidget.prototype.stepGalleryLightbox = function (delta) {
    var images = this._lightboxImages || [];
    if (!images.length) return;
    var next = this._lightboxIndex + delta;
    if (next < 0) next = images.length - 1;
    if (next >= images.length) next = 0;
    this._lightboxIndex = next;
    this.renderGalleryLightbox();
  };

  ESChatWidget.prototype.buildGalleryEl = function (gallery) {
    var wrap = document.createElement('div');
    wrap.className = 'qa-gallery';
    if (gallery.message) {
      var heading = document.createElement('div');
      heading.className = 'qa-gallery__label';
      heading.textContent = gallery.message;
      wrap.appendChild(heading);
    }
    var track = document.createElement('div');
    track.className = 'qa-gallery__track';
    track.setAttribute('role', 'list');

    var images = (gallery.images || []).filter(function (img) {
      return img && img.url;
    });
    var self = this;

    images.forEach(function (img, index) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'qa-gallery__item';
      item.setAttribute('role', 'listitem');
      item.title = img.name || 'View image';
      item.addEventListener('click', function () {
        var strip = item.closest('.qa-scroll-strip');
        if (strip && strip.stopAutoScrollPermanent) {
          strip.stopAutoScrollPermanent();
        }
        self.openGalleryLightbox(images, index);
      });
      var image = document.createElement('img');
      image.className = 'qa-gallery__img';
      image.src = img.url;
      image.alt = img.name || '';
      image.loading = 'lazy';
      image.draggable = false;
      image.onerror = function () {
        item.classList.add('qa-gallery__item--error');
      };
      item.appendChild(image);
      if (img.name) {
        var cap = document.createElement('span');
        cap.className = 'qa-gallery__caption';
        cap.textContent = img.name;
        item.appendChild(cap);
      }
      track.appendChild(item);
    });
    if (track.childNodes.length) {
      wrap.appendChild(this.wrapScrollTrack(track, getScrollStripOpts('gallery')));
    }
    return wrap;
  };

  ESChatWidget.prototype.buildInlineSelectEl = function (dropdown, opts) {
    if (getInlineSelectDisplay() === 'dropdown') {
      return this.buildInlineSelectDropdownEl(dropdown, opts);
    }
    return this.buildInlineSelectChipsEl(dropdown, opts);
  };

  ESChatWidget.prototype.buildInlineSelectChipsEl = function (dropdown, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'qa-inline-select qa-inline-select--chips';

    if (dropdown.message && !opts.hideLabel) {
      var heading = document.createElement('div');
      heading.className = 'qa-inline-select__label';
      heading.textContent = dropdown.message;
      wrap.appendChild(heading);
    }

    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'qa-msg__chips qa-inline-select__chips';
    chipsWrap.setAttribute('role', 'group');
    chipsWrap.setAttribute(
      'aria-label',
      dropdown.message || 'Choose an option'
    );

    (dropdown.options || []).forEach(function (opt) {
      var label = opt.label || opt.value || '';
      var message = opt.value || opt.sendValue || opt.label || '';
      if (!label) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qa-chip qa-chip--bot';
      btn.setAttribute('data-message', message);
      btn.textContent = label;
      chipsWrap.appendChild(btn);
    });

    if (chipsWrap.childNodes.length) {
      chipsWrap.addEventListener(
        'click',
        function (e) {
          var chip = e.target.closest('.qa-chip[data-message]');
          if (!chip || wrap.classList.contains('qa-inline-select--used')) return;
          wrap.classList.add('qa-inline-select--used');
          chipsWrap.querySelectorAll('.qa-chip').forEach(function (b) {
            b.disabled = true;
          });
        },
        true
      );
      wrap.appendChild(chipsWrap);
    }

    return wrap;
  };

  ESChatWidget.prototype.buildInlineSelectDropdownEl = function (
    dropdown,
    opts
  ) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'qa-inline-select qa-inline-select--dropdown';
    var selectId =
      'qa-select-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    var selectPrompt =
      dropdown.message || dropdown.placeholder || 'Choose…';
    var showLabel =
      dropdown.message &&
      !opts.hideLabel &&
      String(dropdown.message).trim() !== String(selectPrompt).trim();

    if (showLabel) {
      var label = document.createElement('label');
      label.className = 'qa-inline-select__label';
      label.setAttribute('for', selectId);
      label.textContent = dropdown.message;
      wrap.appendChild(label);
    }

    var select = document.createElement('select');
    select.id = selectId;
    select.className = 'qa-inline-select__control';
    select.setAttribute(
      'aria-label',
      dropdown.message || selectPrompt || 'Select an option'
    );

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = selectPrompt;
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.hidden = true;
    select.appendChild(placeholder);

    (dropdown.options || []).forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt.value || opt.label || '';
      option.textContent = opt.label || opt.value || '';
      select.appendChild(option);
    });

    var self = this;
    select.addEventListener('change', function () {
      var val = (select.value || '').trim();
      if (!val || self.isSending) return;
      select.disabled = true;
      wrap.classList.add('qa-inline-select--used');
      self.sendMessageWithText(val, { fromRichAction: true });
    });

    wrap.appendChild(select);
    return wrap;
  };

  ESChatWidget.prototype.buildDownloadsEl = function (downloads) {
    var wrap = document.createElement('div');
    wrap.className = 'qa-downloads';
    wrap.setAttribute('role', 'list');
    var self = this;
    (downloads || []).forEach(function (entry) {
      if (!entry || !entry.href) return;
      var item = document.createElement('div');
      item.className = 'qa-download-item';
      item.setAttribute('role', 'listitem');
      item.appendChild(self.createDownloadLink(entry));
      wrap.appendChild(item);
    });
    return wrap;
  };

  ESChatWidget.prototype.appendDownloadLink = function (
    parent,
    btn
  ) {
    if (!btn || !btn.href || !/^https?:\/\//i.test(btn.href)) return false;
    var link = document.createElement('a');
    link.className =
      'qa-chip qa-chip--bot qa-chip--link' +
      (btn.download ? ' qa-chip--download' : '');
    link.href = btn.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (btn.download) {
      link.setAttribute('download', btn.fileName || btn.label || '');
    }
    link.textContent = btn.label || 'Download';
    parent.appendChild(link);
    return true;
  };

  ESChatWidget.prototype.removeFormCard = function (formEl) {
    if (!formEl) return;
    formEl.classList.add('qa-form--closed');
    var row = formEl.closest('.qa-msg');
    var body = formEl.closest('.qa-msg__body');
    formEl.remove();

    /* Keep agent text/chips in the same turn — only drop the whole row if nothing remains */
    if (!body || !row) return;
    var hasContent = false;
    Array.prototype.forEach.call(body.children, function (child) {
      if (!child.classList.contains('qa-msg__persona-row')) {
        hasContent = true;
      }
    });
    if (!hasContent) row.remove();
  };

  ESChatWidget.prototype.runFormDialogflowAction = function (action, opts) {
    opts = opts || {};
    if (this.isHumanChatActive()) return Promise.resolve();
    if (!action) return Promise.resolve();
    this._userHasInteracted = true;
    this.markUserInteracted();
    var body = {
      sessionId: this.sessionId,
      languageCode: this.getDialogflowLang(),
    };
    if (action.type === 'event' && action.event) {
      body.event = action.event;
    } else if (action.message) {
      body.message = action.message;
    } else {
      return Promise.resolve();
    }
    return this.postToDialogflow(
      body,
      Object.assign(
        {
          allowWhileSending: true,
          applyResponse: opts.applyResponse !== false,
          showTyping: opts.showTyping !== false,
        },
        opts
      )
    );
  };

  ESChatWidget.prototype.handleOtpResend = function (payload) {
    var self = this;
    payload = payload || {};
    var values = payload.values || {};
    var def = payload.def || {};
    var req = payload.request || {};
    var statusEl = payload.statusEl;

    this.clientContext = Object.assign({}, this.clientContext || {}, {
      mobile: values.mobile || this.clientContext.mobile,
      dial_code: values.dial_code || this.clientContext.dial_code,
    });

    var dataMsg =
      global.QAChatForm && global.QAChatForm.formatOtpResend
        ? global.QAChatForm.formatOtpResend(values, def)
        : 'resend_otp';

    var onResend =
      global.QAChatForm && global.QAChatForm.resolveFormAction
        ? global.QAChatForm.resolveFormAction(
            req.onResend || def.resendOtpAction || 'query:resend_otp'
          )
        : null;

    return this.postToDialogflow(
      { message: dataMsg, sessionId: this.sessionId, languageCode: this.getDialogflowLang() },
      { applyResponse: !onResend, showTyping: !onResend, allowWhileSending: true }
    )
      .then(function () {
        if (!onResend) return;
        return self.runFormDialogflowAction(onResend, {
          allowWhileSending: true,
          applyResponse: true,
          showTyping: true,
        });
      })
      .then(function () {
        if (statusEl) statusEl.hidden = true;
      })
      .catch(function () {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Could not resend OTP. Try again.';
        }
      });
  };

  ESChatWidget.prototype.buildRichMetaFromMessageOptions = function (
    options
  ) {
    options = options || {};
    var rich = {};
    var has = false;
    if (options.chips && options.chips.length) {
      rich.chips = options.chips;
      has = true;
    }
    if (options.chipHeading && String(options.chipHeading).trim()) {
      rich.chipHeading = String(options.chipHeading).trim();
      has = true;
    }
    if (options.infoCards && options.infoCards.length) {
      rich.infoCards = options.infoCards;
      has = true;
    }
    if (options.downloads && options.downloads.length) {
      rich.downloads = options.downloads;
      has = true;
    }
    if (options.dropdowns && options.dropdowns.length) {
      var d0 = options.dropdowns[0];
      rich.action = 'dfchat_inline_select';
      rich.options = d0 && d0.options ? d0.options : [];
      rich.placeholder = (d0 && d0.message) || '';
      has = true;
    }
    if (options.galleries && options.galleries.length) {
      var g0 = options.galleries[0];
      rich.action = 'open_gallery';
      rich.urls = g0 && g0.urls ? g0.urls : [];
      rich.message = (g0 && g0.message) || '';
      has = true;
    }
    if (options.cardCarousels && options.cardCarousels.length) {
      var c0 = options.cardCarousels[0];
      rich.action = 'open_card_carousel';
      rich.cards = c0 && c0.cards ? c0.cards : [];
      rich.message = (c0 && c0.message) || '';
      has = true;
    }
    if (options.forms && options.forms.length) {
      var f0 = options.forms[0];
      rich.action = 'open_form';
      rich.form_id = (f0 && (f0.formId || f0.form_id)) || '';
      rich.message = (f0 && f0.message) || '';
      has = true;
    }
    return has ? { rich: rich } : undefined;
  };

  ESChatWidget.prototype.messageHasVisibleContent = function (
    role,
    text,
    options
  ) {
    options = options || {};
    var textStr = text == null ? '' : String(text).trim();
    var replyParts = options.replyParts || [];
    var dropdowns = options.dropdowns || [];
    var galleries = options.galleries || [];
    var cardCarousels = options.cardCarousels || [];
    var forms = options.forms || [];
    var chips = options.chips || [];
    var chipHeading = (options.chipHeading || '').trim();
    var infoCards = options.infoCards || [];
    var downloads = options.downloads || [];
    var skipBubbleForDropdown =
      role === 'bot' &&
      textStr &&
      (dropdowns.some(function (d) {
        return String(d.message || '').trim() === textStr;
      }) ||
        galleries.some(function (g) {
          return String(g.message || '').trim() === textStr;
        }) ||
        cardCarousels.some(function (c) {
          return String(c.message || '').trim() === textStr;
        }) ||
        forms.some(function (f) {
          return String(f.message || '').trim() === textStr;
        }));

    if ((textStr || replyParts.length) && !skipBubbleForDropdown) return true;
    if (role === 'bot' && chipHeading) return true;
    if (role === 'bot' && chips.length) return true;
    if (role === 'bot' && infoCards.length) return true;
    if (role === 'bot' && downloads.length) return true;
    if (role === 'bot' && galleries.length) return true;
    if (role === 'bot' && cardCarousels.length) return true;
    if (role === 'bot' && dropdowns.length) return true;
    if (role === 'bot' && forms.length) return true;
    return false;
  };

  ESChatWidget.prototype.transcriptTextFromMessage = function (
    role,
    text,
    options
  ) {
    options = options || {};
    var textStr = text == null ? '' : String(text).trim();
    var replyParts = options.replyParts || [];
    var dropdowns = options.dropdowns || [];
    var galleries = options.galleries || [];
    var cardCarousels = options.cardCarousels || [];
    var forms = options.forms || [];
    var chipHeading = (options.chipHeading || '').trim();
    var skipBubbleForDropdown =
      role === 'bot' &&
      textStr &&
      (dropdowns.some(function (d) {
        return String(d.message || '').trim() === textStr;
      }) ||
        galleries.some(function (g) {
          return String(g.message || '').trim() === textStr;
        }) ||
        cardCarousels.some(function (c) {
          return String(c.message || '').trim() === textStr;
        }) ||
        forms.some(function (f) {
          return String(f.message || '').trim() === textStr;
        }));

    if ((textStr || replyParts.length) && !skipBubbleForDropdown) {
      if (replyParts.length) {
        var joined = replyParts
          .map(function (p) {
            return p && p.text != null ? String(p.text).trim() : '';
          })
          .filter(Boolean)
          .join('\n');
        if (joined) return joined;
      }
      return textStr;
    }
    if (role === 'bot' && chipHeading) return chipHeading;
    if (role === 'bot' && forms.length) {
      var fm = forms[0] && forms[0].message;
      if (fm && String(fm).trim()) return String(fm).trim();
    }
    if (role === 'bot' && galleries.length) {
      var gm = galleries[0] && galleries[0].message;
      if (gm && String(gm).trim()) return String(gm).trim();
    }
    if (role === 'bot' && cardCarousels.length) {
      var cm = cardCarousels[0] && cardCarousels[0].message;
      if (cm && String(cm).trim()) return String(cm).trim();
    }
    if (role === 'bot' && dropdowns.length) {
      var dm = dropdowns[0] && dropdowns[0].message;
      if (dm && String(dm).trim()) return String(dm).trim();
    }
    return '';
  };

  ESChatWidget.prototype.syncTranscriptFromMessage = function (
    role,
    text,
    options
  ) {
    options = options || {};
    if (options.skipTranscriptLog) return Promise.resolve();
    if (!this.messageHasVisibleContent(role, text, options)) {
      return Promise.resolve();
    }
    var line = this.transcriptTextFromMessage(role, text, options);
    var meta;
    if (role === 'bot') {
      meta = this.buildRichMetaFromMessageOptions(options) || {};
      if (options.intentIsFallback) {
        meta.intentIsFallback = true;
        meta.fallback = 'yes';
      }
      if (options.intent) meta.intent = String(options.intent);
      if (!Object.keys(meta).length) meta = undefined;
    }
    if (!line && !meta) return Promise.resolve();
    return this.appendTranscriptTurn(
      role,
      line || '(Rich content)',
      meta
    );
  };

  ESChatWidget.prototype.appendTranscriptTurn = function (role, text, meta) {
    if (!this.apiBase || !this.sessionId || this.esTestMode) return Promise.resolve();
    var t = text == null ? '' : String(text).trim();
    if (!t) return Promise.resolve();
    var body = {
      sessionId: this.sessionId,
      role: role || 'user',
      text: t,
    };
    if (meta && typeof meta === 'object') body.meta = meta;
    return fetch(this.apiBase + '/api/transcript/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(function () {
      return null;
    });
  };

  ESChatWidget.prototype.handleFormClose = function (payload) {
    payload = payload || {};
    this.removeFormCard(payload.formEl);
    var formId = payload.formId ? String(payload.formId).trim() : '';
    if (formId) {
      this.appendTranscriptTurn('user', '__form_closed:' + formId);
    }
    var req = payload.request || {};
    var action =
      global.QAChatForm && global.QAChatForm.resolveFormAction
        ? global.QAChatForm.resolveFormAction(req.onCancel)
        : null;
    if (action) {
      this._userHasInteracted = true;
      this.runFormDialogflowAction(action);
    }
  };

  ESChatWidget.prototype.getComposerUploadCfg = function () {
    return (getEffectiveCfg().features || {}).composerUpload || {};
  };

  ESChatWidget.prototype.composerUploadLabel = function (map, fallback) {
    var cfg = this.getComposerUploadCfg();
    var m = (cfg && map) || {};
    return (
      m[this.language] ||
      m.en ||
      fallback ||
      ''
    );
  };

  ESChatWidget.prototype.setComposerUploadBusy = function (busy) {
    if (this.els.attach) {
      this.els.attach.disabled = !!busy;
      this.els.attach.classList.toggle('qa-attach--busy', !!busy);
    }
  };

  ESChatWidget.prototype.uploadDocumentNames = function (up, fallbackNames) {
    up = up || {};
    return (
      up.document_names ||
      (up.uploads || [])
        .map(function (u) {
          return u.original_name;
        })
        .filter(Boolean)
        .join(', ') ||
      String(fallbackNames || '').trim()
    );
  };

  ESChatWidget.prototype.shouldShowUploadSuccessAck = function (up) {
    var cfg = this.getComposerUploadCfg();
    if (this.esTestMode && up && up.simulated) return true;
    return cfg.showSuccessAck === true;
  };

  ESChatWidget.prototype.shouldShowUploadingStatus = function () {
    var cfg = this.getComposerUploadCfg();
    return cfg.showUploadingStatus === true;
  };

  ESChatWidget.prototype.buildUploadAckMessage = function (up, fallbackNames) {
    var cfg = this.getComposerUploadCfg();
    var names = this.uploadDocumentNames(up, fallbackNames);
    if (this.esTestMode && up && up.simulated) {
      return this.composerUploadLabel(
        cfg.qaPreviewByLanguage,
        'QA test mode: upload preview only — file was not saved.'
      );
    }
    if (up && up.duplicate_skipped) {
      var dupTpl = this.composerUploadLabel(
        cfg.duplicateByLanguage,
        '✅ We already received your document(s): {files}'
      );
      return dupTpl.replace('{files}', names);
    }
    var tpl = this.composerUploadLabel(
      cfg.successByLanguage || cfg.confirmByLanguage,
      '✅ Upload successful! We received your document(s): {files}'
    );
    return tpl.replace('{files}', names);
  };

  ESChatWidget.prototype.updateBotMessageText = function (row, text, kind) {
    if (!row) return;
    var bubble = row.querySelector('.qa-msg__bubble');
    if (!bubble) return;
    bubble.classList.remove('qa-msg__bubble--multiline');
    this.fillMessageBubble(bubble, String(text || ''), []);
    row.classList.remove('qa-msg--upload-success', 'qa-msg--upload-failed', 'qa-msg--upload-pending');
    if (kind === 'success') row.classList.add('qa-msg--upload-success');
    else if (kind === 'failed') row.classList.add('qa-msg--upload-failed');
    else if (kind === 'pending') row.classList.add('qa-msg--upload-pending');
    if (this.els.messages) {
      this.els.messages.scrollTop = this.els.messages.scrollHeight;
    }
  };

  ESChatWidget.prototype.showUploadAcknowledgement = function (up, fallbackNames, statusRow) {
    if (!this.shouldShowUploadSuccessAck(up)) return;
    var msg = this.buildUploadAckMessage(up, fallbackNames);
    if (statusRow) {
      var kind = up && up.ok ? 'success' : 'failed';
      if (this.esTestMode && up && up.simulated) kind = 'failed';
      this.updateBotMessageText(statusRow, msg, kind);
      return;
    }
    this.appendMessage('bot', msg, {
      messageKind: up && up.ok && !(this.esTestMode && up.simulated) ? 'upload-success' : '',
    });
  };

  ESChatWidget.prototype.handleComposerUploadPick = function (fileList) {
    var files = [];
    if (fileList && fileList.length) {
      for (var i = 0; i < fileList.length; i += 1) {
        if (fileList[i]) files.push(fileList[i]);
      }
    }
    if (!files.length) return;
    var sizeCheck = this.validateUploadFiles(files);
    if (!sizeCheck.ok) {
      this.appendMessage('bot', 'Could not upload: ' + sizeCheck.message, {
        skipTranscriptLog: true,
      });
      return;
    }
    if (!this.apiBase) {
      this.appendMessage(
        'bot',
        'Chat server URL missing — reload the page and try again.'
      );
      return;
    }

    var self = this;
    var cfg = this.getComposerUploadCfg();
    var emoji = String(cfg.emoji || '📎').trim() || '📎';
    var names = files
      .map(function (f) {
        return f.name;
      })
      .filter(Boolean)
      .join(', ');

    this._userHasInteracted = true;
    this.noteUserActivity();
    this.setComposerUploadBusy(true);
    this.appendMessage('user', emoji + (names ? ' ' + names : ''));
    var statusRow = null;
    if (self.shouldShowUploadingStatus()) {
      var uploadingMsg = self.composerUploadLabel(
        cfg.uploadingByLanguage,
        'Uploading your document(s)…'
      );
      statusRow = self.appendMessage('bot', uploadingMsg, {
        skipTranscriptLog: true,
      });
      self.updateBotMessageText(statusRow, uploadingMsg, 'pending');
    }

    this.uploadFormDocuments(files, {}, { tag: 'composer' })
      .then(function (up) {
        if (statusRow && statusRow.parentNode) {
          statusRow.parentNode.removeChild(statusRow);
          statusRow = null;
        }
        if (up && up.ok) {
          var docNames = self.uploadDocumentNames(up, names);
          if (self.shouldShowUploadSuccessAck(up)) {
            self.appendMessage('bot', self.buildUploadAckMessage(up, names), {
              messageKind: 'upload-success',
              skipTranscriptLog: true,
            });
          }
          if (!self.esTestMode) {
            self.appendTranscriptTurn('user', emoji + (docNames ? ' ' + docNames : ''));
            self.pushSessionContext();
          }
          return;
        }
        var failMsg = self.composerUploadLabel(
          cfg.failedByLanguage,
          (up && up.message) || 'Could not upload. Please try again.'
        );
        self.appendMessage('bot', 'Could not upload: ' + failMsg, {
          skipTranscriptLog: true,
        });
      })
      .catch(function (err) {
        if (statusRow && statusRow.parentNode) {
          statusRow.parentNode.removeChild(statusRow);
          statusRow = null;
        }
        self.appendMessage(
          'bot',
          self.composerUploadLabel(
            cfg.failedByLanguage,
            'Could not upload. Please try again.'
          ),
          { skipTranscriptLog: true }
        );
      })
      .finally(function () {
        self.setComposerUploadBusy(false);
      });
  };

  ESChatWidget.prototype.uploadFormDocuments = function (files, values, request) {
    if (!this.apiBase) {
      return Promise.resolve({
        ok: false,
        message: 'Chat server URL missing — reload the page.',
      });
    }
    if (!files || !files.length) {
      return Promise.resolve({ ok: false, message: 'No files selected' });
    }
    var sizeCheck = this.validateUploadFiles(files);
    if (!sizeCheck.ok) {
      return Promise.resolve({ ok: false, message: sizeCheck.message });
    }
    if (this._uploadInFlight) {
      return this._uploadInFlight;
    }
    var ctx = this.clientContext || {};
    var vals = values || {};
    var fd = new FormData();
    fd.append('sessionId', this.sessionId);
    var uploadTag =
      (request && request.tag) ||
      (vals && vals.tag) ||
      this.pendingUploadTag ||
      '';
    uploadTag = String(uploadTag || '').trim();
    if (uploadTag) fd.append('tag', uploadTag);
    fd.append('channel', this.esTestMode ? 'ES-Test' : 'Web');
    var mobile = vals.mobile != null ? String(vals.mobile).trim() : String(ctx.mobile || '').trim();
    var dial = vals.dial_code != null ? String(vals.dial_code).trim() : String(ctx.dial_code || '').trim();
    if (mobile) fd.append('mobile', mobile);
    if (dial) fd.append('dial_code', dial);
    var customerName =
      vals.name != null ? String(vals.name).trim() : String(ctx.name || '').trim();
    var customerEmail =
      vals.email != null ? String(vals.email).trim() : String(ctx.email || '').trim();
    if (customerName) fd.append('name', customerName);
    if (customerEmail) fd.append('email', customerEmail);
    for (var i = 0; i < files.length; i += 1) {
      fd.append('files', files[i], files[i].name);
    }
    var self = this;
    var uploadHeaders = {};
    if (this.esTestMode) uploadHeaders['X-ES-Test-Mode'] = '1';
    this._uploadInFlight = fetch(this.apiBase + '/api/upload/documents', {
      method: 'POST',
      headers: uploadHeaders,
      body: fd,
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (parseErr) {
            data = {
              error: 'invalid_response',
              message: String(text || '').slice(0, 240) || 'Server returned non-JSON.',
            };
          }
          return { status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.data && res.data.ok) {
          return res.data;
        }
        var data = res.data || {};
        var msg =
          data.message ||
          data.error ||
          (data.error === 'gcs_not_configured'
            ? 'File storage is not configured on the server (GCS_BUCKET_NAME).'
            : '') ||
          (res.status === 400 ? 'Upload request was invalid (missing session or files).' : '') ||
          (res.status === 503 ? 'Upload storage is not ready on the server.' : '') ||
          'Upload failed';
        if (res.status) msg = 'HTTP ' + res.status + ': ' + msg;
        return { ok: false, message: msg, status: res.status, data: data };
      })
      .catch(function () {
        return { ok: false, message: 'Upload failed' };
      })
      .finally(function () {
        self._uploadInFlight = null;
      });
    return this._uploadInFlight;
  };

  ESChatWidget.prototype.handleFormSubmit = function (payload) {
    var self = this;
    payload = payload || {};
    this.clientContext = Object.assign({}, this.clientContext || {}, payload.values || {});
    this.pushSessionContext();
    this._userHasInteracted = true;

    var ack = payload.summaryText || '';
    var req = payload.request || {};
    var onSubmit =
      global.QAChatForm && global.QAChatForm.resolveFormAction
        ? global.QAChatForm.resolveFormAction(req.onSubmit)
        : null;

    /* Remove form before ack or any Dialogflow reply so agent text never stacks on the card */
    this.removeFormCard(payload.formEl);

    var runAfterFormGone = function () {
      var userLabel =
        global.QAChatForm && global.QAChatForm.formSubmittedTranscriptLabel
          ? global.QAChatForm.formSubmittedTranscriptLabel(
              payload.formId,
              payload.def
            )
          : '';

      /* Transcript order: user submit line before bot thank-you */
      var chainPromise = userLabel
        ? self.appendTranscriptTurn('user', userLabel)
        : Promise.resolve();

      chainPromise = chainPromise.then(function () {
        if (ack) {
          self.appendMessage('bot', ack);
        }

        /* Form data to Dialogflow is silent when we show our own ack */
        return self.postToDialogflow(
          {
            message: payload.dialogflowText,
            sessionId: self.sessionId,
            languageCode: self.getDialogflowLang(),
            skipTranscriptUser: true,
          },
          { applyResponse: false, showTyping: false, allowWhileSending: true }
        );
      });

      if (onSubmit) {
        chainPromise = chainPromise.then(function () {
          return self.runFormDialogflowAction(onSubmit);
        });
      } else if (
        payload.nextFormId &&
        global.QAChatForm &&
        global.QAChatForm.isFormsEnabled()
      ) {
        chainPromise = chainPromise.then(function () {
          var chainTag = String(req.tag || self.pendingUploadTag || '').trim();
          if (chainTag) self.pendingUploadTag = chainTag;
          var nextFormReq =
            global.QAChatForm && global.QAChatForm.buildChainedFormRequest
              ? global.QAChatForm.buildChainedFormRequest(
                  payload.nextFormId,
                  payload.def,
                  req,
                  self.clientContext
                )
              : {
                  formId: payload.nextFormId,
                  prefill: self.clientContext,
                };
          if (!nextFormReq) return;
          if (chainTag && !nextFormReq.tag) nextFormReq.tag = chainTag;
          var displayForms = self.resolveFormRequestsForDisplay([nextFormReq]);
          if (!displayForms.length) return;
          self.appendMessage('bot', '', { forms: displayForms });
        });
      }

      return chainPromise;
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(runAfterFormGone);
    } else {
      setTimeout(runAfterFormGone, 0);
    }
  };

  ESChatWidget.prototype.mergeSessionParameters = function (sessionParameters) {
    var params =
      sessionParameters && typeof sessionParameters === 'object'
        ? sessionParameters
        : {};
    if (!Object.keys(params).length) return;
    var patch = Object.assign({}, params);
    if (!patch.mobile && patch.phone) patch.mobile = patch.phone;
    if (!patch.appointmentdate && patch.appointment_date) {
      patch.appointmentdate = patch.appointment_date;
    }
    if (!patch.appointmenttime && patch.appointment_time) {
      patch.appointmenttime = patch.appointment_time;
    }
    this.clientContext = Object.assign({}, this.clientContext || {}, patch);
  };

  ESChatWidget.prototype.handleSkippedForm = function (request) {
    var prefill = (request && request.prefill) || {};
    this.clientContext = Object.assign({}, this.clientContext || {}, prefill);
    this.pushSessionContext();
    var action =
      global.QAChatForm && global.QAChatForm.resolveFormAction
        ? global.QAChatForm.resolveFormAction((request || {}).onSubmit)
        : null;
    if (action) {
      this._userHasInteracted = true;
      this.runFormDialogflowAction(action);
    }
  };

  ESChatWidget.prototype.handleSkippedContactForm = function (request) {
    this.handleSkippedForm(request);
  };

  ESChatWidget.prototype.resolveFormRequestsForDisplay = function (forms) {
    var self = this;
    var skipFn =
      global.QAChatForm &&
      (global.QAChatForm.resolveFormSkips || global.QAChatForm.resolveContactSkip);
    if (!skipFn) return Array.isArray(forms) ? forms : [];
    var out = [];
    (Array.isArray(forms) ? forms : []).forEach(function (req) {
      var resolved = skipFn(req, self);
      if (!resolved) return;
      if (resolved._skipContactOnly || resolved._skipAppointmentOnly) {
        self.handleSkippedForm(resolved.request);
        return;
      }
      out.push(resolved);
    });
    return out;
  };

  ESChatWidget.prototype.buildFormEl = function (formRequest) {
    if (!global.QAChatForm || !global.QAChatForm.isFormsEnabled()) return null;
    var skipFn =
      global.QAChatForm.resolveFormSkips || global.QAChatForm.resolveContactSkip;
    var resolved = skipFn ? skipFn(formRequest, this) : formRequest;
    if (resolved && (resolved._skipContactOnly || resolved._skipAppointmentOnly)) {
      this.handleSkippedForm(resolved.request);
      return null;
    }
    return global.QAChatForm.buildFormEl(resolved, this);
  };

  ESChatWidget.prototype.appendFormattedBubbleContent = function (
    bubble,
    text,
    replyHtml
  ) {
    if (replyHtml && String(replyHtml).trim()) {
      bubble.classList.add('qa-msg__bubble--formatted');
      bubble.innerHTML = String(replyHtml);
      return true;
    }
    var ms = global.QAMessageSyntax;
    var textStr = text == null ? '' : String(text);
    if (!textStr.trim()) return false;
    if (!ms || typeof ms.renderHtml !== 'function' || !ms.hasMessageSyntax(textStr)) {
      return false;
    }
    bubble.classList.add('qa-msg__bubble--formatted');
    bubble.innerHTML = ms.renderHtml(textStr);
    return true;
  };

  ESChatWidget.prototype.fillMessageBubble = function (bubble, text, replyParts, replyHtml) {
    bubble.textContent = '';
    bubble.classList.remove('qa-msg__bubble--formatted', 'qa-msg__bubble--multiline');
    if (replyHtml && String(replyHtml).trim()) {
      this.appendFormattedBubbleContent(bubble, text, replyHtml);
      return;
    }
    var parts = replyParts && replyParts.length ? replyParts : null;
    if (!parts) {
      var textStr = text == null ? '' : String(text).trim();
      if (!textStr) return;
      if (this.appendFormattedBubbleContent(bubble, textStr, replyHtml)) return;
      if (textStr.indexOf('\n') >= 0) {
        bubble.classList.add('qa-msg__bubble--multiline');
        textStr.split('\n').forEach(function (line, i) {
          if (i > 0) bubble.appendChild(document.createElement('br'));
          bubble.appendChild(document.createTextNode(line));
        });
      } else {
        bubble.textContent = textStr;
      }
      return;
    }
    var self = this;
    var ms = global.QAMessageSyntax;
    var usedFormatted = false;
    parts.forEach(function (part) {
      if (part.type === 'link' && part.href && /^https?:\/\//i.test(part.href)) {
        var a = document.createElement('a');
        a.className = 'qa-msg__link';
        a.href = part.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (
          ms &&
          typeof ms.renderHtml === 'function' &&
          ms.hasMessageSyntax(part.text || '')
        ) {
          a.innerHTML = ms.renderHtml(part.text || '');
        } else {
          a.textContent = part.text || part.href;
        }
        bubble.appendChild(a);
        return;
      }
      var chunk = part.text != null ? String(part.text) : '';
      if (!chunk) return;
      if (
        ms &&
        typeof ms.renderHtml === 'function' &&
        ms.hasMessageSyntax(chunk)
      ) {
        usedFormatted = true;
        var wrap = document.createElement('span');
        wrap.innerHTML = ms.renderHtml(chunk);
        while (wrap.firstChild) bubble.appendChild(wrap.firstChild);
        return;
      }
      bubble.appendChild(document.createTextNode(chunk));
    });
    if (usedFormatted) bubble.classList.add('qa-msg__bubble--formatted');
    if (!bubble.childNodes.length && text) {
      if (!this.appendFormattedBubbleContent(bubble, String(text).trim(), replyHtml)) {
        bubble.textContent = String(text).trim();
      }
    }
  };

  ESChatWidget.prototype.appendMessage = function (role, text, options) {
    options = options || {};
    if (this.els.welcome) {
      this.els.welcome.remove();
      this.els.welcome = null;
    }
    var row = document.createElement('div');
    row.className = 'qa-msg qa-msg--' + role;
    if (
      options.messageKind === 'agent-connected' ||
      options.messageKind === 'agent-rejoined' ||
      options.messageKind === 'agent-disconnected'
    ) {
      row.classList.add('qa-msg--agent-connected');
    }
    if (options.messageKind === 'upload-success') {
      row.classList.add('qa-msg--upload-success');
    }
    var body = document.createElement('div');
    body.className = 'qa-msg__body';
    body.appendChild(this.buildPersonaRow(role, options));
    var textStr = text == null ? '' : String(text).trim();
    var replyParts = options.replyParts || [];
    var replyHtml = options.replyHtml || '';
    var dropdowns = options.dropdowns || [];
    var galleries = options.galleries || [];
    var cardCarousels = options.cardCarousels || [];
    var forms = options.forms || [];
    var skipBubbleForDropdown =
      role === 'bot' &&
      textStr &&
      (dropdowns.some(function (d) {
        return String(d.message || '').trim() === textStr;
      }) ||
        galleries.some(function (g) {
          return String(g.message || '').trim() === textStr;
        }) ||
        cardCarousels.some(function (c) {
          return String(c.message || '').trim() === textStr;
        }) ||
        forms.some(function (f) {
          return String(f.message || '').trim() === textStr;
        }));
    if ((textStr || replyParts.length) && !skipBubbleForDropdown) {
      var bubble = document.createElement('div');
      bubble.className = 'qa-msg__bubble';
      this.fillMessageBubble(bubble, textStr, replyParts, replyHtml);
      body.appendChild(bubble);
    }
    var chips = options.chips || [];
    var chipHeading = (options.chipHeading || '').trim();
    if (role === 'bot' && chipHeading) {
      var headingEl = document.createElement('div');
      headingEl.className = 'qa-msg__chips-heading';
      headingEl.textContent = chipHeading;
      body.appendChild(headingEl);
    }
    if (role === 'bot' && chips.length) {
      var chipsWrap = document.createElement('div');
      chipsWrap.className = 'qa-msg__chips';
      chipsWrap.setAttribute('role', 'group');
      chipsWrap.setAttribute('aria-label', 'Suggested replies');
      var self = this;
      chips.forEach(function (c) {
        var label = c.label || c.message || '';
        var message = c.sendMessage || c.message || c.label || '';
        if (!label) return;
        if (
          c.href &&
          /^https?:\/\//i.test(c.href) &&
          self.appendDownloadLink(chipsWrap, {
            href: c.href,
            label: label,
            download: true,
            fileName: label,
          })
        ) {
          return;
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qa-chip qa-chip--bot';
        btn.setAttribute('data-message', message);
        btn.textContent = label;
        chipsWrap.appendChild(btn);
      });
      if (chipsWrap.childNodes.length) body.appendChild(chipsWrap);
    }
    var infoCards = options.infoCards || [];
    if (role === 'bot' && infoCards.length) {
      body.appendChild(this.buildInfoCardsEl(infoCards));
    }
    var downloads = options.downloads || [];
    if (role === 'bot' && downloads.length) {
      body.appendChild(this.buildDownloadsEl(downloads));
    }
    if (role === 'bot' && galleries.length) {
      var selfGallery = this;
      galleries.forEach(function (gallery) {
        body.appendChild(selfGallery.buildGalleryEl(gallery));
      });
    }
    if (role === 'bot' && cardCarousels.length) {
      var selfCarousel = this;
      cardCarousels.forEach(function (carousel) {
        body.appendChild(selfCarousel.buildCardCarouselEl(carousel));
      });
    }
    if (role === 'bot' && dropdowns.length) {
      var selfDropdown = this;
      var sharedGalleryMsg =
        galleries.length === 1 ? String(galleries[0].message || '').trim() : '';
      dropdowns.forEach(function (dropdown) {
        var hideLabel =
          sharedGalleryMsg &&
          String(dropdown.message || '').trim() === sharedGalleryMsg;
        body.appendChild(selfDropdown.buildInlineSelectEl(dropdown, { hideLabel: hideLabel }));
      });
    }
    if (role === 'bot' && forms.length) {
      var selfForm = this;
      forms.forEach(function (formReq) {
        var el = selfForm.buildFormEl(formReq);
        if (el) body.appendChild(el);
      });
    }
    row.appendChild(body);
    this.els.messages.appendChild(row);
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
    this.syncTranscriptFromMessage(role, text, options);
    return row;
  };

  ESChatWidget.prototype.showTyping = function () {
    var typingCfg = getTypingIndicatorCfg();
    if (this.root) {
      this.root.style.setProperty(
        '--es-typing-dot-duration',
        Math.max(0.45, typingCfg.dotsIntervalMs / 1000) + 's'
      );
    }
    var row = document.createElement('div');
    row.className = 'qa-msg qa-msg--bot qa-msg--typing-indicator';
    var body = document.createElement('div');
    body.className = 'qa-msg__body';
    body.appendChild(this.buildPersonaRow('bot'));
    var bubble = document.createElement('div');
    bubble.className = 'qa-msg__bubble qa-msg__bubble--typing';
    bubble.setAttribute('aria-label', typingCfg.text || 'Bot is typing');
    var html = '';
    if (typingCfg.text) {
      html +=
        '<span class="qa-msg__typing-text">' +
        this.escape(typingCfg.text) +
        '</span> ';
    }
    html +=
      '<span class="qa-msg__typing" aria-hidden="true"><span></span><span></span><span></span></span>';
    bubble.innerHTML = html;
    body.appendChild(bubble);
    row.appendChild(body);
    this.els.messages.appendChild(row);
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
    row._stopTyping = function () {};
    return row;
  };

  ESChatWidget.prototype.sendMessage = function () {
    var text = (this.els.input.value || '').trim();
    if (!text || this.isSending) return;
    this.els.input.value = '';
    this.els.input.style.height = 'auto';
    this.sendMessageWithText(text);
  };

  ESChatWidget.prototype.sendMessageWithText = function (text, opts) {
    opts = opts || {};
    text = (text || '').trim();
    if (!text || this.isSending) return;
    if (this.isHumanChatActive()) {
      if (typeof this._liveAgentSendUser === 'function') {
        if (!this.liveAgentMode && typeof this.startLiveAgentMode === 'function') {
          this.startLiveAgentMode({});
        }
        this._liveAgentSendUser(text);
        return;
      }
    }

    var orch = getAgentOrchestrationCfg();
    if (this.isOrchestrationReceptionistHost()) {
      if (this._orchMode === 'receptionist') {
        var child = findChildByOpenTrigger_(text, orch);
        if (child) {
          this.markUserInteracted();
          this.noteUserActivity();
          this.appendMessage('user', text);
          this.switchToChildAgent(child);
          return;
        }
      } else if (
        this._orchMode === 'child' &&
        isReturnToReceptionistTrigger_(text, orch)
      ) {
        this.markUserInteracted();
        this.noteUserActivity();
        this.appendMessage('user', text);
        this.switchToReceptionist();
        return;
      }
    }

    this.markUserInteracted();
    this.noteUserActivity();
    this.appendMessage('user', text);
    this.postToDialogflow(
      this.withDialogflowRouting_({
        message: text,
        sessionId: this.sessionId,
        languageCode: this.getDialogflowLang(),
        skipQaProvision: !!opts.fromRichAction,
      })
    );
  };

  ESChatWidget.prototype.toggleSpeech = function () {
    if (!isSpeechToTextEnabled()) return;

    if (this.recognition) {
      this.stopSpeech();
      return;
    }
    var SpeechRecognition =
      global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showError(
        'Speech-to-text is not supported in this browser. Use Chrome or Edge.'
      );
      return;
    }
    var self = this;
    var lang = this.langMap[this.language]
      ? this.langMap[this.language].speech
      : 'en-IN';
    this.recognition = new SpeechRecognition();
    this.recognition.lang = lang;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.els.mic.classList.add('qa-mic--active');
    this.recognition.onresult = function (e) {
      var transcript = e.results[0][0].transcript;
      self.els.input.value = (self.els.input.value + ' ' + transcript).trim();
      self.els.input.dispatchEvent(new Event('input'));
    };
    this.recognition.onerror = function () {
      self.showError('Could not capture speech. Check microphone permission.');
      self.stopSpeech();
    };
    this.recognition.onend = function () {
      self.stopSpeech();
    };
    this.recognition.start();
  };

  ESChatWidget.prototype.stopSpeech = function () {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
      this.recognition = null;
    }
    if (this.els.mic) this.els.mic.classList.remove('qa-mic--active');
  };

  ESChatWidget.prototype.showError = function (msg) {
    this.els.error.textContent = msg;
    this.els.error.hidden = false;
  };

  ESChatWidget.prototype.hideError = function () {
    this.els.error.hidden = true;
    this.els.error.textContent = '';
  };

  ESChatWidget.prototype.escape = function (s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  global.ESChatWidget = ESChatWidget;
})(typeof window !== 'undefined' ? window : this);
