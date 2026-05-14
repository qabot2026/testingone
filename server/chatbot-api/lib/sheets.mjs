/**
 * Append one row via Google Sheets API v4 (service account must be shared on the spreadsheet).
 *
 * **Sheet extras (custom columns):** edit one file next to the API:
 * `sheet-integration.config.json` → property `extraColumnMappings` (see repo example).
 * Legacy: `sheet-extra-columns.config.json` (raw array only) still loads if the integration file is absent.
 * Env overrides: `SHEETS_EXTRA_COLUMN_MAPPINGS_JSON` (JSON array), then `SHEETS_INTEGRATION_CONFIG_JSON`
 * (object with `extraColumnMappings` or a raw array).
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getServiceAccountCredentials } from "./google-service-account.mjs";

const SHEET_CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHEET_INTEGRATION_CONFIG_PATH = path.join(SHEET_CONFIG_DIR, "..", "sheet-integration.config.json");
const SHEET_LEGACY_EXTRA_COLUMNS_PATH = path.join(SHEET_CONFIG_DIR, "..", "sheet-extra-columns.config.json");

/** @type {unknown[] | null} */
let diskSheetExtraMappingsCache = null;

/** @param {string} filePath */
function parseExtraMappingsFromConfigFile_(filePath) {
    const raw = readFileSync(filePath, "utf8");
    const j = JSON.parse(raw);
    if (Array.isArray(j)) {
        return j;
    }
    if (j && typeof j === "object") {
        const o = /** @type {{ extraColumnMappings?: unknown; mappings?: unknown }} */ (j);
        if (Array.isArray(o.extraColumnMappings)) {
            return o.extraColumnMappings;
        }
        if (Array.isArray(o.mappings)) {
            return o.mappings;
        }
    }
    return null;
}

function loadSheetExtraMappingsFromDisk_() {
    if (diskSheetExtraMappingsCache !== null) {
        return diskSheetExtraMappingsCache;
    }
    diskSheetExtraMappingsCache = [];
    try {
        if (existsSync(SHEET_INTEGRATION_CONFIG_PATH)) {
            const parsed = parseExtraMappingsFromConfigFile_(SHEET_INTEGRATION_CONFIG_PATH);
            if (parsed) {
                diskSheetExtraMappingsCache = parsed;
            }
        }
        if (!diskSheetExtraMappingsCache.length && existsSync(SHEET_LEGACY_EXTRA_COLUMNS_PATH)) {
            const parsed = parseExtraMappingsFromConfigFile_(SHEET_LEGACY_EXTRA_COLUMNS_PATH);
            if (parsed) {
                diskSheetExtraMappingsCache = parsed;
            }
        }
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        console.warn("[chatbot-api] Sheet config JSON parse failed:", msg);
        diskSheetExtraMappingsCache = [];
    }
    return diskSheetExtraMappingsCache;
}

const SPREADSHEET_ID = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
// Default schema: no Form ID (A–R). Col A Date, B Time (12h TZ from SHEETS_CONV_DATETIME_TZ), then name…
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:R").trim();

/** Session id column (0-based) when using default Date + Time lead layout (column J); legacy single Conv column layout used I (index 8). */
const STANDARD_SESSION_COLUMN_INDEX0_NEW = 9;
const STANDARD_SESSION_COLUMN_INDEX0_LEGACY = 8;
const DEDUP_LOOKBACK_ROWS = Math.max(
    10,
    Number.parseInt(process.env.SHEETS_DEDUP_LOOKBACK_ROWS || "500", 10) || 500
);
const DEDUP_WINDOW_MS = Math.max(
    10_000,
    Number.parseInt(process.env.SHEETS_DEDUP_WINDOW_MS || String(10 * 60 * 1000), 10)
        || (10 * 60 * 1000)
);

/** Skip leading sheet rows when matching mobiles / repeats (row 1 = headers). Set SHEETS_HEADER_SKIP_ROWS=0 if you have no header row. */
const HEADER_SKIP_ROWS_0 = (() => {
    const n = Number.parseInt(process.env.SHEETS_HEADER_SKIP_ROWS ?? "1", 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(20, n)) : 1;
})();

const SPREADSHEET_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * IANA zone for the “Conv.” column (12h display). Omit env or set empty for **server local** time.
 * Default `Asia/Kolkata` matches typical `company.config.js` chat persona clock.
 */
function conversationDateTimeZoneForIntl_() {
    const raw = process.env.SHEETS_CONV_DATETIME_TZ;
    if (raw === undefined || raw === null) {
        return "Asia/Kolkata";
    }
    const t = String(raw).trim();
    return t === "" ? undefined : t;
}

/** @param {Date} d */
function conversationSheetBaseDate_(d) {
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
}

/**
 * Conversation **date only** for Sheets column A (same TZ as combined stamp).
 * @param {Date} [d]
 * @returns {string}
 */
export function formatConversationDateForSheet(d = new Date()) {
    const dt = conversationSheetBaseDate_(d);
    const tz = conversationDateTimeZoneForIntl_();
    try {
        const opts = /** @type {Intl.DateTimeFormatOptions} */ ({
            dateStyle: "medium",
            hour12: true
        });
        if (tz) {
            opts.timeZone = tz;
        }
        return new Intl.DateTimeFormat("en-IN", opts).format(dt);
    } catch {
        try {
            return dt.toLocaleDateString("en-US", { hour12: true });
        } catch {
            return dt.toISOString().slice(0, 10);
        }
    }
}

/**
 * Conversation **time only** for Sheets column B (12-hour clock).
 * @param {Date} [d]
 * @returns {string}
 */
export function formatConversationTimeForSheet(d = new Date()) {
    const dt = conversationSheetBaseDate_(d);
    const tz = conversationDateTimeZoneForIntl_();
    try {
        const opts = /** @type {Intl.DateTimeFormatOptions} */ ({
            timeStyle: "medium",
            hour12: true
        });
        if (tz) {
            opts.timeZone = tz;
        }
        return new Intl.DateTimeFormat("en-IN", opts).format(dt);
    } catch {
        try {
            return dt.toLocaleTimeString("en-US", { hour12: true });
        } catch {
            return dt.toISOString().slice(11, 19);
        }
    }
}

/**
 * Human-readable conversation timestamp for the Sheets **Conv.** column (12-hour clock).
 * @param {Date} [d]
 * @returns {string}
 */
export function formatConversationDateTimeForSheet(d = new Date()) {
    const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
    const tz = conversationDateTimeZoneForIntl_();
    try {
        const opts = /** @type {Intl.DateTimeFormatOptions} */ ({
            dateStyle: "medium",
            timeStyle: "medium",
            hour12: true
        });
        if (tz) {
            opts.timeZone = tz;
        }
        return new Intl.DateTimeFormat("en-IN", opts).format(dt);
    } catch {
        try {
            return dt.toLocaleString("en-US", { hour12: true });
        } catch {
            return dt.toISOString();
        }
    }
}

/**
 * Force append into our schema columns (A–R: Date, Time, then lead fields…).
 *
 * We previously used `A:Z` to avoid truncation when env was set to `A:H`, but `values.append`
 * may choose a "table" anchored later in the sheet and append at an unexpected start column
 * (e.g. `W:AJ`), making the lead look "missing" in A–N.
 *
 * @param {string} raw same as `SHEETS_RANGE` / default
 */
function appendRangeSchemaWidth_(raw) {
    const tab = tabNameFromRange(raw);
    return `${tab}!A:R`;
}

/**
 * Resolve Date + Time strings for Sheets (preferred) or derive from legacy `iso` combined cell.
 *
 * @param {{ iso?: string, convDate?: string, convTime?: string }} row
 */
function conversationPartsFromIncomingRow_(row) {
    const dd = typeof row.convDate === "string" ? row.convDate.trim() : "";
    const tt = typeof row.convTime === "string" ? row.convTime.trim() : "";
    if (dd && tt) {
        return { convDate: dd, convTime: tt };
    }
    const iso = typeof row.iso === "string" ? row.iso.trim() : "";
    if (iso) {
        const parts = iso.split(",").map((s) => s.trim());
        if (parts.length >= 2) {
            return { convDate: parts[0], convTime: parts.slice(1).join(", ") };
        }
        return { convDate: iso, convTime: tt };
    }
    const now = new Date();
    return {
        convDate: formatConversationDateForSheet(now),
        convTime: formatConversationTimeForSheet(now)
    };
}

