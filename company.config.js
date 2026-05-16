/**
 * Company Chat UI settings (edit only this file).
 *
 * How to use:
 * - Change values in this file, save, hard-refresh the page (Ctrl+F5) so the
 *   browser reloads this script (cache-bust ?v= on the script tag in HTML helps).
 * - `company.js` reads `window.COMPANY_CHAT_UI_CONFIG` once at startup.
 *
 * This file must load *before* `company.js` (see `myweb.html` script order).
 *
 * Load Dialogflow default CSS, then `company.css`, then **all** `forms/*.js` (register in-chat forms),
 * then this file, then `company.js`. See `forms/` for one file per form (contact, otp, upload, …).
 * The in-chat form DOM is injected by `company.js`.
 * If you host files under different names or folders, update every `<link>` / `<script src>` in your HTML to match.
 *
 * Three ways to ship:
 * - **One line (recommended):** `https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=7` — mounts an **iframe** to
 *   `chat-frame.html` (static CSS + df-messenger + config + company inside; no script injection in the host).
 *   Bump `?v=` in the URL and `IFRAME_VERSION` in `company-loader.js` when you change assets.
 * - **Split (no loader):** same GitHub + gstatic URLs as separate `<link>` / `<script src>` tags (or open `chat-frame.html` source as a template).
 * - **Single JS bundle:** run `python scripts/build_widget_bundle.py` and load `dist/company-widget.bundle.js` plus `dist/company.css`
 *   (see `embed-bundle.html`). The bundle is generated from this file + `company.js` — edit only `static/*`, then rebuild.
 *
 * Layout: `common` = shared. `desk` = desktop (wide viewport). `mob` = mobile (≤768px).
 * Legacy names `desktop` / `mobile` still work in company.js; prefer `desk` / `mob` for new files.
 */

