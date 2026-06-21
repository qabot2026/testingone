(function () {
  'use strict';

  var global = typeof window !== 'undefined' ? window : this;

  var hintEl = document.getElementById('previewHint');
  if (hintEl) {
    hintEl.textContent = 'Starting chatbot preview…';
  }

  var widgetInstance = null;
  var bootTimer = null;
  var bootWatchdog = null;
  var previewBooted = false;
  var currentSitePreset = null;
  var currentBotId = null;
  var currentPreviewViewport = 'desk';
  var sitePresetsLoaded = false;
  var previewDocHeightPx = 0;
  var layoutPreviewTimer = null;

  function readEmbeddedFrameHeight() {
    try {
      if (window.frameElement) {
        return (
          window.frameElement.clientHeight ||
          Math.round(window.frameElement.getBoundingClientRect().height) ||
          0
        );
      }
    } catch (e) {
      /* ignore */
    }
    return 0;
  }

  function resolvePreviewStageHeight(px) {
    var posted = parseInt(px, 10) || 0;
    var embedded = readEmbeddedFrameHeight();
    var h = Math.max(posted, embedded);
    if (!h) {
      h = Math.max(
        280,
        global.innerHeight ||
          (document.documentElement && document.documentElement.clientHeight) ||
          600
      );
    }
    return Math.max(280, h);
  }

  function applyPreviewDocHeight(px) {
    var h = resolvePreviewStageHeight(px);
    if (h === previewDocHeightPx) return;
    previewDocHeightPx = h;
    global.previewDocHeightPx = h;
    document.documentElement.style.setProperty('--es-preview-vh', h + 'px');
    document.documentElement.style.height = h + 'px';
    document.documentElement.style.minHeight = h + 'px';
    document.documentElement.style.maxHeight = h + 'px';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.height = h + 'px';
    document.body.style.minHeight = h + 'px';
    document.body.style.maxHeight = h + 'px';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
  }

  applyPreviewDocHeight(0);

  function deepMerge(base, over) {
    var out = {};
    var b = base || {};
    var o = over || {};
    Object.keys(b).forEach(function (k) {
      out[k] = b[k];
    });
    Object.keys(o).forEach(function (k) {
      if (
        o[k] &&
        typeof o[k] === 'object' &&
        !Array.isArray(o[k]) &&
        b[k] &&
        typeof b[k] === 'object' &&
        !Array.isArray(b[k])
      ) {
        out[k] = deepMerge(b[k], o[k]);
      } else {
        out[k] = o[k];
      }
    });
    return out;
  }

  function ensureSitePresets(cb) {
    if (sitePresetsLoaded) {
      cb();
      return;
    }
    fetch('/api/site-presets/public?t=' + Date.now())
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (
          data &&
          data.sitePresets &&
          window.ES_CHAT_UI_CONFIG &&
          window.ES_CHAT_UI_CONFIG.common
        ) {
          var current = window.ES_CHAT_UI_CONFIG.common.sitePresets || {};
          window.ES_CHAT_UI_CONFIG.common.sitePresets = deepMerge(
            current,
            data.sitePresets
          );
        }
      })
      .catch(function () {
        /* keep defaults */
      })
      .finally(function () {
        sitePresetsLoaded = true;
        cb();
      });
  }

  function destroyWidget() {
    var nodes = document.querySelectorAll('.qa-widget');
    nodes.forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    widgetInstance = null;
    window.widgetInstance = null;
    currentSitePreset = null;
    currentBotId = null;
    previewBooted = false;
    window.__qaWidgetLoaded = false;
  }

  function normalizePreviewViewport(raw) {
    return raw === 'mob' ? 'mob' : 'desk';
  }

  function applyPreviewViewportClass(vp) {
    document.body.classList.toggle('qa-bot-preview--mob', vp === 'mob');
    document.body.classList.toggle('qa-bot-preview--desk', vp === 'desk');
  }

  function isPreviewMode() {
    return !!(window.ES_CONFIG && window.ES_CONFIG.previewViewport);
  }

  function clearBootWatchdog() {
    if (bootWatchdog) {
      clearTimeout(bootWatchdog);
      bootWatchdog = null;
    }
  }

  function armBootWatchdog() {
    clearBootWatchdog();
    bootWatchdog = setTimeout(function () {
      if (previewBooted) return;
      updateHint(
        'Preview is taking longer than expected — refreshing connection…',
        false
      );
      signalReady();
    }, 5000);
  }

  function mergePreviewConfig(payload) {
    var project = payload.project;
    var preset = payload.preset || {};
    if (!project || !project.sitePreset) return null;

    if (!window.ES_CHAT_UI_CONFIG) window.ES_CHAT_UI_CONFIG = {};
    var cfg = window.ES_CHAT_UI_CONFIG;
    if (!cfg.common) cfg.common = {};
    if (!cfg.common.sitePresets) cfg.common.sitePresets = {};

    cfg.common.sitePresets[project.sitePreset] = deepMerge(
      cfg.common.sitePresets[project.sitePreset] || {},
      preset
    );

    var siteBlock = cfg.common.sitePresets[project.sitePreset] || {};
    if (siteBlock.common) {
      cfg.common = deepMerge(cfg.common, siteBlock.common);
    }
    if (siteBlock.desk) {
      cfg.desk = deepMerge(cfg.desk || {}, siteBlock.desk);
    }
    if (siteBlock.mob) {
      cfg.mob = deepMerge(cfg.mob || {}, siteBlock.mob);
    }

    var vp = normalizePreviewViewport(payload.previewViewport);
    currentPreviewViewport = vp;
    window.ES_CONFIG = {
      apiBase: window.location.origin.replace(/\/$/, ''),
      sitePreset: project.sitePreset,
      previewViewport: vp,
    };
    if (project.welcomeEventName) {
      window.ES_CONFIG.welcomeEventName = project.welcomeEventName;
    }
    applyPreviewViewportClass(vp);

    return project;
  }

  function updateHint(text, isError) {
    var hint = document.getElementById('previewHint');
    if (!hint) return;
    hint.textContent = text;
    hint.style.color = isError ? '#dc2626' : '#94a3b8';
    hint.style.display = '';
  }

  function hideHint() {
    var hint = document.getElementById('previewHint');
    if (hint) hint.style.display = 'none';
  }

  function layoutPreview() {
    if (!widgetInstance || !widgetInstance.root) return;
    if (typeof widgetInstance.applyPreviewPanelLayout_ === 'function') {
      widgetInstance.applyPreviewPanelLayout_();
    }
    if (typeof widgetInstance.syncLauncherStack === 'function') {
      widgetInstance.syncLauncherStack();
    }
    if (typeof widgetInstance.syncPreviewStageLayout_ === 'function') {
      widgetInstance.syncPreviewStageLayout_();
    }
  }

  function scheduleLayoutPreview() {
    if (layoutPreviewTimer) clearTimeout(layoutPreviewTimer);
    layoutPreviewTimer = setTimeout(function () {
      layoutPreviewTimer = null;
      requestAnimationFrame(function () {
        layoutPreview();
      });
    }, 48);
  }

  function scheduleLayoutPreviewBurst() {
    scheduleLayoutPreview();
    [80, 200, 500, 1000].forEach(function (ms) {
      setTimeout(scheduleLayoutPreview, ms);
    });
  }

  function syncPreviewStageHeightFromFrame() {
    applyPreviewDocHeight(readEmbeddedFrameHeight());
  }

  function wirePreviewResize() {
    if (typeof ResizeObserver === 'undefined') return;
    var lastW = 0;
    var lastH = 0;
    var ro = new ResizeObserver(function () {
      var w = document.documentElement.clientWidth;
      var h = previewDocHeightPx || document.documentElement.clientHeight;
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
      lastW = w;
      lastH = h;
      scheduleLayoutPreview();
    });
    ro.observe(document.documentElement);
  }

  function reapplyPreviewIcons() {
    if (!widgetInstance || typeof widgetInstance.refreshUiFromConfig !== 'function') {
      return;
    }
    widgetInstance.refreshUiFromConfig();
  }

  function bootWidget(project) {
    if (!window.ESChatWidget) {
      updateHint('Preview failed: chat widget did not load.', true);
      return;
    }

    syncPreviewStageHeightFromFrame();

    widgetInstance = new window.ESChatWidget({
      apiBase: window.ES_CONFIG.apiBase,
    });
    window.widgetInstance = widgetInstance;
    currentSitePreset = project.sitePreset;
    if (!widgetInstance.root) {
      updateHint('Preview failed: could not create chat widget.', true);
      return;
    }
    if (
      !isPreviewMode() &&
      widgetInstance.root.style.display === 'none'
    ) {
      var label = currentPreviewViewport === 'mob' ? 'Mobile' : 'Desktop';
      updateHint('Chatbot hidden — enable “Show chatbot” under ' + label + '.', true);
      return;
    }
    previewBooted = true;
    clearBootWatchdog();
    hideHint();

    installPreviewReverseHighlight(widgetInstance);

    scheduleLayoutPreviewBurst();
    setTimeout(reapplyPreviewIcons, 120);
  }

  function refreshWidget() {
    if (!widgetInstance) return;

    if (!widgetInstance.root) {
      destroyWidget();
      bootWidget({ sitePreset: currentSitePreset });
      return;
    }

    if (typeof widgetInstance.updateChatbotVisibility === 'function') {
      widgetInstance.updateChatbotVisibility();
    }

    if (
      !isPreviewMode() &&
      widgetInstance.root.style.display === 'none'
    ) {
      var hiddenLabel = currentPreviewViewport === 'mob' ? 'Mobile' : 'Desktop';
      updateHint('Chatbot hidden — enable “Show chatbot” under ' + hiddenLabel + '.', true);
      return;
    }

    if (widgetInstance.root) {
      previewBooted = true;
      clearBootWatchdog();
      hideHint();
    }

    if (typeof widgetInstance.refreshUiFromConfig === 'function') {
      widgetInstance.refreshUiFromConfig();
    } else {
      if (typeof widgetInstance.applyTheme === 'function') {
        widgetInstance.applyTheme();
      }
      if (typeof widgetInstance.applyLayout === 'function') {
        widgetInstance.applyLayout();
      }
      if (typeof widgetInstance.updateLauncherStripVisibility === 'function') {
        widgetInstance.updateLauncherStripVisibility();
      }
      if (typeof widgetInstance.applyFeatureToggles === 'function') {
        widgetInstance.applyFeatureToggles();
      }
    }

    scheduleLayoutPreview();
    setTimeout(reapplyPreviewIcons, 120);
  }

  function applyPreview(payload) {
    if (!payload || !payload.project) {
      updateHint('Waiting for bot settings from editor…', false);
      return;
    }
    updateHint('Loading chatbot…', false);
    ensureSitePresets(function () {
      var project = mergePreviewConfig(payload);
      if (!project) {
        updateHint(
          'Preview config missing — reload the page (company.config.js may not have loaded).',
          true
        );
        return;
      }

      var nextBotId = String(project.id || '').trim();
      if (
        widgetInstance &&
        nextBotId &&
        currentBotId &&
        nextBotId !== currentBotId
      ) {
        destroyWidget();
      }
      currentBotId = nextBotId || currentBotId;

      syncPreviewStageHeightFromFrame();

      if (widgetInstance && currentSitePreset === project.sitePreset) {
        refreshWidget();
        scheduleLayoutPreviewBurst();
        return;
      }

      destroyWidget();
      bootWidget(project);
    });
  }

  function schedulePreview(payload) {
    if (!previewBooted) {
      applyPreview(payload);
      return;
    }
    if (bootTimer) clearTimeout(bootTimer);
    bootTimer = setTimeout(function () {
      bootTimer = null;
      applyPreview(payload);
    }, 60);
  }

  var spotlightEl = null;
  var spotlightTimer = null;
  var demoTypingRow = null;
  var demoTypingTimer = null;
  var SPOTLIGHT_DURATION_MS = 2000;

  var PREVIEW_HOVER_SELECTORS = [
    '.qa-launcher-strip',
    '.qa-header__expand',
    '.qa-header__title',
    '.qa-header__subtitle',
    '.qa-header__icon',
    '.qa-lang',
    '.qa-mic',
    '.qa-restart',
    '.qa-input',
    '.qa-send',
    '.qa-powered',
    '.qa-msg--typing-indicator',
    '.qa-msg--user .qa-msg__bubble',
    '.qa-msg--bot .qa-msg__bubble',
    '.qa-msg--bot .qa-msg__avatar',
    '.qa-msg__time',
    '.qa-launcher-wrap',
    '.qa-launcher',
    '.qa-header',
    '.qa-messages',
    '.qa-footer',
    '.qa-toolbar',
    '.qa-panel',
  ];

  function resolvePreviewHoverSelector(node, root) {
    if (!node || !root) return null;
    var i;
    for (i = 0; i < PREVIEW_HOVER_SELECTORS.length; i++) {
      var sel = PREVIEW_HOVER_SELECTORS[i];
      if (node.closest && node.closest(sel)) return sel;
    }
    return null;
  }

  function installPreviewReverseHighlight(w) {
    if (!w || !w.root || w.root._reverseHighlightBound) return;
    w.root._reverseHighlightBound = true;
    var lastSelector = null;
    var postTimer = null;

    w.root.addEventListener('mouseover', function (ev) {
      if (!ev.ctrlKey) return;
      var sel = resolvePreviewHoverSelector(ev.target, w.root);
      if (!sel || sel === lastSelector) return;
      lastSelector = sel;
      if (postTimer) clearTimeout(postTimer);
      postTimer = setTimeout(function () {
        postTimer = null;
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: 'qa-bot-preview-reverse-highlight',
              selector: sel,
            },
            '*'
          );
        }
      }, 50);
    });

    w.root.addEventListener('mouseleave', function () {
      lastSelector = null;
    });
  }

  function clearSpotlight() {
    if (spotlightEl) {
      spotlightEl.classList.remove('qa-preview-spotlight');
      spotlightEl = null;
    }
    if (spotlightTimer) {
      clearTimeout(spotlightTimer);
      spotlightTimer = null;
    }
  }

  function clearDemoTyping() {
    if (demoTypingRow && demoTypingRow.parentNode) {
      demoTypingRow.parentNode.removeChild(demoTypingRow);
    }
    demoTypingRow = null;
    if (demoTypingTimer) {
      clearTimeout(demoTypingTimer);
      demoTypingTimer = null;
    }
  }

  function ensureDemoMessages(w) {
    if (!w || !w.els || !w.els.messages) return;
    var msgs = w.els.messages;
    if (!msgs.querySelector('.qa-msg--user')) {
      var user = document.createElement('div');
      user.className = 'qa-msg qa-msg--user';
      user.innerHTML =
        '<div class="qa-msg__body"><div class="qa-msg__bubble">Sample visitor message</div></div>';
      msgs.appendChild(user);
    }
    if (
      !msgs.querySelector(
        '.qa-msg--bot:not(.qa-msg--typing-indicator)'
      )
    ) {
      var bot = document.createElement('div');
      bot.className = 'qa-msg qa-msg--bot';
      bot.innerHTML =
        '<div class="qa-msg__body"><div class="qa-msg__bubble">Sample bot reply</div></div>';
      msgs.appendChild(bot);
    }
  }

  function ensureDemoContent(w, kind) {
    if (!w) return;
    if (kind === 'typing') {
      clearDemoTyping();
      if (w.els && w.els.messages && !w.els.messages.querySelector('.qa-msg--typing-indicator')) {
        if (typeof w.showTyping === 'function') {
          demoTypingRow = w.showTyping();
          demoTypingTimer = setTimeout(clearDemoTyping, 4500);
        }
      }
      return;
    }
    if (kind === 'messages' || kind === 'botMsg') {
      ensureDemoMessages(w);
    }
  }

  function pickHighlightElement(w, target) {
    if (!w || !w.root) return null;
    var selectors = [];
    if (target && target.selector) selectors.push(target.selector);
    if (target && target.fallbackSelector) {
      selectors.push(target.fallbackSelector);
    }
    selectors.push('.qa-widget');
    var i;
    for (i = 0; i < selectors.length; i++) {
      var el = w.root.querySelector(selectors[i]);
      if (el) return el;
    }
    return w.root;
  }

  function applyHighlight(payload) {
    if (payload && payload.clear) {
      clearSpotlight();
      clearDemoTyping();
      return;
    }
    clearSpotlight();
    clearDemoTyping();

    var w = widgetInstance;
    if (!w || !w.root || w.root.style.display === 'none') {
      return;
    }

    var target = payload.target || {};
    if (target.openPanel && typeof w.open === 'function' && !w.isOpen) {
      w.open();
    } else if (target.closePanel && typeof w.close === 'function' && w.isOpen) {
      w.close();
    }

    if (target.demo) {
      ensureDemoContent(w, target.demo);
    }

    scheduleLayoutPreview();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var el = pickHighlightElement(w, target);
        if (!el) return;
        el.classList.add('qa-preview-spotlight');
        spotlightEl = el;
        spotlightTimer = setTimeout(clearSpotlight, SPOTLIGHT_DURATION_MS);
      });
    });
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data) return;
    if (data.type === 'qa-bot-preview-size') {
      applyPreviewDocHeight(data.height);
      scheduleLayoutPreviewBurst();
      setTimeout(reapplyPreviewIcons, 80);
      return;
    }
    if (data.type === 'qa-bot-preview-highlight') {
      applyHighlight(data);
      return;
    }
    if (data.type !== 'qa-bot-preview') return;
    schedulePreview(data);
  });

  function getUrlBotId() {
    try {
      return String(new URLSearchParams(window.location.search).get('botId') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function bootstrapPreviewFromApi() {
    var botId = getUrlBotId();
    if (!botId) return;
    updateHint('Loading chatbot settings…', false);
    fetch('/api/bot-settings/' + encodeURIComponent(botId) + '?t=' + Date.now())
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.project) {
          updateHint('Could not load bot settings for preview.', true);
          return;
        }
        applyPreview({
          project: data.project,
          preset: data.preset || {},
          previewViewport: currentPreviewViewport,
        });
      })
      .catch(function () {
        updateHint('Could not load bot settings for preview.', true);
      });
  }

  function signalReady() {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'qa-bot-preview-ready' }, '*');
    }
  }

  updateHint('Waiting for settings from editor…', false);
  armBootWatchdog();
  signalReady();
  if (getUrlBotId()) {
    bootstrapPreviewFromApi();
  }
  window.addEventListener('load', function () {
    signalReady();
    wirePreviewResize();
    syncPreviewStageHeightFromFrame();
    scheduleLayoutPreviewBurst();
  });
  window.addEventListener('resize', function () {
    syncPreviewStageHeightFromFrame();
    scheduleLayoutPreview();
  });
})();
