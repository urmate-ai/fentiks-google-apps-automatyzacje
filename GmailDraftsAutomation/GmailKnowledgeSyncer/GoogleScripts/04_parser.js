const GmailParser = (() => {
  function headerValue(headers, name) {
    if (!Array.isArray(headers)) return '';
    const lower = String(name || '').toLowerCase();
    const header = headers.find((h) => h && typeof h.name === 'string' && h.name.toLowerCase() === lower);
    return header && header.value ? header.value : '';
  }

  function parseAddress(raw) {
    if (!raw) return null;
    const match = /"?([^"<]*)"?\s*<([^>]+)>/.exec(raw);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    return { name: '', email: String(raw).trim() };
  }

  function splitAddresses(raw) {
    if (!raw) return [];
    return String(raw)
      .split(',')
      .map((part) => part && part.trim())
      .filter(Boolean)
      .map((part) => parseAddress(part));
  }

  function normalizeBase64(value) {
    if (!value) return null;

    const cleaned = String(value).trim().replace(/\s+/g, '');
    if (!cleaned) return null;

    const standard = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    if (/[^A-Za-z0-9+/=]/.test(standard)) {
      return null;
    }

    const remainder = standard.length % 4;
    if (remainder === 1) {
      return null;
    }

    const padded = remainder === 0 ? standard : standard + '='.repeat(4 - remainder);
    return {
      padded,
      urlSafe: cleaned !== standard,
    };
  }

  function decodeWithFallback(b64) {
    const normalized = normalizeBase64(b64);
    if (!normalized) return '';

    const { padded, urlSafe } = normalized;
    const hasStandardDecoder = typeof Utilities.base64Decode === 'function';
    const hasWebSafeDecoder = typeof Utilities.base64DecodeWebSafe === 'function';

    if (hasStandardDecoder) {
      const bytes = Utilities.base64Decode(padded);
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }

    if (hasWebSafeDecoder) {
      const webSafeValue = urlSafe ? padded.replace(/\+/g, '-').replace(/\//g, '_') : padded;
      const bytes = Utilities.base64DecodeWebSafe(webSafeValue);
      return Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }

    return '';
  }

  function decodeBody(b64) {
    return decodeWithFallback(b64);
  }

  function stripHtml(html) {
    if (!html) return '';
    return String(html)
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

  function extractPlainText(payload) {
    const stack = [payload];
    while (stack.length) {
      const part = stack.pop();
      if (!part) continue;
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return decodeBody(part.body.data);
      }
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        return stripHtml(decodeBody(part.body.data));
      }
      if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => stack.push(child));
      }
    }
    return '';
  }

  function cleanBody(text) {
    if (!text) return '';
    let cleaned = String(text)
      .replace(/^[>|].*$/gm, '')
      .replace(/\nOn .* wrote:\n[\s\S]*$/i, '')
      .replace(/--\s*\n[\s\S]*$/m, '')
      .trim();
    cleaned = cleaned
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    return cleaned;
  }

  function guessLang(text) {
    if (!text) return 'unknown';
    const plChars = /[ąćęłńóśźż]/i.test(text);
    const enWords = /\b(the|and|to|of|in|on)\b/i.test(text);
    if (plChars && !enWords) return 'pl';
    if (enWords && !plChars) return 'en';
    return 'unknown';
  }

  function formatDateForGmail(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('Invalid date provided');
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  function formatTimestampForGmail(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error('Invalid timestamp provided');
    }
    return Math.floor(Number(timestamp) / 1000);
  }

  const BASE_QUERY_PARTS = [
    'in:anywhere',
    '-category:promotions',
    '-category:social',
    '-category:updates',
    '-category:forums',
    '-is:chat',
    '-label:spam',
    '-label:trash',
    '-from:mailer-daemon',
  ];

  const NEWSLETTER_HEADERS = ['List-Unsubscribe', 'List-Id'];
  const AUTOMATED_ADDRESS_PATTERNS = [
    /no[-_.]?reply/i,
    /news(letter)?/i,
    /notification/i,
    /offers?/i,
    /promo/i,
    /do[-_.]?not[-_.]?reply/i,
  ];

  function hasHeader(headers, name) {
    return headers.some(
      (header) =>
        header &&
        typeof header.name === 'string' &&
        header.name.toLowerCase() === String(name || '').toLowerCase() &&
        header.value,
    );
  }

  function isAutomatedAddress(address) {
    if (!address || !address.email) return false;
    return AUTOMATED_ADDRESS_PATTERNS.some((pattern) => pattern.test(address.email));
  }

  function hasNewsletterHeaders(headers) {
    return NEWSLETTER_HEADERS.some((name) => hasHeader(headers, name));
  }

  function isPromotionalLabel(labels) {
    if (!Array.isArray(labels)) return false;
    return labels.some((label) =>
      ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(label),
    );
  }

  function parseMessage(message) {
    if (!message || !message.payload) {
      return null;
    }
    const headers = message.payload.headers || [];
    const subject = headerValue(headers, 'Subject');
    const fromRaw = headerValue(headers, 'From');
    const toRaw = headerValue(headers, 'To');
    const ccRaw = headerValue(headers, 'Cc');
    const body = extractPlainText(message.payload) || '';
    const cleanedBody = cleanBody(body);
    const dateMs = Number(message.internalDate);
    const attachments = (message.payload.parts || [])
      .filter((part) => part && part.filename && part.body && part.body.attachmentId)
      .map((part) => ({ filename: part.filename, mimeType: part.mimeType }));
    const receivedAt = Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null;

    return {
      sync_metadata: {
        source: 'gmail',
        version: 1,
      },
      gmail: {
        message_id: message.id,
        thread_id: message.threadId,
        history_id: message.historyId || null,
        received_internaldate_ms: Number.isFinite(dateMs) ? dateMs : null,
        received_at: receivedAt,
        subject: subject || '',
        snippet: message.snippet || '',
        labels: message.labelIds || [],
      },
      participants: {
        from: parseAddress(fromRaw),
        to: splitAddresses(toRaw),
        cc: splitAddresses(ccRaw),
      },
      content: {
        body_text: cleanedBody,
        lang: guessLang(cleanedBody),
        quoted_removed: true,
        attachments,
      },
    };
  }

  function normalizeQueryOptions(input) {
    if (input && typeof input === 'object' && !Number.isFinite(input)) {
      return input;
    }
    if (!input) {
      return {};
    }
    return { afterTimestamp: input };
  }

  function buildGmailQuery(baseQuery, rawOptions) {
    const segments = BASE_QUERY_PARTS.slice();
    if (baseQuery) {
      segments.unshift(String(baseQuery).trim());
    }
    const options = normalizeQueryOptions(rawOptions);
    const cleanedSegments = segments.filter(Boolean);
    if (options.afterTimestamp) {
      const afterSeconds = formatTimestampForGmail(Number(options.afterTimestamp));
      cleanedSegments.push(`after:${afterSeconds}`);
    }
    if (options.beforeTimestamp) {
      const beforeSeconds = formatTimestampForGmail(Number(options.beforeTimestamp));
      cleanedSegments.push(`before:${beforeSeconds}`);
    }
    return cleanedSegments.join(' ').replace(/\s+/g, ' ').trim();
  }

  function getMessageTimestamp(parsedMessage) {
    if (!parsedMessage || !parsedMessage.gmail) return 0;
    const raw = parsedMessage.gmail.received_internaldate_ms;
    if (Number.isFinite(raw)) {
      return Number(raw);
    }
    const iso = parsedMessage.gmail.received_at;
    const isoTs = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(isoTs) ? isoTs : 0;
  }

  function isLikelyPersonal(message, parsedMessage) {
    if (!message || !parsedMessage) {
      return false;
    }
    if (isPromotionalLabel(message.labelIds)) {
      return false;
    }
    const headers = message.payload && message.payload.headers ? message.payload.headers : [];
    if (hasNewsletterHeaders(headers)) {
      return false;
    }
    const fromAddress = parsedMessage.participants ? parsedMessage.participants.from : null;
    if (isAutomatedAddress(fromAddress)) {
      return false;
    }
    const tos = (parsedMessage.participants && parsedMessage.participants.to) || [];
    if (tos.every((addr) => addr && addr.email && /group\./i.test(addr.email))) {
      return false;
    }
    return true;
  }

  return {
    headerValue,
    parseAddress,
    splitAddresses,
    decodeBody,
    stripHtml,
    extractPlainText,
    cleanBody,
    guessLang,
    formatDateForGmail,
    buildGmailQuery,
    formatTimestampForGmail,
    parseMessage,
    getMessageTimestamp,
    isLikelyPersonal,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.GmailParser = GmailParser;
}

if (typeof module !== 'undefined') {
  module.exports = GmailParser;
}
