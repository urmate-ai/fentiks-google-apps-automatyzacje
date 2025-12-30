import { gmail_v1, google } from 'googleapis';
import { logger } from '../shared/logger/index.js';
import { config } from '../shared/config/index.js';
import { stripHtml } from '../shared/utils/index.js';
import { createLLM } from './llm.js';
import { RagService } from './rag.js';
import { extractJson } from '../shared/utils/index.js';

const PERSONAL_QUERY_PARTS = [
  '-category:promotions',
  '-category:social',
  '-category:updates',
  '-category:forums',
  '-label:spam',
  '-label:trash',
  '-is:chat',
  '-from:mailer-daemon',
];

export interface ClassificationResult {
  classification: 'ready' | 'template' | 'ignored';
  lang: 'pl' | 'en' | 'other';
  response: string | null;
}

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private llm: ReturnType<typeof createLLM>;
  private ragService: RagService;

  constructor(auth: any) {
    this.gmail = google.gmail({ version: 'v1', auth });
    this.llm = createLLM();
    this.ragService = new RagService();
    
    this.ragService.checkDatabaseStatus().catch((error) => {
      logger.error('Failed to check RAG database status', error);
    });
  }

  buildContext(_subject: string, _body: string): string {
    return [
      'Rules:',
      '- Retrieve the necessary knowledge from the configured RAG corpus.',
      '- If the retrieval does not provide enough data, leave missing fields as [____] to be completed by a human.',
    ].join('\n');
  }

  async isQuoteRequest(subject: string, body: string): Promise<boolean> {
    const prompt = `Analyze the following email and determine if it is a quote request or pricing inquiry (zapytanie ofertowe/zapytanie cenowe).

Email subject: ${subject}
Email body: ${body}

Respond with ONLY a JSON object: {"isQuoteRequest": true|false}

A quote request is an email asking for:
- Price, cost, estimate, quotation, offer (cena, koszt, wycena, oferta)
- Budget information (informacje o budżecie)
- Project pricing (wycena projektu)
- Service costs (koszty usług)
- Product pricing (ceny produktów)
- Request for quote (RFQ)
- Any inquiry about costs or pricing

Do NOT consider as quote requests:
- General questions
- Support requests
- Meeting requests
- Information requests that don't involve pricing`;

    try {
      const response = await this.llm.invoke([
        { role: 'system', content: 'You are a helpful assistant that analyzes emails. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ]);

      const content = typeof response.content === 'string' ? response.content : '';
      const jsonStr = extractJson(content);
      const json = JSON.parse(jsonStr);

      return Boolean(json.isQuoteRequest);
    } catch (error) {
      logger.warn('Error detecting quote request, defaulting to false', error);
      return false;
    }
  }

  async classifyAndReply(
    subject: string,
    body: string,
    context: string
  ): Promise<ClassificationResult> {
    const ragContext = await this.ragService.retrieveContext(`${subject}\n\n${body}`);
    
    if (ragContext) {
      logger.info(`RAG context retrieved (length: ${ragContext.length} chars)`);
      logger.debug(`Full RAG context:\n${ragContext}`);
    } else {
      logger.warn('No RAG context found - will use template classification');
    }

    const systemPrompt = [
      config.systemContext ||
        "You are Mateusz Janota's private email assistant trained on the history of his mailbox. Respond to emails on his behalf.",
      '',
      'CRITICAL INSTRUCTIONS FOR RAG CONTEXT:',
      '1. The RAG RETRIEVED CONTEXT contains search results ordered by relevance (highest similarity first).',
      '2. Results marked with "⭐ HIGHEST PRIORITY" have the highest similarity and are most likely to contain the answer.',
      '3. ALWAYS check the FIRST result in RAG context FIRST - it has the highest similarity score.',
      '4. If the first result contains information that answers the email question, you MUST use it and classify as "ready".',
      '5. Similarity scores above 0.55 are considered highly relevant - use them!',
      '6. Ignore lower similarity results if a high-similarity result already answers the question.',
      '',
      'Return ONLY valid JSON with keys {"classification":"ready|template|ignored","lang":"pl|en|other","response":string|null}.',
      'If classification="ignored" then response must be null.',
      '',
      'CLASSIFICATION RULES:',
      '- Use "ignored" ONLY for: spam, automated notifications, no-reply emails, or emails that clearly do not require a response. If the email asks a question or requires any response, do NOT use "ignored".',
      '- Use "ready" when RAG RETRIEVED CONTEXT (especially the FIRST/HIGHEST PRIORITY result) contains sufficient information to answer the email completely. YOU MUST extract and use the actual data from RAG context in your response.',
      '- Use "template" ONLY when RAG RETRIEVED CONTEXT does NOT contain the needed information, or when the information is incomplete.',
      '- CRITICAL: If RAG context shows "⭐ HIGHEST PRIORITY" or has similarity > 0.55 and contains relevant data, you MUST use "ready" classification and provide the full answer using that data.',
      '- Example: If email asks "Ile wynosiły zyski firmy w 2025?" and RAG context contains "Zyski naszej firmy wyniosły 3 mln złotych", you MUST respond with "ready" and answer "Zyski naszej firmy wyniosły 3 mln złotych".',
      '- Do NOT say "nie dysponujemy takimi informacjami" if the information IS in the RAG RETRIEVED CONTEXT, especially in the first/highest priority result. Read it carefully!',
      '',
      'RESPONSE FORMAT:',
      '- If "ready": create a full HTML reply in detected language using data from RAG context. Extract the actual numbers, facts, and information from RAG context.',
      '- If "template": create a brief HTML reply skeleton with [____] placeholders only when data is missing from RAG context.',
      '- Do not use signature in the response. Signature is added by the script after the response is generated.',
      '- Always end the message politely with a closing phrase, such as "Z poważaniem," (for Polish) or "Best regards," (for English), but without any name or signature after it.',
      '- Use <br> for new lines. Placeholders must be exactly four underscores inside square brackets: [____].',
    ]
      .filter(Boolean)
      .join(' ');

    const userPrompt = [
      'CONTEXT:',
      context,
      '',
      'RAG RETRIEVED CONTEXT:',
      ragContext || '(No relevant context found)',
      '',
      'EMAIL SUBJECT:',
      subject || '(no subject)',
      '',
      'EMAIL BODY:',
      body || '(empty body)',
    ].join('\n');

    try {
      const response = await this.llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = typeof response.content === 'string' ? response.content : '';
      const jsonStr = extractJson(content);
      const json = JSON.parse(jsonStr);

      return {
        classification: (json.classification || 'ignored') as 'ready' | 'template' | 'ignored',
        lang: (json.lang || 'pl') as 'pl' | 'en' | 'other',
        response: json.response ? String(json.response) : null,
      };
    } catch (error) {
      logger.warn('LLM classification error', error);
      return { classification: 'ignored', lang: 'pl', response: null };
    }
  }

  async fetchCandidateThreads(limit: number = 5): Promise<gmail_v1.Schema$Thread[]> {
    const query = [
      'in:inbox',
      'is:unread',
      ...PERSONAL_QUERY_PARTS,
      `-label:${config.gmailLabels.ready}`,
      `-label:${config.gmailLabels.template}`,
      `-label:${config.gmailLabels.failed}`,
      config.gmailLabels.ignored ? `-label:${config.gmailLabels.ignored}` : '',
      'newer_than:14d',
    ]
      .filter(Boolean)
      .join(' ');

    logger.info(`[Email Automation] Searching for candidate threads with query: ${query}`);
    
    const response = await this.gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: limit,
    });

    const threads = response.data.threads || [];
    logger.info(`[Email Automation] Found ${threads.length} candidate threads (limit: ${limit})`);

    if (threads.length === 0) {
      logger.info('[Email Automation] No threads found with strict query. Trying broader searches...');
      
      const unreadQuery = 'in:inbox is:unread newer_than:14d';
      const unreadResponse = await this.gmail.users.threads.list({
        userId: 'me',
        q: unreadQuery,
        maxResults: 5,
      });
      logger.info(`[Email Automation] Unread emails (any): ${unreadResponse.data.threads?.length || 0}`);
      
      const inboxQuery = 'in:inbox newer_than:14d';
      const inboxResponse = await this.gmail.users.threads.list({
        userId: 'me',
        q: inboxQuery,
        maxResults: 5,
      });
      logger.info(`[Email Automation] Inbox emails (read+unread): ${inboxResponse.data.threads?.length || 0}`);
      
      const readyQuery = `label:${config.gmailLabels.ready} newer_than:14d`;
      const readyResponse = await this.gmail.users.threads.list({
        userId: 'me',
        q: readyQuery,
        maxResults: 5,
      });
      logger.info(`[Email Automation] Emails with "${config.gmailLabels.ready}" label: ${readyResponse.data.threads?.length || 0}`);
    }
    
    return threads.map((t) => t as gmail_v1.Schema$Thread);
  }

  async fetchFailedThreads(limit: number = 2): Promise<gmail_v1.Schema$Thread[]> {
    const query = [
      `label:${config.gmailLabels.failed}`,
      'is:unread',
      ...PERSONAL_QUERY_PARTS,
      `-label:${config.gmailLabels.ready}`,
      `-label:${config.gmailLabels.template}`,
      config.gmailLabels.ignored ? `-label:${config.gmailLabels.ignored}` : '',
      'newer_than:14d',
    ]
      .filter(Boolean)
      .join(' ');

    logger.info(`[Email Automation] Searching for failed threads with query: ${query}`);
    
    const response = await this.gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: limit,
    });

    const threads = response.data.threads || [];
    logger.info(`[Email Automation] Found ${threads.length} failed threads (limit: ${limit})`);
    
    return threads.map((t) => t as gmail_v1.Schema$Thread);
  }

  async threadHasDraft(threadId: string): Promise<boolean> {
    try {
      const thread = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });

      const messages = thread.data.messages || [];
      return messages.some((msg) => msg.labelIds?.includes('DRAFT') ?? false);
    } catch {
      return false;
    }
  }

  async processThread(threadId: string): Promise<void> {
    try {
      const thread = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });

      const messages = thread.data.messages || [];
      if (messages.length === 0) return;

      const latestMessage = messages[messages.length - 1];
      if (!latestMessage.id) return;

      const message = await this.gmail.users.messages.get({
        userId: 'me',
        id: latestMessage.id,
        format: 'full',
      });

      const headers = message.data.payload?.headers || [];
      const subject =
        headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';

      if (
        /no[-]?reply|do[-]?not[-]?reply|donotreply/i.test(from) ||
        /(alert|notification)/i.test(subject)
      ) {
        await this.addLabel(threadId, config.gmailLabels.ignored);
        return;
      }

      const bodyText = this.extractBodyText(message.data);
      const bodyPlain = stripHtml(bodyText);

      const isQuote = await this.isQuoteRequest(subject, bodyPlain);
      if (isQuote) {
        logger.info('To jest zapytanie ofertowe', { subject, threadId });
      }

      const context = this.buildContext(subject, bodyPlain);

      const result = await this.classifyAndReply(subject, bodyPlain, context);
      logger.info('Classification result', result);

      if (result.classification === 'ignored' || !result.response) {
        await this.addLabel(threadId, config.gmailLabels.ignored);
        return;
      }

      const html = this.postProcessResponse(result.response, result.lang);

      const hasPlaceholders = /\[<span[^>]*>____<\/span>\]/.test(html);
      const needHuman = result.classification !== 'ready' || hasPlaceholders;
      
      await this.createDraftReply(threadId, html);

      if (needHuman) {
        await this.addLabel(threadId, config.gmailLabels.template);
        await this.removeLabel(threadId, config.gmailLabels.ready);
      } else {
        await this.addLabel(threadId, config.gmailLabels.ready);
        await this.removeLabel(threadId, config.gmailLabels.template);
      }
    } catch (error) {
      logger.error(`Error processing thread ${threadId}`, error);
      await this.addLabel(threadId, config.gmailLabels.failed);
      throw error;
    }
  }

  private extractBodyText(message: gmail_v1.Schema$Message): string {
    const payload = message.payload;
    if (!payload) return '';

    const extractFromPart = (part: gmail_v1.Schema$MessagePart): string => {
      if (part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        return part.parts.map((p) => extractFromPart(p)).join('\n');
      }
      return '';
    };

    return extractFromPart(payload);
  }

  private postProcessResponse(raw: string, lang: string): string {
    const signature =
      lang && lang.toLowerCase().startsWith('en') ? config.signatures.en : config.signatures.pl;

    const cleaned = (raw || '')
      .trim()
      .replace(/^```(?:html)?\n?/i, '')
      .replace(/```$/i, '')
      .trim();

    const sanitized = cleaned.replace(/\[____[^\]]*\]/g, '[____]');

    const withSig = sanitized.includes(signature)
      ? sanitized
      : sanitized + (sanitized.endsWith('<br>') ? '' : '<br><br>') + signature;

    const withPlaceholders = withSig.replace(
      /\[____[^\]]*\]/g,
      '[<span style="background-color: rgb(0, 255, 255);">____</span>]'
    );

    return withPlaceholders;
  }

  private async createDraftReply(threadId: string, htmlBody: string): Promise<void> {
    const thread = await this.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const messages = thread.data.messages || [];
    if (messages.length === 0) return;

    const latestMessage = messages[messages.length - 1];
    const latestMessageId = latestMessage.id;
    if (!latestMessageId) return;

    const headers = latestMessage.payload?.headers || [];
    const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
    const messageId = headers.find((h) => h.name?.toLowerCase() === 'message-id')?.value || '';
    const references = headers.find((h) => h.name?.toLowerCase() === 'references')?.value || '';
    
    const fromEmail = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)![1] : from.trim();
    
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    const referencesHeader = references 
      ? `${references} ${messageId}`.trim() 
      : messageId;

    const cleanHtml = htmlBody
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<body[^>]*>/gi, '')
      .replace(/<\/body>/gi, '')
      .trim();

    const emailLines = [
      `To: ${fromEmail}`,
      `Subject: ${replySubject}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
    ];

    if (messageId) {
      emailLines.push(`In-Reply-To: ${messageId}`);
    }
    if (referencesHeader) {
      emailLines.push(`References: ${referencesHeader}`);
    }

    emailLines.push('');
    emailLines.push(cleanHtml);

    const raw = emailLines.join('\r\n');

    const encoded = Buffer.from(raw, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const draft = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            threadId,
            raw: encoded,
          },
        },
      });

      logger.info(`Created draft ${draft.data.id} for thread ${threadId}`);
      logger.debug(`Draft content preview: ${cleanHtml.substring(0, 100)}...`);
    } catch (error) {
      logger.error(`Failed to create draft for thread ${threadId}`, error);
      throw error;
    }
  }

  async ensureLabelsExist(): Promise<void> {
    const labelsToCreate = [
      config.gmailLabels.ready,
      config.gmailLabels.template,
      config.gmailLabels.failed,
      config.gmailLabels.ignored,
    ].filter((label): label is string => Boolean(label));

    logger.info(`Ensuring ${labelsToCreate.length} labels exist...`);

    for (const labelName of labelsToCreate) {
      const labelId = await this.ensureLabelExists(labelName);
      if (labelId) {
        await this.setLabelColor(labelName, labelId);
      }
    }

    logger.info('All labels are ready with colors');
  }

  private async setLabelColor(labelName: string, labelId: string): Promise<void> {
    try {
      let color: { backgroundColor: string; textColor: string } | null = null;

      if (labelName === config.gmailLabels.failed) {
        color = { backgroundColor: '#ffad47', textColor: '#000000' };
      } else if (labelName === config.gmailLabels.ready) {
        color = { backgroundColor: '#16a766', textColor: '#ffffff' };
      } else if (labelName === config.gmailLabels.template) {
        color = { backgroundColor: '#3c78d8', textColor: '#ffffff' };
      } else if (labelName === config.gmailLabels.ignored) {
        color = null;
      }

      if (color) {
        await this.gmail.users.labels.patch({
          userId: 'me',
          id: labelId,
          requestBody: {
            color,
          },
        });
        logger.info(`Set color for label ${labelName}: ${color.backgroundColor}`);
      }
    } catch (error) {
      logger.warn(`Failed to set color for label ${labelName}`, error);
    }
  }

  private async ensureLabelExists(labelName: string): Promise<string | null> {
    if (!labelName) return null;
    
    try {
      const labels = await this.gmail.users.labels.list({ userId: 'me' });
      const existingLabel = labels.data.labels?.find((l) => l.name === labelName);

      if (existingLabel?.id) {
        logger.debug(`Label ${labelName} already exists`);
        await this.setLabelColor(labelName, existingLabel.id);
        return existingLabel.id;
      }

      logger.info(`Creating label: ${labelName}`);
      const newLabel = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });

      if (newLabel.data.id) {
        logger.info(`Label ${labelName} created with ID: ${newLabel.data.id}`);
        return newLabel.data.id;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to ensure label exists: ${labelName}`, error);
      return null;
    }
  }

  private async addLabel(threadId: string, labelName: string): Promise<void> {
    if (!labelName) return;
    
    try {
      const labelId = await this.ensureLabelExists(labelName);
      
      if (labelId) {
        await this.gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            addLabelIds: [labelId],
          },
        });
        logger.debug(`Added label ${labelName} to thread ${threadId}`);
      } else {
        logger.warn(`Could not add label ${labelName} - label creation failed`);
      }
    } catch (error) {
      logger.warn(`Failed to add label ${labelName}`, error);
    }
  }

  private async removeLabel(threadId: string, labelName: string): Promise<void> {
    try {
      const labels = await this.gmail.users.labels.list({ userId: 'me' });
      const label = labels.data.labels?.find((l) => l.name === labelName);

      if (label && label.id) {
        await this.gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            removeLabelIds: [label.id],
          },
        });
      }
    } catch (error) {
      logger.warn(`Failed to remove label ${labelName}`, error);
    }
  }
}

