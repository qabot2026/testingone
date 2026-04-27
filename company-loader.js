/**
 * One-line embed (optional — if this fails, use the 4 static tags in wellness.html):
 *   <script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=4"></script>
 * Bump COMPANY_BUNDLE_VERSION and &v= on each deploy of assets.
 *
 * Dynamic <script> tags default to async in many browsers; this file sets async=false
 * on each script so load order matches pasted <script src> tags.
 * Waits for document.body. Some strict CSPs block createElement("script") to gstatic:
 * use direct tags on those sites.
 */
(function () {
  if (window.__COMPANY_WIDGET_LOADER_RAN) {
    return;
  }
  window.__COMPANY_WIDGET_LOADER_RAN = true;
  var COMPANY_ASSET_BASE = "https://qabot2026.github.io/testingone/";
  var COMPANY_BUNDLE_VERSION = "4";

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

  function setSync(el) {
    el.async = false;
    if ("defer" in el) {
      el.defer = false;
    }
  }

  function onScriptError(label, e) {
    if (window.console && console.error) {
      console.error("[company-loader] failed to load " + label, e && e.type ? e.type : e);
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
    setSync(s0);
    s0.src = "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";
    s0.onerror = onScriptError.bind(null, "df-messenger.js");
    s0.onload = function () {
      var s1 = document.createElement("script");
      setSync(s1);
      s1.src = withBust(base + "company.config.js");
      s1.onerror = onScriptError.bind(null, "company.config.js");
      s1.onload = function () {
        var s2 = document.createElement("script");
        setSync(s2);
        s2.src = withBust(base + "company.js");
        s2.onerror = onScriptError.bind(null, "company.js");
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
