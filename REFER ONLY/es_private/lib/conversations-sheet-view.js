/**
 * Staff conversations sheet viewer API (Only Refer–compatible payloads).
 */

const sheets = require('./sheets');
const dateDisplay = require('./date-display');
const liveAgentSheetModule = require('./live-agent-sheet');
const botSheetTabs = require('./bot-sheet-tabs');
const sitePresetsStore = require('./site-presets-store');

const TZ = process.env.SHEETS_CONV_DATETIME_TZ || 'Asia/Kolkata';
const HEADERS = sheets.SHEET_COL_HEADERS;

const COL = {
  date: HEADERS.indexOf('Conv. Date'),
  mobile: HEADERS.indexOf('Mobile'),
  email: HEADERS.indexOf('Email'),
  channel: HEADERS.indexOf('Channel'),
  city: HEADERS.indexOf('City'),
  appBooked: HEADERS.indexOf('App. Booked'),
  appDate: HEADERS.indexOf('App. Date'),
  appTime: HEADERS.indexOf('App. Time'),
  userQueries: HEADERS.indexOf('User Queries'),
};

function isoYyyyMmDdOk(s) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(s || '').trim());
}

function sheetCellString(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return String(raw).trim();
}

function padRow(cells, width) {
  const out = Array.isArray(cells) ? cells.slice() : [];
  while (out.length < width) out.push('');
  return out;
}

function sheetRowHasAnyCell(cells) {
  return cells.some((c) => sheetCellString(c));
}

function conversationRowYmdInSheetTz(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  if (map.year && map.month && map.day) {
    return `${map.year}-${map.month}-${map.day}`;
  }
  return '';
}

function googleSheetsSerialToMs(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000 || n > 600000) return NaN;
  const whole = Math.floor(n);
  const ms = Math.round((whole - 25569) * 86400000) + 43200000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.getTime() : NaN;
}

function parseConversationDateCell(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const msNum = googleSheetsSerialToMs(raw);
    if (Number.isFinite(msNum)) return msNum;
  }
  const s = sheetCellString(raw);
  if (!s) return NaN;

  const serialOnly = /^\d{5,6}(?:\.\d+)?$/.exec(s);
  if (serialOnly) {
    const msSerial = googleSheetsSerialToMs(parseFloat(serialOnly[0]));
    if (Number.isFinite(msSerial)) return msSerial;
  }

  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDay) {
    return Date.UTC(
      Number(isoDay[1]),
      Number(isoDay[2]) - 1,
      Number(isoDay[3]),
      12,
      0,
      0
    );
  }
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]((?:\d{2})|(?:\d{4}))\b/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y >= 0 && y < 100) y += y >= 70 ? 1900 : 2000;
    if (dd >= 1 && dd <= 31 && mo >= 1 && mo <= 12) {
      return Date.UTC(y, mo - 1, dd, 12, 0, 0);
    }
  }
  const longFmt = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/.exec(s);
  if (longFmt) {
    const dd = Number(longFmt[1]);
    const y = Number(longFmt[3]);
    const monKey = String(longFmt[2] || '')
      .toLowerCase()
      .slice(0, 3);
    const monMap = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const mo0 = monMap[monKey];
    if (
      mo0 !== undefined &&
      dd >= 1 &&
      dd <= 31 &&
      y >= 1970 &&
      y <= 2100
    ) {
      return Date.UTC(y, mo0, dd, 12, 0, 0);
    }
  }
  const t = Date.parse(s.replace(/,/g, ''));
  return Number.isFinite(t) ? t : NaN;
}

function defaultDateRange(daysBack = 5) {
  const back = Math.max(0, Math.min(90, Number.parseInt(String(daysBack), 10) || 4));
  const to = conversationRowYmdInSheetTz(Date.now());
  const parts = to.split('-').map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { from: to, to };
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - back);
  return { from: conversationRowYmdInSheetTz(dt.getTime()), to };
}

