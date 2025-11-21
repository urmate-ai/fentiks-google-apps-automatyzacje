jest.mock('../GoogleScript/01_config', () => ({
  CONFIG_KEYS: { activeOperation: 'ACTIVE_OPERATION' },
  getConfig: jest.fn(),
  resolveProperties: jest.fn(),
}));

jest.mock('../GoogleScript/03_drive', () => ({
  listAllFileIdsRecursively: jest.fn(),
}));

jest.mock('../GoogleScript/04_vertex', () => ({
  listRagFiles: jest.fn(),
  deleteRagFile: jest.fn(),
  importRagFiles: jest.fn(),
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
      corpusId: 'corpus',
      rootFolderId: 'root-folder',
      location: 'europe-west3',
    });
    configModule.resolveProperties.mockReturnValue(propsMock);

    driveModule.listAllFileIdsRecursively.mockReturnValue([]);

    vertexModule.listRagFiles.mockReturnValue({ success: true, ragFiles: [] });
    vertexModule.deleteRagFile.mockReturnValue({ success: true, operationName: 'delete-op' });
    vertexModule.importRagFiles.mockReturnValue({ success: true, operationName: 'import-op' });
    vertexModule.checkOperationStatus.mockReturnValue({ done: true });
  });

  it('wysyła tylko pierwszą partię importu i ustawia activeOperation', () => {
    const fileIds = Array.from({ length: 30 }, (_, index) => `file-${index + 1}`);
    driveModule.listAllFileIdsRecursively.mockReturnValue(fileIds);

    vertexModule.importRagFiles.mockImplementation((_, ids) => ({
      success: true,
      operationName: `import-${ids.length}`,
    }));

    RagRefresher.syncRagFromDrive();

    expect(vertexModule.importRagFiles).toHaveBeenCalledTimes(1);
    expect(vertexModule.importRagFiles).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      fileIds.slice(0, 25),
    );

    expect(propsMock.setProperty).toHaveBeenCalledWith(
      configModule.CONFIG_KEYS.activeOperation,
      JSON.stringify(['import-25']),
    );
  });

  it('dołącza operacje usuwania i importu do activeOperation', () => {
    const driveFiles = ['drive-1', 'drive-2'];
    driveModule.listAllFileIdsRecursively.mockReturnValue(driveFiles);

    vertexModule.listRagFiles.mockReturnValue({
      success: true,
      ragFiles: [
        {
          name: 'rag-old-1',
          createTime: '2023-01-01T00:00:00Z',
          googleDriveSource: {
            resourceIds: [
              { resourceType: 'RESOURCE_TYPE_FILE', resourceId: 'drive-1' },
            ],
          },
        },
        {
          name: 'rag-old-2',
          createTime: '2023-01-02T00:00:00Z',
          googleDriveSource: {
            resourceIds: [
              { resourceType: 'RESOURCE_TYPE_FILE', resourceId: 'drive-1' },
            ],
          },
        },
      ],
    });

    vertexModule.deleteRagFile.mockReturnValue({ success: true, operationName: 'delete-op' });
    vertexModule.importRagFiles.mockReturnValue({ success: true, operationName: 'import-op' });

    RagRefresher.syncRagFromDrive();

    expect(vertexModule.deleteRagFile).toHaveBeenCalledWith(
      expect.any(Object),
      'rag-old-1',
    );
    expect(vertexModule.importRagFiles).toHaveBeenCalledTimes(1);

    expect(propsMock.setProperty).toHaveBeenCalledWith(
      configModule.CONFIG_KEYS.activeOperation,
      JSON.stringify(['delete-op', 'import-op']),
    );
  });
});
