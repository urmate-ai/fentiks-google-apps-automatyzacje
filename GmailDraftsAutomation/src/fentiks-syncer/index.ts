import { logger } from '../shared/logger/index.js';
import { config } from '../shared/config/index.js';
import { DriveService } from '../shared/drive/index.js';
import {
  getFentiksSchedulePath,
  getFentiksScheduleFileName,
  validateFolderId,
} from '../shared/drive/structure.js';
import { scrapeFentiksSchedule, FentiksScheduleEntry } from './scraper.js';

export class FentiksSyncer {
  private driveService: DriveService;

  constructor(auth: any) {
    this.driveService = new DriveService(auth);
  }

  private parseExistingEntries(content: string): FentiksScheduleEntry[] {
    const entries: FentiksScheduleEntry[] = [];
    if (!content || !content.trim()) {
      return entries;
    }

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      logger.warn('Fentiks schedule file is not a JSON array, returning empty');
      return [];
    } catch (error) {
      logger.error('Failed to parse Fentiks schedule file', error);
      return [];
    }
  }

  private filterNewEntries(
    entries: FentiksScheduleEntry[],
    existingEntries: FentiksScheduleEntry[]
  ): FentiksScheduleEntry[] {
    const existingKeys = new Set(
      existingEntries.map((e) => `${e.miejsce}|${e.data}`.toLowerCase().trim())
    );

    return entries.filter((entry) => {
      const key = `${entry.miejsce}|${entry.data}`.toLowerCase().trim();
      return !existingKeys.has(key);
    });
  }

  async syncFentiksToDrive(): Promise<number> {
    validateFolderId(config.driveRootFolderId, 'RAG_REFRESHER_ROOT_FOLDER_ID');

    logger.info('Starting Fentiks schedule scraping and sync to Drive');

    const rootFolderId = config.driveRootFolderId;

    try {
      logger.info('Scraping fentiks.pl schedule page...');
      const scrapedEntries = await scrapeFentiksSchedule();

      if (scrapedEntries.length === 0) {
        logger.info('No schedule entries found');
        return 0;
      }

      logger.info(`Found ${scrapedEntries.length} schedule entries from website`);

      const folderPath = getFentiksSchedulePath();
      const folderId = folderPath.length > 0
        ? await this.driveService.ensureFolderPath(rootFolderId, folderPath)
        : rootFolderId;

      const fileName = getFentiksScheduleFileName();
      const fileId = await this.driveService.getOrCreateFile(folderId, fileName, 'application/json');
      
      const existingContent = await this.driveService.readFileContent(fileId);
      const existingEntries = this.parseExistingEntries(existingContent);

      logger.info(`Found ${existingEntries.length} existing entries in file`);

      const newEntries = this.filterNewEntries(scrapedEntries, existingEntries);

      if (newEntries.length === 0) {
        logger.info('All entries already exist in Drive, nothing to add');
        return 0;
      }

      logger.info(`Found ${newEntries.length} new entries to add (${scrapedEntries.length - newEntries.length} duplicates skipped)`);

      const allEntries = [...existingEntries, ...newEntries].sort((a, b) => {
        try {
          const dateA = new Date(a.data.split('-').reverse().join('-'));
          const dateB = new Date(b.data.split('-').reverse().join('-'));
          return dateB.getTime() - dateA.getTime();
        } catch {
          return 0;
        }
      });
        
      const content = JSON.stringify(allEntries, null, 2);
      await this.driveService.overwriteFile(fileId, content, 'application/json');

      logger.info(`Synced ${newEntries.length} new entries from fentiks.pl to Drive (${fileName})`);
      logger.info(`Total entries in file: ${allEntries.length}`);
      return newEntries.length;
    } catch (error) {
      logger.error('Error syncing fentiks schedule to Drive', error);
      throw error;
    }
  }
}
