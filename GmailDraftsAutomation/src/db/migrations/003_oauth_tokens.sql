-- Create oauth_tokens table for storing refresh tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'google',
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at TIMESTAMP,
  scopes TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider)
);

-- Create index on provider
CREATE INDEX IF NOT EXISTS oauth_tokens_provider_idx ON oauth_tokens(provider);

