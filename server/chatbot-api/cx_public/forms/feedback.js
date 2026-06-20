/**
 * Form: feedback — `form_id`: "feedback".
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.feedback = {
    staffFormLabel: "feedback",
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
  };
})(typeof window !== "undefined" ? window : globalThis);
