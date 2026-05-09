/**
 * Backend for `company.js` POST /contact-form-submissions (JSON or multipart with files).
 * Large file uploads: **Google Drive API** in this service, **or** relay to your **Apps Script web app**
 *   (`GOOGLE_APPS_SCRIPT_WEBAPP_URL` → script runs as you, no service-account Drive quota issue).
 *
 * **Easiest “files only” (no Firestore):** set on Railway `DRIVE_ONLY=1` + Apps Script or Drive API as below.
 *   Google Sheets still append when `SHEETS_SPREADSHEET_ID` is set (unless `DISABLE_SHEETS=1`);
 *   `DRIVE_ONLY` only skips Firestore, not Sheets.
 *   `DRIVE_ONLY=1` + `GOOGLE_APPS_SCRIPT_WEBAPP_URL` (recommended for personal Gmail), **or**
 *   `DRIVE_ONLY=1` + `GOOGLE_DRIVE_FOLDER_ID` + service-account JSON (**Workspace Shared drive** only).
 *
 * **Text-only leads (no attachments):** `SHEETS_SPREADSHEET_ID` + share the Sheet with the service
 *   account; `DISABLE_FIRESTORE=1` + `DISABLE_DRIVE_UPLOAD=1`.
 *
 * Env:
 *   GOOGLE_APPS_SCRIPT_WEBAPP_URL — full `/exec` URL; POST **JSON + Base64 `_files`** (see examples/apps-script-drive-upload/Code.gs)
 *   GOOGLE_APPS_SCRIPT_USE_MULTIPART=1 — legacy multipart (omit unless your script parses it)
 *   GOOGLE_DRIVE_FOLDER_ID — Drive API folder, **or** target folder sent to Apps Script as `_drive_folder_id`
 *   DRIVE_ONLY=1 — skip Firestore only; Sheets still run if SHEETS_SPREADSHEET_ID is set
 *   DISABLE_DRIVE_UPLOAD=1 — reject file fields (Sheet/text-only mode)
 *   GOOGLE_DRIVE_OAUTH_* (Drive API path; optional if Apps Script URL set)
 *   PORT, FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS
 *   DISABLE_FIRESTORE=1, FIRESTORE_DATABASE_ID, CORS_ORIGIN, SHEETS_*, DISABLE_SHEETS=1
 *
 * Chat-only mobile → Sheet row (no file upload): POST JSON `/contact-form-mobile-sheet-sync`.
 * Optional: CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET → client must send `X-Contact-Form-Mobile-Sync-Secret`.
 *
 * RTDB catalog: POST `/api/sync-catalog-from-repo` with header `X-Catalog-Sync-Secret`
 * matching `CATALOG_SYNC_SECRET` re-uploads bundled `data/doctors.upload.json` + `data/branches.upload.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import admin from "firebase-admin";
import "firebase-admin/database";
import { firebaseAdminInit } from "./lib/firebase-admin-init.mjs";
import { persistToFirestore } from "./lib/firestore.mjs";
import { appendContactRowToSheet, upsertSessionQueriesInSheet } from "./lib/sheets.mjs";
import { uploadSubmissionFilesToDrive } from "./lib/drive-upload.mjs";
import { hasDriveUploadCredentials } from "./lib/drive-auth.mjs";
import { forwardSubmissionToAppsScript } from "./lib/apps-script-upload.mjs";
import {
    resolveContactMobile,
    resolveContactEmail,
    resolveContactName,
    resolveSubmissionMobileDigits,
    scalarFormValue
} from "./lib/contact-mobile.mjs";
import { bookAppointment, listBookedSlots } from "./lib/appointments.mjs";
import { listBranches, listDepartments, listDoctors } from "./lib/catalog-rtdb.mjs";
import { upsertCatalogFromCsvFiles } from "./lib/catalog-csv-ingest.mjs";

const APPS_SCRIPT_WEBAPP_URL = (process.env.GOOGLE_APPS_SCRIPT_WEBAPP_URL || "").trim();

const __dirname_api = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DOCTORS_CSV = path.join(__dirname_api, "data", "doctors.upload.json");
const CATALOG_BRANCHES_CSV = path.join(__dirname_api, "data", "branches.upload.json");
const PATHNAME_CATALOG_SYNC = "/api/sync-catalog-from-repo";
const CATALOG_SYNC_SECRET = (process.env.CATALOG_SYNC_SECRET || "").trim();

const PORT = Number(process.env.PORT) || 8080;
const PATHNAME = "/contact-form-submissions";
const PATHNAME_MOBILE_SHEET_SYNC = "/contact-form-mobile-sheet-sync";
const PATHNAME_SESSION_SHEET_SYNC = "/contact-form-session-sheet-sync";
/** “Just put files in Drive” — skips Firestore; Sheets are independent (see SHEETS_DISABLED). */
const DRIVE_ONLY = process.env.DRIVE_ONLY === "1";
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1" || DRIVE_ONLY;
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 (independent of DRIVE_ONLY). */
const SHEETS_DISABLED =
    process.env.DISABLE_SHEETS === "1" ||
    !(process.env.SHEETS_SPREADSHEET_ID || "").trim();
/** When set, file fields are not accepted; use Sheet + service account only (no Drive/OAuth). */
const DISABLE_DRIVE_UPLOAD = process.env.DISABLE_DRIVE_UPLOAD === "1";

function hasFirebaseCredentials() {
    if ((process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()) {
        return true;
    }
    if ((process.env.FIREBASE_CONFIG || "").trim()) {
        return true;
    }
    const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    return !!(credPath && fs.existsSync(credPath));
}

const multipart = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 32 * 1024 * 1024, files: 30 }
});

/** `client_context.channel`: `web` or `whatsapp` (non-WhatsApp integrations should send `whatsapp` explicitly). */
function normalizeLeadChannel(raw) {
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return s === "whatsapp" ? "whatsapp" : "web";
}

function corsOriginOption() {
    const raw = (process.env.CORS_ORIGIN || "").trim();
    if (!raw) {
        return true;
    }
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return (origin, cb) => {
        if (!origin || list.includes(origin)) {
            return cb(null, true);
        }
        return cb(new Error("CORS blocked"));
    };
}

function stripIpv4Port_(ip) {
    const s = typeof ip === "string" ? ip.trim() : "";
    if (!s) {
        return "";
    }
    return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s) ? s.slice(0, s.lastIndexOf(":")) : s;
}

function normalizeRemoteAddress_(ip) {
    const s = typeof ip === "string" ? ip.trim() : "";
    if (!s) {
        return "";
    }
    // "::ffff:1.2.3.4" → "1.2.3.4"
    if (s.toLowerCase().startsWith("::ffff:")) {
        return s.slice("::ffff:".length);
    }
    return s;
}

function isPrivateIpv4_(ip) {
    const s = stripIpv4Port_(normalizeRemoteAddress_(ip));
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        return false;
    }
    const parts = s.split(".").map((x) => Number.parseInt(x, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
        return true;
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    // CGNAT 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function isPrivateIpv6_(ip) {
    const s = String(ip || "").trim().toLowerCase();
    if (!s) return true;
    if (s === "::1") return true;
    if (s.startsWith("fe80:")) return true; // link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local
    return false;
}

function isPublicIp_(ip) {
    const s = normalizeRemoteAddress_(stripIpv4Port_(ip));
    if (!s) return false;
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        return !isPrivateIpv4_(s);
    }
    // IPv6-ish
    if (s.includes(":")) {
        return !isPrivateIpv6_(s);
    }
    return false;
}

function bestIpFromXForwardedFor(value) {
    const raw = typeof value === "string" ? value : "";
    if (!raw.trim()) {
        return "";
    }
    // Usually: "client, proxy1, proxy2" — but some platforms prepend internal IPs.
    const parts = raw.split(",").map((x) => normalizeRemoteAddress_(stripIpv4Port_(x))).filter(Boolean);
    for (const p of parts) {
        if (isPublicIp_(p)) {
            return p;
        }
    }
    // Fall back to the first non-empty token.
    return parts[0] || "";
}

