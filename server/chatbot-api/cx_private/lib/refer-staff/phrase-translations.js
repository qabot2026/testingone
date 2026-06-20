/**
 * Bot-wide phrase dictionary: exact English from Dialogflow → hi / mr.
 * Display text only — chip/dropdown send values stay English for Dialogflow match.
 */

const fs = require('fs');
const path = require('path');
const clientPaths = require('./client-paths');

const DATA_PATH = clientPaths.phraseTranslationsPath();

let cache = null;
let cacheMtime = 0;
let cacheLower = null;

function normalizeLang(code) {
  const c = String(code || '')
    .trim()
    .toLowerCase();
  if (!c || c === 'en') return 'en';
  return c.split('-')[0];
}

function normalizeKey(text) {
  return String(text == null ? '' : text)
    .trim()
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ');
}

function isEnabled() {
  if (process.env.PHRASE_TRANSLATIONS_ENABLED === 'false') return false;
  if (process.env.PHRASE_TRANSLATIONS_ENABLED === 'true') return true;
  return fs.existsSync(DATA_PATH);
}

function loadPhrases() {
  if (!fs.existsSync(DATA_PATH)) {
    cache = {};
    cacheLower = {};
    return cache;
  }
  const stat = fs.statSync(DATA_PATH);
  if (cache && stat.mtimeMs === cacheMtime) return cache;

  const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  cache = {};
  cacheLower = {};
  Object.keys(parsed).forEach((key) => {
    if (key.startsWith('_')) return;
    const k = normalizeKey(key);
    cache[k] = parsed[key];
    cacheLower[k.toLowerCase()] = k;
  });
  cacheMtime = stat.mtimeMs;
  return cache;
}

function lookupEntry(phrases, key) {
  const k = normalizeKey(key);
  if (!k) return null;
  if (phrases[k]) return phrases[k];
  const canon = cacheLower[k.toLowerCase()];
  return canon ? phrases[canon] : null;
}

function translateLine(text, lang, phrases) {
  const key = normalizeKey(text);
  if (!key || lang === 'en') return text;
  const entry = lookupEntry(phrases, key);
  if (!entry || typeof entry !== 'object') return text;
  const t = entry[lang];
  if (t != null && String(t).trim()) return String(t).trim();
  return text;
}

function translateMultiline(text, lang, phrases) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim() || lang === 'en') return text;
  return raw
    .split('\n')
    .map((line) => translateLine(line, lang, phrases))
    .join('\n');
}

/** Flat map for browser: { "English phrase": "Translated" } */
function getFlatMapForLang(uiLanguageCode) {
  const lang = normalizeLang(uiLanguageCode);
  if (lang === 'en') return {};
  const phrases = loadPhrases();
  const map = {};
  Object.keys(phrases).forEach((en) => {
    const entry = phrases[en];
    if (entry && entry[lang] != null && String(entry[lang]).trim()) {
      map[en] = String(entry[lang]).trim();
      map[en.toLowerCase()] = String(entry[lang]).trim();
    }
  });
  return map;
}

function translateChip(chip, lang, phrases) {
  const sendMessage = String(chip.message || chip.label || '').trim();
  const displaySrc = String(chip.label || chip.message || '').trim();
  const label = translateLine(displaySrc, lang, phrases);
  if (label === displaySrc && sendMessage === chip.message) return chip;
  return {
    ...chip,
    label,
    message: sendMessage,
    sendMessage,
  };
}

function translateButton(btn, lang, phrases) {
  const sendMessage = String(
    btn.message || btn.postback || btn.ctaMessage || btn.label || ''
  ).trim();
  const displaySrc = String(btn.label || btn.text || '').trim();
  const label = translateLine(displaySrc, lang, phrases);
  if (label === displaySrc) return btn;
  return { ...btn, label, message: sendMessage || btn.message };
}

