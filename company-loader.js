/**
 * One line on ANY site (parent page only needs this script; no gstatic/Dialogflow in *parent* CSP):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=7"></script>
 *
 * This does NOT inject third-party <script> tags. It adds one <iframe> to chat-frame.html
 * on the same host. The iframe is a normal static HTML page (same 4 resources that work when pasted).
 * Bump IFRAME_VERSION and ?v= on deploy.
 *
 * iframe `chat-frame.html` URL uses the **same origin as this script**, so localhost and GitHub Pages
 * both pull `company.js` / `company.config.js` next to `company-loader.js`  (no pinned stale CDN copies).
 */
(function () {
  if (window.__COMPANY_WIDGET_IFRAME_MOUNTED) {
    return;
  }
  window.__COMPANY_WIDGET_IFRAME_MOUNTED = true;

  function chatHostFromLoaderSrc() {
    try {
      var cur = document.currentScript;
      var src = cur && cur.src;
      if (!src) {
        var nodes = document.querySelectorAll("script[src*='company-loader.js']");
        src = nodes.length ? nodes[nodes.length - 1].src : "";
      }
      if (!src) {
        return "";
      }
      var u = new URL(src);
      var path = u.pathname.replace(/[^/]+$/, "");
      return u.origin + path;
    } catch (e) {
      return "";
    }
  }

  var CHAT_HOST = chatHostFromLoaderSrc() || "https://qabot2026.github.io/testingone/";
  var IFRAME_VERSION = "123-es-cx-ui-parity";
  var DEFAULT_API_BASE = "https://handsome-amazement-production-7f65.up.railway.app";

  function getLoaderQuery() {
    var cur = document.currentScript;
    if (cur && cur.src) {
      try {
        return new URL(cur.src).searchParams;
      } catch (e) {
        return new URLSearchParams();
      }
    }
    var nodes = document.querySelectorAll("script[src*='company-loader.js']");
    var last = nodes.length ? nodes[nodes.length - 1] : null;
    if (last && last.src) {
      try {
        return new URL(last.src).searchParams;
      } catch (e2) {
        return new URLSearchParams();
      }
    }
    return new URLSearchParams();
  }
  var q = getLoaderQuery();
  var bot = (q.get("botid") || "").trim();
  /** Pass-through: backend base URL for `/contact-form-submissions` (Railway API). */
  var apiBase = (q.get("apiBase") || "").trim() || DEFAULT_API_BASE;

  var frameUrl = CHAT_HOST + "chat-frame.html?v=" + encodeURIComponent(IFRAME_VERSION);
  if (bot) {
    frameUrl += "&botid=" + encodeURIComponent(bot);
  }
  if (apiBase) {
    frameUrl += "&apiBase=" + encodeURIComponent(apiBase);
  }
  /** Parent document URL → chat iframe reads this so `client_context.source_url` is the host page, not `chat-frame.html` or API host. */
  try {
    frameUrl += "&hostPage=" + encodeURIComponent(window.location.href);
  } catch (e2) {
    /* ignore invalid parent location */
  }

  function mount() {
    if (!document.body) {
      return;
    }
    if (document.getElementById("company-chat-widget-iframe")) {
      return;
    }
    var f = document.createElement("iframe");
    f.id = "company-chat-widget-iframe";
    f.title = "Chat";
    f.setAttribute("src", frameUrl);
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    /* iframe must use pointer-events:auto — none on the iframe element sends every click through to the host page, so the chat cannot be used. */
    var mobile = false;
    try {
      mobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    } catch (e0) {
      mobile = false;
    }
    f.style.cssText = mobile
      ? [
          "position:fixed",
          "left:0",
          "right:0",
          "bottom:0",
          "top:0",
          "width:100%",
          "height:100%",
          "border:0",
          "z-index:2147483000",
          "pointer-events:auto",
          "background:transparent"
        ].join(";")
      : [
          "position:fixed",
          "right:0",
          "bottom:0",
          "width:min(440px, 100vw)",
          "height:min(720px, 100vh)",
          "border:0",
          "z-index:2147483000",
          "pointer-events:auto",
          "background:transparent"
        ].join(";");
    document.body.appendChild(f);
  }

  if (document.body) {
    mount();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    var n = 0;
    (function w() {
      if (document.body) {
        mount();
        return;
      }
      if (n++ > 200) {
        return;
      }
      setTimeout(w, 0);
    })();
  }
})();