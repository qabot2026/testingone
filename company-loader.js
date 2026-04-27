/**
 * One line in the page (everything else is inside this file):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=6"></script>
 * Bump COMPANY_BUNDLE_VERSION and ?v= when you change any asset.
 *
 * Injects the same order as a working static page:
 *   <head> company.css, df-messenger.js
 *   <body> ... your content ... then company.config.js, company.js
 */
(function () {
  if (window.__COMPANY_WIDGET_LOADER_RAN) {
    return;
  }
  window.__COMPANY_WIDGET_LOADER_RAN = true;
  var COMPANY_ASSET_BASE = "https://qabot2026.github.io/testingone/";
  var COMPANY_BUNDLE_VERSION = "6";

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
  var u = src ? new URL(src) : null;
  if (u) {
    var bot = (u.searchParams.get("botid") || "").trim();
    if (bot) {
      window.COMPANY_EMBED_BOT_ID = bot;
    }
  }
  var base = COMPANY_ASSET_BASE.replace(/\/?$/, "/");

  function beforeSrc(el) {
    el.removeAttribute("async");
    el.removeAttribute("defer");
    el.async = false;
    el.defer = false;
  }

  function logErr(label) {
    if (window.console && console.error) {
      console.error("[company-loader] failed: " + label);
    }
  }

  function injectAll() {
    if (!document.body || !document.head) {
      return;
    }
    var head = document.head;
    var body = document.body;

    if (!document.getElementById("company-widget-company-css")) {
      var link = document.createElement("link");
      link.id = "company-widget-company-css";
      link.rel = "stylesheet";
      link.href = withBust(base + "company.css");
      head.appendChild(link);
    }

    var sDf = document.createElement("script");
    sDf.setAttribute("data-company-widget", "df-messenger");
    beforeSrc(sDf);
    sDf.onerror = function () {
      logErr("df-messenger");
    };
    sDf.onload = function () {
      var sCfg = document.createElement("script");
      sCfg.setAttribute("data-company-widget", "company.config");
      beforeSrc(sCfg);
      sCfg.onerror = function () {
        logErr("company.config.js");
      };
      sCfg.onload = function () {
        var sCo = document.createElement("script");
        sCo.setAttribute("data-company-widget", "company.js");
        beforeSrc(sCo);
        sCo.onerror = function () {
          logErr("company.js");
        };
        sCo.src = withBust(base + "company.js");
        body.appendChild(sCo);
      };
      sCfg.src = withBust(base + "company.config.js");
      body.appendChild(sCfg);
    };
    sDf.src = "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";
    head.appendChild(sDf);
  }

  if (document.body) {
    injectAll();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectAll, { once: true });
  } else {
    var n = 0;
    (function wait() {
      if (document.body && document.head) {
        injectAll();
        return;
      }
      if (n++ > 200) {
        return;
      }
      setTimeout(wait, 0);
    })();
  }
})();
