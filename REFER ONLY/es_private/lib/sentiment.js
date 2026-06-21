/**
 * Chat sentiment from user message keywords (Only Refer / conversation-metrics.mjs).
 */

const POSITIVE_RE =
  /\b(thank|thanks|thankyou|great|good|excellent|happy|love|appreciate|wonderful|amazing|helpful|satisfied|perfect|awesome|fantastic|pleased|glad|nice|delighted)\b/gi;

const NEGATIVE_RE =
  /\b(bad|terrible|awful|angry|hate|disappointed|frustrat|complaint|worst|rude|unhappy|poor|horrible|useless|annoyed|upset|disgust|not\s+happy|waste|pathetic|disappointing)\b/gi;

/** @returns {"positive"|"negative"|""} */
function sentimentPolarity(text) {
  const s = String(text || '').toLowerCase();
  if (!s || s.length < 2) return '';

  const pos = (s.match(POSITIVE_RE) || []).length;
  const neg = (s.match(NEGATIVE_RE) || []).length;
  if (pos === 0 && neg === 0) return '';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return '';
}

/** @returns {"Positive"|"Negative"|""} */
function sentimentLabelFromText(text) {
  const pol = sentimentPolarity(text);
  if (pol === 'positive') return 'Positive';
  if (pol === 'negative') return 'Negative';
  return '';
}

function collectChatTextForSentiment(doc) {
  const meta = (doc && doc.meta) || {};
  const turns = (doc && doc.turns) || [];
  const parts = [];

  turns.forEach((t) => {
    if (t && t.role === 'user' && t.text) parts.push(String(t.text));
  });

  ['feedback', 'feedbackMessage', 'message_feedback', 'message'].forEach((k) => {
    if (meta[k] != null && String(meta[k]).trim()) parts.push(String(meta[k]));
  });

  return parts.join(' ');
}

/** @returns {"Positive"|"Negative"|""} */
function sentimentLabelFromDoc(doc) {
  return sentimentLabelFromText(collectChatTextForSentiment(doc));
}

module.exports = {
  sentimentPolarity,
  sentimentLabelFromText,
  sentimentLabelFromDoc,
  collectChatTextForSentiment,
};
