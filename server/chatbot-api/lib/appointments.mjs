import admin from "firebase-admin";
import "firebase-admin/database";

const APPOINTMENTS_ROOT = (process.env.FIREBASE_APPOINTMENTS_ROOT || "appointments").trim();

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
 * @param {{ doctorId: string, branchId: string, department: string, dateISO: string, slotLabel: string, userId?: string }} args
 */
export async function bookAppointment(args) {
    const doctorId = String(args.doctorId || "").trim();
    const branchId = String(args.branchId || "").trim();
    const department = String(args.department || "").trim();
    const dateISO = String(args.dateISO || "").trim();
    const slotLabel = String(args.slotLabel || "").trim();
    const userId = String(args.userId || "").trim();

    if (!doctorId || !branchId || !department || !dateISO || !slotLabel) {
        throw new Error("Missing required fields: doctorId, branchId, department, dateISO, slotLabel.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        throw new Error("Invalid dateISO (expected YYYY-MM-DD).");
    }

    const db = getDb_();
    const slotKey = base64UrlEncode_(slotLabel);
    const ref = db.ref(`${APPOINTMENTS_ROOT}/${doctorId}/${dateISO}/${slotKey}`);

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
            userId: userId || null,
            created_at_ms: Date.now()
        };
    });

    if (!result.committed) {
        throw new Error("Slot already booked.");
    }

    return { ok: true, key: `${doctorId}__${dateISO}__${slotKey}` };
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