window.COMPANY_CHAT_UI_CONFIG = {
  // =========================
  // COMMON (shared: agent, form field defs, theme, …)
  // =========================
  common: {
    // Project + Agent settings (Dialogflow CX).
    dialogflow: {
      projectId: "qabot01",
      location: "us-central1",
      agentId: "9dbd4886-3cbe-43fc-8eb5-54ee5097f25c"
    },

    // -------------------------------------------------------------------------
    // Google Sheet extra columns (contact-form **API** — not read by the browser)
    // Single file to edit: `server/chatbot-api/sheet-integration.config.json`
    // (`extraColumnMappings` → startColumn, valueFrom dot path e.g. session_params.coursename).
    // Railway env override: SHEETS_INTEGRATION_CONFIG_JSON or SHEETS_EXTRA_COLUMN_MAPPINGS_JSON.
    // -------------------------------------------------------------------------

    // Header text + images.
    header: {
      title: "Artemis",
      subtitle: "🟢 We are online to assist you",
      // Public HTTPS URLs; JPG / PNG / WebP / SVG are fine — bitmaps work reliably as launcher + title icons.
      chatIconUrl: "https://storage.googleapis.com/companybucket/Images/cat.png",
      chatTitleIconUrl: "https://storage.googleapis.com/companybucket/Images/cat-icon.png",
      // Base label (no trailing dots): while the agent types, the UI cycles Typing. / Typing.. / Typing...
      botWritingText: "Typing",
      botWritingDotsIntervalMs: 480,
      // `false` to leave Dialogflow’s default (arrow/locale) title dismiss; default true = always ×, all languages.
      forceCloseIconX: true,
      // Optional public URL (https://…) for the **collapse** (title) icon. If unset, a built-in X SVG (data URL) is used.
      // chatCollapseIconUrl: "https://example.com/chat-collapse-x.svg"
    },

    // Bot row: `mode: "image"` uses `image.url` / `image.imageUrl` / `imageUrl`; with `image.showTime`, the clock is markdown bold on the same line as the avatar (data-SVG + embedded HTTP avatars is unreliable).
    // User row: optional `userPersona` below — emoji/label + time in the right-aligned badge (defaults match the old 🙂 + IST clock).
    // Use `mode: "emojiTime"` only if you want a text 🤖+time caption for the bot instead of the image URL.
    botPersona: {
      mode: "image",
      // Bot persona clock: include calendar date + time when the reply arrives (`false` = time only).
      messageTimeIncludesDate: false,
      // Space (px) between the persona row and the assistant message bubble below (0–64).
      gapBelowAssistantPx: 4,
      // User badge: small `translateX` right (px); negative values shift LEFT. On wide viewports adds `userPersonaShiftRightDeskExtraPx`; on ≤768px subtracts half of `userPersonaMobileNudgeLeftPx` (moves strip slightly left on phones).
      userPersonaShiftRightPx: -24,
      userPersonaShiftRightDeskExtraPx: 10,
      userPersonaMobileNudgeLeftPx: 38,
      // Extra pull upward (adds to baseline −6px margin-top); desktop and mobile.
      userPersonaNudgeUpPx: 4,
      threadAvatarSizePx: 28,
      emojiTime: {
        label: "🤖",
        showTime: true,
        timeZone: "Asia/Kolkata"
      },
      image: {
        url: "https://storage.googleapis.com/companybucket/Images/cat-icon.png",
        widthPx: 32,
        heightPx: 32,
        // Optional caption text rendered between the avatar and the clock (e.g. "Chatbot 09:36:29 pm"). "" = clock only.
        label: "Demo",
        showTime: true,
        timeZone: "Asia/Kolkata",
        // Persona row: nudge avatar/time down (`offsetDownPx`); clock text only (`timeOffsetDownPx`).
        offsetDownPx: 6,
        timeOffsetDownPx: 20,
        tightenBelowPx: 8,
        // ≤768px: shift bot persona img + time left (translateX) without affecting desktop.
        mobileNudgeLeftPx: 14
      }
    },

    // Shown above each outgoing user bubble: emoji `label` + optional blurred clock (markdown text; avoids huge `![](data:image/svg+xml…)` in transcript).
    userPersona: {
      label: "🙂User",
      showTime: true,
      timeZone: "Asia/Kolkata"
    },

    // Features ON / OFF — each block should include `enabled: true` or `false`
    features: {
      // --- Languages (simple mental model) ---
      // - ON  → user can switch language in the chat (picker / buttons next to Send).
      // - OFF → no picker; the agent uses `defaultLanguage` only.
      // - `code` = language code for Dialogflow (`language-code` on df-messenger); `label` = fallback gloss (English).
      // - Optional `nativeLabel` = exact menu/pill text (overrides built-in endonyms for en/hi/mr).
      // - Changing language = same conversation language + chat UI (not the host page), unless
      //   you set `autoTranslateHostPage: true` to also Google-translate the rest of the page.
      multiLanguage: {
        enabled: true,
        defaultLanguage: "en",
        autoTranslateHostPage: false,
        // Optional: exact phrase overrides applied BEFORE Google translate.
        // Use this when the client wants a specific string, not a machine translation.
        // Keys are the original English phrases (exact match, trimmed).
        // Example: "We have following robots" → Marathi custom line.
        translationOverridesByLanguage: {
          hi: {
            "We have following robots": "नीचे का देख लो",
            "help":"सह्याता"
          },
          mr: {
            "We have following robots": "खालचे बागून घ्या लवकर",
            "help":"साथ"
          }
        },
        // Composer hint (`placeholder-text`). Keys = same `code` values as below. Optional: add `inputPlaceholder` on each language row to override only that row.
        // inputPlaceholderByLanguage: {
        //   en: "Ask something in English…",
        //   hi: "कुछ पूछें…",
        //   mr: "इथे टाइप करा…"
        // },
        // enabledLanguages: [
        //   { code: "en", label: "English" },
        //   { code: "hi", label: "Hindi" },
        //   { code: "mr", label: "Marathi" }
        // ]
      },

      // Restart button in footer.
      restartChat: {
        enabled: true,
        label: "Restart"
      },

      /**
       * After the visitor interacts once (message or chip), if they send nothing for `idleMs`, the widget
       * sends `dialogflowEvent` to CX. No interaction at all (welcome only) does not trigger the event.
       * Timer resets only on user actions — bot replies do not reset it.
       */
      idleEndConversation: {
        enabled: true,
        idleMs: 20000,
        dialogflowEvent: "END_CONVERSATION_IDLE"
      },

      /**
       * Client-side gate: stop sending new user messages to Dialogflow if no mobile is stored and the visitor
       * has already sent this many user lines (same `user_queries` list as Sheet sync). Uses `preventDefault`
       * on `df-user-input-entered` / `df-request-sent` when the browser allows it. Set `enabled: false` to turn off.
       *
       * When the limit is hit, the bot shows `blockMessage` and opens the contact form (see `openContactFormOnBlock`).
       * Optional `dialogflowEventOnBlock`: CX custom event name sent after the form opens (define the same event in CX).
       */
      blockChatWithoutMobile: {
        enabled: false,
        maxUserQueries: 2,
        blockMessage:
          "You've reached the message limit without a mobile number. Please enter your mobile number in the form that just opened, or type it in chat.",
        openContactFormOnBlock: true,
        formIdOnBlock: "",
        dialogflowEventOnBlock: ""
      },

      // POST telemetry to `/chat-client-context` on your API base (see `dfchat-api-base-url`). Static sites
      // (GitHub Pages, host-my-page, etc.) have no backend — turn off to avoid 404 in the Network tab.
      clientContextCapture: {
        enabled: false
      },

      /**
       * Inline image carousel (`open_gallery`) + inline YouTube (`open_video`).
       *
       * - **`allowGalleryOnAnyIntent: true`** (default) — show whenever fulfillment sends payloads (recommended
       *   with merge limited to **`queryResult.responseMessages`** only — not `detail.data.messages`).
       * - **`allowGalleryOnAnyIntent: false`** — only when the CX intent display name matches a substring in
       *   **`restrictToIntentDisplayNames`**. Use if the webhook incorrectly sends `open_gallery` on every turn.
       */
      inlineGallery: {
        allowGalleryOnAnyIntent: true,
        restrictToIntentDisplayNames: [],
        /**
         * If true (default), the same `{ "urls": […] }` set opens the carousel **once per chat tab** —
         * later intents that repeat the identical payload will not duplicate the carousel. Fix for fulfillment
         * echoing `open_gallery`. Cleared when the user uses **Restart**.
         */
        suppressRepeatedOpenGalleryUrls: true,
        // Optional translations for option chips under `open_gallery` / `open_video` payloads.
        // Key = option `value` lowercased (e.g. "location"). Values are labels by language code.
        optionLabelByLanguage: {
          location: { en: "Location", hi: "स्थान", mr: "स्थान" },
          robots: { en: "Robots", hi: "रोबोट", mr: "रोबोट" },
          robot: { en: "Robot", hi: "रोबोट", mr: "रोबोट" },
          live: { en: "Live", hi: "लाइव", mr: "लाइव्ह" },
          animal: { en: "Animal", hi: "जानवर", mr: "प्राणी" },
          video: { en: "Video", hi: "वीडियो", mr: "व्हिडिओ" }
        }
      }
    },

    // Language + Restart pill (next to Send). All values are pixels. Tune after you set `chatLayout.side`
    // (right-docked chat usually keeps Send on the right; nudges only move the pill, not the bubble).
    // nudgeUpPx: **positive** moves Language/Restart **up** (fixed `top` and inline `translateY`). **Negative**
    // moves them **down** — do not use negative if you want the bar higher. Use a small value (0–20) unless
    // you are fine-tuning. nudgeDownPx ADDS to fixed `top`; it does not apply when the bar is inline below the composer.
    // Keep nudges near 0 unless you are fine-tuning a specific layout. Large values (especially negative
    // `nudgeRightPx`) easily push Language/Restart over the typing area or off the composer row.
   
   
    // footerActionBar: {
    //   // when type strip is enabled
    //   nudgeRightPx: 0,
    //   nudgeUpPx: -8,
    //   nudgeDownPx: 0,
    //   // nudgeLeftPx: 100,
    //   gapBeforeSendPx: 8,
    //   lockVerticalWhenComposerRowTallerThanPx: 0
    // },

    // footerActionBar: {
    //   // when type strip is disabled
    //   nudgeRightPx: -180,
    //   nudgeUpPx: -8,
    //   nudgeDownPx: 40,
    //   // nudgeLeftPx: 100,
    //   gapBeforeSendPx: 8,
    //   lockVerticalWhenComposerRowTallerThanPx: 0
    // },

    footerActionBar: {
      // when type strip is disabled
      nudgeRightPx: -160,
      nudgeUpPx: 6,
      nudgeDownPx: 70,
      nudgeLeftPx: 100,
      gapBeforeSendPx: 8,
      lockVerticalWhenComposerRowTallerThanPx: 0
    },


    // -------------------------------------------------------------------------
    // Footer message row (Dialogflow `.input-box-wrapper` inside `df-messenger-user-input`).
    // - Sets CSS variables on `df-messenger` (they inherit into shadow DOM).
    // - `alignItems` / `overflowY` are injected with !important (Google hardcodes align-items: flex-end).
    // - Applied after `dfMessengerTheme`, so values here win for the same variables.
    // -------------------------------------------------------------------------
    footerInputBox: {
      // Composer inset vs chat card (top right bottom left). Omit `sendButtonWrapperPx` to use Dialogflow’s default Send.
      padding: "8px 10px 30px 10px",
      // Nudge the Send icon wrapper (negative = up).
      sendOffsetYpx: -3,
      // Or omit `padding` and set all four:
      // paddingTopPx: 19,
      // paddingRightPx: 0,
      // paddingBottomPx: 50,
      // paddingLeftPx: 20,

      scrollbarGutter: "stable",
      inputMaxWidth: null,
      chatMaxWidth: null,

      // Optional (requires shadow inject): flex-end | flex-start | center | stretch | baseline | start | end
      // alignItems: "center",
      // overflowY: "auto"
    },

    // -------------------------------------------------------------------------
    // "Powered by …" (fixed line above the type-your-message area when chat is open)
    // - Shown text: prefix + value  (e.g. "Powered by " + "demo" → "Powered by demo")
    // - Position: use nudgeUpPx / nudgeDownPx / nudgeLeftPx / nudgeRightPx (px) to move
    //   the strip in that direction. Then add offsetTopPx / offsetLeftPx for extra fine tune.
    //   Formula: finalTop += offsetTopPx + nudgeDownPx - nudgeUpPx
    //            finalLeft += offsetLeftPx + nudgeRightPx - nudgeLeftPx
    // - Look: color (CSS color), fontSizePx, textAlign, lineHeightPx
    // - widthOffsetPx: add/subtract from strip width. gap* keys tune spacing from composer/window.
    // - linkUrl: optional. If set (e.g. "https://www.google.com"), the strip is a link; click opens a new tab.
    // - marginPx: optional uniform CSS margin (px) on the fixed strip; 0 = none.
    // -------------------------------------------------------------------------
    poweredBy: {
      enabled: true,
      prefix: "⚡by ",
      value: "demo",
      linkUrl: "https://www.google.com",

      color: "#0369a1",
      fontSizePx: 11,
      textAlign: "center",
      lineHeightPx: 16,

      // when type strip is enabled
      // nudgeUpPx: 65,
      // nudgeDownPx: -40,
      // nudgeLeftPx: 20,
      // nudgeRightPx: 150,

        // when type strip is disabled
        nudgeUpPx: -15,
        nudgeDownPx: -40,
        nudgeLeftPx: 0,
        nudgeRightPx: -90,



      offsetTopPx: 80,
      offsetLeftPx: 0,
      widthOffsetPx: 0,
      marginPx: 20,

      gapAboveComposerPx: 1,
      fallbackGapFromWindowBottomPx: 6
    },

    // Page colors.
    theme: {
      "--dfchat-bg-1": "#e8f4fc",
      "--dfchat-bg-2": "#f7fbff",
      "--dfchat-brand-900": "#0f172a",
      "--dfchat-brand-700": "#0369a1",
      "--dfchat-brand-500": "#0ea5e9",
      "--dfchat-accent-200": "#e0f2fe",
      "--dfchat-surface": "#ffffff",
      "--dfchat-text": "#0f172a",
      "--dfchat-text-soft": "#475569",
      "--dfchat-border": "#dbe5ec"
    },

    // Where the chat bubble + “Hi” strip sit: "right" | "left" (one switch for both).
    // Use matching edges everywhere below:
    // - "right" → `rightPx` + `bottomPx` (set `leftPx: null` on desktop/mobile bubble + both launcherStrips)
    // - "left"  → `leftPx` + `bottomPx` (set `rightPx: null`)
    chatLayout: {
      side: "right"
    },

    // Message list (conversation) scrollbar inside the open chat card.
    // - `showScrollbar: true` (default) — Dialogflow’s default overflow is `hidden scroll` (y=scroll = always on).
    // - `showScrollbar: false` — company.js sets `--df-messenger-chat-overflow: hidden auto` on df-messenger + bubble
    //   (see Google’s CSS) and hides the track; wheel/touch scrolling still works.
    // - `paneBorderRadius` (optional) — per-corner for the *middle* chat strip. Dialogflow applies
    //   `border-radius: var(--df-messenger-chat-border-radius)` on `.message-list-wrapper` (the light/gradient
    //   area), not only to `#message-list`; we inject into shadow to override, e.g. { bottomLeft: "6px" }.
    //   Omitted keys default to "0" (sharp corners on that middle panel). Whole-card roundness: `dfMessengerTheme["--df-messenger-chat-border-radius"]`.
    chatMessageList: {
      showScrollbar: false,
      // Top of the message strip: straight; bottom edges square (meets composer with a straight seam).
      paneBorderRadius: {
        topLeft: "0",
        topRight: "0",
        bottomLeft: "0",
        bottomRight: "0"
      }
    },

    // **Open chat card** (the whitish panel: title + message area + input). Google sets one var `--df-messenger-chat-border-radius` on the whole card; we override the panel shell in shadow (`.chat-wrapper`) per corner.
    // Top corners must match the titlebar's own border-top-*-radius (read from `--df-messenger-chat-border-radius` in df-messenger.js) — otherwise the wrapper's forced-white background bleeds through as visible white edges at the curved top corners of the header. Bottom corners are the panel's own outer rounding.
    // Omit this block to keep the default all-around radius from `dfMessengerTheme`.
    chatPanel: {
      borderRadius: {
        topLeft: "22px",
        topRight: "22px",
        bottomLeft: "20px",
        bottomRight: "20px"
      }
    },

    // -------------------------------------------------------------------------
    // In-chat forms — field defs live in `forms/*.js` (each registers `window.__DFCHAT_FORMS__[formKey]`).
    // Docking / padding / insets: set per device under `desk.form` and `mob.form` (not here).
    // -------------------------------------------------------------------------
    form: {
      // Form to use when Dialogflow sends only `{ "action": "open_form" }` (no `form_id`), and on first load.
      defaultFormId: "contact",
      // If Dialogflow still uses `form_id: "appointment"`, load this form instead (e.g. shared general calendar).
      legacyAppointmentFormAlias: "appintmentformgeneral",
      // Shared defaults when a form does not set its own (this form uses per-form chatSummaryFieldNames).
      // Align keys with CX session parameters — e.g. name, mobile, email (field `name` → POST JSON key).
      chatSummaryFieldNames: ["name", "mobile", "email"],
      forms: Object.assign(
        {},
        typeof window !== "undefined" &&
          window.__DFCHAT_FORMS__ &&
          typeof window.__DFCHAT_FORMS__ === "object"
          ? window.__DFCHAT_FORMS__
          : {}
      ),
    },

    // -------------------------------------------------------------------------
    // **Common (“general-purpose”) appointment form** — `form_id` / key `appintmentformgeneral`.
    //
    // Naming: “General” here means **the default reusable contact-form calendar**, usable for
    // **any client or industry** — hospitals, real estate, services, salons, etc. It is **not**
    // a clinical “General medicine” department (see `department` below).
    //
    // One shared time grid for that form + optional Firebase tags (`bookingId`, `branchId`,
    // `department`). The API reads this block from this file (Mon–Fri 9–5 style, 12h AM/PM).
    // Env on the server still overrides if set: GENERAL_APPOINTMENT_START / _END / _DAYS /
    // _BOOKING_ID / _BRANCH_ID / _DEPARTMENT.
    //
    // Why `branchId` / `department`? Legacy **names in the booking API** — required non-empty
    // strings in RTDB, but **semantic meaning is yours**: office/region, booking category, etc.
    // Slot conflicts use only `bookingId` + date + time, not branch/department.
    // Example (non-hospital): bookingId `"consultations"`, branchId `"downtown-office"`,
    // department `"Property viewing"` or `"Appointment"`.
    // -------------------------------------------------------------------------
    generalAppointment: {
      /** RTDB **calendar pool id** for this common form (`"general"` is just an id — not “General dept”). */
      bookingId: "general",
      /** Same syntax as doctor CSV Days, e.g. "Mon-Fri", "Mon,Wed,Fri". */
      days: "Mon-Fri",
      start: "9:00 AM",
      end: "5:00 PM",
      /** Stored on each slot; arbitrary label — e.g. office code (non-hospital: site, region). */
      branchId: "500",
      /** Stored tag — **not** “hospital department”. Name of visit type / product line / default “Appointment”. */
      department: "Appointment",
      /**
       * Optional slot length in minutes for this calendar only (5–180).
       * The contact-form API uses this value when `company.config.js` is bundled with the API; otherwise
       * **`company.js` sends `generalSlotMinutes=<this>` on general-calendar API calls + form submits** so
       * grids still match. Fallbacks: GENERAL_APPOINTMENT_SLOT_MINUTES env, then APPOINTMENT_SLOT_MINUTES / 30.
       */
      slotMinutes: 30,
    },

    // -------------------------------------------------------------------------
    // FLOATING CHAT BUTTON (when the chat window is closed)
    // -------------------------------------------------------------------------
    // This is the small button that stays on the screen so visitors can open chat again.
    // You do not need to know CSS — change the plain options below.
    //
    // - keepRoundShape: true  → the site keeps the button as a circle (recommended).
    //   false → only “corner roundness” is used (softer, more like a rounded square).
    //
    // - cornerRoundness: how round the button outline is. Examples:
    //   "50%"  = full circle (best with keepRoundShape: true),
    //   "32px" = gently rounded corners (try with keepRoundShape: false).
    //
    // - clipPictureToCircle: true  → the photo/icon inside is cropped to match the round button.
    //   false → picture keeps a square look inside the button.
    //
    // - hideOverflow: true  → cleans up the edges so color does not spill outside the round shape.
    //
    // - buttonSizePx: diameter of the button in pixels (same width and height). Example: 64
    //   Leave null to use the default size from the chat widget.
    //
    // - iconSizePx: size of the picture inside the button. Leave null and we size it from buttonSizePx.
    //   Or set both yourself, e.g. button 72 and icon 60.
    //
    // - storyRing: optional Instagram-style rainbow ring around the bubble (conic gradient “border”).
    //   `enabled: false` turns it off. `widthPx` = ring thickness (e.g. 2–4).
    //   `rotateSeconds` = how long the ring spins (0 = no spin). `revolutions` = full 360° turns in that time.
    // -------------------------------------------------------------------------
    chatBubbleLauncher: {
      keepRoundShape: true,
      cornerRoundness: "50%",
      clipPictureToCircle: true,
      hideOverflow: true,
      buttonSizePx: null,
      iconSizePx: null,
      // Unread count on the closed launcher when the agent replies while the chat panel is closed.
      unreadBadge: {
        enabled: true,
        maxDisplay: 99,
        background: "#e11d48",
        color: "#ffffff",
        fontSizePx: 12,
        minSizePx: 20
      },
      storyRing: {
        enabled: true,
        widthPx: 3,
        rotateSeconds: 5,
        revolutions: 4
      }
    },

    // Chat colors + other widget styling (technical names — ask a developer if unsure).
    // Tip: the floating button’s roundness is controlled above in `chatBubbleLauncher` (easier for edits).
    dfMessengerTheme: {
      "--df-messenger-input-inner-padding": "0 46px 8px 10px",
      "--df-messenger-input-box-padding": "8px 16px 8px 16px",
      "--df-messenger-input-box-focus-padding": "8px 16px 8px 16px",
      "--df-messenger-input-box-border-radius": "12px",
      "--df-messenger-input-box-border": "1px solid rgba(148, 197, 224, 0.95)",
      "--df-messenger-input-box-focus-border": "1px solid rgba(2, 132, 199, 0.9)",
      "--df-messenger-input-border-top": "1px solid rgba(14, 165, 233, 0.28)",
      "--df-messenger-input-font-size": "16px",
      "--df-messenger-input-font-weight": "600",
      "--df-messenger-primary-color": "#0284c7",
      "--df-messenger-chat-background": "#ffffff",
      "--df-messenger-message-bot-background": "linear-gradient(168deg, #e8f6ff 0%, #bae6fd 100%)",
      "--df-messenger-message-bot-font-color": "#0c4a6e",
      "--df-messenger-message-user-background": "linear-gradient(145deg, #0284c7 0%, #0ea5e9 100%)",
      "--df-messenger-message-user-font-color": "#f0f9ff",
      "--df-messenger-titlebar-background": "linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.1) 24%, transparent 46%), linear-gradient(168deg, #38bdf8 0%, #0284c7 42%, #075985 100%)",
      "--df-messenger-titlebar-border": "none",
      "--df-messenger-titlebar-border-bottom": "1px solid rgba(4, 58, 90, 0.55)",
      "--df-messenger-titlebar-font-color": "#f0f9ff",
      "--df-messenger-titlebar-subtitle-font-color": "#bae6fd",
      "--df-messenger-chips-background": "rgba(186, 230, 253, 0.92)",
      "--df-messenger-chips-font-color": "#0c4a6e",
      "--df-messenger-button-border": "1px solid rgba(14, 165, 233, 0.45)",
      "--df-messenger-chat-border": "none",
      "--df-messenger-chat-box-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 -1px 0 rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.05), 0 10px 28px -6px rgba(15, 23, 42, 0.1), 0 20px 40px -14px rgba(14, 165, 233, 0.12)",
      "--df-messenger-chat-border-radius": "22px",
      "--df-messenger-chat-bubble-background": "linear-gradient(160deg, #0ea5e9 0%, #0284c7 48%, #0369a1 100%)",
      // Usually match `common.chatBubbleLauncher.cornerRoundness` (the launcher block wins when the page runs).
      "--df-messenger-chat-bubble-border-radius": "50%",
      "--df-messenger-chat-scroll-button-enabled-display": "none",
      "--df-messenger-chat-scroll-button-text-display": "none",
      "--df-messenger-chat-messagelist-scroll-shadow-background": "none"
    }
  },

  // =========================
  // DESK (wide viewport)
  // =========================
  desk: {
    // One switch: show floating bubble + chat window (false = hidden on desktop only)
    showChatbot: true,

    chatWindow: {
      widthPx: 400,
      heightPx: 450,

      // right + bottom (matches `common.chatLayout.side: "right"`).
      bubblePosition: { rightPx: 10, bottomPx: 20, leftPx: null, topPx: null },

      // This is the correct knob for the bubble–chat gap: Dialogflow v1 uses it in the chat-bubble
      // shadow (not window height). Set on both the outer host and the bubble; use config here or
      // `df-messenger, df-messenger-chat-bubble { --df-messenger-chat-window-offset: 8px; }` in CSS.
      // Default when omitted: 16. Example: 8
      // chatWindowOffsetPx: 8,

      // Add to the panel height so the window extends toward the bubble. Optional; separate from chatWindowOffsetPx.
      extraHeightTowardBubblePx: 0
    },

    autoOpenChat: {
      enabled: true,
      delayMs: 5000
    },

    // Composer microphone: speech-to-text in the Dialogflow textarea (Chrome/Edge/Safari; needs https or localhost).
    // Separate from mob — tune per device without affecting the other.
    speechToText: {
      enabled: true
    },

    launcherStrip: {
      // “Hi” strip: same edge as the bubble ( here = bottom-right )
      enabled: true,
      text: "👋Hey, how are you?😊",
      // Word-by-word reveal; full line finishes in this many ms (0 = show full text at once).
      typingDurationMs: 1000,
      // After this many ms from load, replaces `text` (typing animation is cancelled mid-flight if needed).
      swapTextDelayMs: 1000000,
      swapText: "Chat with us",
      position: { rightPx: 10, bottomPx: 96, leftPx: null, topPx: null },
      style: { fontSizePx: 13, paddingYpx: 10, paddingXpx: 14, maxWidthPx: 260 }
    },

    // Quick message row: stacked above the bubble with `gapAboveBubblePx` (5px to bubble). Greeting strip sits above it.
    launcherInputStrip: {
      enabled: false,
      placeholder: "What is your query?",
      sendLabel: "Send",
      gapAboveBubblePx: 5,
      gapBelowGreetingPx: 8,
      position: { rightPx: 10, leftPx: null, topPx: null },
      fallbackBottomPx: 54,
      style: { fontSizePx: 14, maxWidthPx: 300 }
    },

    // Form panel layout (all in-chat forms: contact, appointment, upload, …).
    form: {
      dockToChatWindow: true,
      dockAboveFooter: true,
      gapAboveFooterPx: 8,
      titleInsetPx: 48,
      dockNudgeDownPx: 20,
      sideInsetPx: 15,
      maxCardHeightPx: 300,
      showSubtitle: true,
      /* Max width when the form is docked in the chat window (right-docked chat = grows to the left). */
      formDockMaxWidthPx: 380
    }
  },

  // =========================
  // MOB (≤768px)
  // =========================
  mob: {
    // One switch: show bubble + chat on small screens (e.g. false = desktop-only widget).
    showChatbot: true,

    // Legacy: mobile layout code treats `enabled: false` as “do not apply mob panel sizing” (kept for compatibility).
    enabled: true,

    chatWindow: {
      horizontalInsetPx: 12,
      topInsetPx: 26,
      bottomInsetPx: 10,
      /* Extra space below the system safe area / status bar. */
      safeAreaTopReservePx: 56,
      /* JS subtracts this from open chat height so the Dialogflow titlebar row is not clipped (optional; default 48 in code). */
      titlebarChromeReservePx: 40,
      minWidthPx: 260,
      minHeightPx: 200,

      bubblePosition: { rightPx: 12, bottomPx: 10, leftPx: null, topPx: null },

      // Optional: set only the bubble–window gap: `chatWindowOffsetPx: 10` (see desk).

      // Add to the panel height; optional, separate from `chatWindowOffsetPx`.
      extraHeightTowardBubblePx: 20
    },

    autoOpenChat: {
      enabled: true,
      delayMs: 5000
    },

    speechToText: {
      enabled: true
    },

    launcherStrip: {
      // Same edge as the bubble (bottom-right on mobile)
      enabled: true,
      text: "Hello, how are you?",
      typingDurationMs: 2000,
      swapTextDelayMs: 10000,
      swapText: "🤖Chat with us",
      position: { rightPx: 12, bottomPx: 86, leftPx: null, topPx: null },
      style: { fontSizePx: 13, paddingYpx: 10, paddingXpx: 14, maxWidthPx: null }
    },

    launcherInputStrip: {
      enabled: false,
      placeholder: "What is your query?",
      sendLabel: "Send",
      gapAboveBubblePx: 5,
      gapBelowGreetingPx: 8,
      position: { rightPx: 12, leftPx: null, topPx: null },
      fallbackBottomPx: 48,
      style: { fontSizePx: 14, maxWidthPx: 300 }
    },

    /* Extra horizontal nudge for Language/Restart (company.js; positive = toward the right). */
    footerActionBar: {
      nudgeRightExtraPx: 30
    },

    // Form panel layout (all in-chat forms) + horizontal insets.
    form: {
      dockToChatWindow: true,
      dockAboveFooter: true,
      gapAboveFooterPx: 8,
      titleInsetPx: 48,
      dockNudgeDownPx: 20,
      sideInsetPx: 15,
      maxCardHeightPx: 300,
      showSubtitle: true,
      formDockMaxWidthPx: 300,
      insetLeftPx: 30,
      insetRightPx: 20
    }
  },

  // (Colors moved to COMMON section above)
};

// ---------------------------------------------------------------------------
// Runtime settings merge (optional)
// If your host serves `/company-admin/settings-public.json` on the same origin,
// this merges that JSON into `window.COMPANY_CHAT_UI_CONFIG`.
// ---------------------------------------------------------------------------
(function () {
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function deepMerge(dst, src) {
    if (!isObj(dst) || !isObj(src)) return dst;
    for (const k of Object.keys(src)) {
      const sv = src[k];
      if (isObj(sv)) {
        if (!isObj(dst[k])) dst[k] = {};
        deepMerge(dst[k], sv);
      } else {
        dst[k] = sv;
      }
    }
    return dst;
  }

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/company-admin/settings-public.json", false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      const patch = JSON.parse(xhr.responseText);
      if (isObj(patch)) {
        deepMerge(window.COMPANY_CHAT_UI_CONFIG, patch);
      }
    }
  } catch {
    /* ignore */
  }
})();
