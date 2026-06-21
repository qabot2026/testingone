/**
 * Receptionist (home) ↔ child project agents — routing helpers.
 * Dialogflow ES: one agent per GCP project; projectId selects the agent.
 */

const appEnv = require('./app-env');

const PROJECT_ID = appEnv.DIALOGFLOW_PROJECT_ID;

function normalizeText_(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeTriggers_(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeText_(item)).filter(Boolean);
}

function matchTrigger_(text, triggers) {
  const needle = normalizeText_(text);
  if (!needle) return false;
  const list = normalizeTriggers_(triggers);
  return list.some((t) => t === needle);
}

function resolveProjectId(requested) {
  const primary = String(PROJECT_ID || '').trim();
  const pid = String(requested || primary).trim() || primary;
  if (!/^[a-z][a-z0-9-]{4,}$/i.test(pid)) {
    throw new Error('Invalid Dialogflow project id');
  }
  if (pid === primary) return pid;

  const allowed = String(appEnv.DIALOGFLOW_ALLOWED_PROJECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length && allowed.indexOf(pid) < 0) {
    throw new Error(
      `Dialogflow project not allowed: ${pid}. Add it to DIALOGFLOW_ALLOWED_PROJECTS.`
    );
  }
  return pid;
}

module.exports = {
  PROJECT_ID,
  normalizeText: normalizeText_,
  normalizeTriggers: normalizeTriggers_,
  matchTrigger: matchTrigger_,
  resolveProjectId,
};
