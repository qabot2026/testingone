/**
 * Live agent departments + global settings (Firestore).
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { firebaseAdminInit } from "../firebase-admin-init.mjs";

const LOG_TAG = "[live-agent/dept]";
const GENERAL_ID = "general";

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function slugId_(name) {
    const s = trim_(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s || "dept";
}

function normalizeEmail_(raw) {
    return trim_(raw).toLowerCase();
}

function firestoreDb_() {
    firebaseAdminInit();
    const id = trim_(process.env.FIRESTORE_DATABASE_ID);
    if (!id || id === "default" || id === "(default)") {
        return admin.firestore();
    }
    return getFirestore(admin.app(), id);
}

function departmentsCol_() {
    return firestoreDb_().collection(
        trim_(process.env.LIVE_AGENT_DEPARTMENTS_COLLECTION) || "live_agent_departments"
    );
}

function settingsRef_() {
    firebaseAdminInit();
    return firestoreDb_()
        .collection(trim_(process.env.LIVE_AGENT_SETTINGS_COLLECTION) || "live_agent_settings")
        .doc("config");
}

function serializeDepartment_(id, data) {
    const d = data || {};
    const emails = Array.isArray(d.agentEmails)
        ? d.agentEmails.map(normalizeEmail_).filter(Boolean)
        : [];
    return {
        id,
        name: typeof d.name === "string" ? d.name : id,
        agentEmails: [...new Set(emails)],
        isSystem: d.isSystem === true || id === GENERAL_ID,
        roundRobinCursor: typeof d.roundRobinCursor === "number" ? d.roundRobinCursor : 0,
        createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : null
    };
}

export async function ensureGeneralDepartment_() {
    const ref = departmentsCol_().doc(GENERAL_ID);
    const snap = await ref.get();
    if (snap.exists) return serializeDepartment_(GENERAL_ID, snap.data());
    const now = admin.firestore.FieldValue.serverTimestamp();
    const data = {
        name: "General Department",
        agentEmails: [],
        isSystem: true,
        roundRobinCursor: 0,
        createdAt: now,
        updatedAt: now
    };
    await ref.set(data);
    return serializeDepartment_(GENERAL_ID, data);
}

function bool_(v, fallback) {
    if (v === true || v === false) return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
    return fallback;
}

function clampInt_(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
}

function pickEnum_(v, allowed, fallback) {
    const s = trim_(v).toLowerCase();
    return allowed.includes(s) ? s : fallback;
}

/** @param {unknown} raw */
export function normalizeAgentProfiles_(raw) {
    const out = [];
    const seen = new Set();
    const arr = Array.isArray(raw) ? raw : [];
    for (let i = 0; i < arr.length; i += 1) {
        const row = arr[i];
        if (!row || typeof row !== "object") {
            continue;
        }
        const o = /** @type {Record<string, unknown>} */ (row);
        const email = normalizeEmail_(o.email || o.agentEmail);
        const name = trim_(o.name || o.displayName);
        if (!email || !email.includes("@") || !name || seen.has(email)) {
            continue;
        }
        seen.add(email);
        out.push({ email, name: name.slice(0, 80) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

/** Display name for visitors and agents (never returns an email). */
export function resolveAgentDisplayName_(email, settings) {
    const e = normalizeEmail_(email);
    if (!e) {
        return "Agent";
    }
    const profiles =
        settings && settings.general && Array.isArray(settings.general.agentProfiles)
            ? settings.general.agentProfiles
            : [];
    for (let i = 0; i < profiles.length; i += 1) {
        const p = profiles[i];
        if (p && normalizeEmail_(p.email) === e && trim_(p.name)) {
            return trim_(p.name);
        }
    }
    return "Agent";
}

/** Stored on accept; formatted per audience in enrichMessagesWithAgentNames_. */
export const LIVE_AGENT_HUMAN_CONNECTED_MARKER_ = "live_agent_human_connected";
export const LIVE_AGENT_HUMAN_REJOINED_MARKER_ = "live_agent_human_rejoined";
export const LIVE_AGENT_HANDOFF_TO_BOT_MARKER_ = "live_agent_handoff_to_bot";
export const LIVE_AGENT_BOT_ACTIVE_MARKER_ = "live_agent_bot_active";
export const LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT_ = "AI assistant is replying now.";

function agentNameFromSystemMsg_(msg, assignedAgentEmail, settings) {
    const fromMsg = trim_(msg && (msg.senderDisplayName || msg.senderName));
    const email =
        normalizeEmail_(msg && msg.senderEmail) ||
        normalizeEmail_(assignedAgentEmail) ||
        "";
    return fromMsg || resolveAgentDisplayName_(email, settings) || "Agent";
}

function isHumanHandoffToBotSystemText_(text) {
    const t = trim_(text);
    return t === LIVE_AGENT_HANDOFF_TO_BOT_MARKER_ || t === LIVE_AGENT_BOT_ACTIVE_MARKER_;
}

function isBotHandoffSystemText_(text) {
    const t = trim_(text).toLowerCase();
    return (
        t === LIVE_AGENT_HANDOFF_TO_BOT_MARKER_ ||
        t === LIVE_AGENT_BOT_ACTIVE_MARKER_ ||
        t.includes("ai assistant is replying") ||
        t.includes("the assistant is replying") ||
        t.includes("stepped away")
    );
}

function isHumanJoinSystemText_(text) {
    const t = trim_(text);
    return (
        t === LIVE_AGENT_HUMAN_CONNECTED_MARKER_ ||
        /^Agent\s+\S+@\S+\s+accepted the chat\.?$/i.test(t) ||
        /^\S+@\S+\s+accepted the chat\.?$/i.test(t)
    );
}

/** Agent desk / API — not visitor-facing copy (mirrors refer formatSystemMessageForAgent). */
export function formatSystemMessageTextForAgent_(
    text,
    visitorDisplayName,
    msg,
    viewingAgentEmail,
    settings,
    assignedAgentEmail
) {
    let t = trim_(text);
    if (!t) {
        return t;
    }
    const me = normalizeEmail_(viewingAgentEmail);
    const senderEmail =
        normalizeEmail_(msg && msg.senderEmail) || normalizeEmail_(assignedAgentEmail);
    const senderName = agentNameFromSystemMsg_(msg, assignedAgentEmail, settings);
    const isMe = !!(me && senderEmail && me === senderEmail);

    if (isHumanHandoffToBotSystemText_(t) || isBotHandoffSystemText_(t)) {
        return isMe
            ? "You stepped away. AI assistant is replying to the visitor."
            : `${senderName} stepped away. AI assistant is replying to the visitor.`;
    }
    if (t === LIVE_AGENT_HUMAN_REJOINED_MARKER_ || /joined again\.?$/i.test(t)) {
        return isMe ? "You joined again." : `${senderName} joined again.`;
    }
    if (isHumanJoinSystemText_(t) || /^you are now chatting with\s+/i.test(t)) {
        const visitor = trim_(visitorDisplayName) || "Visitor";
        return `${visitor} joined the chat.`;
    }
    const joined = t.match(/^(.+?)\s+joined the chat\.?$/i);
    if (joined) {
        const visitor = trim_(visitorDisplayName) || "Visitor";
        return `${visitor} joined the chat.`;
    }
    return t;
}

/** Visitor-safe system line (no email addresses). */
export function formatSystemMessageTextForVisitor_(text, settings, senderEmail, assignedAgentEmail) {
    let t = trim_(text);
    if (!t) {
        return t;
    }
    const agentEmail = normalizeEmail_(senderEmail) || normalizeEmail_(assignedAgentEmail);
    if (t === LIVE_AGENT_HUMAN_CONNECTED_MARKER_) {
        const name = resolveAgentDisplayName_(agentEmail, settings);
        return `You are now chatting with ${name}.`;
    }
    if (t === LIVE_AGENT_HUMAN_REJOINED_MARKER_) {
        const name = resolveAgentDisplayName_(agentEmail, settings);
        return `${name} joined again.`;
    }
    if (t === LIVE_AGENT_HANDOFF_TO_BOT_MARKER_ || t === LIVE_AGENT_BOT_ACTIVE_MARKER_) {
        const name = resolveAgentDisplayName_(agentEmail, settings);
        return `${name} stepped away. ${LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT_}`;
    }
    const tLower = t.toLowerCase();
    if (tLower.includes("ai assistant enabled") && tLower.includes("bot")) {
        return LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT_;
    }
    if (tLower.includes("human agent took over")) {
        return "";
    }
    const acceptLegacy = t.match(/^Agent\s+(\S+@\S+)\s+accepted the chat\.?$/i);
    if (acceptLegacy) {
        const name = resolveAgentDisplayName_(acceptLegacy[1], settings);
        return `You are now chatting with ${name}.`;
    }
    const acceptShort = t.match(/^(\S+@\S+)\s+accepted the chat\.?$/i);
    if (acceptShort) {
        const name = resolveAgentDisplayName_(acceptShort[1], settings);
        return `You are now chatting with ${name}.`;
    }
    const joined = t.match(/^(.+?)\s+joined the chat\.?$/i);
    if (joined) {
        const who = trim_(joined[1]);
        const name = /@/.test(who)
            ? resolveAgentDisplayName_(who, settings)
            : resolveAgentDisplayName_(agentEmail, settings);
        return `You are now chatting with ${name}.`;
    }
    if (/ended|closed/i.test(t)) {
        return t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, () => "Agent");
    }
    return t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (email) =>
        resolveAgentDisplayName_(email, settings)
    );
}

function serializeLiveAgentSettings_(d) {
    const raw = d || {};
    const accessRaw = raw.access && typeof raw.access === "object" ? raw.access : {};
    const reportingRaw = raw.reporting && typeof raw.reporting === "object" ? raw.reporting : {};
    const kbRaw = raw.knowledgeBase && typeof raw.knowledgeBase === "object" ? raw.knowledgeBase : {};
    const bhRaw = raw.businessHours && typeof raw.businessHours === "object" ? raw.businessHours : {};
    return {
        claimWaitSeconds: clampInt_(raw.claimWaitSeconds, 5, 300, 30),
        endConvWaitMinutes: clampInt_(raw.endConvWaitMinutes, 1, 120, 3),
        defaultDepartmentId: trim_(raw.defaultDepartmentId) || GENERAL_ID,
        queueMaxWaitEnabled: raw.queueMaxWaitEnabled !== false,
        queueMaxWaitMinutes: clampInt_(raw.queueMaxWaitMinutes, 1, 120, 10),
        queueTimeoutReply:
            typeof raw.queueTimeoutReply === "string" && raw.queueTimeoutReply.trim()
                ? raw.queueTimeoutReply.trim()
                : "All agents are busy right now. Please continue with the assistant or try again shortly.",
        general: {
            muteServiceDesk: bool_(raw.muteServiceDesk, false),
            showAgentNameInChat: bool_(raw.showAgentNameInChat, true),
            enableAgentChatFeedback: bool_(raw.enableAgentChatFeedback, false),
            disableUserTextTranslation: bool_(raw.disableUserTextTranslation, false),
            sortChatsByLastMessage: bool_(raw.sortChatsByLastMessage, true),
            notificationSound: pickEnum_(raw.notificationSound, ["default", "chime", "none"], "default"),
            notifyDeskPanel: bool_(raw.notifyDeskPanel, true),
            notifyDesktopPopup: bool_(raw.notifyDesktopPopup, true),
            notifyMobilePopup: bool_(raw.notifyMobilePopup, true),
            agentProfiles: normalizeAgentProfiles_(raw.agentProfiles)
        },
        routing: {
            algorithm: pickEnum_(raw.routingAlgorithm, ["round_robin", "online_parallel"], "online_parallel"),
            maxConcurrentChats: clampInt_(raw.maxConcurrentChats, 1, 20, 2),
            agentInactivityMinutes: clampInt_(raw.agentInactivityMinutes, 1, 480, 15),
            exitAgentOnInactive: bool_(raw.exitAgentOnInactive, false)
        },
        access: {
            tabAllChats: bool_(accessRaw.tabAllChats ?? raw.tabAllChats, true),
            tabAllAssigned: bool_(accessRaw.tabAllAssigned ?? raw.tabAllAssigned, true),
            tabUnassigned: bool_(accessRaw.tabUnassigned ?? raw.tabUnassigned, true),
            tabAiChats: bool_(accessRaw.tabAiChats ?? raw.tabAiChats, false),
            tabAgentChats: bool_(accessRaw.tabAgentChats ?? raw.tabAgentChats, true),
            tabCompleted: bool_(accessRaw.tabCompleted ?? raw.tabCompleted, true),
            uploadFile: bool_(accessRaw.uploadFile ?? raw.uploadFile, true),
            viewContact: pickEnum_(accessRaw.viewContact ?? raw.viewContact, ["all", "assigned", "none"], "all")
        },
        reporting: {
            dailyRecipients:
                typeof reportingRaw.dailyRecipients === "string"
                    ? reportingRaw.dailyRecipients
                    : typeof raw.dailyReportRecipients === "string"
                      ? raw.dailyReportRecipients
                      : "",
            weeklyMonthlyEnabled: bool_(
                reportingRaw.weeklyMonthlyEnabled ?? raw.weeklyMonthlyReports,
                false
            )
        },
        knowledgeBase: {
            enabled: kbRaw.enabled !== false,
            articles: Array.isArray(kbRaw.articles) ? kbRaw.articles : []
        },
        businessHours: {
            enabled: bhRaw.enabled === true,
            timezone: trim_(bhRaw.timezone) || "Asia/Kolkata",
            workDays: Array.isArray(bhRaw.workDays)
                ? bhRaw.workDays.map((x) => String(x).toLowerCase())
                : ["monday", "tuesday", "wednesday", "thursday", "friday"],
            start: trim_(bhRaw.start) || "9:00 AM",
            end: trim_(bhRaw.end) || "5:00 PM",
            outsideHoursMessage: trim_(bhRaw.outsideHoursMessage)
        },
        updatedAt: raw.updatedAt && raw.updatedAt.toDate ? raw.updatedAt.toDate().toISOString() : null
    };
}

export async function getLiveAgentSettings_() {
    await ensureGeneralDepartment_();
    const snap = await settingsRef_().get();
    return serializeLiveAgentSettings_(snap.exists ? snap.data() : {});
}

export async function saveLiveAgentSettings_(patch) {
    const cur = await getLiveAgentSettings_();
    const p = patch && typeof patch === "object" ? patch : {};
    const g = p.general && typeof p.general === "object" ? p.general : {};
    const r = p.routing && typeof p.routing === "object" ? p.routing : {};
    const a = p.access && typeof p.access === "object" ? p.access : {};
    const rep = p.reporting && typeof p.reporting === "object" ? p.reporting : {};

    const next = {
        claimWaitSeconds:
            p.claimWaitSeconds !== undefined
                ? clampInt_(p.claimWaitSeconds, 5, 300, cur.claimWaitSeconds)
                : cur.claimWaitSeconds,
        endConvWaitMinutes:
            p.endConvWaitMinutes !== undefined
                ? clampInt_(p.endConvWaitMinutes, 1, 120, cur.endConvWaitMinutes)
                : cur.endConvWaitMinutes,
        defaultDepartmentId:
            p.defaultDepartmentId !== undefined
                ? trim_(p.defaultDepartmentId) || GENERAL_ID
                : cur.defaultDepartmentId,
        muteServiceDesk:
            g.muteServiceDesk !== undefined ? bool_(g.muteServiceDesk, cur.general.muteServiceDesk) : cur.general.muteServiceDesk,
        showAgentNameInChat:
            g.showAgentNameInChat !== undefined
                ? bool_(g.showAgentNameInChat, cur.general.showAgentNameInChat)
                : cur.general.showAgentNameInChat,
        enableAgentChatFeedback:
            g.enableAgentChatFeedback !== undefined
                ? bool_(g.enableAgentChatFeedback, cur.general.enableAgentChatFeedback)
                : cur.general.enableAgentChatFeedback,
        disableUserTextTranslation:
            g.disableUserTextTranslation !== undefined
                ? bool_(g.disableUserTextTranslation, cur.general.disableUserTextTranslation)
                : cur.general.disableUserTextTranslation,
        sortChatsByLastMessage:
            g.sortChatsByLastMessage !== undefined
                ? bool_(g.sortChatsByLastMessage, cur.general.sortChatsByLastMessage)
                : cur.general.sortChatsByLastMessage,
        notificationSound:
            g.notificationSound !== undefined
                ? pickEnum_(g.notificationSound, ["default", "chime", "none"], cur.general.notificationSound)
                : cur.general.notificationSound,
        notifyDeskPanel:
            g.notifyDeskPanel !== undefined
                ? bool_(g.notifyDeskPanel, cur.general.notifyDeskPanel)
                : cur.general.notifyDeskPanel,
        notifyDesktopPopup:
            g.notifyDesktopPopup !== undefined
                ? bool_(g.notifyDesktopPopup, cur.general.notifyDesktopPopup)
                : cur.general.notifyDesktopPopup,
        notifyMobilePopup:
            g.notifyMobilePopup !== undefined
                ? bool_(g.notifyMobilePopup, cur.general.notifyMobilePopup)
                : cur.general.notifyMobilePopup,
        agentProfiles:
            g.agentProfiles !== undefined
                ? normalizeAgentProfiles_(g.agentProfiles)
                : cur.general.agentProfiles,
        routingAlgorithm:
            r.algorithm !== undefined
                ? pickEnum_(r.algorithm, ["round_robin", "online_parallel"], cur.routing.algorithm)
                : cur.routing.algorithm,
        maxConcurrentChats:
            r.maxConcurrentChats !== undefined
                ? clampInt_(r.maxConcurrentChats, 1, 20, cur.routing.maxConcurrentChats)
                : cur.routing.maxConcurrentChats,
        agentInactivityMinutes:
            r.agentInactivityMinutes !== undefined
                ? clampInt_(r.agentInactivityMinutes, 1, 480, cur.routing.agentInactivityMinutes)
                : cur.routing.agentInactivityMinutes,
        exitAgentOnInactive:
            r.exitAgentOnInactive !== undefined
                ? bool_(r.exitAgentOnInactive, cur.routing.exitAgentOnInactive)
                : cur.routing.exitAgentOnInactive,
        access: {
            tabAllChats:
                a.tabAllChats !== undefined ? bool_(a.tabAllChats, cur.access.tabAllChats) : cur.access.tabAllChats,
            tabAllAssigned:
                a.tabAllAssigned !== undefined
                    ? bool_(a.tabAllAssigned, cur.access.tabAllAssigned)
                    : cur.access.tabAllAssigned,
            tabUnassigned:
                a.tabUnassigned !== undefined ? bool_(a.tabUnassigned, cur.access.tabUnassigned) : cur.access.tabUnassigned,
            tabAiChats:
                a.tabAiChats !== undefined ? bool_(a.tabAiChats, cur.access.tabAiChats) : cur.access.tabAiChats,
            tabAgentChats:
                a.tabAgentChats !== undefined ? bool_(a.tabAgentChats, cur.access.tabAgentChats) : cur.access.tabAgentChats,
            tabCompleted:
                a.tabCompleted !== undefined ? bool_(a.tabCompleted, cur.access.tabCompleted) : cur.access.tabCompleted,
            uploadFile:
                a.uploadFile !== undefined ? bool_(a.uploadFile, cur.access.uploadFile) : cur.access.uploadFile,
            viewContact:
                a.viewContact !== undefined
                    ? pickEnum_(a.viewContact, ["all", "assigned", "none"], cur.access.viewContact)
                    : cur.access.viewContact
        },
        reporting: {
            dailyRecipients:
                rep.dailyRecipients !== undefined
                    ? String(rep.dailyRecipients || "")
                    : cur.reporting.dailyRecipients,
            weeklyMonthlyEnabled:
                rep.weeklyMonthlyEnabled !== undefined
                    ? bool_(rep.weeklyMonthlyEnabled, cur.reporting.weeklyMonthlyEnabled)
                    : cur.reporting.weeklyMonthlyEnabled
        },
        queueMaxWaitEnabled:
            p.queueMaxWaitEnabled !== undefined
                ? bool_(p.queueMaxWaitEnabled, cur.queueMaxWaitEnabled)
                : cur.queueMaxWaitEnabled,
        queueMaxWaitMinutes:
            p.queueMaxWaitMinutes !== undefined
                ? clampInt_(p.queueMaxWaitMinutes, 1, 120, cur.queueMaxWaitMinutes)
                : cur.queueMaxWaitMinutes,
        queueTimeoutReply:
            p.queueTimeoutReply !== undefined
                ? String(p.queueTimeoutReply || "")
                : cur.queueTimeoutReply,
        knowledgeBase:
            p.knowledgeBase !== undefined
                ? p.knowledgeBase
                : cur.knowledgeBase,
        businessHours:
            p.businessHours !== undefined
                ? p.businessHours
                : cur.businessHours,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await settingsRef_().set(next, { merge: true });
    return getLiveAgentSettings_();
}

/** Emails allowed to sign in (Settings → agent profiles + department agent lists). */
export async function collectRegisteredAgentEmails_() {
    const emails = new Set();
    try {
        const settings = await getLiveAgentSettings_();
        const profiles =
            settings && settings.general && Array.isArray(settings.general.agentProfiles)
                ? settings.general.agentProfiles
                : [];
        for (let i = 0; i < profiles.length; i += 1) {
            const e = normalizeEmail_(profiles[i] && profiles[i].email);
            if (e && e.includes("@")) {
                emails.add(e);
            }
        }
    } catch (err) {
        console.warn(LOG_TAG, "settings for agent allowlist:", err.message || err);
    }
    try {
        const depts = await listDepartments_();
        for (let di = 0; di < depts.length; di += 1) {
            const list = depts[di].agentEmails || [];
            for (let ei = 0; ei < list.length; ei += 1) {
                const e = normalizeEmail_(list[ei]);
                if (e && e.includes("@")) {
                    emails.add(e);
                }
            }
        }
    } catch (err) {
        console.warn(LOG_TAG, "departments for agent allowlist:", err.message || err);
    }
    return [...emails].sort();
}

/** @param {string} email */
export async function isAgentEmailRegistered_(email) {
    const e = normalizeEmail_(email);
    if (!e || !e.includes("@")) {
        return false;
    }
    const allowUnlisted = trim_(process.env.LIVE_AGENT_ALLOW_UNLISTED_LOGIN).toLowerCase();
    if (allowUnlisted === "1" || allowUnlisted === "true" || allowUnlisted === "yes") {
        return true;
    }
    const registered = await collectRegisteredAgentEmails_();
    if (!registered.length) {
        return false;
    }
    return registered.includes(e);
}

export async function listDepartments_() {
    await ensureGeneralDepartment_();
    const snap = await departmentsCol_().get();
    const rows = snap.docs.map((doc) => serializeDepartment_(doc.id, doc.data()));
    rows.sort((a, b) => {
        if (a.isSystem && !b.isSystem) return -1;
        if (!a.isSystem && b.isSystem) return 1;
        return a.name.localeCompare(b.name);
    });
    return rows;
}

export async function getDepartment_(departmentId) {
    const id = trim_(departmentId) || GENERAL_ID;
    const snap = await departmentsCol_().doc(id).get();
    if (!snap.exists) {
        if (id === GENERAL_ID) return ensureGeneralDepartment_();
        return null;
    }
    return serializeDepartment_(id, snap.data());
}

export async function createDepartment_({ name, agentEmails }) {
    const n = trim_(name);
    if (!n) throw new Error("Department name required");
    let id = slugId_(n);
    const col = departmentsCol_();
    if ((await col.doc(id).get()).exists) {
        id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }
    const emails = Array.isArray(agentEmails)
        ? agentEmails.map(normalizeEmail_).filter(Boolean)
        : [];
    const now = admin.firestore.FieldValue.serverTimestamp();
    const data = {
        name: n,
        agentEmails: [...new Set(emails)],
        isSystem: false,
        roundRobinCursor: 0,
        createdAt: now,
        updatedAt: now
    };
    await col.doc(id).set(data);
    return serializeDepartment_(id, data);
}

export async function updateDepartment_({ departmentId, name, agentEmails }) {
    const id = trim_(departmentId);
    if (!id) throw new Error("departmentId required");
    const ref = departmentsCol_().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Department not found");
    const cur = snap.data() || {};
    /** @type {Record<string, unknown>} */
    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (name !== undefined && !cur.isSystem) {
        patch.name = trim_(name) || cur.name;
    }
    if (agentEmails !== undefined) {
        const emails = Array.isArray(agentEmails)
            ? agentEmails.map(normalizeEmail_).filter(Boolean)
            : [];
        patch.agentEmails = [...new Set(emails)];
    }
    await ref.update(patch);
    const next = await ref.get();
    return serializeDepartment_(id, next.data());
}

export async function deleteDepartment_(departmentId) {
    const id = trim_(departmentId);
    if (!id || id === GENERAL_ID) throw new Error("Cannot delete General Department");
    const ref = departmentsCol_().doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Department not found");
    if (snap.data()?.isSystem) throw new Error("Cannot delete system department");
    await ref.delete();
    return { ok: true, id };
}

export function resolveDepartmentId_(requested, settings) {
    const id = trim_(requested) || trim_(settings?.defaultDepartmentId) || GENERAL_ID;
    return id;
}

export async function agentInDepartment_(agentEmail, departmentId) {
    const email = normalizeEmail_(agentEmail);
    if (!email) return false;
    const dept = await getDepartment_(departmentId);
    if (!dept) return false;
    if (!dept.agentEmails.length) return true;
    return dept.agentEmails.includes(email);
}

export async function pickRoundRobinAssignee_(departmentId) {
    const dept = await getDepartment_(departmentId);
    if (!dept) return { assigneeEmail: "", roundIndex: 0, departmentName: "General" };
    const pool = dept.agentEmails || [];
    if (!pool.length) {
        return { assigneeEmail: "", roundIndex: 0, departmentName: dept.name };
    }
    const idx = ((dept.roundRobinCursor || 0) % pool.length + pool.length) % pool.length;
    const assigneeEmail = pool[idx];
    const nextCursor = (idx + 1) % pool.length;
    await departmentsCol_().doc(dept.id).update({
        roundRobinCursor: nextCursor,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { assigneeEmail, roundIndex: idx, departmentName: dept.name };
}

export function logDept_(msg, extra) {
    if (extra !== undefined) console.warn(LOG_TAG, msg, extra);
    else console.warn(LOG_TAG, msg);
}
