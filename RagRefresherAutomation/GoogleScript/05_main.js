function syncRagFromDrive() {
  return RagRefresher.syncRagFromDrive();
}

const RagRefresher = (() => {
  const configModule = typeof require !== 'undefined' ? require('./01_config') : globalThis;
  const driveModule =
    (typeof globalThis !== 'undefined' && globalThis.Drive) ||
    (typeof require !== 'undefined' ? require('./03_drive') : {});
  const vertexModule =
    (typeof globalThis !== 'undefined' && globalThis.Vertex) ||
    (typeof require !== 'undefined' ? require('./04_vertex') : {});

  const getConfig = configModule.getConfig || (typeof globalThis.getConfig === 'function' ? globalThis.getConfig : undefined);
  const resolveProperties =
    configModule.resolveProperties ||
    (typeof globalThis.resolveProperties === 'function' ? globalThis.resolveProperties : undefined);
  const CONFIG_KEYS = configModule.CONFIG_KEYS || (typeof globalThis.CONFIG_KEYS !== 'undefined' ? globalThis.CONFIG_KEYS : {});

  const logError =
    (typeof globalThis.logError === 'function' ? globalThis.logError : null) ||
    (msg => console.error(`[Error] ${msg}`));
  const logWarning =
    (typeof globalThis.logWarning === 'function' ? globalThis.logWarning : null) ||
    (msg => console.warn(`[Warning] ${msg}`));
  const logInfo =
    (typeof globalThis.logInfo === 'function' ? globalThis.logInfo : null) ||
    (msg => console.log(`[Information] ${msg}`));
  const logDebug =
    (typeof globalThis.logDebug === 'function' ? globalThis.logDebug : null) ||
    (msg => console.debug ? console.debug(`[Debug] ${msg}`) : console.log(`[Debug] ${msg}`));

  const listAllFileIdsRecursively = driveModule.listAllFileIdsRecursively || globalThis.listAllFileIdsRecursively;
  const listRagFiles = vertexModule.listRagFiles || globalThis.listRagFiles;
  const deleteRagFile = vertexModule.deleteRagFile || globalThis.deleteRagFile;
  const importRagFiles = vertexModule.importRagFiles || globalThis.importRagFiles;
  const checkOperationStatus = vertexModule.checkOperationStatus || globalThis.checkOperationStatus;

  const MAX_RESOURCE_IDS_PER_IMPORT = 25;

  function chunkIntoBatches(items, batchSize) {
    if (!Array.isArray(items) || batchSize <= 0) {
      return [];
    }

    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  function parseStoredOperationNames(rawValue) {
    if (!rawValue) {
      return [];
    }

    if (typeof rawValue === 'string') {
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
          return parsed.filter(name => typeof name === 'string' && name.trim() !== '');
        }
      } catch (err) {
        // Treat as plain string fallback below.
      }

      return rawValue.trim() ? [rawValue.trim()] : [];
    }

    if (Array.isArray(rawValue)) {
      return rawValue.filter(name => typeof name === 'string' && name.trim() !== '');
    }

    return [];
  }

  function serializeOperationNames(operationNames) {
    return JSON.stringify(operationNames.filter(name => typeof name === 'string' && name.trim() !== ''));
  }

  function createRagFileIndex(ragFiles) {
    const byDriveId = new Map();

    ragFiles.forEach(file => {
      const source = file && file.googleDriveSource;
      if (!source || !Array.isArray(source.resourceIds)) {
        return;
      }

      source.resourceIds.forEach(resource => {
        if (!resource || resource.resourceType !== 'RESOURCE_TYPE_FILE' || !resource.resourceId) {
          return;
        }

        const entry = {
          ragFileName: file.name,
          driveId: resource.resourceId,
          createTime: file.createTime || '',
          updateTime: file.updateTime || '',
        };

        if (!byDriveId.has(resource.resourceId)) {
          byDriveId.set(resource.resourceId, [entry]);
        } else {
          byDriveId.get(resource.resourceId).push(entry);
        }
      });
    });

    return byDriveId;
  }

  function pickRagFilesToDeleteByDriveId(entries) {
    if (!entries || entries.length <= 1) {
      return [];
    }

    const copy = entries.slice();
    copy.sort((a, b) => {
      const aTime = a.updateTime || a.createTime || '';
      const bTime = b.updateTime || b.createTime || '';
      if (aTime === bTime) {
        return 0;
      }
      return aTime > bTime ? -1 : 1;
    });

    return copy.slice(1);
  }

  function syncRagFromDrive_() {
    const config = getConfig ? getConfig() : {};
    const props = resolveProperties ? resolveProperties() : null;

    if (!config.projectId || !config.corpusId || !config.rootFolderId) {
      logError('Brak wymaganej konfiguracji (projectId, corpusId lub rootFolderId).');
      return;
    }

    const storedOperationsRaw = props ? props.getProperty(CONFIG_KEYS.activeOperation) : null;
    const storedOperations = parseStoredOperationNames(storedOperationsRaw);
    const pendingOperations = [];

    storedOperations.forEach(operationName => {
      const status = checkOperationStatus ? checkOperationStatus(config, operationName) : { done: true };
      if (!status.done) {
        pendingOperations.push(operationName);
        return;
      }

      if (status.error) {
        logWarning(`Poprzednia operacja zakończona z błędem: ${status.error}`);
      }
    });

    if (pendingOperations.length > 0) {
      logInfo(`Operacje w toku (${pendingOperations.join(', ')}) – pomijam synchronizację.`);
      if (props) {
        props.setProperty(CONFIG_KEYS.activeOperation, serializeOperationNames(pendingOperations));
      }
      return;
    }

    if (props && storedOperationsRaw) {
      props.deleteProperty(CONFIG_KEYS.activeOperation);
    }

    const fileIds = listAllFileIdsRecursively ? listAllFileIdsRecursively(config.rootFolderId) : [];
    const fileIdSet = new Set(fileIds);

    const ragFilesResult = listRagFiles ? listRagFiles(config) : { success: true, ragFiles: [] };
    if (!ragFilesResult.success) {
      logError(`Nie udało się pobrać listy plików z Vertex AI (${ragFilesResult.code}): ${ragFilesResult.body}`);
      return;
    }

    const ragFilesIndex = createRagFileIndex(ragFilesResult.ragFiles || []);
    const filesToImport = fileIds.filter(id => !ragFilesIndex.has(id));
    const ragFilesToDelete = [];

    ragFilesIndex.forEach((entries, driveId) => {
      if (!fileIdSet.has(driveId)) {
        entries.forEach(entry => {
          if (entry.ragFileName) {
            ragFilesToDelete.push({ ragFileName: entry.ragFileName, driveId });
          }
        });
        return;
      }

      const duplicates = pickRagFilesToDeleteByDriveId(entries);
      duplicates.forEach(entry => {
        if (entry.ragFileName) {
          ragFilesToDelete.push({ ragFileName: entry.ragFileName, driveId });
        }
      });
    });

    if (filesToImport.length === 0 && ragFilesToDelete.length === 0) {
      logInfo('Brak zmian w plikach – pomijam synchronizację.');
      return;
    }

    logDebug(`Zebrano ${fileIds.length} plików na Dysku. Nowe: ${filesToImport.length}, do usunięcia: ${ragFilesToDelete.length}.`);

    const newOperations = [];
    const updateActiveOperations = () => {
      if (!props) {
        return;
      }

      if (newOperations.length > 0) {
        props.setProperty(CONFIG_KEYS.activeOperation, serializeOperationNames(newOperations));
      } else {
        props.deleteProperty(CONFIG_KEYS.activeOperation);
      }
    };

    ragFilesToDelete.forEach(item => {
      const result = deleteRagFile ? deleteRagFile(config, item.ragFileName) : { success: false };
      if (!result.success) {
        logError(`Błąd usuwania pliku ${item.driveId || item.ragFileName} (${result.code}): ${result.body}`);
        return;
      }

      logInfo(`Usuwanie pliku ${item.driveId || item.ragFileName} rozpoczęte (${result.operationName}).`);
      if (result.operationName) {
        newOperations.push(result.operationName);
      }
    });

    if (filesToImport.length > 0) {
      const batches = chunkIntoBatches(filesToImport, MAX_RESOURCE_IDS_PER_IMPORT);

      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        const importResult = importRagFiles ? importRagFiles(config, batch) : { success: false };

        if (!importResult.success) {
          const suffix = batches.length > 1 ? ` (partia ${index + 1}/${batches.length})` : '';
          logError(`Błąd importu${suffix} (${importResult.code}): ${importResult.body}`);
          continue;
        }

        logInfo(
          batches.length > 1
            ? `Import partii ${index + 1}/${batches.length} (${batch.length} plików) rozpoczęty: ${importResult.operationName}`
            : `Import nowych plików rozpoczęty: ${importResult.operationName}`,
        );

        if (importResult.operationName) {
          newOperations.push(importResult.operationName);
          updateActiveOperations();
          logInfo('Oczekiwanie na zakończenie bieżącej operacji importu przed uruchomieniem kolejnych partii.');
          return;
        }
      }
    }

    updateActiveOperations();
  }

  return {
    syncRagFromDrive: syncRagFromDrive_,
    parseStoredOperationNames,
    serializeOperationNames,
    createRagFileIndex,
    pickRagFilesToDeleteByDriveId,
    chunkIntoBatches,
    MAX_RESOURCE_IDS_PER_IMPORT,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = RagRefresher;
} else {
  this.RagRefresher = RagRefresher;
}