function extractRequestIp(req) {
    const h = req && req.headers ? req.headers : {};
    const xf = bestIpFromXForwardedFor(h["x-forwarded-for"]);
    if (xf) {
        return xf;
    }
    const cf = typeof h["cf-connecting-ip"] === "string" ? h["cf-connecting-ip"].trim() : "";
    if (cf) {
        return cf;
    }
    const real = typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "";
    if (real) {
        return real;
    }
    const ra = req && req.socket && typeof req.socket.remoteAddress === "string"
        ? normalizeRemoteAddress_(req.socket.remoteAddress)
        : "";
    return ra || "";
}

function normalizeUserQueriesCsvFromClientContext(clientContext) {
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const arr = Array.isArray(ctx.user_queries) ? ctx.user_queries : null;
    if (arr) {
        const cleaned = arr
            .filter((x) => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean);
        return cleaned.join(", ");
    }
    const raw = typeof ctx.user_queries_csv === "string" ? ctx.user_queries_csv.trim() : "";
    return raw;
}

const GEOIP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** @type {Map<string, { city: string, ts: number }>} */
const geoIpCityCache = new Map();

async function resolveCityForRequest(req) {
    const h = req && req.headers ? req.headers : {};
    // Prefer provider-injected city headers if present (fast/no external call).
    const fromCf = typeof h["cf-ipcity"] === "string" ? h["cf-ipcity"].trim() : "";
    if (fromCf) {
        return fromCf;
    }
    const fromVercel = typeof h["x-vercel-ip-city"] === "string" ? h["x-vercel-ip-city"].trim() : "";
    if (fromVercel) {
        return fromVercel;
    }

    const ip = extractRequestIp(req);
    if (!ip) {
        return "";
    }
    const cached = geoIpCityCache.get(ip);
    if (cached && Date.now() - cached.ts <= GEOIP_CACHE_TTL_MS) {
        return cached.city;
    }

    // Best-effort GeoIP: ipapi.co (no token). If fetch is unavailable or it errors, return empty.
    if (typeof fetch !== "function") {
        return "";
    }
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 1500);
    try {
        const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: ac.signal
        });
        if (!resp.ok) {
            return "";
        }
        const data = await resp.json().catch(() => null);
        const city = data && typeof data.city === "string" ? data.city.trim() : "";
        geoIpCityCache.set(ip, { city, ts: Date.now() });
        return city;
    } catch {
        return "";
    } finally {
        clearTimeout(timeout);
    }
}

let firebaseInitError = "";
if (hasFirebaseCredentials()) {
    try {
        firebaseAdminInit();
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        firebaseInitError = msg;
        // Do not crash the entire API on boot; endpoints that require Firebase will return 503 with details.
        console.error("[contact-form-api] Firebase init failed:", msg);
    }
}

const app = express();
app.use(cors({
    origin: corsOriginOption(),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Contact-Form-Mobile-Sync-Secret", "X-Catalog-Sync-Secret"],
    optionsSuccessStatus: 204
}));

app.options(PATHNAME, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_MOBILE_SHEET_SYNC, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_SESSION_SHEET_SYNC, (_req, res) => res.sendStatus(204));

// ---------------------------------------------------------------------------
// Catalog + appointments: Firebase Realtime Database (CSV upload → RTDB)
// ---------------------------------------------------------------------------

/** Return "mon|tue|..." from YYYY-MM-DD (UTC-based, stable) */
function weekdayKeyFromDateIso_(dateISO) {
    const d = new Date(`${dateISO}T00:00:00.000Z`);
    const wd = d.getUTCDay(); // 0=Sun
    return wd === 0 ? "sun" : wd === 1 ? "mon" : wd === 2 ? "tue" : wd === 3 ? "wed" : wd === 4 ? "thu" : wd === 5 ? "fri" : "sat";
}

/** Slot step (minutes). Override with APPOINTMENT_SLOT_MINUTES (e.g. 15, 30, 60). */
function appointmentSlotMinutes_() {
    const n = Number(process.env.APPOINTMENT_SLOT_MINUTES);
    if (Number.isFinite(n) && n >= 5 && n <= 180) {
        return Math.floor(n);
    }
    return 30;
}

/** @returns {number} minutes from midnight, NaN if invalid */
function parseClockToMinutes_(s) {
    const t = String(s || "").trim();
    if (!t) return NaN;
    const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return NaN;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + min;
}

/** Match Dialogflow CX webhook `cxTimeTo12h_` output so bookings line up with `bookAppointment`. */
function formatMinutesAsSlotLabel_(totalMinutes) {
    const h24 = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const ampm = h24 >= 12 ? "PM" : "AM";
    let h = h24 % 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Expand one range into discrete slot **start** labels (same format as `cxTimeTo12h_`).
 * Accepts "10:00 AM - 4:00 PM" or "10:00 AM-4:00 PM".
 */
function expandTimeRangeToSlotLabels_(rangeStr, intervalMin) {
    const raw = String(rangeStr || "").trim();
    if (!raw) return [];
    const m = raw.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    if (!m) return [];
    const startMin = parseClockToMinutes_(m[1]);
    const endMin = parseClockToMinutes_(m[2]);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return [];
    }
    const step = Math.max(5, intervalMin);
    /** @type {string[]} */
    const out = [];
    for (let t = startMin; t + step <= endMin; t += step) {
        out.push(formatMinutesAsSlotLabel_(t));
    }
    return out;
}

/**
 * TimingPattern segment after weekday colon: comma-separated ranges or single times.
 * @example "10:00 AM - 1:00 PM,5:00 PM-7:00 PM"
 */
function expandTimingPatternDaySegment_(segment, intervalMin) {
    const s = String(segment || "").trim();
    if (!s) return [];
    const chunks = s.split(",").map((x) => x.trim()).filter(Boolean);
    /** @type {string[]} */
    const out = [];
    for (const ch of chunks) {
        if (/\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(ch)) {
            out.push(...expandTimeRangeToSlotLabels_(ch, intervalMin));
        } else {
            const mins = parseClockToMinutes_(ch);
            if (Number.isFinite(mins)) {
                out.push(formatMinutesAsSlotLabel_(mins));
            }
        }
    }
    return out;
}

/**
 * TimingPattern (sample format):
 * "mon:10:00 AM-1:00 PM,5:00 PM-7:00 PM; wed:10:00 AM-1:00 PM; fri:5:00 PM-7:00 PM"
 */
function slotsFromTimingPattern_(timingPattern, weekdayKey) {
    const iv = appointmentSlotMinutes_();
    const s = String(timingPattern || "");
    if (!s.trim()) return [];
    const parts = s.split(";").map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
        const idx = p.indexOf(":");
        if (idx === -1) continue;
        const day = p.slice(0, idx).trim().toLowerCase();
        if (day !== weekdayKey) continue;
        const slotsStr = p.slice(idx + 1).trim();
        return expandTimingPatternDaySegment_(slotsStr, iv);
    }
    return [];
}

/**
 * Slot labels for a doctor on a calendar day: `TimingPattern` (per-weekday) or CSV `Days`+`Start`+`End`.
 */
function slotsForDoctorOnDate_(d, dateISO) {
    const weekdayKey = weekdayKeyFromDateIso_(dateISO);
    const wdShort = weekdayShort_(dateISO);
    const iv = appointmentSlotMinutes_();
    const tp = normalizeStr_(d.TimingPattern);
    if (tp) {
        return slotsFromTimingPattern_(tp, weekdayKey);
    }
    const days = normalizeStr_(d.Days);
    const start = normalizeStr_(d.Start);
    const end = normalizeStr_(d.End);
    if (!dayInDaysField_(wdShort, days)) return [];
    if (start && end) {
        return expandTimeRangeToSlotLabels_(`${start} - ${end}`, iv);
    }
    return [];
}

