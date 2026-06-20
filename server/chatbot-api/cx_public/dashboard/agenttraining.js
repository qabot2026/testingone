/**

 * Agent training — Intent (read-only) + Text response (editable) + in-table preview.

 */

(function () {

  'use strict';



  var auth = window.DashboardDeskAuth;

  var nav = window.DashboardNav;

  var ms = window.QAMessageSyntax;

  var richEditor = window.QaProvisionRichEditor;



  if (!auth || !auth.requireAuthOrRedirect('dashboard/agenttraining.html')) return;



  var cachedItems = [];

  var cachedBackups = [];

  var backupHighlightTimer = null;
  var liveBarClearTimer = null;
  var liveBarMode = '';

  var currentPage = 1;

  var PAGE_SIZE_OPTIONS = [25, 50, 100];

  var pageSize = 50;

  var PAGE_SIZE_KEY = 'qap-page-size';



  function loadPageSize() {

    try {

      var saved = parseInt(sessionStorage.getItem(PAGE_SIZE_KEY), 10);

      if (PAGE_SIZE_OPTIONS.indexOf(saved) >= 0) pageSize = saved;

    } catch (e) {

      /* ignore */

    }

  }



  function savePageSize() {

    try {

      sessionStorage.setItem(PAGE_SIZE_KEY, String(pageSize));

    } catch (e) {

      /* ignore */

    }

  }



  function syncPageSizeSelect() {

    var sel = $('qap-page-size');

    if (!sel) return;

    sel.value = String(pageSize);

  }



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



  function setStatus(id, msg, isError) {

    var el = $(id);

    if (!el) return;

    el.textContent = msg || '';

    el.hidden = !msg;

    el.classList.toggle('qap-status--error', !!isError);

  }



  function clearLiveBarTimer() {
    if (liveBarClearTimer) {
      clearTimeout(liveBarClearTimer);
      liveBarClearTimer = null;
    }
  }

  function setLiveBarMessage(msg, isError) {
    var el = $('qap-live-bar-msg');
    if (!el) return;
    clearLiveBarTimer();
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.remove('qap-live-bar-msg--error', 'qap-live-bar-msg--loading');
    if (!msg) {
      liveBarMode = '';
      return;
    }
    if (isError === 'loading') {
      el.classList.add('qap-live-bar-msg--loading');
      liveBarMode = 'loading';
      return;
    }
    el.classList.toggle('qap-live-bar-msg--error', !!isError);
    liveBarMode = isError ? 'error' : 'success';
    liveBarClearTimer = setTimeout(function () {
      liveBarMode = '';
      el.textContent = '';
      el.hidden = true;
      el.classList.remove('qap-live-bar-msg--error', 'qap-live-bar-msg--loading');
    }, 10000);
  }



  function formatLiveIntentCount(n) {

    var count = Number(n) || 0;

    if (count === 1) return 'New changes live for 1 intent.';

    return 'New changes live for ' + count + ' intents.';

  }



  function headersJson() {

    return Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders());

  }



  function provisionApi(path) {

    return auth.apiBase() + '/api/qa-provision' + (path || '');

  }



  function displayText(item) {

    if (!item) return '';

    var text = String(item.preview || item.draftResponse || item.response || '').trim();

    if (text === '(No text response in Dialogflow)') return '';

    return text;

  }



  function renderPreviewHtml(text) {

    if (richEditor && typeof richEditor.renderPreview === 'function') {

      return richEditor.renderPreview(text);

    }

    var raw = String(text || '').trim();

    if (!raw) return '<span class="dash-muted">—</span>';

    if (/^Form:/i.test(raw) || /^Dialogflow /i.test(raw)) {
      return '<span class="dash-muted qap-form-label">' + esc(raw) + '</span>';
    }

    if (ms && typeof ms.renderHtml === 'function' && ms.hasMessageSyntax(raw)) {

      return ms.renderHtml(raw);

    }

    return esc(raw).replace(/\n/g, '<br>');

  }



  function buildRowHtml(item) {

    var text = displayText(item);

    var draftBadge = item.hasDraft

      ? ' <span class="qap-draft-badge" title="Draft — not live yet">draft</span>'

      : '';

    return (

      '<tr class="qap-row' +

      (item.hasDraft ? ' qap-row--draft' : '') +

      '" data-qap-id="' +

      esc(item.id) +

      '">' +

      '<td class="qap-col-intent"><code class="qap-intent-name">' +

      esc(item.intent) +

      '</code></td>' +

      '<td class="qap-col-response">' +

      '<div class="qap-response-view">' +

      esc(text) +

      draftBadge +

      '<button type="button" class="dash-btn dash-btn--ghost qap-edit-btn qap-edit-btn--inline" title="Edit">✎</button>' +

      '</div>' +

      '<div class="qap-response-edit-wrap">' +

      '<div class="qap-rich-editor-host"></div>' +

      '</div>' +

      '<div class="qap-row-actions">' +

      '<button type="button" class="dash-btn dash-btn--primary qap-save-btn" title="Save draft" hidden>💾</button>' +

      '</div>' +

      '</td>' +

      '<td class="qap-col-preview"><div class="qap-preview qa-msg__bubble qa-msg__bubble--formatted">' +

      renderPreviewHtml(text) +

      '</div></td>' +

      '</tr>'

    );

  }



  function pageMeta(total) {

    var totalPages = Math.max(1, Math.ceil(total / pageSize));

    if (currentPage > totalPages) currentPage = totalPages;

    if (currentPage < 1) currentPage = 1;

    return {

      total: total,

      page: currentPage,

      totalPages: totalPages,

      hasPrev: currentPage > 1,

      hasNext: currentPage < totalPages,

      limit: pageSize,

      start: (currentPage - 1) * pageSize,

    };

  }



  function syncPager(meta) {

    var pager = $('qap-pager');

    var hint = $('qap-page-hint');

    var pageEl = $('qap-page-num');

    var first = $('qap-page-first');

    var prev = $('qap-page-prev');

    var next = $('qap-page-next');

    var last = $('qap-page-last');

    if (!pager) return;

    if (!meta || !meta.total || meta.total <= PAGE_SIZE_OPTIONS[0]) {

      pager.hidden = true;

      return;

    }

    pager.hidden = false;

    syncPageSizeSelect();

    if (pageEl) pageEl.textContent = String(meta.page);

    if (last) last.textContent = String(meta.totalPages);

    if (first) first.disabled = !meta.hasPrev;

    if (prev) prev.disabled = !meta.hasPrev;

    if (next) next.disabled = !meta.hasNext;

    if (last) last.disabled = !meta.hasNext;

    if (hint) {

      hint.textContent =

        meta.total + ' intent(s), ' + meta.limit + ' per page · showing ' + (meta.start + 1) + '–' + Math.min(meta.start + meta.limit, meta.total);

    }

  }



  function goToPage(page) {

    var meta = pageMeta(cachedItems.length);

    var next = Math.max(1, Math.min(meta.totalPages, Number(page) || 1));

    if (next === currentPage) return;

    closeEditor(null);

    currentPage = next;

    renderTable(cachedItems);

  }



  function wirePager() {

    var first = $('qap-page-first');

    var prev = $('qap-page-prev');

    var next = $('qap-page-next');

    var last = $('qap-page-last');

    if (first) {

      first.addEventListener('click', function () {

        if (!first.disabled) goToPage(1);

      });

    }

    if (prev) {

      prev.addEventListener('click', function () {

        if (!prev.disabled) goToPage(currentPage - 1);

      });

    }

    if (next) {

      next.addEventListener('click', function () {

        if (!next.disabled) goToPage(currentPage + 1);

      });

    }

    if (last) {

      last.addEventListener('click', function () {

        if (!last.disabled) goToPage(pageMeta(cachedItems.length).totalPages);

      });

    }

    var sizeSel = $('qap-page-size');

    if (sizeSel) {

      sizeSel.addEventListener('change', function () {

        var next = parseInt(sizeSel.value, 10);

        if (PAGE_SIZE_OPTIONS.indexOf(next) < 0) return;

        pageSize = next;

        savePageSize();

        currentPage = 1;

        closeEditor(null);

        renderTable(cachedItems);

      });

    }

  }



  function renderTable(items) {

    var el = $('qap-list');

    if (!el) return;

    if (!items.length) {

      el.innerHTML =

        '<p class="dash-muted">No intents yet. Upload an Excel file with Intent and Response columns.</p>';

      syncPager(null);

      return;

    }

    var meta = pageMeta(items.length);

    var pageItems = items.slice(meta.start, meta.start + pageSize);

    el.innerHTML =

      '<div class="qap-table-wrap"><table class="qap-table">' +

      '<thead><tr>' +

      '<th>Intent</th><th>Text response</th><th>Preview</th>' +

      '</tr></thead><tbody>' +

      pageItems.map(buildRowHtml).join('') +

      '</tbody></table></div>';

    syncPager(meta);

    wireRows();

  }



  function updateDraftCount(count) {

    var n = Number(count) || 0;

    var el = $('qap-draft-count');

    if (el) {

      el.textContent = n === 1 ? '1 draft change pending' : n + ' draft change(s) pending';

      el.classList.toggle('qap-live-bar-drafts--active', n > 0);

    }

    if (n > 0 && liveBarMode !== 'loading') setLiveBarMessage('', false);

    var btn = $('qap-make-live');

    if (btn) btn.disabled = !(n > 0);

  }



  function readResponseFromRow(row) {

    if (row && row._qapEditor && typeof row._qapEditor.getValue === 'function') {

      return row._qapEditor.getValue().trim();

    }

    return '';

  }



  function destroyRowEditor(row) {

    if (!row) return;

    row._qapEditor = null;

    var host = row.querySelector('.qap-rich-editor-host');

    if (host) host.innerHTML = '';

  }



  function closeEditor(exceptRowId) {

    document.querySelectorAll('.qap-row').forEach(function (row) {

      var id = row.getAttribute('data-qap-id');

      if (exceptRowId && id === exceptRowId) return;

      row.classList.remove('is-editing');

      var wrap = row.querySelector('.qap-response-edit-wrap');

      if (wrap) wrap.hidden = true;

      destroyRowEditor(row);

      var saveBtn = row.querySelector('.qap-save-btn');

      var editBtn = row.querySelector('.qap-edit-btn');

      if (saveBtn) saveBtn.hidden = true;

      if (editBtn) editBtn.hidden = false;

    });

  }



  function openEditor(row) {

    closeEditor(row.getAttribute('data-qap-id'));

    row.classList.add('is-editing');

    var saveBtn = row.querySelector('.qap-save-btn');

    var editBtn = row.querySelector('.qap-edit-btn');

    var wrap = row.querySelector('.qap-response-edit-wrap');

    var host = row.querySelector('.qap-rich-editor-host');

    var rowId = row.getAttribute('data-qap-id');

    var item = cachedItems.find(function (x) {

      return x.id === rowId;

    });

    var text = displayText(item);

    if (wrap) wrap.hidden = false;

    if (richEditor && host && typeof richEditor.mount === 'function') {

      destroyRowEditor(row);

      row._qapEditor = richEditor.mount(host, text, {

        compact: true,

        onChange: function (val) {

          var preview = row.querySelector('.qap-preview');

          if (preview) preview.innerHTML = renderPreviewHtml(val);

        },

      });

      if (row._qapEditor && row._qapEditor.focus) row._qapEditor.focus();

    }

    if (saveBtn) saveBtn.hidden = false;

    if (editBtn) editBtn.hidden = true;

  }



  function wireRows() {

    document.querySelectorAll('.qap-row').forEach(function (row) {

      var editBtn = row.querySelector('.qap-edit-btn');

      var saveBtn = row.querySelector('.qap-save-btn');

      var wrap = row.querySelector('.qap-response-edit-wrap');

      if (wrap) wrap.hidden = true;



      if (editBtn) {

        editBtn.addEventListener('click', function () {

          openEditor(row);

        });

      }



      if (saveBtn) {

        saveBtn.addEventListener('click', function () {

          saveRow(row);

        });

      }

    });

  }



  function saveRow(row) {

    var id = row.getAttribute('data-qap-id');

    var item = cachedItems.find(function (x) {

      return x.id === id;

    });

    var response = readResponseFromRow(row);

    if (!response) {

      setStatus('qap-list-status', 'Response text is required.', true);

      return;

    }

    saveBtnBusy(row, true);

    fetch(provisionApi(), {

      method: 'POST',

      credentials: 'same-origin',

      headers: headersJson(),

      body: JSON.stringify({

        id: id,

        intent: item && item.intent,

        response: response,

      }),

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

        setStatus(

          'qap-list-status',

          'Draft saved for “' + (item && item.intent) + '”. Click Make Live to update the sheet and Dialogflow.',

          false

        );

        closeEditor(null);

        loadItems(false, true);

      })

      .catch(function (err) {

        setStatus('qap-list-status', err.message || 'Save failed', true);

      })

      .finally(function () {

        saveBtnBusy(row, false);

      });

  }



  function saveBtnBusy(row, busy) {

    var btn = row.querySelector('.qap-save-btn');

    if (btn) btn.disabled = !!busy;

  }



  function loadItems(forceSync, skipSync) {

    setStatus('qap-list-status', 'Loading…', false);

    var qs = [];

    if (forceSync) qs.push('refresh=1');

    if (skipSync) qs.push('noSync=1');

    fetch(provisionApi(qs.length ? '?' + qs.join('&') : ''), {

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

        cachedItems = result.body.items || [];

        updateDraftCount(result.body.draftCount || 0);

        renderTable(cachedItems);

        var sync = result.body.dfSync;

        if (sync && sync.ran && !sync.ok) {

          setStatus(

            'qap-list-status',

            'Loaded ' + cachedItems.length + ' intent(s), but Dialogflow sync failed: ' + (sync.error || 'unknown'),

            true

          );

        } else {

          setStatus('qap-list-status', '', false);

        }

      })

      .catch(function (err) {

        setStatus('qap-list-status', err.message || 'Load failed', true);

      });

  }



  function formatBackupLabel(b) {
    var when = '';
    if (b.at) {
      var d = new Date(b.at);
      if (!isNaN(d.getTime())) {
        var datePart = d.toLocaleString('en-GB', { day: 'numeric', month: 'long' });
        var timePart = d.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        when = datePart + ' ' + timePart;
      } else {
        when = String(b.at);
      }
    }
    return when + ' · by ' + (b.actor || 'system');
  }



  function renderBackupSelect() {

    var sel = $('qap-backup-select');

    if (!sel) return;

    sel.innerHTML =

      '<option value="">Choose a backup…</option>' +

      cachedBackups

        .map(function (b) {

          return '<option value="' + esc(b.id) + '">' + esc(formatBackupLabel(b)) + '</option>';

        })

        .join('');

  }



  function loadBackups() {

    fetch(provisionApi('/backups'), {

      credentials: 'same-origin',

      headers: auth.authHeaders(),

    })

      .then(function (res) {

        return res.json();

      })

      .then(function (body) {

        if (!body.ok) return;

        cachedBackups = body.backups || [];

        renderBackupSelect();

      })

      .catch(function () {

        /* ignore */

      });

  }



  function formatDialogflowMakeLiveMsg(df) {

    if (!df) return ' Dialogflow push was not attempted.';

    if (df.configured === false) {

      return ' Dialogflow: not pushed — set GOOGLE_CREDENTIALS_JSON and DIALOGFLOW_PROJECT_ID on the server.';

    }

    if (df.skipped || (df.results && df.results[0] && df.results[0].skipped && !df.pushed)) {

      var skipErr =

        (df.results && df.results[0] && df.results[0].error) ||

        'Dialogflow is not configured on this server.';

      return ' Dialogflow: not pushed (' + skipErr + ').';

    }

    var parts = [];

    if (df.pushed) parts.push(df.pushed + ' intent(s) pushed to Dialogflow');

    if (df.failed) parts.push(df.failed + ' failed');

    if (df.projectId) parts.push('project ' + df.projectId);

    var msg = parts.length ? ' ' + parts.join(', ') + '.' : '';

    if (df.results && df.failed) {

      var errs = df.results

        .filter(function (r) {

          return !r.ok;

        })

        .map(function (r) {

          return (r.intent || '?') + ': ' + (r.error || 'failed');

        });

      if (errs.length) msg += ' Errors: ' + errs.slice(0, 3).join('; ') + '.';

    }

    return msg;

  }



  function makeLive() {

    setLiveBarMessage('Making changes live…', 'loading');

    setStatus('qap-list-status', '', false);

    fetch(provisionApi('/make-live'), {

      method: 'POST',

      credentials: 'same-origin',

      headers: headersJson(),

      body: JSON.stringify({ pushDialogflow: true }),

    })

      .then(function (res) {

        return res.json().then(function (body) {

          return { ok: res.ok, body: body };

        });

      })

      .then(function (result) {

        if (!result.ok || !result.body.ok) {

          throw new Error((result.body && result.body.error) || 'Make live failed');

        }

        var df = result.body.dialogflow;

        var isError = df && (df.failed > 0 || df.configured === false);

        var promoted = Number(result.body.promoted) || 0;

        if (isError) {

          var errMsg = formatDialogflowMakeLiveMsg(df).trim();

          setLiveBarMessage(

            errMsg || 'Make live failed — check Dialogflow settings.',

            true

          );

        } else {

          setLiveBarMessage(formatLiveIntentCount(promoted), false);

        }

        setStatus('qap-list-status', '', false);

        loadItems();

        loadBackups();

      })

      .catch(function (err) {

        setLiveBarMessage(err.message || 'Make live failed', true);

        setStatus('qap-list-status', '', false);

      });

  }



  function pullLiveChanges() {

    var pendingDrafts = (cachedItems || []).filter(function (it) {

      return it && it.hasDraft;

    }).length;

    if (

      pendingDrafts > 0 &&

      !window.confirm(

        'You have ' +

          pendingDrafts +

          ' pending draft(s). Pulling from Dialogflow will discard them and show the live Dialogflow text. Continue?'

      )

    ) {

      return;

    }

    setStatus('qap-list-status', 'Pulling live changes from Dialogflow…', false);

    fetch(provisionApi('/pull-dialogflow'), {

      method: 'POST',

      credentials: 'same-origin',

      headers: headersJson(),

      body: JSON.stringify({
        mode: 'merge',
        overwriteResponse: true,
        clearDrafts: true,
        pruneMissing: true,
      }),

    })

      .then(function (res) {

        return res.json().then(function (body) {

          return { ok: res.ok, body: body };

        });

      })

      .then(function (result) {

        if (!result.ok || !result.body.ok) {

          throw new Error((result.body && result.body.error) || 'Pull failed');

        }

        var b = result.body;

        setStatus(

          'qap-list-status',

          'Pulled ' +

            (b.pulledIntents || 0) +

            ' intent(s) from Dialogflow (' +

            (b.added || 0) +

            ' new, ' +

            (b.updated || 0) +

            ' updated' +

            (b.removed ? ', ' + b.removed + ' removed' : '') +

            ').',

          false

        );

        loadItems();

      })

      .catch(function (err) {

        setStatus('qap-list-status', err.message || 'Pull failed', true);

      });

  }



  function restoreBackup() {

    var sel = $('qap-backup-select');

    var id = sel ? sel.value : '';

    if (!id) {

      highlightBackupSelect(true);

      setStatus('qap-list-status', 'Choose a backup to restore.', true);

      return;

    }

    if (!window.confirm('Restore this backup? Current live data will be backed up first.')) return;

    setStatus('qap-list-status', 'Restoring backup…', false);

    fetch(provisionApi('/restore/' + encodeURIComponent(id)), {

      method: 'POST',

      credentials: 'same-origin',

      headers: headersJson(),

      body: '{}',

    })

      .then(function (res) {

        return res.json().then(function (body) {

          return { ok: res.ok, body: body };

        });

      })

      .then(function (result) {

        if (!result.ok || !result.body.ok) {

          throw new Error((result.body && result.body.error) || 'Restore failed');

        }

        setStatus('qap-list-status', 'Backup restored (' + result.body.itemCount + ' rows).', false);

        if (sel) sel.value = '';

        loadItems();

        loadBackups();

      })

      .catch(function (err) {

        setStatus('qap-list-status', err.message || 'Restore failed', true);

      });

  }



  function backupDownloadFilename(id) {

    var b = cachedBackups.find(function (x) {

      return x.id === id;

    });

    if (b && b.at) {

      var stamp = String(b.at).slice(0, 10);

      if (stamp) return 'agenttraining-backup-' + stamp + '.xlsx';

    }

    return 'agenttraining-backup.xlsx';

  }



  function highlightBackupSelect(needs) {

    var sel = $('qap-backup-select');

    if (!sel) return;

    if (backupHighlightTimer) {

      clearTimeout(backupHighlightTimer);

      backupHighlightTimer = null;

    }

    sel.classList.toggle('qap-restore-select--needs-selection', !!needs);

    if (needs) {

      sel.setAttribute('aria-invalid', 'true');

      try {

        sel.focus({ preventScroll: true });

      } catch (e) {

        sel.focus();

      }

      backupHighlightTimer = setTimeout(function () {

        highlightBackupSelect(false);

      }, 5000);

    } else {

      sel.removeAttribute('aria-invalid');

    }

  }



  function downloadBackupExcel() {

    var sel = $('qap-backup-select');

    var id = sel ? sel.value : '';

    if (!id) {

      highlightBackupSelect(true);

      setStatus('qap-list-status', 'Choose a backup to download.', true);

      return;

    }

    setStatus('qap-list-status', 'Preparing download…', false);

    fetch(provisionApi('/backups/' + encodeURIComponent(id) + '/export'), {

      credentials: 'same-origin',

      headers: auth.authHeaders(),

    })

      .then(function (res) {

        if (!res.ok) throw new Error('Download failed');

        return res.blob();

      })

      .then(function (blob) {

        var a = document.createElement('a');

        a.href = URL.createObjectURL(blob);

        a.download = backupDownloadFilename(id);

        a.click();

        URL.revokeObjectURL(a.href);

        setStatus('qap-list-status', 'Backup download started.', false);

      })

      .catch(function (err) {

        setStatus('qap-list-status', err.message || 'Download failed', true);

      });

  }



  function importExcel() {

    var fileInput = $('qap-file');

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {

      setStatus('qap-upload-status', 'Choose an Excel file first.', true);

      return;

    }

    var fd = new FormData();

    fd.append('file', fileInput.files[0]);

    fd.append('mode', 'replace');

    setStatus('qap-upload-status', 'Uploading…', false);

    fetch(provisionApi('/import'), {

      method: 'POST',

      credentials: 'same-origin',

      headers: auth.authHeaders(),

      body: fd,

    })

      .then(function (res) {

        return res.json().then(function (body) {

          return { ok: res.ok, body: body };

        });

      })

      .then(function (result) {

        if (!result.ok || !result.body.ok) {

          throw new Error((result.body && result.body.error) || 'Upload failed');

        }

        var drafted = result.body.draftedRows || 0;

        var uploadMsg =
          drafted > 0
            ? drafted + ' change(s) saved as draft.'
            : 'No response changes detected.';

        setStatus(

          'qap-upload-status',

          uploadMsg,

          false

        );

        fileInput.value = '';

        currentPage = 1;

        loadItems();

        loadBackups();

      })

      .catch(function (err) {

        setStatus('qap-upload-status', err.message || 'Upload failed', true);

      });

  }



  function downloadExcel() {

    fetch(provisionApi('/export'), { credentials: 'same-origin', headers: auth.authHeaders() })

      .then(function (res) {

        if (!res.ok) throw new Error('Download failed');

        return res.blob();

      })

      .then(function (blob) {

        var a = document.createElement('a');

        a.href = URL.createObjectURL(blob);

        a.download = 'agenttraining.xlsx';

        a.click();

        URL.revokeObjectURL(a.href);

        setStatus('qap-upload-status', 'Download started.', false);

      })

      .catch(function (err) {

        setStatus('qap-upload-status', err.message || 'Download failed', true);

      });

  }



  function init() {

    nav.mount({

      active: 'agenttraining',

      title: 'AI agent training',

      subtitle: 'Intent responses · all bots',

    });

    loadPageSize();

    syncPageSizeSelect();

    wirePager();

    $('qap-choose-file') && $('qap-choose-file').addEventListener('click', function () {
      var input = $('qap-file');
      if (input) input.click();
    });

    $('qap-file') && $('qap-file').addEventListener('change', function () {
      var nameEl = $('qap-file-name');
      if (this.files && this.files[0]) {
        if (nameEl) nameEl.textContent = this.files[0].name;
        importExcel();
      } else if (nameEl) {
        nameEl.textContent = 'No file chosen';
      }
    });

    $('qap-download-btn') && $('qap-download-btn').addEventListener('click', downloadExcel);

    $('qap-pull-live') && $('qap-pull-live').addEventListener('click', pullLiveChanges);

    $('qap-make-live') && $('qap-make-live').addEventListener('click', makeLive);

    $('qap-restore-backup') && $('qap-restore-backup').addEventListener('click', restoreBackup);

    $('qap-download-backup') && $('qap-download-backup').addEventListener('click', downloadBackupExcel);

    var backupSel = $('qap-backup-select');

    if (backupSel) {

      backupSel.addEventListener('change', function () {

        if (backupSel.value) highlightBackupSelect(false);

      });

    }

    loadItems(true);

    loadBackups();

  }



  nav.whenReady(init);

})();


