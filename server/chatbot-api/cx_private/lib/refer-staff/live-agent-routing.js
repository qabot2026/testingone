/**
 * Live agent routing — online parallel vs department round robin (claim wait).
 */

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeEmail(email) {
  return trim(email).toLowerCase();
}

function findDepartmentInSettings(departmentId, settings) {
  const id = trim(departmentId).toLowerCase() || 'general';
  const depts = (settings && settings.departments) || [];
  for (let i = 0; i < depts.length; i += 1) {
    const d = depts[i];
    if (d && String(d.id || '').trim().toLowerCase() === id) {
      return d;
    }
  }
  return null;
}

/** @param {object} settings */
function getRoutingConfig(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const r = s.routing && typeof s.routing === 'object' ? s.routing : {};
  const raw = trim(s.routingAlgorithm || r.algorithm || r.mode || 'online_parallel');
  const mode = raw === 'round_robin' ? 'round_robin' : 'online_parallel';
  const claimWaitSeconds = Math.min(
    Math.max(Number(s.claimWaitSeconds) || 30, 5),
    300
  );
  return { mode, claimWaitSeconds, claimWaitMs: claimWaitSeconds * 1000 };
}

function getDepartmentAgentEmails(departmentId, settings) {
  const dept = findDepartmentInSettings(departmentId, settings);
  const seen = new Set();
  const out = [];
  const push = (email) => {
    const e = normalizeEmail(email);
    if (!e.includes('@') || seen.has(e)) return;
    seen.add(e);
    out.push(e);
  };
  if (dept && Array.isArray(dept.agentEmails)) {
    for (const raw of dept.agentEmails) {
      push(raw);
    }
  }
  if (!out.length) {
    const profiles = (settings.general && settings.general.agentProfiles) || [];
    for (const p of profiles) {
      push(p && p.email);
    }
  }
  return out;
}

function isRoundRobinSession(session, routing) {
  if (!session || session.status !== 'waiting') return false;
  const cfg = routing || { mode: 'online_parallel' };
  if (cfg.mode !== 'round_robin') return false;
  return !!(session.roundRobinAgents && session.roundRobinAgents.length);
}

function isOfferedToAgent(conversation, agentEmail) {
  const me = normalizeEmail(agentEmail);
  if (!me.includes('@')) return false;
  const offered = normalizeEmail(
    conversation && conversation.currentAssigneeEmail
  );
  if (!offered) return true;
  return offered === me;
}

function initRoundRobinOnSession(session, departmentId, settings) {
  const routing = getRoutingConfig(settings);
  session.routingMode = routing.mode;
  if (routing.mode !== 'round_robin') {
    session.roundRobinAgents = [];
    session.roundRobinIndex = 0;
    return;
  }
  const agents = getDepartmentAgentEmails(departmentId, settings);
  if (!agents.length) {
    session.roundRobinAgents = [];
    session.currentAssigneeEmail = '';
    return;
  }
  session.roundRobinAgents = agents;
  session.roundRobinIndex = 0;
  session.currentAssigneeEmail = agents[0];
  session.roundRobinOfferedAt = session.roundRobinOfferedAt || session.requestedAt;
}

/**
 * Advance to next department agent when claim window elapsed.
 * @returns {boolean} true if session changed
 */
function advanceRoundRobinIfDue(session, settings) {
  if (!session || session.status !== 'waiting') return false;
  const routing = getRoutingConfig(settings);
  if (!isRoundRobinSession(session, routing)) return false;
  const agents = session.roundRobinAgents || [];
  if (!agents.length) return false;
  const offeredAt = Date.parse(session.roundRobinOfferedAt || session.requestedAt || '');
  if (!Number.isFinite(offeredAt)) return false;
  if (Date.now() - offeredAt < routing.claimWaitMs) return false;

  const nextIndex = ((Number(session.roundRobinIndex) || 0) + 1) % agents.length;
  session.roundRobinIndex = nextIndex;
  session.currentAssigneeEmail = agents[nextIndex];
  session.roundRobinOfferedAt = new Date().toISOString();
  return true;
}

function assertAgentMayAccept(session, agentEmail, settings, resolveDisplayName) {
  const routing = getRoutingConfig(settings);
  if (!isRoundRobinSession(session, routing)) return;
  advanceRoundRobinIfDue(session, settings);
  const me = normalizeEmail(agentEmail);
  const offered = normalizeEmail(session.currentAssigneeEmail);
  if (offered && offered !== me) {
    const name =
      typeof resolveDisplayName === 'function'
        ? resolveDisplayName(offered)
        : offered;
    throw new Error(
      `This chat is currently offered to ${name}. It will rotate to the next agent in ${routing.claimWaitSeconds}s if not accepted.`
    );
  }
}

module.exports = {
  getRoutingConfig,
  getDepartmentAgentEmails,
  findDepartmentInSettings,
  isRoundRobinSession,
  isOfferedToAgent,
  initRoundRobinOnSession,
  advanceRoundRobinIfDue,
  assertAgentMayAccept,
};
