const { createUtilitiesMock } = require('../testUtils');

const configPath = require.resolve('../GoogleScript/01_config.js');
const loggerPath = require.resolve('../GoogleScript/02_logger.js');
const drivePath = require.resolve('../GoogleScript/03_drive.js');
const scraperPath = require.resolve('../GoogleScript/04_scraper.js');
const mainPath = require.resolve('../GoogleScript/05_main.js');

describe('scrapeScheduleToDrive', () => {
  let store;
  let fetchMock;
  let urlFetchResponse;
  let driveListMock;
  let driveCreateMock;
  let driveUpdateMock;
  let fileStore;
  let folderStore;
  let sessionMock;

  beforeEach(() => {
    jest.resetModules();
    fileStore = new Map();
    folderStore = new Map();
    store = {
      SCHEDULE_SCRAPER_TARGET_FOLDER_ID: 'folder123',
      SCHEDULE_SCRAPER_FILE_FORMAT: 'json',
    };

    urlFetchResponse = {
      getResponseCode: jest.fn(() => 200),
      getContentText: jest.fn(() => `
        <table>
          <tr>
            <td>POZNAŃ G1/2/3 + EGZAMIN 16:00-19:00</td>
            <td>2025-12-01.</td>
            <td>466,6zł</td>
            <td>Kup teraz</td>
          </tr>
          <tr>
            <td>WARSZAWA G1/2/3 + EGZAMIN 16:00-19:00</td>
            <td>2025-12-03.</td>
            <td>466,6zł</td>
            <td>Kup teraz</td>
          </tr>
        </table>
      `),
    };

    fetchMock = jest.fn(() => urlFetchResponse);
    global.UrlFetchApp = { fetch: fetchMock };

    driveListMock = jest.fn(() => ({ files: [] }));
    driveCreateMock = jest.fn((resource, blob) => {
      const id = `file-${Date.now()}`;
      const file = {
        id,
        getId: () => id,
        getName: () => resource.name,
        content: blob ? blob.getDataAsString() : '',
      };
      fileStore.set(id, file);
      return { id };
    });
    driveUpdateMock = jest.fn();

    global.Drive = {
      Files: {
        list: driveListMock,
        create: driveCreateMock,
        update: driveUpdateMock,
      },
    };

    const testFolder = {
      id: 'folder123',
      getId: () => 'folder123',
    };
    folderStore.set('folder123', testFolder);
    global.DriveApp = {
      getFolderById: jest.fn((id) => folderStore.get(id)),
      getFileById: jest.fn((id) => fileStore.get(id)),
    };

    global.Utilities = createUtilitiesMock();
    global.Session = {
      getScriptTimeZone: () => 'Europe/Warsaw',
    };

    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => store[key],
      }),
    };

    delete require.cache[configPath];
    delete require.cache[loggerPath];
    delete require.cache[drivePath];
    delete require.cache[scraperPath];
    delete require.cache[mainPath];

    require(configPath);
    require(loggerPath);
    require(drivePath);
    require(scraperPath);
  });

  afterEach(() => {
    delete global.UrlFetchApp;
    delete global.Drive;
    delete global.DriveApp;
    delete global.Utilities;
    delete global.Session;
    delete global.PropertiesService;
    delete global.logger;
    delete global.TARGET_FOLDER_ID;
    delete global.FILE_FORMAT;
    fileStore.clear();
    folderStore.clear();
  });

  it('scrapes schedule and saves to Drive as JSON', () => {
    const { scrapeScheduleToDrive } = require(mainPath);
    const result = scrapeScheduleToDrive();

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.format).toBe('json');
    expect(result.fileName).toBe('terminarz.json');
    expect(result.fileId).toBeDefined();
    expect(driveCreateMock).toHaveBeenCalled();
  });

  it('scrapes schedule and saves to Drive as CSV when format is csv', () => {
    store.SCHEDULE_SCRAPER_FILE_FORMAT = 'csv';
    delete require.cache[configPath];
    delete require.cache[mainPath];
    require(configPath);

    const { scrapeScheduleToDrive } = require(mainPath);
    const result = scrapeScheduleToDrive();

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.format).toBe('csv');
    expect(result.fileName).toBe('terminarz.csv');
    
    const callArgs = driveCreateMock.mock.calls[0];
    const blob = callArgs[1];
    const content = blob.getDataAsString();
    expect(content).toContain('Miejsce,Data,Cena,Akcja,ScrapedAt');
    expect(content).toContain('POZNAŃ');
  });

  it('throws error when TARGET_FOLDER_ID is not configured', () => {
    store.SCHEDULE_SCRAPER_TARGET_FOLDER_ID = '';
    delete require.cache[configPath];
    delete require.cache[mainPath];
    require(configPath);

    const { scrapeScheduleToDrive } = require(mainPath);
    expect(() => scrapeScheduleToDrive()).toThrow('TARGET_FOLDER_ID is not configured');
  });

  it('handles empty schedule gracefully', () => {
    urlFetchResponse.getContentText.mockReturnValue('<table></table>');
    
    const { scrapeScheduleToDrive } = require(mainPath);
    const result = scrapeScheduleToDrive();

    expect(result.success).toBe(false);
    expect(result.count).toBe(0);
    expect(result.message).toContain('Brak danych');
  });

  it('handles HTTP errors during scraping', () => {
    urlFetchResponse.getResponseCode.mockReturnValue(500);
    urlFetchResponse.getContentText.mockReturnValue('Server Error');

    const { scrapeScheduleToDrive } = require(mainPath);
    expect(() => scrapeScheduleToDrive()).toThrow();
  });

  it('updates existing file instead of creating new one', () => {
    // Mock that file already exists
    const existingFileId = 'existing-file-123';
    driveListMock.mockReturnValue({
      files: [{ id: existingFileId }],
    });
    
    const existingFile = {
      id: existingFileId,
      getId: () => existingFileId,
      getName: () => 'terminarz.json',
    };
    fileStore.set(existingFileId, existingFile);
    global.DriveApp.getFileById.mockReturnValue(existingFile);

    const { scrapeScheduleToDrive } = require(mainPath);
    const result = scrapeScheduleToDrive();

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.fileName).toBe('terminarz.json');
    expect(result.fileId).toBe(existingFileId);
    
    // Should update existing file, not create new one
    expect(driveUpdateMock).toHaveBeenCalled();
    expect(driveCreateMock).not.toHaveBeenCalled();
  });
});
