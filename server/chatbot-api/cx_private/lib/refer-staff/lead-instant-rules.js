/**
 * Instant lead auto-send rules: delay, conditions, trigger catalog.
 */

const chatTranscript = require('./chat-transcript');

/** All email triggers in the system (for dashboard reference). */
const EMAIL_TRIGGER_CATALOG = [
  {
    key: 'instantLead',
    label: 'Instant lead (auto-send)',
    category: 'lead',
    configurable: true,
    when: 'After conversation sync when contact + conditions pass (optional delay).',
    settingsPage: 'Email Notifications → instantLead',
    templateKeys: ['leadCapture', 'hotLead'],
  },
  {
    key: 'dailyReport',
    label: 'Daily lead report',
    category: 'report',
    configurable: true,
    when: 'Every day at configured time — yesterday’s leads summary.',
    settingsPage: 'Email Notifications → dailyReport',
    templateKeys: [],
  },
  {
    key: 'weeklyReport',
    label: 'Weekly lead report',
    category: 'report',
    configurable: true,
    when: 'Every week on configured weekday/time — Mon–Sun leads summary.',
    settingsPage: 'Email Notifications → weeklyReport',
    templateKeys: [],
  },
  {
    key: 'appointmentBookedClient',
    label: 'Appointment booked (client)',
    category: 'appointment',
    configurable: false,
    when: 'Visitor books appointment (/api/appointment-book).',
    settingsPage: 'Email Notifications → appointmentClient',
    templateKeys: ['appointmentClient'],
  },
  {
    key: 'appointmentBookedUser',
    label: 'Appointment request received (visitor)',
    category: 'appointment',
    configurable: false,
    when: 'Same appointment book event — to visitor email.',
    settingsPage: 'Email Notifications → appointmentUserReceived',
    templateKeys: ['appointmentUserReceived'],
  },
  {
    key: 'appointmentConfirmedUser',
    label: 'Appointment confirmed (visitor)',
    category: 'appointment',
    configurable: false,
    when: 'Staff accepts appointment in dashboard.',
    settingsPage: 'Email Notifications → appointmentUserConfirmed',
    templateKeys: ['appointmentUserConfirmed'],
  },
];

const CONDITION_DEFS = [
  {
    key: 'requireContact',
    label: 'Contact required',
    type: 'select',
    options: [
      { value: 'mobile_or_email', label: 'Mobile OR email' },
      { value: 'mobile', label: 'Mobile only' },
      { value: 'email', label: 'Email only' },
      { value: 'mobile_and_email', label: 'Mobile AND email' },
    ],
    hint: 'If not met, lead email is not sent.',
  },
  {
    key: 'visitorType',
    label: 'Visitor type',
    type: 'select',
    options: [
      { value: 'any', label: 'Any visitor' },
      { value: 'first_time', label: 'First time only' },
      { value: 'repeated', label: 'Repeated only (hot lead)' },
    ],
  },
  {
    key: 'requireAppointmentBooked',
    label: 'Appointment booked',
    type: 'select',
    options: [
      { value: 'any', label: 'Any' },
      { value: 'yes', label: 'Must be booked' },
      { value: 'no', label: 'Must NOT be booked' },
    ],
  },
  {
    key: 'intentsAllow',
    label: 'Allow only these intents',
    type: 'text',
    hint: 'Comma-separated Dialogflow intent names. Leave empty = any intent.',
  },
  {
    key: 'intentsBlock',
    label: 'Block these intents',
    type: 'text',
    hint: 'Comma-separated. Email skipped if last intent matches.',
  },
  {
    key: 'minUserTurns',
    label: 'Minimum user messages',
    type: 'number',
    hint: 'Visitor must send at least this many messages before email sends.',
  },
  {
    key: 'blockIfFallback',
    label: 'Block if last intent was fallback',
    type: 'boolean',
  },
];

function defaultConditions() {
  return {
    requireContact: 'mobile_or_email',
    visitorType: 'any',
    requireAppointmentBooked: 'any',
    intentsAllow: '',
    intentsBlock: '',
    minUserTurns: 0,
    blockIfFallback: false,
  };
}

function parseIntentList(raw) {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeDelayMinutes(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1440, n);
}

