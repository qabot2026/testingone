(function () {
  'use strict';
  var KEY = 'qa_live_agent_desk';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  var d = load();
  document.getElementById('la-set-name').value = d.agentName || '';
  document.getElementById('la-set-token').value = d.token || '';

  document.getElementById('la-set-save').addEventListener('click', function () {
    var name = document.getElementById('la-set-name').value.trim();
    var token = document.getElementById('la-set-token').value.trim();
    if (!name) {
      alert('Enter your name.');
      return;
    }
    if (!token) {
      alert('Enter the desk token (LIVE_AGENT_DESK_TOKEN).');
      return;
    }
    save({
      agentName: name,
      agentId: name.toLowerCase().replace(/\s+/g, '-').slice(0, 32),
      token: token,
      apiBase: window.location.origin.replace(/\/live-agent\/?$/, ''),
    });
    window.location.href = 'index.html';
  });
})();
