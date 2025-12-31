import { getPool } from '../shared/database/index.js';
import { logger } from '../shared/logger/index.js';

export interface OAuthToken {
  id: number;
  provider: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: Date | null;
  scopes: string[] | null;
  created_at: Date;
  updated_at: Date;
}

export async function getRefreshToken(provider: string = 'google'): Promise<string | null> {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT refresh_token FROM oauth_tokens WHERE provider = $1',
      [provider]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0].refresh_token;
  } catch (error) {
    logger.error('[Token DB] Error getting refresh token', error);
    throw error;
  }
}

export async function saveRefreshToken(
  refreshToken: string,
  accessToken?: string,
  expiresAt?: Date,
  scopes?: string[],
  provider: string = 'google'
): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, scopes, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (provider) 
       DO UPDATE SET 
         refresh_token = EXCLUDED.refresh_token,
         access_token = EXCLUDED.access_token,
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         updated_at = NOW()`,
      [provider, refreshToken, accessToken || null, expiresAt || null, scopes || null]
    );
    
    logger.info('[Token DB] Refresh token saved to database');
  } catch (error) {
    logger.error('[Token DB] Error saving refresh token', error);
    throw error;
  }
}

export async function getOAuthToken(provider: string = 'google'): Promise<OAuthToken | null> {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM oauth_tokens WHERE provider = $1',
      [provider]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0] as OAuthToken;
  } catch (error) {
    logger.error('[Token DB] Error getting OAuth token', error);
    throw error;
  }
}

export async function initializeOAuthTokensTable(): Promise<void> {
  const pool = getPool();
  try {
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'oauth_tokens'
      )`
    );
    
    if (!tableCheck.rows[0].exists) {
      logger.warn('[Token DB] oauth_tokens table does not exist. Please run migration 003_oauth_tokens.sql');
    }
  } catch (error) {
    logger.error('[Token DB] Error checking oauth_tokens table', error);
  }
}

