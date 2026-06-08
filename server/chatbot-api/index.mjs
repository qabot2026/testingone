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
 *   SHEETS_CONV_DATETIME_TZ — optional IANA zone for Sheets “Conv.” column (12h display); unset defaults Asia/Kolkata; empty = server-local.
 *   CONVERSATIONS_TRANSCRIPT_TIME_INCLUDES_DATE — optional 1/true: staff transcript page shows short calendar date + time on each bubble (matches `company.js` persona clock options); omit/false = time only.
 *   Common (“general-purpose”) appointment hours: `company.config.js` → `common.generalAppointment` (any industry). Env overrides GENERAL_APPOINTMENT_*.
 *
 * Lead email (optional): staff + visitor mail — see `env.example.txt`, `lib/contact-lead-notify-email.mjs`, `lib/mail/client-lead-ack-email.mjs`, `lib/mail/appointment-client-ack-email.mjs`, `lib/mail/appointment-chatbot-staff-notify-email.mjs`; HTML layouts under `lib/mail/templates/` (`lead_mail_to_client.html`, `appointment_mail_to_user.html`, `appointment_mail_to_client.html`). SMTP_* MAIL_FROM CONTACT_LEAD_* CONTACT_APPOINTMENT_*.
 *   CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC=1 — also notify on mobile-sheet-sync when name or email is present.
 *
 * Faster contact-form submit (Sheets + Firestore both on): `CONTACT_FORM_DEFER_FIRESTORE_AFTER_RESPONSE=1` persists Firestore **after** HTTP 200 (Sheet row still authoritative for that request).
 *   `CONTACT_FORM_RESPONSE_FINISH_FALLBACK_MS` (default 3500): if `finish` is delayed, tail work (email / deferred FS) still runs.
 *
 * Chat-only mobile → Sheet row (no file upload): POST JSON `/contact-form-mobile-sheet-sync`.
 * Optional: CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET → client must send `X-Contact-Form-Mobile-Sync-Secret`.
 *
 * RTDB catalog: POST `/api/sync-catalog-from-repo` with header `X-Catalog-Sync-Secret`
 * matching `CATALOG_SYNC_SECRET` re-uploads bundled `data/doctors.upload.json` + `data/branches.upload.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
import express from "express";
import cors from "cors";
import multer from "multer";
import admin from "firebase-admin";
import "firebase-admin/database";
import { firebaseAdminInit } from "./lib/firebase-admin-init.mjs";
import {
    persistToFirestore,
    fetchLatestContactSubmissionForClientSession,
    fetchSessionChatTranscriptContext,
    patchLatestContactSubmissionClientContext,
    upsertSessionChatTranscriptDoc,
    persistChatFeedbackRecord
} from "./lib/firestore.mjs";
import {
    appendContactRowToSheet,
    fetchConversationLeadCaptureStats,
    fetchConversationSheetPreview,
    fetchConversationSheetExport,
    fetchLeadSheetUserQueriesForSession,
    fetchLeadSheetRowKeyValuesForSession,
    fetchLeadSheetChatTranscriptJsonForSession,
    formatMobileForSheetDisplay,
    getConversationDateTimeZoneForTranscript,
    formatConversationDateForSheet,
    formatConversationTimeForSheet,
    probeSheetsSpreadsheetAccess,
    sanitizeUserQueriesCsvForSheet,
    upsertSessionQueriesInSheet,
    runCoalescedSessionSheetSync_,
    patchSheetLeadBySessionId_,
    feedbackFieldsFromLeadSources_
} from "./lib/sheets.mjs";
import {
    extractCampaignParamsFromUrl,
    formatCampaignParamsForTranscript_,
    mergeCampaignParamsIntoSessionParams
} from "./lib/campaign-params.mjs";
import { formatCrmExchangeForTranscript_, syncLeadToCrm_ } from "./lib/crm-sync.mjs";
import {
    computeConversationMetricsFromClientContext_,
    mergeConversationMetricsIntoClientContext_,
    enrichClientContextForSheetMetricsAsync_
} from "./lib/conversation-metrics.mjs";
import { getServiceAccountCredentials } from "./lib/google-service-account.mjs";
import { uploadSubmissionFilesToDrive } from "./lib/drive-upload.mjs";
import { hasDriveUploadCredentials } from "./lib/drive-auth.mjs";
import { forwardSubmissionToAppsScript } from "./lib/apps-script-upload.mjs";
import {
    contactContextLookupRecord_,
    resolveContactMobile,
    resolveContactEmail,
    resolveContactName,
    resolveSubmissionMobileDigits,
    scalarFormValue
} from "./lib/contact-mobile.mjs";
import {
    bookAppointment,
    listBookedSlots,
    persistAppointmentLeadRecord
} from "./lib/appointments.mjs";
import { listBranches, listDepartments, listDoctors } from "./lib/catalog-rtdb.mjs";
import { upsertCatalogFromCsvFiles } from "./lib/catalog-csv-ingest.mjs";
import {
    mergedGeneralAppointmentSchedule_,
    resolvedGeneralAppointmentSlotMinutes_
} from "./lib/company-general-appointment.mjs";
import {
    formatLeadEmailOutcomeForJson,
    logContactLeadEmailBoot,
    maybeSendContactLeadNotifyEmail,
    missingContactLeadEmailEnvKeys_,
    sendContactLeadMailboxSelfTestPing,
    verifyContactLeadSmtpOnBoot
} from "./lib/contact-lead-notify-email.mjs";
import { currentMailProvider_ } from "./lib/mail/smtp-send.mjs";
import { isResendConfigured_ } from "./lib/mail/resend-send.mjs";
import { maybeSendClientLeadAckEmail } from "./lib/mail/client-lead-ack-email.mjs";
import { maybeSendAppointmentChatbotStaffNotifyEmail } from "./lib/mail/appointment-chatbot-staff-notify-email.mjs";
import { maybeSendAppointmentClientAckEmail } from "./lib/mail/appointment-client-ack-email.mjs";
import { mountSmsOtpRoutes } from "./lib/sms-otp/index.mjs";
import { mountWhatsappRoutes } from "./lib/whatsapp/index.mjs";
import { mountDashboardRoutes } from "./lib/dashboard/index.mjs";
import { mountLiveAgentRoutes } from "./lib/live-agent/index.mjs";
import { mountStaffPageRoutes, isQaRequest_ } from "./lib/staff-pages/index.mjs";
import { normalizeSheetFormId as normalizeStaffSheetFormId_ } from "./lib/form-staff-labels.mjs";

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
const PATHNAME_SESSION_TRANSCRIPT_SYNC = "/api/session-transcript-sync";
const PATHNAME_CHAT_FEEDBACK = "/chat-feedback";
/** “Just put files in Drive” — skips Firestore; Sheets are independent (see SHEETS_DISABLED). */
const DRIVE_ONLY = process.env.DRIVE_ONLY === "1";
const FIRESTORE_DISABLED = process.env.DISABLE_FIRESTORE === "1" || DRIVE_ONLY;
/** Sheets on when SHEETS_SPREADSHEET_ID is set and not DISABLE_SHEETS=1 (independent of DRIVE_ONLY). */
const SHEETS_DISABLED =
    process.env.DISABLE_SHEETS === "1" ||
    !(process.env.SHEETS_SPREADSHEET_ID || "").trim();
/** When set, file fields are not accepted; use Sheet + service account only (no Drive/OAuth). */
const DISABLE_DRIVE_UPLOAD = process.env.DISABLE_DRIVE_UPLOAD === "1";
/**
 * When `1`, each contact-form POST appends a new row even if chat sync already created one (duplicate session ids).
 * Default: strict — one row per `client_session_id`; form submit updates the chat-sync row.
 * Set `SHEETS_CONTACT_FORM_APPEND_FREELY=1` to allow duplicate rows. (`SHEETS_STRICT_SESSION_DEDUP=1` is legacy, same as default.)
 */
const SHEETS_CONTACT_FORM_APPEND_FREELY = process.env.SHEETS_CONTACT_FORM_APPEND_FREELY === "1";
/**
 * When `1`: after a successful Sheets append, defer `persistToFirestore` until **after** HTTP 200 finishes.
 * Faster “Saved…” for chat users; Sheets remains the authoritative row for this request.
 */
const DEFER_FIRESTORE_UNTIL_AFTER_HTTP_RESPONSE =
    !FIRESTORE_DISABLED &&
    !SHEETS_DISABLED &&
    process.env.CONTACT_FORM_DEFER_FIRESTORE_AFTER_RESPONSE === "1";

/**
 * Copy Dialogflow `session_params` contact fields onto top-level `client_context` for Sheets / Firestore.
 *
 * @param {Record<string, unknown>} clientContext
 */
function hydrateClientContextContactFromSession_(clientContext) {
    const base =
        clientContext && typeof clientContext === "object" && !Array.isArray(clientContext)
            ? { ...clientContext }
            : {};
    const lookup = contactContextLookupRecord_(base);
    const name = resolveContactName({}, {}, lookup);
    const mobile = resolveContactMobile({}, {}, lookup);
    const email = resolveContactEmail({}, {}, lookup);
    if (name) {
        base.name = name;
    }
    if (mobile) {
        base.mobile = mobile;
    }
    if (email) {
        base.email = email;
    }
    return base;
}

/**
 * Live session transcript doc + patch newest lead `client_context` (bot lines for staff script).
 *
 * @param {string} sessionId
 * @param {Record<string, unknown>} clientContext
 * @returns {Promise<{ sessionStored: boolean, leadPatched: boolean }>}
 */
async function patchSessionTranscriptFirestore_(sessionId, clientContext) {
    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!sid || FIRESTORE_DISABLED || !clientContext || typeof clientContext !== "object") {
        return { sessionStored: false, leadPatched: false };
    }
    const cx = /** @type {Record<string, unknown>} */ ({ ...clientContext });
    const ct = coerceChatTranscriptArray_(cx.chat_transcript);
    const aq = Array.isArray(cx.assistant_queries) ? cx.assistant_queries : [];
    const uq = Array.isArray(cx.user_queries) ? cx.user_queries : [];
    if (!ct.length && !aq.length && !uq.length) {
        return { sessionStored: false, leadPatched: false };
    }
    cx.chat_transcript = ct;
    if (aq.length) {
        cx.assistant_queries = aq;
    }
    try {
        await upsertSessionChatTranscriptDoc(sid, cx);
        let leadPatched = false;
        try {
            leadPatched = await patchLatestContactSubmissionClientContext(sid, cx);
        } catch (le) {
            const detail =
                le && /** @type {{ message?: string }} */ (le).message ? String(le.message) : String(le);
            console.warn("[chatbot-api] patchSessionTranscriptFirestore lead:", detail.slice(0, 240));
        }
        return { sessionStored: true, leadPatched: !!leadPatched };
    } catch (e) {
        const detail = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        console.warn("[chatbot-api] patchSessionTranscriptFirestore:", detail.slice(0, 240));
        return { sessionStored: false, leadPatched: false };
    }
}

/**
 * Widget session sync auth — same rule as POST /contact-form-session-sheet-sync (not staff CONVERSATIONS_SHEET_VIEW_SECRET).
 *
 * @param {import("express").Request} req
 * @returns {{ ok: boolean }}
 */
function contactFormSessionSyncSecretFromReq_(req) {
    const syncSecret = (process.env.CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET || "").trim();
    if (!syncSecret) {
        return { ok: true };
    }
    const sent =
        typeof req.headers["x-contact-form-mobile-sync-secret"] === "string"
            ? req.headers["x-contact-form-mobile-sync-secret"].trim()
            : "";
    const authHdr =
        typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    const bearer = authHdr.toLowerCase().startsWith("bearer ") ? authHdr.slice(7).trim() : "";
    if (sent === syncSecret || bearer === syncSecret) {
        return { ok: true };
    }
    return { ok: false };
}

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

import { normalizeLeadChannel } from "./lib/meta-channels/normalize-channel.mjs";

/** Source page URL for Sheets (from `company.js` `getClientContext()` + fallbacks). */
function resolveSourceUrlForSheet(cx) {
    const o = cx && typeof cx === "object" ? cx : {};
    const direct =
        (typeof o.source_url === "string" ? o.source_url.trim() : "")
        || (typeof o.sourceUrl === "string" ? o.sourceUrl.trim() : "")
        || (typeof o.page_url === "string" ? o.page_url.trim() : "")
        || (typeof o.url === "string" ? o.url.trim() : "");
    if (direct) {
        return direct;
    }
    const po = typeof o.page_origin === "string" ? o.page_origin.trim() : "";
    const pp = typeof o.page_path === "string" ? o.page_path.trim() : "";
    if (po && pp) {
        return `${po}${pp}`;
    }
    return typeof o.referrer_url === "string" ? o.referrer_url.trim() : "";
}

/** Normalize `_contactFormId` for Sheets; chat-only rows use `web` unless `DEFAULT_SHEET_FORM_ID` is set. */
function normalizeSheetFormId(explicit) {
    return normalizeStaffSheetFormId_(explicit, (process.env.DEFAULT_SHEET_FORM_ID || "").trim());
}

/**
 * Milliseconds to wait **after** response flush (and deferred Firestore, if any) before SMTP send.
 * Default 60000 (1 min); set CONTACT_LEAD_EMAIL_DELAY_MS=0 for immediate sending.
 */
function resolveContactLeadEmailDelayMs_() {
    const rawStr = (process.env.CONTACT_LEAD_EMAIL_DELAY_MS ?? "").trim();
    if (!rawStr) {
        return 60000;
    }
    const n = Number(rawStr);
    if (!Number.isFinite(n)) {
        return 60000;
    }
    return Math.min(Math.max(Math.round(n), 0), 15 * 60 * 1000);
}

/**
 * After HTTP **200 OK** is flushed, run optional deferred Firestore + lead email exactly once.
 * Uses `finish` plus a fallback timeout (Railway/CDN quirks can delay or skip `finish`).
 *
 * @param {import('express').Response | null | undefined} res
 * @param {{
 *   deferFirestoreRecord?: Record<string, unknown> | null,
 *   leadEmailPayload: Record<string, unknown>,
 * }} work
 */
function scheduleContactPostSuccessTail_(res, work) {
    const fallbackMs = Math.min(
        Math.max(Number(process.env.CONTACT_FORM_RESPONSE_FINISH_FALLBACK_MS) || 3500, 800),
        30000
    );
    /** @type {boolean} */
    let ran = false;
    const runner = async () => {
        if (ran) {
            return;
        }
        ran = true;
        if (
            work.deferFirestoreRecord
            && typeof work.deferFirestoreRecord === "object"
            && Object.keys(work.deferFirestoreRecord).length
        ) {
            const fsT0 = Date.now();
            try {
                await persistToFirestore(work.deferFirestoreRecord);
                const defRec = work.deferFirestoreRecord;
                const defSid =
                    typeof defRec.client_session_id === "string"
                        ? defRec.client_session_id.trim()
                        : "";
                const defCx =
                    defRec.client_context && typeof defRec.client_context === "object"
                        ? /** @type {Record<string, unknown>} */ (defRec.client_context)
                        : null;
                if (defSid && defCx) {
                    await patchSessionTranscriptFirestore_(defSid, defCx);
                }
                console.log(`[contact-form] deferred_firestore_ms=${Date.now() - fsT0}`);
            } catch (fe) {
                const detail = fe && fe.message ? String(fe.message) : String(fe);
                console.error(
                    "[chatbot-api] Deferred Firestore failed after HTTP 200 (Sheet row OK):",
                    detail,
                    fe
                );
            }
        }
        try {
            const p =
                work.leadEmailPayload && typeof work.leadEmailPayload === "object"
                    ? work.leadEmailPayload
                    : {};
            const nm = typeof p.name === "string" ? p.name.trim() : "";
            const visitorEmail = typeof p.email === "string" ? p.email.trim() : "";
            const mob = typeof p.mobile === "string" ? p.mobile.trim() : "";
            const ct = typeof p.city === "string" ? p.city.trim() : "";
            const src = typeof p.source === "string" ? p.source.trim() : "contact-form";
            const surl = typeof p.sourceUrl === "string" ? p.sourceUrl.trim() : "";
            const subAt = typeof p.submittedAtIso === "string" ? p.submittedAtIso.trim() : "";

            const ackLead = await maybeSendClientLeadAckEmail({
                name: nm,
                email: visitorEmail,
                mobile: mob,
                city: ct,
                source: src,
                sourceUrl: surl,
                submittedAtIso: subAt
            });
            if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1" && !(ackLead && ackLead.sent)) {
                console.log(
                    "[contact-form] client_lead_ack:",
                    "skipped" in ackLead ? `skipped:${ackLead.reason}` : ("error" in ackLead ? `error:${ackLead.error}` : "?")
                );
            }

            const apBk =
                typeof p.appointmentBooked === "string" ? p.appointmentBooked.trim() : "";
            const apDt =
                typeof p.appointmentDate === "string" ? p.appointmentDate.trim() : "";
            const apTm =
                typeof p.appointmentTime === "string" ? p.appointmentTime.trim() : "";
            const bookedServerSide =
                /^yes$/i.test(apBk) && Boolean(apDt && apTm) && visitorEmail;
            const appointmentRtdb =
                /^yes$/i.test(apBk)
                && Boolean(apDt && apTm)
                && (p.appointmentBookedServer === true || bookedServerSide);
            if (appointmentRtdb) {
                const fieldsReadyRtdb =
                    p.fields && typeof p.fields === "object" && !Array.isArray(p.fields);
                const fieldsRtdb = fieldsReadyRtdb
                    ? /** @type {Record<string, string>} */ (p.fields)
                    : {};
                await persistAppointmentLeadToRtdbBestEffort_({
                    sessionId:
                        typeof p.clientSessionId === "string" ? p.clientSessionId.trim() : "",
                    formId: typeof p.formId === "string" ? p.formId.trim() : "",
                    patientName: nm,
                    patientMobile: mob,
                    patientEmail: visitorEmail,
                    appointmentDate: apDt,
                    appointmentTime: apTm,
                    appointmentBooked: apBk,
                    doctorId: normalizeStr_(fieldsRtdb.doctorId),
                    branchId: normalizeStr_(fieldsRtdb.branchId),
                    source: "contact-form"
                });
            }
            if (bookedServerSide) {
                const fieldsReady =
                    p.fields
                    && typeof p.fields === "object"
                    && !Array.isArray(p.fields);
                const fieldsRaw = fieldsReady
                    ? /** @type {Record<string, unknown>} */ (p.fields)
                    : {};
                /** @type {Record<string, string>} */
                const lc = {};
                for (const [fk, fv] of Object.entries(fieldsRaw)) {
                    if (typeof fv === "string" && fv.trim()) {
                        lc[String(fk).toLowerCase()] = fv.trim();
                    }
                }
                const dn =
                    lc.doctornamedisplay ||
                    lc.doctordisplay ||
                    lc.doctorname ||
                    lc.doctor_name ||
                    lc.doctor ||
                    "";
                const doctorDisplayGuess = dn ? (/\bdr\.?\s/i.test(dn) ? dn : `Dr. ${dn}`) : "";

                const apAck = await maybeSendAppointmentClientAckEmail({
                    toEmail: visitorEmail,
                    recipientName: nm,
                    doctorDisplay:
                        doctorDisplayGuess || lc.displaydoctorname || "Your appointment slot",
                    specialization: lc.specialization || lc.department || lc.dept || "",
                    branchId: "",
                    dateISO: apDt,
                    slotLabel: apTm,
                    cityOrPlace: ct,
                    source: "contact-form-submission",
                    mobile: mob
                });
                if (
                    (process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1"
                    && !(apAck && apAck.sent)
                ) {
                    console.log(
                        "[contact-form] appointment_client_ack:",
                        "skipped" in apAck ? `skipped:${apAck.reason}` : ("error" in apAck ? `error:${apAck.error}` : "?")
                    );
                }
            }

            const delayMs = resolveContactLeadEmailDelayMs_();
            if (delayMs > 0) {
                console.log(`[contact-form] lead_email_delay_wait_ms=${delayMs}`);
                await new Promise((r) => globalThis.setTimeout(r, delayMs));
            }
            const mailOut = await maybeSendContactLeadNotifyEmail(work.leadEmailPayload);
            const outcomeJson = formatLeadEmailOutcomeForJson(mailOut);
            if (mailOut && mailOut.sent) {
                console.log("[contact-form] lead_notify_tail:", JSON.stringify(outcomeJson));
            } else {
                console.warn("[contact-form] lead_notify_tail:", JSON.stringify(outcomeJson));
            }
        } catch (leadErr) {
            console.error(
                "[chatbot-api] lead notify email (unexpected throw)",
                leadErr && leadErr.message ? leadErr.message : leadErr
            );
        }
    };
    const kick = () => {
        void runner();
    };
    if (res && typeof res.once === "function") {
        res.once("finish", kick);
    }
    globalThis.setTimeout(() => {
        if (!ran) {
            console.warn(
                `[contact-form] tail work not started after ${fallbackMs}ms (` +
                    "finish fallback) — running Firestore/email now"
            );
            kick();
        }
    }, fallbackMs);
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

function stringifyClientContextCsvHint_(maybe) {
    const s = typeof maybe === "string" ? maybe.trim() : "";
    return s.length && s.length <= 8000 ? s : "";
}

/** @param {string} s */
function userQueryLineCompareNorm_(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .slice(0, 200);
}

function collectUserQueriesLinesFromContext_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return [];
    }
    /** @type {string[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    /** @param {string} cell */
    const pushLine = (cell) => {
        const t = typeof cell === "string" ? cell.trim() : "";
        if (!t || t.length > 8000 || isUserQuerySheetAndSummaryNoise_(t)) {
            return;
        }
        const nk = userQueryLineCompareNorm_(t);
        if (!nk || seen.has(nk)) {
            return;
        }
        seen.add(nk);
        out.push(t);
    };
    const keys = ["user_queries", "chat_queries", "visitor_queries", "dialog_queries", "conversation_queries"];
    for (let i = 0; i < keys.length; i += 1) {
        const a = ctx[keys[i]];
        if (!Array.isArray(a)) {
            continue;
        }
        for (let j = 0; j < a.length; j += 1) {
            const cell = typeof a[j] === "string" ? a[j] : "";
            pushLine(cell);
        }
    }
    const raw = coerceChatTranscriptArray_(ctx.chat_transcript);
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (!item || typeof item !== "object") {
            continue;
        }
        const rec = /** @type {Record<string, unknown>} */ (item);
        if (normalizeTranscriptItemRole_(rec) !== "user") {
            continue;
        }
        const text = transcriptTurnTextFromItem_(rec);
        if (text && !/^form submission\b/i.test(text.trim())) {
            pushLine(text);
        }
    }
    return out;
}

/** Form dismiss / internal tokens — script transcript only, not Sheet or Summary. */
function isUserQuerySheetAndSummaryNoise_(raw) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) {
        return true;
    }
    if (/^__form_closed:/i.test(t)) {
        return true;
    }
    if (/\bform\s+closed\.?$/i.test(t)) {
        return true;
    }
    return false;
}

/** @param {string} raw */
function userQueryLineForDisplayAndSheet_(raw) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t || isUserQuerySheetAndSummaryNoise_(t)) {
        return "";
    }
    return t;
}

/** Ordered `user_queries` array — no dedupe (Sheet + chatscript need every visitor line). */
function userQueryLinesFromContextOrdered_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return [];
    }
    /** @type {string[]} */
    const out = [];
    const uq = Array.isArray(ctx.user_queries) ? ctx.user_queries : [];
    for (let i = 0; i < uq.length; i += 1) {
        const raw = typeof uq[i] === "string" ? uq[i].trim() : "";
        if (!raw || shouldOmitTranscriptUserTurn_(raw)) {
            continue;
        }
        const line = userQueryLineForDisplayAndSheet_(raw);
        if (line) {
            out.push(line);
        }
    }
    return out;
}

function normalizeUserQueriesCsvFromClientContext(clientContext) {
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};

    let lines = userQueryLinesFromContextOrdered_(ctx);
    if (!lines.length) {
        lines = collectUserQueriesLinesFromContext_(ctx);
    }
    let csv = sanitizeUserQueriesCsvForSheet(lines.join(", "), { preserveAllChatQueries: true });
    const extraCsv =
        stringifyClientContextCsvHint_(ctx.user_queries_csv)
        || stringifyClientContextCsvHint_(ctx.chat_queries_csv)
        || stringifyClientContextCsvHint_(ctx.queries_csv);
    const extraSan = sanitizeUserQueriesCsvForSheet(extraCsv, { preserveAllChatQueries: true });
    if (extraSan) {
        csv = sanitizeUserQueriesCsvForSheet(csv ? `${csv}, ${extraSan}` : extraSan, {
            preserveAllChatQueries: true
        });
    }
    return csv;
}

/** At least one user chat line (message or chip) — welcome-only sessions are not conversations. */
function clientContextHasUserChatEngagement_(clientContext) {
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    if (collectUserQueriesLinesFromContext_(ctx).length > 0) {
        return true;
    }
    if (normalizeUserQueriesCsvFromClientContext(ctx)) {
        return true;
    }
    const raw = ctx.chat_transcript;
    if (!Array.isArray(raw)) {
        return false;
    }
    for (let i = 0; i < raw.length; i += 1) {
        const it = raw[i];
        if (!it || typeof it !== "object") {
            continue;
        }
        const role = String(/** @type {{ role?: unknown }} */ (it).role || "")
            .trim()
            .toLowerCase();
        if (role !== "user") {
            continue;
        }
        const text = typeof /** @type {{ text?: unknown }} */ (it).text === "string"
            ? /** @type {{ text: string }} */ (it).text.trim()
            : "";
        if (text) {
            return true;
        }
    }
    return false;
}

/** Drop bot-only transcript payloads when the visitor never messaged in chat. */
function clientContextForStorageWithoutChatScriptUnlessEngaged_(clientContext) {
    const ctx = clientContext && typeof clientContext === "object" ? clientContext : {};
    if (clientContextHasUserChatEngagement_(ctx)) {
        return ctx;
    }
    const out = { ...ctx };
    delete out.chat_transcript;
    delete out.assistant_queries;
    delete out.chat_transcript_seq;
    if (Array.isArray(out.user_queries)) {
        out.user_queries = [];
    }
    return out;
}

/** First non-empty string among common Dialogflow/widget keys sent in `client_context`. */
function pickCityFromClientContextMerged_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return "";
    }
    const sp =
        ctx.session_params && typeof ctx.session_params === "object" && !Array.isArray(ctx.session_params)
            ? /** @type {Record<string, unknown>} */ (ctx.session_params)
            : {};
    const aliases = ["city", "user_city", "visitor_city", "selected_city", "geo_city", "preferred_city", "home_city"];
    for (let i = 0; i < aliases.length; i += 1) {
        const key = aliases[i];
        const raw = ctx[key] ?? sp[key];
        const v = typeof raw === "string" ? raw.trim() : "";
        if (v && v.length <= 200 && !/^\$session\.params\./i.test(v)) {
            return v;
        }
    }
    return "";
}

const GEOIP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** @type {Map<string, { city: string, countryCode: string, country: string, ts: number }>} */
const geoIpCityCache = new Map();

async function resolveGeoForRequest(req) {
    const h = req && req.headers ? req.headers : {};
    const cityFromCf = typeof h["cf-ipcity"] === "string" ? h["cf-ipcity"].trim() : "";
    const cityFromVercel = typeof h["x-vercel-ip-city"] === "string" ? h["x-vercel-ip-city"].trim() : "";
    const countryFromCf = typeof h["cf-ipcountry"] === "string" ? h["cf-ipcountry"].trim().toUpperCase() : "";
    const countryFromVercel = typeof h["x-vercel-ip-country"] === "string" ? h["x-vercel-ip-country"].trim().toUpperCase() : "";
    const headerCity = cityFromCf || cityFromVercel;
    const headerCountryCode = countryFromCf || countryFromVercel;
    if (headerCity || headerCountryCode) {
        return { city: headerCity, countryCode: headerCountryCode, country: "" };
    }

    const ip = extractRequestIp(req);
    if (!ip) {
        return { city: "", countryCode: "", country: "" };
    }
    const cached = geoIpCityCache.get(ip);
    if (cached && Date.now() - cached.ts <= GEOIP_CACHE_TTL_MS) {
        return {
            city: cached.city || "",
            countryCode: cached.countryCode || "",
            country: cached.country || ""
        };
    }

    // Best-effort GeoIP: ipapi.co (no token). If fetch is unavailable or it errors, return empty.
    if (typeof fetch !== "function") {
        return { city: "", countryCode: "", country: "" };
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
            return { city: "", countryCode: "", country: "" };
        }
        const data = await resp.json().catch(() => null);
        const city = data && typeof data.city === "string" ? data.city.trim() : "";
        const countryCode = data && typeof data.country_code === "string" ? data.country_code.trim().toUpperCase() : "";
        const country = data && typeof data.country_name === "string" ? data.country_name.trim() : "";
        geoIpCityCache.set(ip, { city, countryCode, country, ts: Date.now() });
        return { city, countryCode, country };
    } catch {
        return { city: "", countryCode: "", country: "" };
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveCityForRequest(req) {
    const geo = await resolveGeoForRequest(req);
    return geo.city || "";
}

let firebaseInitError = "";
if (hasFirebaseCredentials()) {
    try {
        firebaseAdminInit();
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        firebaseInitError = msg;
        // Do not crash the entire API on boot; endpoints that require Firebase will return 503 with details.
        console.error("[chatbot-api] Firebase init failed:", msg);
    }
}

const app = express();
app.use(cors({
    origin: corsOriginOption(),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "X-Contact-Form-Mobile-Sync-Secret",
        "X-Catalog-Sync-Secret",
        "X-Chat-Feedback-Secret"
    ],
    optionsSuccessStatus: 204
}));

app.options(PATHNAME, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_MOBILE_SHEET_SYNC, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_SESSION_SHEET_SYNC, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_SESSION_TRANSCRIPT_SYNC, (_req, res) => res.sendStatus(204));
app.options(PATHNAME_CHAT_FEEDBACK, (_req, res) => res.sendStatus(204));

// SMS OTP routes: /api/sms-otp/send, /api/sms-otp/verify, /api/sms-otp/health.
// Active provider via SMS_OTP_PROVIDER env (default "msg91"). See lib/sms-otp/README.md.
mountSmsOtpRoutes(app);

// WhatsApp Cloud API: GET/POST /api/whatsapp/webhook, GET /api/whatsapp/health
mountWhatsappRoutes(app);

// Customization dashboard: /dashboard (static SPA) + /api/dashboard/* (auth + settings)
// + /api/public/widget-settings (read by chat-frame.html on load). See lib/dashboard/README.md.
mountDashboardRoutes(app);

// Live human-agent inbox: /live-agent (agent SPA) + /api/live-agent/* (see lib/live-agent/README.md).
mountLiveAgentRoutes(app);

// ---------------------------------------------------------------------------
// Catalog + appointments: Firebase Realtime Database (CSV upload → RTDB)
// ---------------------------------------------------------------------------

/** Return "mon|tue|..." from YYYY-MM-DD (UTC-based, stable) */
function weekdayKeyFromDateIso_(dateISO) {
    const d = new Date(`${dateISO}T00:00:00.000Z`);
    const wd = d.getUTCDay(); // 0=Sun
    return wd === 0 ? "sun" : wd === 1 ? "mon" : wd === 2 ? "tue" : wd === 3 ? "wed" : wd === 4 ? "thu" : wd === 5 ? "fri" : "sat";
}

/**
 * Normalize a contact-form or CX string to YYYY-MM-DD.
 * Accepts ISO YYYY-MM-DD or day-first DD-MM-YYYY (e.g. 13-05-2026).
 * @param {unknown} raw
 * @returns {string}
 */
function appointmentDateInputToIso_(raw) {
    const t = normalizeStr_(raw);
    if (!t) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
    if (slash) {
        const dd = Number(slash[1]);
        const mo = Number(slash[2]);
        const yyyy = Number(slash[3]);
        if (!Number.isFinite(dd) || !Number.isFinite(mo) || !Number.isFinite(yyyy)) return "";
        if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > 2100) return "";
        return `${yyyy}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
    if (!m) return "";
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    const d = parseInt(dd, 10);
    const mo = parseInt(mm, 10);
    const y = parseInt(yyyy, 10);
    if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return "";
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return "";
    return `${yyyy}-${mm}-${dd}`;
}

