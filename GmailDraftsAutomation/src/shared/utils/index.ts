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

