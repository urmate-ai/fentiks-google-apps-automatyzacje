import { gmail_v1, google } from 'googleapis';
import { logger } from '../shared/logger/index.js';
import { config } from '../shared/config/index.js';
import { GmailSyncerDriveService } from './drive.js';
import {
  parseMessage,
  buildGmailQuery,
  ParsedMessage,
} from './parser.js';
import { SpamFilter } from './spam-filter.js';

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS_BACK = 180;
const MAX_MESSAGES_PER_RUN = 500;

interface ProcessedEmail {
  gmail_id: string;
  received_internaldate_ms: number;
  received_at: string;
}

export class GmailSyncer {
  private gmail: gmail_v1.Gmail;
  private driveService: GmailSyncerDriveService;
  private spamFilter: SpamFilter;

  constructor(auth: any) {
    this.gmail = google.gmail({ version: 'v1', auth });
    this.driveService = new GmailSyncerDriveService(auth);
    this.spamFilter = new SpamFilter();
  }

  private resolveStorageDetails(parsed: ParsedMessage): {
    folderParts: string[];
    fileName: string;
  } {
    const isoDate = parsed.gmail.received_at;
    if (!isoDate) {
      return {
        folderParts: ['unknown'],
        fileName: 'undated.jsonl',
      };
    }

    const year = isoDate.slice(0, 4);
    const month = isoDate.slice(0, 7);
    const day = isoDate.slice(0, 10);

    return {
      folderParts: [year, month],
      fileName: `${day}.jsonl`,
    };
  }