/** Normalize appointment date to DD-MM-YYYY format for Sheets. */
function normalizeAppointmentDateToDDMMYYYY_(raw) {
    const t = normalizeStr_(raw);
    if (!t) return "";
    if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
        const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
        const dd = m[1];
        const mm = m[2];
        const yyyy = m[3];
        const d = parseInt(dd, 10);
        const mo = parseInt(mm, 10);
        const y = parseInt(yyyy, 10);
        if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return "";
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return "";
        return t; // already DD-MM-YYYY
    }
    // If it's ISO, convert to DD-MM-YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const [yyyy, mm, dd] = t.split('-');
        return `${dd}-${mm}-${yyyy}`;
    }
    return "";
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

/** RTDB doctor id for shared “general” appointments — from `company.config.js` → `common.generalAppointment`, overridable by env. */
function generalAppointmentBookingId_() {
    return normalizeStr_(mergedGeneralAppointmentSchedule_().bookingId);
}

/**
 * One shared schedule for the general appointment form — defaults in `company.config.js` (`common.generalAppointment`).
 * Env vars override when set on the server.
 */
/** @param {{ querySlotMinutes?: string, formSlotMinutes?: string }} [hints] */
function slotsForGeneralAppointment_(dateISO, hints = undefined) {
    const cfg = mergedGeneralAppointmentSchedule_();
    const wdShort = weekdayShort_(dateISO);
    const days = normalizeStr_(cfg.days);
    if (!dayInDaysField_(wdShort, days)) return [];
    const start = normalizeStr_(cfg.start);
    const end = normalizeStr_(cfg.end);
    const iv = resolvedGeneralAppointmentSlotMinutes_(hints || {}, appointmentSlotMinutes_);
    return expandTimeRangeToSlotLabels_(`${start} - ${end}`, iv);
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

/** In-process cache of the bundled branches JSON used to backfill missing fields from RTDB. */
let bundledBranchesCache_ = null;

function readBundledBranchesFile_() {
    if (bundledBranchesCache_) return bundledBranchesCache_;
    try {
        const raw = fs.readFileSync(CATALOG_BRANCHES_CSV, "utf8");
        const parsed = JSON.parse(raw);
        bundledBranchesCache_ = Array.isArray(parsed) ? parsed : [];
    } catch {
        bundledBranchesCache_ = [];
    }
    return bundledBranchesCache_;
}

/**
 * For each branch returned by RTDB, fill in `Latitude`/`Longitude` (and any other
 * missing fields) from the bundled JSON file when the RTDB value is empty.
 * @param {Array<Record<string, unknown>>} branchesFromDb
 */
function backfillBranchFieldsFromBundle_(branchesFromDb) {
    if (!Array.isArray(branchesFromDb) || !branchesFromDb.length) return branchesFromDb;
    const bundle = readBundledBranchesFile_();
    if (!bundle.length) return branchesFromDb;
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const b of bundle) {
        const id = String((b && (b.BranchId || b.branchId)) || "").trim();
        if (id) byId.set(id, b);
    }
    return branchesFromDb.map((row) => {
        const id = String((row && (row.BranchId || row.branchId)) || "").trim();
        const ref = id ? byId.get(id) : null;
        if (!ref) return row;
        const merged = { ...row };
        for (const [k, v] of Object.entries(ref)) {
            const cur = merged[k];
            const curStr = typeof cur === "string" ? cur.trim() : cur == null ? "" : String(cur);
            if (!curStr && v != null && v !== "") {
                merged[k] = v;
            }
        }
        return merged;
    });
}

/**
 * Read branches from RTDB if available; fall back to the bundled JSON file so
 * `/api/nearest-branches` keeps working in dev / when Firebase is not configured.
 * When RTDB rows are missing fields (e.g. empty Latitude/Longitude after a
 * partial sync), backfill from the bundled file matched by BranchId.
 * @returns {Promise<Array<Record<string, string>>>}
 */
async function readBranchesWithFallback_() {
    if (!firebaseInitError) {
        try {
            const list = await listBranches();
            if (Array.isArray(list) && list.length) {
                return backfillBranchFieldsFromBundle_(list);
            }
        } catch {
            /* fall through to file */
        }
    }
    return readBundledBranchesFile_();
}

/** Haversine distance between two coordinates in **kilometres**. */
function haversineKm_(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * GET /api/nearest-branches?lat=<num>&lng=<num>&limit=<1-50>
 * Returns branches sorted by distance from the supplied coordinates.
 * Branches without numeric Latitude/Longitude are filtered out.
 */
/** Best-effort visitor city from CDN headers or GeoIP (widget stores in `client_context.city`). */
app.get("/api/visitor-city", async (req, res) => {
    try {
        const geo = await resolveGeoForRequest(req);
        return res.status(200).json({
            ok: true,
            city: geo.city || "",
            countryCode: geo.countryCode || "",
            country_code: geo.countryCode || "",
            country: geo.country || ""
        });
    } catch (e) {
        const detail = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: detail.slice(0, 240) });
    }
});

/**
 * @param {Record<string, unknown>} ctx
 * @param {import("express").Request} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function mergeVisitorCityIntoClientContext_(ctx, req) {
    const merged = ctx && typeof ctx === "object" ? { ...ctx } : {};
    const hasCity = !!pickCityFromClientContextMerged_(merged);
    const hasCountryCode = typeof merged.country_code === "string" && merged.country_code.trim()
        || typeof merged.countryCode === "string" && merged.countryCode.trim();
    if (hasCity && hasCountryCode) {
        return merged;
    }
    const geo = await resolveGeoForRequest(req);
    if (!hasCity && geo.city) {
        merged.city = geo.city;
    }
    if (!hasCountryCode && geo.countryCode) {
        merged.country_code = geo.countryCode;
    }
    if (geo.country && !(typeof merged.country === "string" && merged.country.trim())) {
        merged.country = geo.country;
    }
    return merged;
}

app.get("/api/nearest-branches", async (req, res) => {
    const latRaw = typeof req.query.lat === "string" ? req.query.lat.trim() : "";
    const lngRaw = typeof req.query.lng === "string" ? req.query.lng.trim() : "";
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ ok: false, error: "Missing or invalid lat/lng query params." });
    }
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit.trim()) : 5;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 5;

    let branches;
    try {
        branches = await readBranchesWithFallback_();
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }

    const withDistance = [];
    for (const b of branches) {
        const bLat = Number(String(b.Latitude || "").trim());
        const bLng = Number(String(b.Longitude || "").trim());
        if (!Number.isFinite(bLat) || !Number.isFinite(bLng)) {
            continue;
        }
        const distanceKm = haversineKm_(lat, lng, bLat, bLng);
        withDistance.push({
            BranchId: String(b.BranchId || "").trim(),
            BranchName: String(b.BranchName || "").trim(),
            City: String(b.City || "").trim(),
            Area: String(b.Area || "").trim(),
            State: String(b.State || "").trim(),
            Address: String(b.Address || "").trim(),
            Latitude: String(b.Latitude || "").trim(),
            Longitude: String(b.Longitude || "").trim(),
            GoogleMap: String(b.GoogleMap || "").trim(),
            BranchTiming: String(b.BranchTiming || "").trim(),
            ContactNumber: String(b.ContactNumber || "").trim(),
            ContactEmail: String(b.ContactEmail || "").trim(),
            distanceKm: Math.round(distanceKm * 100) / 100
        });
    }
    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
    return res.status(200).json({
        ok: true,
        origin: { lat, lng },
        count: withDistance.length,
        branches: withDistance.slice(0, limit)
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
    const hints = {
        querySlotMinutes:
            typeof req.query.generalSlotMinutes === "string" ? req.query.generalSlotMinutes.trim() : ""
    };
    const doctorId = generalAppointmentBookingId_();
    const slots = slotsForGeneralAppointment_(dateISO, hints);
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
    const gm = resolvedGeneralAppointmentSlotMinutes_(hints, appointmentSlotMinutes_);
    return res.status(200).json({
        ok: true,
        doctorId,
        dateISO,
        slotMinutes: gm,
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
    const hints = {
        querySlotMinutes:
            typeof req.query.generalSlotMinutes === "string" ? req.query.generalSlotMinutes.trim() : ""
    };
    const doctorId = generalAppointmentBookingId_();
    const daysInMonth = new Date(y, mo, 0).getDate();
    const iv = resolvedGeneralAppointmentSlotMinutes_(hints, appointmentSlotMinutes_);
    /** @type {Record<string, { working: boolean, totalSlots: number, bookedCount: number, availableCount: number }>} */
    const days = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateISO = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const slots = slotsForGeneralAppointment_(dateISO, hints);
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
        console.error("[chatbot-api] catalog-sync", msg);
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
    const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
    const contactName =
        typeof body.contactName === "string" ? body.contactName.trim() : "";
    const contactMobile =
        typeof body.contactMobile === "string" ? body.contactMobile.trim() : "";
    const doctorDisplay =
        typeof body.doctorDisplay === "string"
            ? body.doctorDisplay.trim()
            : (doctorId ? `Doctor (${doctorId})` : "");
    const cityOrPlaceBook =
        typeof body.cityOrPlace === "string" ? body.cityOrPlace.trim() : "";
    try {
        const out = await bookAppointment({
            doctorId,
            branchId,
            department,
            dateISO,
            slotLabel,
            userId,
            patientName: contactName,
            patientMobile: contactMobile,
            patientEmail: contactEmail,
            sessionId: userId,
            source: "rest-book-appointment"
        });
        void persistAppointmentLeadToRtdbBestEffort_({
            sessionId: userId,
            patientName: contactName,
            patientMobile: contactMobile,
            patientEmail: contactEmail,
            doctorId,
            branchId,
            department,
            appointmentDate: dateISO,
            appointmentTime: slotLabel,
            appointmentBooked: "Yes",
            doctorDisplay,
            cityOrPlace: cityOrPlaceBook || branchId,
            source: "rest-book-appointment"
        });
        if (contactEmail) {
            void (async () => {
                try {
                    const rr = await maybeSendAppointmentClientAckEmail({
                        toEmail: contactEmail,
                        recipientName: contactName,
                        doctorDisplay: doctorDisplay || "Your appointment",
                        specialization: department,
                        branchId,
                        dateISO,
                        slotLabel,
                        cityOrPlace: cityOrPlaceBook || branchId,
                        source: "rest-book-appointment",
                        mobile: contactMobile
                    });
                    if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1" && !(rr && rr.sent)) {
                        console.log(
                            "[api/book-appointment] client_ack:",
                            "skipped" in rr ? rr.reason : rr.error || "?"
                        );
                    }
                } catch (be) {
                    console.error("[api/book-appointment] client_ack defer", be && be.message ? be.message : be);
                }
            })();
        }
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
    if (typeof dateObj === "string") {
        return appointmentDateInputToIso_(dateObj);
    }
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

/**
 * Branch → carousel card. Distance is shown when supplied (nearby flow).
 * `ctaValue` is the BranchId so DFCX/widget can set `branch_id` on click.
 */
