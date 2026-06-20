/**
 * Only Refer–compatible /api/live-agent routes + /live-agent static desk.
 */

const path = require('path');
const express = require('express');
const store = require('./live-agent-store');
const context = require('./live-agent-context');
const signals = require('./live-agent-signals');
const knowledge = require('./live-agent-knowledge');
const liveAgentHours = require('./live-agent-hours');
const liveAgentQueue = require('./live-agent-queue');

function deliverChannelReply(sessionId, text) {
  const channelOutbound = require('./channels/channel-outbound');
  return channelOutbound.deliverAgentReply(sessionId, text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildVisitorSyncAfterSignals(sessionId, clientRev, clientLastMsgId) {
  await signals.pullSignals({ maxAgeMs: 25 });
  const sig = signals.getSessionSignal(sessionId);
  const remoteRev = sig ? Number(sig.revision) || 0 : 0;
  const remoteMsgId = sig ? String(sig.lastMessageId || '') : '';
  const clientMsgId = trim(clientLastMsgId);
  const needsFull =
    remoteRev > clientRev ||
    (remoteMsgId && remoteMsgId !== clientMsgId);
  if (needsFull) {
    await store.syncPull({ force: true });
  } else {
    await store.syncPull({ maxAgeMs: 60 });
  }
  return store.enrichPayloadFromSignals(
    sessionId,
    store.buildVisitorSyncPayload(sessionId)
  );
}

async function longPollUntilChange(sessionId, clientRev, waitMs, clientLastMsgId) {
  const deadline =
    Date.now() + Math.min(Math.max(Number(waitMs) || 20000, 400), 28000);
  let seenTyping = '';
  let seenAgentTyping = '';
  let seenMsgId = trim(clientLastMsgId);
  while (Date.now() < deadline) {
    await signals.pullSignals({ maxAgeMs: 25 });
    const sig = signals.getSessionSignal(sessionId);
    const remoteRev = sig ? Number(sig.revision) || 0 : 0;
    const vt = sig ? String(sig.visitorTyping || '') : '';
    const at = sig ? String(sig.agentTyping || '') : '';
    const msgId = sig ? String(sig.lastMessageId || '') : '';
    if (
      remoteRev > clientRev ||
      vt !== seenTyping ||
      at !== seenAgentTyping ||
      (msgId && msgId !== seenMsgId)
    ) {
      return buildVisitorSyncAfterSignals(
        sessionId,
        clientRev,
        clientLastMsgId
      );
    }
    seenTyping = vt;
    seenAgentTyping = at;
    if (msgId) seenMsgId = msgId;
    await sleep(20);
  }
  const payload = await buildVisitorSyncAfterSignals(
    sessionId,
    clientRev,
    clientLastMsgId
  );
  if (
    payload.revision <= clientRev &&
    !trim(payload.visitorTyping) &&
    !trim(payload.agentTyping) &&
    (!payload.lastMessageId ||
      payload.lastMessageId === trim(clientLastMsgId))
  ) {
    return {
      ok: true,
      unchanged: true,
      revision: payload.revision,
      visitorTyping: payload.visitorTyping || '',
      agentTyping: payload.agentTyping || '',
    };
  }
  return payload;
}

const DESK_DIR = path.join(__dirname, '..', '..', '..', 'cx_public', 'live-agent');

const SHEET_SECRET = String(
  process.env.CONVERSATIONS_SHEET_VIEW_SECRET || ''
).trim();
const DESK_TOKEN = String(process.env.LIVE_AGENT_DESK_TOKEN || '').trim();

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function setPublicCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Agent-Token, X-Desk-Token, X-Conversations-Sheet-Secret, Authorization, X-Live-Agent-Email, X-Live-Agent-Name'
  );
}

