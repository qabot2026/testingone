(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;
  if (!auth) return;

  var pageState = {
    answeredPage: 1,
    unansweredPage: 1,
    pageSize: 50,
    activeView: 'answered',
    faqs: [],
    lastAnalytics: null,
    faqToastTimer: null,
  };

  function normalizeFaqText(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s?]/g, '');
  }

  function faqTokens(text) {
    return normalizeFaqText(text)
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 1;
      });
  }

  function faqScoreMatch(userText, faq) {
    var userNorm = normalizeFaqText(userText);
    var qNorm = normalizeFaqText(faq && faq.question);
    if (!userNorm || !qNorm) return 0;
    if (userNorm === qNorm) return 100;
    if (userNorm.length >= 8 && (userNorm.indexOf(qNorm) >= 0 || qNorm.indexOf(userNorm) >= 0)) {
      return 90;
    }
    var userTokens = faqTokens(userText);
    var qTokens = faqTokens(faq.question);
    if (!userTokens.length || !qTokens.length) return 0;
    var overlap = 0;
    qTokens.forEach(function (t) {
      if (userTokens.indexOf(t) >= 0) overlap += 1;
    });
    var ratio = overlap / Math.max(qTokens.length, 1);
    if (ratio >= 0.75) return 70 + Math.round(ratio * 20);
    if (ratio >= 0.5) return 50 + Math.round(ratio * 20);
    return 0;
  }

  function queryHasFaq(query) {
    var items = pageState.faqs || [];
    for (var i = 0; i < items.length; i++) {
      if (faqScoreMatch(query, items[i]) >= 90) return true;
    }
    return false;
  }

  function loadFaqs() {
    return fetch(auth.apiBase() + '/api/faqs/' + encodeURIComponent(botId()), {
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
          pageState.faqs = [];
          return;
        }
        pageState.faqs = result.body.items || [];
      })
      .catch(function () {
        pageState.faqs = [];
      });
  }

  function refreshUnansweredTable() {
    if (!pageState.lastAnalytics) return;
    var unansweredBody = $('qa-unanswered-body');
    if (!unansweredBody) return;
    unansweredBody.innerHTML = renderUnansweredRows(
      pageState.lastAnalytics.unansweredQueries || [],
      'No unanswered queries in this period.'
    );
  }

  function showToast(message, ms) {
    var el = $('qa-toast');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = false;
    if (pageState.faqToastTimer) {
      window.clearTimeout(pageState.faqToastTimer);
    }
    pageState.faqToastTimer = window.setTimeout(function () {
      el.hidden = true;
      pageState.faqToastTimer = null;
    }, ms || 2000);
  }

  function botId() {
    return nav && typeof nav.getBid === 'function' ? nav.getBid() : '10001';
  }

  function faqPageUrl() {
    if (nav && typeof nav.navHref === 'function') {
      return nav.navHref('faqs', botId());
    }
    return '/dashboard/faqs.html?bid=' + encodeURIComponent(botId());
  }

  function setFaqStatus(msg, isError) {
    var el = $('qa-faq-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className = 'qa-faq-status' + (isError ? ' qa-faq-status--error' : ' qa-faq-status--ok');
  }

  function hideFaqPanel() {
    var panel = $('qa-faq-panel');
    if (panel) panel.hidden = true;
    var q = $('qa-faq-question');
    var a = $('qa-faq-answer');
    if (q) q.value = '';
    if (a) a.value = '';
    setFaqStatus('');
  }

  function showFaqPanel(question) {
    var panel = $('qa-faq-panel');
    var q = $('qa-faq-question');
    var a = $('qa-faq-answer');
    if (!panel || !q || !a) return;
    q.value = String(question || '');
    a.value = '';
    setFaqStatus('');
    panel.hidden = false;
    a.focus();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setActiveView(view) {
    view = view === 'unanswered' ? 'unanswered' : 'answered';
    pageState.activeView = view;

    document.querySelectorAll('.qa-view-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-qa-view') === view;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var answeredView = $('qa-view-answered');
    var unansweredView = $('qa-view-unanswered');
    var hintUnanswered = $('qa-hint-unanswered');
    var queriesPanel = document.querySelector('.qa-queries-panel');
    if (answeredView) answeredView.hidden = view !== 'answered';
    if (unansweredView) unansweredView.hidden = view !== 'unanswered';
    if (hintUnanswered) hintUnanswered.hidden = view !== 'unanswered';
    if (queriesPanel) {
      queriesPanel.classList.toggle('qa-queries-panel--answered', view === 'answered');
      queriesPanel.classList.toggle('qa-queries-panel--unanswered', view === 'unanswered');
    }
    if (view === 'answered') hideFaqPanel();
  }

  function wireViewTabs() {
    document.querySelectorAll('.qa-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveView(btn.getAttribute('data-qa-view'));
      });
    });
  }

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

  function queryCellHtml(text, suffixHtml) {
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
      (suffixHtml || '') +
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

  function todayIso() {
    return isoDate(new Date());
  }

  function syncCustomDateLimits() {
    var today = todayIso();
    var fromEl = $('qa-from');
    var toEl = $('qa-to');
    if (fromEl) {
      fromEl.max = today;
      if (fromEl.value && fromEl.value > today) fromEl.value = today;
    }
    if (toEl) {
      toEl.max = today;
      if (toEl.value && toEl.value > today) toEl.value = today;
    }
    if (fromEl && toEl && fromEl.value && toEl.value && fromEl.value > toEl.value) {
      toEl.value = fromEl.value;
    }
    if (fromEl && toEl && fromEl.value) toEl.min = fromEl.value;
    if (fromEl && toEl && toEl.value) fromEl.max = toEl.value < today ? toEl.value : today;
  }

  function defaultCustomDates() {
    var to = new Date();
    var from = new Date();
    from.setDate(from.getDate() - 29);
    return { from: isoDate(from), to: isoDate(to) };
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
      syncCustomDateLimits();
    }
  }

  function onCustomDateChange() {
    if (!$('qa-period') || $('qa-period').value !== 'custom') return;
    syncCustomDateLimits();
    var from = $('qa-from') ? parseInputDate($('qa-from').value) : '';
    var to = $('qa-to') ? parseInputDate($('qa-to').value) : '';
    if (!from || !to) return;
    pageState.answeredPage = 1;
    pageState.unansweredPage = 1;
    load();
  }

  function getPageSize() {
    var el = $('qa-page-size');
    var n = el ? parseInt(el.value, 10) : 50;
    if ([50, 100, 200, 300].indexOf(n) < 0) n = 50;
    pageState.pageSize = n;
    return n;
  }

  function parseInputDate(raw) {
    var dd = window.QADateDisplay;
    if (dd && dd.parseToIsoYmd) return dd.parseToIsoYmd(raw);
    return String(raw || '').trim();
  }

  function buildQueryUrl() {
    var period = $('qa-period') ? $('qa-period').value : '30';
    var base =
      auth.apiBase() +
      '/api/analytics/queries?botId=' +
      encodeURIComponent(botId());
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
        return { error: 'Choose valid From and To dates.' };
      }
      if (from > to) {
        return { error: 'From date must be on or before To date.' };
      }
      var today = todayIso();
      if (from > today || to > today) {
        return { error: 'Dates cannot be in the future.' };
      }
      return (
        base +
        '&from=' +
        encodeURIComponent(from) +
        '&to=' +
        encodeURIComponent(to) +
        pageQs
      );
    }
    return base + '&days=' + encodeURIComponent(period) + pageQs;
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

  function renderAnsweredRows(list, emptyLabel) {
    if (!list.length) {
      return (
        '<tr><td colspan="4" class="qa-loading">' +
        escapeHtml(emptyLabel) +
        '</td></tr>'
      );
    }
    return list
      .map(function (q) {
        var popular = q.isMostPopular === true;
        var rowClass = popular ? ' class="qa-row--most-popular"' : '';
        var badge = popular
          ? ' <span class="qa-most-popular-badge">Most popular</span>'
          : '';
        return (
          '<tr' +
          rowClass +
          '>' +
          queryCellHtml(q.query, badge) +
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

  function renderUnansweredRows(list, emptyLabel) {
    if (!list.length) {
      return (
        '<tr><td colspan="5" class="qa-loading">' +
        escapeHtml(emptyLabel) +
        '</td></tr>'
      );
    }
    return list
      .map(function (q) {
        var fullQuery = String(q.query || '');
        var actionCell = queryHasFaq(fullQuery)
          ? '<span class="dash-muted">—</span>'
          : '<button type="button" class="dash-btn dash-btn--ghost qa-add-faq-btn" data-faq-query="' +
            escapeAttr(fullQuery) +
            '">Add to FAQs</button>';
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
          '</td>' +
          '<td class="qa-action-cell">' +
          actionCell +
          '</td></tr>'
        );
      })
      .join('');
  }

  function wireUnansweredActions() {
    var body = $('qa-unanswered-body');
    if (!body || body.getAttribute('data-faq-bound') === '1') return;
    body.setAttribute('data-faq-bound', '1');
    body.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.qa-add-faq-btn') : null;
      if (!btn) return;
      ev.preventDefault();
      var query = btn.getAttribute('data-faq-query') || '';
      setActiveView('unanswered');
      showFaqPanel(query);
    });
  }

  function saveFaqFromPanel(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var questionEl = $('qa-faq-question');
    var answerEl = $('qa-faq-answer');
    var saveBtn = $('qa-faq-save-btn');
    var question = questionEl ? questionEl.value.trim() : '';
    var answer = answerEl ? answerEl.value.trim() : '';
    if (!question || !answer) {
      setFaqStatus('Question and answer are required.', true);
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    setFaqStatus('Saving FAQ…', false);
    fetch(auth.apiBase() + '/api/faqs/' + encodeURIComponent(botId()), {
      method: 'POST',
      credentials: 'same-origin',
      headers: auth.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        question: question,
        answer: answer,
        published: true,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not save FAQ');
        }
        hideFaqPanel();
        if (result.body.item) {
          pageState.faqs = (pageState.faqs || []).filter(function (item) {
            return item.id !== result.body.item.id;
          });
          pageState.faqs.push(result.body.item);
        } else {
          return loadFaqs();
        }
      })
      .then(function () {
        refreshUnansweredTable();
        showToast('FAQ added.', 2000);
      })
      .catch(function (err) {
        setFaqStatus((err && err.message) || 'Could not save FAQ', true);
      })
      .finally(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
  }

  function setSummaryCard(id, value) {
    var el = $(id);
    if (el) el.textContent = value != null ? value : '—';
  }

  function showTableMessage(msg) {
    var answeredBody = $('qa-answered-body');
    var unansweredBody = $('qa-unanswered-body');
    var safe = escapeHtml(msg || 'Could not load queries.');
    if (answeredBody) {
      answeredBody.innerHTML = '<tr><td colspan="4" class="qa-loading">' + safe + '</td></tr>';
    }
    if (unansweredBody) {
      unansweredBody.innerHTML = '<tr><td colspan="5" class="qa-loading">' + safe + '</td></tr>';
    }
  }
  function renderTables(data) {
    var answered = (data && data.answeredQueries) || [];
    var unanswered = (data && data.unansweredQueries) || [];

    var answeredBody = $('qa-answered-body');
    var unansweredBody = $('qa-unanswered-body');
    if (answeredBody) {
      answeredBody.innerHTML = renderAnsweredRows(
        answered,
        'No answered queries in this period.'
      );
    }
    if (unansweredBody) {
      unansweredBody.innerHTML = renderUnansweredRows(
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
    pageState.lastAnalytics = data;
    var s = data.summary || {};
    setSummaryCard('qa-total', s.totalQueries != null ? s.totalQueries : '—');
    setSummaryCard('qa-bot', s.botAnswered != null ? s.botAnswered : '—');
    setSummaryCard('qa-fallback', s.fallback != null ? s.fallback : '—');
    setSummaryCard('qa-handoff', s.handoff != null ? s.handoff : '—');
    setSummaryCard('qa-unique', s.uniqueQueries != null ? s.uniqueQueries : '—');
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
    if (!$('qa-answered-body') || !$('qa-unanswered-body')) {
      return;
    }

    if (!auth.hasAuth()) {
      showUnlock('Enter your viewer secret to load query analytics.');
      showTableMessage('Unlock with your viewer secret to load queries.');
      return;
    }

    showTableMessage('Loading…');

    var built = buildQueryUrl();
    if (built && built.error) {
      showTableMessage(built.error);
      return;
    }
    if (!built) {
      toggleCustomRange();
      showTableMessage('Choose From and To dates.');
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
          showTableMessage('Could not load queries. Enter your viewer secret above.');
          return;
        }
        hideUnlock();
        return loadFaqs().then(function () {
          render(res.data);
        });
      })
      .catch(function () {
        showUnlock('Network error — try again.');
        showTableMessage('Network error — try again.');
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

  function wirePage() {
    if (wirePage._bound) return;
    wirePage._bound = true;

    if ($('qa-refresh')) {
      $('qa-refresh').addEventListener('click', function () {
        load();
      });
    }
    if ($('qa-period')) {
      $('qa-period').addEventListener('change', function () {
        toggleCustomRange();
        pageState.answeredPage = 1;
        pageState.unansweredPage = 1;
        load();
      });
    }
    if ($('qa-from')) {
      $('qa-from').addEventListener('change', onCustomDateChange);
    }
    if ($('qa-to')) {
      $('qa-to').addEventListener('change', onCustomDateChange);
    }
    if ($('qa-page-size')) {
      $('qa-page-size').addEventListener('change', function () {
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
    syncCustomDateLimits();
    bindQueryCopyHandler();
    wireViewTabs();
    wireUnansweredActions();
    setActiveView('answered');
    if ($('qa-faq-form')) {
      $('qa-faq-form').addEventListener('submit', saveFaqFromPanel);
    }
    if ($('qa-faq-cancel-btn')) {
      $('qa-faq-cancel-btn').addEventListener('click', hideFaqPanel);
    }
    if ($('qa-unlock-btn')) {
      $('qa-unlock-btn').addEventListener('click', unlockAndLoad);
    }
    if ($('qa-secret')) {
      $('qa-secret').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') unlockAndLoad();
      });
    }
    load();
  }

  function init() {
    if (!nav || typeof nav.mountPage !== 'function') return;
    var bid = nav.getBid ? nav.getBid() : '10001';
    var bot =
      (nav.BOTS || []).find(function (b) {
        return b.id === bid;
      }) || (nav.BOTS && nav.BOTS[0]);
    var subtitle = bot
      ? bot.name + ' (Bot ID ' + bot.id + ')'
      : 'Answered and unanswered queries for the selected bot';

    nav
      .mountPage({
        active: 'queryanalytics',
        title: 'Customer Questions',
        subtitle: subtitle,
      })
      .then(function () {
        wirePage();
      });
  }

  if (nav && typeof nav.whenReady === 'function') {
    nav.whenReady(init);
  }
})();
