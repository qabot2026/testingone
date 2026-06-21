/**
 * Live agent desk storage (JSON file) — Only Refer–compatible conversation shape.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const chatTranscript = require('./chat-transcript');
const gcsSync = require('./live-agent-gcs-sync');
const liveAgentHours = require('./live-agent-hours');
const liveAgentQueue = require('./live-agent-queue');
const liveAgentRouting = require('./live-agent-routing');
const signals = require('./live-agent-signals');
const transcriptDisplay = require('./transcript-display-text');

function scheduleSheet2Sync(sessionId) {
  try {
    require('./live-agent-sheet').scheduleSheet2Sync(sessionId);
  } catch (e) {
    console.warn('[live-agent] sheet2 sync:', e.message);
  }
}

const DATA_PATH =
  process.env.LIVE_AGENT_DATA_PATH ||
  path.join(__dirname, '..', 'data', 'live-agent-sessions.json');
const SETTINGS_PATH =
  process.env.LIVE_AGENT_SETTINGS_PATH ||
  path.join(__dirname, '..', 'data', 'live-agent-settings.json');

let store = { sessions: {} };
let loaded = false;
let lastGcsPullMs = 0;
let lastSettingsGcsPullMs = 0;
const SETTINGS_GCS_PULL_MIN_MS = Math.max(
  200,
  Number(process.env.LIVE_AGENT_SETTINGS_GCS_PULL_MS) || 500
);
const GCS_PULL_MIN_MS = Math.max(
  60,
  Number(process.env.LIVE_AGENT_GCS_PULL_MS) || 80
);
const TYPING_TTL_MS = 12000;

const LIVE_AGENT_HUMAN_CONNECTED = 'live_agent_human_connected';
const LIVE_AGENT_HUMAN_REJOINED = 'live_agent_human_rejoined';
const LIVE_AGENT_HANDOFF_TO_BOT = 'live_agent_handoff_to_bot';
const LIVE_AGENT_BOT_ACTIVE = 'live_agent_bot_active';
const LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT = 'AI assistant is replying now.';

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function resolveAgentDisplayName(email) {
  const e = normalizeEmail(email);
  if (!e) return 'Agent';
  const settings = loadSettings();
  const profiles = (settings.general && settings.general.agentProfiles) || [];
  for (let i = 0; i < profiles.length; i += 1) {
    const p = profiles[i];
    if (p && normalizeEmail(p.email) === e && trim(p.name)) {
      return trim(p.name);
    }
  }
  const local = e.split('@')[0];
  let name = local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Agent';
  if (/^me$/i.test(name)) {
    const domain = (e.split('@')[1] || '').split('.')[0] || '';
    name = domain
      ? domain.charAt(0).toUpperCase() + domain.slice(1) + ' Support'
      : 'Support Agent';
  }
  return name;
}

function typingFromSignalText(text, atIso) {
  const t = trim(text);
  if (!t) return '';
  const at = Date.parse(atIso || '');
  if (!Number.isFinite(at) || Date.now() - at > TYPING_TTL_MS) return '';
  return t;
}

/** Visitor draft for agents — stays visible after they stop typing until message is sent. */
function visitorDraftText(text) {
  return trim(text).slice(0, 400);
}

/** Active chat with bot replying (desk "Bot on") — no visitor typing preview for agents. */
function isBotReplyModeSession(session) {
  if (!session || session.status !== 'active') return false;
  const hm = String(session.humanMode || '').toLowerCase();
  return hm === 'ai' && session.aiEnabled !== false;
}

function lastVisitorMessageText(session) {
  const msgs = (session && session.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && normalizeMessageRole(m) === 'visitor') {
      return trim(m.text);
    }
  }
  return '';
}

function sessionHasHandoffRequestLine(session) {
  const msgs = (session && session.messages) || [];
  return msgs.some((m) => {
    const role = normalizeMessageRole(m);
    if (role !== 'visitor' && role !== 'system') return false;
    return transcriptDisplay.isHandoffRequestLine(m.text);
  });
}

/** Live draft for agents — hide when it matches the last sent visitor line. */
function visitorTypingForDeskSession(session) {
  if (!session) return '';
  if (isBotReplyModeSession(session)) return '';
  const draft = visitorDraftText(session.visitorTypingText);
  if (!draft) return '';
  if (transcriptDisplay.isHandoffRequestLine(draft)) return '';
  const lastVisitor = lastVisitorMessageText(session);
  if (lastVisitor && draft === lastVisitor) return '';
  return draft;
}

/** Visitors see only a generic label, never the agent's unsent draft text. */
function agentTypingLabelForVisitorSession(session) {
  if (!session) return '';
  if (isBotReplyModeSession(session)) return '';
  return activeTypingText(session.agentTypingText, session.agentTypingAt)
    ? 'Typing...'
    : '';
}

function visitorTypingForDesk(sessionId) {
  return visitorTypingForDeskSession(getSession(sessionId));
}

/** Prefer live session; fall back to GCS signals file (multi-instance Railway). */
function resolveAgentTypingLabelForVisitor(sessionId) {
  const id = safeId(sessionId);
  if (!id) return '';
  const s = getSession(id);
  const fromSession = agentTypingLabelForVisitorSession(s);
  if (fromSession) return fromSession;
  const sig = signals.getSessionSignal(id);
  if (!sig || (s && isBotReplyModeSession(s))) return '';
  return activeTypingText(sig.agentTyping, sig.agentTypingAt) ? 'Typing...' : '';
}

function agentTypingLabelForVisitor(sessionId) {
  return resolveAgentTypingLabelForVisitor(sessionId);
}

/** Merge fast signals file (typing + revision) into sync payload for cross-instance desks. */
function enrichPayloadFromSignals(sessionId, payload) {
  const sig = signals.getSessionSignal(sessionId);
  if (!sig || !payload) return payload;
  const sigRev = Number(sig.revision) || 0;
  if (sigRev > (Number(payload.revision) || 0)) {
    payload.revision = sigRev;
  }
  const s = getSession(sessionId);
  if (s) {
    payload.visitorTyping = visitorTypingForDeskSession(s);
  } else {
    const vt = visitorDraftText(sig.visitorTyping);
    if (vt && !transcriptDisplay.isHandoffRequestLine(vt)) {
      payload.visitorTyping = vt;
    }
  }
  payload.agentTyping = resolveAgentTypingLabelForVisitor(sessionId);
  if (sig.lastMessageId) payload.lastMessageId = sig.lastMessageId;
  if (sig.lastMessageRole) payload.lastMessageRole = sig.lastMessageRole;
  return payload;
}