function tabNameFromRange(raw) {
    const s = (raw || "").trim();
    if (!s) {
        return "Sheet1";
    }
    const bang = s.indexOf("!");
    if (bang === -1) {
        return s;
    }
    return s.slice(0, bang) || "Sheet1";
}

function normalizedHeaderKey_(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function columnLetterFromIndex_(idx0) {
    let n = idx0 + 1; // 1-based
    let out = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

/** @param {string} letters */
function columnLetterToIndex0_(letters) {
    const s = String(letters || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
    if (!s) {
        return 0;
    }
    let n = 0;
    for (let i = 0; i < s.length; i += 1) {
        const code = s.charCodeAt(i);
        if (code < 65 || code > 90) {
            continue;
        }
        n = n * 26 + (code - 64);
    }
    return n - 1;
}

/** @param {string} tab */
function normalizedSheetTabKey_(tab) {
    return String(tab || "")
        .trim()
        .toLowerCase();
}

/**
 * @param {Array<{ range?: string, values?: unknown[][] }>} updates
 * @returns {Set<number>}
 */
function usedColumnIndexesFromUpdates_(updates) {
    const used = new Set();
    if (!Array.isArray(updates)) {
        return used;
    }
    for (const u of updates) {
        const r = u && typeof u.range === "string" ? u.range : "";
        const m = r.match(/!([A-Za-z]+)(\d+)/);
        if (m) {
            used.add(columnLetterToIndex0_(m[1]));
        }
    }
    return used;
}

/** @param {unknown} root */
function getValueAtDotPath_(root, dotPath) {
    const parts = String(dotPath || "")
        .split(".")
        .map((p) => p.trim())
        .filter(Boolean);
    if (!parts.length) {
        return "";
    }
    let cur = root;
    for (const p of parts) {
        if (cur == null || typeof cur !== "object") {
            return "";
        }
        const o = /** @type {Record<string, unknown>} */ (cur);
        if (!Object.prototype.hasOwnProperty.call(o, p)) {
            return "";
        }
        cur = o[p];
    }
    if (cur == null) {
        return "";
    }
    if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") {
        return String(cur);
    }
    return "";
}

/**
 * @param {{ clientContext?: Record<string, unknown> | null, fields?: Record<string, unknown> | null } | null | undefined} sources
 */
function mergeSheetExtrasSources_(sources) {
    const s = sources && typeof sources === "object" ? sources : {};
    let ctx =
        s.clientContext && typeof s.clientContext === "object" && !Array.isArray(s.clientContext)
            ? /** @type {Record<string, unknown>} */ ({ ...s.clientContext })
            : {};
    const fields =
        s.fields && typeof s.fields === "object" && !Array.isArray(s.fields)
            ? /** @type {Record<string, unknown>} */ ({ ...s.fields })
            : {};
    const cn = typeof ctx.coursename === "string" ? ctx.coursename.trim() : "";
    if (cn) {
        const sp =
            ctx.session_params && typeof ctx.session_params === "object" && !Array.isArray(ctx.session_params)
                ? /** @type {Record<string, unknown>} */ ({ ...ctx.session_params })
                : {};
        if (!String(sp.coursename || "").trim()) {
            sp.coursename = cn;
        }
        ctx = { ...ctx, session_params: sp };
    }
    return { ...ctx, fields };
}

/**
 * Resolve `valueFrom` dot path; fall back to last segment at top-level and under `fields` (CX / form quirks).
 *
 * @param {Record<string, unknown>} mergedRoot
 * @param {string} path
 */
function resolveExtraCellScalarFromSources_(mergedRoot, path) {
    const p = String(path || "").trim();
    if (!p) {
        return "";
    }
    let v = getValueAtDotPath_(mergedRoot, p);
    v = sheetOutboundCell_(v);
    if (String(v || "").trim()) {
        return String(v).trim();
    }
    const last = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).trim() : p;
    if (!last) {
        return "";
    }
    v = getValueAtDotPath_(mergedRoot, last);
    v = sheetOutboundCell_(v);
    if (String(v || "").trim()) {
        return String(v).trim();
    }
    v = getValueAtDotPath_(mergedRoot, `fields.${last}`);
    v = sheetOutboundCell_(v);
    if (String(v || "").trim()) {
        return String(v).trim();
    }
    return "";
}

function getActiveSheetExtraMappings_() {
    const raw = (process.env.SHEETS_EXTRA_COLUMN_MAPPINGS_JSON || "").trim();
    if (raw) {
        try {
            const j = JSON.parse(raw);
            if (Array.isArray(j)) {
                return j;
            }
            if (j && typeof j === "object" && Array.isArray(/** @type {{ mappings?: unknown }} */ (j).mappings)) {
                return /** @type {{ mappings: unknown[] }} */ (j).mappings;
            }
        } catch {
            /* fall through */
        }
    }
    const rawIntegration = (process.env.SHEETS_INTEGRATION_CONFIG_JSON || "").trim();
    if (rawIntegration) {
        try {
            const j = JSON.parse(rawIntegration);
            if (Array.isArray(j)) {
                return j;
            }
            if (j && typeof j === "object") {
                const o = /** @type {{ extraColumnMappings?: unknown[] }} */ (j);
                if (Array.isArray(o.extraColumnMappings)) {
                    return o.extraColumnMappings;
                }
            }
        } catch {
            /* fall through */
        }
    }
    return loadSheetExtraMappingsFromDisk_();
}

/**
 * @param {unknown[]} activeMappings
 * @param {string} tab
 */
function sheetExtraMappingsForTab_(activeMappings, tab) {
    const want = normalizedSheetTabKey_(tab);
    /** @type {unknown[]} */
    const out = [];
    for (const block of activeMappings) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const b = /** @type {{ tab?: string, entries?: unknown }} */ (block);
        const bt = typeof b.tab === "string" ? b.tab.trim() : "";
        if (!bt || normalizedSheetTabKey_(bt) === want) {
            out.push(block);
        }
    }
    return out;
}

/** Google Sheets row width (last column ZZZ = index 18277, 0-based). */
const GOOGLE_SHEETS_LAST_COL_INDEX0 = 18277;

/**
 * @param {string} tab
 * @param {number} rowNumber
 * @param {{ clientContext?: Record<string, unknown> | null, fields?: Record<string, unknown> | null } | null | undefined} sources
 * @param {Array<{ range?: string, values?: unknown[][] }>} standardUpdates
 */
function buildConfiguredExtraCellUpdates_(tab, rowNumber, sources, standardUpdates) {
    const active = getActiveSheetExtraMappings_();
    if (!active.length || !rowNumber) {
        return [];
    }
    const used = usedColumnIndexesFromUpdates_(standardUpdates);
    const mergedRoot = mergeSheetExtrasSources_(sources);
    /** @type {Array<{ range: string, values: string[][] }>} */
    const out = [];
    const blocks = sheetExtraMappingsForTab_(active, tab);
    for (const block of blocks) {
        const b = block && typeof block === "object" ? /** @type {{ entries?: unknown }} */ (block) : null;
        const entries = b && Array.isArray(b.entries) ? b.entries : [];
        for (const ent of entries) {
            if (!ent || typeof ent !== "object") {
                continue;
            }
            const e = /** @type {{ startColumn?: string, valueFrom?: string, shiftIfOccupied?: boolean }} */ (ent);
            const colLet = typeof e.startColumn === "string" ? e.startColumn.trim() : "";
            const path = typeof e.valueFrom === "string" ? e.valueFrom.trim() : "";
            if (!colLet || !path) {
                continue;
            }
            const v = resolveExtraCellScalarFromSources_(mergedRoot, path);
            if (!v) {
                continue;
            }
            /** If false, write exactly to startColumn (extras are appended after standard in batchUpdate — same cell may be written twice; later entry wins). */
            const shift = e.shiftIfOccupied !== false;
            let idx0 = columnLetterToIndex0_(colLet);
            if (idx0 < 0) {
                idx0 = 0;
            }
            // Walk right (D, E, F, …) only while shift=true — finds first column index not used by *standard* updates.
            // That often lands on M when C–L are filled (mobile, email, …) and IP is empty — not the same as “column C”.
            while (used.has(idx0) && shift && idx0 < GOOGLE_SHEETS_LAST_COL_INDEX0) {
                idx0 += 1;
            }
            if (shift && used.has(idx0)) {
                console.warn(
                    "[chatbot-api] Sheets extra column: could not place value — every column from",
                    colLet,
                    "through the sheet width is already used by this row batch. Skipping valueFrom=",
                    path
                );
                continue;
            }
            if (!shift && used.has(idx0)) {
                console.warn(
                    "[chatbot-api] Sheets extra: forced startColumn",
                    colLet,
                    "overlaps a standard lead cell in this batch; extra value is still written (later batch entry wins). valueFrom=",
                    path
                );
            }
            const letter = columnLetterFromIndex_(idx0);
            out.push({ range: `${tab}!${letter}${rowNumber}`, values: [[v]] });
            used.add(idx0);
        }
    }
    return out;
}

