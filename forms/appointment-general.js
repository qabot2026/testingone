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
    // Name / mobile / email come from chat `client_context`; this form is date + time only.
    chatSummaryFieldNames: ["appointmentdate", "appointmenttime"],
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
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
