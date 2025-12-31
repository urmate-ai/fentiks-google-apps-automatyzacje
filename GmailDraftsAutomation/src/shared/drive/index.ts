import { drive_v3, google } from 'googleapis';
import { logger } from '../logger/index.js';

export class DriveService {
  private drive: drive_v3.Drive;

  constructor(auth: any) {
    this.drive = google.drive({ version: 'v3', auth });
  }

  async ensureFolderPath(rootFolderId: string, segments: string[]): Promise<string> {
    let currentFolderId = rootFolderId;

    for (const segment of segments) {
      if (!segment || !segment.trim()) {
        logger.warn(`Skipping empty folder segment`);
        continue;
      }

      const trimmed = segment.trim();
      const existingId = await this.findFolderInParent(currentFolderId, trimmed);

      if (existingId) {
        currentFolderId = existingId;
        logger.debug(`Found existing folder: ${trimmed} (${existingId})`);
      } else {
        const newFolderId = await this.createFolder(currentFolderId, trimmed);
        currentFolderId = newFolderId;
        logger.info(`Created folder: ${trimmed} (${newFolderId})`);
      }
    }

    return currentFolderId;
  }

  private async findFolderInParent(parentId: string, name: string): Promise<string | null> {
    try {
      const escaped = this.escapeQueryValue(name);
      const response = await this.drive.files.list({
        q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        pageSize: 1,
        fields: 'files(id, name)',
      });

      const files = response.data.files || [];
      return files.length > 0 && files[0].id ? files[0].id : null;
    } catch (error) {
      logger.error(`Error finding folder "${name}" in parent ${parentId}`, error);
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
        fields: 'id, name',
      });

      if (!folder.data.id) {
        throw new Error(`Failed to create folder "${name}" - no ID returned`);
      }

      return folder.data.id;
    } catch (error) {
      logger.error(`Error creating folder "${name}" in parent ${parentId}`, error);
      throw error;
    }
  }

  async findFileInParent(parentId: string, name: string): Promise<string | null> {
    try {
      const escaped = this.escapeQueryValue(name);
      const response = await this.drive.files.list({
        q: `'${parentId}' in parents and name='${escaped}' and trashed=false`,
        pageSize: 1,
        fields: 'files(id, name)',
      });

      const files = response.data.files || [];
      return files.length > 0 && files[0].id ? files[0].id : null;
    } catch (error) {
      logger.error(`Error finding file "${name}" in parent ${parentId}`, error);
      return null;
    }
  }

  async getOrCreateFile(
    parentId: string,
    fileName: string,
    mimeType: string = 'application/json'
  ): Promise<string> {
    const existingId = await this.findFileInParent(parentId, fileName);

    if (existingId) {
      logger.debug(`File "${fileName}" already exists (${existingId})`);
      return existingId;
    }

    return await this.createFile(parentId, fileName, mimeType);
  }

  private async createFile(
    parentId: string,
    fileName: string,
    mimeType: string
  ): Promise<string> {
    try {
      const file = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentId],
          mimeType,
        },
        fields: 'id, name',
      });

      if (!file.data.id) {
        throw new Error(`Failed to create file "${fileName}" - no ID returned`);
      }

      await this.drive.files.update({
        fileId: file.data.id,
        media: {
          mimeType,
          body: '',
        },
      });

      logger.info(`Created file: ${fileName} (${file.data.id})`);
      return file.data.id;
    } catch (error) {
      logger.error(`Error creating file "${fileName}" in parent ${parentId}`, error);
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
    } catch (error: any) {
      if (error.code === 404 || error.message?.includes('not found')) {
        logger.debug(`File ${fileId} not found or empty, returning empty string`);
        return '';
      }
      logger.error(`Error reading file ${fileId}`, error);
      throw error;
    }
  }

  async appendToFile(
    fileId: string,
    content: string,
    mimeType: string = 'application/json'
  ): Promise<void> {
    try {
      const existingContent = await this.readFileContent(fileId);
      const newContent = existingContent + content;

      await this.drive.files.update({
        fileId,
        media: {
          mimeType,
          body: Buffer.from(newContent, 'utf-8'),
        },
      });

      logger.debug(`Appended ${content.length} bytes to file ${fileId}`);
    } catch (error) {
      logger.error(`Error appending to file ${fileId}`, error);
      throw error;
    }
  }

  async overwriteFile(
    fileId: string,
    content: string,
    mimeType: string = 'application/json'
  ): Promise<void> {
    try {
      await this.drive.files.update({
        fileId,
        media: {
          mimeType,
          body: Buffer.from(content, 'utf-8'),
        },
      });

      logger.debug(`Overwrote file ${fileId} with ${content.length} bytes`);
    } catch (error) {
      logger.error(`Error overwriting file ${fileId}`, error);
      throw error;
    }
  }

  private escapeQueryValue(value: string): string {
    return value.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
  }


  async listFilesInFolder(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
      });

      return (response.data.files || []).map(file => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType || 'unknown',
      }));
    } catch (error) {
      logger.error(`Error listing files in folder ${folderId}`, error);
      throw error;
    }
  }
}

