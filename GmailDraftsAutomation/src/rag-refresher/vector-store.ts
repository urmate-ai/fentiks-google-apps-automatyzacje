import { logger } from '../shared/logger/index.js';
import { getPool } from '../shared/database/index.js';

export interface DocumentMetadata {
  driveId: string;
  fileName?: string;
  filePath?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: DocumentMetadata;
  embedding: number[];
}

export class VectorStore {
  private tableName = 'document_chunks';
  private embeddingDimension: number = 1536;

  setEmbeddingDimension(dimension: number): void {
    this.embeddingDimension = dimension;
  }

  async initializeSchema(): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id VARCHAR(255) PRIMARY KEY,
          drive_id VARCHAR(255) UNIQUE NOT NULL,
          file_name TEXT,
          file_path TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      const embeddingDim = this.embeddingDimension;
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id VARCHAR(255) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          metadata JSONB,
          embedding vector(${embeddingDim}),
          created_at TIMESTAMP DEFAULT NOW(),
          CONSTRAINT fk_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx 
        ON ${this.tableName} 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS ${this.tableName}_document_id_idx 
        ON ${this.tableName} (document_id)
      `);

      logger.info('Vector store schema initialized');
    } finally {
      client.release();
    }
  }

  async listDocuments(): Promise<Array<{ id: string; driveId: string }>> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT id, drive_id FROM documents ORDER BY updated_at DESC'
      );
      return result.rows.map((row: { id: string; drive_id: string }) => ({
        id: row.id,
        driveId: row.drive_id,
      }));
    } finally {
      client.release();
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query('DELETE FROM documents WHERE id = $1', [documentId]);
      logger.info(`Deleted document ${documentId}`);
    } finally {
      client.release();
    }
  }

  async deleteDocumentByDriveId(driveId: string): Promise<void> {
    const client = await getPool().connect();
    try {
      const result = await client.query('SELECT id FROM documents WHERE drive_id = $1', [driveId]);
      if (result.rows.length > 0) {
        await this.deleteDocument(result.rows[0].id);
      }
    } finally {
      client.release();
    }
  }

  async upsertDocument(
    documentId: string,
    driveId: string,
    metadata: DocumentMetadata,
    chunks: Array<{ content: string; embedding: number[] }>
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO documents (id, drive_id, file_name, file_path, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (drive_id) 
        DO UPDATE SET 
          file_name = EXCLUDED.file_name,
          file_path = EXCLUDED.file_path,
          updated_at = NOW()
        `,
        [documentId, driveId, metadata.fileName || null, metadata.filePath || null]
      );
        
      await client.query(`DELETE FROM ${this.tableName} WHERE document_id = $1`, [documentId]);

      if (chunks.length > 0) {
        const values: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        for (const chunk of chunks) {
          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`
          );
          params.push(
            documentId,
            chunk.content,
            JSON.stringify(metadata),
            `[${chunk.embedding.join(',')}]`
          );
          paramIndex += 4;
        }

        await client.query(
          `
          INSERT INTO ${this.tableName} (document_id, content, metadata, embedding)
          VALUES ${values.join(', ')}
        `,
          params
        );
      }

      await client.query('COMMIT');
      logger.info(`Upserted document ${documentId} with ${chunks.length} chunks`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error upserting document ${documentId}`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async searchSimilar(
    queryEmbedding: number[],
    topK: number = 5,
    threshold: number = 0.7
  ): Promise<Array<{ content: string; metadata: DocumentMetadata; similarity: number }>> {
    const client = await getPool().connect();
    try {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      const result = await client.query(
        `
        SELECT 
          content,
          metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM ${this.tableName}
        WHERE 1 - (embedding <=> $1::vector) >= $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `,
        [embeddingStr, threshold, topK]
      );

      return result.rows.map((row: { content: string; metadata: DocumentMetadata; similarity: string | number }) => ({
        content: row.content,
        metadata: row.metadata as DocumentMetadata,
        similarity: parseFloat(String(row.similarity)),
      }));
    } finally {
      client.release();
    }
  }
}