function applyToResult(result, uiLanguageCode) {
  if (!isEnabled() || !result) return result;
  const lang = normalizeLang(uiLanguageCode);
  if (lang === 'en') return result;

  const phrases = loadPhrases();
  const out = { ...result };
  let applied = false;

  function touch(field, fn) {
    if (out[field] == null) return;
    const next = fn(out[field]);
    if (next !== out[field]) {
      out[field] = next;
      applied = true;
    }
  }

  touch('reply', (v) => {
    const next = translateMultiline(v, lang, phrases);
    if (next !== v) {
      delete out.replyHtml;
      delete out.replyFormatted;
      delete out.replyChannel;
    }
    return next;
  });
  touch('chipHeading', (v) => {
    const raw = String(v == null ? '' : v);
    if (!raw.trim() || lang === 'en') return v;
    return raw
      .split('\n')
      .map((line) => translateLine(line, lang, phrases))
      .join('\n');
  });

  if (Array.isArray(out.chips)) {
    out.chips = out.chips.map((chip) => {
      const next = translateChip(chip, lang, phrases);
      if (next !== chip) applied = true;
      return next;
    });
  }

  if (Array.isArray(out.replyParts)) {
    out.replyParts = out.replyParts.map((p) => {
      if (p.type === 'text' && p.text) {
        const text = translateMultiline(p.text, lang, phrases);
        if (text === p.text) return p;
        applied = true;
        return { ...p, text };
      }
      if (p.type === 'link' && p.text) {
        const text = translateLine(p.text, lang, phrases);
        if (text === p.text) return p;
        applied = true;
        return { ...p, text };
      }
      return p;
    });
  }

  if (Array.isArray(out.dropdowns)) {
    out.dropdowns = out.dropdowns.map((d) => {
      let changed = false;
      const next = { ...d };
      ['message', 'placeholder'].forEach((k) => {
        if (!d[k]) return;
        const t = translateLine(d[k], lang, phrases);
        if (t !== d[k]) {
          next[k] = t;
          changed = true;
        }
      });
      if (Array.isArray(d.options)) {
        next.options = d.options.map((opt) => {
          const value = String(opt.value || opt.label || '').trim();
          const labelSrc = String(opt.label || opt.value || '').trim();
          const label = translateLine(labelSrc, lang, phrases);
          if (label === labelSrc) return opt;
          changed = true;
          return { ...opt, label, value: value || opt.value };
        });
      }
      if (changed) applied = true;
      return next;
    });
  }

  if (Array.isArray(out.galleries)) {
    out.galleries = out.galleries.map((g) => {
      let changed = false;
      const next = { ...g };
      if (g.message) {
        const m = translateLine(g.message, lang, phrases);
        if (m !== g.message) {
          next.message = m;
          changed = true;
        }
      }
      if (Array.isArray(g.images)) {
        next.images = g.images.map((img) => {
          const nameSrc = String(img.name || img.title || '').trim();
          const name = translateLine(nameSrc, lang, phrases);
          if (name === nameSrc) return img;
          changed = true;
          return { ...img, name, title: name };
        });
      }
      if (changed) applied = true;
      return next;
    });
  }

  if (Array.isArray(out.cardCarousels)) {
    out.cardCarousels = out.cardCarousels.map((car) => {
      let changed = false;
      const next = { ...car };
      if (car.message) {
        const m = translateLine(car.message, lang, phrases);
        if (m !== car.message) {
          next.message = m;
          changed = true;
        }
      }
      if (Array.isArray(car.cards)) {
        next.cards = car.cards.map((card) => {
          let cardChanged = false;
          const c = { ...card };
          ['title', 'subtitle', 'ctaLabel'].forEach((k) => {
            if (!card[k]) return;
            const t = translateLine(card[k], lang, phrases);
            if (t !== card[k]) {
              c[k] = t;
              cardChanged = true;
            }
          });
          if (card.ctaLabel && card.ctaMessage) {
            c.ctaMessage = card.ctaMessage;
          }
          if (Array.isArray(card.buttons)) {
            c.buttons = card.buttons.map((btn) => {
              const b = translateButton(btn, lang, phrases);
              if (b !== btn) cardChanged = true;
              return b;
            });
          }
          if (cardChanged) changed = true;
          return c;
        });
      }
      if (changed) applied = true;
      return next;
    });
  }

  if (Array.isArray(out.infoCards)) {
    out.infoCards = out.infoCards.map((card) => {
      let changed = false;
      const c = { ...card };
      ['title', 'subtitle', 'description', 'body'].forEach((k) => {
        if (!card[k]) return;
        const t = translateLine(card[k], lang, phrases);
        if (t !== card[k]) {
          c[k] = t;
          changed = true;
        }
      });
      if (Array.isArray(card.buttons)) {
        c.buttons = card.buttons.map((btn) => {
          const b = translateButton(btn, lang, phrases);
          if (b !== btn) changed = true;
          return b;
        });
      }
      if (changed) applied = true;
      return c;
    });
  }

  if (Array.isArray(out.downloads)) {
    out.downloads = out.downloads.map((d) => {
      const labelSrc = String(d.label || d.fileName || '').trim();
      const label = translateLine(labelSrc, lang, phrases);
      if (label === labelSrc) return d;
      applied = true;
      return { ...d, label };
    });
  }

  if (applied) {
    out.localizedFromPhrases = true;
    out.uiLanguageCode = lang;
  }
  return out;
}