function ymdAddDays(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function sheetCellHasLeadEmail(cell) {
  const s = sheetCellString(cell);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function sheetCellHasLeadMobile(cell) {
  const digits = sheetCellString(cell).replace(/\D/g, '');
  return digits.length >= 7;
}

function conversationChannelBucket(cell) {
  const s = sheetCellString(cell).toLowerCase();
  if (!s) return 'other';
  if (/\bwhatsapp\b|\bwa\b/.test(s)) return 'whatsapp';
  if (/\binstagram\b|\binsta\b|\big\b/.test(s)) return 'instagram';
  if (/\bfacebook\b|\bfb\b|\bmessenger\b/.test(s)) return 'facebook';
  if (/\bweb\b|browser|desktop|mobile web/.test(s)) return 'web';
  return 'other';
}

function leadSegmentChannelEmpty() {
  return { web: 0, whatsapp: 0, instagram: 0, facebook: 0, other: 0 };
}

function leadSegmentChannelAdd(acc, ch) {
  if (acc[ch] != null) acc[ch] += 1;
  else acc.other += 1;
}

function sheetAppointmentCellCountsScheduled(cell) {
  const s = sheetCellString(cell).toLowerCase();
  if (!s) return false;
  return /^(yes|y|true|1|booked|scheduled|confirmed|done)$/.test(s) || /\byes\b/.test(s);
}

function sheetRowAppointmentSlotCellsLikelyFilled(dateCell, timeCell) {
  const d = sheetCellString(dateCell);
  const t = sheetCellString(timeCell);
  return !!(d && t);
}

function leadCaptureNormalizeCityLabel(cell) {
  const s = sheetCellString(cell);
  if (!s) return 'Unknown';
  return s.length > 48 ? `${s.slice(0, 45)}...` : s;
}

const POS_RE =
  /\b(thank|thanks|thankyou|great|good|excellent|happy|love|appreciate|wonderful|amazing|helpful|satisfied|perfect|awesome|fantastic|pleased|glad|nice|delighted)\b/gi;
const NEG_RE =
  /\b(bad|terrible|awful|angry|hate|disappointed|frustrat|complaint|worst|rude|unhappy|poor|horrible|useless|annoyed|upset|disgust|not\s+happy|waste|pathetic|disappointing)\b/gi;

function leadCaptureSentimentPolarity(text) {
  const s = String(text || '').toLowerCase();
  if (!s || s.length < 2) return 'neutral';
  const pos = (s.match(POS_RE) || []).length;
  const neg = (s.match(NEG_RE) || []).length;
  if (pos === 0 && neg === 0) return 'neutral';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function leadCaptureExtractUserText(cells) {
  const uq =
    COL.userQueries >= 0 ? sheetCellString(cells[COL.userQueries]) : '';
  return uq.replace(/,/g, ' ').trim();
}

function conversationRowFromCells(cells, headers) {
  const o = {};
  for (let c = 0; c < headers.length; c += 1) {
    o[headers[c]] = sheetCellString(cells[c]);
  }
  return sheetRowHasAnyCell(cells) ? o : null;
}

function viewerReturnMaxRows() {
  return Math.min(
    50000,
    Math.max(
      500,
      Number.parseInt(
        String(
          (process.env.CONVERSATIONS_SHEET_VIEW_RETURN_MAX_ROWS || '').trim() ||
            '50000'
        ),
        10
      ) || 50000
    )
  );
}

function dateFilterMaxRows() {
  return Math.min(
    50000,
    Math.max(
      500,
      Number.parseInt(
        String(
          (process.env.CONVERSATIONS_SHEET_DATE_FILTER_MAX_ROWS || '').trim() ||
            '50000'
        ),
        10
      ) || 50000
    )
  );
}

function leadCaptureStatsAccumulatorEmpty() {
  return {
    dataRowsConsidered: 0,
    skippedNoDate: 0,
    conversations: 0,
    conversationsByDate: Object.create(null),
    conversationsByCity: Object.create(null),
    sentimentPositive: 0,
    sentimentNegative: 0,
    onlyMobile: 0,
    onlyEmail: 0,
    mobileAndEmail: 0,
    neither: 0,
    appointmentScheduled: 0,
    channelWeb: 0,
    channelWhatsapp: 0,
    channelInstagram: 0,
    channelFacebook: 0,
    channelOther: 0,
    onlyMobileByChannel: leadSegmentChannelEmpty(),
    onlyEmailByChannel: leadSegmentChannelEmpty(),
    mobileAndEmailByChannel: leadSegmentChannelEmpty(),
  };
}

function leadCaptureStatsAccumulateRow(acc, cells, rowYmd) {
  if (!sheetRowHasAnyCell(cells)) return;
  const hasEm = sheetCellHasLeadEmail(cells[COL.email]);
  const hasMob = sheetCellHasLeadMobile(cells[COL.mobile]);
  const channelKey = conversationChannelBucket(cells[COL.channel]);
  acc.conversations += 1;
  if (rowYmd && isoYyyyMmDdOk(rowYmd)) {
    acc.conversationsByDate[rowYmd] =
      (acc.conversationsByDate[rowYmd] || 0) + 1;
  }
  if (COL.city >= 0) {
    const cityLbl = leadCaptureNormalizeCityLabel(cells[COL.city]);
    acc.conversationsByCity[cityLbl] =
      (acc.conversationsByCity[cityLbl] || 0) + 1;
  }
  const sentiment = leadCaptureSentimentPolarity(
    leadCaptureExtractUserText(cells)
  );
  if (sentiment === 'positive') acc.sentimentPositive += 1;
  else if (sentiment === 'negative') acc.sentimentNegative += 1;
  if (hasMob && hasEm) {
    acc.mobileAndEmail += 1;
    leadSegmentChannelAdd(acc.mobileAndEmailByChannel, channelKey);
  } else if (hasMob) {
    acc.onlyMobile += 1;
    leadSegmentChannelAdd(acc.onlyMobileByChannel, channelKey);
  } else if (hasEm) {
    acc.onlyEmail += 1;
    leadSegmentChannelAdd(acc.onlyEmailByChannel, channelKey);
  } else {
    acc.neither += 1;
  }
  let appt = sheetAppointmentCellCountsScheduled(cells[COL.appBooked]);
  if (!appt) {
    appt = sheetRowAppointmentSlotCellsLikelyFilled(
      cells[COL.appDate],
      cells[COL.appTime]
    );
  }
  if (appt) acc.appointmentScheduled += 1;
  switch (channelKey) {
    case 'web':
      acc.channelWeb += 1;
      break;
    case 'whatsapp':
      acc.channelWhatsapp += 1;
      break;
    case 'instagram':
      acc.channelInstagram += 1;
      break;
    case 'facebook':
      acc.channelFacebook += 1;
      break;
    default:
      acc.channelOther += 1;
  }
}

function conversationsByDateSeries(byDate, fromYmd, toYmd) {
  const labels = [];
  const data = [];
  if (!fromYmd || !toYmd || !isoYyyyMmDdOk(fromYmd) || !isoYyyyMmDdOk(toYmd)) {
    return { labels, data };
  }
  let fromEff = fromYmd;
  let toEff = toYmd;
  if (fromEff > toEff) {
    const swap = fromEff;
    fromEff = toEff;
    toEff = swap;
  }
  const map = byDate && typeof byDate === 'object' ? byDate : {};
  let cur = fromEff;
  let guard = 0;
  while (cur && cur <= toEff && guard < 4000) {
    guard += 1;
    labels.push(cur);
    data.push(
      typeof map[cur] === 'number' && Number.isFinite(map[cur])
        ? Math.trunc(map[cur])
        : 0
    );
    if (cur === toEff) break;
    const next = ymdAddDays(cur, 1);
    if (!next || next <= cur) break;
    cur = next;
  }
  return { labels, data };
}

function conversationsByCitySeries(byCity, topN = 10) {
  const labels = [];
  const data = [];
  const map = byCity && typeof byCity === 'object' ? byCity : {};
  const entries = Object.keys(map)
    .map((k) => ({ label: k, count: map[k] }))
    .filter((e) => e.label && typeof e.count === 'number' && e.count > 0)
    .sort((a, b) => b.count - a.count);
  const cap = Math.max(1, Math.min(20, topN));
  let other = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (i < cap) {
      labels.push(entries[i].label);
      data.push(Math.trunc(entries[i].count));
    } else {
      other += Math.trunc(entries[i].count);
    }
  }
  if (other > 0) {
    labels.push('Other');
    data.push(other);
  }
  return { labels, data };
}

function leadCaptureStatsShell(tab, title, dateFilter, rowCount, headersRaw) {
  const tzNote =
    TZ === undefined || TZ === ''
      ? 'server default (SHEETS_CONV_DATETIME_TZ empty)'
      : `IANA TZ: ${TZ}`;
  return {
    tab,
    title,
    timezoneNote: tzNote,
    dateFilter,
    scan: {
      sheetLastRow1Based: rowCount,
      sheetGridRowCount: rowCount > 0 ? rowCount : null,
      dataRowsConsidered: 0,
      scanHardCapEnv: viewerReturnMaxRows(),
    },
    columns: {
      dateIdx0: COL.date,
      mobileIdx0: COL.mobile,
      emailIdx0: COL.email,
      channelIdx0: COL.channel,
      appointmentBookedIdx0: COL.appBooked,
      dateHeader: headersRaw[COL.date] || 'Conv. Date',
      mobileHeader: headersRaw[COL.mobile] || 'Mobile',
      emailHeader: headersRaw[COL.email] || 'Email',
      channelHeader: headersRaw[COL.channel] || 'Channel',
      appointmentBookedHeader: headersRaw[COL.appBooked] || 'App. Booked',
    },
    totals: {
      conversations: 0,
      onlyMobile: 0,
      onlyEmail: 0,
      mobileAndEmail: 0,
      neither: 0,
      rowsSkippedNoParsableDate: 0,
      leadsCaptured: 0,
      appointmentScheduled: 0,
      appointmentBooked: 0,
      channelWeb: 0,
      channelWhatsapp: 0,
      channelInstagram: 0,
      channelFacebook: 0,
      channelOther: 0,
      onlyMobileByChannel: leadSegmentChannelEmpty(),
      onlyEmailByChannel: leadSegmentChannelEmpty(),
      mobileAndEmailByChannel: leadSegmentChannelEmpty(),
    },
    ratios: {
      onlyMobile: '0 / 0',
      onlyEmail: '0 / 0',
      mobileAndEmail: '0 / 0',
      leads: '0 / 0',
      leadCapturePct: null,
    },
  };
}

function leadCaptureStatsPayloadFromAccumulator(acc, baseEmpty) {
  const out = baseEmpty;
  const conversations = acc.conversations;
  const leadsCaptured = acc.onlyMobile + acc.onlyEmail + acc.mobileAndEmail;
  const pct = conversations
    ? Math.round((leadsCaptured * 10000) / conversations) / 100
    : null;
  const rpt = (num) => `${num} / ${conversations}`;
  out.scan.dataRowsConsidered = acc.dataRowsConsidered;
  out.totals.conversations = conversations;
  out.totals.onlyMobile = acc.onlyMobile;
  out.totals.onlyEmail = acc.onlyEmail;
  out.totals.mobileAndEmail = acc.mobileAndEmail;
  out.totals.neither = acc.neither;
  out.totals.rowsSkippedNoParsableDate = acc.skippedNoDate;
  out.totals.leadsCaptured = leadsCaptured;
  out.totals.appointmentScheduled = acc.appointmentScheduled;
  out.totals.appointmentBooked = acc.appointmentScheduled;
  out.totals.channelWeb = acc.channelWeb;
  out.totals.channelWhatsapp = acc.channelWhatsapp;
  out.totals.channelInstagram = acc.channelInstagram;
  out.totals.channelFacebook = acc.channelFacebook;
  out.totals.channelOther = acc.channelOther;
  out.totals.onlyMobileByChannel = acc.onlyMobileByChannel;
  out.totals.onlyEmailByChannel = acc.onlyEmailByChannel;
  out.totals.mobileAndEmailByChannel = acc.mobileAndEmailByChannel;
  out.ratios.onlyMobile = rpt(acc.onlyMobile);
  out.ratios.onlyEmail = rpt(acc.onlyEmail);
  out.ratios.mobileAndEmail = rpt(acc.mobileAndEmail);
  out.ratios.leads = rpt(leadsCaptured);
  out.ratios.leadCapturePct = pct;
  const df = out.dateFilter && typeof out.dateFilter === 'object' ? out.dateFilter : {};
  const fromYmd = typeof df.from === 'string' && df.from ? df.from : null;
  const toYmd = typeof df.to === 'string' && df.to ? df.to : null;
  out.series = {
    conversationsByDate: conversationsByDateSeries(
      acc.conversationsByDate,
      fromYmd,
      toYmd
    ),
    conversationsByCity: conversationsByCitySeries(acc.conversationsByCity, 10),
    sentiment: {
      labels: ['Positive', 'Negative'],
      data: [acc.sentimentPositive, acc.sentimentNegative],
    },
  };
  return out;
}

function parseDateOpts(opts = {}) {
  const fromIn = opts && typeof opts.from === 'string' ? opts.from.trim() : '';
  const toIn = opts && typeof opts.to === 'string' ? opts.to.trim() : '';
  let fromIso = fromIn ? dateDisplay.parseToIsoYmd(fromIn) : null;
  let toIso = toIn ? dateDisplay.parseToIsoYmd(toIn) : null;
  if ((fromIn && !fromIso) || (toIn && !toIso)) {
    throw new Error('Invalid date parameter — use DD/MM/YYYY for from/to.');
  }
  if (fromIso && toIso && fromIso > toIso) {
    const swap = fromIso;
    fromIso = toIso;
    toIso = swap;
  }
  return { fromIso, toIso };
}

function resolveConversationTabForRequest(botId) {
  const id = sitePresetsStore.normalizeBotId(botId);
  if (id && sitePresetsStore.resolveProject(id)) {
    return botSheetTabs.resolveConversationTabForBotId(id);
  }
  return sheets.tabName();
}

async function loadGridContext(botId) {
  const tab = resolveConversationTabForRequest(botId);
  const grid = await sheets.fetchConversationGrid(tab);
  const padWidth = HEADERS.length;
  const n = grid.dataRows.length + 1;
  return { ...grid, padWidth, rowCount: n, sheetDataRowCount: grid.dataRows.length };
}

async function loadLiveAgentGridContext() {
  const grid = await sheets.fetchLiveAgentGrid();
  const headers =
    grid.headers && grid.headers.length && String(grid.headers[0] || '').trim()
      ? grid.headers
      : [...liveAgentSheetModule.LIVE_AGENT_SHEET_HEADERS];
  const padWidth = headers.length;
  const n = grid.dataRows.length + 1;
  return {
    ...grid,
    headers,
    padWidth,
    rowCount: n,
    sheetDataRowCount: grid.dataRows.length,
  };
}

/**
 * Sheet2 live-agent table for staff viewer (no KPI stats).
 * @param {{ maxRows?: number, offset?: number, from?: string, to?: string, allInRange?: boolean }} [opts]
 */
async function fetchLiveAgentSheetPreview(opts = {}) {
  const allInRange = opts.allInRange !== false && opts.allInRange !== '0';
  let maxRows = Number.parseInt(String(opts.maxRows !== undefined ? opts.maxRows : 200), 10);
  if (!Number.isFinite(maxRows) || maxRows < 5) maxRows = 200;
  if (maxRows > 500) maxRows = 500;
  let offset = Number.parseInt(String(opts.offset !== undefined ? opts.offset : 0), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const { fromIso: fromIn, toIso: toIn } = parseDateOpts(opts);
  const previewDateFilterActive = !!(fromIn || toIn);
  let previewFromEff = '1900-01-01';
  let previewToEff = '9999-12-31';
  if (previewDateFilterActive) {
    if (fromIn) previewFromEff = fromIn;
    if (toIn) previewToEff = toIn;
  }
  const dateFilterEcho = previewDateFilterActive
    ? {
        applied: true,
        serverApplied: true,
        serverDefaultRange: false,
        from: fromIn,
        to: toIn,
      }
    : { applied: false, serverApplied: false, from: null, to: null };

  const ctx = await loadLiveAgentGridContext();
  const { tab, title, headers, dataRows, padWidth, rowCount, sheetDataRowCount } =
    ctx;
  const dateCol = headers.indexOf('Conv. Date');

  if (sheetDataRowCount < 1) {
    return {
      tab,
      title,
      rowCount,
      headers,
      conversations: [],
      offset: 0,
      limit: maxRows,
      hasOlder: false,
      hasNewer: false,
      totalDataRows: 0,
      dateFilter: dateFilterEcho,
      sheetSource: 'live-agent',
    };
  }

  let inRangeRows = [];
  if (previewDateFilterActive && dateCol >= 0) {
    for (let ri = 0; ri < dataRows.length; ri += 1) {
      const cells = padRow(dataRows[ri], padWidth);
      if (!sheetRowHasAnyCell(cells)) continue;
      const dateMs = parseConversationDateCell(cells[dateCol]);
      if (!Number.isFinite(dateMs)) continue;
      const ymd = conversationRowYmdInSheetTz(dateMs);
      if (!ymd || ymd < previewFromEff || ymd > previewToEff) continue;
      const row = conversationRowFromCells(cells, headers);
      if (row) inRangeRows.push(row);
    }
  } else {
    for (let ri = 0; ri < dataRows.length; ri += 1) {
      const cells = padRow(dataRows[ri], padWidth);
      const row = conversationRowFromCells(cells, headers);
      if (row) inRangeRows.push(row);
    }
  }

  const totalFiltered = inRangeRows.length;
  const newestFirst = inRangeRows.slice().reverse();
  const viewerCap = viewerReturnMaxRows();
  const capped =
    allInRange && newestFirst.length > viewerCap
      ? newestFirst.slice(0, viewerCap)
      : newestFirst;

  let sliceRows;
  let hasNewerFiltered = false;
  let hasOlderFiltered = false;
  let effectiveLimit = maxRows;
  if (allInRange) {
    sliceRows = capped;
    offset = 0;
    effectiveLimit = sliceRows.length;
  } else {
    const maxFilteredOffset = Math.max(0, totalFiltered - maxRows);
    if (offset > maxFilteredOffset) offset = maxFilteredOffset;
    sliceRows = capped.slice(offset, offset + maxRows);
    hasNewerFiltered = offset > 0;
    hasOlderFiltered = offset + sliceRows.length < totalFiltered;
  }

  return {
    tab,
    title,
    rowCount,
    headers,
    conversations: sliceRows,
    offset,
    limit: effectiveLimit,
    hasOlder: hasOlderFiltered,
    hasNewer: hasNewerFiltered,
    totalDataRows: totalFiltered,
    allInRange,
    rowsTruncated: allInRange && totalFiltered > capped.length,
    dateFilter: dateFilterEcho,
    sheetSource: 'live-agent',
  };
}

/**
 * @param {{ maxRows?: number, offset?: number, from?: string, to?: string, allInRange?: boolean, includeStats?: boolean }} [opts]
 */
async function fetchConversationSheetPreview(opts = {}) {
  const allInRange = opts.allInRange !== false && opts.allInRange !== '0';
  const includeStats = opts.includeStats !== false && opts.includeStats !== '0';
  let maxRows = Number.parseInt(String(opts.maxRows !== undefined ? opts.maxRows : 200), 10);
  if (!Number.isFinite(maxRows) || maxRows < 5) maxRows = 200;
  if (maxRows > 500) maxRows = 500;
  let offset = Number.parseInt(String(opts.offset !== undefined ? opts.offset : 0), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const { fromIso: fromIn, toIso: toIn } = parseDateOpts(opts);
  let previewFromIso = fromIn;
  let previewToIso = toIn;
  let previewServerDefaultRange = false;
  let previewDateFilterActive = !!(previewFromIso || previewToIso);
  let previewFromEff = '1900-01-01';
  let previewToEff = '9999-12-31';
  if (previewDateFilterActive) {
    if (previewFromIso) previewFromEff = previewFromIso;
    if (previewToIso) previewToEff = previewToIso;
  }
  const dateFilterEcho = previewDateFilterActive
    ? {
        applied: true,
        serverApplied: true,
        serverDefaultRange: previewServerDefaultRange,
        from: previewFromIso,
        to: previewToIso,
      }
    : { applied: false, serverApplied: false, from: null, to: null };

  const ctx = await loadGridContext(opts.botId);
  const { tab, title, headers, dataRows, padWidth, rowCount, sheetDataRowCount } =
    ctx;

  if (sheetDataRowCount < 1) {
    return {
      tab,
      title,
      rowCount,
      headers,
      conversations: [],
      offset: 0,
      limit: maxRows,
      hasOlder: false,
      hasNewer: false,
      totalDataRows: 0,
      dateFilter: dateFilterEcho,
    };
  }

  if (previewDateFilterActive) {
    const acc = includeStats ? leadCaptureStatsAccumulatorEmpty() : null;
    const viewerCap = viewerReturnMaxRows();
    const inRangeRows = [];
    for (let ri = 0; ri < dataRows.length; ri += 1) {
      if (acc) acc.dataRowsConsidered += 1;
      const cells = padRow(dataRows[ri], padWidth);
      if (!sheetRowHasAnyCell(cells)) continue;
      const dateMs = parseConversationDateCell(cells[COL.date]);
      if (!Number.isFinite(dateMs)) {
        if (acc) acc.skippedNoDate += 1;
        continue;
      }
      const ymd = conversationRowYmdInSheetTz(dateMs);
      if (!ymd || ymd < previewFromEff || ymd > previewToEff) continue;
      if (acc) leadCaptureStatsAccumulateRow(acc, cells, ymd);
      const row = conversationRowFromCells(cells, headers);
      if (row) inRangeRows.push(row);
    }
    let totalFiltered = inRangeRows.length;
    let dateFilterOut = dateFilterEcho;
    let relaxedDateFilter = false;

    if (totalFiltered < 1 && sheetDataRowCount > 0) {
      relaxedDateFilter = true;
      inRangeRows.length = 0;
      for (let ri = 0; ri < dataRows.length; ri += 1) {
        const cells = padRow(dataRows[ri], padWidth);
        const row = conversationRowFromCells(cells, headers);
        if (row) inRangeRows.push(row);
      }
      totalFiltered = inRangeRows.length;
      dateFilterOut = {
        applied: false,
        serverApplied: false,
        serverDefaultRange: false,
        from: null,
        to: null,
        relaxedBecauseNoDatedRows: true,
      };
      if (acc) {
        acc.dataRowsConsidered = dataRows.length;
        acc.skippedNoDate = 0;
        acc.conversations = 0;
        acc.onlyMobile = 0;
        acc.onlyEmail = 0;
        acc.mobileAndEmail = 0;
        acc.neither = 0;
        acc.appointmentScheduled = 0;
        acc.channelWeb = 0;
        acc.channelWhatsapp = 0;
        acc.channelInstagram = 0;
        acc.channelFacebook = 0;
        acc.channelOther = 0;
        acc.conversationsByDate = Object.create(null);
        acc.conversationsByCity = Object.create(null);
        acc.sentimentPositive = 0;
        acc.sentimentNegative = 0;
        acc.onlyMobileByChannel = leadSegmentChannelEmpty();
        acc.onlyEmailByChannel = leadSegmentChannelEmpty();
        acc.mobileAndEmailByChannel = leadSegmentChannelEmpty();
        for (let ri = 0; ri < dataRows.length; ri += 1) {
          const cells = padRow(dataRows[ri], padWidth);
          if (!sheetRowHasAnyCell(cells)) continue;
          leadCaptureStatsAccumulateRow(acc, cells, null);
        }
      }
    }

    const newestFirst = inRangeRows.slice().reverse();
    const capped =
      allInRange && newestFirst.length > viewerCap
        ? newestFirst.slice(0, viewerCap)
        : newestFirst;
    const rowsTruncated =
      !relaxedDateFilter &&
      (totalFiltered > viewerCap ||
        (allInRange && totalFiltered > capped.length));
    let sliceRows;
    let hasNewerFiltered = false;
    let hasOlderFiltered = false;
    let effectiveLimit = maxRows;
    if (allInRange) {
      sliceRows = capped;
      offset = 0;
      effectiveLimit = sliceRows.length;
    } else {
      const maxFilteredOffset = Math.max(0, totalFiltered - maxRows);
      if (offset > maxFilteredOffset) offset = maxFilteredOffset;
      sliceRows = capped.slice(offset, offset + maxRows);
      hasNewerFiltered = offset > 0;
      hasOlderFiltered = offset + sliceRows.length < totalFiltered;
    }
    let leadStats;
    if (includeStats && acc) {
      const statsShell = leadCaptureStatsShell(
        tab,
        title,
        relaxedDateFilter
          ? dateFilterOut
          : {
              applied: true,
              serverApplied: true,
              serverDefaultRange: previewServerDefaultRange,
              from: previewFromIso,
              to: previewToIso,
            },
        rowCount,
        headers
      );
      leadStats = leadCaptureStatsPayloadFromAccumulator(acc, statsShell);
    }
    return {
      tab,
      title,
      rowCount,
      headers,
      conversations: sliceRows,
      offset,
      limit: effectiveLimit,
      hasOlder: hasOlderFiltered,
      hasNewer: hasNewerFiltered,
      totalDataRows: totalFiltered,
      allInRange,
      rowsTruncated,
      leadStats,
      dateFilter: dateFilterOut,
    };
  }

  const maxOffset = Math.max(0, sheetDataRowCount - maxRows);
  if (offset > maxOffset) offset = maxOffset;
  const endIdx = sheetDataRowCount - offset;
  const startIdx = Math.max(0, endIdx - maxRows);
  const slice = dataRows.slice(startIdx, endIdx);
  const conversations = [];
  for (let r = slice.length - 1; r >= 0; r -= 1) {
    const cells = padRow(slice[r], padWidth);
    const row = conversationRowFromCells(cells, headers);
    if (row) conversations.push(row);
  }
  const hasOlder = startIdx > 0;
  const hasNewer = offset > 0;
  return {
    tab,
    title,
    rowCount,
    headers,
    conversations,
    offset,
    limit: maxRows,
    hasOlder,
    hasNewer,
    totalDataRows: sheetDataRowCount,
    dateFilter: dateFilterEcho,
  };
}

/**
 * @param {{ from?: string, to?: string }} [opts]
 */
async function fetchConversationLeadCaptureStats(opts = {}) {
  const { fromIso: fromIn, toIso: toIn } = parseDateOpts(opts);
  let fromStr = fromIn;
  let toStr = toIn;
  let serverDefaultRange = false;
  if (!fromStr && !toStr) {
    const def = defaultDateRange(5);
    fromStr = def.from;
    toStr = def.to;
    serverDefaultRange = true;
  }
  const filterActive = !!(fromStr || toStr);
  let fromEff = '1900-01-01';
  let toEff = '9999-12-31';
  if (filterActive) {
    if (fromStr) fromEff = fromStr;
    if (toStr) toEff = toStr;
  }
  const ctx = await loadGridContext(opts.botId);
  const { tab, title, headers, dataRows, padWidth, rowCount } = ctx;
  const acc = leadCaptureStatsAccumulatorEmpty();
  const dateFilter = {
    applied: filterActive,
    from: fromStr,
    to: toStr,
    serverDefaultRange,
    serverApplied: filterActive,
  };
  const baseEmpty = leadCaptureStatsShell(tab, title, dateFilter, rowCount, headers);
  if (!dataRows.length) return baseEmpty;

  for (let ri = 0; ri < dataRows.length; ri += 1) {
    acc.dataRowsConsidered += 1;
    const cells = padRow(dataRows[ri], padWidth);
    if (!sheetRowHasAnyCell(cells)) continue;
    if (filterActive) {
      const dateMs = parseConversationDateCell(cells[COL.date]);
      if (!Number.isFinite(dateMs)) {
        acc.skippedNoDate += 1;
        continue;
      }
      const ymd = conversationRowYmdInSheetTz(dateMs);
      if (!ymd || ymd < fromEff || ymd > toEff) continue;
      leadCaptureStatsAccumulateRow(acc, cells, ymd);
    } else {
      leadCaptureStatsAccumulateRow(acc, cells, null);
    }
  }
  return leadCaptureStatsPayloadFromAccumulator(acc, baseEmpty);
}

/**
 * @param {{ from?: string, to?: string }} [opts]
 */
async function fetchConversationSheetExport(opts = {}) {
  const fromIn = opts && typeof opts.from === 'string' ? opts.from.trim() : '';
  const toIn = opts && typeof opts.to === 'string' ? opts.to.trim() : '';
  if (fromIn || toIn) {
    const { fromIso, toIso } = parseDateOpts(opts);
    const preview = await fetchConversationSheetPreview({
      from: fromIso || undefined,
      to: toIso || undefined,
      maxRows: 500,
      offset: 0,
      allInRange: true,
      includeStats: false,
      botId: opts.botId,
    });
    return {
      tab: preview.tab,
      title: preview.title,
      headers: preview.headers,
      conversations: preview.conversations,
      dateFilter: preview.dateFilter,
    };
  }
  const ctx = await loadGridContext(opts.botId);
  const conversations = [];
  for (let ri = 0; ri < ctx.dataRows.length; ri += 1) {
    const cells = padRow(ctx.dataRows[ri], ctx.padWidth);
    const row = conversationRowFromCells(cells, ctx.headers);
    if (row) conversations.push(row);
  }
  return {
    tab: ctx.tab,
    title: ctx.title,
    headers: ctx.headers,
    conversations,
    dateFilter: { applied: false, serverApplied: false, from: null, to: null },
  };
}

function rowsToCsv(headers, conversations) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    if (/[\r\n",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(',')];
  for (let i = 0; i < conversations.length; i += 1) {
    const row = conversations[i] || {};
    lines.push(headers.map((h) => esc(row[h])).join(','));
  }
  return lines.join('\r\n');
}

function exportFilename(fromIso, toIso) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const seg = (iso) => {
    if (!iso || !isoYyyyMmDdOk(iso)) return '';
    const [ys, ms, ds] = iso.split('-');
    const mo = Number.parseInt(ms, 10);
    const d = Number.parseInt(ds, 10);
    const y = Number.parseInt(ys, 10);
    if (!months[mo - 1]) return '';
    return `${d}_${months[mo - 1]}_${y}`;
  };
  const a = seg(fromIso);
  const b = seg(toIso);
  if (a && b) return `conversation-leads_${a}_to_${b}.csv`;
  if (a) return `conversation-leads_from_${a}.csv`;
  if (b) return `conversation-leads_until_${b}.csv`;
  return 'conversation-leads_all.csv';
}

module.exports = {
  fetchConversationSheetPreview,
  fetchLiveAgentSheetPreview,
  fetchConversationLeadCaptureStats,
  fetchConversationSheetExport,
  rowsToCsv,
  exportFilename,
};
