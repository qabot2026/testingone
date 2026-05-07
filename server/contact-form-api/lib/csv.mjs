/**
 * Minimal CSV parser with header row.
 * Supports:
 * - commas
 * - quoted fields with escaped quotes ("")
 * - newlines inside quoted fields
 */

/** @param {string} input */
export function parseCsv(input) {
    // UTF-8 BOM on first cell breaks header "DoctorId" → skip all doctor rows unless stripped.
    const s = String(input || "").replace(/^\uFEFF/, "");
    /** @type {string[][]} */
    const rows = [];
    /** @type {string[]} */
    let row = [];
    let field = "";
    let i = 0;
    let inQuotes = false;

    const pushField = () => {
        row.push(field);
        field = "";
    };
    const pushRow = () => {
        // ignore completely empty trailing row
        if (row.length === 1 && row[0] === "" && rows.length > 0) {
            row = [];
            return;
        }
        rows.push(row);
        row = [];
    };

    while (i < s.length) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === "\"") {
                const next = s[i + 1];
                if (next === "\"") {
                    field += "\"";
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            field += ch;
            i += 1;
            continue;
        }

        if (ch === "\"") {
            inQuotes = true;
            i += 1;
            continue;
        }
        if (ch === ",") {
            pushField();
            i += 1;
            continue;
        }
        if (ch === "\r") {
            // CRLF or bare CR
            if (s[i + 1] === "\n") i += 2;
            else i += 1;
            pushField();
            pushRow();
            continue;
        }
        if (ch === "\n") {
            i += 1;
            pushField();
            pushRow();
            continue;
        }
        field += ch;
        i += 1;
    }
    pushField();
    pushRow();

    if (rows.length === 0) {
        return { headers: [], records: [] };
    }
    const headers = rows[0].map((h) => String(h || "").trim().replace(/^\uFEFF/, ""));
    const records = rows.slice(1).map((r) => {
        /** @type {Record<string, string>} */
        const obj = {};
        for (let c = 0; c < headers.length; c += 1) {
            const key = headers[c];
            if (!key) continue;
            obj[key] = String(r[c] ?? "").trim();
        }
        return obj;
    });
    return { headers, records };
}

