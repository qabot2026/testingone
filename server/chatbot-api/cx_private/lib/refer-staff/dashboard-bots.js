/**
 * Dashboard routing — bot IDs from data/bot-registry.json (5-digit public IDs).
 */

const sitePresetsStore = require('./site-presets-store');

const DEFAULT_BID = '10001';

/** Page slug → route metadata */
const PAGES = {
  home: {
    label: 'Home',
    botSpecific: false,
    resolvePath: (bid) => '/dashboard/' + (bid ? '?bid=' + bid : ''),
  },
  'uc-conversations': {
    label: 'Insights',
    botSpecific: true,
    aliases: ['aichatanalytics'],
    resolvePath: (bid) => bidPath(bid, 'uc-conversations'),
  },
  queryanalytics: {
    label: 'Customer Questions',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'queryanalytics'),
  },
  notifications: {
    label: 'Email Notifications',
    botSpecific: true,
    resolvePath: (bid) =>
      '/dashboard/notifications.html?bid=' + encodeURIComponent(bid || DEFAULT_BID),
  },
  'email-templates': {
    label: 'Email Templates',
    botSpecific: true,
    resolvePath: (bid) =>
      '/super/email-templates.html?bid=' + encodeURIComponent(bid || DEFAULT_BID),
  },
  faqs: {
    label: 'Add FAQs',
    botSpecific: true,
    resolvePath: (bid) =>
      '/dashboard/faqs.html?bid=' + encodeURIComponent(bid || DEFAULT_BID),
  },
  'agenttraining': {
    label: 'AI Agent training',
    botSpecific: false,
    aliases: ['qa-provision'],
    resolvePath: () => '/dashboard/agenttraining.html',
  },
  assets: {
    label: 'Assets',
    botSpecific: true,
    resolvePath: (bid) =>
      '/super/assets.html?bid=' + encodeURIComponent(bid || DEFAULT_BID),
  },
  power: {
    label: 'Power',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'power'),
  },
  integration: {
    label: 'Integration',
    botSpecific: true,
    aliases: ['supersetting'],
    resolvePath: (bid) => bidPath(bid, 'channels-integration'),
  },
  'channels-integration': {
    label: 'Channels Integration',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'channels-integration'),
  },
  'crm-integration': {
    label: 'CRM Integration',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'crm-integration'),
  },
  'uiux-setting': {
    label: 'Appearance',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'uiux-setting'),
  },
  uiux: {
    label: 'Additional features',
    botSpecific: true,
    resolvePath: (bid) => bidPath(bid, 'uiux'),
  },
  'ua-conversations': {
    label: 'Agent Conversation',
    botSpecific: false,
    aliases: ['agentanalytics'],
    resolvePath: () => '/ua-conversations',
  },
  'live-agent': {
    label: 'Live Chat Inbox',
    botSpecific: false,
    resolvePath: () => '/live-agent/',
  },
  appointments: {
    label: 'Appointments',
    botSpecific: false,
    resolvePath: () => '/dashboard/appointments.html',
  },
  'live-agent-settings': {
    label: 'Live Chat Setup',
    botSpecific: false,
    slug: 'live-agent/settings',
    resolvePath: () => '/live-agent/settings',
  },
  documents: {
    label: 'Customer Uploads',
    botSpecific: false,
    resolvePath: () => '/dashboard/documents.html',
  },
  actions: {
    label: 'Actions',
    botSpecific: false,
    resolvePath: () => '/super/actions.html',
  },
  audits: {
    label: 'Audits',
    botSpecific: true,
    resolvePath: (bid) =>
      '/super/audits.html?bid=' + encodeURIComponent(bid || DEFAULT_BID),
  },
  'manage-access': {
    label: 'Access permissions',
    botSpecific: false,
    resolvePath: () => '/dashboard/manage-access.html',
  },
  'test-links': {
    label: 'Test Links',
    botSpecific: false,
    resolvePath: () => '/dashboard/test-links.html',
  },
  'email-integration': {
    label: 'Email Integration',
    botSpecific: true,
    aliases: ['emailintegration'],
    resolvePath: (bid) =>
      '/super/email-templates.html?bid=' +
      encodeURIComponent(bid || DEFAULT_BID) +
      '#email-integration',
  },
};

function bidPath(bid, slug) {
  return '/bid=' + encodeURIComponent(bid) + '/' + slug;
}

function listBots() {
  return sitePresetsStore.listProjects();
}

function resolveBid(bid) {
  return sitePresetsStore.resolveProject(bid);
}

function defaultBid() {
  return DEFAULT_BID;
}

function normalizePageSlug(slug) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/\.html$/, '');
  if (PAGES[s]) return s;
  for (const [key, page] of Object.entries(PAGES)) {
    if (page.slug === s) return key;
    if (page.aliases && page.aliases.includes(s)) return key;
  }
  return null;
}

