import { RagService } from '../email-automation/rag.js';
import { createLLM } from '../email-automation/llm.js';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

export interface ChatRequest {
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: string;
}

export interface ChatResponse {
  response: string;
  contextUsed?: boolean;
  error?: string;
}

export class ChatService {
  private ragService: RagService;
  private llm: ReturnType<typeof createLLM>;

  constructor() {
    this.ragService = new RagService();
    this.llm = createLLM();
  }

  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    try {
      const { message, conversationHistory = [], context: providedContext } = request;

      logger.info(`[Chat API] Processing message: "${message.substring(0, 100)}..."`);

      let ragContext = providedContext || '';
      if (!providedContext) {
        ragContext = await this.ragService.retrieveContext(message);
      }

      const hasContext = ragContext.length > 0;
      logger.info(`[Chat API] RAG context available: ${hasContext}`);

      const systemPrompt = [
        config.systemContext ||
          "Jesteś pomocnym asystentem AI. Odpowiadasz na pytania użytkowników w sposób profesjonalny i pomocny.",
        '',
        'INSTRUKCJE:',
        '- Jeśli masz dostęp do kontekstu RAG, użyj go do udzielenia dokładnej odpowiedzi.',
        '- Jeśli kontekst RAG zawiera informacje odpowiadające na pytanie, użyj ich bezpośrednio.',
        '- Odpowiadaj w języku, w którym zadano pytanie (polski lub angielski).',
        '- Bądź zwięzły, ale wyczerpujący.',
        '- Jeśli nie masz informacji w kontekście, powiedz to szczerze.',
      ].join('\n');

      const conversationContext = conversationHistory
        .map((msg) => `${msg.role === 'user' ? 'Użytkownik' : 'Asystent'}: ${msg.content}`)
        .join('\n');

      const fullPrompt = [
        conversationContext ? `Historia konwersacji:\n${conversationContext}\n\n` : '',
        ragContext ? `KONTEKST Z BAZY WIEDZY:\n${ragContext}\n\n` : '',
        `Pytanie użytkownika: ${message}`,
      ]
        .filter(Boolean)
        .join('\n');

      logger.debug(`[Chat API] Full prompt length: ${fullPrompt.length} chars`);

      const response = await this.llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullPrompt },
      ]);

      const responseText =
        typeof response.content === 'string' ? response.content : String(response.content);

      logger.info(`[Chat API] Generated response (length: ${responseText.length} chars)`);

      return {
        response: responseText.trim(),
        contextUsed: hasContext,
      };
    } catch (error) {
      logger.error('[Chat API] Error processing message', error);
      return {
        response: '',
        contextUsed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

