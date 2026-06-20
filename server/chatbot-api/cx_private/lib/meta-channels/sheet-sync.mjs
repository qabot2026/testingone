/**
 * Google Sheets row for WhatsApp / Instagram / Facebook inbound messages.
 */

import {
    formatConversationDateForSheet,
    formatConversationTimeForSheet,
    upsertSessionQueriesInSheet
} from "../sheets.mjs";
import { resolveMetaContactForSheet_ } from "./contact-profile.mjs";
import { isMetaLeadChannel, normalizeLeadChannel } from "./normalize-channel.mjs";

function trim_(v) {
    return (v == null ? "" : String(v)).trim();
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
 *   profileName?: string,
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

    const contact = resolveMetaContactForSheet_({
        sessionId,
        channel,
        from: input.from,
        profileName: input.profileName,
        cxParams: input.cxParams && typeof input.cxParams === "object" ? input.cxParams : {}
    });
    const { name, email, mobile } = contact;

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
        userQueriesCsv: userText,
        lightweightSessionSync: false,
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
        return { ok: true, channel, contact: { name, email, mobile }, result };
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn("[meta-channel/sheet-sync]", msg.slice(0, 240));
        return { ok: false, error: msg };
    }
}
