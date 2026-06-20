/**
 * Conversation sentiment label for Google Sheet "Sentiment" column.
 */

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function sentimentLabelFromDoc(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  return (
    trim(meta.sentiment) ||
    trim(meta.conversationSentiment) ||
    trim(meta.chatSentiment) ||
    ''
  );
}

module.exports = {
  sentimentLabelFromDoc,
};
