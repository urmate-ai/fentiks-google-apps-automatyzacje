import { logger } from '../shared/logger/index.js';
import { createLLM } from '../email-automation/llm.js';
import { extractJson } from '../shared/utils/index.js';
import { ParsedMessage } from './parser.js';

export interface SpamClassificationResult {
  isSpam: boolean;
  isMarketing: boolean;
  reason?: string;
  confidence?: number;
}

export class SpamFilter {
  private llm: ReturnType<typeof createLLM>;

  constructor() {
    this.llm = createLLM();
  }

  async classifyEmail(parsed: ParsedMessage): Promise<SpamClassificationResult> {
    const subject = parsed.gmail.subject || '';
    const body = parsed.content.body_text || '';
    const from = parsed.participants.from?.email || '';
    const snippet = parsed.gmail.snippet || '';

    if (this.isSpamByHeuristics(subject, body, from, snippet)) {
      return {
        isSpam: true,
        isMarketing: true,
        reason: 'Detected by heuristics',
        confidence: 0.9,
      };
    }

    try {
      const prompt = `Analyze the following email and determine if it is SPAM or MARKETING email.

Email subject: ${subject}
Email from: ${from}
Email snippet: ${snippet}
Email body (first 500 chars): ${body.substring(0, 500)}

Respond with ONLY a JSON object: {"isSpam": true|false, "isMarketing": true|false, "reason": "brief explanation", "confidence": 0.0-1.0}

SPAM indicators:
- Unsolicited emails
- Phishing attempts
- Suspicious links
- Requests for personal information
- Too good to be true offers
- Urgent/scare tactics
- Generic greetings ("Dear customer", "Hello friend")

MARKETING indicators:
- Promotional content
- Sales offers
- Newsletter subscriptions
- Product announcements
- Discount codes
- "Unsubscribe" links
- Marketing campaigns
- Commercial advertisements

NOT spam/marketing:
- Personal emails
- Business inquiries
- Support requests
- Meeting requests
- Professional communications
- Transactional emails (invoices, receipts, confirmations)
- Important notifications`;

      const response = await this.llm.invoke([
        {
          role: 'system',
          content:
            'You are a helpful assistant that classifies emails. Always respond with valid JSON only. Be strict - only mark as spam/marketing if clearly so.',
        },
        { role: 'user', content: prompt },
      ]);

      const content = typeof response.content === 'string' ? response.content : '';
      const jsonStr = extractJson(content);
      const result = JSON.parse(jsonStr);

      return {
        isSpam: Boolean(result.isSpam),
        isMarketing: Boolean(result.isMarketing),
        reason: result.reason || '',
        confidence: result.confidence || 0.5,
      };
    } catch (error) {
      logger.warn('Error classifying email with AI, defaulting to not spam', error);
      return {
        isSpam: false,
        isMarketing: false,
        reason: 'Classification error',
        confidence: 0.0,
      };
    }
  }

  private isSpamByHeuristics(
    subject: string,
    body: string,
    from: string,
    snippet: string
  ): boolean {
    const text = `${subject} ${body} ${snippet}`.toLowerCase();

    const spamKeywords = [
      'viagra',
      'cialis',
      'lottery winner',
      'congratulations you won',
      'claim your prize',
      'urgent action required',
      'verify your account',
      'suspended account',
      'click here immediately',
      'limited time offer',
      'act now',
      'free money',
      'nigerian prince',
      'inheritance',
      'unclaimed funds',
    ];

    const marketingKeywords = [
      'unsubscribe',
      'marketing',
      'promotional',
      'special offer',
      'limited time',
      'discount code',
      'coupon',
      'sale',
      'newsletter',
      'subscribe',
      'promo',
      'deal',
      'flash sale',
      'exclusive offer',
    ];

    if (spamKeywords.some((keyword) => text.includes(keyword))) {
      return true;
    }

    if (marketingKeywords.some((keyword) => text.includes(keyword))) {
      if (from.includes('@') && !from.includes('noreply') && !from.includes('no-reply')) {
        return false;
      }
      return true;
    }

    const suspiciousFrom = [
      'noreply',
      'no-reply',
      'donotreply',
      'mailer-daemon',
      'postmaster',
    ];
    if (suspiciousFrom.some((pattern) => from.toLowerCase().includes(pattern))) {
      return true;
    }

    const genericGreetings = ['dear customer', 'hello friend', 'dear valued customer'];
    if (genericGreetings.some((greeting) => body.toLowerCase().includes(greeting))) {
      return true;
    }

    return false;
  }
}

