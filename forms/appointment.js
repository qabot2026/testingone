/**
 * Form: simple date/time appointment — `form_id`: "appointment".
 * (Legacy; per-doctor / general calendars use `appointment-doctor.js` / `appointment-general.js`.)
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.appointment = {
    staffFormLabel: "appointment",
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
  };
})(typeof window !== "undefined" ? window : globalThis);
