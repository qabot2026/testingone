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
// Default schema: no Form ID (A–S). Col A = Conv. link (HYPERLINK), B Date, C Time (12h TZ from SHEETS_CONV_DATETIME_TZ), then name… through S = Document. Sheet JSON transcript column is opt-in only (SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN).
const RANGE = (process.env.SHEETS_RANGE || "Sheet1!A:S").trim();
/**
 * Optional A1 column letter (e.g. S). When set, new/updated rows get =HYPERLINK(...) to open that row in this spreadsheet.
 * Leave unset to skip (default). Add a matching header on row 1 in your sheet if you want a label.
 */
const SHEETS_ROW_OPEN_LINK_COLUMN = (process.env.SHEETS_ROW_OPEN_LINK_COLUMN || "").trim().toUpperCase();
/**
 * Optional: A1 column letter for **JSON** `chat_transcript` (e.g. `T`). When unset, JSON is **not** written to the Sheet
 * (column A stays the Chat script / Conv. link only; staff transcript uses Firestore + session sync elsewhere).
 * When set / matched, session sync and contact-form writes store the widget `chat_transcript` JSON so staff transcripts include bot lines even if Firestore is empty or client_context drops them.
 */
const SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN = (process.env.SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN || "").trim().toUpperCase();
/** When not `1` / `true`, never write raw `chat_transcript` JSON to any Sheet cell (transcript uses Firestore sync). */
const SHEETS_WRITE_CHAT_TRANSCRIPT_JSON =
    process.env.SHEETS_WRITE_CHAT_TRANSCRIPT_JSON === "1"
    || String(process.env.SHEETS_WRITE_CHAT_TRANSCRIPT_JSON || "").trim().toLowerCase() === "true";
/**
 * Resolves HTTPS origin for staff transcript links. Set CONVERSATIONS_PUBLIC_BASE_URL, or rely on
 * Railway’s RAILWAY_PUBLIC_DOMAIN / RAILWAY_STATIC_URL when unset.
 */
function resolvedConversationsPublicBaseUrl_() {
    const explicit = (process.env.CONVERSATIONS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    if (explicit) {
        return explicit;
    }
    const dom = (process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
    if (dom) {
        const host = dom.replace(/^https?:\/\//i, "").split("/")[0] || "";
        return host ? `https://${host}` : "";
    }
    const st = (process.env.RAILWAY_STATIC_URL || "").trim().replace(/\/+$/, "");
    if (st) {
        return /^https?:\/\//i.test(st) ? st : `https://${st}`;
    }
    return "";
}
/** Secondary tab for lead KPIs (created if missing). Must differ from `SHEETS_RANGE` data tab. */
const DASHBOARD_SHEET_TAB = (process.env.SHEETS_DASHBOARD_TAB || "Sheet2").trim() || "Sheet2";
/** After each new lead row append, refresh the dashboard tab (best-effort; does not fail the request). */
const SYNC_DASHBOARD_ON_APPEND = /^(1|true|yes)$/i.test(
    String(process.env.SHEETS_SYNC_DASHBOARD_ON_APPEND || "").trim()
);

/**
 * Session id column (0-based): K (10) with Conv. link in A and date in B; J (9) legacy Date-first A–R row;
 * I (8) older single “Conv” column layout.
 */
const STANDARD_SESSION_COLUMN_INDEX0_PRIMARY = 10;
const STANDARD_SESSION_COLUMN_INDEX0_PRE_TRANSCRIPT = 9;
const STANDARD_SESSION_COLUMN_INDEX0_LEGACY = 8;
/** Column A (0): staff “Chat script” = Conv. link HYPERLINK — never raw JSON. */
const STANDARD_CHAT_SCRIPT_LINK_COL_INDEX0 = 0;
/** Column S (18): Document / drive file links — never transcript JSON or duplicate link. */
const STANDARD_DOCUMENT_COL_INDEX0 = 18;
/** Only used when env mistakenly targets A or S for JSON — never written by default. */
const STANDARD_CHAT_TRANSCRIPT_JSON_COL_LETTER = "T";
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

/**
 * IANA zone for `/conversation-transcript` timestamps (`en-IN` clock, same as Sheets “Conv.” when `SHEETS_CONV_DATETIME_TZ` is set).
 * When that env is empty (server-local Sheets stamping), defaults to **Asia/Kolkata** so staff see the usual widget persona clock.
 * @returns {string}
 */
export function getConversationDateTimeZoneForTranscript() {
    const tz = conversationDateTimeZoneForIntl_();
    if (tz && String(tz).trim()) {
        return String(tz).trim();
    }
    return "Asia/Kolkata";
}

/** @param {Date} d */
function conversationSheetBaseDate_(d) {
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
}

const SHEET_DD_MM_YYYY_NUMBER_FORMAT = { type: "DATE", pattern: "dd/mm/yyyy" };

/** Google Sheets serial (days since 1899-12-30) for calendar Y-M-D. */
function googleSheetsSerialFromIsoYmd_(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    if (!m) {
        return null;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isoCalendarDayOk_(y, mo, d)) {
        return null;
    }
    const epoch = Date.UTC(1899, 11, 30, 0, 0, 0);
    return (Date.UTC(y, mo - 1, d, 12, 0, 0) - epoch) / 86400000;
}

/** @param {number} epochMs */
function googleSheetsSerialFromEpochMs_(epochMs) {
    if (!Number.isFinite(epochMs)) {
        return null;
    }
    const ymd = conversationRowYmdInSheetTz_(epochMs);
    return ymd ? googleSheetsSerialFromIsoYmd_(ymd) : null;
}

/**
 * Conversation **date only** for Sheets (numeric cell + dd/mm/yyyy display format).
 * @param {Date} [d]
 * @returns {number|string}
 */
export function formatConversationDateForSheet(d = new Date()) {
    const dt = conversationSheetBaseDate_(d);
    const ser = googleSheetsSerialFromEpochMs_(dt.getTime());
    return ser != null ? ser : "";
}

/** @param {unknown} raw */
function sheetConvDateCellValue_(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        const ser = googleSheetsSerialFromEpochMs_(raw.getTime());
        return ser != null ? ser : "";
    }
    const ms = parseConversationDateCellWide_(raw);
    if (Number.isFinite(ms)) {
        const ser = googleSheetsSerialFromEpochMs_(ms);
        return ser != null ? ser : "";
    }
    return "";
}

/** @param {unknown} raw */
function sheetAppointmentDateCellValue_(raw) {
    return sheetConvDateCellValue_(raw);
}

/**
 * Conversation **time only** for Sheets column C (12-hour clock) when column A is the Conv. link.
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
 * Force append into our schema columns (A–S: Conv. link, Date, Time, then lead fields…).
 *
 * We previously used `A:Z` to avoid truncation when env was set to `A:H`, but `values.append`
 * may choose a "table" anchored later in the sheet and append at an unexpected start column
 * (e.g. `W:AJ`), making the lead look "missing" in A–N.
 *
 * @param {string} raw same as `SHEETS_RANGE` / default
 */
function appendRangeSchemaWidth_(raw) {
    const tab = tabNameFromRange(raw);
    return `${tab}!A:S`;
}

/**
 * Resolve Date + Time strings for Sheets (preferred) or derive from legacy `iso` combined cell.
 *
 * @param {{ iso?: string, convDate?: string, convTime?: string }} row
 */
function conversationPartsFromIncomingRow_(row) {
    const tt = typeof row.convTime === "string" ? row.convTime.trim() : "";
    if (typeof row.convDate === "number" && Number.isFinite(row.convDate)) {
        return { convDate: row.convDate, convTime: tt };
    }
    const dd = typeof row.convDate === "string" ? row.convDate.trim() : "";
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

let headerCache_ = { tab: "", at: 0, mobileColIdx: 4, mobileColLetter: "E" };
const HEADER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Detect mobile column position by header row.
 * Falls back to the default schema (column E) if not found.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getMobileColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (headerCache_.tab === tab && now - headerCache_.at < HEADER_CACHE_TTL_MS) {
        return headerCache_;
    }
    let mobileColIdx = 4;
    let mobileColLetter = "E";
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

let repeatedHeaderCache_ = { tab: "", at: 0, repeatedColIdx: 8, repeatedColLetter: "I" };

/** Sheet-facing label when we only know repeat from session scan (`false` ⇒ first-time). */
function repeatedUserLabelFromRepeatedFlag_(repeatedAcrossSessions) {
    return repeatedAcrossSessions ? "Repeated" : "First Time";
}

/**
 * Canonical meaning of "Repeated User" cells (legacy Yes/No and new wording).
 * @returns {""|"Repeated"|"First Time"}
 */
function repeatedUserSheetSemantics_(raw) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) {
        return "";
    }
    if (/^yes$/i.test(t) || /^repeated$/i.test(t)) {
        return "Repeated";
    }
    if (/^no$/i.test(t) || /^first\s*time$/i.test(t)) {
        return "First Time";
    }
    return "";
}

/** Outbound Appointment booked: `Scheduled` or blank (`No` clears). Handles legacy Yes/No. */
function appointmentBookedSheetValue_(raw) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s || /^no$/i.test(s)) {
        return "";
    }
    if (/^yes$/i.test(s) || /^scheduled$/i.test(s)) {
        return "Scheduled";
    }
    return s;
}

/** Treat Sheet cell as “appointment scheduled/booked” for staff stats — wider than ingest-only normaliser. */
function sheetAppointmentCellCountsScheduled_(raw) {
    const cell = sheetCellString_(raw).trim();
    if (!cell) {
        return false;
    }
    if (
        /^no$/i.test(cell)
        || /^none$/i.test(cell)
        || /^false$/i.test(cell)
        || /^not\s*(scheduled|booked|yet)$/i.test(cell)
        || /^n\/?a$/i.test(cell)
        || /^cancel(cancel(led)?)?/i.test(cell)
        || /^reject(ed)?$/i.test(cell)
        || /^pending$/i.test(cell)
        || /^0$/i.test(cell)
    ) {
        return false;
    }
    if (appointmentBookedSheetValue_(cell) === "Scheduled") {
        return true;
    }
    const low = cell.toLowerCase();
    if (/^yes$|^true$|^done$|^y$|^1$|^✓|^✔|^☑/i.test(cell)) {
        return true;
    }
    if (
        /\b(scheduled|booked)\b|appointment\s*(booked|scheduled|confirmed|fixed|set)|booking\s*(done|confirmed|complete)|\bconfirmation\b|\bconfirmed\b|consult(ation)?\s*(booked|scheduled)|slot\s*(reserved|booked)|^completed$/i.test(
            low
        )
    ) {
        return true;
    }
    return false;
}

/** Infer slot filled when “booked/status” cells are blank but appointment date & time columns are populated plausibly. */
function sheetRowAppointmentSlotCellsLikelyFilled_(dateCellRaw, timeCellRaw) {
    const d = sheetCellString_(dateCellRaw).trim();
    const t = sheetCellString_(timeCellRaw).trim();
    if (!d || !t || !/\d/.test(d) || !/\d/.test(t)) {
        return false;
    }
    if (/[:.]/.test(t) || /\b(am|pm)\b/i.test(t) || /^\d{3,4}$/.test(t) || /\d{1,2}\s*h/i.test(t)) {
        return true;
    }
    return false;
}

/** Single-cell appointment timestamp (ISO or date + clock time). */
function sheetCellLooksLikeAppointmentDateTimeCombined_(raw) {
    const s = sheetCellString_(raw).trim();
    if (!s || !/\d/.test(s)) {
        return false;
    }
    if (/\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(s)) {
        return true;
    }
    if (/\d{4}-\d{2}-\d{2}[T ]\d{1,2}(?!:)/.test(s)) {
        return true;
    }
    if (/\d{1,4}[/.\-]\d{1,4}[/.\-]\d{2,4}/.test(s) && /\d{1,2}:\d{2}/.test(s)) {
        return true;
    }
    return false;
}

/**
 * Normalize “Channel” column text → lead-stats bucket (`web`, `whatsapp`, `instagram`, `facebook`, else `other`).
 * @returns {"web"|"whatsapp"|"instagram"|"facebook"|"other"}
 */
function conversationChannelBucket_(raw) {
    const s = sheetCellString_(raw).trim().toLowerCase();
    if (!s) {
        return "other";
    }
    if (/\bwhatsapp\b|(^|[\s,])wa([\s,/]|$)|whats[\s_-]*app/.test(s)) {
        return "whatsapp";
    }
    if (/\binstagram\b|(^|[\s,])ig([\s,/]|$)/.test(s)) {
        return "instagram";
    }
    if (/\bfacebook\b|(^|[\s,])fb([\s,/]|$)|\bmessenger\b|meta[\s_-]*business/.test(s)) {
        return "facebook";
    }
    if (
        /\bwebsite\b|^web([\s_-]|$)|^web$|\bwebchat\b|\bwebview\b|^inappwebview|(^|[\s,])www\.|\bbrowser\b|(^|[\s,])desktop\b|\bportal\b|^online([\s_-]|$)|^online$|\binternet\b|^internet$|^site$|^www$|^cx\b|^sse\b|^widget\b|^embed(ded)?\b|^hosted\b|^organic\b|^direct\b/.test(
            s
        )
    ) {
        return "web";
    }
    return "other";
}

/**
 * Human-readable **Device** cell for Sheets and staff transcript summary (e.g. `Desktop/Mobile`).
 * @param {unknown} raw
 * @returns {string}
 */
export function formatDeviceTypeForSheetDisplay(raw) {
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!s) {
        return "";
    }
    return s
        .split(/\s*[/,|]\s*/)
        .map((part) => {
            const p = part.trim();
            if (!p) {
                return "";
            }
            const low = p.toLowerCase();
            if (low === "desktop") {
                return "Desktop";
            }
            if (low === "mobile") {
                return "Mobile";
            }
            if (low === "tablet") {
                return "Tablet";
            }
            return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
        })
        .filter(Boolean)
        .join("/");
}

/**
 * Human-readable **Channel** cell (e.g. `Web/WhatsApp/Instagram/Facebook`).
 * @param {unknown} raw
 * @returns {string}
 */
export function formatChannelForSheetDisplay(raw) {
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!s) {
        return "";
    }
    return s
        .split(/\s*[/,|]\s*/)
        .map((part) => {
            const p = part.trim();
            if (!p) {
                return "";
            }
            const low = p.toLowerCase();
            if (low === "web") {
                return "Web";
            }
            if (low === "whatsapp") {
                return "WhatsApp";
            }
            if (low === "instagram") {
                return "Instagram";
            }
            if (low === "facebook") {
                return "Facebook";
            }
            if (low === "twitter") {
                return "Twitter";
            }
            if (low === "x") {
                return "X";
            }
            return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
        })
        .filter(Boolean)
        .join("/");
}

/** Empty per-channel tallies for a lead segment (mobile-only / email-only / both). */
function leadSegmentChannelTotalsEmpty_() {
    return { web: 0, whatsapp: 0, instagram: 0, facebook: 0, other: 0 };
}

/**
 * @param {{ web: number, whatsapp: number, instagram: number, facebook: number, other: number }} acc
 * @param {"web"|"whatsapp"|"instagram"|"facebook"|"other"} ch
 */
function leadSegmentChannelAdd_(acc, ch) {
    switch (ch) {
        case "web":
            acc.web += 1;
            break;
        case "whatsapp":
            acc.whatsapp += 1;
            break;
        case "instagram":
            acc.instagram += 1;
            break;
        case "facebook":
            acc.facebook += 1;
            break;
        default:
            acc.other += 1;
    }
}

/** Mutable tallies while scanning sheet rows once for viewer + dashboard stats. */
function leadCaptureStatsAccumulatorEmpty_() {
    return {
        dataRowsConsidered: 0,
        skippedNoDate: 0,
        conversations: 0,
        onlyMobile: 0,
        onlyEmail: 0,
        mobileAndEmail: 0,
        neither: 0,
        appointmentScheduled: 0,
        channelWeb: 0,
        channelWhatsapp: 0,
        channelInstagram: 0,
        channelFacebook: 0,
        channelOther: 0,
        onlyMobileByChannel: leadSegmentChannelTotalsEmpty_(),
        onlyEmailByChannel: leadSegmentChannelTotalsEmpty_(),
        mobileAndEmailByChannel: leadSegmentChannelTotalsEmpty_()
    };
}

/**
 * @param {ReturnType<typeof leadCaptureStatsAccumulatorEmpty_>} acc
 * @param {unknown[]} cells
 * @param {{
 *   mobileIdx: number,
 *   emailIdx: number,
 *   channelIdx: number,
 *   appointmentBookedIdx: number,
 *   appointmentDateIdx: number,
 *   appointmentTimeIdx: number,
 *   apptDtIdx: number
 * }} col
 */
