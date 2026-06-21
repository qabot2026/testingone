/**
 * Visitor context panel for service desk (transcript meta + sheet row).
 */

const chatTranscript = require('./chat-transcript');
const sheets = require('./sheets');
const documentDisplay = require('./document-display');

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

async function getVisitorContext(sessionId, options) {
  const sid = trim(sessionId);
  const base = {
    sessionId: sid,
    name: '',
    email: '',
    mobile: '',
    channel: '',
    sourceUrl: '',
    documents: [],
    transcriptUrl: sid
      ? `/conversation-transcript?session=${encodeURIComponent(sid)}`
      : '',
    hasLead: false,
  };
  if (!sid) return base;

  const conv = options && options.conversation;
  if (conv && trim(conv.visitorName)) {
    base.name = trim(conv.visitorName);
  }

  const doc = chatTranscript.getSessionDoc(sid);
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  if (!base.name && meta.name) base.name = trim(meta.name);
  if (meta.email) base.email = trim(meta.email);
  if (meta.mobile || meta.phone) base.mobile = trim(meta.mobile || meta.phone);
  if (meta.channel) base.channel = trim(meta.channel);
  if (meta.sourceUrl || meta.pageUrl || meta.url) {
    base.sourceUrl = trim(meta.sourceUrl || meta.pageUrl || meta.url);
  }

  const docNames = documentDisplay.documentNamesFromMeta(meta);
  if (docNames) {
    docNames.split(/[,;\n]+/).forEach((part) => {
      const label = trim(part);
      if (label) base.documents.push({ label, url: '' });
    });
  }

  if (sheets.isConfigured()) {
    try {
      const row = await sheets.fetchSheetRowBySessionId(sid);
      if (row && row.columns) {
        const c = row.columns;
        if (!base.name && c.Name) base.name = trim(c.Name);
        if (!base.email && c.Email) base.email = trim(c.Email);
        if (!base.mobile && c.Mobile) base.mobile = trim(c.Mobile);
        if (!base.channel && c.Channel) base.channel = trim(c.Channel);
        if (!base.sourceUrl && c['Source URL']) base.sourceUrl = trim(c['Source URL']);
        const docField = c.Document;
        if (docField) {
          const formatted = documentDisplay.formatDocumentFieldForDisplay(docField);
          formatted.split(/[,;\n]+/).forEach((part) => {
            const label = trim(part);
            if (label && !base.documents.some((d) => d.label === label)) {
              base.documents.push({ label, url: '' });
            }
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  base.hasLead = Boolean(
    base.name ||
      base.email ||
      base.mobile ||
      base.channel ||
      base.sourceUrl ||
      base.documents.length
  );
  return base;
}

module.exports = { getVisitorContext };