/** RTDB doctor id for shared “general” appointments (`GENERAL_APPOINTMENT_BOOKING_ID`, default `general`). */
function generalAppointmentBookingId_() {
    return normalizeStr_(process.env.GENERAL_APPOINTMENT_BOOKING_ID || "general");
}

/**
 * One shared schedule for the general appointment form (env-tunable).
 * Default: Mon–Fri, 9:00 AM – 5:00 PM, same slot step as doctors.
 */
function slotsForGeneralAppointment_(dateISO) {
    const wdShort = weekdayShort_(dateISO);
    const days = normalizeStr_(process.env.GENERAL_APPOINTMENT_DAYS || "Mon-Fri");
    if (!dayInDaysField_(wdShort, days)) return [];
    const start = normalizeStr_(process.env.GENERAL_APPOINTMENT_START || "9:00 AM");
    const end = normalizeStr_(process.env.GENERAL_APPOINTMENT_END || "5:00 PM");
    return expandTimeRangeToSlotLabels_(`${start} - ${end}`, appointmentSlotMinutes_());
}

// JSON helpers for CX webhooks (easier to consume than XML)
app.get("/api/branches", (_req, res) => {
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    listBranches()
        .then((branches) => res.status(200).json({ ok: true, branches, source: "firebase_rtdb" }))
        .catch((e) => {
            const msg = e && e.message ? e.message : String(e);
            res.status(500).json({ ok: false, error: msg });
        });
});

app.get("/api/departments", (req, res) => {
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId.trim() : "";
    listDepartments({ branchId: branchId || undefined })
        .then((departments) => res.status(200).json({ ok: true, branchId: branchId || null, departments, source: "firebase_rtdb" }))
        .catch((e) => {
            const msg = e && e.message ? e.message : String(e);
            res.status(500).json({ ok: false, error: msg });
        });
});

app.get("/api/doctors", (req, res) => {
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId.trim() : "";
    const department = typeof req.query.department === "string" ? req.query.department.trim() : "";
    listDoctors({ branchId: branchId || undefined, department: department || undefined })
        .then((doctors) => res.status(200).json({ ok: true, doctors, source: "firebase_rtdb" }))
        .catch((e) => {
            const msg = e && e.message ? e.message : String(e);
            res.status(500).json({ ok: false, error: msg });
        });
});

app.get("/api/doctor-month-overview", async (req, res) => {
    const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId.trim() : "";
    const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
    const mRe = /^(\d{4})-(\d{2})$/.exec(month);
    if (!doctorId || !mRe) {
        return res.status(400).json({ ok: false, error: "Missing doctorId or month (YYYY-MM)." });
    }
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    const y = parseInt(mRe[1], 10);
    const mo = parseInt(mRe[2], 10);
    let d;
    try {
        const docs = await listDoctors();
        d = docs.find((x) => String(x.DoctorId || "").trim() === doctorId) || null;
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
    if (!d) {
        return res.status(404).json({ ok: false, error: "Doctor not found." });
    }
    const daysInMonth = new Date(y, mo, 0).getDate();
    const iv = appointmentSlotMinutes_();
    /** @type {Record<string, { working: boolean, totalSlots: number, bookedCount: number, availableCount: number }>} */
    const days = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateISO = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const slots = slotsForDoctorOnDate_(d, dateISO);
        let booked = [];
        try {
            booked = await listBookedSlots({ doctorId, dateISO });
        } catch {
            booked = [];
        }
        const bookedSet = new Set(booked);
        const bookedCount = slots.filter((s) => bookedSet.has(s)).length;
        days[dateISO] = {
            working: slots.length > 0,
            totalSlots: slots.length,
            bookedCount,
            availableCount: slots.length - bookedCount
        };
    }
    return res.status(200).json({
        ok: true,
        doctorId,
        month,
        slotMinutes: iv,
        days
    });
});

app.get("/api/slots", async (req, res) => {
    const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId.trim() : "";
    const dateISO = typeof req.query.date === "string" ? req.query.date.trim() : "";
    if (!doctorId || !dateISO) {
        return res.status(400).json({ ok: false, error: "Missing doctorId or date (YYYY-MM-DD)." });
    }
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    let d;
    try {
        const docs = await listDoctors();
        d = docs.find((x) => String(x.DoctorId || "").trim() === doctorId) || null;
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
    if (!d) {
        return res.status(404).json({ ok: false, error: "Doctor not found." });
    }
    const weekdayKey = weekdayKeyFromDateIso_(dateISO);
    const slots = slotsForDoctorOnDate_(d, dateISO);
    let booked = [];
    // Booked slots come from Firebase RTDB.
    try {
        booked = await listBookedSlots({ doctorId, dateISO });
    } catch {
        booked = [];
    }
    const bookedSet = new Set(booked);
    const available = slots.filter((s) => !bookedSet.has(s));
    const slotStatuses = slots.map((label) => ({
        label,
        status: bookedSet.has(label) ? "booked" : "available"
    }));
    return res.status(200).json({
        ok: true,
        doctorId,
        dateISO,
        weekday: weekdayKey,
        slotMinutes: appointmentSlotMinutes_(),
        slots,
        booked,
        available,
        slotStatuses
    });
});

app.get("/api/general-slots", async (req, res) => {
    const dateISO = typeof req.query.date === "string" ? req.query.date.trim() : "";
    if (!dateISO) {
        return res.status(400).json({ ok: false, error: "Missing date (YYYY-MM-DD)." });
    }
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    const doctorId = generalAppointmentBookingId_();
    const slots = slotsForGeneralAppointment_(dateISO);
    let booked = [];
    try {
        booked = await listBookedSlots({ doctorId, dateISO });
    } catch {
        booked = [];
    }
    const bookedSet = new Set(booked);
    const slotStatuses = slots.map((label) => ({
        label,
        status: bookedSet.has(label) ? "booked" : "available"
    }));
    return res.status(200).json({
        ok: true,
        doctorId,
        dateISO,
        slotMinutes: appointmentSlotMinutes_(),
        slots,
        booked,
        available: slots.filter((s) => !bookedSet.has(s)),
        slotStatuses
    });
});

app.get("/api/general-month-overview", async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
    const mRe = /^(\d{4})-(\d{2})$/.exec(month);
    if (!mRe) {
        return res.status(400).json({ ok: false, error: "Missing month (YYYY-MM)." });
    }
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    const y = parseInt(mRe[1], 10);
    const mo = parseInt(mRe[2], 10);
    const doctorId = generalAppointmentBookingId_();
    const daysInMonth = new Date(y, mo, 0).getDate();
    const iv = appointmentSlotMinutes_();
    /** @type {Record<string, { working: boolean, totalSlots: number, bookedCount: number, availableCount: number }>} */
    const days = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateISO = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const slots = slotsForGeneralAppointment_(dateISO);
        let booked = [];
        try {
            booked = await listBookedSlots({ doctorId, dateISO });
        } catch {
            booked = [];
        }
        const bookedSet = new Set(booked);
        const bookedCount = slots.filter((s) => bookedSet.has(s)).length;
        days[dateISO] = {
            working: slots.length > 0,
            totalSlots: slots.length,
            bookedCount,
            availableCount: slots.length - bookedCount
        };
    }
    return res.status(200).json({
        ok: true,
        doctorId,
        month,
        slotMinutes: iv,
        days
    });
});

