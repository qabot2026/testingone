/**
 * Short stable ids for Sheets / Firestore / staff transcript (not internal `forms/*.js` registry keys).
 * Widget `staffFormLabel` on each form should match these values.
 */
/** @type {Record<string, string>} */
export const INTERNAL_FORM_KEY_TO_STAFF_LABEL = {
    contact: "contact",
    uploadDocument: "upload",
    upload: "upload",
    otp: "otp",
    feedback: "feedback",
    birthform: "birth",
    nearestBranch: "nearest-branch",
    appointment: "appointment",
    appintmentformgeneral: "general-appointment",
    appintmentformdoctor: "doctor-appointment",
    appintmentformdocot: "doctor-appointment"
};

/**
 * @param {unknown} formId internal registry key or staff label
 * @returns {string}
 */
export function staffFormLabelFromId(formId) {
    const t = typeof formId === "string" ? formId.trim() : "";
    if (!t) {
        return "";
    }
    const mapped = INTERNAL_FORM_KEY_TO_STAFF_LABEL[t];
    if (mapped) {
        return mapped;
    }
    const compact = t.toLowerCase().replace(/[\s_-]+/g, "");
    if (compact === "upload" || compact === "uploaddocument") {
        return "upload";
    }
    return t;
}

/**
 * @param {unknown} explicit `_contactFormId` from widget or CX
 * @param {string} [envDefault] `DEFAULT_SHEET_FORM_ID`
 * @returns {string}
 */
export function normalizeSheetFormId(explicit, envDefault = "") {
    const staff = staffFormLabelFromId(explicit);
    if (staff) {
        return staff;
    }
    const def = typeof envDefault === "string" ? envDefault.trim() : "";
    return def || "web";
}
