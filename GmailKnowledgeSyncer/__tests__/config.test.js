const configModulePath = require.resolve('../GoogleScripts/01_config.js');

describe('config', () => {
  let store;

  beforeEach(() => {
    jest.resetModules();
    store = {};
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => store[key],
      }),
    };
  });

  afterEach(() => {
    delete global.PropertiesService;
    delete global.CONFIG_KEYS;
    delete global.DEFAULTS;
    delete global.TARGET_FOLDER_ID;
    delete global.THRESHOLD_DAYS;
    delete global.LOG_LEVEL;
  });

  function loadConfig() {
    delete require.cache[configModulePath];
    return require(configModulePath);
  }

  it('returns defaults when properties are missing', () => {
    const config = loadConfig();
    expect(config.THRESHOLD_DAYS).toBe(180);
    expect(config.LOG_LEVEL).toBe('Information');
  });

  it('reads provided script properties', () => {
    store.GMAIL_KNOWLEDGE_TARGET_FOLDER_ID = 'root123';
    store.GMAIL_KNOWLEDGE_THRESHOLD_DAYS = '45';
    store.GMAIL_KNOWLEDGE_LOG_LEVEL = 'Debug';

    const config = loadConfig();
    expect(config.TARGET_FOLDER_ID).toBe('root123');
    expect(config.THRESHOLD_DAYS).toBe(45);
    expect(config.LOG_LEVEL).toBe('Debug');
  });

  it('falls back to defaults for invalid numeric values', () => {
    store.GMAIL_KNOWLEDGE_THRESHOLD_DAYS = 'abc';
    const config = loadConfig();
    expect(config.THRESHOLD_DAYS).toBe(180);
  });
});