  private parseProcessedEmails(content: string): ProcessedEmail[] {
    const entries: ProcessedEmail[] = [];
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.gmail_id && parsed.received_internaldate_ms) {
          entries.push({
            gmail_id: parsed.gmail_id,
            received_internaldate_ms: parsed.received_internaldate_ms,
            received_at: parsed.received_at || new Date(parsed.received_internaldate_ms).toISOString(),
          });
        }
      } catch (error) {
        logger.warn('Failed to parse processed email line', { line: line.substring(0, 100) });
      }
    }

    return entries;
  }

  private async loadProcessedEmails(rootFolderId: string): Promise<{
    processedIds: Set<string>;
    oldestTimestamp: number;
    fileId: string;
  }> {
    try {
      const fileId = await this.driveService.getOrCreateProcessedEmailsFile(rootFolderId);
      const content = await this.driveService.readFileContent(fileId);
      const entries = this.parseProcessedEmails(content);

      const processedIds = new Set(entries.map((e) => e.gmail_id));
      const timestamps = entries.map((e) => e.received_internaldate_ms).filter((t) => t > 0);
      const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;

      logger.info(`Loaded ${entries.length} processed emails, oldest: ${new Date(oldestTimestamp).toISOString()}`);

      return {
        processedIds,
        oldestTimestamp: oldestTimestamp || 0,
        fileId,
      };
    } catch (error) {
      logger.error('Error loading processed emails', error);
      return {
        processedIds: new Set(),
        oldestTimestamp: 0,
        fileId: '',
      };
    }
  }

  private async saveProcessedEmails(fileId: string, entries: ProcessedEmail[]): Promise<void> {
    try {
      const sorted = entries
        .slice()
        .sort((a, b) => {
          if (a.received_internaldate_ms !== b.received_internaldate_ms) {
            return b.received_internaldate_ms - a.received_internaldate_ms;
          }
          return a.gmail_id.localeCompare(b.gmail_id);
        });

      const content = sorted.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

      await this.driveService.appendToFile(fileId, content);
      logger.debug(`Saved ${entries.length} processed email entries`);
    } catch (error) {
      logger.error('Error saving processed emails', error);
      throw error;
    }
  }

  private async fetchMessages(
    beforeTimestamp?: number,
    afterTimestamp?: number,
    limit: number = MAX_MESSAGES_PER_RUN
  ): Promise<gmail_v1.Schema$Message[]> {
    const query = buildGmailQuery(beforeTimestamp, afterTimestamp);
    logger.info(`Fetching messages with query: ${query}`);

    const messages: gmail_v1.Schema$Message[] = [];
    let pageToken: string | undefined;

    do {
      try {
        const response = await this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(limit - messages.length, 500),
          pageToken,
        });

        const batch = response.data.messages || [];
        messages.push(...batch);

        pageToken = response.data.nextPageToken || undefined;

        if (messages.length >= limit) {
          break;
        }
      } catch (error) {
        logger.error('Error fetching messages', error);
        break;
      }
    } while (pageToken && messages.length < limit);

    logger.info(`Fetched ${messages.length} message IDs`);
    return messages;
  }

  async syncGmailToDrive(daysBack: number = DEFAULT_DAYS_BACK): Promise<number> {
    if (!config.driveRootFolderId) {
      throw new Error('RAG_REFRESHER_ROOT_FOLDER_ID not configured');
    }

    logger.info(`Starting Gmail sync to Drive (last ${daysBack} days)`);

    const rootFolderId = config.driveRootFolderId;
    const now = Date.now();
    const afterTimestamp = now - daysBack * MILLIS_PER_DAY;

    const { processedIds, fileId: processedFileId } = await this.loadProcessedEmails(rootFolderId);

    const messageIds = await this.fetchMessages(
      undefined,
      afterTimestamp
    );

    if (messageIds.length === 0) {
      logger.info('No new messages to sync');
      return 0;
    }

    logger.info(`Processing ${messageIds.length} messages`);

    const messages: gmail_v1.Schema$Message[] = [];
    for (const msgId of messageIds) {
      if (!msgId.id) continue;

      try {
        const message = await this.gmail.users.messages.get({
          userId: 'me',
          id: msgId.id,
          format: 'full',
        });
        messages.push(message.data);
      } catch (error) {
        logger.error(`Error fetching message ${msgId.id}`, error);
      }
    }

    const processedUpdates: ProcessedEmail[] = [];
    let totalWritten = 0;

    const newMessages = messages.filter((msg) => {
      if (!msg.id) return false;
      return !processedIds.has(msg.id);
    });

    logger.info(`Found ${newMessages.length} new messages (${messages.length} total, ${messages.length - newMessages.length} already processed)`);

    let spamCount = 0;

    for (const message of newMessages) {
      const parsed = parseMessage(message);
      if (!parsed) {
        logger.warn(`Failed to parse message ${message.id}`);
        continue;
      }

      // Classify email for spam/marketing
      try {
        logger.debug(`Classifying email: ${parsed.gmail.subject} from ${parsed.participants.from?.email}`);
        const classification = await this.spamFilter.classifyEmail(parsed);
        
        if (classification.isSpam || classification.isMarketing) {
          spamCount++;
          logger.info(
            `Skipping ${classification.isSpam ? 'spam' : 'marketing'} email: ${parsed.gmail.subject} (reason: ${classification.reason || 'unknown'}, confidence: ${classification.confidence || 0})`
          );
          // Still mark as processed to avoid re-checking
          processedUpdates.push({
            gmail_id: parsed.gmail.message_id,
            received_internaldate_ms: parsed.gmail.received_internaldate_ms,
            received_at: parsed.gmail.received_at,
          });
          continue;
        }
      } catch (error) {
        logger.warn(`Error classifying email ${parsed.gmail.message_id}, proceeding anyway`, error);
        // If classification fails, proceed with saving (fail-safe)
      }

      try {
        const storage = this.resolveStorageDetails(parsed);
        const folderId = await this.driveService.ensureFolderPath(rootFolderId, storage.folderParts);
        const fileId = await this.driveService.getOrCreateFile(folderId, storage.fileName);

        const enriched: ParsedMessage = {
          ...parsed,
          sync_metadata: {
            synced_at: new Date().toISOString(),
            storage_hint: {
              folder_parts: storage.folderParts,
              file_name: storage.fileName,
            },
          },
        };

        const jsonlLine = JSON.stringify(enriched) + '\n';
        await this.driveService.appendToFile(fileId, jsonlLine);

        processedUpdates.push({
          gmail_id: parsed.gmail.message_id,
          received_internaldate_ms: parsed.gmail.received_internaldate_ms,
          received_at: parsed.gmail.received_at,
        });

        totalWritten++;
      } catch (error) {
        logger.error(`Error saving message ${parsed.gmail.message_id}`, error);
      }
    }

    if (processedUpdates.length > 0 && processedFileId) {
      await this.saveProcessedEmails(processedFileId, processedUpdates);
    }

    logger.info(
      `Synced ${totalWritten} messages to Drive (skipped ${spamCount} spam/marketing emails)`
    );
    return totalWritten;
  }

  async syncNewMessages(): Promise<number> {
    return await this.syncGmailToDrive(DEFAULT_DAYS_BACK);
  }
}

