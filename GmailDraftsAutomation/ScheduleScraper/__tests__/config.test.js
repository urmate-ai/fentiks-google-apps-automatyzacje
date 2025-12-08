const configModulePath = require.resolve('../GoogleScript/01_config.js');

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
    delete global.SCHEDULE_URL;
    delete global.LOG_LEVEL;
    delete global.FILE_FORMAT;
  });

  function loadConfig() {
    delete require.cache[configModulePath];
    return require(configModulePath);
  }

  it('returns defaults when properties are missing', () => {
    const config = loadConfig();
    expect(config.SCHEDULE_URL).toBe('https://fentiks.pl/terminarz-szkolen-i-egzaminow/');
    expect(config.LOG_LEVEL).toBe('Information');
    expect(config.FILE_FORMAT).toBe('json');
    expect(config.TARGET_FOLDER_ID).toBe('');
  });

  it('reads provided script properties', () => {
    store.SCHEDULE_SCRAPER_TARGET_FOLDER_ID = 'folder123';
    store.SCHEDULE_SCRAPER_URL = 'https://example.com/schedule';
    store.SCHEDULE_SCRAPER_LOG_LEVEL = 'Debug';
    store.SCHEDULE_SCRAPER_FILE_FORMAT = 'csv';

    const config = loadConfig();
    expect(config.TARGET_FOLDER_ID).toBe('folder123');
    expect(config.SCHEDULE_URL).toBe('https://example.com/schedule');
    expect(config.LOG_LEVEL).toBe('Debug');
    expect(config.FILE_FORMAT).toBe('csv');
  });

  it('uses default URL when empty', () => {
    store.SCHEDULE_SCRAPER_URL = '';
    const config = loadConfig();
    expect(config.SCHEDULE_URL).toBe('https://fentiks.pl/terminarz-szkolen-i-egzaminow/');
  });
});