function leadCaptureStatsAccumulateRow_(acc, cells, col) {
    if (!sheetRowHasAnyCell_(cells)) {
        return;
    }
    const mobCell = cells[col.mobileIdx];
    const emCell = cells[col.emailIdx];
    const chCell = cells[col.channelIdx];
    const hasEm = sheetCellHasLeadEmail_(emCell);
    const hasMob = sheetCellHasLeadMobile_(mobCell);
    const channelKey = conversationChannelBucket_(chCell);
    acc.conversations += 1;
    if (hasMob && hasEm) {
        acc.mobileAndEmail += 1;
        leadSegmentChannelAdd_(acc.mobileAndEmailByChannel, channelKey);
    } else if (hasMob) {
        acc.onlyMobile += 1;
        leadSegmentChannelAdd_(acc.onlyMobileByChannel, channelKey);
    } else if (hasEm) {
        acc.onlyEmail += 1;
        leadSegmentChannelAdd_(acc.onlyEmailByChannel, channelKey);
    } else {
        acc.neither += 1;
    }
    let apptCounted = sheetAppointmentCellCountsScheduled_(cells[col.appointmentBookedIdx]);
    if (!apptCounted) {
        apptCounted = sheetRowAppointmentSlotCellsLikelyFilled_(
            cells[col.appointmentDateIdx],
            cells[col.appointmentTimeIdx]
        );
    }
    if (!apptCounted && col.apptDtIdx >= 0) {
        apptCounted = sheetCellLooksLikeAppointmentDateTimeCombined_(cells[col.apptDtIdx]);
    }
    if (apptCounted) {
        acc.appointmentScheduled += 1;
    }
    switch (channelKey) {
        case "web":
            acc.channelWeb += 1;
            break;
        case "whatsapp":
            acc.channelWhatsapp += 1;
            break;
        case "instagram":
            acc.channelInstagram += 1;
            break;
        case "facebook":
            acc.channelFacebook += 1;
            break;
        default:
            acc.channelOther += 1;
    }
}

/**
 * @param {ReturnType<typeof leadCaptureStatsAccumulatorEmpty_>} acc
 * @param {ReturnType<typeof leadCaptureStatsAccumulatorEmpty_>} baseEmpty
 */
function leadCaptureStatsPayloadFromAccumulator_(acc, baseEmpty) {
    const out = baseEmpty;
    const conversations = acc.conversations;
    const leadsCaptured = acc.onlyMobile + acc.onlyEmail + acc.mobileAndEmail;
    const pct = conversations ? Math.round((leadsCaptured * 10_000) / conversations) / 100 : null;
    const rpt = /** @type {(a: number) => string} */ (num) => `${num} / ${conversations}`;
    out.scan.dataRowsConsidered = acc.dataRowsConsidered;
    out.totals.conversations = conversations;
    out.totals.onlyMobile = acc.onlyMobile;
    out.totals.onlyEmail = acc.onlyEmail;
    out.totals.mobileAndEmail = acc.mobileAndEmail;
    out.totals.neither = acc.neither;
    out.totals.rowsSkippedNoParsableDate = acc.skippedNoDate;
    out.totals.leadsCaptured = leadsCaptured;
    out.totals.appointmentScheduled = acc.appointmentScheduled;
    out.totals.appointmentBooked = acc.appointmentScheduled;
    out.totals.channelWeb = acc.channelWeb;
    out.totals.channelWhatsapp = acc.channelWhatsapp;
    out.totals.channelInstagram = acc.channelInstagram;
    out.totals.channelFacebook = acc.channelFacebook;
    out.totals.channelOther = acc.channelOther;
    out.totals.onlyMobileByChannel = acc.onlyMobileByChannel;
    out.totals.onlyEmailByChannel = acc.onlyEmailByChannel;
    out.totals.mobileAndEmailByChannel = acc.mobileAndEmailByChannel;
    out.ratios.onlyMobile = rpt(acc.onlyMobile);
    out.ratios.onlyEmail = rpt(acc.onlyEmail);
    out.ratios.mobileAndEmail = rpt(acc.mobileAndEmail);
    out.ratios.leads = rpt(leadsCaptured);
    out.ratios.leadCapturePct = pct;
    return out;
}

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
    /** Default A–S schema: Repeated User is column I (index 8). */
    let repeatedColIdx = 8;
    let repeatedColLetter = "I";
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
        if (repeatedColIdx === 8) {
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

let userQueriesHeaderCache_ = { tab: "", at: 0, colIdx: 7, colLetter: "H" };

/**
 * Column for merged live-chat `user_queries` CSV — default column H (A–S lead layout).
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getUserQueriesColumnInfo_(sheets, tab) {
    const now = Date.now();
    if (userQueriesHeaderCache_.tab === tab && now - userQueriesHeaderCache_.at < HEADER_CACHE_TTL_MS) {
        return userQueriesHeaderCache_;
    }
    let colIdx = 7;
    let colLetter = "H";
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
function sheetCellLooksLikeLeadEmail_(raw) {
    const t = sheetCellString_(raw).trim();
    if (!t || !t.includes("@")) {
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+/.test(t);
}

function mobileKeyFromCell_(rawCell) {
    if (sheetCellLooksLikeLeadEmail_(rawCell)) {
        return "";
    }
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
        : 4;
    // Prefer detected mobile column first.
    const primary = mobileKeyFromCell_(r[idx]);
    if (primary) {
        return primary;
    }
    // Fallback: scan all cells for any phone-like value.
    let best = "";
    for (let i = 0; i < r.length; i += 1) {
        if (sheetCellLooksLikeLeadEmail_(r[i])) {
            continue;
        }
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

/**
 * Last 1-based sheet row with any value in column A or B (chat JSON in A, conv. date in B on default schema).
 * @param {unknown[][]} abRows from `${tab}!A1:B${cap}`
 */
function lastDataRow1BasedFromAB_(abRows) {
    if (!Array.isArray(abRows) || !abRows.length) {
        return 0;
    }
    for (let ri = abRows.length - 1; ri >= 0; ri -= 1) {
        const row = abRows[ri];
        const a = row && row[0];
        const b = row && row[1];
        if (!isBlankSheetCell_(a) || !isBlankSheetCell_(b)) {
            return ri + 1;
        }
    }
    return 0;
}

/** Upper bound for `CONVERSATIONS_SHEET_SCAN_MAX_ROWS` (chunk size for A:B scans). */
const CONVERSATIONS_SHEET_SCAN_ROW_ABS_MAX = 100_000;

/** Rows per A:B fetch when locating the last populated row (default 15000; was 8000). */
function conversationSheetScanHardCap_() {
    return Math.min(
        CONVERSATIONS_SHEET_SCAN_ROW_ABS_MAX,
        Math.max(
            250,
            Number.parseInt(
                String((process.env.CONVERSATIONS_SHEET_SCAN_MAX_ROWS || "").trim() || "8000"),
                10
            ) || 8000
        )
    );
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @returns {Promise<number>}
 */
async function conversationSheetGridRowCount_(sheets, tab) {
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
                const gr =
                    p && p.gridProperties && typeof p.gridProperties.rowCount === "number"
                        ? p.gridProperties.rowCount
                        : 0;
                if (Number.isFinite(gr) && gr > 0) {
                    return Math.trunc(gr);
                }
                break;
            }
        }
    } catch {
        /* ignore */
    }
    return 0;
}

/**
 * Last 1-based row with data in columns A or B. Scans upward in chunks when the tab exceeds `chunkRows`.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} chunkRows
 * @param {number} [gridRows]
 * @returns {Promise<number>}
 */
async function conversationSheetLastDataRow1Based_(sheets, tab, chunkRows, gridRows = 0) {
    const cap = Math.max(250, chunkRows);
    const grid = Number.isFinite(gridRows) && gridRows > 0 ? Math.trunc(gridRows) : 0;
    const upper = grid > 0 ? grid : cap;

    if (upper <= cap) {
        const colABGot = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A1:B${upper}`
        });
        const colVals = Array.isArray(colABGot.data.values) ? colABGot.data.values : [];
        return lastDataRow1BasedFromAB_(colVals);
    }

    let end = upper;
    while (end >= 1) {
        const start = Math.max(1, end - cap + 1);
        const colABGot = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A${start}:B${end}`
        });
        const colVals = Array.isArray(colABGot.data.values) ? colABGot.data.values : [];
        const rel = lastDataRow1BasedFromAB_(colVals);
        if (rel > 0) {
            return start + rel - 1;
        }
        if (start <= 1) {
            break;
        }
        end = start - 1;
    }

    const headGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A1:B${cap}`
    });
    const headVals = Array.isArray(headGot.data.values) ? headGot.data.values : [];
    return lastDataRow1BasedFromAB_(headVals);
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

/** Tabs where Conv. Date + Appointment date columns already have dd/mm/yyyy number format. */
const sheetDateColumnsFormatApplied_ = new Set();

/**
 * Apply dd/mm/yyyy display format to conversation + appointment date columns (numeric cells).
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function ensureSheetDateColumnsFormat_(sheets, tab) {
    const key = normalizedSheetTabKey_(tab);
    if (sheetDateColumnsFormatApplied_.has(key)) {
        return;
    }
    const sheetId = await getSheetIdForTitle_(sheets, tab);
    const dateColIdxs = [1, 16];
    /** @type {import("googleapis").sheets_v4.Schema$Request[]} */
    const requests = dateColIdxs.map((colIdx) => ({
        repeatCell: {
            range: {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 200000,
                startColumnIndex: colIdx,
                endColumnIndex: colIdx + 1
            },
            cell: { userEnteredFormat: { numberFormat: SHEET_DD_MM_YYYY_NUMBER_FORMAT } },
            fields: "userEnteredFormat.numberFormat"
        }
    }));
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests }
    });
    sheetDateColumnsFormatApplied_.add(key);
}

/** Force Conv. Time to stay plain text in Sheets (time-only column). */
function sheetConvDateOrTimeCell_(v) {
    const s = sheetOutboundCell_(v);
    if (!s) {
        return "";
    }
    return /^'/.test(s) ? s : `'${s}`;
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
        if (!k && ra.length > 4) {
            k = mobileKeyFromCell_(ra[4]);
        }
        if (!k && ra.length > 3) {
            k = mobileKeyFromCell_(ra[3]);
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
            sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_PRIMARY])
            || sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_PRE_TRANSCRIPT])
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

/** Replace CSV segments that start with prefix (case-insensitive), then append the new segment. */
function replacePrefixedCsvSegment_(existingCsv, prefix, newSegment) {
    const pfx = typeof prefix === "string" ? prefix.trim().toLowerCase() : "";
    const parts = splitCsvValues_(existingCsv).filter((seg) => {
        if (!pfx) return true;
        return !seg.trim().toLowerCase().startsWith(pfx);
    });
    const next = typeof newSegment === "string" ? newSegment.trim() : "";
    if (next) parts.push(next);
    return parts.join(", ");
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
        range: `${tab}!A${rowNumber}:S${rowNumber}`
    });
    const row = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
    const colL = columnLetterFromIndex_;

    /** C–E → D–F on A–S schema: contact-form submits should overwrite an older chat-sync row when values are present. */
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

    const name = contactPatchFor(typeof incoming.name === "string" ? incoming.name : "", 3);
    const mobile = contactPatchFor(typeof incoming.mobile === "string" ? incoming.mobile : "", 4);
    const email = contactPatchFor(typeof incoming.email === "string" ? incoming.email : "", 5);
    const channelRaw = patchScalarInto(typeof incoming.channel === "string" ? incoming.channel : "", 6);
    const channel = channelRaw ? formatChannelForSheetDisplay(channelRaw) : "";
    const deviceTypeRaw = patchScalarInto(typeof incoming.deviceType === "string" ? incoming.deviceType : "", 11);
    const deviceType = deviceTypeRaw ? formatDeviceTypeForSheetDisplay(deviceTypeRaw) : "";
    const browserName =
        patchScalarInto(typeof incoming.browserName === "string" ? incoming.browserName : "", 12);
    const city = patchScalarInto(typeof incoming.city === "string" ? incoming.city : "", 13);
    const ip = patchScalarInto(typeof incoming.ip === "string" ? incoming.ip : "", 14);

    const repeatedIncoming = typeof incoming.repeated === "string" ? incoming.repeated.trim() : "";
    const existingRepeatedSem = repeatedUserSheetSemantics_(sheetCellString_(row[repeatedCol.repeatedColIdx]));
    const repeatedNorm = repeatedUserSheetSemantics_(repeatedIncoming);
    let repeated = "";
    if (repeatedNorm) {
        const needPatch =
            preferIncomingContact || existingRepeatedSem !== repeatedNorm;
        if (needPatch) {
            repeated = repeatedNorm;
        }
    }

    const sourceUrl = patchScalarInto(
        typeof incoming.sourceUrl === "string" ? incoming.sourceUrl : "",
        9
    );
    const incomingAbRaw = typeof incoming.appointmentBooked === "string" ? incoming.appointmentBooked : "";
    const desiredAb = appointmentBookedSheetValue_(incomingAbRaw);
    const existingAbSem = appointmentBookedSheetValue_(sheetCellString_(row[15]));
    /** @type {string | null} */
    let appointmentBookedPatch = null;
    if (preferIncomingContact) {
        if (desiredAb !== existingAbSem) {
            appointmentBookedPatch = desiredAb;
        }
    } else if (desiredAb === "Scheduled" && existingAbSem === "") {
        appointmentBookedPatch = "Scheduled";
    }
    const appointmentDate = patchScalarInto(
        typeof incoming.appointmentDate === "string" ? incoming.appointmentDate : "",
        16
    );
    const appointmentTime = patchScalarInto(
        typeof incoming.appointmentTime === "string" ? incoming.appointmentTime : "",
        17
    );
    const fileLinks = patchScalarInto(
        typeof incoming.fileLinks === "string" ? incoming.fileLinks : "",
        18
    );

    const existingQueries = sheetCellString_(row[queriesCol.colIdx]);
    const mergedQueries = mergeCsvUnique_(existingQueries, incoming.userQueriesCsv || "", 200);
    const userQueriesCsv = mergedQueries && mergedQueries !== existingQueries ? mergedQueries : "";

    /** @type {Array<{ range: string, values: string[][] }>} */
    const data = [];
    if (name) data.push({ range: `${tab}!${colL(3)}${rowNumber}`, values: [[name]] });
    if (mobile) data.push({ range: `${tab}!${colL(4)}${rowNumber}`, values: [[mobile]] });
    if (email) data.push({ range: `${tab}!${colL(5)}${rowNumber}`, values: [[email]] });
    if (channel) data.push({ range: `${tab}!${colL(6)}${rowNumber}`, values: [[channel]] });
    if (repeated) data.push({ range: `${tab}!${repeatedCol.repeatedColLetter}${rowNumber}`, values: [[repeated]] });
    if (sourceUrl) data.push({ range: `${tab}!${colL(9)}${rowNumber}`, values: [[sourceUrl]] });
    if (deviceType) data.push({ range: `${tab}!${colL(11)}${rowNumber}`, values: [[deviceType]] });
    if (browserName) data.push({ range: `${tab}!${colL(12)}${rowNumber}`, values: [[browserName]] });
    if (city) data.push({ range: `${tab}!${colL(13)}${rowNumber}`, values: [[city]] });
    if (ip) data.push({ range: `${tab}!${colL(14)}${rowNumber}`, values: [[ip]] });
    if (appointmentBookedPatch !== null) {
        data.push({ range: `${tab}!${colL(15)}${rowNumber}`, values: [[appointmentBookedPatch]] });
    }
    if (appointmentDate) {
        const apptDateCell = sheetAppointmentDateCellValue_(appointmentDate);
        if (apptDateCell !== "") {
            data.push({ range: `${tab}!${colL(16)}${rowNumber}`, values: [[apptDateCell]] });
        }
    }
    if (appointmentTime) data.push({ range: `${tab}!${colL(17)}${rowNumber}`, values: [[appointmentTime]] });
    if (fileLinks) data.push({ range: `${tab}!${colL(18)}${rowNumber}`, values: [[fileLinks]] });
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

let sheetSchemaCache_ = {
    tab: "",
    at: 0,
    byKey: /** @type {Record<string, number>} */ ({}),
    headersRaw: /** @type {unknown[]} */ ([])
};

