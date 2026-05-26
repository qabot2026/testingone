/**
 * Per-session contact hints for Meta channels (WhatsApp / Instagram / Facebook).
 * Mobile from sender id; name from WhatsApp profile or Graph API; email from Dialogflow when user shares it.
 */

import { normalizeLeadChannel } from "./normalize-channel.mjs";

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
}

/** @param {unknown} v */
function paramStr_(v) {
    if (typeof v === "string") {
        return trim_(v);
    }
    if (typeof v === "number" || typeof v === "boolean") {
        return String(v);
    }
    return "";
}

/** @param {...string} vals */
function pickFirstNonEmpty_(...vals) {
    for (const v of vals) {
        const s = trim_(v);
        if (s) {
            return s;
        }
    }
    return "";
}

/** @type {Map<string, { name: string, email: string, mobile: string, channel: string, at: number }>} */
const metaContactBySession_ = new Map();
const CONTACT_TTL_MS = 24 * 60 * 60 * 1000;

function pruneMetaContactCache_() {
    const now = Date.now();
    for (const [k, v] of metaContactBySession_) {
        if (now - v.at > CONTACT_TTL_MS) {
            metaContactBySession_.delete(k);
        }
    }
}

/**
 * @param {unknown} contacts WhatsApp webhook `value.contacts`
 * @param {string} waId message `from`
 */
export function whatsappProfileNameFromContacts_(contacts, waId) {
    if (!Array.isArray(contacts)) {
        return "";
    }
    const id = trim_(waId);
    for (const row of contacts) {
        if (!row || typeof row !== "object") {
            continue;
        }
        const wa = trim_(row.wa_id);
        const name = trim_(row.profile && typeof row.profile === "object" ? row.profile.name : "");
        if (!name) {
            continue;
        }
        if (!id || !wa || wa === id) {
            return name;
        }
    }
    for (const row of contacts) {
        if (!row || typeof row !== "object") {
            continue;
        }
        const name = trim_(row.profile && typeof row.profile === "object" ? row.profile.name : "");
        if (name) {
            return name;
        }
    }
    return "";
}

/** @param {Record<string, unknown>} params */
export function contactFieldsFromDialogflowParams_(params) {
    const name = pickFirstNonEmpty_(
        paramStr_(params.name),
        paramStr_(params.Name),
        paramStr_(params.patient_name),
        paramStr_(params.patientName),
        paramStr_(params.full_name),
        paramStr_(params.fullName)
    );
    const email = pickFirstNonEmpty_(
        paramStr_(params.email),
        paramStr_(params.Email),
        paramStr_(params.email_address),
        paramStr_(params.emailAddress)
    );
    let mobile = pickFirstNonEmpty_(
        paramStr_(params.mobile),
        paramStr_(params.Mobile),
        paramStr_(params.phone),
        paramStr_(params.Phone)
    );
    mobile = mobile.replace(/\D/g, "");
    return { name, email, mobile };
}

/** @param {string} channel @param {string} from */
export function mobileFromMetaSender_(channel, from) {
    const ch = normalizeLeadChannel(channel);
    const digits = trim_(from).replace(/\D/g, "");
    if (ch === "whatsapp" && digits.length >= 10) {
        return digits;
    }
    return "";
}

/**
 * @param {string} sessionId
 * @param {{ name?: string, email?: string, mobile?: string, channel?: string }} hints
 */
export function rememberMetaContact_(sessionId, hints) {
    const sid = trim_(sessionId);
    if (!sid) {
        return;
    }
    pruneMetaContactCache_();
    const prev = metaContactBySession_.get(sid) || {
        name: "",
        email: "",
        mobile: "",
        channel: "",
        at: Date.now()
    };
    metaContactBySession_.set(sid, {
        name: pickFirstNonEmpty_(hints.name, prev.name),
        email: pickFirstNonEmpty_(hints.email, prev.email),
        mobile: pickFirstNonEmpty_(hints.mobile, prev.mobile),
        channel: pickFirstNonEmpty_(hints.channel, prev.channel),
        at: Date.now()
    });
}

/** @param {string} sessionId */
export function getMetaContact_(sessionId) {
    const sid = trim_(sessionId);
    if (!sid) {
        return { name: "", email: "", mobile: "", channel: "" };
    }
    pruneMetaContactCache_();
    const row = metaContactBySession_.get(sid);
    if (!row) {
        return { name: "", email: "", mobile: "", channel: "" };
    }
    return {
        name: row.name,
        email: row.email,
        mobile: row.mobile,
        channel: row.channel
    };
}

/**
 * Merge profile, cached session contact, and Dialogflow parameters.
 * Dialogflow values win when present (user shared name/email in chat).
 *
 * @param {{
 *   sessionId: string,
 *   channel: string,
 *   from: string,
 *   profileName?: string,
 *   dialogflowParams?: Record<string, unknown>
 * }} input
 */
export function resolveMetaContactForSheet_(input) {
    const cached = getMetaContact_(input.sessionId);
    const fromDialogflow = contactFieldsFromDialogflowParams_(input.dialogflowParams || {});
    const mobile = pickFirstNonEmpty_(
        fromDialogflow.mobile,
        cached.mobile,
        mobileFromMetaSender_(input.channel, input.from)
    );
    const name = pickFirstNonEmpty_(fromDialogflow.name, cached.name, input.profileName);
    const email = pickFirstNonEmpty_(fromDialogflow.email, cached.email);

    rememberMetaContact_(input.sessionId, {
        name,
        email,
        mobile,
        channel: normalizeLeadChannel(input.channel)
    });

    return { name, email, mobile };
}

/**
 * Contact hints to seed Dialogflow `$session.params` before detectIntent.
 * @param {{ sessionId: string, channel: string, from: string, profileName?: string }} input
 */
export function metaContactHintsForDialogflowSession_(input) {
    const cached = getMetaContact_(input.sessionId);
    const mobile = pickFirstNonEmpty_(
        cached.mobile,
        mobileFromMetaSender_(input.channel, input.from)
    );
    const name = pickFirstNonEmpty_(cached.name, input.profileName);
    const email = cached.email;
    /** @type {Record<string, string>} */
    const out = { channel: normalizeLeadChannel(input.channel) };
    if (name) {
        out.name = name;
    }
    if (email) {
        out.email = email;
    }
    if (mobile) {
        out.mobile = mobile;
    }
    return out;
}
