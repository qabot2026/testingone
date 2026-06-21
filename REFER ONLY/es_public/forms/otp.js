/**
 * Form: OTP — `form_id`: "otp".
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.otp = {
    staffFormLabel: "otp",
    formType: "otp",
    titleByLanguage: {
      en: "Verify OTP",
      hi: "OTP सत्यापित करें",
      mr: "OTP सत्यापित करा"
    },
    subtitleByLanguage: {
      en: "Enter the code we sent.",
      hi: "भेजा गया कोड दर्ज करें।",
      mr: "पाठवलेला कोड टाका."
    },
    subtitleMobileByLanguage: {
      en: "Enter your mobile number. We will send a new code.",
      hi: "अपना मोबाइल नंबर दर्ज करें। हम नया कोड भेजेंगे।",
      mr: "तुमचा मोबाईल नंबर टाका. आम्ही नवा कोड पाठवू."
    },
    showSubtitle: true,
    maxCardHeightPx: 280,
    resendOtpAction: "query:resend_otp",
    chatSummaryFieldNames: ["otp", "mobile"],
    fields: [
      {
        id: "o-otp",
        name: "otp",
        type: "text",
        required: true,
        icon: "key",
        maxLength: 8,
        minLength: 4,
        inputMode: "numeric",
        pattern: "^[0-9]{4,8}$",
        i18nPlaceholder: "otpEnterPlaceholder",
        i18nSummaryLabel: "summaryOtpLabel",
        i18nInvalidMessage: "invalidOtp",
        autocomplete: "one-time-code"
      },
      {
        id: "o-mobile",
        name: "mobile",
        type: "tel",
        required: false,
        hiddenUntilChangeMobile: true,
        icon: "phone",
        validateAs: "phone",
        i18nPlaceholder: "mobilePlaceholder",
        i18nSummaryLabel: "summaryMobileLabel",
        autocomplete: "tel",
        inputMode: "tel",
        placeholderByLanguage: {
          en: "Mobile number",
          hi: "मोबाइल नंबर",
          mr: "मोबाईल नंबर"
        }
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
