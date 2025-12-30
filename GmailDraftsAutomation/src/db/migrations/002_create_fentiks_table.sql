-- Create fentiks table for syncing data to Google Drive
-- This is a generic table structure - adjust columns based on your actual data
CREATE TABLE IF NOT EXISTS fentiks (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  data JSONB
);

-- Add index on id for faster queries
CREATE INDEX IF NOT EXISTS fentiks_id_idx ON fentiks(id);

-- Add index on created_at for date-based queries
CREATE INDEX IF NOT EXISTS fentiks_created_at_idx ON fentiks(created_at);

