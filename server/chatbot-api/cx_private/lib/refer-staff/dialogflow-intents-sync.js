/**
 * Pull Dialogflow ES intents (training phrases, responses, events, contexts, etc.)
 * into Q&A provision, and push sheet rows back to Dialogflow.
 */

const dialogflow = require('@google-cloud/dialogflow').v2;
const googleCredentials = require('./google-credentials');
const appEnv = require('./app-env');
const dialogflowSessions = require('./dialogflow');
const flowPayload = require('./flow-payload');
const qaProvisionStore = require('./qa-provision-store');

let intentsClient = null;
let entityTypesClient = null;
let initError = null;

const NO_TEXT_PLACEHOLDER = '(No text response in Dialogflow)';

function normalizeIntentKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s?]/g, '')
    .replace(/\s+/g, '.');
}

function contextShortName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return '';
  const marker = '/contexts/';
  const idx = s.lastIndexOf(marker);
  if (idx >= 0) return s.slice(idx + marker.length);
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

function contextFullName(projectId, shortName) {
  const name = String(shortName || '').trim().replace(/^\/+/, '');
  if (!name) return '';
  if (name.includes('/contexts/')) return name;
  return `projects/${projectId}/agent/sessions/-/contexts/${name}`;
}

function getIntentsClient() {
  if (intentsClient) return intentsClient;
  if (initError) throw initError;
  try {
    const credentials = googleCredentials.getServiceAccountCredentials();
    if (!credentials) {
      initError = new Error(
        'Dialogflow credentials missing. Set GOOGLE_CREDENTIALS_JSON in Railway Variables.'
      );
      throw initError;
    }
    intentsClient = new dialogflow.IntentsClient({ credentials });
    return intentsClient;
  } catch (err) {
    initError = err;
    throw err;
  }
}

function resolveProjectId(projectIdOverride) {
  const override = String(projectIdOverride || '').trim();
  if (override) return override;
  return appEnv.DIALOGFLOW_PROJECT_ID || dialogflowSessions.PROJECT_ID;
}

function isConfigured() {
  return dialogflowSessions.isConfigured() && !!resolveProjectId();
}

function shouldSkipIntent(intent) {
  if (!intent || !intent.displayName) return true;
  if (intent.isFallback) return true;
  if (dialogflowSessions.isFallbackIntent(intent.displayName, intent)) return true;
  const name = String(intent.displayName).trim().toLowerCase();
  if (name === 'default welcome intent') return true;
  return false;
}