async function getHeaderIndexMap_(sheets, tab) {
    const now = Date.now();
    if (sheetSchemaCache_.tab === tab && now - sheetSchemaCache_.at < HEADER_CACHE_TTL_MS) {
        return sheetSchemaCache_.byKey;
    }
    /** @type {Record<string, number>} */
    const byKey = {};
    /** @type {unknown[]} */
    let headersRaw = [];
    try {
        const got = await sheetsValuesGet_(sheets, {
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!1:1`
        });
        const header = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        headersRaw = header;
        for (let i = 0; i < header.length; i += 1) {
            const k = normalizedHeaderKey_(sheetCellString_(header[i]));
            if (k && byKey[k] === undefined) {
                byKey[k] = i;
            }
        }
    } catch {
        // ignore
    }
    sheetSchemaCache_ = { tab, at: now, byKey, headersRaw };
    return byKey;
}

/** Reuse last-row / grid metadata between viewer + stats within one page load. */
let conversationSheetScanCache_ = {
    tab: "",
    at: 0,
    nLast: 0,
    gridRows: 0,
    hardCap: 8000
};

const CONVERSATION_SHEET_SCAN_CACHE_TTL_MS = 90_000;

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 */
async function getConversationSheetScanMeta_(sheets, tab) {
    const now = Date.now();
    const hardCap = conversationSheetScanHardCap_();
    if (
        conversationSheetScanCache_.tab === tab
        && now - conversationSheetScanCache_.at < CONVERSATION_SHEET_SCAN_CACHE_TTL_MS
        && conversationSheetScanCache_.hardCap === hardCap
    ) {
        return conversationSheetScanCache_;
    }
    await getHeaderIndexMap_(sheets, tab);
    const gridRows = await conversationSheetGridRowCount_(sheets, tab);
    const nLast = await conversationSheetLastDataRow1Based_(sheets, tab, hardCap, gridRows);
    conversationSheetScanCache_ = { tab, at: now, nLast, gridRows, hardCap };
    return conversationSheetScanCache_;
}

let conversationLeadStatsCache_ = {
    key: "",
    at: 0,
    payload: /** @type {Record<string, unknown>|null} */ (null)
};

const LEAD_STATS_RESPONSE_CACHE_TTL_MS = 60_000;

/** One wide values fetch shared by viewer + stats on the same reload. */
let conversationSheetBlockCache_ = {
    key: "",
    at: 0,
    rows: /** @type {unknown[][]} */ ([])
};

const SHEET_BLOCK_CACHE_TTL_MS = 60_000;

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} endCol0
 * @param {number} nLast
 */
async function getConversationSheetDataBlock_(sheets, tab, endCol0, nLast) {
    const key = `${tab}|${nLast}|${endCol0}`;
    const now = Date.now();
    if (
        conversationSheetBlockCache_.key === key
        && now - conversationSheetBlockCache_.at < SHEET_BLOCK_CACHE_TTL_MS
        && Array.isArray(conversationSheetBlockCache_.rows)
    ) {
        return conversationSheetBlockCache_.rows;
    }
    const rows = await fetchSheetValuesRangeChunked_(sheets, tab, 0, endCol0, nLast);
    conversationSheetBlockCache_ = { key, at: now, rows };
    return rows;
}

function sleepMs_(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function sheetsApiQuotaHit_(err) {
    const msg = String(
        (err && /** @type {{ message?: string }} */ (err).message) || err || ""
    ).toLowerCase();
    return (
        msg.includes("quota exceeded")
        || msg.includes("rate limit")
        || msg.includes("resource_exhausted")
        || msg.includes("429")
    );
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {import("googleapis").sheets_v4.Params$Resource$Spreadsheets$Values$Get} params
 */
async function sheetsValuesGet_(sheets, params) {
    let attempt = 0;
    const maxAttempts = 4;
    while (attempt < maxAttempts) {
        try {
            return await sheets.spreadsheets.values.get(params);
        } catch (err) {
            attempt += 1;
            if (!sheetsApiQuotaHit_(err) || attempt >= maxAttempts) {
                throw err;
            }
            await sleepMs_(1500 * attempt);
        }
    }
    throw new Error("Sheets values.get failed after retries.");
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

/** @param {Record<string, number>} headerMap @param {string[]} aliases @returns {number|undefined} */
function firstHeaderIdxFromAliases_(headerMap, aliases) {
    for (let i = 0; i < aliases.length; i += 1) {
        const k = normalizedHeaderKey_(aliases[i]);
        if (k && headerMap[k] !== undefined) {
            return headerMap[k];
        }
    }
    return undefined;
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
    "user_email",
    "contactemail",
    "contact_email",
    "email_id",
    "e_mail_address",
    "mail_id",
    "customeremail",
    "customer_email",
    "leademail",
    "lead_email",
    "clientemail",
    "client_email"
];
const SHEET_H_CHANNEL = [
    "channel",
    "channels",
    "whatsapp",
    "whatsappchannel",
    "chatsource",
    "sourcechannel",
    "communicationchannel",
    "chatchannel",
    "userchannel",
    "entrychannel",
    "originchannel",
    "platformchannel"
];

const SHEET_H_CITY = [
    "city",
    "visitorcity",
    "usercity",
    "cityname",
    "location",
    "preferredcity",
    "geocity",
    "homecity"
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

/** Header aliases for “Appointment booked” / scheduled (stats); default sheet column index 15 (same as ingest). */
const SHEET_H_APPOINTMENT_BOOKED = [
    "appointmentbooked",
    "appointment_booked",
    "isappointmentbooked",
    "appointmentscheduled",
    "appointmentstatus",
    "appointmentbookingstatus",
    "appointmentconfirmation",
    "consultbooked",
    "consultscheduled",
    "appointmentdone",
    "apptstatus",
    "apptbooking",
    "apptscheduled",
    "consultbooking",
    "bookedappointment",
    "bookingdone",
    "bookingstatus"
];

/** Stats: separate date / time columns (default schema ~ O / P, 0-based 15 / 16). */
const SHEET_H_APPOINTMENT_DATE = [
    "appointmentdate",
    "apptdate",
    "appointmentday",
    "selectedappointmentdate",
    "appointmentpickeddate",
    "dateofappointment",
    "scheduleddate",
    "apptscheduleddate"
];
const SHEET_H_APPOINTMENT_TIME = [
    "appointmenttime",
    "appttime",
    "appointmenttimeslot",
    "scheduledtime",
    "apptscheduledtime",
    "slottime"
];

/** Combined appointment timestamp in one column (detect when date+time not split). */
const SHEET_H_APPOINTMENT_DATETIME = [
    "appointmentdatetime",
    "appointment_date_time",
    "apptdatetime",
    "appointment_at",
    "scheduledatetime",
    "scheduledat",
    "bookedat",
    "booked_datetime"
];

/**
 * Infer “appointment booked / scheduled?” column — ignore pure date/time headers.
 *
 * @param {Record<string, number>} headerMap
 * @param {unknown[]} headersRaw
 * @param {number} fallbackIdx
 * @returns {number}
 */
function pickAppointmentStatsColumnIdx_(headerMap, headersRaw, fallbackIdx) {
    for (let a = 0; a < SHEET_H_APPOINTMENT_BOOKED.length; a += 1) {
        const nk = normalizedHeaderKey_(SHEET_H_APPOINTMENT_BOOKED[a]);
        if (nk && headerMap[nk] !== undefined) {
            return headerMap[nk];
        }
    }
    const denyKeys = [
        "appointmentdate",
        "appointmenttime",
        "appointmentdatetime",
        "appttime",
        "apptdate",
        "appointmentday",
        "dayofappointment",
        "selectedappointmentdate",
        "appointmentpickeddate",
        "dateofappointment"
    ];
    const deny = new Set(denyKeys.map((x) => normalizedHeaderKey_(x)));
    for (let i = 0; i < headersRaw.length; i += 1) {
        const k = normalizedHeaderKey_(sheetCellString_(headersRaw[i]));
        if (!k || deny.has(k)) {
            continue;
        }
        if (
            /appointment/.test(k)
            && /(book|schedul|confirm|consult|booking|ticket|completed|reserved|reservedflag|chk|tick)/.test(k)
            && !/^(only)?date|^daytime$|^timestamp$/.test(k)
        ) {
            return i;
        }
    }
    return fallbackIdx;
}

/** Header aliases for conversation date column (stats + period filter); default column B index 1 when column A is chat transcript. */
const SHEET_H_CONV_DATE_CELL = [
    "conversationdate",
    "convdate",
    "convdateonly",
    "conversiondate",
    "date"
];

/** @returns {boolean} */
function isoYyyyMmDdOk_(raw) {
    const d = typeof raw === "string" ? raw.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return false;
    }
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const dd = Number(d.slice(8, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(dd)) {
        return false;
    }
    if (m < 1 || m > 12 || dd < 1 || dd > 31) {
        return false;
    }
    const dt = Date.UTC(y, m - 1, dd);
    const round = new Date(dt);
    return round.getUTCFullYear() === y && round.getUTCMonth() === m - 1 && round.getUTCDate() === dd;
}

/**
 * Normalize row conversation date strings (Sheet “medium” stamps, ISO, DD/MM/YYYY) to milliseconds.
 * @param {unknown} raw
 */
function parseConversationDateCellWide_(raw) {
    const s = typeof raw === "string" ? raw.trim() : sheetCellString_(raw).trim();
    if (!s) {
        return NaN;
    }

    const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (isoDay) {
        const y = Number(isoDay[1]);
        const mo = Number(isoDay[2]);
        const d = Number(isoDay[3]);
        return Date.UTC(y, mo - 1, d, 12, 0, 0);
    }
    const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]((?:\d{2})|(?:\d{4}))\b/.exec(s);
    if (dmy) {
        const dd = Number(dmy[1]);
        const mo = Number(dmy[2]);
        let y = Number(dmy[3]);
        if (Number.isFinite(y) && y >= 0 && y < 100) {
            y += y >= 70 ? 1900 : 2000;
        }
        if (
            Number.isFinite(dd)
            && Number.isFinite(mo)
            && Number.isFinite(y)
            && mo >= 1
            && mo <= 12
            && dd >= 1
            && dd <= 31
        ) {
            return Date.UTC(y, mo - 1, dd, 12, 0, 0);
        }
    }
    const longFmt = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/.exec(s);
    if (longFmt) {
        const dd = Number(longFmt[1]);
        const y = Number(longFmt[3]);
        const monKey = String(longFmt[2] || "").toLowerCase().slice(0, 3);
        /** Month token → 0-based. */
        const monMap =
            /** @type {Record<string, number>} */ ({
                jan: 0,
                feb: 1,
                mar: 2,
                apr: 3,
                may: 4,
                jun: 5,
                jul: 6,
                aug: 7,
                sep: 8,
                oct: 9,
                nov: 10,
                dec: 11
            });
        const mo0 = monMap[monKey];
        if (
            mo0 !== undefined
            && Number.isFinite(dd)
            && dd >= 1
            && dd <= 31
            && Number.isFinite(y)
            && y >= 1970
            && y <= 2100
        ) {
            return Date.UTC(y, mo0, dd, 12, 0, 0);
        }
    }
    const t = Date.parse(s.replace(/,/g, ""));
    return Number.isNaN(t) ? NaN : t;
}

/** @param {number} epochMs */
function conversationRowYmdInSheetTz_(epochMs) {
    if (!Number.isFinite(epochMs)) {
        return "";
    }
    const tz = conversationDateTimeZoneForIntl_();
    const opts = /** @type {Intl.DateTimeFormatOptions} */ ({
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    if (tz) {
        opts.timeZone = tz;
    }
    try {
        return new Intl.DateTimeFormat("en-CA", opts).format(new Date(epochMs));
    } catch {
        return new Intl.DateTimeFormat("en-CA", opts).format(new Date(epochMs));
    }
}

/**
 * Default staff dashboard window: today plus `daysBack` prior calendar days in sheet TZ (default 4 → 5 days).
 * @param {number} [daysBack]
 * @returns {{ from: string, to: string }}
 */
function conversationSheetDefaultDateRange_(daysBack = 4) {
    const back = Math.max(0, Math.min(90, Number.parseInt(String(daysBack), 10) || 4));
    const to = conversationRowYmdInSheetTz_(Date.now());
    const parts = to.split("-").map((x) => Number.parseInt(String(x), 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return { from: to, to };
    }
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    dt.setUTCDate(dt.getUTCDate() - back);
    return { from: conversationRowYmdInSheetTz_(dt.getTime()), to };
}

/** Max rows materialized when a date filter matches (avoids OOM on wide tabs). */
function conversationSheetDateFilterMaxRows_() {
    return Math.min(
        50_000,
        Math.max(
            500,
            Number.parseInt(
                String(
                    (process.env.CONVERSATIONS_SHEET_DATE_FILTER_MAX_ROWS || "").trim() || "50000"
                ),
                10
            ) || 50_000
        )
    );
}

/** Max conversation rows returned in one API response (prevents 502/OOM on Railway). */
function conversationSheetViewerReturnMaxRows_() {
    return Math.min(
        10_000,
        Math.max(
            200,
            Number.parseInt(
                String(
                    (process.env.CONVERSATIONS_SHEET_VIEW_RETURN_MAX_ROWS || "").trim() || "2500"
                ),
                10
            ) || 2500
        )
    );
}

/**
 * Build a sparse row object (non-empty cells only) to shrink JSON payloads.
 * @param {unknown[]} cells padded row
 * @param {string[]} headers
 * @returns {Record<string, string>|null}
 */
function conversationRowFromCells_(cells, headers) {
    let hasAny = false;
    /** @type {Record<string, string>} */
    const o = {};
    for (let c = 0; c < headers.length; c += 1) {
        const v = sheetCellString_(cells[c]);
        if (v) {
            o[headers[c]] = v;
            hasAny = true;
        }
    }
    return hasAny ? o : null;
}

/**
 * @param {string} tab
 * @param {string} title
 * @param {{ applied: boolean, serverApplied?: boolean, serverDefaultRange?: boolean, from: string|null, to: string|null }} dateFilter
 * @param {number} nLast
 * @param {number} gridRows
 * @param {number} hardCap
 * @param {unknown[]} headersRaw
 * @param {number} dateIdx
 * @param {number} mobileIdx
 * @param {number} emailIdx
 * @param {number} channelIdx
 * @param {number} appointmentBookedIdx
 */
function leadCaptureStatsShellForViewer_(
    tab,
    title,
    dateFilter,
    nLast,
    gridRows,
    hardCap,
    headersRaw,
    dateIdx,
    mobileIdx,
    emailIdx,
    channelIdx,
    appointmentBookedIdx
) {
    const tz = conversationDateTimeZoneForIntl_();
    return {
        tab,
        title,
        timezoneNote:
            tz === undefined ? "server default (SHEETS_CONV_DATETIME_TZ empty)" : `IANA TZ: ${tz}`,
        dateFilter,
        scan: {
            sheetLastRow1Based: nLast,
            sheetGridRowCount: gridRows > 0 ? gridRows : null,
            dataRowsConsidered: 0,
            scanHardCapEnv: hardCap
        },
        columns: {
            dateIdx0: dateIdx,
            mobileIdx0: mobileIdx,
            emailIdx0: emailIdx,
            channelIdx0: channelIdx,
            appointmentBookedIdx0: appointmentBookedIdx,
            dateHeader: sheetCellString_(headersRaw[dateIdx])
                ? sheetCellString_(headersRaw[dateIdx])
                : `Column_${dateIdx + 1}`,
            mobileHeader: sheetCellString_(headersRaw[mobileIdx])
                ? sheetCellString_(headersRaw[mobileIdx])
                : `Column_${mobileIdx + 1}`,
            emailHeader: sheetCellString_(headersRaw[emailIdx])
                ? sheetCellString_(headersRaw[emailIdx])
                : `Column_${emailIdx + 1}`,
            channelHeader: sheetCellString_(headersRaw[channelIdx])
                ? sheetCellString_(headersRaw[channelIdx])
                : `Column_${channelIdx + 1}`,
            appointmentBookedHeader: sheetCellString_(headersRaw[appointmentBookedIdx])
                ? sheetCellString_(headersRaw[appointmentBookedIdx])
                : `Column_${appointmentBookedIdx + 1}`
        },
        totals: {
            conversations: 0,
            onlyMobile: 0,
            onlyEmail: 0,
            mobileAndEmail: 0,
            neither: 0,
            rowsSkippedNoParsableDate: 0,
            leadsCaptured: 0,
            appointmentScheduled: 0,
            appointmentBooked: 0,
            channelWeb: 0,
            channelWhatsapp: 0,
            channelInstagram: 0,
            channelFacebook: 0,
            channelOther: 0,
            onlyMobileByChannel: leadSegmentChannelTotalsEmpty_(),
            onlyEmailByChannel: leadSegmentChannelTotalsEmpty_(),
            mobileAndEmailByChannel: leadSegmentChannelTotalsEmpty_()
        },
        ratios: {
            onlyMobile: "0 / 0",
            onlyEmail: "0 / 0",
            mobileAndEmail: "0 / 0",
            leads: "0 / 0",
            leadCapturePct: null
        }
    };
}

/** True when the cell is only a person name (no phone/email) — must not count as a lead. */
function sheetCellLooksLikeNameOnly_(raw) {
    const s = sheetCellString_(raw).trim();
    if (!s || s.includes("@")) {
        return false;
    }
    if (mobileDigitsOnly(s).length >= 7) {
        return false;
    }
    if (!/[a-zA-Z]/.test(s)) {
        return false;
    }
    return /^[a-zA-Z\s.'-]+$/.test(s);
}

/** Lead stats: mobile column only — needs real digits; name-only text is not a lead. */
function sheetCellHasLeadMobile_(raw) {
    if (sheetCellLooksLikeLeadEmail_(raw) || sheetCellLooksLikeNameOnly_(raw)) {
        return false;
    }
    const s = sheetCellString_(raw).trim();
    if (!s || !/\d/.test(s)) {
        return false;
    }
    const key = mobileKeyFromCell_(raw);
    return mobileDigitsOnly(key).length >= 7;
}

/**
 * One value per sheet data row from a single-column `values.get` (row 2..n).
 * @param {unknown} matrix
 * @returns {unknown[]}
 */
function sheetSingleColumnValuesList_(matrix) {
    if (!Array.isArray(matrix)) {
        return [];
    }
    return matrix.map((row) => (Array.isArray(row) ? row[0] : undefined));
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} colIdx0
 * @param {number} lastRow1Based
 * @returns {Promise<unknown[]>}
 */
/**
 * Few large `values.get` calls (not many per-column reads) to stay under Sheets read quota.
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} startCol0
 * @param {number} endCol0
 * @param {number} lastRow1Based
 * @param {number} [firstRow1Based]
 * @returns {Promise<unknown[][]>}
 */
async function fetchSheetValuesRangeChunked_(sheets, tab, startCol0, endCol0, lastRow1Based, firstRow1Based = 2) {
    if (lastRow1Based < 2 || endCol0 < startCol0) {
        return [];
    }
    const left = columnLetterFromIndex_(startCol0);
    const right = columnLetterFromIndex_(endCol0);
    const chunkRows = conversationSheetScanHardCap_();
    /** @type {unknown[][]} */
    const merged = [];
    let startRow = Math.max(2, firstRow1Based);
    while (startRow <= lastRow1Based) {
        const endRow = Math.min(lastRow1Based, startRow + chunkRows - 1);
        const got = await sheetsValuesGet_(sheets, {
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!${left}${startRow}:${right}${endRow}`
        });
        const part = Array.isArray(got.data.values) ? got.data.values : [];
        merged.push(...part);
        startRow = endRow + 1;
    }
    return merged;
}

