#!/usr/bin/env node

import { initializeDatabase, closePool } from './shared/database/index.js';
import { logger } from './shared/logger/index.js';
import { getAuthenticatedClient } from './auth/google.js';
import { RagRefresher } from './rag-refresher/index.js';
import { EmailAutomation } from './email-automation/index.js';

async function main() {
  try {
    logger.info('Starting Gmail Drafts Automation');

    await initializeDatabase();

    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      logger.error('GOOGLE_REFRESH_TOKEN not set. Please authorize the application first.');
      process.exit(1);
    }

    const auth = await getAuthenticatedClient(refreshToken);

    if (process.argv.includes('--rag-refresh') || process.argv.includes('--all')) {
      logger.info('Running RAG refresher...');
      const ragRefresher = new RagRefresher(auth);
      await ragRefresher.initialize();
      await ragRefresher.syncRagFromDrive();
    }

    if (process.argv.includes('--email-automation') || process.argv.includes('--all')) {
      logger.info('Running email automation...');
      const emailAutomation = new EmailAutomation(auth);
      await emailAutomation.main();
    }

    logger.info('Completed successfully');
  } catch (error) {
    logger.error('Fatal error', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await closePool();
  process.exit(0);
});

main();

