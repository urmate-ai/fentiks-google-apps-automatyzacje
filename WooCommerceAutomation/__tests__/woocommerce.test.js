import { checkIfCustomerExists, createCustomerPayload, addCustomerToWooCommerce } from './testHelpers';

describe('WooCommerce Module', () => {
  const mockConfig = {
    URL_BASE: 'https://test.com/wp-json/wc/v3/customers',
    CONSUMER_KEY: 'test_key',
    CONSUMER_SECRET: 'test_secret'
  };

  const mockAuthHeader = 'Basic ' + Buffer.from('test_key:test_secret').toString('base64');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkIfCustomerExists', () => {
    test('returns true when customer exists', () => {
      UrlFetchApp.fetch.mockReturnValueOnce({
        getContentText: () => JSON.stringify([{ id: 1 }])
      });

      const exists = checkIfCustomerExists('test@example.com', mockConfig.URL_BASE, mockAuthHeader);
      
      expect(exists).toBe(true);
      expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
        `${mockConfig.URL_BASE}?email=test%40example.com`,
        {
          method: 'get',
          headers: { Authorization: mockAuthHeader },
          muteHttpExceptions: true
        }
      );
    });

    test('returns false when customer does not exist', () => {
      UrlFetchApp.fetch.mockReturnValueOnce({
        getContentText: () => '[]'
      });

      const exists = checkIfCustomerExists('test@example.com', mockConfig.URL_BASE, mockAuthHeader);
      
      expect(exists).toBe(false);
    });

    test('returns true on error', () => {
      UrlFetchApp.fetch.mockImplementationOnce(() => {
        throw new Error('API Error');
      });

      const exists = checkIfCustomerExists('test@example.com', mockConfig.URL_BASE, mockAuthHeader);
      
      expect(exists).toBe(true);
      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Błąd sprawdzania klienta: test@example.com')
      );
    });
  });

  describe('createCustomerPayload', () => {
    test('creates correct customer payload', () => {
      const payload = createCustomerPayload(
        'John',
        'Doe',
        'john@example.com',
        '12345',
        'Test City'
      );

      expect(payload).toEqual({
        email: 'john@example.com',
        first_name: 'John',
        last_name: 'Doe',
        username: 'John Doe',
        billing: {
          first_name: 'John',
          last_name: 'Doe',
          company: '',
          address_1: '',
          address_2: '',
          city: 'Test City',
          postcode: '12345',
          country: '',
          state: 'PL',
          email: 'john@example.com',
          phone: ''
        },
        shipping: {
          first_name: '',
          last_name: '',
          company: '',
          address_1: '',
          address_2: '',
          city: '',
          postcode: '',
          country: '',
          state: '',
          phone: ''
        }
      });
    });
  });

  describe('addCustomerToWooCommerce', () => {
    const mockCustomer = {
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User'
    };

    test('successfully adds customer', () => {
      UrlFetchApp.fetch.mockReturnValueOnce({
        getContentText: () => JSON.stringify({ id: 1 })
      });

      const result = addCustomerToWooCommerce(mockCustomer, mockConfig.URL_BASE, mockAuthHeader);
      
      expect(result).toBe(true);
      expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
        mockConfig.URL_BASE,
        {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: mockAuthHeader },
          payload: JSON.stringify(mockCustomer),
          muteHttpExceptions: true
        }
      );
      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Dodano: test@example.com')
      );
    });

    test('handles error when adding customer', () => {
      UrlFetchApp.fetch.mockImplementationOnce(() => {
        throw new Error('API Error');
      });

      const result = addCustomerToWooCommerce(mockCustomer, mockConfig.URL_BASE, mockAuthHeader);
      
      expect(result).toBe(false);
      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Błąd dodawania klienta: test@example.com')
      );
    });
  });
});