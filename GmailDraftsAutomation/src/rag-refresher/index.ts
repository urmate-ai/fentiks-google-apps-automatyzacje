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

    const fileIds = await this.driveService.listAllFileIdsRecursively(config.driveRootFolderId);
    const fileIdSet = new Set(fileIds);
    logger.info(`Found ${fileIds.length} files in Drive`);

    const existingDocuments = await this.vectorStore.listDocuments();
    const documentsIndex = new Map<string, string>();
    existingDocuments.forEach((doc) => {
      documentsIndex.set(doc.driveId, doc.id);
    });

    const filesToImport = fileIds.filter((id) => !documentsIndex.has(id));
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

    for (const documentId of documentsToDelete) {
      try {
        await this.vectorStore.deleteDocument(documentId);
        logger.info(`Deleted document ${documentId}`);
      } catch (error) {
        logger.error(`Error deleting document ${documentId}`, error);
      }
    }

    if (filesToImport.length > 0) {
      const batches = chunkArray(filesToImport, MAX_RESOURCE_IDS_PER_IMPORT);

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

  private async processDocument(driveId: string, content: string): Promise<void> {
    const entries = parseJsonlContent(content);
    const text = extractTextFromJsonl(entries);

    if (!text || text.trim().length === 0) {
      logger.warn(`Skipping empty document ${driveId}`);
      return;
    }

    const chunks = chunkText(text, 1000, 200);
    logger.debug(`Document ${driveId} split into ${chunks.length} chunks`);

    const embeddings = await this.embedder.embedDocuments(chunks);

    const chunksWithEmbeddings = chunks.map((chunk, index) => ({
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

    logger.info(`Processed document ${driveId} with ${chunks.length} chunks`);
  }
}

