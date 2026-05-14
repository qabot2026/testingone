/* ===========================================================
   Chatbot dashboard front-end
   - Settings form → widget flat-settings schema
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
  // Main view: settings binding + preview
  // ---------------------------------------------------------

  /** Current in-memory settings object (flat schema). */
  var state = Object.assign({}, DEFAULTS);

  /** Snapshot of last published payload (for “Unpublished changes”). */
  var lastPublishedEnvelope = null;

  function currentEnvelope() {
    return JSON.stringify({
      flat: buildFlatPatch(),
      advancedPatchJson: buildAdvancedPatchJson()
    });
  }

  function updateDraftBadge() {
    var badge = $("#draftBadge");
    if (!badge) return;
    if (lastPublishedEnvelope === null) {
      badge.classList.add("hidden");
      return;
    }
    var dirty = currentEnvelope() !== lastPublishedEnvelope;
    badge.classList.toggle("hidden", !dirty);
  }

  var updateDraftBadgeDebounced = debounce(updateDraftBadge, 48);

  function setPublishedBaselineFromCurrentState() {
    lastPublishedEnvelope = currentEnvelope();
    updateDraftBadge();
  }

  /**
   * Load Firestore `flat` + optional `advancedPatchJson` into dashboard `state`.
   * Maps widget keys (autoOpenDesk*, launcherStrip*) back into simple form fields.
   */
  function hydrateStateFromServer(flat, advancedPatchJsonStr) {
    var f = flat && typeof flat === "object" ? flat : {};
    state = Object.assign({}, DEFAULTS);

    Object.keys(f).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) return;
      var meta = SETTINGS.filter(function (s) { return s.key === k; })[0];
      var t = meta ? meta.type : "text";
      var v = f[k];
      if (t === "bool") {
        state[k] = !!v;
      } else if (t === "number") {
        var n = Number(v);
        state[k] = Number.isFinite(n) ? n : DEFAULTS[k];
      } else if (t === "color") {
        var hex = String(v || "").trim();
        state[k] = isHexColor(hex) ? hex : DEFAULTS[k];
      } else {
        state[k] = v == null ? "" : String(v);
      }
    });

    if (f.autoOpenDeskEnabled !== undefined || f.autoOpenMobEnabled !== undefined) {
      state.autoOpenEnabled = !!(f.autoOpenDeskEnabled || f.autoOpenMobEnabled);
    }
    var deskMs = Number(f.autoOpenDeskDelayMs);
    var mobMs = Number(f.autoOpenMobDelayMs);
    if (Number.isFinite(deskMs) || Number.isFinite(mobMs)) {
      var ms = Number.isFinite(deskMs) ? deskMs : mobMs;
      state.autoOpenSeconds = ms / 1000;
    }

    if (f.launcherStripDeskEnabled !== undefined || f.launcherStripMobEnabled !== undefined) {
      state.bubbleStripEnabled = !!(f.launcherStripDeskEnabled || f.launcherStripMobEnabled);
    }
    if (f.launcherStripDeskText !== undefined || f.launcherStripMobText !== undefined) {
      var d = f.launcherStripDeskText;
      var m = f.launcherStripMobText;
      state.bubbleStripText = d !== undefined && d !== null ? String(d) : String(m != null ? m : "");
    }

    var advStr = (advancedPatchJsonStr || "").trim();
    if (advStr) {
      try {
        var adv = JSON.parse(advStr);
        var ml = adv && adv.common && adv.common.features && adv.common.features.multiLanguage;
        var byLang = ml && ml.inputPlaceholderByLanguage;
        if (byLang && typeof byLang === "object") {
          var ph = byLang.en || byLang.hi || byLang.mr;
          if (ph == null) {
            var vals = Object.keys(byLang).map(function (x) { return byLang[x]; }).filter(Boolean);
            ph = vals[0];
          }
          if (ph != null) state.inputPlaceholder = String(ph);
        }
      } catch (e) { /* ignore bad JSON */ }
    }
  }

  /** Update small thumbnail previews for icon URL fields. */
  function syncImagePreviews() {
    var bubbleImg = document.getElementById("chatIconPreview");
    var headerImg = document.getElementById("headerIconPreview");
    var u1 = (state.chatIconUrl || "").trim();
    var u2 = (state.chatTitleIconUrl || "").trim();
    if (bubbleImg) {
      bubbleImg.onerror = function () {
        bubbleImg.classList.remove("visible");
      };
      if (u1) {
        bubbleImg.src = u1;
        bubbleImg.classList.add("visible");
      } else {
        bubbleImg.removeAttribute("src");
        bubbleImg.classList.remove("visible");
      }
    }
    if (headerImg) {
      headerImg.onerror = function () {
        headerImg.classList.remove("visible");
      };
      if (u2) {
        headerImg.src = u2;
        headerImg.classList.add("visible");
      } else {
        headerImg.removeAttribute("src");
        headerImg.classList.remove("visible");
      }
    }
  }

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
    syncImagePreviews();
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
  function pushDraftToPreview() {
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
      /* ignore */
    }
  }

  var pushDraftDebounced = debounce(pushDraftToPreview, 48);

  // ---------------------------------------------------------
  // Bind inputs
  // ---------------------------------------------------------

  function bindSettingsInputs() {
    SETTINGS.forEach(function (def) {
      var input = document.querySelector("[data-setting='" + def.key + "']");
      if (!input) return;

      function syncFromDom(immediatePreview) {
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
          if (def.key === "chatIconUrl" || def.key === "chatTitleIconUrl") {
            syncImagePreviews();
          }
        }
        if (immediatePreview) pushDraftToPreview();
        else pushDraftDebounced();
        updateDraftBadgeDebounced();
      }

      if (def.type === "bool") {
        input.addEventListener("change", function () { syncFromDom(true); });
      } else if (def.type === "color") {
        input.addEventListener("input", function () { syncFromDom(true); });
        input.addEventListener("change", function () { syncFromDom(true); });
      } else if (def.type === "number") {
        input.addEventListener("input", function () { syncFromDom(true); });
      } else {
        input.addEventListener("input", function () { syncFromDom(false); });
      }
    });

    $$(".color-hex").forEach(function (hexInput) {
      hexInput.addEventListener("input", function () {
        var key = hexInput.getAttribute("data-setting-pair");
        if (!key) return;
        var v = (hexInput.value || "").trim().toLowerCase();
        if (!isHexColor(v)) return;
        state[key] = v;
        var colorInput = document.querySelector("[data-setting='" + key + "']");
        if (colorInput && colorInput.value !== v) colorInput.value = v;
        pushDraftToPreview();
        updateDraftBadgeDebounced();
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
        hydrateStateFromServer((data && data.flat) || {}, (data && data.advancedPatchJson) || "");
        renderInputs();
        pushDraftToPreview();
        setPublishedBaselineFromCurrentState();
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
        .then(function () { showToast("Reloaded published settings.", "ok"); })
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
        showToast("Published live — visitors will see this for bot \"" + bot + "\"", "ok");
        setPublishedBaselineFromCurrentState();
      }).catch(function (err) {
        showToast("Save failed: " + (err && err.message ? err.message : err), "err");
      }).then(function () {
        btn.disabled = false;
      });
    });

    var logoutBtn = $("#logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        apiFetch("/api/dashboard/logout", { method: "POST" })
          .catch(function () { /* ignore */ })
          .then(function () {
            window.location.reload();
          });
      });
    }
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
    urlInput.addEventListener("input", debounce(function () {
      var v = urlInput.value.trim();
      if (!v) return;
      try {
        new URL(v);
      } catch (e) {
        return;
      }
      setPreviewUrl(v);
      reloadPreview();
    }, 450));
    $("#reloadPreviewBtn").addEventListener("click", function () {
      setPreviewUrl(urlInput.value.trim());
      reloadPreview();
    });

    // When the preview iframe finishes loading, push drafts repeatedly (df-messenger may boot late).
    $("#previewFrame").addEventListener("load", function () {
      [0, 50, 200, 450, 1100].forEach(function (ms) {
        setTimeout(pushDraftToPreview, ms);
      });
    });

    if (savedUrl) reloadPreview();
    else {
      apiFetch("/api/dashboard/health").then(function (h) {
        var def = h && h.preview_url_default;
        if (typeof def === "string" && def.trim()) {
          var u = def.trim();
          urlInput.value = u;
          setPreviewUrl(u);
          reloadPreview();
        }
      }).catch(function () { /* ignore */ });
    }
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
    bindTopbar();
    bindPreview();
    bindTabs();
    bindSettingsInputs();
    renderInputs();

    loadSavedSettings()
      .catch(function (err) {
        showToast("Could not load saved settings: " + (err && err.message ? err.message : err), "err");
      })
      .then(function () {
        reloadPreview();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
