import { logger } from '../shared/logger/index.js';

export interface JsonlEntry {
  content?: {
    body_text?: string;
  };
  gmail?: {
    subject?: string;
    snippet?: string;
  };
  participants?: {
    from?: { name?: string; email?: string };
    to?: Array<{ name?: string; email?: string }>;
  };
  raw?: string;
}

export function parseJsonlContent(content: string): JsonlEntry[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const entries: JsonlEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      entries.push(JSON.parse(trimmed));
    } catch (err) {
      logger.warn('Failed to parse JSONL line', { error: err, line: trimmed.substring(0, 100) });
      entries.push({ raw: trimmed });
    }
  }

  return entries;
}

export function extractTextFromJsonl(entries: JsonlEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.raw) {
        return entry.raw;
      }

      const textParts: string[] = [];

      if (entry.content?.body_text) {
        textParts.push(entry.content.body_text);
      }
      if (entry.gmail?.subject) {
        textParts.push(`Temat: ${entry.gmail.subject}`);
      }
      if (entry.gmail?.snippet) {
        textParts.push(entry.gmail.snippet);
      }
      if (entry.participants) {
        const parts: string[] = [];
        if (entry.participants.from) {
          parts.push(
            `Od: ${entry.participants.from.name || entry.participants.from.email || ''}`
          );
        }
        if (entry.participants.to && entry.participants.to.length > 0) {
          parts.push(
            `Do: ${entry.participants.to.map((p) => p.name || p.email || '').join(', ')}`
          );
        }
        if (parts.length > 0) {
          textParts.push(parts.join(' | '));
        }
      }

      if (textParts.length === 0) {
        try {
          return JSON.stringify(entry);
        } catch {
          return String(entry);
        }
      }

      return textParts.join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

const CHARS_PER_TOKEN_ESTIMATE = 3;
const MAX_TOKENS_FOR_EMBEDDING = 8000;
const MAX_CHARS_PER_CHUNK = MAX_TOKENS_FOR_EMBEDDING * CHARS_PER_TOKEN_ESTIMATE;

export function chunkText(text: string, chunkSize: number = 2000, overlap: number = 200): string[] {
  if (!text || text.length <= chunkSize) {
    return [text];
  }

  const safeChunkSize = Math.min(chunkSize, MAX_CHARS_PER_CHUNK);
  
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + safeChunkSize, text.length);
    let chunk = text.slice(start, end);
    
    if (chunk.length > MAX_CHARS_PER_CHUNK) {
      const subChunks = splitLargeChunk(chunk, MAX_CHARS_PER_CHUNK);
      chunks.push(...subChunks);
      start = text.length;
      continue;
    }
    
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > safeChunkSize * 0.5) {
        chunk = chunk.slice(0, breakPoint + 1);
        start += breakPoint + 1 - overlap;
      } else {
        start += safeChunkSize - overlap;
      }
    } else {
      start = text.length;
    }

    chunks.push(chunk.trim());
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function splitLargeChunk(chunk: string, maxSize: number): string[] {
  const subChunks: string[] = [];
  let start = 0;
  
  while (start < chunk.length) {
    const end = Math.min(start + maxSize, chunk.length);
    let subChunk = chunk.slice(start, end);
    
    if (end < chunk.length) {
      const lastPeriod = subChunk.lastIndexOf('.');
      const lastNewline = subChunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > maxSize * 0.5) {
        subChunk = subChunk.slice(0, breakPoint + 1);
        start += breakPoint + 1;
      } else {
        start += maxSize;
      }
    } else {
      start = chunk.length;
    }
    
    subChunks.push(subChunk.trim());
  }
  
  return subChunks.filter((c) => c.length > 0);
}

