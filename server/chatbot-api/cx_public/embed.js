(function () {
  'use strict';

  var ES_ASSET_VERSION = '20260621_fresh';

  var ES_FORM_SCRIPTS = [
    'contact.js',
    'feedback.js',
    'otp.js',
    'upload.js',
    'appointment.js',
    'birthform.js',
    'nearest-branch.js',
  ];

  var script = document.currentScript;
  var base = '';
  if (script && script.src) {
    base = script.src.replace(/\/embed\.js(\?.*)?$/i, '');
  }
  if (!base && window.ES_CONFIG && window.ES_CONFIG.apiBase) {
    base = window.ES_CONFIG.apiBase;
  }
  if (!base && window.ES_CHAT_UI_CONFIG && window.ES_CHAT_UI_CONFIG.common) {
    base = window.ES_CHAT_UI_CONFIG.common.deploy.publicBaseUrl;
  }

  function assetUrl(path) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=' + ES_ASSET_VERSION;
  }

  function loadCss(href) {
    var url = assetUrl(href);
    var existing = document.querySelector('link[data-es-widget-css]');
    if (existing) {
      if (existing.getAttribute('href') === url) return;
      existing.remove();
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-es-widget-css', 'true');
    document.head.appendChild(link);
  }

  function loadJs(src, cb) {
    if (document.querySelector('script[src="' + src + '"]')) {
      if (cb) cb();
      return;
    }
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = cb || null;
    document.head.appendChild(s);
  }

  function loadFormScripts(index, cb) {
    if (index >= ES_FORM_SCRIPTS.length) {
      if (cb) cb();
      return;
    }
    loadJs(assetUrl(base + '/forms/' + ES_FORM_SCRIPTS[index]), function () {
      loadFormScripts(index + 1, cb);
    });
  }

  function deepMerge_(base, over) {
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
        out[k] = deepMerge_(b[k], o[k]);
      } else {
        out[k] = o[k];
      }
    });
    return out;
  }

  function loadSitePresetOverrides_(cb) {
    var url =
      assetUrl(base + '/api/site-presets/public') + '&t=' + Date.now();
    fetch(url)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (
          data &&
          data.sitePresets &&
          window.ES_CHAT_UI_CONFIG &&
          window.ES_CHAT_UI_CONFIG.common
        ) {
          var current = window.ES_CHAT_UI_CONFIG.common.sitePresets || {};
          window.ES_CHAT_UI_CONFIG.common.sitePresets = deepMerge_(
            current,
            data.sitePresets
          );
        }
      })
      .catch(function () {})
      .finally(cb);
  }

  function boot() {
    if (window.__qaWidgetLoaded) return;
    loadJs(assetUrl(base + '/bot-configs/bootstrap.js'), function () {
      if (!window.QABotConfigsReady) {
        return loadJs(assetUrl(base + '/company.config.js'), afterCompanyConfig);
      }
      window.QABotConfigsReady(function () {
        loadJs(assetUrl(base + '/company.config.js'), afterCompanyConfig);
      });
    });
  }

  function afterCompanyConfig() {
      loadSitePresetOverrides_(function () {
      loadFormScripts(0, function () {
        loadCss(base + '/widget/chat-widget.css?v=20260619b');
        loadJs(assetUrl(base + '/widget/date-display.js'), function () {
          loadJs(assetUrl(base + '/widget/message-syntax.js?v=20260616f'), function () {
            loadJs(assetUrl(base + '/widget/chat-form.js'), function () {
              loadJs(assetUrl(base + '/widget/chat-widget.js?v=20260619b'), function () {
                loadJs(assetUrl(base + '/widget/live-agent-client.js'), function () {
                  loadJs(assetUrl(base + '/widget/transcript-client.js'), function () {
                    if (window.ESChatWidget) {
                      window.__qaWidgetLoaded = true;
                      new window.ESChatWidget({
                        apiBase:
                          (window.ES_CONFIG && window.ES_CONFIG.apiBase) || base,
                        esTestMode: !!(window.ES_CONFIG && window.ES_CONFIG.esTestMode),
                      });
                    }
                  });
                });
              });
            });
          });
        });
      });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
