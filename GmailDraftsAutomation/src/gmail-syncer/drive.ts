import { drive_v3, google } from 'googleapis';
import { logger } from '../shared/logger/index.js';

export class GmailSyncerDriveService {
  private drive: drive_v3.Drive;

  constructor(auth: any) {
    this.drive = google.drive({ version: 'v3', auth });
  }

  async ensureFolderPath(rootFolderId: string, segments: string[]): Promise<string> {
    let currentId = rootFolderId;

    for (const segment of segments) {
      if (!segment || !segment.trim()) continue;

      const trimmed = segment.trim();
      const existingId = await this.findFolderInFolder(currentId, trimmed);

      if (existingId) {
        currentId = existingId;
      } else {
        const newFolderId = await this.createFolder(currentId, trimmed);
        currentId = newFolderId;
      }
    }

    return currentId;
  }

  private async findFolderInFolder(parentId: string, name: string): Promise<string | null> {
    try {
      const escaped = name.replace(/'/g, "\\'");
      const response = await this.drive.files.list({
        q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        pageSize: 1,
        fields: 'files(id)',
      });

      const files = response.data.files || [];
      return files.length > 0 && files[0].id ? files[0].id : null;
    } catch (error) {
      logger.error(`Error finding folder ${name} in ${parentId}`, error);
      return null;
    }
  }

  private async createFolder(parentId: string, name: string): Promise<string> {
    try {
      const folder = await this.drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      });

      if (!folder.data.id) {
        throw new Error(`Failed to create folder ${name}`);
      }

      logger.debug(`Created folder ${name} with id ${folder.data.id}`);
      return folder.data.id;
    } catch (error) {
      logger.error(`Error creating folder ${name}`, error);
      throw error;
    }
  }

  async getOrCreateFile(folderId: string, fileName: string): Promise<string> {
    const existingId = await this.findFileInFolder(folderId, fileName);

    if (existingId) {
      logger.debug(`File ${fileName} already exists with id ${existingId}`);
      return existingId;
    }

    return await this.createFile(folderId, fileName);
  }

  private async findFileInFolder(folderId: string, name: string): Promise<string | null> {
    try {
      const escaped = name.replace(/'/g, "\\'");
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and name='${escaped}' and trashed=false`,
        pageSize: 1,
        fields: 'files(id)',
      });

      const files = response.data.files || [];
      return files.length > 0 && files[0].id ? files[0].id : null;
    } catch (error) {
      logger.error(`Error finding file ${name}`, error);
      return null;
    }
  }

  private async createFile(folderId: string, fileName: string): Promise<string> {
    try {
      const file = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
          mimeType: 'application/json',
        },
        fields: 'id',
      });

      if (!file.data.id) {
        throw new Error(`Failed to create file ${fileName}`);
      }

      await this.drive.files.update({
        fileId: file.data.id,
        media: {
          mimeType: 'application/json',
          body: '',
        },
      });

      logger.debug(`Created file ${fileName} with id ${file.data.id}`);
      return file.data.id;
    } catch (error) {
      logger.error(`Error creating file ${fileName}`, error);
      throw error;
    }
  }

  async appendToFile(fileId: string, content: string): Promise<void> {
    try {
      let existingContent = '';
      try {
        const file = await this.drive.files.get(
          {
            fileId,
            alt: 'media',
          },
          { responseType: 'text' }
        );
        existingContent = typeof file.data === 'string' ? file.data : '';
      } catch (error: any) {
        if (error.code !== 404) {
          logger.warn(`Error reading file ${fileId} for append, assuming empty`, error);
        }
      }

      const newContent = existingContent + content;

      await this.drive.files.update({
        fileId,
        media: {
          mimeType: 'application/json',
          body: Buffer.from(newContent, 'utf-8'),
        },
      });

      logger.debug(`Appended ${content.length} bytes to file ${fileId}`);
    } catch (error) {
      logger.error(`Error appending to file ${fileId}`, error);
      throw error;
    }
  }

  async readFileContent(fileId: string): Promise<string> {
    try {
      const file = await this.drive.files.get(
        {
          fileId,
          alt: 'media',
        },
        { responseType: 'text' }
      );

      return typeof file.data === 'string' ? file.data : '';
    } catch (error) {
      logger.error(`Error reading file ${fileId}`, error);
      return '';
    }
  }

  async getOrCreateProcessedEmailsFile(rootFolderId: string): Promise<string> {
    return await this.getOrCreateFile(rootFolderId, 'processedEmails.jsonl');
  }
}

