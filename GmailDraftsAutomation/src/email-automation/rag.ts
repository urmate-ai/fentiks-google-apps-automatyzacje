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

  async retrieveContext(query: string): Promise<string> {
    try {
      const queryEmbedding = await this.embedder.embedText(query);

      const results = await this.vectorStore.searchSimilar(
        queryEmbedding,
        config.ragTopK,
        config.ragSimilarityThreshold
      );

      if (results.length === 0) {
        logger.debug('No relevant context found for query');
        return '';
      }

      const contextParts = results.map((result, index) => {
        return `[Context ${index + 1}]\n${result.content}\n(Similarity: ${result.similarity.toFixed(3)})`;
      });

      return contextParts.join('\n\n---\n\n');
    } catch (error) {
      logger.error('Error retrieving RAG context', error);
      return '';
    }
  }
}

