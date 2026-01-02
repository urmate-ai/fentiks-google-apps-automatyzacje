import { DriveService } from './drive.js';
import { VectorStore } from './vector-store.js';
import { Embedder } from './embedder.js';
import { parseJsonlContent, extractTextFromJsonl, chunkText } from './parser.js';
import { logger } from '../shared/logger/index.js';
import { config } from '../shared/config/index.js';
import { chunkArray, sleep } from '../shared/utils/index.js';

const MAX_RESOURCE_IDS_PER_IMPORT = 25;

export class RagRefresher {
  private driveService: DriveService;
  private vectorStore: VectorStore;
  private embedder: Embedder;

  constructor(auth: any) {
    this.driveService = new DriveService(auth);
    this.vectorStore = new VectorStore();
    this.embedder = new Embedder();
  }

  async initialize(): Promise<void> {
    this.vectorStore.setEmbeddingDimension(this.embedder.embeddingDimension);
    await this.vectorStore.initializeSchema();
  }

  async syncRagFromDrive(): Promise<void> {
    if (!config.driveRootFolderId) {
      throw new Error('RAG_REFRESHER_ROOT_FOLDER_ID not configured');
    }

    logger.info('Starting RAG synchronization from Drive');

    const driveFiles = await this.driveService.listAllFilesRecursively(config.driveRootFolderId);
    const fileIdSet = new Set(driveFiles.map(f => f.id));
    logger.info(`Found ${driveFiles.length} files in Drive`);

    const existingDocuments = await this.vectorStore.listDocuments();
    const documentsIndex = new Map<string, string>();
    existingDocuments.forEach((doc) => {
      documentsIndex.set(doc.driveId, doc.id);
    });

    const filesToImport = driveFiles.filter((file) => !documentsIndex.has(file.id));
    const documentsToDelete: string[] = [];

    documentsIndex.forEach((documentId, driveId) => {
      if (!fileIdSet.has(driveId)) {
        documentsToDelete.push(documentId);
      }
    });

    if (filesToImport.length === 0 && documentsToDelete.length === 0) {
      logger.info('No changes detected - skipping synchronization');
      return;
    }

    logger.info(
      `Files to import: ${filesToImport.length}, Documents to delete: ${documentsToDelete.length}`
    );

    if (filesToImport.length > 0) {
      logger.info('New files found on Drive:');
      filesToImport.forEach((file, index) => {
        logger.info(`  ${index + 1}. ${file.name} (ID: ${file.id})`);
      });
    }

    for (const documentId of documentsToDelete) {
      try {
        await this.vectorStore.deleteDocument(documentId);
        logger.info(`Deleted document ${documentId}`);
      } catch (error) {
        logger.error(`Error deleting document ${documentId}`, error);
      }
    }

    if (filesToImport.length > 0) {
      const fileIdsToImport = filesToImport.map(f => f.id);
      const batches = chunkArray(fileIdsToImport, MAX_RESOURCE_IDS_PER_IMPORT);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} files)`);

        try {
          const documents = await this.driveService.readFileContents(batch);

          for (const doc of documents) {
            try {
              await this.processDocument(doc.id, doc.content);
            } catch (error) {
              logger.error(`Error processing document ${doc.id}`, error);
            }
          }

          if (i < batches.length - 1) {
            await sleep(1000);
          }
        } catch (error) {
          logger.error(`Error processing batch ${i + 1}`, error);
        }
      }
    }

    logger.info('RAG synchronization completed');
  }

  async checkForDriveChanges(): Promise<boolean> {
    if (!config.driveRootFolderId) {
      throw new Error('RAG_REFRESHER_ROOT_FOLDER_ID not configured');
    }

    logger.debug('Checking for changes in Drive folder...');

    const driveFiles = await this.driveService.listFilesWithMetadata(config.driveRootFolderId);
    const existingDocuments = await this.vectorStore.listDocuments();
    const documentsIndex = new Map<string, string>();
    existingDocuments.forEach((doc) => {
      documentsIndex.set(doc.driveId, doc.id);
    });

    const newFiles = driveFiles.filter((file) => !documentsIndex.has(file.id));
    if (newFiles.length > 0) {
      logger.info(`Found ${newFiles.length} new files in Drive:`);
      newFiles.forEach((file, index) => {
        logger.info(`  ${index + 1}. ${file.name} (ID: ${file.id}, modified: ${file.modifiedTime})`);
      });
      return true;
    }

    const changedFiles: string[] = [];
    for (const driveFile of driveFiles) {
      if (documentsIndex.has(driveFile.id)) {
        const documentId = documentsIndex.get(driveFile.id)!;
        const dbDocument = await this.vectorStore.getDocument(documentId);
        if (dbDocument) {
          const driveModified = new Date(driveFile.modifiedTime);
          const dbUpdated = new Date(dbDocument.updatedAt);
          if (driveModified > dbUpdated) {
            changedFiles.push(driveFile.id);
          }
        }
      }
    }

    if (changedFiles.length > 0) {
      logger.info(`Found ${changedFiles.length} changed files in Drive`);
      return true;
    }

    const driveFileIds = new Set(driveFiles.map((f) => f.id));
    const deletedFiles = existingDocuments.filter((doc) => !driveFileIds.has(doc.driveId));
    if (deletedFiles.length > 0) {
      logger.info(`Found ${deletedFiles.length} deleted files in Drive`);
      return true;
    }

    logger.debug('No changes detected in Drive folder');
    return false;
  }

  private async processDocument(driveId: string, content: string): Promise<void> {
    const entries = parseJsonlContent(content);
    const text = extractTextFromJsonl(entries);

    if (!text || text.trim().length === 0) {
      logger.warn(`Skipping empty document ${driveId}`);
      return;
    }

    const chunks = chunkText(text, 2000, 200);
    logger.debug(`Document ${driveId} split into ${chunks.length} chunks`);
    
    const MAX_CHARS_PER_CHUNK = 24000;
    const validChunks: string[] = [];
    const skippedChunks: number[] = [];
    
    chunks.forEach((chunk, index) => {
      if (chunk.length > MAX_CHARS_PER_CHUNK) {
        skippedChunks.push(index);
        const estimatedTokens = Math.ceil(chunk.length / 3);
        logger.warn(`Skipping chunk ${index} in document ${driveId}: ${chunk.length} chars (~${estimatedTokens} tokens), max is ${MAX_CHARS_PER_CHUNK} chars (~8000 tokens)`);
      } else {
        validChunks.push(chunk);
      }
    });
    
    if (skippedChunks.length > 0) {
      logger.error(`Skipped ${skippedChunks.length} oversized chunks in document ${driveId} (${validChunks.length} valid chunks will be processed)`);
    }
    
    if (validChunks.length === 0) {
      logger.warn(`No valid chunks to process for document ${driveId}`);
      return;
    }

    const embeddings = await this.embedder.embedDocuments(validChunks);

    const chunksWithEmbeddings = validChunks.map((chunk, index) => ({
      content: chunk,
      embedding: embeddings[index],
    }));

    await this.vectorStore.upsertDocument(
      driveId,
      driveId,
      {
        driveId,
        fileName: `drive_${driveId}`,
      },
      chunksWithEmbeddings
    );

    logger.info(`Processed document ${driveId} with ${chunksWithEmbeddings.length} chunks${skippedChunks.length > 0 ? ` (${skippedChunks.length} skipped)` : ''}`);
  }
}

