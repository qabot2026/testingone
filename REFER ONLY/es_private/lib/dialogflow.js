const dialogflow = require('@google-cloud/dialogflow').v2;
const {
  parseFulfillmentMessages,
  collectEsSessionParameters,
  enrichOpenFormWithSessionParams,
  parametersStructToPlain,
} = require('./rich-content');
const googleCredentials = require('./google-credentials');
const orchestration = require('./agent-orchestration');
const appEnv = require('./app-env');

const PROJECT_ID = appEnv.DIALOGFLOW_PROJECT_ID;

let sessionsClient = null;
let initError = null;

function getClient() {
  if (sessionsClient) return sessionsClient;
  if (initError) throw initError;
  try {
    const credentials = googleCredentials.getServiceAccountCredentials();
    if (!credentials) {
      initError = new Error(
        'Dialogflow credentials missing. Set GOOGLE_CREDENTIALS_JSON in Railway Variables.'
      );
      throw initError;
    }
    if (credentials.project_id && credentials.project_id !== PROJECT_ID) {
      console.warn(
        `[dialogflow] Credential project_id (${credentials.project_id}) differs from DIALOGFLOW_PROJECT_ID (${PROJECT_ID})`
      );
    }
    sessionsClient = new dialogflow.SessionsClient({ credentials });
    return sessionsClient;
  } catch (err) {
    initError = err;
    throw err;
  }
}

function formatApiError(err) {
  const parts = [];
  if (err && err.code != null) parts.push(String(err.code));
  if (err && err.message) parts.push(String(err.message));
  const details = err && Array.isArray(err.details) ? err.details : [];
  details.forEach((detail) => {
    if (!detail) return;
    if (typeof detail === 'string') {
      parts.push(detail);
      return;
    }
    if (Array.isArray(detail.fieldViolations)) {
      detail.fieldViolations.forEach((v) => {
        const field = v && v.field ? String(v.field) : 'field';
        const desc = v && v.description ? String(v.description) : '';
        if (field || desc) parts.push(field + (desc ? ': ' + desc : ''));
      });
      return;
    }
    if (detail['@type'] && detail.message) {
      parts.push(String(detail.message));
    }
  });
  return parts.filter(Boolean).join(' — ');
}

