(function (global) {
  'use strict';

  var state = {
    languages: [],
    rows: [],
    filter: '',
    initialized: false,
  };

  var opts = {};

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, '&#39;');
  }

  function langLabel(code) {
    var map = { hi: 'Hindi', mr: 'Marathi', en: 'English' };
    return map[code] || code;
  }

  function apiUrl(path) {
    if (opts.authedApiUrl) return opts.authedApiUrl(path);
    return (opts.apiBase || '') + path;
  }

  function headers(json) {
    if (opts.authHeaders) {
      return opts.authHeaders(json ? { 'Content-Type': 'application/json' } : {});
    }
    return json ? { 'Content-Type': 'application/json' } : {};
  }

  function setStatus(msg, isError) {
    var el = $('translation-sheet-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className =
      'translation-sheet-status' + (isError ? ' translation-sheet-status--error' : '');
  }

  function configuredLanguages() {
    if (opts.getLanguages) {
      var langs = opts.getLanguages();
      if (Array.isArray(langs) && langs.length) {
        return langs
          .map(function (item) {
            if (typeof item === 'string') return item;
            return item && item.code;
          })
          .filter(function (code) {
            return code && String(code).toLowerCase() !== 'en';
          });
      }
    }
    return state.languages.length ? state.languages.slice() : ['hi', 'mr'];
  }

  function langQuery() {
    return configuredLanguages()
      .map(function (c) {
        return encodeURIComponent(c);
      })
      .join(',');
  }

  function filteredRows() {
    var q = String(state.filter || '')
      .trim()
      .toLowerCase();
    if (!q) return state.rows;
    return state.rows.filter(function (row) {
      if (String(row.english || '').toLowerCase().indexOf(q) >= 0) return true;
      return state.languages.some(function (lang) {
        return String((row.translations && row.translations[lang]) || '')
          .toLowerCase()
          .indexOf(q) >= 0;
      });
    });
  }

  function renderTable() {
    var tbody = $('translation-sheet-body');
    var head = $('translation-sheet-head');
    if (!tbody || !head) return;

    var langs = state.languages;
    head.innerHTML =
      '<tr><th class="translation-sheet-th translation-sheet-th--en">English</th>' +
      langs
        .map(function (lang) {
          return (
            '<th class="translation-sheet-th">' + esc(langLabel(lang)) + '</th>'
          );
        })
        .join('') +
      '<th class="translation-sheet-th translation-sheet-th--action"></th></tr>';

    tbody.innerHTML = state.rows
      .map(function (row, rowIndex) {
        var hidden = false;
        if (state.filter) {
          var q = state.filter.toLowerCase();
          hidden =
            String(row.english || '').toLowerCase().indexOf(q) < 0 &&
            !state.languages.some(function (lang) {
              return String((row.translations && row.translations[lang]) || '')
                .toLowerCase()
                .indexOf(q) >= 0;
            });
        }
        return (
          '<tr data-row-index="' +
          rowIndex +
          '"' +
          (hidden ? ' hidden' : '') +
          '>' +
          '<td class="translation-sheet-cell translation-sheet-cell--en">' +
          '<textarea class="translation-sheet-input" data-field="english" rows="2">' +
          esc(row.english || '') +
          '</textarea></td>' +
          langs
            .map(function (lang) {
              return (
                '<td class="translation-sheet-cell"><textarea class="translation-sheet-input" data-field="' +
                escAttr(lang) +
                '" rows="2">' +
                esc((row.translations && row.translations[lang]) || '') +
                '</textarea></td>'
              );
            })
            .join('') +
          '<td class="translation-sheet-cell translation-sheet-cell--action">' +
          '<button type="button" class="translation-sheet-remove" title="Remove row" aria-label="Remove row">×</button>' +
          '</td></tr>'
        );
      })
      .join('');

    var countEl = $('translation-sheet-count');
    if (countEl) {
      countEl.textContent =
        filteredRows().length +
        ' shown · ' +
        state.rows.length +
        ' total · ' +
        langs.length +
        ' languages';
    }
  }

  function applyFilter() {
    var q = String(state.filter || '')
      .trim()
      .toLowerCase();
    var tbody = $('translation-sheet-body');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-row-index]').forEach(function (tr) {
      if (!q) {
        tr.hidden = false;
        return;
      }
      var idx = parseInt(tr.getAttribute('data-row-index'), 10);
      var row = state.rows[idx];
      if (!row) {
        tr.hidden = true;
        return;
      }
      var match =
        String(row.english || '').toLowerCase().indexOf(q) >= 0 ||
        state.languages.some(function (lang) {
          return String((row.translations && row.translations[lang]) || '')
            .toLowerCase()
            .indexOf(q) >= 0;
        });
      tr.hidden = !match;
    });
    var countEl = $('translation-sheet-count');
    if (countEl) {
      var shown = tbody.querySelectorAll('tr[data-row-index]:not([hidden])').length;
      countEl.textContent =
        shown +
        ' shown · ' +
        state.rows.length +
        ' total · ' +
        state.languages.length +
        ' languages';
    }
  }

  function collectRowsFromDom() {
    var tbody = $('translation-sheet-body');
    if (!tbody) return [];
    var out = [];
    tbody.querySelectorAll('tr[data-row-index]').forEach(function (tr) {
      var idx = parseInt(tr.getAttribute('data-row-index'), 10);
      var prior = state.rows[idx] || { type: 'phrase', translations: {} };
      var englishEl = tr.querySelector('[data-field="english"]');
      var english = englishEl ? englishEl.value.trim() : '';
      if (!english && prior.type !== 'i18n') return;
      var translations = {};
      state.languages.forEach(function (lang) {
        var el = tr.querySelector('[data-field="' + lang + '"]');
        translations[lang] = el ? el.value : '';
      });
      out.push({
        key: prior.key || '',
        english: english,
        type: prior.type || 'phrase',
        translations: translations,
      });
    });
    return out;
  }

  function applySheet(sheet) {
    state.languages = (sheet && sheet.languages) || configuredLanguages();
    state.rows = (sheet && sheet.rows) || [];
    renderTable();
  }

  function parseApiResponse(res) {
    return res.text().then(function (text) {
      var body = null;
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        if (res.status === 401) {
          throw new Error(
            'Unauthorized — open Live Agent Settings and save your viewer secret, then try again.'
          );
        }
        throw new Error(
          'Server returned an unexpected response (not JSON). Refresh the page and try again.'
        );
      }
      return { ok: res.ok, body: body };
    });
  }

  function loadSheet() {
    setStatus('Loading…', false);
    return fetch(
      apiUrl('/api/phrase-translations/sheet?languages=' + langQuery()),
      { credentials: 'same-origin', headers: headers(false) }
    )
      .then(parseApiResponse)
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Could not load sheet');
        }
        applySheet(result.body.sheet);
        setStatus('', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Load failed', true);
      });
  }

  function saveSheet() {
    setStatus('Saving…', false);
    var payload = {
      languages: configuredLanguages(),
      rows: collectRowsFromDom(),
    };
    return fetch(apiUrl('/api/phrase-translations/sheet'), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify(payload),
    })
      .then(parseApiResponse)
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Save failed');
        }
        applySheet(result.body.sheet);
        setStatus('Translation sheet saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Save failed', true);
      });
  }

  function download(format) {
    var url =
      apiUrl(
        '/api/phrase-translations/sheet/download?format=' +
          encodeURIComponent(format) +
          '&languages=' +
          langQuery()
      );
    global.open(url, '_blank', 'noopener');
  }

  function importJsonText(text) {
    var doc;
    try {
      doc = JSON.parse(String(text || ''));
    } catch (e) {
      setStatus('Invalid JSON file.', true);
      return;
    }
    fetch(apiUrl('/api/phrase-translations/sheet/import-json'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({ document: doc }),
    })
      .then(parseApiResponse)
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Upload failed');
        }
        applySheet(result.body.sheet);
        setStatus('Sheet uploaded and saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Upload failed', true);
      });
  }

  function importCsvText(text) {
    fetch(apiUrl('/api/phrase-translations/sheet/import-csv'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({
        csv: text,
        languages: configuredLanguages(),
      }),
    })
      .then(parseApiResponse)
      .then(function (result) {
        if (!result.ok || !result.body.ok) {
          throw new Error((result.body && result.body.error) || 'Upload failed');
        }
        applySheet(result.body.sheet);
        setStatus('Sheet uploaded and saved.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Upload failed', true);
      });
  }

  function uploadFile(file) {
    if (!file) return;
    setStatus('Uploading…', false);
    var name = String(file.name || '').toLowerCase();
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      if (name.endsWith('.json') || text.trim().charAt(0) === '{') {
        importJsonText(text);
        return;
      }
      importCsvText(text);
    };
    reader.onerror = function () {
      setStatus('Could not read file.', true);
    };
    reader.readAsText(file);
  }

  function addRow() {
    state.rows.unshift({
      key: '',
      english: '',
      type: 'phrase',
      translations: state.languages.reduce(function (acc, lang) {
        acc[lang] = '';
        return acc;
      }, {}),
    });
    state.filter = '';
    var search = $('translation-sheet-search');
    if (search) search.value = '';
    renderTable();
    applyFilter();
  }

  function removeRow(btn) {
    var tr = btn.closest('tr');
    if (!tr) return;
    var idx = parseInt(tr.getAttribute('data-row-index'), 10);
    if (isNaN(idx)) return;
    state.rows.splice(idx, 1);
    renderTable();
    applyFilter();
  }

  function mountHtml() {
    return (
      '<section class="settings-card translation-sheet" id="translation-sheet">' +
      '<div class="settings-card__head settings-card__head--static">' +
      '<h3 class="settings-card__title">Translation sheet</h3>' +
      '</div>' +
      '<div class="settings-card__body">' +
      '<div class="translation-sheet-toolbar">' +
      '<input type="search" id="translation-sheet-search" class="translation-sheet-search" placeholder="Search phrases…" />' +
      '<span class="translation-sheet-count" id="translation-sheet-count"></span>' +
      '<div class="translation-sheet-toolbar__actions">' +
      '<button type="button" class="btn ghost" id="translation-sheet-add">Add row</button>' +
      '<button type="button" class="btn ghost" id="translation-sheet-dl-csv">Download CSV</button>' +
      '<button type="button" class="btn ghost" id="translation-sheet-dl-json">Download JSON</button>' +
      '<label class="btn ghost translation-sheet-upload-label">' +
      'Upload<input type="file" id="translation-sheet-upload" accept=".csv,.json,application/json,text/csv" hidden /></label>' +
      '<button type="button" class="btn primary" id="translation-sheet-save">Save sheet</button>' +
      '</div></div>' +
      '<p class="translation-sheet-status" id="translation-sheet-status" hidden role="status"></p>' +
      '<div class="translation-sheet-scroll">' +
      '<table class="translation-sheet-table">' +
      '<thead id="translation-sheet-head"></thead>' +
      '<tbody id="translation-sheet-body"></tbody>' +
      '</table></div></div></section>'
    );
  }

  function wireEvents() {
    var saveBtn = $('translation-sheet-save');
    if (saveBtn) saveBtn.addEventListener('click', saveSheet);

    var addBtn = $('translation-sheet-add');
    if (addBtn) addBtn.addEventListener('click', addRow);

    var dlCsv = $('translation-sheet-dl-csv');
    if (dlCsv) dlCsv.addEventListener('click', function () {
      download('csv');
    });

    var dlJson = $('translation-sheet-dl-json');
    if (dlJson) dlJson.addEventListener('click', function () {
      download('json');
    });

    var upload = $('translation-sheet-upload');
    if (upload) {
      upload.addEventListener('change', function () {
        if (upload.files && upload.files[0]) uploadFile(upload.files[0]);
        upload.value = '';
      });
    }

    var search = $('translation-sheet-search');
    if (search) {
      search.addEventListener('input', function () {
        state.filter = search.value;
        applyFilter();
      });
    }

    var body = $('translation-sheet-body');
    if (body) {
      body.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.translation-sheet-remove');
        if (btn) removeRow(btn);
      });
    }
  }

  function init(options) {
    opts = options || {};
    if (state.initialized) {
      loadSheet();
      return;
    }
    state.initialized = true;
    wireEvents();
    loadSheet();
  }

  global.ESTranslationSheet = {
    mountHtml: mountHtml,
    init: init,
    reload: loadSheet,
  };
})(window);
