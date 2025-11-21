const crypto = require('crypto');

const SECRET_HEX = 'dd45971f4289e215';

describe('IFirma postExpense authentication', () => {
  let fetchMock;
  let scriptProperties;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn(() => ({
      getResponseCode: () => 201,
      getContentText: () => '{"Status":"OK"}',
    }));

    global.UrlFetchApp = { fetch: fetchMock };

    scriptProperties = {
      getProperty: jest.fn((name) => {
        if (name === 'IFIRMA_LOGIN') return 'test-login';
        if (name === 'IFIRMA_EXPENSE_KEY') return SECRET_HEX;
        return null;
      }),
    };

    global.PropertiesService = { getScriptProperties: jest.fn(() => scriptProperties) };
  });

  afterEach(() => {
    delete global.UrlFetchApp;
    delete global.PropertiesService;
    delete global.Utilities;
  });

  test('builds canonical signature material and header per spec', async () => {
    const payload = { foo: 'bar' };
    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postExpense('endpoint', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe('https://www.ifirma.pl/iapi/endpoint.json');
    expect(options.headers.Authentication).toBeDefined();
    expect(options.headers.Authentication).toContain('user=test-login');
    expect(options.headers.Authentication).not.toContain('key=');
    expect(options.contentType).toBe('application/json; charset=utf-8');
    expect(options.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(options.headers.Accept).toBe('application/json');
    expect(options.headers['Accept-Charset']).toBe('utf-8');
    expect(Buffer.from(options.payload).toString('utf8')).toBe(JSON.stringify(payload));

    const canonical = url + 'test-login' + 'wydatek' + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha1', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical, 'utf8')
      .digest('hex');

    expect(options.headers.Authentication)
      .toBe(`IAPIS user=test-login, hmac-sha1=${expectedSignature}`);
  });

  test('coerces GAS types before computing signature', async () => {
    const payload = { foo: 'bar' };
    const url = 'https://www.ifirma.pl/iapi/endpoint.json';
    const canonical = url + 'test-login' + 'wydatek' + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha1', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical, 'utf8')
      .digest('hex');

    const toSignedBytes = (buffer) => Array.from(buffer, (byte) => (byte > 127 ? byte - 256 : byte));
    const messageBytes = toSignedBytes(Buffer.from(canonical, 'utf8'));
    const keyBytes = toSignedBytes(Buffer.from(SECRET_HEX, 'hex'));

    const messageBlob = { getBytes: jest.fn(() => messageBytes) };

    const newBlob = jest.fn((value) => {
      if (value === canonical) {
        return messageBlob;
      }

      if (Array.isArray(value)) {
        const buffer = Buffer.from(value);
        return {
          getDataAsString: jest.fn(() => buffer.toString('utf8')),
          getBytes: jest.fn(() => Array.from(buffer, (byte) => (byte > 127 ? byte - 256 : byte))),
        };
      }

      return {
        getBytes: jest.fn(() => []),
        getDataAsString: jest.fn(() => ''),
      };
    });

    const signatureBytes = toSignedBytes(Buffer.from(expectedSignature, 'hex'));
    const computeHmacSignature = jest.fn(() => signatureBytes);

    global.Utilities = {
      MacAlgorithm: { HMAC_SHA_1: 'HMAC_SHA_1' },
      newBlob,
      computeHmacSignature,
    };

    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postExpense('endpoint', payload);

    expect(computeHmacSignature).toHaveBeenCalledTimes(1);
    const [algorithm, message, key] = computeHmacSignature.mock.calls[0];
    expect(algorithm).toBe('HMAC_SHA_1');
    expect(message).toEqual(messageBytes);
    expect(key).toEqual(keyBytes);

    expect(global.Utilities.newBlob).toHaveBeenCalledWith(canonical);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authentication)
      .toBe(`IAPIS user=test-login, hmac-sha1=${expectedSignature}`);
    expect(Buffer.from(options.payload).toString('utf8')).toBe(JSON.stringify(payload));
  });

  test('trims credentials from script properties', async () => {
    scriptProperties.getProperty.mockImplementation((name) => {
      if (name === 'IFIRMA_LOGIN') return '  spaced-login  ';
      if (name === 'IFIRMA_EXPENSE_KEY') {
        return '  \ufeff' + SECRET_HEX.toUpperCase() + '  ';
      }
      return null;
    });

    const payload = { foo: 'bar' };
    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postExpense('endpoint', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authentication).toContain('user=spaced-login');
    expect(options.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(options.contentType).toBe('application/json; charset=utf-8');
    expect(Buffer.from(options.payload).toString('utf8')).toBe(JSON.stringify(payload));

    const canonical = url
      + 'spaced-login'
      + 'wydatek'
      + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha1', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical, 'utf8')
      .digest('hex');

    expect(options.headers.Authentication)
      .toBe(`IAPIS user=spaced-login, hmac-sha1=${expectedSignature}`);
  });

  test('excludes query string from canonical URL for HMAC', async () => {
    const payload = { foo: 'bar' };
    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postExpense('endpoint?limit=10', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.ifirma.pl/iapi/endpoint.json?limit=10');

    const canonicalUrl = 'https://www.ifirma.pl/iapi/endpoint.json';
    const canonical = canonicalUrl + 'test-login' + 'wydatek' + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha1', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical, 'utf8')
      .digest('hex');

    expect(options.headers.Authentication)
      .toBe(`IAPIS user=test-login, hmac-sha1=${expectedSignature}`);
  });

  test('normalizes UTF-8 payload strings to avoid encoding errors', async () => {
    const payload = '\ufeff{"żółć":"ąę"}';
    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postExpense('endpoint', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(options.headers['Accept-Charset']).toBe('utf-8');
    expect(Buffer.from(options.payload).toString('utf8')).toBe('{"żółć":"ąę"}');
  });

  test('postSalesInvoice signs payload with faktura key by default', async () => {
    const payload = { foo: 'bar' };
    scriptProperties.getProperty.mockImplementation((name) => {
      if (name === 'IFIRMA_LOGIN') return 'sales-login';
      if (name === 'IFIRMA_SALES_KEY') return SECRET_HEX;
      return null;
    });

    const IFirma = require('../GoogleScript/07_ifirma');

    await IFirma.postSalesInvoice('fakturakraj', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.ifirma.pl/iapi/fakturakraj.json');
    const canonical = 'https://www.ifirma.pl/iapi/fakturakraj.json'
      + 'sales-login'
      + 'faktura'
      + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha1', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical, 'utf8')
      .digest('hex');
    expect(options.headers.Authentication)
      .toBe(`IAPIS user=sales-login, hmac-sha1=${expectedSignature}`);
  });
});
