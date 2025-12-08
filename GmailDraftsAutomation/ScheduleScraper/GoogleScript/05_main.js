function scrapeScheduleToDrive() {
  return ScheduleMain.scrapeScheduleToDrive();
}

const ScheduleMain = (() => {
  const logger = (typeof globalThis !== 'undefined' && globalThis.logger)
    || (typeof require !== 'undefined' ? require('./02_logger') : this.Log);
  const DriveHelpers = (typeof globalThis !== 'undefined' && globalThis.DriveHelpers)
    || (typeof require !== 'undefined' ? require('./03_drive') : null);
  const Scraper = (typeof globalThis !== 'undefined' && globalThis.ScheduleScraper)
    || (typeof require !== 'undefined' ? require('./04_scraper') : null);
  const Config = (typeof require !== 'undefined' ? require('./01_config') : {}) || {};

  const {
    getOrCreateFile,
    getFolderById,
  } = DriveHelpers || {};

  const {
    scrapeSchedule,
    toJson,
    toCsv,
  } = Scraper || {};

  function resolveTargetFolderId() {
    const scriptProps = typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties
      ? PropertiesService.getScriptProperties()
      : null;
    if (scriptProps && typeof scriptProps.getProperty === 'function') {
      const raw = scriptProps.getProperty(Config.CONFIG_KEYS.TARGET_FOLDER_ID);
      if (raw !== null && raw !== undefined) {
        const trimmed = String(raw).trim();
        if (trimmed !== '') return trimmed;
        return '';
      }
    }
    if (typeof globalThis !== 'undefined' && globalThis.TARGET_FOLDER_ID !== undefined) {
      const trimmed = String(globalThis.TARGET_FOLDER_ID).trim();
      if (trimmed !== '') return trimmed;
      return '';
    }
    const fallback = Config.TARGET_FOLDER_ID;
    if (fallback && String(fallback).trim() !== '') {
      return String(fallback).trim();
    }
    return '';
  }

  function resolveFileFormat() {
    if (typeof PropertiesService !== 'undefined'
      && PropertiesService.getScriptProperties
      && typeof PropertiesService.getScriptProperties().getProperty === 'function') {
      const raw = PropertiesService.getScriptProperties().getProperty(Config.CONFIG_KEYS.FILE_FORMAT);
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        return String(raw).trim();
      }
    }
    if (typeof globalThis !== 'undefined' && globalThis.FILE_FORMAT !== undefined) {
      return globalThis.FILE_FORMAT;
    }
    return Config.FILE_FORMAT || 'json';
  }

  if (!DriveHelpers || !Scraper) {
    throw new Error('Required helpers are not available');
  }

  /**
   * Main function: scrapes schedule and saves to Drive
   */
  function scrapeScheduleToDrive() {
    const targetFolderId = resolveTargetFolderId();
    const fileFormat = resolveFileFormat();

    if (!targetFolderId) {
      throw new Error('TARGET_FOLDER_ID is not configured. Please set SCHEDULE_SCRAPER_TARGET_FOLDER_ID in script properties.');
    }

    try {
      logger.info('Rozpoczynam pobieranie terminarza');

      // Scrape schedule
      const entries = scrapeSchedule();

      if (!entries || entries.length === 0) {
        logger.warn('Nie znaleziono żadnych wpisów w terminarzu');
        return { success: false, count: 0, message: 'Brak danych do zapisania' };
      }

      logger.info(`Pobrano ${entries.length} wpisów z terminarza`);

      // Get target folder
      const targetFolder = getFolderById(targetFolderId);

      // Determine file format and extension
      const format = String(fileFormat || 'json').toLowerCase();
      const extension = format === 'csv' ? 'csv' : 'json';
      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';

      // Generate filename with timestamp
      const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
      const fileName = `terminarz_${timestamp}.${extension}`;

      // Convert entries to the selected format
      const content = format === 'csv' ? toCsv(entries) : toJson(entries);

      // Save to Drive
      const file = getOrCreateFile(targetFolder, fileName, content, mimeType);

      logger.info('Zapisano terminarz do Dysku Google', fileName, `folder=${targetFolderId}`);

      return {
        success: true,
        count: entries.length,
        fileName,
        fileId: file.getId(),
        format,
        message: `Zapisano ${entries.length} wpisów do pliku ${fileName}`,
      };
    } catch (error) {
      logger.error('Błąd podczas pobierania i zapisywania terminarza', error);
      throw error;
    }
  }

  return {
    scrapeScheduleToDrive,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.scrapeScheduleToDrive = scrapeScheduleToDrive;
  globalThis.ScheduleMain = ScheduleMain;
}

if (typeof module !== 'undefined') {
  module.exports = ScheduleMain;
}
