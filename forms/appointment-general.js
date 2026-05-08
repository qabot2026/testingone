/**
 * Form: shared clinic calendar — `form_id`: "appintmentformgeneral".
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.appintmentformgeneral = {
    titleByLanguage: {
      en: "Appointment",
      hi: "अपॉइंटमेंट",
      mr: "अपॉइंटमेंट"
    },
    subtitleByLanguage: {
      en: "One shared schedule for the clinic. Red = already booked.",
      hi: "क्लिनिक का एक साझा शेड्यूल। लाल = पहले से बुक।",
      mr: "क्लिनिकचे एक समायोजन. लाल = आधीच बुक."
    },
    showSubtitle: true,
    maxCardHeightPx: 540,
    chatSummaryFieldNames: ["name", "mobile", "email", "appointmentdate", "appointmenttime"],
    fields: [
      {
        id: "afg-appt",
        name: "appointmentdate",
        type: "appointmentgeneral",
        required: true,
        icon: "calendar",
        hiddenDateId: "afg-appt-date",
        hiddenTimeId: "afg-appt-time",
        i18nSummaryLabel: "summaryDateLabel",
        placeholderByLanguage: {
          en: "Calendar below",
          hi: "नीचे कैलेंडर",
          mr: "खाली दिनदर्शिका"
        }
      },
      { id: "afg-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
      { id: "afg-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
      { id: "afg-email", name: "email", type: "email", required: false, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
