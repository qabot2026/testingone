/**
 * Form: per-doctor booking — `form_id`: "appintmentformdoctor".
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.appintmentformdoctor = {
    titleByLanguage: {
      en: "Doctor appointment",
      hi: "डॉक्टर अपॉइंटमेंट",
      mr: "डॉक्टर अपॉइंटमेंट"
    },
    subtitleByLanguage: {
      en: "Choose a date and time for the doctor you selected. Red = booked for this doctor.",
      hi: "चयनित डॉक्टर के लिए तारीख और समय चुनें। लाल = इस डॉक्टर के लिए बुक।",
      mr: "निवडलेल्या डॉक्टरसाठी तारीख आणि वेळ निवडा. लाल = या डॉक्टरसाठी बुक."
    },
    showSubtitle: true,
    maxCardHeightPx: 540,
    chatSummaryFieldNames: ["doctorId", "name", "mobile", "email", "appointmentdate", "appointmenttime"],
    fields: [
      { id: "afd-doctor", name: "doctorId", type: "hidden", required: true, value: "", i18nSummaryLabel: "summaryDoctorIdLabel" },
      {
        id: "afd-appt",
        name: "appointmentdate",
        type: "appointmentdoctor",
        required: true,
        icon: "calendar",
        hiddenDateId: "afd-appt-date",
        hiddenTimeId: "afd-appt-time",
        i18nSummaryLabel: "summaryDateLabel",
        placeholderByLanguage: {
          en: "Calendar below",
          hi: "नीचे कैलेंडर",
          mr: "खाली दिनदर्शिका"
        }
      },
      { id: "afd-name", name: "name", type: "text", required: true, icon: "user", i18nPlaceholder: "namePlaceholder", i18nSummaryLabel: "summaryNameLabel", autocomplete: "name" },
      { id: "afd-mobile", name: "mobile", type: "tel", required: true, icon: "phone", i18nPlaceholder: "mobilePlaceholder", i18nSummaryLabel: "summaryMobileLabel", autocomplete: "tel", inputMode: "tel" },
      { id: "afd-email", name: "email", type: "email", required: false, icon: "email", validateAs: "email", i18nPlaceholder: "emailPlaceholder", i18nSummaryLabel: "summaryEmailLabel", autocomplete: "email" }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