function branchToCarouselCard_(b, { distanceKm } = {}) {
    const branchId = normalizeStr_(b.BranchId);
    const title = normalizeStr_(b.BranchName || b.Area || b.City || "Branch");
    const area = normalizeStr_(b.Area);
    const city = normalizeStr_(b.City);
    const state = normalizeStr_(b.State);
    const timing = normalizeStr_(b.BranchTiming);
    const contact = normalizeStr_(b.ContactNumber);
    const imageUrl = normalizeStr_(b.ImageUrl);
    const distLabel = Number.isFinite(distanceKm)
        ? `${Math.round(distanceKm * 10) / 10} km away`
        : "";
    const location = [area, city, state].filter(Boolean).join(", ");
    const subtitleParts = [
        distLabel,
        location,
        timing ? `Timing: ${timing}` : "",
        contact ? `Contact: ${contact}` : ""
    ].filter(Boolean);

    return {
        ctaLabel: "View",
        subtitle: subtitleParts.join(" • "),
        id: branchId ? `branch_${branchId}` : `branch_${Math.random().toString(16).slice(2)}`,
        title,
        ctaValue: branchId || title,
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

    const liveAgentHandoffTags = new Set([
        "request_live_agent",
        "live_agent",
        "human_agent",
        "request_human_agent",
        "handoff_live_agent",
        "speak_to_agent",
        "request_human"
    ]);

    try {
        if (liveAgentHandoffTags.has(tag)) {
            const { cxWebhookParamStr_ } = await import("./lib/live-agent/from-context.mjs");
            const convId =
                cxWebhookParamStr_(params, "client_session_id")
                || cxWebhookParamStr_(params, "clientSessionId")
                || sessionId;
            const waitMsg =
                normalizeStr_(params.message) || "Connecting you with an agent. Please wait…";
            if (convId) {
                try {
                    const { requestHumanAgent_, liveAgentFirestoreReady_ } = await import(
                        "./lib/live-agent/store.mjs"
                    );
                    if (liveAgentFirestoreReady_()) {
                        await requestHumanAgent_({
                            conversationId: convId,
                            visitorName: normalizeStr_(params.name) || "Visitor",
                            initialMessage:
                                normalizeStr_(
                                    params.initial_message
                                        || params.initialMessage
                                        || params.query
                                        || params.last_user_utterance
                                ) || "",
                            departmentId:
                                normalizeStr_(params.department_id || params.departmentId) || ""
                        });
                        console.log("[webhook] live agent queued", convId, "tag=", tag);
                    } else {
                        console.warn("[webhook] live agent storage not configured (Firestore env)");
                    }
                } catch (handoffErr) {
                    console.warn("[webhook] live agent handoff failed:", handoffErr.message || handoffErr);
                }
            }
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxText_(waitMsg, lang),
                        cxPayload_({
                            action: "request_live_agent",
                            message: waitMsg
                        })
                    ]
                }
            });
        }

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

        if (tag === "get_areas") {
            const state = normalizeStr_(params.state);
            const city = normalizeStr_(params.city);
            if (!city) {
                return fallback("Please select a city first.");
            }
            const branches = await listBranches();
            const filtered = branches.filter((b) => {
                if (state && normalizeLower_(b.State) !== normalizeLower_(state)) return false;
                return normalizeLower_(b.City) === normalizeLower_(city);
            });
            const areas = Array.from(
                new Set(filtered.map((b) => normalizeStr_(b.Area)).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b));
            if (!areas.length) {
                return fallback(`No areas found for ${city}.`);
            }
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxPayload_({
                            action: "dfchat_inline_select",
                            message: `Please select an area in ${city}:`,
                            placeholder: "Choose an area…",
                            options: areas.map((a) => ({ label: String(a), value: String(a) }))
                        })
                    ]
                }
            });
        }

        if (tag === "get_branches_by_area") {
            const state = normalizeStr_(params.state);
            const city = normalizeStr_(params.city);
            const area = normalizeStr_(params.area);
            if (!city || !area) {
                return fallback("Please select a city and area first.");
            }
            const branches = await listBranches();
            const matches = branches.filter((b) => {
                if (state && normalizeLower_(b.State) !== normalizeLower_(state)) return false;
                if (normalizeLower_(b.City) !== normalizeLower_(city)) return false;
                return normalizeLower_(b.Area) === normalizeLower_(area);
            });
            if (!matches.length) {
                return fallback(`No branches found in ${area}, ${city}.`);
            }
            const cards = matches.slice(0, 12).map((b) => branchToCarouselCard_(b));
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxPayload_({
                            cards,
                            message: `Branches in ${area}, ${city}:`,
                            action: "open_card_carousel"
                        })
                    ]
                }
            });
        }

        if (tag === "get_nearby_branches") {
            const latRaw = normalizeStr_(params.user_lat ?? params.userLat ?? params.lat);
            const lngRaw = normalizeStr_(params.user_lng ?? params.userLng ?? params.lng);
            if (!latRaw || !lngRaw) {
                return fallback(
                    "I couldn't read your location. Please allow location access in your browser, or try 'Search by city' instead."
                );
            }
            const lat = Number(latRaw);
            const lng = Number(lngRaw);
            if (
                !Number.isFinite(lat) || !Number.isFinite(lng)
                || lat < -90 || lat > 90 || lng < -180 || lng > 180
            ) {
                return fallback(
                    `Invalid location received (lat=${latRaw}, lng=${lngRaw}). Please retry, or use 'Search by city'.`
                );
            }
            const branches = await readBranchesWithFallback_();
            const ranked = [];
            const debugSample = [];
            for (const b of branches) {
                const bLatRaw = String(b.Latitude || b.latitude || b.lat || b.LAT || "").trim();
                const bLngRaw = String(b.Longitude || b.longitude || b.lng || b.LNG || b.lon || "").trim();
                if (debugSample.length < 3) {
                    debugSample.push({
                        keys: Object.keys(b).join(","),
                        Latitude: b.Latitude,
                        Longitude: b.Longitude,
                        latitude: b.latitude,
                        longitude: b.longitude
                    });
                }
                if (!bLatRaw || !bLngRaw) continue;
                const bLat = Number(bLatRaw);
                const bLng = Number(bLngRaw);
                if (
                    !Number.isFinite(bLat) || !Number.isFinite(bLng)
                    || bLat < -90 || bLat > 90 || bLng < -180 || bLng > 180
                ) {
                    continue;
                }
                ranked.push({ b, distanceKm: haversineKm_(lat, lng, bLat, bLng) });
            }
            ranked.sort((x, y) => x.distanceKm - y.distanceKm);
            const top3 = ranked.slice(0, 3);
            if (!top3.length) {
                console.warn(
                    "[get_nearby_branches] no usable branches",
                    "loaded:", branches.length,
                    "withCoords:", ranked.length,
                    "sample:", JSON.stringify(debugSample)
                );
                if (branches.length === 0) {
                    return fallback("No branches loaded (catalog is empty). Run /api/sync-catalog-from-repo or check Firebase RTDB.");
                }
                return fallback(
                    `Loaded ${branches.length} branches but none have valid Latitude/Longitude fields. Check catalog field names.`
                );
            }
            const cards = top3.map(({ b, distanceKm }) =>
                branchToCarouselCard_(b, { distanceKm })
            );
            return res.json({
                fulfillment_response: {
                    messages: [
                        cxPayload_({
                            cards,
                            message: "Top 3 branches near you:",
                            action: "open_card_carousel"
                        })
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

            const chatGuestEmailCx = normalizeStr_(
                params.email
                    || params.user_email
                    || params.guest_email
                    || params.person_email
            );
            const chatGuestNameCx = normalizeStr_(
                params.person_name || params.name || params.customer_name || params.personname
            );
            const chatGuestMobileCx = normalizeStr_(
                params.mobile || params.phone_number || params.phone || params.phonenumber
            );
            try {
                await bookAppointment({
                    doctorId: normalizeStr_(doc.DoctorId),
                    branchId: normalizeStr_(doc.BranchId || resolvedBranch || "500"),
                    department: normalizeStr_(doc.Specialization),
                    dateISO,
                    slotLabel: timeLabel,
                    userId: "",
                    patientName: chatGuestNameCx,
                    patientMobile: chatGuestMobileCx,
                    patientEmail: chatGuestEmailCx,
                    sessionId,
                    source: "cx_webhook"
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
            const doctorDisplayCx =
                normalizeStr_(doc.DisplayDoctorName || `Dr. ${doctorName}`);
            void persistAppointmentLeadToRtdbBestEffort_({
                sessionId,
                patientName: chatGuestNameCx,
                patientMobile: chatGuestMobileCx,
                patientEmail: chatGuestEmailCx,
                doctorId: normalizeStr_(doc.DoctorId),
                branchId: normalizeStr_(doc.BranchId || resolvedBranch || ""),
                department: normalizeStr_(doc.Specialization),
                appointmentDate: dateISO,
                appointmentTime: timeLabel,
                appointmentBooked: "Yes",
                doctorDisplay: doctorDisplayCx,
                cityOrPlace: placeLabel,
                source: "cx_webhook"
            });
            void (async () => {
                try {
                    const staffR = await maybeSendAppointmentChatbotStaffNotifyEmail({
                        doctorDisplay: doctorDisplayCx,
                        doctorName,
                        specialization: normalizeStr_(doc.Specialization),
                        branchId: normalizeStr_(doc.BranchId || resolvedBranch || ""),
                        dateISO,
                        slotLabel: timeLabel,
                        cityOrPlace: placeLabel
                    });
                    if ((process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1" && !(staffR && staffR.sent)) {
                        console.log(
                            "[cx book_doctor_appointment] staff_notify:",
                            "skipped" in staffR ? staffR.reason : staffR.error || "?"
                        );
                    }
                    if (chatGuestEmailCx) {
                        const cr = await maybeSendAppointmentClientAckEmail({
                            toEmail: chatGuestEmailCx,
                            recipientName: chatGuestNameCx,
                            doctorDisplay: doctorDisplayCx,
                            specialization: normalizeStr_(doc.Specialization),
                            branchId: normalizeStr_(doc.BranchId || resolvedBranch || ""),
                            dateISO,
                            slotLabel: timeLabel,
                            cityOrPlace: placeLabel,
                            source: "dialogflow-cx-chatbot",
                            mobile: chatGuestMobileCx
                        });
                        if (
                            (process.env.CONTACT_LEAD_EMAIL_DEBUG || "").trim() === "1"
                            && !(cr && cr.sent)
                        ) {
                            console.log(
                                "[cx book_doctor_appointment] client_ack:",
                                "skipped" in cr ? cr.reason : cr.error || "?"
                            );
                        }
                    }
                } catch (mailErr) {
                    console.error("[cx book_doctor_appointment] mail deferred error", mailErr);
                }
            })();

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
 * @param {Record<string, string>} fields
 * @param {string} formId
 * @param {string} [sessionId]
 */
function appointmentLeadExtrasFromContactFields_(fields, formId, sessionId) {
    return {
        patientName: normalizeStr_(fields.name),
        patientMobile: normalizeStr_(fields.mobile),
        patientEmail: normalizeStr_(fields.email),
        sessionId: normalizeStr_(sessionId),
        formId: normalizeStr_(formId),
        source: "contact_form"
    };
}

/**
 * @param {Record<string, unknown>} payload
 */
async function persistAppointmentLeadToRtdbBestEffort_(payload) {
    if (firebaseInitError) {
        return;
    }
    try {
        await persistAppointmentLeadRecord(payload);
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("[chatbot-api] appointment RTDB lead write failed:", msg);
    }
}

/**
 * Reserve RTDB slot when submitting doctor/general appointment contact forms.
 * @param {string} formId
 * @param {Record<string, string>} fields
 * @param {{ sessionId?: string }} [opts]
 */
async function tryReserveAppointmentSlotFromContactForm_(formId, fields, opts) {
    const sessionId =
        opts && typeof opts.sessionId === "string" ? opts.sessionId.trim() : "";
    const leadExtras = appointmentLeadExtrasFromContactFields_(fields, formId, sessionId);
    let fid = normalizeStr_(formId);
    /** Legacy typo id from older CX payloads / configs. */
    if (fid === "appintmentformdocot") {
        fid = "appintmentformdoctor";
    }
    if (fid !== "appintmentformdoctor" && fid !== "appintmentformgeneral") {
        return { skip: true };
    }
    const dateISO = appointmentDateInputToIso_(fields.appointmentdate);
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
        const gsmHint =
            scalarFormValue(fields.generalAppointmentSlotMinutes) ||
            scalarFormValue(fields.generalappointmentslotminutes);
        const hints = gsmHint ? { formSlotMinutes: gsmHint } : {};
        const slots = slotsForGeneralAppointment_(dateISO, hints);
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
            const ga = mergedGeneralAppointmentSchedule_();
            await bookAppointment({
                doctorId: generalAppointmentBookingId_(),
                branchId: normalizeStr_(ga.branchId),
                department: normalizeStr_(ga.department),
                dateISO,
                slotLabel,
                userId: "",
                ...leadExtras
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
            userId: "",
            ...leadExtras
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
    return { ok: true, block: true, doctorId, dateISO, slotLabel };
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
        let mergedClientContext = hydrateClientContextContactFromSession_(
            clientContextForStorageWithoutChatScriptUnlessEngaged_({
                ...clientContext,
                channel
            })
        );

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

        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";

        if (isQaRequest_(req, clientSessionId)) {
            return res.json({
                ok: true,
                qaMode: true,
                sessionId: clientSessionId,
                skipped: true
            });
        }

        /** True when this request successfully booked an appointment slot (server-side). */
        let appointmentBookedServer = false;
        try {
            const rsv = await tryReserveAppointmentSlotFromContactForm_(formId, fields, {
                sessionId: clientSessionId
            });
            if (rsv && rsv.skip) {
                /* not an appointment booking form */
            } else if (rsv && rsv.ok === false) {
                return res.status(typeof rsv.status === "number" ? rsv.status : 400).json({
                    ok: false,
                    error: typeof rsv.error === "string" && rsv.error.trim() ? rsv.error.trim() : "Booking failed."
                });
            } else if (rsv && rsv.ok === true) {
                appointmentBookedServer = true;
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
        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";

        /** DRIVE_ONLY turns Firestore off; file uploads remain optional unless the user attaches files. */
        if (DRIVE_ONLY) {
            const hasBytes = uploadedFiles.some(
                (f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0
            );
            if (!hasBytes && uploadedFiles.length > 0) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "DRIVE_ONLY=1: file field(s) were sent but contain no file data. Add a valid attachment or remove empty file inputs."
                });
            }
            if (!hasBytes && uploadedFiles.length === 0 && SHEETS_DISABLED) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "DRIVE_ONLY=1: Firestore is off in this mode. For text-only contact leads enable Google Sheets (set SHEETS_SPREADSHEET_ID and share the spreadsheet with the service account), attach a file, or remove DRIVE_ONLY."
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
                console.error("[chatbot-api] Upload forward failed", detail, ue);
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

        const convAt = new Date();
        const submittedAtIso = convAt.toISOString();
        const convSheetDate = formatConversationDateForSheet(convAt);
        const convSheetTime = formatConversationTimeForSheet(convAt);
        const ip = extractRequestIp(req);
        const mergedWithCity = await mergeVisitorCityIntoClientContext_(mergedClientContext, req);
        mergedClientContext = mergeCampaignParamsIntoClientContextRecord_(mergedWithCity);
        const cityFromFields = typeof fields.city === "string" ? fields.city.trim() : "";
        const cityFromContext = pickCityFromClientContextMerged_(mergedClientContext);
        const city = cityFromFields || cityFromContext || (await resolveCityForRequest(req));
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);
        const sourceUrl = resolveSourceUrlForSheet(mergedClientContext);
        const appointmentDateRaw =
            scalarFormValue(fields.appointmentdate)
            || scalarFormValue(fields.appointmentDate)
            || scalarFormValue(fields.appointment_date)
            || "";
        const appointmentDate = appointmentDateInputToIso_(appointmentDateRaw);
        const appointmentTimeRaw =
            scalarFormValue(fields.appointmenttime)
            || scalarFormValue(fields.appointmentTime)
            || scalarFormValue(fields.appointment_time)
            || "";
        const timeMinutes = parseClockToMinutes_(appointmentTimeRaw);
        const appointmentTime = Number.isFinite(timeMinutes)
            ? formatMinutesAsSlotLabel_(timeMinutes)
            : appointmentTimeRaw;
        const rawAppointmentBooked =
            scalarFormValue(fields.appointmentbooked)
            || scalarFormValue(fields.appointment_booked)
            || scalarFormValue(fields.appointmentBooked);
        let appointmentBooked =
            (appointmentBookedServer || (appointmentDate && appointmentTime)) ? "Yes" : "No";
        if (/^yes$/i.test(rawAppointmentBooked || "")) {
            appointmentBooked = "Yes";
        } else if (/^no$/i.test(rawAppointmentBooked || "")) {
            appointmentBooked = "No";
        }

        const normalizedApptFormId = normalizeStr_(formId);
        const isAppointmentContactForm =
            normalizedApptFormId === "appintmentformdoctor" ||
            normalizedApptFormId === "appintmentformgeneral" ||
            normalizedApptFormId === "appintmentformdocot";
        if (isAppointmentContactForm && appointmentDate && appointmentTime) {
            /** @type {Record<string, string>} */
            const lcAppt = {};
            for (const [fk, fv] of Object.entries(fields)) {
                if (typeof fv === "string" && fv.trim()) {
                    lcAppt[String(fk).toLowerCase()] = fv.trim();
                }
            }
            const dnAppt =
                lcAppt.doctornamedisplay ||
                lcAppt.doctordisplay ||
                lcAppt.doctorname ||
                lcAppt.doctor_name ||
                lcAppt.doctor ||
                "";
            const doctorDisplayFromFields = dnAppt
                ? /\bdr\.?\s/i.test(dnAppt)
                    ? dnAppt
                    : `Dr. ${dnAppt}`
                : lcAppt.displaydoctorname || "";
            void persistAppointmentLeadToRtdbBestEffort_({
                sessionId: clientSessionId,
                formId:
                    normalizedApptFormId === "appintmentformdocot"
                        ? "appintmentformdoctor"
                        : formId,
                patientName: name,
                patientMobile: mobile,
                patientEmail: email,
                appointmentDate,
                appointmentTime,
                appointmentBooked,
                doctorId: normalizeStr_(fields.doctorId),
                branchId: normalizeStr_(fields.branchId),
                department:
                    normalizeStr_(fields.department) || normalizeStr_(fields.specialization),
                doctorDisplay: doctorDisplayFromFields,
                cityOrPlace: city,
                staffStatus: "requested",
                source: "contact-form"
            });
        }

        /** Firestore-safe payload (flattened for querying) */
        const fileLinksForSheet = drive_uploads
            .map((u) => (typeof u.web_view_link === "string" ? u.web_view_link : ""))
            .filter(Boolean)
            .join(", ");

        mergeLeadFormAssistantIntoClientContextIfMissing_(
            mergedClientContext,
            buildContactLeadSummaryTextForTranscript_({
                name,
                email,
                mobile,
                form_id: formId,
                submitted_at: submittedAtIso,
                fields
            })
        );

        try {
            const crmOut = await syncLeadToCrm_({
                submitted_at: submittedAtIso,
                form_id: formId,
                name,
                email,
                mobile,
                channel,
                source_url: sourceUrl,
                city,
                client_session_id: clientSessionId,
                fields
            });
            if (!crmOut.skipped) {
                mergedClientContext = {
                    ...mergedClientContext,
                    crm_status: crmOut.status,
                    crm_ok: crmOut.ok,
                    crm_request: crmOut.request,
                    crm_response: crmOut.response || crmOut.error || ""
                };
            }
        } catch (crmErr) {
            const msg =
                crmErr && /** @type {{ message?: string }} */ (crmErr).message
                    ? String(crmErr.message)
                    : String(crmErr);
            console.warn("[chatbot-api] CRM sync:", msg.slice(0, 280));
            mergedClientContext = {
                ...mergedClientContext,
                crm_status: "Failed",
                crm_ok: false,
                crm_request: "",
                crm_response: msg.slice(0, 500)
            };
        }

        const record = {
            submitted_at: submittedAtIso,
            form_id: formId,
            name,
            email,
            mobile,
            fields,
            client_context: mergedClientContext,
            ...(clientSessionId ? { client_session_id: clientSessionId } : {}),
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
            /** True only if Google Sheets ran a successful append or batchUpdate (duplicate_noop=false positive). */
            let wroteToSheets = false;
            /** @type {{ action: string, patched: boolean, tab?: string } | null} */
            let sheetOutcome = null;
            const sheetsT0Ms = Date.now();
            const feedbackForSheet = feedbackFieldsFromLeadSources_({
                formId,
                fields: fields && typeof fields === "object" ? fields : {},
                clientContext: mergedClientContext
            });
            if (feedbackForSheet.feedbackRating || feedbackForSheet.feedbackMessage) {
                mergedClientContext = {
                    ...mergedClientContext,
                    ...(feedbackForSheet.feedbackRating
                        ? { feedback_rating: feedbackForSheet.feedbackRating }
                        : {}),
                    ...(feedbackForSheet.feedbackMessage
                        ? {
                              feedback_message: feedbackForSheet.feedbackMessage,
                              feedback_comment: feedbackForSheet.feedbackMessage
                          }
                        : {})
                };
            }
            const chatTranscriptJsonForSheet = sheetsWriteChatTranscriptJsonEnabled_()
                ? stringifyChatTranscriptForSheetPayload_(mergedClientContext)
                : "";
            mergedClientContext = await enrichClientContextForSheetMetricsAsync_(mergedClientContext, {
                sessionId: clientSessionId,
                incomingRow: chatTranscriptJsonForSheet
                    ? { chatTranscriptJson: chatTranscriptJsonForSheet }
                    : {}
            });
            const conversationMetrics = computeConversationMetricsFromClientContext_(mergedClientContext);
            mergedClientContext = mergeConversationMetricsIntoClientContext_(
                mergedClientContext,
                conversationMetrics
            );
            record.client_context = mergedClientContext;
            if (!SHEETS_DISABLED) {
                try {
                    sheetOutcome = await appendContactRowToSheet(
                        {
                            convDate: convSheetDate,
                            convTime: convSheetTime,
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
                            sourceUrl,
                            appointmentBooked,
                            appointmentDate,
                            appointmentTime,
                            userQueriesCsv,
                            feedbackRating: feedbackForSheet.feedbackRating,
                            feedbackMessage: feedbackForSheet.feedbackMessage,
                            ...(chatTranscriptJsonForSheet
                                ? { chatTranscriptJson: chatTranscriptJsonForSheet }
                                : {})
                        },
                        {
                            preferIncomingContact: true,
                            sheetExtrasSources: {
                                clientContext: mergedClientContext,
                                fields: fields && typeof fields === "object" ? fields : {}
                            }
                        }
                    );
                    wroteToSheets = !!(
                        sheetOutcome
                        && (
                            sheetOutcome.patched
                            || sheetOutcome.action === "appended"
                            || sheetOutcome.action === "duplicate_updated"
                        )
                    );
                } catch (se) {
                    const detail = se && se.message ? se.message : String(se);
                    throw new Error(`Sheets: ${detail}`);
                }
            }
            console.log(`[contact-form] sheets_wall_ms=${Date.now() - sheetsT0Ms}`);

            /** @type {Record<string, unknown> | null} */
            let deferFirestoreRecord = null;
            if (!FIRESTORE_DISABLED && DEFER_FIRESTORE_UNTIL_AFTER_HTTP_RESPONSE) {
                deferFirestoreRecord = record;
                console.log("[contact-form] Firestore runs after HTTP 200 (+ tail flush) — faster chat submit");
            } else if (!FIRESTORE_DISABLED) {
                const fsT0Ms = Date.now();
                try {
                    await persistToFirestore(record);
                    if (clientSessionId) {
                        await patchSessionTranscriptFirestore_(clientSessionId, mergedClientContext);
                    }
                    console.log(`[contact-form] firestore_wall_ms=${Date.now() - fsT0Ms}`);
                } catch (fe) {
                    const detail = fe && fe.message ? fe.message : String(fe);
                    console.error("[chatbot-api] Firestore persist failed (Sheets already attempted)", detail, fe);
                    if (!wroteToSheets) {
                        throw new Error(`Firestore: ${detail}`);
                    }
                }
            }
            /** @type {Record<string, unknown>} */
            const out = { ok: true, message: "Saved." };
            if (SHEETS_DISABLED) {
                out.sheet_integration = {
                    enabled: false,
                    reason:
                        process.env.DISABLE_SHEETS === "1"
                            ? "DISABLE_SHEETS=1 — server skips Google Sheets writes."
                            : "SHEETS_SPREADSHEET_ID is not set — server skips Google Sheets writes.",
                    hint:
                        process.env.DISABLE_SHEETS === "1"
                            ? "Remove DISABLE_SHEETS or set it to 0, then redeploy."
                            : "In Railway Variables set SHEETS_SPREADSHEET_ID (spreadsheet id from the Google Sheet URL); share that sheet with the service account client_email from FIREBASE_SERVICE_ACCOUNT_JSON as Editor."
                };
                out.sheet = null;
            } else if (sheetOutcome) {
                const writeBlock = {
                    action: sheetOutcome.action,
                    patched: sheetOutcome.patched,
                    tab: sheetOutcome.tab || "",
                    appendRangeUsed: typeof sheetOutcome.appendRangeUsed === "string"
                        ? sheetOutcome.appendRangeUsed
                        : "",
                    sheetRowNumber:
                        typeof sheetOutcome.sheetRowNumber === "number"
                            ? sheetOutcome.sheetRowNumber
                            : null,
                    googleAppend: sheetOutcome.googleAppend || null,
                    googleBatch: sheetOutcome.googleBatch || null,
                    sessionDedupeMode: !SHEETS_CONTACT_FORM_APPEND_FREELY
                        ? "strict_single_row_per_session"
                        : clientSessionId.trim()
                          ? "append_each_form_submit"
                          : "append_no_session_client_id",
                    hadName: typeof name === "string" ? name.trim().length > 0 : false,
                    hadMobile: typeof mobile === "string" ? mobile.trim().length > 0 : false,
                    hadEmail: typeof email === "string" ? email.trim().length > 0 : false,
                    hadSessionId: typeof clientSessionId === "string" ? clientSessionId.trim().length > 0 : false
                };
                out.sheet_integration = {
                    enabled: true,
                    write: writeBlock
                };
                out.sheet = writeBlock;
            }
            const leadEmailPayload = {
                source: "contact-form",
                formId,
                name,
                email,
                mobile,
                city,
                channel,
                sourceUrl,
                clientSessionId,
                appointmentDate,
                appointmentTime,
                appointmentBooked,
                appointmentBookedServer,
                submittedAtIso,
                fields,
                ip
            };
            const attachLeadEmail =
                (process.env.CONTACT_LEAD_ATTACH_OUTCOME_IN_JSON || "").trim() === "1";
            if (attachLeadEmail) {
                out.lead_email = {
                    status: "scheduled",
                    delay_ms: resolveContactLeadEmailDelayMs_(),
                    note: "Lead email is not sent during this request; it runs in the background after HTTP 200. Use Railway logs or POST /contact-form-email-self-test. Unset CONTACT_LEAD_ATTACH_OUTCOME_IN_JSON to hide this field."
                };
            }
            /** Deferred Firestore (optional) + lead email — after flush; email waits CONTACT_LEAD_EMAIL_DELAY_MS (default 1 min). */
            scheduleContactPostSuccessTail_(res, {
                deferFirestoreRecord,
                leadEmailPayload
            });
            return res.status(200).json(out);
        } catch (err) {
            const message = err && err.message ? err.message : "Save failed";
            console.error("[chatbot-api]", message, err);
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
        let mergedClientContext = hydrateClientContextContactFromSession_(
            clientContextForStorageWithoutChatScriptUnlessEngaged_({
                ...clientContext,
                channel
            })
        );

        if (!clientContextHasUserChatEngagement_(clientContext)) {
            return res.status(200).json({
                ok: true,
                message: "No user chat engagement; mobile sheet sync skipped.",
                skipped: true,
                reason: "no_user_engagement"
            });
        }

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

        const formId = normalizeSheetFormId(body._contactFormId);
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

        const convAt = new Date();
        const convSheetDate = formatConversationDateForSheet(convAt);
        const convSheetTime = formatConversationTimeForSheet(convAt);
        const ip = extractRequestIp(req);
        const mergedWithCity = await mergeVisitorCityIntoClientContext_(mergedClientContext, req);
        mergedClientContext = mergeCampaignParamsIntoClientContextRecord_(mergedWithCity);
        const city = pickCityFromClientContextMerged_(mergedClientContext)
            || (await resolveCityForRequest(req));
        const userQueriesCsv = normalizeUserQueriesCsvFromClientContext(mergedClientContext);
        const sourceUrl = resolveSourceUrlForSheet(mergedClientContext);
        const chatTranscriptJsonMobile = sheetsWriteChatTranscriptJsonEnabled_()
            ? stringifyChatTranscriptForSheetPayload_(mergedClientContext)
            : "";
        mergedClientContext = await enrichClientContextForSheetMetricsAsync_(mergedClientContext, {
            sessionId: clientSessionId,
            incomingRow: chatTranscriptJsonMobile
                ? { chatTranscriptJson: chatTranscriptJsonMobile }
                : {}
        });
        const conversationMetricsMobile = computeConversationMetricsFromClientContext_(mergedClientContext);
        mergedClientContext = mergeConversationMetricsIntoClientContext_(
            mergedClientContext,
            conversationMetricsMobile
        );
        try {
            const sheetOutcome = await appendContactRowToSheet(
                {
                    convDate: convSheetDate,
                    convTime: convSheetTime,
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
                    sourceUrl,
                    appointmentBooked: "No",
                    appointmentDate: "",
                    appointmentTime: "",
                    userQueriesCsv,
                    ...(chatTranscriptJsonMobile
                        ? { chatTranscriptJson: chatTranscriptJsonMobile }
                        : {})
                },
                {
                    preferIncomingContact: true,
                    sheetExtrasSources: {
                        clientContext: mergedClientContext,
                        fields: {}
                    }
                }
            );
            if ((process.env.CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC || "").trim() === "1") {
                const nm = typeof name === "string" ? name.trim() : "";
                const em = typeof email === "string" ? email.trim() : "";
                if (nm || em) {
                    scheduleContactPostSuccessTail_(res, {
                        deferFirestoreRecord: null,
                        leadEmailPayload: {
                            source: "mobile-sheet-sync",
                            formId,
                            name,
                            email,
                            mobile,
                            city,
                            channel,
                            sourceUrl,
                            clientSessionId,
                            appointmentDate: "",
                            appointmentTime: "",
                            appointmentBooked: "No",
                            submittedAtIso: new Date().toISOString(),
                            fields,
                            ip
                        }
                    });
                }
            }
            return res.status(200).json({
                ok: true,
                message: "Sheet updated.",
                sheet_integration: {
                    enabled: true,
                    write: {
                        action: sheetOutcome.action,
                        patched: sheetOutcome.patched,
                        tab: sheetOutcome.tab || "",
                        appendRangeUsed: typeof sheetOutcome.appendRangeUsed === "string"
                            ? sheetOutcome.appendRangeUsed
                            : "",
                        sheetRowNumber:
                            typeof sheetOutcome.sheetRowNumber === "number"
                                ? sheetOutcome.sheetRowNumber
                                : null,
                        googleAppend: sheetOutcome.googleAppend || null,
                        googleBatch: sheetOutcome.googleBatch || null,
                        sessionDedupeMode: "strict_single_row_per_session",
                        hadName: typeof name === "string" ? name.trim().length > 0 : false,
                        hadMobile: true,
                        hadEmail: typeof email === "string" ? email.trim().length > 0 : false,
                        hadSessionId: typeof clientSessionId === "string"
                            ? clientSessionId.trim().length > 0
                            : false
                    }
                }
            });
        } catch (se) {
            const detail = se && se.message ? se.message : String(se);
            console.error("[chatbot-api] mobile-sheet-sync", detail, se);
            return res.status(500).json({ ok: false, error: detail });
        }
    }
);

/** Live-sync accumulated user_queries (sheet “User Queries” column — default column H in A–S layout). */
app.post(
    PATHNAME_SESSION_SHEET_SYNC,
    express.json({ limit: "512kb" }),
    async (req, res) => {
        const sheetSyncAuth = contactFormSessionSyncSecretFromReq_(req);
        if (!sheetSyncAuth.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized (set X-Contact-Form-Mobile-Sync-Secret matching CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET)."
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
        let mergedClientContext = hydrateClientContextContactFromSession_(
            clientContextForStorageWithoutChatScriptUnlessEngaged_({
                ...clientContext,
                channel
            })
        );

        const clientSessionId = typeof clientContext.client_session_id === "string"
            ? clientContext.client_session_id.trim()
            : "";
        if (!clientSessionId) {
            return res.status(400).json({ ok: false, error: "Missing client_session_id in client_context." });
        }

        try {
            const { noteChatSessionStarted_ } = await import("./lib/sheet-sync-gate.mjs");
            noteChatSessionStarted_(clientSessionId);
        } catch {
            /* ignore */
        }

        let liveAgentQueue = { queued: false, reason: "not_checked" };
        try {
            const { maybeQueueLiveAgentFromClientContext_ } = await import(
                "./lib/live-agent/from-context.mjs"
            );
            liveAgentQueue = await maybeQueueLiveAgentFromClientContext_(clientContext);
        } catch (laErr) {
            liveAgentQueue = { queued: false, reason: laErr.message || String(laErr) };
        }

        if (!clientContextHasUserChatEngagement_(clientContext)) {
            return res.status(200).json({
                ok: true,
                message: "No user chat engagement; sync skipped.",
                skipped: true,
                reason: "no_user_engagement",
                live_agent: liveAgentQueue
            });
        }

        const coercedTranscript = coerceChatTranscriptArray_(mergedClientContext.chat_transcript);
        mergedClientContext.chat_transcript = coercedTranscript;
        const assistantQueries = Array.isArray(mergedClientContext.assistant_queries)
            ? mergedClientContext.assistant_queries
            : [];
        const hasLiveChatTranscript =
            coercedTranscript.length > 0 || assistantQueries.length > 0;

        const browserName = typeof clientContext.browser_name === "string"
            ? clientContext.browser_name.trim()
            : "";
        const deviceType = typeof clientContext.device_type === "string"
            ? clientContext.device_type.trim()
            : "";
        const osName = typeof clientContext.os_name === "string"
            ? clientContext.os_name.trim()
            : "";
        const formId = normalizeSheetFormId(body._contactFormId);

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
        const hasResolvedContact = !!(name || email || mobile);

        const convAt = new Date();
        const convSheetDate = formatConversationDateForSheet(convAt);
        const convSheetTime = formatConversationTimeForSheet(convAt);
        const ip = extractRequestIp(req);
        const mergedWithCity = await mergeVisitorCityIntoClientContext_(mergedClientContext, req);
        mergedClientContext = mergeCampaignParamsIntoClientContextRecord_(mergedWithCity);
        const city = pickCityFromClientContextMerged_(mergedClientContext)
            || (await resolveCityForRequest(req));
        const sourceUrl = resolveSourceUrlForSheet(mergedClientContext);
        mergedClientContext = await enrichClientContextForSheetMetricsAsync_(mergedClientContext, {
            sessionId: clientSessionId,
            incomingRow: {}
        });
        const conversationMetricsSync = computeConversationMetricsFromClientContext_(mergedClientContext);
        mergedClientContext = mergeConversationMetricsIntoClientContext_(
            mergedClientContext,
            conversationMetricsSync
        );

        let sessionTranscriptStored = false;
        let leadTranscriptPatched = false;
        if (!FIRESTORE_DISABLED && (hasLiveChatTranscript || clientContextHasUserChatEngagement_(mergedClientContext))) {
            try {
                const fsPatch = await patchSessionTranscriptFirestore_(
                    clientSessionId,
                    mergedClientContext
                );
                sessionTranscriptStored = fsPatch.sessionStored;
                leadTranscriptPatched = fsPatch.leadPatched;
            } catch (fe) {
                const detail = fe && fe.message ? fe.message : String(fe);
                console.warn("[chatbot-api] session-sheet-sync Firestore transcript patch:", detail.slice(0, 240));
            }
        }

        const { buildAuthoritativeSheet1UserQueriesCsv_ } = await import(
            "./lib/authoritative-user-queries.mjs"
        );
        const userQueriesCsv = await buildAuthoritativeSheet1UserQueriesCsv_(clientSessionId, {
            clientContext: mergedClientContext,
            loadFirestoreContext: true
        });
        const chatTranscriptJson = sheetsWriteChatTranscriptJsonEnabled_()
            ? stringifyChatTranscriptForSheetPayload_(mergedClientContext)
            : "";
        if (!userQueriesCsv && !hasLiveChatTranscript) {
            return res.status(200).json({ ok: true, message: "Nothing to sync." });
        }

        /** @type {Record<string, unknown>} */
        let syncDetail = { mode: "skipped_empty_queries" };
        if (SHEETS_DISABLED) {
            return res.status(200).json({
                ok: true,
                message: hasLiveChatTranscript ? "Transcript synced (Firestore)." : "Nothing to sync.",
                sheet_integration: {
                    enabled: false,
                    reason:
                        process.env.DISABLE_SHEETS === "1"
                            ? "DISABLE_SHEETS=1"
                            : "SHEETS_SPREADSHEET_ID is not set"
                },
                firestore_transcript_patched: sessionTranscriptStored,
                lead_transcript_patched: leadTranscriptPatched,
                firestore_disabled: FIRESTORE_DISABLED
            });
        }
        if (userQueriesCsv || hasLiveChatTranscript) {
            try {
                const rowPayload = {
                    convDate: convSheetDate,
                    convTime: convSheetTime,
                    formId,
                    name,
                    mobile,
                    email,
                    clientSessionId,
                    browserName,
                    deviceType,
                    osName,
                    channel,
                    fileLinks: "",
                    ip,
                    city,
                    sourceUrl,
                    appointmentBooked: "No",
                    appointmentDate: "",
                    appointmentTime: "",
                    userQueriesCsv,
                    chatTranscriptJson,
                    writeChatTranscriptOnSessionSync: false,
                    lightweightSessionSync: false,
                    clientAuthoritativeQueries: true,
                    sheetExtrasSources: {
                        clientContext: mergedClientContext,
                        fields
                    }
                };
                syncDetail = await runCoalescedSessionSheetSync_(clientSessionId, () =>
                    upsertSessionQueriesInSheet(rowPayload)
                );
                const uqArr = Array.isArray(mergedClientContext.user_queries)
                    ? mergedClientContext.user_queries
                    : [];
                const hasLiveAgentPhase = uqArr.some(
                    (line) =>
                        typeof line === "string"
                        && (/^connected with agent$/i.test(line.trim())
                            || line.trim() === "__live_agent_ended__")
                );
                if (hasLiveAgentPhase) {
                    try {
                        const { scheduleLiveAgentHandoffSheetSync_ } = await import(
                            "./lib/live-agent/live-agent-sheet-sync.mjs"
                        );
                        scheduleLiveAgentHandoffSheetSync_(clientSessionId);
                    } catch {
                        /* non-fatal */
                    }
                }
            } catch (se) {
                const detail = se && se.message ? se.message : String(se);
                console.error("[chatbot-api] session-sheet-sync", detail, se);
                if (/quota exceeded|rate limit|resource_exhausted/i.test(detail)) {
                    return res.status(200).json({
                        ok: true,
                        message: "Chat saved; Google Sheets will catch up on the next sync.",
                        skipped: true,
                        reason: "sheets_quota",
                        live_agent: liveAgentQueue
                    });
                }
                return res.status(500).json({ ok: false, error: detail });
            }
        }

        return res.status(200).json({
            ok: true,
            message: userQueriesCsv ? "Queries synced." : "Transcript synced.",
            sheet_integration: userQueriesCsv || hasLiveChatTranscript
                ? { enabled: true, result: syncDetail }
                : { enabled: true, skipped: "queries_only_in_firestore" },
            firestore_transcript_patched: sessionTranscriptStored,
            lead_transcript_patched: leadTranscriptPatched,
            firestore_disabled: FIRESTORE_DISABLED,
            chat_transcript_turns: coercedTranscript.length,
            chat_transcript_json_written: Boolean(
                chatTranscriptJson && sheetsWriteChatTranscriptJsonEnabled_()
            ),
            live_agent: liveAgentQueue
        });
    }
);

/** Firestore-only live transcript sync from widget (bot + user lines in `chat_transcript`). */
app.post(
    PATHNAME_SESSION_TRANSCRIPT_SYNC,
    express.json({ limit: "512kb" }),
    async (req, res) => {
        const auth = contactFormSessionSyncSecretFromReq_(req);
        if (!auth.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized (set X-Contact-Form-Mobile-Sync-Secret matching CONTACT_FORM_MOBILE_SHEET_SYNC_SECRET)."
            });
        }

        let body = req.body && typeof req.body === "object" ? req.body : {};
        if (typeof body.client_context === "string") {
            try {
                body = { ...body, client_context: JSON.parse(body.client_context) };
            } catch {
                body = { ...body, client_context: {} };
            }
        }
        const clientContext =
            body.client_context && typeof body.client_context === "object" ? body.client_context : {};
        const sid =
            typeof clientContext.client_session_id === "string" ? clientContext.client_session_id.trim() : "";
        if (!sid) {
            return res.status(400).json({ ok: false, error: "Missing client_session_id in client_context." });
        }

        let liveAgentQueue = { queued: false, reason: "not_checked" };
        try {
            const { maybeQueueLiveAgentFromClientContext_ } = await import(
                "./lib/live-agent/from-context.mjs"
            );
            liveAgentQueue = await maybeQueueLiveAgentFromClientContext_(clientContext);
        } catch (laErr) {
            liveAgentQueue = { queued: false, reason: laErr.message || String(laErr) };
        }

        if (!clientContextHasUserChatEngagement_(clientContext)) {
            return res.status(200).json({
                ok: true,
                message: "No user chat engagement; transcript not stored.",
                stored_turns: 0,
                skipped: true,
                reason: "no_user_engagement",
                live_agent: liveAgentQueue
            });
        }

        if (FIRESTORE_DISABLED) {
            return res.status(503).json({ ok: false, error: "Firestore is disabled on this server." });
        }

        const ct = coerceChatTranscriptArray_(clientContext.chat_transcript);
        const aq = Array.isArray(clientContext.assistant_queries) ? clientContext.assistant_queries : [];
        if (!ct.length && !aq.length) {
            return res.status(200).json({ ok: true, message: "Nothing to store.", stored_turns: 0 });
        }

        const patch = /** @type {Record<string, unknown>} */ ({
            ...clientContext,
            channel: normalizeLeadChannel(clientContext.channel),
            chat_transcript: ct
        });
        if (aq.length) {
            patch.assistant_queries = aq;
        }

        let sessionStored = false;
        let leadPatched = false;
        try {
            await upsertSessionChatTranscriptDoc(sid, patch);
            sessionStored = true;
            try {
                leadPatched = await patchLatestContactSubmissionClientContext(sid, patch);
            } catch (le) {
                const detail =
                    le && /** @type {{ message?: string }} */ (le).message ? String(le.message) : String(le);
                console.warn("[chatbot-api] session-transcript-sync lead patch:", detail.slice(0, 240));
            }
        } catch (e) {
            const detail = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
            return res.status(500).json({ ok: false, error: detail });
        }

        let assistantRows = 0;
        for (let i = 0; i < ct.length; i += 1) {
            const it = ct[i];
            if (
                it
                && typeof it === "object"
                && String(/** @type {{ role?: unknown }} */ (it).role || "")
                    .trim()
                    .toLowerCase() === "assistant"
            ) {
                assistantRows += 1;
            }
        }

        return res.status(200).json({
            ok: true,
            session_stored: sessionStored,
            stored_turns: ct.length,
            stored_assistant_rows: assistantRows,
            stored_assistant_queries: aq.length,
            lead_patched: leadPatched,
            live_agent: liveAgentQueue
        });
    }
);

/**
 * Lightweight CSAT / helpful feedback → Firestore `chat_feedback` (no BigQuery).
 * Widget: `window.dfchatPostFeedback({ helpful: true })` or `{ rating: 5 }` — see company.js.
 */
app.post(
    PATHNAME_CHAT_FEEDBACK,
    express.json({ limit: "32kb" }),
    async (req, res) => {
        const syncSecret = (process.env.CHAT_FEEDBACK_SECRET || "").trim();
        if (syncSecret) {
            const sent =
                typeof req.headers["x-chat-feedback-secret"] === "string"
                    ? req.headers["x-chat-feedback-secret"].trim()
                    : "";
            if (sent !== syncSecret) {
                return res.status(401).json({
                    ok: false,
                    error: "Unauthorized — set header X-Chat-Feedback-Secret to match CHAT_FEEDBACK_SECRET."
                });
            }
        }
        if (FIRESTORE_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Firestore is disabled — unset DISABLE_FIRESTORE / DRIVE_ONLY or enable Firebase for feedback storage."
            });
        }

        const body = req.body && typeof req.body === "object" ? req.body : {};
        const sidRaw =
            typeof body.client_session_id === "string" ? body.client_session_id.trim() : "";
        if (
            !sidRaw
            || sidRaw.length < 8
            || sidRaw.length > 128
            || !/^[a-zA-Z0-9_-]+$/.test(sidRaw)
        ) {
            return res.status(400).json({
                ok: false,
                error: "Missing or invalid client_session_id (use widget session id)."
            });
        }

        /** @type {Record<string, unknown>} */
        const doc = {
            client_session_id: sidRaw,
            channel: normalizeLeadChannel(body.channel)
        };

        if (body.helpful === true || body.helpful === false) {
            doc.helpful = body.helpful;
        }

        if (body.rating != null) {
            const r = Number(body.rating);
            if (Number.isFinite(r)) {
                const ri = Math.round(r);
                if (ri >= 1 && ri <= 5) {
                    doc.rating = ri;
                }
            }
        }

        const comment =
            typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
        if (comment) {
            doc.comment = comment;
        }

        const tag = typeof body.tag === "string" ? body.tag.trim().slice(0, 120) : "";
        if (tag) {
            doc.tag = tag;
        }

        const sourceUrl =
            typeof body.source_url === "string" ? body.source_url.trim().slice(0, 2000) : "";
        if (sourceUrl) {
            doc.source_url = sourceUrl;
        }

        if (
            doc.helpful === undefined
            && doc.rating === undefined
            && !doc.comment
            && !doc.tag
        ) {
            return res.status(400).json({
                ok: false,
                error: "Send at least one of: helpful (boolean), rating (1–5), comment, tag."
            });
        }

        doc.ip = extractRequestIp(req);

        try {
            await persistChatFeedbackRecord(doc);
            /** @type {Record<string, unknown>} */
            const out = { ok: true, message: "Recorded." };
            if (!SHEETS_DISABLED) {
                const feedbackMessage =
                    comment
                    || tag
                    || (doc.helpful === true ? "Helpful" : doc.helpful === false ? "Not helpful" : "");
                const feedbackRating = doc.rating != null ? String(doc.rating) : "";
                try {
                    out.sheet = await patchSheetLeadBySessionId_(sidRaw, {
                        feedbackRating,
                        feedbackMessage
                    });
                } catch (se) {
                    const detail = se && se.message ? se.message : String(se);
                    console.warn("[chatbot-api] chat-feedback sheet patch:", detail.slice(0, 240));
                    out.sheet = { ok: false, error: detail.slice(0, 200) };
                }
            }
            return res.status(200).json(out);
        } catch (e) {
            const msg =
                e && /** @type {{ message?: string }} */ (e).message
                    ? String(e.message)
                    : String(e);
            console.error("[chatbot-api] chat-feedback", msg.slice(0, 280), e);
            return res.status(500).json({ ok: false, error: msg.slice(0, 400) });
        }
    }
);

app.get("/health", (_req, res) => res.status(200).send("ok"));

/** Default: HTML page (avoids browsers “downloading” bare JSON). JSON only via ?format=json or Accept JSON-only. */
function wantsContactFormEmailHealthHtml_(req) {
    const q = req.query && typeof req.query === "object" ? req.query : {};
    if (String(q.format || "").toLowerCase() === "json") {
        return false;
    }
    if (String(q.html || "").toLowerCase() === "1") {
        return true;
    }
    if (String(q.format || "").toLowerCase() === "html") {
        return true;
    }
    const accept = (req.get("accept") || "").trim();
    const a = accept.toLowerCase();
    const hasJson = /\bapplication\/json\b/.test(a);
    const hasHtml = /\btext\/html\b/.test(a);
    const wildcard = /\*\/\*/.test(a);
    /** e.g. curl with Accept application/json only (no text/html, no star-slash-star). */
    if (hasJson && !hasHtml && !wildcard) {
        return false;
    }
    return true;
}

/** Debugging: Sheets env + optional live read probe (spreadsheet tabs / permissions). */
/** JSON (or HTML in the browser): which lead-email env vars are set (no secrets). Open after deploy to verify Railway. */
app.get("/contact-form-email-health", (req, res) => {
    const missing = missingContactLeadEmailEnvKeys_();
    const delayMs = resolveContactLeadEmailDelayMs_();
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const smtpSecureRaw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
    const smtpSecureEffective =
        smtpSecureRaw === "1" || smtpSecureRaw === "true" || smtpPort === 465;
    /** @type {string[]} */
    const troubleshooting_steps = [
        "Staff lead emails send only after HTTP 200, then CONTACT_LEAD_EMAIL_DELAY_MS wait (often 60000 ms). Set CONTACT_LEAD_EMAIL_DELAY_MS=0 when testing.",
        'After every form test, search Railway Logs for "[contact-form] lead_notify_tail" — if status is skipped or error, that line tells you why.',
        "Separate from staff mail: visitor thank-you needs CONTACT_LEAD_CLIENT_ACK_ENABLED=1; visitor appointment confirmation needs CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED=1.",
        'Chat/mobile-only sync POST may send no mail unless CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC=1 and name or email is present (mobile alone skips email on that endpoint).',
        "POST /contact-form-email-self-test (with CONTACT_LEAD_EMAIL_TEST_SECRET header) proves SMTP to CONTACT_LEAD_NOTIFY_TO. If ok:true but inbox empty, check spam and filters.",
        "Gmail SMTP: MAIL_FROM usually must match SMTP_USER unless your provider documents otherwise — use Google App Password, not normal password."
    ];
    const payload = {
        ok: missing.length === 0,
        lead_email_ready: missing.length === 0,
        missing_env: missing,
        has_notify_to: !!(process.env.CONTACT_LEAD_NOTIFY_TO || "").trim(),
        has_smtp_host: !!(process.env.SMTP_HOST || "").trim(),
        has_smtp_user: !!(process.env.SMTP_USER || "").trim(),
        has_smtp_pass: !!(process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").trim(),
        mail_from_set: !!(process.env.MAIL_FROM || "").trim(),
        mail_provider: currentMailProvider_(),
        resend_configured: isResendConfigured_(),
        resend_api_key_format_ok:
            !isResendConfigured_() || (process.env.RESEND_API_KEY || "").trim().startsWith("re_"),
        resend_from_set: !!(process.env.RESEND_FROM || "").trim(),
        smtp_port: smtpPort,
        smtp_secure_effective_hint: smtpSecureEffective ? "implicit TLS mode (typically port 465)" : "STARTTLS typical for port 587",
        visitor_client_ack_enabled: (process.env.CONTACT_LEAD_CLIENT_ACK_ENABLED || "").trim() === "1",
        visitor_appointment_ack_enabled:
            (process.env.CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED || "").trim() === "1",
        notify_on_mobile_sheet_sync_enabled:
            (process.env.CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC || "").trim() === "1",
        lead_email_delay_ms_after_http_200: delayMs,
        troubleshooting_steps,
        hint:
            missing.length
                ? "Set the missing_* names in Railway Variables for this service, redeploy, then submit the contact form with name + phone or email."
                : "Env looks complete. If still no mail: check Railway Logs for [contact-lead-notify-email], set CONTACT_LEAD_EMAIL_DEBUG=1, submit form again, use a real App Password for Gmail."
    };
    if (!wantsContactFormEmailHealthHtml_(req)) {
        return res.status(200).json(payload);
    }
    /** @type {(s: unknown) => string} */
    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    const yesNo = (b) =>
        `<span style="font-weight:600;color:${b ? "#0a7" : "#c22"}">${b ? "yes" : "no"}</span>`;
    const rows = [
        ["ok", payload.ok],
        ["lead_email_ready", payload.lead_email_ready],
        ["CONTACT_LEAD_NOTIFY_TO set", payload.has_notify_to],
        ["mail_provider (resend vs smtp)", payload.mail_provider],
        ["RESEND_API_KEY set (HTTPS mail)", payload.resend_configured],
        ["resend_api_key_format_ok (starts with re_)", payload.resend_api_key_format_ok],
        ["RESEND_FROM set", payload.resend_from_set],
        ["SMTP_HOST set", payload.has_smtp_host],
        ["SMTP_USER set", payload.has_smtp_user],
        ["SMTP_PASS (or SMTP_PASSWORD) set", payload.has_smtp_pass],
        ["MAIL_FROM set", payload.mail_from_set],
        ["SMTP_PORT", payload.smtp_port],
        ["smtp_secure_effective_hint", payload.smtp_secure_effective_hint],
        ["lead_email_delay_ms_after_http_200", delayMs],
        ["CONTACT_LEAD_CLIENT_ACK_ENABLED (=1 visitor thank-you)", payload.visitor_client_ack_enabled],
        ["CONTACT_APPOINTMENT_CLIENT_ACK_ENABLED (=1 visitor appointment)", payload.visitor_appointment_ack_enabled],
        ["CONTACT_LEAD_NOTIFY_ON_MOBILE_SYNC (=1 sheet-only mobile POST)", payload.notify_on_mobile_sheet_sync_enabled],
        ["missing_env (must be [])", payload.missing_env.length ? payload.missing_env.join(", ") : "(none)"],
        ["hint", payload.hint]
    ];
    const tr = rows
        .map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #ccc">${esc(k)}</td>` +
            `<td style="padding:6px 12px;border:1px solid #ccc">${
                typeof v === "boolean" ? yesNo(v) : esc(v)
            }</td></tr>`)
        .join("");
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Lead email env</title></head>`
        + `<body style="font-family:system-ui,Segoe UI,sans-serif;padding:24px;background:#fafafa">`
        + `<h1 style="margin-top:0">Contact form — lead email health</h1>`
        + `<p>This page reads environment flags only — no passwords are printed.</p>`
        + `<table style="border-collapse:collapse;background:#fff;max-width:720px">${tr}</table>`
        + `<h2 style="margin-top:28px;font-size:18px">If mail still doesn’t arrive</h2>`
        + `<ol style="background:#fff;max-width:720px;line-height:1.5">${(payload.troubleshooting_steps || [])
            .map((s) => `<li style="margin:8px 0">${esc(s)}</li>`)
            .join("")}</ol>`
        + `<p style="margin-top:20px;color:#666;font-size:14px">`
        + `<a href="?format=json">Open as JSON</a> · `
        + `Use <code>curl -H \"Accept: application/json\" …</code> for scripts.</p>`
        + `</body></html>`;
    return res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(html);
});

/** POST: send exactly one ping mail to CONTACT_LEAD_NOTIFY_TO (proves SMTP, not only env parser). Requires CONTACT_LEAD_EMAIL_TEST_SECRET + matching header/body.secret. */
app.post("/contact-form-email-self-test", express.json({ limit: "2kb" }), async (req, res) => {
    const want = (process.env.CONTACT_LEAD_EMAIL_TEST_SECRET || "").trim();
    if (!want || want.length < 8) {
        return res.status(503).json({
            ok: false,
            error:
                "Set CONTACT_LEAD_EMAIL_TEST_SECRET (8+ random chars) in Railway Variables for this service, redeploy, then POST with header X-Contact-Lead-Email-Test-Secret."
        });
    }
    const gotHdr = typeof req.headers["x-contact-lead-email-test-secret"] === "string"
        ? req.headers["x-contact-lead-email-test-secret"].trim()
        : "";
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const gotBody = typeof /** @type {{ secret?: unknown }} */ (body).secret === "string"
        ? String(body.secret).trim()
        : "";
    const got = gotHdr || gotBody;
    if (got !== want) {
        return res.status(403).json({
            ok: false,
            error: "Forbidden — send X-Contact-Lead-Email-Test-Secret (or JSON { secret }) matching CONTACT_LEAD_EMAIL_TEST_SECRET."
        });
    }
    try {
        const out = await sendContactLeadMailboxSelfTestPing();
        const shaped = formatLeadEmailOutcomeForJson(out);
        const okPing = shaped.status === "sent";
        return res.status(okPing ? 200 : 500).json({ ok: okPing, outcome: shaped });
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
});

app.get("/contact-form-sheets-health", async (_req, res) => {
    try {
        const id = (process.env.SHEETS_SPREADSHEET_ID || "").trim();
        /** @type {Record<string, unknown>} */
        const body = {
            ok: true,
            sheets_writes_enabled: !SHEETS_DISABLED,
            disable_sheets_flag: process.env.DISABLE_SHEETS === "1",
            spreadsheet_id_configured: !!id,
            spreadsheet_id_suffix: id ? id.slice(-8) : "",
            sheets_default_range_env: (process.env.SHEETS_RANGE || "Sheet1!A:S").trim(),
            strict_session_dedup: process.env.SHEETS_STRICT_SESSION_DEDUP === "1",
            service_account_credentials_present: !!getServiceAccountCredentials()
        };
        if (!SHEETS_DISABLED && getServiceAccountCredentials()) {
            body.read_probe = await probeSheetsSpreadsheetAccess();
            try {
                const { google } = await import("googleapis");
                const key = getServiceAccountCredentials();
                const tab = (process.env.SHEETS_RANGE || "Sheet1!A:S").split("!")[0] || "Sheet1";
                const auth = new google.auth.GoogleAuth({
                    credentials: key,
                    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
                });
                const sheetsApi = google.sheets({ version: "v4", auth: await auth.getClient() });
                const got = await sheetsApi.spreadsheets.values.get({
                    spreadsheetId: id,
                    range: `${tab}!1:1`
                });
                const h0 = Array.isArray(got.data.values) && got.data.values[0] ? got.data.values[0] : [];
                body.header_row_1 = h0.slice(0, 35).map((c) => String(c ?? "").trim());
                body.header_row_1_length = h0.length;
            } catch (hdrErr) {
                body.header_row_1_error = hdrErr && hdrErr.message ? String(hdrErr.message).slice(0, 200) : String(hdrErr);
            }
        }
        return res.status(200).json(body);
    } catch (e) {
        const detail = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        return res.status(500).json({ ok: false, error: detail });
    }
});

/** Reception/staff: same-slot view as the chat widget (reads RTDB via /api/slots). */
const RECEPTION_SCHEDULE_HTML = path.join(__dirname_api, "public", "reception-schedule.html");
const CONVERSATIONS_SHEET_HTML = path.join(__dirname_api, "public", "conversations-sheet.html");
const CONVERSATION_TRANSCRIPT_HTML = path.join(__dirname_api, "public", "conversation-transcript.html");
const QA_INDEX_HTML = path.join(__dirname_api, "public", "qa", "index.html");

mountStaffPageRoutes(app, {
    conversationsSheetHtml: CONVERSATIONS_SHEET_HTML,
    qaIndexHtml: QA_INDEX_HTML
});

/** sendFile callback: client abort (EPIPE) can fire after headers are already sent. */
function sendStaffHtmlPage_(res, filePath, routeLabel, missingBody) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.sendFile(filePath, (err) => {
        if (!err) return;
        const code = typeof err.code === "string" ? err.code : "";
        const msg = err.message || String(err);
        if (res.headersSent) {
            if (code !== "EPIPE" && code !== "ECONNRESET" && !/aborted|destroyed/i.test(msg)) {
                console.warn(`[chatbot-api] ${routeLabel}: response interrupted —`, msg);
            }
            return;
        }
        console.error(`[chatbot-api] ${routeLabel}:`, msg);
        res.status(404).type("text/plain; charset=utf-8").send(missingBody);
    });
}

app.get("/reception-schedule", (_req, res) => {
    sendStaffHtmlPage_(
        res,
        RECEPTION_SCHEDULE_HTML,
        "reception-schedule",
        "Staff UI missing: add public/reception-schedule.html and redeploy."
    );
});

/** Staff: one session’s transcript UI (`?session=`). Sheet “Chat transcript” → same URL via SHEETS_ROW_OPEN_LINK_COLUMN + CONVERSATIONS_PUBLIC_BASE_URL. Auth: CONVERSATIONS_SHEET_VIEW_SECRET (see GET /api/conversation-transcript). */
app.get("/conversation-transcript", (_req, res) => {
    sendStaffHtmlPage_(
        res,
        CONVERSATION_TRANSCRIPT_HTML,
        "conversation-transcript",
        "Staff UI missing: add public/conversation-transcript.html and redeploy."
    );
});

const PATHNAME_CONVERSATIONS_SHEET_JSON = "/api/conversations-sheet";
const PATHNAME_CONVERSATIONS_SHEET_STATS = "/api/conversations-sheet-stats";
const PATHNAME_CONVERSATIONS_SHEET_EXPORT = "/api/conversations-sheet-export";
const PATHNAME_CONVERSATION_TRANSCRIPT_JSON = "/api/conversation-transcript";

const CONVERSATIONS_VIEWER_READ_QUOTA_MSG =
    "Read quota exceeded. Wait about one minute, then tap Reload once (avoid rapid refreshes).";

/** @param {unknown} msg */
function isConversationsSheetReadQuotaError_(msg) {
    const low = String(msg || "").toLowerCase();
    return (
        low.includes("quota exceeded")
        || low.includes("rate limit")
        || low.includes("resource_exhausted")
    );
}

/** User-facing API errors for the conversations viewer (no upstream product names). @param {unknown} msg */
function sanitizeConversationsViewerApiError_(msg) {
    const raw = String(msg || "").trim();
    if (!raw) {
        return "Request failed.";
    }
    if (isConversationsSheetReadQuotaError_(raw)) {
        return CONVERSATIONS_VIEWER_READ_QUOTA_MSG;
    }
    const stripped = raw
        .replace(/google sheets?\s*(api\s*)?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (isConversationsSheetReadQuotaError_(stripped)) {
        return CONVERSATIONS_VIEWER_READ_QUOTA_MSG;
    }
    return (stripped || raw).slice(0, 500);
}

function conversationsSheetSecretFromReq_(req) {
    const want = (process.env.CONVERSATIONS_SHEET_VIEW_SECRET || "").trim();
    if (!want) {
        return { want: "", got: "", ok: false, reason: "unset" };
    }
    const auth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    let bearer = "";
    if (/^Bearer\s+/i.test(auth)) {
        bearer = auth.replace(/^Bearer\s+/i, "").trim();
    }
    const hdr =
        (typeof req.headers["x-conversations-sheet-secret"] === "string"
            ? req.headers["x-conversations-sheet-secret"].trim()
            : "")
        || bearer;
    const q = req.query && typeof req.query.secret === "string" ? req.query.secret.trim() : "";
    const got = hdr || q;
    return { want, got, ok: got === want, reason: got ? "bad" : "missing" };
}

function setConversationsSheetCors_(req, res) {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Conversations-Sheet-Secret"
    );
}

/**
 * @param {unknown} raw
 * @returns {number | undefined}
 */
function coerceTranscriptAtMs_(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
    }
    if (raw && typeof raw === "object") {
        const o = /** @type {{ seconds?: unknown, nanoseconds?: unknown, _seconds?: unknown, _nanoseconds?: unknown }} */ (
            raw
        );
        const sec =
            typeof o.seconds === "number" && Number.isFinite(o.seconds)
                ? o.seconds
                : typeof o._seconds === "number" && Number.isFinite(o._seconds)
                  ? o._seconds
                  : NaN;
        const ns =
            typeof o.nanoseconds === "number" && Number.isFinite(o.nanoseconds)
                ? o.nanoseconds
                : typeof o._nanoseconds === "number" && Number.isFinite(o._nanoseconds)
                  ? o._nanoseconds
                  : 0;
        if (Number.isFinite(sec)) {
            return sec * 1000 + Math.floor(ns / 1e6);
        }
    }
    if (typeof raw === "string" && raw.trim()) {
        const t = Date.parse(raw.trim());
        if (Number.isFinite(t)) {
            return t;
        }
    }
    return undefined;
}

/**
 * @param {Record<string, unknown>} rec
 * @returns {boolean}
 */
function transcriptItemLooksLikeCxAssistantPayload_(rec) {
    if (!rec || typeof rec !== "object") {
        return false;
    }
    if (rec.fulfillment_response || rec.fulfillmentResponse) {
        return true;
    }
    const pl = rec.payload;
    if (pl && typeof pl === "object") {
        const p = /** @type {Record<string, unknown>} */ (pl);
        if (p.fulfillment_response || p.fulfillmentResponse) {
            return true;
        }
    }
    const tx = rec.text;
    if (tx && typeof tx === "object" && !Array.isArray(tx)) {
        /** CX outbound: `{ text: { text: string[] } }` without `role` */
        const nest = /** @type {{ text?: unknown }} */ (tx).text;
        if (Array.isArray(nest) && nest.some((x) => typeof x === "string" && x.trim())) {
            return true;
        }
    }
    return false;
}

/**
 * Widget / Firestore sometimes stores `chat_transcript` as a JSON string instead of an array.
 *
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function coerceChatTranscriptArray_(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === "string") {
        const s = raw.trim();
        if (s.startsWith("[")) {
            try {
                const parsed = JSON.parse(s);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
    }
    return [];
}

/**
 * @param {Record<string, unknown>} cx
 */
function describeChatTranscriptStorage_(cx) {
    if (!cx || typeof cx !== "object") {
        return { kind: "missing" };
    }
    const raw = cx.chat_transcript;
    if (Array.isArray(raw)) {
        let assistantRows = 0;
        for (let i = 0; i < raw.length; i += 1) {
            const it = raw[i];
            if (
                it
                && typeof it === "object"
                && String(/** @type {{ role?: unknown }} */ (it).role || "")
                    .trim()
                    .toLowerCase() === "assistant"
            ) {
                assistantRows += 1;
            }
        }
        return { kind: "array", length: raw.length, assistant_rows: assistantRows };
    }
    if (typeof raw === "string") {
        return { kind: "string", length: raw.length };
    }
    if (raw == null) {
        return { kind: "null" };
    }
    return { kind: typeof raw };
}

/**
 * @param {Record<string, unknown>} rec
 * @returns {"assistant" | "user" | "agent"}
 */
function normalizeTranscriptItemRole_(rec) {
    const raw =
        rec.role
        ?? rec.type
        ?? rec.sender
        ?? rec.participant
        ?? rec.author
        ?? rec.messageFrom
        ?? rec.source
        ?? rec.speaker;
    const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (r === "staff" || r === "human_agent" || r === "live_agent") {
        return "agent";
    }
    if (r === "agent") {
        return "agent";
    }
    if (
        r === "assistant"
        || r === "bot"
        || r === "model"
        || r === "assistant_bot"
        || r === "virtual_agent"
        || r === "df-bot"
        || r === "chirp"
        || r.includes("automated")
    ) {
        return "assistant";
    }
    if (r === "system") {
        return "assistant";
    }
    if (r === "user" || r === "human" || r === "customer" || r === "client" || r === "end_user" || r === "enduser") {
        return "user";
    }
    if (transcriptItemLooksLikeCxAssistantPayload_(rec)) {
        return "assistant";
    }
    return "user";
}

/** @param {{ role?: string }} turn */
function transcriptTurnRoleForMerge_(turn) {
    const r = String(turn && turn.role != null ? turn.role : "")
        .trim()
        .toLowerCase();
    if (r === "agent" || r === "staff") {
        return "agent";
    }
    if (r === "assistant") {
        return "assistant";
    }
    return "user";
}

function liveAgentSystemLineHiddenFromTranscript_(text) {
    const t = String(text || "")
        .trim()
        .toLowerCase();
    if (!t) {
        return true;
    }
    if (t.includes("ai assistant enabled") || t.includes("human agent took over")) {
        return true;
    }
    if (t.includes("this chat has ended")) {
        return true;
    }
    return false;
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ role: string, text: string, at?: number }[]>}
 */
async function transcriptTurnsFromLiveAgentInbox_(sessionId) {
    try {
        const { liveAgentFirestoreReady_, listMessages_, getConversation_, resolveConversationId_ } =
            await import("./lib/live-agent/store.mjs");
        const { resolveAgentDisplayName_, getLiveAgentSettings_ } = await import(
            "./lib/live-agent/departments.mjs"
        );
        if (!liveAgentFirestoreReady_()) {
            return [];
        }
        let id = "";
        try {
            id = resolveConversationId_(sessionId);
        } catch {
            return [];
        }
        const conv = await getConversation_(id);
        if (!conv) {
            return [];
        }
        const messages = await listMessages_({ conversationId: id, limit: 200 });
        if (!messages.length) {
            return [];
        }
        const settings = await getLiveAgentSettings_();
        /** @type {{ role: string, text: string, at?: number }[]} */
        const turns = [];
        for (let i = 0; i < messages.length; i += 1) {
            const m = messages[i];
            if (!m) {
                continue;
            }
            const roleRaw = typeof m.role === "string" ? m.role.trim().toLowerCase() : "";
            const text = typeof m.text === "string" ? m.text.trim() : "";
            if (!text || isTranscriptEphemeralStatusText_(text)) {
                continue;
            }
            const atMs = coerceTranscriptAtMs_(m.createdAt);
            if (roleRaw === "visitor") {
                if (isTranscriptHandoffRoutingToken_(text) || isTranscriptInternalUserToken_(text)) {
                    continue;
                }
                /** @type {{ role: string, text: string, at?: number }} */
                const row = { role: "user", text };
                if (typeof atMs === "number" && Number.isFinite(atMs)) {
                    row.at = atMs;
                }
                turns.push(row);
                continue;
            }
            if (roleRaw === "agent" || roleRaw === "staff") {
                const name =
                    typeof m.senderDisplayName === "string" && m.senderDisplayName.trim()
                        ? m.senderDisplayName.trim()
                        : resolveAgentDisplayName_(m.senderEmail, settings);
                const line = name ? `${name}: ${text}` : text;
                /** @type {{ role: string, text: string, at?: number }} */
                const row = { role: "agent", text: line };
                if (typeof atMs === "number" && Number.isFinite(atMs)) {
                    row.at = atMs;
                }
                turns.push(row);
                continue;
            }
            if (roleRaw === "system") {
                if (liveAgentSystemLineHiddenFromTranscript_(text)) {
                    continue;
                }
                /** @type {{ role: string, text: string, at?: number }} */
                const row = { role: "agent", text };
                if (typeof atMs === "number" && Number.isFinite(atMs)) {
                    row.at = atMs;
                }
                turns.push(row);
            }
        }
        return turns;
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.warn("[chatbot-api] live-agent transcript:", msg.slice(0, 240));
        return [];
    }
}

/** @param {{ role: string, text: string, at?: number, seq?: number }[]} turns */
function assistantTurnCount_(turns) {
    if (!Array.isArray(turns)) {
        return 0;
    }
    let n = 0;
    for (let i = 0; i < turns.length; i += 1) {
        if (turns[i] && turns[i].role === "assistant") {
            n += 1;
        }
    }
    return n;
}

/** Prefer the source with more turns / higher `seq` (live widget vs frozen submit snapshot). */
function transcriptSourceRichness_(turns) {
    if (!Array.isArray(turns) || !turns.length) {
        return 0;
    }
    let maxSeq = 0;
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (!t || typeof t !== "object") {
            continue;
        }
        const s = typeof t.seq === "number" && Number.isFinite(t.seq) ? t.seq : 0;
        if (s > maxSeq) {
            maxSeq = s;
        }
    }
    return turns.length + maxSeq * 1000 + assistantTurnCount_(turns) * 500;
}

/**
 * @param {Record<string, unknown>} o
 * @param {number} [depth]
 * @returns {string}
 */
function transcriptTurnTextFromItem_(o, depth = 0) {
    if (!o || typeof o !== "object" || depth > 8) {
        return "";
    }
    const rec = /** @type {Record<string, unknown>} */ (o);
    /** Dialogflow CX: `{ text: { text: ["..."] } }` — not always flattened to top-level string. */
    const cxTextNest = rec.text;
    if (cxTextNest && typeof cxTextNest === "object" && !Array.isArray(cxTextNest)) {
        const nest = /** @type {{ text?: unknown }} */ (cxTextNest).text;
        if (Array.isArray(nest)) {
            /** @type {string[]} */
            const bits = [];
            for (const x of nest) {
                if (typeof x === "string" && x.trim()) {
                    bits.push(x.trim());
                }
            }
            if (bits.length) {
                return bits.join("\n");
            }
        }
    }
    if (Array.isArray(rec.messages) && rec.messages.length && depth < 8) {
        /** @type {string[]} */
        const msgBits = [];
        for (let mi = 0; mi < rec.messages.length; mi += 1) {
            const m = rec.messages[mi];
            const sub =
                m && typeof m === "object"
                    ? transcriptTurnTextFromItem_(/** @type {Record<string, unknown>} */ (m), depth + 1)
                    : "";
            if (sub) {
                msgBits.push(sub);
            }
        }
        if (msgBits.length) {
            return msgBits.join("\n\n");
        }
    }
    /** @param {unknown} v */
    const stringLeaf = (v) => {
        if (typeof v === "string" && v.trim()) {
            return v.trim();
        }
        if (
            v
            && typeof v === "object"
            && typeof /** @type {{ text?: unknown }} */ (v).text === "string"
            && String(/** @type {{ text?: string }} */ (v).text).trim()
        ) {
            return String(/** @type {{ text?: string }} */ (v).text).trim();
        }
        return "";
    };
    for (const k of ["text", "message", "content", "body"]) {
        const v = rec[k];
        const leaf = stringLeaf(v);
        if (leaf) {
            return leaf;
        }
        if (
            typeof v === "object"
            && v
            && Array.isArray(/** @type {{ parts?: unknown }} */ (v).parts)
        ) {
            const parts = /** @type {{ parts: unknown[] }} */ (v).parts;
            /** @type {string[]} */
            const bits = [];
            for (const p of parts) {
                const s = stringLeaf(p);
                if (s) {
                    bits.push(s);
                }
            }
            if (bits.length) {
                return bits.join("\n");
            }
        }
    }
    for (const k of ["outputText", "displayText"]) {
        const v = rec[k];
        if (typeof v === "string" && v.trim()) {
            return v.trim();
        }
    }
    /** Dialogflow CX / Messenger: full message objects sometimes only carry `fulfillment_response.messages`. */
    const fr = rec.fulfillment_response || rec.fulfillmentResponse;
    if (fr && typeof fr === "object") {
        const msgs = /** @type {{ messages?: unknown[] }} */ (fr).messages;
        if (Array.isArray(msgs) && msgs.length) {
            /** @type {string[]} */
            const bits = [];
            for (let mi = 0; mi < msgs.length; mi += 1) {
                const m = msgs[mi];
                const sub =
                    m && typeof m === "object"
                        ? transcriptTurnTextFromItem_(/** @type {Record<string, unknown>} */ (m), depth + 1)
                        : "";
                if (sub) {
                    bits.push(sub);
                }
            }
            if (bits.length) {
                return bits.join("\n\n");
            }
        }
    }
    if (rec.rich) {
        const fromRich = transcriptTextFromStoredRich_(rec.rich);
        if (fromRich) {
            return fromRich;
        }
    }
    const pay = rec.payload;
    if (pay && typeof pay === "object") {
        const fromPay = transcriptTextFromStoredRich_(pay);
        if (fromPay) {
            return fromPay;
        }
        const nested = transcriptTurnTextFromItem_(/** @type {Record<string, unknown>} */ (pay), depth + 1);
        if (nested) {
            return nested;
        }
    }
    return "";
}

const CHAT_TRANSCRIPT_SHEET_CELL_MAX = 49000;

/** @param {unknown} text */
function normalizeSheetTranscriptSplashKey_(text) {
    return String(text || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

/**
 * Drops leading assistant line(s) that are generic splash openers so the Sheet JSON starts at the real dialog.
 * Built-in: "Welcome to Artemis event." Optional: exact match for `SHEETS_CHAT_TRANSCRIPT_STRIP_LEADING_ASSISTANT_TEXT`.
 *
 * @param {unknown[]} arr
 */
function stripLeadingAssistantSplashForSheet_(arr) {
    if (!Array.isArray(arr) || !arr.length) {
        return arr;
    }
    const splashNeedles = new Set(["welcome to artemis event", "welcome to artemis event."]);
    const envExtra = normalizeSheetTranscriptSplashKey_(
        process.env.SHEETS_CHAT_TRANSCRIPT_STRIP_LEADING_ASSISTANT_TEXT || ""
    );
    if (envExtra) {
        splashNeedles.add(envExtra);
    }
    const out = arr.slice();
    while (out.length) {
        const first = out[0];
        if (!first || typeof first !== "object") {
            break;
        }
        const o = /** @type {Record<string, unknown>} */ (first);
        if (String(o.role || "").toLowerCase() !== "assistant") {
            break;
        }
        const key = normalizeSheetTranscriptSplashKey_(o.text);
        if (!key || !splashNeedles.has(key)) {
            break;
        }
        out.shift();
    }
    return out;
}

/**
 * Drop gallery/graph/chip payloads from transcript JSON before optional Sheet storage.
 * Staff transcript page uses Firestore; Sheet JSON is legacy and should be text-only.
 *
 * @param {unknown[]} arr
 */
function sanitizeChatTranscriptForSheet_(arr) {
    if (!Array.isArray(arr) || !arr.length) {
        return [];
    }
    /** @type {Record<string, unknown>[]} */
    const out = [];
    for (let i = 0; i < arr.length; i += 1) {
        const turn = arr[i];
        if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
            continue;
        }
        const o = /** @type {Record<string, unknown>} */ ({ ...turn });
        delete o.rich_json;
        delete o.rich;
        delete o.payload;
        delete o.images;
        delete o.gallery;
        let text = typeof o.text === "string" ? o.text.trim() : "";
        if (text && transcriptTextLooksLikeScrapedRichNoise_(text)) {
            text = "";
        }
        if (!text) {
            continue;
        }
        o.text = text;
        out.push(o);
    }
    return out;
}

function sheetsWriteChatTranscriptJsonEnabled_() {
    return (
        process.env.SHEETS_WRITE_CHAT_TRANSCRIPT_JSON === "1"
        || String(process.env.SHEETS_WRITE_CHAT_TRANSCRIPT_JSON || "").trim().toLowerCase() === "true"
    );
}

/** Serialize widget `chat_transcript` for optional Google Sheets column (see SHEETS_CHAT_TRANSCRIPT_JSON_COLUMN). */
function stringifyChatTranscriptForSheetPayload_(clientContext) {
    const cx = clientContext && typeof clientContext === "object" ? clientContext : {};
    const ctRaw = coerceChatTranscriptArray_(cx.chat_transcript);
    if (!ctRaw.length) {
        return "";
    }
    const ct = sanitizeChatTranscriptForSheet_(stripLeadingAssistantSplashForSheet_(ctRaw));
    if (!Array.isArray(ct) || !ct.length) {
        return "";
    }
    try {
        const full = JSON.stringify(ct);
        if (full.length <= CHAT_TRANSCRIPT_SHEET_CELL_MAX) {
            return full;
        }
        let lo = 0;
        let hi = ct.length;
        /** @type {string} */
        let best = "";
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const slice = ct.slice(-mid);
            const tryStr = JSON.stringify(slice);
            if (tryStr.length <= CHAT_TRANSCRIPT_SHEET_CELL_MAX) {
                best = tryStr;
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return best || JSON.stringify(ct.slice(-3));
    } catch {
        return "";
    }
}

/**
 * @param {Record<string, unknown>} o
 * @returns {Record<string, unknown> | null}
 */
function transcriptTurnRichFromItem_(o) {
    if (!o || typeof o !== "object") {
        return null;
    }
    const richJson = o.rich_json;
    if (typeof richJson === "string" && richJson.trim()) {
        try {
            const parsed = JSON.parse(richJson);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return /** @type {Record<string, unknown>} */ (parsed);
            }
        } catch {
            /* ignore */
        }
    }
    const direct = o.rich;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return /** @type {Record<string, unknown>} */ (direct);
    }
    const pay = o.payload;
    if (pay && typeof pay === "object" && !Array.isArray(pay)) {
        const p = /** @type {Record<string, unknown>} */ (pay);
        if (Array.isArray(p.richContent) || typeof p.action === "string") {
            return p;
        }
    }
    return null;
}

/** @param {string} text */
function transcriptTextLooksLikeScrapedRichNoise_(text) {
    const t = String(text || "").trim();
    if (!t) {
        return false;
    }
    if (/\bHANDLER_PROMPT\b/.test(t) || /\bVirtual Agent\b/.test(t)) {
        return true;
    }
    const lines = t.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);
    return lines.some((ln) => ln === "Chips" || ln === "chips");
}

/**
 * Plain text for staff transcript when widget stored structured `rich` without `text`
 * (e.g. after partial revert while Firestore still has rich-only assistant rows).
 *
 * @param {unknown} rich
 * @returns {string}
 */
function transcriptTextFromStoredRich_(rich) {
    if (!rich || typeof rich !== "object" || Array.isArray(rich)) {
        return "";
    }
    const r = /** @type {Record<string, unknown>} */ (rich);
    /** @type {string[]} */
    const bits = [];
    const msg = typeof r.message === "string" ? r.message.trim() : "";
    if (msg) {
        bits.push(msg);
    }
    const rc = r.richContent;
    if (Array.isArray(rc)) {
        for (let ri = 0; ri < rc.length; ri += 1) {
            const row = rc[ri];
            if (!Array.isArray(row)) {
                continue;
            }
            for (let ci = 0; ci < row.length; ci += 1) {
                const item = row[ci];
                if (!item || typeof item !== "object") {
                    continue;
                }
                const type = String(/** @type {{ type?: unknown }} */ (item).type || "").toLowerCase();
                if (type === "chips") {
                    const opts = /** @type {{ options?: unknown[] }} */ (item).options;
                    if (Array.isArray(opts)) {
                        for (const opt of opts) {
                            const t =
                                typeof opt === "string"
                                    ? opt.trim()
                                    : opt && typeof opt === "object" && typeof /** @type {{ text?: unknown }} */ (opt).text === "string"
                                      ? String(/** @type {{ text?: string }} */ (opt).text).trim()
                                      : "";
                            if (t && t !== "Chips" && t !== "HANDLER_PROMPT" && t !== "Virtual Agent") {
                                bits.push(t);
                            }
                        }
                    }
                } else if (type === "info" || type === "accordion") {
                    const title =
                        typeof /** @type {{ title?: unknown }} */ (item).title === "string"
                            ? String(/** @type {{ title?: string }} */ (item).title).trim()
                            : "";
                    const sub =
                        typeof /** @type {{ subtitle?: unknown }} */ (item).subtitle === "string"
                            ? String(/** @type {{ subtitle?: string }} */ (item).subtitle).trim()
                            : "";
                    if (title) {
                        bits.push(sub ? `${title} — ${sub}` : title);
                    } else if (sub) {
                        bits.push(sub);
                    }
                }
            }
        }
    }
    if (Array.isArray(r.options)) {
        for (const opt of r.options) {
            if (!opt || typeof opt !== "object") {
                continue;
            }
            const label =
                typeof /** @type {{ label?: unknown }} */ (opt).label === "string"
                    ? String(/** @type {{ label?: string }} */ (opt).label).trim()
                    : "";
            if (label) {
                bits.push(label);
            }
        }
    }
    return [...new Set(bits)].join("\n");
}

/**
 * @param {unknown[]} arr
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]}
 */
function transcriptTurnsFromStoredChatArray_(arr) {
    if (!Array.isArray(arr) || !arr.length) {
        return [];
    }
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, seq?: number, ord: number, atMs?: number, atSort: number }[]} */
    const tmp = [];
    let ord = 0;
    for (const item of arr) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const o = /** @type {Record<string, unknown>} */ (item);
        const roleRaw = String(o.role ?? o.type ?? "").trim().toLowerCase();
        const explicitAssistant =
            roleRaw === "assistant"
            || roleRaw === "bot"
            || roleRaw === "agent"
            || roleRaw === "virtual_agent";
        const role = normalizeTranscriptItemRole_(o);
        const rich = transcriptTurnRichFromItem_(o);
        let text = transcriptTurnTextFromItem_(o);
        if (rich && transcriptTextLooksLikeScrapedRichNoise_(text)) {
            text = "";
        }
        if (!text && rich) {
            text = transcriptTextFromStoredRich_(rich);
        }
        if (!text && !rich) {
            if (explicitAssistant || role === "assistant") {
                text = "(Bot message)";
            } else {
                continue;
            }
        }
        if (role === "user" && shouldOmitTranscriptUserTurn_(text)) {
            continue;
        }
        if (isTranscriptEphemeralStatusText_(text)) {
            continue;
        }
        if (isTranscriptCxInternalToken_(text)) {
            continue;
        }
        if (role === "assistant" && text && !rich && isTranscriptIntentDisplayNoise_(text)) {
            continue;
        }
        if (role === "assistant" && text && !rich && isTranscriptStandaloneChipOrMenuLabel_(text)) {
            continue;
        }
        if (isTranscriptOpenFormActionTurn_(/** @type {{ role?: string, text?: string, rich?: unknown, rich_json?: unknown }} */ ({ role, text, rich }))) {
            continue;
        }
        if (role === "assistant" && isTranscriptPersonaChromeText_(text)) {
            continue;
        }
        if (role === "assistant") {
            text = dedupeTranscriptDisplayText_(stripLiveAgentTranscriptFingerprint_(text));
        }
        const atMs = coerceTranscriptAtMs_(o.at);
        const rawSeq = o.seq;
        const seqParsed =
            typeof rawSeq === "number" && Number.isFinite(rawSeq)
                ? rawSeq
                : typeof rawSeq === "string" && Number.isFinite(Number(rawSeq.trim()))
                  ? Number(rawSeq.trim())
                  : NaN;
        const seq = Number.isFinite(seqParsed) ? seqParsed : undefined;
        const atSort = atMs !== undefined ? atMs : Number.POSITIVE_INFINITY;
        tmp.push({ role, text: text || "", rich, seq, ord: ord++, atMs, atSort });
    }
    const seqCount = tmp.filter((x) => typeof x.seq === "number" && Number.isFinite(x.seq)).length;
    const allSeq = seqCount === tmp.length && tmp.length > 0;
    const anyMissingAt = tmp.some((x) => x.atMs === undefined);
    if (allSeq) {
        tmp.sort(
            (a, b) =>
                /** @type {number} */ (a.seq) - /** @type {number} */ (b.seq) || a.ord - b.ord
        );
    } else if (anyMissingAt) {
        // Avoid sorting undated rows to the end (Infinity bucket), which clusters roles out of order.
        tmp.sort((a, b) => a.ord - b.ord);
    } else {
        tmp.sort((a, b) => {
            if (a.atSort !== b.atSort) {
                return a.atSort - b.atSort;
            }
            const ha = typeof a.seq === "number" && Number.isFinite(a.seq);
            const hb = typeof b.seq === "number" && Number.isFinite(b.seq);
            if (ha && hb && /** @type {number} */ (a.seq) !== /** @type {number} */ (b.seq)) {
                return /** @type {number} */ (a.seq) - /** @type {number} */ (b.seq);
            }
            return a.ord - b.ord;
        });
    }
    return tmp.map(({ role, text, rich, atMs, seq }) => {
        const out = /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }} */ ({
            role,
            text
        });
        if (rich && typeof rich === "object") {
            out.rich = rich;
        }
        if (atMs !== undefined) {
            out.at = atMs;
        }
        if (typeof seq === "number" && Number.isFinite(seq)) {
            out.seq = seq;
        }
        return out;
    });
}

