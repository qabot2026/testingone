(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  if (!auth) return;

  var pageState = {
    answeredPage: 1,
    unansweredPage: 1,
    pageSize: 50,
  };

  function $(id) {
    return document.getElementById(id);
  }

  var QUERY_DISPLAY_MAX = 100;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  function formatQueryForDisplay(text) {
    var full = String(text || '');
    if (full.length <= QUERY_DISPLAY_MAX) {
      return { full: full, display: full };
    }
    return { full: full, display: full.slice(0, QUERY_DISPLAY_MAX) + '...' };
  }

  function queryCellHtml(text) {
    var q = formatQueryForDisplay(text);
    var title =
      q.full.length > QUERY_DISPLAY_MAX
        ? ' title="' + escapeAttr(q.full) + '"'
        : '';
    return (
      '<td class="qa-query-cell" data-full-query="' +
      escapeAttr(q.full) +
      '"' +
      title +
      '>' +
      escapeHtml(q.display) +
      '</td>'
    );
  }

  function bindQueryCopyHandler() {
    if (bindQueryCopyHandler._bound) return;
    bindQueryCopyHandler._bound = true;
    document.addEventListener('copy', function (e) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var node = sel.anchorNode;
      if (!node) return;
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !el.closest) return;
      var cell = el.closest('.qa-query-cell');
      if (!cell) return;
      var full = cell.getAttribute('data-full-query');
      if (!full) return;
      e.clipboardData.setData('text/plain', full);
      e.preventDefault();
    });
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return iso;
    }
  }

  function isoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDmy(d) {
    var dd = window.QADateDisplay;
    if (dd && dd.isoYmdToDdMmYyyy) return dd.isoYmdToDdMmYyyy(isoDate(d));
    var parts = isoDate(d).split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function parseInputDate(raw) {
    var dd = window.QADateDisplay;
    if (dd && dd.parseToIsoYmd) return dd.parseToIsoYmd(raw);
    return String(raw || '').trim();
  }

  function defaultCustomDates() {
    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - 29);
    return { from: formatDmy(from), to: formatDmy(to) };
  }

  function toggleCustomRange() {
    var period = $('qa-period');
    var custom = $('qa-custom-range');
    if (!period || !custom) return;
    var isCustom = period.value === 'custom';
    custom.classList.toggle('hidden', !isCustom);
    if (isCustom) {
      var fromEl = $('qa-from');
      var toEl = $('qa-to');
      var defaults = defaultCustomDates();
      if (fromEl && !fromEl.value) fromEl.value = defaults.from;
      if (toEl && !toEl.value) toEl.value = defaults.to;
    }
  }

  function getPageSize() {
    var el = $('qa-page-size');
    var n = el ? parseInt(el.value, 10) : 50;
    if ([50, 100, 200, 300].indexOf(n) < 0) n = 50;
    pageState.pageSize = n;
    return n;
  }

  function buildQueryUrl() {
    var period = $('qa-period') ? $('qa-period').value : '30';
    var base = auth.apiBase() + '/api/analytics/queries?';
    var pageQs =
      '&limit=' +
      encodeURIComponent(getPageSize()) +
      '&answeredPage=' +
      encodeURIComponent(pageState.answeredPage) +
      '&unansweredPage=' +
      encodeURIComponent(pageState.unansweredPage);
    if (period === 'custom') {
      var fromRaw = $('qa-from') ? $('qa-from').value : '';
      var toRaw = $('qa-to') ? $('qa-to').value : '';
      if (!fromRaw || !toRaw) {
        return null;
      }
      var from = parseInputDate(fromRaw);
      var to = parseInputDate(toRaw);
      if (!from || !to) {
        return { error: 'Use DD/MM/YYYY for From and To dates.' };
      }
      if (from > to) {
        return { error: 'From date must be on or before To date.' };
      }
      return (
        base +
        'from=' +
        encodeURIComponent(from) +
        '&to=' +
        encodeURIComponent(to) +
        pageQs
      );
    }
    return base + 'days=' + encodeURIComponent(period) + pageQs;
  }

  function syncPager(prefix, meta, rowLabel) {
    var pager = $(prefix + '-pager');
    var hint = $(prefix + '-hint');
    var pageEl = $(prefix + '-page');
    var first = $(prefix + '-first');
    var prev = $(prefix + '-prev');
    var next = $(prefix + '-next');
    var last = $(prefix + '-last');
    if (!pager || !meta) {
      if (pager) pager.hidden = true;
      return;
    }
    if (!meta.total) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    if (pageEl) pageEl.textContent = String(meta.page || 1);
    if (last) last.textContent = String(meta.totalPages || 1);
    if (first) first.disabled = !meta.hasPrev;
    if (prev) prev.disabled = !meta.hasPrev;
    if (next) next.disabled = !meta.hasNext;
    if (last) last.disabled = !meta.hasNext;
    if (hint) {
      hint.textContent =
        meta.total +
        ' ' +
        rowLabel +
        ', ' +
        meta.limit +
        ' per page';
    }
  }

  function wirePager(prefix, onPageChange) {
    function go(page) {
      onPageChange(page);
      load();
    }
    var first = $(prefix + '-first');
    var prev = $(prefix + '-prev');
    var next = $(prefix + '-next');
    var last = $(prefix + '-last');
    if (first) {
      first.addEventListener('click', function () {
        if (first.disabled) return;
        go(1);
      });
    }
    if (prev) {
      prev.addEventListener('click', function () {
        if (prev.disabled) return;
        go(Math.max(1, pageState[prefix === 'qa-answered' ? 'answeredPage' : 'unansweredPage'] - 1));
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        if (next.disabled) return;
        go(pageState[prefix === 'qa-answered' ? 'answeredPage' : 'unansweredPage'] + 1);
      });
    }
    if (last) {
      last.addEventListener('click', function () {
        if (last.disabled) return;
        var key = prefix === 'qa-answered' ? 'lastAnsweredPages' : 'lastUnansweredPages';
        go(pageState[key] || 1);
      });
    }
  }

  function formatPeriodLabel(period) {
    if (!period) return '';
    var dd = window.QADateDisplay;
    var fromRaw = period.from ? String(period.from).slice(0, 10) : '';
    var toRaw = period.to ? String(period.to).slice(0, 10) : '';
    if (!fromRaw || !toRaw) return '';
    if (dd && dd.formatDateDisplay) {
      return dd.formatDateDisplay(fromRaw) + ' → ' + dd.formatDateDisplay(toRaw);
    }
    return fromRaw + ' → ' + toRaw;
  }

  function renderQueryRows(list, emptyLabel) {
    if (!list.length) {
      return (
        '<tr><td colspan="4" class="qa-loading">' +
        escapeHtml(emptyLabel) +
        '</td></tr>'
      );
    }
    return list
      .map(function (q) {
        return (
          '<tr>' +
          queryCellHtml(q.query) +
          '<td class="num qa-times-cell"><strong>' +
          (q.times || 0) +
          '</strong></td>' +
          '<td class="num qa-sessions-cell">' +
          (q.sessions || 0) +
          '</td>' +
          '<td class="num qa-date-cell">' +
          escapeHtml(formatWhen(q.lastAt)) +
          '</td></tr>'
        );
      })
      .join('');
  }

  function renderTables(data) {
    var answered = (data && data.answeredQueries) || [];
    var unanswered = (data && data.unansweredQueries) || [];

    var answeredBody = $('qa-answered-body');
    var unansweredBody = $('qa-unanswered-body');
    if (answeredBody) {
      answeredBody.innerHTML = renderQueryRows(
        answered,
        'No answered queries in this period.'
      );
    }
    if (unansweredBody) {
      unansweredBody.innerHTML = renderQueryRows(
        unanswered,
        'No unanswered queries in this period.'
      );
    }
    var answeredMeta = data && data.answeredPagination;
    var unansweredMeta = data && data.unansweredPagination;
    if (answeredMeta) {
      pageState.answeredPage = answeredMeta.page || 1;
      pageState.lastAnsweredPages = answeredMeta.totalPages || 1;
    }
    if (unansweredMeta) {
      pageState.unansweredPage = unansweredMeta.page || 1;
      pageState.lastUnansweredPages = unansweredMeta.totalPages || 1;
    }
    syncPager('qa-answered', answeredMeta, 'answered queries');
    syncPager('qa-unanswered', unansweredMeta, 'unanswered queries');
  }

  function render(data) {
    var s = data.summary || {};
    $('qa-total').textContent = s.totalQueries != null ? s.totalQueries : '—';
    $('qa-bot').textContent = s.botAnswered != null ? s.botAnswered : '—';
    $('qa-fallback').textContent = s.fallback != null ? s.fallback : '—';
    $('qa-handoff').textContent = s.handoff != null ? s.handoff : '—';
    $('qa-unique').textContent = s.uniqueQueries != null ? s.uniqueQueries : '—';
    $('qa-period-label').textContent = formatPeriodLabel(data.period);
    renderTables(data);
  }

  function showUnlock(message) {
    var panel = $('qa-unlock');
    var msg = $('qa-unlock-msg');
    if (panel) panel.classList.remove('hidden');
    if (msg) {
      msg.textContent = message || '';
      msg.classList.toggle('ok', !message);
    }
    var saved = auth.viewerSecret();
    if (saved && $('qa-secret') && !$('qa-secret').value) {
      $('qa-secret').value = saved;
    }
  }

  function hideUnlock() {
    var panel = $('qa-unlock');
    var msg = $('qa-unlock-msg');
    if (panel) panel.classList.add('hidden');
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('ok');
    }
  }

  function load() {
    if (!auth.hasAuth()) {
      showUnlock('Enter your viewer secret to load query analytics.');
      return;
    }

    var answeredBody = $('qa-answered-body');
    var unansweredBody = $('qa-unanswered-body');
    if (answeredBody) {
      answeredBody.innerHTML = '<tr><td colspan="4" class="qa-loading">Loading…</td></tr>';
    }
    if (unansweredBody) {
      unansweredBody.innerHTML = '<tr><td colspan="4" class="qa-loading">Loading…</td></tr>';
    }

    var built = buildQueryUrl();
    if (built && built.error) {
      $('qa-period-label').textContent = built.error;
      return;
    }
    if (!built) {
      toggleCustomRange();
      $('qa-period-label').textContent = 'Choose From and To dates, then Apply.';
      return;
    }
    var url = auth.withAuthQuery(built);

    fetch(url, { headers: auth.authHeaders() })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (res.status === 401 || !res.data.ok) {
          var detail =
            (res.data && (res.data.message || res.data.error)) ||
            'Secret not accepted.';
          showUnlock(detail + ' Check CONVERSATIONS_SHEET_VIEW_SECRET on Railway.');
          return;
        }
        hideUnlock();
        render(res.data);
      })
      .catch(function () {
        showUnlock('Network error — try again.');
      });
  }

  function unlockAndLoad() {
    var input = $('qa-secret');
    var msg = $('qa-unlock-msg');
    var btn = $('qa-unlock-btn');
    var secret = input ? input.value.trim() : '';
    if (!secret) {
      if (msg) msg.textContent = 'Enter viewer secret.';
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Checking secret…';
    auth.validateSecret(secret).then(function (result) {
      if (btn) btn.disabled = false;
      if (!result.ok) {
        if (msg) msg.textContent = result.message || 'Secret not accepted.';
        return;
      }
      if (msg) {
        msg.textContent = 'Unlocked.';
        msg.classList.add('ok');
      }
      load();
    });
  }

  $('qa-refresh').addEventListener('click', function () {
    load();
  });
  $('qa-period').addEventListener('change', function () {
    toggleCustomRange();
    pageState.answeredPage = 1;
    pageState.unansweredPage = 1;
    if ($('qa-period').value !== 'custom') {
      load();
    }
  });
  if ($('qa-page-size')) {
    $('qa-page-size').addEventListener('change', function () {
      pageState.answeredPage = 1;
      pageState.unansweredPage = 1;
      load();
    });
  }
  if ($('qa-apply-range')) {
    $('qa-apply-range').addEventListener('click', function () {
      pageState.answeredPage = 1;
      pageState.unansweredPage = 1;
      load();
    });
  }
  wirePager('qa-answered', function (page) {
    pageState.answeredPage = page;
  });
  wirePager('qa-unanswered', function (page) {
    pageState.unansweredPage = page;
  });
  toggleCustomRange();
  bindQueryCopyHandler();
  if ($('qa-unlock-btn')) {
    $('qa-unlock-btn').addEventListener('click', unlockAndLoad);
  }
  if ($('qa-secret')) {
    $('qa-secret').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') unlockAndLoad();
    });
  }
  load();
})();
