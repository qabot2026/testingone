/**
 * Form: nearest-branch — `form_id`: "nearestBranch".
 *
 * One-click geolocation: the user clicks a "Use my location" button, the browser
 * prompts for permission, and the chat fetches the closest hospital branches from
 * `GET /api/nearest-branches?lat=&lng=&limit=`. The picked branch's id flows back
 * into the form as `branchId` and is submitted to the standard contact-form API.
 *
 * Trigger from Dialogflow with `open_form: { form_id: "nearestBranch" }`.
 */
(function (w) {
  w.__DFCHAT_FORMS__ = w.__DFCHAT_FORMS__ || {};
  w.__DFCHAT_FORMS__.nearestBranch = {
    titleByLanguage: {
      en: "Find nearest hospital",
      hi: "नज़दीकी अस्पताल खोजें",
      mr: "जवळचे रुग्णालय शोधा"
    },
    subtitleByLanguage: {
      en: "Share your location in one tap; we'll list the closest branches.",
      hi: "एक टैप में अपना स्थान साझा करें; हम पास की शाखाएँ दिखाएँगे।",
      mr: "एका क्लिकमध्ये तुमचे स्थान शेअर करा; जवळच्या शाखा दिसतील."
    },
    showSubtitle: true,
    maxCardHeightPx: 520,
    chatSummaryFieldNames: ["branchName", "branchCity", "branchArea", "branchDistanceKm"],
    fields: [
      {
        id: "nb-geo",
        name: "geolocation",
        type: "geolocation",
        required: true,
        icon: "location",
        hiddenLatId: "nb-lat",
        hiddenLngId: "nb-lng",
        hiddenBranchIdId: "nb-branchId",
        hiddenBranchNameId: "nb-branchName",
        hiddenBranchCityId: "nb-branchCity",
        hiddenBranchAreaId: "nb-branchArea",
        hiddenBranchDistanceKmId: "nb-branchDistanceKm",
        resultLimit: 5,
        buttonLabelByLanguage: {
          en: "Use my location",
          hi: "मेरा स्थान उपयोग करें",
          mr: "माझे स्थान वापरा"
        },
        retryButtonLabelByLanguage: {
          en: "Try again",
          hi: "फिर से प्रयास करें",
          mr: "पुन्हा प्रयत्न करा"
        },
        bookButtonLabelByLanguage: {
          en: "Select",
          hi: "चुनें",
          mr: "निवडा"
        },
        introByLanguage: {
          en: "Tap the button below; your browser will ask for permission.",
          hi: "नीचे का बटन दबाएँ; ब्राउज़र अनुमति माँगेगा।",
          mr: "खालचे बटण दाबा; ब्राउझर परवानगी विचारेल."
        },
        locatingByLanguage: {
          en: "Locating you…",
          hi: "आपका स्थान खोजा जा रहा है…",
          mr: "तुमचे स्थान शोधत आहे…"
        },
        permissionDeniedByLanguage: {
          en: "Location permission was blocked. Allow it in your browser settings, or type the city in chat.",
          hi: "स्थान अनुमति अवरुद्ध है। ब्राउज़र सेटिंग में अनुमति दें या चैट में शहर लिखें।",
          mr: "स्थान परवानगी ब्लॉक केली आहे. ब्राउझरमधून परवानगी द्या किंवा चॅटमध्ये शहर लिहा."
        },
        unsupportedByLanguage: {
          en: "Your browser doesn't support geolocation.",
          hi: "आपका ब्राउज़र जियो-लोकेशन का समर्थन नहीं करता।",
          mr: "तुमचा ब्राउझर जियो-लोकेशनला समर्थन देत नाही."
        },
        fetchFailedByLanguage: {
          en: "Could not load nearby branches. Please try again.",
          hi: "पास की शाखाएँ लोड नहीं हो सकीं। कृपया पुनः प्रयास करें।",
          mr: "जवळच्या शाखा लोड करता आल्या नाहीत. पुन्हा प्रयत्न करा."
        },
        noResultsByLanguage: {
          en: "No branches found near you.",
          hi: "आपके पास कोई शाखा नहीं मिली।",
          mr: "तुमच्या जवळ कोणतीही शाखा सापडली नाही."
        },
        pickPromptByLanguage: {
          en: "Pick a branch to continue:",
          hi: "जारी रखने के लिए एक शाखा चुनें:",
          mr: "पुढे जाण्यासाठी शाखा निवडा:"
        }
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
