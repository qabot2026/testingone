/**
 * Chat media library — upload images/PDFs to GCS and manage their public links.
 */

(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  var nav = window.DashboardNav;
  if (!auth || !auth.requireAuthOrRedirect('super/assets.html')) return;

  var loaded = false;
  var cachedAssets = [];
  var assetsMaxMb = 20;

  function assetsRejectMessage() {
    return 'File is too large. Maximum size is ' + assetsMaxMb + ' MB.';
  }

  function validateDuplicateFiles(files) {
    var taken = {};
    var i;
    for (i = 0; i < cachedAssets.length; i++) {
      taken[String(cachedAssets[i].file_name || '').trim().toLowerCase()] = true;
    }
    for (i = 0; i < files.length; i++) {
      var name = files[i].name || '';
      var key = name.trim().toLowerCase();
      if (!key) continue;
      if (taken[key]) {
        return { ok: false, message: 'This file already exists: ' + name };
      }
      taken[key] = true;
    }
    return { ok: true };
  }

  function validateUploadFiles(files) {
    if (!files || !files.length) return { ok: false, message: 'No file selected.' };
    var dup = validateDuplicateFiles(files);
    if (!dup.ok) return dup;
    var maxBytes = assetsMaxMb * 1024 * 1024;
    var rejectMsg = assetsRejectMessage();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !f.size) continue;
      if (f.size > maxBytes) {
        var fileName = f.name || 'file';
        return { ok: false, message: fileName + ': ' + rejectMsg };
      }
    }
    return { ok: true };
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

  function assetsApi(path) {
    return auth.apiBase() + '/api/chat-assets' + (path || '');
  }

  function assetUrl(asset) {
    if (!asset || !asset.public_path) return '';
    return auth.apiBase() + asset.public_path;
  }

  function setStatus(msg, isError) {
    var el = $('qap-assets-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.toggle('qap-status--error', !!isError);
  }

  function formatWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }

  function formatSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isImage(type) {
    return /^image\//i.test(String(type || ''));
  }

  function assetIcon(asset) {
    if (isImage(asset.content_type)) {
      return (
        '<img class="qap-asset-thumb" src="' +
        esc(assetUrl(asset)) +
        '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />'
      );
    }
    return '<span class="qap-asset-icon" aria-hidden="true">PDF</span>';
  }

  function actionIconBtn(className, iconSvg, label, dataAct) {
    return (
      '<button type="button" class="qap-asset-icon-btn ' +
      className +
      '" data-act="' +
      esc(dataAct) +
      '" title="' +
      esc(label) +
      '" aria-label="' +
      esc(label) +
      '">' +
      iconSvg +
      '</button>'
    );
  }

  var ICON_COPY =
    '<svg class="qap-asset-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_VIEW =
    '<svg class="qap-asset-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  var ICON_DOWNLOAD =
    '<svg class="qap-asset-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  var ICON_DELETE =
    '<svg class="qap-asset-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  function buildAssetRow(asset) {
    return (
      '<div class="qap-asset" data-object="' + esc(asset.gcs_object) + '">' +
      '<div class="qap-asset-left">' +
      '<div class="qap-asset-media">' + assetIcon(asset) + '</div>' +
      '<div class="qap-asset-size">' + esc(formatSize(asset.size_bytes)) + '</div>' +
      '</div>' +
      '<div class="qap-asset-side">' +
      '<div class="qap-asset-side-top">' +
      '<div class="qap-asset-name" title="' + esc(asset.file_name) + '">' + esc(asset.file_name) + '</div>' +
      '<div class="qap-asset-sub">' + esc(formatWhen(asset.uploaded_at)) + '</div>' +
      '</div>' +
      '<div class="qap-asset-action-icons">' +
      actionIconBtn('qap-asset-icon-btn--copy', ICON_COPY, 'Copy link', 'copy') +
      actionIconBtn('qap-asset-icon-btn--view', ICON_VIEW, 'View', 'view') +
      actionIconBtn('qap-asset-icon-btn--download', ICON_DOWNLOAD, 'Download', 'download') +
      actionIconBtn('qap-asset-icon-btn--delete', ICON_DELETE, 'Delete', 'delete') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderList() {
    var el = $('qap-assets-list');
    if (!el) return;
    if (!cachedAssets.length) {
      el.innerHTML = '<p class="dash-muted qap-assets-empty">No files uploaded yet.</p>';
      return;
    }
    el.innerHTML = cachedAssets.map(buildAssetRow).join('');
    wireRows();
  }

  function findAsset(obj) {
    return cachedAssets.find(function (a) {
      return a.gcs_object === obj;
    });
  }

  function wireRows() {
    var el = $('qap-assets-list');
    if (!el) return;
    el.querySelectorAll('.qap-asset').forEach(function (row) {
      var obj = row.getAttribute('data-object');
      row.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'copy') copyLink(obj);
          else if (act === 'view') viewAsset(obj);
          else if (act === 'download') downloadAsset(obj);
          else if (act === 'delete') deleteAsset(obj, row);
        });
      });
    });
  }

  function copyLink(obj) {
    var asset = findAsset(obj);
    var url = assetUrl(asset);
    if (!url) return;
    var done = function () {
      setStatus('Copied to clipboard.', false);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () {
        fallbackCopy(url);
        done();
      });
    } else {
      fallbackCopy(url);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  function viewAsset(obj) {
    var url = assetUrl(findAsset(obj));
    if (url) window.open(url, '_blank', 'noopener');
  }

  function downloadAsset(obj) {
    setStatus('Preparing download…', false);
    fetch(assetsApi('/download?object=' + encodeURIComponent(obj)), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok || !body.url) throw new Error(body.error || 'Download failed');
        window.open(body.url, '_blank', 'noopener');
        setStatus('', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Download failed', true);
      });
  }

  function deleteAsset(obj, row) {
    if (!window.confirm('Delete this file from the media library?')) return;
    setStatus('Deleting…', false);
    fetch(assetsApi('/delete'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.authHeaders()),
      body: JSON.stringify({ object: obj }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok) throw new Error(body.error || 'Delete failed');
        cachedAssets = cachedAssets.filter(function (a) {
          return a.gcs_object !== obj;
        });
        renderList();
        setStatus('File deleted.', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Delete failed', true);
      });
  }

  function loadAssets(showStatus) {
    if (showStatus) setStatus('Loading…', false);
    return fetch(assetsApi(''), {
      credentials: 'same-origin',
      headers: auth.authHeaders(),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        if (!body.ok) {
          var msg =
            body.error === 'gcs_not_configured'
              ? 'Storage not configured — set GCS_BUCKET_NAME and GOOGLE_CREDENTIALS_JSON on the server.'
              : body.error || 'Could not load files';
          throw new Error(msg);
        }
        cachedAssets = body.assets || [];
        if (body.max_upload_mb) assetsMaxMb = Number(body.max_upload_mb) || assetsMaxMb;
        loaded = true;
        renderList();
        if (showStatus) setStatus(cachedAssets.length + ' file(s).', false);
      })
      .catch(function (err) {
        setStatus(err.message || 'Could not load files', true);
      });
  }

  function uploadAssets(files) {
    if (!files || !files.length) return;
    function runUpload() {
      var check = validateUploadFiles(files);
      if (!check.ok) {
        setStatus(check.message, true);
        return;
      }
      var fd = new FormData();
      for (var i = 0; i < files.length; i++) fd.append('files', files[i]);
      setStatus('Uploading ' + files.length + ' file(s)…', false);
      fetch(assetsApi('/upload'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: auth.authHeaders(),
        body: fd,
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (body) {
          if (!body.ok) {
            var msg =
              body.error === 'gcs_not_configured'
                ? 'Storage not configured — set GCS_BUCKET_NAME and GOOGLE_CREDENTIALS_JSON on the server.'
                : body.message || body.error || 'Upload failed';
            throw new Error(msg);
          }
          setStatus('Uploaded ' + (body.uploaded || 0) + ' file(s).', false);
          loadAssets(false);
        })
        .catch(function (err) {
          setStatus(err.message || 'Upload failed', true);
        });
    }
    if (!loaded) {
      loadAssets(false).then(runUpload);
      return;
    }
    runUpload();
  }

  function wire() {
    var uploadBtn = $('qap-assets-upload-btn');
    var fileInput = $('qap-assets-file');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        if (this.files && this.files.length) uploadAssets(this.files);
        this.value = '';
      });
    }
  }

  function init() {
    if (!$('qap-assets')) return;
    var bid = nav.getBid();
    var bot =
      nav.BOTS.find(function (b) {
        return b.id === bid;
      }) || nav.BOTS[0];
    nav.mount({
      active: 'assets',
      title: 'Assets',
      subtitle: bot.name + ' (Bot ID ' + bot.id + ')',
      bid: bid,
    });
    wire();
    loadAssets(true);
  }

  nav.whenReady(init);
})();
