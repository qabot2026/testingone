(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('super/crm-integration.html')) return;

  var providers = [];
  var chatFields = [];
  var defaultFieldMap = {};
  var selectedProvider = 'zoho';

  function $(id) {
    return document.getElementById(id);
  }

  function bid() {
    return nav.getBid();
  }

  function headers() {
    return Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders());
  }

  function authedUrl(path) {
    var url = auth.apiBase() + path;
    return auth.withAuthQuery ? auth.withAuthQuery(url) : url;
  }

  function setStatus(msg, isError) {
    var el = $('crm-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('crm-status--error', !!isError);
    el.classList.toggle('crm-status--ok', !!msg && !isError);
  }

  function setBadge(status) {
    var el = $('crm-badge');
    if (!el) return;
    el.textContent = status || '—';
    el.classList.remove('crm-badge--ready', 'crm-badge--warn', 'crm-badge--off');
    if (status === 'Ready') el.classList.add('crm-badge--ready');
    else if (status === 'Disabled') el.classList.add('crm-badge--off');
    else el.classList.add('crm-badge--warn');
  }

  function renderProviders() {
    var root = $('crm-providers');
    if (!root) return;
    root.innerHTML = providers
      .map(function (p) {
        return (
          '<button type="button" class="crm-provider' +
          (p.id === selectedProvider ? ' is-active' : '') +
          '" data-provider="' +
          p.id +
          '">' +
          p.label +
          '</button>'
        );
      })
      .join('');
    root.querySelectorAll('[data-provider]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectProvider(btn.getAttribute('data-provider'));
      });
    });
  }

  function selectProvider(id, skipDefaults) {
    selectedProvider = id;
    renderProviders();
    var p = providers.find(function (x) {
      return x.id === id;
    });
    if (!skipDefaults && p) {
      $('crm-baseUrl').value = p.baseUrl || '';
      $('crm-module').value = p.module || '';
      $('crm-path').value = p.path || '';
      if (defaultFieldMap[id]) {
        renderFieldMap(defaultFieldMap[id]);
      }
    }
  }

  function syncAuthFields() {
    var type = $('crm-authType').value;
    $('crm-apiKey-wrap').hidden = type !== 'api_key';
    $('crm-bearer-wrap').hidden = type !== 'bearer';
    $('crm-clientId-wrap').hidden = type !== 'oauth';
    $('crm-clientSecret-wrap').hidden = type !== 'oauth';
    $('crm-refreshToken-wrap').hidden = type !== 'oauth';
  }

  function fieldMapRow(chatField, crmField) {
    var options = chatFields
      .map(function (f) {
        return (
          '<option value="' +
          f.id +
          '"' +
          (f.id === chatField ? ' selected' : '') +
          '>' +
          f.label +
          '</option>'
        );
      })
      .join('');
    return (
      '<div class="crm-map-row">' +
      '<select class="crm-map-chat">' +
      options +
      '</select>' +
      '<span class="crm-map-arrow">→</span>' +
      '<input class="crm-map-crm" value="' +
      (crmField || '').replace(/"/g, '&quot;') +
      '" placeholder="CRM field name" />' +
      '<button type="button" class="dash-btn dash-btn--ghost crm-map-remove">Remove</button>' +
      '</div>'
    );
  }

  function renderFieldMap(rows) {
    var root = $('crm-field-map');
    if (!root) return;
    rows = rows && rows.length ? rows : [{ chatField: 'name', crmField: '' }];
    root.innerHTML = rows.map(function (r) {
      return fieldMapRow(r.chatField, r.crmField);
    }).join('');
    root.querySelectorAll('.crm-map-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.closest('.crm-map-row').remove();
      });
    });
  }

  function collectFieldMap() {
    var rows = [];
    document.querySelectorAll('.crm-map-row').forEach(function (row) {
      var chat = row.querySelector('.crm-map-chat');
      var crm = row.querySelector('.crm-map-crm');
      if (!chat || !crm) return;
      var crmVal = crm.value.trim();
      if (!crmVal) return;
      rows.push({ chatField: chat.value, crmField: crmVal });
    });
    return rows;
  }

  function fillForm(data) {
    data = data || {};
    var cfg = data.config || {};
    providers = data.providers || [];
    chatFields = data.chatFields || [];
    defaultFieldMap = data.defaultFieldMap || {};

    selectedProvider = cfg.provider || 'zoho';
    renderProviders();
    $('crm-enabled').checked = !!cfg.enabled;
    setBadge(cfg.status);

    var conn = cfg.connection || {};
    $('crm-baseUrl').value = conn.baseUrl || '';
    $('crm-authType').value = conn.authType || 'api_key';
    $('crm-apiKey').value = '';
    $('crm-bearerToken').value = '';
    $('crm-clientSecret').value = '';
    $('crm-refreshToken').value = '';
    $('crm-clientId').value = conn.clientId || '';
    $('crm-apiKey-hint').textContent = conn.apiKeySet
      ? 'Saved ' + (conn.apiKeyHint || '••••') + ' — leave blank to keep.'
      : '';
    $('crm-bearer-hint').textContent = conn.bearerTokenSet
      ? 'Saved ' + (conn.bearerTokenHint || '••••') + ' — leave blank to keep.'
      : '';
    $('crm-clientSecret-hint').textContent = conn.clientSecretSet
      ? 'Saved ' + (conn.clientSecretHint || '••••') + ' — leave blank to keep.'
      : '';
    $('crm-refreshToken-hint').textContent = conn.refreshTokenSet
      ? 'Saved ' + (conn.refreshTokenHint || '••••') + ' — leave blank to keep.'
      : '';

    var triggers = cfg.triggers || {};
    $('crm-trigger-leadCapture').checked = triggers.leadCapture !== false;
    $('crm-trigger-hotLead').checked = triggers.hotLead !== false;
    $('crm-trigger-appointmentBooked').checked = triggers.appointmentBooked !== false;

    var api = cfg.api || {};
    $('crm-method').value = api.method || 'POST';
    $('crm-module').value = api.module || '';
    $('crm-path').value = api.path || '';

    renderFieldMap(cfg.fieldMap || []);
    selectProvider(selectedProvider, true);
    syncAuthFields();
  }

  function collectPayload() {
    return {
      enabled: $('crm-enabled').checked,
      provider: selectedProvider,
      connection: {
        baseUrl: $('crm-baseUrl').value.trim(),
        authType: $('crm-authType').value,
        apiKey: $('crm-apiKey').value,
        bearerToken: $('crm-bearerToken').value,
        clientId: $('crm-clientId').value.trim(),
        clientSecret: $('crm-clientSecret').value,
        refreshToken: $('crm-refreshToken').value,
      },
      triggers: {
        leadCapture: $('crm-trigger-leadCapture').checked,
        hotLead: $('crm-trigger-hotLead').checked,
        appointmentBooked: $('crm-trigger-appointmentBooked').checked,
      },
      fieldMap: collectFieldMap(),
      api: {
        method: $('crm-method').value,
        module: $('crm-module').value.trim(),
        path: $('crm-path').value.trim(),
      },
    };
  }

  function load() {
    setStatus('Loading…', false);
    return fetch(authedUrl('/api/crm-integration/' + encodeURIComponent(bid())), {
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
          throw new Error((result.body && result.body.error) || 'Load failed');
        }
        fillForm(result.body);
        setStatus('', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Load failed', true);
      });
  }

  function save() {
    var btn = $('crm-save');
    if (btn) btn.disabled = true;
    setStatus('Saving…', false);
    return fetch(authedUrl('/api/crm-integration/' + encodeURIComponent(bid())), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify(collectPayload()),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Save failed');
        }
        fillForm(result.body);
        setStatus('CRM settings saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Save failed', true);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function testConnection() {
    var btn = $('crm-test');
    if (btn) btn.disabled = true;
    setStatus('Testing…', false);
    return save()
      .then(function () {
        return fetch(authedUrl('/api/crm-integration/' + encodeURIComponent(bid()) + '/test'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: headers(),
          body: JSON.stringify({}),
        });
      })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Test failed');
        }
        setStatus(result.body.message || 'Connection OK.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Test failed', true);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function init() {
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid();
      }) || nav.BOTS[0];

    nav.mount({
      active: 'crm-integration',
      title: 'CRM Integration',
      subtitle: bot.name + ' · Bot ID ' + bid(),
      bid: bid(),
    });

    $('crm-authType').addEventListener('change', syncAuthFields);
    $('crm-save').addEventListener('click', save);
    $('crm-test').addEventListener('click', testConnection);
    $('crm-add-map').addEventListener('click', function () {
      var root = $('crm-field-map');
      if (!root) return;
      root.insertAdjacentHTML('beforeend', fieldMapRow('name', ''));
      var last = root.querySelector('.crm-map-row:last-child .crm-map-remove');
      if (last) {
        last.addEventListener('click', function () {
          last.closest('.crm-map-row').remove();
        });
      }
    });
    load();
  }

  nav.whenReady(init);
})();
