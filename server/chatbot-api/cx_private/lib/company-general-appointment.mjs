/**
 * Reads `company.config.js` so general appointment hours match the chat UI config.
 * Env: optional absolute path COMPANY_CHAT_UI_CONFIG_PATH (or COMPANY_CONFIG_JS_PATH).
 * Fallbacks: cwd, parent dirs, or three levels above this file (monorepo root).
 * GENERAL_APPOINTMENT_SLOT_MINUTES forces general-slot step without reading config (deploy-friendly).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
/** chatbot-api root (`index.mjs` lives here): ship `company.config.js` beside it for flattened deploys. */
const apiRootDir_ = path.join(__dirname_lib, "..");
const COMPANY_CONFIG_FALLBACK_REL = path.join(__dirname_lib, "..", "..", "..", "company.config.js");

function trimStrEnv(x) {
    return String(x ?? "").trim();
}

function resolveReadableCompanyConfigPath() {
    const fromEnv =
        trimStrEnv(process.env.COMPANY_CHAT_UI_CONFIG_PATH) ||
        trimStrEnv(process.env.COMPANY_CONFIG_JS_PATH);
    if (fromEnv && fs.existsSync(fromEnv)) {
        return fromEnv;
    }
    const cwd = process.cwd();
    /** @type {string[]} */
    const candidates = [
        path.join(apiRootDir_, "company.config.js"),
        path.join(apiRootDir_, "..", "..", "company.config.js"),
        COMPANY_CONFIG_FALLBACK_REL,
        path.join(cwd, "company.config.js"),
        path.join(cwd, "..", "company.config.js"),
        path.join(cwd, "..", "..", "company.config.js")
    ];
    for (const p of candidates) {
        try {
            const abs = path.resolve(p);
            if (fs.existsSync(abs)) {
                return abs;
            }
        } catch {
            /* ignore */
        }
    }
    return path.resolve(COMPANY_CONFIG_FALLBACK_REL);
}

/** @type {object | null | undefined} undefined = not loaded */
let cachedChatUiConfig = undefined;

function loadCompanyChatUiConfig() {
    if (cachedChatUiConfig !== undefined) {
        return cachedChatUiConfig;
    }
    const COMPANY_CONFIG_PATH = resolveReadableCompanyConfigPath();
    try {
        const src = fs.readFileSync(COMPANY_CONFIG_PATH, "utf8");
        const sandbox = {};
        sandbox.globalThis = sandbox;
        sandbox.window = sandbox;
        sandbox.console = console;
        vm.createContext(sandbox);
        vm.runInNewContext(src, sandbox, { filename: "company.config.js" });
        cachedChatUiConfig = sandbox.COMPANY_CHAT_UI_CONFIG || null;
    } catch (e) {
        console.warn(
            `[chatbot-api] Could not load company.config.js (tried ${COMPANY_CONFIG_PATH}); using env/defaults.`,
            e && e.message ? e.message : e
        );
        cachedChatUiConfig = null;
    }
    return cachedChatUiConfig;
}

function generalAppointmentFromCompany_() {
    const cfg = loadCompanyChatUiConfig();
    const g =
        cfg &&
        cfg.common &&
        cfg.common.generalAppointment &&
        typeof cfg.common.generalAppointment === "object"
            ? cfg.common.generalAppointment
            : {};
    return g;
}

function trimStr(x) {
    return String(x ?? "").trim();
}

function fromCompany_(c, key, fallback) {
    const v = trimStr(c[key]);
    return v || fallback;
}

/**
 * Effective general-appointment schedule (company.config.js with env override).
 * @returns {{ bookingId: string, days: string, start: string, end: string, branchId: string, department: string }}
 */
export function mergedGeneralAppointmentSchedule_() {
    const c = generalAppointmentFromCompany_();
    return {
        bookingId:
            trimStr(process.env.GENERAL_APPOINTMENT_BOOKING_ID) ||
            fromCompany_(c, "bookingId", "general"),
        days: trimStr(process.env.GENERAL_APPOINTMENT_DAYS) || fromCompany_(c, "days", "Mon-Fri"),
        start: trimStr(process.env.GENERAL_APPOINTMENT_START) || fromCompany_(c, "start", "9:00 AM"),
        end: trimStr(process.env.GENERAL_APPOINTMENT_END) || fromCompany_(c, "end", "5:00 PM"),
        branchId:
            trimStr(process.env.GENERAL_APPOINTMENT_BRANCH_ID) || fromCompany_(c, "branchId", "500"),
        department:
            trimStr(process.env.GENERAL_APPOINTMENT_DEPARTMENT) ||
            fromCompany_(c, "department", "Appointment")
    };
}

function clampAppointmentSlotMinutes_(raw) {
    const n =
        typeof raw === "number" && Number.isFinite(raw)
            ? raw
            : Number(String(raw == null ? "" : raw).trim());
    if (!Number.isFinite(n) || n < 5 || n > 180) {
        return null;
    }
    return Math.floor(n);
}

/**
 * Slot step for the shared general calendar.
 * Priority: GENERAL_APPOINTMENT_SLOT_MINUTES → explicit `generalAppointment.slotMinutes` in loaded
 * `company.config.js` → optional client hints (`generalSlotMinutes` query / `generalAppointmentSlotMinutes`
 * form field — same UI config the browser reads) → global `appointmentSlotMinutes_()` / 30.
 * Client hints apply only when the server did **not** read a usable `slotMinutes` from disk.
 * @param {{ querySlotMinutes?: string, formSlotMinutes?: string }} [hints]
 * @param {() => number} globalSlotMinutesFn
 */
export function resolvedGeneralAppointmentSlotMinutes_(hints, globalSlotMinutesFn) {
    const fromEnv = clampAppointmentSlotMinutes_(trimStrEnv(process.env.GENERAL_APPOINTMENT_SLOT_MINUTES));
    if (fromEnv != null) {
        return fromEnv;
    }

    const blob = loadCompanyChatUiConfig();
    const c = generalAppointmentFromCompany_();
    if (
        blob !== null &&
        c &&
        typeof c === "object" &&
        Object.prototype.hasOwnProperty.call(c, "slotMinutes")
    ) {
        const fromFile = clampAppointmentSlotMinutes_(/** @type {unknown} */ (c).slotMinutes);
        if (fromFile != null) {
            return fromFile;
        }
    }

    if (hints) {
        const raw =
            hints.formSlotMinutes !== undefined && String(hints.formSlotMinutes).trim() !== ""
                ? hints.formSlotMinutes
                : hints.querySlotMinutes;
        const fromHint = clampAppointmentSlotMinutes_(raw);
        if (fromHint != null) {
            return fromHint;
        }
    }

    return globalSlotMinutesFn();
}

/**
 * @param {() => number} globalSlotMinutesFn
 * @param {{ querySlotMinutes?: string, formSlotMinutes?: string }} [hints]
 */
export function generalAppointmentSlotStepMinutes_(globalSlotMinutesFn, hints) {
    return resolvedGeneralAppointmentSlotMinutes_(hints || {}, globalSlotMinutesFn);
}
