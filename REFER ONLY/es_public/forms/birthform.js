/**
 * Form: birth date — `form_id`: "birthform".
 * Only dates strictly before today (no today / future). Requires `pastDateOnly` on the date field (see company.js).
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.birthform = {
    staffFormLabel: "birth",
    titleByLanguage: {
      en: "Date of birth",
      hi: "जन्म तिथि",
      mr: "जन्मतारीख"
    },
    subtitleByLanguage: {
      en: "Choose a date in the past (today and future dates are not allowed).",
      hi: "अतीत की कोई तारीख चुनें (आज और भविष्य की तारीखें मान्य नहीं)।",
      mr: "भूतकाळातील तारीख निवडा (आज आणि भविष्यातील तारखा मान्य नाहीत)."
    },
    showSubtitle: true,
    maxCardHeightPx: 280,
    chatSummaryFieldNames: ["birthdate"],
    fields: [
      {
        id: "bf-birthdate",
        name: "birthdate",
        type: "date",
        required: true,
        pastDateOnly: true,
        pastDateMin: "1900-01-01",
        icon: "calendar",
        i18nPlaceholder: "birthDatePlaceholder",
        placeholderByLanguage: {
          en: "DD/MM/YYYY",
          hi: "DD/MM/YYYY",
          mr: "DD/MM/YYYY"
        },
        i18nSummaryLabel: "summaryBirthDateLabel",
        i18nInvalidMessage: "invalidPastBirthDate",
        autocomplete: "bday"
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
