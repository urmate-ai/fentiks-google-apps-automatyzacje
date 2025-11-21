const path = '../GoogleScript/02_logger';

describe('logger', () => {
  beforeEach(() => {
    jest.resetModules();
    global.UrlFetchApp = { fetch: jest.fn() };
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (n) => (n === 'SLACK_WEBHOOK_URL' ? 'https://example.com/hook' : undefined),
      }),
    };
  });

  it('sends errors to slack webhook', () => {
    const logger = require(path);
    logger.error('boom');
    expect(UrlFetchApp.fetch).toHaveBeenCalledWith('https://example.com/hook', expect.objectContaining({
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: 'boom' }),
    }));
  });
});

