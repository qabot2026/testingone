(function (global) {
  'use strict';

  var NAV_ASSET_V = '20260626c';

  function ensureBoot() {
    var root = document.documentElement;
    if (root.getAttribute('data-dash-boot') === '1') return;
    root.setAttribute('data-dash-boot', '1');
    root.classList.add('dash-mount-pending');

    if (!document.getElementById('dash-critical-css')) {
      var crit = document.createElement('style');
      crit.id = 'dash-critical-css';
      crit.textContent =
        'html.dash-mount-pending,html.dash-mount-pending body{overflow:hidden!important}' +
        'html.dash-mount-pending .dash-page-content,html.dash-mount-pending #app[data-dash-pre-mount]{visibility:hidden!important;opacity:0!important}' +
        '.dash-nav-ic,svg.dash-nav-ic,.dash-nav-ic--img{width:18px!important;height:18px!important;max-width:18px!important;max-height:18px!important;object-fit:contain!important}' +
        '.dash-icon-badge svg{width:18px!important;height:18px!important;max-width:18px!important;max-height:18px!important}' +
        '#dash-shell-loader{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#f1f5f9}' +
        'html.dash-ready #dash-shell-loader{display:none!important}';
      document.head.appendChild(crit);
    }

    function insertLoader() {
      if (document.getElementById('dash-shell-loader')) return;
      var loader = document.createElement('div');
      loader.id = 'dash-shell-loader';
      loader.className = 'dash-shell-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-live', 'polite');
      loader.setAttribute('aria-label', 'Loading');
      loader.innerHTML =
        '<div class="dash-loader"><div class="dash-loader__spinner" aria-hidden="true"></div><span>Loading</span></div>';
      (document.body || document.documentElement).appendChild(loader);
    }

    if (document.body) insertLoader();
    else document.addEventListener('DOMContentLoaded', insertLoader);
  }

  ensureBoot();
  var DEFAULT_BOT_ID = '10001';
  var BOTS = [
    { id: '10001', name: 'Receptionist' },
    { id: '10002', name: 'Green Valley' },
    { id: '10003', name: 'Lake View' },
  ];
  var botsLoaded = false;
  var botsLoadPromise = null;

  function loadBots() {
    if (botsLoaded) return Promise.resolve(BOTS);
    if (botsLoadPromise) return botsLoadPromise;
    botsLoadPromise = fetch('/api/dashboard/bots', { credentials: 'same-origin' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.bots && data.bots.length) {
          BOTS.length = 0;
          data.bots.forEach(function (b) {
            BOTS.push({ id: b.id, name: b.name });
          });
          if (data.defaultBid) DEFAULT_BOT_ID = data.defaultBid;
        }
        botsLoaded = true;
        return BOTS;
      })
      .catch(function () {
        botsLoaded = true;
        return BOTS;
      });
    return botsLoadPromise;
  }

  function refreshBots() {
    botsLoaded = false;
    botsLoadPromise = null;
    return loadBots();
  }

  function whenReady(fn) {
    return loadBots().then(function () {
      if (typeof fn === 'function') return fn();
    });
  }

  var BOT_PAGE_KEYS = [
    'uc-conversations',
    'queryanalytics',
    'notifications',
    'email-templates',
    'uiux-setting',
    'uiux',
    'power',
    'assets',
    'channels-integration',
    'crm-integration',
    'audits',
    'faqs',
  ];

  /** Org-wide pages — no project selector in the top bar */
  var ORG_PAGE_KEYS = [
    'live-agent',
    'ua-conversations',
    'live-agent/settings',
    'agenttraining',
    'test-links',
    'appointments',
    'documents',
    'actions',
    'manage-access',
  ];

  var LAST_BOT_KEY = 'dash-last-bot-id';

  /** Sidebar order — sections separated by dividers */
  var NAV_SECTIONS = [
    {
      items: [{ key: 'home', label: 'Home', icon: 'home' }],
    },
    {
      items: [
        { key: 'uc-conversations', label: 'Insights', icon: 'insights' },
        { key: 'queryanalytics', label: 'Customer Questions', icon: 'search' },
        { key: 'notifications', label: 'Email Notifications', icon: 'chart' },
        { key: 'faqs', label: 'Add FAQs', icon: 'help' },
        { key: 'uiux-setting', label: 'Appearance', icon: 'appearance' },
        { key: 'appointments', label: 'Appointments', icon: 'calendar' },
        { key: 'documents', label: 'Customer Uploads', icon: 'file' },
      ],
    },
    {
      items: [{ key: 'agenttraining', label: 'AI Agent training', icon: 'file' }],
    },
    {
      items: [
        { key: 'live-agent', label: 'Live Chat Inbox', icon: 'headset' },
        { key: 'ua-conversations', label: 'Agent Conversation', icon: 'users' },
        { key: 'live-agent/settings', label: 'Live Chat Setup', icon: 'cog' },
      ],
    },
    {
      items: [
        { key: 'test-links', label: 'Test Links', icon: 'search' },
        { key: 'manage-access', label: 'Access permissions', icon: 'lock' },
      ],
    },
    {
      items: [
        { key: 'power', label: 'Power', icon: 'cog' },
        { key: 'uiux', label: 'Additional features', icon: 'palette' },
        { key: 'assets', label: 'Assets', icon: 'brush' },
        { key: 'channels-integration', label: 'Channels Integration', icon: 'users' },
        { key: 'crm-integration', label: 'CRM Integration', icon: 'cog' },
        { key: 'email-templates', label: 'Email Templates', icon: 'file' },
        { key: 'actions', label: 'Actions', icon: 'chart' },
        { key: 'audits', label: 'Audits', icon: 'file' },
      ],
    },
  ];

  var ICONS = {
    home:
      '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    chart:
      '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    insights:
      '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    brush:
      '<path d="m15 20-4-4 6.5-6.5a4.2 4.2 0 1 1 6 6L11 20"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    appearance:
      '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>' +
      '<path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
    search:
      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    palette:
      '<path d="M12 22a1 1 0 0 1-1-1v-2.05a4 4 0 0 1-2.144-1.88"/><path d="M12 3v2.05a4 4 0 0 1 2.144 1.88"/><path d="M3 12h2.05a4 4 0 0 1 1.88 2.144"/><path d="M21 12h-2.05a4 4 0 0 1-1.88-2.144"/><circle cx="12" cy="12" r="2.5"/>',
    shield:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    headset:
      '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3z"/><path d="M21 11h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3z"/><path d="M4 11V9a8 8 0 0 1 16 0v2"/>',
    calendar:
      '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    cog:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    file:
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13h4"/><path d="M10 17h7"/>',
    lock:
      '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/>',
    help:
      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  };

  function getIconForKey(key) {
    var i;
    var j;
    for (i = 0; i < NAV_SECTIONS.length; i++) {
      for (j = 0; j < NAV_SECTIONS[i].items.length; j++) {
        if (NAV_SECTIONS[i].items[j].key === key) {
          return NAV_SECTIONS[i].items[j].icon;
        }
      }
    }
    return 'home';
  }

  function normalizeBotId(id) {
    var s = String(id || '').trim();
    if (s === '001') return '10001';
    if (s === '002') return '10002';
    if (s === '003') return '10003';
    return s;
  }

  function defaultBotId() {
    return (BOTS[0] && BOTS[0].id) || DEFAULT_BOT_ID;
  }

  function getStoredBotId() {
    try {
      var id = normalizeBotId(sessionStorage.getItem(LAST_BOT_KEY) || '');
      return resolveBot(id) ? id : '';
    } catch (e) {
      return '';
    }
  }

  function setStoredBotId(botId) {
    try {
      sessionStorage.setItem(LAST_BOT_KEY, normalizeBotId(botId));
    } catch (e) {
      /* ignore */
    }
  }

  function clearStoredBotId() {
    try {
      sessionStorage.removeItem(LAST_BOT_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function effectiveBotId(fallbackBotId) {
    var stored = getStoredBotId();
    if (stored) return stored;
    return normalizeBotId(fallbackBotId || defaultBotId());
  }

  /** Bot used when leaving an org page for a bot-level nav item */
  function resolveNavBotId() {
    return getStoredBotId() || defaultBotId();
  }

  function isOrgLevelPage(active) {
    return ORG_PAGE_KEYS.indexOf(active) >= 0;
  }

  function requiresProjectSelection(key) {
    if (!key) return false;
    if (isOrgLevelPage(key)) return false;
    return true;
  }

  function shouldShowProjectSelect(activeKey) {
    return !isOrgLevelPage(activeKey);
  }

  function getBid() {
    var pathMatch = location.pathname.match(/\/bot-settings\/(\d{5})\.html/);
    if (pathMatch) return pathMatch[1];
    pathMatch = location.pathname.match(/\/dashboard\/faqs\/bid=(\d{5})\/?$/);
    if (pathMatch) return pathMatch[1];
    if (/\/dashboard\/faqs\.html$/i.test(location.pathname)) {
      var faqBid = new URLSearchParams(location.search).get('bid');
      if (faqBid && resolveBot(faqBid)) return normalizeBotId(faqBid);
    }
    pathMatch = location.pathname.match(/\/bid[=/](\d{5})\//);
    if (pathMatch) return pathMatch[1];
    var q = new URLSearchParams(location.search).get('bid');
    if (q && resolveBot(q)) return normalizeBotId(q);
    return DEFAULT_BOT_ID;
  }

  function resolveBot(botId) {
    var id = normalizeBotId(botId);
    return BOTS.find(function (b) {
      return b.id === id;
    });
  }

  function bidPath(botId, slug) {
    return '/bid=' + encodeURIComponent(normalizeBotId(botId)) + '/' + slug;
  }

  function faqPath(botId) {
    return '/dashboard/faqs.html?bid=' + encodeURIComponent(normalizeBotId(botId));
  }

  function commonPath(slug) {
    if (slug === 'live-agent/settings') return '/live-agent/settings';
    if (slug === 'appointments') return '/dashboard/appointments.html';
    if (slug === 'agenttraining' || slug === 'qa-provision') return '/dashboard/agenttraining.html';
    if (slug === 'power') return '/super/power.html';
    if (slug === 'uiux') return '/super/uiux.html';
    if (slug === 'assets') return '/super/assets.html';
    if (slug === 'integration' || slug === 'supersetting') return '/super/channels-integration.html';
    if (slug === 'channels-integration') return '/super/channels-integration.html';
    if (slug === 'crm-integration') return '/super/crm-integration.html';
    if (slug === 'email-templates') return '/super/email-templates.html';
    if (slug === 'test-links') return '/dashboard/test-links.html';
    if (slug === 'faqs') return faqPath(DEFAULT_BOT_ID);
    if (slug === 'documents') return '/dashboard/documents.html';
    if (slug === 'actions') return '/super/actions.html';
    if (slug === 'audits') return '/super/audits.html';
    if (slug === 'manage-access') return '/dashboard/manage-access.html';
    if (slug === 'ua-conversations') return '/ua-conversations';
    if (slug === 'live-agent') return '/live-agent/';
    return '/dashboard/';
  }

  function navHref(key, botId) {
    botId = normalizeBotId(botId);
    if (key === 'home') return '/dashboard/?bid=' + botId;
    if (key === 'faqs') return faqPath(botId);
    if (BOT_PAGE_KEYS.indexOf(key) >= 0) {
      return bidPath(botId, key);
    }
    var path = commonPath(key);
    if (ORG_PAGE_KEYS.indexOf(key) >= 0) {
      return path;
    }
    return path;
  }

  function detectActiveKey() {
    var p = location.pathname;
    if (p.indexOf('/dashboard/test-links') >= 0) return 'test-links';
    if (p.indexOf('/dashboard/manage-access') >= 0) return 'manage-access';
    if (p.indexOf('/super/uiux') >= 0) return 'uiux';
    if (p.indexOf('/super/power') >= 0) return 'power';
    if (p.indexOf('/super/assets') >= 0) return 'assets';
    if (p.indexOf('/super/channels-integration') >= 0) return 'channels-integration';
    if (p.indexOf('/super/crm-integration') >= 0) return 'crm-integration';
    if (p.indexOf('/super/email-templates') >= 0) return 'email-templates';
    if (p.indexOf('/dashboard/notifications') >= 0) return 'notifications';
    if (p.indexOf('/super/actions') >= 0) return 'actions';
    if (p.indexOf('/super/audits') >= 0) return 'audits';
    if (p.indexOf('/dashboard/audits') >= 0) return 'audits';
    if (p.indexOf('/dashboard/actions') >= 0) return 'actions';
    if (p.indexOf('/dashboard/supersetting') >= 0) return 'channels-integration';
    if (p.indexOf('/dashboard/faqs') >= 0) return 'faqs';
    if (p.indexOf('/dashboard/agenttraining') >= 0) return 'agenttraining';
    if (p.indexOf('/dashboard/qa-provision') >= 0) return 'agenttraining';
    if (p.indexOf('/dashboard/query-analytics') >= 0) return 'queryanalytics';
    if (p.indexOf('/dashboard/documents') >= 0) return 'documents';
    if (p.indexOf('/dashboard/appointments') >= 0) return 'appointments';
    if (p.indexOf('/bot-settings/') >= 0) return 'uiux-setting';
    if (p.indexOf('/uc-conversations') >= 0) return 'uc-conversations';
    if (p.indexOf('/ua-conversations') >= 0) return 'ua-conversations';
    if (p.indexOf('/live-agent/settings') >= 0) return 'live-agent/settings';
    if (p.indexOf('/live-agent') >= 0) return 'live-agent';
    if (p === '/dashboard/' || p === '/dashboard' || p.indexOf('/dashboard/index') >= 0) {
      return 'home';
    }
    return '';
  }

  function isBotSpecificPage(active) {
    return BOT_PAGE_KEYS.indexOf(active) >= 0 || active === 'home';
  }

  function onBotChange(botId) {
    var active = detectActiveKey();
    botId = normalizeBotId(botId);
    setStoredBotId(botId);

    if (!active || active === 'home') {
      global.location.href = '/dashboard/?bid=' + encodeURIComponent(botId);
      return;
    }
    if (isBotSpecificPage(active)) {
      global.location.href = navHref(active, botId);
      return;
    }
    var url = new URL(global.location.href);
    url.searchParams.set('bid', botId);
    global.location.href = url.pathname + url.search + url.hash;
  }

  function navIcon(name) {
    var paths = ICONS[name] || ICONS.home;
    var stroke = name === 'appearance' ? '2.25' : '1.5';
    var cls = 'dash-nav-ic' + (name === 'appearance' ? ' dash-nav-ic--appearance' : '');
    return (
      '<svg class="' +
      cls +
      '" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      stroke +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      '</svg>'
    );
  }

  function iconBadge(name, extraClass) {
    return (
      '<span class="dash-icon-badge dash-icon-badge--' +
      name +
      (extraClass ? ' ' + extraClass : '') +
      '">' +
      navIcon(name) +
      '</span>'
    );
  }

  function botSelectHtml(selectValue) {
    selectValue = String(selectValue || '');
    return BOTS.map(function (b) {
      return (
        '<option value="' +
        b.id +
        '"' +
        (selectValue === b.id ? ' selected' : '') +
        '>' +
        b.name +
        ' (Bot ID ' +
        b.id +
        ')</option>'
      );
    }).join('');
  }

  function projectSelectValue(activeKey, botId) {
    return normalizeBotId(botId);
  }

  function isMobileNav() {
    try {
      return window.matchMedia('(max-width: 700px)').matches;
    } catch (e) {
      return false;
    }
  }

  function renderNav(activeKey, botId) {
    botId = effectiveBotId(botId);

    function navRow(key, label, iconName) {
      var href = navHref(key, botId);
      var cls = 'dash-nav-row' + (activeKey === key ? ' is-active' : '');
      return (
        '<a class="' +
        cls +
        '" href="' +
        href +
        '" data-nav-key="' +
        key +
        '" title="' +
        label +
        '" aria-label="' +
        label +
        '">' +
        '<span class="dash-nav-row__icon">' +
        iconBadge(iconName) +
        '</span>' +
        '<span class="dash-nav-row__label">' +
        label +
        '</span></a>'
      );
    }

    var navHtml = '';
    NAV_SECTIONS.forEach(function (section, index) {
      if (index > 0) {
        navHtml += '<div class="dash-nav-sep" aria-hidden="true"></div>';
      }
      section.items.forEach(function (item) {
        navHtml += navRow(item.key, item.label, item.icon);
      });
    });

    return (
      '<div class="dash-sidebar-backdrop" aria-hidden="true"></div>' +
      '<aside class="dash-sidebar" id="dash-sidebar" aria-label="Dashboard navigation">' +
      '<div class="dash-sidebar__inner">' +
      '<nav class="dash-nav-list" id="dash-sidebar-nav" aria-label="Main navigation">' +
      navHtml +
      '</nav>' +
      '</div>' +
      '</aside>'
    );
  }

  function renderTopbar(title, subtitle, activeKey, botId) {
    var selectValue = projectSelectValue(activeKey, botId);
    var projectTools = shouldShowProjectSelect(activeKey)
      ? '<div class="dash-topbar__tools">' +
        '<label class="dash-topbar__bot-label" for="dash-bot-select">Project</label>' +
        '<select class="dash-bot-select" id="dash-bot-select" aria-label="Select bot project">' +
        botSelectHtml(selectValue) +
        '</select>' +
        '</div>'
      : '';
    return (
      '<header class="dash-topbar">' +
      '<div class="dash-topbar__lead">' +
      '<button type="button" class="dash-nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="dash-sidebar-nav">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>' +
      '</svg></button>' +
      '<div class="dash-topbar__titles">' +
      '<h2>' +
      title +
      '</h2>' +
      (subtitle ? '<p>' + subtitle + '</p>' : '') +
      '</div>' +
      '</div>' +
      projectTools +
      '</header>'
    );
  }

  function linkAssets() {
    if (!document.querySelector('link[data-dash-font]')) {
      var font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href =
        'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
      font.setAttribute('data-dash-font', '1');
      document.head.appendChild(font);
    }
    if (!document.querySelector('link[data-dash-nav-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/dashboard/dashboard-nav.css?v=' + NAV_ASSET_V;
      link.setAttribute('data-dash-nav-css', '1');
      document.head.appendChild(link);
    }
  }

  function findPageContent(selector) {
    if (selector) {
      var picked = document.querySelector(selector);
      if (picked) return picked;
    }
    var el = document.querySelector('.dash-page-content');
    if (el) return el;
    var selectors = [
      '.bot-settings-dash-content',
      '.dash-app',
      '.docs-app',
      '.appt-app',
      '.qa-app',
      '#la-dash-shell-root',
      '#la-settings-shell-root',
      'div.app',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var node = document.querySelector(selectors[i]);
      if (node && !node.closest('.dash-shell')) return node;
    }
    return null;
  }

  function preparePageContent(selector) {
    var content = findPageContent(selector);
    if (!content) return null;
    content.classList.add('dash-page-content');
    if (!content.style.display) content.style.display = 'none';
    return content;
  }

  function bindNavClicks(shell) {
    var nav = shell ? shell.querySelector('.dash-nav-list') : document.querySelector('.dash-nav-list');
    if (!nav || nav.getAttribute('data-nav-bound') === '1') return;
    nav.setAttribute('data-nav-bound', '1');
    nav.addEventListener('click', function (ev) {
      var link = ev.target && ev.target.closest ? ev.target.closest('a.dash-nav-row') : null;
      if (!link) return;
      var key = link.getAttribute('data-nav-key') || '';
      if (!requiresProjectSelection(key)) return;
      var active = detectActiveKey();
      if (!isOrgLevelPage(active)) return;
      ev.preventDefault();
      global.location.href = navHref(key, resolveNavBotId());
    });
  }

  function bindBotSelect(shell) {
    var select = shell
      ? shell.querySelector('#dash-bot-select')
      : document.getElementById('dash-bot-select');
    if (!select || select.getAttribute('data-bound') === '1') return;
    select.setAttribute('data-bound', '1');
    select.addEventListener('change', function () {
      onBotChange(select.value);
    });
  }

  function bindSidebarExpand(shell) {
    var sidebar = shell ? shell.querySelector('.dash-sidebar') : document.querySelector('.dash-sidebar');
    if (!sidebar || sidebar.getAttribute('data-expand-bound') === '1') return;
    sidebar.setAttribute('data-expand-bound', '1');

    function setOpen(open) {
      if (isMobileNav()) return;
      sidebar.classList.toggle('is-expanded', open);
    }

    sidebar.addEventListener('mouseenter', function () {
      setOpen(true);
    });
    sidebar.addEventListener('mouseleave', function () {
      setOpen(false);
    });
    sidebar.addEventListener('focusin', function () {
      setOpen(true);
    });
    sidebar.addEventListener('focusout', function (ev) {
      if (!sidebar.contains(ev.relatedTarget)) setOpen(false);
    });
  }

  function bindMobileNav(shell) {
    if (!shell) return;
    var toggle = shell.querySelector('.dash-nav-toggle');
    var backdrop = shell.querySelector('.dash-sidebar-backdrop');
    var sidebar = shell.querySelector('.dash-sidebar');
    if (!toggle || !sidebar || toggle.getAttribute('data-mobile-bound') === '1') return;
    toggle.setAttribute('data-mobile-bound', '1');

    function setOpen(open) {
      if (!isMobileNav()) {
        shell.classList.remove('is-mobile-nav-open');
        sidebar.classList.remove('is-mobile-open');
        document.body.classList.remove('dash-mobile-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
        return;
      }
      shell.classList.toggle('is-mobile-nav-open', open);
      sidebar.classList.toggle('is-mobile-open', open);
      sidebar.classList.toggle('is-expanded', open);
      document.body.classList.toggle('dash-mobile-nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    function closeMenu() {
      setOpen(false);
    }

    toggle.addEventListener('click', function () {
      if (!isMobileNav()) return;
      setOpen(!shell.classList.contains('is-mobile-nav-open'));
    });

    if (backdrop) {
      backdrop.addEventListener('click', closeMenu);
    }

    var nav = shell.querySelector('.dash-nav-list');
    if (nav) {
      nav.addEventListener('click', function (ev) {
        if (!isMobileNav()) return;
        var link = ev.target && ev.target.closest ? ev.target.closest('a.dash-nav-row') : null;
        if (link) closeMenu();
      });
    }

    window.addEventListener('resize', function () {
      if (!isMobileNav()) closeMenu();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeMenu();
    });
  }

  function finishMount() {
    var root = document.documentElement;
    root.classList.remove('dash-mount-pending');
    root.classList.add('dash-ready');
    var app = document.getElementById('app');
    if (app) app.removeAttribute('data-dash-pre-mount');
  }

  function mount(opts) {
    opts = opts || {};
    ensureBoot();
    if (!botsLoaded) {
      loadBots().then(function () {
        mount(opts);
      });
      return false;
    }
    if (document.querySelector('.dash-shell')) {
      bindBotSelect(document.querySelector('.dash-shell'));
      bindSidebarExpand(document.querySelector('.dash-shell'));
      bindMobileNav(document.querySelector('.dash-shell'));
      bindNavClicks(document.querySelector('.dash-shell'));
      finishMount();
      return true;
    }

    var botId = opts.bid || getBid();
    var activeKey = opts.active || detectActiveKey();
    var title = opts.title || 'Dashboard';
    var subtitle = opts.subtitle || '';

    var content = preparePageContent(opts.contentSelector);
    if (!content) return false;

    var shell = document.createElement('div');
    shell.className = 'dash-shell';
    shell.innerHTML =
      renderNav(activeKey, botId) +
      '<div class="dash-main-wrap">' +
      renderTopbar(title, subtitle, activeKey, botId) +
      '<div class="dash-main" id="dash-main-slot"></div>' +
      '</div>';

    var slot = shell.querySelector('#dash-main-slot');
    slot.appendChild(content);
    content.classList.add('dash-mounted');
    content.style.display = '';
    content.style.visibility = 'visible';
    content.style.opacity = '1';

    document.body.classList.add('dash-has-shell');
    document.body.insertBefore(shell, document.body.firstChild);
    bindBotSelect(shell);
    bindSidebarExpand(shell);
    bindMobileNav(shell);
    bindNavClicks(shell);
    finishMount();
    return true;
  }

  function mountPage(opts) {
    ensureBoot();
    linkAssets();
    return whenReady(function () {
      return mount(opts || {});
    });
  }

  function updateTopbar(title, subtitle) {
    var h2 = document.querySelector('.dash-topbar h2');
    var p = document.querySelector('.dash-topbar p');
    if (h2 && title) h2.textContent = title;
    if (p && subtitle !== undefined) p.textContent = subtitle;
  }

  global.DashboardNav = {
    ensureBoot: ensureBoot,
    getBid: getBid,
    bidPath: bidPath,
    navHref: navHref,
    mount: mount,
    mountPage: mountPage,
    updateTopbar: updateTopbar,
    onBotChange: onBotChange,
    detectActiveKey: detectActiveKey,
    isOrgLevelPage: isOrgLevelPage,
    requiresProjectSelection: requiresProjectSelection,
    getIconForKey: getIconForKey,
    iconBadge: iconBadge,
    navIcon: navIcon,
    BOTS: BOTS,
    loadBots: loadBots,
    refreshBots: refreshBots,
    whenReady: whenReady,
    normalizeBotId: normalizeBotId,
  };
})(typeof window !== 'undefined' ? window : this);
