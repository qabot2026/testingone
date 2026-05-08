/**
 * Form: document upload — `form_id`: "uploadDocument".
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.uploadDocument = {
    titleByLanguage: {
      en: "Upload document",
      hi: "दस्तावेज़ अपलोड करें",
      mr: "दस्तऐवज अपलोड करा"
    },
    subtitleByLanguage: {
      en: "You can select one or more files. Use Contact us first so we have your mobile for your upload folder.",
      hi: "एक या अधिक फ़ाइल चुन सकते हैं। अपलोड फ़ोल्डर के लिए पहले «संपर्क करें» भरें।",
      mr: "एक किंवा अनेक फाइल निवडा. अपलोड फोल्डरसाठी आधी संपर्क फॉर्म भरा."
    },
    showSubtitle: true,
    maxCardHeightPx: 300,
    chatSummaryFieldNames: ["document"],
    fields: [
      {
        id: "u-document",
        name: "document",
        type: "file",
        required: true,
        multiple: true,
        icon: "file",
        i18nSummaryLabel: "summaryDocumentLabel",
        accept: "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip,application/x-zip-compressed",
        placeholderByLanguage: {
          en: "Choose one or more files…",
          hi: "एक या अधिक फ़ाइलें चुनें…",
          mr: "एक किंवा अनेक फाइल निवडा…"
        }
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
