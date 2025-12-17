-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(255) PRIMARY KEY,
  drive_id VARCHAR(255) UNIQUE NOT NULL,
  file_name TEXT,
  file_path TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create document_chunks table with pgvector
-- Note: Embedding dimension is set dynamically based on the embedding model
-- OpenAI: 1536, Google: 768
-- The application will create the table with the correct dimension
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id VARCHAR(255) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536), -- Default to OpenAI dimension, adjust if using Google
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx 
ON document_chunks (document_id);

CREATE INDEX IF NOT EXISTS documents_drive_id_idx 
ON documents (drive_id);

