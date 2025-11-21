const Drive = (() => {
  const IGNORED_FILE_NAMES = new Set(['processedEmails.jsonl']);

  function shouldIgnoreFile(file) {
    if (!file || typeof file.getName !== 'function') {
      return false;
    }

    try {
      const name = file.getName();
      return IGNORED_FILE_NAMES.has(name);
    } catch (err) {
      return false;
    }
  }

  function listAllFileIdsRecursively(rootFolderId, driveApp) {
    const drive = resolveDriveApp(driveApp);
    const visitedFolders = new Set();
    const collectedFileIds = new Set();

    function crawl(folderId) {
      if (visitedFolders.has(folderId)) {
        return;
      }
      visitedFolders.add(folderId);

      const folder = drive.getFolderById(folderId);

      const fileIterator = folder.getFiles();
      while (fileIterator.hasNext()) {
        const file = fileIterator.next();
        if (!file.isTrashed() && !shouldIgnoreFile(file)) {
          collectedFileIds.add(file.getId());
        }
      }

      const subfolders = folder.getFolders();
      while (subfolders.hasNext()) {
        const sub = subfolders.next();
        if (!sub.isTrashed()) {
          crawl(sub.getId());
        }
      }
    }

    crawl(rootFolderId);
    return Array.from(collectedFileIds);
  }

  function resolveDriveApp(driveApp) {
    if (driveApp) {
      return driveApp;
    }

    if (typeof DriveApp === 'undefined') {
      throw new Error('DriveApp is not available in the current environment.');
    }

    return DriveApp;
  }

  return { listAllFileIdsRecursively, resolveDriveApp, shouldIgnoreFile };
})();

if (typeof module !== 'undefined') {
  module.exports = Drive;
} else {
  this.Drive = Drive;
}
