import { gmail_v1 } from 'googleapis';
import { logger } from '../shared/logger/index.js';

export interface ParsedMessage {
  gmail: {
    message_id: string;
    thread_id: string;
    subject: string;
    snippet: string;
    received_at: string;
    received_internaldate_ms: number;
  };
  participants: {
    from?: { name?: string; email?: string };
    to?: Array<{ name?: string; email?: string }>;
    cc?: Array<{ name?: string; email?: string }>;
    bcc?: Array<{ name?: string; email?: string }>;
  };
  content: {
    body_text: string;
    body_html?: string;
  };
  sync_metadata?: {
    synced_at?: string;
    storage_hint?: {
      folder_parts?: string[];
      file_name?: string;
    };
  };
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!Array.isArray(headers)) return '';
  const lower = name.toLowerCase();
  const header = headers.find((h) => h.name?.toLowerCase() === lower);
  return header?.value || '';
}

function parseAddress(raw: string): { name: string; email: string } {
  if (!raw) return { name: '', email: '' };
  const match = /"?([^"<]*)"?\s*<([^>]+)>/.exec(raw);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: '', email: raw.trim() };
}

function splitAddresses(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseAddress(part));
}

function decodeBase64(data: string): string {
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(normalized + padding, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart): string {
  const stack: gmail_v1.Schema$MessagePart[] = [payload];

  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;

    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64(part.body.data);
    }

    if (part.mimeType === 'text/html' && part.body?.data) {
      const html = decodeBase64(part.body.data);
      return stripHtml(html);
    }

    if (part.parts) {
      part.parts.forEach((p) => stack.push(p));
    }
  }

  return '';
}

function extractBodyHtml(payload: gmail_v1.Schema$MessagePart): string | undefined {
  const stack: gmail_v1.Schema$MessagePart[] = [payload];

  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;

    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64(part.body.data);
    }

    if (part.parts) {
      part.parts.forEach((p) => stack.push(p));
    }
  }

  return undefined;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(?:div|p)[^>]*>/gi, '\n')
    .replace(/<\/(?:div|p)>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanBody(text: string): string {
  if (!text) return '';
  let cleaned = text
    .replace(/^[>|].*$/gm, '')
    .replace(/\nOn .* wrote:\n[\s\S]*$/i, '')
    .replace(/--\s*\n[\s\S]*$/m, '')
    .trim();
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return cleaned;
}

export function parseMessage(message: gmail_v1.Schema$Message): ParsedMessage | null {
  try {
    if (!message.id || !message.threadId) {
      return null;
    }

    const payload = message.payload;
    if (!payload) {
      return null;
    }

    const headers = payload.headers || [];
    const subject = headerValue(headers, 'Subject');
    const from = headerValue(headers, 'From');
    const to = headerValue(headers, 'To');
    const cc = headerValue(headers, 'Cc');
    const bcc = headerValue(headers, 'Bcc');

    const internalDate = message.internalDate ? parseInt(message.internalDate, 10) : Date.now();
    const receivedAt = new Date(internalDate).toISOString();

    const bodyText = cleanBody(extractBodyText(payload));
    const bodyHtml = extractBodyHtml(payload);

    return {
      gmail: {
        message_id: message.id,
        thread_id: message.threadId,
        subject: subject || '(no subject)',
        snippet: message.snippet || '',
        received_at: receivedAt,
        received_internaldate_ms: internalDate,
      },
      participants: {
        from: from ? parseAddress(from) : undefined,
        to: to ? splitAddresses(to) : undefined,
        cc: cc ? splitAddresses(cc) : undefined,
        bcc: bcc ? splitAddresses(bcc) : undefined,
      },
      content: {
        body_text: bodyText,
        body_html: bodyHtml,
      },
    };
  } catch (error) {
    logger.error('Error parsing message', error);
    return null;
  }
}

export function getMessageTimestamp(parsed: ParsedMessage): number {
  return parsed.gmail.received_internaldate_ms || Date.parse(parsed.gmail.received_at);
}

export function buildGmailQuery(
  beforeTimestamp?: number,
  afterTimestamp?: number
): string {
  const parts: string[] = [
    'in:anywhere',
    '-category:promotions',
    '-category:social',
    '-category:updates',
    '-category:forums',
    '-label:spam',
    '-label:trash',
    '-is:chat',
    '-from:mailer-daemon',
  ];

  if (beforeTimestamp) {
    const beforeDate = new Date(beforeTimestamp);
    const beforeStr = beforeDate.toISOString().split('T')[0].replace(/-/g, '/');
    parts.push(`before:${beforeStr}`);
  }

  if (afterTimestamp) {
    const afterDate = new Date(afterTimestamp);
    const afterStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/');
    parts.push(`after:${afterStr}`);
  }

  return parts.join(' ');
}

