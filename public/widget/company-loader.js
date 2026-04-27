(function () {
  // `document.currentScript` is null for `async` scripts in many browsers — resolve URL explicitly.
  var cur = document.currentScript;
  var src = (cur && cur.src) || "";
  if (!src) {
    var nodes = document.querySelectorAll("script[src*='company-loader.js']");
    var last = nodes.length ? nodes[nodes.length - 1] : null;
    if (last && last.src) src = last.src;
  }
  if (!src) return;
  var base = new URL("../..", src);
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