/** Re-push catalog from deployed `data/*.upload.json` (or legacy CSV) into RTDB (set CATALOG_SYNC_SECRET on the server). */
app.post(PATHNAME_CATALOG_SYNC, async (req, res) => {
    if (!CATALOG_SYNC_SECRET) {
        return res.sendStatus(404);
    }
    const hdr = typeof req.get("x-catalog-sync-secret") === "string"
        ? req.get("x-catalog-sync-secret").trim()
        : "";
    if (hdr !== CATALOG_SYNC_SECRET) {
        return res.status(403).json({ ok: false, error: "Forbidden." });
    }
    if (firebaseInitError) {
        return res.status(503).json({ ok: false, error: `Firebase init failed: ${firebaseInitError}` });
    }
    try {
        const out = await upsertCatalogFromCsvFiles({
            doctorsFile: CATALOG_DOCTORS_CSV,
            branchesFile: CATALOG_BRANCHES_CSV
        });
        return res.status(200).json(out);
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[contact-form-api] catalog-sync", msg);
        return res.status(500).json({ ok: false, error: msg });
    }
});

app.options(PATHNAME_CATALOG_SYNC, (_req, res) => res.sendStatus(204));

app.post("/api/book-appointment", express.json({ limit: "256kb" }), async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const doctorId = typeof body.doctorId === "string" ? body.doctorId.trim() : "";
    const branchId = typeof body.branchId === "string" ? body.branchId.trim() : "";
    const department = typeof body.department === "string" ? body.department.trim() : "";
    const dateISO = typeof body.date === "string" ? body.date.trim() : "";
    const slotLabel = typeof body.slot === "string" ? body.slot.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    try {
        const out = await bookAppointment({ doctorId, branchId, department, dateISO, slotLabel, userId });
        return res.status(200).json(out);
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const code = /already booked/i.test(msg) ? 409 : 400;
        return res.status(code).json({ ok: false, error: msg });
    }
});

// ---------------------------------------------------------------------------
// Dialogflow CX webhook (Artemis flow tags) — served from Railway
// ---------------------------------------------------------------------------

function cxText_(text, languageCode) {
    return { text: { text: [String(text || "")] }, ...(languageCode ? { languageCode } : {}) };
}

function cxChips_(options) {
    return { payload: { richContent: [[{ type: "chips", options: options.map((t) => ({ text: String(t) })) }]] } };
}

function cxAccordion_({ title, subtitle, text, imageUrl }) {
    return {
        payload: {
            richContent: [[{
                type: "accordion",
                title: String(title || ""),
                subtitle: String(subtitle || ""),
                ...(imageUrl
                    ? { image: { src: { rawUrl: String(imageUrl) } } }
                    : {}),
                text: String(text || "")
            }]]
        }
    };
}

function cxPayload_(payloadObj) {
    return { payload: payloadObj && typeof payloadObj === "object" ? payloadObj : {} };
}

function normalizeStr_(s) {
    return String(s || "").trim();
}

function normalizeLower_(s) {
    return normalizeStr_(s).toLowerCase();
}

/** CX session: catalog doctors are keyed by `BranchId` — prefer this over city. */
function sessionBranchIdFromParams_(params) {
    const p = params && typeof params === "object" ? params : {};
    return normalizeStr_(p.branch_id ?? p.branchId ?? p.branchid ?? "");
}

/**
 * Prefer explicit `branch_id` / `branchId`. If absent, use city only when it maps to **exactly one** branch row.
 * @returns {{ branchId: string, ambiguousCity: boolean }}
 */
async function resolveCatalogBranchIdFromSession_(params) {
    const direct = sessionBranchIdFromParams_(params);
    if (direct) {
        return { branchId: direct, ambiguousCity: false };
    }
    const city = normalizeStr_(params.city);
    if (!city) {
        return { branchId: "", ambiguousCity: false };
    }
    const branches = await listBranches();
    const hits = branches.filter((b) => normalizeLower_(b.City) === normalizeLower_(city));
    if (hits.length === 1) {
        return { branchId: normalizeStr_(hits[0].BranchId), ambiguousCity: false };
    }
    if (hits.length > 1) {
        return { branchId: "", ambiguousCity: true };
    }
    return { branchId: "", ambiguousCity: false };
}

