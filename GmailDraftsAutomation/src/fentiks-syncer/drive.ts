import { drive_v3, google } from 'googleapis';
import { logger } from '../shared/logger/index.js';

export class FentiksSyncerDriveService {
  private drive: drive_v3.Drive;

  constructor(auth: any) {
    this.drive = google.drive({ version: 'v3', auth });
  }

  async ensureFolderPath(rootFolderId: string, segments: string[]): Promise<string> {
    let currentFolderId = rootFolderId;

    for (const segment of segments) {
      try {
        const response = await this.drive.files.list({
          q: `'${currentFolderId}' in parents and name='${segment}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name)',
          pageSize: 1,
        });

        if (response.data.files && response.data.files.length > 0) {
          currentFolderId = response.data.files[0].id!;
        } else {
          const folder = await this.drive.files.create({
            requestBody: {
              name: segment,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [currentFolderId],
            },
            fields: 'id',
          });

          if (folder.data.id) {
            currentFolderId = folder.data.id;
            logger.debug(`Created folder: ${segment} (${currentFolderId})`);
          } else {
            throw new Error(`Failed to create folder: ${segment}`);
          }
        }
      } catch (error) {
        logger.error(`Error ensuring folder path segment: ${segment}`, error);
        throw error;
      }
    }

    return currentFolderId;
  }

  async getOrCreateFile(parentFolderId: string, fileName: string): Promise<string> {
    try {
      const response = await this.drive.files.list({
        q: `'${parentFolderId}' in parents and name='${fileName}' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1,
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
      }

      const file = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentFolderId],
        },
        fields: 'id',
      });

      if (file.data.id) {
        logger.debug(`Created file: ${fileName} (${file.data.id})`);
        return file.data.id;
      } else {
        throw new Error(`Failed to create file: ${fileName}`);
      }
    } catch (error) {
      logger.error(`Error getting or creating file: ${fileName}`, error);
      throw error;
    }
  }

  async readFileContent(fileId: string): Promise<string> {
    try {
      const file = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );
      return typeof file.data === 'string' ? file.data : '';
    } catch (error: any) {
      if (error.code === 404 || error.message?.includes('not found')) {
        return '';
      }
      logger.error(`Error reading file ${fileId}`, error);
      throw error;
    }
  }

  async appendToFile(fileId: string, content: string): Promise<void> {
    try {
      const existingContent = await this.readFileContent(fileId);
      const newContent = existingContent + content;

      await this.drive.files.update({
        fileId,
        media: {
          mimeType: 'text/plain',
          body: newContent,
        },
      });

      logger.debug(`Appended content to file ${fileId}`);
    } catch (error: any) {
      if (error.code === 404 || error.message?.includes('not found')) {
        await this.drive.files.update({
          fileId,
          media: {
            mimeType: 'text/plain',
            body: content,
          },
        });
        logger.debug(`Created file content for ${fileId}`);
      } else {
        logger.error(`Error appending to file ${fileId}`, error);
        throw error;
      }
    }
  }
}