const I18N_PREFIX = '@i18n:';

const DEFAULT_I18N_EN = {
  submit: 'Submit',
  required: 'This field is required.',
  invalidEmail: 'Enter a valid email.',
  invalidPhone: 'Enter a valid mobile number.',
  invalidOtp: 'Enter a valid OTP code.',
  invalidPastBirthDate: 'Choose a date before today.',
  invalidFutureDate: 'Choose today or a later date.',
  invalidDateFormat: 'Use DD/MM/YYYY.',
  datePlaceholder: 'DD/MM/YYYY',
  namePlaceholder: 'Your name',
  mobilePlaceholder: 'Mobile number',
  emailPlaceholder: 'Email address',
  dialCodePlaceholder: 'Country code',
  otpCodePlaceholder: 'OTP code',
  otpEnterPlaceholder: 'Enter OTP',
  resendOtp: "Didn't receive? Send OTP again",
  changeMobile: 'Change mobile number',
  otpResending: 'Sending a new code…',
  otpResendNeedMobile: 'Enter your mobile number first.',
  birthDatePlaceholder: 'Date of birth',
  summaryNameLabel: 'Name',
  summaryMobileLabel: 'Mobile',
  summaryEmailLabel: 'Email',
  summaryDialCodeLabel: 'Code',
  summaryOtpLabel: 'OTP',
  summaryDateLabel: 'Date',
  summaryTimeLabel: 'Time',
  summaryAppointmentDateLabel: 'Appointment Date',
  summaryAppointmentTimeLabel: 'Appointment Time',
  summaryDocumentLabel: 'Document',
  summaryDoctorIdLabel: 'Doctor',
  summaryBirthDateLabel: 'Birth date',
  summaryRatingLabel: 'Rating',
  summaryMessageLabel: 'Message',
  chooseFiles: 'Upload',
  addMoreFiles: 'Add',
  filesSelected: '{n} selected',
  clearFileSelection: 'Clear selection',
  removeFile: 'Remove file',
  calPrev: 'Previous month',
  calNext: 'Next month',
  calPickTime: 'Pick a time',
  calBookedLegend: 'Green - Available · Red - Full',
  calClosedDay: 'Not available on this day.',
  calTodayHidden: 'Today is not available for booking. Pick a future date.',
  calNoMoreSlotsToday: 'No more times left today. Try another date.',
  calOutsideWindow: 'You can only book within the allowed number of days.',
  calLoading: 'Loading…',
  calSlotTaken: 'That time was just booked. Pick another slot.',
  calSlotInvalid: 'This time is not available anymore. Pick another slot.',
  calNetworkError: 'Network error. Please try again.',
  calBookFailed: 'Could not book this slot. Try again.',
  formSubmitThanks: 'Thank you for sharing.',
  formSubmitThanksAppointment: 'Your appointment request has been submitted.',
  closeForm: 'Close form',
  inputPlaceholder: 'Type your message here…',
};

