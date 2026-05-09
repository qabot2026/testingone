/**
 * Form: contact — default `open_form` / `form_id`: "contact".
 * Load before `company.config.js` (see `chat-frame.html`).
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.contact = {
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
    // After a successful contact submit, automatically open the upload form.
    // (Used to support “back-to-back” forms for a single intent.)
    nextFormId: "uploadDocument",
    chatSummaryFieldNames: ["name", "mobile", "email"],
    fields: [
      { id: "c-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
      { id: "c-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
      { id: "c-email", name: "email", type: "email", required: true, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
