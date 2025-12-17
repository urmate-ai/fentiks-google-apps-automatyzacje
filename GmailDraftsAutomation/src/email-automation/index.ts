import { GmailService } from './gmail.js';
import { logger } from '../shared/logger/index.js';
import { retryWithBackoff } from '../shared/utils/index.js';

const MAX_RUNTIME_MS = 3 * 60 * 1000;

export class EmailAutomation {
  private gmailService: GmailService;

  constructor(auth: any) {
    this.gmailService = new GmailService(auth);
  }

  async setup(): Promise<void> {
    logger.info('Setup complete - labels will be created on first use');
  }

  async main(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.setup();

      const threads = await this.gmailService.fetchCandidateThreads(5);
      const failed = await this.gmailService.fetchFailedThreads(2);
      const allThreads = [...threads, ...failed];

      logger.info(`Processing ${allThreads.length} threads`);

      for (const thread of allThreads) {
        if (Date.now() - startTime >= MAX_RUNTIME_MS) {
          logger.info('Time limit reached; stopping');
          break;
        }

        if (!thread.id) continue;

        const hasDraft = await this.gmailService.threadHasDraft(thread.id);
        if (hasDraft) {
          logger.debug(`Skipping thread ${thread.id} - has draft`);
          continue;
        }
        
        await retryWithBackoff(async () => {
          await this.gmailService.processThread(thread.id!);
        });
      }

      logger.info('Run completed');
    } catch (error) {
      logger.error('Error in main automation loop', error);
      throw error;
    }
  }
}