const LANG_LABELS = {
  hi: 'Hindi',
  mr: 'Marathi',
  en: 'English',
};

function isI18nKey(key) {
  return String(key || '').startsWith(I18N_PREFIX);
}

function i18nKeyToField(key) {
  return String(key || '').slice(I18N_PREFIX.length);
}

function fieldToI18nKey(field) {
  return I18N_PREFIX + String(field || '').trim();
}

function resolveLanguages(configured) {
  const list = Array.isArray(configured) ? configured : ['hi', 'mr'];
  const out = [];
  list.forEach((item) => {
    const code =
      typeof item === 'string'
        ? normalizeLang(item)
        : normalizeLang(item && (item.code || item.lang));
    if (code && code !== 'en' && out.indexOf(code) < 0) out.push(code);
  });
  return out.length ? out : ['hi', 'mr'];
}

function readDocument() {
  if (!fs.existsSync(DATA_PATH)) {
    return {
      _help:
        'Key = EXACT English text from Dialogflow (chips, replies, dropdowns) OR @i18n:key for form UI strings.',
      _help2:
        'Add one line once. Wherever that English appears, translations show after the visitor selects a language.',
    };
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function writeDocument(doc) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  cache = null;
  cacheLower = null;
  cacheMtime = 0;
}

function pickTranslations(entry, langs) {
  const out = {};
  langs.forEach((lang) => {
    out[lang] = entry && entry[lang] != null ? String(entry[lang]) : '';
  });
  return out;
}

function rowEnglishForKey(key, entry) {
  if (isI18nKey(key)) {
    const field = i18nKeyToField(key);
    return (
      (entry && entry.en != null && String(entry.en).trim()) ||
      DEFAULT_I18N_EN[field] ||
      field
    );
  }
  return key;
}

function getSheet(options) {
  const doc = readDocument();
  const langs = resolveLanguages(options && options.languages);
  const rows = [];
  const seen = new Set();

  Object.keys(doc).forEach((key) => {
    if (key.startsWith('_')) return;
    const entry = doc[key];
    if (!entry || typeof entry !== 'object') return;
    seen.add(key);
    rows.push({
      key,
      english: rowEnglishForKey(key, entry),
      type: isI18nKey(key) ? 'i18n' : 'phrase',
      translations: pickTranslations(entry, langs),
    });
  });

  Object.keys(DEFAULT_I18N_EN).forEach((field) => {
    const key = fieldToI18nKey(field);
    if (seen.has(key)) return;
    rows.push({
      key,
      english: DEFAULT_I18N_EN[field],
      type: 'i18n',
      translations: langs.reduce((acc, lang) => {
        acc[lang] = '';
        return acc;
      }, {}),
    });
  });

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'i18n' ? 1 : -1;
    return String(a.english).localeCompare(String(b.english));
  });

  return { languages: langs, rows, enabled: isEnabled() };
}