function normalizeConditions(raw) {
  const base = defaultConditions();
  const c = raw && typeof raw === 'object' ? raw : {};
  const allowedContact = ['mobile_or_email', 'mobile', 'email', 'mobile_and_email'];
  if (allowedContact.indexOf(c.requireContact) >= 0) {
    base.requireContact = c.requireContact;
  }
  const allowedVisitor = ['any', 'first_time', 'repeated'];
  if (allowedVisitor.indexOf(c.visitorType) >= 0) {
    base.visitorType = c.visitorType;
  }
  const allowedAppt = ['any', 'yes', 'no'];
  if (allowedAppt.indexOf(c.requireAppointmentBooked) >= 0) {
    base.requireAppointmentBooked = c.requireAppointmentBooked;
  }
  base.intentsAllow = String(c.intentsAllow || '').trim();
  base.intentsBlock = String(c.intentsBlock || '').trim();
  base.minUserTurns = Math.max(0, parseInt(c.minUserTurns, 10) || 0);
  base.blockIfFallback = !!c.blockIfFallback;
  return base;
}

function isRepeatedVisitor(meta) {
  const label = String((meta && meta.repeatedUserLabel) || '')
    .trim()
    .toLowerCase();
  return label === 'repeated' || label.indexOf('repeat') >= 0;
}

function countUserTurns(sessionDoc) {
  const turns = sessionDoc && Array.isArray(sessionDoc.turns) ? sessionDoc.turns : [];
  return turns.filter((t) => t && t.role === 'user' && String(t.text || '').trim()).length;
}

function evaluateInstantConditions(meta, sessionDoc, conditions) {
  const c = normalizeConditions(conditions);
  const m = meta && typeof meta === 'object' ? meta : {};
  const failures = [];

  const mobile = String(m.mobile || '').trim();
  const email = String(m.email || '').trim();

  if (c.requireContact === 'mobile' && !mobile) failures.push('mobile_required');
  if (c.requireContact === 'email' && !email) failures.push('email_required');
  if (c.requireContact === 'mobile_or_email' && !mobile && !email) {
    failures.push('contact_required');
  }
  if (c.requireContact === 'mobile_and_email' && (!mobile || !email)) {
    failures.push('mobile_and_email_required');
  }

  const repeated = isRepeatedVisitor(m);
  if (c.visitorType === 'first_time' && repeated) failures.push('not_first_time');
  if (c.visitorType === 'repeated' && !repeated) failures.push('not_repeated');

  const appt = String(m.appointmentBooked || '').trim().toLowerCase();
  if (c.requireAppointmentBooked === 'yes' && appt !== 'yes') {
    failures.push('appointment_required');
  }
  if (c.requireAppointmentBooked === 'no' && appt === 'yes') {
    failures.push('appointment_not_allowed');
  }

  const lastIntent = String(m.lastIntent || '').trim();
  const fallback =
    m.intentIsFallback === true ||
    m.intentIsFallback === 'yes' ||
    lastIntent === 'fallback';
  if (c.blockIfFallback && fallback) failures.push('fallback_blocked');

  const allowList = parseIntentList(c.intentsAllow);
  if (allowList.length && (!lastIntent || allowList.indexOf(lastIntent) < 0)) {
    failures.push('intent_not_in_allow_list');
  }

  const blockList = parseIntentList(c.intentsBlock);
  if (blockList.length && lastIntent && blockList.indexOf(lastIntent) >= 0) {
    failures.push('intent_blocked');
  }

  const userTurns = countUserTurns(sessionDoc);
  if (c.minUserTurns > 0 && userTurns < c.minUserTurns) {
    failures.push('min_user_turns');
  }

  return {
    ok: failures.length === 0,
    failures,
    lastIntent: lastIntent || '',
    userTurns,
  };
}

function evaluateForSession(sessionId, conditions) {
  const sid = String(sessionId || '').trim();
  const doc = chatTranscript.getSessionDoc(sid);
  return evaluateInstantConditions(doc.meta || {}, doc, conditions);
}

function failureLabels(failures) {
  const map = {
    mobile_required: 'Mobile number required',
    email_required: 'Email address required',
    contact_required: 'Mobile or email required',
    mobile_and_email_required: 'Both mobile and email required',
    not_first_time: 'Visitor is not first-time',
    not_repeated: 'Visitor is not repeated',
    appointment_required: 'Appointment must be booked',
    appointment_not_allowed: 'Appointment must not be booked',
    fallback_blocked: 'Last intent was fallback',
    intent_not_in_allow_list: 'Last intent not in allow list',
    intent_blocked: 'Last intent is blocked',
    min_user_turns: 'Not enough user messages yet',
  };
  return (failures || []).map((f) => map[f] || f);
}

module.exports = {
  EMAIL_TRIGGER_CATALOG,
  CONDITION_DEFS,
  defaultConditions,
  normalizeConditions,
  normalizeDelayMinutes,
  evaluateInstantConditions,
  evaluateForSession,
  failureLabels,
  parseIntentList,
};
