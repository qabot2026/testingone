/**
 * Form: contact — default `open_form` / `form_id`: "contact".
 * Load before `company.config.js` (see `chat-frame.html`).
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.contact = {
    staffFormLabel: "contact",
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
    // Optional static chaining. Prefer Dialogflow `open_form`: `next_form_id` + `following_form_id` + `third_form_id`, or `next_form_ids` array.
    // nextFormId: "uploadDocument",
    chatSummaryFieldNames: ["name", "dial_code", "mobile", "email"],
    fields: [
      { id: "c-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
      {
        id: "c-dial-code",
        name: "dial_code",
        type: "select",
        required: true,
        icon: "phone",
        i18nPlaceholder: "dialCodePlaceholder",
        i18nSummaryLabel: "summaryDialCodeLabel",
        autoDetectDialCode: true,
        options: [
          { label: "🇮🇳 +91", value: "+91" },
          { label: "🇺🇸/🇨🇦 +1", value: "+1" },
          { label: "🇬🇧 +44", value: "+44" },
          { label: "🇦🇪 +971", value: "+971" },
          { label: "🇦🇺 +61", value: "+61" },
          { label: "🇸🇬 +65", value: "+65" },
          { label: "🇸🇦 +966", value: "+966" },
          { label: "🇶🇦 +974", value: "+974" },
          { label: "🇴🇲 +968", value: "+968" },
          { label: "🇰🇼 +965", value: "+965" },
          { label: "🇧🇭 +973", value: "+973" },
          { label: "🇳🇵 +977", value: "+977" },
          { label: "🇧🇩 +880", value: "+880" },
          { label: "🇱🇰 +94", value: "+94" },
          { label: "🇵🇰 +92", value: "+92" },
          { label: "🇲🇾 +60", value: "+60" },
          { label: "🇩🇪 +49", value: "+49" },
          { label: "🇫🇷 +33", value: "+33" },
          { label: "🇮🇹 +39", value: "+39" },
          { label: "🇪🇸 +34", value: "+34" }
        ]
      },
      { id: "c-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
      { id: "c-email", name: "email", type: "email", required: true, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