function syncVisitorNameFromTranscript(session) {
  if (!session || !session.sessionId) return false;
  if (trim(session.visitorName)) return false;
  try {
    const doc = chatTranscript.getSessionDoc(session.sessionId);
    const meta = doc && doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
    const name = trim(meta.name) || trim(meta.visitorName);
    if (name) {
      session.visitorName = name;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function normalizeMessageRole(m) {
  let role = trim(m && m.role);
  if (!role && m && m.from) {
    const f = String(m.from).toLowerCase();
    if (f === 'agent' || f === 'staff') role = 'agent';
    else if (f === 'system') role = 'system';
    else if (f === 'internal' || f === 'note') role = 'internal';
    else role = 'visitor';
  }
  if (role === 'note') role = 'internal';
  return role || 'visitor';
}

function isInternalNoteInput(text) {
  return trim(text).startsWith('/');
}

function stripInternalNotePrefix(text) {
  const t = trim(text);
  return t.startsWith('/') ? trim(t.slice(1)) : t;
}

function isHumanJoinSystemText(text) {
  const t = trim(text);
  return (
    t === LIVE_AGENT_HUMAN_CONNECTED ||
    /^.+ joined the chat\.?$/i.test(t) ||
    /^Agent\s+\S+@\S+\s+accepted the chat\.?$/i.test(t)
  );
}

function isHumanRejoinSystemText(text) {
  return trim(text) === LIVE_AGENT_HUMAN_REJOINED;
}

function isHumanHandoffToBotSystemText(text) {
  const t = trim(text);
  return t === LIVE_AGENT_HANDOFF_TO_BOT || t === LIVE_AGENT_BOT_ACTIVE;
}

function agentNameFromSystemMsg(conversation, msg) {
  const fromMsg = trim(msg && (msg.senderDisplayName || msg.senderName));
  const email =
    trim(msg && msg.senderEmail) ||
    trim(conversation && conversation.assignedAgentEmail) ||
    trim(conversation && conversation.acceptedByEmail);
  return fromMsg || resolveAgentDisplayName(email) || 'Support Agent';
}

function visitorNameFromConversation(conversation) {
  const n = trim(conversation && conversation.visitorName);
  return n || 'Visitor';
}

function formatHumanRejoinedForVisitor(conversation, msg) {
  const name = agentNameFromSystemMsg(conversation, msg);
  return name && name !== 'Support Agent'
    ? `${name} joined again.`
    : 'An agent joined again.';
}

function isBotHandoffSystemText(text) {
  const t = trim(text).toLowerCase();
  return (
    t === LIVE_AGENT_BOT_ACTIVE ||
    t === LIVE_AGENT_HANDOFF_TO_BOT ||
    t.includes('ai assistant is replying') ||
    t.includes('the assistant is replying') ||
    t.includes('stepped away')
  );
}

function formatHumanHandoffToBotForVisitor(conversation, msg) {
  const name = agentNameFromSystemMsg(conversation, msg);
  return `${name} stepped away. ${LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT}`;
}

function findLastVisitorNoticeMessage(session, conversation) {
  if (!session || !conversation) return null;
  if (conversation.status === 'waiting' || conversation.status === 'closed') {
    return null;
  }
  const msgs = session.messages || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (!m || normalizeMessageRole(m) !== 'system') continue;
    const raw = trim(m.text);
    if (!raw) continue;
    const id = trim(m.id);
    if (isHumanRejoinSystemText(raw)) {
      return {
        type: 'rejoined',
        text: formatHumanRejoinedForVisitor(conversation, m),
        messageId: id,
      };
    }
    if (isHumanHandoffToBotSystemText(raw)) {
      return {
        type: 'bot_active',
        text: formatHumanHandoffToBotForVisitor(conversation, m),
        messageId: id,
      };
    }
    if (isHumanJoinSystemText(raw)) {
      return {
        type: 'connected',
        text: formatSystemMessageForVisitor(raw, conversation, m),
        messageId: id,
      };
    }
  }
  return null;
}

function formatSystemMessageForVisitor(text, conversation, msg) {
  if (isHumanHandoffToBotSystemText(text)) {
    return formatHumanHandoffToBotForVisitor(conversation, msg);
  }
  if (isBotHandoffSystemText(text)) return LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT;
  if (isHumanRejoinSystemText(text)) {
    return formatHumanRejoinedForVisitor(conversation, msg);
  }
  if (!isHumanJoinSystemText(text)) return text || '';
  const name = agentNameFromSystemMsg(conversation, msg);
  return `You are now chatting with ${name}.`;
}

/** Agent desk / API — not visitor-facing copy. */
function formatSystemMessageForAgent(text, conversation, msg, viewingAgentEmail) {
  const t = trim(text);
  if (!t) return '';
  const me = normalizeEmail(viewingAgentEmail);
  const senderEmail =
    normalizeEmail(msg && msg.senderEmail) ||
    normalizeEmail(conversation && conversation.assignedAgentEmail);
  const senderName = agentNameFromSystemMsg(conversation, msg);
  const isMe = !!(me && senderEmail && me === senderEmail);

  if (isHumanHandoffToBotSystemText(t) || isBotHandoffSystemText(t)) {
    return isMe
      ? 'You stepped away. AI assistant is replying to the visitor.'
      : `${senderName} stepped away. AI assistant is replying to the visitor.`;
  }
  if (isHumanRejoinSystemText(t) || /joined again\.?$/i.test(t)) {
    return isMe ? 'You joined again.' : `${senderName} joined again.`;
  }
  if (isHumanJoinSystemText(t) || /^you are now chatting with\s+/i.test(t)) {
    const visitor = visitorNameFromConversation(conversation);
    return `${visitor} joined the chat.`;
  }
  return t;
}

function enrichMessageForAudience(m, conversation, audience) {
  const role = normalizeMessageRole(m);
  const base = serializeMessage({ ...m, role });
  if (audience !== 'visitor') return base;
  if (base.role === 'system') {
    return {
      ...base,
      text: formatSystemMessageForVisitor(base.text, conversation, base),
    };
  }
  if (base.role === 'agent' && base.senderEmail) {
    return {
      ...base,
      senderDisplayName: resolveAgentDisplayName(base.senderEmail),
    };
  }
  return base;
}

function nowIso() {
  return new Date().toISOString();
}

function bumpSessionRevision(session) {
  if (!session) return 0;
  session.revision = (Number(session.revision) || 0) + 1;
  session.updatedAt = nowIso();
  return session.revision;
}

function sessionUpdatedMs(s) {
  if (!s) return 0;
  const t = Date.parse(s.updatedAt || s.closedAt || s.lastMessageAt || '');
  return Number.isFinite(t) ? t : 0;
}

/** Closed chats stay closed when merging GCS copies (prevents dismiss from reappearing). */
function mergeSessionPair(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  if (local.status === 'closed' || remote.status === 'closed') {
    if (local.status === 'closed' && remote.status === 'closed') {
      return sessionUpdatedMs(local) >= sessionUpdatedMs(remote) ? local : remote;
    }
    return local.status === 'closed' ? local : remote;
  }
  return sessionUpdatedMs(local) >= sessionUpdatedMs(remote) ? local : remote;
}

function mergeStores(localStore, remoteStore) {
  const out = { sessions: {} };
  const local = (localStore && localStore.sessions) || {};
  const remote = (remoteStore && remoteStore.sessions) || {};
  const ids = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const id of ids) {
    const merged = mergeSessionPair(local[id], remote[id]);
    if (merged) out.sessions[id] = merged;
  }
  return out;
}

function activeTypingText(text, atIso) {
  const t = trim(text);
  if (!t) return '';
  const at = Date.parse(atIso || '');
  if (!Number.isFinite(at) || Date.now() - at > TYPING_TTL_MS) return '';
  return t;
}

function normalizeEmail(email) {
  return trim(email).toLowerCase();
}

function safeId(id) {
  const s = trim(id);
  if (!s) throw new Error('Invalid conversation id');
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

function reloadStoreFromDisk() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      if (raw && typeof raw.sessions === 'object') {
        store = raw;
      } else {
        store = { sessions: {} };
      }
    }
  } catch (e) {
    console.warn('[live-agent] load failed:', e.message);
    store = { sessions: {} };
  }
}