let headerCache_ = { tab: "", at: 0, mobileColIdx: 3, mobileColLetter: "D" };
const HEADER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Detect mobile column position by header row.
 * Falls back to the default schema (column D) if not found.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getMobileColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (headerCache_.tab === tab && now - headerCache_.at < HEADER_CACHE_TTL_MS) {
        return headerCache_;
    }
    let mobileColIdx = 3;
    let mobileColLetter = "D";
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const want = new Set([
            "mobile",
            "phone",
            "phonenumber",
            "mobile_number",
            "mobilenumber",
            "contact",
            "contactnumber",
            "contactno",
            "whatsapp",
            "whatsappnumber"
        ].map(normalizedHeaderKey_));
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && want.has(k)) {
                mobileColIdx = i;
                mobileColLetter = columnLetterFromIndex_(i);
                break;
            }
        }
    } catch {
        // ignore
    }
    headerCache_ = { tab, at: now, mobileColIdx, mobileColLetter };
    return headerCache_;
}

let repeatedHeaderCache_ = { tab: "", at: 0, repeatedColIdx: 7, repeatedColLetter: "H" };

/**
 * Detect "Repeated" column position by header row.
 * Falls back to the default schema (column H) if not found.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getRepeatedColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (repeatedHeaderCache_.tab === tab && now - repeatedHeaderCache_.at < HEADER_CACHE_TTL_MS) {
        return repeatedHeaderCache_;
    }
    /** Default A–R schema: Repeated User is column H (index 7). */
    let repeatedColIdx = 7;
    let repeatedColLetter = "H";
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        /** Avoid matching generic “Duplicate…” / “Existing…” columns ahead of Repeated User (wrong column patches). */
        const wantPreferred = [
            "repeateduser",
            "repeatusern",
            "repuser",
            "isrepeated",
            "repeatedcustomer",
            "returningcustomer"
        ].map(normalizedHeaderKey_);
        const preferredSet = new Set(wantPreferred.filter(Boolean));
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && preferredSet.has(k)) {
                repeatedColIdx = i;
                repeatedColLetter = columnLetterFromIndex_(i);
                break;
            }
        }
        if (repeatedColIdx === 7) {
            for (let i = 0; i < header.length; i += 1) {
                const k = normalizedHeaderKey_(sheetCellString_(header[i]));
                if (k.includes("repeat") && k.includes("user")) {
                    repeatedColIdx = i;
                    repeatedColLetter = columnLetterFromIndex_(i);
                    break;
                }
            }
        }
    } catch {
        // ignore
    }
    repeatedHeaderCache_ = { tab, at: now, repeatedColIdx, repeatedColLetter };
    return repeatedHeaderCache_;
}

let userQueriesHeaderCache_ = { tab: "", at: 0, colIdx: 6, colLetter: "G" };

/**
 * Column for merged live-chat `user_queries` CSV — default column G (A–R lead layout).
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getUserQueriesColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (userQueriesHeaderCache_.tab === tab && now - userQueriesHeaderCache_.at < HEADER_CACHE_TTL_MS) {
        return userQueriesHeaderCache_;
    }
    let colIdx = 6;
    let colLetter = "G";
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const want = new Set(
            [
                "userqueries",
                "user_queries",
                "queries",
                "chatqueries",
                "conversationqueries",
                "visitorqueries",
                "userquery",
                "chathistory",
                "dialogflowqueries"
            ].map(normalizedHeaderKey_)
        );
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && want.has(k)) {
                colIdx = i;
                colLetter = columnLetterFromIndex_(i);
                break;
            }
        }
    } catch {
        // ignore
    }
    userQueriesHeaderCache_ = { tab, at: now, colIdx, colLetter };
    return userQueriesHeaderCache_;
}

/** @param {string} s */
function mobileDigitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
}

/**
 * Normalize a phone-like cell to a comparable key.
 * - Extract digits (handles "+91 98..." etc.)
 * - If it's longer than 10 digits, compare by the last 10 digits (India-centric; avoids country code mismatch)
 * - Attempt to expand scientific notation strings (e.g. "9.19876E+11") to digits when safe
 *
 * @param {unknown} rawCell
 */
function mobileKeyFromCell_(rawCell) {
    const s0 = sheetCellString_(rawCell);
    if (!s0) {
        return "";
    }
    let s = s0;
    // Sheets sometimes stores long numbers in scientific notation (string or number).
    if (/[eE][+-]?\d+/.test(s)) {
        const n = Number(s);
        // Avoid tiny/invalid parses; 9 digits minimum to resemble a phone.
        if (Number.isFinite(n) && n >= 1e8 && n <= 1e15) {
            // toFixed(0) expands without decimals; may still be rounded if the sheet already lost precision.
            s = n.toFixed(0);
        }
    }
    let digits = mobileDigitsOnly(s);
    if (!digits) {
        return "";
    }
    // Prefer comparing by last 10 digits to ignore country codes / prefixes.
    if (digits.length > 10) {
        digits = digits.slice(-10);
    }
    return digits;
}

/** Best-effort mobile key from a whole sheet row (handles column reorders). @param {unknown[]} r @param {number} mobileColIdx */
function mobileKeyFromRow_(r, mobileColIdx) {
    if (!Array.isArray(r) || !r.length) {
        return "";
    }
    const idx = typeof mobileColIdx === "number" && Number.isFinite(mobileColIdx)
        ? mobileColIdx
        : 3;
    // Prefer detected mobile column first.
    const primary = mobileKeyFromCell_(r[idx]);
    if (primary) {
        return primary;
    }
    // Fallback: scan all cells for any phone-like value.
    let best = "";
    for (let i = 0; i < r.length; i += 1) {
        const k = mobileKeyFromCell_(r[i]);
        if (k.length > best.length) {
            best = k;
        }
        if (best.length === 10) {
            // Can't do better than a full 10-digit key.
            return best;
        }
    }
    return best;
}

/** Values API often returns numbers (e.g. phone) instead of strings — normalize for compares + blank checks. */
function sheetCellString_(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    if (typeof v === "boolean") {
        return v ? "true" : "false";
    }
    return "";
}

/** @param {unknown} rawCell sheet cell value before coercion */
function isBlankSheetCell_(rawCell) {
    return !sheetCellString_(rawCell);
}

/** Coerce outbound row cells to plain strings — API payloads must not contain `undefined` (can break inserts). */
function sheetOutboundCell_(v) {
    if (v == null) {
        return "";
    }
    if (typeof v === "string") {
        return v.trim();
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
    }
    if (typeof v === "boolean") {
        return v ? "true" : "false";
    }
    return String(v);
}

/** @param {import("googleapis").gaxios.GaxiosResponse<import("googleapis").sheets_v4.Schema$BatchUpdateValuesResponse> | null | undefined} batchRes */
function googleBatchSummaryFromResponse_(batchRes) {
    const br = batchRes && batchRes.data ? batchRes.data : {};
    const updatedRanges = Array.isArray(br.responses)
        ? br.responses.map((r) => (r && typeof r.updatedRange === "string" ? r.updatedRange : "")).filter(Boolean)
        : [];
    return {
        totalUpdatedCells:
            typeof br.totalUpdatedCells === "number"
                ? br.totalUpdatedCells
                : undefined,
        totalUpdatedRows:
            typeof br.totalUpdatedRows === "number"
                ? br.totalUpdatedRows
                : undefined,
        updatedRanges
    };
}

/**
 * Dedupe strategy:
 * - Primary key: clientSessionId when session id exists (only one Sheet row per session)
 * - Used for "Repeated" flag: mobile digits across different sessions
 *
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 */
function buildDedupeKey(row) {
    const sid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    return sid || "";
}

