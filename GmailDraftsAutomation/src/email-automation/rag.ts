import { VectorStore } from '../rag-refresher/vector-store.js';
import { Embedder } from '../rag-refresher/embedder.js';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

export class RagService {
  private vectorStore: VectorStore;
  private embedder: Embedder;

  constructor() {
    this.vectorStore = new VectorStore();
    this.embedder = new Embedder();
  }

  async checkDatabaseStatus(): Promise<void> {
    try {
      const documents = await this.vectorStore.listDocuments();
      logger.info(`RAG database contains ${documents.length} documents`);
      
      if (documents.length === 0) {
        logger.warn('RAG database is empty! Run "npm run rag:refresh" to import documents from Google Drive.');
      }
    } catch (error) {
      logger.error('Error checking RAG database status', error);
    }
  }

  async retrieveContext(query: string): Promise<string> {
    try {
      logger.info(`Searching RAG database for query: "${query.substring(0, 100)}..."`);
      
      const queryEmbedding = await this.embedder.embedText(query);
      logger.debug(`Query embedding created (dimension: ${queryEmbedding.length})`);

      const allResults = await this.vectorStore.searchSimilar(
        queryEmbedding,
        Math.max(config.ragTopK * 2, 10), 
        0.0
      );
      
      if (allResults.length > 0) {
        const bestSimilarity = allResults[0].similarity;
        logger.info(`Best match similarity: ${bestSimilarity.toFixed(4)}`);
        
        const dynamicThreshold = Math.max(bestSimilarity * 0.8, 0.4);
        const finalThreshold = Math.min(dynamicThreshold, config.ragSimilarityThreshold);
        
        logger.info(`Using dynamic threshold: ${finalThreshold.toFixed(4)} (best match: ${bestSimilarity.toFixed(4)})`);
        
        const results = allResults.filter(r => r.similarity >= finalThreshold);
        
        logger.info(`RAG search found ${results.length} results (after filtering with threshold: ${finalThreshold.toFixed(4)}, topK: ${config.ragTopK})`);
        
        if (results.length === 0 && allResults.length > 0) {
          logger.warn(`No results passed threshold ${finalThreshold.toFixed(4)}, but best match was ${bestSimilarity.toFixed(4)}`);
          logger.warn('Consider lowering RAG_SIMILARITY_THRESHOLD in .env file');
        }
        
        if (results.length === 0) {
          logger.warn('No relevant context found in RAG database. Check if:');
          logger.warn('1. Documents were imported (run: npm run rag:refresh)');
          logger.warn(`2. Similarity threshold (${config.ragSimilarityThreshold}) is not too high`);
          logger.warn('3. Query is similar to content in database');
          return '';
        }

        results.forEach((result, index) => {
          logger.info(`RAG result ${index + 1}: similarity=${result.similarity.toFixed(3)}, content length=${result.content.length}`);
        });

        const sortedResults = results.sort((a, b) => b.similarity - a.similarity);
        
        const topResults = sortedResults.slice(0, Math.min(config.ragTopK, sortedResults.length));
        
        const contextParts = topResults.map((result, index) => {
          const priority = index === 0 && result.similarity > 0.55 ? '⭐ HIGHEST PRIORITY - USE THIS DATA ⭐' : '';
          return `${priority ? `${priority}\n` : ''}[Context ${index + 1} - Similarity: ${result.similarity.toFixed(3)}]\n${result.content}`;
        });

        return contextParts.join('\n\n---\n\n');
      } else {
        logger.warn('No results found in RAG database at all');
        return '';
      }
    } catch (error) {
      logger.error('Error retrieving RAG context', error);
      return '';
    }
  }
}