function loadStore() {
  reloadStoreFromDisk();
  loaded = true;
}

function saveStore() {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_PATH);
  } catch (e) {
    console.warn('[live-agent] save failed:', e.message);
  }
}

function defaultSettings() {
  return {
    general: {
      showAgentNameToVisitor: true,
      agentProfiles: [],
      notifyDeskPanel: true,
      notifyDesktopPopup: true,
      notifyMobilePopup: true,
    },
    routing: { mode: 'parallel', algorithm: 'online_parallel', maxConcurrentChatsPerAgent: 5 },
    claimWaitSeconds: 30,
    departments: [{ id: 'general', name: 'General', agentEmails: [] }],
    knowledgeBase: { enabled: true, articles: [] },
    businessHours: liveAgentHours.defaultBusinessHours(),
    queueMaxWaitEnabled: true,
    queueMaxWaitMinutes: 10,
    queueTimeoutReply: liveAgentQueue.DEFAULT_QUEUE_REPLY,
  };
}

/** Close waiting chat when no agent accepted within configured max wait. */
function expireWaitingQueueIfNeeded(sessionId) {
  const id = safeId(sessionId);
  if (!loaded) loadStore();
  const s = getSession(id);
  if (!s || s.status !== 'waiting') {
    return { expired: false };
  }
  const queueCfg = liveAgentQueue.normalizeQueueSettings(loadSettings());
  if (!liveAgentQueue.shouldExpireWaiting(s, queueCfg)) {
    return { expired: false };
  }
  const reply = queueCfg.reply;
  appendMessage(s, {
    role: 'system',
    text: reply,
    bumpUnread: { visitor: 1, agent: 1 },
  });
  s.status = 'closed';
  s.humanMode = 'ai';
  s.aiEnabled = true;
  s.closedAt = nowIso();
  s.closedByEmail = '';
  s.closedReason = 'queue_timeout';
  s.queueTimedOut = true;
  s.dismissedAt = s.closedAt;
  s.visitorTypingText = '';
  s.visitorTypingAt = '';
  s.agentTypingText = '';
  s.agentTypingAt = '';
  bumpSessionRevision(s);
  signals.syncSignalFromSession(s);
  try {
    chatTranscript.mergeSessionMeta(s.sessionId, {
      liveAgentActive: false,
      liveAgentRequested: false,
      liveAgentBotHandoff: false,
      liveAgentQueueTimedOut: true,
    });
  } catch {
    /* ignore */
  }
  saveStore();
  return { expired: true, message: reply };
}

