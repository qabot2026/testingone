(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;

  if (!auth || !auth.requireAuthOrRedirect('dashboard/faqs.html')) return;

  function $(id) {
    return document.getElementById(id);
  }

  function apiBase() {
    return auth.apiBase();
  }

  function headers() {
    return auth.authHeaders({ 'Content-Type': 'application/json' });
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

  var ICON_EDIT =
    '<svg class="faq-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 20h9"/>' +
    '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
    '</svg>';

  var ICON_DELETE =
    '<svg class="faq-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/>' +
    '</svg>';

  function actionIconBtn(className, iconSvg, label) {
    return (
      '<button type="button" class="faq-icon-btn ' +
      className +
      '" title="' +
      esc(label) +
      '" aria-label="' +
      esc(label) +
      '">' +
      iconSvg +
      '</button>'
    );
  }

  var cachedFaqs = [];
  var pageState = {
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };

  function getPageSize() {
    var el = $('faq-page-size');
    var n = el ? parseInt(el.value, 10) : 10;
    if ([10, 20, 50].indexOf(n) < 0) n = 10;
    pageState.pageSize = n;
    return n;
  }

  function paginateList(items) {
    var list = Array.isArray(items) ? items : [];
    var limit = getPageSize();
    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    var page = Math.min(Math.max(pageState.page || 1, 1), totalPages);
    var offset = (page - 1) * limit;
    pageState.page = page;
    pageState.totalPages = totalPages;
    return {
      items: list.slice(offset, offset + limit),
      offset: offset,
      page: page,
      limit: limit,
      total: total,
      totalPages: totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };
  }

  function syncPager(meta) {
    var pager = $('faq-pager');
    var hint = $('faq-page-hint');
    var pageEl = $('faq-page-num');
    var first = $('faq-page-first');
    var prev = $('faq-page-prev');
    var next = $('faq-page-next');
    var last = $('faq-page-last');
    if (!pager || !meta || !meta.total) {
      if (pager) pager.hidden = true;
      return;
    }
    if (meta.totalPages <= 1) {
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
        meta.total + ' FAQs, ' + meta.limit + ' per page';
    }
  }

  function goToPage(page) {
    pageState.page = Math.max(1, Number(page) || 1);
    renderList(cachedFaqs);
  }

  function afterAnswerPhrase(item) {
    var phrase = String((item && item.nextIntentPhrase) || '').trim();
    if (phrase) return phrase;
    return String((item && item.nextIntent) || '').trim();
  }

  function setStatus(elId, msg, isError) {
    var el = $(elId);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'faq-status' + (isError ? ' faq-status--error' : ' faq-status--ok');
    el.hidden = !msg;
  }

  function botId() {
    return nav.getBid();
  }

  function resetForm() {
    $('faq-edit-id').value = '';
    $('faq-question').value = '';
    $('faq-answer').value = '';
    $('faq-published').checked = true;
    if ($('faq-next-phrase')) $('faq-next-phrase').value = '';
    $('faq-cancel-btn').hidden = true;
    $('faq-save-btn').textContent = 'Save FAQ';
  }

  function saveAfterAnswerPhrase(item, phrase, inputEl) {
    if (!item || !item.id) return;
    if (inputEl) inputEl.disabled = true;
    fetch(apiBase() + '/api/faqs/' + encodeURIComponent(botId()), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify({
        id: item.id,
        question: item.question,
        answer: item.answer,
        published: item.published !== false,
        nextIntentPhrase: phrase,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not save training phrase');
        }
        item.nextIntentPhrase = phrase;
        item.nextIntent = '';
        var idx = cachedFaqs.findIndex(function (x) {
          return x.id === item.id;
        });
        if (idx >= 0) {
          cachedFaqs[idx] = Object.assign({}, cachedFaqs[idx], {
            nextIntentPhrase: phrase,
            nextIntent: '',
          });
        }
        setStatus('faq-list-status', 'After this answer updated.', false);
      })
      .catch(function (err) {
        if (inputEl) inputEl.value = afterAnswerPhrase(item);
        setStatus('faq-list-status', err.message || 'Save failed', true);
      })
      .finally(function () {
        if (inputEl) inputEl.disabled = false;
      });
  }

  function loadFaqs() {
    setStatus('faq-list-status', 'Loading…', false);
    fetch(apiBase() + '/api/faqs/' + encodeURIComponent(botId()), {
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
          throw new Error((result.body && result.body.error) || 'Could not load FAQs');
        }
        cachedFaqs = result.body.items || [];
        pageState.page = 1;
        renderList(cachedFaqs);
        setStatus('faq-list-status', cachedFaqs.length + ' FAQ(s) loaded.', false);
      })
      .catch(function (err) {
        renderList([]);
        setStatus('faq-list-status', err.message || 'Load failed', true);
      });
  }

  function renderList(items) {
    var el = $('faq-list');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<p class="dash-muted">No FAQs yet. Add your first question above.</p>';
      syncPager(null);
      return;
    }

    var page = paginateList(items);
    el.innerHTML = page.items
      .map(function (item, idx) {
        var num = page.offset + idx + 1;
        var phrase = afterAnswerPhrase(item);
        return (
          '<article class="faq-item' +
          (item.published === false ? ' is-draft' : '') +
          '" data-faq-id="' +
          esc(item.id) +
          '">' +
          '<div class="faq-item__head">' +
          '<span class="faq-item__num" aria-label="FAQ ' +
          num +
          '">' +
          num +
          '</span>' +
          '<div class="faq-item__main">' +
          '<div class="faq-item__row faq-item__row--q">' +
          '<span class="faq-item__mark faq-item__mark--q" aria-hidden="true">Q</span>' +
          '<p class="faq-item__q">' +
          esc(item.question) +
          (item.published === false ? ' <span class="dash-muted">(draft)</span>' : '') +
          '</p></div>' +
          '<div class="faq-item__row faq-item__row--a">' +
          '<span class="faq-item__mark faq-item__mark--a" aria-hidden="true">A</span>' +
          '<p class="faq-item__a">' +
          esc(item.answer) +
          '</p></div>' +
          '<div class="faq-item__meta">' +
          '<label class="faq-after-answer-label">After this answer' +
          '<input type="text" class="faq-after-answer-input" value="' +
          escAttr(phrase) +
          '" placeholder="Training phrase (e.g. price, main menu)" aria-label="After this answer for ' +
          escAttr(item.question) +
          '" /></label></div></div>' +
          '<div class="faq-item__actions">' +
          actionIconBtn('faq-icon-btn--edit faq-edit-btn', ICON_EDIT, 'Edit') +
          actionIconBtn('faq-icon-btn--delete faq-delete-btn', ICON_DELETE, 'Delete') +
          '</div></div></article>'
        );
      })
      .join('');

    syncPager(page);

    el.querySelectorAll('.faq-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('[data-faq-id]');
        var id = card.getAttribute('data-faq-id');
        var item = cachedFaqs.find(function (x) {
          return x.id === id;
        });
        if (!item) return;
        $('faq-edit-id').value = item.id;
        $('faq-question').value = item.question || '';
        $('faq-answer').value = item.answer || '';
        $('faq-published').checked = item.published !== false;
        if ($('faq-next-phrase')) $('faq-next-phrase').value = afterAnswerPhrase(item);
        $('faq-cancel-btn').hidden = false;
        $('faq-save-btn').textContent = 'Update FAQ';
        $('faq-question').focus();
      });
    });

    el.querySelectorAll('.faq-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('[data-faq-id]');
        var id = card.getAttribute('data-faq-id');
        if (!window.confirm('Delete this FAQ?')) return;
        fetch(
          apiBase() + '/api/faqs/' + encodeURIComponent(botId()) + '/' + encodeURIComponent(id),
          {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: auth.authHeaders(),
          }
        )
          .then(function (res) {
            return res.json();
          })
          .then(function (body) {
            if (!body.ok) throw new Error(body.error || 'Delete failed');
            loadFaqs();
          })
          .catch(function (err) {
            setStatus('faq-list-status', err.message || 'Delete failed', true);
          });
      });
    });

    el.querySelectorAll('.faq-after-answer-input').forEach(function (input) {
      input.addEventListener('change', function () {
        var card = input.closest('[data-faq-id]');
        var id = card && card.getAttribute('data-faq-id');
        var item = cachedFaqs.find(function (x) {
          return x.id === id;
        });
        if (!item) return;
        saveAfterAnswerPhrase(item, input.value.trim(), input);
      });
    });
  }

  function saveFaq(ev) {
    ev.preventDefault();
    var payload = {
      id: $('faq-edit-id').value.trim(),
      question: $('faq-question').value.trim(),
      answer: $('faq-answer').value.trim(),
      published: $('faq-published').checked,
      nextIntentPhrase: $('faq-next-phrase') ? $('faq-next-phrase').value.trim() : '',
    };
    if (!payload.question || !payload.answer) {
      setStatus('faq-form-status', 'Question and answer are required.', true);
      return;
    }
    $('faq-save-btn').disabled = true;
    setStatus('faq-form-status', 'Saving…', false);
    fetch(apiBase() + '/api/faqs/' + encodeURIComponent(botId()), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify(payload),
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
        resetForm();
        setStatus('faq-form-status', 'FAQ saved.', false);
        loadFaqs();
      })
      .catch(function (err) {
        setStatus('faq-form-status', err.message || 'Save failed', true);
      })
      .finally(function () {
        $('faq-save-btn').disabled = false;
      });
  }

  function init() {
    var bid = botId();
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid;
      }) || nav.BOTS[0];

    nav.mount({
      active: 'faqs',
      title: 'FAQs',
      subtitle: bot.name + ' (Bot ID ' + bot.id + ')',
    });

    $('faq-form').addEventListener('submit', saveFaq);
    $('faq-cancel-btn').addEventListener('click', resetForm);
    $('faq-refresh').addEventListener('click', loadFaqs);
    if ($('faq-page-size')) {
      $('faq-page-size').addEventListener('change', function () {
        pageState.page = 1;
        renderList(cachedFaqs);
      });
    }
    if ($('faq-page-first')) {
      $('faq-page-first').addEventListener('click', function () {
        if (this.disabled) return;
        goToPage(1);
      });
    }
    if ($('faq-page-prev')) {
      $('faq-page-prev').addEventListener('click', function () {
        if (this.disabled) return;
        goToPage(pageState.page - 1);
      });
    }
    if ($('faq-page-next')) {
      $('faq-page-next').addEventListener('click', function () {
        if (this.disabled) return;
        goToPage(pageState.page + 1);
      });
    }
    if ($('faq-page-last')) {
      $('faq-page-last').addEventListener('click', function () {
        if (this.disabled) return;
        goToPage(pageState.totalPages);
      });
    }
    loadFaqs();
  }

  nav.whenReady(init);
})();
