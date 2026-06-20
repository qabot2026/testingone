/**
 * Scheduled lead notification runner + instant lead hook.
 */

const leadNotificationsStore = require('./lead-notifications-store');
const leadNotificationsMail = require('./lead-notifications-mail');
const leadInstantRules = require('./lead-instant-rules');
const emailSender = require('./email-sender');
const sitePresetsStore = require('./site-presets-store');
const botSheetTabs = require('./bot-sheet-tabs');
const chatTranscript = require('./chat-transcript');

let tickTimer = null;
let tickInFlight = false;

/** sessionId → { timer, botId } */
const pendingInstant = new Map();

function resolveBotIdFromMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const direct = String(m.botId || m.bot_id || '').trim();
  if (/^\d{5}$/.test(direct)) return direct;
  const tab = botSheetTabs.resolveConversationTabForMeta(m);
  if (!tab) return '';
  const bots = sitePresetsStore.listProjects();
  const hit = bots.find((b) => String(b.sheetTab || '').trim() === tab);
  return hit ? hit.id : '';
}

function clearPendingInstant(sessionId) {
  const sid = String(sessionId || '').trim();
  const entry = pendingInstant.get(sid);
  if (entry && entry.timer) clearTimeout(entry.timer);
  pendingInstant.delete(sid);
}

async function fireInstantLead(sessionId, botId) {
  const sid = String(sessionId || '').trim();
  pendingInstant.delete(sid);

  if (!emailSender.isConfigured()) {
    return { ok: false, skipped: true, reason: 'no_smtp' };
  }
  if (leadNotificationsStore.wasInstantSent(botId, sid)) {
    return { ok: false, skipped: true, reason: 'already_sent' };
  }

  const stored = leadNotificationsStore.getRawBotStored(botId);
  const cfg = stored.instantLead || {};
  if (!cfg.enabled) return { ok: false, skipped: true, reason: 'disabled' };

  const doc = chatTranscript.getSessionDoc(sid);
  const meta = doc.meta || {};
  const evalResult = leadInstantRules.evaluateInstantConditions(
    meta,
    doc,
    cfg.conditions
  );
  if (!evalResult.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'conditions_failed',
      failures: evalResult.failures,
    };
  }

  try {
    return await leadNotificationsMail.sendInstantLead(botId, meta, sid);
  } catch (err) {
    console.warn('[lead-notifications] instant lead failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function scheduleInstantLead(sessionId, botId, cfg) {
  const sid = String(sessionId || '').trim();
  if (!sid || !botId) return { ok: false, skipped: true, reason: 'invalid_session' };

  const delayMinutes = leadInstantRules.normalizeDelayMinutes(cfg && cfg.delayMinutes);
  const delayMs = delayMinutes * 60 * 1000;

  clearPendingInstant(sid);

  if (delayMs <= 0) {
    fireInstantLead(sid, botId).catch((err) => {
      console.warn('[lead-notifications] instant fire:', err.message);
    });
    return { ok: true, scheduled: false, delayMinutes: 0 };
  }

  const timer = setTimeout(() => {
    fireInstantLead(sid, botId).catch((err) => {
      console.warn('[lead-notifications] delayed instant:', err.message);
    });
  }, delayMs);

  pendingInstant.set(sid, { timer, botId, at: Date.now(), delayMinutes });
  return { ok: true, scheduled: true, delayMinutes };
}

async function runScheduledTick() {
  if (tickInFlight) return { ok: true, skipped: true, reason: 'in_flight' };
  if (!emailSender.isConfigured()) return { ok: false, error: 'SMTP not configured' };
  tickInFlight = true;
  const results = [];
  try {
    const entries = leadNotificationsStore.listAllBotConfigs();
    const now = new Date();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const botId = entry.botId;
      const cfg = entry.config;

      if (cfg.dailyReport && cfg.dailyReport.enabled) {
        const tz = cfg.dailyReport.timezone || leadNotificationsStore.DEFAULT_TZ;
        const parts = leadNotificationsMail.zonedParts(now, tz);
        if (leadNotificationsMail.timeMatches(parts, cfg.dailyReport.time)) {
          const yesterday = leadNotificationsMail.addDaysYmd(parts.ymd, -1);
          if (cfg.dailyReport.lastSentForDate !== yesterday) {
            const sent = await leadNotificationsMail.sendDailyReport(
              botId,
              cfg.dailyReport,
              yesterday
            );
            results.push({ botId, type: 'daily', yesterday, ...sent });
          }
        }
      }

      if (cfg.weeklyReport && cfg.weeklyReport.enabled) {
        const tz = cfg.weeklyReport.timezone || leadNotificationsStore.DEFAULT_TZ;
        const parts = leadNotificationsMail.zonedParts(now, tz);
        const targetDay = cfg.weeklyReport.dayOfWeek != null ? cfg.weeklyReport.dayOfWeek : 1;
        if (
          leadNotificationsMail.weekdayMatches(parts, targetDay) &&
          leadNotificationsMail.timeMatches(parts, cfg.weeklyReport.time)
        ) {
          const weekKey = parts.ymd;
          if (cfg.weeklyReport.lastSentWeekKey !== weekKey) {
            const range = leadNotificationsMail.previousWeekRangeMonSun(parts.ymd);
            const sent = await leadNotificationsMail.sendWeeklyReport(
              botId,
              cfg.weeklyReport,
              range.from,
              range.to,
              weekKey
            );
            results.push({ botId, type: 'weekly', range, ...sent });
          }
        }
      }
    }
    return { ok: true, results };
  } catch (err) {
    console.warn('[lead-notifications-runner]', err.message);
    return { ok: false, error: err.message };
  } finally {
    tickInFlight = false;
  }
}