function settingsUpdatedMs(s) {
  const t = Date.parse(s && s.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

function readSettingsFile_() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeSettingsFile_(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

/** Pull shared settings from GCS before admin reads/writes (multi-instance Railway). */
async function syncSettingsFromGcs() {
  if (!gcsSync.useGcs()) return;
  const now = Date.now();
  if (now - lastSettingsGcsPullMs < SETTINGS_GCS_PULL_MIN_MS) return;
  lastSettingsGcsPullMs = now;
  try {
    const remote = await gcsSync.pullSettings();
    const local = readSettingsFile_() || defaultSettings();
    if (!remote) {
      if (local.updatedAt) {
        await gcsSync.pushSettings(local);
      }
      return;
    }
    if (
      !local.updatedAt ||
      settingsUpdatedMs(remote) >= settingsUpdatedMs(local)
    ) {
      writeSettingsFile_(remote);
    } else {
      await gcsSync.pushSettings(local);
    }
  } catch (e) {
    console.warn('[live-agent] settings GCS pull failed:', e.message);
  }
}

function loadSettings() {
  return readSettingsFile_() || defaultSettings();
}

function slugDepartmentId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Resolve Dialogflow/settings department label to stored id + display name. */
function resolveDepartment(departmentInput) {
  const raw = trim(departmentInput);
  if (!raw) {
    return { departmentId: 'general', departmentName: 'General' };
  }
  const settings = loadSettings();
  const depts = settings.departments || [];
  const lower = raw.toLowerCase();
  const slug = slugDepartmentId(raw);
  for (let i = 0; i < depts.length; i += 1) {
    const d = depts[i];
    if (!d) continue;
    const id = String(d.id || '').trim();
    const name = String(d.name || '').trim();
    if (id && id.toLowerCase() === lower) {
      return { departmentId: id, departmentName: name || id };
    }
    if (name && name.toLowerCase() === lower) {
      return { departmentId: id || slug, departmentName: name };
    }
    if (id && id.toLowerCase() === slug) {
      return { departmentId: id, departmentName: name || id };
    }
    if (name && slugDepartmentId(name) === slug) {
      return { departmentId: id || slug, departmentName: name };
    }
  }
  return {
    departmentId: slug || 'general',
    departmentName: raw,
  };
}

function findDepartmentInSettings(departmentId) {
  const id = trim(departmentId).toLowerCase() || 'general';
  const depts = loadSettings().departments || [];
  for (let i = 0; i < depts.length; i += 1) {
    const d = depts[i];
    if (d && String(d.id || '').trim().toLowerCase() === id) {
      return d;
    }
  }
  return null;
}

/** Whether an agent may see or accept chats for this department. */
function agentCanAccessDepartment(agentEmail, departmentId) {
  const me = normalizeEmail(agentEmail);
  if (!me.includes('@')) return false;
  const dept = findDepartmentInSettings(departmentId);
  if (!dept) {
    return isAgentEmailRegistered(me);
  }
  const emails = (dept.agentEmails || [])
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (!emails.length) {
    return isAgentEmailRegistered(me);
  }
  return emails.includes(me);
}

function filterInboxForAgentDepartment(list, agentEmail) {
  const me = normalizeEmail(agentEmail);
  if (!me) return list;
  const routing = liveAgentRouting.getRoutingConfig(loadSettings());
  return list.filter((c) => {
    if (normalizeEmail(c.assignedAgentEmail) === me) return true;
    if (!agentCanAccessDepartment(me, c.departmentId)) return false;
    if (c.status === 'waiting' && routing.mode === 'round_robin') {
      return liveAgentRouting.isOfferedToAgent(c, me);
    }
    return true;
  });
}

function processAllWaitingRoundRobin_() {
  const settings = loadSettings();
  const routing = liveAgentRouting.getRoutingConfig(settings);
  if (routing.mode !== 'round_robin') return false;
  if (!loaded) loadStore();
  let dirty = false;
  for (const key of Object.keys(store.sessions)) {
    const s = store.sessions[key];
    if (!s || s.status !== 'waiting') continue;
    if (liveAgentRouting.advanceRoundRobinIfDue(s, settings)) {
      bumpSessionRevision(s);
      signals.syncSignalFromSession(s);
      dirty = true;
    }
  }
  if (dirty) saveStore();
  return dirty;
}

async function saveSettings(settings) {
  const next = { ...settings, updatedAt: nowIso() };
  writeSettingsFile_(next);
  if (gcsSync.useGcs()) {
    try {
      await gcsSync.pushSettings(next);
    } catch (e) {
      console.warn('[live-agent] settings GCS push failed:', e.message);
    }
  }
  return next;
}

function ensureMessageIds(session) {
  if (!session || !Array.isArray(session.messages)) return false;
  let dirty = false;
  session.messages.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    if (!trim(m.id)) {
      m.id = randomUUID();
      dirty = true;
    }
    if (!trim(m.createdAt) && m.at) {
      m.createdAt = m.at;
      dirty = true;
    }
    if (!trim(m.role)) {
      m.role = normalizeMessageRole(m);
      dirty = true;
    }
  });
  return dirty;
}

function getSession(sessionId) {
  if (!loaded) loadStore();
  const key = safeId(sessionId);
  const s = store.sessions[key] || null;
  if (s && ensureMessageIds(s)) {
    saveStore();
  }
  return s;
}

function serializeConversation(id, s) {
  if (!s) return null;
  const status = s.status || 'waiting';
  let humanMode = s.humanMode || '';
  if (!humanMode) {
    if (status === 'waiting') humanMode = 'waiting';
    else if (status === 'active') humanMode = 'human';
    else humanMode = 'ai';
  }
  const msgs = s.messages || [];
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const visitorLabel = visitorNameFromConversation({ visitorName: s.visitorName });
  let lastMessagePreview = '';
  if (last) {
    const lastRole = normalizeMessageRole(last);
    if (lastRole === 'visitor') {
      lastMessagePreview =
        transcriptDisplay.formatVisitorMessageForAgentDesk(
          last.text,
          visitorLabel
        ) || String(last.text || '').slice(0, 120);
    } else if (lastRole === 'internal') {
      lastMessagePreview = `[Private] ${String(last.text || '').slice(0, 100)}`;
    } else {
      lastMessagePreview = String(last.text || '').slice(0, 120);
    }
  }
  return {
    id,
    status,
    humanMode,
    aiEnabled: typeof s.aiEnabled === 'boolean' ? s.aiEnabled : status === 'closed',
    botid: s.botid || 'default',
    visitorName: trim(s.visitorName),
    assignedAgentEmail: trim(s.assignedAgentEmail),
    assignedAgentDisplayName:
      trim(s.assignedAgentDisplayName) ||
      (trim(s.assignedAgentEmail)
        ? resolveAgentDisplayName(s.assignedAgentEmail)
        : ''),
    departmentId: s.departmentId || 'general',
    departmentName: s.departmentName || 'General',
    currentAssigneeEmail: trim(s.currentAssigneeEmail || s.assignedAgentEmail),
    lastMessagePreview,
    unreadForAgent: Number(s.unreadForAgent) || 0,
    unreadForVisitor: Number(s.unreadForVisitor) || 0,
    requestedAt: s.requestedAt || s.createdAt,
    claimedAt: s.claimedAt || s.acceptedAt,
    acceptedAt: s.acceptedAt || s.claimedAt,
    acceptedByEmail: trim(s.acceptedByEmail || s.assignedAgentEmail),
    closedAt: s.closedAt,
    closedByEmail: trim(s.closedByEmail),
    closedReason: trim(s.closedReason),
    queueTimedOut: !!s.queueTimedOut,
    routingMode: trim(s.routingMode),
    roundRobinOfferedAt: s.roundRobinOfferedAt || '',
    lastMessageAt: s.lastMessageAt || s.updatedAt,
    revision: Number(s.revision) || 0,
    visitorTypingText: visitorDraftText(s.visitorTypingText),
    visitorTypingAt: s.visitorTypingAt || '',
    agentTypingText: activeTypingText(s.agentTypingText, s.agentTypingAt),
    agentTypingAt: s.agentTypingAt || '',
  };
}

function serializeMessage(m) {
  const role = normalizeMessageRole(m);
  let from = 'user';
  if (role === 'agent') from = 'agent';
  else if (role === 'system') from = 'system';
  else if (role === 'internal') from = 'internal';
  return {
    id: m.id,
    role,
    text: m.text || '',
    senderEmail: trim(m.senderEmail),
    senderDisplayName: trim(m.senderDisplayName || m.senderEmail),
    createdAt: m.createdAt || m.at,
    from,
    internal: role === 'internal',
    at: m.createdAt || m.at,
  };
}

function appendMessage(session, opts) {
  const text = trim(opts.text);
  if (!text) return null;
  const role = trim(opts.role) || 'visitor';
  const msg = {
    id: randomUUID(),
    role,
    text,
    senderEmail: trim(opts.senderEmail),
    senderDisplayName: trim(opts.senderDisplayName),
    createdAt: nowIso(),
  };
  session.messages = session.messages || [];
  session.messages.push(msg);
  session.lastMessageAt = msg.createdAt;
  session.updatedAt = msg.createdAt;
  session.lastMessagePreview =
    role === 'internal'
      ? `[Private] ${text.slice(0, 100)}`
      : text.slice(0, 120);
  if (role === 'visitor') {
    session.visitorTypingText = '';
    session.visitorTypingAt = '';
  } else if (role === 'agent') {
    session.agentTypingText = '';
    session.agentTypingAt = '';
  }
  bumpSessionRevision(session);
  signals.syncSignalFromSession(session);
  if (opts.bumpUnread) {
    if (opts.bumpUnread.agent != null) {
      session.unreadForAgent = (Number(session.unreadForAgent) || 0) + opts.bumpUnread.agent;
    }
    if (opts.bumpUnread.visitor != null) {
      session.unreadForVisitor =
        (Number(session.unreadForVisitor) || 0) + opts.bumpUnread.visitor;
    }
  }
  const transcriptRole =
    role === 'agent' ? 'agent' : role === 'visitor' ? 'user' : null;
  if (transcriptRole) {
    try {
      chatTranscript.appendTurn(session.sessionId, transcriptRole, text, undefined, {
        scheduleSheet: false,
        id: msg.id,
      });
    } catch (e) {
      console.warn('[live-agent] transcript:', e.message);
    }
    scheduleSheet2Sync(session.sessionId);
  } else if (role === 'system') {
    try {
      const conv = serializeConversation(session.sessionId, session);
      const line = formatSystemMessageForVisitor(text, conv, msg);
      if (line) {
        chatTranscript.appendTurn(session.sessionId, 'assistant', line, undefined, {
          scheduleSheet: false,
          id: msg.id,
        });
      }
    } catch (e) {
      console.warn('[live-agent] transcript:', e.message);
    }
  }
  return msg;
}

function storageReady() {
  loadStore();
  if (gcsSync.useGcs()) {
    syncSettingsFromGcs().catch((e) => {
      console.warn('[live-agent] settings GCS startup sync:', e.message);
    });
  }
  return true;
}

function requestHumanAgent({
  conversationId,
  botid,
  visitorName,
  initialMessage,
  department,
}) {
  const id = safeId(conversationId);
  if (!loaded) loadStore();
  let s = store.sessions[id];
  if (s && (s.status === 'waiting' || s.status === 'active')) {
    return {
      conversation: serializeConversation(id, s),
      created: false,
    };
  }
  if (s && (s.status === 'closed' || s.dismissedAt)) {
    if (s.status !== 'closed') {
      s.status = 'closed';
      saveStore();
    }
    return {
      conversation: serializeConversation(id, s),
      created: false,
      dismissed: true,
    };
  }
  const hoursCheck = liveAgentHours.checkAvailability(loadSettings());
  if (!hoursCheck.available) {
    return {
      conversation: null,
      created: false,
      outsideHours: true,
      message: hoursCheck.message,
      reason: hoursCheck.reason || 'outside_hours',
    };
  }
  const t = nowIso();
  const dept = resolveDepartment(department);
  s = {
    sessionId: id,
    status: 'waiting',
    humanMode: 'waiting',
    aiEnabled: false,
    botid: trim(botid) || 'default',
    visitorName: trim(visitorName),
    assignedAgentEmail: '',
    departmentId: dept.departmentId,
    departmentName: dept.departmentName,
    messages: [],
    unreadForAgent: 0,
    unreadForVisitor: 0,
    createdAt: t,
    updatedAt: t,
    requestedAt: t,
  };
  liveAgentRouting.initRoundRobinOnSession(
    s,
    dept.departmentId,
    loadSettings()
  );
  if (syncVisitorNameFromTranscript(s)) saveStore();
  const visitorLabel = visitorNameFromConversation({ visitorName: s.visitorName });
  const deskInitial = trim(initialMessage)
    ? transcriptDisplay.formatVisitorMessageForAgentDesk(
        initialMessage,
        visitorLabel
      )
    : '';
  if (deskInitial) {
    appendMessage(s, {
      role: 'visitor',
      text: deskInitial,
      bumpUnread: { agent: 1, visitor: 0 },
    });
  } else {
    appendMessage(s, {
      role: 'system',
      text: transcriptDisplay.isHumanAgentHandoffToken(initialMessage)
        ? transcriptDisplay.formatHumanAgentRequestForDesk(visitorLabel)
        : 'Visitor requested a human agent.',
      bumpUnread: { agent: 1, visitor: 0 },
    });
  }
  store.sessions[id] = s;
  try {
    chatTranscript.mergeSessionMeta(id, {
      liveAgentRequested: true,
      liveAgentActive: true,
    });
  } catch {
    /* ignore */
  }
  saveStore();
  scheduleSheet2Sync(id);
  return { conversation: serializeConversation(id, s), created: true };
}

function getConversation(conversationId) {
  const s = getSession(conversationId);
  if (!s) return null;
  return serializeConversation(s.sessionId, s);
}

function visitorWaitingForAgent(conversation) {
  return !!(conversation && conversation.status === 'waiting');
}

/** True when an agent has joined and owns the chat (not queue wait, not desk "Bot on"). */
function visitorAgentChatActive(conversation) {
  if (!conversation || conversation.status !== 'active') return false;
  const hm = String(conversation.humanMode || '').toLowerCase();
  if (hm === 'ai') return false;
  if (hm === 'human' || conversation.aiEnabled === false) return true;
  return hm !== 'ai';
}

/** @deprecated alias — waiting queue is not human chat. */
function visitorHumanChatActive(conversation) {
  return visitorAgentChatActive(conversation);
}

/** Block Dialogflow only after an agent has joined (not while waiting in queue). */
function isDialogflowBlockedForSession(sessionId) {
  const sid = trim(sessionId);
  if (!sid) return false;
  const s = getSession(sid);
  if (!s) return false;
  if (isBotReplyModeSession(s)) return false;
  return visitorAgentChatActive(serializeConversation(s.sessionId, s));
}

async function syncPull(options) {
  const force = !!(options && options.force);
  if (!gcsSync.useGcs()) {
    reloadStoreFromDisk();
    loaded = true;
    return;
  }
  const maxAgeMs =
    options && Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : GCS_PULL_MIN_MS;
  const now = Date.now();
  if (!force && loaded && now - lastGcsPullMs < maxAgeMs) {
    return;
  }
  try {
    const remote = await gcsSync.pullStore();
    if (remote && typeof remote.sessions === 'object') {
      store = mergeStores(store, remote);
      saveStore();
    } else if (!loaded) {
      reloadStoreFromDisk();
    }
    loaded = true;
    lastGcsPullMs = now;
  } catch (e) {
    console.warn('[live-agent] GCS pull failed:', e.message);
    reloadStoreFromDisk();
    loaded = true;
  }
}

async function syncPush() {
  saveStore();
  loaded = true;
  try {
    await signals.pushSignals();
  } catch (e) {
    console.warn('[live-agent] signals push:', e.message);
  }
  if (gcsSync.useGcs()) {
    try {
      const remote = await gcsSync.pullStore();
      if (remote && typeof remote.sessions === 'object') {
        store = mergeStores(store, remote);
        saveStore();
      }
      await gcsSync.pushStore(store);
      lastGcsPullMs = Date.now();
    } catch (e) {
      console.warn('[live-agent] GCS push failed:', e.message);
    }
  }
}

async function updateVisitorTyping({ conversationId, text }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s || s.status === 'closed') return null;
  if (isBotReplyModeSession(s)) return null;
  const textVal = String(text || '').slice(0, 400);
  if (!trim(textVal).length || transcriptDisplay.isHandoffRequestLine(textVal)) {
    s.visitorTypingText = '';
    s.visitorTypingAt = '';
  } else {
    s.visitorTypingText = textVal;
    s.visitorTypingAt = nowIso();
  }
  bumpSessionRevision(s);
  saveStore();
  signals.syncSignalFromSession(s);
  await signals.pushSignals();
  return serializeConversation(id, s);
}

