const drivePath = require.resolve('../GoogleScript/03_drive.js');
const loggerPath = require.resolve('../GoogleScript/02_logger.js');

describe('DriveHelpers', () => {
  let driveListMock;
  let driveCreateMock;
  let driveUpdateMock;
  let driveAppGetFolderMock;
  let driveAppGetFileMock;
  let fileStore;
  let folderStore;

  beforeEach(() => {
    jest.resetModules();
    fileStore = new Map();
    folderStore = new Map();

    driveListMock = jest.fn(() => ({ files: [] }));
    driveCreateMock = jest.fn((resource, blob) => {
      const id = `file-${Date.now()}-${Math.random()}`;
      const file = {
        id,
        name: resource.name,
        content: blob ? blob.getDataAsString() : '',
        mimeType: resource.mimeType || 'application/octet-stream',
      };
      fileStore.set(id, file);
      return { id };
    });
    driveUpdateMock = jest.fn();
    
    driveAppGetFolderMock = jest.fn((id) => {
      const folder = folderStore.get(id) || {
        id,
        getId: () => id,
        getName: () => `folder-${id}`,
      };
      folderStore.set(id, folder);
      return folder;
    });
    
    driveAppGetFileMock = jest.fn((id) => {
      const file = fileStore.get(id) || {
        id,
        getId: () => id,
        getName: () => `file-${id}`,
      };
      fileStore.set(id, file);
      return file;
    });

    global.Drive = {
      Files: {
        list: driveListMock,
        create: driveCreateMock,
        update: driveUpdateMock,
      },
    };
    global.DriveApp = {
      getFolderById: driveAppGetFolderMock,
      getFileById: driveAppGetFileMock,
    };
    global.Utilities = {
      newBlob: (content, mimeType, name) => ({
        getDataAsString: () => content,
        mimeType,
        name,
      }),
    };

    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: () => null,
      }),
    };

    delete require.cache[loggerPath];
    delete require.cache[drivePath];
    require(loggerPath);
  });

  afterEach(() => {
    delete global.Drive;
    delete global.DriveApp;
    delete global.Utilities;
    delete global.PropertiesService;
    delete global.logger;
    fileStore.clear();
    folderStore.clear();
  });

  it('creates file when it does not exist', () => {
    const folder = { getId: () => 'folder123' };
    driveListMock.mockReturnValue({ files: [] });

    const DriveHelpers = require(drivePath);
    const file = DriveHelpers.getOrCreateFile(folder, 'test.json', '{}', 'application/json');

    expect(driveCreateMock).toHaveBeenCalled();
    expect(file).toBeDefined();
    expect(file.getId).toBeDefined();
  });

  it('updates file when it exists', () => {
    const folder = { getId: () => 'folder123' };
    const existingFileId = 'file-existing';
    driveListMock.mockReturnValue({ files: [{ id: existingFileId }] });

    const DriveHelpers = require(drivePath);
    const file = DriveHelpers.getOrCreateFile(folder, 'test.json', '{"new": true}', 'application/json');

    expect(driveUpdateMock).toHaveBeenCalled();
    expect(driveAppGetFileMock).toHaveBeenCalledWith(existingFileId);
  });

  it('gets folder by ID', () => {
    folderStore.set('folder123', { id: 'folder123', getId: () => 'folder123' });

    const DriveHelpers = require(drivePath);
    const folder = DriveHelpers.getFolderById('folder123');

    expect(folder).toBeDefined();
    expect(folder.getId()).toBe('folder123');
  });

  it('throws error when folder ID is missing', () => {
    const DriveHelpers = require(drivePath);
    expect(() => DriveHelpers.getFolderById('')).toThrow('TARGET_FOLDER_ID is not configured');
  });
});