/** Pad sparse Values API rows so column indexes match sheet columns (trailing empties omitted). */
function padSheetRow_(cells, minCols) {
    const row = Array.isArray(cells) ? cells.slice() : [];
    const n = typeof minCols === "number" && minCols > 0 ? minCols : 0;
    while (row.length < n) {
        row.push("");
    }
    return row;
}

/**
 * Prefer dedicated column fetch (aligned with data row count); fall back to padded wide row.
 * @param {unknown[]} colVals
 * @param {number} dataRowCount
 * @param {number} ri
 * @param {unknown[]} cells padded wide row
 * @param {number} idx0
 */
function leadStatsCellAt_(colVals, dataRowCount, ri, cells, idx0) {
    if (Array.isArray(colVals) && colVals.length === dataRowCount && ri < colVals.length) {
        return colVals[ri];
    }
    return cells[idx0];
}

/** Build a padded row from per-column Values API arrays (date-filtered stats; avoids full-sheet load). */
function leadStatsCellsFromColumns_(ri, padWidth, /** @type {Record<number, unknown[]>} */ idxToCol) {
    const cells = padSheetRow_([], padWidth);
    for (const key of Object.keys(idxToCol)) {
        const idx = Number(key);
        const vals = idxToCol[idx];
        if (Array.isArray(vals) && ri < vals.length) {
            cells[idx] = vals[ri];
        }
    }
    return cells;
}

function sheetRowHasAnyCell_(cells) {
    for (let ci = 0; ci < cells.length; ci += 1) {
        if (!isBlankSheetCell_(cells[ci])) {
            return true;
        }
    }
    return false;
}

/** @param {unknown[]} cells @param {number} mobileIdx @param {number} [emailIdx] */
function sheetRowHasLeadMobile_(cells, mobileIdx, emailIdx) {
    if (sheetCellHasLeadMobile_(cells[mobileIdx])) {
        return true;
    }
    const key = mobileKeyFromRow_(cells, mobileIdx);
    if (mobileDigitsOnly(key).length >= 7) {
        return true;
    }
    const emIdx =
        typeof emailIdx === "number" && Number.isFinite(emailIdx) ? emailIdx : -1;
    for (let i = 0; i < cells.length; i += 1) {
        if (i === mobileIdx || i === emIdx) {
            continue;
        }
        if (sheetCellLooksLikeLeadEmail_(cells[i])) {
            continue;
        }
        if (sheetCellHasLeadMobile_(cells[i])) {
            return true;
        }
    }
    return false;
}

/** @param {unknown[]} cells @param {number} emailIdx */
function sheetRowHasLeadEmail_(cells, emailIdx) {
    if (sheetCellHasLeadEmail_(cells[emailIdx])) {
        return true;
    }
    for (let i = 0; i < cells.length; i += 1) {
        if (i === emailIdx) {
            continue;
        }
        if (sheetCellHasLeadEmail_(cells[i])) {
            return true;
        }
    }
    return false;
}

function sheetCellHasLeadEmail_(raw) {
    return sheetCellLooksLikeLeadEmail_(raw);
}

function rowNumberFromUpdatedRange_(updatedRange) {
    const s = typeof updatedRange === "string" ? updatedRange : "";
    const m = s.match(/!([A-Z]+)(\d+)(?::[A-Z]+(\d+))?$/);
    const rowNumber = m && m[2] ? Number.parseInt(m[2], 10) : 0;
    return Number.isFinite(rowNumber) ? rowNumber : 0;
}

/**
 * Lead sheet column A: `=HYPERLINK(...)` to staff transcript when `CONVERSATIONS_PUBLIC_BASE_URL` (or Railway) + session exist.
 * Otherwise, when `rowNumber` ≥ 2, link to this row in the spreadsheet. Pass `rowNumber` **0** before the row exists (only transcript URL is returned when base + session exist).
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tabTitle
 * @param {number} rowNumber 1-based sheet row, or **0** if not yet appended
 * @param {string} clientSessionId
 * @returns {Promise<string>} formula or ""
 */
async function conversationLinkFormulaForLeadSheetCell_(sheets, tabTitle, rowNumber, clientSessionId) {
    const sid = typeof clientSessionId === "string" ? clientSessionId.trim() : "";
    const base = resolvedConversationsPublicBaseUrl_();
    if (base && sid) {
        const url = `${base}/conversation-transcript?session=${encodeURIComponent(sid)}`;
        const label = "Chat link";
        return `=HYPERLINK("${url.replace(/"/g, '""')}","${label.replace(/"/g, '""')}")`;
    }
    if (SPREADSHEET_ID && rowNumber >= 2) {
        try {
            const gid = await getSheetIdForTitle_(sheets, tabTitle);
            const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${gid}#range=A${rowNumber}`;
            const label = "Open row";
            return `=HYPERLINK("${url.replace(/"/g, '""')}","${label.replace(/"/g, '""')}")`;
        } catch {
            return "";
        }
    }
    return "";
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tabTitle
 * @param {number} rowNumber 1-based
 * @param {string} clientSessionId
 */
async function maybeWriteLeadConvLinkColumnA_(sheets, tabTitle, rowNumber, clientSessionId) {
    if (!rowNumber || rowNumber < 2) {
        return;
    }
    const f = await conversationLinkFormulaForLeadSheetCell_(sheets, tabTitle, rowNumber, clientSessionId);
    if (!f) {
        return;
    }
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetA1TabPrefix_(tabTitle)}!A${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[f]] }
        });
    } catch (e) {
        const m = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        console.warn("[chatbot-api] Lead Conv. link column A write failed:", m.slice(0, 240));
    }
}

/**
 * Writes a clickable cell: prefers `/conversation-transcript?session=…` when a public API base URL
 * (CONVERSATIONS_PUBLIC_BASE_URL or Railway RAILWAY_PUBLIC_DOMAIN / RAILWAY_STATIC_URL) and session id exist.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tabTitle Worksheet title (not RANGE prefix).
 * @param {number} rowNumber 1-based sheet row
 * @param {string} [clientSessionId]
 */
async function maybeWriteSheetRowOpenLink_(sheets, tabTitle, rowNumber, clientSessionId = "") {
    const col = SHEETS_ROW_OPEN_LINK_COLUMN;
    if (!col || !/^[A-Z]{1,3}$/.test(col) || rowNumber < 2) {
        return;
    }
    if (col === "A") {
        return;
    }
    const colIdx0 = columnLetterToIndex0_(col);
    if (colIdx0 === STANDARD_DOCUMENT_COL_INDEX0) {
        return;
    }
    const sid = typeof clientSessionId === "string" ? clientSessionId.trim() : "";
    /** @type {string} */
    let url = "";
    /** @type {string} */
    let label = "Open row";
    const base = resolvedConversationsPublicBaseUrl_();
    if (base && sid) {
        url = `${base}/conversation-transcript?session=${encodeURIComponent(sid)}`;
        label = "Chat transcript";
    } else if (SPREADSHEET_ID) {
        try {
            const gid = await getSheetIdForTitle_(sheets, tabTitle);
            url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${gid}#range=A${rowNumber}`;
            label = "Open row";
        } catch {
            return;
        }
    } else {
        return;
    }
    try {
        const formula = `=HYPERLINK("${url.replace(/"/g, '""')}","${label.replace(/"/g, '""')}")`;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetA1TabPrefix_(tabTitle)}!${col}${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[formula]] }
        });
    } catch (e) {
        const m = e && /** @type {{ message?: string }} */ (e).message
            ? String(/** @type {{ message?: string }} */ (e).message)
            : String(e);
        console.warn("[chatbot-api] SHEETS_ROW_OPEN_LINK_COLUMN write failed:", m);
    }
}

/** Row-1 headers for **JSON** storage only — not “Chat script” in column A (that is the Conv. link). */
const CHAT_TRANSCRIPT_JSON_HEADER_ALIASES = [
    "chat_transcript_json",
    "chattranscriptjson",
    "df_chat_transcript_json",
    "conversation_transcript_json",
    "bot_transcript_json",
    "assistant_transcript_json",
    "chat transcript json",
    "transcriptjson",
    "chathistoryjson"
];

/** @param {number} idx0 */
function isReservedColumnForChatTranscriptJson_(idx0) {
    return idx0 === STANDARD_CHAT_SCRIPT_LINK_COL_INDEX0 || idx0 === STANDARD_DOCUMENT_COL_INDEX0;
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @returns {Promise<string>}
 */
async function resolveChatTranscriptColumnLetter_(sheets, tab) {
    const envCol = SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN.replace(/[^A-Z]/g, "");
    if (/^[A-Z]{1,3}$/.test(envCol)) {
        const envIdx = columnLetterToIndex0_(envCol);
        if (!isReservedColumnForChatTranscriptJson_(envIdx)) {
            return envCol;
        }
        console.warn(
            "[chatbot-api] SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN must not be A (Chat script link) or S (Document); JSON sheet writes skipped."
        );
        return "";
    }
    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const transcriptIdx = firstHeaderIdxFromAliases_(headerMap, CHAT_TRANSCRIPT_JSON_HEADER_ALIASES);
    if (transcriptIdx !== undefined && !isReservedColumnForChatTranscriptJson_(transcriptIdx)) {
        return columnLetterFromIndex_(transcriptIdx);
    }
    return "";
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tab
 * @param {number} rowNumber
 * @param {string} chatTranscriptJson
 */
async function maybeWriteChatTranscriptJsonToSheetCell_(sheets, tab, rowNumber, chatTranscriptJson, opts) {
    const forceSessionSync = !!(opts && opts.sessionSync === true);
    if (!SHEETS_WRITE_CHAT_TRANSCRIPT_JSON && !forceSessionSync) {
        return false;
    }
    const raw = typeof chatTranscriptJson === "string" ? chatTranscriptJson.trim() : "";
    if (!raw || !rowNumber || rowNumber < 1) {
        return false;
    }
    const letter = await resolveChatTranscriptColumnLetter_(sheets, tab);
    if (!letter) {
        return false;
    }
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!${letter}${rowNumber}`,
            valueInputOption: "RAW",
            requestBody: { values: [[raw]] }
        });
        return true;
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.warn("[chatbot-api] Chat transcript JSON column write failed:", msg.slice(0, 240));
        return false;
    }
}

/**
 * User Queries cell for the lead row with this session id (for transcript API fallback).
 *
 * @param {string} sessionId
 * @returns {Promise<{ csv: string, rowNumber: number }>}
 */
export async function fetchLeadSheetUserQueriesForSession(sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || !SPREADSHEET_ID) {
        return { csv: "", rowNumber: 0 };
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);
    const rowNumber = await findSessionRowNumberBySessionId_(sheets, tab, sid);
    if (!rowNumber) {
        return { csv: "", rowNumber: 0 };
    }
    const queriesCol = await getUserQueriesColumnInfo_(sheets, tab);
    const got = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!${queriesCol.colLetter}${rowNumber}:${queriesCol.colLetter}${rowNumber}`
    });
    const row0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
    const csv = sheetCellString_(row0[0]);
    return { csv, rowNumber };
}

/**
 * One lead row on the configured tab, keyed by header labels (matches Google Sheet columns).
 *
 * @param {string} sessionId
 * @returns {Promise<{ rowNumber: number, columns: Record<string, string> } | null>}
 */
export async function fetchLeadSheetRowKeyValuesForSession(sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || !SPREADSHEET_ID) {
        return null;
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);
    const rowNumber = await findSessionRowNumberBySessionId_(sheets, tab, sid);
    if (!rowNumber) {
        return null;
    }
    const maxCol0 = 40;
    const lastLetter = columnLetterFromIndex_(maxCol0);
    const hGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A1:${lastLetter}1`
    });
    const dGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${rowNumber}:${lastLetter}${rowNumber}`
    });
    const headers = Array.isArray(hGot.data.values) && hGot.data.values[0] ? hGot.data.values[0] : [];
    const cells = Array.isArray(dGot.data.values) && dGot.data.values[0] ? dGot.data.values[0] : [];
    /** @type {Record<string, number>} */
    const seen = {};
    /** @type {Record<string, string>} */
    const columns = {};
    for (let i = 0; i < Math.max(headers.length, cells.length); i += 1) {
        const hRaw = headers[i];
        let label =
            typeof hRaw === "string" && hRaw.trim()
                ? hRaw.trim()
                : `Column ${columnLetterFromIndex_(i)}`;
        const v = sheetCellString_(cells[i]).trim();
        if (!v) {
            continue;
        }
        const n = (seen[label] || 0) + 1;
        seen[label] = n;
        if (n > 1) {
            label = `${label} (${n})`;
        }
        columns[label] = v;
    }
    return { rowNumber, columns };
}

/**
 * Reads optional JSON `chat_transcript` cell for this session (see SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN / header aliases).
 *
 * @param {string} sessionId
 * @returns {Promise<{ raw: string, rowNumber: number }>}
 */
