(function (global) {
  'use strict';

  var loaded = false;
  var loading = false;
  var queue = [];

  function runQueue() {
    loaded = true;
    loading = false;
    var pending = queue.slice();
    queue.length = 0;
    pending.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.warn('[bot-configs] ready callback failed', e);
      }
    });
  }

  function loadScript(src, cb) {
    if (global.document.querySelector('script[data-qa-bot-config="' + src + '"]')) {
      if (cb) cb();
      return;
    }
    var s = global.document.createElement('script');
    s.src = src;
    s.async = false;
    s.setAttribute('data-qa-bot-config', src);
    s.onload = function () {
      if (cb) cb();
    };
    s.onerror = function () {
      console.warn('[bot-configs] failed to load', src);
      if (cb) cb();
    };
    global.document.head.appendChild(s);
  }

  function loadAll(files, index, cb) {
    if (index >= files.length) return cb();
    loadScript(files[index], function () {
      loadAll(files, index + 1, cb);
    });
  }

  function manifestUrl() {
    var base = '';
    if (global.ES_CONFIG && global.ES_CONFIG.apiBase) {
      base = String(global.ES_CONFIG.apiBase).replace(/\/$/, '');
    } else if (global.location && global.location.origin) {
      base = global.location.origin;
    }
    return base + '/bot-configs/manifest.json?t=' + Date.now();
  }

  global.QABotConfigsReady = function (cb) {
    if (typeof cb !== 'function') return;
    if (loaded) {
      cb();
      return;
    }
    queue.push(cb);
    if (loading) return;
    loading = true;

    fetch(manifestUrl())
      .then(function (res) {
        return res.ok ? res.json() : { configs: [] };
      })
      .catch(function () {
        return { configs: [] };
      })
      .then(function (data) {
        var names = (data && data.configs) || [];
        var urls = names.map(function (name) {
          return '/bot-configs/' + name;
        });
        loadAll(urls, 0, runQueue);
      });
  };
})(typeof window !== 'undefined' ? window : this);
