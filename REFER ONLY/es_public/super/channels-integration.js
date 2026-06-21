(function () {
  'use strict';

  var nav = window.DashboardNav;
  var web = window.ChannelsIntegrationWeb;
  var social = window.ChannelsIntegrationSocial;

  var SOCIAL_TABS = ['whatsapp', 'instagram', 'facebook'];
  var activeTab = 'web';

  function readTabFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var tab = String(params.get('tab') || '').trim().toLowerCase();
    if (tab === 'web' || SOCIAL_TABS.indexOf(tab) >= 0) return tab;
    var hash = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (hash === 'web' || SOCIAL_TABS.indexOf(hash) >= 0) return hash;
    return 'web';
  }

  function writeTabToUrl(tab) {
    var url = new URL(window.location.href);
    if (tab === 'web') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }
    url.hash = '';
    var next = url.pathname + url.search;
    window.history.replaceState(null, '', next);
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-channel-tab]').forEach(function (btn) {
      var on = btn.getAttribute('data-channel-tab') === tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-channel-panel]').forEach(function (panel) {
      var on = panel.getAttribute('data-channel-panel') === tab;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    writeTabToUrl(tab);
    if (SOCIAL_TABS.indexOf(tab) >= 0 && social && typeof social.loadChannel === 'function') {
      social.loadChannel(tab);
    }
  }

  function wireTabs() {
    document.querySelectorAll('[data-channel-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTab(btn.getAttribute('data-channel-tab') || 'web');
      });
    });
  }

  function init() {
    var bid = nav.getBid();
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid;
      }) || nav.BOTS[0];

    nav.mount({
      active: 'channels-integration',
      title: 'Channels Integration',
      subtitle: bot.name + ' (Bot ID ' + bot.id + ')',
      bid: bid,
    });

    wireTabs();

    var webReady = web && typeof web.init === 'function' ? web.init() : Promise.resolve();
    var socialReady =
      social && typeof social.init === 'function'
        ? social.init().catch(function (err) {
            SOCIAL_TABS.forEach(function (channelId) {
              var el = document.getElementById('channelsSocialIntro-' + channelId);
              if (el) el.textContent = err.message || 'Could not load channel settings.';
            });
          })
        : Promise.resolve();

    Promise.all([webReady, socialReady]).then(function () {
      setTab(readTabFromUrl());
    });
  }

  nav.whenReady(init);
})();
