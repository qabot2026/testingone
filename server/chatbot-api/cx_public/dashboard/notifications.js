(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;
  if (!auth || !auth.requireAuthOrRedirect('dashboard/notifications.html')) return;

  var TEMPLATE_DELIVERY_CLIENT_KEYS = ['leadCapture', 'hotLead', 'appointmentClient'];
  var CLIENT_MAIL_PREFIXES = ['td-leadCapture', 'td-hotLead', 'td-appointmentClient'];
  var MAIL_PREFIXES = CLIENT_MAIL_PREFIXES.concat(['daily', 'weekly']);
  var TIME12_SELECT_IDS = ['daily-time', 'weekly-time'];

  function $(id) {
    return document.getElementById(id);
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

  function setStatus(msg, isError) {
    var el = $('notifications-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('notifications-status--error', !!isError);
    el.classList.toggle('notifications-status--ok', !!msg && !isError);
  }

  function parseRecipients(text) {
    return String(text || '')
      .split(/[\n,;]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function recipientsToText(list) {
    return (list || []).join(', ');
  }

  function buildTime12Options(select) {
    if (!select || select.options.length) return;
    for (var h = 1; h <= 12; h += 1) {
      for (var ampm = 0; ampm < 2; ampm += 1) {
        var period = ampm ? 'PM' : 'AM';
        var hour24 = h === 12 ? (ampm ? 12 : 0) : ampm ? h + 12 : h;
        var value = String(hour24).padStart(2, '0') + ':00';
        var opt = document.createElement('option');
        opt.value = value;
        opt.textContent = h + ':00 ' + period;
        select.appendChild(opt);
      }
    }
  }

  function initTime12Selects() {
    TIME12_SELECT_IDS.forEach(function (id) {
      buildTime12Options($(id));
    });
  }

  function setTime12Select(id, time24) {
    var select = $(id);
    if (!select) return;
    var match = String(time24 || '10:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      select.value = '10:00';
      return;
    }
    var hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
    select.value = String(hour).padStart(2, '0') + ':00';
  }

  function getTime12Select(id) {
    var select = $(id);
    return (select && select.value) || '10:00';
  }

  function mailExtraBtn(prefix, kind) {
    return document.querySelector(
      '.notifications-add-' + kind + '[data-prefix="' + prefix + '"]'
    );
  }

  function syncMailExtraUI(prefix) {
    var ccWrap = $(prefix + '-cc-wrap');
    var bccWrap = $(prefix + '-bcc-wrap');
    var ccEl = $(prefix + '-cc');
    var bccEl = $(prefix + '-bcc');
    var ccBtn = mailExtraBtn(prefix, 'cc');
    var bccBtn = mailExtraBtn(prefix, 'bcc');
    var showCc = ccEl && parseRecipients(ccEl.value).length > 0;
    var showBcc = bccEl && parseRecipients(bccEl.value).length > 0;
    if (ccWrap) {
      ccWrap.classList.toggle('is-visible', showCc);
    }
    if (bccWrap) {
      bccWrap.classList.toggle('is-visible', showBcc);
    }
    if (ccBtn) ccBtn.hidden = showCc;
    if (bccBtn) bccBtn.hidden = showBcc;
    var extra = ccBtn && ccBtn.parentElement;
    if (extra && extra.classList.contains('notifications-mail-extra')) {
      extra.hidden = !!(ccBtn && ccBtn.hidden && bccBtn && bccBtn.hidden);
    }
  }

  function revealMailExtra(prefix, kind) {
    var wrap = $(prefix + '-' + kind + '-wrap');
    var btn = mailExtraBtn(prefix, kind);
    if (wrap) wrap.classList.add('is-visible');
    if (btn) btn.hidden = true;
    var extra = btn && btn.parentElement;
    if (extra && extra.classList.contains('notifications-mail-extra')) {
      var ccBtn = mailExtraBtn(prefix, 'cc');
      var bccBtn = mailExtraBtn(prefix, 'bcc');
      extra.hidden = !!(ccBtn && ccBtn.hidden && bccBtn && bccBtn.hidden);
    }
    var el = $(prefix + '-' + kind);
    if (el) el.focus();
  }

  function resetAllMailExtraUI() {
    document.querySelectorAll('.notifications-mail-extra-field').forEach(function (wrap) {
      wrap.classList.remove('is-visible');
    });
    document.querySelectorAll('.notifications-add-cc, .notifications-add-bcc').forEach(function (btn) {
      btn.hidden = false;
    });
    document.querySelectorAll('.notifications-mail-extra').forEach(function (el) {
      el.hidden = false;
    });
  }

  function initMailExtraButtons() {
    document.querySelectorAll('.notifications-add-cc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        revealMailExtra(btn.getAttribute('data-prefix'), 'cc');
      });
    });
    document.querySelectorAll('.notifications-add-bcc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        revealMailExtra(btn.getAttribute('data-prefix'), 'bcc');
      });
    });
  }

  function syncAllMailExtraUI() {
    MAIL_PREFIXES.forEach(syncMailExtraUI);
  }

  function fillMailFields(prefix, mail) {
    mail = mail || {};
    var legacy = mail.recipients || [];
    var toEl = $(prefix + '-to');
    var ccEl = $(prefix + '-cc');
    var bccEl = $(prefix + '-bcc');
    if (toEl) {
      toEl.value = recipientsToText(
        mail.to && mail.to.length ? mail.to : legacy
      );
    }
    if (ccEl) ccEl.value = recipientsToText(mail.cc);
    if (bccEl) bccEl.value = recipientsToText(mail.bcc);
    syncMailExtraUI(prefix);
  }

  function collectMailFields(prefix) {
    return {
      to: parseRecipients($(prefix + '-to') && $(prefix + '-to').value),
      cc: parseRecipients($(prefix + '-cc') && $(prefix + '-cc').value),
      bcc: parseRecipients($(prefix + '-bcc') && $(prefix + '-bcc').value),
    };
  }

  function fillTemplateDelivery(td) {
    td = td || {};
    TEMPLATE_DELIVERY_CLIENT_KEYS.forEach(function (key) {
      fillMailFields('td-' + key, td[key] || {});
    });
  }

  function collectTemplateDelivery() {
    var out = {};
    TEMPLATE_DELIVERY_CLIENT_KEYS.forEach(function (key) {
      out[key] = Object.assign({ enabled: true }, collectMailFields('td-' + key));
    });
    return out;
  }

  function fillForm(cfg) {
    cfg = cfg || {};
    $('instant-enabled').checked = !!(cfg.instantLead && cfg.instantLead.enabled);
    $('instant-delay').value =
      cfg.instantLead && cfg.instantLead.delayMinutes != null
        ? String(cfg.instantLead.delayMinutes)
        : '0';

    var cond = (cfg.instantLead && cfg.instantLead.conditions) || {};
    $('cond-require-contact').value = cond.requireContact || 'mobile_or_email';
    $('cond-visitor-type').value = cond.visitorType || 'any';
    $('cond-appointment').value = cond.requireAppointmentBooked || 'any';
    $('cond-min-turns').value = cond.minUserTurns != null ? String(cond.minUserTurns) : '0';

    fillTemplateDelivery(cfg.templateDelivery);

    $('daily-enabled').checked = !!(cfg.dailyReport && cfg.dailyReport.enabled);
    setTime12Select('daily-time', (cfg.dailyReport && cfg.dailyReport.time) || '10:00');
    if (window.ESTimezoneOptions) {
      ESTimezoneOptions.fillSelect(
        $('daily-timezone'),
        (cfg.dailyReport && cfg.dailyReport.timezone) || ESTimezoneOptions.DEFAULT
      );
    } else if ($('daily-timezone')) {
      $('daily-timezone').value =
        (cfg.dailyReport && cfg.dailyReport.timezone) || 'Asia/Kolkata';
    }
    fillMailFields('daily', cfg.dailyReport || {});

    $('weekly-enabled').checked = !!(cfg.weeklyReport && cfg.weeklyReport.enabled);
    $('weekly-day').value = String(
      cfg.weeklyReport && cfg.weeklyReport.dayOfWeek != null ? cfg.weeklyReport.dayOfWeek : 1
    );
    setTime12Select('weekly-time', (cfg.weeklyReport && cfg.weeklyReport.time) || '10:00');
    if (window.ESTimezoneOptions) {
      ESTimezoneOptions.fillSelect(
        $('weekly-timezone'),
        (cfg.weeklyReport && cfg.weeklyReport.timezone) || ESTimezoneOptions.DEFAULT
      );
    } else if ($('weekly-timezone')) {
      $('weekly-timezone').value =
        (cfg.weeklyReport && cfg.weeklyReport.timezone) || 'Asia/Kolkata';
    }
    fillMailFields('weekly', cfg.weeklyReport || {});
  }

  function collectPayload() {
    return {
      instantLead: {
        enabled: $('instant-enabled').checked,
        delayMinutes: parseInt($('instant-delay').value, 10) || 0,
        conditions: {
          requireContact: $('cond-require-contact').value,
          visitorType: $('cond-visitor-type').value,
          requireAppointmentBooked: $('cond-appointment').value,
          minUserTurns: parseInt($('cond-min-turns').value, 10) || 0,
          intentsAllow: '',
          intentsBlock: '',
          blockIfFallback: false,
        },
      },
      templateDelivery: collectTemplateDelivery(),
      dailyReport: Object.assign(
        {
          enabled: $('daily-enabled').checked,
          time: getTime12Select('daily-time'),
          timezone: $('daily-timezone').value.trim() || 'Asia/Kolkata',
        },
        collectMailFields('daily')
      ),
      weeklyReport: Object.assign(
        {
          enabled: $('weekly-enabled').checked,
          dayOfWeek: parseInt($('weekly-day').value, 10),
          time: getTime12Select('weekly-time'),
          timezone: $('weekly-timezone').value.trim() || 'Asia/Kolkata',
        },
        collectMailFields('weekly')
      ),
    };
  }

  function load() {
    setStatus('Loading…', false);
    return fetch(authedUrl('/api/lead-notifications/' + encodeURIComponent(bid())), {
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
          throw new Error((result.body && result.body.error) || 'Could not load settings');
        }
        fillForm(result.body.config);
        setStatus('', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Load failed', true);
      });
  }

  function save() {
    $('notifications-save').disabled = true;
    setStatus('Saving…', false);
    return fetch(authedUrl('/api/lead-notifications/' + encodeURIComponent(bid())), {
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
        fillForm(result.body.config);
        setStatus('Settings saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Save failed', true);
      })
      .finally(function () {
        $('notifications-save').disabled = false;
      });
  }

  function sendTest(kind) {
    setStatus('Sending test ' + kind + ' email…', false);
    return fetch(
      authedUrl('/api/lead-notifications/' + encodeURIComponent(bid()) + '/test'),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(),
        body: JSON.stringify({ kind: kind }),
      }
    )
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Test send failed');
        }
        setStatus('Test ' + kind + ' email sent.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Test send failed', true);
      });
  }

  function init() {
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid();
      }) || nav.BOTS[0];

    nav.mount({
      active: 'notifications',
      title: 'Email Notifications',
      subtitle: bot.name + ' · Bot ID ' + bot.id,
      bid: bid(),
    });

    var templatesLink = document.getElementById('notifications-templates-link');
    if (templatesLink) {
      templatesLink.href =
        '/super/email-templates.html?bid=' + encodeURIComponent(bid());
    }
    var integrationLink = document.getElementById('notifications-integration-link');
    if (integrationLink) {
      integrationLink.href =
        '/super/email-templates.html?bid=' + encodeURIComponent(bid()) + '#email-integration';
    }

    initTime12Selects();
    $('notifications-save').addEventListener('click', save);
    resetAllMailExtraUI();
    initMailExtraButtons();
    if (window.ESTimezoneOptions) {
      ESTimezoneOptions.initSelects(document);
    }
    document.querySelectorAll('[data-test]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendTest(btn.getAttribute('data-test'));
      });
    });
    load().then(syncAllMailExtraUI);
  }

  nav.whenReady(init);
})();
