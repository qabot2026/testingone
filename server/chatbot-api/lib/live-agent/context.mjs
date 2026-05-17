/**
 * Visitor lead context for the live-agent dashboard (Firestore contact submission).
 */

import { fetchLatestContactSubmissionForClientSession } from "../firestore.mjs";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

/** @param {unknown} lead */
function pickField_(lead, keys) {
    if (!lead || typeof lead !== "object") {
        return "";
    }
    const o = /** @type {Record<string, unknown>} */ (lead);
    for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) {
            return v.trim();
        }
    }
    const cx = o.client_context;
    if (cx && typeof cx === "object") {
        const c = /** @type {Record<string, unknown>} */ (cx);
        for (const k of keys) {
            const v = c[k];
            if (typeof v === "string" && v.trim()) {
                return v.trim();
            }
        }
    }
    return "";
}

/** @param {unknown} lead */
function documentsFromLead_(lead) {
    /** @type {{ label: string, url: string }[]} */
    const out = [];
    const seen = new Set();
    if (!lead || typeof lead !== "object") {
        return out;
    }
    const o = /** @type {Record<string, unknown>} */ (lead);

    function add(label, url) {
        const u = trim_(url);
        if (!u || seen.has(u)) {
            return;
        }
        seen.add(u);
        out.push({ label: label || "Document", url: u });
    }

    const doc = pickField_(lead, ["document", "fileLinks", "file_links", "files"]);
    if (doc) {
        const parts = doc.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        for (const p of parts) {
            if (/^https?:\/\//i.test(p)) {
                add("Uploaded file", p);
            } else {
                add(p, "");
            }
        }
    }

    const uploads = o.drive_uploads || o.uploads;
    if (Array.isArray(uploads)) {
        for (const item of uploads) {
            if (!item || typeof item !== "object") {
                continue;
            }
            const u = /** @type {Record<string, unknown>} */ (item);
            const url =
                trim_(u.webViewLink) ||
                trim_(u.web_view_link) ||
                trim_(u.url) ||
                trim_(u.link);
            const name = trim_(u.originalname) || trim_(u.name) || "File";
            if (url) {
                add(name, url);
            }
        }
    }

    const cx = o.client_context;
    if (cx && typeof cx === "object") {
        const c = /** @type {Record<string, unknown>} */ (cx);
        const cxUploads = c.drive_uploads || c.uploads;
        if (Array.isArray(cxUploads)) {
            for (const item of cxUploads) {
                if (!item || typeof item !== "object") {
                    continue;
                }
                const u = /** @type {Record<string, unknown>} */ (item);
                const url = trim_(u.webViewLink) || trim_(u.url);
                const name = trim_(u.originalname) || "File";
                if (url) {
                    add(name, url);
                }
            }
        }
    }

    return out;
}

/**
 * @param {string} sessionId
 * @returns {Promise<{
 *   sessionId: string,
 *   name: string,
 *   email: string,
 *   mobile: string,
 *   channel: string,
 *   sourceUrl: string,
 *   documents: { label: string, url: string }[],
 *   transcriptUrl: string,
 *   hasLead: boolean
 * }>}
 */
export async function getVisitorContext_(sessionId) {
    const sid = trim_(sessionId);
    const base = {
        sessionId: sid,
        name: "",
        email: "",
        mobile: "",
        channel: "",
        sourceUrl: "",
        documents: /** @type {{ label: string, url: string }[]} */ ([]),
        transcriptUrl: sid ? `/conversation-transcript?session=${encodeURIComponent(sid)}` : "",
        hasLead: false
    };
    if (!sid) {
        return base;
    }
    try {
        const lead = await fetchLatestContactSubmissionForClientSession(sid);
        if (!lead) {
            return base;
        }
        base.hasLead = true;
        base.name = pickField_(lead, ["name", "visitor_name", "full_name"]);
        base.email = pickField_(lead, ["email", "mail"]);
        base.mobile = pickField_(lead, ["mobile", "phone", "contact"]);
        base.channel = pickField_(lead, ["channel", "source_channel"]);
        base.sourceUrl = pickField_(lead, ["sourceUrl", "source_url", "page_url", "url"]);
        base.documents = documentsFromLead_(lead);
        return base;
    } catch {
        return base;
    }
}
