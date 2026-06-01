/**
 * Loads translations/strings.json before company.js (sync XHR — needs http/https, not file://).
 */
(function (w) {
  w.DFCHAT_STRINGS = null;
  var url = "translations/strings.json?v=2";
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      w.DFCHAT_STRINGS = JSON.parse(xhr.responseText);
    }
  } catch (e) {
    console.warn("[dfchat] Could not load strings.json:", e);
  }
})(typeof window !== "undefined" ? window : globalThis);
