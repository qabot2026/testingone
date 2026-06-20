(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('dashboard/actions.html')) return;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch (e) {
      return iso;
    }
  }

  function prettyJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value || '');
    }
  }

  function setStatus(msg) {
    var el = $('actions-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function buildUrl() {
    var params = new URLSearchParams();
    params.set('days', $('actions-days').value || '7');
    var bot = $('actions-bot').value.trim();
    var path = $('actions-path').value.trim();
    if (bot) params.set('botId', bot);
    if (path) params.set('path', path);
    return auth.apiBase() + '/api/actions?' + params.toString();
  }

  function renderSummary(summary) {
    var el = $('actions-summary');
    if (!el) return;
    if (!summary || !summary.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = summary
      .slice(0, 8)
      .map(function (row) {
        return (
          '<div class="admin-summary-card"><strong>' +
          esc(row.count) +
          '</strong><span>' +
          esc(row.method + ' ' + row.path) +
          '</span></div>'
        );
      })
      .join('');
  }

  function renderEvents(events) {
    var body = $('actions-body');
    if (!body) return;
    if (!events.length) {
      body.innerHTML =
        '<tr><td colspan="8" class="admin-empty">No API actions logged yet.</td></tr>';
      return;
    }
    body.innerHTML = events
      .map(function (e, index) {
        return (
          '<tr data-action-row="' +
          index +
          '">' +
          '<td>' +
          esc(formatWhen(e.at)) +
          '</td>' +
          '<td><code>' +
          esc(e.method) +
          '</code></td>' +
          '<td><code>' +
          esc(e.path) +
          '</code></td>' +
          '<td>' +
          esc(e.status) +
          '</td>' +
          '<td>' +
          esc(e.durationMs) +
          ' ms</td>' +
          '<td>' +
          (e.botId ? '<code>' + esc(e.botId) + '</code>' : '—') +
          '</td>' +
          '<td>' +
          esc(e.actor) +
          '</td>' +
          '<td><button type="button" class="dash-btn dash-btn--ghost actions-toggle-btn">Details</button></td>' +
          '</tr>' +
          '<tr class="actions-detail-row" hidden data-action-detail="' +
          index +
          '"><td colspan="8">' +
          '<p><strong>Request</strong></p><pre class="admin-json">' +
          esc(prettyJson(e.request)) +
          '</pre>' +
          '<p style="margin-top:0.65rem"><strong>Response</strong></p><pre class="admin-json">' +
          esc(prettyJson(e.response)) +
          '</pre></td></tr>'
        );
      })
      .join('');

    body.querySelectorAll('.actions-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('[data-action-row]');
        var index = row.getAttribute('data-action-row');
        var detail = body.querySelector('[data-action-detail="' + index + '"]');
        if (!detail) return;
        var open = detail.hidden === false;
        detail.hidden = open;
        row.classList.toggle('is-open', !open);
        btn.textContent = open ? 'Details' : 'Hide';
      });
    });
  }

  function load() {
    setStatus('Loading…');
    fetch(buildUrl(), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not load actions');
        }
        renderSummary(result.body.summary || []);
        renderEvents(result.body.events || []);
        setStatus('Showing ' + (result.body.events || []).length + ' of ' + (result.body.total || 0) + ' events.');
      })
      .catch(function (err) {
        renderSummary([]);
        renderEvents([]);
        setStatus(err.message || 'Load failed');
      });
  }

  function init() {
    var bid = nav.getBid();
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid;
      }) || nav.BOTS[0];

    nav.mount({
      active: 'actions',
      title: 'Actions',
      subtitle: 'API request log · ' + bot.name,
    });

    if ($('actions-bot') && !$('actions-bot').value) {
      $('actions-bot').placeholder = bid;
    }

    $('actions-refresh').addEventListener('click', load);
    $('actions-days').addEventListener('change', load);
    load();
  }

  nav.whenReady(init);
})();
