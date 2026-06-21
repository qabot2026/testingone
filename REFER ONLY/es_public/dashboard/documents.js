(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var state = { rows: [], filtered: [], dateFilterActive: true };

  if (!auth || !auth.requireAuthOrRedirect('dashboard/documents.html')) {
    return;
  }

  function headers() {
    return auth.authHeaders({ 'Content-Type': 'application/json' });
  }

  function apiBase() {
    return auth.apiBase();
  }

  function formatBytes(n) {
    var b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(iso, dateDisplay) {
    if (dateDisplay) return dateDisplay;
    if (!iso) return '—';
    try {
      var dd = window.QADateDisplay;
      var dayPart = dd && dd.formatDateDisplay
        ? dd.formatDateDisplay(String(iso).slice(0, 10))
        : String(iso).slice(0, 10);
      var timePart = new Date(iso).toLocaleString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      return dayPart + ', ' + timePart;
    } catch (e) {
      return iso;
    }
  }

  function formatMobile(mobile, dialCode) {
    if (!mobile) return '—';
    var raw = String(mobile).trim();
    var compact = raw.replace(/\s+/g, '');
    var digits = compact.replace(/\D/g, '');
    var dial = String(dialCode || '').replace(/\D/g, '');

    if (/^\+?\d{11,}$/.test(compact) || digits.length > 10) {
      var local = digits.slice(-10);
      var dialDigits = dial || digits.slice(0, digits.length - 10);
      if (!dialDigits && local.length === 10) dialDigits = '91';
      if (dialDigits && local) return dialDigits + ' ' + local;
      return digits;
    }

    if (!dial && digits.length === 10) dial = '91';
    var local = digits;
    if (dial && local.indexOf(dial) === 0 && local.length > dial.length) {
      local = local.slice(dial.length);
    }
    if (local.length > 10) local = local.slice(-10);
    if (dial && local) return dial + ' ' + local;
    return raw.replace(/^\+/, '').trim() || '—';
  }

  function transcriptSessionId(r) {
    var sid = String((r && r.session_id) || '').trim();
    if (sid) return sid;
    var folder = String((r && r.storage_folder) || '').trim();
    var m = folder.match(/^(.+)__(\d{2})_(\d{2})_(\d{4})_(\d+)$/);
    return m ? m[1] : '';
  }

  var ICON_EYE =
    '<svg class="docs-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  var ICON_DOWNLOAD =
    '<svg class="docs-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  var ICON_DELETE =
    '<svg class="docs-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  var ICON_COPY =
    '<svg class="docs-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function actionIconBtn(className, iconSvg, label, dataAttrs) {
    return (
      '<button type="button" class="docs-icon-btn ' +
      className +
      '" ' +
      (dataAttrs || '') +
      ' title="' +
      escapeHtml(label) +
      '" aria-label="' +
      escapeHtml(label) +
      '">' +
      iconSvg +
      '<span class="visually-hidden">' +
      escapeHtml(label) +
      '</span></button>'
    );
  }

  function setActionBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle('docs-icon-btn--busy', !!busy);
    btn.disabled = !!busy;
  }

  function copyTextToClipboard(text) {
    var value = String(text || '').trim();
    if (!value) return Promise.reject(new Error('Nothing to copy'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        if (ok) resolve();
        else reject(new Error('Copy failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function fetchDocumentLink(object, externalUrl) {
    var ext = String(externalUrl || '').trim();
    if (ext) return Promise.resolve(ext);
    var obj = String(object || '').trim();
    if (!obj) return Promise.reject(new Error('Missing file'));
    return fetch(
      apiBase() + '/api/documents/download-url?object=' + encodeURIComponent(obj),
      { headers: headers() }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok || !data.url) {
          throw new Error(data.message || 'Could not get file link.');
        }
        return data.url;
      });
  }

  function showAlert(msg) {
    var el = document.getElementById('docs-alert');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function localIsoYmd(d) {
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate())
    );
  }

  function todayIsoYmd() {
    return localIsoYmd(new Date());
  }

  function formatIndianDate(isoYmd) {
    var dd = window.QADateDisplay;
    if (dd && dd.formatDateDisplay) {
      return dd.formatDateDisplay(isoYmd);
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoYmd || ''));
    if (!m) return String(isoYmd || '');
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function parseIndianDateInput(raw) {
    var dd = window.QADateDisplay;
    if (dd && dd.parseToIsoYmd) return dd.parseToIsoYmd(raw);
    return '';
  }

  function getDocsDateYmd(el) {
    if (!el) return '';
    var stored = String(el.dataset.ymd || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    var parsed = parseIndianDateInput(el.value);
    if (parsed) {
      el.dataset.ymd = parsed;
      return parsed;
    }
    var raw = String(el.value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      el.dataset.ymd = raw;
      return raw;
    }
    return '';
  }

  function setDocsDateYmd(el, isoYmd) {
    if (!el) return;
    var iso = String(isoYmd || '').trim();
    var wrap = el.closest('.docs-date-field');
    var native = wrap && wrap.querySelector('.docs-date-native');
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      el.dataset.ymd = iso;
      el.value = formatIndianDate(iso);
      if (native) native.value = iso;
    } else {
      el.dataset.ymd = '';
      el.value = '';
      if (native) native.value = '';
    }
  }

  function normalizeDocsDateInput(el) {
    if (!el) return;
    var raw = String(el.value || '').trim();
    if (!raw) {
      setDocsDateYmd(el, '');
      return;
    }
    var ymd = parseIndianDateInput(raw);
    if (!ymd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) ymd = raw;
    if (ymd) setDocsDateYmd(el, ymd);
  }

  function bindDocsDatePicker(textEl) {
    if (!textEl || textEl._docsDatePickerBound) return;
    textEl._docsDatePickerBound = true;
    var wrap = textEl.closest('.docs-date-field');
    if (!wrap) return;
    var native = wrap.querySelector('.docs-date-native');
    var icon = wrap.querySelector('.docs-date-cal-ic');
    if (!native) return;

    function openPicker() {
      var ymd = getDocsDateYmd(textEl);
      native.value = ymd || '';
      if (typeof native.showPicker === 'function') native.showPicker();
      else native.click();
    }

    if (icon) {
      icon.setAttribute('role', 'button');
      icon.setAttribute('tabindex', '0');
      icon.setAttribute('aria-label', 'Open calendar');
      icon.addEventListener('click', openPicker);
      icon.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openPicker();
        }
      });
    }

    textEl.addEventListener('blur', function () {
      normalizeDocsDateInput(textEl);
      onDateInputChange();
    });
    textEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        normalizeDocsDateInput(textEl);
        onDateInputChange();
      }
    });

    native.addEventListener('change', function () {
      setDocsDateYmd(textEl, native.value || '');
      onDateInputChange();
    });
  }

  function setDateInputDisplay(el, isoYmd) {
    setDocsDateYmd(el, isoYmd);
  }

  function getDateRangeFromInputs() {
    var fromEl = document.getElementById('docs-date-from');
    var toEl = document.getElementById('docs-date-to');
    var fromIso = fromEl ? getDocsDateYmd(fromEl) : '';
    var toIso = toEl ? getDocsDateYmd(toEl) : '';
    if (fromIso && toIso && fromIso > toIso) {
      var swap = fromIso;
      fromIso = toIso;
      toIso = swap;
      setDocsDateYmd(fromEl, fromIso);
      setDocsDateYmd(toEl, toIso);
    }
    return { fromIso: fromIso, toIso: toIso };
  }

  function initDefaultDateRange() {
    var today = todayIsoYmd();
    setDocsDateYmd(document.getElementById('docs-date-from'), today);
    setDocsDateYmd(document.getElementById('docs-date-to'), today);
    state.dateFilterActive = true;
  }

  /** Previous 5 calendar days before today (today excluded). */
  function applyLast5DaysRange() {
    var now = new Date();
    var fromD = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 5
    );
    var toD = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1
    );
    setDocsDateYmd(document.getElementById('docs-date-from'), localIsoYmd(fromD));
    setDocsDateYmd(document.getElementById('docs-date-to'), localIsoYmd(toD));
    state.dateFilterActive = true;
    showAlert('');
    applyFilter();
  }

  function applyClearDateRange() {
    initDefaultDateRange();
    showAlert('');
    applyFilter();
  }

  function onDateInputChange() {
    state.dateFilterActive = true;
    normalizeDocsDateInput(document.getElementById('docs-date-from'));
    normalizeDocsDateInput(document.getElementById('docs-date-to'));
    applyFilter();
  }

  function rowDateIso(r) {
    var candidates = [r && r.uploaded_at, r && r.updated_at];
    var i;
    for (i = 0; i < candidates.length; i += 1) {
      var raw = candidates[i];
      if (!raw) continue;
      var d = new Date(raw);
      if (!isNaN(d.getTime())) return localIsoYmd(d);
    }
    var display = String((r && r.date_display) || '').trim();
    if (display) {
      var dd = window.QADateDisplay;
      if (dd && dd.parseToIsoYmd) {
        var parsed = dd.parseToIsoYmd(display);
        if (parsed) return parsed;
      }
      var parts = display.split('/');
      if (parts.length === 3) {
        return (
          parts[2] +
          '-' +
          pad2(parts[1]) +
          '-' +
          pad2(parts[0])
        );
      }
    }
    return '';
  }

  function dateRangeLabel(fromIso, toIso) {
    if (fromIso && toIso) {
      if (fromIso === toIso) return formatIndianDate(fromIso);
      return formatIndianDate(fromIso) + ' – ' + formatIndianDate(toIso);
    }
    if (fromIso) return 'from ' + formatIndianDate(fromIso);
    if (toIso) return 'until ' + formatIndianDate(toIso);
    return '';
  }

  function foldersToRows(folders) {
    var rows = [];
    var seenObjects = {};
    (folders || []).forEach(function (f) {
      (f.files || []).forEach(function (file) {
        var obj = file.gcs_object || '';
        if (obj && seenObjects[obj]) return;
        if (obj) seenObjects[obj] = true;
        rows.push({
          file_name: file.file_name,
          gcs_object: file.gcs_object,
          size_bytes: file.size_bytes,
          uploaded_at: file.uploaded_at,
          name: f.name || '',
          mobile: f.mobile || '',
          dial_code: f.dial_code || '',
          email: f.email || '',
          date_display: f.date_display || '',
          updated_at: f.updated_at || file.uploaded_at,
          session_id: file.session_id || f.session_id || '',
          storage_folder: f.storage_folder || '',
          tag: file.tag || f.tag || '',
          channel: file.channel || f.channel || '',
          assistant: file.assistant || f.assistant || '',
          external: !!file.external,
          storage_link: file.storage_link || '',
        });
      });
    });
    rows.sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    return dedupeSubmissionRows(rows);
  }

  function dedupeSubmissionRows(rows) {
    var best = {};
    (rows || []).forEach(function (r) {
      var sid = String(r.session_id || '').trim();
      var fn = String(r.file_name || '').trim().toLowerCase();
      var sz = String(r.size_bytes || '0');
      var mob = String(r.mobile || '').replace(/\D/g, '');
      var key =
        sid && fn
          ? 's:' + sid + ':' + fn + ':' + sz
          : mob && fn
            ? 'm:' + mob + ':' + fn + ':' + sz
            : 'o:' + (r.gcs_object || '');
      if (
        !best[key] ||
        String(r.updated_at || '').localeCompare(String(best[key].updated_at || '')) > 0
      ) {
        best[key] = r;
      }
    });
    return Object.keys(best).map(function (k) {
      return best[k];
    });
  }

  function uploaderKey(r) {
    var mob = String((r && r.mobile) || '').replace(/\D/g, '');
    if (mob.length >= 10) {
      var dial = String((r && r.dial_code) || '').replace(/\D/g, '');
      if (!dial && mob.length === 10) dial = '91';
      return 'm:' + (dial || '91') + ':' + mob.slice(-10);
    }
    var email = String((r && r.email) || '').trim().toLowerCase();
    if (email) return 'e:' + email;
    var sid = String((r && r.session_id) || '').trim();
    if (sid) return 's:' + sid;
    var folder = String((r && r.storage_folder) || '').trim();
    if (folder) {
      var m = folder.match(/^(.+)__(\d{2})_(\d{2})_(\d{4})_/);
      return 'f:' + (m ? m[1] : folder);
    }
    return 'o:' + String((r && r.gcs_object) || '');
  }

  function countUniqueUploaders(rows) {
    var seen = {};
    (rows || []).forEach(function (r) {
      seen[uploaderKey(r)] = true;
    });
    return Object.keys(seen).length;
  }

  function updateSummary() {
    var folders = {};
    var totalBytes = 0;
    state.filtered.forEach(function (r) {
      folders[r.storage_folder] = true;
      totalBytes += r.size_bytes || 0;
    });
    document.getElementById('docs-count-users').textContent = String(
      countUniqueUploaders(state.filtered)
    );
    document.getElementById('docs-count-submissions').textContent = String(
      Object.keys(folders).length
    );
    document.getElementById('docs-count-files').textContent = String(
      state.filtered.length
    );
    document.getElementById('docs-count-size').textContent = formatBytes(totalBytes);
  }

  function applyFilter() {
    var q = String(document.getElementById('docs-search').value || '')
      .trim()
      .toLowerCase();
    var range = getDateRangeFromInputs();
    var fromIso = range.fromIso;
    var toIso = range.toIso;
    var useDateFilter =
      state.dateFilterActive && (fromIso || toIso);

    state.filtered = state.rows.filter(function (r) {
      if (useDateFilter) {
        var rowIso = rowDateIso(r);
        if (!rowIso) return false;
        if (fromIso && rowIso < fromIso) return false;
        if (toIso && rowIso > toIso) return false;
      }
      if (!q) return true;
      var hay =
        (r.file_name || '') +
        ' ' +
        (r.name || '') +
        ' ' +
        (r.mobile || '') +
        ' ' +
        (r.email || '') +
        ' ' +
        (r.storage_folder || '') +
        ' ' +
        (r.session_id || '') +
        ' ' +
        (r.channel || '') +
        ' ' +
        (r.assistant || '') +
        ' ' +
        (r.tag || '');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
    renderTable();
  }

  function renderTable() {
    var tbody = document.getElementById('docs-tbody');
    updateSummary();

    if (!state.filtered.length) {
      tbody.innerHTML =
        '<tr><td colspan="10" class="docs-table__empty">No documents found.</td></tr>';
      return;
    }

    tbody.innerHTML = state.filtered
      .map(function (r) {
        var displayName = r.name || '—';
        var chatSid = transcriptSessionId(r);
        return (
          '<tr>' +
          '<td><span class="docs-file-name">' +
          escapeHtml(r.file_name) +
          '</span></td>' +
          '<td>' +
          escapeHtml(r.assistant || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(r.channel || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(r.tag || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(displayName) +
          '</td>' +
          '<td>' +
          escapeHtml(r.email || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(formatMobile(r.mobile, r.dial_code)) +
          '</td>' +
          '<td>' +
          escapeHtml(formatDate(r.uploaded_at, r.date_display)) +
          '</td>' +
          '<td>' +
          formatBytes(r.size_bytes) +
          '</td>' +
          '<td><div class="docs-actions">' +
          '<div class="docs-action-icons">' +
          actionIconBtn(
            'docs-icon-btn--view docs-view',
            ICON_EYE,
            'View',
            'data-object="' +
              escapeHtml(r.gcs_object) +
              '" data-external-url="' +
              escapeHtml(r.external ? r.storage_link || '' : '') +
              '"'
          ) +
          actionIconBtn(
            'docs-icon-btn--download docs-download',
            ICON_DOWNLOAD,
            'Download',
            'data-object="' +
              escapeHtml(r.gcs_object) +
              '" data-filename="' +
              escapeHtml(r.file_name) +
              '"'
          ) +
          actionIconBtn(
            'docs-icon-btn--copy docs-copy',
            ICON_COPY,
            'Copy link',
            'data-object="' +
              escapeHtml(r.gcs_object) +
              '" data-external-url="' +
              escapeHtml(r.external ? r.storage_link || '' : '') +
              '"'
          ) +
          (r.external
            ? ''
            : actionIconBtn(
                'docs-icon-btn--delete docs-delete',
                ICON_DELETE,
                'Delete',
                'data-object="' +
                  escapeHtml(r.gcs_object) +
                  '" data-filename="' +
                  escapeHtml(r.file_name) +
                  '"'
              )) +
          '</div>' +
          '<a class="docs-link-transcript" href="../conversation-transcript?session=' +
          encodeURIComponent(chatSid) +
          '" target="_blank" rel="noopener noreferrer">Chatscript</a>' +
          '</div></td></tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('.docs-view').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openView(btn);
      });
    });
    tbody.querySelectorAll('.docs-download').forEach(function (btn) {
      btn.addEventListener('click', function () {
        downloadFile(btn);
      });
    });
    tbody.querySelectorAll('.docs-copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyDocumentLink(btn);
      });
    });
    tbody.querySelectorAll('.docs-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteDocument(btn);
      });
    });
  }

  function copyDocumentLink(btn) {
    var object = btn.getAttribute('data-object');
    var externalUrl = btn.getAttribute('data-external-url') || '';
    if (!object) return;
    setActionBusy(btn, true);
    fetchDocumentLink(object, externalUrl)
      .then(function (url) {
        return copyTextToClipboard(url);
      })
      .then(function () {
        var prev = btn.getAttribute('title') || 'Copy link';
        btn.setAttribute('title', 'Copied!');
        setTimeout(function () {
          btn.setAttribute('title', prev);
        }, 1500);
      })
      .catch(function (err) {
        alert((err && err.message) || 'Could not copy link.');
      })
      .finally(function () {
        setActionBusy(btn, false);
      });
  }

  function openView(btn) {
    var object = btn.getAttribute('data-object');
    var externalUrl = btn.getAttribute('data-external-url') || '';
    if (!object) return;
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setActionBusy(btn, true);
    fetch(
      apiBase() +
        '/api/documents/download-url?object=' +
        encodeURIComponent(object),
      { headers: headers() }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok || !data.url) {
          alert(data.message || 'Could not open file.');
          return;
        }
        window.open(data.url, '_blank', 'noopener,noreferrer');
      })
      .catch(function () {
        alert('Request failed.');
      })
      .finally(function () {
        setActionBusy(btn, false);
      });
  }

  function removeRowFromState(gcsObject) {
    var obj = String(gcsObject || '').trim();
    if (!obj) return;
    state.rows = state.rows.filter(function (r) {
      return String(r.gcs_object || '').trim() !== obj;
    });
    state.filtered = state.filtered.filter(function (r) {
      return String(r.gcs_object || '').trim() !== obj;
    });
    applyFilter();
  }

  function deleteDocument(btn) {
    var object = btn.getAttribute('data-object');
    var fileName = btn.getAttribute('data-filename') || 'this file';
    if (!object || !auth.hasAuth()) return;
    if (
      !window.confirm(
        'Delete "' + fileName + '" from cloud storage? This cannot be undone.'
      )
    ) {
      return;
    }

    setActionBusy(btn, true);

    fetch(apiBase() + '/api/documents/delete', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ object: object }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          throw new Error(
            (data && data.message) ||
              (data && data.error) ||
              'Delete failed.'
          );
        }
        removeRowFromState(object);
        showAlert('');
      })
      .catch(function (err) {
        alert(err.message || 'Delete failed.');
      })
      .finally(function () {
        setActionBusy(btn, false);
      });
  }

  function downloadFile(btn) {
    var object = btn.getAttribute('data-object');
    var fileName = btn.getAttribute('data-filename') || 'download';
    if (!object || !auth.hasAuth()) return;

    setActionBusy(btn, true);

    fetch(
      apiBase() +
        '/api/documents/download?object=' +
        encodeURIComponent(object),
      { headers: headers() }
    )
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (data) {
            throw new Error((data && data.message) || 'Download failed.');
          });
        }
        return r.blob().then(function (blob) {
          return { blob: blob, fileName: fileName };
        });
      })
      .then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = result.fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 2000);
      })
      .catch(function (err) {
        alert(err.message || 'Download failed.');
      })
      .finally(function () {
        setActionBusy(btn, false);
      });
  }

  function load() {
    showAlert('');
    document.getElementById('docs-tbody').innerHTML =
      '<tr><td colspan="10" class="docs-table__empty">Loading…</td></tr>';
    fetch(apiBase() + '/api/documents/catalog?limit=500', {
      headers: headers(),
      cache: 'no-store',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          if (data.error === 'gcs_not_configured') {
            showAlert('Storage not configured. Set GCS_BUCKET_NAME on Railway.');
          } else if (data.error === 'unauthorized') {
            window.location.href = '../live-agent/settings.html';
            return;
          } else {
            showAlert(data.message || 'Could not load documents.');
          }
          document.getElementById('docs-tbody').innerHTML =
            '<tr><td colspan="10" class="docs-table__empty">—</td></tr>';
          return;
        }
        state.rows = foldersToRows(data.folders || []);
        if (data.gcs_list_error) {
          showAlert(
            'Cloud storage list failed (' +
              data.gcs_list_error +
              '). Showing files verified one-by-one. For faster refresh, give Storage Object Viewer on bucket ' +
              (data.bucket || '') +
              '.'
          );
        } else if (!state.rows.length) {
          showAlert(
            'No documents yet. Upload from production chat (not /es-test), wait for bot success, then Refresh.'
          );
        } else if (state.dateFilterActive) {
          var range = getDateRangeFromInputs();
          var inRange = state.rows.filter(function (r) {
            var rowIso = rowDateIso(r);
            if (!rowIso) return false;
            if (range.fromIso && rowIso < range.fromIso) return false;
            if (range.toIso && rowIso > range.toIso) return false;
            return true;
          });
          if (!inRange.length) {
            showAlert(
              'No documents for ' +
                dateRangeLabel(range.fromIso, range.toIso) +
                '. Change the date range or use Last 5 days.'
            );
          }
        }
        applyFilter();
      })
      .catch(function () {
        showAlert('Network error. Check desk token and server.');
        document.getElementById('docs-tbody').innerHTML =
          '<tr><td colspan="10" class="docs-table__empty">—</td></tr>';
      });
  }

  document.getElementById('docs-refresh').addEventListener('click', load);
  document.getElementById('docs-search').addEventListener('input', applyFilter);
  document.getElementById('docs-date-last5').addEventListener('click', applyLast5DaysRange);
  document.getElementById('docs-date-clear').addEventListener('click', applyClearDateRange);
  bindDocsDatePicker(document.getElementById('docs-date-from'));
  bindDocsDatePicker(document.getElementById('docs-date-to'));
  initDefaultDateRange();
  load();
})();
