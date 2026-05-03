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
 * Load Dialogflow default CSS, then `company.css`, then this file, then `company.js`.
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
      agentId: "05ce7add-9025-4534-990c-fd7a25dadde1"
    },

    // Header text + images.
    header: {
      title: "Chat Support",
      subtitle: "🟢 We are online to assist you",
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

    // Bot line above each agent reply: small image OR emoji + time (IST-style clock via timeZone).
    // `mode: "image"` hides the thread-side bot avatar (no duplicate of the persona image). `threadAvatarSizePx` applies when `mode` is `emojiTime`.
    botPersona: {
      mode: "image",
      // Added to 250px baseline — higher = user persona label rows sit farther right.
      userPersonaShiftRightPx: 16,
      // Wide viewports only: extra margin-left px (does not change the mobile formula below).
      userPersonaShiftRightDeskExtraPx: 10,
      // ≤768px: subtract this many px from computed user persona margin-left (moves strip left on phones).
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
        showTime: true,
        timeZone: "Asia/Kolkata",
        // Persona row: nudge avatar/time down and pull the reply bubble closer (px).
        offsetDownPx: 6,
        tightenBelowPx: 8,
        // ≤768px: shift bot persona img + time left (translateX) without affecting desktop.
        mobileNudgeLeftPx: 14
      }
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
    // Omit this block to keep the default all-around radius from `dfMessengerTheme`.
    chatPanel: {
      borderRadius: {
        topLeft: "0",
        topRight: "0",
        bottomLeft: "20px",
        bottomRight: "20px"
      }
    },

    // -------------------------------------------------------------------------
    // In-chat forms (contact, appointment, upload, otp, …) — field defs + i18n only.
    // Docking / padding / insets: set per device under `desk.form` and `mob.form` (not here).
    // -------------------------------------------------------------------------
    form: {
      // Form to use when Dialogflow sends only `{ "action": "open_form" }` (no `form_id`), and on first load.
      defaultFormId: "contact",
      // Shared defaults when a form does not set its own (this form uses per-form chatSummaryFieldNames)
      chatSummaryFieldNames: ["name", "mobile", "email"],
      forms: {
        // Contact: name, mobile, email (no message field)
        contact: {
          titleByLanguage: {
            en: "Contact us",
            hi: "हमसे संपर्क करें",
            mr: "आमच्याशी संपर्क करा"
          },
          subtitleByLanguage: {
            en: "Share your contact details.",
            hi: "अपनी जानकारी साझा करें।",
            mr: "तुमची माहिती शेअर करा."
          },
          showSubtitle: true,
          maxCardHeightPx: 300,
          chatSummaryFieldNames: ["name", "mobile", "email"],
          fields: [
            { id: "c-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
            { id: "c-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
            { id: "c-email", name: "email", type: "email", required: true, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
          ]
        },
        // Feedback: rating + message (open from Dialogflow with `form_id`: `"feedback"`)
        feedback: {
          titleByLanguage: {
            en: "Feedback",
            hi: "फीडबैक",
            mr: "अभिप्राय"
          },
          subtitleByLanguage: {
            en: "Tell us how we did.",
            hi: "आपका अनुभव कैसा रहा?",
            mr: "तुमचा अनुभव कसा होता?"
          },
          showSubtitle: true,
          maxCardHeightPx: 300,
          chatSummaryFieldNames: ["rating", "message"],
          fields: [
            {
              id: "f-rating",
              name: "rating",
              type: "select",
              required: true,
              icon: "star",
              placeholderByLanguage: { en: "Rating (1-5)", hi: "रेटिंग (1-5)", mr: "रेटिंग (1-5)" },
              options: [
                { label: "1", value: "1" },
                { label: "2", value: "2" },
                { label: "3", value: "3" },
                { label: "4", value: "4" },
                { label: "5", value: "5" }
              ]
            },
            {
              id: "f-message",
              name: "message",
              type: "textarea",
              required: true,
              icon: "message",
              rows: 3,
              placeholderByLanguage: { en: "Write your feedback…", hi: "अपना फीडबैक लिखें…", mr: "तुमचा अभिप्राय लिहा…" }
            }
          ]
        },
        // Appointment: date and time (open from Dialogflow with `form_id`: `"appointment"`)
        appointment: {
          titleByLanguage: {
            en: "Appointment",
            hi: "अपॉइंटमेंट",
            mr: "अपॉइंटमेंट"
          },
          subtitleByLanguage: {
            en: "Choose a date and time.",
            hi: "तारीख और समय चुनें।",
            mr: "तारीख आणि वेळ निवडा."
          },
          showSubtitle: true,
          maxCardHeightPx: 260,
          chatSummaryFieldNames: ["appointmentdate", "appointmenttime"],
          fields: [
            {
              id: "a-date",
              name: "appointmentdate",
              type: "date",
              required: true,
              icon: "calendar",
              i18nSummaryLabel: "summaryDateLabel",
              placeholderByLanguage: { en: "Date", hi: "तिथि", mr: "तारीख" }
            },
            {
              id: "a-time",
              name: "appointmenttime",
              type: "time",
              required: true,
              icon: "clock",
              i18nSummaryLabel: "summaryTimeLabel",
              placeholderByLanguage: { en: "Time", hi: "समय", mr: "वेळ" }
            }
          ]
        },
        // OTP: first screen = OTP only + “change mobile”; second = mobile only + submit (`form_id`: `"otp"`).
        otp: {
          titleByLanguage: {
            en: "Verify OTP",
            hi: "OTP सत्यापित करें",
            mr: "OTP सत्यापित करा"
          },
          subtitleByLanguage: {
            en: "Enter the code we sent.",
            hi: "भेजा गया कोड दर्ज करें।",
            mr: "पाठवलेला कोड टाका."
          },
          // Shown on the “change mobile” step (optional i18n fallback in company.js).
          subtitleMobileByLanguage: {
            en: "Enter the correct mobile number and submit. We will send a new code.",
            hi: "सही मोबाइल नंबर दर्ज करें और जमा करें।",
            mr: "योग्य मोबाईल क्रमांक टाका आणि सबमिट करा. नवा कोड पाठवू."
          },
          showSubtitle: true,
          maxCardHeightPx: 240,
          chatSummaryFieldNames: ["mobile", "otp"],
          // OTP field first, then mobile (UI groups into two steps in company.js).
          fields: [
            {
              id: "o-otp",
              name: "otp",
              type: "text",
              required: true,
              icon: "key",
              maxLength: 8,
              minLength: 4,
              inputMode: "numeric",
              pattern: "^[0-9]{4,8}$",
              i18nPlaceholder: "otpCodePlaceholder",
              i18nSummaryLabel: "summaryOtpLabel",
              i18nInvalidMessage: "invalidOtp",
              autocomplete: "one-time-code"
            },
            {
              id: "o-mobile",
              name: "mobile",
              type: "tel",
              required: false,
              icon: "phone",
              validateAs: "phone",
              i18nPlaceholder: "mobilePlaceholder",
              i18nSummaryLabel: "summaryMobileLabel",
              autocomplete: "tel",
              inputMode: "tel",
              placeholderByLanguage: {
                en: "Mobile number",
                hi: "मोबाइल नंबर",
                mr: "मोबाईल नंबर"
              }
            }
          ]
        },
        // Upload document — `form_id`: `"uploadDocument"`. `multiple: true` = several files; omit or `false` = one file.
        uploadDocument: {
          titleByLanguage: {
            en: "Upload document",
            hi: "दस्तावेज़ अपलोड करें",
            mr: "दस्तऐवज अपलोड करा"
          },
          subtitleByLanguage: {
            en: "You can select one or more files.",
            hi: "एक या अधिक फ़ाइल चुन सकते हैं।",
            mr: "एक किंवा अनेक फाइल निवडा."
          },
          showSubtitle: true,
          maxCardHeightPx: 280,
          chatSummaryFieldNames: ["document"],
          fields: [
            {
              id: "u-document",
              name: "document",
              type: "file",
              required: true,
              multiple: true,
              icon: "file",
              i18nSummaryLabel: "summaryDocumentLabel",
              accept: "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip,application/x-zip-compressed",
              placeholderByLanguage: {
                en: "Choose one or more files…",
                hi: "एक या अधिक फ़ाइलें चुनें…",
                mr: "एक किंवा अनेक फाइल निवडा…"
              }
            }
          ]
        }
      }
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
      "--df-messenger-chat-background": "linear-gradient(180deg, #fbfdff 0%, #f0f9ff 100%)",
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
