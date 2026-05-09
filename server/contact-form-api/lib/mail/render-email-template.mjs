/**
 * Load UTF-8 HTML from lib/mail/templates/ and substitute {{TOKEN}} placeholders.
 * All replacement values MUST be pre-escaped (see escapeMailHtml_).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

/** @param {unknown} val */
export function escapeMailHtml_(val) {
    return String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * @param {string} fileName Must end with .html inside templates/
 * @param {Record<string, string>} variables Escaped fragments only (caller runs escapeMailHtml_)
 */
export function renderEmailTemplateHtml_(fileName, variables) {
    const safeBase = path.basename(fileName);
    const fullPath = path.join(templatesDir, safeBase);
    let raw = fs.readFileSync(fullPath, "utf8");
    for (const [key, escapedValue] of Object.entries(variables)) {
        raw = raw.split(`{{${key}}}`).join(escapedValue);
    }
    if (/\{\{[A-Za-z0-9_]+\}\}/.test(raw)) {
        console.warn(
            "[render-email-template] unreplaced placeholders in",
            safeBase,
            "// check spelling matches template tokens"
        );
    }
    return raw;
}
