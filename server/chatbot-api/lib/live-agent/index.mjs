/**
 * Live human-agent handoff — drop-in Express module.
 *
 * Static agent inbox:
 *   GET  /live-agent              → agent chat dashboard SPA
 *
 * Agent API (CONVERSATIONS_SHEET_VIEW_SECRET via X-Conversations-Sheet-Secret):
 *   GET  /api/live-agent/me
 *   GET  /api/live-agent/inbox?status=waiting|active|mine|all
 *   POST /api/live-agent/claim              { conversationId }
 *   GET  /api/live-agent/conversations/:id/messages?since=
 *   POST /api/live-agent/conversations/:id/messages   { text }
 *   POST /api/live-agent/conversations/:id/close
 *
 * Widget / visitor API (public, CORS *):
 *   POST /api/live-agent/request            { clientSessionId, botid?, visitorName?, initialMessage? }
 *   GET  /api/live-agent/status?clientSessionId=
 *   GET  /api/live-agent/messages?clientSessionId=&since=
 *   POST /api/live-agent/visitor-message    { clientSessionId, text }
 *   POST /api/live-agent/visitor-typing     { clientSessionId, text, active? }
 *   GET  /api/live-agent/sync?clientSessionId=&rev=&waitMs=&lastMessageId=
 *   GET  /api/live-agent/typing-pulse?clientSessionId=&rev=&lastMessageId=
 *
 * Agent auth: CONVERSATIONS_SHEET_VIEW_SECRET (header X-Conversations-Sheet-Secret).
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import express from "express";

import {
    conversationsViewSecret_,
    liveAgentAuthConfigured_,
    liveAgentAuthRequired_,
    liveAgentSecretFromReq_,
    readLiveAgentSessionFromReq_,
    requireLiveAgentSession_
} from "./auth.mjs";
import { getVisitorContext_ } from "./context.mjs";
import {
    appendMessage_,
    isLiveAgentAiCopilot_,
    bulkCloseTestConversations_,
    acceptConversation_,
    claimConversation_,
    reopenConversationForAgent_,
    closeConversation_,
    getConversation_,
    listInbox_,
    listMessages_,
    liveAgentFirestoreReady_,
    logStoreError_,
    requestHumanAgent_,
    resolveConversationId_,
    updateConversationMode_,
    transferConversation_
} from "./store.mjs";
import {
    createDepartment_,
    deleteDepartment_,
    getLiveAgentSettings_,
    listDepartments_,
    saveLiveAgentSettings_,
    updateDepartment_
} from "./departments.mjs";
import { cacheVisitorRequest_, getCachedVisitorRequest_ } from "./request-dedupe.mjs";
import {
    getAgentByEmail_,
    listAgentActivity_,
    listAgentsOverview_,
    touchAgentPresence_
} from "./agents.mjs";
import {
    conversationRevision_,
    getTypingState_,
    liveSyncPoll_,
    listDeskMessages_,
    updateAgentTyping_,
    updateVisitorTyping_
} from "./desk-realtime.mjs";

const LOG_TAG = "[live-agent]";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname_lib, "..", "..", "live-agent");
const requireRefer_ = createRequire(pathToFileURL(path.join(__dirname_lib, "..", "refer-staff", "package.json")));

function referKnowledge_() {
    return requireRefer_(path.join(__dirname_lib, "..", "refer-staff", "live-agent-knowledge.js"));
}

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

function setNoCache_(res) {
    res.setHeader("Cache-Control", "no-store");
}

function setPublicCors_(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeClientSessionId_(raw) {
    try {
        return resolveConversationId_(raw);
    } catch {
        return "";
    }
}

function jsonError_(res, status, message) {
    res.status(status).json({ ok: false, error: message });
}

function visitorAgentChatActive_(conv) {
    if (!conv || conv.status !== "active") {
        return false;
    }
    if (isLiveAgentAiCopilot_(conv)) {
        return false;
    }
    const hm = trim_(conv.humanMode).toLowerCase();
    if (hm === "ai") {
        return false;
    }
    if (hm === "human" || conv.aiEnabled === false) {
        return true;
    }
    return !!(trim_(conv.assignedAgentEmail) && hm !== "ai");
}

async function buildVisitorSyncPayload_(clientSessionId, clientRev, waitMs, lastMessageId) {
    const id = clientSessionId;
    const rev = Number(clientRev) || 0;
    const wait = Math.min(Math.max(Number(waitMs) || 0, 0), 28000);
    const lastId = trim_(lastMessageId);
    let base;
    if (wait > 0) {
        base = await liveSyncPoll_({
            conversationId: id,
            clientRev: rev,
            waitMs: wait,
            lastMessageId: lastId || undefined
        });
    } else {
        const typing = await getTypingState_(id);
        const conversation = await getConversation_(id);
        const messages = await listMessages_({
            conversationId: id,
            limit: 50,
            markReadFor: "visitor"
        });
        base = {
            ok: true,
            unchanged: false,
            revision: typing.revision,
            visitorTyping: typing.visitorTyping,
            agentTyping: typing.agentTypingVisitor,
            lastMessageId: typing.lastMessageId,
            conversation,
            messages
        };
    }
    const conversation = base.conversation || (await getConversation_(id));
    const assigned = trim_(conversation && conversation.assignedAgentEmail);
    const agentConnected = !!(
        conversation &&
        conversation.status === "active" &&
        assigned
    );
    const humanHandoffActive = visitorAgentChatActive_(conversation);
    const aiCopilot = isLiveAgentAiCopilot_(conversation);
    const { getLiveAgentSettings_, resolveAgentDisplayName_ } = await import("./departments.mjs");
    const settings = await getLiveAgentSettings_();
    let assignedAgentDisplayName = "";
    if (assigned) {
        assignedAgentDisplayName = resolveAgentDisplayName_(assigned, settings);
    }
    const agentProfiles =
        settings && settings.general && settings.general.agentProfiles
            ? settings.general.agentProfiles
            : [];
    return {
        ...base,
        conversation,
        agentConnected,
        humanHandoffActive,
        humanActive: humanHandoffActive,
        waitingForAgent: !!(conversation && conversation.status === "waiting"),
        aiCopilot,
        assignedAgentDisplayName,
        agentProfiles,
        aiEnabled: conversation ? conversation.aiEnabled !== false : true,
        humanMode: conversation && conversation.humanMode ? conversation.humanMode : "ai"
    };
}

function sendHealthJson_(res) {
    setNoCache_(res);
    res.json({
        ok: true,
        firestore_ready: liveAgentFirestoreReady_(),
        auth_required: liveAgentAuthRequired_(),
        auth_configured: liveAgentAuthConfigured_(),
        auth_mode: "conversations_sheet_secret"
    });
}

/**
 * @param {import('express').Express} app
 */
