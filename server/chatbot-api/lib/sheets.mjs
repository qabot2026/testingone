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
/** Secondary tab for lead KPIs (created if missing). Must differ from `SHEETS_RANGE` data tab. */
const DASHBOARD_SHEET_TAB = (process.env.SHEETS_DASHBOARD_TAB || "Sheet2").trim() || "Sheet2";
/** After each new lead row append, refresh the dashboard tab (best-effort; does not fail the request). */
const SYNC_DASHBOARD_ON_APPEND = /^(1|true|yes)$/i.test(
    String(process.env.SHEETS_SYNC_DASHBOARD_ON_APPEND || "").trim()
);

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
        8
    );
    const incomingAbRaw = typeof incoming.appointmentBooked === "string" ? incoming.appointmentBooked : "";
    const desiredAb = appointmentBookedSheetValue_(incomingAbRaw);
    const existingAbSem = appointmentBookedSheetValue_(sheetCellString_(row[14]));
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
    if (appointmentBookedPatch !== null) {
        data.push({ range: `${tab}!${colL(14)}${rowNumber}`, values: [[appointmentBookedPatch]] });
    }
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
const SHEET_H_CHANNEL = [
    "channel",
    "channels",
    "chatsource",
    "sourcechannel",
    "communicationchannel",
    "chatchannel",
    "userchannel",
    "entrychannel",
    "originchannel",
    "platformchannel"
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

/** Header aliases for “Appointment booked” / scheduled (stats); default sheet column index 14 (same as ingest). */
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

/** Header aliases for conversation date column (stats + period filter); default column A index 0. */
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

/** Lead stats: plausible mobile if enough digits (captures WhatsApp variants). */
function sheetCellHasLeadMobile_(raw) {
    const digits = sheetCellString_(raw).replace(/\D/g, "");
    return digits.length >= 7;
}

function sheetCellHasLeadEmail_(raw) {
    const t = sheetCellString_(raw).trim();
    if (!t || !t.includes("@")) {
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+/.test(t);
}

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
    const appointmentBookedRaw = typeof row.appointmentBooked === "string" ? row.appointmentBooked.trim() : "";
    const appointmentBooked = appointmentBookedSheetValue_(appointmentBookedRaw);
    const appointmentDate = typeof row.appointmentDate === "string" ? row.appointmentDate.trim() : "";
    const appointmentTime = typeof row.appointmentTime === "string" ? row.appointmentTime.trim() : "";
    const userQueriesCsv = sanitizeUserQueriesCsvForSheet(
        typeof row.userQueriesCsv === "string" ? row.userQueriesCsv : ""
    );
    const repeated = repeatedUserLabelFromRepeatedFlag_(scanFull.repeatedAcrossSessions);
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

    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = tabNameFromRange(RANGE);

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

    const headerGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!1:1`
    });
    const headersRaw = Array.isArray(headerGot.data.values) && headerGot.data.values[0]
        ? /** @type {unknown[]} */ (headerGot.data.values[0])
        : [];
    const headerMap = await getHeaderIndexMap_(sheets, tab);
    const dateIdx = pickHeaderIndex_(headerMap, SHEET_H_CONV_DATE_CELL, 0);
    const mobileIdx = pickHeaderIndex_(headerMap, SHEET_H_MOBILE, 3);
    const emailIdx = pickHeaderIndex_(headerMap, SHEET_H_EMAIL, 4);
    const channelIdx = pickHeaderIndex_(headerMap, SHEET_H_CHANNEL, 5);
    const appointmentBookedIdx = pickAppointmentStatsColumnIdx_(headerMap, headersRaw, 14);
    const appointmentDateIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_DATE, 15);
    const appointmentTimeIdx = pickHeaderIndex_(headerMap, SHEET_H_APPOINTMENT_TIME, 16);
    const appointmentDatetimeIdx = firstHeaderIdxFromAliases_(headerMap, SHEET_H_APPOINTMENT_DATETIME);

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
        /* fallback hardCap */
    }

    const colAGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A1:A${capRow}`
    });
    const colVals = Array.isArray(colAGot.data.values) ? colAGot.data.values : [];
    /** 1-based last row with column A populated. */
    let nLast = 0;
    for (let ri = colVals.length - 1; ri >= 0; ri -= 1) {
        if (!isBlankSheetCell_(colVals[ri] && colVals[ri][0])) {
            nLast = ri + 1;
            break;
        }
    }
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
            to: toStr
        },
        scan: {
            sheetLastRow1Based: nLast || colVals.length,
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
        17
    );
    const lastColIdx = Math.min(175, lastColBound);
    const colLetter = columnLetterFromIndex_(lastColIdx);
    const dataGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A2:${colLetter}${nLast}`
    });
    const dataRows = Array.isArray(dataGot.data.values) ? dataGot.data.values : [];

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
        const cells = dataRows[ri] || [];
        let rowHasAny = false;
        for (let ci = 0; ci < cells.length; ci += 1) {
            if (!isBlankSheetCell_(cells[ci])) {
                rowHasAny = true;
                break;
            }
        }
        if (!rowHasAny) {
            continue;
        }
        if (filterActive) {
            const dateMs = parseConversationDateCellWide_(cells[dateIdx]);
            if (!Number.isFinite(dateMs)) {
                skippedNoDate += 1;
                continue;
            }
            const ymd = conversationRowYmdInSheetTz_(dateMs);
            if (!ymd || ymd < fromEff || ymd > toEff) {
                continue;
            }
        }
        const hasMob = sheetCellHasLeadMobile_(cells[mobileIdx]);
        const hasEm = sheetCellHasLeadEmail_(cells[emailIdx]);
        const channelKey = conversationChannelBucket_(cells[channelIdx]);
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

/**
 * @param {Awaited<ReturnType<typeof fetchConversationLeadCaptureStats>>} payload
 * @returns {(string|number)[][]}
 */
function buildLeadDashboardSheetValues_(payload) {
    const tot = payload.totals;
    const conv = tot.conversations || 0;
    const leads = (tot.onlyMobile || 0) + (tot.onlyEmail || 0) + (tot.mobileAndEmail || 0);
    const pct =
        payload.ratios && payload.ratios.leadCapturePct != null
            ? payload.ratios.leadCapturePct
            : conv
              ? Math.round((leads * 10_000) / conv) / 100
              : "";
    /** @type {(string|number)[][]} */
    const lines = [];
    lines.push(["Lead dashboard (live sync — same logic as /conversations-sheet)", new Date().toISOString()]);
    lines.push([]);
    lines.push(["Total conversations", conv]);
    lines.push(["Lead capture %", pct === "" ? "" : pct]);
    lines.push(["Appointments booked", tot.appointmentBooked ?? tot.appointmentScheduled ?? 0]);
    lines.push([]);
    lines.push(["Conversations by channel", ""]);
    lines.push(["Web", tot.channelWeb || 0]);
    lines.push(["WhatsApp", tot.channelWhatsapp || 0]);
    lines.push(["Instagram", tot.channelInstagram || 0]);
    lines.push(["Facebook", tot.channelFacebook || 0]);
    lines.push(["Other / uncategorized", tot.channelOther || 0]);
    lines.push([]);
    lines.push(["Contact detail captured"]);
    lines.push(["Segment", "Total", "Web", "WhatsApp", "Instagram", "Facebook", "Other"]);
    const omCh = tot.onlyMobileByChannel || {};
    const oeCh = tot.onlyEmailByChannel || {};
    const bothCh = tot.mobileAndEmailByChannel || {};
    lines.push([
        "Mobile only",
        tot.onlyMobile || 0,
        omCh.web || 0,
        omCh.whatsapp || 0,
        omCh.instagram || 0,
        omCh.facebook || 0,
        omCh.other || 0
    ]);
    lines.push([
        "Email only",
        tot.onlyEmail || 0,
        oeCh.web || 0,
        oeCh.whatsapp || 0,
        oeCh.instagram || 0,
        oeCh.facebook || 0,
        oeCh.other || 0
    ]);
    lines.push([
        "Mobile & email",
        tot.mobileAndEmail || 0,
        bothCh.web || 0,
        bothCh.whatsapp || 0,
        bothCh.instagram || 0,
        bothCh.facebook || 0,
        bothCh.other || 0
    ]);
    lines.push([]);
    lines.push(["Neither mobile nor email (conversation still counted)", tot.neither || 0]);
    if (payload.dateFilter && payload.dateFilter.applied) {
        lines.push([]);
        lines.push([
            "Date filter (inclusive)",
            `${payload.dateFilter.from || "—"} … ${payload.dateFilter.to || "—"}`
        ]);
    }
    return lines;
}

/**
 * Writes KPI tables to a second tab on the live spreadsheet (default `Sheet2`).
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
    const values = buildLeadDashboardSheetValues_(payload);
    const client = await getSheetsAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const { created, title } = await ensureSpreadsheetWorksheet_(sheets, dashTab);
    const prefix = sheetA1TabPrefix_(title);
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
 * Bounded column-A scan (never `A:A`) so large tabs do not stall the API.
 *
 * @param {{ maxRows?: number, offset?: number, from?: string, to?: string }} [opts]
 * @returns {Promise<{ tab: string, title: string, rowCount: number, headers: string[], conversations: Record<string, string>[], offset: number, limit: number, hasOlder: boolean, hasNewer: boolean, totalDataRows: number, dateFilter: { applied: boolean, serverApplied?: boolean, from: string|null, to: string|null } }>}
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
    const previewLastCol0 = Math.min(175, Math.max(headersRaw.length - 1, 17));
    const previewRightLetter = columnLetterFromIndex_(previewLastCol0);

    if (previewDateFilterActive) {
        const headerMap = await getHeaderIndexMap_(sheets, tab);
        const dateIdx = pickHeaderIndex_(headerMap, SHEET_H_CONV_DATE_CELL, 0);
        const fullGot = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A2:${previewRightLetter}${n}`
        });
        const dataRowsAll = Array.isArray(fullGot.data.values) ? fullGot.data.values : [];
        /** @type {Record<string, string>[]} */
        const matchedChrono = [];
        for (let ri = 0; ri < dataRowsAll.length; ri += 1) {
            const cells = dataRowsAll[ri] || [];
            let rowHasAny = false;
            for (let ci = 0; ci < cells.length; ci += 1) {
                if (!isBlankSheetCell_(cells[ci])) {
                    rowHasAny = true;
                    break;
                }
            }
            if (!rowHasAny) {
                continue;
            }
            const dateMs = parseConversationDateCellWide_(cells[dateIdx]);
            if (!Number.isFinite(dateMs)) {
                continue;
            }
            const ymd = conversationRowYmdInSheetTz_(dateMs);
            if (!ymd || ymd < previewFromEff || ymd > previewToEff) {
                continue;
            }
            /** @type {Record<string, string>} */
            const o = {};
            for (let c = 0; c < headers.length; c += 1) {
                const h = headers[c];
                o[h] = sheetCellString_(cells[c]);
            }
            if (Object.values(o).some((v) => v && v.trim())) {
                matchedChrono.push(o);
            }
        }
        const totalFiltered = matchedChrono.length;
        /** Newest spreadsheet rows last → reverse for paging like the non-filter viewer. */
        const newestFirst = matchedChrono.slice().reverse();
        const maxFilteredOffset = Math.max(0, totalFiltered - maxRows);
        if (offset > maxFilteredOffset) {
            offset = maxFilteredOffset;
        }
        const sliceRows = newestFirst.slice(offset, offset + maxRows);
        const hasNewerFiltered = offset > 0;
        const hasOlderFiltered = offset + sliceRows.length < totalFiltered;
        return {
            tab,
            title,
            rowCount: n,
            headers,
            conversations: sliceRows,
            offset,
            limit: maxRows,
            hasOlder: hasOlderFiltered,
            hasNewer: hasNewerFiltered,
            totalDataRows: totalFiltered,
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
    const blockGot = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab}!A${dataStart}:${previewRightLetter}${dataEnd}`
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
        totalDataRows: sheetDataRowCount,
        dateFilter: dateFilterEcho
    };
}

