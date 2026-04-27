/**
 * One-line only in your page (all other URLs are inside this file):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=5"></script>
 * Bump COMPANY_BUNDLE_VERSION and this ?v= when you deploy asset changes.
 *
 * Fixes the usual loader bugs:
 * - Dynamic scripts default to async; we force sync order (set async/defer false BEFORE .src, remove async attr).
 * - Waits for document.body.
 * - Strict CSP: if the host blocks createElement("script") to gstatic, that host cannot use any one-line
 *   third-party widget without allowing those script-src sites (not fixable in JS).
 */
(function () {
  if (window.__COMPANY_WIDGET_LOADER_RAN) {
    return;
  }
  window.__COMPANY_WIDGET_LOADER_RAN = true;
  var COMPANY_ASSET_BASE = "https://qabot2026.github.io/testingone/";
  var COMPANY_BUNDLE_VERSION = "5";

  function withBust(u) {
    var sep = u.indexOf("?") === -1 ? "?" : "&";
    return u + sep + "v=" + encodeURIComponent(COMPANY_BUNDLE_VERSION);
  }

  function getLoaderSrc() {
    var cur = document.currentScript;
    if (cur && cur.src) {
      return cur.src;
    }
    var nodes = document.querySelectorAll("script[src*='company-loader.js']");
    var last = nodes.length ? nodes[nodes.length - 1] : null;
    return last && last.src ? last.src : "";
  }
  var src = getLoaderSrc();
  var url = src ? new URL(src) : null;
  if (url) {
    var botId = (url.searchParams.get("botid") || "").trim();
    if (botId) {
      window.COMPANY_EMBED_BOT_ID = botId;
    }
  }
  var base = COMPANY_ASSET_BASE.replace(/\/?$/, "/");

  /**
   * Must run BEFORE assigning .src, or the browser may start an async fetch.
   * @param {HTMLScriptElement} el
   */
  function forceClassicBlockingOrder(el) {
    el.removeAttribute("async");
    el.removeAttribute("defer");
    el.async = false;
    el.defer = false;
  }

  function onScriptError(label) {
    if (window.console && console.error) {
      console.error("[company-loader] failed to load: " + label);
    }
  }

  function injectAll() {
    if (!document.body) {
      return;
    }

    if (!document.getElementById("company-widget-company-css")) {
      var link = document.createElement("link");
      link.id = "company-widget-company-css";
      link.rel = "stylesheet";
      link.href = withBust(base + "company.css");
      document.head.appendChild(link);
    }

    var s0 = document.createElement("script");
    forceClassicBlockingOrder(s0);
    s0.onerror = onScriptError.bind(null, "df-messenger");
    s0.onload = function () {
      var s1 = document.createElement("script");
      forceClassicBlockingOrder(s1);
      s1.onerror = onScriptError.bind(null, "company.config.js");
      s1.onload = function () {
        var s2 = document.createElement("script");
        forceClassicBlockingOrder(s2);
        s2.onerror = onScriptError.bind(null, "company.js");
        s2.src = withBust(base + "company.js");
        document.body.appendChild(s2);
      };
      s1.src = withBust(base + "company.config.js");
      document.body.appendChild(s1);
    };
    s0.src = "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";
    document.body.appendChild(s0);
  }

  if (document.body) {
    injectAll();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectAll);
  } else {
    var n = 0;
    (function waitBody() {
      if (document.body) {
        injectAll();
        return;
      }
      if (n++ > 200) {
        return;
      }
      setTimeout(waitBody, 0);
    })();
  }
})();