/**
 * Rows from `values.get` are indexed 0 = sheet row 1.
 *
 * @param {unknown[]} rows
 * @param {string} incomingDigits
 * @param {number} mobileColIdx
 * @param {number} excludeSheetRow1Based skip this sheet row when counting (session-dedupe update target row)
 */
function countOtherRowsWithSameMobile_(rows, incomingDigits, mobileColIdx, excludeSheetRow1Based) {
    if (!incomingDigits || !rows.length) {
        return 0;
    }
    let n = 0;
    for (let i = HEADER_SKIP_ROWS_0; i < rows.length; i += 1) {
        const sheetRow = i + 1;
        if (excludeSheetRow1Based && sheetRow === excludeSheetRow1Based) {
            continue;
        }
        const r = rows[i] || [];
        /** @type {unknown[]} */
        const ra = Array.isArray(r) ? r : [];
        let k = mobileKeyFromRow_(ra, mobileColIdx);
        if (!k && ra.length > 3) {
            k = mobileKeyFromCell_(ra[3]);
        }
        if (!k && ra.length > 2) {
            k = mobileKeyFromCell_(ra[2]);
        }
        if (k && k === incomingDigits) {
            n += 1;
        }
    }
    return n;
}

/**
 * @param {unknown[][]} colRows cells from `${Col}:${Col}` get
 */
function countColumnMatchesExcludingRow_(colRows, incomingDigits, excludeSheetRow1Based) {
    if (!incomingDigits || !colRows.length) {
        return 0;
    }
    let n = 0;
    for (let i = HEADER_SKIP_ROWS_0; i < colRows.length; i += 1) {
        const sheetRow = i + 1;
        if (excludeSheetRow1Based && sheetRow === excludeSheetRow1Based) {
            continue;
        }
        const cell = colRows[i] && colRows[i][0] !== undefined ? colRows[i][0] : "";
        const k = mobileKeyFromCell_(cell);
        if (k && k === incomingDigits) {
            n += 1;
        }
    }
    return n;
}

/**
 * Scan recent sheet rows for:
 * - duplicate for the same session id (only one row per session id)
 * - repeated: same mobile exists on **another** sheet row (exclude current row when updating by session dedupe)
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {{ iso: string, mobile: string, clientSessionId: string }} row
 * @returns {Promise<{ duplicate: boolean, matchedRowNumber: number, repeatedAcrossSessions: boolean }>}
 */
async function scanSheetTailForDedupeAndRepeat_(sheets, row) {
    const key = buildDedupeKey(row);
    const tab = tabNameFromRange(RANGE);
    const mobileCol = await getMobileColumnInfo_(sheets, tab);
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        // Use a wide range so dedupe works even if your sheet has more columns than expected
        // or the session id column was moved.
        range: `${tab}!A:Z`
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    if (!rows.length) {
        return { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions: false };
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const tailOffset = rows.length - tail.length; // 0-based offset into full sheet rows
    const incomingSid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    let incomingMobileDigits = mobileKeyFromCell_(row.mobile);
    if (!incomingMobileDigits && row && typeof row === "object") {
        const ro = /** @type {Record<string, unknown>} */ (row);
        incomingMobileDigits =
            mobileKeyFromCell_(ro.phone)
            || mobileKeyFromCell_(ro.tel)
            || mobileKeyFromCell_(ro.contact_mobile);
    }

    let duplicateRowNum = 0;

    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingSid =
            sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_NEW])
            || sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_LEGACY]);
        const rowNumber = tailOffset + i + 1; // 1-based row number in the sheet

        // If we have a session id, enforce "only once per session".
        if (key && incomingSid && existingSid && existingSid === incomingSid) {
            duplicateRowNum = rowNumber;
            break;
        }
        // Some sheets have different column ordering; scan the whole row for the session id string.
        if (key && incomingSid && Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = sheetCellString_(r[c]);
                if (cell && cell === incomingSid) {
                    duplicateRowNum = rowNumber;
                    break;
                }
            }
            if (duplicateRowNum) {
                break;
            }
        }
    }

    const excludeForRepeat = duplicateRowNum || 0;
    let otherMatches = 0;
    if (incomingMobileDigits) {
        otherMatches = countOtherRowsWithSameMobile_(
            /** @type {unknown[][]} */ (rows),
            incomingMobileDigits,
            mobileCol.mobileColIdx,
            excludeForRepeat
        );
    }
    if (incomingMobileDigits && otherMatches === 0) {
        try {
            const col = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${tab}!${mobileCol.mobileColLetter}:${mobileCol.mobileColLetter}`
            });
            const colRows = Array.isArray(col.data.values) ? col.data.values : [];
            otherMatches = countColumnMatchesExcludingRow_(
                /** @type {unknown[][]} */ (colRows),
                incomingMobileDigits,
                excludeForRepeat
            );
        } catch {
            /* ignore */
        }
    }
    const repeatedAcrossSessions = otherMatches >= 1;

    if (duplicateRowNum) {
        return { duplicate: true, matchedRowNumber: duplicateRowNum, repeatedAcrossSessions };
    }
    return { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions };
}

function normalizedUserQueryNoiseKey_(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/** Short chat / intent tokens that shouldn’t occupy the User Queries column (e.g. “upload” alone). */
const USER_QUERY_NOISE_KEYS = new Set(
    [
        "upload",
        "uploading",
        "uploader",
        "uploaddocument",
        "documents",
        "document",
        "docs",
        "doc",
        "file",
        "files",
        "attachment",
        "attachments",
        "pdf",
        "yes",
        "no",
        "y",
        "n",
        "ok",
        "okay",
        "yeah",
        "sure",
        "hi",
        "hello",
        "hey",
        "thanks",
        "thankyou",
        "bye",
        "stop"
    ].map(normalizedUserQueryNoiseKey_)
);

/** @param {string} csv */
export function sanitizeUserQueriesCsvForSheet(csv) {
    const s = typeof csv === "string" ? csv.trim() : "";
    if (!s) {
        return "";
    }
    const kept = [];
    for (const p of splitCsvValues_(csv)) {
        const t = String(p || "").trim();
        if (!t) {
            continue;
        }
        const nk = normalizedUserQueryNoiseKey_(t);
        if (nk && USER_QUERY_NOISE_KEYS.has(nk)) {
            continue;
        }
        kept.push(t);
    }
    return kept.join(", ");
}

function splitCsvValues_(raw) {
    const s = typeof raw === "string" ? raw : "";
    if (!s.trim()) {
        return [];
    }
    return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
}

function mergeCsvUnique_(existingCsv, incomingCsv, limit = 40) {
    const existing = splitCsvValues_(existingCsv);
    const incoming = splitCsvValues_(incomingCsv);
    if (!incoming.length) {
        return existing.join(", ");
    }
    const seen = new Set();
    const out = [];
    // Preserve order: existing first, then add new ones.
    for (const v of existing) {
        const k = v.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push(v);
        }
    }
    for (const v of incoming) {
        const k = v.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push(v);
        }
    }
    return out.slice(0, Math.max(1, limit)).join(", ");
}

/**
 * If we already have a row for this session id (from chat mobile sync), fill in missing fields
 * from the later contact-form submit rather than dropping the write.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber 1-based sheet row
 * @param {{ name: string, mobile: string, email: string, browserName: string, deviceType: string, channel: string, repeated?: string, fileLinks?: string, city?: string, ip?: string, sourceUrl?: string, appointmentBooked?: string, appointmentDate?: string, appointmentTime?: string, userQueriesCsv?: string }} incoming
 * @param {{ preferIncomingContact?: boolean }} [options] when true (contact-form POST), B–D use incoming whenever non-empty; chat/sync fills blanks only.
 */
/** @returns {Promise<{ applied: boolean, googleBatch?: { totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } }>} */
async function updateExistingSessionRow_(sheets, tab, rowNumber, incoming, options = {}) {
    if (!rowNumber || rowNumber < 1) {
        return { applied: false };
    }
    const preferIncomingContact = !!(options && options.preferIncomingContact);
    const repeatedCol = await getRepeatedColumnInfo_(sheets, tab);
    const queriesCol = await getUserQueriesColumnInfo_(sheets, tab);
    const got = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${rowNumber}:R${rowNumber}`
    });
    const row = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
    const colL = columnLetterFromIndex_;

    /** C–E: contact-form submits should overwrite an older chat-sync row when values are present. */
    const contactPatchFor = (v, colIdx) => {
        const s = typeof v === "string" ? v.trim() : "";
        if (!s) {
            return "";
        }
        if (preferIncomingContact) {
            return s;
        }
        return isBlankSheetCell_(row[colIdx]) ? s : "";
    };

    /** Fills blanks unless preferIncomingContact. @param {string} raw @param {number} idx */
    const patchScalarInto = (raw, idx) => {
        const s = typeof raw === "string" ? raw.trim() : "";
        if (!s) {
            return "";
        }
        if (preferIncomingContact) {
            return s;
        }
        return isBlankSheetCell_(row[idx]) ? s : "";
    };

    const name = contactPatchFor(typeof incoming.name === "string" ? incoming.name : "", 2);
    const mobile = contactPatchFor(typeof incoming.mobile === "string" ? incoming.mobile : "", 3);
    const email = contactPatchFor(typeof incoming.email === "string" ? incoming.email : "", 4);
    const channel = patchScalarInto(typeof incoming.channel === "string" ? incoming.channel : "", 5);
    const deviceType =
        patchScalarInto(typeof incoming.deviceType === "string" ? incoming.deviceType : "", 10);
    const browserName =
        patchScalarInto(typeof incoming.browserName === "string" ? incoming.browserName : "", 11);
    const city = patchScalarInto(typeof incoming.city === "string" ? incoming.city : "", 12);
    const ip = patchScalarInto(typeof incoming.ip === "string" ? incoming.ip : "", 13);

    const repeatedIncoming = typeof incoming.repeated === "string" ? incoming.repeated.trim() : "";
    const existingRepeatedRaw = sheetCellString_(row[repeatedCol.repeatedColIdx]);
    let repeated = "";
    let repeatedNorm = "";
    if (/^yes$/i.test(repeatedIncoming)) {
        repeatedNorm = "Yes";
    } else if (/^no$/i.test(repeatedIncoming)) {
        repeatedNorm = "No";
    }
    if (repeatedNorm) {
        const ex = existingRepeatedRaw.trim();
        const exIsYes = /^yes$/i.test(ex);
        const exIsNo = /^no$/i.test(ex);
        const needPatch =
            preferIncomingContact
            || (repeatedNorm === "Yes" ? !exIsYes : repeatedNorm === "No" ? !exIsNo : false);
        if (needPatch) {
            repeated = repeatedNorm;
        }
    }

    const sourceUrl = patchScalarInto(
        typeof incoming.sourceUrl === "string" ? incoming.sourceUrl : "",
        8
    );
    const appointmentBooked = patchScalarInto(
        typeof incoming.appointmentBooked === "string" ? incoming.appointmentBooked : "",
        14
    );
    const appointmentDate = patchScalarInto(
        typeof incoming.appointmentDate === "string" ? incoming.appointmentDate : "",
        15
    );
    const appointmentTime = patchScalarInto(
        typeof incoming.appointmentTime === "string" ? incoming.appointmentTime : "",
        16
    );
    const fileLinks = patchScalarInto(
        typeof incoming.fileLinks === "string" ? incoming.fileLinks : "",
        17
    );

    const existingQueries = sheetCellString_(row[queriesCol.colIdx]);
    const mergedQueries = mergeCsvUnique_(existingQueries, incoming.userQueriesCsv || "", 200);
    const userQueriesCsv = mergedQueries && mergedQueries !== existingQueries ? mergedQueries : "";

    /** @type {Array<{ range: string, values: string[][] }>} */
    const data = [];
    if (name) data.push({ range: `${tab}!${colL(2)}${rowNumber}`, values: [[name]] });
    if (mobile) data.push({ range: `${tab}!${colL(3)}${rowNumber}`, values: [[mobile]] });
    if (email) data.push({ range: `${tab}!${colL(4)}${rowNumber}`, values: [[email]] });
    if (channel) data.push({ range: `${tab}!${colL(5)}${rowNumber}`, values: [[channel]] });
    if (repeated) data.push({ range: `${tab}!${repeatedCol.repeatedColLetter}${rowNumber}`, values: [[repeated]] });
    if (sourceUrl) data.push({ range: `${tab}!${colL(8)}${rowNumber}`, values: [[sourceUrl]] });
    if (deviceType) data.push({ range: `${tab}!${colL(10)}${rowNumber}`, values: [[deviceType]] });
    if (browserName) data.push({ range: `${tab}!${colL(11)}${rowNumber}`, values: [[browserName]] });
    if (city) data.push({ range: `${tab}!${colL(12)}${rowNumber}`, values: [[city]] });
    if (ip) data.push({ range: `${tab}!${colL(13)}${rowNumber}`, values: [[ip]] });
    if (appointmentBooked) data.push({ range: `${tab}!${colL(14)}${rowNumber}`, values: [[appointmentBooked]] });
    if (appointmentDate) data.push({ range: `${tab}!${colL(15)}${rowNumber}`, values: [[appointmentDate]] });
    if (appointmentTime) data.push({ range: `${tab}!${colL(16)}${rowNumber}`, values: [[appointmentTime]] });
    if (fileLinks) data.push({ range: `${tab}!${colL(17)}${rowNumber}`, values: [[fileLinks]] });
    if (userQueriesCsv) {
        data.push({ range: `${tab}!${queriesCol.colLetter}${rowNumber}`, values: [[userQueriesCsv]] });
    }

    if (!data.length) {
        if (preferIncomingContact) {
            console.warn(
                "[chatbot-api] Sheets duplicate-session row update applied no patches (incoming contact/query fields empty or unchanged)."
            );
        }
        return { applied: false };
    }
    const batchRes = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data
        }
    });
    return {
        applied: true,
        googleBatch: googleBatchSummaryFromResponse_(batchRes)
    };
}

