import { drive_v3, google } from 'googleapis';
import { logger } from '../shared/logger/index.js';

const IGNORED_FILE_NAMES = new Set(['processedEmails.jsonl']);

export class DriveService {
  private drive: drive_v3.Drive;

  constructor(auth: any) {
    this.drive = google.drive({ version: 'v3', auth });
  }

  shouldIgnoreFile(fileName: string): boolean {
    return IGNORED_FILE_NAMES.has(fileName);
  }

  async listAllFileIdsRecursively(rootFolderId: string): Promise<string[]> {
    const visitedFolders = new Set<string>();
    const collectedFileIds = new Set<string>();

    const crawl = async (folderId: string): Promise<void> => {
      if (visitedFolders.has(folderId)) {
        return;
      }
      visitedFolders.add(folderId);

      try {
        const filesResponse = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id, name, mimeType)',
          pageSize: 1000,
        });

        const files = filesResponse.data.files || [];
        for (const file of files) {
          if (file.id && file.name && !this.shouldIgnoreFile(file.name)) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
              await crawl(file.id);
            } else {
              collectedFileIds.add(file.id);
            }
          }
        }
      } catch (error) {
        logger.error(`Error crawling folder ${folderId}`, error);
      }
    };

    await crawl(rootFolderId);
    return Array.from(collectedFileIds);
  }

  async readFileContents(fileIds: string[]): Promise<Array<{ id: string; content: string }>> {
    const results: Array<{ id: string; content: string }> = [];

    for (const id of fileIds) {
      try {
        const file = await this.drive.files.get(
          { fileId: id, alt: 'media' },
          { responseType: 'text' }
        );

        const content = typeof file.data === 'string' ? file.data : '';
        results.push({ id, content });
      } catch (error) {
        logger.error(`Error reading file ${id}`, error);
        results.push({ id, content: '' });
      }
    }

    return results;
  }
}

