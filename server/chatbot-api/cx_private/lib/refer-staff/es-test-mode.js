/** ES test sandbox — full chatbot UI without leads, transcripts, sheets, or bookings. */

const ES_TEST_SESSION_PREFIX = 'es-test-';

function isEsTestSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  return sid.startsWith(ES_TEST_SESSION_PREFIX);
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isEsTestRequest(req, sessionId) {
  const sid = String(
    sessionId ||
      (req && req.body && req.body.sessionId) ||
      (req && req.body && req.body.session_id) ||
      ''
  ).trim();
  if (isEsTestSessionId(sid)) return true;
  if (!req) return false;
  const header =
    req.headers && (req.headers['x-es-test-mode'] || req.headers['X-ES-Test-Mode']);
  if (isTruthyFlag(header)) return true;
  const body = req.body || {};
  return isTruthyFlag(body.esTestMode) || isTruthyFlag(body.es_test_mode);
}

module.exports = {
  ES_TEST_SESSION_PREFIX,
  isEsTestSessionId,
  isEsTestRequest,
  /** @deprecated use isEsTestSessionId */
  isQaSessionId: isEsTestSessionId,
  /** @deprecated use isEsTestRequest */
  isQaRequest: isEsTestRequest,
};
