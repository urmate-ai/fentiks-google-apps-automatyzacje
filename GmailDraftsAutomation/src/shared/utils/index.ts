import { logger } from '../logger/index.js';

export function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function extractJson(text: string): string {
  if (!text) return '{}';
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxTries: number = 5,
  delays: number[] = [2000, 4000, 8000, 16000, 32000]
): Promise<T> {
  const max = Math.min(maxTries, delays.length);
  
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === max) throw error;
      const delay = delays[attempt - 1];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Retry exhausted');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

export function extractRetryAfter(error: any): number | null {
  try {
    if (error?.response?.headers?.['retry-after']) {
      const retryAfter = parseInt(error.response.headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        return retryAfter * 1000;
      }
    }
    
    if (error?.response?.data?.error?.message) {
      const message = error.response.data.error.message;
      const match = message.match(/Retry after ([0-9TZ:\-\.]+)/i);
      if (match) {
        const retryDate = new Date(match[1]);
        if (!isNaN(retryDate.getTime())) {
          const delay = retryDate.getTime() - Date.now();
          return Math.max(delay, 0);
        }
      }
    }
    
    if (error?.retryAfter) {
      return typeof error.retryAfter === 'number' ? error.retryAfter * 1000 : null;
    }
  } catch (e) {
  }
  
  return null;
}

export async function retryWithGmailRateLimit<T>(
  fn: () => Promise<T>,
  maxTries: number = 5,
  baseDelay: number = 2000
): Promise<T> {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxTries;
      const isRateLimit = error?.code === 429 || error?.response?.status === 429;
      
      if (isLastAttempt) {
        throw error;
      }
      
      if (isRateLimit) {
        const retryAfter = extractRetryAfter(error);
        if (retryAfter && retryAfter > 0) {
          const waitTime = Math.min(retryAfter, 15 * 60 * 1000);
          logger.warn(`Rate limit exceeded. Waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt}/${maxTries})`);
          await sleep(waitTime);
          continue;
        }
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt}/${maxTries})`);
      await sleep(delay);
    }
  }
  
  throw new Error('Retry exhausted');
}

