(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;
  var registryBots = [];
  var deskTokenRequired = false;

  function apiBase() {
    return auth.apiBase();
  }

  function showAuthUnlock(message) {
    var panel = document.getElementById('superAuthUnlock');
    var msg = document.getElementById('superAuthUnlockMsg');
    if (panel) panel.classList.remove('hidden');
    if (msg) {
      msg.textContent = message || '';
      msg.classList.toggle('ok', !message);
    }
    var saved = auth.viewerSecret();
    var input = document.getElementById('superAuthSecret');
    if (saved && input && !input.value) input.value = saved;
  }

  function hideAuthUnlock() {
    var panel = document.getElementById('superAuthUnlock');
    var msg = document.getElementById('superAuthUnlockMsg');
    if (panel) panel.classList.add('hidden');
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('ok');
    }
  }

  function refreshAuthGate() {
    if (!deskTokenRequired || auth.hasAuth()) {
      hideAuthUnlock();
      return;
    }
    showAuthUnlock('Enter your viewer secret to save bot registry changes.');
  }

  function loadDeskConfig() {
    return fetch(apiBase() + '/api/live-agent/desk-config', { credentials: 'same-origin' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        deskTokenRequired = !!(data && data.tokenRequired);
        refreshAuthGate();
      })
      .catch(function () {
        deskTokenRequired = false;
        refreshAuthGate();
      });
  }

  function unlockSaving() {
    var input = document.getElementById('superAuthSecret');
    var msg = document.getElementById('superAuthUnlockMsg');
    var btn = document.getElementById('superAuthUnlockBtn');
    var secret = input ? input.value.trim() : '';
    if (!secret) {
      if (msg) msg.textContent = 'Enter viewer secret.';
      return Promise.resolve();
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Checking secret…';
    return auth.validateSecret(secret).then(function (result) {
      if (btn) btn.disabled = false;
      if (!result.ok) {
        if (msg) msg.textContent = result.message || 'Secret not accepted.';
        return;
      }
      if (msg) {
        msg.textContent = 'Unlocked — you can save settings now.';
        msg.classList.add('ok');
      }
      window.setTimeout(hideAuthUnlock, 1200);
    });
  }

  function bindAuthUnlock() {
    var btn = document.getElementById('superAuthUnlockBtn');
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', unlockSaving);
    var input = document.getElementById('superAuthSecret');
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          unlockSaving();
        }
      });
    }
  }

  function markEditingRow(botId) {
    var id = String(botId || '').trim();
    document.querySelectorAll('[data-bot-row]').forEach(function (row) {
      row.classList.toggle('is-editing', row.getAttribute('data-bot-row') === id);
    });
  }

  function selectBotForEdit(botId) {
    var bot = findBot(botId);
    if (!bot) return;
    fillCurrentBotForm(bot);
    markEditingRow(bot.id);
    if (nav.getBid() !== bot.id) {
      var url = new URL(window.location.href);
      url.searchParams.set('bid', bot.id);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    nav.updateTopbar('Advanced configuration', bot.name + ' (Bot ID ' + bot.id + ')');
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, '&#39;');
  }

  function suggestSheetTab(name) {
    var label = String(name || '').trim();
    if (!label) return 'Bot Conv.';
    return label + ' Conv.';
  }

  function setStatus(elId, msg, isError) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    if (elId === 'superListStatus') {
      el.className =
        'super-list-status' + (isError ? ' super-list-status--error' : ' super-list-status--ok');
    } else {
      el.className =
        'super-form-status' + (isError ? ' super-form-status--error' : ' super-form-status--ok');
    }
    el.hidden = !msg;
  }

  function findBot(botId) {
    var id = String(botId || '').trim();
    return (
      registryBots.find(function (b) {
        return b.id === id;
      }) ||
      nav.BOTS.find(function (b) {
        return b.id === id;
      }) ||
      null
    );
  }

  function demoSlug(name, botId) {
    var slug = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'bot-' + String(botId || '').slice(-3);
  }

  function updateDemoPathPreview(botId, name) {
    var el = document.getElementById('superEditDemoPath');
    if (!el) return;
    el.textContent = 'Demo page: /' + demoSlug(name, botId) + '-demo.html';
  }

  function fillCurrentBotForm(bot) {
    var idEl = document.getElementById('superEditBotId');
    var idDisplay = document.getElementById('superEditBotIdDisplay');
    var sitePresetEl = document.getElementById('superEditSitePreset');
    var nameEl = document.getElementById('superEditBotName');
    var sheetEl = document.getElementById('superEditSheetTab');
    var welcomeEl = document.getElementById('superEditWelcomeEvent');
    var line = document.getElementById('superCurrentBotLine');
    if (!bot) return;
    if (idEl) idEl.value = bot.id;
    if (idDisplay) idDisplay.value = bot.id;
    if (sitePresetEl) sitePresetEl.value = bot.sitePreset || '';
    if (nameEl) nameEl.value = bot.name || '';
    if (sheetEl) sheetEl.value = bot.sheetTab || suggestSheetTab(bot.name);
    if (welcomeEl) welcomeEl.value = bot.welcomeEventName || '';
    updateDemoPathPreview(bot.id, bot.name);
    markEditingRow(bot.id);
    if (line) {
      line.textContent =
        'Editing ' + bot.name + ' (Bot ID ' + bot.id + '). Save once — all project files update.';
    }
  }

  function githubSyncNote(githubSync) {
    if (!githubSync) return '';
    if (githubSync.ok === false) {
      return ' GitHub sync failed: ' + (githubSync.error || 'unknown error') + '.';
    }
    if (githubSync.pushedFiles > 0) {
      return ' GitHub: ' + githubSync.pushedFiles + ' file(s) pushed.';
    }
    return ' GitHub already up to date.';
  }

  function patchBotSettings(botId, payload) {
    return fetch(apiBase() + '/api/bot-registry/' + encodeURIComponent(botId), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders()),
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  function saveCurrentBotSettings(ev) {
    if (ev) ev.preventDefault();

    var botId = document.getElementById('superEditBotId').value.trim();
    var name = document.getElementById('superEditBotName').value.trim();
    var sheetTab = document.getElementById('superEditSheetTab').value.trim();
    var welcomeEventName = document.getElementById('superEditWelcomeEvent').value.trim();
    var saveBtn = document.getElementById('superSaveSettingsBtn');

    if (!botId) {
      setStatus('superEditStatus', 'No bot selected.', true);
      return Promise.resolve();
    }
    if (deskTokenRequired && !auth.hasAuth()) {
      showAuthUnlock('Enter your viewer secret before saving.');
      setStatus(
        'superEditStatus',
        'Saving locked — unlock with your viewer secret above first.',
        true
      );
      return Promise.resolve();
    }
    if (!name) {
      setStatus('superEditStatus', 'Display name is required.', true);
      return Promise.resolve();
    }
    if (!sheetTab) {
      setStatus('superEditStatus', 'Sheet tab name is required.', true);
      return Promise.resolve();
    }

    if (saveBtn) saveBtn.disabled = true;
    setStatus('superEditStatus', 'Saving…', false);

    return patchBotSettings(botId, {
      name: name,
      sheetTab: sheetTab,
      welcomeEventName: welcomeEventName,
    })
      .then(function (result) {
        if (result.status === 401) {
          showAuthUnlock(
            'Not signed in — enter the viewer secret above (same as Insights / Live chat setup).'
          );
          throw new Error(
            'Not signed in — enter your viewer secret above, then save again.'
          );
        }
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not save settings');
        }
        var bot = result.body.bot || {};
        var synced = result.body.syncedPaths || [];
        var syncNote =
          synced.length > 0
            ? ' Updated ' + synced.length + ' file groups (registry, config, settings, demo, presets).'
            : '';
        setStatus(
          'superEditStatus',
          'Saved ' +
            (bot.name || name) +
            ': sheet tab "' +
            (bot.sheetTab || sheetTab) +
            '"' +
            (bot.welcomeEventName
              ? ', welcome event "' + bot.welcomeEventName + '"'
              : ', welcome event cleared') +
            syncNote +
            githubSyncNote(result.body.githubSync),
          false
        );
        return nav.refreshBots().then(loadRegistry);
      })
      .catch(function (err) {
        setStatus('superEditStatus', err.message || 'Request failed', true);
      })
      .finally(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
  }

  function renderBotList(bots) {
    var el = document.getElementById('superBotList');
    if (!el) return;
    if (!bots.length) {
      el.innerHTML = '<p class="dash-muted">No bots registered yet.</p>';
      return;
    }
    el.innerHTML =
      '<div class="super-bot-table-wrap"><table class="super-bot-table" aria-label="Registered bots">' +
      '<thead><tr><th>Bot ID</th><th>Name</th><th>Sheet tab</th><th>Welcome event</th><th>Files</th><th></th></tr></thead><tbody>' +
      bots
        .map(function (b) {
          var tabLabel = b.sheetTab
            ? '<code>' + esc(b.sheetTab) + '</code>'
            : '<span class="dash-muted">—</span>';
          var event = b.welcomeEventName
            ? '<code>' + esc(b.welcomeEventName) + '</code>'
            : '<span class="dash-muted">(default / home)</span>';
          var canDelete = b.id !== '10001' && bots.length > 1;
          var deleteCell = canDelete
            ? '<button type="button" class="super-delete-btn" data-bot-id="' +
              esc(b.id) +
              '" data-bot-name="' +
              esc(b.name) +
              '">Delete</button>'
            : '<span class="dash-muted" title="Default bot cannot be removed">—</span>';
          return (
            '<tr data-bot-row="' +
            esc(b.id) +
            '">' +
            '<td><code>' +
            esc(b.id) +
            '</code></td>' +
            '<td>' +
            esc(b.name) +
            '</td>' +
            '<td>' +
            tabLabel +
            '</td>' +
            '<td>' +
            event +
            '</td>' +
            '<td class="super-bot-links">' +
            '<a href="' +
            nav.bidPath(b.id, 'uc-conversations') +
            '">Insights</a> · ' +
            '<a href="' +
            nav.bidPath(b.id, 'uiux-setting') +
            '">Appearance</a>' +
            (b.demoPath
              ? ' · <a href="' + esc(b.demoPath) + '" target="_blank" rel="noopener">Demo</a>'
              : '') +
            (b.configPath
              ? ' · <a href="' + esc(b.configPath) + '" target="_blank" rel="noopener">UI config</a>'
              : '') +
            '</td>' +
            '<td class="super-bot-actions">' +
            deleteCell +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';

    el.querySelectorAll('[data-bot-row]').forEach(function (row) {
      row.addEventListener('click', function (ev) {
        if (ev.target.closest('a,button')) return;
        selectBotForEdit(row.getAttribute('data-bot-row'));
      });
    });

    el.querySelectorAll('.super-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteBot(btn.getAttribute('data-bot-id'), btn.getAttribute('data-bot-name'));
      });
    });
  }

  function deleteBot(botId, botName) {
    var label = botName ? botName + ' (' + botId + ')' : botId;
    if (
      !window.confirm(
        'Delete bot ' +
          label +
          '? This removes it from the dashboard and clears its appearance preset. This cannot be undone.'
      )
    ) {
      return;
    }
    setStatus('superListStatus', 'Deleting…', false);

    fetch(apiBase() + '/api/bot-registry/' + encodeURIComponent(botId), {
      method: 'DELETE',
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
          throw new Error((result.body && result.body.error) || 'Could not delete bot');
        }
        setStatus('superListStatus', 'Bot ' + label + ' deleted.', false);
        var currentBid = nav.getBid();
        return nav.refreshBots().then(function () {
          if (currentBid === botId && nav.BOTS.length) {
            window.location.href =
              '/dashboard/supersetting.html?bid=' + encodeURIComponent(nav.BOTS[0].id);
            return;
          }
          return loadRegistry();
        });
      })
      .catch(function (err) {
        setStatus('superListStatus', err.message || 'Request failed', true);
      });
  }

  function loadRegistry() {
    return fetch(apiBase() + '/api/bot-registry', { credentials: 'same-origin' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        registryBots = (data && data.bots) || [];
        renderBotList(registryBots);
        var bid = nav.getBid();
        fillCurrentBotForm(findBot(bid) || registryBots[0] || nav.BOTS[0]);
        return data;
      })
      .catch(function () {
        registryBots = nav.BOTS || [];
        renderBotList(registryBots);
        fillCurrentBotForm(findBot(nav.getBid()) || registryBots[0]);
      });
  }

  function bindEditForm() {
    var form = document.getElementById('superEditBotForm');
    if (!form) return;
    form.addEventListener('submit', saveCurrentBotSettings);
    var nameInput = document.getElementById('superEditBotName');
    if (nameInput) {
      nameInput.addEventListener('input', function () {
        var botId = document.getElementById('superEditBotId').value.trim();
        updateDemoPathPreview(botId, nameInput.value);
      });
    }
  }

  function bindForm() {
    var form = document.getElementById('superAddBotForm');
    if (!form) return;

    var nameInput = document.getElementById('superBotName');
    var sheetTabInput = document.getElementById('superSheetTab');

    if (nameInput && sheetTabInput) {
      nameInput.addEventListener('input', function () {
        if (sheetTabInput.dataset.touched === '1') return;
        sheetTabInput.value = suggestSheetTab(nameInput.value);
      });
      sheetTabInput.addEventListener('input', function () {
        sheetTabInput.dataset.touched = '1';
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      setStatus('superFormStatus', 'Saving…', false);

      var id = document.getElementById('superBotId').value.trim();
      var name = document.getElementById('superBotName').value.trim();
      var welcomeEventName = document.getElementById('superWelcomeEvent').value.trim();
      var sheetTab = sheetTabInput ? sheetTabInput.value.trim() : '';

      fetch(apiBase() + '/api/bot-registry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders()),
        body: JSON.stringify({
          id: id,
          name: name,
          welcomeEventName: welcomeEventName,
          sheetTab: sheetTab,
        }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok, status: res.status, body: body };
          });
        })
        .then(function (result) {
          if (result.status === 401) {
            showAuthUnlock('Enter your viewer secret before creating a bot.');
            throw new Error(
              'Not signed in — enter your viewer secret above, then try again.'
            );
          }
          if (!result.ok || !result.body.ok) {
            throw new Error((result.body && result.body.error) || 'Could not add bot');
          }
          var bot = result.body.bot || {};
          var files = (result.body.filesCreated || []).join(', ');
          var extra = files ? ' Files: ' + files + '.' : '';
          setStatus(
            'superFormStatus',
            'Bot ' +
              bot.name +
              ' (' +
              bot.id +
              ') created. Sheet tab "' +
              (bot.sheetTab || '') +
              '" is ready.' +
              extra +
              githubSyncNote(result.body.githubSync),
            false
          );
          form.reset();
          if (sheetTabInput) delete sheetTabInput.dataset.touched;
          return nav.refreshBots().then(function () {
            return loadRegistry();
          });
        })
        .catch(function (err) {
          setStatus('superFormStatus', err.message || 'Request failed', true);
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
      active: 'supersetting',
      title: 'Advanced configuration',
      subtitle: bot.name + ' (Bot ID ' + bot.id + ')',
    });

    var line = document.getElementById('superBotLine');
    if (line) {
      line.textContent = 'Create a brand-new bot project (new Bot ID). Use the form above to edit an existing bot.';
    }

    bindAuthUnlock();
    bindEditForm();
    bindForm();
    loadDeskConfig();
    loadRegistry();
  }

  nav.whenReady(init);
})();
