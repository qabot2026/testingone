/**
 * Stub — ES live-agent uses Firestore (lib/live-agent/store.mjs).
 * Refer sheet2 sync needs a file store; read-only Sheet2 view works without this.
 */

module.exports = {
  getSession() {
    return null;
  },
  saveStore() {},
  listSessions() {
    return [];
  }
};
