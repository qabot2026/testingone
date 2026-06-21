/**
 * Appointment calendar — Dialogflow `form_id`: "appointment"
 * Schedule: data/appointment-schedule.json → forms.appointment
 * Booked:   data/appointment-booked.json   → forms.appointment
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  var def = {
    staffFormLabel: "appointment",
    formType: "appointment",
    titleByLanguage: {
      en: "Appointment",
      hi: "अपॉइंटमेंट",
      mr: "अपॉइंटमेंट"
    },
    showSubtitle: true,
    subtitleByLanguage: {
      en: "Pick a date, then choose an available time. Red = already booked.",
      hi: "तारीख चुनें, फिर उपलब्ध समय। लाल = पहले से बुक।",
      mr: "तारीख निवडा, नंतर उपलब्ध वेळ. लाल = आधीच बुक."
    },
    maxCardHeightPx: 540,
    chatSummaryFieldNames: ["appointmentdate", "appointmenttime"],
    fields: [
      {
        id: "appt-cal",
        name: "appointmentdate",
        type: "appointment",
        required: true,
        icon: "calendar",
        hiddenDateId: "appt-date",
        hiddenTimeId: "appt-time",
        i18nSummaryLabel: "summaryAppointmentDateLabel",
        placeholderByLanguage: {
          en: "Calendar below",
          hi: "नीचे कैलेंडर",
          mr: "खाली दिनदर्शिका"
        }
      }
    ]
  };
  w.__DFCHAT_FORMS__.appointment = def;
  /** Purana Dialogflow form_id — same form */
  w.__DFCHAT_FORMS__.appintmentformgeneral = def;
})(typeof window !== "undefined" ? window : globalThis);
