/**
 * Visitor queue timeout — max wait while no agent accepts (live-agent-settings.json).
 */

const DEFAULT_QUEUE_REPLY =
  'All our agents are busy at the moment. Please continue with the assistant below, or try again shortly.';

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeQueueSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const enabled = s.queueMaxWaitEnabled !== false;
  const minutes = Math.min(
    Math.max(Number(s.queueMaxWaitMinutes) || 10, 1),
    180
  );
  const reply = trim(s.queueTimeoutReply) || DEFAULT_QUEUE_REPLY;
  return {
    enabled,
    minutes,
    reply: reply.slice(0, 2000),
  };
}

function waitingElapsedMs(session) {
  if (!session) return 0;
  const t = Date.parse(session.requestedAt || session.createdAt || '');
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : 0;
}

function shouldExpireWaiting(session, queueCfg) {
  if (!session || session.status !== 'waiting') return false;
  if (!queueCfg || !queueCfg.enabled) return false;
  return waitingElapsedMs(session) >= queueCfg.minutes * 60 * 1000;
}

module.exports = {
  DEFAULT_QUEUE_REPLY,
  normalizeQueueSettings,
  waitingElapsedMs,
  shouldExpireWaiting,
};