function parseChatTranscriptJsonCell_(raw) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s.startsWith("[")) {
        return [];
    }
    try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

/** Scan wide row dump for any cell containing serialised `chat_transcript` JSON. */
function transcriptTurnsFromSheetColumnsChatScan_(columns) {
    if (!columns || typeof columns !== "object") {
        return [];
    }
    /** @type {{ role: string, text: string, at?: number }[]} */
    let best = [];
    for (const v of Object.values(columns)) {
        const arr = parseChatTranscriptJsonCell_(typeof v === "string" ? v : String(v || ""));
        if (!arr.length) {
            continue;
        }
        const turns = transcriptTurnsFromStoredChatArray_(arr);
        const nAsst = turns.filter((t) => t.role === "assistant").length;
        if (nAsst > 0 && turns.length >= best.length) {
            best = turns;
        }
    }
    return best;
}

function hasAssistantTurns_(turns) {
    return Array.isArray(turns) && turns.some((t) => t && t.role === "assistant");
}

/**
 * @param {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} t
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }}
 */
function cloneTranscriptTurnForMerge_(t) {
    let role = "user";
    if (t && typeof t === "object") {
        const raw = String(t.role != null ? t.role : "")
            .trim()
            .toLowerCase();
        if (raw === "agent" || raw === "staff") {
            role = "agent";
        } else {
            role = normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (t));
        }
    }
    const out = /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }} */ ({
        role,
        text: String(t && t.text != null ? t.text : "")
    });
    const rich = t && t.rich;
    if (rich && typeof rich === "object" && !Array.isArray(rich)) {
        out.rich = /** @type {Record<string, unknown>} */ (rich);
    }
    const atMs = coerceTranscriptAtMs_(t && t.at);
    if (typeof atMs === "number" && Number.isFinite(atMs)) {
        out.at = atMs;
    }
    const rawSeq = t && t.seq;
    const seqParsed =
        typeof rawSeq === "number" && Number.isFinite(rawSeq)
            ? rawSeq
            : typeof rawSeq === "string" && Number.isFinite(Number(String(rawSeq).trim()))
              ? Number(String(rawSeq).trim())
              : NaN;
    if (Number.isFinite(seqParsed)) {
        out.seq = seqParsed;
    }
    return out;
}