function cxDateToISO_(dateObj) {
    const d = dateObj && typeof dateObj === "object" ? dateObj : {};
    const year = Number(d.year) || 0;
    const month = Number(d.month) || 0;
    const day = Number(d.day) || 0;
    if (!year || !month || !day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cxTimeTo12h_(timeObj) {
    const t = timeObj && typeof timeObj === "object" ? timeObj : {};
    const hours = Number(t.hours);
    const minutes = Number(t.minutes);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
    const h = ((hours % 24) + 24) % 24;
    const m = ((minutes % 60) + 60) % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

function weekdayShort_(dateISO) {
    const d = new Date(`${dateISO}T00:00:00.000Z`);
    const wd = d.getUTCDay();
    return wd === 0 ? "Sun" : wd === 1 ? "Mon" : wd === 2 ? "Tue" : wd === 3 ? "Wed" : wd === 4 ? "Thu" : wd === 5 ? "Fri" : "Sat";
}

function dayInDaysField_(weekdayShort, daysField) {
    const raw = normalizeStr_(daysField);
    if (!raw) return true;
    const w = weekdayShort.slice(0, 3);
    if (raw.includes("-")) {
        const parts = raw.split("-").map((x) => x.trim().slice(0, 3));
        if (parts.length === 2) {
            const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            const a = order.indexOf(parts[0]);
            const b = order.indexOf(parts[1]);
            const wi = order.indexOf(w);
            if (a !== -1 && b !== -1 && wi !== -1) {
                if (a <= b) return wi >= a && wi <= b;
                return wi >= a || wi <= b;
            }
        }
    }
    const tokens = raw.split(/[,\s]+/).map((x) => x.trim().slice(0, 3)).filter(Boolean);
    return tokens.includes(w);
}

function doctorTimingLabel_(d) {
    const days = normalizeStr_(d.Days);
    const start = normalizeStr_(d.Start);
    const end = normalizeStr_(d.End);
    if (days && start && end) return `${days}: ${start} - ${end}`;
    return "";
}

function doctorToCarouselCard_(d) {
    const doctorId = normalizeStr_(d.DoctorId);
    const title = normalizeStr_(d.DisplayDoctorName || d.DoctorName || "Doctor");
    const spec = normalizeStr_(d.Specialization);
    const desig = normalizeStr_(d.Designation);
    const city = normalizeStr_(d.City);
    const timing = doctorTimingLabel_(d);
    const subtitleParts = [
        [spec, desig].filter(Boolean).join(" • "),
        city ? `City: ${city}` : "",
        timing ? `Timings: ${timing}` : ""
    ].filter(Boolean);
    const imageUrl = normalizeStr_(d.ImageUrl);

    return {
        ctaLabel: "View",
        subtitle: subtitleParts.join(" • "),
        id: doctorId ? `doctor_${doctorId}` : `doctor_${Math.random().toString(16).slice(2)}`,
        title,
        ctaValue: doctorId || title,
        ...(imageUrl ? { imageUrl } : {})
    };
}

app.post("/webhook", express.json({ limit: "512kb" }), async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const tag = normalizeLower_(body.fulfillmentInfo && body.fulfillmentInfo.tag);
    const lang = normalizeStr_(body.languageCode) || "en";
    const sessionFull = normalizeStr_(body.sessionInfo && body.sessionInfo.session);
    const sessionId = sessionFull ? sessionFull.split("/").slice(-1)[0] : "";
    const params = body.sessionInfo && body.sessionInfo.parameters && typeof body.sessionInfo.parameters === "object"
        ? body.sessionInfo.parameters
        : {};

    const fallback = (msg) => res.json({ fulfillment_response: { messages: [cxText_(msg, lang)] } });

    try {
        if (tag === "diag_yes") {
            const dateISO = cxDateToISO_(params.testdate);
            const diagnosticName = normalizeStr_(params.diagnostics || "diagnostic");
            const data = {
                appointment_date: dateISO,
                patient_name: normalizeStr_(params.name),
                phone: normalizeStr_(params.mobile),
                age: normalizeStr_(params.age),
                test: diagnosticName,
                createdAt: new Date().toISOString()
            };
            if (!firebaseInitError && sessionId) {
                await admin.database().ref(`leads/diagnostics/${sessionId}`).set(data);
            }
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxText_(`✅ Your ${diagnosticName} appointment has been booked for ${dateISO || "the selected date"}. We will contact you soon.`, lang)
                    ]
                }
            });
        }

        if (tag === "homecare_booking") {
            const dateISO = cxDateToISO_(params.hcservicedate);
            const data = {
                service_date: dateISO,
                name: normalizeStr_(params.name),
                phone: normalizeStr_(params.mobile),
                age: normalizeStr_(params.age),
                selected_service: normalizeStr_(params.homecare),
                createdAt: new Date().toISOString()
            };
            if (!firebaseInitError && sessionId) {
                await admin.database().ref(`leads/homecare/${sessionId}`).set(data);
            }
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxText_("✅ Home care request received. We will contact you soon.", lang)
                    ]
                }
            });
        }

        if (tag === "get_states") {
            const branches = await listBranches();
            const states = Array.from(
                new Set(branches.map((b) => normalizeStr_(b.State)).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b));
            if (!states.length) return fallback("No states found.");
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxText_("Please select a state:", lang),
                        cxChips_(states)
                    ]
                }
            });
        }

        if (tag === "get_cities") {
            const state = normalizeStr_(params.state);
            const branches = await listBranches();
            const filtered = state
                ? branches.filter((b) => normalizeLower_(b.State) === normalizeLower_(state))
                : branches;
            const cities = Array.from(
                new Set(filtered.map((b) => normalizeStr_(b.City)).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b));
            if (!cities.length) return fallback("No cities found.");
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxPayload_({
                            action: "dfchat_inline_select",
                            message: "Please select a city:",
                            placeholder: "Choose a city…",
                            options: cities.map((c) => ({
                                label: String(c),
                                value: String(c)
                            }))
                        })
                    ]
                }
            });
        }

        if (tag === "get_address") {
            const state = normalizeStr_(params.state);
            const city = normalizeStr_(params.city);
            if (!state || !city) {
                return fallback("Please select both state and city.");
            }
            const branches = await listBranches();
            const matches = branches.filter(
                (b) => normalizeLower_(b.State) === normalizeLower_(state) && normalizeLower_(b.City) === normalizeLower_(city)
            );
            if (!matches.length) {
                return fallback("No address found for the selected city.");
            }
            const b = matches[0];
            const addressLines = [
                normalizeStr_(b.BranchName),
                normalizeStr_(b.Address),
                normalizeStr_(b.BranchTiming ? `Timing: ${b.BranchTiming}` : ""),
                normalizeStr_(b.ContactNumber ? `Contact: ${b.ContactNumber}` : ""),
                normalizeStr_(b.GoogleMap ? `Map: ${b.GoogleMap}` : "")
            ].filter(Boolean);
            const text = addressLines.join("\n");
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxAccordion_({
                            title: `${city}, ${state}`,
                            subtitle: "Click here for address",
                            text,
                            imageUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png"
                        }),
                        cxText_(text, lang)
                    ]
                }
            });
        }

        if (tag === "get_address_by_city_only") {
            const city = normalizeStr_(params.city);
            if (!city) {
                return fallback("Please enter a city name.");
            }
            const branches = await listBranches();
            const matches = branches.filter((b) => normalizeLower_(b.City) === normalizeLower_(city));
            if (!matches.length) {
                return fallback("No address found for this city.");
            }
            const b = matches[0];
            const state = normalizeStr_(b.State);
            const addressLines = [
                normalizeStr_(b.BranchName),
                normalizeStr_(b.Address),
                normalizeStr_(b.BranchTiming ? `Timing: ${b.BranchTiming}` : ""),
                normalizeStr_(b.ContactNumber ? `Contact: ${b.ContactNumber}` : ""),
                normalizeStr_(b.GoogleMap ? `Map: ${b.GoogleMap}` : "")
            ].filter(Boolean);
            const text = addressLines.join("\n");
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxAccordion_({
                            title: `${city}${state ? `, ${state}` : ""}`,
                            subtitle: "Click here for address",
                            text,
                            imageUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png"
                        }),
                        cxText_(text, lang)
                    ]
                }
            });
        }

        if (tag === "get_specializations") {
            const { branchId, ambiguousCity } = await resolveCatalogBranchIdFromSession_(params);
            if (ambiguousCity) {
                return fallback(
                    "Several branches serve this city — set session parameter branch_id (catalog BranchId), then try again."
                );
            }
            if (!branchId) {
                return fallback("Please select a branch first (session parameter branch_id / branchId).");
            }
            const filtered = await listDoctors({ branchId });
            const specs = Array.from(
                new Set(filtered.map((d) => normalizeStr_(d.Specialization)).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b));
            if (!specs.length) {
                return fallback(
                    "No specializations found for this branch. Check doctor catalog: BranchId must match, and Specialization must be set."
                );
            }
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxText_("Please select a specialization:", lang),
                        cxChips_(specs)
                    ]
                }
            });
        }

        if (tag === "get_doctors_by_city_and_spec") {
            const specialization = normalizeStr_(params.specialization);
            const { branchId, ambiguousCity } = await resolveCatalogBranchIdFromSession_(params);
            if (ambiguousCity) {
                return fallback(
                    "Several branches in this city — set branch_id on the session to list doctors."
                );
            }
            if (!branchId) {
                return fallback("Please select a branch first (branch_id). Doctors are listed per branch, not by city alone.");
            }
            const filtered = await listDoctors({
                branchId,
                department: specialization || undefined
            });
            if (!filtered.length) return fallback("No doctors found for this branch and specialization.");
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxPayload_({
                            cards: filtered.slice(0, 12).map(doctorToCarouselCard_),
                            message: "Pick one option:",
                            action: "open_card_carousel"
                        })
                    ]
                }
            });
        }

        if (tag === "get_doctor_details_by_name" || tag === "get_doctor_details") {
            const doctornameParam = normalizeStr_(params.doctorname);
            const rawName = doctornameParam.replace(/^Dr\.?\s*/i, "").trim();
            const idFromParam = doctornameParam.replace(/^doctor_/i, "").trim();
            const branchFilter = sessionBranchIdFromParams_(params);
            const docs = await listDoctors();
            const pool = branchFilter
                ? docs.filter((d) => String(d.BranchId || "").trim() === branchFilter)
                : docs;
            const byId = (d) => {
                const id = normalizeStr_(d.DoctorId);
                return id !== "" && id === idFromParam;
            };
            const byRaw = (d) => normalizeLower_(d.DoctorName) === normalizeLower_(rawName);
            const byDisplay = (d) => normalizeLower_(d.DisplayDoctorName) === normalizeLower_(doctornameParam);
            let match = pool.find(byId) || pool.find(byRaw) || pool.find(byDisplay) || null;
            if (!match && !branchFilter) {
                match = docs.find(byId) || docs.find(byRaw) || docs.find(byDisplay) || null;
            }
            if (!match) {
                return fallback(branchFilter ? "Doctor not found at this branch." : "Doctor not found.");
            }
            const sessionDoctorName = normalizeStr_(match.DoctorName).replace(/^Dr\.?\s*/i, "").trim();
            const days = normalizeStr_(match.Days);
            const start = normalizeStr_(match.Start);
            const end = normalizeStr_(match.End);
            const timing = days && start && end ? `${days}: ${start} - ${end}` : "Not available";
            const details =
                `👨‍⚕️ ${normalizeStr_(match.DisplayDoctorName || ("Dr. " + (match.DoctorName || "")))}\n` +
                `🩺 Specialization: ${normalizeStr_(match.Specialization)}\n` +
                `🎖 Designation: ${normalizeStr_(match.Designation)}\n` +
                `🏢 City: ${normalizeStr_(match.City)}\n` +
                `🎓 ${normalizeStr_(match.Education)}\n` +
                `🕒 Timings: ${timing}\n` +
                (normalizeStr_(match.PageUrl) ? `🔗 Profile: ${normalizeStr_(match.PageUrl)}` : "");
            return res.json({
                sessionInfo: {
                    parameters: {
                        doctorname: sessionDoctorName,
                        city: normalizeStr_(match.City),
                        branch_id: normalizeStr_(match.BranchId)
                    }
                },
                fulfillment_response: { messages: [cxText_(details, lang)] }
            });
        }

        if (tag === "book_doctor_appointment") {
            const dateISO = cxDateToISO_(params.appointmentdate);
            const timeLabel = cxTimeTo12h_(params.appointmenttime);
            const doctorName = normalizeStr_(params.doctorname).replace(/^Dr\.?\s*/i, "").trim();

            if (!dateISO || !timeLabel || !doctorName) {
                return fallback("Missing appointment details (doctor, date, or time).");
            }

            const { branchId: resolvedBranch, ambiguousCity } = await resolveCatalogBranchIdFromSession_(params);
            if (ambiguousCity) {
                return fallback("Several branches in this city — set branch_id on the session before booking.");
            }
            if (!resolvedBranch) {
                return fallback("Missing branch — set session parameter branch_id (catalog BranchId).");
            }

            const branchDocs = await listDoctors({ branchId: resolvedBranch });
            const doc =
                branchDocs.find((d) => normalizeLower_(d.DoctorName) === normalizeLower_(doctorName))
                || branchDocs.find((d) => normalizeLower_(d.DisplayDoctorName) === normalizeLower_(normalizeStr_(params.doctorname)))
                || null;
            if (!doc) return fallback("Doctor not found at this branch.");

            const wd = weekdayShort_(dateISO);
            if (!dayInDaysField_(wd, doc.Days)) {
                return res.json({
                    sessionInfo: { parameters: { appointmentdate: null, appointmenttime: null } },
                    fulfillment_response: {
                        messages: [cxText_(`❌ ${normalizeStr_(doc.DisplayDoctorName || ("Dr. " + doctorName))} is not available on ${dateISO} (${wd}). Please select another date.`, lang)]
                    }
                });
            }

            try {
                await bookAppointment({
                    doctorId: normalizeStr_(doc.DoctorId),
                    branchId: normalizeStr_(doc.BranchId || resolvedBranch || "500"),
                    department: normalizeStr_(doc.Specialization),
                    dateISO,
                    slotLabel: timeLabel,
                    userId: ""
                });
            } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                if (/already booked/i.test(msg)) {
                    return res.json({
                        fulfillment_response: {
                            messages: [cxText_(`❌ Slot already booked with Dr. ${doctorName} on ${dateISO} at ${timeLabel}. Please choose a different date and time.`, lang)]
                        }
                    });
                }
                return fallback(msg);
            }

            const placeLabel = normalizeStr_(doc.City) || `branch ${resolvedBranch}`;
            return res.json({
                fulfillment_response: {
                    messages: [cxText_(`✅ Appointment booked with Dr. ${doctorName} on ${dateISO} at ${timeLabel} (${placeLabel}).`, lang)]
                }
            });
        }

        return fallback(`Unrecognized tag: ${tag || "(empty)"}`);
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ fulfillment_response: { messages: [cxText_(msg, lang)] } });
    }
});