async function getSheetsAuthClient() {
    const key = getServiceAccountCredentials();
    if (!key) {
        throw new Error(
            [
                "No Google service account JSON for Sheets.",
                "In Railway, set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_CONFIG) to the full JSON from",
                "Firebase Console → Project settings → Service accounts → Generate new private key.",
                "Same value as for Firestore; do not rely on default credentials on Railway."
            ].join(" ")
        );
    }
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: SPREADSHEET_SCOPES
    });
    return auth.getClient();
}

let sheetSchemaCache_ = { tab: "", at: 0, byKey: /** @type {Record<string, number>} */ ({}) };

async function getHeaderIndexMap_(sheets, tab) {
    const now = Date.now();
    if (sheetSchemaCache_.tab === tab && now - sheetSchemaCache_.at < HEADER_CACHE_TTL_MS) {
        return sheetSchemaCache_.byKey;
    }
    /** @type {Record<string, number>} */
    const byKey = {};
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && byKey[k] === undefined) {
                byKey[k] = i;
            }
        }
    } catch {
        // ignore
    }
    sheetSchemaCache_ = { tab, at: now, byKey };
    return byKey;
}

function pickHeaderIndex_(map, aliases, fallbackIdx) {
    for (let i = 0; i < aliases.length; i += 1) {
        const k = normalizedHeaderKey_(aliases[i]);
        if (k && map[k] !== undefined) {
            return map[k];
        }
    }
    return fallbackIdx;
}

/** Aliases for header row matching when column order differs from legacy A–R (e.g. extra "Course" column). */
const SHEET_H_NAME = [
    "name",
    "fullname",
    "full_name",
    "customername",
    "customer_name",
    "personname",
    "person_name",
    "username",
    "guestname",
    "displayname",
    "contactname",
    "contact_name",
    "yourname",
    "clientname",
    "firstlastname",
    "lastfirstname",
    "first_name",
    "lastname",
    "last_name",
    "fname",
    "lname"
];
const SHEET_H_MOBILE = [
    "mobile",
    "phone",
    "phonenumber",
    "mobilenumber",
    "mobile_number",
    "tel",
    "cell",
    "cellphone",
    "contactnumber",
    "contactphone",
    "whatsapp",
    "whatsappnumber",
    "yourmobile",
    "usermobile",
    "customermobile",
    "mobile_no",
    "mobileno",
    "phone_no",
    "phoneno",
    "cell_number"
];
const SHEET_H_EMAIL = [
    "email",
    "mail",
    "e_mail",
    "email_address",
    "emailaddress",
    "useremail",
    "contactemail",
    "contact_email",
    "email_id",
    "e_mail_address",
    "mail_id"
];
const SHEET_H_SESSION = [
    "sessionid",
    "session",
    "session_id",
    "sessioniid",
    "sessioni",
    "clientsessionid",
    "client_session_id",
    "clientsession",
    "conversationid",
    "conversation_id",
    "chatsessionid",
    "sessioni_id",
    "session_id_client"
];

