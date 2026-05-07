import fs from "node:fs";

/**
 * Extremely small XML reader for the specific "GenericTable" format used here:
 * <GenericTable><Doctor>...</Doctor><Doctor>...</Doctor></GenericTable>
 * <GenericTable><Branch>...</Branch>...</GenericTable>
 *
 * Not a general XML parser (intentionally avoids extra deps).
 */

/** @param {string} s */
function decodeXmlText_(s) {
    return String(s || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#10;/g, "\n");
}

/**
 * @param {string} xml
 * @param {string} itemTag e.g. "Doctor" or "Branch"
 * @returns {string[]}
 */
function extractItems_(xml, itemTag) {
    const re = new RegExp(`<${itemTag}\\b[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "g");
    /** @type {string[]} */
    const out = [];
    let m;
    while ((m = re.exec(xml))) {
        out.push(m[1] || "");
    }
    return out;
}

/**
 * @param {string} itemXml inner XML of an item
 * @param {string} tagName
 * @returns {string}
 */
function getTagText_(itemXml, tagName) {
    const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const m = re.exec(itemXml);
    if (!m) return "";
    return decodeXmlText_((m[1] || "").trim());
}

/**
 * @param {{ filePath: string | URL, itemTag: string, fields: string[] }} args
 * @returns {Array<Record<string, string>>}
 */
export function readGenericTableFile({ filePath, itemTag, fields }) {
    // Accept either an absolute/relative filesystem path OR a file:// URL (from import.meta.url).
    const xml = fs.readFileSync(/** @type {any} */ (filePath), "utf8");
    const items = extractItems_(xml, itemTag);
    return items.map((ix) => {
        /** @type {Record<string, string>} */
        const obj = {};
        for (const f of fields) {
            obj[f] = getTagText_(ix, f);
        }
        return obj;
    });
}

