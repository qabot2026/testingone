(function () {
  var cur = document.currentScript;
  if (!cur || !cur.src) return;
  var base = new URL("../..", cur.src);
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