function jsonError(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

function normalizeDepartmentEmails(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  list.forEach((e) => {
    const v = String(e || '')
      .trim()
      .toLowerCase();
    if (!v || !v.includes('@') || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function departmentsForApi(departments) {
  return (departments || []).map((d) => ({
    ...d,
    isSystem: String(d.id || '').toLowerCase() === 'general',
    agentEmails: Array.isArray(d.agentEmails) ? d.agentEmails : [],
  }));
}

function findDepartmentIndex_(departments, id) {
  const want = trim(id).toLowerCase();
  if (!want) return -1;
  for (let i = 0; i < departments.length; i += 1) {
    if (String(departments[i].id || '').toLowerCase() === want) {
      return i;
    }
  }
  return -1;
}

function secretFromReq(req) {
  const sheetHdr = trim(req.headers['x-conversations-sheet-secret']);
  const agentHdr =
    trim(req.headers['x-agent-token']) || trim(req.headers['x-desk-token']);
  let bearer = '';
  const auth = trim(req.headers.authorization);
  if (/^Bearer\s+/i.test(auth)) bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const q = trim(req.query.token || req.query.secret);
  const candidates = [sheetHdr, agentHdr, bearer, q].filter(Boolean);
  if (SHEET_SECRET && candidates.some((c) => c === SHEET_SECRET)) {
    return { ok: true, reason: 'sheet' };
  }
  if (DESK_TOKEN && candidates.some((c) => c === DESK_TOKEN)) {
    return { ok: true, reason: 'desk' };
  }
  if (!SHEET_SECRET && !DESK_TOKEN) return { ok: true, reason: 'open' };
  return { ok: false, reason: candidates.length ? 'bad' : 'missing' };
}

function readSessionFromReq(req) {
  const check = secretFromReq(req);
  if (!check.ok) return null;
  const email =
    trim(req.headers['x-live-agent-email']) ||
    trim(req.headers['x-live-agent-name']) ||
    'agent';
  return { agentId: email.toLowerCase(), secretOk: true };
}

function requireAgentSession(req, res, next) {
  if (!SHEET_SECRET && !DESK_TOKEN) {
    req.liveAgentSession = { agentId: 'dev@local' };
    return next();
  }
  if (!SHEET_SECRET && !DESK_TOKEN) {
    return jsonError(
      res,
      503,
      'Set CONVERSATIONS_SHEET_VIEW_SECRET or LIVE_AGENT_DESK_TOKEN on the server.'
    );
  }
  const sess = readSessionFromReq(req);
  if (!sess) {
    const check = secretFromReq(req);
    const msg =
      check.reason === 'bad'
        ? 'Unauthorized — secret does not match.'
        : 'Unauthorized — send X-Conversations-Sheet-Secret.';
    return res.status(401).json({ ok: false, error: msg });
  }
  req.liveAgentSession = sess;
  next();
}

function sendHealth(res) {
  setNoCache(res);
  res.json({
    ok: true,
    firestore_ready: store.storageReady(),
    storage_ready: store.storageReady(),
    auth_required: Boolean(SHEET_SECRET || DESK_TOKEN),
    auth_configured: Boolean(SHEET_SECRET || DESK_TOKEN),
    auth_mode: 'conversations_sheet_secret',
  });
}

function mountLiveAgentRoutes(app) {
  app.get('/live-agent/health', (_req, res) => sendHealth(res));
  app.get('/api/live-agent/health', (_req, res) => sendHealth(res));

  app.use(
    '/live-agent',
    express.static(DESK_DIR, {
      index: ['index.html'],
      extensions: ['html'],
      setHeaders(res, filePath) {
        if (filePath.toLowerCase().endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  router.get('/me', (req, res) => {
    setNoCache(res);
    if (!SHEET_SECRET && !DESK_TOKEN) {
      res.json({ ok: true, agentId: 'dev@local' });
      return;
    }
    const sess = readSessionFromReq(req);
    if (!sess) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const email = sess.agentId;
    if (email.includes('@') && !store.isAgentEmailRegistered(email)) {
      return res.status(403).json({
        ok: false,
        error:
          'This email is not registered. Add it in Live Agent Settings → Departments.',
      });
    }
    res.json({ ok: true, agentId: email });
  });

  router.get('/inbox', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      const fresh =
        trim(req.query.fresh) === '1' || trim(req.query.force) === '1';
      await store.syncPull(fresh ? { force: true } : undefined);
      const status = trim(req.query.status) || 'all';
      const limit = Number(req.query.limit);
      const conversations = store.listInbox({
        status,
        agentEmail: req.liveAgentSession.agentId,
        limit: Number.isFinite(limit) ? limit : 80,
      });
      res.json({
        ok: true,
        conversations,
        status,
        count: conversations.length,
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Inbox failed');
    }
  });

  router.post('/bulk-close-tests', requireAgentSession, (req, res) => {
    setNoCache(res);
    try {
      const result = store.bulkCloseTests({
        idPrefix: trim(req.body && req.body.idPrefix) || 'test-',
        maxClose: Number(req.body && req.body.limit),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      jsonError(res, 400, err.message || 'Bulk close failed');
    }
  });

  async function handleAccept(req, res) {
    setNoCache(res);
    const conversationId = trim(
      (req.body && req.body.conversationId) ||
        (req.body && req.body.sessionId)
    );
    if (!conversationId) {
      return jsonError(res, 400, 'conversationId required');
    }
    try {
      await store.syncPull({ force: true });
      const conversation = store.acceptConversation({
        conversationId,
        agentEmail: req.liveAgentSession.agentId,
      });
      await store.syncPush();
      res.json({ ok: true, conversation });
    } catch (err) {
      jsonError(res, 400, err.message || 'Accept failed');
    }
  }

  router.post('/accept', requireAgentSession, handleAccept);
  router.post('/claim', requireAgentSession, handleAccept);

  router.get('/settings', requireAgentSession, async (_req, res) => {
    setNoCache(res);
    try {
      await store.syncSettingsFromGcs();
      const settings = store.loadSettings();
      settings.knowledgeBase = knowledge.normalizeKnowledgeBase(settings.knowledgeBase);
      res.json({
        ok: true,
        settings,
        departments: departmentsForApi(settings.departments),
        knowledgeBase: settings.knowledgeBase,
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Could not load settings');
    }
  });

  router.get('/knowledge/search', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const q = trim(req.query.q || req.query.query);
    if (!q) {
      return res.json({ ok: true, results: [] });
    }
    await store.syncSettingsFromGcs();
    const settings = store.loadSettings();
    const departmentId =
      trim(req.query.departmentId) ||
      trim(req.query.department) ||
      'general';
    const results = knowledge.searchKnowledgeBase(settings.knowledgeBase, {
      query: q,
      departmentId,
      limit: Number(req.query.limit) || 12,
    });
    res.json({ ok: true, results });
  });

  router.put('/settings', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      await store.syncSettingsFromGcs();
      const current = store.loadSettings();
      const patch = req.body || {};
      const merged = {
        ...current,
        ...patch,
        general: { ...(current.general || {}), ...(patch.general || {}) },
        routing: {
          ...(current.routing || {}),
          ...(patch.routing || {}),
          algorithm:
            (patch.routing && patch.routing.algorithm) ||
            patch.routingAlgorithm ||
            (current.routing && current.routing.algorithm) ||
            'online_parallel',
        },
        access: { ...(current.access || {}), ...(patch.access || {}) },
        reporting: { ...(current.reporting || {}), ...(patch.reporting || {}) },
      };
      if (patch.knowledgeBase != null) {
        merged.knowledgeBase = knowledge.normalizeKnowledgeBase(patch.knowledgeBase);
      } else {
        merged.knowledgeBase = knowledge.normalizeKnowledgeBase(
          current.knowledgeBase
        );
      }
      if (!Array.isArray(patch.departments)) {
        merged.departments = current.departments;
      }
      if (patch.businessHours != null) {
        merged.businessHours = liveAgentHours.normalizeBusinessHours(
          patch.businessHours
        );
      } else {
        merged.businessHours = liveAgentHours.normalizeBusinessHours(
          current.businessHours
        );
      }
      const queueNorm = liveAgentQueue.normalizeQueueSettings({
        ...current,
        ...patch,
      });
      merged.queueMaxWaitEnabled = queueNorm.enabled;
      merged.queueMaxWaitMinutes = queueNorm.minutes;
      merged.queueTimeoutReply = queueNorm.reply;
      if (patch.claimWaitSeconds != null) {
        merged.claimWaitSeconds = Math.min(
          Math.max(Number(patch.claimWaitSeconds) || 30, 5),
          300
        );
      }
      if (patch.routingAlgorithm != null) {
        merged.routing = merged.routing || {};
        merged.routing.algorithm = trim(patch.routingAlgorithm);
      }
      const settings = await store.saveSettings(merged);
      settings.knowledgeBase = knowledge.normalizeKnowledgeBase(
        settings.knowledgeBase
      );
      res.json({
        ok: true,
        settings,
        departments: departmentsForApi(settings.departments),
        knowledgeBase: settings.knowledgeBase,
      });
    } catch (err) {
      jsonError(res, 400, err.message || 'Settings save failed');
    }
  });

  router.get('/departments', requireAgentSession, async (_req, res) => {
    setNoCache(res);
    try {
      await store.syncSettingsFromGcs();
      const settings = store.loadSettings();
      res.json({ ok: true, departments: departmentsForApi(settings.departments) });
    } catch (err) {
      jsonError(res, 500, err.message || 'Could not load departments');
    }
  });

  router.post('/departments', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      await store.syncSettingsFromGcs();
      const settings = store.loadSettings();
      const name = trim(req.body && req.body.name) || 'Department';
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      settings.departments = settings.departments || [];
      if (findDepartmentIndex_(settings.departments, id) >= 0) {
        return jsonError(res, 409, 'A department with this id already exists');
      }
      const dept = {
        id,
        name,
        agentEmails: normalizeDepartmentEmails(req.body && req.body.agentEmails),
      };
      settings.departments.push(dept);
      await store.saveSettings(settings);
      res.json({ ok: true, department: { ...dept, isSystem: false } });
    } catch (err) {
      jsonError(res, 500, err.message || 'Could not create department');
    }
  });

  router.put('/departments/:id', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      await store.syncSettingsFromGcs();
      const settings = store.loadSettings();
      settings.departments = settings.departments || [];
      const idx = findDepartmentIndex_(settings.departments, req.params.id);
      if (idx < 0) {
        return jsonError(res, 404, 'Department not found');
      }
      const dept = settings.departments[idx];
      if (req.body && req.body.agentEmails != null) {
        dept.agentEmails = normalizeDepartmentEmails(req.body.agentEmails);
      }
      const nextName = trim(req.body && req.body.name);
      if (nextName) {
        dept.name = nextName;
      }
      settings.departments[idx] = dept;
      await store.saveSettings(settings);
      res.json({
        ok: true,
        department: {
          ...dept,
          isSystem: String(dept.id || '').toLowerCase() === 'general',
        },
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Could not save department');
    }
  });

  router.delete('/departments/:id', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      const id = trim(req.params.id).toLowerCase();
      if (!id) {
        return jsonError(res, 400, 'Department id required');
      }
      if (id === 'general') {
        return jsonError(res, 400, 'Cannot delete the General department');
      }
      await store.syncSettingsFromGcs();
      const settings = store.loadSettings();
      settings.departments = settings.departments || [];
      const idx = findDepartmentIndex_(settings.departments, id);
      if (idx < 0) {
        return jsonError(res, 404, 'Department not found');
      }
      settings.departments.splice(idx, 1);
      await store.saveSettings(settings);
      res.json({ ok: true, deleted: id });
    } catch (err) {
      jsonError(res, 500, err.message || 'Could not delete department');
    }
  });

  router.post('/presence', requireAgentSession, (req, res) => {
    setNoCache(res);
    const status = trim(req.body && req.body.status) || 'online';
    const agent = store.touchAgentPresence(req.liveAgentSession.agentId, status);
    res.json({ ok: true, agent });
  });

  router.get('/agents', requireAgentSession, (_req, res) => {
    setNoCache(res);
    res.json({ ok: true, agents: store.listAgentsOverview() });
  });

  router.get('/activity', requireAgentSession, (_req, res) => {
    setNoCache(res);
    res.json({ ok: true, activity: [] });
  });

  router.get('/conversations/:id/messages', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      await buildVisitorSyncAfterSignals(req.params.id, 0);
      const conversation = store.getConversation(req.params.id);
      const messages = store.listMessages({
        conversationId: req.params.id,
        sinceIso: trim(req.query.since) || undefined,
        sinceId: trim(req.query.sinceId) || undefined,
        limit: Number(req.query.limit) || undefined,
        markReadFor: trim(req.query.markRead) === '1' ? 'agent' : undefined,
        viewingAgentEmail: req.liveAgentSession && req.liveAgentSession.agentId,
      });
      if (trim(req.query.markRead) === '1') {
        await store.syncPush();
      }
      res.json({
        ok: true,
        messages,
        conversation,
        revision: conversation ? conversation.revision : 0,
        visitorTyping: conversation ? conversation.visitorTypingText : '',
        agentTyping: conversation ? conversation.agentTypingText : '',
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Messages failed');
    }
  });

  router.get('/conversations/:id/typing-pulse', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const sessionId = req.params.id;
    const clientRev = Number(req.query.rev || req.query.revision) || 0;
    const clientLastMsgId = trim(req.query.lastMessageId);
    try {
      await signals.pullSignals({ maxAgeMs: 25 });
      await store.syncPull({ maxAgeMs: 50 });
      const sig = signals.getSessionSignal(sessionId);
      const rev = sig ? Number(sig.revision) || 0 : 0;
      const visitorTyping = store.visitorTypingForDesk(sessionId);
      const agentTyping = sig ? String(sig.agentTyping || '') : '';
      const lastMessageId = sig ? String(sig.lastMessageId || '') : '';
      const lastMessageRole = sig ? String(sig.lastMessageRole || '') : '';
      const typingChanged =
        visitorTyping !== trim(req.query.visitorTyping) ||
        agentTyping !== trim(req.query.agentTyping);
      const messageHint =
        !!lastMessageId && lastMessageId !== clientLastMsgId;
      res.json({
        ok: true,
        revision: rev,
        visitorTyping,
        agentTyping,
        lastMessageId,
        lastMessageRole,
        changed: rev > clientRev || typingChanged || messageHint,
        newMessage: messageHint,
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Typing pulse failed');
    }
  });

  router.get('/conversations/:id/live-sync', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const clientRev = Number(req.query.rev || req.query.revision) || 0;
    const waitMs = Number(req.query.wait || req.query.waitMs) || 20000;
    const clientLastMsgId = trim(req.query.lastMessageId || req.query.sinceId);
    try {
      const payload = await longPollUntilChange(
        req.params.id,
        clientRev,
        waitMs,
        clientLastMsgId
      );
      if (payload.unchanged) {
        res.json(payload);
        return;
      }
      const sinceId = trim(req.query.sinceId);
      const messages = store.listMessages({
        conversationId: req.params.id,
        sinceId: sinceId || undefined,
        tail: sinceId ? undefined : 80,
        limit: sinceId ? 80 : undefined,
        viewingAgentEmail: req.liveAgentSession && req.liveAgentSession.agentId,
      });
      res.json({
        ...payload,
        messages,
        conversation:
          payload.conversation || store.getConversation(req.params.id),
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Live sync failed');
    }
  });

  router.post('/conversations/:id/typing', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const text = trim(req.body && req.body.text);
    const active = req.body && req.body.active !== false;
    try {
      await store.syncPull({ maxAgeMs: 50 });
      const conversation = await store.updateAgentTyping({
        conversationId: req.params.id,
        text,
        active,
        agentEmail: req.liveAgentSession.agentId,
      });
      res.json({
        ok: true,
        revision: conversation ? conversation.revision : 0,
        conversation,
      });
    } catch (err) {
      jsonError(res, 400, err.message || 'Typing failed');
    }
  });

  router.post('/conversations/:id/messages', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const text = trim(req.body && req.body.text);
    if (!text) return jsonError(res, 400, 'text required');
    try {
      await store.syncPull({ maxAgeMs: 50 });
      const result = store.postAgentMessage({
        conversationId: req.params.id,
        text,
        agentEmail: req.liveAgentSession.agentId,
        agentName: trim(req.body && req.body.agentName),
      });
      await store.syncPush();
      void deliverChannelReply(req.params.id, text).catch((err) =>
        console.warn('[channels] agent reply:', err.message)
      );
      res.json({
        ok: true,
        message: result.message,
        conversation: result.conversation,
        internal: !!result.internal,
      });
    } catch (err) {
      jsonError(res, 400, err.message || 'Send failed');
    }
  });

  router.post('/conversations/:id/reopen', requireAgentSession, (req, res) => {
    setNoCache(res);
    try {
      const conversation = store.reopenConversation({
        conversationId: req.params.id,
        agentEmail: req.liveAgentSession.agentId,
      });
      res.json({ ok: true, conversation });
    } catch (err) {
      jsonError(res, 400, err.message || 'Reopen failed');
    }
  });

  router.post('/conversations/:id/close', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      await store.syncPull({ force: true });
      const conversation = store.closeConversation({
        conversationId: req.params.id,
        agentEmail: req.liveAgentSession.agentId,
      });
      await store.syncPush();
      res.json({ ok: true, conversation });
    } catch (err) {
      jsonError(res, 400, err.message || 'Close failed');
    }
  });

  router.get('/conversations/:id/context', requireAgentSession, async (req, res) => {
    setNoCache(res);
    try {
      const conversation = store.getConversation(req.params.id);
      const visitor = await context.getVisitorContext(req.params.id, {
        conversation,
      });
      res.json({ ok: true, conversation, visitor });
    } catch (err) {
      jsonError(res, 500, err.message || 'Context failed');
    }
  });

  router.post('/conversations/:id/transfer', requireAgentSession, (req, res) => {
    setNoCache(res);
    const toAgentEmail = trim(req.body && req.body.toAgentEmail);
    if (!toAgentEmail) return jsonError(res, 400, 'toAgentEmail required');
    try {
      const conversation = store.transferConversation({
        conversationId: req.params.id,
        fromAgentEmail: req.liveAgentSession.agentId,
        toAgentEmail,
      });
      res.json({ ok: true, conversation });
    } catch (err) {
      jsonError(res, 400, err.message || 'Transfer failed');
    }
  });

  router.post('/conversations/:id/mode', requireAgentSession, async (req, res) => {
    setNoCache(res);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      await store.syncPull({ maxAgeMs: 50 });
      const conversation = store.updateConversationMode({
        conversationId: req.params.id,
        aiEnabled:
          typeof body.aiEnabled === 'boolean' ? body.aiEnabled : undefined,
        humanMode: trim(body.humanMode) || undefined,
        agentEmail: req.liveAgentSession.agentId,
      });
      await store.syncPush();
      res.json({ ok: true, conversation });
    } catch (err) {
      jsonError(res, 400, err.message || 'Mode failed');
    }
  });

  app.use('/api/live-agent', router);

  const publicRouter = express.Router();
  publicRouter.use(express.json({ limit: '128kb' }));

  publicRouter.options('*', (_req, res) => {
    setPublicCors(res);
    res.status(204).end();
  });

  publicRouter.post('/request', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      (req.body && req.body.clientSessionId) || (req.body && req.body.sessionId)
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    try {
      await store.syncPull({ force: true });
      const result = store.requestHumanAgent({
        conversationId: clientSessionId,
        botid: req.body && req.body.botid,
        visitorName:
          trim(req.body && req.body.visitorName) ||
          trim(req.body && req.body.name),
        initialMessage:
          (req.body && req.body.initialMessage) ||
          (req.body && req.body.previewMessage),
        department:
          trim(req.body && req.body.department) ||
          trim(req.body && req.body.liveAgentDepartment) ||
          trim(req.body && req.body.departmentName) ||
          trim(req.body && req.body.departmentId),
      });
      await store.syncPush();
      res.json({
        ok: true,
        ...result,
        deduped: !result.created,
        dismissed: !!(result && result.dismissed),
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Request failed');
    }
  });

  publicRouter.get('/sync', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      req.query.clientSessionId || req.query.sessionId
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    const clientRev = Number(req.query.rev || req.query.revision) || 0;
    const waitMs = Number(req.query.wait || req.query.waitMs) || 0;
    const clientLastMsgId = trim(req.query.lastMessageId || req.query.sinceId);
    try {
      const payload =
        waitMs > 0
          ? await longPollUntilChange(
              clientSessionId,
              clientRev,
              waitMs,
              clientLastMsgId
            )
          : await buildVisitorSyncAfterSignals(
              clientSessionId,
              clientRev,
              clientLastMsgId
            );
      res.json(payload);
    } catch (err) {
      jsonError(res, 500, err.message || 'Sync failed');
    }
  });

  publicRouter.get('/stream', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      req.query.clientSessionId || req.query.sessionId
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();
    let clientRev = Number(req.query.rev || req.query.revision) || 0;
    let clientLastMsgId = trim(req.query.lastMessageId || req.query.sinceId);
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    try {
      while (!closed) {
        const payload = await longPollUntilChange(
          clientSessionId,
          clientRev,
          22000,
          clientLastMsgId
        );
        if (closed) break;
        if (!payload.unchanged) {
          clientRev = payload.revision || clientRev;
          if (payload.lastMessageId) {
            clientLastMsgId = payload.lastMessageId;
          }
          res.write(`event: sync\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      }
    } catch (err) {
      if (!closed) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`
        );
      }
    } finally {
      if (!closed) res.end();
    }
  });

  publicRouter.post('/visitor-typing', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      (req.body && req.body.clientSessionId) || (req.body && req.body.sessionId)
    );
    const text = trim(req.body && req.body.text);
    const active = req.body && req.body.active !== false;
    if (!clientSessionId) return jsonError(res, 400, 'clientSessionId required');
    try {
      await store.syncPull({ maxAgeMs: 120 });
      const conversation = await store.updateVisitorTyping({
        conversationId: clientSessionId,
        text,
        active,
      });
      res.json({
        ok: true,
        revision: conversation ? conversation.revision : 0,
        visitorTyping: conversation ? conversation.visitorTypingText : '',
        agentTyping: conversation ? conversation.agentTypingText : '',
      });
    } catch (err) {
      jsonError(res, 400, err.message || 'Typing failed');
    }
  });

  publicRouter.get('/typing-pulse', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      req.query.clientSessionId || req.query.sessionId
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    const clientRev = Number(req.query.rev || req.query.revision) || 0;
    const clientLastMsgId = trim(req.query.lastMessageId);
    try {
      await signals.pullSignals({ maxAgeMs: 25 });
      await store.syncPull({ maxAgeMs: 50 });
      const sig = signals.getSessionSignal(clientSessionId);
      const rev = sig ? Number(sig.revision) || 0 : 0;
      const agentTyping = store.agentTypingLabelForVisitor(clientSessionId);
      const lastMessageId = sig ? String(sig.lastMessageId || '') : '';
      res.json({
        ok: true,
        revision: rev,
        agentTyping,
        lastMessageId,
        changed:
          rev > clientRev ||
          (!!lastMessageId && lastMessageId !== clientLastMsgId) ||
          agentTyping !== trim(req.query.agentTyping),
        newMessage: !!lastMessageId && lastMessageId !== clientLastMsgId,
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Typing pulse failed');
    }
  });

  publicRouter.get('/status', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      req.query.clientSessionId || req.query.sessionId
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    try {
      await store.syncPull();
      const payload = store.buildVisitorSyncPayload(clientSessionId);
      const { messages, storageBackend, ...statusOnly } = payload;
      res.json(statusOnly);
    } catch (err) {
      jsonError(res, 500, err.message || 'Status failed');
    }
  });

  publicRouter.get('/messages', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      req.query.clientSessionId || req.query.sessionId
    );
    if (!clientSessionId) {
      return jsonError(res, 400, 'clientSessionId required');
    }
    try {
      await store.syncPull();
      const conversation = store.getConversation(clientSessionId);
      const tail = Number(req.query.tail);
      const messages = store.listMessagesForVisitor(clientSessionId, {
        tail: Number.isFinite(tail) && tail > 0 ? tail : 50,
      });
      const agentName = conversation
        ? store.resolveAgentDisplayName(conversation.assignedAgentEmail)
        : '';
      res.json({ ok: true, messages, agentName, agentProfiles: [] });
    } catch (err) {
      jsonError(res, 500, err.message || 'Messages failed');
    }
  });

  publicRouter.post('/visitor-message', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const clientSessionId = trim(
      (req.body && req.body.clientSessionId) || (req.body && req.body.sessionId)
    );
    const text = trim(req.body && req.body.text) || trim(req.body && req.body.message);
    if (!clientSessionId) return jsonError(res, 400, 'clientSessionId required');
    if (!text) return jsonError(res, 400, 'text required');
    try {
      await store.syncPull({ maxAgeMs: 50 });
      const result = store.postVisitorMessage({
        conversationId: clientSessionId,
        text,
      });
      await store.syncPush();
      const sync = store.enrichPayloadFromSignals(
        clientSessionId,
        store.buildVisitorSyncPayload(clientSessionId)
      );
      res.json({
        ok: true,
        ...result,
        deduped: false,
        revision: sync.revision,
        messages: sync.messages,
        humanHandoffActive: sync.humanHandoffActive,
        agentConnected: sync.agentConnected,
        assignedAgentDisplayName: sync.assignedAgentDisplayName,
        connectedMessage: sync.connectedMessage,
        visitorNotice: sync.visitorNotice || null,
        lastMessageId: sync.lastMessageId,
      });
    } catch (err) {
      jsonError(res, 400, err.message || 'Send failed');
    }
  });

  /** Legacy widget poll */
  publicRouter.get('/poll', async (req, res) => {
    setPublicCors(res);
    setNoCache(res);
    const sessionId = trim(req.query.sessionId || req.query.clientSessionId);
    if (!sessionId) return jsonError(res, 400, 'sessionId required');
    try {
      await store.syncPull();
      const payload = store.buildVisitorSyncPayload(sessionId);
      res.json({
        ok: true,
        status: payload.status,
        agentName: payload.agentName,
        humanActive: payload.humanActive,
        messages: (payload.messages || []).map((m) => ({
          id: m.id,
          from: m.from,
          text: m.text,
          at: m.createdAt,
          role: m.role,
        })),
      });
    } catch (err) {
      jsonError(res, 500, err.message || 'Poll failed');
    }
  });

  publicRouter.get('/state', (req, res) => {
    setPublicCors(res);
    const sessionId = trim(req.query.sessionId);
    const conversation = store.getConversation(sessionId);
    res.json({
      ok: true,
      status: conversation ? conversation.status : 'none',
      agentName: conversation
        ? (conversation.assignedAgentEmail || '').split('@')[0]
        : '',
      session: conversation,
    });
  });

  publicRouter.post('/user-message', (req, res) => {
    setPublicCors(res);
    const sessionId = trim(req.body && req.body.sessionId);
    const message = trim(req.body && req.body.message);
    try {
      const result = store.postVisitorMessage({
        conversationId: sessionId,
        text: message,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      jsonError(res, 400, err.message || 'Send failed');
    }
  });

  app.use('/api/live-agent', publicRouter);

  /** Legacy desk queue API */
  app.get('/api/live-agent/queue', requireAgentSession, (_req, res) => {
    const waiting = store.listInbox({ status: 'waiting', limit: 80 });
    const active = store.listInbox({ status: 'active', limit: 80 });
    res.json({
      ok: true,
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
    });
  });

  app.get('/api/live-agent/session', requireAgentSession, (req, res) => {
    const sid = trim(req.query.sessionId);
    const s = store.getSession(sid);
    if (!s) return res.json({ error: 'session_not_found' });
    res.json({
      ok: true,
      session: store.serializeConversation(s.sessionId, s),
      messages: (s.messages || []).map(store.serializeMessage),
    });
  });

  app.post('/api/live-agent/agent-message', requireAgentSession, async (req, res) => {
    try {
      const sessionId = trim(req.body.sessionId);
      const text = trim(req.body.message);
      const result = store.postAgentMessage({
        conversationId: sessionId,
        text,
        agentEmail: req.liveAgentSession.agentId,
        agentName: req.body.agentName,
      });
      void deliverChannelReply(sessionId, text).catch((err) =>
        console.warn('[channels] agent reply:', err.message)
      );
      res.json({ ok: true, message: result.message });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/live-agent/end', requireAgentSession, (req, res) => {
    try {
      const conversation = store.closeConversation({
        conversationId: req.body.sessionId,
        agentEmail: req.liveAgentSession.agentId,
      });
      res.json({ ok: true, session: conversation });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { mountLiveAgentRoutes, secretFromReq, readSessionFromReq };
