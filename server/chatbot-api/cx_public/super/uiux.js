(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('super/uiux.html')) return;

  function start() {
    var bid = nav.getBid();
    window.BOT_ID = bid;
    var chain = document.createElement('script');
    chain.src = '/shared/timezone-options.js?v=20260621b';
    chain.onload = function () {
      var ts = document.createElement('script');
      ts.src = '/super/translation-sheet.js?v=20260621a';
      ts.onload = function () {
        var script = document.createElement('script');
        script.src = '/bot-settings/bot-settings.js';
        document.body.appendChild(script);
      };
      document.body.appendChild(ts);
    };
    document.body.appendChild(chain);
  }

  if (nav && nav.whenReady) {
    nav.whenReady(start);
  } else {
    start();
  }
})();
