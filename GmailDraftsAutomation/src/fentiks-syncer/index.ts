import { logger } from '../shared/logger/index.js';
import { config } from '../shared/config/index.js';
import { FentiksSyncerDriveService } from './drive.js';
import { scrapeFentiksSchedule, FentiksScheduleEntry } from './scraper.js';

export class FentiksSyncer {
  private driveService: FentiksSyncerDriveService;

  constructor(auth: any) {
    this.driveService = new FentiksSyncerDriveService(auth);
  }

  private parseExistingEntries(content: string): Set<string> {
    const existingKeys = new Set<string>();
    if (!content || !content.trim()) {
      return existingKeys;
    }

    const lines = content.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      try {
        const entry: FentiksScheduleEntry = JSON.parse(line);
        const key = `${entry.miejsce}|${entry.data}`.toLowerCase().trim();
        existingKeys.add(key);
      } catch (error) {
        logger.warn('Failed to parse existing entry line', { line: line.substring(0, 100) });
      }
    }

    return existingKeys;
  }

  private filterNewEntries(
    entries: FentiksScheduleEntry[],
    existingKeys: Set<string>
  ): FentiksScheduleEntry[] {
    return entries.filter((entry) => {
      const key = `${entry.miejsce}|${entry.data}`.toLowerCase().trim();
      return !existingKeys.has(key);
    });
  }

  async syncFentiksToDrive(): Promise<number> {
    if (!config.driveRootFolderId) {
      throw new Error('RAG_REFRESHER_ROOT_FOLDER_ID not configured');
    }

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

      const year = new Date().getFullYear().toString();
      const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
      const day = new Date().getDate().toString().padStart(2, '0');

      const folderParts = ['fentiks', year, month];
      const folderId = await this.driveService.ensureFolderPath(rootFolderId, folderParts);
      const fileName = `${day}.jsonl`;

      const fileId = await this.driveService.getOrCreateFile(folderId, fileName);
      const existingContent = await this.driveService.readFileContent(fileId);
      const existingKeys = this.parseExistingEntries(existingContent);

      logger.info(`Found ${existingKeys.size} existing entries in file`);

      const newEntries = this.filterNewEntries(scrapedEntries, existingKeys);

      if (newEntries.length === 0) {
        logger.info('All entries already exist in Drive, nothing to add');
        return 0;
      }

      logger.info(`Found ${newEntries.length} new entries to add (${scrapedEntries.length - newEntries.length} duplicates skipped)`);

      const jsonlLines = newEntries.map((entry) => {
        return JSON.stringify(entry);
      });

      const content = jsonlLines.join('\n') + '\n';

      await this.driveService.appendToFile(fileId, content);

      logger.info(`Synced ${newEntries.length} new entries from fentiks.pl to Drive (${fileName})`);
      return newEntries.length;
    } catch (error) {
      logger.error('Error syncing fentiks schedule to Drive', error);
      throw error;
    }
  }
}
