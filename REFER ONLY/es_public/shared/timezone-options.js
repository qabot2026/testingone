/**
 * IANA timezone options for dashboard / bot settings.
 */
(function (global) {
  'use strict';

  var DEFAULT_TZ = 'Asia/Kolkata';

  var OPTIONS = [
    { value: 'Asia/Kolkata', label: 'India — Kolkata (IST)' },
    { value: 'Asia/Colombo', label: 'Sri Lanka — Colombo' },
    { value: 'Asia/Kathmandu', label: 'Nepal — Kathmandu' },
    { value: 'Asia/Dhaka', label: 'Bangladesh — Dhaka' },
    { value: 'Asia/Karachi', label: 'Pakistan — Karachi' },
    { value: 'Asia/Dubai', label: 'UAE — Dubai (GST)' },
    { value: 'Asia/Muscat', label: 'Oman — Muscat' },
    { value: 'Asia/Riyadh', label: 'Saudi Arabia — Riyadh' },
    { value: 'Asia/Qatar', label: 'Qatar — Doha' },
    { value: 'Asia/Kuwait', label: 'Kuwait — Kuwait City' },
    { value: 'Asia/Bahrain', label: 'Bahrain — Manama' },
    { value: 'Asia/Tehran', label: 'Iran — Tehran' },
    { value: 'Asia/Jerusalem', label: 'Israel — Jerusalem' },
    { value: 'Asia/Baghdad', label: 'Iraq — Baghdad' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'Asia/Kuala_Lumpur', label: 'Malaysia — Kuala Lumpur' },
    { value: 'Asia/Bangkok', label: 'Thailand — Bangkok' },
    { value: 'Asia/Jakarta', label: 'Indonesia — Jakarta' },
    { value: 'Asia/Manila', label: 'Philippines — Manila' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Vietnam — Ho Chi Minh City' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Shanghai', label: 'China — Shanghai' },
    { value: 'Asia/Taipei', label: 'Taiwan — Taipei' },
    { value: 'Asia/Tokyo', label: 'Japan — Tokyo' },
    { value: 'Asia/Seoul', label: 'South Korea — Seoul' },
    { value: 'Europe/London', label: 'United Kingdom — London' },
    { value: 'Europe/Dublin', label: 'Ireland — Dublin' },
    { value: 'Europe/Lisbon', label: 'Portugal — Lisbon' },
    { value: 'Europe/Paris', label: 'France — Paris' },
    { value: 'Europe/Berlin', label: 'Germany — Berlin' },
    { value: 'Europe/Amsterdam', label: 'Netherlands — Amsterdam' },
    { value: 'Europe/Brussels', label: 'Belgium — Brussels' },
    { value: 'Europe/Madrid', label: 'Spain — Madrid' },
    { value: 'Europe/Rome', label: 'Italy — Rome' },
    { value: 'Europe/Zurich', label: 'Switzerland — Zurich' },
    { value: 'Europe/Vienna', label: 'Austria — Vienna' },
    { value: 'Europe/Stockholm', label: 'Sweden — Stockholm' },
    { value: 'Europe/Oslo', label: 'Norway — Oslo' },
    { value: 'Europe/Copenhagen', label: 'Denmark — Copenhagen' },
    { value: 'Europe/Helsinki', label: 'Finland — Helsinki' },
    { value: 'Europe/Warsaw', label: 'Poland — Warsaw' },
    { value: 'Europe/Prague', label: 'Czech Republic — Prague' },
    { value: 'Europe/Athens', label: 'Greece — Athens' },
    { value: 'Europe/Istanbul', label: 'Turkey — Istanbul' },
    { value: 'Europe/Moscow', label: 'Russia — Moscow' },
    { value: 'Africa/Cairo', label: 'Egypt — Cairo' },
    { value: 'Africa/Johannesburg', label: 'South Africa — Johannesburg' },
    { value: 'Africa/Lagos', label: 'Nigeria — Lagos' },
    { value: 'Africa/Nairobi', label: 'Kenya — Nairobi' },
    { value: 'America/New_York', label: 'USA — Eastern (New York)' },
    { value: 'America/Chicago', label: 'USA — Central (Chicago)' },
    { value: 'America/Denver', label: 'USA — Mountain (Denver)' },
    { value: 'America/Los_Angeles', label: 'USA — Pacific (Los Angeles)' },
    { value: 'America/Phoenix', label: 'USA — Arizona (Phoenix)' },
    { value: 'America/Anchorage', label: 'USA — Alaska (Anchorage)' },
    { value: 'Pacific/Honolulu', label: 'USA — Hawaii (Honolulu)' },
    { value: 'America/Toronto', label: 'Canada — Eastern (Toronto)' },
    { value: 'America/Vancouver', label: 'Canada — Pacific (Vancouver)' },
    { value: 'America/Mexico_City', label: 'Mexico — Mexico City' },
    { value: 'America/Bogota', label: 'Colombia — Bogota' },
    { value: 'America/Lima', label: 'Peru — Lima' },
    { value: 'America/Santiago', label: 'Chile — Santiago' },
    { value: 'America/Sao_Paulo', label: 'Brazil — São Paulo' },
    { value: 'America/Buenos_Aires', label: 'Argentina — Buenos Aires' },
    { value: 'Australia/Sydney', label: 'Australia — Sydney' },
    { value: 'Australia/Melbourne', label: 'Australia — Melbourne' },
    { value: 'Australia/Brisbane', label: 'Australia — Brisbane' },
    { value: 'Australia/Perth', label: 'Australia — Perth' },
    { value: 'Australia/Adelaide', label: 'Australia — Adelaide' },
    { value: 'Pacific/Auckland', label: 'New Zealand — Auckland' },
    { value: 'UTC', label: 'UTC' },
  ];

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function tzDisplayParts(iana) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: iana,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'shortOffset',
      }).formatToParts(new Date());
    } catch (e) {
      return [];
    }
  }

  function formatOffsetFromParts(parts) {
    var p = parts.find(function (x) {
      return x.type === 'timeZoneName';
    });
    if (!p) return '';
    return String(p.value).replace(/^GMT/i, 'UTC');
  }

  function formatClockFromParts(parts) {
    var hour = parts.find(function (x) {
      return x.type === 'hour';
    });
    var minute = parts.find(function (x) {
      return x.type === 'minute';
    });
    var dayPeriod = parts.find(function (x) {
      return x.type === 'dayPeriod';
    });
    if (!hour || !minute) return '';
    return hour.value + ':' + minute.value + (dayPeriod ? ' ' + dayPeriod.value : '');
  }

  /** e.g. Singapore · UTC+8 · 4:30 PM */
  function displayLabel(opt) {
    var parts = tzDisplayParts(opt.value);
    var offset = formatOffsetFromParts(parts);
    var clock = formatClockFromParts(parts);
    var out = opt.label;
    if (offset) out += ' · ' + offset;
    if (clock) out += ' · ' + clock;
    return out;
  }

  function labelForTimeZone(value) {
    var v = String(value || DEFAULT_TZ).trim() || DEFAULT_TZ;
    var found = OPTIONS.find(function (o) {
      return o.value === v;
    });
    if (found) return displayLabel(found);
    var parts = tzDisplayParts(v);
    var offset = formatOffsetFromParts(parts);
    var clock = formatClockFromParts(parts);
    if (offset && clock) return v + ' · ' + offset + ' · ' + clock;
    if (offset) return v + ' · ' + offset;
    return v;
  }

  function asSelectOptions() {
    return OPTIONS.map(function (opt) {
      return {
        value: opt.value,
        label: displayLabel(opt),
      };
    });
  }

  function fillSelect(select, selected) {
    if (!select) return;
    selected = String(selected || DEFAULT_TZ).trim() || DEFAULT_TZ;
    var known = false;
    var html = OPTIONS.map(function (opt) {
      var on = opt.value === selected;
      if (on) known = true;
      return (
        '<option value="' +
        escAttr(opt.value) +
        '"' +
        (on ? ' selected' : '') +
        '>' +
        escAttr(displayLabel(opt)) +
        '</option>'
      );
    }).join('');
    if (!known && selected) {
      html +=
        '<option value="' +
        escAttr(selected) +
        '" selected>' +
        escAttr(labelForTimeZone(selected)) +
        '</option>';
    }
    select.innerHTML = html;
  }

  function initSelects(root, selector) {
    root = root || document;
    selector = selector || 'select[data-timezone-select]';
    root.querySelectorAll(selector).forEach(function (sel) {
      fillSelect(sel, sel.getAttribute('data-selected') || sel.value || DEFAULT_TZ);
    });
  }

  global.ESTimezoneOptions = {
    DEFAULT: DEFAULT_TZ,
    list: OPTIONS,
    asSelectOptions: asSelectOptions,
    labelForTimeZone: labelForTimeZone,
    fillSelect: fillSelect,
    initSelects: initSelects,
  };
})(typeof window !== 'undefined' ? window : this);
