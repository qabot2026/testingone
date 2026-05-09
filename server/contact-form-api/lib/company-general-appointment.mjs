/**
 * Reads `company.config.js` (repo root) so general appointment hours match the chat UI config.
 * Env vars still override when set: GENERAL_APPOINTMENT_* and branch/department.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_CONFIG_PATH = path.join(__dirname_lib, "..", "..", "..", "company.config.js");

/** @type {object | null | undefined} undefined = not loaded */
let cachedChatUiConfig = undefined;

function loadCompanyChatUiConfig() {
    if (cachedChatUiConfig !== undefined) {
        return cachedChatUiConfig;
    }
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
            "[contact-form-api] Could not load company.config.js for general appointment; using env/defaults.",
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

/**
 * Slot step (minutes) for the general calendar only. Optional `generalAppointment.slotMinutes`
 * in company.config.js; otherwise same as global `appointmentSlotMinutes_()`.
 * @param {() => number} globalSlotMinutesFn
 */
export function generalAppointmentSlotStepMinutes_(globalSlotMinutesFn) {
    const c = generalAppointmentFromCompany_();
    const n = Number(c.slotMinutes);
    if (Number.isFinite(n) && n >= 5 && n <= 180) {
        return Math.floor(n);
    }
    return globalSlotMinutesFn();
}
