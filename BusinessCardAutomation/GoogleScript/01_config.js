/**
 * Configuration constants.
 */
const scriptProperties =
  typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties
    ? PropertiesService.getScriptProperties()
    : null;

const CONFIG_KEYS = {
  ROOT_FOLDER_ID: 'BUSINESS_CARD_FOLDER_ID',
  LOG_LEVEL: 'BUSINESS_CARD_LOG_LEVEL',
  HUBSPOT_CALL_ENABLED: 'BUSINESS_CARD_HUBSPOT_ENABLED',
  EMAIL_SENDING_ENABLED: 'BUSINESS_CARD_EMAIL_ENABLED',
  SMS_SENDING_ENABLED: 'BUSINESS_CARD_SMS_ENABLED',
};

const DEFAULTS = {
  LOG_LEVEL: 'Information',
  HUBSPOT_CALL_ENABLED: true,
  EMAIL_SENDING_ENABLED: true,
  SMS_SENDING_ENABLED: true,
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

function getConfigBoolean_(key, defaultValue) {
  const value = getRawProperty_(key);
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].indexOf(normalized) >= 0) {
    return true;
  }
  if (['false', '0', 'no', 'off'].indexOf(normalized) >= 0) {
    return false;
  }
  return defaultValue;
}

const FOLDER_ID = getConfigString_(CONFIG_KEYS.ROOT_FOLDER_ID, ''); // Drive folder ID (from the URL /folders/<ID>)

const TEMPLATE_NAME = 'wzorzec.xlsx';
const SHEET_HEADERS = [
  'Lp', 'imie', 'nazwisko', 'email', 'stanowisko',
  'pesel', 'telefon', 'firma', 'ulica', 'nr_domu',
  'kod_pocztowy', 'miasto',
  'sourceFileName', 'sourceFileId', 'timestamp'
];
const GEMINI_MODEL = 'gemini-2.0-flash'; // fast and inexpensive; for difficult cards you can switch to 'gemini-1.5-pro'

// Logging level: choose from 'Error', 'Warning', 'Information', 'Debug', or 'None'
const LOG_LEVEL = getConfigString_(CONFIG_KEYS.LOG_LEVEL, DEFAULTS.LOG_LEVEL);

// Feature flags
const HUBSPOT_CALL_ENABLED = getConfigBoolean_(CONFIG_KEYS.HUBSPOT_CALL_ENABLED, DEFAULTS.HUBSPOT_CALL_ENABLED); // controls whether contacts are sent to HubSpot
const EMAIL_SENDING_ENABLED = getConfigBoolean_(CONFIG_KEYS.EMAIL_SENDING_ENABLED, DEFAULTS.EMAIL_SENDING_ENABLED); // controls sending thank-you emails
const SMS_SENDING_ENABLED   = getConfigBoolean_(CONFIG_KEYS.SMS_SENDING_ENABLED, DEFAULTS.SMS_SENDING_ENABLED); // controls sending SMS messages

if (typeof globalThis !== 'undefined') {
  globalThis.FOLDER_ID = FOLDER_ID;
  globalThis.LOG_LEVEL = LOG_LEVEL;
  globalThis.HUBSPOT_CALL_ENABLED = HUBSPOT_CALL_ENABLED;
  globalThis.EMAIL_SENDING_ENABLED = EMAIL_SENDING_ENABLED;
  globalThis.SMS_SENDING_ENABLED = SMS_SENDING_ENABLED;
}
