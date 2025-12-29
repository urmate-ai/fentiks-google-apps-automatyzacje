#!/usr/bin/env node

import { initializeDatabase, closePool } from './shared/database/index.js';
import { logger } from './shared/logger/index.js';
import { getAuthenticatedClient } from './auth/google.js';
import { RagRefresher } from './rag-refresher/index.js';
import { EmailAutomation } from './email-automation/index.js';
import { GmailSyncer } from './gmail-syncer/index.js';

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

    if (process.argv.includes('--gmail-sync') || process.argv.includes('--all')) {
      logger.info('Running Gmail sync to Drive...');
      const gmailSyncer = new GmailSyncer(auth);
      
      if (process.argv.includes('--watch')) { 
        logger.info('Starting Gmail sync in watch mode (checking every 5 minutes)');
        logger.info('Press Ctrl+C to stop');
        const watchInterval = 5 * 60 * 1000;
        
        const syncNew = async () => {
          try {
            logger.info('Checking for new messages...');
            const count = await gmailSyncer.syncNewMessages();
            if (count > 0) {
              logger.info(`Synced ${count} new messages. Triggering RAG refresh...`);
              const ragRefresher = new RagRefresher(auth);
              await ragRefresher.initialize();
              await ragRefresher.syncRagFromDrive();
            } else {
              logger.info('No new messages found');
            }
          } catch (error) {
            logger.error('Error in watch mode sync', error);
          }
        };
        
        await syncNew();
        
        const interval = setInterval(syncNew, watchInterval);
        
        const cleanup = () => {
          clearInterval(interval);
          logger.info('Stopping watch mode...');
        };
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        
      } else {
        const daysBack = process.argv.includes('--full-sync') ? 180 : 7;
        await gmailSyncer.syncGmailToDrive(daysBack);
      }
    }

    if (process.argv.includes('--email-automation') || process.argv.includes('--all')) {
      logger.info('Running email automation...');
      const emailAutomation = new EmailAutomation(auth);
      await emailAutomation.main();
    }

    if (process.argv.includes('--watch-all')) {
      logger.info('========================================');
      logger.info('Starting FULL AUTOMATION in watch mode');
      logger.info('========================================');
      logger.info('This will run:');
      logger.info('  - Gmail sync (every 5 minutes)');
      logger.info('  - RAG refresh (after new emails)');
      logger.info('  - Email automation (every 10 minutes)');
      logger.info('Press Ctrl+C to stop\n');

      const gmailSyncer = new GmailSyncer(auth);
      const emailAutomation = new EmailAutomation(auth);
      const ragRefresher = new RagRefresher(auth);
      await ragRefresher.initialize();

      const gmailSyncInterval = 5 * 60 * 1000;
      const syncGmail = async () => {
        try {
          logger.info('[Gmail Sync] Checking for new messages...');
          const count = await gmailSyncer.syncNewMessages();
          if (count > 0) {
            logger.info(`[Gmail Sync] Synced ${count} new messages. Triggering RAG refresh...`);
            await ragRefresher.syncRagFromDrive();
          } else {
            logger.info('[Gmail Sync] No new messages found');
          }
        } catch (error) {
          logger.error('[Gmail Sync] Error', error);
        }
      };

      const emailAutomationInterval = 10 * 60 * 1000;
      const runEmailAutomation = async () => {
        try {
          logger.info('[Email Automation] Processing threads...');
          await emailAutomation.main();
          logger.info('[Email Automation] Completed');
        } catch (error) {
          logger.error('[Email Automation] Error', error);
        }
      };

      await syncGmail();
      await runEmailAutomation();

      const gmailInterval = setInterval(syncGmail, gmailSyncInterval);
      const emailInterval = setInterval(runEmailAutomation, emailAutomationInterval);

      const cleanup = () => {
        clearInterval(gmailInterval);
        clearInterval(emailInterval);
        logger.info('Stopping watch-all mode...');
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      logger.info('Watch mode active. Waiting for tasks...');
      return;
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

