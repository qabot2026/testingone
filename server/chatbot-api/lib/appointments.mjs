import admin from "firebase-admin";
import "firebase-admin/database";

const APPOINTMENTS_ROOT = (process.env.FIREBASE_APPOINTMENTS_ROOT || "appointments").trim();
const APPOINTMENTS_LEADS_ROOT = (
    process.env.FIREBASE_APPOINTMENTS_LEADS_ROOT || "leads/appointments"
).trim();

/** @param {string} s */
function base64UrlEncode_(s) {
    const b64 = Buffer.from(String(s || ""), "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @param {string} s */
function base64UrlDecode_(s) {
    const raw = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (raw.length % 4)) % 4;
    const padded = raw + "=".repeat(padLen);
    return Buffer.from(padded, "base64").toString("utf8");
}

function getDb_() {
    // Requires firebaseAdminInit() to have been called with databaseURL.
    return admin.database();
}

/**
 * @param {Record<string, unknown> | undefined} extras
 */
function appointmentLeadFieldsFromExtras_(extras) {
    const o = extras && typeof extras === "object" ? extras : {};
    const pick = (k) => {
        const v = o[k];
        return typeof v === "string" ? v.trim() : "";
    };
    const patientName = pick("patientName");
    const patientMobile = pick("patientMobile");
    const patientEmail = pick("patientEmail");
    const sessionId = pick("sessionId");
    const formId = pick("formId");
    const source = pick("source");
    /** @type {Record<string, string>} */
    const out = {};
    if (patientName) {
        out.patientName = patientName;
    }
    if (patientMobile) {
        out.patientMobile = patientMobile;
    }
    if (patientEmail) {
        out.patientEmail = patientEmail;
    }
    if (sessionId) {
        out.sessionId = sessionId;
    }
    if (formId) {
        out.formId = formId;
    }
    if (source) {
        out.source = source;
    }
    return out;
}

/**
 * @param {{
 *   doctorId: string,
 *   branchId: string,
 *   department: string,
 *   dateISO: string,
 *   slotLabel: string,
 *   userId?: string,
 *   patientName?: string,
 *   patientMobile?: string,
 *   patientEmail?: string,
 *   sessionId?: string,
 *   formId?: string,
 *   source?: string
 * }} args
 */
export async function bookAppointment(args) {
    const doctorId = String(args.doctorId || "").trim();
    const branchId = String(args.branchId || "").trim();
    const department = String(args.department || "").trim();
    const dateISO = String(args.dateISO || "").trim();
    const slotLabel = String(args.slotLabel || "").trim();
    const userId = String(args.userId || "").trim();
    const leadFields = appointmentLeadFieldsFromExtras_(/** @type {Record<string, unknown>} */ (args));

    if (!doctorId || !branchId || !department || !dateISO || !slotLabel) {
        throw new Error("Missing required fields: doctorId, branchId, department, dateISO, slotLabel.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        throw new Error("Invalid dateISO (expected YYYY-MM-DD).");
    }

    const db = getDb_();
    const slotKey = base64UrlEncode_(slotLabel);
    const ref = db.ref(`${APPOINTMENTS_ROOT}/${doctorId}/${dateISO}/${slotKey}`);
    const sessionId = leadFields.sessionId || "";
    const effectiveUserId = userId || sessionId || null;

    const result = await ref.transaction((current) => {
        if (current) {
            return; // abort
        }
        return {
            doctorId,
            branchId,
            department,
            dateISO,
            slotLabel,
            userId: effectiveUserId,
            created_at_ms: Date.now(),
            ...leadFields
        };
    });

    if (!result.committed) {
        throw new Error("Slot already booked.");
    }

    return { ok: true, key: `${doctorId}__${dateISO}__${slotKey}`, slotKey };
}

/**
 * Full appointment lead row for staff dashboards (parallel to `leads/diagnostics`).
 *
 * @param {Record<string, unknown>} record
 */
/** @typedef {"requested" | "accepted" | "declined"} AppointmentStaffStatus */

/** @param {unknown} raw */
export function normalizeAppointmentStaffStatus_(raw) {
    const s = String(raw || "")
        .trim()
        .toLowerCase();
    if (s === "accepted" || s === "confirmed" || s === "approved") {
        return /** @type {AppointmentStaffStatus} */ ("accepted");
    }
    if (s === "declined" || s === "rejected" || s === "cancelled" || s === "canceled") {
        return /** @type {AppointmentStaffStatus} */ ("declined");
    }
    return /** @type {AppointmentStaffStatus} */ ("requested");
}

/**
 * @param {Record<string, unknown>} record
 */
export async function persistAppointmentLeadRecord(record) {
    const sessionId =
        typeof record.sessionId === "string"
            ? record.sessionId.trim()
            : typeof record.client_session_id === "string"
              ? record.client_session_id.trim()
              : "";
    const mobileDigits =
        typeof record.patientMobile === "string"
            ? record.patientMobile.replace(/\D/g, "")
            : typeof record.mobile === "string"
              ? record.mobile.replace(/\D/g, "")
              : "";
    const key = sessionId || mobileDigits;
    if (!key) {
        return { ok: false, reason: "no_session_or_mobile" };
    }

    const db = getDb_();
    const ref = db.ref(`${APPOINTMENTS_LEADS_ROOT}/${key}`);
    const snap = await ref.get();
    const prev = snap.exists() && snap.val() && typeof snap.val() === "object" ? snap.val() : null;
    const prevStatus = prev ? normalizeAppointmentStaffStatus_(prev.staffStatus) : null;
    const incomingStatus = record.staffStatus
        ? normalizeAppointmentStaffStatus_(record.staffStatus)
        : null;
    let staffStatus = incomingStatus || "requested";
    if (prevStatus === "accepted" || prevStatus === "declined") {
        staffStatus = prevStatus;
    }

    const now = Date.now();
    const payload = {
        ...record,
        sessionId: sessionId || key,
        staffStatus,
        updated_at_ms: now,
        created_at_ms:
            prev && typeof prev.created_at_ms === "number" ? prev.created_at_ms : now
    };
    await ref.set(payload);
    return { ok: true, key, staffStatus };
}

/** @param {string} raw */
export function appointmentDateToIso_(raw) {
    const s = String(raw || "").trim();
    if (!s) {
        return "";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
    }
    const dmY = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmY) {
        const d = Number(dmY[1]);
        const m = Number(dmY[2]);
        const y = Number(dmY[3]);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900) {
            return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
    }
    return "";
}

/** @param {string} iso YYYY-MM-DD */
export function formatAppointmentDateDdMmYyyy_(iso) {
    const n = appointmentDateToIso_(iso);
    if (!n) {
        return "";
    }
    const [y, m, d] = n.split("-");
    return `${d}/${m}/${y}`;
}

/** @param {string} raw */
function appointmentDateInRange_(raw, dateFrom, dateTo) {
    const iso = appointmentDateToIso_(raw);
    if (!iso) {
        return false;
    }
    if (dateFrom && iso < dateFrom) {
        return false;
    }
    if (dateTo && iso > dateTo) {
        return false;
    }
    return true;
}

/**
 * @param {{ status?: string, limit?: number, dateFrom?: string, dateTo?: string }} [opts]
 */
export async function listAppointmentLeads(opts) {
    const statusFilter = opts && opts.status ? normalizeAppointmentStaffStatus_(opts.status) : "";
    const dateFrom =
        opts && opts.dateFrom ? appointmentDateToIso_(opts.dateFrom) : "";
    const dateTo = opts && opts.dateTo ? appointmentDateToIso_(opts.dateTo) : "";
    const hasDateFilter = Boolean(dateFrom || dateTo);
    const limit =
        opts && typeof opts.limit === "number" && opts.limit > 0
            ? Math.min(Math.floor(opts.limit), 500)
            : hasDateFilter
              ? 500
              : 200;

    const db = getDb_();
    const snap = await db.ref(APPOINTMENTS_LEADS_ROOT).get();
    const val = snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") {
        return [];
    }

    /** @type {Array<Record<string, unknown>>} */
    const rows = [];
    for (const [key, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : {};
        const staffStatus = normalizeAppointmentStaffStatus_(p.staffStatus);
        if (statusFilter && staffStatus !== statusFilter) {
            continue;
        }
        const appointmentDateRaw =
            typeof p.appointmentDate === "string" ? p.appointmentDate : "";
        if (hasDateFilter && !appointmentDateInRange_(appointmentDateRaw, dateFrom, dateTo)) {
            continue;
        }
        const appointmentDateIso = appointmentDateToIso_(appointmentDateRaw);
        rows.push({
            key: String(key),
            staffStatus,
            patientName: typeof p.patientName === "string" ? p.patientName : "",
            patientMobile: typeof p.patientMobile === "string" ? p.patientMobile : "",
            patientEmail: typeof p.patientEmail === "string" ? p.patientEmail : "",
            appointmentDate: appointmentDateRaw,
            appointmentDateIso,
            appointmentDateDisplay: formatAppointmentDateDdMmYyyy_(appointmentDateIso || appointmentDateRaw),
            appointmentTime: typeof p.appointmentTime === "string" ? p.appointmentTime : "",
            appointmentBooked:
                typeof p.appointmentBooked === "string" ? p.appointmentBooked : "",
            doctorId: typeof p.doctorId === "string" ? p.doctorId : "",
            branchId: typeof p.branchId === "string" ? p.branchId : "",
            department: typeof p.department === "string" ? p.department : "",
            doctorDisplay: typeof p.doctorDisplay === "string" ? p.doctorDisplay : "",
            cityOrPlace: typeof p.cityOrPlace === "string" ? p.cityOrPlace : "",
            formId: typeof p.formId === "string" ? p.formId : "",
            sessionId: typeof p.sessionId === "string" ? p.sessionId : String(key),
            source: typeof p.source === "string" ? p.source : "",
            created_at_ms: typeof p.created_at_ms === "number" ? p.created_at_ms : 0,
            updated_at_ms: typeof p.updated_at_ms === "number" ? p.updated_at_ms : 0,
            staffUpdatedBy: typeof p.staffUpdatedBy === "string" ? p.staffUpdatedBy : "",
            staffUpdatedAtMs:
                typeof p.staffUpdatedAtMs === "number" ? p.staffUpdatedAtMs : 0
        });
    }

    rows.sort((a, b) => {
        const au = Number(a.updated_at_ms) || Number(a.created_at_ms) || 0;
        const bu = Number(b.updated_at_ms) || Number(b.created_at_ms) || 0;
        return bu - au;
    });
    return rows.slice(0, limit);
}

/**
 * @param {{ key: string, staffStatus: string, updatedBy?: string }} args
 */
export async function updateAppointmentLeadStaffStatus(args) {
    const key = String(args.key || "").trim();
    const staffStatus = normalizeAppointmentStaffStatus_(args.staffStatus);
    if (!key) {
        throw new Error("Missing appointment key.");
    }
    if (staffStatus !== "accepted" && staffStatus !== "declined") {
        throw new Error("staffStatus must be accepted or declined.");
    }

    const db = getDb_();
    const ref = db.ref(`${APPOINTMENTS_LEADS_ROOT}/${key}`);
    const snap = await ref.get();
    if (!snap.exists()) {
        throw new Error("Appointment not found.");
    }

    const now = Date.now();
    const updatedBy = typeof args.updatedBy === "string" ? args.updatedBy.trim() : "";
    await ref.update({
        staffStatus,
        staffUpdatedAtMs: now,
        staffUpdatedBy: updatedBy,
        updated_at_ms: now
    });
    return { ok: true, key, staffStatus };
}

/**
 * @param {{ doctorId: string, dateISO: string }} args
 * @returns {Promise<string[]>}
 */
export async function listBookedSlots(args) {
    const doctorId = String(args.doctorId || "").trim();
    const dateISO = String(args.dateISO || "").trim();
    if (!doctorId || !dateISO) {
        return [];
    }
    const db = getDb_();
    const ref = db.ref(`${APPOINTMENTS_ROOT}/${doctorId}/${dateISO}`);
    const snap = await ref.get();
    const val = snap && snap.exists() ? snap.val() : null;
    if (!val || typeof val !== "object") {
        return [];
    }
    const out = [];
    for (const [slotKey, payload] of Object.entries(val)) {
        const p = payload && typeof payload === "object" ? payload : null;
        const slotLabel =
            p && typeof /** @type {{ slotLabel?: unknown }} */ (p).slotLabel === "string"
                ? /** @type {{ slotLabel?: string }} */ (p).slotLabel
                : "";
        if (slotLabel) {
            out.push(slotLabel);
        } else {
            // Fallback: decode key if label wasn't stored for some reason.
            try {
                out.push(base64UrlDecode_(slotKey));
            } catch {
                /* ignore */
            }
        }
    }
    return out;
}
