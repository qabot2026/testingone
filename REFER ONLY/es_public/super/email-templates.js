(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;
  if (!auth || !auth.requireAuthOrRedirect('super/email-templates.html')) return;

  var templateKeys = [];

  function $(id) {
    return document.getElementById(id);
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function headers() {
    return Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders());
  }

  function authedUrl(path) {
    var url = auth.apiBase() + path;
    return auth.withAuthQuery ? auth.withAuthQuery(url) : url;
  }

  function bid() {
    return nav.getBid();
  }

  function setIntegrationStatus(msg, isError) {
    var el = document.getElementById('email-integration-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('email-integration-status--error', !!isError);
    el.classList.toggle('email-integration-status--ok', !!msg && !isError);
  }

  function currentBotName() {
    var botId = nav.getBid ? nav.getBid() : '';
    var bot =
      (nav.BOTS || []).find(function (b) {
        return b.id === botId;
      }) || nav.BOTS[0];
    return (bot && bot.name) || botId || 'Bot';
  }

  function updateTestBotHint() {
    var el = document.getElementById('email-test-bot-hint');
    if (!el) return;
    el.textContent =
      'Test email includes Agent — ' + currentBotName() + ' (current sidebar bot).';
  }

  function selectedProvider() {
    return document.getElementById('email-provider-resend').checked ? 'resend' : 'smtp';
  }

  function syncProviderSections() {
    var isResend = selectedProvider() === 'resend';
    document.getElementById('email-resend-section').hidden = !isResend;
    document.getElementById('email-smtp-section').hidden = isResend;
  }

  function setReadOnlyFromEnv(isEnv) {
    var ids = [
      'email-enabled',
      'email-provider-resend',
      'email-provider-smtp',
      'email-resend-key',
      'email-resend-from-name',
      'email-resend-from-email',
      'email-host',
      'email-port',
      'email-user',
      'email-password',
      'email-from-name',
      'email-from-email',
      'email-reply-to',
      'email-test-recipient',
      'email-secure',
      'email-save-btn',
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!isEnv;
    });
  }

  function syncSecureWithPort() {
    var port = parseInt(document.getElementById('email-port').value, 10) || 587;
    var secureEl = document.getElementById('email-secure');
    if (!secureEl) return;
    if (port === 465) secureEl.checked = true;
    else if (port === 587 || port === 25) secureEl.checked = false;
  }

  function fillIntegrationForm(data) {
    var smtp = (data && data.smtp) || {};
    var resend = (data && data.resend) || {};
    document.getElementById('email-enabled').checked = !!data.enabled;
    if (data.provider === 'resend') {
      document.getElementById('email-provider-resend').checked = true;
    } else {
      document.getElementById('email-provider-smtp').checked = true;
    }
    syncProviderSections();

    document.getElementById('email-resend-key').value = '';
    document.getElementById('email-resend-from-name').value = resend.fromName || 'Chatbot Leads';
    document.getElementById('email-resend-from-email').value = resend.fromEmail || '';
    document.getElementById('email-resend-key-hint').textContent = resend.apiKeySet
      ? 'Saved key ' + (resend.apiKeyHint || '••••') + ' — leave blank to keep.'
      : 'No API key saved yet.';

    document.getElementById('email-host').value = smtp.host || '';
    document.getElementById('email-port').value = smtp.port != null ? String(smtp.port) : '587';
    document.getElementById('email-user').value = smtp.user || '';
    document.getElementById('email-password').value = '';
    document.getElementById('email-from-name').value = smtp.fromName || 'Chatbot Leads';
    document.getElementById('email-from-email').value = smtp.fromEmail || '';
    document.getElementById('email-reply-to').value = data.replyTo || '';
    document.getElementById('email-test-recipient').value = data.testRecipient || '';
    document.getElementById('email-secure').checked = !!smtp.secure;
    syncSecureWithPort();
    document.getElementById('email-password-hint').textContent = smtp.passwordSet
      ? 'Saved password ' + (smtp.passwordHint || '••••') + ' — leave blank to keep.'
      : 'No password saved yet.';

    var badge = 'Dashboard file';
    if (data.source === 'resend-env') badge = 'Resend env';
    else if (data.source === 'smtp-env') badge = 'SMTP env';
    document.getElementById('email-source-badge').textContent =
      (data.provider === 'resend' ? 'Resend' : 'SMTP') + ' · ' + badge;
    setReadOnlyFromEnv(data.source === 'resend-env' || data.source === 'smtp-env');
  }

  function collectIntegrationPayload() {
    var provider = selectedProvider();
    var payload = {
      enabled: document.getElementById('email-enabled').checked,
      provider: provider,
      replyTo: document.getElementById('email-reply-to').value.trim(),
      testRecipient: document.getElementById('email-test-recipient').value.trim(),
    };
    if (provider === 'resend') {
      payload.resend = {
        enabled: true,
        apiKey: document.getElementById('email-resend-key').value,
        fromName: document.getElementById('email-resend-from-name').value.trim(),
        fromEmail: document.getElementById('email-resend-from-email').value.trim(),
      };
    } else {
      payload.smtp = {
        host: document.getElementById('email-host').value.trim(),
        port: parseInt(document.getElementById('email-port').value, 10) || 587,
        secure: document.getElementById('email-secure').checked,
        user: document.getElementById('email-user').value.trim(),
        password: document.getElementById('email-password').value,
        fromName: document.getElementById('email-from-name').value.trim(),
        fromEmail: document.getElementById('email-from-email').value.trim(),
      };
    }
    return payload;
  }

  function loadIntegration() {
    setIntegrationStatus('Loading…', false);
    return fetch(authedUrl('/api/email-integration'), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok) throw new Error(body.error || 'Load failed');
        fillIntegrationForm(body);
        setIntegrationStatus('', false);
      })
      .catch(function (err) {
        setIntegrationStatus(err.message || 'Load failed', true);
      });
  }

  function saveIntegration(ev) {
    if (ev) ev.preventDefault();
    document.getElementById('email-save-btn').disabled = true;
    setIntegrationStatus('Saving…', false);
    return fetch(authedUrl('/api/email-integration'), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify(collectIntegrationPayload()),
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
        fillIntegrationForm(result.body.config);
        setIntegrationStatus('Email settings saved.', false);
      })
      .catch(function (err) {
        setIntegrationStatus(err.message || 'Save failed', true);
      })
      .finally(function () {
        document.getElementById('email-save-btn').disabled = false;
      });
  }

  function sendIntegrationTest() {
    var testBtn = document.getElementById('email-test-btn');
    var recipient = document.getElementById('email-test-recipient').value.trim();
    if (!recipient) {
      setIntegrationStatus('Enter a test recipient email first.', true);
      return Promise.resolve();
    }
    if (testBtn) testBtn.disabled = true;
    setIntegrationStatus('Sending test email…', false);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () {
          controller.abort();
        }, 45000)
      : null;
    return fetch(authedUrl('/api/email-integration/test'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify({ to: recipient, botId: nav.getBid ? nav.getBid() : '' }),
      signal: controller ? controller.signal : undefined,
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
        setIntegrationStatus(
          'Test email sent to ' +
            result.body.to +
            (result.body.botName ? ' (Agent — ' + result.body.botName + ')' : '') +
            '. Check inbox and spam.',
          false
        );
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          setIntegrationStatus(
            'Test timed out. On Railway Hobby, SMTP is blocked — switch to Resend API and save, then retry.',
            true
          );
          return;
        }
        setIntegrationStatus(err.message || 'Test failed', true);
      })
      .finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
        if (testBtn) testBtn.disabled = false;
      });
  }

  function initIntegration() {
    if (!document.getElementById('emailIntegrationForm')) return;
    updateTestBotHint();
    document
      .getElementById('email-provider-resend')
      .addEventListener('change', syncProviderSections);
    document
      .getElementById('email-provider-smtp')
      .addEventListener('change', syncProviderSections);
    document.getElementById('email-port').addEventListener('change', syncSecureWithPort);
    document.getElementById('email-port').addEventListener('input', syncSecureWithPort);
    document.getElementById('emailIntegrationForm').addEventListener('submit', saveIntegration);
    document.getElementById('email-test-btn').addEventListener('click', sendIntegrationTest);
    loadIntegration();
  }

  function setStatus(msg, isError) {
    var el = $('email-templates-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('email-templates-status--error', !!isError);
    el.classList.toggle('email-templates-status--ok', !!msg && !isError);
  }

  function cardEl(key) {
    return document.querySelector('.email-templates-card[data-template="' + key + '"]');
  }

  function readTemplate(key) {
    var card = cardEl(key);
    if (!card) return {};
    return {
      enabled: card.querySelector('[data-field="enabled"]').checked,
      subject: card.querySelector('[data-field="subject"]').value.trim(),
      body: card.querySelector('[data-field="body"]').value,
    };
  }

  function fillTemplate(key, tpl) {
    var card = cardEl(key);
    if (!card || !tpl) return;
    card.querySelector('[data-field="enabled"]').checked = !!tpl.enabled;
    card.querySelector('[data-field="subject"]').value = tpl.subject || '';
    card.querySelector('[data-field="body"]').value = tpl.body || '';
  }

  function fillVarHints(hints) {
    var list = $('email-templates-var-list');
    if (!list) return;
    list.innerHTML = (hints || [])
      .map(function (h) {
        return '<li><code>' + escHtml(h.token) + '</code> — ' + escHtml(h.desc) + '</li>';
      })
      .join('');
  }

  function renderCards(catalog) {
    var list = $('email-templates-list');
    if (!list) return;
    templateKeys = (catalog || []).map(function (item) {
      return item.key;
    });
    list.innerHTML = (catalog || [])
      .map(function (item) {
        return (
          '<section class="email-templates-card" data-template="' +
          escHtml(item.key) +
          '">' +
          '<div class="email-templates-card__head">' +
          '<h2>' +
          escHtml(item.number) +
          ' — ' +
          escHtml(item.label) +
          '</h2>' +
          '<label class="email-templates-toggle">' +
          '<input type="checkbox" data-field="enabled" />' +
          '<span>Enabled</span>' +
          '</label>' +
          '</div>' +
          '<label class="email-templates-field">Subject' +
          '<input type="text" data-field="subject" />' +
          '</label>' +
          '<label class="email-templates-field">Message (plain text)' +
          '<textarea rows="12" data-field="body"></textarea>' +
          '</label>' +
          '<button type="button" class="dash-btn dash-btn--ghost" data-test="' +
          escHtml(item.key) +
          '">Send test</button>' +
          '</section>'
        );
      })
      .join('');

    list.querySelectorAll('[data-test]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendTest(btn.getAttribute('data-test'));
      });
    });
  }

  function collectPayload() {
    var out = {};
    templateKeys.forEach(function (key) {
      out[key] = readTemplate(key);
    });
    return out;
  }

  function load() {
    setStatus('Loading…', false);
    return fetch(authedUrl('/api/email-templates/' + encodeURIComponent(bid())), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok) throw new Error(body.error || 'Load failed');
        renderCards(body.templateCatalog || []);
        var tpl = body.templates || {};
        templateKeys.forEach(function (key) {
          fillTemplate(key, tpl[key]);
        });
        fillVarHints(body.variableHints);
        setStatus('', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Load failed', true);
      });
  }

  function save() {
    $('email-templates-save').disabled = true;
    setStatus('Saving…', false);
    return fetch(authedUrl('/api/email-templates/' + encodeURIComponent(bid())), {
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
        var tpl = result.body.templates || {};
        templateKeys.forEach(function (key) {
          fillTemplate(key, tpl[key]);
        });
        setStatus('Templates saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Save failed', true);
      })
      .finally(function () {
        $('email-templates-save').disabled = false;
      });
  }

  function sendTest(templateKey) {
    setStatus('Sending test ' + templateKey + ' email…', false);
    return fetch(
      authedUrl('/api/email-templates/' + encodeURIComponent(bid()) + '/test'),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(),
        body: JSON.stringify({ templateKey: templateKey }),
      }
    )
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Test failed');
        }
        setStatus('Test email sent (' + templateKey + ') to ' + result.body.to + '.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Test failed', true);
      });
  }

  function init() {
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid();
      }) || nav.BOTS[0];

    nav.mount({
      active: 'email-templates',
      title: 'Email Templates',
      subtitle: (bot && bot.name) + ' · Bot ID ' + bid(),
      bid: bid(),
    });
    initIntegration();

    var link = $('email-templates-recipients-link');
    if (link) link.href = '/dashboard/notifications.html?bid=' + encodeURIComponent(bid());

    $('email-templates-save').addEventListener('click', save);
    load();
    if (location.hash === '#email-integration') {
      var target = document.getElementById('email-integration');
      if (target) {
        requestAnimationFrame(function () {
          target.scrollIntoView({ block: 'start' });
        });
      }
    }
  }

  nav.whenReady(init);
})();
