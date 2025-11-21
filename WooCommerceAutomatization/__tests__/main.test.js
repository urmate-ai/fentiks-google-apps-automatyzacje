import { onOpen, dodajKontaktyDoWooCommerce } from './testHelpers';
import { mocks } from './setupTests';

describe('Main Module', () => {
  const createTestRow = (rowIndex, firstName, lastName, email, postcode, city) => {
    const row = new Array(42).fill('');
    row[0] = rowIndex;
    row[1] = firstName;
    row[2] = lastName;
    row[34] = email;
    row[40] = postcode;
    row[41] = city;
    return row;
  };

  const mockData = [
    ['Header1', 'Header2', 'Header3'],
    createTestRow(1, '', '', '', '', ''),
    createTestRow(2, '', '', '', '', ''),
    createTestRow(3, 'Jan', 'Kowalski', 'jan@example.com', '12345', 'Warszawa')
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mocks.sheet.getValues.mockReturnValue(mockData);
  });

  describe('onOpen', () => {
    test('creates custom menu on spreadsheet open', () => {
      onOpen();
      
      expect(mocks.ui.createMenu).toHaveBeenCalledWith('Automatyzacja');
      expect(mocks.menu.addItem).toHaveBeenCalledWith(
        'Dodaj nowe kontakty do WooCommerce',
        'dodajKontaktyDoWooCommerce'
      );
      expect(mocks.menu.addToUi).toHaveBeenCalled();
    });
  });

  describe('dodajKontaktyDoWooCommerce', () => {
    test('processes valid customer data correctly', () => {
      const checkResponse = { getContentText: () => '[]' };
      const addResponse = { getContentText: () => '{"id": 1}' };
      
      UrlFetchApp.fetch
        .mockImplementationOnce(() => checkResponse)
        .mockImplementationOnce(() => addResponse);

      dodajKontaktyDoWooCommerce();

      expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
      
      const calls = UrlFetchApp.fetch.mock.calls;
      expect(calls[0][0]).toContain('email=jan%40example.com');
      expect(calls[0][1]).toMatchObject({
        method: 'get',
        muteHttpExceptions: true
      });

      expect(calls[1][1]).toMatchObject({
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true
      });
      expect(calls[1][1].payload).toContain('jan@example.com');

      expect(mocks.ui.alert).toHaveBeenCalledWith(
        'Zakończono!\nDodano 1 nowych klientów.'
      );
    });

    test('shows message when no new customers to add', () => {
      mocks.sheet.getValues.mockReturnValue([
        ['Header1', 'Header2'],
        ['Data1', 'Data2']
      ]);

      dodajKontaktyDoWooCommerce();

      expect(mocks.ui.alert).toHaveBeenCalledWith(
        'Brak nowych klientów do dodania.'
      );
    });

    test('skips existing customers', () => {
      UrlFetchApp.fetch.mockImplementationOnce(() => ({
        getContentText: () => '[{"id": 1}]'
      }));

      dodajKontaktyDoWooCommerce();

      expect(Logger.log).toHaveBeenCalledWith(
        '[INFO] Pominięto (już istnieje): jan@example.com'
      );
    });

    test('handles API errors gracefully', () => {
      const error = new Error('API Error');
      UrlFetchApp.fetch.mockImplementationOnce(() => {
        throw error;
      });

      dodajKontaktyDoWooCommerce();

      expect(Logger.log).toHaveBeenCalledWith(
        '[ERROR] Błąd sprawdzania klienta: jan@example.com -> Error: API Error'
      );
    });
  });
});