function rowNumberFromUpdatedRange_(updatedRange) {
    const s = typeof updatedRange === "string" ? updatedRange : "";
    const m = s.match(/!([A-Z]+)(\d+)(?::[A-Z]+(\d+))?$/);
    const rowNumber = m && m[2] ? Number.parseInt(m[2], 10) : 0;
    return Number.isFinite(rowNumber) ? rowNumber : 0;
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber
 * @param {*} lead same shape as writeLeadRowByHeader_
 * @returns {Promise<Array<{ range: string, values: string[][] }>>}
 */
async function buildStandardLeadRowUpdates_(sheets, tab, rowNumber, lead) {
    if (!rowNumber) {
        return [];
    }
    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const getIdx = (aliases, fallbackIdx) => pickHeaderIndex_(headerMap, aliases, fallbackIdx);

    const col = (idx0) => columnLetterFromIndex_(idx0);

    /** @type {Array<{ range: string, values: string[][] }>} */
    const updates = [];
    const put = (aliases, fallbackIdx, value) => {
        const v = sheetOutboundCell_(value);
        if (!String(v || "").trim()) {
            return;
        }
        const idx0 = getIdx(aliases, fallbackIdx);
        updates.push({ range: `${tab}!${col(idx0)}${rowNumber}`, values: [[v]] });
    };

    // Prefer declared A–R schema (Date, Time, then lead fields…); aliases correct column when order differs.
    put(
        [
            "conversationdate",
            "convdate",
            "convdateonly",
            "conversiondate",
            "date"
        ],
        0,
        lead.convDate
    );
    put(
        [
            "conversationtime",
            "convtime",
            "convtimeonly",
            "conversiontime",
            "time"
        ],
        1,
        lead.convTime
    );
    put(SHEET_H_NAME, 2, lead.name);
    put(SHEET_H_MOBILE, 3, lead.mobile);
    put(SHEET_H_EMAIL, 4, lead.email);
    put(["channel"], 5, lead.channel);
    put(
        [
            "userqueries",
            "user_queries",
            "queries",
            "chatqueries",
            "userquery",
            "visitorqueries",
            "conversationqueries"
        ],
        6,
        lead.userQueriesCsv
    );
    put(["repeateduser", "repeated_user", "isrepeated", "repuser"], 7, lead.repeated);
    put(["sourceurl", "source_url", "pageurl", "embedurl"], 8, lead.sourceUrl);
    put(SHEET_H_SESSION, 9, lead.clientSessionId);
    put(["device", "devicetype"], 10, lead.deviceType);
    put(["browser", "browsername"], 11, lead.browserName);
    put(
        ["city", "visitorcity", "usercity", "cityname", "location", "preferredcity"],
        12,
        lead.city
    );
    put(["ip", "ipaddress", "ip_address"], 13, lead.ip);
    // Prefer exact "Appointment Booked" match only — aliases like `appointment` would hit Date/Time headers.
    put(["appointmentbooked", "appointment_booked", "isappointmentbooked"], 14, lead.appointmentBooked);
    put(["appointmentdate"], 15, lead.appointmentDate);
    put(["appointmenttime"], 16, lead.appointmentTime);
    put(["drivefilelink", "drive file link", "drivefile", "filelink", "filelinks", "drivelink"], 17, lead.driveFileLink);

    return updates;
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber
 * @param {*} lead
 * @param {{ clientContext?: Record<string, unknown> | null, fields?: Record<string, unknown> | null } | null | undefined} [sheetExtrasSources]
 */
async function writeLeadRowByHeader_(sheets, tab, rowNumber, lead, sheetExtrasSources) {
    const standard = await buildStandardLeadRowUpdates_(sheets, tab, rowNumber, lead);
    const extras = buildConfiguredExtraCellUpdates_(tab, rowNumber, sheetExtrasSources, standard);
    const updates = [...standard, ...extras];
    if (!updates.length) {
        return;
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates
        }
    });
}

/**
 * Same optional columns as `writeLeadRowByHeader_`, for rows that already exist (chat mobile sync → form submit).
 * Without this, `session_params.*` extras never appeared because duplicate-session updates skipped the header/extras batch.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber
 * @param {*} row
 * @param {{ clientContext?: Record<string, unknown> | null, fields?: Record<string, unknown> | null } | null | undefined} sheetExtrasSources
 * @param {{ repeatedAcrossSessions?: boolean }} scanFull
 */
async function applySheetExtrasAfterDuplicateSessionRow_(sheets, tab, rowNumber, row, sheetExtrasSources, scanFull) {
    if (!rowNumber || !sheetExtrasSources) {
        return { applied: false };
    }
    const ch = typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : "web";
    const userQueriesCsv = sanitizeUserQueriesCsvForSheet(
        typeof row.userQueriesCsv === "string" ? row.userQueriesCsv : ""
    );
    const city = typeof row.city === "string" ? row.city.trim() : "";
    const ip = typeof row.ip === "string" ? row.ip.trim() : "";
    const sourceUrl = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const appointmentBooked = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
    const repeated = scanFull && scanFull.repeatedAcrossSessions ? "Yes" : "No";

    const parts = conversationPartsFromIncomingRow_(row);

    const lead = {
        convDate: parts.convDate,
        convTime: parts.convTime,
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        clientSessionId: row.clientSessionId,
        deviceType: typeof row.deviceType === "string" ? row.deviceType.trim() : "",
        browserName: row.browserName,
        channel: ch,
        userQueriesCsv,
        city,
        ip,
        repeated,
        sourceUrl,
        appointmentBooked,
        appointmentDate,
        appointmentTime,
        driveFileLink: fileLinks
    };

    try {
        const standard = await buildStandardLeadRowUpdates_(sheets, tab, rowNumber, lead);
        const extras = buildConfiguredExtraCellUpdates_(tab, rowNumber, sheetExtrasSources, standard);
        if (!extras.length) {
            return { applied: false };
        }
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: "USER_ENTERED",
                data: extras
            }
        });
        return { applied: true };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        console.error("[chatbot-api] Sheet extras after duplicate-row update:", msg);
        return { applied: false };
    }
}

/**
 * Default columns A–R (no Form ID):
 * Date, Time, Name, Mobile, Email, Channel, User Queries, Repeated User, Source URL, Session id,
 * Device, Browser, City, IP, Appointment booked/date/time, Drive link.
 *
 * @param {{ convDate?: string, convTime?: string, iso?: string, formId?: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, sourceUrl?: string, appointmentBooked?: string, appointmentDate?: string, appointmentTime?: string, userQueriesCsv?: string }} row Preferred: `convDate` + `convTime`; legacy combined `iso` is split when needed. `formId` ignored for Sheets.
 * @param {{ preferIncomingContact?: boolean, skipSessionDedup?: boolean, sheetExtrasSources?: { clientContext?: Record<string, unknown> | null, fields?: Record<string, unknown> | null } }} [opts] `skipSessionDedup` (with `preferIncomingContact`) skips “one row per session” and always appends — default for main contact-form POST. `sheetExtrasSources` uses dot paths from `sheet-integration.config.json`.
 * @returns {Promise<{ action: "appended"|"duplicate_updated"|"duplicate_noop", patched: boolean, tab: string, appendRangeUsed?: string, sheetRowNumber?: number, googleAppend?: { updatedRange?: string, updatedRows?: number, spreadsheetId?: string }, googleBatch?: { totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } }>}
 */