async function updateAgentTyping({ conversationId, text, active, agentEmail }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s || s.status === 'closed') return null;
  const on = active !== false && trim(text).length > 0;
  s.agentTypingText = on ? String(text).slice(0, 400) : '';
  s.agentTypingAt = on ? nowIso() : '';
  if (agentEmail) s.agentTypingEmail = normalizeEmail(agentEmail);
  bumpSessionRevision(s);
  saveStore();
  signals.syncSignalFromSession(s);
  await signals.pushSignals();
  return serializeConversation(id, s);
}

/** Compare client revision with signal file (fast); returns true if full sync needed. */
async function shouldFullSync(sessionId, clientRevision) {
  await signals.pullSignals({ maxAgeMs: 120 });
  const sig = signals.getSessionSignal(sessionId);
  const remoteRev = sig ? Number(sig.revision) || 0 : 0;
  const clientRev = Number(clientRevision) || 0;
  return remoteRev > clientRev;
}

/** Visitor poll: live-agent store only (transcript merge caused duplicate agent bubbles). */
function listMessagesForVisitor(conversationId, opts) {
  const tailN = opts && opts.tail ? Number(opts.tail) : 50;
  const tail = Number.isFinite(tailN) && tailN > 0 ? tailN : 50;
  const conv = getConversation(conversationId);
  let msgs = listMessages({
    conversationId,
    tail,
    audience: 'visitor',
  });
  msgs = msgs.filter((m) => normalizeMessageRole(m) !== 'internal');
  if (conv && visitorAgentChatActive(conv)) {
    msgs = msgs.filter((m) => {
      if (m.role !== 'system') return true;
      return !isBotHandoffSystemText(m.text);
    });
  }
  return msgs;
}

