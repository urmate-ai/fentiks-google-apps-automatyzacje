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
    const files = await this.listAllFilesRecursively(rootFolderId);
    return files.map(f => f.id);
  }

  async listAllFilesRecursively(rootFolderId: string): Promise<Array<{ id: string; name: string }>> {
    const visitedFolders = new Set<string>();
    const collectedFiles: Array<{ id: string; name: string }> = [];

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
              collectedFiles.push({ id: file.id, name: file.name });
            }
          }
        }
      } catch (error) {
        logger.error(`Error crawling folder ${folderId}`, error);
      }
    };

    await crawl(rootFolderId);
    return collectedFiles;
  }

  async listFilesWithMetadata(rootFolderId: string): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    const visitedFolders = new Set<string>();
    const collectedFiles: Array<{ id: string; name: string; modifiedTime: string }> = [];

    const crawl = async (folderId: string): Promise<void> => {
      if (visitedFolders.has(folderId)) {
        return;
      }
      visitedFolders.add(folderId);

      try {
        const filesResponse = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id, name, mimeType, modifiedTime)',
          pageSize: 1000,
        });

        const files = filesResponse.data.files || [];
        for (const file of files) {
          if (file.id && file.name && !this.shouldIgnoreFile(file.name)) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
              await crawl(file.id);
            } else if (file.modifiedTime) {
              collectedFiles.push({
                id: file.id,
                name: file.name,
                modifiedTime: file.modifiedTime,
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Error crawling folder ${folderId}`, error);
      }
    };

    await crawl(rootFolderId);
    return collectedFiles;
  }

  async readFileContents(fileIds: string[]): Promise<Array<{ id: string; content: string }>> {
    const results: Array<{ id: string; content: string }> = [];

    for (const id of fileIds) {
      try {
        const fileMetadata = await this.drive.files.get({
          fileId: id,
          fields: 'mimeType, name',
        });

        const mimeType = fileMetadata.data.mimeType || '';
        let content = '';

        if (mimeType.startsWith('application/vnd.google-apps.')) {
          const exportMimeType = this.getExportMimeType(mimeType);
          
          if (exportMimeType) {
            const exported = await this.drive.files.export(
              { fileId: id, mimeType: exportMimeType },
              { responseType: 'text' }
            );
            content = typeof exported.data === 'string' ? exported.data : '';
          } else {
            logger.warn(`Unsupported Google Docs file type: ${mimeType} for file ${id}`);
            content = '';
          }
        } else {
          const file = await this.drive.files.get(
            { fileId: id, alt: 'media' },
            { responseType: 'text' }
          );
          content = typeof file.data === 'string' ? file.data : '';
        }

        results.push({ id, content });
      } catch (error) {
        logger.error(`Error reading file ${id}`, error);
        results.push({ id, content: '' });
      }
    }

    return results;
  }

  private getExportMimeType(googleMimeType: string): string | null {
    const exportMap: Record<string, string> = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet': 'text/csv',
      'application/vnd.google-apps.presentation': 'text/plain',
    };

    return exportMap[googleMimeType] || null;
  }
}