async function onConversationSynced(sessionId, meta, syncResult) {
  if (!syncResult || !syncResult.ok) return { ok: false, skipped: true };
  if (!emailSender.isConfigured()) return { ok: false, skipped: true, reason: 'no_smtp' };
  const botId = resolveBotIdFromMeta(meta);
  if (!botId) return { ok: false, skipped: true, reason: 'no_bot' };

  const stored = leadNotificationsStore.getRawBotStored(botId);
  const cfg = stored.instantLead || {};
  if (!cfg.enabled) return { ok: false, skipped: true, reason: 'disabled' };
  if (leadNotificationsStore.wasInstantSent(botId, sessionId)) {
    return { ok: false, skipped: true, reason: 'already_sent' };
  }

  const doc = chatTranscript.getSessionDoc(sessionId);
  const evalResult = leadInstantRules.evaluateInstantConditions(
    meta || doc.meta || {},
    doc,
    cfg.conditions
  );
  if (!evalResult.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'conditions_failed',
      failures: evalResult.failures,
    };
  }

  return scheduleInstantLead(sessionId, botId, cfg);
}

async function onAppointmentBooked(sessionId, meta) {
  if (!emailSender.isConfigured()) return { ok: false, skipped: true, reason: 'no_smtp' };
  const botId = resolveBotIdFromMeta(meta);
  if (!botId) return { ok: false, skipped: true, reason: 'no_bot' };
  try {
    const emailNotificationsMail = require('./email-notifications-mail');
    return await emailNotificationsMail.sendAppointmentBookedNotifications(botId, meta, sessionId);
  } catch (err) {
    console.warn('[email-notifications] appointment email failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function onAppointmentConfirmed(sessionId, meta) {
  if (!emailSender.isConfigured()) return { ok: false, skipped: true, reason: 'no_smtp' };
  const botId = resolveBotIdFromMeta(meta);
  if (!botId) return { ok: false, skipped: true, reason: 'no_bot' };
  try {
    const emailNotificationsMail = require('./email-notifications-mail');
    return await emailNotificationsMail.sendAppointmentConfirmedNotification(
      botId,
      meta,
      sessionId
    );
  } catch (err) {
    console.warn('[email-notifications] appointment confirmed email failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function startScheduler() {
  if (tickTimer) return;
  const intervalMs = Math.max(
    30000,
    Number(process.env.LEAD_NOTIFICATIONS_TICK_MS || 60000) || 60000
  );
  tickTimer = setInterval(() => {
    runScheduledTick().catch((err) => {
      console.warn('[lead-notifications-runner] tick error:', err.message);
    });
  }, intervalMs);
  console.log('[lead-notifications] scheduler started (every ' + intervalMs / 1000 + 's)');
}

function stopScheduler() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

module.exports = {
  startScheduler,
  stopScheduler,
  runScheduledTick,
  onConversationSynced,
  onAppointmentBooked,
  onAppointmentConfirmed,
  resolveBotIdFromMeta,
  scheduleInstantLead,
  fireInstantLead,
  clearPendingInstant,
};
