/**
 * Form support APIs: nearest branches, appointment slot availability.
 */

const fs = require('fs');
const path = require('path');
const appointmentSchedule = require('./appointment-schedule');
const localTime = require('./local-time');
const { to24h, to12h } = require('./time-format');
const dateDisplay = require('./date-display');
const clientPaths = require('./client-paths');

const BRANCHES_PATH = clientPaths.branchesPath();
const BOOKED_PATH = path.join(__dirname, '..', 'data', 'appointment-booked.json');

const COUNTRY_DIAL = {
  IN: '+91',
  US: '+1',
  CA: '+1',
  GB: '+44',
  AE: '+971',
  AU: '+61',
  SG: '+65',
  SA: '+966',
  QA: '+974',
  OM: '+968',
  KW: '+965',
  BH: '+973',
  NP: '+977',
  BD: '+880',
  LK: '+94',
  PK: '+92',
  MY: '+60',
  DE: '+49',
  FR: '+33',
  IT: '+39',
  ES: '+34',
};

function isoToFlag(iso) {
  const up = String(iso || '')
    .trim()
    .toUpperCase();
  if (up.length !== 2) return '';
  return String.fromCodePoint(
    ...[...up].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

function countryToDial(iso) {
  const cc = String(iso || '')
    .trim()
    .toUpperCase();
  return COUNTRY_DIAL[cc] || '+91';
}

async function detectCountryFromCoords(lat, lng) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return { error: 'invalid_coordinates' };
  }
  try {
    const url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
      encodeURIComponent(latN) +
      '&longitude=' +
      encodeURIComponent(lngN) +
      '&localityLanguage=en';
    const res = await fetch(url);
    if (!res.ok) throw new Error('geocode_http_' + res.status);
    const data = await res.json();
    return countryResult(String(data.countryCode || '').toUpperCase());
  } catch (err) {
    return { error: 'geocode_failed', message: err.message };
  }
}

function countryResult(countryCode) {
  const cc = String(countryCode || '')
    .trim()
    .toUpperCase();
  const dialCode = countryToDial(cc || 'IN');
  const flag = isoToFlag(cc || 'IN');
  return {
    countryCode: cc || 'IN',
    dialCode,
    flag,
  };
}

function getClientIp(req) {
  if (!req) return '';
  const xf = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'];
  if (xf) return String(xf).split(',')[0].trim();
  const real = req.headers['x-real-ip'] || req.headers['X-Real-IP'];
  if (real) return String(real).trim();
  if (req.socket && req.socket.remoteAddress) {
    return String(req.socket.remoteAddress).replace(/^::ffff:/, '');
  }
  return req.ip ? String(req.ip) : '';
}

