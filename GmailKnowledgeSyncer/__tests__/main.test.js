const { createUtilitiesMock } = require('../testUtils');

const configPath = require.resolve('../GoogleScripts/01_config.js');
const loggerPath = require.resolve('../GoogleScripts/02_logger.js');
const drivePath = require.resolve('../GoogleScripts/03_drive.js');
const parserPath = require.resolve('../GoogleScripts/04_parser.js');
const mainPath = require.resolve('../GoogleScripts/05_main.js');

function extractWindowFromQuery(query) {
  const afterMatch = query && query.match(/after:(\d+)/);
  const beforeMatch = query && query.match(/before:(\d+)/);
  return {
    after: afterMatch ? Number(afterMatch[1]) * 1000 : 0,
    before: beforeMatch ? Number(beforeMatch[1]) * 1000 : Number.POSITIVE_INFINITY,
  };
}

function makeGmailMessage(id, isoString, subject = 'Subject') {
  return {
    id,
    threadId: `thread-${id}`,
    historyId: `h-${id}`,
    internalDate: String(new Date(isoString).getTime()),
    labelIds: ['INBOX'],
    payload: {
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'To', value: 'Bob <bob@example.com>' },
      ],
      mimeType: 'text/plain',
      body: { data: Buffer.from(`Content for ${id}`).toString('base64') },
    },
  };
}

