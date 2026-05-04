/**
 * Per-submission folder names under the parent Drive folder / Apps Script target.
 *
 * • Mobile digits: `{digits}_1`, `{digits}_2`, … (legacy bare `{digits}` counts as submission #1)
 * • No mobile: sanitized `client_session_id` → `{session}_1`, `{session}_2`, …
 * • No mobile and no session: `unknown_1`, `unknown_2`, … (legacy `unknownN` still counted)
 */

export function normalizeMobileDigits(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    return d.length ? d : "";
}

/**
 * @param {string} digits normalized digits only
 * @param {string[]} folderNames
 */
export function nextMobileSubmissionFolderName(digits, folderNames) {
    const ranks = new Set();
    if (folderNames.includes(digits)) {
        ranks.add(1);
    }
    const re = new RegExp(`^${escapeRegExp(digits)}_(\\d+)$`);
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
    return `${digits}_${nextRank}`;
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
 * Same numbering pattern as mobile, using session id as base (e.g. abc_1, abc_2).
 */
export function nextSessionSubmissionFolderName(sessionBase, folderNames) {
    if (!sessionBase) {
        return nextUnknownFolderName(folderNames);
    }
    const ranks = new Set();
    if (folderNames.includes(sessionBase)) {
        ranks.add(1);
    }
    const re = new RegExp(`^${escapeRegExp(sessionBase)}_(\\d+)$`);
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
    return `${sessionBase}_${nextRank}`;
}

/** `unknown_1`, `unknown_2`, … (+ legacy unknown1-style names) */
export function nextUnknownFolderName(folderNames) {
    const base = "unknown";
    const ranks = new Set();
    const reUnderscore = /^unknown_(\d+)$/i;
    const reLegacy = /^unknown(\d+)$/i;
    for (const n of folderNames) {
        let m = n.match(reUnderscore);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
            continue;
        }
        m = n.match(reLegacy);
        if (m) {
            const r = parseInt(m[1], 10);
            if (!Number.isNaN(r)) {
                ranks.add(r);
            }
        }
    }
    const nextRank = ranks.size === 0 ? 1 : Math.max(...ranks) + 1;
    return `${base}_${nextRank}`;
}

/**
 * @param {{ mobile: string, clientSessionId: string, folderNames: string[] }} args
 */
export function nextSubmissionFolderName({ mobile, clientSessionId, folderNames }) {
    const digits = normalizeMobileDigits(mobile);
    if (digits) {
        return nextMobileSubmissionFolderName(digits, folderNames);
    }
    const sessionBase = sanitizeSessionFolderBase(clientSessionId);
    if (sessionBase) {
        return nextSessionSubmissionFolderName(sessionBase, folderNames);
    }
    return nextUnknownFolderName(folderNames);
}

export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeFilename(name) {
    const base = name.replace(/[/\\]/g, "_").replace(/\0/g, "");
    return base.slice(0, 200) || "file";
}
