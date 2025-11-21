const originalProps = globalThis.PropertiesService;

function mockProperties(map) {
  return {
    getProperty: (key) => (key in map ? map[key] : null)
  };
}

describe('configuration log level', () => {
  afterEach(() => {
    jest.resetModules();
    if (originalProps) {
      globalThis.PropertiesService = originalProps;
    } else {
      delete globalThis.PropertiesService;
    }
    delete globalThis.CFG;
    delete globalThis.LOG_LEVEL;
  });

  test('defaults to Information when not set', () => {
    globalThis.PropertiesService = {
      getScriptProperties: () => mockProperties({})
    };

    const cfg = require('../GoogleScripts/01_config');

    expect(cfg.LOG_LEVEL).toBe('Information');
    expect(globalThis.LOG_LEVEL).toBe('Information');
  });

  test('reads log level from GEMINI_EMAIL_LOG_LEVEL', () => {
    globalThis.PropertiesService = {
      getScriptProperties: () => mockProperties({ GEMINI_EMAIL_LOG_LEVEL: 'Debug' })
    };

    const cfg = require('../GoogleScripts/01_config');

    expect(cfg.LOG_LEVEL).toBe('Debug');
    expect(globalThis.LOG_LEVEL).toBe('Debug');
  });
});
