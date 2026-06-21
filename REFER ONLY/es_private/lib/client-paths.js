/**
 * Per-client files inside es_public/ + es_private/
 * - es_public/client-based/   → browser (company.config, bot-configs)
 * - es_private/client-based/data/ → server (bot-registry, site-presets)
 */

const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CLIENT_PUBLIC = path.join(PROJECT_ROOT, 'es_public', 'client-based');
const CLIENT_PRIVATE = path.join(__dirname, '..', 'client-based');

function dataDir() {
  return path.join(CLIENT_PRIVATE, 'data');
}

module.exports = {
  PROJECT_ROOT,
  CLIENT_PUBLIC,
  CLIENT_PRIVATE,
  companyConfigPath: () => path.join(CLIENT_PUBLIC, 'company.config.js'),
  dataDir,
  botConfigsDir: () => path.join(CLIENT_PUBLIC, 'bot-configs'),
  botSettingsDir: () => path.join(CLIENT_PUBLIC, 'bot-settings'),
  pagesDir: () => path.join(CLIENT_PUBLIC, 'pages'),
  registryPath: () => path.join(dataDir(), 'bot-registry.json'),
  sitePresetsPath: () => path.join(dataDir(), 'site-presets.json'),
  whatsappIntegrationSettingsPath: () =>
    path.join(dataDir(), 'whatsapp-integration.json'),
  socialIntegrationsPath: () => path.join(dataDir(), 'social-integrations.json'),
  branchesPath: () => path.join(dataDir(), 'branches.json'),
  appointmentSchedulePath: () => path.join(dataDir(), 'appointment-schedule.json'),
  phraseTranslationsPath: () => path.join(dataDir(), 'phrase-translations.json'),
  faqsPath: () => path.join(dataDir(), 'faqs.json'),
  qaProvisionPath: () => path.join(dataDir(), 'qa-provision.json'),
  emailIntegrationPath: () => path.join(dataDir(), 'email-integration.json'),
  emailTemplatesPath: () => path.join(dataDir(), 'email-templates.json'),
  leadNotificationsPath: () => path.join(dataDir(), 'lead-notifications.json'),
  crmIntegrationPath: () => path.join(dataDir(), 'crm-integration.json'),
  queryAnalyticsPath: () => path.join(dataDir(), 'query-analytics.jsonl'),
  integrationsDir: () => path.join(CLIENT_PRIVATE, 'integrations'),
  whatsappIntegrationPath: () =>
    path.join(CLIENT_PRIVATE, 'integrations', 'whatsapp.integration.js'),
  instagramIntegrationPath: () =>
    path.join(CLIENT_PRIVATE, 'integrations', 'instagram.integration.js'),
  facebookIntegrationPath: () =>
    path.join(CLIENT_PRIVATE, 'integrations', 'facebook.integration.js'),
};