export async function fetchLeadSheetChatTranscriptJsonForSession(sessionId) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || !SPREADSHEET_ID) {
        return { raw: "", rowNumber: 0 };
    }
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);
    const rowNumber = await findSessionRowNumberBySessionId_(sheets, tab, sid);
    if (!rowNumber) {
        return { raw: "", rowNumber: 0 };
    }
    const letter = await resolveChatTranscriptColumnLetter_(sheets, tab);
    if (!letter) {
        return { raw: "", rowNumber };
    }
    try {
        const got = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!${letter}${rowNumber}:${letter}${rowNumber}`
        });
        const row0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const raw = sheetCellString_(row0[0]);
        return { raw, rowNumber };
    } catch {
        return { raw: "", rowNumber };
    }
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

    // Prefer declared A–S schema (Chat transcript, Date, Time, then lead fields…); aliases correct column when order differs.
    put(
        [
            "conversationdate",
            "convdate",
            "convdateonly",
            "conversiondate",
            "date"
        ],
        1,
        sheetConvDateCellValue_(lead.convDate)
    );
    put(
        [
            "conversationtime",
            "convtime",
            "convtimeonly",
            "conversiontime",
            "time"
        ],
        2,
        sheetConvDateOrTimeCell_(lead.convTime)
    );
    put(SHEET_H_NAME, 3, lead.name);
    put(SHEET_H_MOBILE, 4, lead.mobile);
    put(SHEET_H_EMAIL, 5, lead.email);
    put(["channel"], 6, formatChannelForSheetDisplay(lead.channel));
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
        7,
        lead.userQueriesCsv
    );
    put(["repeateduser", "repeated_user", "isrepeated", "repuser"], 8, lead.repeated);
    put(["sourceurl", "source_url", "pageurl", "embedurl"], 9, lead.sourceUrl);
    put(SHEET_H_SESSION, 10, lead.clientSessionId);
    put(["device", "devicetype"], 11, formatDeviceTypeForSheetDisplay(lead.deviceType));
    put(["browser", "browsername"], 12, lead.browserName);
    put(
        ["city", "visitorcity", "usercity", "cityname", "location", "preferredcity"],
        13,
        lead.city
    );
    put(["ip", "ipaddress", "ip_address"], 14, lead.ip);
    // Prefer exact "Appointment Booked" match only — aliases like `appointment` would hit Date/Time headers.
    put(["appointmentbooked", "appointment_booked", "isappointmentbooked"], 15, lead.appointmentBooked);
    put(["appointmentdate"], 16, lead.appointmentDate);
    put(["appointmenttime"], 17, lead.appointmentTime);
    put(
        ["document", "documents", "drivefilelink", "drive file link", "drivefile", "filelink", "filelinks", "drivelink"],
        18,
        lead.driveFileLink
    );

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
    const appointmentBookedRaw = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentBooked = appointmentBookedSheetValue_(appointmentBookedRaw);
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
    const repeated = repeatedUserLabelFromRepeatedFlag_(!!(scanFull && scanFull.repeatedAcrossSessions));

    const parts = conversationPartsFromIncomingRow_(row);

    const lead = {
        convDate: parts.convDate,
        convTime: parts.convTime,
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        clientSessionId: row.clientSessionId,
        deviceType: formatDeviceTypeForSheetDisplay(typeof row.deviceType === "string" ? row.deviceType.trim() : ""),
        browserName: row.browserName,
        channel: formatChannelForSheetDisplay(ch),
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
 * Default columns A–S (no Form ID), matching typical lead headers:
 * Conv. link (HYPERLINK in A), Conv. Date, Conv. Time, Name, Mobile, Email, Channel, User Queries,
 * Repeated User, Source URL, Session id, Device, Browser, City, IP Address, App. Booked, App. Date, App. Time, Document.
 * Widget `chat_transcript` JSON is written to column **T** by default (see `SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN`).
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
        const repeated = repeatedUserLabelFromRepeatedFlag_(scanFull.repeatedAcrossSessions);
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
        if (SYNC_DASHBOARD_ON_APPEND && patched) {
            void writeLeadCaptureDashboardToSheet2({}).catch((e) => {
                const msg = e && /** @type {{ message?: string }} */ (e).message
                    ? String(/** @type {{ message?: string }} */ (e).message)
                    : String(e);
                console.warn("[chatbot-api] Dashboard tab sync failed:", msg);
            });
        }
        await maybeWriteLeadConvLinkColumnA_(sheets, tabResolved, scan.matchedRowNumber, row.clientSessionId);
        await maybeWriteSheetRowOpenLink_(sheets, tabResolved, scan.matchedRowNumber, row.clientSessionId);
        if (typeof row.chatTranscriptJson === "string" && row.chatTranscriptJson.trim()) {
            await maybeWriteChatTranscriptJsonToSheetCell_(
                sheets,
                tabResolved,
                scan.matchedRowNumber,
                row.chatTranscriptJson
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

    const chRaw = typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : "web";
    const ch = formatChannelForSheetDisplay(chRaw);
    const deviceForAppend = formatDeviceTypeForSheetDisplay(
        typeof row.deviceType === "string" ? row.deviceType.trim() : ""
    );
    const fileLinks =
        typeof row.fileLinks === "string" && row.fileLinks.trim()
            ? row.fileLinks.trim()
            : "";
    const city = typeof row.city === "string" ? row.city.trim() : "";
    const ip = typeof row.ip === "string" ? row.ip.trim() : "";
    const sourceUrl = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const appointmentBookedRaw = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentBooked = appointmentBookedSheetValue_(appointmentBookedRaw);
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const userQueriesCsv = sanitizeUserQueriesCsvForSheet(
        typeof row.userQueriesCsv === "string" ? row.userQueriesCsv : ""
    );
    const repeated = repeatedUserLabelFromRepeatedFlag_(scanFull.repeatedAcrossSessions);
    const convParts = conversationPartsFromIncomingRow_(row);
    const sid0 = typeof row.clientSessionId === "string" ? row.clientSessionId.trim() : "";
    const colAFormula = await conversationLinkFormulaForLeadSheetCell_(sheets, tabResolved, 0, sid0);
    // Append A–S directly (Conv. link, Date, Time, then lead fields …).
    const values = [[
        colAFormula || "",
        sheetConvDateCellValue_(convParts.convDate),
        sheetConvDateOrTimeCell_(convParts.convTime),
        sheetOutboundCell_(row.name),
        sheetOutboundCell_(row.mobile),
        sheetOutboundCell_(row.email),
        sheetOutboundCell_(ch),
        sheetOutboundCell_(userQueriesCsv),
        sheetOutboundCell_(repeated),
        sheetOutboundCell_(sourceUrl),
        sheetOutboundCell_(row.clientSessionId),
        sheetOutboundCell_(deviceForAppend),
        sheetOutboundCell_(row.browserName),
        sheetOutboundCell_(city),
        sheetOutboundCell_(ip),
        sheetOutboundCell_(appointmentBooked),
        sheetAppointmentDateCellValue_(appointmentDate),
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

    const appendedRowNum = rowNumberFromUpdatedRange_(googleAppend.updatedRange);
    if (appendedRowNum && !colAFormula && sid0) {
        await maybeWriteLeadConvLinkColumnA_(sheets, tabResolved, appendedRowNum, sid0);
    }
    try {
        await ensureSheetDateColumnsFormat_(sheets, tabResolved);
    } catch (fmtColErr) {
        console.warn(
            "[chatbot-api] Sheets date column format:",
            fmtColErr && /** @type {{ message?: string }} */ (fmtColErr).message
                ? String(/** @type {{ message?: string }} */ (fmtColErr).message).slice(0, 200)
                : fmtColErr
        );
    }
    try {
        if (appendedRowNum) {
            await writeLeadRowByHeader_(sheets, tabResolved, appendedRowNum, {
                convDate: convParts.convDate,
                convTime: convParts.convTime,
                name: row.name,
                mobile: row.mobile,
                email: row.email,
                clientSessionId: row.clientSessionId,
                deviceType: deviceForAppend,
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
    await maybeWriteSheetRowOpenLink_(sheets, tabResolved, appendedRowNum, row.clientSessionId);
    if (
        appendedRowNum
        && typeof row.chatTranscriptJson === "string"
        && row.chatTranscriptJson.trim()
    ) {
        await maybeWriteChatTranscriptJsonToSheetCell_(
            sheets,
            tabResolved,
            appendedRowNum,
            row.chatTranscriptJson
        );
    }
    if (SYNC_DASHBOARD_ON_APPEND) {
        void writeLeadCaptureDashboardToSheet2({}).catch((err) => {
            const msg = err && /** @type {{ message?: string }} */ (err).message
                ? String(/** @type {{ message?: string }} */ (err).message)
                : String(err);
            console.warn("[chatbot-api] Dashboard tab sync failed:", msg);
        });
    }
    return {
        action: "appended",
        patched: true,
        tab: tabResolved,
        appendRangeUsed,
        sheetRowNumber: appendedRowNum || undefined,
        googleAppend: Object.keys(googleAppend).length ? googleAppend : undefined
    };
}

/**
 * Find 1-based row number whose Session id column matches (default column K in A–S layout; J or I on older layouts), or any cell.
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
            sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_PRIMARY])
            || sheetCellString_(r[STANDARD_SESSION_COLUMN_INDEX0_PRE_TRANSCRIPT])
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
 * @param {{ iso?: string, convDate?: string, convTime?: string, formId?: string, name: string, mobile: string, email: string, clientSessionId: string, browserName: string, deviceType: string, channel: string, fileLinks?: string, city?: string, ip?: string, userQueriesCsv?: string, chatTranscriptJson?: string }} row
 */
export async function upsertSessionQueriesInSheet(row) {
    if (!SPREADSHEET_ID) {
        throw new Error("Missing SHEETS_SPREADSHEET_ID in env (or set DISABLE_SHEETS=1).");
    }
    const incomingQRaw = typeof row.userQueriesCsv === "string" ? row.userQueriesCsv.trim() : "";
    const incomingQ = sanitizeUserQueriesCsvForSheet(incomingQRaw);
    const chatTranscriptJson =
        typeof row.chatTranscriptJson === "string" ? row.chatTranscriptJson.trim() : "";
    const writeChatTranscriptOnSessionSync = row.writeChatTranscriptOnSessionSync === true;
    if (!incomingQ && !chatTranscriptJson) {
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
            range: `${tab}!A${rowNumber}:S${rowNumber}`
        });
        const r0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
        const existingCsv = sanitizeUserQueriesCsvForSheet(sheetCellString_(r0[queriesCol.colIdx]));
        let merged = existingCsv;
        let queryColumnWritten = false;
        /** @type {{ totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } | null} */
        let googleBatchQueries = null;
        if (incomingQ) {
            const replacePrefix =
                typeof row.replaceCsvPrefix === "string" ? row.replaceCsvPrefix.trim() : "";
            merged = replacePrefix
                ? replacePrefixedCsvSegment_(existingCsv, replacePrefix, incomingQ)
                : mergeCsvUnique_(existingCsv, incomingQ, 200);
            queryColumnWritten = merged !== existingCsv;
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
        }
        // Chat may append a row on mobile first (blank name/email), then capture fields later; session
        // query sync still hits this path — fill blank contact columns without rewriting the queries column twice.
        /** @type {{ applied: boolean, googleBatch?: { totalUpdatedCells?: number, totalUpdatedRows?: number, updatedRanges: string[] } }} */
        let contact = { applied: false };
        if (incomingQ) {
            contact = await updateExistingSessionRow_(
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
        }
        await maybeWriteLeadConvLinkColumnA_(sheets, tab, rowNumber, sid);
        await maybeWriteSheetRowOpenLink_(sheets, tab, rowNumber, sid);
        if (chatTranscriptJson) {
            await maybeWriteChatTranscriptJsonToSheetCell_(sheets, tab, rowNumber, chatTranscriptJson, {
                sessionSync: writeChatTranscriptOnSessionSync
            });
        }
        if (!incomingQ) {
            return {
                mode: "transcript_only_existing_row",
                tab,
                sheetRowNumber: rowNumber,
                chat_transcript_json_written: Boolean(chatTranscriptJson)
            };
        }
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

    if (!incomingQ) {
        return { mode: "skipped_no_session_row_for_transcript" };
    }

    const sheetOutcome = await appendContactRowToSheet(row);
    let appendedRn =
        typeof sheetOutcome.sheetRowNumber === "number" && sheetOutcome.sheetRowNumber > 0
            ? sheetOutcome.sheetRowNumber
            : 0;
    if (chatTranscriptJson && appendedRn) {
        await maybeWriteChatTranscriptJsonToSheetCell_(sheets, tab, appendedRn, chatTranscriptJson, {
            sessionSync: writeChatTranscriptOnSessionSync
        });
    }
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
 * Lead capture breakdown for the Sheet tab — same bounded scan tail as `/api/conversations-sheet`.
 * **Lead (for %):** each conversation row counts as **at most one** lead: only-mobile, only-email, or mobile+email each adds 1 toward `leadsCaptured` (never 2 for the same row).
 * Rows are grouped by plausible Mobile vs Email (`@` mailbox shape, mobile = ≥7 digits).
 * Period filter compares each row's conversation-date cell to `[from, to]` (inclusive calendar days in `SHEETS_CONV_DATETIME_TZ`, default Asia/Kolkata).
 *
 * @param {{ from?: string, to?: string }} [opts]
 * @returns {Promise<{
 *   tab: string,
 *   title: string,
 *   timezoneNote: string,
 *   dateFilter: { applied: boolean, from: string|null, to: string|null },
 *   scan: { sheetLastRow1Based: number, dataRowsConsidered: number, scanHardCapEnv: number },
 *   columns: { dateIdx0: number, mobileIdx0: number, emailIdx0: number, channelIdx0: number, appointmentBookedIdx0: number, dateHeader: string, mobileHeader: string, emailHeader: string, channelHeader: string, appointmentBookedHeader: string },
 *   totals: { conversations: number, onlyMobile: number, onlyEmail: number, mobileAndEmail: number, neither: number, rowsSkippedNoParsableDate: number, leadsCaptured: number, appointmentScheduled: number, appointmentBooked: number, channelWeb: number, channelWhatsapp: number, channelInstagram: number, channelFacebook: number, channelOther: number, onlyMobileByChannel: { web: number, whatsapp: number, instagram: number, facebook: number, other: number }, onlyEmailByChannel: { web: number, whatsapp: number, instagram: number, facebook: number, other: number }, mobileAndEmailByChannel: { web: number, whatsapp: number, instagram: number, facebook: number, other: number } },
 *   ratios: {
 *     onlyMobile: string,
 *     onlyEmail: string,
 *     mobileAndEmail: string,
 *     leads: string,
 *     leadCapturePct: number|null
 *   }
 * }>}
 */
export async function fetchConversationLeadCaptureStats(opts = {}) {
    if (!SPREADSHEET_ID) {
        throw new Error("SHEETS_SPREADSHEET_ID is not set.");
    }
    const tabEarly = tabNameFromRange(RANGE);
    const fromIn = opts && typeof opts.from === "string" ? opts.from.trim() : "";
    const toIn = opts && typeof opts.to === "string" ? opts.to.trim() : "";
    /** @type {string|null} */
    let fromStr = fromIn && isoYyyyMmDdOk_(fromIn) ? fromIn : null;
    /** @type {string|null} */
    let toStr = toIn && isoYyyyMmDdOk_(toIn) ? toIn : null;
    if ((fromIn && !fromStr) || (toIn && !toStr)) {
        throw new Error("Invalid date parameter — use YYYY-MM-DD for from/to.");
    }
    if (fromStr && toStr && fromStr > toStr) {
        const swap = fromStr;
        fromStr = toStr;
        toStr = swap;
    }
    let serverDefaultRange = false;
    if (!fromStr && !toStr) {
        const def = conversationSheetDefaultDateRange_(4);
        fromStr = def.from;
        toStr = def.to;
        serverDefaultRange = true;
    }
    const filterActive = !!(fromStr || toStr);
    let fromEff = "1900-01-01";
    let toEff = "9999-12-31";
    if (filterActive) {
        if (fromStr) {
            fromEff = fromStr;
        }
        if (toStr) {
            toEff = toStr;
        }
    }

    const statsCacheKey = `${tabEarly}|${fromStr || ""}|${toStr || ""}|${serverDefaultRange ? "d" : ""}`;
    const statsCacheNow = Date.now();
    if (
        conversationLeadStatsCache_.key === statsCacheKey
        && statsCacheNow - conversationLeadStatsCache_.at < LEAD_STATS_RESPONSE_CACHE_TTL_MS
        && conversationLeadStatsCache_.payload
    ) {
        return conversationLeadStatsCache_.payload;
    }

    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabEarly;

    let title = "";
    try {
        const titleGot = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: "properties.title"
        });
        title =
            titleGot.data.properties && typeof titleGot.data.properties.title === "string"
                ? titleGot.data.properties.title.trim()
                : "";
    } catch {
        title = "";
    }

    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const headersRaw =
        sheetSchemaCache_.tab === tab && Array.isArray(sheetSchemaCache_.headersRaw)
            ? sheetSchemaCache_.headersRaw
            : [];
    const dateIdx = pickHeaderIndex_(headerMap, SHEET_H_CONV_DATE_CELL, 1);
    const mobileIdx = pickHeaderIndex_(headerMap, SHEET_H_MOBILE, 4);
    const emailIdx = pickHeaderIndex_(headerMap, SHEET_H_EMAIL, 5);
    const channelIdx = pickHeaderIndex_(headerMap, SHEET_H_CHANNEL, 6);
    const appointmentBookedIdx = pickAppointmentStatsColumnIdx_(headerMap, headersRaw, 15);
    const appointmentDateIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_DATE, 16);
    const appointmentTimeIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_TIME, 17);
    const appointmentDatetimeIdx = firstHeaderIdxFromAliases_(headerMap, SHEET_H_APPOINTMENT_DATETIME);

    const scanMeta = await getConversationSheetScanMeta_(sheets, tab);
    const hardCap = scanMeta.hardCap;
    const gridRows = scanMeta.gridRows;
    const nLast = scanMeta.nLast;
    const tz = conversationDateTimeZoneForIntl_();
    const timezoneNote =
        tz === undefined ? "server default (SHEETS_CONV_DATETIME_TZ empty)" : `IANA TZ: ${tz}`;

    const baseEmpty = () => ({
        tab,
        title,
        timezoneNote,
        dateFilter: {
            applied: filterActive,
            from: fromStr,
            to: toStr,
            serverDefaultRange
        },
        scan: {
            sheetLastRow1Based: nLast,
            sheetGridRowCount: gridRows > 0 ? gridRows : null,
            dataRowsConsidered: 0,
            scanHardCapEnv: hardCap
        },
        columns: {
            dateIdx0: dateIdx,
            mobileIdx0: mobileIdx,
            emailIdx0: emailIdx,
            channelIdx0: channelIdx,
            appointmentBookedIdx0: appointmentBookedIdx,
            dateHeader: sheetCellString_(headersRaw[dateIdx])
                ? sheetCellString_(headersRaw[dateIdx])
                : `Column_${dateIdx + 1}`,
            mobileHeader: sheetCellString_(headersRaw[mobileIdx])
                ? sheetCellString_(headersRaw[mobileIdx])
                : `Column_${mobileIdx + 1}`,
            emailHeader: sheetCellString_(headersRaw[emailIdx])
                ? sheetCellString_(headersRaw[emailIdx])
                : `Column_${emailIdx + 1}`,
            channelHeader: sheetCellString_(headersRaw[channelIdx])
                ? sheetCellString_(headersRaw[channelIdx])
                : `Column_${channelIdx + 1}`,
            appointmentBookedHeader: sheetCellString_(headersRaw[appointmentBookedIdx])
                ? sheetCellString_(headersRaw[appointmentBookedIdx])
                : `Column_${appointmentBookedIdx + 1}`
        },
        totals: {
            conversations: 0,
            onlyMobile: 0,
            onlyEmail: 0,
            mobileAndEmail: 0,
            neither: 0,
            rowsSkippedNoParsableDate: 0,
            leadsCaptured: 0,
            appointmentScheduled: 0,
            appointmentBooked: 0,
            channelWeb: 0,
            channelWhatsapp: 0,
            channelInstagram: 0,
            channelFacebook: 0,
            channelOther: 0,
            onlyMobileByChannel: leadSegmentChannelTotalsEmpty_(),
            onlyEmailByChannel: leadSegmentChannelTotalsEmpty_(),
            mobileAndEmailByChannel: leadSegmentChannelTotalsEmpty_()
        },
        ratios: {
            onlyMobile: "0 / 0",
            onlyEmail: "0 / 0",
            mobileAndEmail: "0 / 0",
            leads: "0 / 0",
            leadCapturePct: null
        }
    });

    if (nLast <= 1) {
        return baseEmpty();
    }

    const lastColBound = Math.max(
        headersRaw.length - 1,
        dateIdx,
        mobileIdx,
        emailIdx,
        channelIdx,
        appointmentBookedIdx,
        appointmentDateIdx,
        appointmentTimeIdx,
        appointmentDatetimeIdx === undefined ? appointmentDateIdx : appointmentDatetimeIdx,
        18
    );
    const lastColIdx = Math.min(175, lastColBound);
    const colLetter = columnLetterFromIndex_(lastColIdx);
    const padWidth = lastColIdx + 1;

    /** @type {unknown[][]} */
    let dataRows = [];

    if (filterActive) {
        const apptDtIdx =
            appointmentDatetimeIdx !== undefined && appointmentDatetimeIdx >= 0
                ? appointmentDatetimeIdx
                : -1;
        const blockRows = await getConversationSheetDataBlock_(sheets, tab, lastColIdx, nLast);
        const acc = leadCaptureStatsAccumulatorEmpty_();
        const statCol = {
            mobileIdx,
            emailIdx,
            channelIdx,
            appointmentBookedIdx,
            appointmentDateIdx,
            appointmentTimeIdx,
            apptDtIdx
        };
        for (let ri = 0; ri < blockRows.length; ri += 1) {
            acc.dataRowsConsidered += 1;
            const cells = padSheetRow_(blockRows[ri] || [], padWidth);
            const dateMs = parseConversationDateCellWide_(cells[dateIdx]);
            if (!Number.isFinite(dateMs)) {
                acc.skippedNoDate += 1;
                continue;
            }
            const ymd = conversationRowYmdInSheetTz_(dateMs);
            if (!ymd || ymd < fromEff || ymd > toEff) {
                continue;
            }
            leadCaptureStatsAccumulateRow_(acc, cells, statCol);
        }
        const out = leadCaptureStatsPayloadFromAccumulator_(acc, baseEmpty());
        out.dateFilter.serverApplied = true;
        conversationLeadStatsCache_ = { key: statsCacheKey, at: Date.now(), payload: out };
        return out;
    }

    dataRows = await getConversationSheetDataBlock_(sheets, tab, lastColIdx, nLast);

    let conversations = 0;
    let onlyMobile = 0;
    let onlyEmail = 0;
    let both = 0;
    let neither = 0;
    let skippedNoDate = 0;
    let appointmentScheduled = 0;
    let channelWeb = 0;
    let channelWhatsapp = 0;
    let channelInstagram = 0;
    let channelFacebook = 0;
    let channelOther = 0;
    let onlyMobileByCh = leadSegmentChannelTotalsEmpty_();
    let onlyEmailByCh = leadSegmentChannelTotalsEmpty_();
    let bothByCh = leadSegmentChannelTotalsEmpty_();

    for (let ri = 0; ri < dataRows.length; ri += 1) {
        const cells = padSheetRow_(dataRows[ri] || [], padWidth);
        if (!sheetRowHasAnyCell_(cells)) {
            continue;
        }
        const mobCell = cells[mobileIdx];
        const emCell = cells[emailIdx];
        const chCell = cells[channelIdx];
        /** Lead = valid mobile and/or email in those columns only (name-only rows are not leads). */
        const hasEm = sheetCellHasLeadEmail_(emCell);
        const hasMob = sheetCellHasLeadMobile_(mobCell);
        const channelKey = conversationChannelBucket_(chCell);
        conversations += 1;
        if (hasMob && hasEm) {
            both += 1;
            leadSegmentChannelAdd_(bothByCh, channelKey);
        } else if (hasMob) {
            onlyMobile += 1;
            leadSegmentChannelAdd_(onlyMobileByCh, channelKey);
        } else if (hasEm) {
            onlyEmail += 1;
            leadSegmentChannelAdd_(onlyEmailByCh, channelKey);
        } else {
            neither += 1;
        }
        let apptCounted = sheetAppointmentCellCountsScheduled_(cells[appointmentBookedIdx]);
        if (!apptCounted) {
            apptCounted = sheetRowAppointmentSlotCellsLikelyFilled_(cells[appointmentDateIdx], cells[appointmentTimeIdx]);
        }
        if (!apptCounted && appointmentDatetimeIdx !== undefined) {
            apptCounted = sheetCellLooksLikeAppointmentDateTimeCombined_(cells[appointmentDatetimeIdx]);
        }
        if (apptCounted) {
            appointmentScheduled += 1;
        }
        switch (channelKey) {
            case "web":
                channelWeb += 1;
                break;
            case "whatsapp":
                channelWhatsapp += 1;
                break;
            case "instagram":
                channelInstagram += 1;
                break;
            case "facebook":
                channelFacebook += 1;
                break;
            default:
                channelOther += 1;
        }
    }

    const leadsCaptured = onlyMobile + onlyEmail + both;
    const pct = conversations ? Math.round((leadsCaptured * 10_000) / conversations) / 100 : null;
    const rpt = /** @type {(a: number) => string} */ (num) =>
        `${num} / ${conversations}`;
    const out = baseEmpty();
    out.scan.dataRowsConsidered = dataRows.length;
    out.totals.conversations = conversations;
    out.totals.onlyMobile = onlyMobile;
    out.totals.onlyEmail = onlyEmail;
    out.totals.mobileAndEmail = both;
    out.totals.neither = neither;
    out.totals.rowsSkippedNoParsableDate = filterActive ? skippedNoDate : 0;
    out.totals.leadsCaptured = leadsCaptured;
    out.totals.appointmentScheduled = appointmentScheduled;
    out.totals.appointmentBooked = appointmentScheduled;
    out.totals.channelWeb = channelWeb;
    out.totals.channelWhatsapp = channelWhatsapp;
    out.totals.channelInstagram = channelInstagram;
    out.totals.channelFacebook = channelFacebook;
    out.totals.channelOther = channelOther;
    out.totals.onlyMobileByChannel = onlyMobileByCh;
    out.totals.onlyEmailByChannel = onlyEmailByCh;
    out.totals.mobileAndEmailByChannel = bothByCh;
    out.ratios.onlyMobile = rpt(onlyMobile);
    out.ratios.onlyEmail = rpt(onlyEmail);
    out.ratios.mobileAndEmail = rpt(both);
    out.ratios.leads = rpt(leadsCaptured);
    out.ratios.leadCapturePct = pct;
    conversationLeadStatsCache_ = { key: statsCacheKey, at: Date.now(), payload: out };
    return out;
}

/**
 * Ensure a worksheet exists (creates it if missing).
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} title
 * @returns {Promise<{ created: boolean, title: string }>}
 */
async function ensureSpreadsheetWorksheet_(sheets, title) {
    const safeTitle = String(title || "").trim().slice(0, 100) || "Sheet2";
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: "sheets.properties(title,sheetId)"
    });
    const sh = Array.isArray(meta.data.sheets) ? meta.data.sheets : [];
    const want = normalizedSheetTabKey_(safeTitle);
    for (let i = 0; i < sh.length; i += 1) {
        const p = sh[i] && sh[i].properties;
        const t = p && typeof p.title === "string" ? p.title.trim() : "";
        if (t && normalizedSheetTabKey_(t) === want) {
            return { created: false, title: safeTitle };
        }
    }
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [{ addSheet: { properties: { title: safeTitle } } }]
        }
    });
    return { created: true, title: safeTitle };
}

/** A1 notation tab prefix (quoted for names with spaces/special chars). */
function sheetA1TabPrefix_(title) {
    const t = String(title || "").trim().replace(/'/g, "''") || "Sheet2";
    return `'${t}'`;
}

/** RGB for Sheets API (0–1 floats). */
function sheetRgb_(hex) {
    const h = String(hex || "").replace(/^#/, "");
    const n = Number.parseInt(h.length === 6 ? h : "000000", 16);
    return {
        red: ((n >> 16) & 255) / 255,
        green: ((n >> 8) & 255) / 255,
        blue: (n & 255) / 255
    };
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {string} tabTitle
 * @returns {Promise<number>}
 */
async function getSheetIdForTitle_(sheets, tabTitle) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: "sheets.properties(title,sheetId)"
    });
    const want = normalizedSheetTabKey_(tabTitle);
    for (const s of meta.data.sheets || []) {
        const p = s.properties;
        const t = p && typeof p.title === "string" ? p.title.trim() : "";
        if (p && typeof p.sheetId === "number" && t && normalizedSheetTabKey_(t) === want) {
            return p.sheetId;
        }
    }
    throw new Error(`Sheet tab not found: ${tabTitle}`);
}

/** Embedded charts use overlay heights ~220–260px; default row ~21px — anchors must be spaced apart. */
const LEAD_DASHBOARD_CHART_ROW_STRIDE = 16;
/** Must match the number of `addChart` entries in `applyLeadDashboardChartsAndFormatting_`. */
const LEAD_DASHBOARD_CHART_SLOTS = 8;
const LEAD_DASHBOARD_CHART_BAND_ROWS =
    (LEAD_DASHBOARD_CHART_SLOTS - 1) * LEAD_DASHBOARD_CHART_ROW_STRIDE + 18;

/**
 * Remove charts + merges in the dashboard area so re-sync stays idempotent.
 *
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {number} sheetId
 */
async function resetDashboardSheetDecor_(sheets, sheetId) {
    const MAX_CHART_PURGE_PASSES = 12;
    for (let pass = 0; pass < MAX_CHART_PURGE_PASSES; pass += 1) {
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: "sheets(properties,charts)"
        });
        /** @type {unknown[]} */
        const deletes = [];
        for (const sh of meta.data.sheets || []) {
            const p = sh.properties;
            const sid = p && typeof p.sheetId === "number" ? p.sheetId : -1;
            if (sid !== sheetId) {
                continue;
            }
            const charts = Array.isArray(sh.charts) ? sh.charts : [];
            for (let i = 0; i < charts.length; i += 1) {
                const cid =
                    charts[i]
                    && /** @type {{ chartId?: number }} */ (charts[i]).chartId !== undefined
                        ? /** @type {{ chartId?: number }} */ (charts[i]).chartId
                        : undefined;
                if (typeof cid === "number") {
                    deletes.push({ deleteEmbeddedObject: { objectId: cid } });
                }
            }
            break;
        }
        if (deletes.length === 0) {
            break;
        }
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: deletes }
        });
    }
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    unmergeCells: {
                        range: {
                            sheetId,
                            startRowIndex: 0,
                            endRowIndex: 520,
                            startColumnIndex: 0,
                            endColumnIndex: 24
                        }
                    }
                }
            ]
        }
    });
}

/**
 * @returns {{
 *   values: (string|number)[][],
 *   layout: {
 *     colCount: number,
 *     rowBannerTitle: number,
 *     rowBannerSub: number,
 *     rowKpiLabels: number,
 *     rowKpiValues: number,
 *     rowChannelSection: number,
 *     channelTableHeaderRow: number,
 *     channelTableEndRow: number,
 *     rowBetweenChannelContact: number,
 *     rowContactSection: number,
 *     contactHeaderRow: number,
 *     pieRowsStart: number,
 *     pieRowsEnd: number,
 *     rowContactNeither: number,
 *     rowFunnelSection: number,
 *     funnelHeaderRow: number,
 *     funnelDataStart: number,
 *     funnelDataEnd: number,
 *     coverageTitleRow: number,
 *     coverageDataStart: number,
 *     coverageDataEnd: number,
 *     rowChartBandLabel: number,
 *     chartSlotStart: number,
 *     chartSlotEnd: number
 *   }
 * }}
 */
function buildLeadDashboardSheetPayload_(payload) {
    const tot = payload.totals;
    const conv = tot.conversations || 0;
    const leads = (tot.onlyMobile || 0) + (tot.onlyEmail || 0) + (tot.mobileAndEmail || 0);
    const pct =
        payload.ratios && payload.ratios.leadCapturePct != null
            ? payload.ratios.leadCapturePct
            : conv
              ? Math.round((leads * 10_000) / conv) / 100
              : "";
    const pctDisp = pct === "" ? "—" : pct;
    const appt = tot.appointmentBooked ?? tot.appointmentScheduled ?? 0;
    const COLS = 10;
    const pad = (/** @type {(string|number)[]} */ row) => {
        const r = row.slice();
        while (r.length < COLS) {
            r.push("");
        }
        return r;
    };

    /** @type {(string|number)[][]} */
    const lines = [];
    /** @type {Record<string, number>} */
    const L = {};

    const push = (/** @type {(string|number)[]} */ cells) => {
        lines.push(pad(cells));
        return lines.length - 1;
    };

    L.rowBannerTitle = push([
        "Lead intelligence · executive dashboard",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.rowBannerSub = push([
        `Live sync · ${new Date().toISOString()} · Tables + embedded charts (graphs) refresh on each sync`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    push([]);
    L.rowKpiLabels = push([
        "Total conversations",
        "",
        "Lead capture rate",
        "",
        "Appointments booked",
        "",
        "",
        "",
        "Conversion funnel",
        ""
    ]);
    L.rowKpiValues = push([
        conv,
        "",
        pctDisp,
        "",
        appt,
        "",
        "",
        "",
        "",
        ""
    ]);
    push([]);
    L.rowChannelSection = push([
        "Channel distribution · volume by source",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.channelTableHeaderRow = push([
        "Channel",
        "Conversations",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    push(["Web", tot.channelWeb || 0, "", "", "", "", "", "", "", ""]);
    push(["WhatsApp", tot.channelWhatsapp || 0, "", "", "", "", "", "", "", ""]);
    push(["Instagram", tot.channelInstagram || 0, "", "", "", "", "", "", "", ""]);
    push(["Facebook", tot.channelFacebook || 0, "", "", "", "", "", "", "", ""]);
    L.channelTableEndRow = push([
        "Other / uncategorized",
        tot.channelOther || 0,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.rowBetweenChannelContact = push([]);
    L.rowContactSection = push([
        "Contact capture · segment × channel (stacked analysis uses rows below)",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.contactHeaderRow = push([
        "Segment",
        "Total",
        "Web",
        "WhatsApp",
        "Instagram",
        "Facebook",
        "Other",
        "",
        "",
        ""
    ]);
    const omCh = tot.onlyMobileByChannel || {};
    const oeCh = tot.onlyEmailByChannel || {};
    const bothCh = tot.mobileAndEmailByChannel || {};
    L.pieRowsStart = push([
        "Mobile only",
        tot.onlyMobile || 0,
        omCh.web || 0,
        omCh.whatsapp || 0,
        omCh.instagram || 0,
        omCh.facebook || 0,
        omCh.other || 0,
        "",
        "",
        ""
    ]);
    push([
        "Email only",
        tot.onlyEmail || 0,
        oeCh.web || 0,
        oeCh.whatsapp || 0,
        oeCh.instagram || 0,
        oeCh.facebook || 0,
        oeCh.other || 0,
        "",
        "",
        ""
    ]);
    L.pieRowsEnd = push([
        "Mobile & email",
        tot.mobileAndEmail || 0,
        bothCh.web || 0,
        bothCh.whatsapp || 0,
        bothCh.instagram || 0,
        bothCh.facebook || 0,
        bothCh.other || 0,
        "",
        "",
        ""
    ]);
    L.rowContactNeither = push([
        "Neither mobile nor email (conversation still counted)",
        tot.neither || 0,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    if (payload.dateFilter && payload.dateFilter.applied) {
        push([]);
        const fromSerial = payload.dateFilter.from
            ? googleSheetsSerialFromIsoYmd_(payload.dateFilter.from)
            : null;
        const toSerial = payload.dateFilter.to
            ? googleSheetsSerialFromIsoYmd_(payload.dateFilter.to)
            : null;
        L.rowDateFilter = push([
            "Date filter (inclusive)",
            fromSerial != null ? fromSerial : "",
            "to",
            toSerial != null ? toSerial : "",
            "",
            "",
            "",
            "",
            "",
            ""
        ]);
    }
    L.rowChartBandLabel = push([
        "Visual analytics — charts below (one per row; scroll to view)",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.chartSlotStart = lines.length;
    for (let i = 0; i < LEAD_DASHBOARD_CHART_BAND_ROWS; i += 1) {
        push(pad([]));
    }
    L.chartSlotEnd = lines.length - 1;
    L.rowFunnelSection = push([
        "— Chart source: pipeline (rows hidden after sync) —",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.funnelHeaderRow = push([
        "Stage",
        "Count",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.funnelDataStart = push([
        "All conversations",
        conv,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    push([
        "With contact detail captured",
        leads,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.funnelDataEnd = push([
        "Appointments booked",
        appt,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.coverageTitleRow = push([
        "— Chart source: lead coverage (hidden) —",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.coverageDataStart = push([
        "With contact detail captured",
        leads,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);
    L.coverageDataEnd = push([
        "No phone or email on file",
        tot.neither || 0,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]);

    return {
        values: lines,
        layout: {
            colCount: COLS,
            rowBannerTitle: L.rowBannerTitle,
            rowBannerSub: L.rowBannerSub,
            rowKpiLabels: L.rowKpiLabels,
            rowKpiValues: L.rowKpiValues,
            rowChannelSection: L.rowChannelSection,
            channelTableHeaderRow: L.channelTableHeaderRow,
            channelTableEndRow: L.channelTableEndRow,
            rowBetweenChannelContact: L.rowBetweenChannelContact,
            rowContactSection: L.rowContactSection,
            contactHeaderRow: L.contactHeaderRow,
            pieRowsStart: L.pieRowsStart,
            pieRowsEnd: L.pieRowsEnd,
            rowContactNeither: L.rowContactNeither,
            rowFunnelSection: L.rowFunnelSection,
            funnelHeaderRow: L.funnelHeaderRow,
            funnelDataStart: L.funnelDataStart,
            funnelDataEnd: L.funnelDataEnd,
            coverageTitleRow: L.coverageTitleRow,
            coverageDataStart: L.coverageDataStart,
            coverageDataEnd: L.coverageDataEnd,
            rowChartBandLabel: L.rowChartBandLabel,
            chartSlotStart: L.chartSlotStart,
            chartSlotEnd: L.chartSlotEnd,
            rowDateFilter: L.rowDateFilter
        }
    };
}

/**
 * @param {import("googleapis").sheets_v4.Sheets} sheets
 * @param {number} sheetId
 * @param {ReturnType<typeof buildLeadDashboardSheetPayload_>["layout"]} layout
 * @param {number} rowCount
 */
async function applyLeadDashboardChartsAndFormatting_(sheets, sheetId, layout, rowCount) {
    const navy = sheetRgb_("#0c1222");
    const slate = sheetRgb_("#1e293b");
    const teal = sheetRgb_("#0d9488");
    const accent = sheetRgb_("#38bdf8");
    const white = { red: 1, green: 1, blue: 1 };
    const muted = sheetRgb_("#64748b");
    const rowTeal = sheetRgb_("#f0fdfa");
    const rowWhite = sheetRgb_("#ffffff");
    const borderSoft = sheetRgb_("#e2e8f0");
    const cols = layout.colCount;

    const ch = layout.channelTableHeaderRow;
    const chEnd = layout.channelTableEndRow;
    const pieS = layout.pieRowsStart;
    const pieE = layout.pieRowsEnd;
    const cHead = layout.contactHeaderRow;
    const funnelHideStart = layout.rowFunnelSection;
    const funnelHideEnd = layout.coverageDataEnd + 1;

    const slot = (/** @type {number} */ i) =>
        layout.chartSlotStart + i * LEAD_DASHBOARD_CHART_ROW_STRIDE;

    const stackColors = [
        sheetRgb_("#2563eb"),
        teal,
        sheetRgb_("#7c3aed"),
        sheetRgb_("#d97706"),
        sheetRgb_("#e11d48")
    ];

    /** @type {unknown[]} */
    const chartReqs = [
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Volume by channel",
                        basicChart: {
                            chartType: "COLUMN",
                            legendPosition: "NO_LEGEND",
                            axis: [
                                { position: "BOTTOM_AXIS", title: "Source" },
                                { position: "LEFT_AXIS", title: "Conversations" }
                            ],
                            domains: [
                                {
                                    domain: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: ch,
                                                    endRowIndex: chEnd + 1,
                                                    startColumnIndex: 0,
                                                    endColumnIndex: 1
                                                }
                                            ]
                                        }
                                    }
                                }
                            ],
                            series: [
                                {
                                    series: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: ch,
                                                    endRowIndex: chEnd + 1,
                                                    startColumnIndex: 1,
                                                    endColumnIndex: 2
                                                }
                                            ]
                                        }
                                    },
                                    targetAxis: "LEFT_AXIS",
                                    color: teal
                                }
                            ],
                            headerCount: 1
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(0), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 540,
                            heightPixels: 240
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Channel mix (share of traffic)",
                        pieChart: {
                            domain: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: ch + 1,
                                            endRowIndex: chEnd + 1,
                                            startColumnIndex: 0,
                                            endColumnIndex: 1
                                        }
                                    ]
                                }
                            },
                            series: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: ch + 1,
                                            endRowIndex: chEnd + 1,
                                            startColumnIndex: 1,
                                            endColumnIndex: 2
                                        }
                                    ]
                                }
                            },
                            legendPosition: "RIGHT_LEGEND",
                            pieHole: 0.4
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(1), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 520,
                            heightPixels: 240
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Segment mix · channel contribution",
                        basicChart: {
                            chartType: "BAR",
                            legendPosition: "RIGHT_LEGEND",
                            stackedType: "STACKED",
                            axis: [
                                { position: "LEFT_AXIS", title: "Segment" },
                                { position: "BOTTOM_AXIS", title: "Conversations" }
                            ],
                            domains: [
                                {
                                    domain: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: cHead,
                                                    endRowIndex: pieE + 1,
                                                    startColumnIndex: 0,
                                                    endColumnIndex: 1
                                                }
                                            ]
                                        }
                                    }
                                }
                            ],
                            series: [2, 3, 4, 5, 6].map((colIdx) => ({
                                series: {
                                    sourceRange: {
                                        sources: [
                                            {
                                                sheetId,
                                                startRowIndex: cHead,
                                                endRowIndex: pieE + 1,
                                                startColumnIndex: colIdx,
                                                endColumnIndex: colIdx + 1
                                            }
                                        ]
                                    }
                                },
                                targetAxis: "BOTTOM_AXIS",
                                color: stackColors[colIdx - 2] ?? teal
                            })),
                            headerCount: 1
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(2), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 820,
                            heightPixels: 230
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Lead capture composition",
                        pieChart: {
                            domain: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: pieS,
                                            endRowIndex: pieE + 1,
                                            startColumnIndex: 0,
                                            endColumnIndex: 1
                                        }
                                    ]
                                }
                            },
                            series: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: pieS,
                                            endRowIndex: pieE + 1,
                                            startColumnIndex: 1,
                                            endColumnIndex: 2
                                        }
                                    ]
                                }
                            },
                            legendPosition: "RIGHT_LEGEND",
                            pieHole: 0.45
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(3), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 520,
                            heightPixels: 250
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "All segments · volume",
                        basicChart: {
                            chartType: "COLUMN",
                            legendPosition: "NO_LEGEND",
                            axis: [
                                { position: "BOTTOM_AXIS", title: "Segment" },
                                { position: "LEFT_AXIS", title: "Conversations" }
                            ],
                            domains: [
                                {
                                    domain: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: cHead,
                                                    endRowIndex: layout.rowContactNeither + 1,
                                                    startColumnIndex: 0,
                                                    endColumnIndex: 1
                                                }
                                            ]
                                        }
                                    }
                                }
                            ],
                            series: [
                                {
                                    series: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: cHead,
                                                    endRowIndex: layout.rowContactNeither + 1,
                                                    startColumnIndex: 1,
                                                    endColumnIndex: 2
                                                }
                                            ]
                                        }
                                    },
                                    targetAxis: "LEFT_AXIS",
                                    color: sheetRgb_("#6366f1")
                                }
                            ],
                            headerCount: 1
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(4), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 540,
                            heightPixels: 250
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Pipeline funnel",
                        basicChart: {
                            chartType: "COLUMN",
                            legendPosition: "NO_LEGEND",
                            axis: [
                                { position: "BOTTOM_AXIS", title: "Stage" },
                                { position: "LEFT_AXIS", title: "Count" }
                            ],
                            domains: [
                                {
                                    domain: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: layout.funnelHeaderRow,
                                                    endRowIndex: layout.funnelDataEnd + 1,
                                                    startColumnIndex: 0,
                                                    endColumnIndex: 1
                                                }
                                            ]
                                        }
                                    }
                                }
                            ],
                            series: [
                                {
                                    series: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId,
                                                    startRowIndex: layout.funnelHeaderRow,
                                                    endRowIndex: layout.funnelDataEnd + 1,
                                                    startColumnIndex: 1,
                                                    endColumnIndex: 2
                                                }
                                            ]
                                        }
                                    },
                                    targetAxis: "LEFT_AXIS",
                                    color: accent
                                }
                            ],
                            headerCount: 1
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(5), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 480,
                            heightPixels: 220
                        }
                    }
                }
            }
        }
    ];

    /** @type {{ addChart: Record<string, unknown> }[]} */
    const dashboardChartRequests = [
        ...chartReqs,
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Contact capture vs gaps",
                        pieChart: {
                            domain: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: layout.coverageDataStart,
                                            endRowIndex: layout.coverageDataEnd + 1,
                                            startColumnIndex: 0,
                                            endColumnIndex: 1
                                        }
                                    ]
                                }
                            },
                            series: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: layout.coverageDataStart,
                                            endRowIndex: layout.coverageDataEnd + 1,
                                            startColumnIndex: 1,
                                            endColumnIndex: 2
                                        }
                                    ]
                                }
                            },
                            legendPosition: "RIGHT_LEGEND",
                            pieHole: 0.35
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(6), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 480,
                            heightPixels: 230
                        }
                    }
                }
            }
        },
        {
            addChart: {
                chart: {
                    spec: {
                        title: "Outcome mix · every segment (pie)",
                        pieChart: {
                            domain: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: pieS,
                                            endRowIndex: layout.rowContactNeither + 1,
                                            startColumnIndex: 0,
                                            endColumnIndex: 1
                                        }
                                    ]
                                }
                            },
                            series: {
                                sourceRange: {
                                    sources: [
                                        {
                                            sheetId,
                                            startRowIndex: pieS,
                                            endRowIndex: layout.rowContactNeither + 1,
                                            startColumnIndex: 1,
                                            endColumnIndex: 2
                                        }
                                    ]
                                }
                            },
                            legendPosition: "RIGHT_LEGEND",
                            pieHole: 0.22
                        }
                    },
                    position: {
                        overlayPosition: {
                            anchorCell: { sheetId, rowIndex: slot(7), columnIndex: 2 },
                            offsetXPixels: 8,
                            offsetYPixels: 6,
                            widthPixels: 560,
                            heightPixels: 250
                        }
                    }
                }
            }
        }
    ];

    for (let i = 0; i < dashboardChartRequests.length; i += 1) {
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: { requests: [dashboardChartRequests[i]] }
            });
        } catch (chartErr) {
            const errObj = /** @type {{ message?: string, response?: { data?: unknown } }} */ (chartErr);
            const apiDetail =
                errObj.response && errObj.response.data !== undefined
                    ? JSON.stringify(errObj.response.data).slice(0, 1200)
                    : "";
            console.error(
                "[chatbot-api] Dashboard embedded chart failed:",
                i + 1,
                "/",
                dashboardChartRequests.length,
                errObj.message || chartErr,
                apiDetail
            );
        }
    }
    /** @type {unknown[]} */
    const requests = [];

    requests.push({
        updateSheetProperties: {
            properties: {
                sheetId,
                gridProperties: {
                    frozenRowCount: 3,
                    hideGridlines: true
                }
            },
            fields: "gridProperties(frozenRowCount,hideGridlines)"
        }
    });

    const mergeRange = (r0, r1, c0, c1) =>
        requests.push({
            mergeCells: {
                range: { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
                mergeType: "MERGE_ALL"
            }
        });

    mergeRange(layout.rowBannerTitle, layout.rowBannerTitle + 1, 0, cols);
    mergeRange(layout.rowBannerSub, layout.rowBannerSub + 1, 0, cols);
    mergeRange(layout.rowChannelSection, layout.rowChannelSection + 1, 0, cols);
    mergeRange(layout.rowContactSection, layout.rowContactSection + 1, 0, cols);

    mergeRange(layout.rowKpiLabels, layout.rowKpiLabels + 1, 0, 2);
    mergeRange(layout.rowKpiLabels, layout.rowKpiLabels + 1, 2, 4);
    mergeRange(layout.rowKpiLabels, layout.rowKpiLabels + 1, 4, 6);
    mergeRange(layout.rowKpiLabels, layout.rowKpiLabels + 1, 8, cols);
    mergeRange(layout.rowKpiValues, layout.rowKpiValues + 1, 0, 2);
    mergeRange(layout.rowKpiValues, layout.rowKpiValues + 1, 2, 4);
    mergeRange(layout.rowKpiValues, layout.rowKpiValues + 1, 4, 6);
    mergeRange(layout.rowKpiValues, layout.rowKpiValues + 1, 8, cols);

    /**
     * @param {number} startRow
     * @param {number} endRow
     * @param {Record<string, unknown>} format
     */
    const repeatRows = (startRow, endRow, format) => {
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: startRow,
                    endRowIndex: endRow,
                    startColumnIndex: 0,
                    endColumnIndex: cols
                },
                cell: { userEnteredFormat: format },
                fields:
                    "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)"
            }
        });
    };

    repeatRows(layout.rowBannerTitle, layout.rowBannerTitle + 1, {
        backgroundColor: navy,
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: white, bold: true, fontSize: 18, fontFamily: "Roboto" },
        borders: { bottom: { style: "SOLID_MEDIUM", color: accent } }
    });
    repeatRows(layout.rowBannerSub, layout.rowBannerSub + 1, {
        backgroundColor: slate,
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: {
            foregroundColor: { red: 0.82, green: 0.88, blue: 0.96 },
            fontSize: 10,
            italic: true
        }
    });
    repeatRows(layout.rowKpiLabels, layout.rowKpiLabels + 1, {
        backgroundColor: sheetRgb_("#f8fafc"),
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: muted, fontSize: 9, bold: true }
    });
    repeatRows(layout.rowKpiValues, layout.rowKpiValues + 1, {
        backgroundColor: rowWhite,
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: navy, fontSize: 22, bold: true },
        borders: { bottom: { style: "SOLID", color: borderSoft } }
    });
    repeatRows(layout.rowChannelSection, layout.rowChannelSection + 1, {
        backgroundColor: teal,
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: white, bold: true, fontSize: 11 }
    });
    repeatRows(ch, ch + 1, {
        backgroundColor: slate,
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: white, bold: true, fontSize: 10 }
    });
    for (let r = ch + 1; r <= chEnd; r += 1) {
        const bg = r % 2 === 1 ? rowWhite : rowTeal;
        repeatRows(r, r + 1, {
            backgroundColor: bg,
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: navy, fontSize: 11 },
            borders: { bottom: { style: "SOLID", color: borderSoft } }
        });
    }
    repeatRows(layout.rowContactSection, layout.rowContactSection + 1, {
        backgroundColor: teal,
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: white, bold: true, fontSize: 11 }
    });
    repeatRows(cHead, cHead + 1, {
        backgroundColor: slate,
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: white, bold: true, fontSize: 9 }
    });
    for (let r = pieS; r <= pieE; r += 1) {
        const bg = r % 2 === 0 ? rowWhite : rowTeal;
        repeatRows(r, r + 1, {
            backgroundColor: bg,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: navy, fontSize: 10 },
            borders: { bottom: { style: "SOLID", color: borderSoft } }
        });
    }
    repeatRows(layout.rowContactNeither, layout.rowContactNeither + 1, {
        backgroundColor: sheetRgb_("#fff7ed"),
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: slate, fontSize: 10, italic: true }
    });

    if (layout.rowChartBandLabel > layout.rowContactNeither + 1) {
        repeatRows(layout.rowContactNeither + 1, layout.rowChartBandLabel, {
            backgroundColor: sheetRgb_("#f8fafc"),
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: muted, fontSize: 10 }
        });
    }
    repeatRows(layout.rowChartBandLabel, layout.rowChartBandLabel + 1, {
        backgroundColor: sheetRgb_("#e2e8f0"),
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE",
        textFormat: { foregroundColor: slate, fontSize: 10, bold: true }
    });
    for (let r = layout.chartSlotStart; r <= layout.chartSlotEnd; r += 1) {
        repeatRows(r, r + 1, {
            backgroundColor: sheetRgb_("#fafafa"),
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: muted, fontSize: 9 }
        });
    }
    if (rowCount > layout.chartSlotEnd + 1) {
        repeatRows(layout.chartSlotEnd + 1, rowCount, {
            backgroundColor: sheetRgb_("#f8fafc"),
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: muted, fontSize: 10 }
        });
    }

    if (layout.rowDateFilter != null && layout.rowDateFilter >= 0) {
        const dfRow = layout.rowDateFilter;
        for (const colIdx of [1, 3]) {
            requests.push({
                repeatCell: {
                    range: {
                        sheetId,
                        startRowIndex: dfRow,
                        endRowIndex: dfRow + 1,
                        startColumnIndex: colIdx,
                        endColumnIndex: colIdx + 1
                    },
                    cell: { userEnteredFormat: { numberFormat: SHEET_DD_MM_YYYY_NUMBER_FORMAT } },
                    fields: "userEnteredFormat.numberFormat"
                }
            });
        }
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests }
    });

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    updateDimensionProperties: {
                        range: { sheetId, dimension: "ROWS", startIndex: funnelHideStart, endIndex: funnelHideEnd },
                        properties: { hiddenByUser: true },
                        fields: "hiddenByUser"
                    }
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
                        properties: { pixelSize: 210 },
                        fields: "pixelSize"
                    }
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
                        properties: { pixelSize: 108 },
                        fields: "pixelSize"
                    }
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: cols },
                        properties: { pixelSize: 92 },
                        fields: "pixelSize"
                    }
                }
            ]
        }
    });

}

/**
 * Same numbers as `fetchConversationLeadCaptureStats` / the staff web dashboard.
 *
 * @param {{ from?: string, to?: string }} [opts] Optional date bounds (YYYY-MM-DD), same as stats API.
 * @returns {Promise<{ tab: string, createdTab: boolean, rowsWritten: number, colsWritten: number }>}
 */
export async function writeLeadCaptureDashboardToSheet2(opts = {}) {
    if (!SPREADSHEET_ID) {
        throw new Error("SHEETS_SPREADSHEET_ID is not set.");
    }
    const dataTab = tabNameFromRange(RANGE);
    const dashTab = DASHBOARD_SHEET_TAB;
    if (normalizedSheetTabKey_(dashTab) === normalizedSheetTabKey_(dataTab)) {
        throw new Error(
            "SHEETS_DASHBOARD_TAB must not be the same worksheet as the data tab in SHEETS_RANGE."
        );
    }
    const payload = await fetchConversationLeadCaptureStats(opts);
    const { values, layout } = buildLeadDashboardSheetPayload_(payload);
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const { created, title } = await ensureSpreadsheetWorksheet_(sheets, dashTab);
    const sheetId = await getSheetIdForTitle_(sheets, title);
    const prefix = sheetA1TabPrefix_(title);
    await resetDashboardSheetDecor_(sheets, sheetId);
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${prefix}!A:Z`
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${prefix}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values }
    });
    try {
        await applyLeadDashboardChartsAndFormatting_(sheets, sheetId, layout, values.length);
    } catch (fmtErr) {
        const errObj = /** @type {{ message?: string, response?: { data?: unknown } }} */ (fmtErr);
        const apiDetail =
            errObj.response && errObj.response.data !== undefined
                ? JSON.stringify(errObj.response.data).slice(0, 1200)
                : "";
        const m = errObj.message ? String(errObj.message) : String(fmtErr);
        console.error(
            "[chatbot-api] Dashboard sheet formatting (data was written):",
            m.slice(0, 600),
            apiDetail
        );
    }
    const colW = values.reduce((m, r) => Math.max(m, r.length), 0);
    return {
        tab: title,
        createdTab: created,
        rowsWritten: values.length,
        colsWritten: colW
    };
}