function buildVisitorSyncPayload(clientSessionId) {
  const settings = loadSettings();
  const sPre = getSession(clientSessionId);
  if (
    sPre &&
    sPre.status === 'waiting' &&
    liveAgentRouting.advanceRoundRobinIfDue(sPre, settings)
  ) {
    bumpSessionRevision(sPre);
    signals.syncSignalFromSession(sPre);
    saveStore();
  }
  const queueExpire = expireWaitingQueueIfNeeded(clientSessionId);
  const conversation = getConversation(clientSessionId);
  const waitingForAgent = visitorWaitingForAgent(conversation);
  const humanHandoffActive = visitorAgentChatActive(conversation);
  const sessionOpen = !!(
    conversation &&
    (conversation.status === 'waiting' || conversation.status === 'active')
  );
  const humanActive = humanHandoffActive;
  const agentConnected = !!(
    humanHandoffActive &&
    conversation &&
    conversation.status === 'active' &&
    conversation.assignedAgentEmail
  );
  const agentDisplayName = conversation
    ? trim(conversation.assignedAgentDisplayName) ||
      (conversation.assignedAgentEmail
        ? resolveAgentDisplayName(conversation.assignedAgentEmail)
        : '')
    : '';
  const messages = listMessagesForVisitor(clientSessionId, { tail: 50 });
  const revision = conversation ? Number(conversation.revision) || 0 : 0;
  const s = getSession(clientSessionId);
  const visitorNotice = s && conversation
    ? findLastVisitorNoticeMessage(s, conversation)
    : null;
  const visitorTyping = visitorTypingForDeskSession(s);
  const agentTyping = resolveAgentTypingLabelForVisitor(clientSessionId);
  const queueCfg = liveAgentQueue.normalizeQueueSettings(loadSettings());
  return {
    ok: true,
    revision,
    visitorTyping,
    agentTyping,
    conversation,
    queueTimedOut: !!(queueExpire.expired || (s && s.queueTimedOut)),
    queueTimeoutReply: queueExpire.expired
      ? queueExpire.message
      : s && s.queueTimedOut
        ? queueCfg.reply
        : '',
    humanActive,
    humanHandoffActive,
    waitingForAgent,
    sessionOpen,
    botMode: !humanHandoffActive,
    agentConnected,
    aiCopilot: !humanHandoffActive,
    assignedAgentDisplayName: agentDisplayName,
    agentProfiles: [],
    aiEnabled:
      conversation && conversation.status === 'active'
        ? conversation.aiEnabled === true
        : conversation
          ? conversation.aiEnabled !== false
          : true,
    humanMode: conversation ? conversation.humanMode : 'ai',
    status: conversation ? conversation.status : 'none',
    agentName: agentDisplayName,
    connectedMessage:
      visitorNotice && visitorNotice.type === 'connected'
        ? visitorNotice.text
        : agentConnected
          ? `You are now chatting with ${agentDisplayName}.`
          : '',
    visitorNotice,
    messages,
    storageBackend: gcsSync.useGcs() ? 'gcs' : 'local',
    lastMessageId: (() => {
      const s = getSession(clientSessionId);
      const msgs = (s && s.messages) || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return last && last.id ? last.id : '';
    })(),
  };
}

function listAllSessions() {
  if (!loaded) loadStore();
  return Object.values(store.sessions).filter(Boolean);
}

function listInbox({ status, agentEmail, limit }) {
  if (!loaded) loadStore();
  processAllWaitingRoundRobin_();
  const me = normalizeEmail(agentEmail);
  const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
  let nameDirty = false;
  let list = Object.values(store.sessions).map((s) => {
    if (syncVisitorNameFromTranscript(s)) nameDirty = true;
    return serializeConversation(s.sessionId, s);
  });
  if (nameDirty) saveStore();
  const st = trim(status).toLowerCase() || 'all';
  if (st === 'waiting') {
    list = list.filter((c) => c.status === 'waiting');
  } else if (st === 'active') {
    list = list.filter((c) => c.status === 'active');
  } else if (st === 'mine') {
    list = list.filter(
      (c) =>
        (c.status === 'waiting' || c.status === 'active') &&
        normalizeEmail(c.assignedAgentEmail) === me
    );
  } else if (st === 'closed') {
    list = list.filter((c) => c.status === 'closed');
  } else if (st === 'assigned') {
    list = list.filter((c) => c.assignedAgentEmail);
  } else if (st === 'unassigned') {
    list = list.filter((c) => c.status === 'waiting' && !c.assignedAgentEmail);
  } else if (st === 'ai') {
    list = list.filter(
      (c) => c.status === 'active' && String(c.humanMode).toLowerCase() === 'ai'
    );
  } else if (st === 'agent') {
    list = list.filter(
      (c) =>
        c.status === 'active' && String(c.humanMode).toLowerCase() === 'human'
    );
  } else {
    list = list.filter((c) => c.status !== 'closed');
  }
  list = filterInboxForAgentDepartment(list, me);
  list.sort((a, b) =>
    String(b.lastMessageAt || b.requestedAt || '').localeCompare(
      String(a.lastMessageAt || a.requestedAt || '')
    )
  );
  return list.slice(0, lim);
}

function acceptConversation({ conversationId, agentEmail }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  if (s.status === 'closed') throw new Error('Conversation is closed');
  const me = normalizeEmail(agentEmail);
  if (!me.includes('@')) throw new Error('Work email required to accept chats');
  if (!agentCanAccessDepartment(me, s.departmentId)) {
    throw new Error('This chat is assigned to another department');
  }
  liveAgentRouting.assertAgentMayAccept(
    s,
    me,
    loadSettings(),
    resolveAgentDisplayName
  );
  if (
    s.status === 'active' &&
    s.assignedAgentEmail &&
    normalizeEmail(s.assignedAgentEmail) !== me
  ) {
    throw new Error('Already assigned to another agent');
  }
  const t = nowIso();
  s.status = 'active';
  s.humanMode = 'human';
  s.aiEnabled = false;
  s.assignedAgentEmail = me;
  s.assignedAgentDisplayName = resolveAgentDisplayName(me);
  s.acceptedByEmail = me;
  s.acceptedAt = t;
  s.claimedAt = t;
  s.updatedAt = t;
  s.unreadForAgent = 0;
  if (syncVisitorNameFromTranscript(s)) saveStore();
  const agentDisplayName = resolveAgentDisplayName(me);
  appendMessage(s, {
    role: 'system',
    text: LIVE_AGENT_HUMAN_CONNECTED,
    senderEmail: me,
    senderDisplayName: agentDisplayName,
    bumpUnread: { visitor: 1, agent: 0 },
  });
  try {
    chatTranscript.mergeSessionMeta(s.sessionId, { liveAgentActive: true });
  } catch {
    /* ignore */
  }
  saveStore();
  scheduleSheet2Sync(id);
  return serializeConversation(id, s);
}