export async function appendContactRowToSheet(row, opts) {
    const tabResolved = tabNameFromRange(RANGE);
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const sheetExtrasSources =
        opts && opts.sheetExtrasSources && typeof opts.sheetExtrasSources === "object"
            ? opts.sheetExtrasSources
            : null;

    const preferIncoming = !!(opts && opts.preferIncomingContact);
    const skipSessionDedup =
        !!(opts && opts.skipSessionDedup)
        && preferIncoming
        && typeof row.clientSessionId === "string"
        && row.clientSessionId.trim();

    // Prevent double-write when chat mobile sync and form submission both hit Sheets,
    // but *update* the existing session row when the contact-form later provides name/email.
    const scanFull = await scanSheetTailForDedupeAndRepeat_(sheets, row);
    const scan = skipSessionDedup
        ? { duplicate: false, matchedRowNumber: 0, repeatedAcrossSessions: scanFull.repeatedAcrossSessions }
        : scanFull;
    const tab = tabNameFromRange(RANGE);
    const appendRangeUsed = appendRangeSchemaWidth_(RANGE);
    if (scan.duplicate) {
        const repeated = scanFull.repeatedAcrossSessions ? "Yes" : "No";
        const up = await updateExistingSessionRow_(
            sheets,
            tab,
            scan.matchedRowNumber,
            { ...row, repeated },
            { preferIncomingContact: !!(opts && opts.preferIncomingContact) }
        );
        /** @type {{ applied: boolean }} */
        let extrasUp = { applied: false };
        try {
            extrasUp = await applySheetExtrasAfterDuplicateSessionRow_(
                sheets,
                tab,
                scan.matchedRowNumber,
                row,
                sheetExtrasSources,
                scanFull
            );
        } catch (ee) {
            const m = ee && /** @type {{ message?: string }} */ (ee).message
                ? String(/** @type {{ message?: string }} */ (ee).message)
                : String(ee);
            console.error("[chatbot-api] Sheet extras duplicate path:", m);
        }
        const patched = !!(up && up.applied) || !!(extrasUp && extrasUp.applied);
        const prefer = !!(opts && opts.preferIncomingContact);
        if (prefer && !patched) {
            console.warn(
                "[chatbot-api] Contact form Sheets write: duplicate session row matched but batchUpdate skipped (nothing changed). ",
                `tab="${tabResolved}" row=${scan.matchedRowNumber} spreadsheet tail …${String(SPREADSHEET_ID).slice(-8)}.`,
                'Confirm SHEETS_RANGE tab matches your open sheet; ensure POST includes name/mobile/email in body or client_context.'
            );
        }
        return {
            action: patched ? "duplicate_updated" : "duplicate_noop",
            patched,
            tab: tabResolved,
            appendRangeUsed,
            sheetRowNumber: scan.matchedRowNumber,
            googleBatch: up.googleBatch
        };
    }

    const ch = typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : "web";
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
    const city = typeof row.city === "string" ? row.city.trim() : "";
    const ip = typeof row.ip === "string" ? row.ip.trim() : "";
    const sourceUrl = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const appointmentBooked = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const userQueriesCsv = sanitizeUserQueriesCsvForSheet(
        typeof row.userQueriesCsv === "string" ? row.userQueriesCsv : ""
    );
    const repeated = scanFull.repeatedAcrossSessions ? "Yes" : "No";
    const convParts = conversationPartsFromIncomingRow_(row);
    // Append A–R directly (Date, Time, then lead fields …).
    const values = [[
        sheetOutboundCell_(convParts.convDate),
        sheetOutboundCell_(convParts.convTime),
        sheetOutboundCell_(row.name),
        sheetOutboundCell_(row.mobile),
        sheetOutboundCell_(row.email),
        sheetOutboundCell_(ch),
        sheetOutboundCell_(userQueriesCsv),
        sheetOutboundCell_(repeated),
        sheetOutboundCell_(sourceUrl),
        sheetOutboundCell_(row.clientSessionId),
        sheetOutboundCell_(row.deviceType),
        sheetOutboundCell_(row.browserName),
        sheetOutboundCell_(city),
        sheetOutboundCell_(ip),
        sheetOutboundCell_(appointmentBooked),
        sheetOutboundCell_(appointmentDate),
        sheetOutboundCell_(appointmentTime),
        sheetOutboundCell_(fileLinks)
    ]];
    const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: appendRangeUsed,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values }
    });
    const up = appendRes && appendRes.data && appendRes.data.updates ? appendRes.data.updates : {};
    /** @type {{ updatedRange?: string, updatedRows?: number, spreadsheetId?: string }} */
    const googleAppend = {};
    if (typeof up.updatedRange === "string") {
        googleAppend.updatedRange = up.updatedRange;
    }
    if (typeof up.updatedRows === "number") {
        googleAppend.updatedRows = up.updatedRows;
    }
    if (typeof up.spreadsheetId === "string") {
        googleAppend.spreadsheetId = up.spreadsheetId;
    }
    if (!googleAppend.updatedRange) {
        console.warn(
            "[chatbot-api] Sheets append succeeded but updates.updatedRange missing; check SHEETS_RANGE tab and spreadsheet id.",
            `tab="${tabResolved}"`,
            appendRangeUsed
        );
    }

    try {
        const rowNumber = rowNumberFromUpdatedRange_(googleAppend.updatedRange);
        if (rowNumber) {
            await writeLeadRowByHeader_(sheets, tabResolved, rowNumber, {
                convDate: convParts.convDate,
                convTime: convParts.convTime,
                name: row.name,
                mobile: row.mobile,
                email: row.email,
                clientSessionId: row.clientSessionId,
                deviceType: typeof row.deviceType === "string" ? row.deviceType.trim() : "",
                browserName: row.browserName,
                channel: ch,
                userQueriesCsv,
                city,
                ip,
                repeated,
                sourceUrl,
                appointmentBooked,
                appointmentDate,
                appointmentTime,
                driveFileLink: fileLinks
            },
                sheetExtrasSources);
        }
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[chatbot-api] Sheets header-mapped patch failed; row still appended.", msg);
    }
    return {
        action: "appended",
        patched: true,
        tab: tabResolved,
        appendRangeUsed,
        googleAppend: Object.keys(googleAppend).length ? googleAppend : undefined
    };
}

/**
 * Find 1-based row number whose Session id column matches (default column J in A–R layout, legacy column I), or any cell.
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {string} sessionId
 */
async function findSessionRowNumberBySessionId_(sheets, tab, sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid) {
        return 0;
    }
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A:Z`
    });
    const rows = Array.isArray(res.data.values) ? res.data.values : [];
    if (!rows.length) {
        return 0;
    }
    const tail = rows.slice(Math.max(0, rows.length - DEDUP_LOOKBACK_ROWS));
    const tailOffset = rows.length - tail.length;
    for (let i = tail.length - 1; i >= 0; i--) {
        const r = tail[i] || [];
        const existingSid =
            sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_NEW])
            || sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_LEGACY]);
        if (existingSid === sid) {
            return tailOffset + i + 1;
        }
        if (Array.isArray(r)) {
            for (let c = 0; c < r.length; c++) {
                const cell = sheetCellString_(r[c]);
                if (cell && cell === sid) {
                    return tailOffset + i + 1;
                }
            }
        }
    }
    return 0;
}

/**
 * Merge latest user_queries into the User Queries column for this session, or append a minimal row if none exists.
 * Used for live chat query sync without requiring another form POST.
 *
 * @param {{ iso?: string, convDate?: string, convTime?: string, formId?: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string }} row
 */
export async function upsertSessionQueriesInSheet(row) {
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const incomingQRaw = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
    const incomingQ = sanitizeUserQueriesCsvForSheet(incomingQRaw);
    if (!incomingQ) {
        return { mode: "skipped_empty_queries" };
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);
    const sid = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    if (!sid) {
        throw new Error("Missing clientSessionId");
    }

    const rowNumber = await findSessionRowNumberBySessionId_(sheets, tab, sid);
    if (rowNumber > 0) {
        const queriesCol = await getUserQueriesColumnInfo_(sheets, tab);
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A${rowNumber}:R${rowNumber}`
        });
        const r0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const existingCsv = sanitizeUserQueriesCsvForSheet(sheetCellString_(r0[queriesCol.colIdx]));
        const merged = mergeCsvUnique_(existingCsv, incomingQ, 200);
        const queryColumnWritten = merged !== existingCsv;
        /** @type {{ totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } | null} */
        let googleBatchQueries = null;
        if (queryColumnWritten) {
            const nBatch = await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: "USER_ENTERED",
                    data: [{ range: `${tab}!${queriesCol.colLetter}${rowNumber}`, values: [[merged]] }]
                }
            });
            googleBatchQueries = googleBatchSummaryFromResponse_(nBatch);
        }
        // Chat may append a row on mobile first (blank name/email), then capture fields later; session
        // query sync still hits this path — fill blank contact columns without rewriting the queries column twice.
        const contact = await updateExistingSessionRow_(
            sheets,
            tab,
            rowNumber,
            {
                name: typeof row.name === "string" ? row.name : "",
                mobile: typeof row.mobile === "string" ? row.mobile : "",
                email: typeof row.email === "string" ? row.email : "",
                browserName: typeof row.browserName === "string" ? row.browserName : "",
                deviceType: typeof row.deviceType === "string" ? row.deviceType : "",
                channel: typeof row.channel === "string" ? row.channel : "",
                fileLinks: typeof row.fileLinks === "string" ? row.fileLinks : "",
                city: typeof row.city === "string" ? row.city : "",
                ip: typeof row.ip === "string" ? row.ip : "",
                sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : "",
                appointmentBooked:
                    typeof row.appointmentBooked === "string" ? row.appointmentBooked : "",
                appointmentDate:
                    typeof row.appointmentDate === "string" ? row.appointmentDate : "",
                appointmentTime:
                    typeof row.appointmentTime === "string" ? row.appointmentTime : "",
                userQueriesCsv: ""
            },
            {}
        );
        return {
            mode: "merge_into_existing_row",
            tab,
            sheetRowNumber: rowNumber,
            queryColumnWritten,
            googleBatchQueries,
            contactFill: {
                applied: contact.applied,
                googleBatch: contact.googleBatch
            }
        };
    }

    const sheetOutcome = await appendContactRowToSheet(row);
    return { mode: "appended_new_row", sheetOutcome };
}

