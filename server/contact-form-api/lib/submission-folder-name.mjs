/**
 * Shared rules for per-submission folder names (Firebase Storage path segment or Drive folder).
 * Mobile digits: first `9960343434`, then `9960343434_2`, … — no mobile: `unknown1`, `unknown2`, …
 */

export function normalizeMobileDigits(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    return d.length ? d : "";
}

/**
 * First submission for this number → folder `9960343434`. Later → `9960343434_2`, `_3`, …
 * @param {string} digits
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
    if (ranks.size === 0) {
        return digits;
    }
    const nextRank = Math.max(...ranks) + 1;
    return `${digits}_${nextRank}`;
}

/** Sequential unknown1, unknown2, … */
export function nextUnknownFolderName(folderNames) {
    const nums = [];
    const re = /^unknown(\d+)$/i;
    for (const n of folderNames) {
        const m = n.match(re);
        if (m) {
            const v = parseInt(m[1], 10);
            if (!Number.isNaN(v)) {
                nums.push(v);
            }
        }
    }
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `unknown${next}`;
}

export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeFilename(name) {
    const base = name.replace(/[/\\]/g, "_").replace(/\0/g, "");
    return base.slice(0, 200) || "file";
}
