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

  function findFileInFolder(folderId, name, mimeType) {
    const escaped = escapeForDriveQuery(name);
    const mimeFilter = mimeType ? ` and mimeType='${mimeType}'` : '';
    const response = Drive.Files.list({
      q: `'${escapeForDriveQuery(folderId)}' in parents and name='${escaped}' and trashed=false${mimeFilter}`,
      pageSize: 1,
      fields: 'files(id)',
    });
    const files = (response && response.files) || [];
    return files.length ? files[0].id : null;
  }

  function createFolder(parentId, name) {
    logger.info('Tworzę folder na Dysku', parentId, name);
    const created = Drive.Files.create({
      name,
      parents: [parentId],
      mimeType: MIME_FOLDER,
    });
    return created && created.id;
  }

  function getOrCreateFolderId(parentId, name) {
    const existing = findFileInFolder(parentId, name, MIME_FOLDER);
    if (existing) {
      logger.info('Folder już istnieje', name, `id=${existing}`);
      return existing;
    }
    const createdId = createFolder(parentId, name);
    if (!createdId) {
      throw new Error(`Nie udało się utworzyć folderu ${name}`);
    }
    logger.info('Utworzono nowy folder', name, `id=${createdId}`);
    return createdId;
  }

  function ensureFolderPath(root, segments) {
    const rootId = toFolderId(root);
    let currentId = rootId;
    logger.info('Zapewniam strukturę folderów', rootId, segments && segments.join('/'));
    (segments || []).forEach((segment) => {
      const trimmed = segment && String(segment).trim();
      if (!trimmed) {
        return;
      }
      currentId = getOrCreateFolderId(currentId, trimmed);
    });
    return DriveApp.getFolderById(currentId);
  }

  function createEmptyJsonFile(folderId, name) {
    const blob = Utilities.newBlob('', 'application/json', name);
    logger.info('Tworzę pusty plik JSONL', folderId, name);
    const created = Drive.Files.create({
      name,
      parents: [folderId],
      mimeType: 'application/json',
    }, blob);
    return created && created.id;
  }

  function getOrCreateFile(folder, name) {
    const folderId = toFolderId(folder);
    const existingId = findFileInFolder(folderId, name);
    if (existingId) {
      logger.info('Plik już istnieje', name, `id=${existingId}`);
      return DriveApp.getFileById(existingId);
    }
    const newId = createEmptyJsonFile(folderId, name);
    if (!newId) {
      throw new Error(`Nie udało się utworzyć pliku ${name}`);
    }
    logger.info('Utworzono nowy plik', name, `id=${newId}`);
    return DriveApp.getFileById(newId);
  }

  function appendJsonl(file, obj) {
    const payload = `${JSON.stringify(obj)}\n`;
    if (typeof file.appendChunk === 'function') {
      file.appendChunk(Utilities.newBlob(payload, 'application/json'));
      return;
    }
    if (typeof file.setContent === 'function' && typeof file.getBlob === 'function') {
      const existing = file.getBlob().getDataAsString('UTF-8') || '';
      file.setContent(existing + payload);
      return;
    }
    throw new Error('Unsupported file object');
  }

  function parseTimestampFromLine(line) {
    if (!line) return 0;
    try {
      const parsed = JSON.parse(line);
      const internal = parsed && parsed.gmail && parsed.gmail.received_internaldate_ms;
      if (Number.isFinite(internal)) {
        return Number(internal);
      }
      const iso = parsed && parsed.gmail && parsed.gmail.received_at;
      const isoTs = iso ? Date.parse(iso) : NaN;
      return Number.isFinite(isoTs) ? isoTs : 0;
    } catch (error) {
      if (typeof logger !== 'undefined' && logger && typeof logger.warn === 'function') {
        logger.warn('Nie udało się sparsować linii JSONL', line, error);
      }
      return 0;
    }
  }

  function extractLatestTimestampFromFile(file) {
    try {
      const content = file.getBlob().getDataAsString('UTF-8');
      if (!content) return 0;
      const lastLine = content
        .split('\n')
        .map((line) => line && line.trim())
        .filter(Boolean)
        .pop();
      if (!lastLine) return 0;
      return parseTimestampFromLine(lastLine);
    } catch (error) {
      if (typeof logger !== 'undefined' && logger && typeof logger.warn === 'function') {
        logger.warn('Nie udało się odczytać znacznika czasu z pliku', file && file.getName && file.getName(), error);
      }
      return 0;
    }
  }

  function extractTimestampBoundsFromFile(file) {
    try {
      const content = file.getBlob().getDataAsString('UTF-8');
      if (!content) {
        return { oldestTimestamp: 0, newestTimestamp: 0 };
      }
      const lines = content
        .split('\n')
        .map((line) => line && line.trim())
        .filter(Boolean);
      if (!lines.length) {
        return { oldestTimestamp: 0, newestTimestamp: 0 };
      }
      const firstTimestamp = parseTimestampFromLine(lines[0]);
      const lastTimestamp = parseTimestampFromLine(lines[lines.length - 1]);
      return {
        oldestTimestamp: Number.isFinite(firstTimestamp) ? firstTimestamp : 0,
        newestTimestamp: Number.isFinite(lastTimestamp) ? lastTimestamp : 0,
      };
    } catch (error) {
      if (typeof logger !== 'undefined' && logger && typeof logger.warn === 'function') {
        logger.warn(
          'Nie udało się odczytać zakresu znaczników czasu z pliku',
          file && file.getName && file.getName(),
          error,
        );
      }
      return { oldestTimestamp: 0, newestTimestamp: 0 };
    }
  }

  function getLatestSyncedTimestamp(rootFolder) {
    const { newestTimestamp } = getSyncedTimestampRange(rootFolder);
    return newestTimestamp;
  }

  function getSyncedTimestampRange(rootFolder) {
    let latest = 0;
    let oldest = 0;
    const stack = [rootFolder];
    while (stack.length) {
      const folder = stack.pop();
      const subfolders = folder.getFolders();
      if (subfolders && typeof subfolders.hasNext === 'function') {
        while (subfolders.hasNext()) {
          stack.push(subfolders.next());
        }
      }
      const files = folder.getFiles();
      if (files && typeof files.hasNext === 'function') {
        while (files.hasNext()) {
          const file = files.next();
          const name = file && typeof file.getName === 'function' ? file.getName() : '';
          if (!name || !/\.jsonl$/i.test(name)) {
            continue;
          }
          const { oldestTimestamp, newestTimestamp } = extractTimestampBoundsFromFile(file);
          if (newestTimestamp > latest) {
            latest = newestTimestamp;
          }
          if (oldestTimestamp > 0 && (oldest === 0 || oldestTimestamp < oldest)) {
            oldest = oldestTimestamp;
          }
        }
      }
    }
    return { newestTimestamp: latest, oldestTimestamp: oldest };
  }

  return {
    MIME_FOLDER,
    toFolderId,
    escapeForDriveQuery,
    findFileInFolder,
    createFolder,
    getOrCreateFolderId,
    ensureFolderPath,
    createEmptyJsonFile,
    getOrCreateFile,
    appendJsonl,
    extractLatestTimestampFromFile,
    extractTimestampBoundsFromFile,
    getLatestSyncedTimestamp,
    getSyncedTimestampRange,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.DriveHelpers = DriveHelpers;
}

if (typeof module !== 'undefined') {
  module.exports = DriveHelpers;
}
