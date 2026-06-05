/** QA sandbox — full chatbot UI without leads, transcripts, sheets, or bookings. */

const QA_SESSION_PREFIX = 'qa-test-';

function isQaSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  return sid.startsWith(QA_SESSION_PREFIX);
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isQaRequest(req, sessionId) {
  const sid = String(
    sessionId ||
      (req && req.body && req.body.sessionId) ||
      (req && req.body && req.body.session_id) ||
      ''
  ).trim();
  if (isQaSessionId(sid)) return true;
  if (!req) return false;
  const header = req.headers && (req.headers['x-qa-mode'] || req.headers['X-QA-Mode']);
  if (isTruthyFlag(header)) return true;
  const body = req.body || {};
  return isTruthyFlag(body.qaMode) || isTruthyFlag(body.qa_mode);
}

module.exports = {
  QA_SESSION_PREFIX,
  isQaSessionId,
  isQaRequest,
};
