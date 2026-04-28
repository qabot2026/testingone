/**
 * One line on ANY site (parent page only needs this script; no gstatic/Dialogflow in *parent* CSP):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=7"></script>
 *
 * This does NOT inject third-party <script> tags. It adds one <iframe> to chat-frame.html
 * on the same host. The iframe is a normal static HTML page (same 4 resources that work when pasted).
 * Bump IFRAME_VERSION and ?v= on deploy.
 * Host page iframe strip (which screen edge — NOT the bubble inside chat-frame.html):
 *   `?dock=right`|`left`; or preset `window.COMPANY_LOADER_IFRAME_DOCK='left'` before this script (see company.config chatLayout).
 * Default when omitted: **right**, to pair with usual `chatLayout.sideDesk: 'right'`.
 *
 * iframe `chat-frame.html` URL uses the **same origin as this script**, so localhost and GitHub Pages
 * both pull `company.js` / `company.config.js` next to `company-loader.js` (no pinned stale CDN copies).
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
  var IFRAME_VERSION = "10";

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
  /** Where the iframe strip sits on the *host* viewport: "left" | "right" (default matches common chatLayout.sideDesk right). */
  var dockParam = q.get("dock");
  var dockSide;
  if (dockParam !== null && String(dockParam).trim()) {
    dockSide = String(dockParam).trim().toLowerCase();
  } else if (
    typeof window.COMPANY_LOADER_IFRAME_DOCK === "string"
    && window.COMPANY_LOADER_IFRAME_DOCK.trim()
  ) {
    dockSide = window.COMPANY_LOADER_IFRAME_DOCK.trim().toLowerCase();
  } else {
    dockSide = "right";
  }
  if (dockSide !== "left" && dockSide !== "right") {
    dockSide = "right";
  }

  var frameUrl = CHAT_HOST + "chat-frame.html?v=" + encodeURIComponent(IFRAME_VERSION);
  if (bot) {
    frameUrl += "&botid=" + encodeURIComponent(bot);
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
    /* Parent page: iframe strip on left or right edge; INSIDE iframe, bubble follows common.chatLayout (sideDesk/sideMob). */
    var dockRight = dockSide === "right";
    var horiz = dockRight
      ? ["right:0", "left:auto"]
      : ["left:0", "right:auto"];
    f.style.cssText = [
      "position:fixed",
      "top:0",
      "bottom:0"
    ].concat(horiz).concat([
      "width:min(100vw, 520px)",
      "height:100%",
      "max-width:100vw",
      "border:0",
      "z-index:2147483000",
      "pointer-events:auto",
      "background:transparent"
    ]).join(";");
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
