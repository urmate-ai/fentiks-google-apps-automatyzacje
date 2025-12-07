const CONFIG_KEYS = {
  projectId: 'RAG_REFRESHER_PROJECT_ID',
  location: 'RAG_REFRESHER_LOCATION',
  dataStoreId: 'RAG_REFRESHER_DATA_STORE_ID',
  rootFolderId: 'RAG_REFRESHER_ROOT_FOLDER_ID',
  logLevel: 'RAG_REFRESHER_LOG_LEVEL',
  activeOperation: 'RAG_REFRESHER_ACTIVE_IMPORT_OP',
};

const CONFIG_DEFAULTS = {
  projectId: '',
  location: 'europe-west3',
  dataStoreId: '',
  rootFolderId: '',
  logLevel: 'Information',
};

const LOG_LEVELS = ['Error', 'Warning', 'Information', 'Debug', 'None'];

if (typeof globalThis !== 'undefined') {
  if (typeof globalThis.CONFIG_KEYS === 'undefined') {
    globalThis.CONFIG_KEYS = CONFIG_KEYS;
  }

  if (typeof globalThis.CONFIG_DEFAULTS === 'undefined') {
    globalThis.CONFIG_DEFAULTS = CONFIG_DEFAULTS;
  }

  if (typeof globalThis.LOG_LEVELS === 'undefined') {
    globalThis.LOG_LEVELS = LOG_LEVELS;
  }
}

function getConfig(properties) {
  const props = resolveProperties(properties);

  const projectId = readProperty(props, CONFIG_KEYS.projectId, CONFIG_DEFAULTS.projectId);
  const location = readProperty(props, CONFIG_KEYS.location, CONFIG_DEFAULTS.location);
  const dataStoreId = readProperty(
    props,
    CONFIG_KEYS.dataStoreId,
    readProperty(props, 'RAG_REFRESHER_CORPUS_ID', CONFIG_DEFAULTS.dataStoreId),
  );
  const rootFolderId = readProperty(props, CONFIG_KEYS.rootFolderId, CONFIG_DEFAULTS.rootFolderId);
  const logLevel = normalizeLogLevel(
    readProperty(props, CONFIG_KEYS.logLevel),
    CONFIG_DEFAULTS.logLevel,
  );

  return { projectId, location, dataStoreId, rootFolderId, logLevel };
}

function resolveProperties(properties) {
  if (properties) {
    return properties;
  }

  if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
    return PropertiesService.getScriptProperties();
  }

  return null;
}

function readProperty(props, key, fallback) {
  if (!props) {
    return fallback;
  }

  if (typeof props.getProperty === 'function') {
    const value = props.getProperty(key);
    return value != null && value !== '' ? value : fallback;
  }

  if (Object.prototype.hasOwnProperty.call(props, key)) {
    const value = props[key];
    return value != null && value !== '' ? value : fallback;
  }

  return fallback;
}

function normalizeLogLevel(rawValue, fallback) {
  if (typeof rawValue !== 'string') {
    return fallback;
  }

  const cleaned = rawValue.trim().toLowerCase();
  const match = LOG_LEVELS.find(level => level.toLowerCase() === cleaned);
  return match || fallback;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG_KEYS,
    CONFIG_DEFAULTS,
    LOG_LEVELS,
    getConfig,
    normalizeLogLevel,
    readProperty,
    resolveProperties,
  };
}
