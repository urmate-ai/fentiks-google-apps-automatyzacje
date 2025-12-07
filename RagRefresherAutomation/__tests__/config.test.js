const {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  getConfig,
  normalizeLogLevel,
} = require('../GoogleScript/01_config');

const { listAllFileIdsRecursively } = require('../GoogleScript/03_drive');
const {
  buildImportUrl,
  buildListUrl,
  listDocuments,
  buildDeleteUrl,
  deleteDocument,
  buildDocumentsBaseUrl,
  importDocuments,
} = require('../GoogleScript/04_vertex');
const {
  parseStoredOperationNames,
  serializeOperationNames,
  createDocumentIndex,
  pickRagFilesToDeleteByDriveId,
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

    expect(url).toBe('https://europe-west3-discoveryengine.googleapis.com/v1/projects/my%20project/locations/europe-west3/collections/default_collection/dataStores/123%2F456/branches/default_branch/documents:import');
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

    expect(base).toBe('https://europe-west3-discoveryengine.googleapis.com/v1/projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents');
    expect(withToken).toBe('https://europe-west3-discoveryengine.googleapis.com/v1/projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents?pageToken=token%2F123');
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

    const result = listDocuments({ projectId: 'p', location: 'europe-west3', dataStoreId: 'c' }, fetcher, scriptApp);

    expect(result.success).toBe(true);
    expect(result.documents.map(file => file.name)).toEqual(['doc1', 'doc2']);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  test('buildDeleteUrl zachowuje pełną nazwę zasobu', () => {
    const url = buildDeleteUrl({ projectId: 'p', location: 'europe-west3', dataStoreId: 'c' }, 'projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents/doc%2F1');
    expect(url).toBe('https://europe-west3-discoveryengine.googleapis.com/v1/projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents/doc%2F1');
  });

  test('deleteDocument zwraca błąd dla niepowodzenia HTTP', () => {
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

    const fetcher = {
      fetch: jest.fn(() => new FakeResponse(500, 'error')),
    };

    const scriptApp = {
      getOAuthToken: jest.fn(() => 'token'),
    };

    const result = deleteDocument({ projectId: 'p', location: 'europe-west3', dataStoreId: 'c' }, 'projects/p/locations/europe-west3/collections/default_collection/dataStores/c/branches/default_branch/documents/doc1', fetcher, scriptApp);

    expect(result.success).toBe(false);
    expect(result.code).toBe(500);
    expect(result.body).toBe('error');
  });
});

describe('Main helpers', () => {
  test('parseStoredOperationNames obsługuje JSON i zwykły tekst', () => {
    expect(parseStoredOperationNames('["op1","op2"]')).toEqual(['op1', 'op2']);
    expect(parseStoredOperationNames('  single-op  ')).toEqual(['single-op']);
    expect(parseStoredOperationNames(null)).toEqual([]);
  });

  test('serializeOperationNames filtruje puste wpisy', () => {
    expect(serializeOperationNames(['op1', '', '  ', 'op2'])).toBe('["op1","op2"]');
  });

  test('createDocumentIndex grupuje pliki według Drive ID', () => {
    const docs = [
      {
        name: 'doc1',
        updateTime: '2025-01-02T00:00:00Z',
        structData: { driveId: 'file1' },
      },
      {
        name: 'doc2',
        updateTime: '2025-01-03T00:00:00Z',
        googleDriveSource: {
          resourceIds: [
            { resourceType: 'RESOURCE_TYPE_FILE', resourceId: 'file1' },
          ],
        },
      },
      {
        name: 'doc3',
        googleDriveSource: {
          resourceIds: [
            { resourceType: 'RESOURCE_TYPE_FOLDER', resourceId: 'folder1' },
          ],
        },
      },
    ];

    const index = createDocumentIndex(docs);

    expect(index.get('file1')).toHaveLength(2);
    expect(index.has('folder1')).toBe(false);

    const duplicates = pickRagFilesToDeleteByDriveId(index.get('file1'));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].documentName).toBe('doc1');
  });
});
