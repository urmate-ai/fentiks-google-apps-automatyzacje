import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', err);
    });
  }

  return pool;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function initializeDatabase(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    logger.info('Database initialized with pgvector extension');
  } catch (error) {
    logger.error('Failed to initialize database', error);
    throw error;
  } finally {
    client.release();
  }
}

