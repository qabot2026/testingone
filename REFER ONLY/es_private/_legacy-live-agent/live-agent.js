(function () {
  'use strict';

  var KEY = 'qa_live_agent_desk';
  var selectedId = '';
  var pollTimer = null;
  var msgSince = '';

  function loadDesk() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function apiBase() {
    var d = loadDesk();
    if (d.apiBase) return d.apiBase.replace(/\/$/, '');
    return window.location.origin;
  }

  function headers() {
    var d = loadDesk();
    var h = { 'Content-Type': 'application/json' };
    if (d.token) h['X-Agent-Token'] = d.token;
    return h;
  }

  function agent() {
    var d = loadDesk();
    return {
      agentId: d.agentId || 'agent',
      agentName: d.agentName || 'Agent',
    };
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      });
    } catch (e) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (body) {
        return { ok: r.ok, status: r.status, body: body };
      });
    });
  }

  function setStatus(ok) {
    var el = document.getElementById('la-status');
    if (!el) return;
    if (ok) {
      el.textContent = 'Online';
      el.className = 'la-status la-status--ok';
    } else {
      el.textContent = 'Offline';
      el.className = 'la-status la-status--err';
    }
  }

  function renderList(id, items, emptyText, kind) {
    var ul = document.getElementById(id);
    ul.innerHTML = '';
    if (!items.length) {
      var li = document.createElement('li');
      li.className = 'la-list__empty';
      li.textContent = emptyText;
      ul.appendChild(li);
      return;
    }
    items.forEach(function (s) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'la-list__item' + (s.sessionId === selectedId ? ' la-list__item--active' : '');
      var tagClass =
        kind === 'active' ? 'la-list__tag--active' : 'la-list__tag--wait';
      var tagLabel = kind === 'active' ? 'In chat' : 'Waiting';
      btn.innerHTML =
        '<span class="la-list__row">' +
        '<span class="la-list__id">Visitor · ' +
        s.sessionId.slice(0, 8) +
        '</span>' +
        '<span class="la-list__time">' +
        formatTime(s.updatedAt || s.createdAt) +
        '</span></span>' +
        '<span class="la-list__preview">' +
        (s.preview || 'No message yet') +
        '</span>' +
        '<span class="la-list__tag ' +
        tagClass +
        '">' +
        tagLabel +
        '</span>';
      btn.addEventListener('click', function () {
        selectSession(s.sessionId, s.status);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function refreshQueue() {
    return fetchJson(apiBase() + '/api/live-agent/queue', { headers: headers() })
      .then(function (res) {
        if (!res.ok) {
          setStatus(false);
          if (res.status === 401) {
            var msg =
              (res.body && res.body.message) ||
              'Wrong token — check LIVE_AGENT_DESK_TOKEN.';
            alert(msg);
            if (res.body && res.body.error === 'desk_token_not_configured') {
              return;
            }
            window.location.href = 'settings.html';
          }
          return;
        }
        setStatus(true);
        var b = res.body;
        document.getElementById('la-wait-count').textContent = (b.waiting || []).length;
        document.getElementById('la-active-count').textContent = (b.active || []).length;
        renderList('la-waiting', b.waiting || [], 'No visitors waiting', 'waiting');
        renderList('la-active', b.active || [], 'No active chats', 'active');
      })
      .catch(function () {
        setStatus(false);
      });
  }

  function updateChatToolbar(status) {
    var stEl = document.getElementById('la-chat-status');
    var claim = document.getElementById('la-claim');
    var endBtn = document.getElementById('la-end');
    if (!stEl) return;
    stEl.textContent = status || 'waiting';
    stEl.className = 'la-chat-status';
    if (status === 'active') stEl.classList.add('la-chat-status--active');
    if (status === 'ended') stEl.classList.add('la-chat-status--ended');
    if (claim) claim.hidden = status === 'active' || status === 'ended';
    if (endBtn) endBtn.hidden = status !== 'active';
  }

  function selectSession(sessionId, statusHint) {
    selectedId = sessionId;
    msgSince = '';
    document.getElementById('la-chat-empty').hidden = true;
    document.getElementById('la-chat-panel').hidden = false;
    document.getElementById('la-chat-title').textContent =
      'Visitor ' + sessionId.slice(0, 10) + '…';
    updateChatToolbar(statusHint || 'waiting');
    loadMessages(true);
    refreshQueue();
  }

  function loadMessages(scrollEnd) {
    if (!selectedId) return;
    var url =
      apiBase() +
      '/api/live-agent/session?sessionId=' +
      encodeURIComponent(selectedId);
    return fetchJson(url, { headers: headers() }).then(function (res) {
      if (!res.ok || !res.body.ok) return;
      var box = document.getElementById('la-messages');
      box.innerHTML = '';
      (res.body.messages || []).forEach(function (m) {
        appendMsgEl(box, m);
        msgSince = m.at || msgSince;
      });
      if (scrollEnd) box.scrollTop = box.scrollHeight;
      var st = (res.body.session && res.body.session.status) || 'waiting';
      updateChatToolbar(st);
    });
  }

  function appendMsgEl(box, m) {
    var from = m.from || 'system';
    var div = document.createElement('div');
    div.className = 'la-msg la-msg--' + from;
    var label =
      from === 'user'
        ? 'Visitor'
        : from === 'agent'
          ? agent().agentName
          : 'System';
    var meta = document.createElement('div');
    meta.className = 'la-msg__meta';
    meta.textContent = label + ' · ' + formatTime(m.at);
    var text = document.createElement('div');
    text.className = 'la-msg__text';
    text.textContent = m.text || '';
    div.appendChild(meta);
    div.appendChild(text);
    box.appendChild(div);
  }

  function pollSelected() {
    if (!selectedId) return;
    fetchJson(
      apiBase() +
        '/api/live-agent/poll?sessionId=' +
        encodeURIComponent(selectedId) +
        (msgSince ? '&since=' + encodeURIComponent(msgSince) : ''),
      { headers: headers() }
    ).then(function (res) {
      if (!res.ok || !res.body.ok) return;
      if (res.body.status) updateChatToolbar(res.body.status);
      var box = document.getElementById('la-messages');
      (res.body.messages || []).forEach(function (m) {
        appendMsgEl(box, m);
        msgSince = m.at || msgSince;
      });
      box.scrollTop = box.scrollHeight;
    });
  }

  function setupTabs() {
    var tabs = document.querySelectorAll('.la-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          t.classList.toggle('la-tab--active', t === tab);
        });
        document.getElementById('la-panel-waiting').hidden = name !== 'waiting';
        document.getElementById('la-panel-active').hidden = name !== 'active';
      });
    });
  }

  document.getElementById('la-refresh').addEventListener('click', function () {
    refreshQueue();
    if (selectedId) loadMessages(true);
  });

  document.getElementById('la-claim').addEventListener('click', function () {
    if (!selectedId) return;
    var a = agent();
    fetchJson(apiBase() + '/api/live-agent/claim', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId: selectedId,
        agentId: a.agentId,
        agentName: a.agentName,
      }),
    }).then(function () {
      loadMessages(true);
      refreshQueue();
      document.querySelector('.la-tab[data-tab="active"]').click();
    });
  });

  document.getElementById('la-end').addEventListener('click', function () {
    if (!selectedId) return;
    if (!confirm('End this chat? The visitor will go back to the bot.')) return;
    var a = agent();
    fetchJson(apiBase() + '/api/live-agent/end', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId: selectedId,
        agentId: a.agentId,
        agentName: a.agentName,
      }),
    }).then(function () {
      loadMessages(true);
      refreshQueue();
    });
  });

  document.getElementById('la-reply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selectedId) return;
    var input = document.getElementById('la-reply-input');
    var text = input.value.trim();
    if (!text) return;
    var a = agent();
    fetchJson(apiBase() + '/api/live-agent/agent-message', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        sessionId: selectedId,
        message: text,
        agentId: a.agentId,
        agentName: a.agentName,
      }),
    }).then(function (res) {
      if (res.body && res.body.ok) {
        input.value = '';
        pollSelected();
      } else if (res.body && res.body.error === 'session_not_active') {
        alert('Click “Take chat” first.');
      }
    });
  });

  var d = loadDesk();
  if (!d.agentName || !d.token) {
    window.location.href = 'settings.html';
  }

  document.getElementById('la-agent-name').textContent = d.agentName || 'Agent';

  setupTabs();
  refreshQueue();
  pollTimer = setInterval(function () {
    refreshQueue();
    pollSelected();
  }, 2500);
})();