/**
 * Reserve RTDB slot when submitting doctor/general appointment contact forms.
 * @param {string} formId
 * @param {Record<string, string>} fields
 */
async function tryReserveAppointmentSlotFromContactForm_(formId, fields) {
    const fid = normalizeStr_(formId);
    if (fid !== "appintmentformdocot" && fid !== "appintmentformgeneral") {
        return { skip: true };
    }
    const dateISO = normalizeStr_(fields.appointmentdate);
    const slotLabel = normalizeStr_(fields.appointmenttime);
    if (!dateISO || !slotLabel) {
        return { ok: false, status: 400, error: "Missing appointment date or time.", block: true };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return { ok: false, status: 400, error: "Invalid appointment date.", block: true };
    }
    if (firebaseInitError) {
        return {
            ok: false,
            status: 503,
            error: `Firebase init failed: ${firebaseInitError}`,
            block: true
        };
    }

    if (fid === "appintmentformgeneral") {
        const slots = slotsForGeneralAppointment_(dateISO);
        if (!slots.includes(slotLabel)) {
            return {
                ok: false,
                status: 400,
                error: "That time is outside general clinic hours.",
                block: true
            };
        }
        let booked = [];
        try {
            booked = await listBookedSlots({ doctorId: generalAppointmentBookingId_(), dateISO });
        } catch {
            booked = [];
        }
        if (booked.includes(slotLabel)) {
            return { ok: false, status: 409, error: "That slot is already booked.", block: true };
        }
        try {
            await bookAppointment({
                doctorId: generalAppointmentBookingId_(),
                branchId: normalizeStr_(process.env.GENERAL_APPOINTMENT_BRANCH_ID || "500"),
                department: normalizeStr_(process.env.GENERAL_APPOINTMENT_DEPARTMENT || "General"),
                dateISO,
                slotLabel,
                userId: ""
            });
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            if (/already booked/i.test(msg)) {
                return {
                    ok: false,
                    status: 409,
                    error: "That slot was just booked. Please choose another.",
                    block: true
                };
            }
            return { ok: false, status: 400, error: msg, block: true };
        }
        return { ok: true, block: true };
    }

    const doctorId = normalizeStr_(fields.doctorId);
    if (!doctorId) {
        return {
            ok: false,
            status: 400,
            error: "Choose a doctor from the chat first (doctor carousel), then open this form.",
            block: true
        };
    }
    let doc = null;
    try {
        const docs = await listDoctors();
        doc = docs.find((x) => String(x.DoctorId || "").trim() === doctorId) || null;
    } catch (e) {
        return {
            ok: false,
            status: 500,
            error: e && e.message ? e.message : String(e),
            block: true
        };
    }
    if (!doc) {
        return { ok: false, status: 404, error: "Doctor not found.", block: true };
    }
    const wd = weekdayShort_(dateISO);
    if (!dayInDaysField_(wd, doc.Days)) {
        return {
            ok: false,
            status: 400,
            error: "This doctor is not available on that day.",
            block: true
        };
    }
    const slots = slotsForDoctorOnDate_(doc, dateISO);
    if (!slots.includes(slotLabel)) {
        return {
            ok: false,
            status: 400,
            error: "That time is outside this doctor's schedule.",
            block: true
        };
    }
    let booked = [];
    try {
        booked = await listBookedSlots({ doctorId, dateISO });
    } catch {
        booked = [];
    }
    if (booked.includes(slotLabel)) {
        return { ok: false, status: 409, error: "That slot is already booked for this doctor.", block: true };
    }
    try {
        await bookAppointment({
            doctorId,
            branchId: normalizeStr_(doc.BranchId || "500"),
            department: normalizeStr_(doc.Specialization || "General"),
            dateISO,
            slotLabel,
            userId: ""
        });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (/already booked/i.test(msg)) {
            return {
                ok: false,
                status: 409,
                error: "That slot was just booked. Please choose another.",
                block: true
            };
        }
        return { ok: false, status: 400, error: msg, block: true };
    }
    return { ok: true, block: true };
}

