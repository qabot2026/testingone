/* ===========================================================
   Chatbot dashboard front-end
   ===========================================================
   - Login (magic link)
   - Settings form bound to the widget's flat-settings schema
   - Live preview via postMessage to chat-frame.html
   - Save persists to Firestore via the API
   =========================================================== */

(function () {
  "use strict";

  // ---------------------------------------------------------
  // Constants + helpers
  // ---------------------------------------------------------

  /** Local storage keys. */
  var LS_PREVIEW_URL = "dashboard.previewUrl";
  var LS_BOTID = "dashboard.botid";

  /** Defaults applied when a setting has no saved value. */
  var DEFAULTS = Object.freeze({
    chatbotPrimaryColor: "#0369a1",
    userMessageBg: "#0369a1",
    userMessageText: "#ffffff",
    botMessageBg: "#f1f5f9",
    botMessageText: "#0f172a",
    chatIconUrl: "",
    chatTitleIconUrl: "",
    headerTitle: "",
    headerSubtitle: "",
    enableMic: true,
    enableRestart: true,
    enableMultiLanguage: true,
    enablePoweredBy: true,
    inputPlaceholder: "",
    autoOpenEnabled: false,
    autoOpenSeconds: 0,
    bubbleStripEnabled: false,
    bubbleStripText: ""
  });

  /** Setting field metadata: how to coerce + how to bind to flat keys when sending to widget. */
  var SETTINGS = [
    { key: "chatbotPrimaryColor", type: "color" },
    { key: "userMessageBg", type: "color" },
    { key: "userMessageText", type: "color" },
    { key: "botMessageBg", type: "color" },
    { key: "botMessageText", type: "color" },
    { key: "chatIconUrl", type: "text" },
    { key: "chatTitleIconUrl", type: "text" },
    { key: "headerTitle", type: "text" },
    { key: "headerSubtitle", type: "text" },
    { key: "enableMic", type: "bool" },
    { key: "enableRestart", type: "bool" },
    { key: "enableMultiLanguage", type: "bool" },
    { key: "enablePoweredBy", type: "bool" },
    { key: "inputPlaceholder", type: "text" },
    { key: "autoOpenEnabled", type: "bool" },
    { key: "autoOpenSeconds", type: "number" },
    { key: "bubbleStripEnabled", type: "bool" },
    { key: "bubbleStripText", type: "text" }
  ];

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function isHexColor(s) {
    return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s.trim());
  }

  function safeOriginOf(urlStr) {
    try {
      return new URL(urlStr, window.location.href).origin;
    } catch (e) {
      return "";
    }
  }

  function showToast(text, kind) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "err", "show");
    if (kind) el.classList.add(kind);
    el.hidden = false;
    requestAnimationFrame(function () {
      el.classList.add("show");
    });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 200);
    }, 2400);
  }

  // ---------------------------------------------------------
  // API client
  // ---------------------------------------------------------

  function apiFetch(path, opts) {
    var o = Object.assign({ credentials: "same-origin", headers: {} }, opts || {});
    if (o.body && !(o.body instanceof FormData)) {
      o.headers["Content-Type"] = o.headers["Content-Type"] || "application/json";
      if (typeof o.body !== "string") o.body = JSON.stringify(o.body);
    }
    return fetch(path, o).then(function (resp) {
      var ct = resp.headers.get("content-type") || "";
      var parser = ct.indexOf("application/json") >= 0
        ? resp.json()
        : resp.text().then(function (t) { return { ok: resp.ok, status: resp.status, text: t }; });
      return parser.then(function (data) {
        if (!resp.ok) {
          var msg = (data && data.error) || (data && data.text) || ("HTTP " + resp.status);
          var err = new Error(msg);
          err.status = resp.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------------------------------------------------------
  // Login view
  // ---------------------------------------------------------

  function showLogin() {
    $("#loginView").hidden = false;
    $("#mainView").hidden = true;
  }

  function showMain() {
    $("#loginView").hidden = true;
    $("#mainView").hidden = false;
  }

  function setLoginMessage(text, kind) {
    var el = $("#loginMessage");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("ok", "err");
    if (kind) el.classList.add(kind);
  }

  function bindLogin() {
    var form = $("#loginForm");
    var btn = $("#loginSubmit");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = ($("#loginEmail").value || "").trim();
      if (!email) {
        setLoginMessage("Please enter your email.", "err");
        return;
      }
      btn.disabled = true;
      setLoginMessage("Sending sign-in link…");
      apiFetch("/api/dashboard/login/request", {
        method: "POST",
        body: { email: email }
      }).then(function (data) {
        setLoginMessage(data && data.message ? data.message : "Check your inbox for the sign-in link.", "ok");
      }).catch(function (err) {
        setLoginMessage("Failed: " + (err && err.message ? err.message : err), "err");
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  // ---------------------------------------------------------
  // Main view: settings binding + preview
  // ---------------------------------------------------------

  /** Current in-memory settings object (flat schema). */
  var state = Object.assign({}, DEFAULTS);

  /** Apply state → DOM inputs. */
  function renderInputs() {
    SETTINGS.forEach(function (def) {
      var key = def.key;
      var value = state[key];
      var input = document.querySelector("[data-setting='" + key + "']");
      if (!input) return;
      if (def.type === "color") {
        var hex = isHexColor(value) ? value : DEFAULTS[key];
        input.value = hex;
        var hexInput = document.querySelector("[data-setting-pair='" + key + "']");
        if (hexInput) hexInput.value = hex;
      } else if (def.type === "bool") {
        input.checked = !!value;
      } else if (def.type === "number") {
        input.value = (value == null || value === "") ? "" : String(value);
      } else {
        input.value = value == null ? "" : String(value);
      }
    });
  }

  /** DOM inputs → state object. */
  function readInputs() {
    SETTINGS.forEach(function (def) {
      var key = def.key;
      var input = document.querySelector("[data-setting='" + key + "']");
      if (!input) return;
      if (def.type === "color") {
        var v = (input.value || "").trim().toLowerCase();
        if (isHexColor(v)) state[key] = v;
      } else if (def.type === "bool") {
        state[key] = !!input.checked;
      } else if (def.type === "number") {
        var n = Number(input.value);
        state[key] = Number.isFinite(n) ? n : 0;
      } else {
        state[key] = input.value;
      }
    });
  }

  /**
   * Translate the dashboard's own keys into the widget's flat-settings schema
   * understood by `window.__dfchatApplyCompanyAdminFlatSettings` in company.js.
   */
  function buildFlatPatch() {
    var flat = {};

    // Colors
    flat.chatbotPrimaryColor = state.chatbotPrimaryColor;
    flat.userMessageBg = state.userMessageBg;
    flat.userMessageText = state.userMessageText;
    flat.botMessageBg = state.botMessageBg;
    flat.botMessageText = state.botMessageText;

    // Images
    if (state.chatIconUrl) flat.chatIconUrl = state.chatIconUrl;
    if (state.chatTitleIconUrl) flat.chatTitleIconUrl = state.chatTitleIconUrl;

    // Header text
    flat.headerTitle = state.headerTitle;
    flat.headerSubtitle = state.headerSubtitle;

    // Features (bool)
    flat.enableMic = !!state.enableMic;
    flat.enableRestart = !!state.enableRestart;
    flat.enableMultiLanguage = !!state.enableMultiLanguage;
    flat.enablePoweredBy = !!state.enablePoweredBy;

    // Auto-open: apply to both desktop and mobile so a single dial controls both.
    flat.autoOpenDeskEnabled = !!state.autoOpenEnabled;
    flat.autoOpenMobEnabled = !!state.autoOpenEnabled;
    var ms = Math.max(0, Math.round(Number(state.autoOpenSeconds) * 1000));
    if (Number.isFinite(ms)) {
      flat.autoOpenDeskDelayMs = ms;
      flat.autoOpenMobDelayMs = ms;
    }

    // Bubble strip: apply same toggle + text to desktop and mobile.
    flat.launcherStripDeskEnabled = !!state.bubbleStripEnabled;
    flat.launcherStripMobEnabled = !!state.bubbleStripEnabled;
    flat.launcherStripDeskText = state.bubbleStripText || "";
    flat.launcherStripMobText = state.bubbleStripText || "";

    return flat;
  }

  /**
   * Build a deep "advanced patch" for keys not natively handled by the widget's
   * flat schema (currently: input placeholder).
   */
  function buildAdvancedPatchJson() {
    var patch = {};
    if (state.inputPlaceholder) {
      patch.common = patch.common || {};
      patch.common.features = patch.common.features || {};
      patch.common.features.multiLanguage = patch.common.features.multiLanguage || {};
      // Apply to all common languages so it shows regardless of currently selected.
      patch.common.features.multiLanguage.inputPlaceholderByLanguage = {
        en: state.inputPlaceholder,
        hi: state.inputPlaceholder,
        mr: state.inputPlaceholder
      };
    }
    return Object.keys(patch).length ? JSON.stringify(patch) : "";
  }

  // ---------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------

  function getPreviewUrl() {
    return ($("#previewUrl").value || "").trim();
  }

  function setPreviewUrl(url) {
    $("#previewUrl").value = url || "";
    try {
      if (url) {
        localStorage.setItem(LS_PREVIEW_URL, url);
      } else {
        localStorage.removeItem(LS_PREVIEW_URL);
      }
    } catch (e) { /* ignore quota */ }
  }

  /**
   * (Re)load the preview iframe with adminOrigin baked into the URL so the
   * iframe accepts cross-origin postMessage from us.
   */
  function reloadPreview() {
    var url = getPreviewUrl();
    var iframe = $("#previewFrame");
    var empty = $("#previewEmpty");
    if (!url) {
      iframe.removeAttribute("src");
      empty.classList.remove("hidden");
      return;
    }
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    var withParams = url + sep + "adminOrigin=" + encodeURIComponent(window.location.origin)
      + "&botid=" + encodeURIComponent(currentBotId())
      + "&v=" + Date.now();
    iframe.src = withParams;
    empty.classList.add("hidden");
  }

  /**
   * Send the current state to the preview iframe (uses postMessage).
   * Includes the advanced patch JSON to cover non-flat fields.
   */
  function pushToPreview() {
    var iframe = $("#previewFrame");
    if (!iframe || !iframe.src || !iframe.contentWindow) return;
    var targetOrigin = safeOriginOf(iframe.src) || "*";
    var flat = buildFlatPatch();
    var adv = buildAdvancedPatchJson();
    if (adv) flat.advancedPatchJson = adv;
    try {
      iframe.contentWindow.postMessage({
        type: "company_admin_settings",
        settings: flat
      }, targetOrigin);
    } catch (e) {
      // postMessage cannot meaningfully fail except for serialisation; ignore.
    }
  }

  var pushToPreviewDebounced = debounce(pushToPreview, 80);

  // ---------------------------------------------------------
  // Bind inputs
  // ---------------------------------------------------------

  function bindSettingsInputs() {
    SETTINGS.forEach(function (def) {
      var input = document.querySelector("[data-setting='" + def.key + "']");
      if (!input) return;
      var ev = (def.type === "bool") ? "change" : "input";
      input.addEventListener(ev, function () {
        if (def.type === "color") {
          var hex = (input.value || "").trim().toLowerCase();
          if (!isHexColor(hex)) return;
          state[def.key] = hex;
          var hexInput = document.querySelector("[data-setting-pair='" + def.key + "']");
          if (hexInput && hexInput.value !== hex) hexInput.value = hex;
        } else if (def.type === "bool") {
          state[def.key] = !!input.checked;
        } else if (def.type === "number") {
          var n = Number(input.value);
          state[def.key] = Number.isFinite(n) ? n : 0;
        } else {
          state[def.key] = input.value;
        }
        pushToPreviewDebounced();
      });
    });

    // Paired hex text inputs let the user type/paste a color value.
    $$(".color-hex").forEach(function (hexInput) {
      hexInput.addEventListener("input", function () {
        var key = hexInput.getAttribute("data-setting-pair");
        if (!key) return;
        var v = (hexInput.value || "").trim().toLowerCase();
        if (!isHexColor(v)) return;
        state[key] = v;
        var colorInput = document.querySelector("[data-setting='" + key + "']");
        if (colorInput && colorInput.value !== v) colorInput.value = v;
        pushToPreviewDebounced();
      });
    });
  }

  // ---------------------------------------------------------
  // Topbar actions
  // ---------------------------------------------------------

  function currentBotId() {
    var v = ($("#botIdInput").value || "").trim().toLowerCase();
    if (!v) v = "default";
    return v.replace(/[^a-z0-9._-]/g, "").slice(0, 64) || "default";
  }

  function loadSavedSettings() {
    var bot = currentBotId();
    return apiFetch("/api/dashboard/settings?botid=" + encodeURIComponent(bot))
      .then(function (data) {
        var flat = (data && data.flat) || {};
        // Adapt the server's stored flat shape back to our dashboard state keys.
        state = Object.assign({}, DEFAULTS);
        Object.keys(flat).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
            state[k] = flat[k];
          }
        });
        renderInputs();
        pushToPreview();
      });
  }

  function bindTopbar() {
    var botInput = $("#botIdInput");
    var initialBot = "default";
    try { initialBot = localStorage.getItem(LS_BOTID) || "default"; } catch (e) { /* ignore */ }
    botInput.value = initialBot;

    botInput.addEventListener("change", function () {
      var v = currentBotId();
      botInput.value = v;
      try { localStorage.setItem(LS_BOTID, v); } catch (e) { /* ignore */ }
      loadSavedSettings()
        .then(function () { showToast("Loaded settings for '" + v + "'", "ok"); })
        .catch(function (err) {
          showToast("Load failed: " + (err && err.message ? err.message : err), "err");
        })
        .then(function () { reloadPreview(); });
    });

    $("#reloadSettingsBtn").addEventListener("click", function () {
      loadSavedSettings()
        .then(function () { showToast("Reloaded saved settings.", "ok"); })
        .catch(function (err) {
          showToast("Reload failed: " + (err && err.message ? err.message : err), "err");
        });
    });

    $("#saveBtn").addEventListener("click", function () {
      var bot = currentBotId();
      var btn = $("#saveBtn");
      btn.disabled = true;
      readInputs();
      var payload = {
        flat: buildFlatPatch(),
        advancedPatchJson: buildAdvancedPatchJson()
      };
      apiFetch("/api/dashboard/settings?botid=" + encodeURIComponent(bot), {
        method: "PUT",
        body: payload
      }).then(function () {
        showToast("Saved live for '" + bot + "'", "ok");
      }).catch(function (err) {
        showToast("Save failed: " + (err && err.message ? err.message : err), "err");
      }).then(function () {
        btn.disabled = false;
      });
    });

    $("#logoutBtn").addEventListener("click", function () {
      apiFetch("/api/dashboard/logout", { method: "POST" })
        .catch(function () { /* ignore */ })
        .then(function () {
          window.location.reload();
        });
    });
  }

  function bindPreview() {
    var urlInput = $("#previewUrl");
    var savedUrl = "";
    try { savedUrl = localStorage.getItem(LS_PREVIEW_URL) || ""; } catch (e) { /* ignore */ }
    urlInput.value = savedUrl;
    urlInput.addEventListener("change", function () {
      setPreviewUrl(urlInput.value.trim());
      reloadPreview();
    });
    $("#reloadPreviewBtn").addEventListener("click", function () {
      setPreviewUrl(urlInput.value.trim());
      reloadPreview();
    });

    // When the preview iframe finishes loading, re-push current settings so they
    // re-apply (the iframe will also fetch saved settings from its own apiBase
    // but that may not match the dashboard's unsaved edits).
    $("#previewFrame").addEventListener("load", function () {
      // Small delay so company.js has time to register its message handler.
      setTimeout(pushToPreview, 350);
      setTimeout(pushToPreview, 1200);
    });

    if (savedUrl) reloadPreview();
  }

  function bindTabs() {
    // Currently only the UI/UX tab is active; this is just future-proofing.
    $$(".section-tabs .tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        $$(".section-tabs .tab").forEach(function (b) { b.classList.toggle("active", b === btn); });
      });
    });
  }

  // ---------------------------------------------------------
  // Boot
  // ---------------------------------------------------------

  function boot() {
    bindLogin();
    bindTopbar();
    bindPreview();
    bindTabs();
    bindSettingsInputs();
    renderInputs();

    apiFetch("/api/dashboard/me").then(function (data) {
      var email = data && data.email ? data.email : "";
      $("#meEmail").textContent = email ? "Signed in as " + email : "";
      showMain();
      return loadSavedSettings();
    }).catch(function () {
      showLogin();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