function extractTrainingPhrases(intent) {
  return (intent.trainingPhrases || [])
    .map((tp) =>
      (tp.parts || [])
        .map((part) => String(part.text || '').trim())
        .join('')
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractTextResponse(intent) {
  const parts = [];
  (intent.messages || []).forEach((msg) => {
    if (msg.text && Array.isArray(msg.text.text)) {
      msg.text.text.forEach((line) => {
        const t = String(line || '').trim();
        if (t) parts.push(t);
      });
    }
  });
  return parts.join('\n\n');
}

function extractEvents(intent) {
  return (intent.events || [])
    .map((eventName) => String(eventName || '').trim())
    .filter(Boolean);
}

function extractAction(intent) {
  return String(intent.action || '').trim();
}

function extractParameters(intent) {
  const params = (intent.parameters || []).map((param) => {
    const next = {
      name: param.name,
      displayName: param.displayName,
      value: param.value,
      defaultValue: param.defaultValue,
      entityTypeDisplayName: param.entityTypeDisplayName,
      mandatory: param.mandatory,
      prompts: param.prompts,
      isList: param.isList,
    };
    Object.keys(next).forEach((key) => {
      if (next[key] == null || next[key] === '') delete next[key];
    });
    return next;
  });
  return params.length ? JSON.stringify(params) : '';
}

function extractInputContexts(intent) {
  return (intent.inputContextNames || [])
    .map((name) => contextShortName(name))
    .filter(Boolean);
}

function extractOutputContexts(intent) {
  const contexts = (intent.outputContexts || [])
    .map((ctx) => {
      const shortName = contextShortName(ctx.name);
      if (!shortName) return null;
      const next = {
        name: shortName,
        lifespanCount: ctx.lifespanCount != null ? ctx.lifespanCount : 5,
      };
      if (ctx.parameters) next.parameters = ctx.parameters;
      return next;
    })
    .filter(Boolean);
  return contexts.length ? JSON.stringify(contexts) : '';
}

function getEntityTypesClient() {
  if (entityTypesClient) return entityTypesClient;
  if (initError) throw initError;
  const credentials = googleCredentials.getServiceAccountCredentials();
  if (!credentials) {
    throw new Error(
      'Dialogflow credentials missing. Set GOOGLE_CREDENTIALS_JSON in Railway Variables.'
    );
  }
  entityTypesClient = new dialogflow.EntityTypesClient({ credentials });
  return entityTypesClient;
}

async function listAllEntityTypes(projectId) {
  const client = getEntityTypesClient();
  const parent = client.projectAgentPath(projectId);
  const types = [];
  let pageToken = undefined;

  do {
    const [page, , response] = await client.listEntityTypes({
      parent,
      pageSize: 100,
      pageToken,
      languageCode: 'en',
    });
    if (page && page.length) types.push(...page);
    pageToken = response && response.nextPageToken ? response.nextPageToken : undefined;
  } while (pageToken);

  return types;
}

async function listEntityTypesForProvision(_botId, options) {
  if (!isConfigured()) {
    return { ok: false, error: 'Dialogflow is not configured on this server.' };
  }

  const projectId = resolveProjectId(options && options.projectId);
  if (!projectId) {
    return { ok: false, error: 'Dialogflow project ID is not set (DIALOGFLOW_PROJECT_ID).' };
  }

  try {
    const types = await listAllEntityTypes(projectId);
    const fromAgent = types
      .map((t) => String(t.displayName || '').trim())
      .filter(Boolean);
    const sysDefaults = [
      '@sys.any',
      '@sys.date',
      '@sys.date-period',
      '@sys.email',
      '@sys.geo-city',
      '@sys.geo-country',
      '@sys.number',
      '@sys.number-integer',
      '@sys.person',
      '@sys.phone-number',
      '@sys.time',
      '@sys.url',
      '@sys.zip-code',
    ];
    const entities = [...new Set([...fromAgent, ...sysDefaults])].sort((a, b) =>
      a.localeCompare(b)
    );
    return {
      ok: true,
      botId: qaProvisionStore.SHARED_PROVISION_KEY,
      projectId,
      entities,
    };
  } catch (err) {
    return {
      ok: false,
      error: dialogflowSessions.formatApiError(err),
    };
  }
}

async function listAllIntents(projectId) {
  const client = getIntentsClient();
  const parent = client.projectAgentPath(projectId);
  const intents = [];
  let pageToken = undefined;

  do {
    const [page, , response] = await client.listIntents({
      parent,
      pageSize: 100,
      pageToken,
      intentView: 'INTENT_VIEW_FULL',
    });
    if (page && page.length) intents.push(...page);
    pageToken = response && response.nextPageToken ? response.nextPageToken : undefined;
  } while (pageToken);

  return intents.filter((intent) => !shouldSkipIntent(intent));
}

function intentsToProvisionRows(intents) {
  return intents.map((intent) => {
    const phrases = extractTrainingPhrases(intent);
    const payloadBlocks = flowPayload.extractBlocksFromMessages(intent.messages);
    const response = flowPayload.normalizeProvisionResponse(
      extractTextResponse(intent),
      payloadBlocks
    );
    const events = extractEvents(intent);
    const inputContexts = extractInputContexts(intent);
    return {
      intent: String(intent.displayName).trim(),
      synonyms: phrases.join(', '),
      response,
      payloadBlocks,
      nextIntent: '',
      nextIntentPhrases: '',
      events: events.join(', '),
      action: extractAction(intent),
      parameters: extractParameters(intent),
      inputContexts: inputContexts.join(', '),
      outputContexts: extractOutputContexts(intent),
      published: true,
    };
  });
}

function mergeMessages(existingMessages, row) {
  return flowPayload.mergeIntentMessages(existingMessages, row);
}

function buildTrainingPhrases(synonyms, intentName) {
  const phrases = qaProvisionStore.parseSynonyms(synonyms);
  const fallback = String(intentName || '').trim();
  const list = phrases.length ? phrases : fallback ? [fallback] : [];
  return list.map((text) => ({
    type: 'EXAMPLE',
    parts: [{ text }],
  }));
}

function resolveEvents(row, fallback) {
  const events = qaProvisionStore.parseSynonyms(row && row.events);
  return events.length ? events : fallback || [];
}

function resolveAction(row, fallback) {
  const action = String((row && row.action) || '').trim();
  return action || fallback || '';
}

function resolveParameters(row, fallback) {
  const raw = String((row && row.parameters) || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((param) => {
        if (!param || typeof param !== 'object') return null;
        const displayName = String(param.displayName || param.name || '').trim();
        if (!displayName) return null;
        const next = {
          name: displayName,
          displayName,
        };
        const entity = String(param.entityTypeDisplayName || '').trim();
        if (entity) next.entityTypeDisplayName = entity;
        const value = String(param.value || '').trim();
        if (value) next.value = value;
        if (param.mandatory) next.mandatory = true;
        if (param.isList) next.isList = true;
        return next;
      })
      .filter(Boolean);
  } catch (_err) {
    return Array.isArray(fallback) ? fallback : [];
  }
}

function resolveInputContextNames(projectId, row, fallback) {
  const names = qaProvisionStore.parseSynonyms(row && row.inputContexts);
  if (!names.length) return [];
  return names.map((name) => contextFullName(projectId, name)).filter(Boolean);
}

function resolveOutputContexts(projectId, row, fallback) {
  const raw = String((row && row.outputContexts) || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return fallback || [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((ctx) => {
      if (!ctx) return null;
      const shortName =
        typeof ctx === 'string' ? ctx : String(ctx.name || '').trim();
      if (!shortName) return null;
      const next = {
        name: contextFullName(projectId, shortName),
        lifespanCount:
          typeof ctx === 'object' && ctx.lifespanCount != null
            ? ctx.lifespanCount
            : 5,
      };
      if (typeof ctx === 'object' && ctx.parameters) {
        next.parameters = ctx.parameters;
      }
      return next;
    })
    .filter(Boolean);
}

function findDfIntentByName(intents, intentName) {
  const key = normalizeIntentKey(intentName);
  if (!key) return null;
  return (
    intents.find((intent) => normalizeIntentKey(intent.displayName) === key) || null
  );
}

function resolveIntentDisplayName(dfIntent, row) {
  const fromDf = dfIntent && String(dfIntent.displayName || '').trim();
  if (fromDf) return fromDf;
  return String((row && row.intent) || '').trim();
}

function sanitizeIntentUpdate(intent) {
  const next = { ...(intent || {}) };
  Object.keys(next).forEach((key) => {
    if (next[key] == null) delete next[key];
  });
  if (Array.isArray(next.parameters) && !next.parameters.length) delete next.parameters;
  if (Array.isArray(next.events) && !next.events.length) delete next.events;
  if (Array.isArray(next.inputContextNames) && !next.inputContextNames.length) {
    delete next.inputContextNames;
  }
  if (Array.isArray(next.outputContexts) && !next.outputContexts.length) delete next.outputContexts;
  if (next.action === '') delete next.action;
  if (Array.isArray(next.followupIntentInfo) && !next.followupIntentInfo.length) {
    delete next.followupIntentInfo;
  }
  return next;
}

function buildSheetIntentUpdate(projectId, dfIntent, row) {
  const displayName = resolveIntentDisplayName(dfIntent, row);
  return {
    name: dfIntent.name,
    displayName,
    trainingPhrases: buildTrainingPhrases(row.synonyms, displayName || row.intent),
    messages: mergeMessages(dfIntent.messages, row),
    parameters: resolveParameters(row, []),
    action: resolveAction(row, ''),
    events: resolveEvents(row, []),
    inputContextNames: resolveInputContextNames(projectId, row, []),
    outputContexts: resolveOutputContexts(projectId, row, []),
  };
}

function buildMinimalIntentUpdate(dfIntent, row) {
  const displayName = resolveIntentDisplayName(dfIntent, row);
  return {
    name: dfIntent.name,
    displayName,
    trainingPhrases: buildTrainingPhrases(row.synonyms, displayName || row.intent),
    messages: mergeMessages(dfIntent.messages, row),
  };
}

function buildPreserveIntentMessagesUpdate(dfIntent, row) {
  const next = {
    ...dfIntent,
    messages: mergeMessages(dfIntent.messages, row),
  };
  delete next.followupIntentInfo;
  return next;
}

function buildResponseTextOnlyUpdate(dfIntent, row) {
  return {
    name: dfIntent.name,
    messages: mergeMessages(dfIntent.messages, row),
  };
}

function buildMessagesOnlyIntentUpdate(dfIntent, row) {
  return buildResponseTextOnlyUpdate(dfIntent, row);
}

function buildMinimalNewIntentPayload(row) {
  const intentName = String(row.intent || '').trim();
  return {
    displayName: intentName,
    trainingPhrases: buildTrainingPhrases(row.synonyms, intentName),
    messages: mergeMessages([], row),
    priority: 500000,
  };
}

function buildIntentUpdate(projectId, dfIntent, row) {
  const displayName = resolveIntentDisplayName(dfIntent, row);
  const trainingPhrases = buildTrainingPhrases(row.synonyms, displayName || row.intent);
  const messages = mergeMessages(dfIntent.messages, row);
  const events = resolveEvents(row, []);
  const action = resolveAction(row, '');
  const parameters = resolveParameters(row, []);
  const inputContextNames = resolveInputContextNames(projectId, row, []);
  const outputContexts = resolveOutputContexts(projectId, row, []);

  return {
    name: dfIntent.name,
    displayName,
    trainingPhrases,
    messages,
    parameters,
    priority: dfIntent.priority,
    isFallback: dfIntent.isFallback,
    action,
    inputContextNames,
    outputContexts,
    events,
    mlDisabled: dfIntent.mlDisabled,
    liveAgentHandoff: dfIntent.liveAgentHandoff,
    endInteraction: dfIntent.endInteraction,
  };
}

async function pullToProvision(_botId, options) {
  if (!isConfigured()) {
    return { ok: false, error: 'Dialogflow is not configured on this server.' };
  }

  const projectId = resolveProjectId(options && options.projectId);
  if (!projectId) {
    return { ok: false, error: 'Dialogflow project ID is not set (DIALOGFLOW_PROJECT_ID).' };
  }

  try {
    const intents = await listAllIntents(projectId);
    const rows = intentsToProvisionRows(intents);
    if (!rows.length) {
      return { ok: false, error: 'No Dialogflow intents found to import.' };
    }

    const saved = qaProvisionStore.mergeDialogflowPull(null, rows, {
      mode: (options && options.mode) || 'merge',
      overwriteResponse: !!(options && options.overwriteResponse),
      clearDrafts: !!(options && options.clearDrafts),
      pruneMissing: !!(options && options.pruneMissing),
    });
    if (!saved.ok) return saved;

    return {
      ...saved,
      projectId,
      pulledIntents: rows.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: dialogflowSessions.formatApiError(err),
    };
  }
}

function buildNewIntentPayload(projectId, row) {
  const intentName = String(row.intent || '').trim();
  const trainingPhrases = buildTrainingPhrases(row.synonyms, intentName);
  const messages = mergeMessages([], row);
  const events = resolveEvents(row, []);
  const action = resolveAction(row, '');
  const parameters = resolveParameters(row, []);
  const inputContextNames = resolveInputContextNames(projectId, row, []);
  const outputContexts = resolveOutputContexts(projectId, row, []);

  return {
    displayName: intentName,
    trainingPhrases,
    messages,
    parameters,
    priority: 500000,
    action,
    inputContextNames,
    outputContexts,
    events,
  };
}

function pushResultWarning(mode, options) {
  const opts = resolvePushOptions(options);
  if (opts.messagesOnly && (mode === 'messages-mask' || mode === 'messages-preserve')) return '';
  if (mode === 'full') return '';
  if (mode === 'sheet' && opts.full) {
    return 'Dialogflow updated (text, parameters, contexts). Some agent-only metadata was left unchanged.';
  }
  if (mode === 'minimal') {
    return opts.full
      ? 'Only text and training phrases synced to Dialogflow; parameters/contexts may need another save.'
      : 'Dialogflow text and training phrases updated; parameters/contexts may not have synced.';
  }
  if (mode === 'messages-only') {
    return 'Dialogflow response text was updated, but training phrases could not be synced.';
  }
  if (mode === 'verified') {
    return 'Dialogflow already has the saved response (API returned a warning).';
  }
  return '';
}

function intentResponseMatchesRow(dfIntent, row) {
  const expected = String((row && row.response) || '').trim();
  if (!expected) return false;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const target = norm(expected);
  const messages = (dfIntent && dfIntent.messages) || [];
  for (const msg of messages) {
    if (!msg.text || !Array.isArray(msg.text.text)) continue;
    for (const line of msg.text.text) {
      if (norm(line) === target) return true;
    }
  }
  const dfText = extractTextResponse(dfIntent);
  return norm(dfText) === target;
}

function isAlreadyExistsError(err) {
  if (!err) return false;
  if (err.code === 6) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('already exists') || msg.includes('already_exist');
}

function resolvePushOptions(options) {
  if (typeof options === 'boolean') {
    return { full: options, messagesOnly: false };
  }
  const opts = options || {};
  return {
    full: !!opts.full && !opts.messagesOnly,
    messagesOnly: !!opts.messagesOnly,
  };
}

async function updateIntentWithFallback(client, projectId, dfIntent, row, intentName, options) {
  const { full: useFullPayload, messagesOnly } = resolvePushOptions(options);
  const attempts = messagesOnly
    ? [
        () => buildResponseTextOnlyUpdate(dfIntent, row),
        () => buildPreserveIntentMessagesUpdate(dfIntent, row),
      ]
    : useFullPayload
      ? [
          () => sanitizeIntentUpdate(buildIntentUpdate(projectId, dfIntent, row)),
          () => sanitizeIntentUpdate(buildSheetIntentUpdate(projectId, dfIntent, row)),
          () => buildMinimalIntentUpdate(dfIntent, row),
          () => buildMessagesOnlyIntentUpdate(dfIntent, row),
        ]
      : [
          () => buildMinimalIntentUpdate(dfIntent, row),
          () => buildMessagesOnlyIntentUpdate(dfIntent, row),
        ];
  const modes = messagesOnly
    ? ['messages-mask', 'messages-preserve']
    : useFullPayload
      ? ['full', 'sheet', 'minimal', 'messages-only']
      : ['minimal', 'messages-only'];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const intentPayload = attempts[i]();
      if (!messagesOnly) {
        const displayName = String(intentPayload.displayName || '').trim();
        if (!displayName) {
          throw new Error('Intent display name is empty for Dialogflow update.');
        }
      }
      const updateRequest = {
        intent: intentPayload,
        languageCode: 'en',
      };
      if (messagesOnly && i === 0) {
        updateRequest.updateMask = { paths: ['messages'] };
      }
      await client.updateIntent(updateRequest);
      return { mode: modes[i] || 'minimal' };
    } catch (err) {
      lastErr = err;
      console.warn(
        '[qa-provision] Dialogflow update attempt ' +
          (i + 1) +
          '/' +
          attempts.length +
          ' (' +
          (modes[i] || 'unknown') +
          ') failed for "' +
          intentName +
          '":',
        dialogflowSessions.formatApiError(err)
      );
    }
  }
  throw lastErr;
}

function rowForDialogflowPush(row, options) {
  if (options && options.messagesOnly) {
    return {
      intent: String((row && row.intent) || '').trim(),
      response: String((row && row.response) || '').trim(),
    };
  }
  const next = { ...(row || {}) };
  if (options && options.textOnly) {
    next.payloadBlocks = [];
  }
  return next;
}

async function pushRowToDialogflow(_botId, row, options) {
  if (!isConfigured()) {
    return { ok: false, skipped: true, error: 'Dialogflow is not configured on this server.' };
  }

  const projectId = resolveProjectId(options && options.projectId);
  if (!projectId) {
    return { ok: false, skipped: true, error: 'Dialogflow project ID is not set.' };
  }

  const pushRow = rowForDialogflowPush(row, options);
  const intentName = String((pushRow && pushRow.intent) || '').trim();
  const response = String((pushRow && pushRow.response) || '').trim();
  const blocks = flowPayload.normalizeBlocks(pushRow && pushRow.payloadBlocks);
  if (!intentName || (!response && !blocks.length)) {
    return {
      ok: false,
      skipped: true,
      error: 'Intent and response or rich blocks are required for Dialogflow push.',
    };
  }

  const pushOptions = resolvePushOptions(options);

  try {
    const client = getIntentsClient();
    const dfIntents = await listAllIntents(projectId);
    const dfIntent = findDfIntentByName(dfIntents, intentName);

    if (dfIntent) {
      const updateResult = await updateIntentWithFallback(
        client,
        projectId,
        dfIntent,
        pushRow,
        intentName,
        pushOptions
      );
      const warning = pushResultWarning(updateResult.mode, pushOptions);
      return {
        ok: true,
        action: 'updated',
        intent: intentName,
        projectId,
        botId: qaProvisionStore.SHARED_PROVISION_KEY,
        mode: updateResult.mode,
        warning: warning || undefined,
      };
    }

    const parent = client.projectAgentPath(projectId);
    const createAttempts = pushOptions.full
      ? [
          () => sanitizeIntentUpdate(buildNewIntentPayload(projectId, pushRow)),
          () => buildMinimalNewIntentPayload(pushRow),
        ]
      : [() => buildMinimalNewIntentPayload(pushRow)];
    const createModes = pushOptions.full ? ['full', 'minimal'] : ['minimal'];
    let created = null;
    let createMode = createModes[0];
    let lastCreateErr = null;
    for (let i = 0; i < createAttempts.length; i += 1) {
      try {
        const [nextIntent] = await client.createIntent({
          parent,
          intent: createAttempts[i](),
          languageCode: 'en',
        });
        created = nextIntent;
        createMode = createModes[i];
        break;
      } catch (createErr) {
        lastCreateErr = createErr;
        if (isAlreadyExistsError(createErr)) break;
        console.warn(
          '[qa-provision] Dialogflow create attempt ' +
            (i + 1) +
            '/' +
            createAttempts.length +
            ' (' +
            (createModes[i] || 'unknown') +
            ') failed for "' +
            intentName +
            '":',
          dialogflowSessions.formatApiError(createErr)
        );
      }
    }

    if (created) {
      const warning = pushResultWarning(createMode, pushOptions);
      return {
        ok: true,
        action: 'created',
        intent: intentName,
        projectId,
        botId: qaProvisionStore.SHARED_PROVISION_KEY,
        dialogflowName: created && created.name ? created.name : '',
        mode: createMode,
        warning: warning || undefined,
      };
    }

    if (!created) {
      if (!lastCreateErr) {
        throw new Error('Dialogflow create failed with no error detail.');
      }
      if (!isAlreadyExistsError(lastCreateErr)) throw lastCreateErr;
      const refreshed = await listAllIntents(projectId);
      const existing = findDfIntentByName(refreshed, intentName);
      if (!existing) throw lastCreateErr;
      const updateResult = await updateIntentWithFallback(
        client,
        projectId,
        existing,
        pushRow,
        intentName,
        pushOptions
      );
      const warning = pushResultWarning(updateResult.mode, pushOptions);
      return {
        ok: true,
        action: 'updated',
        intent: intentName,
        projectId,
        botId: qaProvisionStore.SHARED_PROVISION_KEY,
        mode: updateResult.mode,
        warning: warning || undefined,
      };
    }
  } catch (err) {
    const formatted = dialogflowSessions.formatApiError(err);
    try {
      const client = getIntentsClient();
      const dfIntents = await listAllIntents(projectId);
      const dfIntent = findDfIntentByName(dfIntents, intentName);
      if (dfIntent && !pushOptions.full && intentResponseMatchesRow(dfIntent, pushRow)) {
        console.warn(
          '[qa-provision] Dialogflow push reported failure but intent "' +
            intentName +
            '" already has the saved response:',
          formatted
        );
        return {
          ok: true,
          action: 'updated',
          intent: intentName,
          projectId,
          botId: qaProvisionStore.SHARED_PROVISION_KEY,
          mode: 'verified',
          warning: pushResultWarning('verified', pushOptions),
        };
      }
    } catch (verifyErr) {
      console.warn('[qa-provision] Dialogflow verify read failed:', verifyErr.message);
    }
    console.warn(
      '[qa-provision] Dialogflow push failed for intent "' +
        intentName +
        '":',
      formatted
    );
    return {
      ok: false,
      intent: intentName,
      projectId,
      error: formatted,
    };
  }
}

async function pushFromProvision(_botId, options) {
  if (!isConfigured()) {
    return { ok: false, error: 'Dialogflow is not configured on this server.' };
  }

  const projectId = resolveProjectId(options && options.projectId);
  if (!projectId) {
    return { ok: false, error: 'Dialogflow project ID is not set (DIALOGFLOW_PROJECT_ID).' };
  }

  const list = qaProvisionStore.listItems();
  if (!list.ok) return list;

  const includeUnpublished = !!(options && options.includeUnpublished);
  const rows = (list.items || []).filter(
    (item) => item && (includeUnpublished || item.published !== false)
  );
  if (!rows.length) {
    return { ok: false, error: 'No provision rows to push.' };
  }

  try {
    let updated = 0;
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const row of rows) {
      const intentName = String(row.intent || '').trim();
      if (!intentName) {
        skipped += 1;
        continue;
      }

      const df = await pushRowToDialogflow(null, row, {
        projectId,
        messagesOnly: true,
        textOnly: true,
      });
      if (df.ok) {
        if (df.action === 'created') created += 1;
        else updated += 1;
      } else if (df.skipped) {
        skipped += 1;
      } else {
        failed += 1;
        errors.push({
          intent: intentName,
          error: df.error || 'Push failed',
        });
      }
    }

    return {
      ok: failed === 0,
      botId: list.botId,
      projectId,
      updated,
      created,
      skipped,
      notFound: 0,
      failed,
      totalRows: rows.length,
      errors: errors.length ? errors : undefined,
      error:
        errors.length === 1
          ? errors[0].intent + ': ' + errors[0].error
          : errors.length
            ? errors.length + ' intent(s) failed to update'
            : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: dialogflowSessions.formatApiError(err),
    };
  }
}

module.exports = {
  pullToProvision,
  pushFromProvision,
  pushRowToDialogflow,
  listAllIntents,
  listEntityTypesForProvision,
  intentsToProvisionRows,
  isConfigured,
  resolveProjectId,
  NO_TEXT_PLACEHOLDER,
  contextShortName,
  contextFullName,
};
