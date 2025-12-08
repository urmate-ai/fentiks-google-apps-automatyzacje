const DriveHelpers = (() => {
  const logger = (typeof globalThis !== 'undefined' && globalThis.logger)
    || (typeof require !== 'undefined' ? require('./02_logger') : console);

  const MIME_FOLDER = 'application/vnd.google-apps.folder';

  function toFolderId(folderOrId) {
    if (!folderOrId) {
      throw new Error('Folder reference is required');
    }
    if (typeof folderOrId === 'string') {
      return folderOrId;
    }
    if (typeof folderOrId.getId === 'function') {
      return folderOrId.getId();
    }
    throw new Error('Unsupported folder reference provided');
  }

  function escapeForDriveQuery(value) {
    return String(value || '').replace(/['\\]/g, '\\$&');
  }

  function findFileInFolder(folderId, name) {
    const escaped = escapeForDriveQuery(name);
    const response = Drive.Files.list({
      q: `'${escapeForDriveQuery(folderId)}' in parents and name='${escaped}' and trashed=false`,
      pageSize: 1,
      fields: 'files(id)',
    });
    const files = (response && response.files) || [];
    return files.length ? files[0].id : null;
  }

  function createFile(folderId, name, content, mimeType) {
    logger.info('Tworzę plik na Dysku', folderId, name);
    const blob = Utilities.newBlob(content, mimeType, name);
    const created = Drive.Files.create({
      name,
      parents: [folderId],
    }, blob);
    return created && created.id;
  }

  function updateFile(fileId, content, mimeType) {
    logger.info('Aktualizuję plik na Dysku', fileId);
    const blob = Utilities.newBlob(content, mimeType);
    Drive.Files.update({}, fileId, blob);
  }

  function getOrCreateFile(folder, name, content, mimeType) {
    const folderId = toFolderId(folder);
    const existingId = findFileInFolder(folderId, name);
    if (existingId) {
      logger.info('Plik już istnieje, aktualizuję', name, `id=${existingId}`);
      updateFile(existingId, content, mimeType);
      const existingFile = DriveApp.getFileById(existingId);
      if (existingFile && typeof existingFile.getId !== 'function') {
        existingFile.getId = () => existingId;
      }
      return existingFile;
    }
    const newId = createFile(folderId, name, content, mimeType);
    if (!newId) {
      throw new Error(`Nie udało się utworzyć pliku ${name}`);
    }
    logger.info('Utworzono nowy plik', name, `id=${newId}`);
    const newFile = DriveApp.getFileById(newId);
    if (newFile && typeof newFile.getId !== 'function') {
      newFile.getId = () => newId;
    }
    return newFile;
  }

  function getFolderById(folderId) {
    if (!folderId) {
      throw new Error('TARGET_FOLDER_ID is not configured');
    }
    try {
      return DriveApp.getFolderById(folderId);
    } catch (error) {
      logger.error('Nie udało się pobrać folderu', folderId, error);
      throw new Error(`Nie można uzyskać dostępu do folderu ${folderId}: ${error.message}`);
    }
  }

  return {
    MIME_FOLDER,
    toFolderId,
    escapeForDriveQuery,
    findFileInFolder,
    createFile,
    updateFile,
    getOrCreateFile,
    getFolderById,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.DriveHelpers = DriveHelpers;
}

if (typeof module !== 'undefined') {
  module.exports = DriveHelpers;
}
