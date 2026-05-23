/**
 * Google Sheets row for WhatsApp / Instagram / Facebook inbound messages.
 */

import {
    formatConversationDateForSheet,
    formatConversationTimeForSheet,
    upsertSessionQueriesInSheet
} from "../sheets.mjs";
import { isMetaLeadChannel, normalizeLeadChannel } from "./normalize-channel.mjs";

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

/** @param {Record<string, unknown>} params @param {string[]} keys */
function firstParam_(params, keys) {
    for (const k of keys) {
        const v = paramStr_(params[k]);
        if (v) {
            return v;
        }
    }
    return "";
}

/** @param {string} channel @param {string} from */
function mobileFromMetaSender_(channel, from) {
    const ch = normalizeLeadChannel(channel);
    const digits = trim_(from).replace(/\D/g, "");
    if (ch === "whatsapp" && digits.length >= 10) {
        return digits;
    }
    return "";
}

/** @param {string} channel */
function metaBrowserLabel_(channel) {
    switch (normalizeLeadChannel(channel)) {
        case "whatsapp":
            return "WhatsApp";
        case "instagram":
            return "Instagram";
        case "facebook":
            return "Facebook Messenger";
        default:
            return "";
    }
}

/** @param {string} channel @param {string} from */
function metaSourceUrl_(channel, from) {
    const ch = normalizeLeadChannel(channel);
    const id = trim_(from);
    if (!isMetaLeadChannel(ch) || !id) {
        return "";
    }
    return `${ch}:${id}`;
}

/**
 * @param {{
 *   channel: string,
 *   sessionId: string,
 *   from: string,
 *   userText: string,
 *   cxParams?: Record<string, unknown>
 * }} input
 */
export async function syncMetaInboundMessageToSheet_(input) {
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return { ok: false, skipped: "sheets_disabled" };
    }
    if (!(process.env.SHEETS_SPREADSHEET_ID || "").trim()) {
        return { ok: false, skipped: "no_spreadsheet_id" };
    }

    const userText = trim_(input.userText);
    if (!userText) {
        return { ok: false, skipped: "empty_text" };
    }

    const channel = normalizeLeadChannel(input.channel);
    const sessionId = trim_(input.sessionId);
    if (!sessionId || !isMetaLeadChannel(channel)) {
        return { ok: false, skipped: "not_meta_channel" };
    }

    const params = input.cxParams && typeof input.cxParams === "object" ? input.cxParams : {};
    const name = firstParam_(params, ["name", "Name", "patient_name", "patientName"]);
    const email = firstParam_(params, ["email", "Email"]);
    let mobile = firstParam_(params, ["mobile", "Mobile", "phone", "Phone"]);
    if (!mobile) {
        mobile = mobileFromMetaSender_(channel, input.from);
    }

    const convAt = new Date();
    /** @type {Parameters<typeof upsertSessionQueriesInSheet>[0]} */
    const row = {
        convDate: formatConversationDateForSheet(convAt),
        convTime: formatConversationTimeForSheet(convAt),
        formId: "",
        name,
        mobile,
        email,
        clientSessionId: sessionId,
        browserName: metaBrowserLabel_(channel),
        deviceType: "Mobile",
        channel,
        fileLinks: "",
        ip: "",
        city: "",
        sourceUrl: metaSourceUrl_(channel, input.from),
        appointmentBooked: "No",
        appointmentDate: "",
        appointmentTime: "",
        userQueriesCsv: userText,
        lightweightSessionSync: true,
        clientAuthoritativeQueries: false,
        sheetExtrasSources: {
            clientContext: {
                channel,
                client_session_id: sessionId,
                mobile,
                name,
                email
            },
            fields: {}
        }
    };

    try {
        const result = await upsertSessionQueriesInSheet(row);
        return { ok: true, channel, result };
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn("[meta-channel/sheet-sync]", msg.slice(0, 240));
        return { ok: false, error: msg };
    }
}
