const {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  getConfig,
  normalizeLogLevel,
} = require('../GoogleScript/01_config');

const { listAllFileIdsRecursively } = require('../GoogleScript/03_drive');
const { buildImportUrl, buildListUrl, listDocuments } = require('../GoogleScript/04_vertex');
const {
  parseStoredOperationNames,
  serializeOperationNames,
  createDocumentIndex,
  pickDocumentsToDeleteByDriveId,
} = require('../GoogleScript/05_main');

describe('konfiguracja', () => {
  test('normalizeLogLevel rozpoznaje wielkość liter', () => {
    expect(normalizeLogLevel('debug', CONFIG_DEFAULTS.logLevel)).toBe('Debug');
    expect(normalizeLogLevel('WARNING', CONFIG_DEFAULTS.logLevel)).toBe('Warning');
    expect(normalizeLogLevel(undefined, CONFIG_DEFAULTS.logLevel)).toBe(CONFIG_DEFAULTS.logLevel);
  });

  test('getConfig łączy wartości z właściwości i domyślne', () => {
    const props = {
      [CONFIG_KEYS.projectId]: 'project-123',
      [CONFIG_KEYS.location]: 'us-central1',
    };

    const config = getConfig(props);

    expect(config.projectId).toBe('project-123');
    expect(config.location).toBe('us-central1');
    expect(config.dataStoreId).toBe(CONFIG_DEFAULTS.dataStoreId);
    expect(config.logLevel).toBe(CONFIG_DEFAULTS.logLevel);
  });
});

describe('Drive helpers', () => {
  class FakeIterator {
    constructor(items) {
      this.items = items;
      this.index = 0;
    }

    hasNext() {
      return this.index < this.items.length;
    }

    next() {
      return this.items[this.index++];
    }
  }

  class FakeFile {
    constructor(id, trashed = false, name = null) {
      this.id = id;
      this.trashed = trashed;
      this.name = name || id;
    }

    isTrashed() {
      return this.trashed;
    }

    getId() {
      return this.id;
    }

    getName() {
      return this.name;
    }
  }

  class FakeFolder {
    constructor(id, files = [], folders = [], trashed = false) {
      this.id = id;
      this.files = files;
      this.folders = folders;
      this.trashed = trashed;
    }

    getFiles() {
      return new FakeIterator(this.files);
    }

    getFolders() {
      return new FakeIterator(this.folders);
    }

    isTrashed() {
      return this.trashed;
    }

    getId() {
      return this.id;
    }
  }

  class FakeDrive {
    constructor(folders) {
      this.folders = folders;
    }

    getFolderById(id) {
      const folder = this.folders[id];
      if (!folder) {
        throw new Error(`Folder ${id} nie istnieje`);
      }
      return folder;
    }
  }

  test('listAllFileIdsRecursively zwraca wszystkie pliki z podfolderów', () => {
    const root = new FakeFolder('root', [new FakeFile('f1'), new FakeFile('f2', true)], [new FakeFolder('sub')]);
    const sub = new FakeFolder('sub', [new FakeFile('f3')], []);
    const drive = new FakeDrive({ root, sub });

    const ids = listAllFileIdsRecursively('root', drive);
    expect(ids.sort()).toEqual(['f1', 'f3']);
  });

  test('listAllFileIdsRecursively pomija pliki z listy ignorowanych nazw', () => {
    const root = new FakeFolder(
      'root',
      [new FakeFile('f1'), new FakeFile('f2', false, 'processedEmails.jsonl')],
      [],
    );
    const drive = new FakeDrive({ root });

    const ids = listAllFileIdsRecursively('root', drive);
    expect(ids).toEqual(['f1']);
  });
});

describe('Vertex helpers', () => {
  test('buildImportUrl poprawnie koduje parametry', () => {
    const url = buildImportUrl({
      projectId: 'my project',
      location: 'europe-west3',
      dataStoreId: '123/456',
    });

    expect(url).toBe('https://discoveryengine.googleapis.com/v1/projects/my%20project/locations/europe-west3/collections/default_collection/dataStores/123%2F456/branches/default_branch/documents:import');
  });

  test('buildListUrl dodaje token strony', () => {
    const base = buildListUrl({
      projectId: 'p',
      location: 'europe-west3',
      dataStoreId: 'c',
    });

    const withToken = buildListUrl({
      projectId: 'p',
      location: 'europe-west3',
      dataStoreId: 'c',
    }, 'token/123');

    expect(base).toBe('https://discoveryengine.googleapis.com/v1/projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents');
    expect(withToken).toBe('https://discoveryengine.googleapis.com/v1/projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents?pageToken=token%2F123');
  });

  test('listDocuments łączy wyniki z wielu stron', () => {
    class FakeResponse {
      constructor(code, body) {
        this.code = code;
        this.body = body;
      }

      getResponseCode() {
        return this.code;
      }

      getContentText() {
        return this.body;
      }
    }

    const responses = [
      new FakeResponse(200, JSON.stringify({ documents: [{ name: 'doc1' }], nextPageToken: 'next' })),
      new FakeResponse(200, JSON.stringify({ documents: [{ name: 'doc2' }] })),
    ];

    const fetcher = {
      fetch: jest.fn(() => responses.shift()),
    };

    const scriptApp = {
      getOAuthToken: jest.fn(() => 'token'),
    };

    const config = { projectId: 'p', location: 'l', dataStoreId: 'ds' };

    const result = listDocuments(config, fetcher, scriptApp);

    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    expect(result.documents).toEqual([{ name: 'doc1' }, { name: 'doc2' }]);
  });
});

describe('Operacje importu/serializacji', () => {
  test('parseStoredOperationNames obsługuje JSON i stringi', () => {
    expect(parseStoredOperationNames('["op1", "op2"]')).toEqual(['op1', 'op2']);
    expect(parseStoredOperationNames('op1')).toEqual(['op1']);
    expect(parseStoredOperationNames(['op1', ''])).toEqual(['op1']);
  });

  test('serializeOperationNames filtruje puste', () => {
    expect(serializeOperationNames(['op1', '', 'op2'])).toBe('["op1","op2"]');
  });

  test('createDocumentIndex grupuje po driveId i wyznacza duplikaty', () => {
    const idx = createDocumentIndex([
      {
        name: 'doc-1',
        id: 'drive-1',
        createTime: '2023-01-01',
      },
      {
        name: 'doc-2',
        id: 'drive-2',
      },
      {
        name: 'doc-3',
        id: 'drive-1',
        createTime: '2023-01-03',
      },
    ]);

    expect(Array.from(idx.keys())).toEqual(['drive-1', 'drive-2']);
    expect(idx.get('drive-1').length).toBe(2);
  });

  test('pickDocumentsToDeleteByDriveId zostawia najnowszy', () => {
    const duplicates = pickDocumentsToDeleteByDriveId([
      { documentName: 'old', updateTime: '2023-01-01' },
      { documentName: 'new', updateTime: '2023-02-01' },
    ]);

    expect(duplicates).toEqual([{ documentName: 'old', updateTime: '2023-01-01' }]);
  });
});