app.post(
    PATHNAME,
    (req, res, next) => {
        const ct = req.headers["content-type"] || "";
        if (ct.includes("multipart/form-data")) {
            return multipart.any()(req, res, (err) => {
                if (err) {
                    return res.status(413).json({
                        ok: false,
                        error: err.message || "File upload too large or invalid."
                    });
                }
                return next();
            });
        }
        return express.json({ limit: "32mb" })(req, res, next);
    },
    async (req, res) => {
        const rawBody = req.body && typeof req.body === "object" ? req.body : {};
        /** @type {Record<string, unknown>} */
        let body = rawBody;

        if (typeof body.client_context === "string") {
            try {
                body = {
                    ...body,
                    client_context: JSON.parse(body.client_context)
                };
            } catch {
                body = { ...body, client_context: {} };
            }
        }

        const uploadedFiles = Array.isArray(req.files) ? req.files : [];
        const formId = typeof body._contactFormId === "string" ? body._contactFormId : "unknown";
        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                const s = scalarFormValue(val);
                if (s) {
                    fields[k] = s;
                }
            }
        }

        try {
            const rsv = await tryReserveAppointmentSlotFromContactForm_(formId, fields);
            if (rsv && rsv.skip) {
                /* not an appointment booking form */
            } else if (rsv && rsv.ok === false) {
                return res.status(typeof rsv.status === "number" ? rsv.status : 400).json({
                    ok: false,
                    error: typeof rsv.error === "string" && rsv.error.trim() ? rsv.error.trim() : "Booking failed."
                });
            }
        } catch (be) {
            const msg = be && be.message ? be.message : String(be);
            return res.status(500).json({ ok: false, error: msg });
        }

        const name = resolveContactName(fields, body, mergedClientContext);
        const email = resolveContactEmail(fields, body, mergedClientContext);
        let mobile = resolveContactMobile(fields, body, mergedClientContext);
        if (!mobile) {
            const digitsFromContext = resolveSubmissionMobileDigits(fields, body, mergedClientContext);
            if (digitsFromContext) {
                mobile = digitsFromContext;
            }
        }
        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";

        if (DRIVE_ONLY) {
            const hasBytes = uploadedFiles.some(
                (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
            );
            if (!hasBytes) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "DRIVE_ONLY=1: include at least one file with data in the form, or remove DRIVE_ONLY to allow text-only submissions (Firestore / Sheet without attachments)."
                });
            }
        }

        /** @type {Array<Record<string, unknown>>} */
        let drive_uploads = [];
        let drive_subfolder_id = "";
        let drive_subfolder_name = "";
        /** True after a successful Apps Script forward, even if the script returns no JSON uploads. */
        let filesStoredExternally = false;

        if (uploadedFiles.length > 0 && DISABLE_DRIVE_UPLOAD) {
            return res.status(400).json({
                ok: false,
                error:
                    "This app is set to save only to Google Sheets (DISABLE_DRIVE_UPLOAD=1). " +
                    "Sheets cannot store file attachments. Remove files from the form, or set DISABLE_DRIVE_UPLOAD=0 and configure Google Drive for uploads."
            });
        }

        if (uploadedFiles.length > 0) {
            try {
                if (APPS_SCRIPT_WEBAPP_URL) {
                    const pack = await forwardSubmissionToAppsScript(APPS_SCRIPT_WEBAPP_URL, {
                        files: uploadedFiles,
                        fields,
                        clientContext: mergedClientContext,
                        formId,
                        mobile,
                        body
                    });
                    drive_uploads = pack.uploads;
                    filesStoredExternally = true;
                    const j = pack.json;
                    if (j && typeof j === "object") {
                        if (typeof j.drive_subfolder_id === "string" && j.drive_subfolder_id.trim()) {
                            drive_subfolder_id = j.drive_subfolder_id.trim();
                        }
                        if (typeof j.drive_subfolder_name === "string" && j.drive_subfolder_name.trim()) {
                            drive_subfolder_name = j.drive_subfolder_name.trim();
                        }
                    }
                } else {
                    if (!(process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim()) {
                        return res.status(500).json({
                            ok: false,
                            error:
                                "Set GOOGLE_APPS_SCRIPT_WEBAPP_URL (Apps Script /exec URL) or GOOGLE_DRIVE_FOLDER_ID (Drive API folder id)."
                        });
                    }
                    if (!hasDriveUploadCredentials()) {
                        return res.status(500).json({
                            ok: false,
                            error:
                                "File uploads need either GOOGLE_APPS_SCRIPT_WEBAPP_URL, or Drive API auth: GOOGLE_DRIVE_OAUTH_* or a service-account JSON for Workspace Shared drive."
                        });
                    }
                    const pack = await uploadSubmissionFilesToDrive(uploadedFiles, {
                        mobile,
                        clientSessionId
                    });
                    drive_uploads = pack.uploads;
                    drive_subfolder_id = pack.drive_subfolder_id || "";
                    drive_subfolder_name = pack.drive_subfolder_name || "";
                    filesStoredExternally = drive_uploads.length > 0;
                }
            } catch (ue) {
                let detail = ue && ue.message ? ue.message : String(ue);
                if (/storage quota|Service Accounts do not have storage/i.test(detail)) {
                    detail +=
                        " Use Apps Script (GOOGLE_APPS_SCRIPT_WEBAPP_URL), a Workspace Shared drive, or GOOGLE_DRIVE_OAUTH_*.";
                }
                console.error("[contact-form-api] Upload forward failed", detail, ue);
                return res.status(500).json({
                    ok: false,
                    error: detail
                });
            }
            const namesForSummary = uploadedFiles
                .map((f) => (typeof f.originalname === "string" ? f.originalname : ""))
                .filter(Boolean);
            if (namesForSummary.length && !fields.document) {
                fields.document = namesForSummary.join(", ");
            }
        }

        const iso = new Date().toISOString();
        const ip = extractRequestIp(req);
        const city = await resolveCityForRequest(req);
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);
        /** Firestore-safe payload (flattened for querying) */
        const fileLinksForSheet = drive_uploads
            .map((u) => (typeof u.web_view_link === "string" ? u.web_view_link : ""))
            .filter(Boolean)
            .join(", ");

        const record = {
            submitted_at: iso,
            form_id: formId,
            name,
            email,
            mobile,
            fields,
            client_context: mergedClientContext,
            ...(drive_uploads.length
                ? {
                    drive_uploads,
                    ...(drive_subfolder_id
                        ? { drive_subfolder_id, drive_subfolder_name }
                        : { ...(drive_subfolder_name ? { drive_subfolder_name } : {}) })
                }
                : {})
        };

        try {
            if (FIRESTORE_DISABLED && SHEETS_DISABLED && drive_uploads.length === 0 && !filesStoredExternally) {
                return res.status(500).json({
                    ok: false,
                    error: "Neither Firestore nor Sheets is enabled, and files were not stored (no Drive upload and no Apps Script success). Set SHEETS_SPREADSHEET_ID and/or Firestore, or configure GOOGLE_APPS_SCRIPT_WEBAPP_URL / Drive uploads."
                });
            }
            /** Sheets must not be skipped when Firestore fails (Firestore runs after Sheets). */
            let wroteToSheets = false;
            if (!SHEETS_DISABLED) {
                try {
                    await appendContactRowToSheet(
                        {
                            iso,
                            formId,
                            name,
                            mobile,
                            email,
                            clientSessionId,
                            browserName,
                            deviceType,
                            channel,
                            fileLinks: fileLinksForSheet,
                            ip,
                            city,
                            userQueriesCsv
                        },
                        { preferIncomingContact: true }
                    );
                    wroteToSheets = true;
                } catch (se) {
                    const detail = se && se.message ? se.message : String(se);
                    throw new Error(`Sheets: ${detail}`);
                }
            }
            if (!FIRESTORE_DISABLED) {
                try {
                    await persistToFirestore(record);
                } catch (fe) {
                    const detail = fe && fe.message ? fe.message : String(fe);
                    console.error("[contact-form-api] Firestore persist failed (Sheets already attempted)", detail, fe);
                    if (!wroteToSheets) {
                        throw new Error(`Firestore: ${detail}`);
                    }
                }
            }
            return res.status(200).json({ ok: true, message: "Saved." });
        } catch (err) {
            const message = err && err.message ? err.message : "Save failed";
            console.error("[contact-form-api]", message, err);
            return res.status(500).json({ ok: false, error: message });
        }
    }
);

