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

  function setDateInputDisplay(el, isoYmd) {
    if (!el) return;
    el.value = isoYmd ? formatIndianDate(isoYmd) : '';
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

  function getDateRangeFromInputs() {
    var fromEl = document.getElementById('docs-date-from');
    var toEl = document.getElementById('docs-date-to');
    var fromIso = fromEl ? parseIndianDateInput(fromEl.value) : '';
    var toIso = toEl ? parseIndianDateInput(toEl.value) : '';
    if (fromIso && toIso && fromIso > toIso) {
      var swap = fromIso;
      fromIso = toIso;
      toIso = swap;
      setDateInputDisplay(fromEl, fromIso);
      setDateInputDisplay(toEl, toIso);
    }
    return { fromIso: fromIso, toIso: toIso };
  }

  function initDefaultDateRange() {
    var today = todayIsoYmd();
    setDateInputDisplay(document.getElementById('docs-date-from'), today);
    setDateInputDisplay(document.getElementById('docs-date-to'), today);
    state.dateFilterActive = true;
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

  function onDateInputChange() {
    state.dateFilterActive = true;
    var fromEl = document.getElementById('docs-date-from');
    var toEl = document.getElementById('docs-date-to');
    [fromEl, toEl].forEach(function (el) {
      if (!el || !String(el.value || '').trim()) return;
      var iso = parseIndianDateInput(el.value);
      if (iso) setDateInputDisplay(el, iso);
    });
    applyFilter();
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

  function updateSummary() {
    var folders = {};
    var totalBytes = 0;
    state.filtered.forEach(function (r) {
      folders[r.storage_folder] = true;
      totalBytes += r.size_bytes || 0;
    });
    document.getElementById('docs-count-submissions').textContent = String(
      Object.keys(folders).length
    );
    document.getElementById('docs-count-files').textContent = String(
      state.filtered.length
    );
    document.getElementById('docs-count-size').textContent = formatBytes(totalBytes);
    var range = getDateRangeFromInputs();
    var rangeText = dateRangeLabel(range.fromIso, range.toIso);
    var base =
      state.filtered.length === state.rows.length
        ? 'Showing all ' + state.rows.length + ' documents'
        : 'Showing ' + state.filtered.length + ' of ' + state.rows.length;
    if (state.dateFilterActive && rangeText) {
      base += ' · ' + rangeText;
    } else if (!state.dateFilterActive) {
      base += ' · all dates';
    }
    document.getElementById('docs-showing').textContent = base;
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
        '<tr><td colspan="9" class="docs-table__empty">No documents found.</td></tr>';
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
    tbody.querySelectorAll('.docs-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteDocument(btn);
      });
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

  function updateStorageMeta(data) {
    var el = document.getElementById('docs-storage-meta');
    if (!el || !data || !data.ok) return;
    var prefix = String(data.scan_prefix || 'uploads').trim() || 'uploads';
    var bucket = String(data.bucket || '').trim();
    var fetched = data.fetched_at
      ? new Date(data.fetched_at).toLocaleString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      : '';
    var extra =
      data.total_folders_in_bucket > data.total_folders
        ? ' · showing newest ' + data.total_folders + ' of ' + data.total_folders_in_bucket
        : '';
    el.textContent =
      (bucket ? 'Bucket: ' + bucket + ' · ' : '') +
      'Path: ' +
      prefix +
      '/…' +
      (fetched ? ' · Refreshed ' + fetched : '') +
      extra;
    el.hidden = false;
  }

  function load() {
    showAlert('');
    document.getElementById('docs-tbody').innerHTML =
      '<tr><td colspan="9" class="docs-table__empty">Loading…</td></tr>';
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
            '<tr><td colspan="9" class="docs-table__empty">—</td></tr>';
          return;
        }
        updateStorageMeta(data);
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
            'No documents yet. Upload from production chat (not /qa), wait for bot success, then Refresh.'
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
                '. Change the date range or click All dates.'
            );
          }
        }
        applyFilter();
      })
      .catch(function () {
        showAlert('Network error. Check desk token and server.');
        document.getElementById('docs-tbody').innerHTML =
          '<tr><td colspan="8" class="docs-table__empty">—</td></tr>';
      });
  }

  document.getElementById('docs-refresh').addEventListener('click', load);
  document.getElementById('docs-search').addEventListener('input', applyFilter);
  document.getElementById('docs-date-from').addEventListener('change', onDateInputChange);
  document.getElementById('docs-date-to').addEventListener('change', onDateInputChange);
  document.getElementById('docs-date-from').addEventListener('blur', onDateInputChange);
  document.getElementById('docs-date-to').addEventListener('blur', onDateInputChange);
  document.getElementById('docs-date-all').addEventListener('click', function () {
    var fromEl = document.getElementById('docs-date-from');
    var toEl = document.getElementById('docs-date-to');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    state.dateFilterActive = false;
    showAlert('');
    applyFilter();
  });
  initDefaultDateRange();
  load();
})();
