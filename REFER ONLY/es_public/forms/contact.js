/**
 * Form: contact — default `open_form` / `form_id`: "contact".
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
    maxCardHeightPx: 380,
    chatSummaryFieldNames: ["name", "dial_code", "mobile", "email"],
    fields: [
      { id: "c-name", name: "name", type: "text", required: false, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
      {
        id: "c-dial-code",
        name: "dial_code",
        type: "select",
        required: true,
        i18nSummaryLabel: "summaryDialCodeLabel",
        autoDetectDialCode: true,
        detectFromIp: true,
        options: [
          { flag: "🇮🇳", country: "IN", value: "+91" },
          { flag: "🇺🇸", country: "US", value: "+1" },
          { flag: "🇨🇦", country: "CA", value: "+1" },
          { flag: "🇬🇧", country: "GB", value: "+44" },
          { flag: "🇦🇪", country: "AE", value: "+971" },
          { flag: "🇦🇺", country: "AU", value: "+61" },
          { flag: "🇸🇬", country: "SG", value: "+65" },
          { flag: "🇸🇦", country: "SA", value: "+966" },
          { flag: "🇶🇦", country: "QA", value: "+974" },
          { flag: "🇴🇲", country: "OM", value: "+968" },
          { flag: "🇰🇼", country: "KW", value: "+965" },
          { flag: "🇧🇭", country: "BH", value: "+973" },
          { flag: "🇳🇵", country: "NP", value: "+977" },
          { flag: "🇧🇩", country: "BD", value: "+880" },
          { flag: "🇱🇰", country: "LK", value: "+94" },
          { flag: "🇵🇰", country: "PK", value: "+92" },
          { flag: "🇲🇾", country: "MY", value: "+60" },
          { flag: "🇩🇪", country: "DE", value: "+49" },
          { flag: "🇫🇷", country: "FR", value: "+33" },
          { flag: "🇮🇹", country: "IT", value: "+39" },
          { flag: "🇪🇸", country: "ES", value: "+34" }
        ]
      },
      { id: "c-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
      { id: "c-email", name: "email", type: "email", required: true, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