/**
 * Read-only spreadsheet metadata for ops debugging (wrong tab / permissions / spreadsheet id).
 * @returns {Promise<{ ok: true, title: string, tabNames: string[], configuredRangeTab: string } | { ok: false, code: string, message?: string }>}
 */
export async function probeSheetsSpreadsheetAccess() {
    if (!SPREADSHEET_ID) {
        return { ok: false, code: "missing_spreadsheet_env" };
    }
    try {
        const client = await getSheetsAuthClient();
        const sheetsApi = google.sheets({ version: "v4", auth: client });
        const got = await sheetsApi.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: "properties.title,sheets.properties(title)"
        });
        /** @type {Array<{ properties?: { title?: string } }>} */
        const sh = Array.isArray(got.data.sheets) ? got.data.sheets : [];
        const tabNames = sh
            .map((x) =>
                x && x.properties && typeof x.properties.title === "string"
                    ? x.properties.title.trim()
                    : ""
            )
            .filter(Boolean);
        const title =
            got.data.properties && typeof got.data.properties.title === "string"
                ? got.data.properties.title.trim()
                : "";
        return {
            ok: true,
            title,
            tabNames,
            configuredRangeTab: tabNameFromRange(RANGE)
        };
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        return { ok: false, code: "spreadsheets_get_failed", message: msg.slice(0, 500) };
    }
}

/**
 * Staff viewer: header row + up to `maxRows` most recent data rows (sheet append adds at bottom).
 * Bounded column-A scan (never `A:A`) so large tabs do not stall the API.
 *
 * @param {{ maxRows?: number, offset?: number }} [opts]
 * @returns {Promise<{ tab: string, title: string, rowCount: number, headers: string[], conversations: Record<string, string>[], offset: number, limit: number, hasOlder: boolean, hasNewer: boolean, totalDataRows: number }>}
 */
export async function fetchConversationSheetPreview(opts = {}) {
    if (!SPREADSHEET_ID) {
        throw new Error("SHEETS_SPREADSHEET_ID is not set.");
    }
    const maxRows = Math.min(
        500,
        Math.max(
            5,
            Number.parseInt(
                String(
                    opts.maxRows !== undefined
                        ? opts.maxRows
                        : process.env.CONVERSATIONS_SHEET_VIEW_MAX_ROWS || "200"
                ),
                10
            ) || 200
        )
    );
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);

    const titleGot = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: "properties.title"
    });
    const title =
        titleGot.data.properties && typeof titleGot.data.properties.title === "string"
            ? titleGot.data.properties.title.trim()
            : "";

    const headerGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!1:1`
    });
    const headersRaw = Array.isArray(headerGot.data.values) && headerGot.data.values[0]
        ? /** @type {unknown[]} */ (headerGot.data.values[0])
        : [];
    const headers = [];
    const used = new Set();
    for (let i = 0; i < headersRaw.length; i += 1) {
        let label = sheetCellString_(headersRaw[i]);
        if (!label) {
            label = `Column_${i + 1}`;
        }
        let key = label;
        let n = 2;
        while (used.has(key)) {
            key = `${label} (${n})`;
            n += 1;
        }
        used.add(key);
        headers.push(key);
    }

    /** Avoid `A:A` (entire column) — huge sheets stall until timeout. */
    const hardCap = Math.min(
        15_000,
        Math.max(
            250,
            Number.parseInt(
                String((process.env.CONVERSATIONS_SHEET_SCAN_MAX_ROWS || "").trim() || "8000"),
                10
            ) || 8000
        )
    );

    /** @type {number} */
    let capRow = hardCap;
    try {
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: "sheets.properties(title,gridProperties(rowCount))"
        });
        const sh = Array.isArray(meta.data.sheets) ? meta.data.sheets : [];
        const tabKey = normalizedSheetTabKey_(tab);
        for (let si = 0; si < sh.length; si += 1) {
            const p = sh[si] && sh[si].properties;
            const st = p && typeof p.title === "string" ? p.title.trim() : "";
            if (st && normalizedSheetTabKey_(st) === tabKey) {
                const gr = p && p.gridProperties && typeof p.gridProperties.rowCount === "number"
                    ? p.gridProperties.rowCount
                    : 0;
                if (Number.isFinite(gr) && gr > 0) {
                    capRow = Math.min(hardCap, gr);
                }
                break;
            }
        }
    } catch {
        /* fall back hardCap */
    }

    const colAGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A1:A${capRow}`
    });
    /** @type {unknown[][]} */
    const colVals = Array.isArray(colAGot.data.values) ? colAGot.data.values : [];
    /** 1-based last row with column A populated (fallback: length if full block used). */
    let n = 0;
    for (let ri = colVals.length - 1; ri >= 0; ri -= 1) {
        if (!isBlankSheetCell_(colVals[ri] && colVals[ri][0])) {
            n = ri + 1;
            break;
        }
    }
    if (n <= 1) {
        return {
            tab,
            title,
            rowCount: n || colVals.length,
            headers,
            conversations: [],
            offset: 0,
            limit: maxRows,
            hasOlder: false,
            hasNewer: false,
            totalDataRows: 0
        };
    }
    const totalDataRows = Math.max(0, n - 1);
    let offset = Number.parseInt(String(opts.offset !== undefined ? opts.offset : 0), 10);
    if (!Number.isFinite(offset) || offset < 0) {
        offset = 0;
    }
    /** Skip this many rows from the bottom (newest); page = offset ÷ limit. */
    const maxOffset = Math.max(0, n - 2);
    if (offset > maxOffset) {
        offset = maxOffset;
    }
    const dataEnd = n - offset;
    if (dataEnd < 2) {
        return {
            tab,
            title,
            rowCount: n,
            headers,
            conversations: [],
            offset,
            limit: maxRows,
            hasOlder: false,
            hasNewer: offset > 0,
            totalDataRows
        };
    }
    const dataStart = Math.max(2, dataEnd - maxRows + 1);
    const blockGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${dataStart}:R${dataEnd}`
    });
    const rawRows = Array.isArray(blockGot.data.values) ? blockGot.data.values : [];
    /** @type {Record<string, string>[]} */
    const conversations = [];
    for (let r = rawRows.length - 1; r >= 0; r -= 1) {
        const cells = rawRows[r] || [];
        /** @type {Record<string, string>} */
        const o = {};
        for (let c = 0; c < headers.length; c += 1) {
            const h = headers[c];
            o[h] = sheetCellString_(cells[c]);
        }
        const hasAny = Object.values(o).some((v) => v && v.trim());
        if (hasAny) {
            conversations.push(o);
        }
    }
    const hasOlder = dataStart > 2;
    const hasNewer = offset > 0;
    return {
        tab,
        title,
        rowCount: n,
        headers,
        conversations,
        offset,
        limit: maxRows,
        hasOlder,
        hasNewer,
        totalDataRows
    };
}

