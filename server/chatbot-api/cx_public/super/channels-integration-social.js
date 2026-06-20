(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  var CHANNELS = ['whatsapp', 'instagram', 'facebook'];

  function channelIconSvg(channelId) {
    if (channelId === 'whatsapp') {
      return (
        '<svg class="social-brand-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>' +
        '</svg>'
      );
    }
    if (channelId === 'instagram') {
      return (
        '<svg class="social-brand-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>' +
        '</svg>'
      );
    }
    if (channelId === 'facebook') {
      return (
        '<svg class="social-brand-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>' +
        '</svg>'
      );
    }
    return '';
  }

  function channelIconClass(channelId) {
    return 'social-channel__icon social-channel__icon--' + channelId;
  }

  var state = {
    botId: '',
    botName: '',
    summary: null,
    channels: {},
    openChannel: null,
    visibleVendor: {},
  };

  function apiBase() {
    return auth.apiBase();
  }

  function currentBotId() {
    return nav && typeof nav.getBid === 'function' ? String(nav.getBid() || '').trim() : '';
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

  function channelApi(botId, channel) {
    return (
      apiBase() +
      '/api/social-integration/' +
      encodeURIComponent(botId) +
      '/' +
      encodeURIComponent(channel)
    );
  }

  function panelRoot(channelId) {
    return document.getElementById('socialChannelPanel-' + channelId);
  }

  function setIntro(channelId) {
    var el = document.getElementById('channelsSocialIntro-' + channelId);
    if (!el) return;
    var meta =
      (state.summary && state.summary.channels && state.summary.channels[channelId]) || {};
    var label = meta.label || channelId;
    el.textContent =
      'Bot ' +
      state.botId +
      ' · ' +
      (state.botName || 'Project') +
      ' — ' +
      label +
      ' integration settings.';
  }

  function tabBadgeState(channelId) {
    var ch = state.summary && state.summary.channels && state.summary.channels[channelId];
    if (!ch) return { level: 'red', label: 'Not set up' };
    if (ch.enabled) return { level: 'green', label: 'Live' };
    if (ch.stored || ch.hasCredentials) {
      return { level: 'yellow', label: 'Configured but disabled' };
    }
    return { level: 'red', label: 'Not set up' };
  }

  function updateTabBadges() {
    CHANNELS.forEach(function (channelId) {
      var status = document.getElementById('channelsTabBadge-' + channelId);
      if (!status) return;
      var s = tabBadgeState(channelId);
      var dot = status.querySelector('.channels-tab__status-dot');
      if (dot) {
        dot.className = 'channels-tab__status-dot channels-tab__status-dot--' + s.level;
      }
      status.setAttribute('title', 'Status: ' + s.label);
      status.setAttribute('aria-label', 'Status: ' + s.label);
    });
  }

  function badgeFor(channelId) {
    var s = tabBadgeState(channelId);
    if (s.level === 'green') return { text: 'Active', cls: 'social-channel__badge--on' };
    if (s.level === 'yellow') return { text: 'Disabled', cls: 'social-channel__badge--inactive' };
    return { text: 'Not set up', cls: 'social-channel__badge--off' };
  }

  function mountChannel(channelId) {
    var root = panelRoot(channelId);
    if (!root) return Promise.resolve();
    if (!state.channels[channelId]) {
      root.innerHTML = '<div class="social-channel__placeholder">Loading…</div>';
      return loadChannelPanel(channelId);
    }
    root.innerHTML = renderChannelForm(channelId, state.channels[channelId]);
    bindChannelPanel(channelId);
    return Promise.resolve();
  }

  function loadChannel(channelId) {
    if (CHANNELS.indexOf(channelId) < 0) return Promise.resolve();
    setIntro(channelId);
    return mountChannel(channelId);
  }

  function providerOptions(schema, active) {
    return (schema.providerIds || [])
      .map(function (id) {
        var p = schema.providers[id];
        return (
          '<option value="' +
          esc(id) +
          '"' +
          (id === active ? ' selected' : '') +
          '>' +
          esc(p ? p.label : id) +
          '</option>'
        );
      })
      .join('');
  }

  function renderVendorTabs(channelId, schema, cfg) {
    var visible = state.visibleVendor[channelId] || cfg.activeProvider || 'meta';
    var active = cfg.activeProvider || 'meta';
    var tabs = (schema.providerIds || [])
      .map(function (id) {
        var p = schema.providers[id];
        var cls = 'social-vendor-tab';
        if (id === visible) cls += ' is-active';
        if (id === active) cls += ' is-provider';
        return (
          '<button type="button" class="' +
          cls +
          '" data-vendor-tab="' +
          esc(id) +
          '">' +
          esc(p ? p.label : id) +
          '</button>'
        );
      })
      .join('');

    var panels = (schema.providerIds || [])
      .map(function (id) {
        return renderVendorPanel(channelId, id, schema.providers[id], cfg, id === visible);
      })
      .join('');

    return (
      '<div class="social-section-label">Vendor credentials</div>' +
      '<div class="social-vendor-tabs" data-channel-vendors="' +
      esc(channelId) +
      '">' +
      tabs +
      '</div>' +
      '<div data-channel-panels="' +
      esc(channelId) +
      '">' +
      panels +
      '</div>'
    );
  }

  function renderVendorPanel(channelId, providerId, prov, cfg, visible) {
    var values = (cfg.providers && cfg.providers[providerId]) || {};
    var fields = (prov.fields || [])
      .map(function (field) {
        var type = field.secret ? 'password' : 'text';
        return (
          '<label class="social-field">' +
          esc(field.label) +
          '<input type="' +
          type +
          '" data-ch="' +
          esc(channelId) +
          '" data-prov="' +
          esc(providerId) +
          '" data-field="' +
          esc(field.key) +
          '" value="' +
          escAttr(values[field.key] || '') +
          '" placeholder="' +
          escAttr(field.placeholder || '') +
          '" autocomplete="off" />' +
          (field.hint ? '<small>' + esc(field.hint) + '</small>' : '') +
          (field.env
            ? '<span class="social-env-hint">Env: <code>' + esc(field.env) + '</code></span>'
            : '') +
          '</label>'
        );
      })
      .join('');

    var webhook =
      state.channels[channelId] && state.channels[channelId].webhookUrl
        ? state.channels[channelId].webhookUrl
        : '—';

    return (
      '<div class="social-vendor-panel' +
      (visible ? ' is-visible' : '') +
      '" data-vendor-panel="' +
      esc(providerId) +
      '">' +
      '<p class="dash-muted" style="margin:0;font-size:0.75rem">Webhook: <code>' +
      esc(webhook) +
      '</code></p>' +
      fields +
      '<label class="social-field">Notes<textarea data-ch="' +
      esc(channelId) +
      '" data-prov="' +
      esc(providerId) +
      '" data-field="notes" placeholder="Setup notes">' +
      esc(values.notes || '') +
      '</textarea></label>' +
      (prov.docsUrl
        ? '<p style="margin:0;font-size:0.75rem"><a href="' +
          escAttr(prov.docsUrl) +
          '" target="_blank" rel="noopener">Open vendor docs</a></p>'
        : '') +
      '</div>'
    );
  }

  function renderBotFields(channelId, schema, cfg) {
    var bot = cfg.bot || {};
    return (
      '<div class="social-section-label">Bot routing</div>' +
      '<div class="social-bot-grid">' +
      (schema.botFields || [])
        .map(function (field) {
          return (
            '<label class="social-field">' +
            esc(field.label) +
            '<input type="text" data-ch="' +
            esc(channelId) +
            '" data-bot-field="' +
            esc(field.key) +
            '" value="' +
            escAttr(bot[field.key] != null ? String(bot[field.key]) : '') +
            '" placeholder="' +
            escAttr(field.placeholder || '') +
            '" />' +
            (field.hint ? '<small>' + esc(field.hint) + '</small>' : '') +
            '</label>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderChannelForm(channelId, payload) {
    var schema = payload.schema;
    var cfg = payload.config;
    var configured = !!payload.configured;
    var webhook = payload.webhookUrl || '—';

    if (!configured) {
      return (
        '<div class="social-channel__empty">' +
        '<p>' +
        esc(payload.channelMeta.label) +
        ' is bot ke liye configure nahi hai. Neeche setup shuru karo.</p>' +
        '<button type="button" class="dash-btn dash-btn--primary" data-setup-channel="' +
        esc(channelId) +
        '">Set up ' +
        esc(payload.channelMeta.label) +
        '</button>' +
        '</div>' +
        '<form class="social-form" id="socialForm-' +
        esc(channelId) +
        '" hidden data-channel-form="' +
        esc(channelId) +
        '">' +
        buildFormInner(channelId, schema, cfg, webhook) +
        '</form>'
      );
    }

    return (
      '<form class="social-form" id="socialForm-' +
      esc(channelId) +
      '" data-channel-form="' +
      esc(channelId) +
      '">' +
      buildFormInner(channelId, schema, cfg, webhook) +
      '</form>'
    );
  }

  function buildFormInner(channelId, schema, cfg, webhook) {
    state.visibleVendor[channelId] =
      state.visibleVendor[channelId] || cfg.activeProvider || 'meta';

    return (
      '<div class="social-form-toolbar' +
      (cfg.enabled ? ' is-enabled-channel' : ' is-disabled-channel') +
      '">' +
      '<div class="social-form-toolbar__info">' +
      '<span class="social-form-toolbar__title">Channel status</span>' +
      '<span class="social-form-toolbar__hint">Credentials save kar sakte ho — channel tab tak off rakho jab tak live na karna ho</span>' +
      '</div>' +
      '<label class="social-switch">' +
      '<input type="checkbox" class="social-switch__input" data-ch="' +
      esc(channelId) +
      '" data-enabled-toggle' +
      (cfg.enabled ? ' checked' : '') +
      ' />' +
      '<span class="social-switch__track" aria-hidden="true"></span>' +
      '<span class="social-switch__label">' +
      (cfg.enabled ? 'Enabled' : 'Disabled') +
      '</span>' +
      '</label>' +
      '</div>' +
      '<div class="social-form-card">' +
      '<label class="social-field">Active provider<select data-ch="' +
      esc(channelId) +
      '" data-active-provider>' +
      providerOptions(schema, cfg.activeProvider) +
      '</select><small>Outbound + webhook vendor for this bot.</small></label>' +
      '<div class="social-webhook"><span class="social-webhook__label">Webhook URL</span><code>' +
      esc(webhook) +
      '</code><small>Vendor dashboard mein paste karo · <code>bid</code> + <code>channel</code> routing ke liye</small></div>' +
      '</div>' +
      '<div class="social-form-card">' +
      renderVendorTabs(channelId, schema, cfg) +
      '</div>' +
      '<div class="social-form-card">' +
      renderBotFields(channelId, schema, cfg) +
      '</div>' +
      '<div class="social-form-actions">' +
      '<button type="submit" class="dash-btn dash-btn--primary">Save ' +
      esc(schema.label || channelId) +
      '</button>' +
      '<p class="social-form-status" id="socialStatus-' +
      esc(channelId) +
      '" hidden></p>' +
      '</div>'
    );
  }

  function bindChannelPanel(channelId) {
    var body = panelRoot(channelId);
    if (!body) return;

    var setupBtn = body.querySelector('[data-setup-channel]');
    if (setupBtn) {
      setupBtn.addEventListener('click', function () {
        var form = body.querySelector('[data-channel-form]');
        if (form) {
          form.hidden = false;
          setupBtn.closest('.social-channel__empty').style.display = 'none';
        }
      });
    }

    body.querySelectorAll('[data-vendor-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.visibleVendor[channelId] = tab.getAttribute('data-vendor-tab');
        var payload = state.channels[channelId];
        if (payload) {
          body.innerHTML = renderChannelForm(channelId, payload);
          bindChannelPanel(channelId);
        }
      });
    });

    var activeSelect = body.querySelector('[data-active-provider]');
    if (activeSelect) {
      activeSelect.addEventListener('change', function () {
        state.visibleVendor[channelId] = activeSelect.value;
        refreshWebhookInPanel(channelId);
      });
    }

    var form = body.querySelector('[data-channel-form]');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        saveChannel(channelId);
      });
      var toggle = form.querySelector('[data-enabled-toggle]');
      var toggleLabel = form.querySelector('.social-switch__label');
      if (toggle && toggleLabel) {
        toggle.addEventListener('change', function () {
          toggleLabel.textContent = toggle.checked ? 'Enabled' : 'Disabled';
          var toolbar = form.querySelector('.social-form-toolbar');
          if (toolbar) {
            toolbar.classList.toggle('is-enabled-channel', toggle.checked);
            toolbar.classList.toggle('is-disabled-channel', !toggle.checked);
          }
        });
      }
    }
  }

  function refreshWebhookInPanel(channelId) {
    var payload = state.channels[channelId];
    if (!payload || !payload.schema) return;
    var active =
      (document.querySelector('[data-ch="' + channelId + '"][data-active-provider]') || {})
        .value || payload.config.activeProvider;
    var prov = payload.schema.providers[active];
    var path = (prov && prov.webhookPath) || '/webhooks/meta';
    var base = String(payload.publicBaseUrl || window.location.origin).replace(/\/$/, '');
    var url =
      base +
      path +
      '?bid=' +
      encodeURIComponent(state.botId) +
      '&channel=' +
      encodeURIComponent(channelId);
    var code = body.querySelector('.social-webhook code');
    if (code) code.textContent = url;
  }

  function collectChannelPayload(channelId) {
    var providers = {};
    var schema = state.channels[channelId] && state.channels[channelId].schema;
    if (!schema) return null;

    (schema.providerIds || []).forEach(function (provId) {
      var row = {};
      document
        .querySelectorAll(
          '[data-ch="' + channelId + '"][data-prov="' + provId + '"][data-field]'
        )
        .forEach(function (el) {
          row[el.getAttribute('data-field')] = el.value;
        });
      providers[provId] = row;
    });

    var bot = { botId: state.botId };
    document
      .querySelectorAll('[data-ch="' + channelId + '"][data-bot-field]')
      .forEach(function (el) {
        bot[el.getAttribute('data-bot-field')] = el.value;
      });

    var enabledEl = document.querySelector('[data-ch="' + channelId + '"][data-enabled-toggle]');
    var activeEl = document.querySelector('[data-ch="' + channelId + '"][data-active-provider]');

    return {
      enabled: !!(enabledEl && enabledEl.checked),
      activeProvider: activeEl ? activeEl.value : 'meta',
      providers: providers,
      bot: bot,
    };
  }

  function setChannelStatus(channelId, msg, isError) {
    var el = document.getElementById('socialStatus-' + channelId);
    if (!el) return;
    el.textContent = msg || '';
    el.className =
      'social-form-status' + (isError ? ' social-form-status--error' : ' social-form-status--ok');
    el.hidden = !msg;
  }

  function saveChannel(channelId) {
    setChannelStatus(channelId, 'Saving…', false);
    return fetch(channelApi(state.botId, channelId), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders()),
      body: JSON.stringify(collectChannelPayload(channelId)),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) {
          throw new Error('Not signed in — enter desk token first.');
        }
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Save failed');
        }
        state.channels[channelId] = result.body;
        var savedEnabled = !!(result.body.config && result.body.config.enabled);
        setChannelStatus(
          channelId,
          'Saved — Bot ' +
            state.botId +
            (savedEnabled ? ' · channel enabled (live).' : ' · credentials saved, channel disabled.'),
          false
        );
        return loadSummary().then(function () {
          var panel = panelRoot(channelId);
          if (panel) {
            panel.innerHTML = renderChannelForm(channelId, result.body);
            bindChannelPanel(channelId);
          }
          updateTabBadges();
        });
      })
      .catch(function (err) {
        setChannelStatus(channelId, err.message || 'Request failed', true);
      });
  }

  function loadChannelPanel(channelId) {
    var body = panelRoot(channelId);
    if (!body) return Promise.resolve();

    if (state.channels[channelId]) {
      body.innerHTML = renderChannelForm(channelId, state.channels[channelId]);
      bindChannelPanel(channelId);
      return Promise.resolve();
    }

    return fetch(channelApi(state.botId, channelId), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Load failed');
        }
        state.channels[channelId] = result.body;
        body.innerHTML = renderChannelForm(channelId, result.body);
        bindChannelPanel(channelId);
      })
      .catch(function (err) {
        body.innerHTML =
          '<p class="dash-muted" style="padding-top:1rem">' + esc(err.message) + '</p>';
      });
  }

  function loadSummary() {
    var botId = currentBotId();
    if (!botId) return Promise.resolve();

    state.botId = botId;
    state.channels = {};

    return fetch(apiBase() + '/api/social-integration/' + encodeURIComponent(botId), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not load');
        }
        state.summary = result.body;
        state.botName = result.body.botName || botId;
        updateTabBadges();
        CHANNELS.forEach(setIntro);
      });
  }

  function init() {
    return loadSummary();
  }

  window.ChannelsIntegrationSocial = {
    init: init,
    loadSummary: loadSummary,
    loadChannel: loadChannel,
    updateTabBadges: updateTabBadges,
  };

  updateTabBadges();
})(typeof window !== 'undefined' ? window : this);
