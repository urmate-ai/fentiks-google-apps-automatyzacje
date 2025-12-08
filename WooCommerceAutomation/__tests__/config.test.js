import { getConfig, getAuthHeader } from './testHelpers';

describe('Config Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getConfig returns correct configuration', () => {
    const config = getConfig();
    
    expect(config).toEqual({
      URL_BASE: 'https://test.com/wp-json/wc/v3/customers',
      CONSUMER_KEY: 'test_key',
      CONSUMER_SECRET: 'test_secret'
    });
  });

  test('getAuthHeader returns base64 encoded credentials', () => {
    const authHeader = getAuthHeader();
    const expectedEncoding = Buffer.from('test_key:test_secret').toString('base64');
    
    expect(authHeader).toBe(`Basic ${expectedEncoding}`);
    expect(Utilities.base64Encode).toHaveBeenCalledWith('test_key:test_secret');
  });
});