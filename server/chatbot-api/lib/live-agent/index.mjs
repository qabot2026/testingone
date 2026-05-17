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
 *
 * Agent auth: CONVERSATIONS_SHEET_VIEW_SECRET (header X-Conversations-Sheet-Secret).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

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
    bulkCloseTestConversations_,
    claimConversation_,
    closeConversation_,
    getConversation_,
    listInbox_,
    listMessages_,
    liveAgentFirestoreReady_,
    logStoreError_,
    requestHumanAgent_,
    updateConversationMode_
} from "./store.mjs";

const LOG_TAG = "[live-agent]";

const __dirname_lib = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname_lib, "..", "..", "live-agent");

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
    const s = trim_(raw);
    if (!s || s.length > 128 || !/^[A-Za-z0-9._-]+$/.test(s)) {
        return "";
    }
    return s;
}

function jsonError_(res, status, message) {
    res.status(status).json({ ok: false, error: message });
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
function sendLiveAgentIndex_(res, next) {
    const indexPath = path.join(STATIC_DIR, "index.html");
    fs.access(indexPath)
        .then(() => res.sendFile(indexPath))
        .catch(() => next());
}

export function mountLiveAgentRoutes(app) {
    app.get("/live-agent/health", (_req, res) => sendHealthJson_(res));
    app.get("/api/live-agent/health", (_req, res) => sendHealthJson_(res));

    app.get("/live-agent", (_req, res, next) => sendLiveAgentIndex_(res, next));
    app.get("/live-agent/", (_req, res, next) => sendLiveAgentIndex_(res, next));

    app.use("/live-agent", express.static(STATIC_DIR, {
        index: ["index.html"],
        extensions: ["html"],
        setHeaders(res, filePath) {
            if (filePath.toLowerCase().endsWith(".html")) {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    }));

    const router = express.Router();
    router.use(express.json({ limit: "256kb" }));

    router.get("/me", (req, res) => {
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
            const conversations = await listInbox_({
                status,
                agentEmail: req.liveAgentSession.agentId,
                limit: Number.isFinite(limit) ? limit : 50
            });
            res.json({ ok: true, conversations });
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

    router.post("/claim", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.body && req.body.conversationId);
        if (!conversationId) {
            jsonError_(res, 400, "conversationId required");
            return;
        }
        try {
            const conversation = await claimConversation_({
                conversationId,
                agentEmail: req.liveAgentSession.agentId
            });
            res.json({ ok: true, conversation });
        } catch (err) {
            logStoreError_(err, "claim");
            jsonError_(res, 400, err.message || "Claim failed");
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
            const messages = await listMessages_({
                conversationId,
                sinceIso: since || undefined,
                markReadFor: "agent"
            });
            res.json({ ok: true, messages });
        } catch (err) {
            logStoreError_(err, "agent messages");
            jsonError_(res, 500, err.message || "Failed to load messages");
        }
    });

    router.post("/conversations/:id/messages", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        const text = trim_(req.body && req.body.text);
        if (!conversationId || !text) {
            jsonError_(res, 400, "conversation id and text required");
            return;
        }
        try {
            const conv = await getConversation_(conversationId);
            if (!conv) {
                jsonError_(res, 404, "Conversation not found");
                return;
            }
            const assignee = trim_(conv.assignedAgentEmail).toLowerCase();
            const me = trim_(req.liveAgentSession.agentId).toLowerCase();
            if (conv.status === "active" && assignee && assignee !== me) {
                jsonError_(res, 403, "Assigned to another agent");
                return;
            }
            const message = await appendMessage_({
                conversationId,
                role: "agent",
                text,
                senderEmail: req.liveAgentSession.agentId,
                bumpUnread: { agent: 0, visitor: 1 }
            });
            res.json({ ok: true, message });
        } catch (err) {
            logStoreError_(err, "agent send");
            jsonError_(res, 400, err.message || "Send failed");
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
            const visitor = await getVisitorContext_(conversationId);
            res.json({ ok: true, conversation, visitor });
        } catch (err) {
            logStoreError_(err, "context");
            jsonError_(res, 500, err.message || "Context failed");
        }
    });

    router.post("/conversations/:id/mode", requireLiveAgentSession_(), async (req, res) => {
        setNoCache_(res);
        const conversationId = safeClientSessionId_(req.params && req.params.id);
        if (!conversationId) {
            jsonError_(res, 400, "Invalid conversation id");
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
                humanMode: humanMode || undefined
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
            const result = await requestHumanAgent_({
                conversationId: clientSessionId,
                botid: req.body && req.body.botid,
                visitorName: req.body && req.body.visitorName,
                initialMessage: req.body && req.body.initialMessage
            });
            res.json({ ok: true, ...result });
        } catch (err) {
            logStoreError_(err, "request");
            jsonError_(res, 500, err.message || "Request failed");
        }
    });

    publicRouter.get("/status", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        const clientSessionId = safeClientSessionId_(req.query && req.query.clientSessionId);
        if (!clientSessionId) {
            jsonError_(res, 400, "clientSessionId required");
            return;
        }
        try {
            const conversation = await getConversation_(clientSessionId);
            res.json({
                ok: true,
                conversation,
                humanActive: !!(conversation && (conversation.status === "waiting" || conversation.status === "active")),
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
        const clientSessionId = safeClientSessionId_(req.query && req.query.clientSessionId);
        if (!clientSessionId) {
            jsonError_(res, 400, "clientSessionId required");
            return;
        }
        try {
            const since = trim_(req.query && req.query.since);
            const messages = await listMessages_({
                conversationId: clientSessionId,
                sinceIso: since || undefined,
                markReadFor: "visitor"
            });
            res.json({ ok: true, messages });
        } catch (err) {
            logStoreError_(err, "visitor messages");
            jsonError_(res, 500, err.message || "Failed to load messages");
        }
    });

    publicRouter.post("/visitor-message", async (req, res) => {
        setPublicCors_(res);
        setNoCache_(res);
        const clientSessionId = safeClientSessionId_(req.body && req.body.clientSessionId);
        const text = trim_(req.body && req.body.text);
        if (!clientSessionId || !text) {
            jsonError_(res, 400, "clientSessionId and text required");
            return;
        }
        try {
            const conv = await getConversation_(clientSessionId);
            if (!conv || conv.status === "closed") {
                jsonError_(res, 400, "No active human chat");
                return;
            }
            const message = await appendMessage_({
                conversationId: clientSessionId,
                role: "visitor",
                text,
                senderEmail: "",
                bumpUnread: { agent: 1, visitor: 0 }
            });
            res.json({ ok: true, message });
        } catch (err) {
            logStoreError_(err, "visitor send");
            jsonError_(res, 400, err.message || "Send failed");
        }
    });

    app.use("/api/live-agent", publicRouter);

    console.log(LOG_TAG, "mounted /live-agent + /api/live-agent/* (+ /live-agent/health)");
}