function resolvePageTarget(slug, bid) {
  const pageKey = normalizePageSlug(slug);
  if (!pageKey) return null;
  const page = PAGES[pageKey];
  const bot = resolveBid(bid);
  if (page.botSpecific && !bot) return null;

  if (pageKey === 'uiux-setting') {
    if (!bot) return null;
    return {
      pageKey,
      redirect: '/bot-settings/' + bot.id + '.html',
    };
  }

  if (pageKey === 'uiux') {
    return {
      pageKey,
      redirect: '/super/uiux.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'uc-conversations') {
    return {
      pageKey,
      redirect: bot ? '/dashboard/uc-conversations?bid=' + bot.id : '/dashboard/uc-conversations',
    };
  }

  if (pageKey === 'ua-conversations') {
    return {
      pageKey,
      redirect: bot ? '/dashboard/ua-conversations?bid=' + bot.id : '/dashboard/ua-conversations',
    };
  }

  if (pageKey === 'queryanalytics') {
    return {
      pageKey,
      redirect: '/dashboard/query-analytics.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'notifications') {
    return {
      pageKey,
      redirect: '/dashboard/notifications.html?bid=' + (bot ? bot.id : DEFAULT_BID),
    };
  }

  if (pageKey === 'email-templates') {
    return {
      pageKey,
      redirect: '/super/email-templates.html?bid=' + (bot ? bot.id : DEFAULT_BID),
    };
  }

  if (pageKey === 'faqs') {
    return {
      pageKey,
      redirect: '/dashboard/faqs.html?bid=' + (bot ? bot.id : DEFAULT_BID),
    };
  }

  if (pageKey === 'agenttraining' || pageKey === 'qa-provision') {
    return {
      pageKey: 'agenttraining',
      redirect: '/dashboard/agenttraining.html',
    };
  }

  if (pageKey === 'assets') {
    return {
      pageKey,
      redirect: '/super/assets.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'power') {
    return {
      pageKey,
      redirect: '/super/power.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'integration' || pageKey === 'supersetting') {
    return {
      pageKey: 'channels-integration',
      redirect: '/super/channels-integration.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'channels-integration') {
    return {
      pageKey,
      redirect: '/super/channels-integration.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'crm-integration') {
    return {
      pageKey,
      redirect: '/super/crm-integration.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'audits') {
    return {
      pageKey,
      redirect: '/super/audits.html' + (bot ? '?bid=' + bot.id : ''),
    };
  }

  if (pageKey === 'actions') {
    return {
      pageKey,
      redirect: '/super/actions.html',
    };
  }

  if (pageKey === 'email-integration') {
    return {
      pageKey: 'email-templates',
      redirect:
        '/super/email-templates.html?bid=' +
        (bot ? bot.id : DEFAULT_BID) +
        '#email-integration',
    };
  }

  if (pageKey === 'home') {
    return { pageKey, redirect: '/dashboard/' + (bot ? '?bid=' + bot.id : '') };
  }

  const path = page.resolvePath(bot ? bot.id : null);
  return { pageKey, redirect: path };
}

function navSections(currentBid) {
  const bid = resolveBid(currentBid) ? normalizeBotId(currentBid) : defaultBid();
  const bot = resolveBid(bid);
  const botPages = [
    'uc-conversations',
    'queryanalytics',
    'notifications',
    'email-templates',
    'faqs',
    'uiux-setting',
    'uiux',
    'appointments',
    'documents',
    'power',
    'assets',
    'channels-integration',
    'crm-integration',
    'audits',
    'manage-access',
  ];
  const orgPages = [
    'agenttraining',
    'live-agent',
    'ua-conversations',
    'live-agent-settings',
    'test-links',
    'actions',
  ];
  const commonPages = [...botPages, ...orgPages];
  const chatbotPages = [
    'uc-conversations',
    'queryanalytics',
    'notifications',
    'email-templates',
    'faqs',
    'uiux-setting',
    'uiux',
    'appointments',
    'documents',
    'agenttraining',
    'power',
    'assets',
    'channels-integration',
    'crm-integration',
    'audits',
  ];
  const agentPages = ['live-agent', 'ua-conversations', 'live-agent-settings'];
  const adminPages = [
    'test-links',
    'manage-access',
    'power',
    'assets',
    'channels-integration',
    'crm-integration',
    'actions',
    'audits',
    'email-integration',
  ];
  return {
    bid,
    bot,
    bots: listBots(),
    botSection: botPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    orgSection: orgPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    commonSection: commonPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    chatbotSection: chatbotPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    agentSection: agentPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    adminSection: adminPages.map((key) => ({
      key,
      label: PAGES[key].label,
      href: PAGES[key].resolvePath(bid),
    })),
    homeHref: PAGES.home.resolvePath(bid),
  };
}

function normalizeBotId(bid) {
  return sitePresetsStore.normalizeBotId(bid);
}

module.exports = {
  DEFAULT_BID,
  PAGES,
  bidPath,
  listBots,
  resolveBid,
  defaultBid,
  normalizeBotId,
  normalizePageSlug,
  resolvePageTarget,
  navSections,
};
