const { createUtilitiesMock } = require('../testUtils');

const parserModulePath = require.resolve('../GoogleScripts/04_parser.js');

describe('parser helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    global.Utilities = createUtilitiesMock();
    delete require.cache[parserModulePath];
  });

  afterEach(() => {
    delete global.Utilities;
    delete global.headerValue;
    delete global.parseAddress;
    delete global.splitAddresses;
    delete global.decodeBody;
    delete global.stripHtml;
    delete global.extractPlainText;
    delete global.cleanBody;
    delete global.guessLang;
    delete global.formatDateForGmail;
    delete global.formatTimestampForGmail;
    delete global.buildGmailQuery;
    delete global.parseMessage;
    delete global.getMessageTimestamp;
    delete global.isLikelyPersonal;
  });

  function loadParser() {
    return require(parserModulePath);
  }

  it('strips HTML and cleans body', () => {
    const { stripHtml, cleanBody } = loadParser();
    const html = '<p>Hello&nbsp;World</p><br><div>Line2</div>';
    expect(stripHtml(html)).toBe('Hello World\n\nLine2');

    const dirty = 'Line1\n> quoted\n\nOn Someone wrote:\nquoted\n--\nsignature\n\n\n';
    expect(cleanBody(dirty)).toBe('Line1');
  });

  it('parses addresses', () => {
    const { parseAddress, splitAddresses } = loadParser();
    expect(parseAddress('John Doe <john@example.com>')).toEqual({ name: 'John Doe', email: 'john@example.com' });
    expect(parseAddress('plain@example.com')).toEqual({ name: '', email: 'plain@example.com' });
    expect(splitAddresses('a@example.com, "User" <user@example.com>')).toEqual([
      { name: '', email: 'a@example.com' },
      { name: 'User', email: 'user@example.com' },
    ]);
  });

  it('builds Gmail query with timestamp', () => {
    const { buildGmailQuery } = loadParser();
    const ts = new Date('2024-02-01T10:00:00Z').getTime();
    const query = buildGmailQuery('', ts);
    expect(query).toContain('in:anywhere');
    expect(query).toContain('-category:promotions');
    const expectedSeconds = Math.floor(ts / 1000);
    expect(query).toContain(`after:${expectedSeconds}`);
  });

  it('builds Gmail query with before option', () => {
    const { buildGmailQuery } = loadParser();
    const afterTs = new Date('2024-02-01T00:00:00Z').getTime();
    const beforeTs = new Date('2024-03-01T00:00:00Z').getTime();
    const query = buildGmailQuery('', { afterTimestamp: afterTs, beforeTimestamp: beforeTs });
    expect(query).toContain(`after:${Math.floor(afterTs / 1000)}`);
    expect(query).toContain(`before:${Math.floor(beforeTs / 1000)}`);
  });

  it('parses Gmail message into payload', () => {
    const { parseMessage, getMessageTimestamp, isLikelyPersonal } = loadParser();
    const now = Date.now();
    const message = {
      id: 'm1',
      threadId: 't1',
      historyId: 'h1',
      internalDate: String(now),
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'Subject', value: 'Hello' },
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'To', value: 'Bob <bob@example.com>' },
        ],
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Cześć świecie!').toString('base64') },
          },
          {
            mimeType: 'application/pdf',
            filename: 'file.pdf',
            body: { attachmentId: 'att-1' },
          },
        ],
      },
    };

    const payload = parseMessage(message);
    expect(payload).toMatchObject({
      gmail: {
        message_id: 'm1',
        thread_id: 't1',
        history_id: 'h1',
        subject: 'Hello',
        labels: ['INBOX'],
      },
      participants: {
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
      },
      content: {
        attachments: [{ filename: 'file.pdf', mimeType: 'application/pdf' }],
        quoted_removed: true,
      },
      sync_metadata: {
        source: 'gmail',
        version: 1,
      },
    });
    expect(payload.content.body_text).toContain('Cześć');
    expect(payload.content.lang).toBe('pl');
    expect(getMessageTimestamp(payload)).toBeCloseTo(now, -2);
    expect(isLikelyPersonal(message, payload)).toBe(true);
  });

  it('marks newsletters as non-personal', () => {
    const { parseMessage, isLikelyPersonal } = loadParser();
    const message = {
      id: 'm2',
      threadId: 't2',
      internalDate: String(Date.now()),
      labelIds: ['CATEGORY_PROMOTIONS'],
      payload: {
        headers: [
          { name: 'Subject', value: 'Promo' },
          { name: 'From', value: 'News <newsletter@example.com>' },
          { name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: Buffer.from('Sale!').toString('base64') },
      },
    };

    const parsed = parseMessage(message);
    expect(isLikelyPersonal(message, parsed)).toBe(false);
  });

  it('decodes bodies even when Gmail returns non padded data', () => {
    const mock = createUtilitiesMock();
    global.Utilities = {
      ...mock,
      base64Decode: jest.fn(mock.base64Decode),
    };

    const { decodeBody } = loadParser();
    const encoded = Buffer.from('Hello world!', 'utf8').toString('base64').replace(/=+$/g, '');
    expect(decodeBody(encoded)).toBe('Hello world!');
    expect(global.Utilities.base64Decode).toHaveBeenCalledTimes(1);
  });

  it('returns empty string for invalid base64 length', () => {
    const mock = createUtilitiesMock();
    global.Utilities = {
      ...mock,
      base64Decode: jest.fn(mock.base64Decode),
    };

    const { decodeBody } = loadParser();
    expect(decodeBody('abcde')).toBe('');
    expect(global.Utilities.base64Decode).not.toHaveBeenCalled();
  });
});
