(function () {
  'use strict';

  var BOT_ID = String(window.BOT_ID || window.BOT_PROJECT_ID || '').trim();
  var SETTINGS_MODE = String(window.BOT_SETTINGS_MODE || 'appearance').trim();
  var isAdditionalFeaturesMode = SETTINGS_MODE === 'additional-features';
  var currentProject = null;
  var previewFrame = null;
  var previewReady = false;
  var previewPushTimer = null;
  var previewPending = false;
  var previewStarted = false;
  var lastPreviewSizeSent = 0;
  var previewSizeTimer = null;
  var pageState = {
    activeDevice: 'desk',
    sectionSyncToMob: {
      bubble: false,
      header: false,
      chatPanel: false,
    },
    mobAppearanceCustomized: false,
  };

  var GLOBAL_COMMON_PATH_PREFIXES = [
    'common.features.multiLanguage',
    'common.dialogflow',
  ];

  function isGlobalCommonPath(path) {
    if (!path || path.indexOf('common.') !== 0) return false;
    var i;
    for (i = 0; i < GLOBAL_COMMON_PATH_PREFIXES.length; i++) {
      var prefix = GLOBAL_COMMON_PATH_PREFIXES[i];
      if (path === prefix || path.indexOf(prefix + '.') === 0) return true;
    }
    return false;
  }

  function deviceForElement(el) {
    var panel = el && el.closest('.settings-device-panel');
    if (!panel) return null;
    return panel.id === 'settings-device-mob' ? 'mob' : 'desk';
  }

  function appearanceCommonStoragePath(el, formPath) {
    if (isAdditionalFeaturesMode || isGlobalCommonPath(formPath)) return formPath;
    var dev = deviceForElement(el);
    if (!dev || formPath.indexOf('common.') !== 0) return formPath;
    return dev + '.common.' + formPath.slice('common.'.length);
  }

  function getFormFieldValue(view, el, formPath) {
    var storagePath = appearanceCommonStoragePath(el, formPath);
    var val = getByPath(view, storagePath);
    if (storagePath !== formPath && (val === undefined || val === null)) {
      val = getByPath(view, formPath);
    }
    return val;
  }

  function getStoredPresetValue(preset, el, formPath) {
    return getByPath(preset, appearanceCommonStoragePath(el, formPath));
  }
  var livePresetJson = '';
  var liveBarClearTimer = null;
  var liveBarMode = '';
  var sitePresetsLoadPromise = null;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function apiBase() {
    return window.location.origin.replace(/\/$/, '');
  }

  function deskAuth() {
    return window.DashboardDeskAuth || null;
  }

  function authHeaders() {
    var da = deskAuth();
    if (da && da.authHeaders) {
      return da.authHeaders({ 'Content-Type': 'application/json' });
    }
    return { 'Content-Type': 'application/json' };
  }

  function authedApiUrl(path) {
    var url = apiBase() + path;
    var da = deskAuth();
    if (da && da.withAuthQuery) url = da.withAuthQuery(url);
    return url;
  }

  function saveAuthErrorMessage(data) {
    var err = data && (data.message || data.error);
    if (!err || String(err).toLowerCase() === 'unauthorized') {
      return (
        'Not signed in — open Live chat setup, enter your viewer secret, then try Make Live again.'
      );
    }
    return err;
  }

  function clearLiveBarTimer() {
    if (liveBarClearTimer) {
      clearTimeout(liveBarClearTimer);
      liveBarClearTimer = null;
    }
  }

  function presetSignature(preset) {
    try {
      return JSON.stringify(preset);
    } catch (e) {
      return '';
    }
  }

  function captureLivePreset() {
    livePresetJson = presetSignature(collectPreset());
  }

  function restoreLiveBarAfterToast() {
    setLiveBarMessage('', false);
    refreshDirtyFieldMarkers();
  }

  function valuesEqual(a, b) {
    if (a === b) return true;
    if (a == null && (b == null || b === '')) return true;
    if (b == null && (a == null || a === '')) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  function settingFieldContainer(el) {
    if (!el) return null;
    var row = el.closest('.toggle-row');
    if (row) return row;
    return el.closest('.field, .field--image');
  }

  function refreshDirtyFieldMarkers() {
    document.querySelectorAll('.settings-field--dirty').forEach(function (node) {
      node.classList.remove('settings-field--dirty');
    });
    if (!livePresetJson) return;

    var live;
    try {
      live = JSON.parse(livePresetJson);
    } catch (e) {
      return;
    }

    var current = collectPreset();
    var marked = [];

    document.querySelectorAll('[data-path]').forEach(function (el) {
      if (!shouldCollectSettingField(el)) return;
      var path = el.getAttribute('data-path');
      if (!path) return;
      var container = settingFieldContainer(el);
      if (!container || marked.indexOf(container) >= 0) return;
      marked.push(container);
      var dirty = !valuesEqual(
        getStoredPresetValue(current, el, path),
        getStoredPresetValue(live, el, path)
      );
      container.classList.toggle('settings-field--dirty', dirty);
    });
  }

  function refreshLiveBarFromForm() {
    if (liveBarMode === 'loading') return;
    refreshDirtyFieldMarkers();
  }

  function setLiveBarMessage(msg, kind) {
    var el = $('settings-live-bar-msg');
    if (!el) return;
    clearLiveBarTimer();
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.remove(
      'settings-toolbar-msg--error',
      'settings-toolbar-msg--pending',
      'settings-toolbar-msg--loading'
    );

    if (!msg) {
      liveBarMode = '';
      return;
    }

    if (kind === true || kind === 'error') {
      el.classList.add('settings-toolbar-msg--error');
      liveBarMode = 'error';
      liveBarClearTimer = setTimeout(restoreLiveBarAfterToast, 10000);
      return;
    }

    if (kind === 'pending') {
      liveBarMode = 'pending';
      return;
    }

    if (kind === 'loading') {
      el.classList.add('settings-toolbar-msg--loading');
      liveBarMode = 'loading';
      return;
    }

    liveBarMode = 'success';
    liveBarClearTimer = setTimeout(restoreLiveBarAfterToast, 10000);
  }

  function setStatus(msg, ok) {
    if (!msg || msg === 'Loaded.' || msg === 'Loading…') {
      restoreLiveBarAfterToast();
      return;
    }
    setLiveBarMessage(msg, ok === false ? 'error' : false);
  }

  function setPath(path, value) {
    var parts = path.split('.');
    var obj = {};
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

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

  function mergePath(target, path, value) {
    return deepMerge(target, setPath(path, value));
  }

  function readToggle(id, path, bag) {
    var el = $(id);
    if (!el) return bag;
    return mergePath(bag, path, !!el.checked);
  }

  function readText(id, path, bag) {
    var el = $(id);
    if (!el) return bag;
    return mergePath(bag, path, String(el.value || '').trim());
  }

  function readNumber(id, path, bag) {
    var el = $(id);
    if (!el) return bag;
    var n = parseInt(el.value, 10);
    return mergePath(bag, path, isNaN(n) ? 0 : n);
  }

  function getByPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function ensureSitePresetsLoaded() {
    if (sitePresetsLoadPromise) return sitePresetsLoadPromise;
    sitePresetsLoadPromise = fetch(
      apiBase() + '/api/site-presets/public?t=' + Date.now()
    )
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
      });
    return sitePresetsLoadPromise;
  }

  function mergeSitePresetIntoConfig(project, preset) {
    if (!project || !project.sitePreset || !preset) return;
    var cfg = window.ES_CHAT_UI_CONFIG;
    if (!cfg || !cfg.common) return;
    cfg.common.sitePresets = cfg.common.sitePresets || {};
    cfg.common.sitePresets[project.sitePreset] = deepMerge(
      cfg.common.sitePresets[project.sitePreset] || {},
      preset
    );
  }

  function presetBranch(defaults, spBranch, savedBranch) {
    return deepMerge(
      deepMerge(deepMerge({}, defaults || {}), spBranch || {}),
      savedBranch || {}
    );
  }

  function effectivePreset(project, saved) {
    var cfg = window.ES_CHAT_UI_CONFIG || {};
    var sp =
      (cfg.common &&
        cfg.common.sitePresets &&
        cfg.common.sitePresets[project.sitePreset]) ||
      {};
    saved = saved || {};
    var cfgCommon = deepMerge({}, cfg.common || {});
    delete cfgCommon.sitePresets;
    var result = {
      common: presetBranch(cfgCommon, sp.common, saved.common),
      desk: presetBranch(cfg.desk, sp.desk, saved.desk),
      mob: presetBranch(cfg.mob, sp.mob, saved.mob),
    };
    if (project && project.name) {
      if (!getByPath(result, 'common.header.title')) {
        result = mergePath(result, 'common.header.title', project.name);
      }
      if (!getByPath(result, 'common.botPersona.label')) {
        result = mergePath(result, 'common.botPersona.label', project.name);
      }
    }
    return result;
  }

  function fillForm(preset, project) {
    var view =
      project && project.sitePreset
        ? effectivePreset(project, preset)
        : preset || {};
    document.querySelectorAll('[data-path]').forEach(function (el) {
      var path = el.getAttribute('data-path');
      var val = getFormFieldValue(view, el, path);
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.tagName === 'SELECT') {
        var strVal = val != null ? String(val) : '';
        if (strVal && !Array.prototype.some.call(el.options, function (o) { return o.value === strVal; })) {
          var opt = document.createElement('option');
          opt.value = strVal;
          var isTz = /\.timeZone$/.test(path);
          opt.textContent =
            isTz && window.ESTimezoneOptions && window.ESTimezoneOptions.labelForTimeZone
              ? window.ESTimezoneOptions.labelForTimeZone(strVal)
              : el.getAttribute('data-path') === 'common.typography.fontFamily'
              ? fontLabelForValue(strVal)
              : strVal;
          el.appendChild(opt);
        }
        el.value = strVal || el.options[0].value;
      } else if (el.tagName === 'TEXTAREA') {
        el.value = val != null ? String(val) : '';
      } else if (el.type === 'number') {
        el.value = val != null && val !== '' ? String(val) : '';
      } else if (val != null && val !== '') {
        el.value = val;
      } else {
        el.value = '';
      }
    });

    document.querySelectorAll('input[data-path]').forEach(function (el) {
      if (document.querySelector('img[data-preview-for="' + el.getAttribute('data-path') + '"]')) {
        syncImagePreview(el);
      }
      if (el.getAttribute('data-color-text')) {
        syncColorSwatch(el);
      }
    });

    seedHeaderColorFromLegacyBg(view);
    seedPanelBgFromLegacySurface(view);

    var fallbackIcon = String(getByPath(view, 'common.header.chatIconUrl') || '').trim();
    ['desk', 'mob'].forEach(function (branch) {
      var iconPath = branch + '.launcher.iconUrl';
      var iconEl = document.querySelector('[data-path="' + iconPath + '"]');
      if (!iconEl) return;
      var branchIcon = String(getByPath(view, iconPath) || '').trim();
      if (!branchIcon && fallbackIcon) {
        iconEl.value = fallbackIcon;
        syncImagePreview(iconEl);
      }
    });

    initLanguagesEditorsFromPreset(view);

    document.querySelectorAll('[data-path="common.features.inputPlaceholder"]').forEach(function (el) {
      if (String(el.value || '').trim()) return;
      var panel = el.closest('.settings-device-panel');
      var dev = panel && panel.id === 'settings-device-mob' ? 'mob' : 'desk';
      var legacyPath = dev + '.common.features.inputPlaceholderByLanguage.en';
      var legacy =
        getByPath(view, legacyPath) ||
        getByPath(view, 'common.features.inputPlaceholderByLanguage.en');
      if (legacy != null && legacy !== '') {
        el.value = String(legacy);
      }
    });

    pageState.mobAppearanceCustomized = !!getByPath(view, 'mob.appearanceCustomized');
    var sectionSync = getByPath(view, 'desk.sectionSyncToMob') || {};
    if (getByPath(view, 'desk.applySameToMobile')) {
      sectionSync = { bubble: true, header: true, chatPanel: true };
    }
    pageState.sectionSyncToMob = {
      bubble: !!sectionSync.bubble,
      header: !!sectionSync.header,
      chatPanel: !!sectionSync.chatPanel,
    };
    syncSectionSyncToggleUi();
  }

  function extractHexFromHeaderBg(raw) {
    var s = String(raw || '');
    var matches = s.match(/#[0-9a-f]{3,6}/gi);
    if (!matches || !matches.length) return '';
    for (var i = 0; i < matches.length; i++) {
      var hex = parseHexColor(matches[i]);
      if (hex) return hex;
    }
    return '';
  }

  function seedPanelBgFromLegacySurface(view) {
    var bgPath = 'common.theme.--es-bg';
    var bgEl = document.querySelector('[data-path="' + bgPath + '"]');
    if (!bgEl || String(bgEl.value || '').trim()) return;
    var legacy = getByPath(view, 'common.theme.--es-surface');
    if (!legacy) return;
    document.querySelectorAll('[data-path="' + bgPath + '"]').forEach(function (el) {
      el.value = legacy;
      syncColorSwatch(el);
    });
  }

  function seedHeaderColorFromLegacyBg(view) {
    var colorPath = 'common.theme.--es-header-color';
    var colorEl = document.querySelector('[data-path="' + colorPath + '"]');
    if (!colorEl || String(colorEl.value || '').trim()) return;
    var legacy = getByPath(view, 'common.theme.--es-header-bg');
    var extracted = extractHexFromHeaderBg(legacy);
    if (!extracted) return;
    document.querySelectorAll('[data-path="' + colorPath + '"]').forEach(function (el) {
      el.value = extracted;
      syncColorSwatch(el);
    });
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

  function setFieldValue(path, value) {
    var el = document.querySelector('[data-path="' + path + '"]');
    if (!el) return;
    el.value = value;
    if (document.querySelector('img[data-preview-for="' + path + '"]')) {
      syncImagePreview(el);
    }
  }

  function applyIconFieldsFromPreset(preset) {
    if (!preset) return;
    [
      'common.header.chatIconUrl',
      'common.header.headerIconUrl',
      'desk.launcher.iconUrl',
      'mob.launcher.iconUrl',
    ].forEach(function (path) {
      var val = getByPath(preset, path);
      if (val == null || val === '') return;
      document.querySelectorAll('[data-path="' + path + '"]').forEach(function (el) {
        el.value = String(val);
        if (document.querySelector('img[data-preview-for="' + path + '"]')) {
          syncImagePreview(el);
        }
      });
    });
  }

  function syncIconFieldsInPreset(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    if (!preset.common) preset.common = {};
    if (!preset.common.header) preset.common.header = {};
    var header = preset.common.header;
    var chatIcon = String(header.chatIconUrl || '').trim();
    var headerIcon = String(header.headerIconUrl || '').trim();
    var titleIcon = String(header.chatTitleIconUrl || '').trim();

    if (headerIcon && (isLegacyStockIconUrl(chatIcon) || !chatIcon)) {
      header.chatIconUrl = headerIcon;
      chatIcon = headerIcon;
    }
    if (headerIcon && isLegacyStockIconUrl(titleIcon)) {
      header.chatTitleIconUrl = headerIcon;
    }

    var fallbackIcon = chatIcon || headerIcon;
    ['desk', 'mob'].forEach(function (branch) {
      preset[branch] = preset[branch] || {};
      preset[branch].launcher = preset[branch].launcher || {};
      var branchHeader =
        (preset[branch].common && preset[branch].common.header) || header;
      var branchIcon = String(
        (branchHeader && branchHeader.chatIconUrl) || fallbackIcon || ''
      ).trim();
      if (!String(preset[branch].launcher.iconUrl || '').trim() && branchIcon) {
        preset[branch].launcher.iconUrl = branchIcon;
      }
    });
    return preset;
  }

  function shouldCollectSettingField(el) {
    if (!el || !el.getAttribute('data-path')) return false;
    var path = el.getAttribute('data-path');
    if (path.indexOf('desk.') === 0 || path.indexOf('mob.') === 0) return true;
    if (
      path.indexOf('common.') === 0 &&
      el.closest('.settings-device-panel') &&
      !isGlobalCommonPath(path) &&
      !isAdditionalFeaturesMode
    ) {
      return true;
    }
    if (!el.closest('.settings-device-panel')) return true;
    return !el.closest('.settings-device-panel[hidden]');
  }

  function syncDuplicateSettingFields(sourceEl) {
    if (!sourceEl || !sourceEl.getAttribute('data-path')) return;
    var path = sourceEl.getAttribute('data-path');
    var devicePanel = sourceEl.closest('.settings-device-panel');
    var scope = devicePanel || document;
    scope.querySelectorAll('[data-path="' + path + '"]').forEach(function (other) {
      if (other === sourceEl) return;
      copySettingFieldValue(sourceEl, other);
    });
  }

  function collectPreset() {
    var preset = { common: {}, desk: {}, mob: {} };
    document.querySelectorAll('[data-path]').forEach(function (el) {
      if (!shouldCollectSettingField(el)) return;
      var path = el.getAttribute('data-path');
      var value;
      if (el.type === 'checkbox') {
        value = !!el.checked;
      } else if (el.type === 'number') {
        if (String(el.value || '').trim() === '') return;
        var n = parseInt(el.value, 10);
        value = isNaN(n) ? 0 : n;
      } else if (el.tagName === 'SELECT') {
        value = String(el.value || '').trim();
      } else if (el.tagName === 'TEXTAREA') {
        value = String(el.value || '').trim();
      } else {
        value = String(el.value || '').trim();
        if (el.getAttribute('data-color-text') && !value) return;
      }
      preset = mergePath(preset, appearanceCommonStoragePath(el, path), value);
    });
    var langs = collectLanguagesFromEditor(getActiveLanguagesEditor());
    if (langs.length) {
      preset = mergePath(preset, 'common.features.multiLanguage.languages', langs);
    }
    if (!isAdditionalFeaturesMode) {
      preset = mergePath(
        preset,
        'desk.sectionSyncToMob',
        deepMerge({}, pageState.sectionSyncToMob)
      );
      if (pageState.mobAppearanceCustomized) {
        preset = mergePath(preset, 'mob.appearanceCustomized', true);
      }
    }
    return syncIconFieldsInPreset(preset);
  }

  async function loadProject() {
    if (!BOT_ID) return;
    try {
      await ensureSitePresetsLoaded();
      var res = await fetch(apiBase() + '/api/bot-settings/' + BOT_ID);
      if (!res.ok) throw new Error('Could not load settings');
      var data = await res.json();
      currentProject = data.project || null;
      mergeSitePresetIntoConfig(currentProject, data.preset || {});
      fillForm(data.preset || {}, data.project || {});
      captureLivePreset();
      refreshDirtyFieldMarkers();
      wireFormChrome();
      wireSectionSyncToggles();
      initTranslationSheet();
      if (!isAdditionalFeaturesMode) {
        startPreviewFrame();
        schedulePreviewPushBurst();
      }
      if (window.DashboardNav && data.project) {
        DashboardNav.updateTopbar(
          isAdditionalFeaturesMode ? 'Additional features' : 'Appearance',
          data.project.name + ' · Bot ID ' + BOT_ID
        );
      }
      setLiveBarMessage('', false);
      refreshLiveBarFromForm();
      return data;
    } catch (err) {
      setLiveBarMessage(err.message || 'Load failed', true);
      return null;
    }
  }

  async function saveProject() {
    if (!BOT_ID) return;
    var btn = $('makeLiveBtn');
    var da = deskAuth();
    if (btn) btn.disabled = true;
    setLiveBarMessage('Making changes live…', 'loading');
    try {
      if (!da || !da.hasAuth || !da.hasAuth()) {
        throw new Error(saveAuthErrorMessage(null));
      }
      if (da.validateSecret && da.primarySecret) {
        var authCheck = await da.validateSecret(da.primarySecret());
        if (!authCheck.ok) {
          throw new Error(authCheck.message || saveAuthErrorMessage(null));
        }
      }
      var res = await fetch(authedApiUrl('/api/bot-settings/' + BOT_ID), {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeaders(),
        body: JSON.stringify({ preset: collectPreset() }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 401 || !res.ok || !data.ok) {
        throw new Error(saveAuthErrorMessage(data) || 'Save failed — check viewer secret');
      }
      currentProject = data.project || currentProject;
      mergeSitePresetIntoConfig(currentProject, data.preset || {});
      applyIconFieldsFromPreset(data.preset);
      captureLivePreset();
      refreshDirtyFieldMarkers();
      pushPreviewSoon();
      if (window.DashboardNav && currentProject) {
        DashboardNav.updateTopbar(
          isAdditionalFeaturesMode ? 'Additional features' : 'Appearance',
          currentProject.name + ' · Bot ID ' + BOT_ID
        );
      }
      setLiveBarMessage('Changes are now live.', false);
    } catch (err) {
      setLiveBarMessage(err.message || 'Make live failed', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function escapeHtmlText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var SUBHEAD_TIPS = {
    'Show on this device': 'Turn the chatbot on or off for this screen size only (desktop or phone).',
    Bubble: 'The round floating button visitors click to open the chat.',
    'Message strip': 'Short text label shown beside the bubble before chat is opened.',
    'Chat panel': 'Size and position of the open chat window on the page.',
    Header: 'Font sizes for the title bar inside the open chat panel.',
    'Message input': 'Placeholder text and colors for the “Type your message” box at the bottom.',
    'Names &amp; subtitle': 'Text shown in the chat header bar at the top of the panel.',
    'Icons &amp; images': 'Bubble icon, header logo, and bot avatar image URLs.',
    'Chat panel outer corners': 'Roundness of the outer chat window corners (CSS values like 16px).',
  };

  var SETTING_TIPS = {
    'common.header.title': 'Main name shown in the chat header. Saving also updates the bot name in your dashboard.',
    'common.header.subtitle': 'Smaller line under the title in the chat header (e.g. “We are online”).',
    'common.header.botWritingText': 'Text shown while the bot is typing (e.g. “Typing” or “Thinking”).',
    'common.header.botWritingDotsIntervalMs': 'How fast the typing dots animate, in milliseconds. Try 400–600.',
    'common.typography.fontFamily':
      'Font used across the chat widget. Google Fonts load automatically in the preview and on your site.',
    'common.header.chatIconUrl': 'Image on the floating bubble button. Upload or paste a URL.',
    'common.header.headerIconUrl': 'Logo in the top bar when chat is open.',
    'common.header.header3dGradient': 'Build a glossy 3D-style header gradient from the header color.',
    'common.header.iconShape': 'Logo shape: circular, exact square, or softly curved rounded corners.',
    'common.header.chatTitleIconUrl': 'Optional small icon next to the title. Leave empty to use the header logo.',
    'common.botPersona.imageUrl': 'Round avatar shown next to bot messages.',
    'common.header.showHeaderIcon': 'Show or hide the logo/icon in the chat header bar.',
    'common.botPersona.label': 'Name shown above bot messages (e.g. your bot or brand name).',
    'common.botPersona.avatarSizePx': 'Diameter of the bot avatar circle in pixels.',
    'common.botPersona.avatarShape': 'Bot avatar shape — circular or exact square (sharp corners) next to bot messages.',
    'common.userPersona.label': 'Label for the visitor’s messages (usually “You”).',
    'common.userPersona.avatarSizePx': 'Diameter of the user avatar circle in pixels.',
    'common.personaDisplay.nameFontSizePx': 'Font size for bot/user names above messages.',
    'common.personaDisplay.timeFontSizePx': 'Font size for timestamps under messages.',
    'common.botPersona.timeZone': 'Timezone for bot message timestamps.',
    'common.userPersona.timeZone': 'Timezone for user message timestamps.',
    'common.botPersona.showTime': 'Show a time stamp under each bot message.',
    'common.botPersona.showSeconds': 'Include seconds in bot message times.',
    'common.userPersona.showTime': 'Show a time stamp under each user message.',
    'common.userPersona.showSeconds': 'Include seconds in user message times.',
    'common.botPersona.messageTimeIncludesDate': 'Add the date to bot message timestamps.',
    'common.userPersona.messageTimeIncludesDate': 'Add the date to user message timestamps.',
    'common.features.multiLanguage.enabled': 'Show a language dropdown so visitors can switch language.',
    'common.features.speechToText.enabled':
      'Default microphone setting. Each device tab can override under Additional features.',
    'common.dialogflow.liveAgent.enabled': 'Let visitors request a human agent; connects to your Live Agent desk.',
    'common.dialogflow.forms.enabled': 'Allow in-chat forms (contact, upload, appointment, etc.).',
    'common.features.multiLanguage.defaultLanguage': 'Language used when the chat first opens.',
    'common.restartButton.gapAfterLanguagePx': 'Space between the language dropdown and the next header control.',
    'common.features.inputPlaceholder':
      'Hint text in the message box. Add Hindi/Marathi versions in the translation sheet (@i18n:inputPlaceholder).',
    'common.theme.--es-composer-bg': 'Background color of the message input row.',
    'common.theme.--es-composer-border': 'Border color around the message input row.',
    'restartButton.enabled': 'Show the ↻ restart button in the chat footer (this device only).',
    'restartButton.label': 'Text label next to the ↻ restart button (this device only).',
    'poweredBy.enabled': 'Show “Powered by …” branding at the bottom of the chat (this device only).',
    'poweredBy.prefix': 'Text before the brand name (e.g. “Powered by”).',
    'poweredBy.brandName': 'Your company or product name in the footer.',
    'poweredBy.logoUrl': 'Small logo image URL in the powered-by line.',
    'poweredBy.linkUrl': 'Link when visitors click the brand name or logo.',
    'poweredBy.color': 'Text color for the powered-by line.',
    'poweredBy.fontSizePx': 'Font size of the powered-by footer.',
    'poweredBy.logoHeightPx': 'Height of the logo image in the footer.',
    'poweredBy.align': 'Horizontal position of the powered-by line in the chat footer.',
    'poweredBy.offsetDownPx': 'Move the powered-by line down (pixels).',
    'poweredBy.offsetUpPx': 'Move the powered-by line up (pixels).',
    'poweredBy.offsetLeftPx': 'Move the powered-by line left (pixels).',
    'poweredBy.offsetRightPx': 'Move the powered-by line right (pixels).',
    'features.speechToText.enabled':
      'Microphone on this device only (overrides the shared default if off).',
    'common.theme.--es-user-text': 'Text color inside visitor (user) message bubbles.',
    'common.theme.--es-bot-text': 'Text color inside bot message bubbles.',
    'common.theme.--es-user-bg': 'Background of user messages. Can be a color or CSS gradient.',
    'common.theme.--es-bot-bg': 'Background of bot messages. Can be a color or CSS gradient.',
    'common.theme.--es-bg': 'Background color behind chat messages. Does not change the footer or input area.',
    'common.chatPanel.backgroundImageUrl':
      'Wallpaper image behind chat messages — paste a URL or upload, like WhatsApp chat background.',
    'common.chatPanel.backgroundImageFit':
      'Cover fills the panel; tile repeats the image as a pattern.',
    'common.theme.--es-muted': 'Color for timestamps and secondary text.',
    'common.theme.--es-primary': 'Accent color for links, buttons, and highlights.',
    'common.theme.--es-header-color': 'Main header color. With 3D gradient on, this builds a glossy depth effect.',
    'common.theme.--es-header-title-color': 'Color of the main title text in the chat header.',
    'common.theme.--es-header-subtitle-color': 'Color of the subtitle under the title in the chat header.',
    'common.theme.--es-user-msg-radius': 'Corner roundness of user message bubbles (e.g. 12px).',
    'common.theme.--es-bot-msg-radius': 'Corner roundness of bot message bubbles.',
    'common.chatPanel.borderRadius.topLeft': 'Top-left corner of the chat window outer frame.',
    'common.chatPanel.borderRadius.topRight': 'Top-right corner of the chat window outer frame.',
    'common.chatPanel.borderRadius.bottomLeft': 'Bottom-left corner of the chat window outer frame.',
    'common.chatPanel.borderRadius.bottomRight': 'Bottom-right corner of the chat window outer frame.',
    showChatbot: 'Show or hide the entire chatbot on this device (desktop or mobile).',
    'chatLayout.side': 'Which side of the screen the bubble and panel appear on.',
    'launcher.sizePx': 'Width and height of the floating bubble in pixels (e.g. 60–64).',
    'launcher.cornerRoundness': 'Bubble shape: 50% = circle, or a px value for rounded square.',
    'launcher.storyRing.enabled': 'Colored ring around the bubble (like social story rings).',
    'launcher.iconUrl': 'Image on the floating bubble. Paste a link or upload a file.',
    'launcher.iconZoomPercent':
      'Extra zoom to crop empty edges in the image file (100 = fill the circle automatically; try 130–180 if the PNG has white side padding).',
    'launcher.storyRing.instagramStyle': 'Use a colorful gradient on the ring (social-style).',
    'launcher.storyRing.colorRingMotionEnabled': 'Slowly spin the colored ring around the bubble.',
    'launcher.storyRing.widthPx': 'How thick the colored ring is, in pixels.',
    'launcher.storyRing.rotateSeconds': 'Seconds for one full ring rotation.',
    'launcher.closeBubbleWhenOpen.enabled': 'When chat is open, keep the bubble visible with an ✕ to close.',
    'launcher.closeBubbleWhenOpen.panelBottomPx': 'Gap between the open panel and the bubble (pixels).',
    'launcher.closeBubbleWhenOpen.panelHeightExtraPx': 'Extra panel height when the close bubble stays visible.',
    'launcherStrip.enabled': 'Show a short text label next to the bubble before chat opens.',
    'launcherStrip.wavePopup.enabled': 'Animate the 👋 hand emoji on the strip after a delay.',
    'launcherStrip.text': 'Strip message including 👋 if you want the wave hand (e.g. 👋 Welcome! How can we help?).',
    'launcherStrip.wavePopup.delayMs': 'Milliseconds after page load before the hand wave plays.',
    'launcherStrip.wavePopup.durationMs': 'How long the wave animation lasts.',
    'launcherStrip.wavePopup.scale': 'How large the hand grows during the wave (e.g. 3 = 3×).',
    'launcherStrip.position.rightPx': 'Strip distance from the right edge of the screen.',
    'launcherStrip.position.bottomPx': 'Strip distance above the bubble (pixels).',
    'launcherStrip.position.leftPx': 'Strip distance from the left edge (when panel is on the left).',
    'launcherStrip.style.fontSizePx': 'Text size inside the strip label.',
    'launcherStrip.style.paddingYpx': 'Vertical padding inside the strip.',
    'launcherStrip.style.paddingXpx': 'Horizontal padding inside the strip.',
    'launcherStrip.style.maxWidthPx': 'Maximum width of the strip before text truncates.',
    'chatWindow.widthPx': 'Width of the open chat panel in pixels.',
    'chatWindow.heightPx': 'Height of the open chat panel in pixels.',
    'chatWindow.minHeightPx': 'Smallest height the panel is allowed to shrink to.',
    'chatWindow.topInsetPx': 'Minimum space between the panel top and the browser top.',
    'chatWindow.horizontalInsetPx': 'Side margin on small screens (mobile).',
    'chatWindow.bottomInsetPx': 'Reserved bottom spacing inside layout calculations.',
    'chatWindow.position.rightPx': 'Distance of the widget from the right edge of the screen.',
    'chatWindow.position.bottomPx': 'Distance of the widget from the bottom of the screen.',
    'chatWindow.position.leftPx': 'Distance from the left edge when the panel is left-aligned.',
    'header.titleFontSizePx': 'Font size of the main title in the chat header.',
    'header.subtitleFontSizePx': 'Font size of the subtitle under the title.',
    'header.iconSizePx': 'Size of the logo/icon in the header bar.',
    'header.titlebarIconSizePx': 'Alternate control for header icon size if iconSizePx is not set.',
    'header.expandPanel.enabled':
      'Shows the expand/collapse button next to the Close (✕) button in the chat header.',
    'header.expandPanel.heightIncreasePercent':
      'How much taller the chat panel grows when expanded (30 means 30% taller than the default height).',
    'header.expandPanel.widthIncreasePercent':
      'How much wider the chat panel grows when expanded (100 means double the default width).',
    'autoOpenChat.enabled': 'Automatically open the chat panel after the visitor loads the page.',
    'autoOpenChat.delayMs': 'Wait this many milliseconds before auto-opening.',
  };

  var HIGHLIGHT_RULES = [
    {
      test: function (p) {
        return /\.launcher\.iconUrl$/.test(p) || p === 'common.header.chatIconUrl';
      },
      target: { selector: '.qa-launcher', closePanel: true },
    },
    {
      test: function (p) {
        return /chatLayout\.side$/.test(p) || /\.launcher\.(sizePx|cornerRoundness|iconZoomPercent)$/.test(p);
      },
      target: { selector: '.qa-launcher', closePanel: true },
    },
    {
      test: function (p) {
        return /\.launcher\.storyRing/.test(p);
      },
      target: { selector: '.qa-launcher-wrap', closePanel: true },
    },
    {
      test: function (p) {
        return /\.launcher\.closeBubbleWhenOpen/.test(p);
      },
      target: { selector: '.qa-launcher', openPanel: true },
    },
    {
      test: function (p) {
        return /launcherStrip/.test(p);
      },
      target: { selector: '.qa-launcher-strip', closePanel: true },
    },
    {
      test: function (p) {
        return /chatWindow/.test(p);
      },
      target: { selector: '.qa-panel', openPanel: true },
    },
    {
      test: function (p) {
        return p === 'common.header.chatIconUrl';
      },
      target: { selector: '.qa-launcher', closePanel: true },
    },
    {
      test: function (p) {
        return p === 'common.header.title';
      },
      target: { selector: '.qa-header__title', openPanel: true },
    },
    {
      test: function (p) {
        return p === 'common.header.subtitle';
      },
      target: { selector: '.qa-header__subtitle', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.header\.(headerIconUrl|showHeaderIcon|iconShape)$/.test(p);
      },
      target: { selector: '.qa-header__icon', openPanel: true },
    },
    {
      test: function (p) {
        return /\.header\.(titleFontSizePx|iconSizePx)$/.test(p);
      },
      target: { selector: '.qa-header__title', openPanel: true },
    },
    {
      test: function (p) {
        return /\.header\.subtitleFontSizePx$/.test(p);
      },
      target: { selector: '.qa-header__subtitle', openPanel: true },
    },
    {
      test: function (p) {
        return /\.header\.expandPanel/.test(p);
      },
      target: { selector: '.qa-header__expand', openPanel: true },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-header-title-color';
      },
      target: { selector: '.qa-header__title', openPanel: true },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-header-subtitle-color';
      },
      target: { selector: '.qa-header__subtitle', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.header\.botWriting/.test(p);
      },
      target: {
        selector: '.qa-msg--typing-indicator',
        openPanel: true,
        demo: 'typing',
      },
    },
    {
      test: function (p) {
        return p === 'common.botPersona.imageUrl';
      },
      target: {
        selector: '.qa-msg--bot .qa-msg__avatar',
        openPanel: true,
        demo: 'botMsg',
      },
    },
    {
      test: function (p) {
        return p === 'common.typography.fontFamily';
      },
      target: { selector: '.qa-panel', openPanel: true },
    },
    {
      test: function (p) {
        return (
          p === 'common.theme.--es-header-color' ||
          p === 'common.header.header3dGradient'
        );
      },
      target: { selector: '.qa-header', openPanel: true },
    },
    {
      test: function (p) {
        return (
          p === 'common.theme.--es-bg' ||
          /^common\.chatPanel\.backgroundImage/.test(p)
        );
      },
      target: { selector: '.qa-messages', openPanel: true, demo: 'messages' },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-primary';
      },
      target: { selector: '.qa-send', openPanel: true },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-muted';
      },
      target: {
        selector: '.qa-msg__time',
        openPanel: true,
        demo: 'messages',
      },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-user-text' || p === 'common.theme.--es-user-bg';
      },
      target: {
        selector: '.qa-msg--user .qa-msg__bubble',
        openPanel: true,
        demo: 'messages',
      },
    },
    {
      test: function (p) {
        return p === 'common.theme.--es-bot-text' || p === 'common.theme.--es-bot-bg';
      },
      target: {
        selector: '.qa-msg--bot .qa-msg__bubble',
        openPanel: true,
        demo: 'messages',
      },
    },
    {
      test: function (p) {
        return /common\.theme\.--es-(user|bot)-msg-radius/.test(p);
      },
      target: {
        selector: '.qa-msg--bot .qa-msg__bubble',
        openPanel: true,
        demo: 'messages',
      },
    },
    {
      test: function (p) {
        return /^common\.chatPanel\.borderRadius/.test(p);
      },
      target: { selector: '.qa-panel', openPanel: true },
    },
    {
      test: function (p) {
        return (
          /inputPlaceholder/.test(p) ||
          /--es-composer-/.test(p)
        );
      },
      target: { selector: '.qa-input', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.features\.multiLanguage/.test(p) || p === 'common.restartButton.gapAfterLanguagePx';
      },
      target: { selector: '.qa-lang', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.features\.speechToText/.test(p) || /\.features\.speechToText/.test(p);
      },
      target: { selector: '.qa-mic', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.(bot|user)Persona\.(label|avatarSizePx|showTime|showSeconds|messageTimeIncludesDate|timeZone)$/.test(
          p
        ) || /^common\.personaDisplay\./.test(p);
      },
      target: { selector: '.qa-msg--bot', openPanel: true, demo: 'messages' },
    },
    {
      test: function (p) {
        return /\.header\./.test(p);
      },
      target: { selector: '.qa-header', openPanel: true },
    },
    {
      test: function (p) {
        return /autoOpenChat/.test(p);
      },
      target: { selector: '.qa-panel', openPanel: true },
    },
    {
      test: function (p) {
        return /restartButton|features\.restartChat\.label/.test(p);
      },
      target: { selector: '.qa-restart', openPanel: true },
    },
    {
      test: function (p) {
        return /poweredBy/.test(p);
      },
      target: { selector: '.qa-powered', openPanel: true },
    },
    {
      test: function (p) {
        return /^common\.dialogflow\./.test(p);
      },
      target: { selector: '.qa-messages', openPanel: true, demo: 'messages' },
    },
  ];

  function resolveHighlightForPath(path) {
    if (!path) return null;
    var deviceMatch = path.match(/^(desk|mob)\./);
    if (deviceMatch && deviceMatch[1] !== pageState.activeDevice) {
      return null;
    }
    var i;
    for (i = 0; i < HIGHLIGHT_RULES.length; i++) {
      if (HIGHLIGHT_RULES[i].test(path)) {
        return HIGHLIGHT_RULES[i].target;
      }
    }
    return null;
  }

  var PREVIEW_HIGHLIGHT_KEY = 'es-bot-settings-preview-highlight';
  var highlightRequestId = 0;
  var highlightScheduleTimer = null;
  var highlightHoverEl = null;
  var highlightHoverContainer = null;

  function isPreviewHighlightEnabled() {
    try {
      var stored = localStorage.getItem(PREVIEW_HIGHLIGHT_KEY);
      if (stored === '0' || stored === 'false') return false;
      if (stored === '1' || stored === 'true') return true;
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function setPreviewHighlightEnabled(enabled) {
    try {
      localStorage.setItem(PREVIEW_HIGHLIGHT_KEY, enabled ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    syncPreviewHighlightToggleUi();
    if (!enabled) {
      if (highlightScheduleTimer) {
        clearTimeout(highlightScheduleTimer);
        highlightScheduleTimer = null;
      }
      highlightHoverEl = null;
      highlightHoverContainer = null;
      clearPreviewHighlight();
    }
  }

  function clearPreviewHighlight() {
    if (!previewFrame || !previewReady) return;
    try {
      previewFrame.contentWindow.postMessage(
        { type: 'qa-bot-preview-highlight', clear: true },
        '*'
      );
    } catch (e) {
      /* ignore */
    }
  }

  function syncPreviewHighlightToggleUi() {
    var on = isPreviewHighlightEnabled();
    var input = document.getElementById('previewHighlightSwitch');
    if (input) input.checked = on;
  }

  function resolveHighlightControl(target) {
    if (!target) return null;
    var el = target.closest('[data-path]');
    if (el) return el;
    var row = target.closest('.toggle-row');
    if (row) return row.querySelector('[data-path]');
    var field = target.closest('.field, .field--image');
    if (field) return field.querySelector('[data-path]');
    return null;
  }

  function requestSettingHighlight(el, delayMs) {
    if (!isPreviewHighlightEnabled()) return;
    if (!el || !previewFrame || !previewReady) return;
    var path = el.getAttribute('data-path');
    if (!path) return;
    var target = resolveHighlightForPath(path);
    if (!target) return;

    if (highlightScheduleTimer) clearTimeout(highlightScheduleTimer);
    highlightScheduleTimer = setTimeout(function () {
      highlightScheduleTimer = null;
      highlightRequestId += 1;
      try {
        previewFrame.contentWindow.postMessage(
          {
            type: 'qa-bot-preview-highlight',
            requestId: highlightRequestId,
            path: path,
            target: target,
          },
          '*'
        );
      } catch (e) {
        /* ignore */
      }
    }, delayMs || 0);
  }

  function getActiveDevicePanel() {
    var id =
      pageState.activeDevice === 'mob' ? 'settings-device-mob' : 'settings-device-desk';
    return document.getElementById(id);
  }

  function sectionTitleForPath(path) {
    if (!path) return null;
    if (/launcherStrip|chatLayout|\.launcher\./.test(path)) return 'Bubble';
    if (
      /header|header3dGradient|--es-header|iconShape|showHeaderIcon|headerIconUrl/.test(
        path
      )
    ) {
      return 'Header';
    }
    if (
      /chatWindow|botWriting|typography|botPersona|userPersona|personaDisplay|chatPanel|autoOpenChat|inputPlaceholder|--es-composer-|--es-bg|--es-user|--es-bot|--es-primary|--es-muted|msg-radius/.test(
        path
      )
    ) {
      return 'Chat panel';
    }
    if (/restartButton|features\.restartChat|\.features\.speechToText|poweredBy|features\.multiLanguage/.test(path)) {
      return footerSectionTitle();
    }
    return null;
  }

  function openSettingsAccordionCard(card) {
    if (!card) return;
    var head = card.querySelector('.settings-card__head');
    var scope = card.closest('.settings-device-panel') || card.parentElement;
    if (scope) {
      scope.querySelectorAll('[data-settings-accordion]').forEach(function (other) {
        other.classList.remove('is-open');
        other.classList.add('is-collapsed');
        var otherHead = other.querySelector('.settings-card__head');
        if (otherHead) otherHead.setAttribute('aria-expanded', 'false');
      });
    }
    card.classList.add('is-open');
    card.classList.remove('is-collapsed');
    if (head) head.setAttribute('aria-expanded', 'true');
  }

  function openSettingsSectionByTitle(title) {
    var panel = getActiveDevicePanel();
    if (!panel || !title) return null;
    var cards = panel.querySelectorAll('[data-settings-accordion]');
    var i;
    for (i = 0; i < cards.length; i++) {
      var titleEl = cards[i].querySelector('.settings-card__title');
      if (titleEl && titleEl.textContent.trim() === title) {
        openSettingsAccordionCard(cards[i]);
        return cards[i];
      }
    }
    return null;
  }

  function findSettingFieldForPreviewSelector(selector) {
    var rules = HIGHLIGHT_RULES.filter(function (rule) {
      return rule.target && rule.target.selector === selector;
    });
    if (!rules.length) return null;

    var scopes = [];
    var panel = getActiveDevicePanel();
    if (panel) scopes.push(panel);
    var shared = document.querySelector('.settings-section--shared');
    if (shared) scopes.push(shared);

    var ri;
    for (ri = 0; ri < rules.length; ri++) {
      var si;
      for (si = 0; si < scopes.length; si++) {
        var fields = scopes[si].querySelectorAll('[data-path]');
        var fi;
        for (fi = 0; fi < fields.length; fi++) {
          var path = fields[fi].getAttribute('data-path');
          if (path && rules[ri].test(path)) {
            return { path: path, el: fields[fi] };
          }
        }
      }
    }
    return null;
  }

  var reverseHighlightContainer = null;
  var reverseHighlightTimer = null;

  function clearReverseHighlight() {
    if (reverseHighlightContainer) {
      reverseHighlightContainer.classList.remove('settings-field--reverse-highlight');
      reverseHighlightContainer = null;
    }
    if (reverseHighlightTimer) {
      clearTimeout(reverseHighlightTimer);
      reverseHighlightTimer = null;
    }
  }

  function flashSettingField(el) {
    if (!el) return;
    clearReverseHighlight();
    var container = settingFieldContainer(el) || el;
    container.classList.add('settings-field--reverse-highlight');
    reverseHighlightContainer = container;
    reverseHighlightTimer = setTimeout(function () {
      reverseHighlightTimer = null;
      if (reverseHighlightContainer === container) {
        container.classList.remove('settings-field--reverse-highlight');
        reverseHighlightContainer = null;
      }
    }, 2200);
  }

  function applyReverseHighlightFromPreview(selector) {
    if (!selector) return;
    var hit = findSettingFieldForPreviewSelector(selector);
    if (!hit || !hit.el) return;

    var section = sectionTitleForPath(hit.path);
    if (section) {
      openSettingsSectionByTitle(section);
    }

    window.requestAnimationFrame(function () {
      hit.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashSettingField(hit.el);
      if (isPreviewHighlightEnabled()) {
        requestSettingHighlight(hit.el, 0);
      }
    });
  }

  var SETTING_TIP_DELAY_MS = 2000;
  var settingTipEl = null;
  var settingTipTimer = null;
  var settingTipAnchor = null;

  function ensureSettingTipEl() {
    if (settingTipEl) return settingTipEl;
    settingTipEl = document.createElement('div');
    settingTipEl.className = 'setting-hover-tip';
    settingTipEl.setAttribute('role', 'tooltip');
    settingTipEl.hidden = true;
    document.body.appendChild(settingTipEl);
    return settingTipEl;
  }

  function hideSettingTip() {
    if (settingTipTimer) {
      clearTimeout(settingTipTimer);
      settingTipTimer = null;
    }
    settingTipAnchor = null;
    if (settingTipEl) {
      settingTipEl.hidden = true;
      settingTipEl.textContent = '';
    }
  }

  function positionSettingTip(anchor) {
    if (!settingTipEl || !anchor || settingTipEl.hidden) return;
    var rect = anchor.getBoundingClientRect();
    var tipRect = settingTipEl.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - tipRect.width / 2;
    var top = rect.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    if (top + tipRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - tipRect.height - 8);
    }
    settingTipEl.style.left = left + 'px';
    settingTipEl.style.top = top + 'px';
  }

  function showSettingTip(anchor, text) {
    var tip = ensureSettingTipEl();
    tip.textContent = text;
    tip.hidden = false;
    requestAnimationFrame(function () {
      positionSettingTip(anchor);
    });
  }

  function wireSettingHoverTips() {
    var form = $('settingsForm');
    if (!form || form.getAttribute('data-tip-hover-bound') === '1') return;
    form.setAttribute('data-tip-hover-bound', '1');

    form.addEventListener('mouseover', function (ev) {
      var anchor = ev.target.closest('[data-setting-tip]');
      if (!anchor || !form.contains(anchor)) return;
      if (anchor === settingTipAnchor && settingTipTimer) return;
      if (anchor === settingTipAnchor && settingTipEl && !settingTipEl.hidden) return;
      hideSettingTip();
      var text = anchor.getAttribute('data-setting-tip');
      if (!text) return;
      settingTipAnchor = anchor;
      settingTipTimer = setTimeout(function () {
        settingTipTimer = null;
        if (settingTipAnchor === anchor) {
          showSettingTip(anchor, text);
        }
      }, SETTING_TIP_DELAY_MS);
    });

    form.addEventListener('mouseout', function (ev) {
      var anchor = ev.target.closest('[data-setting-tip]');
      if (!anchor) return;
      var related = ev.relatedTarget;
      if (related && anchor.contains(related)) return;
      if (settingTipAnchor === anchor) {
        hideSettingTip();
      }
    });

    form.addEventListener('scroll', hideSettingTip, true);
    window.addEventListener('resize', hideSettingTip);
  }

  function wireSettingHighlights() {
    var form = $('settingsForm');
    if (!form || form.getAttribute('data-highlight-bound') === '1') return;
    form.setAttribute('data-highlight-bound', '1');

    form.addEventListener('mouseover', function (ev) {
      var container = settingFieldContainer(ev.target);
      if (!container || container === highlightHoverContainer) return;
      var el = container.querySelector('[data-path]') || resolveHighlightControl(ev.target);
      if (!el) return;
      var path = el.getAttribute('data-path');
      if (!path || !resolveHighlightForPath(path)) return;
      highlightHoverContainer = container;
      highlightHoverEl = el;
      requestSettingHighlight(el, 80);
    });

    form.addEventListener('mouseout', function (ev) {
      var container = settingFieldContainer(ev.target);
      if (container && !container.contains(ev.relatedTarget)) {
        if (highlightHoverContainer === container) highlightHoverContainer = null;
        highlightHoverEl = null;
      }
    });
  }

  function tipFor(path) {
    if (!path) return '';
    if (SETTING_TIPS[path]) return SETTING_TIPS[path];
    var short = String(path).replace(/^(desk|mob)\./, '');
    if (SETTING_TIPS[short]) return SETTING_TIPS[short];
    return '';
  }

  function settingTipAttr(path, explicitTip) {
    var tip = explicitTip != null && explicitTip !== '' ? explicitTip : tipFor(path);
    if (!tip) return '';
    return ' data-setting-tip="' + escapeHtmlAttr(tip) + '"';
  }

  function fieldLabelHtml(label) {
    return (
      '<span class="field-label-row">' +
      '<span class="field-label-text">' +
      escapeHtmlText(label) +
      '</span>' +
      '</span>'
    );
  }

  function toggleRow(path, label) {
    return (
      '<label class="toggle-row"' +
      settingTipAttr(path) +
      '>' +
      '<input type="checkbox" data-path="' +
      path +
      '" />' +
      '<span class="toggle-row__label">' +
      escapeHtmlText(label) +
      '</span>' +
      '</label>'
    );
  }

  function toggleCell(path, label) {
    return '<div class="field-grid__toggle">' + toggleRow(path, label) + '</div>';
  }

  function textField(path, label, type, placeholder, span2, compact, mediumWide, stripMessage, wide) {
    type = type || 'text';
    var ph =
      placeholder != null
        ? ' placeholder="' + escapeHtmlAttr(placeholder) + '"'
        : '';
    var cls = 'field';
    if (span2) cls += ' field--span-2';
    if (type === 'number') cls += ' field--number';
    if (compact) cls += ' field--compact';
    if (stripMessage) cls += ' field--strip-message';
    else if (mediumWide) cls += ' field--medium-wide';
    else if (wide) cls += ' field--wide';
    else if (!span2 && type === 'text' && !compact) cls += ' field--medium';
    return (
      '<label class="' +
      cls +
      '"' +
      settingTipAttr(path) +
      '>' +
      fieldLabelHtml(label) +
      '<input type="' +
      type +
      '" data-path="' +
      path +
      '"' +
      ph +
      ' />' +
      '</label>'
    );
  }

  function escapeHtmlAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function timezoneSelectOptions() {
    if (window.ESTimezoneOptions && window.ESTimezoneOptions.asSelectOptions) {
      return window.ESTimezoneOptions.asSelectOptions();
    }
    return [{ value: 'Asia/Kolkata', label: 'India — Kolkata (IST)' }];
  }

  function selectField(path, label, options, span2, narrow, medium) {
    span2 = span2 === true;
    narrow = narrow === true;
    medium = medium === true;
    var cls = 'field';
    if (span2) cls += ' field--span-2';
    if (narrow) cls += ' field--narrow';
    if (medium) cls += ' field--medium';
    var html =
      '<label class="' +
      cls +
      '"' +
      settingTipAttr(path) +
      '>' +
      fieldLabelHtml(label) +
      '<select data-path="' +
      path +
      '">';
    options.forEach(function (opt) {
      html +=
        '<option value="' +
        escapeHtmlAttr(opt.value) +
        '">' +
        escapeHtmlAttr(opt.label) +
        '</option>';
    });
    html += '</select></label>';
    return html;
  }

  var FONT_FAMILY_OPTIONS = [
    {
      value: '"Segoe UI", system-ui, -apple-system, sans-serif',
      label: 'Segoe UI (default)',
    },
    { value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', label: 'System UI' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
    {
      value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      label: 'Helvetica Neue',
    },
    { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
    {
      value: '"Times New Roman", Times, serif',
      label: 'Times New Roman',
    },
    { value: '"Courier New", Courier, monospace', label: 'Courier New' },
    { value: '"Inter", system-ui, sans-serif', label: 'Inter' },
    { value: 'Roboto, system-ui, sans-serif', label: 'Roboto' },
    { value: '"Open Sans", system-ui, sans-serif', label: 'Open Sans' },
    { value: 'Lato, system-ui, sans-serif', label: 'Lato' },
    { value: 'Montserrat, system-ui, sans-serif', label: 'Montserrat' },
    { value: 'Poppins, system-ui, sans-serif', label: 'Poppins' },
    { value: 'Nunito, system-ui, sans-serif', label: 'Nunito' },
    { value: 'Raleway, system-ui, sans-serif', label: 'Raleway' },
    { value: '"Source Sans 3", system-ui, sans-serif', label: 'Source Sans 3' },
    { value: '"Work Sans", system-ui, sans-serif', label: 'Work Sans' },
    { value: '"DM Sans", system-ui, sans-serif', label: 'DM Sans' },
    { value: 'Outfit, system-ui, sans-serif', label: 'Outfit' },
    {
      value: '"Plus Jakarta Sans", system-ui, sans-serif',
      label: 'Plus Jakarta Sans',
    },
    { value: 'Ubuntu, system-ui, sans-serif', label: 'Ubuntu' },
    { value: '"Noto Sans", system-ui, sans-serif', label: 'Noto Sans' },
    { value: 'Merriweather, Georgia, serif', label: 'Merriweather' },
    {
      value: '"Playfair Display", Georgia, serif',
      label: 'Playfair Display',
    },
    { value: 'Oswald, system-ui, sans-serif', label: 'Oswald' },
    { value: 'Rubik, system-ui, sans-serif', label: 'Rubik' },
    { value: 'Manrope, system-ui, sans-serif', label: 'Manrope' },
    {
      value: '"IBM Plex Sans", system-ui, sans-serif',
      label: 'IBM Plex Sans',
    },
    { value: 'Figtree, system-ui, sans-serif', label: 'Figtree' },
    {
      value: '"Public Sans", system-ui, sans-serif',
      label: 'Public Sans',
    },
    { value: 'Lexend, system-ui, sans-serif', label: 'Lexend' },
    { value: '"Fira Sans", system-ui, sans-serif', label: 'Fira Sans' },
  ];

  function fontLabelForValue(value) {
    var strVal = String(value || '');
    for (var i = 0; i < FONT_FAMILY_OPTIONS.length; i++) {
      if (FONT_FAMILY_OPTIONS[i].value === strVal) {
        return FONT_FAMILY_OPTIONS[i].label;
      }
    }
    var match = strVal.match(/^"([^"]+)"/);
    if (match) return match[1];
    match = strVal.match(/^([^,]+)/);
    return match ? match[1].trim() : 'Custom font';
  }

  function fontFamilyField(path, label) {
    return selectField(path, label, FONT_FAMILY_OPTIONS, false, false, true);
  }

  function colorField(path, label, hint) {
    var gradient = hint && /gradient/i.test(hint);
    return (
      '<label class="field field--color' +
      (gradient ? ' field--color-gradient' : '') +
      '"' +
      settingTipAttr(path) +
      '>' +
      fieldLabelHtml(label) +
      '<div class="settings-color-row">' +
      '<input type="color" class="settings-color-swatch" data-color-for="' +
      path +
      '" />' +
      '<input type="text" data-path="' +
      path +
      '" data-color-text="' +
      path +
      '" />' +
      '</div></label>'
    );
  }

  function imageUrlField(path, label, hint) {
    var place = hint || 'Paste link';
    return (
      '<div class="field field--image field--image-inline"' +
      settingTipAttr(path) +
      '>' +
      '<div class="field-label-row field-label-row--block">' +
      fieldLabelHtml(label) +
      '</div>' +
      '<div class="settings-image-inline">' +
      '<input type="text" data-path="' +
      path +
      '" placeholder="' +
      escapeHtmlAttr(place) +
      '" />' +
      '<label class="btn ghost settings-upload-btn settings-upload-btn--sm">' +
      'Upload' +
      '<input type="file" accept="image/*" data-upload-for="' +
      path +
      '" hidden />' +
      '</label>' +
      '<img class="settings-image-preview settings-image-preview--sm" data-preview-for="' +
      path +
      '" alt="" hidden />' +
      '</div></div>'
    );
  }

  function parseHexColor(raw) {
    var s = String(raw || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    var m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      var h = m[1];
      return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return '';
  }

  function syncColorSwatch(textInput) {
    if (!textInput) return;
    var wrap = textInput.closest('.field--color');
    var swatch = wrap
      ? wrap.querySelector('.settings-color-swatch')
      : document.querySelector(
          '.settings-color-swatch[data-color-for="' +
            textInput.getAttribute('data-color-text') +
            '"]'
        );
    if (!swatch) return;
    var hex = parseHexColor(textInput.value);
    if (hex) swatch.value = hex;
  }

  function syncColorText(swatch) {
    if (!swatch) return;
    var wrap = swatch.closest('.field--color');
    var text = wrap
      ? wrap.querySelector('input[data-color-text]')
      : document.querySelector('input[data-color-text="' + swatch.getAttribute('data-color-for') + '"]');
    if (text && swatch.value) text.value = swatch.value;
  }

  function copySettingFieldValue(src, dest) {
    if (!src || !dest || src === dest) return;
    if (src.type === 'checkbox') {
      dest.checked = src.checked;
    } else if (src.tagName === 'SELECT') {
      dest.value = src.value;
    } else if (src.type !== 'file') {
      dest.value = src.value;
    }
    if (dest.getAttribute('data-color-text')) {
      syncColorSwatch(dest);
    }
    var path = dest.getAttribute('data-path');
    if (path && document.querySelector('img[data-preview-for="' + path + '"]')) {
      syncImagePreview(dest);
    }
  }

  function syncImagePreview(input) {
    var path = input.getAttribute('data-path');
    if (!path) return;
    var img = document.querySelector('img[data-preview-for="' + path + '"]');
    if (!img) return;
    var url = String(input.value || '').trim();
    if (!url) {
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    if (/^\/[^/]/.test(url)) {
      url = apiBase().replace(/\/$/, '') + url;
    } else if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
      url = 'https://' + url.replace(/^\/+/, '');
    }
    img.src = url;
    img.hidden = false;
    img.onerror = function () {
      img.hidden = true;
    };
  }

  function wireColorPickers() {
    document.querySelectorAll('input[data-color-text]:not([data-bound])').forEach(function (el) {
      el.setAttribute('data-bound', '1');
      syncColorSwatch(el);
      el.addEventListener('input', function () {
        syncColorSwatch(el);
      });
    });
    document.querySelectorAll('.settings-color-swatch:not([data-bound])').forEach(function (el) {
      el.setAttribute('data-bound', '1');
      el.addEventListener('input', function () {
        syncColorText(el);
        var wrap = el.closest('.field--color');
        var text = wrap && wrap.querySelector('input[data-color-text]');
        if (text) {
          syncDuplicateSettingFields(text);
        }
        pushPreviewSoon();
        refreshDirtyFieldMarkers();
      });
    });
  }

  function wireImageFields() {
    document.querySelectorAll('input[data-path]').forEach(function (el) {
      if (!document.querySelector('img[data-preview-for="' + el.getAttribute('data-path') + '"]')) {
        return;
      }
      if (el.getAttribute('data-img-bound') === '1') return;
      el.setAttribute('data-img-bound', '1');
      syncImagePreview(el);
      el.addEventListener('input', function () {
        syncImagePreview(el);
      });
    });
    document.querySelectorAll('input[data-upload-for]:not([data-bound])').forEach(function (fileInput) {
      fileInput.setAttribute('data-bound', '1');
      fileInput.addEventListener('change', function () {
        if (!fileInput.files || !fileInput.files[0]) return;
        uploadBotAsset(fileInput.files[0], fileInput.getAttribute('data-upload-for'));
        fileInput.value = '';
      });
    });
  }

  function uploadBotAsset(file, path) {
    if (!path) return;
    var target = document.querySelector('input[data-path="' + path + '"]');
    if (!target) return;
    var fd = new FormData();
    fd.append('files', file);
    var headers = authHeaders();
    delete headers['Content-Type'];
    setStatus('Uploading image…');
    fetch(authedApiUrl('/api/chat-assets/upload'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: fd,
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok || !body.assets || !body.assets[0]) {
          throw new Error(
            body.message ||
              body.error ||
              'Upload failed — check storage configuration.'
          );
        }
        var asset = body.assets[0];
        var url = asset.public_path
          ? String(asset.public_path).trim()
          : asset.url || '';
        if (!url && asset.public_path) {
          url = apiBase().replace(/\/$/, '') + asset.public_path;
        }
        if (!url) throw new Error('Upload succeeded but no public URL returned.');
        target.value = url;
        syncImagePreview(target);
        syncDuplicateSettingFields(target);
        mirrorDeskFieldToMob(target);
        if (path === 'common.header.chatIconUrl') {
          setFieldValue('common.header.chatIconUrl', url);
        } else if (path === 'common.header.headerIconUrl') {
          var bubbleEl = document.querySelector(
            'input[data-path="common.header.chatIconUrl"]'
          );
          var bubbleVal = bubbleEl ? String(bubbleEl.value || '').trim() : '';
          if (!bubbleVal || isLegacyStockIconUrl(bubbleVal)) {
            setFieldValue('common.header.chatIconUrl', url);
          }
        }
        pushPreviewSoon();
        setStatus(
          path === 'common.header.chatIconUrl' ||
            path === 'common.header.headerIconUrl'
            ? 'Icon uploaded — click Save settings for the live chatbot link.'
            : 'Image uploaded.',
          true
        );
      })
      .catch(function (err) {
        setStatus(err.message || 'Upload failed', false);
      });
  }

  function syncLanguageFieldsVisibility() {
    document.querySelectorAll('input[data-path="common.features.multiLanguage.enabled"]').forEach(function (mlToggle) {
      var on = !!mlToggle.checked;
      var panel = mlToggle.closest('.settings-device-panel');
      var scope = panel || document;
      scope.querySelectorAll('.settings-lang-fields').forEach(function (block) {
        block.hidden = !on;
      });
    });
  }

  function wireLanguageDependentFields() {
    document.querySelectorAll('input[data-path="common.features.multiLanguage.enabled"]').forEach(function (mlToggle) {
      if (mlToggle.getAttribute('data-lang-bound') === '1') return;
      mlToggle.setAttribute('data-lang-bound', '1');
      mlToggle.addEventListener('change', syncLanguageFieldsVisibility);
    });
    syncLanguageFieldsVisibility();
  }

  var DEFAULT_LANGUAGES = [
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
  ];

  function escAttr(s) {
    return escapeHtmlText(s).replace(/"/g, '&quot;');
  }

  function defaultSpeechForCode(code) {
    var c = String(code || '').trim().toLowerCase();
    if (c === 'en') return 'en-IN';
    if (c === 'hi') return 'hi-IN';
    if (c === 'mr') return 'mr-IN';
    return c ? c + '-IN' : 'en-IN';
  }

  function getActiveLanguagesEditor() {
    var panel = getActiveDevicePanel();
    if (!panel) return document.querySelector('.settings-languages-editor');
    return panel.querySelector('.settings-languages-editor');
  }

  function languageRowHtml(lang) {
    lang = lang || {};
    var code = String(lang.code || '').trim();
    var label = String(lang.label || '').trim();
    var nativeLabel = String(lang.nativeLabel || '').trim();
    var speech = String(lang.speech || defaultSpeechForCode(code)).trim();
    var dialogflow = String(lang.dialogflow || 'en').trim();
    return (
      '<div class="settings-lang-row" data-speech="' +
      escAttr(speech) +
      '" data-dialogflow="' +
      escAttr(dialogflow) +
      '">' +
      '<label class="field field--compact settings-lang-field">' +
      '<span class="field__label">Code</span>' +
      '<input type="text" data-lang-field="code" value="' +
      escAttr(code) +
      '" placeholder="en" autocapitalize="off" />' +
      '</label>' +
      '<label class="field field--compact settings-lang-field">' +
      '<span class="field__label">Label</span>' +
      '<input type="text" data-lang-field="label" value="' +
      escAttr(label) +
      '" placeholder="English" />' +
      '</label>' +
      '<label class="field field--compact settings-lang-field">' +
      '<span class="field__label">Native label</span>' +
      '<input type="text" data-lang-field="nativeLabel" value="' +
      escAttr(nativeLabel) +
      '" placeholder="English" />' +
      '</label>' +
      '<button type="button" class="settings-lang-row__remove" aria-label="Remove language" title="Remove">×</button>' +
      '</div>'
    );
  }

  function renderLanguageRows(editor, languages) {
    if (!editor) return;
    var container = editor.querySelector('.settings-lang-rows');
    if (!container) return;
    var list = languages && languages.length ? languages : DEFAULT_LANGUAGES.slice();
    container.innerHTML = list.map(languageRowHtml).join('');
  }

  function collectLanguagesFromEditor(root) {
    var list = [];
    if (!root) return list;
    root.querySelectorAll('.settings-lang-row').forEach(function (row) {
      var codeEl = row.querySelector('[data-lang-field="code"]');
      var labelEl = row.querySelector('[data-lang-field="label"]');
      var nativeEl = row.querySelector('[data-lang-field="nativeLabel"]');
      var code = String(codeEl && codeEl.value || '').trim();
      if (!code) return;
      var label = String(labelEl && labelEl.value || '').trim() || code;
      var nativeLabel = String(nativeEl && nativeEl.value || '').trim() || label;
      list.push({
        code: code,
        label: label,
        nativeLabel: nativeLabel,
        speech: row.getAttribute('data-speech') || defaultSpeechForCode(code),
        dialogflow: row.getAttribute('data-dialogflow') || 'en',
      });
    });
    return list;
  }

  function syncLanguagesEditors(sourceEditor) {
    if (!sourceEditor) return;
    var rows = collectLanguagesFromEditor(sourceEditor);
    document.querySelectorAll('.settings-languages-editor').forEach(function (editor) {
      if (editor === sourceEditor) return;
      renderLanguageRows(editor, rows);
    });
    refreshDefaultLanguageOptions();
  }

  function refreshDefaultLanguageOptions() {
    var editor = getActiveLanguagesEditor();
    var codes = [];
    if (editor) {
      editor.querySelectorAll('.settings-lang-row').forEach(function (row) {
        var codeEl = row.querySelector('[data-lang-field="code"]');
        var code = String(codeEl && codeEl.value || '').trim();
        if (code) codes.push(code);
      });
    }
    document.querySelectorAll('select[data-path="common.features.multiLanguage.defaultLanguage"]').forEach(function (sel) {
      var current = sel.value;
      sel.innerHTML = codes
        .map(function (c) {
          return (
            '<option value="' +
            escAttr(c) +
            '">' +
            escapeHtmlText(c) +
            '</option>'
          );
        })
        .join('');
      if (codes.indexOf(current) >= 0) sel.value = current;
      else if (codes.length) sel.value = codes[0];
    });
  }

  function initLanguagesEditorsFromPreset(view) {
    var langs = getByPath(view, 'common.features.multiLanguage.languages');
    if (!langs || !langs.length) langs = DEFAULT_LANGUAGES.slice();
    document.querySelectorAll('.settings-languages-editor').forEach(function (editor) {
      renderLanguageRows(editor, langs);
    });
    refreshDefaultLanguageOptions();
    syncLanguageFieldsVisibility();
  }

  function addLanguageRow(editor) {
    if (!editor) return;
    var container = editor.querySelector('.settings-lang-rows');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', languageRowHtml({}));
  }

  function wireLanguagesEditor() {
    var form = $('settingsForm');
    if (!form || form.getAttribute('data-lang-editor-bound') === '1') return;
    form.setAttribute('data-lang-editor-bound', '1');

    form.addEventListener('click', function (ev) {
      var addBtn = ev.target.closest('.settings-lang-add');
      if (addBtn) {
        ev.preventDefault();
        var editor = addBtn.closest('.settings-languages-editor');
        addLanguageRow(editor);
        syncLanguagesEditors(editor);
        pushPreviewSoon();
        refreshDirtyFieldMarkers();
        return;
      }
      var removeBtn = ev.target.closest('.settings-lang-row__remove');
      if (removeBtn) {
        ev.preventDefault();
        var row = removeBtn.closest('.settings-lang-row');
        var editor = removeBtn.closest('.settings-languages-editor');
        if (row) row.remove();
        syncLanguagesEditors(editor);
        pushPreviewSoon();
        refreshDirtyFieldMarkers();
      }
    });

    form.addEventListener('input', function (ev) {
      if (!ev.target.closest('.settings-lang-row')) return;
      var editor = ev.target.closest('.settings-languages-editor');
      syncLanguagesEditors(editor);
      pushPreviewSoon();
      refreshDirtyFieldMarkers();
    });
  }

  function wireTypingPreviewDemo() {
    var paths = [
      'common.header.botWritingText',
      'common.header.botWritingDotsIntervalMs',
    ];
    paths.forEach(function (p) {
      document.querySelectorAll('[data-path="' + p + '"]').forEach(function (el) {
        if (el.getAttribute('data-typing-bound') === '1') return;
        el.setAttribute('data-typing-bound', '1');
        el.addEventListener('input', flashTypingPreview);
        el.addEventListener('change', flashTypingPreview);
      });
    });
  }

  var typingPreviewTimer = null;
  function flashTypingPreview() {
    if (!previewFrame || !previewReady) return;
    try {
      var win = previewFrame.contentWindow;
      if (!win || !win.widgetInstance) return;
      if (typingPreviewTimer) clearTimeout(typingPreviewTimer);
      var w = win.widgetInstance;
      if (typeof w.showTyping === 'function' && w.els && w.els.messages) {
        var old = w.els.messages.querySelector('.qa-msg--typing-indicator');
        if (old) old.remove();
        var row = w.showTyping();
        typingPreviewTimer = setTimeout(function () {
          if (row && row.parentNode) row.remove();
        }, 2400);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function textareaField(path, label, rows) {
    rows = rows || 3;
    return (
      '<label class="field field--wide">' +
      label +
      '<textarea rows="' +
      rows +
      '" data-path="' +
      path +
      '"></textarea></label>'
    );
  }

  var accordionCardSeq = 0;

  function settingsCard(title, bodyHtml, startOpen, cardOpts) {
    cardOpts = cardOpts || {};
    var open = startOpen === true;
    var bodyId = 'settings-card-body-' + ++accordionCardSeq;
    var sectionKey = cardOpts.sectionKey || '';
    var syncHtml =
      sectionKey && cardOpts.devicePrefix === 'desk' && !isAdditionalFeaturesMode
        ? sectionSyncToggleHtml(sectionKey)
        : '';
    return (
      '<div class="settings-card settings-card--accordion' +
      (open ? ' is-open' : ' is-collapsed') +
      '"' +
      (sectionKey ? ' data-settings-section="' + sectionKey + '"' : '') +
      ' data-settings-accordion>' +
      '<button type="button" class="settings-card__head' +
      (syncHtml ? ' settings-card__head--with-sync' : '') +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="' +
      bodyId +
      '">' +
      '<span class="settings-card__title">' +
      escapeHtmlText(title) +
      '</span>' +
      (syncHtml
        ? '<span class="settings-card__head-tools">' + syncHtml + '</span>'
        : '') +
      '<span class="settings-card__chevron" aria-hidden="true"></span>' +
      '</button>' +
      '<div id="' +
      bodyId +
      '" class="settings-card__body">' +
      bodyHtml +
      '</div></div>'
    );
  }

  function settingsGroup(bodyHtml) {
    return '<div class="settings-group">' + bodyHtml + '</div>';
  }

  function launcherIconZoomField(pathPrefix) {
    var path = pathPrefix + '.launcher.iconZoomPercent';
    return (
      '<label class="field field--number field--compact"' +
      settingTipAttr(path) +
      '>' +
      fieldLabelHtml('Bubble icon zoom (%)') +
      '<input type="number" data-path="' +
      path +
      '" min="100" max="400" step="5" placeholder="100" />' +
      '</label>'
    );
  }

  function bubbleSectionHtml(p) {
    return settingsCard(
      'Bubble',
      settingsGroup(
        '<div class="settings-subblock settings-subblock--stacked-rows">' +
          imageUrlField(p + '.launcher.iconUrl', 'Bubble icon', 'Paste link') +
          launcherIconZoomField(p) +
          '<div class="field-grid field-grid--cols-3">' +
          selectField(
            p + '.chatLayout.side',
            'Screen side',
            [
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
            false,
            true
          ) +
          textField(p + '.launcher.sizePx', 'Size (px)', 'number') +
          textField(
            p + '.launcher.cornerRoundness',
            'Roundness (CSS)',
            'text',
            '50%',
            false,
            true
          ) +
          '</div>' +
          '<div class="toggle-grid toggle-grid--4">' +
          toggleRow(p + '.launcher.storyRing.enabled', 'Colored ring') +
          toggleRow(p + '.launcher.storyRing.instagramStyle', 'Style colors') +
          toggleRow(p + '.launcher.storyRing.colorRingMotionEnabled', 'Spin ring') +
          toggleRow(
            p + '.launcher.closeBubbleWhenOpen.enabled',
            'Keep bubble with ✕'
          ) +
          '</div>' +
          '<div class="field-grid field-grid--cols-4">' +
          textField(p + '.launcher.storyRing.rotateSeconds', 'Ring speed (s)', 'number') +
          textField(p + '.launcher.storyRing.widthPx', 'Ring width (px)', 'number') +
          textField(
            p + '.launcher.closeBubbleWhenOpen.panelBottomPx',
            'Panel gap (px)',
            'number'
          ) +
          textField(
            p + '.launcher.closeBubbleWhenOpen.panelHeightExtraPx',
            'Extra height (px)',
            'number'
          ) +
          '</div>' +
          '<div class="toggle-grid toggle-grid--2">' +
          toggleRow(p + '.launcherStrip.enabled', 'Message strip') +
          toggleRow(p + '.launcherStrip.wavePopup.enabled', 'Wave animation') +
          '</div>' +
          textField(
            p + '.launcherStrip.text',
            'Strip message',
            'text',
            '👋 Welcome!',
            false,
            false,
            false,
            true
          ) +
          '<div class="field-grid field-grid--cols-4">' +
          textField(p + '.launcherStrip.wavePopup.delayMs', 'Wave delay (ms)', 'number') +
          textField(p + '.launcherStrip.wavePopup.durationMs', 'Wave duration (ms)', 'number') +
          textField(p + '.launcherStrip.wavePopup.scale', 'Wave scale', 'number') +
          textField(p + '.launcherStrip.style.fontSizePx', 'Strip font size (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-4">' +
          textField(p + '.launcherStrip.position.rightPx', 'Right (px)', 'number') +
          textField(p + '.launcherStrip.position.bottomPx', 'Bottom (px)', 'number') +
          textField(p + '.launcherStrip.position.leftPx', 'Left (px)', 'number') +
          textField(p + '.launcherStrip.style.maxWidthPx', 'Max width (px)', 'number') +
          '</div>' +
          '<details class="settings-advanced">' +
          '<summary>More strip spacing</summary>' +
          '<div class="field-grid field-grid--cols-2">' +
          textField(p + '.launcherStrip.style.paddingYpx', 'Strip padding vertical (px)', 'number') +
          textField(p + '.launcherStrip.style.paddingXpx', 'Strip padding horizontal (px)', 'number') +
          '</div></details>' +
          '</div>'
      ),
      true,
      { sectionKey: 'bubble', devicePrefix: p }
    );
  }

  function headerSectionHtml(p) {
    return settingsCard(
      'Header',
      settingsGroup(
        '<div class="settings-subblock settings-subblock--stacked-rows">' +
          '<div class="field-grid field-grid--cols-2">' +
          colorField('common.theme.--es-header-color', 'Header color') +
          toggleCell('common.header.header3dGradient', '3D gradient') +
          '</div>' +
          imageUrlField('common.header.headerIconUrl', 'Header logo', 'Paste link') +
          '<div class="field-grid field-grid--cols-3">' +
          textField(p + '.header.iconSizePx', 'Logo size (px)', 'number') +
          selectField(
            'common.header.iconShape',
            'Logo shape',
            [
              { value: 'circle', label: 'Circle' },
              { value: 'square', label: 'Square' },
              { value: 'curved', label: 'Curved' },
            ],
            false,
            true
          ) +
          toggleCell('common.header.showHeaderIcon', 'Show logo') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.header.title', 'Title') +
          colorField('common.theme.--es-header-title-color', 'Title color') +
          textField(p + '.header.titleFontSizePx', 'Title size (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.header.subtitle', 'Subtitle') +
          colorField('common.theme.--es-header-subtitle-color', 'Subtitle color') +
          textField(p + '.header.subtitleFontSizePx', 'Subtitle size (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3 settings-expand-panel-row">' +
          toggleCell(p + '.header.expandPanel.enabled', 'Show expand/collapse button') +
          textField(
            p + '.header.expandPanel.heightIncreasePercent',
            'Height increase when expanded (%)',
            'number',
            '30'
          ) +
          textField(
            p + '.header.expandPanel.widthIncreasePercent',
            'Width increase when expanded (%)',
            'number',
            '100'
          ) +
          '</div>' +
          '</div>'
      ),
      false,
      { sectionKey: 'header', devicePrefix: p }
    );
  }

  function chatPanelSectionHtml(p) {
    return settingsCard(
      'Chat panel',
      settingsGroup(
        '<div class="settings-subblock settings-subblock--stacked-rows">' +
          '<div class="field-grid field-grid--cols-3">' +
          textField(p + '.chatWindow.widthPx', 'Width (px)', 'number') +
          textField(p + '.chatWindow.heightPx', 'Height (px)', 'number') +
          textField(p + '.chatWindow.topInsetPx', 'Top inset (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField(p + '.chatWindow.horizontalInsetPx', 'Side inset (px)', 'number') +
          textField(p + '.chatWindow.bottomInsetPx', 'Bottom inset (px)', 'number') +
          textField(p + '.chatWindow.minHeightPx', 'Min height (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField(p + '.chatWindow.position.rightPx', 'Right (px)', 'number') +
          textField(p + '.chatWindow.position.bottomPx', 'Bottom (px)', 'number') +
          textField(p + '.chatWindow.position.leftPx', 'Left (px)', 'number') +
          '</div>' +
          '<div class="toggle-grid toggle-grid--2">' +
          toggleRow(p + '.autoOpenChat.enabled', 'Auto-open chat') +
          '</div>' +
          textField(p + '.autoOpenChat.delayMs', 'Auto-open delay (ms)', 'number', null, false, false, true) +
          subhead('Message input') +
          textField(
            'common.features.inputPlaceholder',
            'Placeholder',
            'text',
            'Type your message here…',
            false,
            false,
            false,
            false,
            true
          ) +
          '<div class="field-grid field-grid--cols-2">' +
          colorField('common.theme.--es-composer-bg', 'Input row background color') +
          colorField('common.theme.--es-composer-border', 'Input row border color') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.header.botWritingText', 'Typing text', 'text', 'Typing', false, false, true) +
          textField('common.header.botWritingDotsIntervalMs', 'Typing dots interval (ms)', 'number') +
          fontFamilyField('common.typography.fontFamily', 'Font') +
          '</div>' +
          imageUrlField('common.botPersona.imageUrl', 'Bot avatar', 'Paste link') +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.botPersona.label', 'Bot name') +
          textField('common.botPersona.avatarSizePx', 'Bot avatar size (px)', 'number') +
          selectField(
            'common.botPersona.avatarShape',
            'Bot avatar shape',
            [
              { value: 'circle', label: 'Circular' },
              { value: 'square', label: 'Square' },
            ],
            false,
            true
          ) +
          '</div>' +
          '<div class="field-grid field-grid--cols-2">' +
          textField('common.userPersona.label', 'User name') +
          textField('common.userPersona.avatarSizePx', 'User avatar size (px)', 'number') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.personaDisplay.nameFontSizePx', 'Name font size (px)', 'number') +
          selectField(
            'common.botPersona.timeZone',
            'Bot timezone',
            timezoneSelectOptions(),
            false,
            false,
            true
          ) +
          selectField(
            'common.userPersona.timeZone',
            'User timezone',
            timezoneSelectOptions(),
            false,
            false,
            true
          ) +
          '</div>' +
          '<div class="toggle-grid toggle-grid--4">' +
          toggleRow('common.botPersona.showTime', 'Show bot message time') +
          toggleRow('common.botPersona.showSeconds', 'Show bot message seconds') +
          toggleRow('common.userPersona.showTime', 'Show user message time') +
          toggleRow('common.userPersona.showSeconds', 'Show user message seconds') +
          '</div>' +
          '<details class="settings-advanced">' +
          '<summary>More timestamps</summary>' +
          '<div class="field-grid field-grid--cols-3">' +
          textField('common.personaDisplay.timeFontSizePx', 'Time font size (px)', 'number') +
          toggleCell('common.botPersona.messageTimeIncludesDate', 'Show bot message date') +
          toggleCell('common.userPersona.messageTimeIncludesDate', 'Show user message date') +
          '</div></details>' +
          '<div class="field-grid field-grid--cols-3">' +
          colorField('common.theme.--es-bg', 'Chat panel background color') +
          colorField('common.theme.--es-primary', 'Accent color') +
          colorField('common.theme.--es-muted', 'Timestamp color') +
          '</div>' +
          imageUrlField('common.chatPanel.backgroundImageUrl', 'Wallpaper', 'Paste link') +
          '<div class="field-grid field-grid--cols-3">' +
          selectField(
            'common.chatPanel.backgroundImageFit',
            'Wallpaper fit',
            [
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
              { value: 'repeat', label: 'Tile' },
            ],
            false,
            true
          ) +
          colorField('common.theme.--es-user-text', 'User message text color') +
          colorField('common.theme.--es-bot-text', 'Bot message text color') +
          '</div>' +
          '<div class="field-grid field-grid--cols-3">' +
          colorField('common.theme.--es-user-bg', 'User message background color', 'Solid or gradient') +
          colorField('common.theme.--es-bot-bg', 'Bot message background color', 'Solid or gradient') +
          '</div>' +
          '<div class="field-grid field-grid--cols-4">' +
          textField('common.theme.--es-user-msg-radius', 'User message corner radius', 'text', '12px', false, true) +
          textField('common.theme.--es-bot-msg-radius', 'Bot message corner radius', 'text', '12px', false, true) +
          textField('common.chatPanel.borderRadius.topLeft', 'Top-left corner radius', 'text', null, false, true) +
          textField('common.chatPanel.borderRadius.topRight', 'Top-right corner radius', 'text', null, false, true) +
          '</div>' +
          '<div class="field-grid field-grid--cols-2">' +
          textField('common.chatPanel.borderRadius.bottomLeft', 'Bottom-left corner radius', 'text', null, false, true) +
          textField('common.chatPanel.borderRadius.bottomRight', 'Bottom-right corner radius', 'text', null, false, true) +
          '</div>' +
          '</div>'
      ),
      false,
      { sectionKey: 'chatPanel', devicePrefix: p }
    );
  }

  function featuresCell(content, span) {
    var cls = 'settings-features-cell';
    if (span && span > 1) cls += ' settings-features-cell--span-' + span;
    return '<div class="' + cls + '">' + content + '</div>';
  }

  function featuresRow(cells, cols) {
    var colsClass = cols ? ' settings-features-row--cols-' + cols : '';
    return (
      '<div class="settings-features-row' +
      colsClass +
      '">' +
      cells.join('') +
      '</div>'
    );
  }

  function footerLanguageBlockFeaturesHtml() {
    return (
      '<div class="settings-footer-lang settings-footer-lang--features">' +
      '<div class="settings-features-toggles">' +
      toggleRow('common.features.multiLanguage.enabled', 'Language selector') +
      toggleRow(
        'common.features.multiLanguage.usePhraseTranslationFile',
        'Use translation sheet'
      ) +
      '</div>' +
      '<div class="settings-lang-fields settings-subblock" hidden>' +
      subhead('Languages') +
      '<div class="settings-languages-editor">' +
      '<div class="settings-lang-rows"></div>' +
      '<button type="button" class="dash-btn dash-btn--ghost settings-lang-add">Add language</button>' +
      '</div>' +
      featuresRow(
        [
          featuresCell(
            selectField(
              'common.features.multiLanguage.defaultLanguage',
              'Default language',
              [
                { value: 'en', label: 'English' },
                { value: 'hi', label: 'Hindi' },
                { value: 'mr', label: 'Marathi' },
              ],
              false,
              false,
              true
            ),
            1
          ),
          featuresCell(
            textField('common.restartButton.gapAfterLanguagePx', 'Lang gap (px)', 'number'),
            1
          ),
        ],
        2
      ) +
      '</div>' +
      '</div>'
    );
  }

  function footerSectionBodyFeaturesHtml(p) {
    return (
      '<div class="settings-features-panel">' +
      '<div class="settings-features-card">' +
      '<h4 class="settings-features-card__title">Controls</h4>' +
      '<div class="settings-features-toggles">' +
      toggleRow(p + '.restartButton.enabled', 'Restart ↻ button') +
      toggleRow(p + '.features.speechToText.enabled', 'Microphone') +
      toggleCell(p + '.poweredBy.enabled', 'Show powered-by footer') +
      '</div>' +
      '</div>' +
      '<div class="settings-features-card">' +
      '<h4 class="settings-features-card__title">Language</h4>' +
      footerLanguageBlockFeaturesHtml() +
      '</div>' +
      '<div class="settings-features-card">' +
      '<h4 class="settings-features-card__title">Footer &amp; powered-by</h4>' +
      featuresRow(
        [
          featuresCell(
            textField(p + '.restartButton.label', 'Restart label', 'text', 'Restart'),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.prefix', 'Powered-by prefix', 'text', '⚡by'),
            1
          ),
          featuresCell(textField(p + '.poweredBy.brandName', 'Brand name', 'text'), 1),
        ],
        3
      ) +
      featuresRow(
        [
          featuresCell(
            textField(
              p + '.poweredBy.color',
              'Powered-by text color',
              'text',
              '#0369a1',
              false,
              false,
              false,
              false,
              true
            ),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.fontSizePx', 'Powered-by font size (px)', 'number'),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.logoHeightPx', 'Logo height (px)', 'number'),
            1
          ),
        ],
        3
      ) +
      featuresRow(
        [
          featuresCell(
            textField(
              p + '.poweredBy.logoUrl',
              'Powered-by logo URL',
              'text',
              null,
              false,
              false,
              false,
              false,
              true
            ),
            1
          ),
          featuresCell(
            textField(
              p + '.poweredBy.linkUrl',
              'Powered-by link URL',
              'text',
              null,
              false,
              false,
              false,
              false,
              true
            ),
            1
          ),
        ],
        2
      ) +
      featuresRow(
        [
          featuresCell(
            selectField(
              p + '.poweredBy.align',
              'Horizontal alignment',
              [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ],
              false,
              false,
              true
            ),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.offsetUpPx', 'Move up (px)', 'number', '0', false, true),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.offsetDownPx', 'Move down (px)', 'number', '0', false, true),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.offsetLeftPx', 'Move left (px)', 'number', '0', false, true),
            1
          ),
          featuresCell(
            textField(p + '.poweredBy.offsetRightPx', 'Move right (px)', 'number', '0', false, true),
            1
          ),
        ],
        5
      ) +
      '</div>' +
      '</div>'
    );
  }

  function footerSectionTitle() {
    return isAdditionalFeaturesMode ? 'Additional features' : 'Footer';
  }

  function footerLanguageBlockHtml() {
    return (
      '<div class="settings-subblock settings-footer-lang">' +
      toggleRow('common.features.multiLanguage.enabled', 'Language selector') +
      '<div class="settings-lang-fields settings-subblock" hidden>' +
      subhead('Languages') +
      '<div class="settings-languages-editor">' +
      '<div class="settings-lang-rows"></div>' +
      '<button type="button" class="dash-btn dash-btn--ghost settings-lang-add">Add language</button>' +
      '</div>' +
      toggleRow('common.features.multiLanguage.usePhraseTranslationFile', 'Use translation sheet') +
      '<div class="field-grid field-grid--cols-2">' +
      selectField('common.features.multiLanguage.defaultLanguage', 'Default language', [
        { value: 'en', label: 'English' },
        { value: 'hi', label: 'Hindi' },
        { value: 'mr', label: 'Marathi' },
      ], false, true) +
      textField('common.restartButton.gapAfterLanguagePx', 'Lang gap (px)', 'number') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function footerSectionBodyHtml(p) {
    if (isAdditionalFeaturesMode) {
      return footerSectionBodyFeaturesHtml(p);
    }
    return (
      '<div class="settings-subblock settings-subblock--stacked-rows">' +
        '<div class="toggle-grid toggle-grid--3">' +
        toggleRow(p + '.restartButton.enabled', 'Restart ↻ button') +
        toggleRow(p + '.features.speechToText.enabled', 'Microphone') +
        toggleCell(p + '.poweredBy.enabled', 'Show powered-by footer') +
        '</div>' +
        footerLanguageBlockHtml() +
        textField(p + '.restartButton.label', 'Restart label', 'text', 'Restart', false, false, true) +
        '<div class="field-grid field-grid--cols-3">' +
        textField(p + '.poweredBy.prefix', 'Powered-by prefix') +
        textField(p + '.poweredBy.brandName', 'Brand name') +
        textField(p + '.poweredBy.color', 'Powered-by text color', 'text', '#0369a1', false, true) +
        '</div>' +
        '<div class="field-grid field-grid--cols-3">' +
        textField(p + '.poweredBy.logoUrl', 'Powered-by logo URL', 'text', null, false, false, true) +
        textField(p + '.poweredBy.linkUrl', 'Powered-by link URL', 'text', null, false, false, true) +
        textField(p + '.poweredBy.fontSizePx', 'Powered-by font size (px)', 'number') +
        '</div>' +
        '<div class="field-grid field-grid--cols-2">' +
        textField(p + '.poweredBy.logoHeightPx', 'Logo height (px)', 'number') +
        selectField(
          p + '.poweredBy.align',
          'Horizontal alignment',
          [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ],
          false,
          true
        ) +
        '</div>' +
        '<div class="field-grid field-grid--cols-4">' +
        textField(p + '.poweredBy.offsetUpPx', 'Move up (px)', 'number', '0', false, true) +
        textField(p + '.poweredBy.offsetDownPx', 'Move down (px)', 'number', '0', false, true) +
        textField(p + '.poweredBy.offsetLeftPx', 'Move left (px)', 'number', '0', false, true) +
        textField(p + '.poweredBy.offsetRightPx', 'Move right (px)', 'number', '0', false, true) +
        '</div>' +
        '</div>'
    );
  }

  function footerSectionHtml(p) {
    var grouped = settingsGroup(footerSectionBodyHtml(p));
    if (isAdditionalFeaturesMode) {
      return grouped;
    }
    return settingsCard(footerSectionTitle(), grouped);
  }

  function subhead(title) {
    var tip = SUBHEAD_TIPS[title] || '';
    return (
      '<h4 class="settings-subhead"' +
      settingTipAttr('', tip) +
      '>' +
      '<span class="settings-subhead__text">' +
      title +
      '</span>' +
      '</h4>'
    );
  }

  function deviceToggleButtonsHtml() {
    return (
      '<div class="settings-device-toggle" role="tablist" aria-label="Desktop or mobile settings">' +
      '<button type="button" class="settings-device-btn is-active" data-device="desk" role="tab" aria-selected="true" id="settings-tab-desk">Desktop</button>' +
      '<button type="button" class="settings-device-btn" data-device="mob" role="tab" aria-selected="false" id="settings-tab-mob">Mobile</button>' +
      '</div>'
    );
  }

  function deviceToggleHtml() {
    return deviceToggleButtonsHtml();
  }

  function sectionSyncToggleHtml(sectionKey) {
    return (
      '<label class="settings-section-sync" data-section-sync-wrap="' +
      sectionKey +
      '">' +
      '<span class="settings-section-sync__label">Apply to mobile</span>' +
      '<span class="settings-switch settings-switch--sm">' +
      '<input type="checkbox" data-section-sync="' +
      sectionKey +
      '" aria-label="Apply this section to mobile view" />' +
      '<span class="settings-switch__slider" aria-hidden="true"></span>' +
      '</span></label>'
    );
  }

  function sectionKeyForElement(el) {
    if (!el || !el.closest) return null;
    var card = el.closest('[data-settings-section]');
    return card ? card.getAttribute('data-settings-section') : null;
  }

  function syncSectionSyncToggleUi() {
    document.querySelectorAll('[data-section-sync]').forEach(function (input) {
      var key = input.getAttribute('data-section-sync');
      if (!key || !pageState.sectionSyncToMob.hasOwnProperty(key)) return;
      input.checked = !!pageState.sectionSyncToMob[key];
      input.disabled = !!pageState.mobAppearanceCustomized;
      var wrap = input.closest('[data-section-sync-wrap]');
      if (wrap) {
        wrap.classList.toggle('settings-section-sync--disabled', input.disabled);
      }
    });
  }

  function markMobAppearanceCustomized() {
    if (isAdditionalFeaturesMode || pageState.mobAppearanceCustomized) return;
    pageState.mobAppearanceCustomized = true;
    pageState.sectionSyncToMob = {
      bubble: false,
      header: false,
      chatPanel: false,
    };
    syncSectionSyncToggleUi();
  }

  function mirrorDeskFieldToMob(sourceEl) {
    if (
      isAdditionalFeaturesMode ||
      pageState.mobAppearanceCustomized ||
      pageState.activeDevice !== 'desk'
    ) {
      return;
    }
    var sectionKey = sectionKeyForElement(sourceEl);
    if (!sectionKey || !pageState.sectionSyncToMob[sectionKey]) return;
    var mobPanel = $('settings-device-mob');
    if (!mobPanel || !sourceEl || !sourceEl.getAttribute('data-path')) return;
    var path = sourceEl.getAttribute('data-path');
    var mobPath = null;
    if (path.indexOf('desk.') === 0) {
      mobPath = 'mob.' + path.slice(5);
    } else if (path.indexOf('common.') === 0 && !isGlobalCommonPath(path)) {
      mobPath = path;
    } else {
      return;
    }
    var mobEl = mobPanel.querySelector('[data-path="' + mobPath + '"]');
    if (mobEl && mobEl !== sourceEl) {
      copySettingFieldValue(sourceEl, mobEl);
    }
  }

  function syncSectionDeskToMob(sectionKey) {
    if (pageState.mobAppearanceCustomized || !pageState.sectionSyncToMob[sectionKey]) return;
    var deskPanel = $('settings-device-desk');
    if (!deskPanel) return;
    var card = deskPanel.querySelector('[data-settings-section="' + sectionKey + '"]');
    if (!card) return;
    card.querySelectorAll('[data-path]').forEach(function (el) {
      mirrorDeskFieldToMob(el);
    });
  }

  function wireSectionSyncToggles() {
    document.querySelectorAll('[data-section-sync]').forEach(function (input) {
      if (input.getAttribute('data-sync-bound') === '1') return;
      input.setAttribute('data-sync-bound', '1');
      input.addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
      input.addEventListener('change', function (ev) {
        ev.stopPropagation();
        if (pageState.mobAppearanceCustomized) {
          input.checked = false;
          return;
        }
        var key = input.getAttribute('data-section-sync');
        if (!key || !pageState.sectionSyncToMob.hasOwnProperty(key)) return;
        pageState.sectionSyncToMob[key] = !!input.checked;
        if (pageState.sectionSyncToMob[key]) {
          syncSectionDeskToMob(key);
          pushPreviewSoon();
          refreshLiveBarFromForm();
        }
      });
    });
    document.querySelectorAll('.settings-section-sync').forEach(function (label) {
      label.addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
    });
    syncSectionSyncToggleUi();
  }

  function previewHighlightToggleHtml() {
    var on = isPreviewHighlightEnabled();
    return (
      '<label class="settings-highlight-switch">' +
      '<span class="settings-highlight-switch__label">Highlight</span>' +
      '<span class="settings-switch">' +
      '<input type="checkbox" id="previewHighlightSwitch" data-preview-highlight-switch' +
      (on ? ' checked' : '') +
      ' aria-label="Highlight preview regions" />' +
      '<span class="settings-switch__slider" aria-hidden="true"></span>' +
      '</span></label>'
    );
  }

  function wirePreviewHighlightToggle() {
    var input = document.getElementById('previewHighlightSwitch');
    if (!input || input.getAttribute('data-highlight-bound') === '1') return;
    input.setAttribute('data-highlight-bound', '1');
    input.addEventListener('change', function () {
      setPreviewHighlightEnabled(!!input.checked);
    });
  }

  function makeLiveButtonLabel(device) {
    return device === 'mob' ? '📱 Make Live' : '🖥️ Make Live';
  }

  function syncMakeLiveButtonLabel() {
    var btn = $('makeLiveBtn');
    if (!btn) return;
    btn.textContent = makeLiveButtonLabel(pageState.activeDevice);
    btn.classList.toggle('settings-make-live-btn--desk', pageState.activeDevice !== 'mob');
    btn.classList.toggle('settings-make-live-btn--mob', pageState.activeDevice === 'mob');
    btn.setAttribute(
      'aria-label',
      'Publish ' + (pageState.activeDevice === 'mob' ? 'mobile' : 'desktop') + ' settings'
    );
  }

  function setActiveDevice(device) {
    device = device === 'mob' ? 'mob' : 'desk';
    pageState.activeDevice = device;

    document.querySelectorAll('.settings-device-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-device') === device;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var deskPanel = $('settings-device-desk');
    var mobPanel = $('settings-device-mob');
    if (deskPanel) deskPanel.hidden = device !== 'desk';
    if (mobPanel) mobPanel.hidden = device !== 'mob';

    var split = document.querySelector('.settings-split');
    if (split) {
      split.classList.toggle('settings-split--mob-preview', device === 'mob');
    }
    var previewCol = document.querySelector('.settings-col-preview');
    if (previewCol) {
      previewCol.classList.toggle('settings-col-preview--mob', device === 'mob');
    }

    pushPreviewSoon();
    notifyPreviewSize();
    syncMakeLiveButtonLabel();
  }

  function wireDeviceToggle() {
    document.querySelectorAll('.settings-device-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveDevice(btn.getAttribute('data-device'));
      });
    });
    wireSectionSyncToggles();
    setActiveDevice(pageState.activeDevice);
  }

  function deviceSection(prefix, title) {
    var p = prefix;
    var panelId = prefix === 'mob' ? 'settings-device-mob' : 'settings-device-desk';
    var hiddenAttr = prefix === 'mob' ? ' hidden' : '';
    var sectionsHtml = isAdditionalFeaturesMode
      ? footerSectionHtml(p)
      : bubbleSectionHtml(p) + headerSectionHtml(p) + chatPanelSectionHtml(p);
    var panelExtraClass = isAdditionalFeaturesMode
      ? ' settings-device-panel--features settings-device-panel--' + prefix
      : '';
    return (
      '<div id="' +
      panelId +
      '" class="settings-device-panel' +
      panelExtraClass +
      '" role="tabpanel"' +
      hiddenAttr +
      '>' +
      '<section class="settings-section settings-section--device settings-section--device-' +
      prefix +
      '">' +
      '<h3 class="settings-device-heading settings-device-heading--' +
      prefix +
      '">' +
      (prefix === 'mob' ? '📱 Mobile settings' : '🖥️ Desktop settings') +
      '</h3>' +
      sectionsHtml +
      '</section></div>'
    );
  }

  function wireSettingsAccordion() {
    var form = $('settingsForm');
    if (!form || form.getAttribute('data-accordion-bound') === '1') return;
    form.setAttribute('data-accordion-bound', '1');
    form.addEventListener('click', function (ev) {
      var head = ev.target.closest('.settings-card__head');
      if (!head || !form.contains(head)) return;
      var card = head.closest('[data-settings-accordion]');
      if (!card) return;
      var wasOpen = card.classList.contains('is-open');
      if (!wasOpen) {
        openSettingsAccordionCard(card);
      } else {
        card.classList.remove('is-open');
        card.classList.add('is-collapsed');
        head.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function wireFormChrome() {
    wireColorPickers();
    wireImageFields();
    wireLanguageDependentFields();
    wireLanguagesEditor();
    wireTypingPreviewDemo();
    wireSettingsAccordion();
    wireSettingHoverTips();
  }

  function pushPreviewSoon() {
    if (previewPushTimer) clearTimeout(previewPushTimer);
    previewPushTimer = setTimeout(pushPreview, 80);
  }

  function schedulePreviewPushBurst() {
    [0, 200, 600].forEach(function (ms) {
      setTimeout(function () {
        if (!currentProject) return;
        pushPreview();
      }, ms);
    });
    setTimeout(notifyPreviewSize, 250);
  }

  function pushPreview() {
    if (!previewFrame || !currentProject) return;
    if (!previewReady) {
      previewPending = true;
      return;
    }
    previewPending = false;
    try {
      previewFrame.contentWindow.postMessage(
        {
          type: 'qa-bot-preview',
          project: currentProject,
          preset: collectPreset(),
          previewViewport: pageState.activeDevice,
        },
        '*'
      );
      notifyPreviewSize();
    } catch (e) {
      previewPending = true;
    }
  }

  function startPreviewFrame() {
    if (!previewFrame || previewStarted) return;
    previewStarted = true;
    previewReady = false;
    previewPending = true;
    lastPreviewSizeSent = 0;
    var src = '/bot-settings/preview.html?t=' + Date.now();
    if (BOT_ID) {
      src += '&botId=' + encodeURIComponent(BOT_ID);
    }
    previewFrame.src = src;
  }

  function onPreviewFrameLoad() {
    lastPreviewSizeSent = 0;
    burstPreviewSize();
    setTimeout(function () {
      if (!currentProject) return;
      previewReady = true;
      pushPreview();
      schedulePreviewPushBurst();
      burstPreviewSize();
    }, 400);
  }

  function bindPreviewListeners() {
    var form = $('settingsForm');
    if (!form) return;
    form.addEventListener('input', function (e) {
      var target = e.target;
      if (!isAdditionalFeaturesMode && deviceForElement(target) === 'mob') {
        markMobAppearanceCustomized();
      }
      syncDuplicateSettingFields(target);
      mirrorDeskFieldToMob(target);
      pushPreviewSoon();
      refreshLiveBarFromForm();
    });
    form.addEventListener('change', function (e) {
      var target = e.target;
      if (!isAdditionalFeaturesMode && deviceForElement(target) === 'mob') {
        markMobAppearanceCustomized();
      }
      syncDuplicateSettingFields(target);
      mirrorDeskFieldToMob(target);
      pushPreviewSoon();
      refreshLiveBarFromForm();
    });
  }

  function sendPreviewSize(force) {
    if (!previewFrame) return;
    var h = previewFrame.clientHeight;
    if (!h && previewFrame.getBoundingClientRect) {
      h = Math.round(previewFrame.getBoundingClientRect().height) || 0;
    }
    if (!h) h = 480;
    if (!force && Math.abs(h - lastPreviewSizeSent) < 2) return;
    lastPreviewSizeSent = h;
    try {
      if (previewFrame.contentWindow) {
        previewFrame.contentWindow.postMessage(
          { type: 'qa-bot-preview-size', height: h },
          '*'
        );
      }
    } catch (e) {
      /* ignore */
    }
  }

  function burstPreviewSize() {
    sendPreviewSize(true);
    [80, 200, 500, 1000].forEach(function (ms) {
      setTimeout(function () {
        sendPreviewSize(true);
      }, ms);
    });
  }

  function notifyPreviewSize() {
    if (!previewFrame) return;
    if (previewSizeTimer) clearTimeout(previewSizeTimer);
    previewSizeTimer = setTimeout(function () {
      previewSizeTimer = null;
      sendPreviewSize(false);
    }, 80);
  }

  function wirePreviewSizeSync() {
    if (!previewFrame || previewFrame.getAttribute('data-size-bound') === '1') {
      return;
    }
    previewFrame.setAttribute('data-size-bound', '1');
    var schedule = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(notifyPreviewSize);
      });
    };
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(schedule);
      ro.observe(previewFrame);
    }
    window.addEventListener('resize', schedule);
    schedule();
  }

  function initPreviewFrame() {
    previewFrame = $('previewFrame');
    if (!previewFrame) return;
    wirePreviewSizeSync();
    if (previewFrame.getAttribute('data-load-bound') !== '1') {
      previewFrame.setAttribute('data-load-bound', '1');
      previewFrame.addEventListener('load', onPreviewFrameLoad);
    }
    window.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'qa-bot-preview-ready') {
        previewReady = true;
        burstPreviewSize();
        if (previewPending || currentProject) {
          pushPreview();
          schedulePreviewPushBurst();
        }
        setTimeout(burstPreviewSize, 200);
        return;
      }
      if (
        ev.data &&
        ev.data.type === 'qa-bot-preview-reverse-highlight' &&
        previewFrame &&
        ev.source === previewFrame.contentWindow
      ) {
        applyReverseHighlightFromPreview(ev.data.selector);
      }
    });
  }

  function integrateDashboardNav() {
    var app = $('app');
    if (!app) return;
    if (!document.querySelector('.bot-settings-dash-content')) {
      var container = document.createElement('div');
      container.className = 'bot-settings-dash-content dash-page-content';
      while (app.firstChild) container.appendChild(app.firstChild);
      app.appendChild(container);
    }
    if (document.querySelector('.dash-shell')) return;
    if (window.DashboardNav) {
      DashboardNav.mountPage({
        active: isAdditionalFeaturesMode ? 'uiux' : 'uiux-setting',
        title: isAdditionalFeaturesMode ? 'Additional features' : 'Appearance',
        subtitle: 'Bot ID ' + BOT_ID,
      });
      if (DashboardNav.whenReady) {
        DashboardNav.whenReady(function () {
          burstPreviewSize();
          if (currentProject) schedulePreviewPushBurst();
        });
      }
    }
  }

  function initTranslationSheet() {
    if (!isAdditionalFeaturesMode || !window.ESTranslationSheet) return;
    window.ESTranslationSheet.init({
      apiBase: apiBase(),
      authedApiUrl: authedApiUrl,
      authHeaders: authHeaders,
      getLanguages: function () {
        var editor = document.querySelector('.settings-languages-editor');
        return collectLanguagesFromEditor(editor);
      },
    });
  }

  function renderProjectShell() {
    var app = $('app');
    if (!app) return;
    var splitClass = isAdditionalFeaturesMode
      ? 'wrap settings-split settings-split--features-only'
      : 'wrap settings-split';
    var previewCol = isAdditionalFeaturesMode
      ? ''
      : '<aside class="settings-col-preview" aria-label="Live preview">' +
        '<iframe id="previewFrame" title="Chatbot preview"></iframe>' +
        '</aside>';
    var featuresActionBar = isAdditionalFeaturesMode
      ? '<div class="settings-features-action-bar">' +
        '<div class="settings-features-device-bar">' +
        deviceToggleButtonsHtml() +
        '</div>' +
        '<div class="settings-features-live-zone">' +
        '<span class="settings-toolbar-msg settings-features-live-msg" id="settings-live-bar-msg" hidden></span>' +
        '<button type="button" class="btn primary settings-make-live-btn settings-make-live-btn--desk" id="makeLiveBtn">🖥️ Make Live</button>' +
        '</div></div>'
      : '';
    var settingsToolbarHtml = isAdditionalFeaturesMode
      ? ''
      : '<div class="settings-toolbar">' +
        '<div class="settings-toolbar__actions">' +
        '<div class="settings-toolbar__lead">' +
        deviceToggleHtml() +
        previewHighlightToggleHtml() +
        '</div>' +
        '<div class="settings-toolbar__live-zone">' +
        '<span class="settings-toolbar-msg" id="settings-live-bar-msg" hidden></span>' +
        '<button type="button" class="btn primary settings-make-live-btn settings-make-live-btn--desk" id="makeLiveBtn">🖥️ Make Live</button>' +
        '</div></div></div>';
    app.innerHTML =
      '<main class="' +
      splitClass +
      '">' +
      '<div class="settings-col-settings">' +
      settingsToolbarHtml +
      '<div class="settings-col-scroll">' +
      '<form class="settings-form" id="settingsForm" onsubmit="return false">' +
      (isAdditionalFeaturesMode
        ? ''
        : '<p class="settings-page-guide">Choose <strong>Desktop</strong> or <strong>Mobile</strong>, edit a setting, check the preview on the right, then click <strong>Make Live</strong> when ready. Hold <strong>Ctrl</strong> and hover a part of the chatbot preview to jump to that setting.</p>') +
      (isAdditionalFeaturesMode && window.ESTranslationSheet
        ? window.ESTranslationSheet.mountHtml()
        : '') +
      featuresActionBar +
      deviceSection('desk', 'Desktop') +
      deviceSection('mob', 'Mobile') +
      '</form></div></div>' +
      previewCol +
      '</main>';
    if (!isAdditionalFeaturesMode) {
      initPreviewFrame();
      wireSettingHighlights();
      wirePreviewHighlightToggle();
    }
    bindPreviewListeners();
    wireDeviceToggle();
    wireFormChrome();
  }

  function initHub() {
    fetch(apiBase() + '/api/bot-settings')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var root = $('projectList');
        if (!root || !data.projects) return;
        root.innerHTML = '';
        data.projects.forEach(function (p) {
          var card = document.createElement('article');
          card.className = 'project-card';
          var badgeClass = 'id-badge';
          if (p.id === '10002') badgeClass += ' gv';
          if (p.id === '10003') badgeClass += ' lv';
          card.innerHTML =
            '<span class="' +
            badgeClass +
            '">Bot ID ' +
            p.id +
            '</span>' +
            '<h2>' +
            p.name +
            '</h2>' +
            '<p style="margin-top:0.75rem"><a class="btn primary" href="' +
            p.settingsPath +
            '">Open chatbot appearance</a></p>';
          root.appendChild(card);
        });
      })
      .catch(function () {
        var root = $('projectList');
        if (root) root.textContent = 'Could not load projects.';
      });
  }

  function initProjectPage() {
    if (window.DashboardNav && DashboardNav.ensureBoot) {
      DashboardNav.ensureBoot();
    }
    var appRoot = $('app');
    if (appRoot) appRoot.setAttribute('data-dash-pre-mount', '1');
    document.body.classList.add('bot-settings-project');
    document.documentElement.classList.add('bot-settings-project');
    renderProjectShell();
    integrateDashboardNav();
    var da = deskAuth();
    var authPage = isAdditionalFeaturesMode
      ? 'super/uiux.html?bid=' + encodeURIComponent(BOT_ID)
      : 'bot-settings/' + BOT_ID + '.html';
    if (da && !da.requireAuthOrRedirect(authPage)) {
      return;
    }
    var makeLiveBtn = $('makeLiveBtn');
    if (makeLiveBtn) makeLiveBtn.addEventListener('click', saveProject);
    function startLoad() {
      loadProject();
    }
    if (da && da.validateSecret && da.primarySecret()) {
      da
        .validateSecret(da.primarySecret())
        .then(function (check) {
          if (!check.ok) {
            setLiveBarMessage(check.message || saveAuthErrorMessage(null), true);
          }
          startLoad();
        })
        .catch(startLoad);
    } else {
      startLoad();
    }
  }

  if (document.body && document.body.dataset.page === 'hub') {
    initHub();
  } else if (BOT_ID) {
    initProjectPage();
  }
})();
