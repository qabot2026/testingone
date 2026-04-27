/**
 * One-line embed (absolute URLs for GitHub Pages):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=3"></script>
 * Bump COMPANY_BUNDLE_VERSION and &v= after any asset change.
 *
 * - Waits for document.body before loading (3rd-party pages often put the tag in <head> — without this,
 *   company.js can run when body is still null; direct <script> tags at the end of <body> avoid that).
 * - Loads company.js without async so order matches a direct, synchronous <script> reference.
 * - If the host uses CSP, script-src must allow: this loader host, gstatic, dialogflow, googleapis
 *   (or use direct <link>/<script> tags in HTML instead of this loader; some strict policies block
 *   dynamically created scripts to third-party hosts).
 * Change COMPANY_ASSET_BASE if you move the site.
 */
(function () {
  var COMPANY_ASSET_BASE = "https://qabot2026.github.io/testingone/";
  var COMPANY_BUNDLE_VERSION = "3";

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
    s0.src = "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";
    s0.onload = function () {
      var s1 = document.createElement("script");
      s1.src = withBust(base + "company.config.js");
      s1.onload = function () {
        var s2 = document.createElement("script");
        s2.src = withBust(base + "company.js");
        // No async: same execution semantics as a normal blocking <script src="company.js"> after config.
        document.body.appendChild(s2);
      };
      document.body.appendChild(s1);
    };
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
