#!/usr/bin/env node

import http from 'http';
import { URL } from 'url';
import { initializeDatabase, closePool } from './shared/database/index.js';
import { logger } from './shared/logger/index.js';
import { config } from './shared/config/index.js';
import { getAuthenticatedClient, generateAuthUrl, exchangeCodeForTokens, createGoogleAuth } from './auth/google.js';
import { RagRefresher } from './rag-refresher/index.js';
import { EmailAutomation } from './email-automation/index.js';
import { GmailSyncer } from './gmail-syncer/index.js';
import { FentiksSyncer } from './fentiks-syncer/index.js';
import { ChatService } from './chat-api/index.js';
import { checkTokenStatus, checkRefreshToken } from './token-manager/index.js';

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

    if (path === '/token' && req.method === 'GET') {
      try {
        const fs = await import('fs/promises');
        const pathModule = await import('path');
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = pathModule.dirname(__filename);
        
        const baseDir = __dirname.endsWith('dist') 
          ? pathModule.join(__dirname, '..', 'src')
          : __dirname;
        
        const uiPath = pathModule.join(baseDir, 'token-manager', 'ui.html');
        const html = await fs.readFile(uiPath, 'utf-8');
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        logger.error('[Token UI] Error serving UI', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading token manager UI');
      }
      return;
    }

    if (path === '/api/v1/oauth/auth-url' && req.method === 'GET') {
      try {
        const authUrl = generateAuthUrl(true);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ authUrl }));
      } catch (error) {
        logger.error('[OAuth API] Error generating auth URL', error);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
      return;
    }

    if (path === '/oauth/callback' && req.method === 'GET') {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Błąd autoryzacji</title>
              <style>
                body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                .error { color: #d32f2f; font-size: 18px; margin: 20px 0; }
                .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <h1>❌ Błąd autoryzacji</h1>
              <p class="error">Autoryzacja została anulowana lub wystąpił błąd: ${error}</p>
              <a href="/token" class="button">Powrót do Token Manager</a>
            </body>
            </html>
          `);
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Błąd</title>
              <style>
                body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                .error { color: #d32f2f; }
              </style>
            </head>
            <body>
              <h1 class="error">Błąd: Brak kodu autoryzacji</h1>
              <a href="/token">Powrót</a>
            </body>
            </html>
          `);
          return;
        }

        await exchangeCodeForTokens(code, true);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Autoryzacja zakończona</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
              .success { color: #2e7d32; font-size: 48px; }
              h1 { margin: 20px 0; }
              .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="success">✅</div>
            <h1>Autoryzacja zakończona pomyślnie!</h1>
            <p>Token został zapisany w bazie danych.</p>
            <p>Możesz teraz zamknąć to okno lub wrócić do panelu zarządzania.</p>
            <a href="/token" class="button">Powrót do Token Manager</a>
            <script>
              // Auto-close after 3 seconds
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
          </html>
        `);
      } catch (error) {
        logger.error('[OAuth Callback] Error processing callback', error);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Błąd</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">Błąd podczas zapisywania tokena</h1>
            <p>${error instanceof Error ? error.message : 'Nieznany błąd'}</p>
            <a href="/token">Spróbuj ponownie</a>
          </body>
          </html>
        `);
      }
      return;
    }

    if (path === '/api/v1/token/status' && req.method === 'GET') {
      try {
        const status = await checkTokenStatus();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify(status));
      } catch (error) {
        logger.error('[Token API] Error checking status', error);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
      return;
    }
    
    if (path === '/api/v1/token/check' && req.method === 'POST') {
      try {
        const result = await checkRefreshToken();
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify(result));
        }
      } catch (error) {
        logger.error('[Token API] Error checking refresh token', error);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
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
    logger.info(`Token Manager UI available at http://localhost:${port}/token`);
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

    let auth: ReturnType<typeof createGoogleAuth> | undefined;
    try {
      auth = await getAuthenticatedClient();
    } catch (error) {
      if (process.argv.includes('--watch-all') || process.argv.includes('--gmail-sync') || 
          process.argv.includes('--email-automation') || process.argv.includes('--all')) {
        logger.error('No refresh token found. Please authorize through /token UI first.');
        process.exit(1);
      } 
      logger.warn('No refresh token found. Some features will be unavailable.');
    }

    if (process.argv.includes('--rag-refresh') || process.argv.includes('--all')) {
      if (!auth) {
        logger.error('Authentication required for RAG refresh');
        process.exit(1);
      }
      logger.info('Running RAG refresher...');
      const ragRefresher = new RagRefresher(auth);
      await ragRefresher.initialize();
      await ragRefresher.syncRagFromDrive();
    }

    if (process.argv.includes('--gmail-sync') || process.argv.includes('--all')) {
      if (!auth) {
        logger.error('Authentication required for Gmail sync');
        process.exit(1);
      }
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
              if (!auth) {
                logger.error('Authentication required for RAG refresh');
                return;
              }
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
      if (!auth) {
        logger.error('Authentication required for Fentiks sync');
        process.exit(1);
      }
      logger.info('Running Fentiks schedule scraping and sync to Drive...');
      const fentiksSyncer = new FentiksSyncer(auth);
      await fentiksSyncer.syncFentiksToDrive();
    }

    if (process.argv.includes('--email-automation') || process.argv.includes('--all')) {
      if (!auth) {
        logger.error('Authentication required for email automation');
        process.exit(1);
      }
      logger.info('Running email automation...');
      const emailAutomation = new EmailAutomation(auth);
      await emailAutomation.main();
    }

    if (process.argv.includes('--watch-all')) {
      if (!auth) {
        logger.error('Authentication required for watch-all mode');
        process.exit(1);
      }
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
          if (!auth) {
            logger.error('Authentication required for Fentiks sync');
            return;
          }
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