/**
 * Staff viewer: header row + up to `maxRows` most recent data rows (sheet append adds at bottom).
 * Bounded A:B scan for last row (never `A:A`) so large tabs do not stall the API.
 *
 * @param {{ maxRows?: number, offset?: number, from?: string, to?: string, allInRange?: boolean, includeStats?: boolean }} [opts]
 * @returns {Promise<{ tab: string, title: string, rowCount: number, headers: string[], conversations: Record<string, string>[], offset: number, limit: number, hasOlder: boolean, hasNewer: boolean, totalDataRows: number, allInRange?: boolean, rowsTruncated?: boolean, leadStats?: object, dateFilter: { applied: boolean, serverApplied?: boolean, from: string|null, to: string|null } }>}
 */
export async function fetchConversationSheetPreview(opts = {}) {
    const allInRange = opts.allInRange !== false && opts.allInRange !== "0";
    const includeStats = opts.includeStats !== false && opts.includeStats !== "0";
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
    const fromIn = opts && typeof opts.from === "string" ? opts.from.trim() : "";
    const toIn = opts && typeof opts.to === "string" ? opts.to.trim() : "";
    /** @type {string|null} */
    let previewFromIso = fromIn && isoYyyyMmDdOk_(fromIn) ? fromIn : null;
    /** @type {string|null} */
    let previewToIso = toIn && isoYyyyMmDdOk_(toIn) ? toIn : null;
    if ((fromIn && !previewFromIso) || (toIn && !previewToIso)) {
        throw new Error("Invalid date parameter — use YYYY-MM-DD for from/to.");
    }
    if (previewFromIso && previewToIso && previewFromIso > previewToIso) {
        const swap = previewFromIso;
        previewFromIso = previewToIso;
        previewToIso = swap;
    }
    let previewServerDefaultRange = false;
    if (!previewFromIso && !previewToIso) {
        const def = conversationSheetDefaultDateRange_(4);
        previewFromIso = def.from;
        previewToIso = def.to;
        previewServerDefaultRange = true;
    }
    const previewDateFilterActive = !!(previewFromIso || previewToIso);
    let previewFromEff = "1900-01-01";
    let previewToEff = "9999-12-31";
    if (previewDateFilterActive) {
        if (previewFromIso) {
            previewFromEff = previewFromIso;
        }
        if (previewToIso) {
            previewToEff = previewToIso;
        }
    }
    /** @type {{ applied: boolean, serverApplied?: boolean, serverDefaultRange?: boolean, from: string|null, to: string|null }} */
    const dateFilterEcho = previewDateFilterActive
        ? {
            applied: true,
            serverApplied: true,
            serverDefaultRange: previewServerDefaultRange,
            from: previewFromIso,
            to: previewToIso
        }
        : { applied: false, serverApplied: false, from: null, to: null };

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

    await getHeaderIndexMap_(sheets, tab);
    const headersRaw =
        sheetSchemaCache_.tab === tab && Array.isArray(sheetSchemaCache_.headersRaw)
            ? sheetSchemaCache_.headersRaw
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

    const scanMeta = await getConversationSheetScanMeta_(sheets, tab);
    const n = scanMeta.nLast;
    if (n <= 1) {
        return {
            tab,
            title,
            rowCount: n,
            headers,
            conversations: [],
            offset: 0,
            limit: maxRows,
            hasOlder: false,
            hasNewer: false,
            totalDataRows: 0,
            dateFilter: dateFilterEcho
        };
    }
    const sheetDataRowCount = Math.max(0, n - 1);
    let offset = Number.parseInt(String(opts.offset !== undefined ? opts.offset : 0), 10);
    if (!Number.isFinite(offset) || offset < 0) {
        offset = 0;
    }
    /** Same right edge as statistics scan so the date column is always fetched. */
    const previewLastCol0 = Math.min(175, Math.max(headersRaw.length - 1, 18));
    const previewRightLetter = columnLetterFromIndex_(previewLastCol0);

    if (previewDateFilterActive) {
        const headerMap = await getHeaderIndexMap_(sheets, tab);
        const dateIdx = pickHeaderIndex_(headerMap, SHEET_H_CONV_DATE_CELL, 1);
        const mobileIdx = pickHeaderIndex_(headerMap, SHEET_H_MOBILE, 4);
        const emailIdx = pickHeaderIndex_(headerMap, SHEET_H_EMAIL, 5);
        const channelIdx = pickHeaderIndex_(headerMap, SHEET_H_CHANNEL, 6);
        const appointmentBookedIdx = pickAppointmentStatsColumnIdx_(headerMap, headersRaw, 15);
        const appointmentDateIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_DATE, 16);
        const appointmentTimeIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_TIME, 17);
        const appointmentDatetimeIdx = firstHeaderIdxFromAliases_(headerMap, SHEET_H_APPOINTMENT_DATETIME);
        const apptDtIdx =
            appointmentDatetimeIdx !== undefined && appointmentDatetimeIdx >= 0
                ? appointmentDatetimeIdx
                : -1;
        const padWidth = previewLastCol0 + 1;
        const statCol = {
            mobileIdx,
            emailIdx,
            channelIdx,
            appointmentBookedIdx,
            appointmentDateIdx,
            appointmentTimeIdx,
            apptDtIdx
        };
        const acc = includeStats ? leadCaptureStatsAccumulatorEmpty_() : null;
        const viewerCap = conversationSheetViewerReturnMaxRows_();
        const listCap = conversationSheetDateFilterMaxRows_();
        const dataRowsAll = await getConversationSheetDataBlock_(sheets, tab, previewLastCol0, n);
        /** @type {Record<string, string>[]} */
        const matchedChrono = [];
        /** @type {Record<string, string>[]} */
        const newestRing = [];
        let totalMatches = 0;
        for (let ri = 0; ri < dataRowsAll.length; ri += 1) {
            if (acc) {
                acc.dataRowsConsidered += 1;
            }
            const cells = padSheetRow_(dataRowsAll[ri] || [], padWidth);
            if (!sheetRowHasAnyCell_(cells)) {
                continue;
            }
            const dateMs = parseConversationDateCellWide_(cells[dateIdx]);
            if (!Number.isFinite(dateMs)) {
                if (acc) {
                    acc.skippedNoDate += 1;
                }
                continue;
            }
            const ymd = conversationRowYmdInSheetTz_(dateMs);
            if (!ymd || ymd < previewFromEff || ymd > previewToEff) {
                continue;
            }
            totalMatches += 1;
            if (acc) {
                leadCaptureStatsAccumulateRow_(acc, cells, statCol);
            }
            const row = conversationRowFromCells_(cells, headers);
            if (!row) {
                continue;
            }
            if (allInRange) {
                newestRing.push(row);
                if (newestRing.length > viewerCap) {
                    newestRing.shift();
                }
            } else if (matchedChrono.length < listCap) {
                matchedChrono.push(row);
            }
        }
        const rowsTruncated =
            totalMatches > (allInRange ? viewerCap : listCap) || totalMatches > viewerCap;
        /** Newest spreadsheet rows last → reverse for staff viewer. */
        const newestFirst = allInRange ? newestRing.slice().reverse() : matchedChrono.slice().reverse();
        let sliceRows;
        let hasNewerFiltered = false;
        let hasOlderFiltered = false;
        let effectiveLimit = maxRows;
        const totalFiltered = totalMatches;
        if (allInRange) {
            sliceRows = newestFirst;
            offset = 0;
            effectiveLimit = sliceRows.length;
        } else {
            const maxFilteredOffset = Math.max(0, totalFiltered - maxRows);
            if (offset > maxFilteredOffset) {
                offset = maxFilteredOffset;
            }
            sliceRows = newestFirst.slice(offset, offset + maxRows);
            hasNewerFiltered = offset > 0;
            hasOlderFiltered = offset + sliceRows.length < totalFiltered;
        }
        /** @type {object|undefined} */
        let leadStats;
        if (includeStats && acc) {
            const statsShell = leadCaptureStatsShellForViewer_(
                tab,
                title,
                {
                    applied: true,
                    serverApplied: true,
                    serverDefaultRange: previewServerDefaultRange,
                    from: previewFromIso,
                    to: previewToIso
                },
                n,
                scanMeta.gridRows,
                scanMeta.hardCap,
                headersRaw,
                dateIdx,
                mobileIdx,
                emailIdx,
                channelIdx,
                appointmentBookedIdx
            );
            leadStats = leadCaptureStatsPayloadFromAccumulator_(acc, statsShell);
            const statsKey = `${tab}|${previewFromIso || ""}|${previewToIso || ""}|${previewServerDefaultRange ? "d" : ""}`;
            conversationLeadStatsCache_ = { key: statsKey, at: Date.now(), payload: leadStats };
        }
        return {
            tab,
            title,
            rowCount: n,
            headers,
            conversations: sliceRows,
            offset,
            limit: effectiveLimit,
            hasOlder: hasOlderFiltered,
            hasNewer: hasNewerFiltered,
            totalDataRows: totalFiltered,
            allInRange,
            rowsTruncated,
            leadStats,
            dateFilter: dateFilterEcho
        };
    }

    /** Skip this many rows from the bottom (newest); page = offset ÷ limit — full tab, no date filter. */
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
            totalDataRows: sheetDataRowCount,
            dateFilter: dateFilterEcho
        };
    }
    const dataStart = Math.max(2, dataEnd - maxRows + 1);
    const rawRows = await fetchSheetValuesRangeChunked_(
        sheets,
        tab,
        0,
        previewLastCol0,
        dataEnd,
        dataStart
    );
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
        totalDataRows: sheetDataRowCount,
        dateFilter: dateFilterEcho
    };
}

