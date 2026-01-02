import { OpenAIEmbeddings } from '@langchain/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

interface EmbeddingsInterface {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

class GoogleGenerativeAIEmbeddingsWrapper implements EmbeddingsInterface {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async embedQuery(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: 'models/embedding-001' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results = await Promise.all(texts.map((text) => this.embedQuery(text)));
    return results;
  }
}

export class Embedder {
  private embeddings: EmbeddingsInterface;

  public readonly embeddingDimension: number;

  constructor() {
    if (config.openaiApiKey) {
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: config.openaiApiKey,
        modelName: config.ragEmbeddingModel,
      });
      this.embeddingDimension = 1536; 
      logger.info('Using OpenAI embeddings (dimension: 1536)');
    } else if (config.googleGenAiApiKey) {
      this.embeddings = new GoogleGenerativeAIEmbeddingsWrapper(config.googleGenAiApiKey);
      this.embeddingDimension = 768;
      logger.info('Using Google Generative AI embeddings (dimension: 768)');
    } else {
      throw new Error('No embedding API key configured');
    }
  }

  async embedText(text: string): Promise<number[]> {
    return await this.embeddings.embedQuery(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return await this.embeddings.embedDocuments(texts);
  }
}

