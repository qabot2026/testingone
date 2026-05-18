/**
 * Visitor context for the live-agent dashboard (contact lead, session transcript, conversation).
 */

import {
    fetchLatestContactSubmissionForClientSession,
    fetchSessionChatTranscriptContext
} from "../firestore.mjs";

const NAME_KEYS = ["name", "visitor_name", "full_name", "customer_name"];
const EMAIL_KEYS = ["email", "mail", "e_mail"];
const MOBILE_KEYS = [
    "mobile",
    "phone",
    "contact",
    "mobile_number",
    "phone_number",
    "tel",
    "telephone"
];
const CHANNEL_KEYS = ["channel", "source_channel"];
const SOURCE_KEYS = ["sourceUrl", "source_url", "page_url", "url"];

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

/** @param {unknown} v */
function scalar_(v) {
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    return "";
}

/** @returns {Record<string, unknown>[]} */
function bagsFromRecord_(record) {
    if (!record || typeof record !== "object") {
        return [];
    }
    const o = /** @type {Record<string, unknown>} */ (record);
    /** @type {Record<string, unknown>[]} */
    const bags = [o];
    const cx = o.client_context;
    if (cx && typeof cx === "object") {
        bags.push(/** @type {Record<string, unknown>} */ (cx));
    }
    for (const bag of bags) {
        const sp = bag.session_params;
        if (sp && typeof sp === "object") {
            bags.push(/** @type {Record<string, unknown>} */ (sp));
        }
    }
    const spTop = o.session_params;
    if (spTop && typeof spTop === "object") {
        bags.push(/** @type {Record<string, unknown>} */ (spTop));
    }
    return bags;
}

/** @param {unknown} record @param {string[]} keys */
function pickField_(record, keys) {
    for (const bag of bagsFromRecord_(record)) {
        for (const k of keys) {
            const v = scalar_(bag[k]);
            if (v) {
                return v;
            }
        }
    }
    return "";
}

/** @param {unknown[]} sources @param {string[]} keys */
function pickFirst_(sources, keys) {
    for (const src of sources) {
        const v = pickField_(src, keys);
        if (v) {
            return v;
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

    for (const bag of bagsFromRecord_(lead)) {
        const cxUploads = bag.drive_uploads || bag.uploads;
        if (!Array.isArray(cxUploads)) {
            continue;
        }
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

    return out;
}

/** @param {{ label: string, url: string }[]} a @param {{ label: string, url: string }[]} b */
function mergeDocuments_(a, b) {
    const seen = new Set(a.map((d) => d.url).filter(Boolean));
    const out = [...a];
    for (const d of b) {
        if (d.url && seen.has(d.url)) {
            continue;
        }
        if (d.url) {
            seen.add(d.url);
        }
        out.push(d);
    }
    return out;
}

/**
 * @param {string} sessionId
 * @param {{ conversation?: Record<string, unknown> | null }} [options]
 */
export async function getVisitorContext_(sessionId, options = {}) {
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

    /** @type {unknown[]} */
    const sources = [];

    try {
        const lead = await fetchLatestContactSubmissionForClientSession(sid);
        if (lead) {
            sources.push(lead);
        }
    } catch {
        /* ignore */
    }

    try {
        const sessionCx = await fetchSessionChatTranscriptContext(sid);
        if (sessionCx) {
            sources.push(sessionCx);
        }
    } catch {
        /* ignore */
    }

    const conv = options.conversation;
    if (conv && typeof conv === "object") {
        const vn = trim_(/** @type {{ visitorName?: string }} */ (conv).visitorName);
        if (vn) {
            sources.push({ name: vn, visitor_name: vn });
        }
    }

    if (!sources.length) {
        return base;
    }

    base.name = pickFirst_(sources, NAME_KEYS);
    base.email = pickFirst_(sources, EMAIL_KEYS);
    base.mobile = pickFirst_(sources, MOBILE_KEYS);
    base.channel = pickFirst_(sources, CHANNEL_KEYS);
    base.sourceUrl = pickFirst_(sources, SOURCE_KEYS);

    let documents = /** @type {{ label: string, url: string }[]} */ ([]);
    for (const src of sources) {
        documents = mergeDocuments_(documents, documentsFromLead_(src));
    }
    base.documents = documents;

    base.hasLead = Boolean(
        base.name || base.email || base.mobile || base.channel || base.sourceUrl || documents.length
    );
    return base;
}