function isFallbackIntent_(intentName, intentObj) {
  if (intentObj && intentObj.isFallback) return true;
  const name = String(intentName || intentObj?.displayName || '')
    .trim()
    .toLowerCase();
  if (!name) return false;
  if (name === 'default fallback intent' || name === 'default unknown') return true;
  if (name.includes('fallback')) return true;
  const custom = String(process.env.DIALOGFLOW_FALLBACK_INTENTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return custom.includes(name);
}

function sanitizeBogusReplyText(text) {
  const trimmed = String(text || '').trim();
  if (trimmed === '{}' || trimmed === '[]') return '';
  return trimmed;
}

function parseQueryResult(response, languageCode = 'en', options) {
  const result = response.queryResult;
  const parsed = parseFulfillmentMessages(result.fulfillmentMessages, options);
  const {
    textParts,
    replyText,
    replyParts,
    hasDfTextResponse,
    chips,
    chipHeading,
    infoCards,
    downloads,
    dropdowns,
    galleries,
    cardCarousels,
    forms,
    liveAgentMessage,
    liveAgentDepartment: parsedDepartment,
  } = parsed;
  let liveAgentDepartment =
    parsedDepartment != null ? String(parsedDepartment).trim() : '';
  let reply = sanitizeBogusReplyText(replyText || textParts.join('\n'));
  const fulfillmentText = sanitizeBogusReplyText(result.fulfillmentText);
  const hasRichPayload =
    chips.length > 0 ||
    infoCards.length > 0 ||
    downloads.length > 0 ||
    dropdowns.length > 0 ||
    galleries.length > 0 ||
    cardCarousels.length > 0 ||
    forms.length > 0;
  const hasChipHeading = !!(chipHeading && String(chipHeading).trim());
  const hasRichDisplay = hasRichPayload || hasChipHeading;
  /* Native text = Dialogflow Text response only. Payload/chip heading → sheet can supply text. */
  const hasNativeTextReply =
    hasDfTextResponse ||
    (!hasRichDisplay &&
      !!fulfillmentText &&
      fulfillmentText.toLowerCase() !== 'no response.');
  const hasReplyParts = replyParts.length > 0;
  const hasRich = hasRichDisplay || hasReplyParts;
  if (!reply && hasReplyParts) {
    reply = replyParts.map((p) => p.text).join('');
  }
  if (!reply && (dropdowns.length || galleries.length || cardCarousels.length || forms.length)) {
    const prompts = [
      ...galleries.map((g) => g.message),
      ...dropdowns.map((d) => d.message),
      ...cardCarousels.map((c) => c.message),
      ...forms.map((f) => f.message),
    ].filter(Boolean);
    reply = [...new Set(prompts)].join('\n').trim();
  }
  /* Dialogflow ES fulfillmentText when Text response did not arrive in text.text[] */
  if (!reply && fulfillmentText) {
    reply = fulfillmentText;
  }
  if (!reply && !hasRich) {
    reply = 'No response.';
  }

  let liveAgent = !!parsed.liveAgent;
  const intentName = result.intent?.displayName || '';
  const params = result.parameters;
  if (params) {
    const fields = params.fields || {};
    const la =
      fields.live_agent?.boolValue ??
      fields.liveAgent?.boolValue ??
      fields.handoff?.boolValue;
    if (la === true) liveAgent = true;
    const str =
      fields.live_agent?.stringValue ||
      fields.liveAgent?.stringValue ||
      '';
    if (String(str).toLowerCase() === 'true' || String(str).toLowerCase() === 'yes') {
      liveAgent = true;
    }
    const deptField =
      fields.department?.stringValue ||
      fields.department_name?.stringValue ||
      fields.departmentName?.stringValue ||
      fields.department_id?.stringValue ||
      fields.departmentId?.stringValue;
    if (deptField && String(deptField).trim()) {
      liveAgentDepartment = String(deptField).trim();
    }
  }
  const handoffIntents = (process.env.LIVE_AGENT_INTENTS || 'Live Agent,Handoff to Agent')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (handoffIntents.indexOf(intentName.toLowerCase()) >= 0) {
    liveAgent = true;
  }

  if (liveAgent && liveAgentMessage && !reply) {
    reply = liveAgentMessage;
  }

  const intentIsFallback = isFallbackIntent_(intentName, result.intent);
  const sessionParameters = parametersStructToPlain(result.parameters);
  const enrichedForms = (forms || []).map((form) =>
    enrichOpenFormWithSessionParams(form, sessionParameters)
  );

  return {
    reply,
    replyParts,
    chips,
    chipHeading: chipHeading || '',
    infoCards,
    downloads,
    dropdowns,
    galleries,
    cardCarousels,
    forms: enrichedForms,
    sessionParameters,
    intent: intentName || null,
    intentIsFallback,
    hasNativeTextReply,
    hasDfTextResponse,
    languageCode: result.languageCode || languageCode,
    liveAgent,
    liveAgentMessage: liveAgentMessage || '',
    liveAgentDepartment: liveAgentDepartment || '',
  };
}

function sessionPath_(sessionId, projectId) {
  const client = getClient();
  const pid = orchestration.resolveProjectId(projectId || PROJECT_ID);
  return { path: client.projectAgentSessionPath(pid, sessionId), projectId: pid };
}

async function detectIntent(sessionId, text, languageCode = 'en', projectId, options) {
  const client = getClient();
  const { path, projectId: pid } = sessionPath_(sessionId, projectId);
  const opts = options && typeof options === 'object' ? options : {};
  const request = {
    session: path,
    queryInput: {
      text: {
        text,
        languageCode,
      },
    },
  };
  if (opts.resetContexts) {
    request.queryParams = { resetContexts: true };
  }
  const [response] = await client.detectIntent(request);
  const parsed = parseQueryResult(response, languageCode, {
    channel: opts.channel,
  });
  parsed.dialogflowProjectId = pid;
  return parsed;
}

/** Dialogflow ES custom/welcome event (e.g. FRESH, WELCOME). */
async function detectEvent(sessionId, eventName, languageCode = 'en', projectId, options) {
  const client = getClient();
  const name = (eventName || '').trim();
  if (!name) {
    throw new Error('event name is required');
  }
  const opts = options && typeof options === 'object' ? options : {};
  const { path, projectId: pid } = sessionPath_(sessionId, projectId);
  const request = {
    session: path,
    queryInput: {
      event: {
        name,
        languageCode,
      },
    },
  };
  const [response] = await client.detectIntent(request);
  const parsed = parseQueryResult(response, languageCode, {
    channel: opts.channel,
  });
  parsed.dialogflowProjectId = pid;
  return parsed;
}

async function probe() {
  const id = 'health-probe-' + Date.now();
  await detectIntent(id, 'hi', 'en');
  return { ok: true, projectId: PROJECT_ID };
}

function isConfigured() {
  return googleCredentials.isCredentialsConfigured();
}

function getCredentialsMeta() {
  const c = googleCredentials.getServiceAccountCredentials();
  if (!c) return null;
  return {
    clientEmail: c.client_email,
    projectId: c.project_id,
  };
}

module.exports = {
  detectIntent,
  detectEvent,
  probe,
  isConfigured,
  formatApiError,
  getCredentialsMeta,
  isFallbackIntent: isFallbackIntent_,
  PROJECT_ID,
};