/**
 * Dedup within {@link mergeConversationTranscriptTurnSources_}: same role+text at different timestamps stay;
 * repeats without timestamps get a stable occurrence suffix. Turns with the same `at` but distinct `seq`
 * (multiple bot lines in one widget tick) stay separate.
 *
 * @param {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} t
 * @param {Map<string, number>} noAtDupCount
 */
function transcriptTurnMergeDedupeKey_(t, noAtDupCount) {
    if (!t || typeof t !== "object") {
        return "";
    }
    const role =
        t && typeof t === "object"
            ? normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (t))
            : "user";
    const text = String(/** @type {{ text?: unknown }} */ (t).text || "").trim();
    const rich = /** @type {{ rich?: unknown }} */ (t).rich;
    const richStem =
        rich && typeof rich === "object" && !Array.isArray(rich)
            ? `rich:${JSON.stringify(rich)}`
            : "";
    if (!text && !richStem) {
        return "";
    }
    const contentStem = text || richStem;
    const atMs = coerceTranscriptAtMs_(/** @type {{ at?: unknown }} */ (t).at);
    const rawSeq = /** @type {{ seq?: unknown }} */ (t).seq;
    const seqParsed =
        typeof rawSeq === "number" && Number.isFinite(rawSeq)
            ? rawSeq
            : typeof rawSeq === "string" && Number.isFinite(Number(String(rawSeq).trim()))
              ? Number(String(rawSeq).trim())
              : NaN;
    const seq = Number.isFinite(seqParsed) ? seqParsed : undefined;
    if (typeof atMs === "number" && Number.isFinite(atMs)) {
        return typeof seq === "number"
            ? `${role}|${contentStem}|${atMs}|seq${seq}`
            : `${role}|${contentStem}|${atMs}`;
    }
    const stem = `${role}|${contentStem}`;
    const next = (noAtDupCount.get(stem) || 0) + 1;
    noAtDupCount.set(stem, next);
    return `${stem}|#${next}`;
}

/**
 * Union-merge two transcript sources: timed turns ordered by `at`, then user lines without timestamps
 * (Firebase `user_queries` merge, Sheet CSV, etc.) in stream order so post-submit Sheet lines are not dropped
 * when Firestore froze at the last lead save.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} a
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} b
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]}
 */
function mergeConversationTranscriptTurnSources_(a, b) {
    const aa = Array.isArray(a) ? a.filter((t) => t && typeof t === "object") : [];
    const bb = Array.isArray(b) ? b.filter((t) => t && typeof t === "object") : [];
    if (!aa.length) {
        return bb.map((t) => cloneTranscriptTurnForMerge_(/** @type {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} */ (t)));
    }
    if (!bb.length) {
        return aa.map((t) => cloneTranscriptTurnForMerge_(/** @type {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} */ (t)));
    }

    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const noAtA = [];
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const noAtB = [];
    /** @type {{ turn: { role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }, ord: number }[]} */
    const withAt = [];
    let ord = 0;
    for (let i = 0; i < aa.length; i += 1) {
        const t = aa[i];
        const cloned = cloneTranscriptTurnForMerge_(/** @type {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} */ (t));
        const atMs = coerceTranscriptAtMs_(cloned.at);
        if (typeof atMs === "number" && Number.isFinite(atMs)) {
            cloned.at = atMs;
            withAt.push({ turn: cloned, ord: ord++ });
        } else {
            noAtA.push(cloned);
        }
    }
    for (let j = 0; j < bb.length; j += 1) {
        const t = bb[j];
        const cloned = cloneTranscriptTurnForMerge_(/** @type {{ role?: unknown, text?: unknown, rich?: unknown, at?: unknown, seq?: unknown }} */ (t));
        const atMs = coerceTranscriptAtMs_(cloned.at);
        if (typeof atMs === "number" && Number.isFinite(atMs)) {
            cloned.at = atMs;
            withAt.push({ turn: cloned, ord: ord++ });
        } else {
            noAtB.push(cloned);
        }
    }

    withAt.sort((x, y) => x.turn.at - y.turn.at || x.ord - y.ord);

    /** @type {Map<string, number>} */
    const noAtDupCount = new Map();
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {{ role: string, text: string, at?: number, seq?: number }[]} */
    const out = [];

    for (let k = 0; k < withAt.length; k += 1) {
        const turn = withAt[k].turn;
        const mergeOrd = withAt[k].ord;
        const atMs = typeof turn.at === "number" && Number.isFinite(turn.at) ? turn.at : undefined;
        const rawSeq = turn.seq;
        const seqParsed =
            typeof rawSeq === "number" && Number.isFinite(rawSeq)
                ? rawSeq
                : typeof rawSeq === "string" && Number.isFinite(Number(String(rawSeq).trim()))
                  ? Number(String(rawSeq).trim())
                  : NaN;
        const seq = Number.isFinite(seqParsed) ? seqParsed : undefined;
        const role = transcriptTurnRoleForMerge_(turn);
        const textTrim = String(turn.text || "").trim();
        /** Form confirms may repeat with new `seq`/`at`; other bot lines keep seq so fallback/menu turns stay distinct. */
        let sig;
        if (
            role === "assistant"
            && textTrim
            && isContactFormSubmissionSummaryAssistantText_(textTrim)
        ) {
            sig = `asstform|${transcriptAssistantCompareNorm_(textTrim)}`;
        } else {
            sig = transcriptTurnMergeDedupeKey_(turn, noAtDupCount);
        }
        if (!sig || seen.has(sig)) {
            continue;
        }
        seen.add(sig);
        out.push(cloneTranscriptTurnForMerge_(turn));
    }
    for (let u = 0; u < noAtA.length; u += 1) {
        const t = noAtA[u];
        const roleNoAt = transcriptTurnRoleForMerge_(t);
        const textNoAt = String(t.text || "").trim();
        const sig =
            roleNoAt === "assistant"
            && textNoAt
            && isContactFormSubmissionSummaryAssistantText_(textNoAt)
                ? `asstform|${transcriptAssistantCompareNorm_(textNoAt)}`
                : transcriptTurnMergeDedupeKey_(t, noAtDupCount);
        if (!sig || seen.has(sig)) {
            continue;
        }
        seen.add(sig);
        out.push(cloneTranscriptTurnForMerge_(t));
    }
    for (let v = 0; v < noAtB.length; v += 1) {
        const t = noAtB[v];
        const roleNoAtB = transcriptTurnRoleForMerge_(t);
        const textNoAtB = String(t.text || "").trim();
        const sig =
            roleNoAtB === "assistant"
            && textNoAtB
            && isContactFormSubmissionSummaryAssistantText_(textNoAtB)
                ? `asstform|${transcriptAssistantCompareNorm_(textNoAtB)}`
                : transcriptTurnMergeDedupeKey_(t, noAtDupCount);
        if (!sig || seen.has(sig)) {
            continue;
        }
        seen.add(sig);
        out.push(cloneTranscriptTurnForMerge_(t));
    }
    return out;
}

