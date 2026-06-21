/**
 * Staff transcript + sheet labels for form payloads ([form:id] …).
 */

const FORM_DISPLAY_NAMES = {
  contact: 'Contact',
  upload: 'Upload',
  uploaddocument: 'Upload',
  feedback: 'Feedback',
  appointment: 'Appointment',
  birth: 'Birth',
  birthform: 'Birth',
  otp: 'OTP',
  nearestbranch: 'Nearest Branch',
  'nearest-branch': 'Nearest Branch',
  appintmentformgeneral: 'General Appointment',
  'general-appointment': 'General Appointment',
  appintmentformdoctor: 'Doctor Appointment',
  'doctor-appointment': 'Doctor Appointment',
};

function titleCase(s) {
  return String(s || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function compactId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function displayNameForFormId(formId, staffLabel) {
  const raw = String(formId || staffLabel || '').trim();
  if (!raw) return '';
  if (FORM_DISPLAY_NAMES[raw]) return FORM_DISPLAY_NAMES[raw];
  const c = compactId(raw);
  if (FORM_DISPLAY_NAMES[c]) return FORM_DISPLAY_NAMES[c];
  if (c === 'upload' || c === 'uploaddocument') return 'Upload';
  return titleCase(raw);
}

/** Parse widget `formatSubmission` payload. */
function parseFormPayload(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw || !/^\[form:/i.test(raw)) return null;

  const formMatch = raw.match(/^\[form:([^\]\s]+)\]/i);
  if (!formMatch) return null;

  const staffMatch = raw.match(/^staff:\s*(\S+)/im);
  const actionMatch = raw.match(/^action:\s*(\S+)/im);

  return {
    formId: formMatch[1].trim(),
    staffLabel: staffMatch ? staffMatch[1].trim() : '',
    action: actionMatch ? actionMatch[1].trim().toLowerCase() : '',
    raw,
  };
}

function isFormSubmitPayload(text) {
  return !!parseFormPayload(text);
}

function stripDialogflowActionPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^(?:query|event):/i, '')
    .trim();
}

function isInternalActionToken(s) {
  const t = stripDialogflowActionPrefix(s);
  return (
    !t ||
    /^__GO_/i.test(t) ||
    t.toLowerCase() === 'upload' ||
    t.toLowerCase() === 'resend_otp'
  );
}

/** Dialogflow routing token from open_form onSubmit (e.g. query:__GO_human agent__). */
function isHumanAgentHandoffToken(text) {
  const raw = stripDialogflowActionPrefix(text);
  if (!raw) return false;
  if (/^__GO_/i.test(raw) && /human\s*agent/i.test(raw)) return true;
  const inner = raw.replace(/^__GO_/i, '').trim();
  if (/^human\s*agent$/i.test(inner)) return true;
  if (/^human\s*agent$/i.test(raw)) return true;
  return false;
}

function formatHumanAgentRequestForDesk(visitorName) {
  const name = String(visitorName || '').trim();
  if (name && !/^visitor$/i.test(name)) {
    return `${name} requested a chat with an agent.`;
  }
  return 'Visitor requested a chat with an agent.';
}

function isHandoffRequestLine(text) {
  const t = String(text || '').trim();
  return (
    isHumanAgentHandoffToken(t) ||
    /requested a (chat with an|human) agent/i.test(t)
  );
}

/** Agent desk + inbox preview — never show raw __GO_ tokens to staff. */
function formatVisitorMessageForAgentDesk(text, visitorName) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';

  if (isHumanAgentHandoffToken(raw)) {
    return formatHumanAgentRequestForDesk(visitorName);
  }

  const parsed = parseFormPayload(raw);
  if (parsed) {
    return normalizeUserQueryText(raw);
  }

  const closedMatch = raw.match(/^__form_closed:(\S+)/i);
  if (closedMatch) {
    return formClosedLabel(closedMatch[1], '');
  }

  if (isInternalActionToken(raw)) return '';

  return raw;
}

function formSubmittedLabel(formId, staffLabel) {
  const id = compactId(formId);
  const staff = compactId(staffLabel);
  const key = id || staff;

  if (key === 'upload' || key === 'uploaddocument') {
    return 'Document uploaded.';
  }
  if (key === 'contact') {
    return 'Contact Form Submitted';
  }

  const name = displayNameForFormId(formId, staffLabel);
  return `${name} Form Submitted`;
}

function formClosedLabel(formId, staffLabel) {
  const name = displayNameForFormId(formId, staffLabel);
  return `${name} form closed`;
}

/** User-turn line for transcript + User Queries column. */
function normalizeUserQueryText(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';

  const parsed = parseFormPayload(raw);
  if (parsed) {
    if (parsed.action === 'resend' && compactId(parsed.formId) === 'otp') {
      return 'OTP resend requested';
    }
    return formSubmittedLabel(parsed.formId, parsed.staffLabel);
  }

  const closedMatch = raw.match(/^__form_closed:(\S+)/i);
  if (closedMatch) {
    return formClosedLabel(closedMatch[1], '');
  }

  if (isInternalActionToken(raw)) return '';

  return raw;
}

/** Human-readable line for live-agent system markers stored in transcript files. */
function formatLiveAgentMarkerText(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t === 'live_agent_bot_active') return 'AI assistant is replying now.';
  if (t === 'live_agent_handoff_to_bot') return 'Agent stepped away. AI assistant is replying now.';
  if (t === 'live_agent_human_rejoined') return 'An agent joined again.';
  if (t === 'live_agent_human_connected') return 'Agent joined the chat.';
  if (/^you are now chatting with\s+/i.test(t)) return t;
  if (/joined again\.?$/i.test(t)) return t;
  if (/ai assistant is replying/i.test(t)) return t;
  if (/the assistant is replying/i.test(t)) return t;
  if (/chat ended/i.test(t)) return t;
  if (/requested a human agent/i.test(t)) return t;
  return '';
}

function displayTurnText(role, text) {
  const r = String(role || '').toLowerCase();
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';

  if (r === 'user' || r === 'visitor' || r === 'customer') {
    return normalizeUserQueryText(raw) || raw;
  }

  const liveLine = formatLiveAgentMarkerText(raw);
  if (liveLine) return liveLine;

  return raw;
}

module.exports = {
  parseFormPayload,
  isFormSubmitPayload,
  isInternalActionToken,
  isHumanAgentHandoffToken,
  isHandoffRequestLine,
  formatHumanAgentRequestForDesk,
  formatVisitorMessageForAgentDesk,
  formSubmittedLabel,
  formClosedLabel,
  normalizeUserQueryText,
  formatLiveAgentMarkerText,
  displayTurnText,
  displayNameForFormId,
};
