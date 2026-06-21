(function (global) {
  'use strict';

  function loadScript(src, cb) {
    var s = global.document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () {
      if (cb) cb();
    };
    s.onerror = function () {
      console.warn('[load-chain] failed', src);
      if (cb) cb();
    };
    global.document.head.appendChild(s);
  }

  function loadChain(urls, index, cb) {
    if (index >= urls.length) {
      if (cb) cb();
      return;
    }
    loadScript(urls[index], function () {
      loadChain(urls, index + 1, cb);
    });
  }

  global.ESLoadScriptChain = function (urls, cb) {
    if (!global.QABotConfigsReady) {
      loadChain(urls, 0, cb);
      return;
    }
    global.QABotConfigsReady(function () {
      loadChain(urls, 0, cb);
    });
  };
})(typeof window !== 'undefined' ? window : this);
