/**
 * Per-upload folder names under the parent Drive folder / Apps Script target.
 *
 * With mobile: `{digits}_{dd}_{mm}_{yyyy}_{n}` (n = 1,2,… for that mobile on that calendar day)
 * No mobile: `{session}_{dd}_{mm}_{yyyy}_{n}`
 * No mobile/session: `unknown_{dd}_{mm}_{yyyy}_{n}`
 *
 * Calendar day uses `CONTACT_FORM_SUBMISSION_TZ` (IANA), default `UTC`. Set e.g. `Asia/Kolkata` on the host if needed.
 */

/**
 * @param {Date} [d]
 * @param {string} [timeZone] IANA zone; defaults to env CONTACT_FORM_SUBMISSION_TZ or "UTC"
 */
export function formatSubmissionFolderDate(
    d = new Date(),
    timeZone = (process.env.CONTACT_FORM_SUBMISSION_TZ || "UTC").trim() || "UTC"
) {
    const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
    const tz = timeZone || "UTC";
    const dtf = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
    /** @type {Record<string, string>} */
    const parts = {};
    for (const p of dtf.formatToParts(dt)) {
        if (p.type !== "literal") {
            parts[p.type] = p.value;
        }
    }
    const day = parts.day || "01";
    const month = parts.month || "01";
    const year = parts.year || "1970";
    return `${day}_${month}_${year}`;
}

export function normalizeMobileDigits(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    return d.length ? d : "";
}

/**
 * @param {string} digits normalized digits only
 * @param {string[]} folderNames existing sibling folder names
 * @param {string} dateLabel from formatSubmissionFolderDate (dd_mm_yyyy)
 */
export function nextMobileSubmissionFolderName(digits, folderNames, dateLabel) {
    const ranks = new Set();
    const re = new RegExp(`^${escapeRegExp(digits)}_${escapeRegExp(dateLabel)}_(\\d+)$`);
    for (const n of folderNames) {
        const m = n.match(re);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
        }
    }
    const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
    return `${digits}_${dateLabel}_${nextRank}`;
}

/** Sanitize client_session_id for use as a folder name segment. */
export function sanitizeSessionFolderBase(raw) {
    const s = String(raw || "").trim();
    if (!s.length) {
        return "";
    }
    const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    return cleaned || "";
}

/**
 * Same numbering as mobile, using session id as base.
 * @param {string} sessionBase
 * @param {string[]} folderNames
 * @param {string} dateLabel
 */
export function nextSessionSubmissionFolderName(sessionBase, folderNames, dateLabel) {
    if (!sessionBase) {
        return nextUnknownFolderName(folderNames, dateLabel);
    }
    const ranks = new Set();
    const re = new RegExp(`^${escapeRegExp(sessionBase)}_${escapeRegExp(dateLabel)}_(\\d+)$`);
    for (const n of folderNames) {
        const m = n.match(re);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
        }
    }
    const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
    return `${sessionBase}_${dateLabel}_${nextRank}`;
}

/** `unknown_{date}_1`, `unknown_{date}_2`, … */
export function nextUnknownFolderName(folderNames, dateLabel) {
    const base = "unknown";
    const ranks = new Set();
    const reDated = new RegExp(`^${escapeRegExp(base)}_${escapeRegExp(dateLabel)}_(\\d+)$`, "i");
    for (const n of folderNames) {
        const m = n.match(reDated);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
        }
    }
    const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
    return `${base}_${dateLabel}_${nextRank}`;
}

/**
 * @param {{ mobile: string, clientSessionId: string, folderNames: string[], submittedAt?: Date }} args
 */
export function nextSubmissionFolderName({ mobile, clientSessionId, folderNames, submittedAt }) {
    const dateLabel = formatSubmissionFolderDate(submittedAt);
    const digits = normalizeMobileDigits(mobile);
    if (digits) {
        return nextMobileSubmissionFolderName(digits, folderNames, dateLabel);
    }
    const sessionBase = sanitizeSessionFolderBase(clientSessionId);
    if (sessionBase) {
        return nextSessionSubmissionFolderName(sessionBase, folderNames, dateLabel);
    }
    return nextUnknownFolderName(folderNames, dateLabel);
}

export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeFilename(name) {
    const base = name.replace(/[/\\]/g, "_").replace(/\0/g, "");
    return base.slice(0, 200) || "file";
}
