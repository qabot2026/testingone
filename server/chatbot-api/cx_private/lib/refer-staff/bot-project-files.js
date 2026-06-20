const fs = require('fs');
const path = require('path');
const botConfigFiles = require('./bot-config-files');
const clientPaths = require('./client-paths');

const PUBLIC_DIR = path.join(clientPaths.PROJECT_ROOT, 'cx_public');
const BOT_SETTINGS_DIR = clientPaths.botSettingsDir();
const PAGES_DIR = clientPaths.pagesDir();
const NAV_ASSET_V = '20260613b';

function toDemoSlug(name, botId) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'bot-' + String(botId || '').slice(-3);
}

function demoFileName(name, botId) {
  return toDemoSlug(name, botId) + '-demo.html';
}

function renderBotSettingsHtml(botId, botName) {
  const title = 'Bot settings — ' + botId + ' ' + botName;
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <meta name="robots" content="noindex, nofollow" />\n' +
    '  <title>' +
    title +
    '</title>\n' +
    '  <link rel="stylesheet" href="/bot-settings/bot-settings.css" />\n' +
    '</head>\n<body data-page="project">\n' +
    '  <div id="app"></div>\n' +
    "  <script>window.BOT_ID = '" +
    botId +
    "';</script>\n" +
    '  <script src="/bot-configs/bootstrap.js"></script>\n' +
    '  <script src="/bot-configs/load-chain.js"></script>\n' +
    '  <script>\n' +
    '    ESLoadScriptChain([\n' +
    "      '/company.config.js',\n" +
    "      '/dashboard/desk-auth.js',\n" +
    "      '/dashboard/dashboard-nav.js?v=" +
    NAV_ASSET_V +
    "',\n" +
    "      '/shared/timezone-options.js?v=20260621b',\n" +
    "      '/bot-settings/bot-settings.js'\n" +
    '    ]);\n' +
    '  </script>\n' +
    '</body>\n</html>\n'
  );
}

function renderDemoHtml(bot) {
  const name = bot.name || 'Chatbot';
  const event = bot.welcomeEventName
    ? String(bot.welcomeEventName).trim()
    : 'FRESH';
  const eventNote = bot.welcomeEventName
    ? '<code>' + event + '</code> event chalega.'
    : 'Home bot — <code>FRESH</code> event (default).';
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>' +
    name +
    ' — chat test</title>\n' +
    '  <style>\n' +
    '    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #333; }\n' +
    '  </style>\n' +
    '</head>\n<body>\n' +
    '  <h1>' +
    name +
    ' (test page)</h1>\n' +
    '  <p>Chat open karo — ' +
    eventNote +
    '</p>\n' +
    '  <script>\n' +
    '    window.ES_CONFIG = {\n' +
    (bot.welcomeEventName
      ? "      welcomeEventName: '" + event + "',\n"
      : '') +
    "      sitePreset: '" +
    bot.sitePreset +
    "',\n" +
    '    };\n' +
    '  </script>\n' +
    '  <script src="/embed.js" async></script>\n' +
    '</body>\n</html>\n'
  );
}

function writeFileAtomic_(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function createForBot(bot, preset) {
  const files = [];
  const botId = bot.id;
  const settingsPath = path.join(BOT_SETTINGS_DIR, botId + '.html');
  writeFileAtomic_(settingsPath, renderBotSettingsHtml(botId, bot.name));
  files.push('/bot-settings/' + botId + '.html');

  const demoName = demoFileName(bot.name, botId);
  const demoPath = path.join(PAGES_DIR, demoName);
  writeFileAtomic_(demoPath, renderDemoHtml(bot));
  files.push('/' + demoName);

  const configPath = botConfigFiles.createBotConfigFile(bot, preset);
  files.push(configPath);

  return {
    ok: true,
    files,
    demoPath: '/' + demoName,
    settingsPath: '/bot-settings/' + botId + '.html',
    configPath,
  };
}

function removeForBot(bot) {
  const removed = [];
  if (bot && bot.id) {
    const settingsPath = path.join(BOT_SETTINGS_DIR, bot.id + '.html');
    try {
      if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
      removed.push('/bot-settings/' + bot.id + '.html');
    } catch (err) {
      console.warn('[bot-project-files] unlink failed:', err.message);
    }
  }
  if (bot && bot.sitePreset) {
    const existingDemo = findDemoPathForBot_(bot);
    if (existingDemo) {
      try {
        fs.unlinkSync(existingDemo);
        removed.push('/' + path.basename(existingDemo));
      } catch (err) {
        console.warn('[bot-project-files] unlink failed:', err.message);
      }
    }
  }
  if (bot && bot.sitePreset) {
    removed.push(botConfigFiles.removeBotConfigFile(bot));
  }
  return { ok: true, removed };
}

function isGeneratedBotDemoPage_(content) {
  return (
    String(content || '').includes('(test page)</h1>') ||
    String(content || '').includes('Chat open karo')
  );
}

function findDemoPathForBot_(bot) {
  if (!bot || !bot.sitePreset || !fs.existsSync(PAGES_DIR)) return null;
  const needle = "sitePreset: '" + bot.sitePreset + "'";
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('-demo.html'));
  for (let i = 0; i < files.length; i += 1) {
    const filePath = path.join(PAGES_DIR, files[i]);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(needle) && isGeneratedBotDemoPage_(content)) return filePath;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Update bot-settings + demo page titles from bot-registry.json. */
function syncFromRegistry(bot) {
  if (!bot || !bot.id) return { ok: false, skipped: true };
  const settingsPath = path.join(BOT_SETTINGS_DIR, bot.id + '.html');
  writeFileAtomic_(settingsPath, renderBotSettingsHtml(bot.id, bot.name));

  const newDemoPath = path.join(PAGES_DIR, demoFileName(bot.name, bot.id));
  const existingDemo = findDemoPathForBot_(bot);
  if (existingDemo && path.resolve(existingDemo) !== path.resolve(newDemoPath)) {
    try {
      fs.unlinkSync(existingDemo);
    } catch (err) {
      console.warn('[bot-project-files] demo unlink failed:', err.message);
    }
  }
  writeFileAtomic_(newDemoPath, renderDemoHtml(bot));

  return {
    ok: true,
    settingsPath: '/bot-settings/' + bot.id + '.html',
    demoPath: '/' + demoFileName(bot.name, bot.id),
  };
}

module.exports = {
  NAV_ASSET_V,
  toDemoSlug,
  demoFileName,
  renderBotSettingsHtml,
  renderDemoHtml,
  createForBot,
  removeForBot,
  syncFromRegistry,
};
