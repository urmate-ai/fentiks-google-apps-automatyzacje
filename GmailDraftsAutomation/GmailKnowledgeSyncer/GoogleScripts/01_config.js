/**
 * Configuration for the Gmail knowledge synchroniser.
 */
const scriptProperties =
  typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties
    ? PropertiesService.getScriptProperties()
    : null;

const CONFIG_KEYS = {
  TARGET_FOLDER_ID: 'GMAIL_KNOWLEDGE_TARGET_FOLDER_ID',
  THRESHOLD_DAYS: 'GMAIL_KNOWLEDGE_THRESHOLD_DAYS',
  LOG_LEVEL: 'GMAIL_KNOWLEDGE_LOG_LEVEL',
  MAX_MESSAGES_PER_RUN: 'GMAIL_KNOWLEDGE_MAX_MESSAGES_PER_RUN',
};

const DEFAULTS = {
  THRESHOLD_DAYS: 180,
  LOG_LEVEL: 'Information',
  MAX_MESSAGES_PER_RUN: 30,
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

function getConfigNumber_(key, defaultValue) {
  const value = getRawProperty_(key);
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : defaultValue;
}

const TARGET_FOLDER_ID = getConfigString_(CONFIG_KEYS.TARGET_FOLDER_ID, '');
const THRESHOLD_DAYS = getConfigNumber_(CONFIG_KEYS.THRESHOLD_DAYS, DEFAULTS.THRESHOLD_DAYS);
const LOG_LEVEL = getConfigString_(CONFIG_KEYS.LOG_LEVEL, DEFAULTS.LOG_LEVEL);
const MAX_MESSAGES_PER_RUN = getConfigNumber_(
  CONFIG_KEYS.MAX_MESSAGES_PER_RUN,
  DEFAULTS.MAX_MESSAGES_PER_RUN,
);
if (typeof globalThis !== 'undefined') {
  globalThis.CONFIG_KEYS = CONFIG_KEYS;
  globalThis.DEFAULTS = DEFAULTS;
  globalThis.TARGET_FOLDER_ID = TARGET_FOLDER_ID;
  globalThis.THRESHOLD_DAYS = THRESHOLD_DAYS;
  globalThis.LOG_LEVEL = LOG_LEVEL;
  globalThis.MAX_MESSAGES_PER_RUN = MAX_MESSAGES_PER_RUN;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG_KEYS,
    DEFAULTS,
    TARGET_FOLDER_ID,
    THRESHOLD_DAYS,
    LOG_LEVEL,
    MAX_MESSAGES_PER_RUN,
  };
}
