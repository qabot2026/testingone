(function (global) {
  'use strict';

  var DESK_KEY = 'qa_live_agent_desk';
  var SECRET_KEY = 'conversations_sheet_secret_v1';

  function desk() {
    try {
      return JSON.parse(localStorage.getItem(DESK_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function viewerSecret() {
    try {
      var local = localStorage.getItem(SECRET_KEY) || '';
      var session = sessionStorage.getItem(SECRET_KEY) || '';
      return (local || session).trim();
    } catch (e) {
      return '';
    }
  }

  function primarySecret() {
    return viewerSecret() || (desk().token || '').trim();
  }

  function hasAuth() {
    return !!primarySecret();
  }

  function persistViewerSecret(secret) {
    var s = String(secret || '').trim();
    if (!s) return false;
    try {
      sessionStorage.setItem(SECRET_KEY, s);
      localStorage.setItem(SECRET_KEY, s);
    } catch (e) {
      return false;
    }
    return true;
  }

  function authHeaders(extra) {
    var h = extra || {};
    var d = desk();
    var s = viewerSecret();
    var primary = primarySecret();
    if (d.token) h['X-Agent-Token'] = d.token;
    if (s) h['X-Conversations-Sheet-Secret'] = s;
    if (primary) h.Authorization = 'Bearer ' + primary;
    return h;
  }

  function apiBase() {
    return window.location.origin.replace(/\/$/, '');
  }

  function withAuthQuery(url) {
    var secret = primarySecret();
    if (!secret) return url;
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + 'token=' + encodeURIComponent(secret);
  }

  function requireAuthOrRedirect(returnPath) {
    if (hasAuth()) return true;
    var next = returnPath || 'dashboard/index.html';
    window.location.href =
      '../live-agent/settings.html?next=' + encodeURIComponent(next);
    return false;
  }

  function validateSecret(secret) {
    var s = String(secret || '').trim();
    if (!s) {
      return Promise.resolve({ ok: false, message: 'Enter viewer secret.' });
    }
    var headers = {
      'X-Conversations-Sheet-Secret': s,
      'X-Agent-Token': s,
      Authorization: 'Bearer ' + s,
    };
    return fetch(apiBase() + '/api/live-agent/me?token=' + encodeURIComponent(s), {
      headers: headers,
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok || !data.ok) {
            return {
              ok: false,
              message:
                (data && (data.error || data.message)) ||
                'Secret not accepted. Use CONVERSATIONS_SHEET_VIEW_SECRET from Railway.',
            };
          }
          persistViewerSecret(s);
          return { ok: true };
        });
      })
      .catch(function () {
        return { ok: false, message: 'Network error while checking secret.' };
      });
  }

  global.DashboardDeskAuth = {
    desk: desk,
    viewerSecret: viewerSecret,
    primarySecret: primarySecret,
    hasAuth: hasAuth,
    persistViewerSecret: persistViewerSecret,
    authHeaders: authHeaders,
    apiBase: apiBase,
    withAuthQuery: withAuthQuery,
    requireAuthOrRedirect: requireAuthOrRedirect,
    validateSecret: validateSecret,
  };
})(typeof window !== 'undefined' ? window : this);
