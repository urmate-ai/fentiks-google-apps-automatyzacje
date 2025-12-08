const LEVELS = {
  None: 0,
  Error: 1,
  Warning: 2,
  Information: 3,
  Debug: 4,
};

const levelName = typeof LOG_LEVEL !== 'undefined' ? LOG_LEVEL : 'Information';
const currentLevel = LEVELS[levelName] !== undefined ? LEVELS[levelName] : LEVELS.Information;

function log(method, level, args) {
  if (currentLevel >= level) {
    console[method](...args);
  }
}

function sendSlack_(args) {
  try {
    const url = typeof SLACK_WEBHOOK_URL !== 'undefined'
      ? SLACK_WEBHOOK_URL
      : (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties
        ? PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL')
        : null);
    if (!url || !/^https?:\/\//.test(url)) return;
    const message = args
      .map((a) => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch (_) { return String(a); }
        }
        return String(a);
      })
      .join(' ');
    const payload = JSON.stringify({ text: message });
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload });
    } else if (typeof fetch !== 'undefined') {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
    }
  } catch (e) {
    // ignore errors when sending notifications
  }
}

const logger = {
  error: (...args) => {
    log('error', LEVELS.Error, args);
    sendSlack_(args);
  },
  warn: (...args) => log('warn', LEVELS.Warning, args),
  info: (...args) => log('log', LEVELS.Information, args),
  debug: (...args) => log('log', LEVELS.Debug, args),
  LEVELS,
};

if (typeof globalThis !== 'undefined') {
  globalThis.logger = logger;
}

if (typeof module !== 'undefined') {
  module.exports = logger;
}
