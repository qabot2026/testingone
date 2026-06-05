(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  if (!auth || !auth.requireAuthOrRedirect('dashboard/index.html')) {
    return;
  }

  function render(data) {
    var cards = document.getElementById('dash-cards');
    cards.innerHTML =
      card(data.totalSessions, 'Total chats') +
      card(data.sessionsToday, 'Today') +
      card(data.totalTurns, 'Messages') +
      card(data.liveWaiting, 'Waiting agent') +
      card(data.liveActive, 'Live now') +
      card(data.sheetsConfigured ? 'On' : 'Off', 'Google Sheet');

    var list = document.getElementById('dash-recent-list');
    var recent = data.recentSessions || [];
    if (!recent.length) {
      list.innerHTML = '<p class="dash-loading" style="padding:16px">No sessions yet</p>';
      return;
    }
    list.innerHTML = recent
      .map(function (s) {
        var sid = s.sessionId || '';
        var href =
          '../conversation-transcript?session=' + encodeURIComponent(sid);
        return (
          '<div class="dash-row"><span>' +
          (s.preview || sid.slice(0, 12)) +
          '…</span><a href="' +
          href +
          '">Chat script</a></div>'
        );
      })
      .join('');
  }

  function card(val, label) {
    return (
      '<div class="dash-card"><div class="dash-card__value">' +
      val +
      '</div><div class="dash-card__label">' +
      label +
      '</div></div>'
    );
  }

  function load() {
    fetch(auth.apiBase() + '/api/analytics/summary', { headers: auth.authHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          alert('Could not load analytics. Check desk token.');
          return;
        }
        render(data);
      })
      .catch(function () {
        alert('Network error');
      });
  }

  document.getElementById('dash-refresh').addEventListener('click', load);
  load();
})();
