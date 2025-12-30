#!/usr/bin/env node

import http from 'http';
import { URL } from 'url';
import { initializeDatabase, closePool } from './shared/database/index.js';
import { logger } from './shared/logger/index.js';
import { config } from './shared/config/index.js';
import { getAuthenticatedClient } from './auth/google.js';
import { RagRefresher } from './rag-refresher/index.js';
import { EmailAutomation } from './email-automation/index.js';
import { GmailSyncer } from './gmail-syncer/index.js';
import { FentiksSyncer } from './fentiks-syncer/index.js';
import { ChatService } from './chat-api/index.js';

function verifyApiKey(req: http.IncomingMessage): boolean {
  if (!config.chatApiKey) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const providedKey = authHeader.substring(7);
    return providedKey === config.chatApiKey;
  }

  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    return apiKeyHeader === config.chatApiKey;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const queryKey = url.searchParams.get('api_key');
  if (queryKey) {
    return queryKey === config.chatApiKey;
  }

  return false;
}

function parseRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
          return;
        }
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function startHealthServer(chatService: ChatService | null) {
  const port = parseInt(process.env.PORT || '8080', 10);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(200, corsHeaders);
      res.end();
      return;
    }

    if ((path === '/health' || path === '/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'gmail-drafts-automation',
          timestamp: new Date().toISOString(),
          chatApiEnabled: !!config.chatApiKey && !!chatService,
        })
      );
      return;
    }

    if ((path === '/api/v1/chat' || path === '/api/chat') && req.method === 'POST') {
      if (!verifyApiKey(req)) {
        logger.warn(`[Chat API] Unauthorized request from ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
        res.writeHead(401, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Unauthorized. Provide valid API key via Authorization: Bearer <key>, X-API-Key header, or ?api_key= query parameter.' }));
        return;
      }

      if (!chatService) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Chat service not available' }));
        return;
      }

      try {
        const body = await parseRequestBody(req);
        const { message, conversationHistory, context } = body;

        if (!message || typeof message !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ error: 'Missing or invalid "message" field' }));
          return;
        }

        logger.info(`[Chat API] Processing chat request (message length: ${message.length})`);

        const response = await chatService.processMessage({
          message,
          conversationHistory,
          context,
        });

        if (response.error) {
          res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ error: response.error }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(
          JSON.stringify({
            response: response.response,
            contextUsed: response.contextUsed,
          })
        );
      } catch (error) {
        logger.error('[Chat API] Error handling request', error);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Internal server error',
          })
        );
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`HTTP server listening on port ${port}`);
    if (config.chatApiKey) {
      logger.info(`Chat API enabled at /api/v1/chat (protected by API key)`);
      logger.info(`Legacy endpoint /api/chat also available (will be deprecated)`);
    } else {
      logger.warn('Chat API disabled - set CHAT_API_KEY environment variable to enable');
    }
  });

  return server;
}

async function main() {
  try {
    logger.info('Starting Gmail Drafts Automation');

    await initializeDatabase();
    
    let chatService: ChatService | null = null;
    if (config.chatApiKey) {
      chatService = new ChatService();
      logger.info('Chat service initialized');
    }

    const healthServer = startHealthServer(chatService);

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
        const daysBack = 180;
        await gmailSyncer.syncGmailToDrive(daysBack);
      }
    }

    if (process.argv.includes('--fentiks-sync') || process.argv.includes('--all')) {
      logger.info('Running Fentiks schedule scraping and sync to Drive...');
      const fentiksSyncer = new FentiksSyncer(auth);
      await fentiksSyncer.syncFentiksToDrive();
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
      const gmailIntervalMin = Math.round(config.watchIntervals.gmailSync / 60000);
      const emailIntervalMin = Math.round(config.watchIntervals.emailAutomation / 60000);
      const driveIntervalMin = Math.round(config.watchIntervals.driveWatch / 60000);
      const fentiksIntervalMin = Math.round(config.watchIntervals.fentiksSync / 60000);
      
      logger.info('This will run:');
      logger.info(`  - Gmail sync (every ${gmailIntervalMin} minutes)`);
      logger.info('  - RAG refresh (after new emails)');
      logger.info(`  - Drive folder watch (every ${driveIntervalMin} minutes)`);
      logger.info(`  - Fentiks schedule scraping (every ${fentiksIntervalMin} minutes)`);
      logger.info(`  - Email automation (every ${emailIntervalMin} minutes)`);
      logger.info('Press Ctrl+C to stop\n');

      const gmailSyncer = new GmailSyncer(auth);
      const emailAutomation = new EmailAutomation(auth);
      const ragRefresher = new RagRefresher(auth);
      await ragRefresher.initialize();

      const gmailSyncInterval = config.watchIntervals.gmailSync;
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

      const emailAutomationInterval = config.watchIntervals.emailAutomation;
      const runEmailAutomation = async () => {
        try {
          logger.info('[Email Automation] Processing threads...');
          await emailAutomation.main();
          logger.info('[Email Automation] Completed');
        } catch (error) {
          logger.error('[Email Automation] Error', error);
        }
      };

      const driveWatchInterval = config.watchIntervals.driveWatch;
      const checkDriveChanges = async () => {
        try {
          logger.info('[Drive Watch] Checking for changes in Drive folder...');
          const hasChanges = await ragRefresher.checkForDriveChanges();
          if (hasChanges) {
            logger.info('[Drive Watch] Changes detected. Syncing RAG from Drive...');
            await ragRefresher.syncRagFromDrive();
            logger.info('[Drive Watch] RAG sync completed');
          } else {
            logger.info('[Drive Watch] No changes detected');
          }
        } catch (error) {
          logger.error('[Drive Watch] Error', error);
        }
      };

      const fentiksSyncInterval = config.watchIntervals.fentiksSync;
      const syncFentiks = async () => {
        try {
          logger.info('[Fentiks Sync] Scraping fentiks.pl and syncing to Drive...');
          const fentiksSyncer = new FentiksSyncer(auth);
          const count = await fentiksSyncer.syncFentiksToDrive();
          logger.info(`[Fentiks Sync] Synced ${count} entries`);
        } catch (error) {
          logger.error('[Fentiks Sync] Error', error);
        }
      };

      await syncGmail();
      await runEmailAutomation();
      await checkDriveChanges();
      await syncFentiks();

      const gmailInterval = setInterval(syncGmail, gmailSyncInterval);
      const emailInterval = setInterval(runEmailAutomation, emailAutomationInterval);
      const driveWatchIntervalId = setInterval(checkDriveChanges, driveWatchInterval);
      const fentiksInterval = setInterval(syncFentiks, fentiksSyncInterval);

      const cleanup = () => {
        clearInterval(gmailInterval);
        clearInterval(emailInterval);
        clearInterval(driveWatchIntervalId);
        clearInterval(fentiksInterval);
        logger.info('Stopping watch-all mode...');
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      logger.info('Watch mode active. Waiting for tasks...');
      
      return;
    }

    logger.info('Completed successfully');
    
    if (!process.argv.includes('--watch') && !process.argv.includes('--watch-all')) {
      setTimeout(async () => {
        logger.info('Shutting down health server...');
        healthServer.close();
        await closePool();
        process.exit(0);
      }, 5000);
    }
  } catch (error) {
    logger.error('Fatal error', error);
    process.exit(1);
  } finally {
    if (!process.argv.includes('--watch') && !process.argv.includes('--watch-all')) {
      await closePool();
    }
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