/**
 * Staff CSV export: every data row in scan order (oldest → newest), optionally filtered by conv. date (same rules as the viewer when from/to are set).
 *
 * @param {{ from?: string, to?: string }} [opts]
 * @returns {Promise<{ tab: string, title: string, headers: string[], conversations: Record<string, string>[], dateFilter: { applied: boolean, serverApplied?: boolean, from: string|null, to: string|null } }>}
 */
export async function fetchConversationSheetExport(opts = {}) {
    if (!SPREADSHEET_ID) {
        throw new Error("SHEETS_SPREADSHEET_ID is not set.");
    }
    const fromIn = opts && typeof opts.from === "string" ? opts.from.trim() : "";
    const toIn = opts && typeof opts.to === "string" ? opts.to.trim() : "";
    /** @type {string|null} */
    let previewFromIso = fromIn && isoYyyyMmDdOk_(fromIn) ? fromIn : null;
    /** @type {string|null} */
    let previewToIso = toIn && isoYyyyMmDdOk_(toIn) ? toIn : null;
    if ((fromIn && !previewFromIso) || (toIn && !previewToIso)) {
        throw new Error("Invalid date parameter — use YYYY-MM-DD for from/to.");
    }
    if (previewFromIso && previewToIso && previewFromIso > previewToIso) {
        const swap = previewFromIso;
        previewFromIso = previewToIso;
        previewToIso = swap;
    }
    const previewDateFilterActive = !!(previewFromIso || previewToIso);
    let previewFromEff = "1900-01-01";
    let previewToEff = "9999-12-31";
    if (previewDateFilterActive) {
        if (previewFromIso) {
            previewFromEff = previewFromIso;
        }
        if (previewToIso) {
            previewToEff = previewToIso;
        }
    }
    /** @type {{ applied: boolean, serverApplied?: boolean, from: string|null, to: string|null }} */
    const dateFilterEcho = previewDateFilterActive
        ? {
              applied: true,
              serverApplied: true,
              from: previewFromIso,
              to: previewToIso
          }
        : { applied: false, serverApplied: false, from: null, to: null };

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
    const usedKeys = new Set();
    for (let i = 0; i < headersRaw.length; i += 1) {
        let label = sheetCellString_(headersRaw[i]);
        if (!label) {
            label = `Column_${i + 1}`;
        }
        let key = label;
        let nDup = 2;
        while (usedKeys.has(key)) {
            key = `${label} (${nDup})`;
            nDup += 1;
        }
        usedKeys.add(key);
        headers.push(key);
    }

    const hardCap = conversationSheetScanHardCap_();
    const gridRows = await conversationSheetGridRowCount_(sheets, tab);
    const nRows = await conversationSheetLastDataRow1Based_(sheets, tab, hardCap, gridRows);
    if (nRows <= 1) {
        return {
            tab,
            title,
            headers,
            conversations: [],
            dateFilter: dateFilterEcho
        };
    }

    const previewLastCol0 = Math.min(175, Math.max(headersRaw.length - 1, 18));
    const previewRightLetter = columnLetterFromIndex_(previewLastCol0);
    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const dateIdx = pickHeaderIndex_(headerMap, SHEET_H_CONV_DATE_CELL, 1);

    const fullGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A2:${previewRightLetter}${nRows}`
    });
    const dataRowsAll = Array.isArray(fullGot.data.values) ? fullGot.data.values : [];

    /** @type {Record<string, string>[]} */
    const out = [];

    for (let ri = 0; ri < dataRowsAll.length; ri += 1) {
        const cells = dataRowsAll[ri] || [];
        let rowHasAny = false;
        for (let ci = 0; ci < cells.length; ci += 1) {
            if (!isBlankSheetCell_(cells[ci])) {
                rowHasAny = true;
                break;
            }
        }
        if (!rowHasAny) continue;

        if (previewDateFilterActive) {
            const dateMs = parseConversationDateCellWide_(cells[dateIdx]);
            if (!Number.isFinite(dateMs)) {
                continue;
            }
            const ymd = conversationRowYmdInSheetTz_(dateMs);
            if (!ymd || ymd < previewFromEff || ymd > previewToEff) {
                continue;
            }
        }

        /** @type {Record<string, string>} */
        const o = {};
        for (let c = 0; c < headers.length; c += 1) {
            const h = headers[c];
            o[h] = sheetCellString_(cells[c]);
        }
        if (!Object.values(o).some((v) => v && v.trim())) {
            continue;
        }
        out.push(o);
    }

    return {
        tab,
        title,
        headers,
        conversations: out,
        dateFilter: dateFilterEcho
    };
}

