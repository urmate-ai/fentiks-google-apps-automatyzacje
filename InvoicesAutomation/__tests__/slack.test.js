const DEFAULT_WEBHOOK = 'https://hooks.slack.com/services/test/webhook';

describe('Slack notifications', () => {
  let Slack;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn(() => ({
      getResponseCode: () => 200,
      getContentText: () => 'ok',
    }));
    global.UrlFetchApp = { fetch: fetchMock };

    jest.isolateModules(() => {
      const slackModule = require('../GoogleScript/02_slack');
      Slack = slackModule;
    });
  });

  afterEach(() => {
    delete global.UrlFetchApp;
    delete global.PropertiesService;
    delete global.IFIRMA_SLACK_CODE_FLAGS;
    delete global.IFIRMA_SLACK_DISABLED_CODES;
    delete global.IFIRMA_NOTIFY_FAILED_INVOICES;
  });

  test('sends iFirma error notification by default', async () => {
    await Slack.notifyIfirmaError({ code: 101, webhookUrl: DEFAULT_WEBHOOK });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_WEBHOOK);
    expect(options.method).toBe('post');
  });

  test('skips notification when code flag set to false', async () => {
    jest.resetModules();
    global.UrlFetchApp = { fetch: fetchMock };
    global.IFIRMA_SLACK_CODE_FLAGS = { 101: false };

    jest.isolateModules(() => {
      Slack = require('../GoogleScript/02_slack');
    });

    const result = await Slack.notifyIfirmaError({ code: 101, webhookUrl: DEFAULT_WEBHOOK });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('skips Failed notification when disabled globally', async () => {
    jest.resetModules();
    global.UrlFetchApp = { fetch: fetchMock };
    global.IFIRMA_NOTIFY_FAILED_INVOICES = false;

    jest.isolateModules(() => {
      Slack = require('../GoogleScript/02_slack');
    });

    const result = await Slack.notifyInvoiceFailure({ invoiceNumber: 'INV-1', webhookUrl: DEFAULT_WEBHOOK });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('script property disables selected code notifications', async () => {
    jest.resetModules();
    global.UrlFetchApp = { fetch: fetchMock };
    const scriptProperties = {
      getProperty: jest.fn((key) => {
        if (key === 'IFIRMA_SLACK_CODE_FLAGS') {
          return '{"101":false}';
        }
        return null;
      }),
    };
    global.PropertiesService = { getScriptProperties: jest.fn(() => scriptProperties) };

    jest.isolateModules(() => {
      Slack = require('../GoogleScript/02_slack');
    });

    const result = await Slack.notifyIfirmaError({ code: 101, webhookUrl: DEFAULT_WEBHOOK });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
