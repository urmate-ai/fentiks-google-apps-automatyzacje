const {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  getConfig,
  normalizeLogLevel,
} = require('../GoogleScript/01_config');

const { listAllFileIdsRecursively } = require('../GoogleScript/03_drive');
const {
  buildImportUrl,
  buildResourceIds,
  buildListUrl,
  listRagFiles,
  buildDeleteUrl,
  deleteRagFile,
} = require('../GoogleScript/04_vertex');
const {
  parseStoredOperationNames,
  serializeOperationNames,
  createRagFileIndex,
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
    expect(config.corpusId).toBe(CONFIG_DEFAULTS.corpusId);
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
  test('buildResourceIds tworzy poprawne obiekty', () => {
    expect(buildResourceIds(['1', '2'])).toEqual([
      { resourceType: 'RESOURCE_TYPE_FILE', resourceId: '1' },
      { resourceType: 'RESOURCE_TYPE_FILE', resourceId: '2' },
    ]);
  });

  test('buildImportUrl poprawnie koduje parametry', () => {
    const url = buildImportUrl({
      projectId: 'my project',
      location: 'europe-west3',
      corpusId: '123/456',
    });

    expect(url).toBe('https://europe-west3-aiplatform.googleapis.com/v1/projects/my%20project/locations/europe-west3/ragCorpora/123%2F456/ragFiles:import');
  });

  test('buildListUrl dodaje token strony', () => {
    const base = buildListUrl({
      projectId: 'p',
      location: 'europe-west3',
      corpusId: 'c',
    });

    const withToken = buildListUrl({
      projectId: 'p',
      location: 'europe-west3',
      corpusId: 'c',
    }, 'token/123');

    expect(base).toBe('https://europe-west3-aiplatform.googleapis.com/v1/projects/p/locations/europe-west3/ragCorpora/c/ragFiles');
    expect(withToken).toBe('https://europe-west3-aiplatform.googleapis.com/v1/projects/p/locations/europe-west3/ragCorpora/c/ragFiles?pageToken=token%2F123');
  });

  test('listRagFiles łączy wyniki z wielu stron', () => {
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
      new FakeResponse(200, JSON.stringify({ ragFiles: [{ name: 'rag1' }], nextPageToken: 'next' })),
      new FakeResponse(200, JSON.stringify({ ragFiles: [{ name: 'rag2' }] })),
    ];

    const fetcher = {
      fetch: jest.fn(() => responses.shift()),
    };

    const scriptApp = {
      getOAuthToken: jest.fn(() => 'token'),
    };

    const result = listRagFiles({ projectId: 'p', location: 'europe-west3', corpusId: 'c' }, fetcher, scriptApp);

    expect(result.success).toBe(true);
    expect(result.ragFiles.map(file => file.name)).toEqual(['rag1', 'rag2']);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  test('buildDeleteUrl zachowuje pełną nazwę zasobu', () => {
    const url = buildDeleteUrl({ projectId: 'p', location: 'europe-west3', corpusId: 'c' }, 'projects/p/locations/europe-west3/ragCorpora/c/ragFiles/rf%2F1');
    expect(url).toBe('https://europe-west3-aiplatform.googleapis.com/v1/projects/p/locations/europe-west3/ragCorpora/c/ragFiles/rf%2F1');
  });

  test('deleteRagFile zwraca błąd dla niepowodzenia HTTP', () => {
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

    const result = deleteRagFile({ projectId: 'p', location: 'europe-west3', corpusId: 'c' }, 'projects/p/locations/europe-west3/ragCorpora/c/ragFiles/rf1', fetcher, scriptApp);

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

  test('createRagFileIndex grupuje pliki według Drive ID', () => {
    const ragFiles = [
      {
        name: 'rag1',
        updateTime: '2025-01-02T00:00:00Z',
        googleDriveSource: {
          resourceIds: [
            { resourceType: 'RESOURCE_TYPE_FILE', resourceId: 'file1' },
          ],
        },
      },
      {
        name: 'rag2',
        updateTime: '2025-01-03T00:00:00Z',
        googleDriveSource: {
          resourceIds: [
            { resourceType: 'RESOURCE_TYPE_FILE', resourceId: 'file1' },
          ],
        },
      },
      {
        name: 'rag3',
        googleDriveSource: {
          resourceIds: [
            { resourceType: 'RESOURCE_TYPE_FOLDER', resourceId: 'folder1' },
          ],
        },
      },
    ];

    const index = createRagFileIndex(ragFiles);

    expect(index.get('file1')).toHaveLength(2);
    expect(index.has('folder1')).toBe(false);

    const duplicates = pickRagFilesToDeleteByDriveId(index.get('file1'));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].ragFileName).toBe('rag1');
  });
});
