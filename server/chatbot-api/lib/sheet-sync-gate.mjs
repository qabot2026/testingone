/**
 * Throttle Google Sheets sync: wait after chat start, debounce bursts, min interval between runs.
 * Reduces Sheets API read quota errors and keeps live chat off the critical path.
 */

function trim_(v) {
    return typeof v === "string" ? v.trim() : "";
}

/** Ms after first activity before any sheet sync may run (default 1 minute). */
export const CHAT_SHEET_SYNC_START_DELAY_MS = Math.max(
    0,
    Number.parseInt(process.env.SHEET_SYNC_CHAT_START_DELAY_MS || "60000", 10) || 60_000
);

/** Debounce rescheduled jobs (default 8s). */
export const SHEET_SYNC_DEBOUNCE_MS = Math.max(
    1000,
    Number.parseInt(process.env.SHEET_SYNC_DEBOUNCE_MS || "8000", 10) || 8000
);

/** Min gap between actual sheet jobs for the same session (default 30s). */
export const SHEET_SYNC_MIN_RUN_INTERVAL_MS = Math.max(
    5000,
    Number.parseInt(process.env.SHEET_SYNC_MIN_RUN_INTERVAL_MS || "30000", 10) || 30_000
);

/** @type {Map<string, number>} */
const chatStartMs_ = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const timers_ = new Map();
/** @type {Map<string, Promise<void>>} */
const chains_ = new Map();
/** @type {Map<string, number>} */
const lastRunAt_ = new Map();

/**
 * @param {string} sessionId
 * @param {number} [atMs]
 */
export function noteChatSessionStarted_(sessionId, atMs) {
    const sid = trim_(sessionId);
    if (!sid) {
        return;
    }
    if (!chatStartMs_.has(sid)) {
        chatStartMs_.set(sid, typeof atMs === "number" && Number.isFinite(atMs) ? atMs : Date.now());
    }
}

/**
 * @param {string} sessionId
 * @returns {number}
 */
export function msUntilSheetSyncAllowed_(sessionId) {
    const sid = trim_(sessionId);
    if (!sid) {
        return 0;
    }
    noteChatSessionStarted_(sid);
    const start = chatStartMs_.get(sid) || Date.now();
    const earliest = start + CHAT_SHEET_SYNC_START_DELAY_MS;
    return Math.max(0, earliest - Date.now());
}

/**
 * @param {string} sessionId
 * @returns {number}
 */
function computeScheduleDelayMs_(sessionId) {
    const waitForStart = msUntilSheetSyncAllowed_(sessionId);
    return waitForStart + SHEET_SYNC_DEBOUNCE_MS;
}

/**
 * @param {string} sessionId
 * @param {string} channel
 * @param {() => void | Promise<void>} job
 */
export function scheduleSheetSyncJob_(sessionId, channel, job) {
    const sid = trim_(sessionId);
    if (!sid || typeof job !== "function") {
        return;
    }
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return;
    }
    noteChatSessionStarted_(sid);
    const key = `${sid}:${channel || "default"}`;
    const existing = timers_.get(key);
    if (existing) {
        clearTimeout(existing);
    }
    const delay = computeScheduleDelayMs_(sid);
    const timer = setTimeout(() => {
        timers_.delete(key);
        const prev = chains_.get(key) || Promise.resolve();
        const run = prev
            .then(async () => {
                const last = lastRunAt_.get(sid) || 0;
                const gap = Date.now() - last;
                if (gap < SHEET_SYNC_MIN_RUN_INTERVAL_MS) {
                    await new Promise((resolve) => {
                        setTimeout(resolve, SHEET_SYNC_MIN_RUN_INTERVAL_MS - gap);
                    });
                }
                lastRunAt_.set(sid, Date.now());
                await job();
            })
            .catch((err) => {
                const msg = err && err.message ? err.message : String(err);
                console.warn("[sheet-sync-gate]", channel, msg.slice(0, 200));
            });
        chains_.set(key, run);
        void run.finally(() => {
            if (chains_.get(key) === run) {
                chains_.delete(key);
            }
        });
    }, delay);
    timers_.set(key, timer);
}

/**
 * Run only after chat-start delay (for already-coalesced session sync flushes).
 *
 * @param {string} sessionId
 * @param {() => void | Promise<void>} job
 */
export function runSheetSyncAfterChatStartDelay_(sessionId, job) {
    const sid = trim_(sessionId);
    if (!sid || typeof job !== "function") {
        return Promise.resolve();
    }
    if (trim_(process.env.DISABLE_SHEETS) === "1") {
        return Promise.resolve();
    }
    const wait = msUntilSheetSyncAllowed_(sid);
    if (wait <= 0) {
        noteChatSessionStarted_(sid);
        return Promise.resolve(job());
    }
    noteChatSessionStarted_(sid);
    return new Promise((resolve) => {
        setTimeout(() => {
            void Promise.resolve(job()).then(resolve, resolve);
        }, wait);
    });
}
