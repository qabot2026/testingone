(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('dashboard/test-links.html')) return;

  var ICON_COPY =
    '<svg class="test-icon-btn__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  var ICON_CHEV =
    '<svg class="test-bot-card__chev-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiBase() {
    return auth.apiBase().replace(/\/$/, '');
  }

  function absUrl(path) {
    var p = String(path || '').trim();
    if (!p) return apiBase();
    if (/^https?:\/\//i.test(p)) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    return apiBase() + p;
  }

  function setStatus(msg) {
    var el = $('test-links-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function copyText(text) {
    var value = String(text || '').trim();
    if (!value) return Promise.reject(new Error('Nothing to copy'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('Copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function copyIconBtn(className, label) {
    return (
      '<button type="button" class="test-icon-btn ' +
      esc(className) +
      '" aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '">' +
      ICON_COPY +
      '</button>'
    );
  }

  function incognitoShortcut() {
    var mac = /Mac|iPhone|iPad/i.test(navigator.userAgent || '');
    return mac ? '⌘⇧N' : 'Ctrl+Shift+N';
  }

  function showIncognitoModal(url) {
    var modal = $('test-links-modal');
    var text = $('test-links-modal-text');
    var urlEl = $('test-links-modal-url');
    if (!modal || !text || !urlEl) return;
    text.textContent =
      'Link copied. Browsers do not allow websites to open Incognito automatically. ' +
      'Press ' +
      incognitoShortcut() +
      ' for a private window, then paste the link in the address bar (Ctrl+V or ⌘V).';
    urlEl.textContent = url;
    modal.hidden = false;
  }

  function hideIncognitoModal() {
    var modal = $('test-links-modal');
    if (modal) modal.hidden = true;
  }

  function chatUrlForBot(bot) {
    if (bot.demoPath) return absUrl(bot.demoPath);
    var name = bot.name || 'bot';
    var slug = String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return absUrl('/' + (slug || 'bot-' + String(bot.id || '').slice(-3)) + '-demo.html');
  }

  function buildEmbedSnippet(bot) {
    var lines = ['<script>', '  window.ES_CONFIG = {'];
    var welcome = String(bot.welcomeEventName || '').trim();
    if (welcome) {
      lines.push("    welcomeEventName: '" + welcome.replace(/'/g, "\\'") + "',");
    }
    var preset = String(bot.sitePreset || '').trim();
    lines.push("    sitePreset: '" + preset.replace(/'/g, "\\'") + "',");
    lines.push('  };');
    lines.push('</script>');
    lines.push('<script src="' + apiBase() + '/embed.js" async></script>');
    return lines.join('\n');
  }

  function botCard(bot, isOpen) {
    var name = bot.name || 'Bot ' + bot.id;
    var url = chatUrlForBot(bot);
    var embed = buildEmbedSnippet(bot);
    return (
      '<article class="test-bot-card' +
      (isOpen ? ' is-open' : '') +
      '" data-bot-id="' +
      esc(bot.id) +
      '" data-chat-url="' +
      esc(url) +
      '">' +
      '<button type="button" class="test-bot-card__head" aria-expanded="' +
      (isOpen ? 'true' : 'false') +
      '">' +
      '<span class="test-bot-card__meta">' +
      '<strong class="test-bot-card__name">' +
      esc(name) +
      '</strong>' +
      '<span class="test-bot-card__id">Bot ID ' +
      esc(bot.id) +
      '</span>' +
      '</span>' +
      '<span class="test-bot-card__chev">' +
      ICON_CHEV +
      '</span>' +
      '</button>' +
      '<div class="test-bot-card__body">' +
      '<section class="test-block">' +
      '<div class="test-block__label-row">' +
      '<span class="test-block__label">Test page</span>' +
      copyIconBtn('test-copy-url', 'Copy test link') +
      '</div>' +
      '<code class="test-block__code" title="' +
      esc(url) +
      '">' +
      esc(url) +
      '</code>' +
      '<div class="test-bot-card__actions">' +
      '<button type="button" class="dash-btn dash-btn--primary test-btn-open">Open</button>' +
      '<button type="button" class="dash-btn dash-btn--ghost test-btn-incognito">Open in Incognito</button>' +
      '</div>' +
      '</section>' +
      '<section class="test-block test-block--embed">' +
      '<div class="test-block__label-row">' +
      '<div class="test-block__label-wrap">' +
      '<span class="test-block__label">Website embed</span>' +
      '<p class="test-block__hint">Paste this snippet into your website just before the closing &lt;/body&gt; tag.</p>' +
      '</div>' +
      copyIconBtn('test-copy-embed', 'Copy embed code') +
      '</div>' +
      '<pre class="test-embed-code">' +
      esc(embed) +
      '</pre>' +
      '</section>' +
      '</div>' +
      '</article>'
    );
  }

  function setOpenCard(root, openBotId) {
    root.querySelectorAll('.test-bot-card').forEach(function (card) {
      var id = card.getAttribute('data-bot-id') || '';
      var isOpen = !!openBotId && id === openBotId;
      card.classList.toggle('is-open', isOpen);
      var head = card.querySelector('.test-bot-card__head');
      if (head) head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  function wireAccordion(root) {
    root.querySelectorAll('.test-bot-card__head').forEach(function (head) {
      head.addEventListener('click', function () {
        var card = head.closest('.test-bot-card');
        if (!card) return;
        var botId = card.getAttribute('data-bot-id') || '';
        var isOpen = card.classList.contains('is-open');
        setOpenCard(root, isOpen ? null : botId);
      });
    });
  }

  function wireCopy(btn, getText, successMsg) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      copyText(getText())
        .then(function () {
          setStatus(successMsg);
          window.setTimeout(function () {
            setStatus('');
          }, 2200);
        })
        .catch(function () {
          setStatus('Could not copy.');
        });
    });
  }

  function wireCards(root) {
    root.querySelectorAll('.test-bot-card').forEach(function (card) {
      var url = card.getAttribute('data-chat-url') || '';
      var embedEl = card.querySelector('.test-embed-code');
      var embedText = embedEl ? embedEl.textContent : '';

      wireCopy(card.querySelector('.test-copy-url'), function () {
        return url;
      }, 'Test link copied.');

      wireCopy(card.querySelector('.test-copy-embed'), function () {
        return embedText;
      }, 'Embed code copied.');

      var openBtn = card.querySelector('.test-btn-open');
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          window.open(url, '_blank', 'noopener,noreferrer');
        });
      }

      var incogBtn = card.querySelector('.test-btn-incognito');
      if (incogBtn) {
        incogBtn.addEventListener('click', function () {
          copyText(url)
            .then(function () {
              showIncognitoModal(url);
            })
            .catch(function () {
              showIncognitoModal(url);
            });
        });
      }
    });
  }

  function loadLinks() {
    var root = $('test-links-root');
    if (!root) return;
    root.innerHTML = '<p class="dash-muted">Loading…</p>';

    fetch(apiBase() + '/api/bot-registry', { credentials: 'same-origin' })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok || !body.bots) throw new Error(body.error || 'Could not load bots');
        var bots = (body.bots || []).filter(function (b) {
          return b && b.id;
        });
        if (!bots.length) throw new Error('No chatbots found');
        root.innerHTML = bots.map(function (b) {
          return botCard(b, false);
        }).join('');
        wireAccordion(root);
        wireCards(root);
      })
      .catch(function (err) {
        var fallback = (nav.BOTS || []).map(function (b) {
          return {
            id: b.id,
            name: b.name,
            demoPath: b.demoPath || null,
            sitePreset: b.sitePreset || '',
            welcomeEventName: b.welcomeEventName || '',
          };
        });
        if (fallback.length) {
          root.innerHTML = fallback.map(function (b) {
            return botCard(b, false);
          }).join('');
          wireAccordion(root);
          wireCards(root);
          setStatus((err && err.message) || 'Using default bot list.');
          return;
        }
        root.innerHTML =
          '<p class="dash-muted">' + esc(err.message || 'Could not load links') + '</p>';
      });
  }

  function init() {
    nav.mount({
      active: 'test-links',
      title: 'Test links',
      subtitle: 'Demo pages and embed code for each bot',
    });

    var closeBtn = $('test-links-modal-close');
    var modal = $('test-links-modal');
    if (closeBtn) closeBtn.addEventListener('click', hideIncognitoModal);
    if (modal) {
      modal.addEventListener('click', function (ev) {
        if (ev.target === modal) hideIncognitoModal();
      });
    }

    loadLinks();
  }

  nav.whenReady(init);
})();