/** Append one Sheet row when chat (Dialogflow) captured mobile — does not require file upload or DRIVE_ONLY. */
app.post(
    PATHNAME_MOBILE_SHEET_SYNC,
    express.json({ limit: "512kb" }),
    async (req, res) => {
        const syncSecret = (process.env.CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET || "").trim();
        if (syncSecret) {
            const sent = typeof req.headers["x-contact-form-mobile-sync-secret"] === "string"
                ? req.headers["x-contact-form-mobile-sync-secret"].trim()
                : "";
            if (sent !== syncSecret) {
                return res.status(401).json({
                    ok: false,
                    error: "Unauthorized (set X-Contact-Form-Mobile-Sync-Secret or CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET)."
                });
            }
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Google Sheets is not enabled. Set SHEETS_SPREADSHEET_ID or remove DISABLE_SHEETS=1."
            });
        }

        let body = req.body && typeof req.body === "object" ? req.body : {};

        if (typeof body.client_context === "string") {
            try {
                body = {
                    ...body,
                    client_context: JSON.parse(body.client_context)
                };
            } catch {
                body = { ...body, client_context: {} };
            }
        }

        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                const s = scalarFormValue(val);
                if (s) {
                    fields[k] = s;
                }
            }
        }

        const formId =
            typeof body._contactFormId === "string" && body._contactFormId.trim()
                ? body._contactFormId.trim()
                : "chat";
        let mobile =
            resolveContactMobile(fields, body, mergedClientContext)
            || resolveSubmissionMobileDigits(fields, body, mergedClientContext)
            || "";
        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";
        const name = resolveContactName(fields, body, mergedClientContext);
        const email = resolveContactEmail(fields, body, mergedClientContext);

        if (!mobile) {
            return res.status(400).json({ ok: false, error: "Missing mobile (send mobile or client_context.mobile)." });
        }

        const iso = new Date().toISOString();
        const ip = extractRequestIp(req);
        const city = await resolveCityForRequest(req);
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);

        try {
            await appendContactRowToSheet({
                iso,
                formId,
                name,
                mobile,
                email,
                clientSessionId,
                browserName,
                deviceType,
                channel,
                fileLinks: "",
                ip,
                city,
                userQueriesCsv
            });
            return res.status(200).json({ ok: true, message: "Sheet updated." });
        } catch (se) {
            const detail = se && se.message ? se.message : String(se);
            console.error("[contact-form-api] mobile-sheet-sync", detail, se);
            return res.status(500).json({ ok: false, error: detail });
        }
    }
);

/** Live-sync accumulated user_queries (Column N) for the chat session — no mobile required. */
app.post(
    PATHNAME_SESSION_SHEET_SYNC,
    express.json({ limit: "512kb" }),
    async (req, res) => {
        const syncSecret = (process.env.CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET || "").trim();
        if (syncSecret) {
            const sent = typeof req.headers["x-contact-form-mobile-sync-secret"] === "string"
                ? req.headers["x-contact-form-mobile-sync-secret"].trim()
                : "";
            if (sent !== syncSecret) {
                return res.status(401).json({
                    ok: false,
                    error: "Unauthorized (set X-Contact-Form-Mobile-Sync-Secret or CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET)."
                });
            }
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Google Sheets is not enabled. Set SHEETS_SPREADSHEET_ID or remove DISABLE_SHEETS=1."
            });
        }

        let body = req.body && typeof req.body === "object" ? req.body : {};

        if (typeof body.client_context === "string") {
            try {
                body = {
                    ...body,
                    client_context: JSON.parse(body.client_context)
                };
            } catch {
                body = { ...body, client_context: {} };
            }
        }

        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const channel = normalizeLeadChannel(clientContext.channel);
        const mergedClientContext = { ...clientContext, channel };

        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        if (!clientSessionId) {
            return res.status(400).json({ ok: false, error: "Missing client_session_id in client_context." });
        }

        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);
        if (!userQueriesCsv) {
            return res.status(200).json({ ok: true, message: "Nothing to sync." });
        }

        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";
        const formId =
            typeof body._contactFormId === "string" && body._contactFormId.trim()
                ? body._contactFormId.trim()
                : "chat";

        /** @type {Record<string, string>} */
        const fields = {};
        for (const [k, val] of Object.entries(body)) {
            if (!k.startsWith("_") && k !== "client_context") {
                const s = scalarFormValue(val);
                if (s) {
                    fields[k] = s;
                }
            }
        }

        let mobile =
            resolveContactMobile(fields, body, mergedClientContext)
            || resolveSubmissionMobileDigits(fields, body, mergedClientContext)
            || "";
        const name = resolveContactName(fields, body, mergedClientContext);
        const email = resolveContactEmail(fields, body, mergedClientContext);

        const iso = new Date().toISOString();
        const ip = extractRequestIp(req);
        const city = await resolveCityForRequest(req);

        try {
            await upsertSessionQueriesInSheet({
                iso,
                formId,
                name,
                mobile,
                email,
                clientSessionId,
                browserName,
                deviceType,
                channel,
                fileLinks: "",
                ip,
                city,
                userQueriesCsv
            });
            return res.status(200).json({ ok: true, message: "Queries synced." });
        } catch (se) {
            const detail = se && se.message ? se.message : String(se);
            console.error("[contact-form-api] session-sheet-sync", detail, se);
            return res.status(500).json({ ok: false, error: detail });
        }
    }
);

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Reception/staff: same-slot view as the chat widget (reads RTDB via /api/slots). */
const RECEPTION_SCHEDULE_HTML = path.join(__dirname_api, "public", "reception-schedule.html");
app.get("/reception-schedule", (_req, res) => {
    res.sendFile(RECEPTION_SCHEDULE_HTML, (err) => {
        if (err) {
            console.error("[contact-form-api] reception-schedule:", err.message);
            res.status(404).type("text/plain; charset=utf-8").send("Staff UI missing: add public/reception-schedule.html and redeploy.");
        }
    });
});

/** Opening the Railway URL in a browser hits GET / — avoid Express default "Cannot GET /". */
app.get("/", (_req, res) => {
    res.status(200).type("text/plain; charset=utf-8").send(
        [
            `Contact leads API running.`,
            `GET /reception-schedule → staff calendar (booked vs free slots).`,
            `POST JSON or multipart/form-data → ${PATHNAME}`,
            `POST JSON (chat mobile) → ${PATHNAME_MOBILE_SHEET_SYNC}`,
            `POST JSON (session queries) → ${PATHNAME_SESSION_SHEET_SYNC}`,
            `GET /health → health check.`,
            CATALOG_SYNC_SECRET
                ? `POST ${PATHNAME_CATALOG_SYNC} + X-Catalog-Sync-Secret → push doctors/branches catalog (JSON) to RTDB.`
                : `Set CATALOG_SYNC_SECRET + redeploy → POST ${PATHNAME_CATALOG_SYNC} to sync catalog JSON to RTDB.`,
            `Drive uploads + optional Firestore/Sheets (DRIVE_ONLY=1 skips Firestore only; Sheets use SHEETS_SPREADSHEET_ID).`
        ].join("\n")
    );
});

app.listen(PORT, () => {
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    const driveHint = DISABLE_DRIVE_UPLOAD
        ? "uploads=off"
        : APPS_SCRIPT_WEBAPP_URL
          ? "uploads=AppsScript"
          : "uploads=DriveAPI";
    const mode = DRIVE_ONLY ? " DRIVE_ONLY" : "";
    console.log(
        `contact-form-api listening on :${PORT} ${PATHNAME} ${PATHNAME_MOBILE_SHEET_SYNC} ${PATHNAME_SESSION_SHEET_SYNC} — ${fsHint} ${sheetHint} ${driveHint}${mode}`
    );
});