function closeConversation({ conversationId, agentEmail, closedBy }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  const me = normalizeEmail(agentEmail);
  if (
    s.status === 'active' &&
    me &&
    s.assignedAgentEmail &&
    normalizeEmail(s.assignedAgentEmail) !== me
  ) {
    throw new Error('Not your session');
  }
  s.status = 'closed';
  s.humanMode = 'ai';
  s.aiEnabled = true;
  s.closedAt = nowIso();
  s.closedByEmail = me;
  s.dismissedAt = s.closedAt;
  s.visitorTypingText = '';
  s.visitorTypingAt = '';
  s.agentTypingText = '';
  s.agentTypingAt = '';
  bumpSessionRevision(s);
  signals.syncSignalFromSession(s);
  appendMessage(s, {
    role: 'system',
    text: 'Chat ended. The visitor can continue with the assistant.',
    bumpUnread: { visitor: 1, agent: 0 },
  });
  try {
    chatTranscript.mergeSessionMeta(s.sessionId, {
      liveAgentActive: false,
      liveAgentRequested: false,
      liveAgentBotHandoff: false,
    });
  } catch {
    /* ignore */
  }
  saveStore();
  scheduleSheet2Sync(id);
  return serializeConversation(id, s);
}

function reopenConversation({ conversationId, agentEmail }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  const me = normalizeEmail(agentEmail);
  s.status = 'active';
  s.humanMode = 'human';
  s.aiEnabled = false;
  s.assignedAgentEmail = me || s.assignedAgentEmail;
  s.closedAt = '';
  s.updatedAt = nowIso();
  appendMessage(s, {
    role: 'system',
    text: 'Chat reopened.',
    bumpUnread: { visitor: 1, agent: 0 },
  });
  saveStore();
  return serializeConversation(id, s);
}

function listMessages({
  conversationId,
  sinceIso,
  sinceId,
  limit,
  tail,
  markReadFor,
  audience,
  viewingAgentEmail,
}) {
  const s = getSession(conversationId);
  if (!s) return [];
  const conv = serializeConversation(s.sessionId, s);
  let msgs = s.messages || [];
  const tailN = Number(tail);
  const useTail = Number.isFinite(tailN) && tailN > 0;
  if (!useTail) {
    const sid = trim(sinceId);
    if (sid) {
      const idx = msgs.findIndex((m) => m && m.id === sid);
      msgs = idx >= 0 ? msgs.slice(idx + 1) : msgs;
    } else {
      const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
      if (sinceMs) {
        msgs = msgs.filter((m) => {
          const t = Date.parse(m.createdAt || m.at);
          return Number.isFinite(t) ? t > sinceMs : true;
        });
      }
    }
  }
  const aud = trim(audience).toLowerCase();
  if (aud === 'visitor') {
    msgs = msgs.filter((m) => {
      const role = normalizeMessageRole(m);
      return role === 'agent' || role === 'system';
    });
  }
  /* desk sees all roles including internal */
  if (useTail) {
    msgs = msgs.slice(-Math.min(Math.max(tailN, 1), 100));
  } else if (limit) {
    msgs = msgs.slice(-limit);
  }
  if (markReadFor === 'agent') {
    s.unreadForAgent = 0;
    saveStore();
  }
  if (markReadFor === 'visitor') {
    s.unreadForVisitor = 0;
    saveStore();
  }
  const viewer = normalizeEmail(viewingAgentEmail);
  return msgs.map((m) => {
    if (aud === 'visitor') {
      return enrichMessageForAudience(m, conv, 'visitor');
    }
    const base = serializeMessage(m);
    const role = normalizeMessageRole(m);
    if (role === 'system') {
      return {
        ...base,
        text: formatSystemMessageForAgent(base.text, conv, base, viewer),
      };
    }
    if (role === 'visitor') {
      const line = transcriptDisplay.formatVisitorMessageForAgentDesk(
        base.text,
        visitorNameFromConversation(conv)
      );
      if (line) return { ...base, text: line };
    }
    return base;
  });
}

function postAgentMessage({ conversationId, text, agentEmail, agentName }) {
  const id = safeId(conversationId);
  let s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  if (s.status === 'closed') throw new Error('Conversation is closed');
  const me = normalizeEmail(agentEmail);
  if (!me.includes('@')) throw new Error('Work email required');
  const isInternal = isInternalNoteInput(text);
  const body = isInternal ? stripInternalNotePrefix(text) : trim(text);
  if (!body) throw new Error('Message required');
  if (!isInternal) {
    if (s.status === 'waiting') {
      acceptConversation({ conversationId: id, agentEmail: me });
      s = getSession(id);
    }
    if (
      s.status === 'active' &&
      s.assignedAgentEmail &&
      normalizeEmail(s.assignedAgentEmail) !== me
    ) {
      throw new Error('Assigned to another agent');
    }
  }
  const msg = appendMessage(s, {
    role: isInternal ? 'internal' : 'agent',
    text: body,
    senderEmail: me,
    senderDisplayName: trim(agentName) || resolveAgentDisplayName(me),
    bumpUnread: isInternal
      ? { agent: 1, visitor: 0 }
      : { visitor: 1, agent: 0 },
  });
  saveStore();
  return {
    message: serializeMessage(msg),
    conversation: serializeConversation(id, s),
    internal: isInternal,
  };
}

function postVisitorMessage({ conversationId, text }) {
  const id = safeId(conversationId);
  let s = getSession(id);
  if (s && s.status === 'closed') throw new Error('No active human chat');
  if (!s) {
    requestHumanAgent({ conversationId: id });
    s = getSession(id);
  }
  if (!s) throw new Error('No active human chat');
  if (s.status === 'closed') throw new Error('No active human chat');
  const visitorLabel = visitorNameFromConversation({ visitorName: s.visitorName });
  if (
    transcriptDisplay.isHumanAgentHandoffToken(text) &&
    sessionHasHandoffRequestLine(s)
  ) {
    return {
      message: null,
      conversation: serializeConversation(id, s),
      skipped: true,
    };
  }
  const deskText = transcriptDisplay.formatVisitorMessageForAgentDesk(
    text,
    visitorLabel
  );
  if (
    deskText &&
    transcriptDisplay.isHandoffRequestLine(deskText) &&
    sessionHasHandoffRequestLine(s)
  ) {
    return {
      message: null,
      conversation: serializeConversation(id, s),
      skipped: true,
    };
  }
  if (!deskText && transcriptDisplay.isInternalActionToken(text)) {
    return {
      message: null,
      conversation: serializeConversation(id, s),
      skipped: true,
    };
  }
  const msg = appendMessage(s, {
    role: 'visitor',
    text: deskText || trim(text),
    bumpUnread: { agent: 1, visitor: 0 },
  });
  saveStore();
  return { message: serializeMessage(msg), conversation: serializeConversation(id, s) };
}