/** Normalizes free-text comparison for Firebase `user_queries` vs transcript user bubbles. */
function transcriptUserCompareNorm_(text) {
    return String(text ?? "").trim().replace(/\s+/g, " ");
}

function stripDialogflowActionPrefixForTranscript_(text) {
    return String(text ?? "")
        .trim()
        .replace(/^(?:query|event):/i, "")
        .trim();
}

/** Raw CX routing tokens (e.g. query:__GO_human agent__) — hide from staff chatscript. */
function isTranscriptHandoffRoutingToken_(text) {
    const raw = stripDialogflowActionPrefixForTranscript_(text);
    if (!raw) {
        return false;
    }
    if (/^__GO_/i.test(raw) && /human\s*agent/i.test(raw)) {
        return true;
    }
    const inner = raw.replace(/^__GO_/i, "").trim();
    return /^human\s*agent$/i.test(inner) || /^human\s*agent$/i.test(raw);
}

/** Skip internal Dialogflow action tokens in transcript user turns. */
function isTranscriptInternalUserToken_(text) {
    const t = stripDialogflowActionPrefixForTranscript_(text);
    if (!t) {
        return true;
    }
    if (isTranscriptCxInternalToken_(text)) {
        return true;
    }
    if (/^__GO_/i.test(t)) {
        return true;
    }
    const low = t.toLowerCase();
    return low === "upload" || low === "resend_otp";
}

/** Dialogflow/CX intent display names — hide from staff chatscript (fulfillment text remains). */
function isTranscriptIntentDisplayNoise_(text) {
    const t = String(text ?? "").trim();
    if (!t) {
        return false;
    }
    if (/^default\s+welcome\s+intent$/i.test(t)) {
        return true;
    }
    return /^.+\s+intent$/i.test(t) && t.length <= 96;
}

/** CX routing tokens and unresolved `$session.params.*` templates — hide from staff chatscript. */
function isTranscriptCxInternalToken_(text) {
    const raw = String(text ?? "").trim();
    if (!raw) {
        return true;
    }
    if (/^\$session\.params\.[a-z0-9_]+$/i.test(raw) || raw.includes("$session.params.")) {
        return true;
    }
    if (/^\$request\.[\w.]+\.[a-z0-9_]+$/i.test(raw) || /\$parameter\.\w+/i.test(raw)) {
        return true;
    }
    const stripped = stripDialogflowActionPrefixForTranscript_(raw);
    if (/^__GO_/i.test(stripped)) {
        return true;
    }
    return false;
}

/** CX chip / menu labels and bare emails — not standalone assistant transcript lines. */
function isTranscriptStandaloneChipOrMenuLabel_(text) {
    const t = String(text ?? "").trim();
    if (!t || t.includes("\n")) {
        return false;
    }
    if (/form closed/i.test(t)) {
        return false;
    }
    if (/^(human agent requested|connected with agent)$/i.test(t)) {
        return false;
    }
    if (/[?!]/.test(t) || /'\w/.test(t)) {
        return false;
    }
    if (/\.\s/.test(t) || (t.endsWith(".") && t.length > 20)) {
        return false;
    }
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length >= 4) {
        return false;
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(t)) {
        return true;
    }
    if (words.length <= 2 && t.length <= 36 && !/[,.]/.test(t)) {
        const nk = t.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (
            nk
            && /^(contact|feedback|appointment|upload|resend|otp|human|agent|book|booking|help|support|menu|services|location|hours|cancel|confirm|continue|back|home|chat|live|whatsapp)$/.test(
                nk
            )
        ) {
            return true;
        }
    }
    return false;
}

function shouldOmitTranscriptUserTurn_(text) {
    if (/^__form_closed:/i.test(String(text ?? "").trim())) {
        return false;
    }
    return (
        isTranscriptHandoffRoutingToken_(text)
        || isTranscriptInternalUserToken_(text)
        || isTranscriptLiveAgentSheetStatusLine_(text)
    );
}

/** Sheet1 queue snapshot (`[Live Agent] | Status: …`) — ops metadata, not visitor chat. */
function isTranscriptLiveAgentSheetStatusLine_(text) {
    const t = String(text ?? "").trim();
    if (!t) {
        return false;
    }
    if (/^\[Live Agent\]/i.test(t)) {
        return true;
    }
    if (/^human agent requested$/i.test(t)) {
        return true;
    }
    if (/^connected with agent$/i.test(t)) {
        return true;
    }
    return (
        /Status:\s*/i.test(t)
        && /Dept:/i.test(t)
        && (/Queue:/i.test(t) || /Agent:/i.test(t))
    );
}

/** Typing indicators — ephemeral UI, not conversation content. */
function isTranscriptEphemeralStatusText_(text) {
    const raw = String(text ?? "").trim();
    if (!raw) {
        return false;
    }
    return /^typing(\.{0,3})?$/i.test(raw);
}

/** `open_form` routing marker — staff see the form summary bubble, not «Form: contact». */
function isTranscriptOpenFormActionTurn_(turn) {
    if (!turn || typeof turn !== "object") {
        return false;
    }
    const role = String(turn.role || "")
        .trim()
        .toLowerCase();
    if (role !== "assistant") {
        return false;
    }
    let rich =
        turn.rich && typeof turn.rich === "object" && !Array.isArray(turn.rich)
            ? /** @type {Record<string, unknown>} */ (turn.rich)
            : null;
    if (!rich && typeof turn.rich_json === "string" && turn.rich_json.trim()) {
        try {
            const parsed = JSON.parse(turn.rich_json);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                rich = /** @type {Record<string, unknown>} */ (parsed);
            }
        } catch {
            /* ignore */
        }
    }
    const act =
        rich && typeof rich.action === "string" ? rich.action.trim().toLowerCase() : "";
    if (act !== "open_form") {
        return false;
    }
    const text = String(turn.text || "").trim();
    if (text && isContactFormSubmissionSummaryAssistantText_(text)) {
        return false;
    }
    if (!text || /^form\s*:/i.test(text)) {
        return true;
    }
    return true;
}

/** Invisible fingerprint on live-agent chat lines (must strip before transcript compare). */
const LIVE_AGENT_TRANSCRIPT_FINGERPRINT_RE_ = /\u2060\u200d\u2060|[\u200B-\u200D\uFEFF\u2060]/g;

/** @param {unknown} text */
function stripLiveAgentTranscriptFingerprint_(text) {
    return String(text ?? "").replace(LIVE_AGENT_TRANSCRIPT_FINGERPRINT_RE_, "").trim();
}

/** Agent lines are often stored as `Name: message` in live-agent inbox. */
function transcriptAgentBodyCompareNorm_(text) {
    const raw = stripLiveAgentTranscriptFingerprint_(text);
    if (!raw) {
        return "";
    }
    const stripped = raw.replace(/^[^:]{1,48}:\s+/, "").trim();
    return transcriptAssistantCompareNorm_(stripped || raw);
}

/**
 * @param {Set<string>} agentNorms
 * @param {unknown} text
 */
function registerAgentTranscriptMirrorNorms_(agentNorms, text) {
    const stripped = stripLiveAgentTranscriptFingerprint_(text);
    if (!stripped) {
        return;
    }
    agentNorms.add(transcriptAssistantCompareNorm_(stripped));
    const bodyNorm = transcriptAgentBodyCompareNorm_(stripped);
    if (bodyNorm) {
        agentNorms.add(bodyNorm);
    }
    const lower = stripped.toLowerCase();
    const copilotIdx = lower.indexOf("ai assistant is replying");
    if (copilotIdx >= 0) {
        agentNorms.add(transcriptAssistantCompareNorm_(stripped.slice(copilotIdx)));
    }
}

/**
 * @param {unknown} assistantText
 * @param {Set<string>} agentNorms
 */
function assistantTextMirrorsAgentTranscript_(assistantText, agentNorms) {
    if (!agentNorms.size) {
        return false;
    }
    const stripped = stripLiveAgentTranscriptFingerprint_(assistantText);
    if (!stripped) {
        return false;
    }
    const norm = transcriptAssistantCompareNorm_(stripped);
    if (norm && agentNorms.has(norm)) {
        return true;
    }
    if (!norm || norm.length < 10) {
        return false;
    }
    for (const agentNorm of agentNorms) {
        if (!agentNorm || agentNorm.length < 10) {
            continue;
        }
        if (agentNorm.includes(norm) || norm.includes(agentNorm)) {
            return true;
        }
    }
    return false;
}

/** @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns */
function buildAgentTranscriptMirrorNormSet_(turns) {
    /** @type {Set<string>} */
    const agentNorms = new Set();
    if (!Array.isArray(turns)) {
        return agentNorms;
    }
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (t && t.role === "agent") {
            registerAgentTranscriptMirrorNorms_(agentNorms, t.text);
        }
    }
    return agentNorms;
}

/** Bot/user persona label + clock rows — not staff conversation content. */
function isTranscriptPersonaChromeText_(text) {
    const raw = String(text ?? "").trim();
    if (!raw) {
        return true;
    }
    if (/dfchat-(bot|user|live-agent)-persona-label/i.test(raw)) {
        return true;
    }
    if (/!\[[^\]]*\]\([^)]*#dfchat-bot-persona/i.test(raw)) {
        return true;
    }
    if (/!\[[^\]]*\]\([^)]*data:image\/svg\+xml/i.test(raw) && /persona/i.test(raw)) {
        return true;
    }
    const stripped = raw
        .replace(/<[^>]+>/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) {
        return true;
    }
    if (/^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(stripped)) {
        return true;
    }
    if (
        stripped.length <= 48
        && /\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?/i.test(stripped)
    ) {
        const withoutTime = stripped
            .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?/gi, "")
            .trim();
        if (withoutTime.length > 0 && withoutTime.length <= 24 && !/[.!?]/.test(withoutTime)) {
            return true;
        }
    }
    return false;
}

/**
 * Live-agent chat renders in the bot lane; DOM scrape can duplicate inbox rows as `assistant`.
 * When an agent turn exists for the same body, drop the assistant mirror.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 */
function collapseLiveAgentAssistantMirrors_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    const agentNorms = buildAgentTranscriptMirrorNormSet_(turns);
    if (!agentNorms.size) {
        return turns.slice();
    }
    return turns.filter((t) => {
        if (!t || t.role !== "assistant") {
            return true;
        }
        return !assistantTextMirrorsAgentTranscript_(t.text, agentNorms);
    });
}

/** Widget form bubbles use `  \\n` between rows; flatten before comparing assistant duplicates. */
function transcriptAssistantCompareNorm_(text) {
    return stripLiveAgentTranscriptFingerprint_(text)
        .replace(/\s{2,}\n/g, " ")
        .replace(/\r\n/g, "\n")
        .replace(/\n+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

/** @param {unknown} text */
function dedupeTranscriptDisplayText_(text) {
    const t = String(text ?? "").trim();
    if (!t) {
        return "";
    }
    const lines = t.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);
    if (lines.length < 2) {
        return t;
    }
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i += 1) {
        const ln = lines[i];
        const norm = transcriptAssistantCompareNorm_(ln);
        if (!norm || seen.has(norm)) {
            continue;
        }
        seen.add(norm);
        out.push(ln);
    }
    return out.join("\n");
}

/**
 * Contact form submission summary (widget `join("  \\n")` or server «Form submission» block).
 *
 * @param {unknown} text
 * @returns {boolean}
 */
function isContactFormSubmissionSummaryAssistantText_(text) {
    const tx = String(text ?? "").trim();
    if (!tx) {
        return false;
    }
    if (/^Form submission\b/im.test(tx)) {
        return true;
    }
    /** Client `company.js`: `lines.join("  \\n")` — multiple `Label - value` rows; require ≥2 rows so normal bot markdown is not mistaken for a form summary */
    const parts = tx.split("  \n").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => /\s-\s/.test(p))) {
        return true;
    }
    /** Single-bubble form confirm (`Name - … Thank you for sharing.`). */
    if (/thank you for sharing\.?$/i.test(tx)) {
        const dashPairs = tx.match(/\s-\s/g);
        return !!(dashPairs && dashPairs.length >= 2);
    }
    return false;
}

/** @param {unknown} text */
function isCampaignParamsAssistantText_(text) {
    return /^Campaign parameters\b/im.test(String(text ?? "").trim());
}

/** @param {unknown} text */
function isCrmIntegrationAssistantText_(text) {
    return /^CRM integration\b/im.test(String(text ?? "").trim());
}

/**
 * @param {unknown} clientContext
 * @returns {{ role: string, text: string, at: number }[]}
 */
function syntheticCampaignParamsAssistantTurnsFromContext_(clientContext) {
    const body = formatCampaignParamsForTranscript_(clientContext);
    if (!body.trim()) {
        return [];
    }
    return [{ role: "assistant", text: body, at: Date.now() }];
}

/**
 * @param {unknown} clientContext
 * @returns {{ role: string, text: string, at: number }[]}
 */
function syntheticCrmExchangeAssistantTurnsFromContext_(clientContext) {
    const body = formatCrmExchangeForTranscript_(clientContext);
    if (!body.trim()) {
        return [];
    }
    return [{ role: "assistant", text: body, at: Date.now() }];
}

/**
 * @param {Record<string, unknown>} cx
 */
function mergeCampaignParamsIntoClientContextRecord_(cx) {
    const src =
        typeof cx.source_url === "string"
            ? cx.source_url.trim()
            : typeof cx.page_url === "string"
              ? cx.page_url.trim()
              : "";
    const fromUrl = extractCampaignParamsFromUrl(src);
    if (!Object.keys(fromUrl).length) {
        return cx;
    }
    const sp =
        cx.session_params && typeof cx.session_params === "object" && !Array.isArray(cx.session_params)
            ? /** @type {Record<string, unknown>} */ ({ ...cx.session_params })
            : {};
    const nextSp = mergeCampaignParamsIntoSessionParams(sp, fromUrl);
    return { ...cx, session_params: nextSp, campaign_params: nextSp.campaign_params };
}

/**
 * Collapse duplicate form confirmations and back-to-back identical assistant bubbles (not unrelated repeats).
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]}
 */
/**
 * Plain assistant line right after a rich bubble that only repeats chip/button labels.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 */
/**
 * Drop back-to-back identical assistant bubbles (same stored text and/or rich JSON).
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 */
function collapseIdenticalAssistantTranscriptTurns_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    /** @type {typeof turns} */
    const out = [];
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (!t || t.role !== "assistant") {
            out.push(t);
            continue;
        }
        const prev = out.length ? out[out.length - 1] : null;
        if (prev && prev.role === "assistant") {
            const tA = transcriptAssistantCompareNorm_(prev.text || "");
            const tB = transcriptAssistantCompareNorm_(t.text || "");
            const rA = prev.rich ? JSON.stringify(prev.rich) : "";
            const rB = t.rich ? JSON.stringify(t.rich) : "";
            if ((tA && tA === tB) || (!tA && !tB && rA && rA === rB)) {
                if (t.rich && !prev.rich) {
                    prev.rich = t.rich;
                }
                continue;
            }
        }
        out.push(t);
    }
    return out;
}

function collapseRedundantAssistantTranscriptTurns_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const out = [];
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (!t || typeof t !== "object") {
            continue;
        }
        const prev = out.length ? out[out.length - 1] : null;
        if (
            prev
            && prev.role === "assistant"
            && t.role === "assistant"
            && prev.rich
            && !t.rich
        ) {
            const plain = String(t.text || "").trim();
            const fromRich = transcriptTextFromStoredRich_(prev.rich);
            if (plain && fromRich) {
                const pN = transcriptAssistantCompareNorm_(plain);
                const rN = transcriptAssistantCompareNorm_(fromRich);
                if (pN === rN || (rN.length > 8 && (rN.includes(pN) || pN.includes(rN)))) {
                    continue;
                }
            }
        }
        out.push(t);
    }
    return out;
}

function dedupeTranscriptTurnsForDisplay_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    /** @type {Set<string>} */
    const seenFormSummary = new Set();
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const out = [];
    let prevAssistantNorm = "";
    let prevUserNorm = "";
    let prevAgentNorm = "";
    /** @type {Set<string>} */
    const seenHandoffUserNorm = new Set();
    const agentMirrorNorms = buildAgentTranscriptMirrorNormSet_(turns);
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (!t || typeof t !== "object") {
            continue;
        }
        const role =
            t && typeof t === "object"
                ? normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (t))
                : "user";
        const text = String(t.text || "").trim();
        const rich =
            t.rich && typeof t.rich === "object" && !Array.isArray(t.rich)
                ? /** @type {Record<string, unknown>} */ (t.rich)
                : undefined;
        if (!text && !rich) {
            continue;
        }
        if (text && isTranscriptEphemeralStatusText_(text)) {
            continue;
        }
        if (text && isTranscriptCxInternalToken_(text)) {
            continue;
        }
        if (role === "assistant" && text && !rich && isTranscriptIntentDisplayNoise_(text)) {
            continue;
        }
        if (role === "assistant" && text && !rich && isTranscriptStandaloneChipOrMenuLabel_(text)) {
            continue;
        }
        if (isTranscriptOpenFormActionTurn_(t)) {
            continue;
        }
        if (role === "assistant") {
            const key = text
                ? transcriptAssistantCompareNorm_(text)
                : rich
                  ? `rich:${JSON.stringify(rich)}`
                  : "";
            if (assistantTextMirrorsAgentTranscript_(text, agentMirrorNorms)) {
                continue;
            }
            if (text && isTranscriptPersonaChromeText_(text)) {
                continue;
            }
            if (text && isContactFormSubmissionSummaryAssistantText_(text)) {
                if (seenFormSummary.has(key)) {
                    continue;
                }
                seenFormSummary.add(key);
            } else if (key && key === prevAssistantNorm) {
                continue;
            }
            prevAssistantNorm = key;
        } else if (role === "user") {
            prevAssistantNorm = "";
            if (shouldOmitTranscriptUserTurn_(text)) {
                continue;
            }
            const userNorm = transcriptUserCompareNorm_(text);
            if (userNorm && isTranscriptHandoffRoutingToken_(text)) {
                if (seenHandoffUserNorm.has(userNorm)) {
                    continue;
                }
                seenHandoffUserNorm.add(userNorm);
            }
            if (userNorm && userNorm === prevUserNorm) {
                continue;
            }
            prevUserNorm = userNorm;
        } else if (role === "agent") {
            prevAssistantNorm = "";
            prevUserNorm = "";
            const agentNorm = transcriptAgentBodyCompareNorm_(text) || transcriptAssistantCompareNorm_(text);
            if (agentNorm && agentNorm === prevAgentNorm) {
                continue;
            }
            prevAgentNorm = agentNorm;
        } else {
            prevAssistantNorm = "";
            prevUserNorm = "";
            prevAgentNorm = "";
        }
        const row = /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }} */ ({
            role,
            text: text || (role === "assistant" ? "(Bot message)" : "")
        });
        if (rich) {
            row.rich = rich;
        }
        if (typeof t.at === "number" && Number.isFinite(t.at)) {
            row.at = t.at;
        }
        if (typeof t.seq === "number" && Number.isFinite(t.seq)) {
            row.seq = t.seq;
        }
        out.push(row);
    }
    return out;
}

/**
 * Final ordering for staff JSON: widget `seq` first (capture order), then wall time (`at`), then merge order.
 * Live-agent inbox rows usually lack `seq` and fall through to `at` so they interleave with bot-phase lines.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]}
 */
function orderTranscriptTurnsForDisplay_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    const tagged = turns.map((t, i) => ({ t, i }));
    tagged.sort((a, b) => {
        const seqA = typeof a.t.seq === "number" && Number.isFinite(a.t.seq) ? a.t.seq : NaN;
        const seqB = typeof b.t.seq === "number" && Number.isFinite(b.t.seq) ? b.t.seq : NaN;
        if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) {
            return seqA - seqB;
        }
        const atA = typeof a.t.at === "number" && Number.isFinite(a.t.at) ? a.t.at : null;
        const atB = typeof b.t.at === "number" && Number.isFinite(b.t.at) ? b.t.at : null;
        if (atA !== null && atB !== null && atA !== atB) {
            return atA - atB;
        }
        if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) {
            return seqA - seqB;
        }
        if (atA !== null && atB === null) {
            return -1;
        }
        if (atA === null && atB !== null) {
            return 1;
        }
        return a.i - b.i;
    });
    return tagged.map(({ t }) => {
        const out = /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }} */ ({
            role: t.role,
            text: t.text
        });
        if (t.rich && typeof t.rich === "object") {
            out.rich = /** @type {Record<string, unknown>} */ (t.rich);
        }
        if (t.at !== undefined) {
            out.at = t.at;
        }
        if (typeof t.seq === "number" && Number.isFinite(t.seq)) {
            out.seq = t.seq;
        }
        return out;
    });
}

/**
 * Staff transcript from widget/Firestore `client_context`: merge stored `chat_transcript` with `user_queries`.
 * After submit, the merge pipeline can persist only an assistant «Form submission…» row while `user_queries`
 * still holds the visitor turns; reading transcript alone then hides the chat.
 *
 * @param {Record<string, unknown>} cx
 * @returns {{ role: string, text: string, at?: number }[]}
 */
/**
 * Plain assistant lines stored beside `chat_transcript` when CX payloads are hard to serialize.
 *
 * @param {Record<string, unknown>} cx
 * @returns {{ role: string, text: string }[]}
 */
/**
 * Last-resort: keep rows the widget tagged as assistant even when text/rich extraction fails.
 *
 * @param {unknown[]} arr
 * @returns {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]}
 */
function transcriptTurnsLenientRecoveryFromRawChat_(arr) {
    if (!Array.isArray(arr) || !arr.length) {
        return [];
    }
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const out = [];
    for (const item of arr) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const o = /** @type {Record<string, unknown>} */ (item);
        const roleRaw = String(o.role ?? o.type ?? "").trim().toLowerCase();
        const explicitAssistant =
            roleRaw === "assistant"
            || roleRaw === "bot"
            || roleRaw === "agent"
            || roleRaw === "virtual_agent";
        const role = normalizeTranscriptItemRole_(o);
        if (!explicitAssistant && role !== "assistant") {
            continue;
        }
        const rich = transcriptTurnRichFromItem_(o);
        let text = transcriptTurnTextFromItem_(o);
        if (rich && transcriptTextLooksLikeScrapedRichNoise_(text)) {
            text = "";
        }
        if (!text && rich) {
            text = transcriptTextFromStoredRich_(rich);
        }
        if (!text) {
            text = "(Bot message)";
        }
        const atMs = coerceTranscriptAtMs_(o.at);
        const rawSeq = o.seq;
        const seqParsed =
            typeof rawSeq === "number" && Number.isFinite(rawSeq)
                ? rawSeq
                : typeof rawSeq === "string" && Number.isFinite(Number(rawSeq.trim()))
                  ? Number(rawSeq.trim())
                  : NaN;
        const row = /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }} */ ({
            role: "assistant",
            text
        });
        if (rich && typeof rich === "object") {
            row.rich = rich;
        }
        if (typeof atMs === "number" && Number.isFinite(atMs)) {
            row.at = atMs;
        }
        if (Number.isFinite(seqParsed)) {
            row.seq = seqParsed;
        }
        out.push(row);
    }
    return out;
}

function assistantTurnsFromAssistantQueries_(cx) {
    const aqSrc = cx.assistant_queries;
    const aqList =
        Array.isArray(aqSrc)
            ? aqSrc
                  .filter((x) => typeof x === "string" && x.trim())
                  .map((x) => String(x).trim())
            : [];
    if (!aqList.length) {
        return [];
    }
    return aqList.map((text) => ({ role: "assistant", text }));
}

function transcriptTurnsFromClientContext_(cx) {
    if (!cx || typeof cx !== "object") {
        return [];
    }
    const rawChat = coerceChatTranscriptArray_(cx.chat_transcript);
    let base = rawChat.length ? transcriptTurnsFromStoredChatArray_(rawChat) : [];

    const fromAssistantQueries = assistantTurnsFromAssistantQueries_(cx);
    if (fromAssistantQueries.length) {
        const existingAssistantNorm = new Set(
            base
                .filter((t) => t.role === "assistant")
                .map((t) => transcriptAssistantCompareNorm_(t.text || ""))
        );
        const extra = fromAssistantQueries.filter((t) => {
            const norm = transcriptAssistantCompareNorm_(t.text);
            return norm && !existingAssistantNorm.has(norm);
        });
        if (extra.length) {
            base = mergeConversationTranscriptTurnSources_(base, extra);
        }
    }

    const uqSrc = cx.user_queries;
    const uqList =
        Array.isArray(uqSrc)
            ? uqSrc
                  .filter((x) => typeof x === "string" && x.trim())
                  .map((x) => String(x).trim())
                  .filter((x) => !shouldOmitTranscriptUserTurn_(x))
            : [];
    const baseAt =
        typeof cx.user_queries_last_at === "number" && Number.isFinite(cx.user_queries_last_at)
            ? cx.user_queries_last_at
            : Date.now();

    if (!base.length) {
        if (!uqList.length) {
            return [];
        }
        return uqList.map((text) => ({ role: "user", text }));
    }

    const missingUsers = missingUserTurnsFromQueryLines_(base, uqList, baseAt);
    if (!missingUsers.length) {
        return base;
    }

    const hadUserTurn = base.some((t) => t.role === "user");
    if (!hadUserTurn) {
        return orderTranscriptTurnsForDisplay_(mergeConversationTranscriptTurnSources_(base, missingUsers));
    }

    /** Server-side form merge uses «Form submission…» assistant text (see mergeLeadFormAssistantIntoClientContextIfMissing_). */
    let formAssistantIdx = -1;
    for (let j = base.length - 1; j >= 0; j--) {
        if (base[j].role !== "assistant") {
            continue;
        }
        const tx = String(base[j].text || "").trim();
        if (isContactFormSubmissionSummaryAssistantText_(tx)) {
            formAssistantIdx = j;
            break;
        }
    }
    if (formAssistantIdx >= 0) {
        return [...base.slice(0, formAssistantIdx), ...missingUsers, ...base.slice(formAssistantIdx)];
    }

    return orderTranscriptTurnsForDisplay_(mergeConversationTranscriptTurnSources_(base, missingUsers));
}

/** @param {Record<string, unknown>} ctx */
function userTurnsFromContextUserQueries_(ctx) {
    if (!ctx || typeof ctx !== "object") {
        return [];
    }
    const uq = Array.isArray(ctx.user_queries) ? ctx.user_queries : [];
    /** @type {string[]} */
    const lines = [];
    for (let i = 0; i < uq.length; i += 1) {
        const cell = typeof uq[i] === "string" ? uq[i].trim() : "";
        if (cell) {
            lines.push(cell);
        }
    }
    if (!lines.length) {
        return [];
    }
    const baseAt =
        typeof ctx.user_queries_last_at === "number" && Number.isFinite(ctx.user_queries_last_at)
            ? ctx.user_queries_last_at
            : Date.now();
    return missingUserTurnsFromQueryLines_([], lines, baseAt);
}

/**
 * Union user_queries from lead + live session context into transcript turns (bot lines alone hide visitor chat).
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @param {Array<Record<string, unknown> | null | undefined>} contexts
 */
