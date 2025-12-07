jest.mock('../GoogleScript/01_config', () => ({
  CONFIG_KEYS: { activeOperation: 'ACTIVE_OPERATION' },
  getConfig: jest.fn(),
  resolveProperties: jest.fn(),
}));

jest.mock('../GoogleScript/03_drive', () => ({
  listAllFileIdsRecursively: jest.fn(),
  readFileContents: jest.fn(),
}));

jest.mock('../GoogleScript/04_vertex', () => ({
  listDocuments: jest.fn(),
  deleteDocument: jest.fn(),
  importDocuments: jest.fn(),
  checkOperationStatus: jest.fn(),
}));

const configModule = require('../GoogleScript/01_config');
const driveModule = require('../GoogleScript/03_drive');
const vertexModule = require('../GoogleScript/04_vertex');

const RagRefresher = require('../GoogleScript/05_main');

describe('RagRefresher.syncRagFromDrive', () => {
  let propsMock;

  beforeEach(() => {
    jest.clearAllMocks();

    propsMock = {
      getProperty: jest.fn(() => null),
      setProperty: jest.fn(),
      deleteProperty: jest.fn(),
    };

    configModule.getConfig.mockReturnValue({
      projectId: 'project',
      dataStoreId: 'datastore',
      rootFolderId: 'root-folder',
      location: 'europe-west3',
    });
    configModule.resolveProperties.mockReturnValue(propsMock);

    driveModule.listAllFileIdsRecursively.mockReturnValue([]);
    driveModule.readFileContents.mockReturnValue([]);

    vertexModule.listDocuments.mockReturnValue({ success: true, documents: [] });
    vertexModule.deleteDocument.mockReturnValue({ success: true, operationName: 'delete-op' });
    vertexModule.importDocuments.mockReturnValue({ success: true, operationName: 'import-op' });
    vertexModule.checkOperationStatus.mockReturnValue({ done: true });
  });

  it('wysyła tylko pierwszą partię importu i ustawia activeOperation przy operacjach asynchronicznych', () => {
    const fileIds = Array.from({ length: 30 }, (_, index) => `file-${index + 1}`);
    driveModule.listAllFileIdsRecursively.mockReturnValue(fileIds);
    driveModule.readFileContents.mockImplementation(ids => ids.map(id => ({ id, content: `content-${id}` })));

    vertexModule.importDocuments.mockImplementation((_, docs) => ({
      success: true,
      operationName: `import-${docs.length}`,
    }));

    RagRefresher.syncRagFromDrive();

    expect(vertexModule.importDocuments).toHaveBeenCalledTimes(1);
    expect(vertexModule.importDocuments).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      fileIds.slice(0, 25).map(id => ({ id, content: `content-${id}` })),
    );

    expect(propsMock.setProperty).toHaveBeenCalledWith(
      configModule.CONFIG_KEYS.activeOperation,
      JSON.stringify(['import-25']),
    );
  });

  it('dołącza operacje usuwania i importu do activeOperation', () => {
    const driveFiles = ['drive-1', 'drive-2'];
    driveModule.listAllFileIdsRecursively.mockReturnValue(driveFiles);

    vertexModule.listDocuments.mockReturnValue({
      success: true,
      documents: [
        {
          name: 'projects/p/locations/l/collections/default_collection/dataStores/ds/branches/default_branch/documents/drive-1',
          id: 'drive-1',
          createTime: '2023-01-01T00:00:00Z',
        },
        {
          name: 'projects/p/locations/l/collections/default_collection/dataStores/ds/branches/default_branch/documents/drive-1-dup',
          id: 'drive-1',
          createTime: '2023-01-02T00:00:00Z',
        },
      ],
    });

    vertexModule.deleteDocument.mockReturnValue({ success: true, operationName: 'delete-op' });
    vertexModule.importDocuments.mockReturnValue({ success: true, operationName: 'import-op' });
    driveModule.readFileContents.mockReturnValue([{ id: 'drive-2', content: 'content-drive-2' }]);

    RagRefresher.syncRagFromDrive();

    expect(vertexModule.deleteDocument).toHaveBeenCalledWith(
      expect.any(Object),
      'projects/p/locations/l/collections/default_collection/dataStores/ds/branches/default_branch/documents/drive-1',
    );
    expect(vertexModule.importDocuments).toHaveBeenCalledTimes(1);

    expect(propsMock.setProperty).toHaveBeenCalledWith(
      configModule.CONFIG_KEYS.activeOperation,
      JSON.stringify(['delete-op', 'import-op']),
    );
  });
});