describe('syncGmailToDriveJsonl', () => {
  let store;
  let listMock;
  let getMock;
  let nowSpy;
  let januaryFolder;
  let rootFolder;
  let folderIndex;
  let fileIndex;
  let idCounter;
  let setPropertyMock;
  let deletePropertyMock;
  let messageStore;
  let capturedQueries;
  let registerMessage;

  const MIME_FOLDER = 'application/vnd.google-apps.folder';

  function createFileMock(name, initialContent = '') {
    const id = `file-${++idCounter}`;
    const file = {
      id,
      name,
      appended: initialContent,
      appendChunk: jest.fn((blob) => {
        file.appended += blob.getDataAsString();
      }),
      getName: () => name,
      getBlob: () => ({
        getDataAsString: () => file.appended,
      }),
      setContent: jest.fn((content) => {
        file.appended = content;
      }),
      getId: () => id,
    };
    fileIndex.set(id, file);
    return file;
  }

  function makeFolder(name, { files = [], subfolders = [] } = {}) {
    const id = `folder-${++idCounter}`;
    const folder = {
      id,
      name,
      files: [...files],
      subfolders: [...subfolders],
      getId: () => id,
      getFoldersByName: (search) => {
        const match = folder.subfolders.find((child) => child.name === search);
        return {
          hasNext: () => Boolean(match),
          next: () => match,
        };
      },
      createFolder: (newName) => {
        const existing = folder.subfolders.find((child) => child.name === newName);
        if (existing) {
          return existing;
        }
        const newFolder = makeFolder(newName);
        folder.subfolders.push(newFolder);
        return newFolder;
      },
      getFolders: () => {
        let index = 0;
        return {
          hasNext: () => index < folder.subfolders.length,
          next: () => folder.subfolders[index++],
        };
      },
      getFilesByName: (search) => {
        const entry = folder.files.find((item) => item.name === search);
        return {
          hasNext: () => Boolean(entry),
          next: () => entry && entry.file,
        };
      },
      createFile: (fileName, content = '') => {
        const file = createFileMock(fileName, content);
        folder.files.push({ id: file.id, name: fileName, file });
        return file;
      },
      getFiles: () => {
        let index = 0;
        return {
          hasNext: () => index < folder.files.length,
          next: () => folder.files[index++].file,
        };
      },
    };
    folderIndex.set(id, folder);
    return folder;
  }

  beforeEach(() => {
    jest.resetModules();
    folderIndex = new Map();
    fileIndex = new Map();
    idCounter = 0;
    messageStore = new Map();
    capturedQueries = [];
    store = {
      GMAIL_KNOWLEDGE_TARGET_FOLDER_ID: 'root123',
      GMAIL_KNOWLEDGE_THRESHOLD_DAYS: '180',
    };

    setPropertyMock = jest.fn((key, value) => {
      store[key] = value;
    });
    deletePropertyMock = jest.fn((key) => {
      delete store[key];
    });

    const properties = {
      getProperty: (key) => store[key],
      setProperty: setPropertyMock,
      deleteProperty: deletePropertyMock,
    };

    global.PropertiesService = {
      getScriptProperties: () => properties,
    };

    global.Utilities = createUtilitiesMock();

    delete require.cache[configPath];
    delete require.cache[loggerPath];
    delete require.cache[drivePath];
    delete require.cache[parserPath];
    delete require.cache[mainPath];

    require(configPath);
    require(loggerPath);
    require(drivePath);
    require(parserPath);

    januaryFolder = makeFolder('2024-01');
    const yearFolder = makeFolder('2024', { subfolders: [januaryFolder] });
    rootFolder = makeFolder('root', { subfolders: [yearFolder] });
    folderIndex.set('root123', rootFolder);

    const driveListImpl = ({ q }) => {
      const parentMatch = q && q.match(/'([^']+)' in parents/);
      const nameMatch = q && q.match(/name='([^']+)'/);
      const mimeMatch = q && q.match(/mimeType='([^']+)'/);
      if (!parentMatch || !nameMatch) {
        return { files: [] };
      }
      const parentId = parentMatch[1];
      const name = nameMatch[1];
      const parent = folderIndex.get(parentId);
      if (!parent) {
        return { files: [] };
      }
      if (mimeMatch && mimeMatch[1] === MIME_FOLDER) {
        const match = parent.subfolders.find((child) => child.name === name);
        return { files: match ? [{ id: match.getId() }] : [] };
      }
      const match = parent.files.find((item) => item.name === name);
      return { files: match ? [{ id: match.id }] : [] };
    };

    const driveCreateImpl = (resource, blob) => {
      const parentId = resource && resource.parents && resource.parents[0];
      const parent = folderIndex.get(parentId);
      if (!parent) {
        throw new Error('Parent folder not found in test harness');
      }
      if (resource.mimeType === MIME_FOLDER) {
        const folder = makeFolder(resource.name);
        parent.subfolders.push(folder);
        return { id: folder.getId() };
      }
      const file = createFileMock(resource.name, blob ? blob.getDataAsString() : '');
      parent.files.push({ id: file.id, name: resource.name, file });
      return { id: file.id };
    };

    global.Drive = { Files: { list: jest.fn(driveListImpl), create: jest.fn(driveCreateImpl) } };
    global.DriveApp = {
      getFolderById: jest.fn((id) => folderIndex.get(id)),
      getFileById: jest.fn((id) => fileIndex.get(id)),
    };

    const message = makeGmailMessage('m-1', '2024-01-02T10:00:00Z');

    registerMessage = (msg) => {
      messageStore.set(msg.id, msg);
    };

    registerMessage(message);

    listMock = jest.fn((_, options = {}) => {
      const { q, maxResults = 100 } = options;
      capturedQueries.push(q);
      const window = extractWindowFromQuery(q);
      const sorted = Array.from(messageStore.values())
        .filter((msg) => {
          const ts = Number(msg.internalDate);
          return ts > window.after && ts < window.before;
        })
        .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
      const limited = sorted.slice(0, maxResults);
      const hasMore = sorted.length > limited.length;
      return {
        messages: limited.map((msg) => ({ id: msg.id })),
        nextPageToken: hasMore ? 'token-next' : null,
      };
    });
    getMock = jest.fn((_, id) => messageStore.get(id));

    global.__registerMessage = registerMessage;

    global.Gmail = {
      Users: {
        Messages: {
          list: listMock,
          get: getMock,
        },
      },
    };

    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-02-01T00:00:00Z').getTime());
  });

  afterEach(() => {
    nowSpy.mockRestore();
    delete global.PropertiesService;
    delete global.Utilities;
    delete global.Drive;
    delete global.DriveApp;
    delete global.Gmail;
    delete global.__registerMessage;
    delete global.logger;
    delete global.CONFIG_KEYS;
    delete global.DEFAULTS;
    delete global.TARGET_FOLDER_ID;
    delete global.THRESHOLD_DAYS;
    delete global.LOG_LEVEL;
    delete global.getOrCreateFile;
    delete global.appendJsonl;
    delete global.ensureFolderPath;
    delete global.extractLatestTimestampFromFile;
    delete global.getLatestSyncedTimestamp;
    delete global.extractTimestampBoundsFromFile;
    delete global.getSyncedTimestampRange;
    delete global.headerValue;
    delete global.parseAddress;
    delete global.splitAddresses;
    delete global.decodeBody;
    delete global.stripHtml;
    delete global.extractPlainText;
    delete global.cleanBody;
    delete global.guessLang;
    delete global.formatDateForGmail;
    delete global.formatTimestampForGmail;
    delete global.buildGmailQuery;
    delete global.parseMessage;
    delete global.getMessageTimestamp;
    delete global.isLikelyPersonal;
  });

  it('downloads newest Gmail messages and updates processedEmails.jsonl', () => {
    const { syncGmailToDriveJsonl } = require(mainPath);
    const written = syncGmailToDriveJsonl();

    expect(written).toBe(1);
    const iterator = januaryFolder.getFilesByName('2024-01-02.jsonl');
    expect(iterator.hasNext()).toBe(true);
    const savedFile = iterator.next();
    expect(savedFile.appended).toContain('"message_id":"m-1"');
    expect(savedFile.appended).toContain('"folder_parts":["2024","2024-01"]');
    const processedIterator = rootFolder.getFilesByName('processedEmails.jsonl');
    expect(processedIterator.hasNext()).toBe(true);
    const processedFile = processedIterator.next();
    const lines = processedFile.appended.trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.gmail_id).toBe('m-1');
    expect(record.received_at).toBe('2024-01-02T10:00:00.000Z');
    expect(record.received_internaldate_ms).toBe(new Date('2024-01-02T10:00:00Z').getTime());
    expect(setPropertyMock).not.toHaveBeenCalled();
    expect(deletePropertyMock).not.toHaveBeenCalled();
    const [, queryOptions] = listMock.mock.calls[0];
    expect(queryOptions).toMatchObject({ includeSpamTrash: false, maxResults: 30 });
    expect(queryOptions.q).not.toContain('before:');
    expect(getMock).toHaveBeenCalledWith('me', 'm-1', { format: 'full' });
  });

  it('fetches newer messages first and backfills older ones when capacity remains', () => {
    const processedLines = [
      {
        gmail_id: 'm-existing-newer',
        received_internaldate_ms: new Date('2024-01-02T10:00:00Z').getTime(),
        received_at: '2024-01-02T10:00:00.000Z',
      },
      {
        gmail_id: 'm-existing-older',
        received_internaldate_ms: new Date('2024-01-01T12:00:00Z').getTime(),
        received_at: '2024-01-01T12:00:00.000Z',
      },
    ];
    const processedContent = `${processedLines.map((line) => JSON.stringify(line)).join('\n')}\n`;
    const processedFile = createFileMock('processedEmails.jsonl', processedContent);
    rootFolder.files.push({ id: processedFile.id, name: processedFile.name, file: processedFile });

    messageStore.clear();
    registerMessage(makeGmailMessage('m-new', '2024-01-03T09:00:00Z', 'Nowa rozmowa'));
    registerMessage(makeGmailMessage('m-old', '2023-12-31T08:00:00Z', 'Starsza rozmowa'));

    const { syncGmailToDriveJsonl } = require(mainPath);
    const written = syncGmailToDriveJsonl();

    expect(written).toBe(2);

    const januaryNewIterator = januaryFolder.getFilesByName('2024-01-03.jsonl');
    expect(januaryNewIterator.hasNext()).toBe(true);
    const januaryNewFile = januaryNewIterator.next();
    expect(januaryNewFile.appended).toContain('"message_id":"m-new"');

    const decemberFolderIterator = rootFolder.getFoldersByName('2023');
    expect(decemberFolderIterator.hasNext()).toBe(true);
    const year2023 = decemberFolderIterator.next();
    const decemberIterator = year2023.getFoldersByName('2023-12');
    expect(decemberIterator.hasNext()).toBe(true);
    const decemberFolder = decemberIterator.next();
    const decemberFileIterator = decemberFolder.getFilesByName('2023-12-31.jsonl');
    expect(decemberFileIterator.hasNext()).toBe(true);
    const decemberFile = decemberFileIterator.next();
    expect(decemberFile.appended).toContain('"message_id":"m-old"');

    const processedIterator = rootFolder.getFilesByName('processedEmails.jsonl');
    expect(processedIterator.hasNext()).toBe(true);
    const updatedProcessed = processedIterator.next();
    const updatedLines = updatedProcessed.appended.trim().split('\n').map((line) => JSON.parse(line));
    expect(updatedLines.map((entry) => entry.gmail_id)).toEqual([
      'm-new',
      'm-existing-newer',
      'm-existing-older',
      'm-old',
    ]);

    const forwardAfterSeconds = Math.floor(new Date('2024-01-02T10:00:00Z').getTime() / 1000);
    expect(capturedQueries.some((q) => q.includes(`after:${forwardAfterSeconds}`))).toBe(true);
    const beforeSeconds = Math.floor(new Date('2024-01-01T12:00:00Z').getTime() / 1000);
    expect(capturedQueries.some((q) => q.includes(`before:${beforeSeconds}`))).toBe(true);
    expect(setPropertyMock).not.toHaveBeenCalled();
    expect(deletePropertyMock).not.toHaveBeenCalled();
  });

  it('skips messages that are already recorded in processedEmails.jsonl', () => {
    const processedRecords = [
      {
        gmail_id: 'm-dup',
        received_internaldate_ms: new Date('2024-01-05T09:00:00Z').getTime(),
        received_at: '2024-01-05T09:00:00.000Z',
      },
    ];
    const processedFile = createFileMock(
      'processedEmails.jsonl',
      `${processedRecords.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    rootFolder.files.push({ id: processedFile.id, name: processedFile.name, file: processedFile });

    messageStore.clear();
    registerMessage(makeGmailMessage('m-dup', '2024-01-06T08:00:00Z', 'Duplikat'));
    registerMessage(makeGmailMessage('m-fresh', '2024-01-07T07:30:00Z', 'Nowa wiadomość'));

    const { syncGmailToDriveJsonl } = require(mainPath);
    const written = syncGmailToDriveJsonl();

    expect(written).toBe(1);
    expect(getMock).not.toHaveBeenCalledWith('me', 'm-dup', expect.any(Object));

    const januaryIterator = januaryFolder.getFilesByName('2024-01-07.jsonl');
    expect(januaryIterator.hasNext()).toBe(true);
    const januaryFile = januaryIterator.next();
    expect(januaryFile.appended).toContain('"message_id":"m-fresh"');
    expect(januaryFile.appended).not.toContain('"message_id":"m-dup"');

    const processedIterator = rootFolder.getFilesByName('processedEmails.jsonl');
    expect(processedIterator.hasNext()).toBe(true);
    const updatedProcessed = processedIterator.next();
    const updatedIds = updatedProcessed.appended.trim().split('\n').map((line) => JSON.parse(line).gmail_id);
    expect(updatedIds).toEqual(['m-fresh', 'm-dup']);
  });
});
