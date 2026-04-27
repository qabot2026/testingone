/**
 * One-line embed (absolute URLs for GitHub Pages):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=2"></script>
 * Bump COMPANY_BUNDLE_VERSION (and the ?v= on this script tag on 3rd-party pages) after any change to
 * company.css / company.config.js / company.js or this file — avoids 304-cached old assets and UI drift.
 * Loads: company.css, gstatic df-messenger, company.config.js, company.js
 * Change COMPANY_ASSET_BASE if you move the site.
 */
(function () {
  var COMPANY_ASSET_BASE = "https://qabot2026.github.io/testingone/";
  /** Increment when you change company.css, company.config.js, company.js, or this loader. */
  var COMPANY_BUNDLE_VERSION = "2";

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
      s2.async = true;
      (document.body || document.head).appendChild(s2);
    };
    (document.body || document.head).appendChild(s1);
  };
  (document.body || document.head).appendChild(s0);
})();