function saveSheet(payload) {
  const langs = resolveLanguages(payload && payload.languages);
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const doc = readDocument();

  Object.keys(doc).forEach((k) => {
    if (!k.startsWith('_')) delete doc[k];
  });

  rows.forEach((row) => {
    const type = row && row.type === 'i18n' ? 'i18n' : 'phrase';
    let key = String((row && row.key) || '').trim();
    const english = normalizeKey(row && row.english);
    if (type === 'i18n') {
      if (!key || !isI18nKey(key)) {
        const field = String((row && row.i18nField) || '').trim();
        key = field ? fieldToI18nKey(field) : fieldToI18nKey(english.replace(/\W+/g, '_').slice(0, 40));
      }
    } else {
      key = english;
    }
    if (!key || key.startsWith('_')) return;

    const entry = {};
    if (type === 'i18n' && english) entry.en = english;
    langs.forEach((lang) => {
      const val = row.translations && row.translations[lang];
      if (val != null && String(val).trim()) entry[lang] = String(val).trim();
    });
    if (Object.keys(entry).length) doc[key] = entry;
  });

  writeDocument(doc);
  return getSheet({ languages: langs });
}

function getI18nMapForLang(uiLanguageCode) {
  const lang = normalizeLang(uiLanguageCode);
  if (lang === 'en') return {};
  const phrases = loadPhrases();
  const map = {};
  Object.keys(phrases).forEach((key) => {
    if (!isI18nKey(key)) return;
    const field = i18nKeyToField(key);
    const entry = phrases[key];
    const t = entry && entry[lang];
    if (t != null && String(t).trim()) map[field] = String(t).trim();
  });
  return map;
}

function csvEscape(val) {
  const s = String(val == null ? '' : val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function langHeaderToCode(header) {
  const h = String(header || '')
    .trim()
    .toLowerCase();
  if (!h || h === 'english' || h === 'en') return 'en';
  if (LANG_LABELS[h]) return h;
  const byLabel = Object.keys(LANG_LABELS).find(
    (code) => LANG_LABELS[code].toLowerCase() === h
  );
  if (byLabel) return byLabel;
  return normalizeLang(h);
}

function exportCsv(languages) {
  const sheet = getSheet({ languages });
  const header = ['English', ...sheet.languages.map((code) => LANG_LABELS[code] || code)];
  const lines = [header.map(csvEscape).join(',')];
  sheet.rows.forEach((row) => {
    lines.push(
      [row.english, ...sheet.languages.map((lang) => row.translations[lang] || '')]
        .map(csvEscape)
        .join(',')
    );
  });
  return lines.join('\n');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function importCsv(text, languages) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('CSV is empty');

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const langCols = [];
  header.forEach((col, idx) => {
    if (idx === 0) return;
    const code = langHeaderToCode(col);
    if (code && code !== 'en') langCols.push({ idx, code });
  });
  const langs = resolveLanguages(
    langCols.length ? langCols.map((c) => c.code) : languages
  );

  const existing = getSheet({ languages: langs });
  const byEnglish = {};
  existing.rows.forEach((row) => {
    byEnglish[String(row.english).toLowerCase()] = row;
  });

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const english = normalizeKey(cells[0]);
    if (!english) continue;
    const prior = byEnglish[english.toLowerCase()];
    const translations = {};
    langCols.forEach(({ idx, code }) => {
      if (langs.indexOf(code) < 0) return;
      translations[code] = cells[idx] != null ? String(cells[idx]) : '';
    });
    rows.push({
      key: prior ? prior.key : english,
      english,
      type: prior ? prior.type : 'phrase',
      translations,
    });
  }

  return saveSheet({ languages: langs, rows });
}

function importJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid JSON document');
  }
  const next = { ...obj };
  if (!next._help) {
    next._help =
      'Key = EXACT English text from Dialogflow (chips, replies, dropdowns) OR @i18n:key for form UI strings.';
  }
  writeDocument(next);
  return getSheet({});
}

module.exports = {
  applyToResult,
  isEnabled,
  getFlatMapForLang,
  getI18nMapForLang,
  getSheet,
  saveSheet,
  exportCsv,
  importCsv,
  importJson,
  readDocument,
  DATA_PATH,
  translateLine,
  normalizeKey,
  resolveLanguages,
  DEFAULT_I18N_EN,
};
