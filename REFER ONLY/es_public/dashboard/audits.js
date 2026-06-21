(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('dashboard/audits.html')) return;

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

  function setStatus(msg) {
    var el = $('audits-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function clearLoader() {
    var root = document.documentElement;
    root.classList.remove('dash-mount-pending');
    root.classList.add('dash-ready');
  }

  function buildUrl() {
    var params = new URLSearchParams();
    params.set('days', ($('audits-days') && $('audits-days').value) || '30');
    var bot = $('audits-bot') ? $('audits-bot').value.trim() : '';
    var page = $('audits-page') ? $('audits-page').value.trim() : '';
    if (bot) params.set('botId', bot);
    if (page) params.set('page', page);
    return auth.apiBase() + '/api/audits?' + params.toString();
  }

  function renderEvents(events) {
    var body = $('audits-body');
    if (!body) return;
    if (!events.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="admin-empty">No audit entries yet.</td></tr>';
      return;
    }
    body.innerHTML = events
      .map(function (e) {
        return (
          '<tr>' +
          '<td><code class="audit-change-id">' +
          esc(e.changeId || '—') +
          '</code></td>' +
          '<td>' +
          esc(formatWhen(e.at)) +
          '</td>' +
          '<td>' +
          esc(e.actor || '—') +
          '</td>' +
          '<td>' +
          esc(e.page || '—') +
          '</td>' +
          '<td><strong>' +
          esc(e.label || e.action || '—') +
          '</strong></td>' +
          '<td>' +
          (e.botId ? '<code>' + esc(e.botId) + '</code>' : '—') +
          '</td>' +
          '<td>' +
          esc(e.summary || '—') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function load() {
    setStatus('Loading…');
    fetch(buildUrl(), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          if (text) {
            try {
              body = JSON.parse(text);
            } catch (e) {
              body = { ok: false, error: 'Invalid server response' };
            }
          }
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) {
          renderEvents([]);
          setStatus(
            'Session expired — open Live chat setup, re-enter your viewer secret, then refresh.'
          );
          return;
        }
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not load audits');
        }
        renderEvents(result.body.events || []);
        setStatus(
          'Showing ' +
            (result.body.events || []).length +
            ' of ' +
            (result.body.total || 0) +
            ' entries.'
        );
      })
      .catch(function (err) {
        renderEvents([]);
        setStatus(err.message || 'Load failed');
      });
  }

  function wireEvents() {
    if ($('audits-bot') && !$('audits-bot').value) {
      $('audits-bot').placeholder = 'All bots';
    }
    if ($('audits-refresh')) $('audits-refresh').addEventListener('click', load);
    if ($('audits-days')) $('audits-days').addEventListener('change', load);
    if ($('audits-page')) {
      $('audits-page').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') load();
      });
    }
    if ($('audits-clear-filters')) {
      $('audits-clear-filters').addEventListener('click', function () {
        if ($('audits-bot')) $('audits-bot').value = '';
        if ($('audits-page')) $('audits-page').value = '';
        load();
      });
    }
  }

  function boot() {
    if (!nav || typeof nav.mountPage !== 'function') {
      clearLoader();
      setStatus('Dashboard navigation failed to load. Hard-refresh the page.');
      return;
    }

    nav
      .mountPage({
        active: 'audits',
        title: 'Audits',
        subtitle: 'Change history · all bots',
      })
      .then(function () {
        wireEvents();
        load();
      })
      .catch(function (err) {
        clearLoader();
        setStatus((err && err.message) || 'Could not open audits page');
      });
  }

  boot();
})();
