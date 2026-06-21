/**
 * Legacy hook — transcript turns are logged on the server (/api/chat, live-agent).
 * Kept so old embed.js script order does not break; no duplicate client POSTs.
 */
(function (global) {
  'use strict';

  function patchWidget() {
    var C = global.ESChatWidget;
    if (!C || !C.prototype) return !!C;
    if (C.prototype._transcriptPatched) return true;
    C.prototype._transcriptPatched = true;
    return true;
  }

  if (!patchWidget()) {
    var n = 0;
    var iv = setInterval(function () {
      n += 1;
      if (patchWidget() || n > 80) clearInterval(iv);
    }, 100);
  }
})(typeof window !== 'undefined' ? window : globalThis);
