import { getSheetData, createCustomMenu } from './testHelpers';
import { mocks } from './setupTests';

describe('Spreadsheet Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getSheetData returns data from active sheet', () => {
    const data = getSheetData();
    
    expect(data).toEqual([
      ['Header1', 'Header2'],
      ['Data1', 'Data2']
    ]);
    expect(SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled();
    expect(mocks.spreadsheet.getActiveSheet).toHaveBeenCalled();
  });

  test('createCustomMenu creates menu with correct items', () => {
    createCustomMenu();
    
    expect(mocks.ui.createMenu).toHaveBeenCalledWith('Automatyzacja');
    expect(mocks.menu.addItem).toHaveBeenCalledWith(
      'Dodaj nowe kontakty do WooCommerce',
      'dodajKontaktyDoWooCommerce'
    );
    expect(mocks.menu.addToUi).toHaveBeenCalled();
  });
});