const createMockMenu = () => {
  const menu = {
    addItem: jest.fn(),
    addToUi: jest.fn()
  };
  menu.addItem.mockReturnValue(menu);
  return menu;
};

const mockMenu = createMockMenu();

const mockUi = {
  alert: jest.fn(),
  createMenu: jest.fn().mockReturnValue(mockMenu)
};

const mockSheet = {
  getDataRange: jest.fn().mockReturnThis(),
  getValues: jest.fn().mockReturnValue([
    ['Header1', 'Header2'],
    ['Data1', 'Data2']
  ])
};

const mockSpreadsheet = {
  getActiveSheet: jest.fn().mockReturnValue(mockSheet),
  getUi: jest.fn().mockReturnValue(mockUi)
};

global.SpreadsheetApp = {
  getUi: jest.fn().mockReturnValue(mockUi),
  getActiveSpreadsheet: jest.fn().mockReturnValue(mockSpreadsheet)
};

global.Logger = {
  log: jest.fn()
};

global.PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn((key) => {
      const mockProperties = {
        URL_BASE: 'https://test.com/wp-json/wc/v3/customers',
        CONSUMER_KEY: 'test_key',
        CONSUMER_SECRET: 'test_secret'
      };
      return mockProperties[key];
    })
  })
};

global.Utilities = {
  base64Encode: jest.fn((str) => Buffer.from(str).toString('base64'))
};

global.UrlFetchApp = {
  fetch: jest.fn()
};

export const mocks = {
  ui: mockUi,
  menu: mockMenu,
  sheet: mockSheet,
  spreadsheet: mockSpreadsheet
};