function updateConversationMode({
  conversationId,
  aiEnabled,
  humanMode,
  agentEmail,
}) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  const wasBotReply = isBotReplyModeSession(s);
  if (humanMode) s.humanMode = humanMode;
  if (typeof aiEnabled === 'boolean') s.aiEnabled = aiEnabled;
  const hm = String(s.humanMode || '').toLowerCase();
  if (hm === 'human') {
    s.aiEnabled = false;
  }
  s.updatedAt = nowIso();
  const botOn =
    hm === 'ai' ||
    (hm !== 'human' &&
      typeof s.aiEnabled === 'boolean' &&
      s.aiEnabled === true);
  if (botOn) {
    s.visitorTypingText = '';
    s.visitorTypingAt = '';
    s.agentTypingText = '';
    s.agentTypingAt = '';
    bumpSessionRevision(s);
    signals.syncSignalFromSession(s);
  }
  try {
    if (botOn) {
      chatTranscript.mergeSessionMeta(s.sessionId, {
        liveAgentActive: false,
        liveAgentRequested: false,
        liveAgentBotHandoff: true,
      });
      const me = normalizeEmail(agentEmail) || normalizeEmail(s.assignedAgentEmail);
      appendMessage(s, {
        role: 'system',
        text: LIVE_AGENT_HANDOFF_TO_BOT,
        senderEmail: me,
        senderDisplayName: me ? resolveAgentDisplayName(me) : '',
        bumpUnread: { visitor: 1, agent: 0 },
      });
    } else if (hm === 'human') {
      chatTranscript.mergeSessionMeta(s.sessionId, {
        liveAgentActive: true,
        liveAgentBotHandoff: false,
      });
      if (wasBotReply) {
        const me = normalizeEmail(agentEmail) || normalizeEmail(s.assignedAgentEmail);
        appendMessage(s, {
          role: 'system',
          text: LIVE_AGENT_HUMAN_REJOINED,
          senderEmail: me,
          senderDisplayName: me ? resolveAgentDisplayName(me) : '',
          bumpUnread: { visitor: 1, agent: 0 },
        });
        s.visitorTypingText = '';
        s.visitorTypingAt = '';
        s.agentTypingText = '';
        s.agentTypingAt = '';
        bumpSessionRevision(s);
        signals.syncSignalFromSession(s);
      }
    }
  } catch {
    /* ignore */
  }
  saveStore();
  return serializeConversation(id, s);
}

function transferConversation({ conversationId, fromAgentEmail, toAgentEmail }) {
  const id = safeId(conversationId);
  const s = getSession(id);
  if (!s) throw new Error('Conversation not found');
  const to = normalizeEmail(toAgentEmail);
  if (!to.includes('@')) throw new Error('Invalid agent email');
  s.assignedAgentEmail = to;
  s.assignedAgentDisplayName = resolveAgentDisplayName(to);
  s.currentAssigneeEmail = to;
  s.updatedAt = nowIso();
  const from = normalizeEmail(fromAgentEmail);
  appendMessage(s, {
    role: 'internal',
    text: `Chat transferred to ${resolveAgentDisplayName(to)} (${to}).`,
    senderEmail: from,
    senderDisplayName: from ? resolveAgentDisplayName(from) : '',
    bumpUnread: { agent: 1, visitor: 0 },
  });
  appendMessage(s, {
    role: 'system',
    text: LIVE_AGENT_HUMAN_CONNECTED,
    senderEmail: to,
    senderDisplayName: resolveAgentDisplayName(to),
    bumpUnread: { visitor: 1, agent: 0 },
  });
  saveStore();
  return serializeConversation(id, s);
}

function bulkCloseTests({ idPrefix, maxClose }) {
  loadStore();
  const prefix = trim(idPrefix) || 'test-';
  const max = Math.min(Number(maxClose) || 150, 500);
  let closed = 0;
  Object.keys(store.sessions).forEach((id) => {
    if (closed >= max) return;
    if (!id.startsWith(prefix)) return;
    const s = store.sessions[id];
    if (s && s.status !== 'closed') {
      s.status = 'closed';
      s.humanMode = 'ai';
      s.aiEnabled = true;
      s.closedAt = nowIso();
      closed += 1;
    }
  });
  if (closed) saveStore();
  return { closed, idPrefix: prefix };
}

function touchAgentPresence(email, status) {
  return {
    email: normalizeEmail(email),
    status: status || 'online',
    effectiveStatus: status || 'online',
  };
}

function listAgentsOverview() {
  const settings = loadSettings();
  const emails = new Set();
  (settings.departments || []).forEach((d) => {
    (d.agentEmails || []).forEach((e) => emails.add(normalizeEmail(e)));
  });
  loadStore();
  const stats = {};
  emails.forEach((e) => {
    stats[e] = { email: e, activeChats: 0, totalAccepted: 0, effectiveStatus: 'offline' };
  });
  Object.values(store.sessions).forEach((s) => {
    const a = normalizeEmail(s.assignedAgentEmail);
    if (!a) return;
    if (!stats[a]) stats[a] = { email: a, activeChats: 0, totalAccepted: 0, effectiveStatus: 'online' };
    if (s.status === 'active') stats[a].activeChats += 1;
    if (s.acceptedAt) stats[a].totalAccepted += 1;
  });
  return Object.values(stats);
}

function isAgentEmailRegistered(email) {
  const settings = loadSettings();
  const me = normalizeEmail(email);
  const all = [];
  (settings.departments || []).forEach((d) => {
    (d.agentEmails || []).forEach((e) => all.push(normalizeEmail(e)));
  });
  if (!all.length) return true;
  return all.includes(me);
}

module.exports = {
  DATA_PATH,
  LIVE_AGENT_HUMAN_CONNECTED,
  LIVE_AGENT_HUMAN_REJOINED,
  LIVE_AGENT_HANDOFF_TO_BOT,
  LIVE_AGENT_BOT_ACTIVE,
  findLastVisitorNoticeMessage,
  LIVE_AGENT_BOT_ACTIVE_VISITOR_TEXT,
  resolveAgentDisplayName,
  storageReady,
  syncPull,
  syncPush,
  bumpSessionRevision,
  updateVisitorTyping,
  updateAgentTyping,
  shouldFullSync,
  activeTypingText,
  loadSettings,
  saveSettings,
  syncSettingsFromGcs,
  resolveDepartment,
  agentCanAccessDepartment,
  requestHumanAgent,
  getConversation,
  visitorWaitingForAgent,
  visitorAgentChatActive,
  visitorHumanChatActive,
  isDialogflowBlockedForSession,
  listMessagesForVisitor,
  buildVisitorSyncPayload,
  enrichPayloadFromSignals,
  visitorTypingForDesk,
  agentTypingLabelForVisitor,
  listAllSessions,
  listInbox,
  saveStore,
  acceptConversation,
  closeConversation,
  reopenConversation,
  listMessages,
  postAgentMessage,
  postVisitorMessage,
  updateConversationMode,
  transferConversation,
  bulkCloseTests,
  touchAgentPresence,
  listAgentsOverview,
  isAgentEmailRegistered,
  getSession,
  serializeConversation,
  serializeMessage,
  formatSystemMessageForVisitor,
  formatSystemMessageForAgent,
};
