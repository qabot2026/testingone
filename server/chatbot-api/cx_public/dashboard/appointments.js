(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  if (!auth) return;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function parseInputDate(raw) {
    var dd = window.QADateDisplay;
    if (dd && dd.parseToIsoYmd) return dd.parseToIsoYmd(raw);
    return String(raw || '').trim();
  }

  function getApptDateYmd(el) {
    if (!el) return '';
    var stored = String(el.dataset.ymd || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    var parsed = parseInputDate(el.value);
    if (parsed) {
      el.dataset.ymd = parsed;
      return parsed;
    }
    var raw = String(el.value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      el.dataset.ymd = raw;
      return raw;
    }
    return '';
  }

  function setApptDateYmd(el, ymd) {
    if (!el) return;
    var dd = window.QADateDisplay;
    var iso = String(ymd || '').trim();
    var wrap = el.closest('.appt-date-field');
    var native = wrap && wrap.querySelector('.appt-date-native');
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      el.dataset.ymd = iso;
      el.value =
        dd && dd.isoYmdToDdMmYyyy ? dd.isoYmdToDdMmYyyy(iso) : formatDmy(iso);
      if (native) native.value = iso;
    } else {
      el.dataset.ymd = '';
      el.value = '';
      if (native) native.value = '';
    }
  }

  function normalizeApptDateInput(el) {
    if (!el) return;
    var raw = String(el.value || '').trim();
    if (!raw) {
      setApptDateYmd(el, '');
      return;
    }
    var ymd = parseInputDate(raw);
    if (!ymd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ymd = raw;
    if (ymd) setApptDateYmd(el, ymd);
  }

  function bindApptDatePicker(textEl) {
    if (!textEl || textEl._apptDatePickerBound) return;
    textEl._apptDatePickerBound = true;
    var wrap = textEl.closest('.appt-date-field');
    if (!wrap) return;
    var native = wrap.querySelector('.appt-date-native');
    var icon = wrap.querySelector('.appt-date-cal-ic');
    if (!native) return;

    function openPicker() {
      var ymd = getApptDateYmd(textEl);
      native.value = ymd || '';
      if (typeof native.showPicker === 'function') native.showPicker();
      else native.click();
    }

    if (icon) {
      icon.setAttribute('role', 'button');
      icon.setAttribute('tabindex', '0');
      icon.setAttribute('aria-label', 'Open calendar');
      icon.addEventListener('click', openPicker);
      icon.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openPicker();
        }
      });
    }

    textEl.addEventListener('blur', function () {
      normalizeApptDateInput(textEl);
    });
    textEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        normalizeApptDateInput(textEl);
        load();
      }
    });

    native.addEventListener('change', function () {
      setApptDateYmd(textEl, native.value || '');
      load();
    });
  }

  function formatDmy(raw) {
    var dd = window.QADateDisplay;
    if (dd && dd.formatDateDisplay) return dd.formatDateDisplay(raw);
    return String(raw || '').trim();
  }

  function localTodayIso() {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function todayDmy() {
    return formatDmy(localTodayIso());
  }

  function initDefaultDates() {
    var today = localTodayIso();
    if ($('appt-from') && !getApptDateYmd($('appt-from'))) {
      setApptDateYmd($('appt-from'), today);
    }
    if ($('appt-to') && !getApptDateYmd($('appt-to'))) {
      setApptDateYmd($('appt-to'), today);
    }
  }

  function statusLabel(status) {
    var s = String(status || 'pending').toLowerCase();
    if (s === 'accepted') return 'Accepted';
    if (s === 'declined') return 'Declined';
    return 'Pending';
  }

  function statusClass(status) {
    var s = String(status || 'pending').toLowerCase();
    if (s === 'accepted') return 'appt-status appt-status--accepted';
    if (s === 'declined') return 'appt-status appt-status--declined';
    return 'appt-status appt-status--pending';
  }

  function buildUrl() {
    var base = auth.apiBase() + '/api/appointments?';
    var fromRaw = $('appt-from') ? getApptDateYmd($('appt-from')) : '';
    var toRaw = $('appt-to') ? getApptDateYmd($('appt-to')) : '';
    var statusRaw = $('appt-status') ? $('appt-status').value : 'all';
    var qs = [];
    if (fromRaw) qs.push('from=' + encodeURIComponent(fromRaw));
    if (toRaw) qs.push('to=' + encodeURIComponent(toRaw));
    if (statusRaw && statusRaw !== 'all') {
      qs.push('status=' + encodeURIComponent(statusRaw));
    }
    return base + qs.join('&');
  }

  function transcriptHref(sessionId) {
    var sid = String(sessionId || '').trim();
    if (!sid) return '';
    return '/conversation-transcript?session=' + encodeURIComponent(sid);
  }

  function renderActions(row) {
    var sid = row.sessionId || '';
    if (!sid) return '<span class="appt-muted">—</span>';
    var st = String(row.status || 'pending').toLowerCase();
    if (st === 'accepted' || st === 'declined') {
      return '<span class="appt-muted">Done</span>';
    }
    return (
      '<div class="appt-actions">' +
      '<button type="button" class="appt-btn appt-btn--accept" data-action="accept" data-session="' +
      esc(sid) +
      '">Accept</button>' +
      '<button type="button" class="appt-btn appt-btn--decline" data-action="decline" data-session="' +
      esc(sid) +
      '">Decline</button>' +
      '</div>'
    );
  }

  function renderRows(data) {
    var body = $('appt-body');
    var meta = $('appt-meta');
    if (!body) return;

    var rows = (data && data.appointments) || [];
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="10" class="appt-empty">No appointments for the selected filters.</td></tr>';
    } else {
      body.innerHTML = rows
        .map(function (row) {
          var link = row.transcriptUrl || transcriptHref(row.sessionId || '');
          var chatCell = link
            ? '<a class="appt-link-transcript" href="' +
              esc(link) +
              '" target="_blank" rel="noopener noreferrer">Chatscript</a>'
            : '—';
          var st = String(row.status || 'pending').toLowerCase();
          return (
            '<tr data-session="' +
            esc(row.sessionId || '') +
            '">' +
            '<td>' +
            esc(formatDmy(row.appointmentDate) || '—') +
            '</td>' +
            '<td>' +
            esc(row.appointmentTime || '—') +
            '</td>' +
            '<td>' +
            esc(row.name || '—') +
            '</td>' +
            '<td>' +
            esc(row.mobile || '—') +
            '</td>' +
            '<td>' +
            esc(row.email || '—') +
            '</td>' +
            '<td>' +
            esc(formatDmy(row.conversationDate) || '—') +
            '</td>' +
            '<td>' +
            esc(row.channel || '—') +
            '</td>' +
            '<td><span class="' +
            statusClass(st) +
            '">' +
            esc(statusLabel(st)) +
            '</span></td>' +
            '<td>' +
            renderActions(row) +
            '</td>' +
            '<td>' +
            chatCell +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    }

    if (meta) {
      var parts = [rows.length + ' appointment' + (rows.length === 1 ? '' : 's')];
      var df = data && data.dateFilter;
      if (df && df.from && df.to) {
        parts.push(
          df.from === df.to
            ? 'App. date: ' + df.from
            : 'App. dates: ' + df.from + ' – ' + df.to
        );
      }
      if (data && data.statusFilter && data.statusFilter !== 'all') {
        parts.push('status: ' + data.statusFilter);
      }
      if (data && data.source) parts.push('source: ' + data.source);
      if (data && data.sheetsConfigured === false) {
        parts.push('Google Sheet not configured — showing transcript data only');
      }
      meta.textContent = parts.join(' · ');
    }
  }

  function showUnlock(message) {
    var panel = $('appt-unlock');
    var msg = $('appt-unlock-msg');
    if (panel) panel.classList.remove('hidden');
    if (msg) {
      msg.textContent = message || '';
      msg.classList.toggle('ok', !message);
    }
    var saved = auth.viewerSecret();
    if (saved && $('appt-secret') && !$('appt-secret').value) {
      $('appt-secret').value = saved;
    }
  }

  function hideUnlock() {
    var panel = $('appt-unlock');
    var msg = $('appt-unlock-msg');
    if (panel) panel.classList.add('hidden');
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('ok');
    }
  }

  function load() {
    if (!auth.hasAuth()) {
      showUnlock('Enter your viewer secret to load appointments.');
      return;
    }

    var body = $('appt-body');
    if (body) {
      body.innerHTML = '<tr><td colspan="10" class="appt-loading">Loading…</td></tr>';
    }

    var url = auth.withAuthQuery(buildUrl());
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
          showUnlock(detail);
          return;
        }
        hideUnlock();
        renderRows(res.data);
      })
      .catch(function () {
        showUnlock('Network error — try again.');
      });
  }

  function findRowData(sessionId) {
    var tr = document.querySelector('tr[data-session="' + sessionId + '"]');
    if (!tr) return null;
    var cells = tr.querySelectorAll('td');
    if (!cells || cells.length < 5) return null;
    return {
      sessionId: sessionId,
      appointmentDate: cells[0] ? cells[0].textContent.trim() : '',
      appointmentTime: cells[1] ? cells[1].textContent.trim() : '',
      name: cells[2] ? cells[2].textContent.trim() : '',
      mobile: cells[3] ? cells[3].textContent.trim() : '',
      email: cells[4] ? cells[4].textContent.trim() : '',
    };
  }

  function postAction(sessionId, action, btn) {
    if (!auth.hasAuth()) {
      showUnlock('Enter your viewer secret first.');
      return;
    }
    var row = findRowData(sessionId);
    if (!row) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = action === 'accept' ? 'Accepting…' : 'Declining…';
    }
    var url = auth.apiBase() + '/api/appointments/action';
    fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders()),
      body: JSON.stringify({
        sessionId: sessionId,
        action: action,
        formId: 'appointment',
        appointmentDate: row.appointmentDate,
        appointmentTime: row.appointmentTime,
        name: row.name === '—' ? '' : row.name,
        mobile: row.mobile === '—' ? '' : row.mobile,
        email: row.email === '—' ? '' : row.email,
      }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.data.ok) {
          var err =
            (res.data && (res.data.error || res.data.message)) ||
            'Action failed.';
          alert(err);
          if (btn) {
            btn.disabled = false;
            btn.textContent = action === 'accept' ? 'Accept' : 'Decline';
          }
          return;
        }
        load();
      })
      .catch(function () {
        alert('Network error — try again.');
        if (btn) {
          btn.disabled = false;
          btn.textContent = action === 'accept' ? 'Accept' : 'Decline';
        }
      });
  }

  function unlockAndLoad() {
    var input = $('appt-secret');
    var msg = $('appt-unlock-msg');
    var btn = $('appt-unlock-btn');
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

  $('appt-refresh').addEventListener('click', load);
  if ($('appt-today')) {
    $('appt-today').addEventListener('click', function () {
      var today = localTodayIso();
      if ($('appt-from')) setApptDateYmd($('appt-from'), today);
      if ($('appt-to')) setApptDateYmd($('appt-to'), today);
      load();
    });
  }
  $('appt-apply').addEventListener('click', load);
  if ($('appt-status')) {
    $('appt-status').addEventListener('change', load);
  }
  if ($('appt-unlock-btn')) {
    $('appt-unlock-btn').addEventListener('click', unlockAndLoad);
  }
  if ($('appt-secret')) {
    $('appt-secret').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') unlockAndLoad();
    });
  }
  if ($('appt-body')) {
    $('appt-body').addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!btn || btn.disabled) return;
      var action = btn.getAttribute('data-action');
      var sessionId = btn.getAttribute('data-session');
      if (!action || !sessionId) return;
      if (action === 'decline') {
        if (!window.confirm('Decline this appointment? The time slot will be released.')) return;
      }
      postAction(sessionId, action, btn);
    });
  }
  bindApptDatePicker($('appt-from'));
  bindApptDatePicker($('appt-to'));
  initDefaultDates();
  load();
})();
