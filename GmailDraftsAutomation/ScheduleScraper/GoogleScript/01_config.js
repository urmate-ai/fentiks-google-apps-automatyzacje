/**
 * Configuration for the Fentiks schedule scraper.
 */
const scriptProperties =
  typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties
    ? PropertiesService.getScriptProperties()
    : null;

const CONFIG_KEYS = {
  TARGET_FOLDER_ID: 'SCHEDULE_SCRAPER_TARGET_FOLDER_ID',
  SCHEDULE_URL: 'SCHEDULE_SCRAPER_URL',
  LOG_LEVEL: 'SCHEDULE_SCRAPER_LOG_LEVEL',
  FILE_FORMAT: 'SCHEDULE_SCRAPER_FILE_FORMAT',
};

const DEFAULTS = {
  SCHEDULE_URL: 'https://fentiks.pl/terminarz-szkolen-i-egzaminow/',
  LOG_LEVEL: 'Information',
  FILE_FORMAT: 'json', // json or csv
};

function getRawProperty_(key) {
  if (!scriptProperties || typeof scriptProperties.getProperty !== 'function') {
    return null;
  }
  try {
    return scriptProperties.getProperty(key);
  } catch (e) {
    return null;
  }
}

function getConfigString_(key, defaultValue) {
  const value = getRawProperty_(key);
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const trimmed = String(value).trim();
  return trimmed === '' ? defaultValue : trimmed;
}

const TARGET_FOLDER_ID = getConfigString_(CONFIG_KEYS.TARGET_FOLDER_ID, '');
const SCHEDULE_URL = getConfigString_(CONFIG_KEYS.SCHEDULE_URL, DEFAULTS.SCHEDULE_URL);
const LOG_LEVEL = getConfigString_(CONFIG_KEYS.LOG_LEVEL, DEFAULTS.LOG_LEVEL);
const FILE_FORMAT = getConfigString_(CONFIG_KEYS.FILE_FORMAT, DEFAULTS.FILE_FORMAT);

if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG_KEYS = CONFIG_KEYS;
  globalThis.DEFAULTS = DEFAULTS;
  globalThis.TARGET_FOLDER_ID = TARGET_FOLDER_ID;
  globalThis.SCHEDULE_URL = SCHEDULE_URL;
  globalThis.LOG_LEVEL = LOG_LEVEL;
  globalThis.FILE_FORMAT = FILE_FORMAT;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG_KEYS,
    DEFAULTS,
    TARGET_FOLDER_ID,
    SCHEDULE_URL,
    LOG_LEVEL,
    FILE_FORMAT,
  };
}