function augmentTranscriptWithMissingUserQueries_(turns, contexts) {
    const base = Array.isArray(turns) ? turns.slice() : [];
    /** @type {string[]} */
    const allLines = [];
    let atBase = Date.now();
    const list = Array.isArray(contexts) ? contexts : [];
    for (let c = 0; c < list.length; c += 1) {
        const ctx = list[c];
        if (!ctx || typeof ctx !== "object") {
            continue;
        }
        const uq = Array.isArray(ctx.user_queries) ? ctx.user_queries : [];
        for (let i = 0; i < uq.length; i += 1) {
            const cell = typeof uq[i] === "string" ? uq[i].trim() : "";
            if (cell) {
                allLines.push(cell);
            }
        }
        if (
            typeof ctx.user_queries_last_at === "number"
            && Number.isFinite(ctx.user_queries_last_at)
        ) {
            atBase = Math.max(atBase, ctx.user_queries_last_at);
        }
    }
    if (!allLines.length) {
        return base;
    }
    const extra = missingUserTurnsFromQueryLines_(base, allLines, atBase);
    if (!extra.length) {
        return base;
    }
    return orderTranscriptTurnsForDisplay_(mergeConversationTranscriptTurnSources_(base, extra));
}

/** Staff-facing form label for open_form transcript rows (mirrors widget `staffFormLabelForKey_`). */
function transcriptStaffFormLabelForKey_(formKey) {
    const key = typeof formKey === "string" ? formKey.trim() : "";
    if (!key || key === "default") {
        return "contact";
    }
    if (key === "uploadDocument") {
        return "upload";
    }
    if (key === "nearestBranch") {
        return "nearest-branch";
    }
    if (key === "appintmentformgeneral") {
        return "general-appointment";
    }
    if (key === "appintmentformdoctor") {
        return "doctor-appointment";
    }
    if (key === "birthform") {
        return "birth";
    }
    return key;
}

/** Replace legacy "(Bot response)" placeholders when the stored rich payload was an open_form action. */
function polishTranscriptAssistantPlaceholderTurn_(turn) {
    if (!turn || typeof turn !== "object") {
        return turn;
    }
    const role = normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (turn));
    if (role !== "assistant") {
        return turn;
    }
    const text = String(turn.text || "").trim();
    if (text !== "(Bot response)" && text !== "(Bot message)") {
        return turn;
    }
    let rich =
        turn.rich && typeof turn.rich === "object" && !Array.isArray(turn.rich)
            ? /** @type {Record<string, unknown>} */ (turn.rich)
            : null;
    if (!rich && typeof turn.rich_json === "string" && turn.rich_json.trim()) {
        try {
            const parsed = JSON.parse(turn.rich_json);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                rich = /** @type {Record<string, unknown>} */ (parsed);
            }
        } catch {
            /* ignore */
        }
    }
    const act =
        rich && typeof rich.action === "string" ? rich.action.trim().toLowerCase() : "";
    if (act !== "open_form") {
        return turn;
    }
    const fid =
        (typeof rich.form_key === "string" && rich.form_key.trim())
        || (typeof rich.formKey === "string" && rich.formKey.trim())
        || (typeof rich.form_id === "string" && rich.form_id.trim())
        || (typeof rich.formId === "string" && rich.formId.trim())
        || "contact";
    return { ...turn, role: "assistant", text: `Form: ${transcriptStaffFormLabelForKey_(fid)}` };
}

/** @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns */
function polishTranscriptAssistantPlaceholderTurns_(turns) {
    if (!Array.isArray(turns) || !turns.length) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    return turns.map((t) => polishTranscriptAssistantPlaceholderTurn_(t));
}

/** Max transcript items kept in sync with widget (`company.js` MAX_CHAT_TRANSCRIPT_TURNS). */
const CHAT_TRANSCRIPT_WIDGET_CAP = 120;

/** @param {string} key */
function prettyTranscriptFieldLabel_(key) {
    const s = typeof key === "string" ? key.trim() : "";
    if (!s) {
        return "";
    }
    const words = s
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
        .split(/\s+/);
    return words.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Lowercased `fields` keys skipped in «Form submission» assistant text (met redundant with chat). */
const CONTACT_FORM_TRANSCRIPT_SKIP_FIELD_KEYS_LOWER_ = new Set([
    "form_id",
    "submitted_at",
    "generalappointmentslotminutes",
    "dial_code",
    "dialcode"
]);

function normalizeTranscriptDialCode_(value) {
    const digits = scalarFormValue(value).replace(/\D/g, "");
    return digits ? `+${digits}` : "";
}

function formatTranscriptMobileWithDialCode_(mobileValue, fields, opt) {
    const mobile = scalarFormValue(mobileValue);
    if (!mobile || mobile.startsWith("+")) {
        return mobile;
    }
    const src = fields && typeof fields === "object" ? fields : {};
    const fallback = opt && typeof opt === "object" ? opt : {};
    const dialCode = normalizeTranscriptDialCode_(
        src.dial_code ?? src.dialCode ?? src.dialcode ?? src.country_dial_code ?? src.countryDialCode
        ?? fallback.dial_code ?? fallback.dialCode ?? fallback.country_dial_code ?? fallback.countryDialCode
    );
    if (!dialCode) {
        return mobile;
    }
    const dialDigits = dialCode.replace(/\D/g, "");
    const mobileDigits = mobile.replace(/\D/g, "");
    if (dialDigits && mobileDigits.startsWith(dialDigits) && mobileDigits.length > dialDigits.length) {
        return `${dialCode} ${mobileDigits.slice(dialDigits.length)}`;
    }
    return `${dialCode} ${mobile}`;
}

/**
 * One assistant bubble built from saved lead fields (not Dialogflow wording).
 *
 * @param {{ name?: unknown, email?: unknown, mobile?: unknown, dial_code?: unknown, dialCode?: unknown, country_dial_code?: unknown, countryDialCode?: unknown, form_id?: unknown, submitted_at?: unknown, fields?: Record<string, unknown> }} opt
 */
function buildContactLeadSummaryTextForTranscript_(opt) {
    const o = opt && typeof opt === "object" ? opt : {};
    const fields =
        o.fields && typeof o.fields === "object"
            ? /** @type {Record<string, unknown>} */ (o.fields)
            : {};
    /** @type {string[]} */
    const lines = [];
    const pushLine = (label, val) => {
        const s =
            typeof val === "string"
                ? val.trim()
                : val != null && typeof val !== "object"
                  ? String(val).trim()
                  : "";
        if (s) {
            lines.push(`${label}: ${s}`);
        }
    };
    pushLine("Name", o.name);
    pushLine("Mobile", formatTranscriptMobileWithDialCode_(o.mobile, fields, o));
    pushLine("Email", o.email);
    const used = new Set(["name", "email", "mobile"]);
    for (const [k, val] of Object.entries(fields)) {
        const keyLower = typeof k === "string" ? k.trim().toLowerCase() : "";
        if (!keyLower || used.has(keyLower) || CONTACT_FORM_TRANSCRIPT_SKIP_FIELD_KEYS_LOWER_.has(keyLower)) {
            continue;
        }
        const sv = scalarFormValue(val);
        if (!sv) {
            continue;
        }
        used.add(keyLower);
        lines.push(`${prettyTranscriptFieldLabel_(k)}: ${sv}`);
    }
    if (!lines.length) {
        return "";
    }
    return `Form submission\n\n${lines.join("\n")}`;
}

/**
 * Guarantees at least one assistant turn from submitted fields when the widget omitted `chat_transcript` assistant rows.
 *
 * @param {Record<string, unknown>} cx merged client_context (mutated)
 * @param {string} summaryText
 */
function mergeLeadFormAssistantIntoClientContextIfMissing_(cx, summaryText) {
    const text = typeof summaryText === "string" ? summaryText.trim() : "";
    if (!text || !cx || typeof cx !== "object") {
        return;
    }
    const prev = Array.isArray(cx.chat_transcript) ? cx.chat_transcript : [];
    /** @type {unknown[]} */
    const arr = prev.slice();
    if (
        arr.some(
            (it) =>
                it != null && typeof it === "object"
                && normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (it)) === "assistant"
        )
    ) {
        return;
    }
    let maxSeq = 0;
    for (const it of arr) {
        if (!it || typeof it !== "object") {
            continue;
        }
        const q = /** @type {{ seq?: unknown }} */ (it).seq;
        if (typeof q === "number" && Number.isFinite(q)) {
            maxSeq = Math.max(maxSeq, q);
        }
    }
    const nextSeq = maxSeq + 1;
    arr.push({ role: "assistant", text, at: Date.now(), seq: nextSeq });
    cx.chat_transcript = arr.slice(-CHAT_TRANSCRIPT_WIDGET_CAP);
    cx.chat_transcript_seq = nextSeq;
}

/** @param {unknown} v */
function submittedAtEpochMs_(v) {
    if (typeof v === "number" && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === "string" && v.trim()) {
        const t = Date.parse(v.trim());
        if (Number.isFinite(t)) {
            return t;
        }
    }
    return undefined;
}

/** @param {Record<string, unknown> | null} rec */
function syntheticFormSubmissionAssistantTurnsFromLead_(rec) {
    if (!rec || typeof rec !== "object") {
        return [];
    }
    const fields =
        rec.fields && typeof rec.fields === "object"
            ? /** @type {Record<string, unknown>} */ (rec.fields)
            : {};
    const body = buildContactLeadSummaryTextForTranscript_({
        name: rec.name,
        email: rec.email,
        mobile: rec.mobile,
        form_id: rec.form_id,
        submitted_at: rec.submitted_at,
        fields
    });
    if (!body.trim()) {
        return [];
    }
    const atMs = submittedAtEpochMs_(rec.submitted_at);
    /** @type {{ role: string, text: string, at?: number }} */
    const row = { role: "assistant", text: body };
    if (atMs !== undefined) {
        row.at = atMs;
    }
    return [row];
}

/** `company.js`-style persona clock on the transcript page (`messageTimeIncludesDate`). */
function transcriptTimeIncludesDateFromEnv_() {
    const raw = process.env.CONVERSATIONS_TRANSCRIPT_TIME_INCLUDES_DATE;
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return false;
    }
    const s = String(raw).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
}

/** Sheet column header → semantic id for transcript summary patching. */
function canonicalLeadFieldKeyForTranscript_(rawKey) {
    const k = String(rawKey || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const kn = k.replace(/\s/g, "");
    if (k === "name") {
        return "name";
    }
    if (k === "email") {
        return "email";
    }
    if (k === "mobile" || k === "phone") {
        return "mobile";
    }
    if (k === "user queries" || k === "userqueries") {
        return "user_queries";
    }
    if (k === "device" || k === "device type" || kn === "devicetype") {
        return "device";
    }
    if (k === "channel") {
        return "channel";
    }
    if (k === "browser" || k === "browser name" || kn === "browsername") {
        return "browser";
    }
    if (k === "conv. date" || k === "conv date" || k === "conversation date" || kn === "conversationdate") {
        return "conv_date";
    }
    if (k === "conv. time" || k === "conv time" || k === "conversation time" || kn === "conversationtime") {
        return "conv_time";
    }
    return null;
}

/** Dial + local context for chatscript Summary phone (Sheet uses same `91 9876543210` shape). */
function transcriptSummaryDialContext_(firestoreRec, liveCx) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const absorb = (cx) => {
        if (!cx || typeof cx !== "object" || Array.isArray(cx)) {
            return;
        }
        Object.assign(out, contactContextLookupRecord_(/** @type {Record<string, unknown>} */ (cx)));
    };
    if (
        firestoreRec
        && typeof firestoreRec === "object"
        && firestoreRec.client_context
        && typeof firestoreRec.client_context === "object"
    ) {
        absorb(firestoreRec.client_context);
    }
    absorb(liveCx);
    const fields =
        firestoreRec
        && typeof firestoreRec === "object"
        && firestoreRec.fields
        && typeof firestoreRec.fields === "object"
            ? /** @type {Record<string, unknown>} */ (firestoreRec.fields)
            : null;
    if (fields) {
        for (const [k, val] of Object.entries(fields)) {
            const nk = String(k || "").trim().toLowerCase();
            if (nk === "dial_code" || nk === "dialcode" || nk === "country_dial_code") {
                const s = scalarFormValue(val);
                if (s) {
                    out.dial_code = s;
                }
            }
        }
    }
    return out;
}

/**
 * @param {Record<string, unknown>} meta
 * @param {Record<string, unknown> | null} firestoreRec
 * @param {Record<string, unknown> | null} liveCx
 * @param {{ rowNumber?: number, columns?: Record<string, string> } | null} sheet
 */
function applyTranscriptSummaryMobileWithDialCode_(meta, firestoreRec, liveCx, sheet) {
    const base = meta && typeof meta === "object" ? { ...meta } : {};
    let mobileRaw = scalarFormValue(base.mobile);
    if (!mobileRaw && sheet && sheet.columns && typeof sheet.columns === "object") {
        for (const [colKey, colVal] of Object.entries(sheet.columns)) {
            if (canonicalLeadFieldKeyForTranscript_(colKey) === "mobile") {
                mobileRaw = scalarFormValue(colVal);
                break;
            }
        }
    }
    if (!mobileRaw) {
        return base;
    }
    const dialCtx = transcriptSummaryDialContext_(firestoreRec, liveCx);
    const formatted = formatMobileForSheetDisplay(mobileRaw, dialCtx);
    if (!formatted) {
        return base;
    }
    base.mobile = formatted;
    const dialDigits = scalarFormValue(
        dialCtx.dial_code ?? dialCtx.dialCode ?? dialCtx.country_dial_code
    ).replace(/\D/g, "");
    if (dialDigits) {
        base.dial_code = dialDigits;
    }
    if (sheet && sheet.columns && typeof sheet.columns === "object") {
        for (const colKey of Object.keys(sheet.columns)) {
            if (canonicalLeadFieldKeyForTranscript_(colKey) === "mobile") {
                sheet.columns[colKey] = formatted;
            }
        }
    }
    return base;
}

/** @param {string} csv */
function userQueryLinesFromCsv_(csv) {
    const s = typeof csv === "string" ? csv.trim() : "";
    if (!s) {
        return [];
    }
    const bits = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (!bits.length) {
        return [];
    }
    return bits.filter((text) => !isTranscriptLiveAgentSheetStatusLine_(text));
}

/** @param {string} csv */
function userTurnsFromSheetQueriesCsv_(csv) {
    const kept = userQueryLinesFromCsv_(csv);
    if (!kept.length) {
        return [];
    }
    if (kept.length === 1) {
        return [{ role: "user", text: kept[0] }];
    }
    return kept.map((text) => ({ role: "user", text }));
}

/**
 * Estimate `seq` / `at` for a user line rebuilt from Sheet CSV when Firestore lacks widget user rows.
 * Maps user index k to the bot response it precedes (multiple user lines can share the same bot slot).
 *
 * @param {number} userIndex
 * @param {{ role: string, text: string, at?: number, seq?: number }[]} assistants
 * @param {number} baseAt
 */
function seqAtForUserQuerySlot_(userIndex, assistants, baseAt) {
    const ai =
        assistants.length > 0 ? Math.min(userIndex, assistants.length - 1) : -1;
    if (ai < 0) {
        return { seq: 2 * userIndex + 1, at: baseAt - (userIndex + 1) * 1500 };
    }
    const bot = assistants[ai];
    const prevBot = ai > 0 ? assistants[ai - 1] : null;
    let sameTarget = 0;
    let myIndexAmongSame = 0;
    for (let j = 0; j <= userIndex; j += 1) {
        const targetAi =
            assistants.length > 0 ? Math.min(j, assistants.length - 1) : -1;
        if (targetAi === ai) {
            if (j === userIndex) {
                myIndexAmongSame = sameTarget;
            }
            sameTarget += 1;
        }
    }
    const hiSeq =
        bot && typeof bot.seq === "number" && Number.isFinite(bot.seq) ? bot.seq : NaN;
    const loSeq =
        prevBot && typeof prevBot.seq === "number" && Number.isFinite(prevBot.seq)
            ? prevBot.seq
            : 0;
    const hiAt =
        bot && typeof bot.at === "number" && Number.isFinite(bot.at) ? bot.at : baseAt;
    const loAt =
        prevBot && typeof prevBot.at === "number" && Number.isFinite(prevBot.at)
            ? prevBot.at
            : hiAt - Math.max(4000, (assistants.length + 2) * 900);
    const frac = (myIndexAmongSame + 1) / (sameTarget + 1);
    let seq;
    if (Number.isFinite(hiSeq)) {
        seq = Math.max(loSeq + 1, Math.floor(loSeq + (hiSeq - loSeq) * frac));
        if (seq >= hiSeq) {
            seq = Math.max(loSeq + 1, hiSeq - 1);
        }
    } else {
        seq = 2 * userIndex + 1;
    }
    const at = Math.max(loAt + 1, Math.floor(loAt + (hiAt - loAt) * frac));
    return { seq, at };
}

/**
 * Match sheet / session user-query lists to transcript user bubbles by multiset (keep duplicate utterances).
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @param {string[]} lines
 * @param {number} [atBase]
 */
function missingUserTurnsFromQueryLines_(turns, lines, atBase) {
    if (!Array.isArray(lines) || !lines.length) {
        return [];
    }
    /** @type {string[]} */
    const pendingNorms = [];
    for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i];
        if (t && t.role === "user") {
            const norm = transcriptUserCompareNorm_(t.text);
            if (norm) {
                pendingNorms.push(norm);
            }
        }
    }
    const assistants = orderTranscriptTurnsForDisplay_(
        turns.filter((t) => t && (t.role === "assistant" || t.role === "agent"))
    );
    const baseAt =
        typeof atBase === "number" && Number.isFinite(atBase) ? atBase : Date.now();
    /** @type {{ role: string, text: string, at: number, seq: number }[]} */
    const extra = [];
    let userSlot = 0;
    for (let k = 0; k < lines.length; k += 1) {
        const text = typeof lines[k] === "string" ? lines[k].trim() : "";
        if (!text || shouldOmitTranscriptUserTurn_(text)) {
            continue;
        }
        const norm = transcriptUserCompareNorm_(text);
        if (!norm) {
            continue;
        }
        const idx = pendingNorms.indexOf(norm);
        if (idx >= 0) {
            pendingNorms.splice(idx, 1);
            userSlot += 1;
            continue;
        }
        const slot = seqAtForUserQuerySlot_(userSlot, assistants, baseAt);
        extra.push({
            role: "user",
            text,
            seq: slot.seq,
            at: slot.at
        });
        pendingNorms.push(norm);
        userSlot += 1;
    }
    return extra;
}

/**
 * User before bot, user before bot, … then any trailing user lines after the last bot reply.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} users
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} bots
 */
function weaveTranscriptUserAndBotTurns_(users, bots) {
    /** @type {typeof users} */
    const out = [];
    const botCount = bots.length;
    for (let i = 0; i < botCount; i += 1) {
        if (i < users.length) {
            out.push(users[i]);
        }
        out.push(bots[i]);
    }
    for (let j = botCount; j < users.length; j += 1) {
        out.push(users[j]);
    }
    return out;
}

/**
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @param {number} [baseAt]
 */
function assignMonotonicTranscriptSequence_(turns, baseAt) {
    const start =
        typeof baseAt === "number" && Number.isFinite(baseAt)
            ? baseAt - turns.length * 2500
            : Date.now() - turns.length * 2500;
    return turns.map((t, idx) => ({
        ...t,
        seq: idx + 1,
        at: start + idx * 2500
    }));
}

/** True when stored widget `chat_transcript` already interleaves user + bot rows by `seq`. */
function storedChatTranscriptTurnsAreInterleaved_(turns) {
    if (!Array.isArray(turns) || turns.length < 2) {
        return false;
    }
    const ordered = orderTranscriptTurnsForDisplay_(turns);
    const users = ordered.filter((t) => t && t.role === "user");
    const bots = ordered.filter((t) => t && (t.role === "assistant" || t.role === "agent"));
    if (!users.length || !bots.length) {
        return false;
    }
    const botSeqs = bots
        .map((t) => (typeof t.seq === "number" && Number.isFinite(t.seq) ? t.seq : NaN))
        .filter((n) => Number.isFinite(n));
    const userSeqs = users
        .map((t) => (typeof t.seq === "number" && Number.isFinite(t.seq) ? t.seq : NaN))
        .filter((n) => Number.isFinite(n));
    if (!botSeqs.length || !userSeqs.length) {
        return false;
    }
    return Math.min(...userSeqs) < Math.max(...botSeqs);
}

/**
 * @param {string} sheetCsv
 * @param {Array<Record<string, unknown> | null | undefined>} contexts
 */
function mergeAuthoritativeUserQueriesCsv_(sheetCsv, contexts) {
    /** @type {string[]} */
    let best = userQueryLinesFromCsv_(sheetCsv);
    const list = Array.isArray(contexts) ? contexts : [];
    for (let i = 0; i < list.length; i += 1) {
        const ctx = list[i];
        if (!ctx || typeof ctx !== "object") {
            continue;
        }
        const fromCtx = userQueryLinesFromContextOrdered_(ctx);
        if (fromCtx.length > best.length) {
            best = fromCtx;
        }
    }
    return best.join(", ");
}

/**
 * Rebuild user bubbles in Sheet / session query order and interleave with bot rows via `seq` / `at`.
 *
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @param {string[]} lines
 */
function reorderTranscriptUsersFromAuthoritativeLines_(turns, lines) {
    const base = Array.isArray(turns) ? turns.slice() : [];
    if (!lines.length) {
        return base;
    }
    /** @type {Map<string, { role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]>} */
    const userQueues = new Map();
    for (let i = 0; i < base.length; i += 1) {
        const t = base[i];
        if (!t || t.role !== "user") {
            continue;
        }
        const norm = transcriptUserCompareNorm_(t.text);
        if (!norm) {
            continue;
        }
        if (!userQueues.has(norm)) {
            userQueues.set(norm, []);
        }
        userQueues.get(norm).push(t);
    }
    const assistants = orderTranscriptTurnsForDisplay_(
        base.filter((t) => t && (t.role === "assistant" || t.role === "agent"))
    );
    const baseAt = Date.now();
    /** @type {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} */
    const usersOrdered = [];
    for (let k = 0; k < lines.length; k += 1) {
        const text = typeof lines[k] === "string" ? lines[k].trim() : "";
        if (!text || shouldOmitTranscriptUserTurn_(text)) {
            continue;
        }
        const norm = transcriptUserCompareNorm_(text);
        if (!norm) {
            continue;
        }
        const queue = userQueues.get(norm);
        if (queue && queue.length) {
            const prev = queue.shift();
            usersOrdered.push({
                role: "user",
                text: typeof prev.text === "string" && prev.text.trim() ? prev.text.trim() : text,
                rich: prev.rich
            });
            continue;
        }
        usersOrdered.push({ role: "user", text });
    }
    const woven = weaveTranscriptUserAndBotTurns_(usersOrdered, assistants);
    return assignMonotonicTranscriptSequence_(woven, baseAt);
}

/**
 * @param {{ role: string, text: string, rich?: Record<string, unknown>, at?: number, seq?: number }[]} turns
 * @param {string} csv
 */
function reinforceTranscriptUserTurnsFromQueriesCsv_(turns, csv) {
    const lines = userQueryLinesFromCsv_(csv);
    if (!lines.length) {
        return Array.isArray(turns) ? turns.slice() : [];
    }
    return reorderTranscriptUsersFromAuthoritativeLines_(turns, lines);
}

app.options(PATHNAME_CONVERSATIONS_SHEET_JSON, (req, res) => {
    setConversationsSheetCors_(req, res);
    res.status(204).end();
});

app.options(PATHNAME_CONVERSATIONS_SHEET_STATS, (req, res) => {
    setConversationsSheetCors_(req, res);
    res.status(204).end();
});

app.options(PATHNAME_CONVERSATIONS_SHEET_EXPORT, (req, res) => {
    setConversationsSheetCors_(req, res);
    res.status(204).end();
});

app.options(PATHNAME_CONVERSATION_TRANSCRIPT_JSON, (req, res) => {
    setConversationsSheetCors_(req, res);
    res.status(204).end();
});