/**
 * @param {import('express').Express} app
 */
export function mountLiveAgentRoutes(app) {
    app.get("/live-agent/health", (_req, res) => sendHealthJson_(res));
    app.get("/api/live-agent/health", (_req, res) => sendHealthJson_(res));

    app.use(
        "/live-agent",
        express.static(STATIC_DIR, {
            index: ["index.html"],
            extensions: ["html"],
            setHeaders(res, filePath) {
                if (filePath.toLowerCase().endsWith(".html")) {
                    res.setHeader("Cache-Control", "no-cache");
                }
            }
        })
    );

    const router = express.Router();
    router.use(express.json({ limit: "256kb" }));

    router.get("/me", async (req, res) => {
        setNoCache_(res);
        if (!liveAgentAuthRequired_()) {
            res.json({
                ok: true,
                agentId: trim_(process.env.LIVE_AGENT_DEV_AGENT_NAME) || "dev"
            });
            return;
        }
        if (!conversationsViewSecret_()) {
            res.status(503).json({
                ok: false,
                error:
                    "Server has no CONVERSATIONS_SHEET_VIEW_SECRET. Set it in Railway Variables (same as conversations inbox)."
            });
            return;
        }
        const sess = readLiveAgentSessionFromReq_(req);
        if (!sess) {
            const check = liveAgentSecretFromReq_(req);
            const msg =
                check.reason === "bad"
                    ? "Unauthorized — secret does not match CONVERSATIONS_SHEET_VIEW_SECRET."
                    : "Unauthorized — send header X-Conversations-Sheet-Secret matching CONVERSATIONS_SHEET_VIEW_SECRET.";
            res.status(401).json({ ok: false, error: msg });
            return;
        }
        const email = trim_(sess.agentId).toLowerCase();
        if (email.includes("@")) {
            try {
                const { isAgentEmailRegistered_ } = await import("./departments.mjs");
                if (!(await isAgentEmailRegistered_(email))) {
                    res.status(403).json({
                        ok: false,
                        error:
                            "This email is not registered for the agent desk. Add it in Live Agent Settings."
                    });
                    return;
                }
            } catch (allowErr) {
                logStoreError_(allowErr, "me allowlist");
            }
        }
        res.json({ ok: true, agentId: sess.agentId });
    });

    router.get("/inbox", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        if (!liveAgentFirestoreReady_()) {
            jsonError_(res, 503, "Firestore not configured (FIREBASE_SERVICE_ACCOUNT_JSON).");
            return;
        }
        try {
            const status = trim_(req.query && req.query.status) || "all";
            const limit = Number(req.query && req.query.limit);
            const light =
                trim_(req.query && req.query.light) === "1" ||
                trim_(req.query && req.query.light).toLowerCase() === "true";
            const conversations = await listInbox_({
                status,
                agentEmail: req.liveAgentSession.agentId,
                limit: Number.isFinite(limit) ? limit : 80,
                skipEscalation: light
            });
            res.json({ ok: true, conversations, status, count: conversations.length });
        } catch (err) {
            logStoreError_(err, "inbox");
            jsonError_(res, 500, err.message || "Inbox failed");
        }
    });

    router.post("/bulk-close-tests", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        if (!liveAgentFirestoreReady_()) {
            jsonError_(res, 503, "Firestore not configured (FIREBASE_SERVICE_ACCOUNT_JSON).");
            return;
        }
        const idPrefix = trim_(req.body && req.body.idPrefix) || "test-";
        const limit = Number(req.body && req.body.limit);
        try {
            const result = await bulkCloseTestConversations_({
                idPrefix,
                agentEmail: req.liveAgentSession.agentId,
                maxClose: Number.isFinite(limit) ? limit : 150
            });
            res.json({ ok: true, ...result });
        } catch (err) {
            logStoreError_(err, "bulk-close-tests");
            jsonError_(res, 400, err.message || "Bulk close failed");
        }
    });

    async function handleAccept_(req, res) {
        setNoCache_(res);
        let conversationId = "";
        try {
            conversationId = resolveConversationId_(req.body && req.body.conversationId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "Invalid conversation id");
            return;
        }
        try {
            const conversation = await acceptConversation_({
                conversationId,
                agentEmail: req.liveAgentSession.agentId
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "accept");
            jsonError_(res, 400, err.message || "Accept failed");
        }
    }

    router.post("/accept", requireLiveAgentSession_(), handleAccept_);
    router.post("/claim", requireLiveAgentSession_(), handleAccept_);

    router.get("/settings", requireLiveAgentSession_(), async (_req, res) => {
        setNoCache_(res);
        try {
            const settings = await getLiveAgentSettings_();
            const departments = await listDepartments_();
            const knowledge = referKnowledge_();
            const knowledgeBase = knowledge.normalizeKnowledgeBase(settings.knowledgeBase);
            res.json({
                ok: true,
                settings,
                departments,
                knowledgeBase
            });
        } catch (err) {
            logStoreError_(err, "settings get");
            jsonError_(res, 500, err.message || "Settings failed");
        }
    });

    router.get("/knowledge/search", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const q = trim_(req.query && (req.query.q || req.query.query));
        if (!q) {
            res.json({ ok: true, results: [] });
            return;
        }
        try {
            const settings = await getLiveAgentSettings_();
            const knowledge = referKnowledge_();
            const departmentId =
                trim_(req.query && (req.query.departmentId || req.query.department)) || "general";
            const results = knowledge.searchKnowledgeBase(settings.knowledgeBase, {
                query: q,
                departmentId,
                limit: Number(req.query && req.query.limit) || 12
            });
            res.json({ ok: true, results });
        } catch (err) {
            logStoreError_(err, "knowledge search");
            jsonError_(res, 500, err.message || "Knowledge search failed");
        }
    });

    router.put("/settings", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        try {
            const patch = req.body && typeof req.body === "object" ? req.body : {};
            const knowledge = referKnowledge_();
            if (patch.knowledgeBase != null) {
                patch.knowledgeBase = knowledge.normalizeKnowledgeBase(patch.knowledgeBase);
            }
            const settings = await saveLiveAgentSettings_(patch);
            const departments = await listDepartments_();
            try {
                const { refreshDeskSettingsCache_ } = await import("./store.mjs");
                await refreshDeskSettingsCache_();
            } catch (_) {
                /* ignore */
            }
            res.json({
                ok: true,
                settings,
                departments,
                knowledgeBase: knowledge.normalizeKnowledgeBase(settings.knowledgeBase)
            });
        } catch (err) {
            logStoreError_(err, "settings put");
            jsonError_(res, 400, err.message || "Settings save failed");
        }
    });

    router.get("/departments", requireLiveAgentSession_(), async (_req, res) => {
        setNoCache_(res);
        try {
            const departments = await listDepartments_();
            res.json({ ok: true, departments });
        } catch (err) {
            jsonError_(res, 500, err.message || "Departments failed");
        }
    });

    router.post("/departments", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        try {
            const department = await createDepartment_({
                name: req.body && req.body.name,
                agentEmails: req.body && req.body.agentEmails
            });
            res.json({ ok: true, department });
        } catch (err) {
            jsonError_(res, 400, err.message || "Create department failed");
        }
    });

    router.put("/departments/:id", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const id = trim_(req.params && req.params.id);
        try {
            const department = await updateDepartment_({
                departmentId: id,
                name: req.body && req.body.name,
                agentEmails: req.body && req.body.agentEmails
            });
            res.json({ ok: true, department });
        } catch (err) {
            jsonError_(res, 400, err.message || "Update department failed");
        }
    });

    router.delete("/departments/:id", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const id = trim_(req.params && req.params.id);
        try {
            const result = await deleteDepartment_(id);
            res.json({ ok: true, ...result });
        } catch (err) {
            jsonError_(res, 400, err.message || "Delete department failed");
        }
    });

    router.post("/presence", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        try {
            const agent = await touchAgentPresence_({
                agentEmail: req.liveAgentSession.agentId,
                status: req.body && req.body.status
            });
            res.json({ ok: true, agent });
        } catch (err) {
            jsonError_(res, 400, err.message || "Presence update failed");
        }
    });

    router.get("/agents", requireLiveAgentSession_(), async (_req, res) => {
        setNoCache_(res);
        try {
            const agents = await listAgentsOverview_();
            res.json({ ok: true, agents });
        } catch (err) {
            jsonError_(res, 500, err.message || "Agents list failed");
        }
    });

    router.get("/agents/:email", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const email = trim_(req.params && req.params.email);
        if (!email) {
            jsonError_(res, 400, "Agent email required");
            return;
        }
        try {
            const data = await getAgentByEmail_(email);
            res.json({ ok: true, ...data });
        } catch (err) {
            jsonError_(res, 400, err.message || "Agent lookup failed");
        }
    });

    router.get("/activity", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        try {
            const limit = Number(req.query && req.query.limit);
            const agentEmail = trim_(req.query && req.query.agentEmail);
            const activity = await listAgentActivity_({
                agentEmail: agentEmail || undefined,
                limit: Number.isFinite(limit) ? limit : 50
            });
            res.json({ ok: true, activity });
        } catch (err) {
            jsonError_(res, 500, err.message || "Activity list failed");
        }
    });

    router.get("/conversations/:id/messages", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        try {
            const since = trim_(req.query && req.query.since);
            const sinceId = trim_(req.query && req.query.sinceId);
            const limitRaw = Number(req.query && req.query.limit);
            const markRead = trim_(req.query && req.query.markRead) === "1";
            const messages = await listDeskMessages_({
                conversationId,
                sinceIso: since || undefined,
                sinceId: sinceId || undefined,
                limit: Number.isFinite(limitRaw) ? limitRaw : 80,
                markReadFor: markRead ? "agent" : undefined,
                viewingAgentEmail: req.liveAgentSession && req.liveAgentSession.agentId
            });
            const conversation = await getConversation_(conversationId);
            const typing = await getTypingState_(conversationId);
            res.json({
                ok: true,
                messages,
                conversation,
                revision: typing.revision || conversationRevision_(conversation),
                visitorTyping: typing.visitorTyping,
                agentTyping: typing.agentTyping
            });
        } catch (err) {
            logStoreError_(err, "agent messages");
            jsonError_(res, 500, err.message || "Failed to load messages");
        }
    });

    router.get("/conversations/:id/typing-pulse", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        try {
            const clientRev = Number(req.query && (req.query.rev || req.query.revision)) || 0;
            const clientLastMsgId = trim_(req.query && req.query.lastMessageId);
            const typing = await getTypingState_(conversationId);
            const rev = Math.max(clientRev, typing.revision);
            const visitorTyping = typing.visitorTyping;
            const agentTyping = typing.agentTyping;
            const lastMessageId = typing.lastMessageId;
            const typingChanged =
                visitorTyping !== trim_(req.query && req.query.visitorTyping) ||
                agentTyping !== trim_(req.query && req.query.agentTyping);
            const messageHint = !!(lastMessageId && clientLastMsgId && lastMessageId !== clientLastMsgId);
            res.json({
                ok: true,
                revision: rev,
                visitorTyping,
                agentTyping,
                lastMessageId,
                changed: rev > clientRev || typingChanged || messageHint,
                newMessage: messageHint
            });
        } catch (err) {
            logStoreError_(err, "typing-pulse");
            jsonError_(res, 500, err.message || "Typing pulse failed");
        }
    });

    router.get("/conversations/:id/live-sync", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        try {
            const payload = await liveSyncPoll_({
                conversationId,
                clientRev: Number(req.query && (req.query.rev || req.query.revision)) || 0,
                waitMs: Number(req.query && (req.query.wait || req.query.waitMs)) || 900,
                sinceId: trim_(req.query && req.query.sinceId),
                lastMessageId: trim_(req.query && (req.query.lastMessageId || req.query.sinceId)),
                viewingAgentEmail: req.liveAgentSession && req.liveAgentSession.agentId
            });
            res.json(payload);
        } catch (err) {
            logStoreError_(err, "live-sync");
            jsonError_(res, 500, err.message || "Live sync failed");
        }
    });

    router.post("/conversations/:id/typing", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        const text = trim_(req.body && req.body.text);
        const active = !(req.body && req.body.active === false);
        try {
            const result = await updateAgentTyping_({
                conversationId,
                text,
                active,
                agentEmail: req.liveAgentSession.agentId
            });
            res.json({
                ok: true,
                revision: result.revision,
                conversation: result.conversation
            });
        } catch (err) {
            logStoreError_(err, "typing");
            jsonError_(res, 400, err.message || "Typing failed");
        }
    });

    router.post("/conversations/:id/messages", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        let conversationId = "";
        try {
            conversationId = resolveConversationId_(req.params && req.params.id);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "Invalid conversation id");
            return;
        }
        const text = trim_(req.body && req.body.text);
        if (!text) {
            jsonError_(res, 400, "text required");
            return;
        }
        const me = trim_(req.liveAgentSession.agentId).toLowerCase();
        if (!me.includes("@")) {
            jsonError_(res, 400, "Sign in with your work email to send messages");
            return;
        }
        try {
            let conv = await getConversation_(conversationId);
            if (!conv) {
                jsonError_(res, 404, "Conversation not found");
                return;
            }
            if (conv.status === "closed") {
                jsonError_(res, 400, "Conversation is closed — reopen it first");
                return;
            }
            if (conv.status === "waiting") {
                conv = await acceptConversation_({
                    conversationId,
                    agentEmail: me
                });
            }
            const assignee = trim_(conv.assignedAgentEmail).toLowerCase();
            if (conv.status === "active" && assignee && assignee !== me) {
                jsonError_(res, 403, "Assigned to another agent");
                return;
            }
            if (isLiveAgentAiCopilot_(conv)) {
                jsonError_(
                    res,
                    409,
                    "Take over required — chatbot is replying to the visitor. Click Take over on the desk to send as agent."
                );
                return;
            }
            const message = await appendMessage_({
                conversationId,
                role: "agent",
                text,
                senderEmail: me,
                bumpUnread: { agent: 0, visitor: 1 }
            });
            const conversation = await getConversation_(conversationId);
            res.json({ ok: true, message, conversation });
        } catch (err) {
            logStoreError_(err, "agent send");
            jsonError_(res, 400, err.message || "Send failed");
        }
    });

    router.post("/conversations/:id/reopen", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        if (!liveAgentFirestoreReady_()) {
            jsonError_(res, 503, "Firestore not configured (FIREBASE_SERVICE_ACCOUNT_JSON).");
            return;
        }
        try {
            const conversation = await reopenConversationForAgent_({
                conversationId,
                agentEmail: req.liveAgentSession.agentId
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "reopen");
            jsonError_(res, 400, err.message || "Reopen failed");
        }
    });

    router.post("/conversations/:id/close", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        try {
            const conversation = await closeConversation_({
                conversationId,
                closedBy: "agent",
                agentEmail: req.liveAgentSession.agentId
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "close");
            jsonError_(res, 400, err.message || "Close failed");
        }
    });

    router.get("/conversations/:id/context", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
            return;
        }
        try {
            const conversation = await getConversation_(conversationId);
            const visitor = await getVisitorContext_(conversationId, { conversation });
            res.json({ ok: true, conversation, visitor });
        } catch (err) {
            logStoreError_(err, "context");
            jsonError_(res, 500, err.message || "Context failed");
        }
    });

    router.post("/conversations/:id/transfer", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        let conversationId = "";
        try {
            conversationId = resolveConversationId_(req.params && req.params.id);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "Invalid conversation id");
            return;
        }
        const toAgentEmail = trim_(req.body && req.body.toAgentEmail);
        if (!toAgentEmail) {
            jsonError_(res, 400, "toAgentEmail required");
            return;
        }
        try {
            const conversation = await transferConversation_({
                conversationId,
                fromAgentEmail: req.liveAgentSession.agentId,
                toAgentEmail
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "transfer");
            jsonError_(res, 400, err.message || "Transfer failed");
        }
    });

    router.post("/conversations/:id/mode", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        let conversationId = "";
        try {
            conversationId = resolveConversationId_(req.params && req.params.id);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "Invalid conversation id");
            return;
        }
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const aiEnabled =
            typeof body.aiEnabled === "boolean" ? body.aiEnabled : undefined;
        const humanMode = trim_(body.humanMode);
        try {
            const conversation = await updateConversationMode_({
                conversationId,
                aiEnabled,
                humanMode: humanMode || undefined,
                agentEmail: req.liveAgentSession && req.liveAgentSession.agentId
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "mode");
            jsonError_(res, 400, err.message || "Mode update failed");
        }
    });

    app.use("/api/live-agent", router);

    // --- Visitor / widget endpoints ------------------------------------------
    const publicRouter = express.Router();
    publicRouter.use(express.json({ limit: "128kb" }));

    publicRouter.options("*", (_req, res) => {
        setPublicCors_(res);
        res.status(204).end();
    });

    publicRouter.post("/request", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        const clientSessionId = safeClientSessionId_(req.body && req.body.clientSessionId);
        if (!clientSessionId) {
            jsonError_(res, 400, "clientSessionId required");
            return;
        }
        if (!liveAgentFirestoreReady_()) {
            jsonError_(res, 503, "Live agent storage not configured");
            return;
        }
        try {
            const cached = getCachedVisitorRequest_(clientSessionId);
            if (cached) {
                res.json({ ok: true, ...cached, deduped: true });
                return;
            }
            const result = await requestHumanAgent_({
                conversationId: clientSessionId,
                botid: req.body && req.body.botid,
                visitorName: req.body && req.body.visitorName,
                initialMessage: req.body && req.body.initialMessage,
                departmentId: req.body && req.body.departmentId
            });
            const payload = { ...result, deduped: false };
            cacheVisitorRequest_(clientSessionId, payload);
            res.json({ ok: true, ...payload });
        } catch (err) {
            logStoreError_(err, "request");
            jsonError_(res, 500, err.message || "Request failed");
        }
    });

    publicRouter.get("/status", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.query && req.query.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        try {
            const conversation = await getConversation_(clientSessionId);
            const humanActive = !!(
                conversation &&
                (conversation.status === "waiting" || conversation.status === "active")
            );
            const agentConnected = !!(
                conversation &&
                conversation.status === "active" &&
                trim_(conversation.assignedAgentEmail)
            );
            const aiCopilot = !!(
                conversation &&
                conversation.status === "active" &&
                trim_(conversation.humanMode).toLowerCase() === "ai" &&
                conversation.aiEnabled !== false
            );
            const { getLiveAgentSettings_, resolveAgentDisplayName_ } = await import(
                "./departments.mjs"
            );
            const settings = await getLiveAgentSettings_();
            let assignedAgentDisplayName = "";
            if (conversation && conversation.assignedAgentEmail) {
                assignedAgentDisplayName = resolveAgentDisplayName_(
                    conversation.assignedAgentEmail,
                    settings
                );
            }
            const agentProfiles =
                settings && settings.general && settings.general.agentProfiles
                    ? settings.general.agentProfiles
                    : [];
            res.json({
                ok: true,
                conversation,
                humanActive,
                agentConnected,
                aiCopilot,
                assignedAgentDisplayName,
                agentProfiles,
                aiEnabled: conversation ? conversation.aiEnabled !== false : true,
                humanMode: conversation && conversation.humanMode ? conversation.humanMode : "ai"
            });
        } catch (err) {
            logStoreError_(err, "status");
            jsonError_(res, 500, err.message || "Status failed");
        }
    });

    publicRouter.get("/messages", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.query && req.query.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        try {
            const since = trim_(req.query && req.query.since);
            const limitRaw = Number(req.query && req.query.limit);
            const messages = await listMessages_({
                conversationId: clientSessionId,
                sinceIso: since || undefined,
                limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
                markReadFor: "visitor"
            });
            const { getLiveAgentSettings_ } = await import("./departments.mjs");
            const settings = await getLiveAgentSettings_();
            const agentProfiles =
                settings && settings.general && settings.general.agentProfiles
                    ? settings.general.agentProfiles
                    : [];
            res.json({ ok: true, messages, agentProfiles });
        } catch (err) {
            logStoreError_(err, "visitor messages");
            jsonError_(res, 500, err.message || "Failed to load messages");
        }
    });

    publicRouter.get("/sync", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.query && req.query.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        try {
            const payload = await buildVisitorSyncPayload_(
                clientSessionId,
                Number(req.query && (req.query.rev || req.query.revision)) || 0,
                Number(req.query && (req.query.wait || req.query.waitMs)) || 0,
                trim_(req.query && (req.query.lastMessageId || req.query.sinceId))
            );
            res.json(payload);
        } catch (err) {
            logStoreError_(err, "visitor sync");
            jsonError_(res, 500, err.message || "Sync failed");
        }
    });

    publicRouter.get("/typing-pulse", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.query && req.query.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        try {
            const clientRev = Number(req.query && (req.query.rev || req.query.revision)) || 0;
            const clientLastMsgId = trim_(req.query && req.query.lastMessageId);
            const typing = await getTypingState_(clientSessionId);
            const conversation = await getConversation_(clientSessionId);
            const rev = Math.max(clientRev, typing.revision);
            const agentTyping = typing.agentTypingVisitor;
            const lastMessageId = typing.lastMessageId;
            const messageHint = !!(lastMessageId && clientLastMsgId && lastMessageId !== clientLastMsgId);
            res.json({
                ok: true,
                revision: rev,
                agentTyping,
                lastMessageId,
                conversation,
                agentConnected: !!(
                    conversation &&
                    conversation.status === "active" &&
                    trim_(conversation.assignedAgentEmail)
                ),
                humanHandoffActive: visitorAgentChatActive_(conversation),
                changed: rev > clientRev || messageHint,
                newMessage: messageHint
            });
        } catch (err) {
            logStoreError_(err, "visitor typing-pulse");
            jsonError_(res, 500, err.message || "Typing pulse failed");
        }
    });

    publicRouter.post("/visitor-typing", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.body && req.body.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        const text = typeof (req.body && req.body.text) === "string" ? req.body.text : "";
        const active = !(req.body && req.body.active === false);
        try {
            const result = await updateVisitorTyping_({
                conversationId: clientSessionId,
                text,
                active
            });
            res.json({ ok: true, ...result });
        } catch (err) {
            logStoreError_(err, "visitor typing");
            jsonError_(res, 400, err.message || "Visitor typing failed");
        }
    });

    publicRouter.post("/visitor-message", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        let clientSessionId = "";
        try {
            clientSessionId = resolveConversationId_(req.body && req.body.clientSessionId);
        } catch (idErr) {
            jsonError_(res, 400, idErr.message || "clientSessionId required");
            return;
        }
        const text = trim_(req.body && req.body.text);
        if (!text) {
            jsonError_(res, 400, "text required");
            return;
        }
        try {
            const conv = await getConversation_(clientSessionId);
            if (!conv || conv.status === "closed") {
                jsonError_(res, 400, "No active human chat");
                return;
            }
            if (isLiveAgentAiCopilot_(conv)) {
                jsonError_(
                    res,
                    409,
                    "Chatbot is handling this chat — visitor messages are not routed to the agent inbox"
                );
                return;
            }
            let message;
            try {
                message = await appendMessage_({
                    conversationId: clientSessionId,
                    role: "visitor",
                    text,
                    senderEmail: "",
                    bumpUnread: { agent: 1, visitor: 0 }
                });
            } catch (appendErr) {
                if (/duplicate visitor message/i.test(appendErr.message || "")) {
                    const conversation = await getConversation_(clientSessionId);
                    res.json({ ok: true, deduped: true, conversation });
                    return;
                }
                throw appendErr;
            }
            const conversation = await getConversation_(clientSessionId);
            const typing = await getTypingState_(clientSessionId);
            const assigned = trim_(conversation && conversation.assignedAgentEmail);
            const agentConnected = !!(
                conversation &&
                conversation.status === "active" &&
                assigned
            );
            res.json({
                ok: true,
                message,
                conversation,
                deduped: false,
                revision: typing.revision,
                lastMessageId: typing.lastMessageId,
                agentConnected,
                humanHandoffActive: visitorAgentChatActive_(conversation),
                aiCopilot: isLiveAgentAiCopilot_(conversation)
            });
        } catch (err) {
            logStoreError_(err, "visitor send");
            jsonError_(res, 400, err.message || "Send failed");
        }
    });

    app.use("/api/live-agent", publicRouter);

    console.log(LOG_TAG, "mounted /live-agent + /api/live-agent/* (+ /live-agent/health)");
}
