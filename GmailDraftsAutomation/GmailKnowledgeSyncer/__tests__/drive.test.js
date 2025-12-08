const { createUtilitiesMock } = require('../testUtils');

const driveModulePath = require.resolve('../GoogleScripts/03_drive.js');

describe('drive helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    global.Utilities = createUtilitiesMock();
    global.Drive = { Files: { list: jest.fn(), create: jest.fn() } };
    global.DriveApp = {
      getFolderById: jest.fn((id) => ({ id, getId: () => id })),
      getFileById: jest.fn((id) => ({ id, appendChunk: jest.fn(), getBlob: jest.fn(() => ({ getDataAsString: () => '' })), setContent: jest.fn() })),
    };
    delete require.cache[driveModulePath];
    require(driveModulePath);
  });

  afterEach(() => {
    delete global.Utilities;
    delete global.Drive;
    delete global.DriveApp;
    delete global.getOrCreateFile;
    delete global.appendJsonl;
    delete global.ensureFolderPath;
    delete global.extractLatestTimestampFromFile;
    delete global.getLatestSyncedTimestamp;
    delete global.extractTimestampBoundsFromFile;
    delete global.getSyncedTimestampRange;
  });

  it('appends JSON lines to a file', () => {
    let content = '';
    const file = {
      appendChunk: jest.fn((blob) => { content += blob.getDataAsString(); }),
    };

    const { appendJsonl } = require(driveModulePath);
    appendJsonl(file, { hello: 'world' });
    appendJsonl(file, { value: 123 });

    expect(content.trim().split('\n')).toEqual([
      JSON.stringify({ hello: 'world' }),
      JSON.stringify({ value: 123 }),
    ]);
  });

  it('ensures nested folder path via Drive API', () => {
    const root = { getId: () => 'root-folder' };
    const driveFolders = {
      root: { id: 'root-folder' },
      year: { id: 'year-folder' },
      month: { id: 'month-folder' },
    };
    Drive.Files.list
      .mockReturnValueOnce({ files: [{ id: driveFolders.year.id }] })
      .mockReturnValueOnce({ files: [{ id: driveFolders.month.id }] });
    DriveApp.getFolderById.mockImplementation((id) => ({ id, getId: () => id }));

    const { ensureFolderPath } = require(driveModulePath);
    const folder = ensureFolderPath(root, ['2024', '2024-01']);
    expect(folder.getId()).toBe(driveFolders.month.id);
    expect(Drive.Files.create).not.toHaveBeenCalled();
    expect(Drive.Files.list).toHaveBeenCalledTimes(2);
  });

  it('creates missing folders via Drive API', () => {
    const root = { getId: () => 'root-folder' };
    Drive.Files.list
      .mockReturnValueOnce({ files: [] })
      .mockReturnValueOnce({ files: [] })
      .mockReturnValueOnce({ files: [{ id: 'month-folder' }] });
    Drive.Files.create
      .mockReturnValueOnce({ id: 'year-folder' })
      .mockReturnValueOnce({ id: 'month-folder' });
    DriveApp.getFolderById.mockImplementation((id) => ({ id, getId: () => id }));

    const { ensureFolderPath } = require(driveModulePath);
    const folder = ensureFolderPath(root, ['2024', '2024-01']);

    expect(folder.getId()).toBe('month-folder');
    expect(Drive.Files.create).toHaveBeenCalledTimes(2);
  });

  it('creates a jsonl file if missing', () => {
    Drive.Files.list
      .mockReturnValueOnce({ files: [] })
      .mockReturnValueOnce({ files: [{ id: 'file-123' }] });
    Drive.Files.create.mockReturnValueOnce({ id: 'file-123' });

    const folder = { getId: () => 'folder-1' };
    DriveApp.getFileById.mockReturnValueOnce({ id: 'file-123', appendChunk: jest.fn(), getBlob: jest.fn(() => ({ getDataAsString: () => '' })), setContent: jest.fn() });

    const { getOrCreateFile } = require(driveModulePath);
    const file = getOrCreateFile(folder, '2024-01-01.jsonl');

    expect(file.id).toBe('file-123');
    expect(Drive.Files.create).toHaveBeenCalledTimes(1);
  });

  it('extracts latest timestamp from jsonl file', () => {
    let stored = '';
    const blob = {
      getDataAsString: () => stored,
    };
    const file = {
      getBlob: () => blob,
      getName: () => '2024-01-01.jsonl',
    };

    const { appendJsonl, extractLatestTimestampFromFile } = require(driveModulePath);
    appendJsonl({
      appendChunk: (chunk) => { stored += chunk.getDataAsString(); },
    }, { gmail: { received_internaldate_ms: 1000 } });
    appendJsonl({
      appendChunk: (chunk) => { stored += chunk.getDataAsString(); },
    }, { gmail: { received_at: '2024-01-02T10:00:00Z' } });

    expect(extractLatestTimestampFromFile(file)).toBe(Date.parse('2024-01-02T10:00:00Z'));
  });

  it('finds latest synced timestamp across folders', () => {
    const fileA = {
      getName: () => '2024-01-01.jsonl',
      getBlob: () => ({ getDataAsString: () => `${JSON.stringify({ gmail: { received_internaldate_ms: 1000 } })}\n` }),
    };
    const fileB = {
      getName: () => '2024-01-02.jsonl',
      getBlob: () => ({ getDataAsString: () => `${JSON.stringify({ gmail: { received_at: '2024-01-03T00:00:00Z' } })}\n` }),
    };
    const filesIterator = {
      hasNext: jest.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      next: jest.fn()
        .mockReturnValueOnce(fileA)
        .mockReturnValueOnce(fileB),
    };
    const subfoldersIterator = {
      hasNext: () => false,
    };
    const folder = {
      getFiles: () => filesIterator,
      getFolders: () => subfoldersIterator,
    };

    const { getLatestSyncedTimestamp } = require(driveModulePath);
    expect(getLatestSyncedTimestamp(folder)).toBe(Date.parse('2024-01-03T00:00:00Z'));
  });

  it('returns timestamp range across folders', () => {
    const fileA = {
      getName: () => '2024-01-01.jsonl',
      getBlob: () => ({
        getDataAsString: () => [
          JSON.stringify({ gmail: { received_internaldate_ms: 2000 } }),
          JSON.stringify({ gmail: { received_at: '2024-01-02T00:00:00Z' } }),
        ].join('\n'),
      }),
    };
    const fileB = {
      getName: () => '2023-12-31.jsonl',
      getBlob: () => ({
        getDataAsString: () => [
          JSON.stringify({ gmail: { received_internaldate_ms: 1000 } }),
          JSON.stringify({ gmail: { received_internaldate_ms: 1500 } }),
        ].join('\n'),
      }),
    };

    const filesIterator = {
      hasNext: jest.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      next: jest.fn()
        .mockReturnValueOnce(fileA)
        .mockReturnValueOnce(fileB),
    };
    const subfoldersIterator = { hasNext: () => false };
    const folder = {
      getFiles: () => filesIterator,
      getFolders: () => subfoldersIterator,
    };

    const { getSyncedTimestampRange } = require(driveModulePath);
    const range = getSyncedTimestampRange(folder);
    expect(range.newestTimestamp).toBe(Date.parse('2024-01-02T00:00:00Z'));
    expect(range.oldestTimestamp).toBe(1000);
  });
});