function isPrivateIp(ip) {
  const s = String(ip || '').trim();
  if (!s || s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  if (/^10\./.test(s) || /^192\.168\./.test(s) || /^172\.(1[6-9]|2\d|3[01])\./.test(s)) {
    return true;
  }
  return false;
}

async function detectCountryFromIp(clientIp) {
  const ip = String(clientIp || '').trim();
  if (isPrivateIp(ip)) {
    return countryResult('IN');
  }
  try {
    const url =
      'https://api.bigdatacloud.net/data/ip-geolocation?ip=' +
      encodeURIComponent(ip) +
      '&localityLanguage=en';
    const res = await fetch(url);
    if (!res.ok) throw new Error('ip_geocode_http_' + res.status);
    const data = await res.json();
    const countryCode = String(
      data.countryCode || data.country?.isoAlpha2 || ''
    ).toUpperCase();
    if (!countryCode) throw new Error('ip_geocode_no_country');
    return countryResult(countryCode);
  } catch (err) {
    return Object.assign({ detectError: err.message }, countryResult('IN'));
  }
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadBranches() {
  const raw = loadJson(BRANCHES_PATH, []);
  return Array.isArray(raw) ? raw : [];
}

function loadBooked() {
  const raw = loadJson(BOOKED_PATH, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function saveBooked(raw) {
  const data = raw && typeof raw === 'object' ? raw : { forms: {} };
  if (!data.forms) data.forms = {};
  fs.writeFileSync(BOOKED_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getBookedFormBlock(formId) {
  const raw = loadBooked();
  const id = appointmentSchedule.normalizeFormId(formId);
  if (raw.forms && raw.forms[id]) return raw.forms[id];

  if (id === 'appointment' && raw.general) {
    return raw.general;
  }
  return { fullyBookedDates: [], slotsByDate: {} };
}

/** @returns {Record<string, number>} slot time24 -> booking count */
function bookedCountsForDate(formId, dateIso) {
  const block = getBookedFormBlock(formId);
  const day = block.slotsByDate && block.slotsByDate[dateIso];
  const counts = {};
  if (!day) return counts;

  if (Array.isArray(day)) {
    day.forEach((t) => {
      const k = to24h(t);
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  if (typeof day === 'object') {
    Object.keys(day).forEach((key) => {
      const k = to24h(key);
      if (!k) return;
      const n = parseInt(day[key], 10);
      counts[k] = Number.isFinite(n) && n > 0 ? n : 1;
    });
  }
  return counts;
}

function slotStatus(booked, capacity) {
  const cap = Math.max(1, capacity || 1);
  const n = Math.max(0, booked || 0);
  if (n >= cap) return 'full';
  return 'available';
}

function nearestBranches(lat, lng, limit = 5) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return { branches: [], error: 'invalid_coordinates' };
  }
  const max = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
  const branches = loadBranches()
    .map((b) => {
      const dist = haversineKm(latN, lngN, Number(b.lat), Number(b.lng));
      return {
        id: String(b.id || ''),
        name: String(b.name || ''),
        city: String(b.city || ''),
        area: String(b.area || ''),
        distanceKm: Math.round(dist * 10) / 10,
      };
    })
    .filter((b) => b.id && b.name)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, max);
  return { branches };
}

function parseTimeToMinutes(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function buildSlotList(dayStart, dayEnd, slotMinutes) {
  const start = parseTimeToMinutes(dayStart) ?? 9 * 60;
  const end = parseTimeToMinutes(dayEnd) ?? 18 * 60;
  const step = Math.max(parseInt(slotMinutes, 10) || 30, 5);
  const slots = [];
  for (let t = start; t < end; t += step) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

function todayForSettings(settings) {
  return localTime.todayIsoInZone(settings && settings.timezone);
}

function slotStartMinutes24(time24) {
  const s = to24h(time24);
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** On today, drop slots that already started (business timezone). */
function filterPastSlotsToday(slots24, dateIso, hidePastTimesToday, timezone) {
  const tz = localTime.normalizeTimezone(timezone);
  if (!hidePastTimesToday || dateIso !== localTime.todayIsoInZone(tz)) return slots24;
  const now = localTime.nowMinutesInZone(tz);
  return slots24.filter((t) => {
    const mins = slotStartMinutes24(t);
    return mins != null && mins > now;
  });
}

function appointmentSlots(formIdOrScope, _doctorId, date) {
  const day = String(date || '').trim();
  const formId = appointmentSchedule.normalizeFormId(formIdOrScope);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: 'invalid_date', formId, slots: [] };
  }
  const settings = appointmentSchedule.getFormSettings(formId);
  const today = todayForSettings(settings);

  if (day < today) {
    return {
      error: 'past_date',
      date: day,
      formId,
      closed: false,
      allowToday: settings.allowToday,
      hidePastTimesToday: settings.hidePastTimesToday,
      timezone: settings.timezone,
      slots: [],
      allSlots: [],
      availableTimes: [],
    };
  }

  if (day === today && !settings.allowToday) {
    return {
      date: day,
      formId,
      closed: true,
      todayHidden: true,
      allowToday: false,
      hidePastTimesToday: settings.hidePastTimesToday,
      timezone: settings.timezone,
      bookingWindow: appointmentSchedule.getBookingWindow(settings),
      slots: [],
      allSlots: [],
      availableTimes: [],
    };
  }

  const bookingWindow = appointmentSchedule.getBookingWindow(settings);
  if (!appointmentSchedule.isWithinBookingWindow(day, settings)) {
    return {
      date: day,
      formId,
      closed: true,
      outsideWindow: true,
      bookingWindow,
      allowToday: settings.allowToday,
      hidePastTimesToday: settings.hidePastTimesToday,
      timezone: settings.timezone,
      slots: [],
      allSlots: [],
      availableTimes: [],
    };
  }

  const resolved = appointmentSchedule.resolveForDate(formId, day);
  const capacityDefault = resolved.slotCapacity || 1;

  if (resolved.closed) {
    return {
      date: day,
      formId,
      closed: true,
      weekday: resolved.weekday,
      slotMinutes: resolved.slotMinutes,
      slotCapacity: capacityDefault,
      periods: resolved.periods,
      allowToday: settings.allowToday,
      hidePastTimesToday: settings.hidePastTimesToday,
      timezone: settings.timezone,
      slots: [],
      allSlots: [],
      availableTimes: [],
    };
  }

  let allSlots24 = appointmentSchedule.buildAllSlots(resolved);
  allSlots24 = filterPastSlotsToday(
    allSlots24,
    day,
    settings.hidePastTimesToday,
    settings.timezone
  );

  if (!allSlots24.length) {
    return {
      date: day,
      formId,
      closed: false,
      noAvailableSlots: true,
      isToday: day === today,
      allowToday: settings.allowToday,
      hidePastTimesToday: settings.hidePastTimesToday,
      timezone: settings.timezone,
      bookingWindow,
      weekday: resolved.weekday,
      slotMinutes: resolved.slotMinutes,
      slotCapacity: capacityDefault,
      periods: resolved.periods,
      allFull: false,
      slots: [],
      allSlots: [],
      availableTimes: [],
    };
  }

  const block = getBookedFormBlock(formId);
  const fullyBookedDates = Array.isArray(block.fullyBookedDates)
    ? block.fullyBookedDates
    : [];
  const counts = bookedCountsForDate(formId, day);

  const slots = allSlots24.map((time24) => {
    const booked = counts[time24] || 0;
    const capacity = capacityDefault;
    const status = slotStatus(booked, capacity);
    const time12 = to12h(time24);
    return {
      time: time12,
      time24,
      booked,
      capacity,
      remaining: Math.max(0, capacity - booked),
      status,
    };
  });

  const availableTimes = slots
    .filter((s) => s.status === 'available')
    .map((s) => s.time);
  const allSlots = slots.map((s) => s.time);
  const bookedTimes = slots
    .filter((s) => s.booked > 0)
    .map((s) => s.time);

  const allFull =
    slots.length > 0 && slots.every((s) => s.status === 'full');

  return {
    date: day,
    formId,
    closed: false,
    isToday: day === today,
    allowToday: settings.allowToday,
    hidePastTimesToday: settings.hidePastTimesToday,
    timezone: settings.timezone,
    bookingWindow,
    weekday: resolved.weekday,
    slotMinutes: resolved.slotMinutes,
    slotCapacity: capacityDefault,
    periods: resolved.periods,
    fullyBookedDates,
    allFull,
    slots,
    allSlots,
    allSlots24: allSlots24,
    availableTimes,
    bookedTimes,
  };
}

function appointmentMonthSummary(formIdOrScope, year, month) {
  const formId = appointmentSchedule.normalizeFormId(formIdOrScope);
  const y = parseInt(year, 10);
  const mo = parseInt(month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return { error: 'invalid_month', formId, closedDates: [], bookedDates: [] };
  }
  const settings = appointmentSchedule.getFormSettings(formId);
  const bookingWindow = appointmentSchedule.getBookingWindow(settings);
  const closedDates = [];
  const bookedDates = [];
  const days = {};
  const daysInMonth = new Date(y, mo, 0).getDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso =
      y +
      '-' +
      String(mo).padStart(2, '0') +
      '-' +
      String(day).padStart(2, '0');
    if (!appointmentSchedule.isWithinBookingWindow(iso, settings)) {
      closedDates.push(iso);
      days[iso] = { working: false, bookedCount: 0, totalSlots: 0 };
      continue;
    }
    const r = appointmentSlots(formId, '', iso);
    if (r.todayHidden || r.outsideWindow) {
      closedDates.push(iso);
      days[iso] = { working: false, bookedCount: 0, totalSlots: 0 };
    } else if (r.closed) {
      closedDates.push(iso);
      days[iso] = { working: false, bookedCount: 0, totalSlots: 0 };
    } else if (
      r.allFull ||
      r.noAvailableSlots ||
      (Array.isArray(r.allSlots) &&
        r.allSlots.length > 0 &&
        (!r.availableTimes || r.availableTimes.length === 0))
    ) {
      bookedDates.push(iso);
      const slotRows = Array.isArray(r.slots) ? r.slots : [];
      days[iso] = {
        working: slotRows.length > 0,
        bookedCount: slotRows.filter((s) => (s.booked || 0) > 0).length,
        totalSlots: slotRows.length,
      };
    } else {
      const slotRows = Array.isArray(r.slots) ? r.slots : [];
      days[iso] = {
        working: slotRows.length > 0,
        bookedCount: slotRows.filter((s) => (s.booked || 0) > 0).length,
        totalSlots: slotRows.length,
      };
    }
    if (Array.isArray(r.fullyBookedDates)) {
      r.fullyBookedDates.forEach((d) => {
        if (closedDates.indexOf(d) < 0 && bookedDates.indexOf(d) < 0) {
          bookedDates.push(d);
        }
      });
    }
  }

  return {
    formId,
    year: y,
    month: mo,
    allowToday: settings.allowToday,
    hidePastTimesToday: settings.hidePastTimesToday,
    timezone: settings.timezone,
    maxBookingDays: settings.maxBookingDays,
    bookingWindow,
    closedDates,
    bookedDates,
    days,
  };
}

function bookAppointmentSlot(formIdOrScope, dateIso, timeLabel, options) {
  const dryRun = !!(options && options.dryRun);
  const formId = appointmentSchedule.normalizeFormId(formIdOrScope);
  const day = dateDisplay.parseToIsoYmd(dateIso);
  const time24 = to24h(timeLabel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time24) {
    return { ok: false, error: 'invalid_date_or_time', formId, date: day };
  }

  const slotCheck = appointmentSlots(formId, '', day);
  if (slotCheck.error === 'past_date') {
    return {
      ok: false,
      error: 'past_date',
      formId,
      date: day,
      time: to12h(time24),
    };
  }
  if (slotCheck.todayHidden) {
    return {
      ok: false,
      error: 'today_not_allowed',
      formId,
      date: day,
      time: to12h(time24),
    };
  }
  if (slotCheck.outsideWindow) {
    return {
      ok: false,
      error: 'outside_booking_window',
      formId,
      date: day,
      time: to12h(time24),
    };
  }
  const slots = Array.isArray(slotCheck.slots) ? slotCheck.slots : [];
  const match = slots.find(
    (s) => s.time24 === time24 || to24h(s.time) === time24
  );
  if (!match || match.status === 'full') {
    return {
      ok: false,
      error: 'slot_unavailable',
      formId,
      date: day,
      time: to12h(time24),
      closed: !!slotCheck.closed,
      noAvailableSlots: !!slotCheck.noAvailableSlots,
    };
  }

  let bookedCount = 1;
  if (!dryRun) {
    const raw = loadBooked();
    if (!raw.forms) raw.forms = {};
    if (!raw.forms[formId]) {
      raw.forms[formId] = { fullyBookedDates: [], slotsByDate: {} };
    }
    const block = raw.forms[formId];
    if (!block.slotsByDate || typeof block.slotsByDate !== 'object') {
      block.slotsByDate = {};
    }
    if (!block.slotsByDate[day] || typeof block.slotsByDate[day] !== 'object') {
      block.slotsByDate[day] = {};
    }
    const dayMap = block.slotsByDate[day];
    dayMap[time24] = (parseInt(dayMap[time24], 10) || 0) + 1;
    bookedCount = dayMap[time24];
    saveBooked(raw);
  }

  return {
    ok: true,
    formId,
    date: day,
    appointmentDate: dateDisplay.formatDateDisplay(day),
    time: to12h(time24),
    time24,
    booked: bookedCount,
    capacity: match.capacity || 1,
    dryRun,
  };
}

function releaseAppointmentSlot(formIdOrScope, dateIso, timeLabel) {
  const formId = appointmentSchedule.normalizeFormId(formIdOrScope);
  const day = dateDisplay.parseToIsoYmd(dateIso);
  const time24 = to24h(timeLabel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time24) {
    return { ok: false, error: 'invalid_date_or_time', formId, date: day };
  }

  const raw = loadBooked();
  if (!raw.forms || !raw.forms[formId]) {
    return { ok: false, error: 'not_found', formId, date: day, time: time24 };
  }
  const block = raw.forms[formId];
  const dayMap =
    block.slotsByDate && typeof block.slotsByDate === 'object'
      ? block.slotsByDate[day]
      : null;
  if (!dayMap || typeof dayMap !== 'object' || !dayMap[time24]) {
    return { ok: false, error: 'not_found', formId, date: day, time: time24 };
  }
  const next = (parseInt(dayMap[time24], 10) || 0) - 1;
  if (next <= 0) {
    delete dayMap[time24];
    if (!Object.keys(dayMap).length) delete block.slotsByDate[day];
  } else {
    dayMap[time24] = next;
  }
  saveBooked(raw);
  return {
    ok: true,
    formId,
    date: day,
    time: to12h(time24),
    time24,
    released: true,
  };
}

module.exports = {
  nearestBranches,
  appointmentSlots,
  appointmentMonthSummary,
  bookAppointmentSlot,
  releaseAppointmentSlot,
  getAppointmentSchedule: appointmentSchedule.getScheduleForClient,
  detectCountryFromCoords,
  detectCountryFromIp,
  getClientIp,
  countryToDial,
  isoToFlag,
  COUNTRY_DIAL,
  BRANCHES_PATH,
  BOOKED_PATH,
};