app.get(PATHNAME_CONVERSATION_TRANSCRIPT_JSON, async (req, res) => {
    setConversationsSheetCors_(req, res);
    res.setHeader("Cache-Control", "no-store");
    try {
        const cfg = conversationsSheetSecretFromReq_(req);
        if (cfg.reason === "unset") {
            return res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set it in Railway Variables (same as conversations inbox)."
            });
        }
        if (!cfg.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized — send header X-Conversations-Sheet-Secret, Authorization: Bearer …, or ?secret="
            });
        }
        const session = typeof req.query.session === "string" ? req.query.session.trim() : "";
        if (!session) {
            return res.status(400).json({ ok: false, error: "Missing session query parameter." });
        }

        /** @type {{ role: string, text: string, at?: number }[]} */
        let fbTurns = [];
        /** @type {string[]} */
        const sourceParts = [];
        /** @type {string} */
        let transcript_fallback = "";
        /** @type {Record<string, unknown>} */
        let meta = {};
        /** @type {{ rowNumber: number, columns: Record<string, string> } | null} */
        let sheet = null;
        /** @type {Record<string, unknown> | null} */
        let firestoreRec = null;
        /** @type {Record<string, unknown> | null} */
        let liveCx = null;

        if (!SHEETS_DISABLED) {
            try {
                sheet = await fetchLeadSheetRowKeyValuesForSession(session);
            } catch (se) {
                const msg = se && /** @type {{ message?: string }} */ (se).message ? String(se.message) : String(se);
                console.warn("[chatbot-api] conversation-transcript Sheet row:", msg.slice(0, 240));
            }
        }

        if (!FIRESTORE_DISABLED) {
            try {
                const rec = await fetchLatestContactSubmissionForClientSession(session);
                if (rec && typeof rec === "object") {
                    firestoreRec = /** @type {Record<string, unknown>} */ (rec);
                    const cx = /** @type {Record<string, unknown>} */ (
                        rec.client_context && typeof rec.client_context === "object"
                            ? rec.client_context
                            : {}
                    );
                    fbTurns = transcriptTurnsFromClientContext_(cx);
                    if (fbTurns.length) {
                        sourceParts.push("firebase");
                    }
                    meta = {
                        name: rec.name,
                        email: rec.email,
                        mobile: rec.mobile,
                        submitted_at: rec.submitted_at,
                        form_id: rec.form_id
                    };
                }
                liveCx = await fetchSessionChatTranscriptContext(session);
                if (liveCx && typeof liveCx === "object") {
                    const liveTurns = transcriptTurnsFromClientContext_(liveCx);
                    if (liveTurns.length) {
                        sourceParts.push("firebase_session_transcript");
                        if (assistantTurnCount_(liveTurns) > assistantTurnCount_(fbTurns)) {
                            fbTurns = mergeConversationTranscriptTurnSources_(liveTurns, fbTurns);
                        } else {
                            fbTurns = mergeConversationTranscriptTurnSources_(fbTurns, liveTurns);
                        }
                    }
                }
            } catch (fe) {
                const msg = fe && /** @type {{ message?: string }} */ (fe).message ? String(fe.message) : String(fe);
                console.warn("[chatbot-api] conversation-transcript Firebase saved lead:", msg.slice(0, 240));
            }
        }

        /** @type {{ role: string, text: string, at?: number }[]} */
        let sheetChatTurns = [];
        if (!SHEETS_DISABLED) {
            try {
                const { raw } = await fetchLeadSheetChatTranscriptJsonForSession(session);
                sheetChatTurns = transcriptTurnsFromStoredChatArray_(parseChatTranscriptJsonCell_(raw));
            } catch (te) {
                const msg = te && /** @type {{ message?: string }} */ (te).message ? String(te.message) : String(te);
                console.warn("[chatbot-api] conversation-transcript Sheet chat JSON:", msg.slice(0, 240));
            }
        }
        if (!hasAssistantTurns_(sheetChatTurns) && sheet?.columns) {
            const scanned = transcriptTurnsFromSheetColumnsChatScan_(sheet.columns);
            if (scanned.length) {
                sheetChatTurns = scanned;
            }
        }

        if (sheetChatTurns.length) {
            sourceParts.push("sheet_chat_transcript_json");
        }

        /** Union-merge: prefer the richer source first (Firestore is patched on session sync; Sheet JSON is optional legacy). */
        let turns;
        /** @type {string} */
        let authoritativeUserQueriesCsv = "";
        const fbRich = transcriptSourceRichness_(fbTurns);
        const sheetRich = transcriptSourceRichness_(sheetChatTurns);
        if (sheetRich > fbRich) {
            turns = mergeConversationTranscriptTurnSources_(sheetChatTurns, fbTurns);
            sourceParts.push("sheet_first_richer");
        } else {
            turns = mergeConversationTranscriptTurnSources_(fbTurns, sheetChatTurns);
        }
        if (sheetChatTurns.length > 0) {
            const mergedAssistants = assistantTurnCount_(turns);
            const sheetAssistants = assistantTurnCount_(sheetChatTurns);
            if (sheetAssistants > mergedAssistants) {
                turns = mergeConversationTranscriptTurnSources_(sheetChatTurns, fbTurns);
                sourceParts.push("sheet_first_assistant_rich");
            }
        }

        if (!SHEETS_DISABLED) {
            try {
                const { buildAuthoritativeSheet1UserQueriesCsv_ } = await import(
                    "./lib/authoritative-user-queries.mjs"
                );
                /** @type {Record<string, unknown>[]} */
                const transcriptContexts = [];
                if (liveCx && typeof liveCx === "object") {
                    transcriptContexts.push(liveCx);
                }
                if (
                    firestoreRec &&
                    firestoreRec.client_context &&
                    typeof firestoreRec.client_context === "object"
                ) {
                    const fcx = /** @type {Record<string, unknown>} */ (firestoreRec.client_context);
                    if (!transcriptContexts.some((c) => c === fcx)) {
                        transcriptContexts.push(fcx);
                    }
                }
                /** Prefer live session transcript context — has freshest post-agent user_queries. */
                let primaryTranscriptCx = null;
                if (liveCx && typeof liveCx === "object") {
                    primaryTranscriptCx = liveCx;
                } else if (
                    firestoreRec &&
                    firestoreRec.client_context &&
                    typeof firestoreRec.client_context === "object"
                ) {
                    primaryTranscriptCx = /** @type {Record<string, unknown>} */ (
                        firestoreRec.client_context
                    );
                }
                authoritativeUserQueriesCsv = await buildAuthoritativeSheet1UserQueriesCsv_(session, {
                    contexts: transcriptContexts,
                    clientContext: primaryTranscriptCx,
                    loadFirestoreContext: true
                });
                const fromSheetQueries = userTurnsFromSheetQueriesCsv_(authoritativeUserQueriesCsv);
                if (fromSheetQueries.length) {
                    const existingUserN = new Set(
                        turns.filter((t) => t.role === "user").map((t) => transcriptUserCompareNorm_(t.text))
                    );
                    const extraCsv = fromSheetQueries.filter(
                        (t) =>
                            t
                            && t.role === "user"
                            && !existingUserN.has(transcriptUserCompareNorm_(t.text))
                    );
                    if (extraCsv.length) {
                        sourceParts.push(
                            sheetChatTurns.length ? "sheet_user_queries_csv_deduped" : "sheet_user_queries_csv"
                        );
                        turns = mergeConversationTranscriptTurnSources_(turns, extraCsv);
                    }
                }
            } catch (se) {
                const msg = se && /** @type {{ message?: string }} */ (se).message ? String(se.message) : String(se);
                console.warn("[chatbot-api] conversation-transcript Sheet:", msg.slice(0, 240));
            }
        }

        /** Merge only when the widget transcript lacks a form-summary assistant bubble. */
        if (firestoreRec) {
            const hasFormSummaryAssistant = turns.some(
                (t) =>
                    t
                    && t.role === "assistant"
                    && isContactFormSubmissionSummaryAssistantText_(t.text)
            );
            const synthLead = syntheticFormSubmissionAssistantTurnsFromLead_(firestoreRec);
            if (synthLead.length && !hasFormSummaryAssistant) {
                sourceParts.push("synthetic_lead");
                turns = mergeConversationTranscriptTurnSources_(turns, synthLead);
            }
        }

        const metaSubmittedAtMs = firestoreRec ? submittedAtEpochMs_(firestoreRec.submitted_at) : undefined;
        const synthMetaAtBase =
            metaSubmittedAtMs !== undefined ? metaSubmittedAtMs + 1 : Date.now();

        const campaignCtx =
            firestoreRec && firestoreRec.client_context && typeof firestoreRec.client_context === "object"
                ? mergeCampaignParamsIntoClientContextRecord_(
                      /** @type {Record<string, unknown>} */ (firestoreRec.client_context)
                  )
                : liveCx && typeof liveCx === "object"
                  ? mergeCampaignParamsIntoClientContextRecord_(/** @type {Record<string, unknown>} */ (liveCx))
                  : null;
        if (campaignCtx) {
            const hasCampaignBubble = turns.some(
                (t) =>
                    t
                    && t.role === "assistant"
                    && isCampaignParamsAssistantText_(t.text)
            );
            const synthCampaign = syntheticCampaignParamsAssistantTurnsFromContext_(campaignCtx).map((t) => ({
                ...t,
                at: synthMetaAtBase
            }));
            if (synthCampaign.length && !hasCampaignBubble) {
                sourceParts.push("synthetic_campaign");
                turns = mergeConversationTranscriptTurnSources_(turns, synthCampaign);
            }
        }

        const crmCtx =
            firestoreRec && firestoreRec.client_context && typeof firestoreRec.client_context === "object"
                ? /** @type {Record<string, unknown>} */ (firestoreRec.client_context)
                : liveCx && typeof liveCx === "object"
                  ? /** @type {Record<string, unknown>} */ (liveCx)
                  : null;
        if (crmCtx) {
            const hasCrmBubble = turns.some(
                (t) =>
                    t
                    && t.role === "assistant"
                    && isCrmIntegrationAssistantText_(t.text)
            );
            const synthCrm = syntheticCrmExchangeAssistantTurnsFromContext_(crmCtx).map((t) => ({
                ...t,
                at: synthMetaAtBase + 1
            }));
            if (synthCrm.length && !hasCrmBubble) {
                sourceParts.push("synthetic_crm");
                turns = mergeConversationTranscriptTurnSources_(turns, synthCrm);
            }
        }

        if (!assistantTurnCount_(turns)) {
            /** @type {unknown[][]} */
            const recoveryArrays = [];
            if (firestoreRec?.client_context) {
                const rawCx = /** @type {Record<string, unknown>} */ (firestoreRec.client_context);
                const coerced = coerceChatTranscriptArray_(rawCx.chat_transcript);
                if (coerced.length) {
                    recoveryArrays.push(coerced);
                }
            }
            if (liveCx) {
                const coercedLive = coerceChatTranscriptArray_(liveCx.chat_transcript);
                if (coercedLive.length) {
                    recoveryArrays.push(coercedLive);
                }
            }
            for (let ri = 0; ri < recoveryArrays.length; ri += 1) {
                const recovered = transcriptTurnsLenientRecoveryFromRawChat_(recoveryArrays[ri]);
                if (recovered.length) {
                    turns = mergeConversationTranscriptTurnSources_(turns, recovered);
                    sourceParts.push("recovery_assistant_rows");
                    break;
                }
            }
        }

        const liveChatRawArr = liveCx ? coerceChatTranscriptArray_(liveCx.chat_transcript) : [];
        const liveChatTurns = transcriptTurnsFromStoredChatArray_(liveChatRawArr);
        const useLiveChatBackbone = storedChatTranscriptTurnsAreInterleaved_(liveChatTurns);

        if (useLiveChatBackbone) {
            const agentOnly = turns.filter((t) => t && t.role === "agent");
            turns = orderTranscriptTurnsForDisplay_(
                mergeConversationTranscriptTurnSources_(liveChatTurns, agentOnly)
            );
            sourceParts.push("live_chat_transcript_backbone");
        } else if (authoritativeUserQueriesCsv) {
            turns = reinforceTranscriptUserTurnsFromQueriesCsv_(turns, authoritativeUserQueriesCsv);
            sourceParts.push("sheet_user_queries_interleaved");
        } else {
            turns = augmentTranscriptWithMissingUserQueries_(turns, [
                firestoreRec && typeof firestoreRec.client_context === "object"
                    ? /** @type {Record<string, unknown>} */ (firestoreRec.client_context)
                    : null,
                liveCx && typeof liveCx === "object" ? liveCx : null
            ]);
        }

        const liveAgentTurnsRaw = await transcriptTurnsFromLiveAgentInbox_(session);
        if (liveAgentTurnsRaw.length) {
            const existingUserNorms = new Set(
                turns
                    .filter((t) => t && t.role === "user")
                    .map((t) => transcriptUserCompareNorm_(t.text))
            );
            const existingAgentNorms = new Set(
                turns
                    .filter((t) => t && t.role === "agent")
                    .map((t) => transcriptAgentBodyCompareNorm_(t.text))
                    .filter(Boolean)
            );
            const liveAgentTurns = liveAgentTurnsRaw.filter((t) => {
                if (!t) {
                    return false;
                }
                if (t.role === "user") {
                    const norm = transcriptUserCompareNorm_(t.text);
                    if (!norm || existingUserNorms.has(norm)) {
                        return false;
                    }
                    existingUserNorms.add(norm);
                    return true;
                }
                if (t.role === "agent") {
                    const norm = transcriptAgentBodyCompareNorm_(t.text);
                    if (norm && existingAgentNorms.has(norm)) {
                        return false;
                    }
                    if (norm) {
                        existingAgentNorms.add(norm);
                    }
                }
                return true;
            });
            if (liveAgentTurns.length) {
                sourceParts.push("live_agent_inbox");
                turns = mergeConversationTranscriptTurnSources_(turns, liveAgentTurns);
                turns = orderTranscriptTurnsForDisplay_(turns);
            }
        }

        turns = polishTranscriptAssistantPlaceholderTurns_(turns);

        turns = orderTranscriptTurnsForDisplay_(turns);
        turns = collapseLiveAgentAssistantMirrors_(turns);
        turns = collapseIdenticalAssistantTranscriptTurns_(turns);
        turns = collapseRedundantAssistantTranscriptTurns_(turns);
        turns = dedupeTranscriptTurnsForDisplay_(turns);
        turns = orderTranscriptTurnsForDisplay_(turns);

        if (!assistantTurnCount_(turns) && firestoreRec?.client_context) {
            const rawCx = /** @type {Record<string, unknown>} */ (firestoreRec.client_context);
            const rawArr = coerceChatTranscriptArray_(rawCx.chat_transcript);
            const rawAssistants = rawArr.filter(
                (it) =>
                    it
                    && typeof it === "object"
                    && normalizeTranscriptItemRole_(/** @type {Record<string, unknown>} */ (it)) === "assistant"
            ).length;
            if (rawAssistants > 0) {
                console.warn(
                    "[chatbot-api] conversation-transcript: lead has",
                    rawAssistants,
                    "stored assistant row(s) but merged turns are user-only; session=",
                    session
                );
            }
        }

        transcript_fallback = "";
        const source = sourceParts.length ? sourceParts.join("+") : "none";

        const rawLeadArr =
            firestoreRec?.client_context && typeof firestoreRec.client_context === "object"
                ? coerceChatTranscriptArray_(
                      /** @type {Record<string, unknown>} */ (firestoreRec.client_context).chat_transcript
                  )
                : [];
        const rawLiveArr = liveCx ? coerceChatTranscriptArray_(liveCx.chat_transcript) : [];
        const countRawAssistant = (arr) =>
            arr.filter(
                (it) =>
                    it
                    && typeof it === "object"
                    && String(/** @type {{ role?: unknown }} */ (it).role || "")
                        .trim()
                        .toLowerCase() === "assistant"
            ).length;

        if (authoritativeUserQueriesCsv) {
            meta = { ...meta, user_queries: authoritativeUserQueriesCsv };
            if (sheet && sheet.columns && typeof sheet.columns === "object") {
                const colKeys = Object.keys(sheet.columns);
                for (let qi = 0; qi < colKeys.length; qi += 1) {
                    const colKey = colKeys[qi];
                    if (canonicalLeadFieldKeyForTranscript_(colKey) === "user_queries") {
                        sheet.columns[colKey] = authoritativeUserQueriesCsv;
                        break;
                    }
                }
            }
        }

        try {
            const { loadSessionForLiveAgentSheet } = await import("./lib/live-agent/firestore-bridge.mjs");
            const laSession = await loadSessionForLiveAgentSheet(session);
            if (laSession) {
                const liveAgentSheet = require_("./lib/refer-staff/live-agent-sheet.js");
                if (typeof liveAgentSheet.buildSheet2UserQueriesForSheet === "function") {
                    const laUq = liveAgentSheet.buildSheet2UserQueriesForSheet(laSession);
                    if (laUq) {
                        meta = { ...meta, live_agent_user_queries: laUq };
                    }
                }
            }
        } catch (laMetaErr) {
            console.warn(
                "[chatbot-api] conversation-transcript live_agent_user_queries:",
                laMetaErr && laMetaErr.message ? laMetaErr.message : laMetaErr
            );
        }

        meta = applyTranscriptSummaryMobileWithDialCode_(meta, firestoreRec, liveCx, sheet);

        return res.json({
            ok: true,
            session,
            source,
            meta,
            sheet,
            turns,
            transcript_fallback,
            transcript_stats: {
                assistant_turns: assistantTurnCount_(turns),
                agent_turns: turns.filter((t) => t && t.role === "agent").length,
                user_turns: turns.filter((t) => t && t.role === "user").length,
                stored_lead_assistant_rows: countRawAssistant(rawLeadArr),
                stored_session_assistant_rows: countRawAssistant(rawLiveArr),
                lead_chat_transcript: describeChatTranscriptStorage_(
                    firestoreRec?.client_context && typeof firestoreRec.client_context === "object"
                        ? /** @type {Record<string, unknown>} */ (firestoreRec.client_context)
                        : {}
                ),
                session_chat_transcript: describeChatTranscriptStorage_(
                    liveCx && typeof liveCx === "object" ? liveCx : {}
                ),
                assistant_queries_count: Array.isArray(
                    firestoreRec?.client_context
                    && typeof firestoreRec.client_context === "object"
                    && /** @type {Record<string, unknown>} */ (firestoreRec.client_context).assistant_queries
                )
                    ? /** @type {unknown[]} */ (
                          /** @type {Record<string, unknown>} */ (firestoreRec.client_context).assistant_queries
                      ).length
                    : liveCx && Array.isArray(liveCx.assistant_queries)
                      ? liveCx.assistant_queries.length
                      : 0
            },
            transcript_time_zone: getConversationDateTimeZoneForTranscript(),
            transcript_time_includes_date: transcriptTimeIncludesDateFromEnv_()
        });
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        return res.status(500).json({ ok: false, error: msg });
    }
});

app.get(PATHNAME_CONVERSATIONS_SHEET_JSON, async (req, res) => {
    setConversationsSheetCors_(req, res);
    res.setHeader("Cache-Control", "no-store");
    try {
        const cfg = conversationsSheetSecretFromReq_(req);
        if (cfg.reason === "unset") {
            return res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set a random secret in Railway Variables, redeploy, then open /conversations-sheet and paste it once."
            });
        }
        if (!cfg.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized — send header X-Conversations-Sheet-Secret or Authorization: Bearer <secret> matching CONVERSATIONS_SHEET_VIEW_SECRET."
            });
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Sheets reads disabled (DISABLE_SHEETS=1 or missing SHEETS_SPREADSHEET_ID). Viewer needs the same Sheet as lead capture."
            });
        }
        if (!getServiceAccountCredentials()) {
            return res.status(503).json({
                ok: false,
                error: "Missing service account JSON — same as Sheets writes (FIREBASE_SERVICE_ACCOUNT_JSON)."
            });
        }
        let maxRows = 200;
        if (req.query && req.query.limit != null) {
            const n = Number.parseInt(String(req.query.limit), 10);
            if (Number.isFinite(n) && n >= 5 && n <= 500) {
                maxRows = n;
            }
        }
        let offset = 0;
        if (req.query && req.query.offset != null) {
            const o = Number.parseInt(String(req.query.offset), 10);
            if (Number.isFinite(o) && o >= 0 && o <= 500_000) {
                offset = o;
            }
        }
        const rawFrom =
            req.query && typeof req.query.from === "string" ? req.query.from.trim() : "";
        const rawTo = req.query && typeof req.query.to === "string" ? req.query.to.trim() : "";
        const allInRange = req.query.all !== "0" && req.query.all !== "false";
        const includeStats = req.query.includeStats !== "0" && req.query.includeStats !== "false";
        const previewOpts = {
            maxRows,
            offset,
            allInRange,
            includeStats,
            from: rawFrom,
            to: rawTo
        };
        const payload = await fetchConversationSheetPreview(previewOpts);
        return res.status(200).json({ ok: true, ...payload });
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        if (isConversationsSheetReadQuotaError_(msg)) {
            return res.status(503).json({
                ok: false,
                error: CONVERSATIONS_VIEWER_READ_QUOTA_MSG
            });
        }
        console.error("[chatbot-api] conversations-sheet JSON:", msg);
        return res.status(500).json({ ok: false, error: sanitizeConversationsViewerApiError_(msg) });
    }
});

app.get(PATHNAME_CONVERSATIONS_SHEET_STATS, async (req, res) => {
    setConversationsSheetCors_(req, res);
    res.setHeader("Cache-Control", "no-store");
    try {
        const cfg = conversationsSheetSecretFromReq_(req);
        if (cfg.reason === "unset") {
            return res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set a random secret in Railway Variables, redeploy, then open /conversations-sheet and paste it once."
            });
        }
        if (!cfg.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized — send header X-Conversations-Sheet-Secret or Authorization: Bearer <secret> matching CONVERSATIONS_SHEET_VIEW_SECRET."
            });
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Sheets reads disabled (DISABLE_SHEETS=1 or missing SHEETS_SPREADSHEET_ID). Viewer needs the same Sheet as lead capture."
            });
        }
        if (!getServiceAccountCredentials()) {
            return res.status(503).json({
                ok: false,
                error: "Missing service account JSON — same as Sheets writes (FIREBASE_SERVICE_ACCOUNT_JSON)."
            });
        }
        const q = req.query || {};
        const from = typeof q.from === "string" ? q.from.trim() : "";
        const to = typeof q.to === "string" ? q.to.trim() : "";
        const statsOpts =
            from || to ? { from: from || undefined, to: to || undefined } : {};
        const t0 = Date.now();
        const payload = await fetchConversationLeadCaptureStats(statsOpts);
        const ms = Date.now() - t0;
        if (ms > 5000) {
            console.warn("[chatbot-api] conversations-sheet stats slow", {
                ms,
                from: from || null,
                to: to || null
            });
        }
        return res.status(200).json({ ok: true, ...payload });
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        const low = msg.toLowerCase();
        if (low.includes("invalid date parameter")) {
            return res.status(400).json({ ok: false, error: msg.slice(0, 400) });
        }
        if (isConversationsSheetReadQuotaError_(msg)) {
            return res.status(503).json({
                ok: false,
                error: CONVERSATIONS_VIEWER_READ_QUOTA_MSG
            });
        }
        console.error("[chatbot-api] conversations-sheet stats:", msg);
        return res.status(500).json({ ok: false, error: sanitizeConversationsViewerApiError_(msg) });
    }
});

/**
 * @param {unknown} v
 */
function csvEscapeConversationCell_(v) {
    const s = String(v == null ? "" : v);
    if (/[\r\n",]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * @param {string[]} headers
 * @param {Record<string, string>[]} conversations
 */
function conversationSheetRowsToCsv_(headers, conversations) {
    /** @type {string[]} */
    const lines = [headers.map(csvEscapeConversationCell_).join(",")];
    for (let i = 0; i < conversations.length; i += 1) {
        const row = conversations[i] || {};
        lines.push(headers.map((h) => csvEscapeConversationCell_(row[h])).join(","));
    }
    return lines.join("\r\n");
}

const CONVERSATIONS_EXPORT_MONTHS_SHORT = /** @type {const} */ ([
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
]);

/**
 * @param {unknown} isoYmd
 */
function isoYmdToConversationExportFilenameSegment_(isoYmd) {
    const s = typeof isoYmd === "string" ? isoYmd.trim() : "";
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) {
        return "";
    }
    const [ys, ms, ds] = s.split("-");
    const y = Number.parseInt(ys, 10);
    const mo = Number.parseInt(ms, 10);
    const d = Number.parseInt(ds, 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
        return "";
    }
    if (!Number.isFinite(d) || d < 1 || d > 31) {
        return "";
    }
    const monthLabel = CONVERSATIONS_EXPORT_MONTHS_SHORT[mo - 1];
    if (!monthLabel) {
        return "";
    }
    return `${d}_${monthLabel}_${y}`;
}

function conversationSheetExportFilename_(fromIso, toIso) {
    const segFrom = isoYmdToConversationExportFilenameSegment_(fromIso);
    const segTo = isoYmdToConversationExportFilenameSegment_(toIso);
    if (segFrom && segTo) {
        return `conversation-leads_${segFrom}_to_${segTo}.csv`;
    }
    if (segFrom) return `conversation-leads_from_${segFrom}.csv`;
    if (segTo) return `conversation-leads_until_${segTo}.csv`;
    return "conversation-leads_all.csv";
}

app.get(PATHNAME_CONVERSATIONS_SHEET_EXPORT, async (req, res) => {
    setConversationsSheetCors_(req, res);
    res.setHeader("Cache-Control", "no-store");
    try {
        const cfg = conversationsSheetSecretFromReq_(req);
        if (cfg.reason === "unset") {
            return res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set a random secret in Railway Variables, redeploy, then open /conversations-sheet and paste it once."
            });
        }
        if (!cfg.ok) {
            return res.status(401).json({
                ok: false,
                error:
                    "Unauthorized — send header X-Conversations-Sheet-Secret or Authorization: Bearer <secret> matching CONVERSATIONS_SHEET_VIEW_SECRET."
            });
        }
        if (SHEETS_DISABLED) {
            return res.status(503).json({
                ok: false,
                error:
                    "Sheets reads disabled (DISABLE_SHEETS=1 or missing SHEETS_SPREADSHEET_ID). Viewer needs the same Sheet as lead capture."
            });
        }
        if (!getServiceAccountCredentials()) {
            return res.status(503).json({
                ok: false,
                error: "Missing service account JSON — same as Sheets writes (FIREBASE_SERVICE_ACCOUNT_JSON)."
            });
        }
        const q = req.query || {};
        const from = typeof q.from === "string" ? q.from.trim() : "";
        const to = typeof q.to === "string" ? q.to.trim() : "";
        const payload = await fetchConversationSheetExport(
            from || to ? { from: from || undefined, to: to || undefined } : {}
        );
        const csvBody = conversationSheetRowsToCsv_(payload.headers, payload.conversations);
        const df = payload.dateFilter && typeof payload.dateFilter === "object" ? payload.dateFilter : {};
        const fn = conversationSheetExportFilename_(df.from, df.to);
        res.status(200);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
        return res.send(`\uFEFF${csvBody}`);
    } catch (e) {
        const msg = e && /** @type {{ message?: string }} */ (e).message ? String(e.message) : String(e);
        const low = msg.toLowerCase();
        if (low.includes("invalid date parameter")) {
            return res.status(400).json({ ok: false, error: msg.slice(0, 400) });
        }
        if (isConversationsSheetReadQuotaError_(msg)) {
            return res.status(503).json({
                ok: false,
                error: CONVERSATIONS_VIEWER_READ_QUOTA_MSG
            });
        }
        console.error("[chatbot-api] conversations-sheet export:", msg);
        return res.status(500).json({ ok: false, error: sanitizeConversationsViewerApiError_(msg) });
    }
});

/** Opening the Railway URL in a browser hits GET / — avoid Express default "Cannot GET /". */
app.get("/", (_req, res) => {
    res.status(200).type("text/plain; charset=utf-8").send(
        [
            `Contact leads API running.`,
            `GET /reception-schedule → staff calendar (booked vs free slots).`,
            `GET /conversations-sheet → staff inbox (Sheet leads; requires CONVERSATIONS_SHEET_VIEW_SECRET).`,
            `GET /conversation-transcript?session=… → staff chat transcript page (same secret via header or localStorage).`,
            `GET /api/conversation-transcript?session=… → JSON { turns: [{role,text,at?}], transcript_time_zone, transcript_time_includes_date } (same secret as inbox).`,
            `GET /api/conversations-sheet?limit=&offset=&from=YYYY-MM-DD&to=YYYY-MM-DD → JSON rows (same secret; optional sheet-wide date filter).`,
            `GET /api/conversations-sheet-stats?from=YYYY-MM-DD&to=YYYY-MM-DD → mobile/email lead ratios (same secret).`,
            `GET /api/conversations-sheet-export?from=&to= → CSV download for all scanned rows or date-filtered rows (same secret).`,
            `POST JSON or multipart/form-data → ${PATHNAME}`,
            `POST JSON (chat mobile) → ${PATHNAME_MOBILE_SHEET_SYNC}`,
            `POST JSON (session queries) → ${PATHNAME_SESSION_SHEET_SYNC}`,
            `POST JSON (live transcript) → ${PATHNAME_SESSION_TRANSCRIPT_SYNC}`,
            `POST JSON ${PATHNAME_CHAT_FEEDBACK} → visitor CSAT/helpful (Firestore chat_feedback; optional CHAT_FEEDBACK_SECRET).`,
            `GET /health → health check.`,
            `GET /contact-form-sheets-health → JSON: Sheets env + tab names (spreadsheet READ probe).`,
            `GET /contact-form-email-health → JSON: lead email env (no secrets; check missing_env).`,
            `POST /contact-form-email-self-test (+ CONTACT_LEAD_EMAIL_TEST_SECRET header) → sends one SMTP ping.`,
            CATALOG_SYNC_SECRET
                ? `POST ${PATHNAME_CATALOG_SYNC} + X-Catalog-Sync-Secret → push doctors/branches catalog (JSON) to RTDB.`
                : `Set CATALOG_SYNC_SECRET + redeploy → POST ${PATHNAME_CATALOG_SYNC} to sync catalog JSON to RTDB.`,
            `Drive uploads + optional Firestore/Sheets (DRIVE_ONLY=1 skips Firestore only; Sheets use SHEETS_SPREADSHEET_ID).`
        ].join("\n")
    );
});

process.on("unhandledRejection", (reason) => {
    console.error("[chatbot-api] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[chatbot-api] uncaughtException:", err && err.stack ? err.stack : err);
});

// Bind 0.0.0.0 so PaaS (Railway, Docker) healthchecks can reach the process.
app.listen(PORT, "0.0.0.0", () => {
    logContactLeadEmailBoot();
    void verifyContactLeadSmtpOnBoot();
    const sheetHint = SHEETS_DISABLED ? "(Sheets OFF)" : "(Sheets ON)";
    const fsHint = FIRESTORE_DISABLED ? "Firestore OFF" : "Firestore ON";
    const driveHint = DISABLE_DRIVE_UPLOAD
        ? "uploads=off"
        : APPS_SCRIPT_WEBAPP_URL
          ? "uploads=AppsScript"
          : "uploads=DriveAPI";
    const mode = DRIVE_ONLY ? " DRIVE_ONLY" : "";
    console.log(
        `chatbot-api listening on :${PORT} ${PATHNAME} ${PATHNAME_MOBILE_SHEET_SYNC} ${PATHNAME_SESSION_SHEET_SYNC} ${PATHNAME_SESSION_TRANSCRIPT_SYNC} ${PATHNAME_CHAT_FEEDBACK} — ${fsHint} ${sheetHint} ${driveHint}${mode}`
    );
});
