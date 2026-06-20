/**
 * Live agent — file store + legacy exports for transcript / old callers.
 */

const store = require('./live-agent-store');
const routes = require('./live-agent-routes');

function verifyDeskToken(req) {
  const check = routes.secretFromReq(req);
  if (check.ok) return { ok: true };
  if (!process.env.CONVERSATIONS_SHEET_VIEW_SECRET && !process.env.LIVE_AGENT_DESK_TOKEN) {
    return { ok: true };
  }
  return routes.deskAuthFailed
    ? { ok: false, error: 'Wrong desk token.' }
    : {
        ok: false,
        error:
          check.reason === 'bad'
            ? 'Wrong desk token.'
            : 'Unauthorized — use desk token or conversations viewer secret.',
      };
}

function deskAuthFailed() {
  if (!process.env.CONVERSATIONS_SHEET_VIEW_SECRET && !process.env.LIVE_AGENT_DESK_TOKEN) {
    return {
      error: 'desk_token_not_configured',
      message: 'Set CONVERSATIONS_SHEET_VIEW_SECRET or LIVE_AGENT_DESK_TOKEN.',
    };
  }
  return { error: 'unauthorized', message: 'Wrong desk token.' };
}

function isDeskTokenRequired() {
  return Boolean(
    String(process.env.CONVERSATIONS_SHEET_VIEW_SECRET || '').trim() ||
      String(process.env.LIVE_AGENT_DESK_TOKEN || '').trim()
  );
}

async function refreshStore() {
  await store.syncPull({ force: true });
}

async function persistStore() {
  await store.syncPush();
}

async function requestHandoff(sessionId, opts) {
  await store.syncPull({ force: true });
  const result = store.requestHumanAgent({
    conversationId: sessionId,
    userLanguage: opts && opts.userLanguage,
    initialMessage: opts && opts.previewMessage,
    visitorName: opts && opts.visitorName,
    department:
      (opts && opts.department) ||
      (opts && opts.liveAgentDepartment) ||
      (opts && opts.departmentId),
  });
  await store.syncPush();
  return result;
}

async function postUserMessage(sessionId, text) {
  try {
    await store.syncPull({ force: true });
    const result = store.postVisitorMessage({ conversationId: sessionId, text });
    await store.syncPush();
    return result;
  } catch (e) {
    return { error: e.message || 'send_failed' };
  }
}

function postAgentMessage(sessionId, text, agent) {
  try {
    return store.postAgentMessage({
      conversationId: sessionId,
      text,
      agentEmail: agent && agent.agentId,
      agentName: agent && agent.agentName,
    });
  } catch (e) {
    return { error: e.message || 'send_failed' };
  }
}

function claimSession(sessionId, agent) {
  try {
    const conversation = store.acceptConversation({
      conversationId: sessionId,
      agentEmail: (agent && agent.agentId) || (agent && agent.agentName),
    });
    return { ok: true, session: conversation };
  } catch (e) {
    return { error: e.message };
  }
}

function endSession(sessionId, agent, reason) {
  try {
    const conversation = store.closeConversation({
      conversationId: sessionId,
      agentEmail: agent && agent.agentId,
    });
    return { ok: true, session: conversation };
  } catch (e) {
    return { error: e.message };
  }
}

function getMessagesSince(sessionId, since) {
  const messages = store.listMessages({
    conversationId: sessionId,
    sinceIso: since,
  });
  return {
    ok: true,
    sessionId,
    status: store.getConversation(sessionId)?.status || 'none',
    agentName: (store.getConversation(sessionId)?.assignedAgentEmail || '')
      .split('@')[0],
    messages: messages.map((m) => ({
      id: m.id,
      from: m.from,
      text: m.text,
      at: m.createdAt,
    })),
  };
}

function getUserState(sessionId) {
  const conversation = store.getConversation(sessionId);
  if (!conversation) {
    return { ok: true, status: 'none', messages: [] };
  }
  return {
    ok: true,
    status: conversation.status,
    agentName: (conversation.assignedAgentEmail || '').split('@')[0],
    session: conversation,
  };
}

function getQueue() {
  const waiting = store.listInbox({ status: 'waiting', limit: 80 });
  const active = store.listInbox({ status: 'active', limit: 80 });
  const ended = store.listInbox({ status: 'closed', limit: 50 });
  return {
    waiting: waiting.map((c) => ({
      sessionId: c.id,
      status: c.status,
      createdAt: c.requestedAt,
      updatedAt: c.lastMessageAt,
      preview: c.lastMessagePreview,
    })),
    active: active.map((c) => ({
      sessionId: c.id,
      status: c.status,
      createdAt: c.requestedAt,
      updatedAt: c.lastMessageAt,
      preview: c.lastMessagePreview,
      agentName: (c.assignedAgentEmail || '').split('@')[0],
    })),
    ended: ended.map((c) => ({
      sessionId: c.id,
      status: c.status,
      updatedAt: c.lastMessageAt,
    })),
  };
}

function getSessionDetail(sessionId) {
  const s = store.getSession(sessionId);
  if (!s) return { error: 'session_not_found' };
  return {
    ok: true,
    session: store.serializeConversation(s.sessionId, s),
    messages: (s.messages || []).map(store.serializeMessage),
  };
}

function isDialogflowBlockedForSession(sessionId) {
  return store.isDialogflowBlockedForSession(sessionId);
}

function getConversation(sessionId) {
  return store.getConversation(sessionId);
}

function resolveAgentDisplayName(email) {
  return store.resolveAgentDisplayName(email);
}

module.exports = {
  DATA_PATH: store.DATA_PATH,
  mountLiveAgentRoutes: routes.mountLiveAgentRoutes,
  refreshStore,
  persistStore,
  isDialogflowBlockedForSession,
  getConversation,
  resolveAgentDisplayName,
  isDeskTokenRequired,
  verifyDeskToken,
  deskAuthFailed,
  requestHandoff,
  postUserMessage,
  postAgentMessage,
  claimSession,
  endSession,
  getMessagesSince,
  getUserState,
  getQueue,
  getSessionDetail,
  storageReady: store.storageReady,
};
