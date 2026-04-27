/**
 * One-line embed (same folder as company.css, company.config.js, company.js):
 *   <script src="company-loader.js?botid=0001"></script>
 * Sets window.COMPANY_EMBED_BOT_ID when ?botid= is present (see company.config.js).
 * Loads: company.css, gstatic df-messenger, company.config.js, company.js
 */
(function () {
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
  if (!src) {
    return;
  }
  var url = new URL(src);
  var botId = (url.searchParams.get("botid") || "").trim();
  if (botId) {
    window.COMPANY_EMBED_BOT_ID = botId;
  }
  var base = new URL(".", src);
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("company.css", base).href;
  document.head.appendChild(link);
  var s0 = document.createElement("script");
  s0.src = "https://www.gstatic.com/dialogflow-console/fast/df-messenger/prod/v1/df-messenger.js";
  s0.onload = function () {
    var s1 = document.createElement("script");
    s1.src = new URL("company.config.js", base).href;
    s1.onload = function () {
      var s2 = document.createElement("script");
      s2.src = new URL("company.js", base).href;
      s2.async = true;
      (document.body || document.head).appendChild(s2);
    };
    (document.body || document.head).appendChild(s1);
  };
  (document.body || document.head).appendChild(s0);
})();
