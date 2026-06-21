/**
 * Brand logo (dashboard menu icon) uploader — Advanced configuration page.
 * Saves the chosen image to the GCS appearance icon object via the server.
 */

(function () {
  'use strict';

  var auth = window.DashboardDeskAuth;
  if (!auth) return;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $('superLogoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.classList.remove('super-form-status--error', 'super-form-status--ok');
    if (kind === 'error') el.classList.add('super-form-status--error');
    else if (kind === 'ok') el.classList.add('super-form-status--ok');
  }

  function refreshPreview() {
    var wrap = $('superLogoPreview');
    if (!wrap) return;
    var img = wrap.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = 'Current brand logo';
      wrap.appendChild(img);
    }
    img.style.display = '';
    // Cache-bust so the new logo shows immediately after upload.
    img.src = '/dashboard/icons/appearance-menu-icon.png?t=' + Date.now();
    img.onerror = function () {
      img.style.display = 'none';
    };
  }

  function upload(file) {
    var fd = new FormData();
    fd.append('file', file);
    setStatus('Uploading logo…', null);
    fetch(auth.apiBase() + '/api/appearance/menu-icon', {
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
          var err = result.body && result.body.error;
          var msg =
            err === 'gcs_not_configured'
              ? 'Cloud storage not configured on the server.'
              : (result.body && (result.body.message || err)) || 'Upload failed';
          throw new Error(msg);
        }
        setStatus('Logo updated.', 'ok');
        refreshPreview();
      })
      .catch(function (e) {
        setStatus(e.message || 'Upload failed', 'error');
      });
  }

  function wire() {
    var chooseBtn = $('superLogoChooseBtn');
    var fileInput = $('superLogoFile');
    var nameEl = $('superLogoName');
    if (!chooseBtn || !fileInput) return;

    chooseBtn.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) {
        if (nameEl) nameEl.textContent = this.files[0].name;
        upload(this.files[0]);
      } else if (nameEl) {
        nameEl.textContent = 'No file chosen';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
