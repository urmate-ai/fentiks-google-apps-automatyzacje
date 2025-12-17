import { ChatOpenAI } from '@langchain/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import { ChatGeneration, ChatResult } from '@langchain/core/outputs';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

class GoogleGenerativeAIWrapper extends BaseChatModel {
  private genAI: GoogleGenerativeAI;
  private modelName: string;
  private temperature: number;
  private maxOutputTokens: number;

  constructor(apiKey: string, modelName: string, temperature: number, maxOutputTokens: number) {
    super({});
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
    this.temperature = temperature;
    this.maxOutputTokens = maxOutputTokens;
  }

  _llmType(): string {
    return 'google_generative_ai';
  }

  async _generate(
    messages: BaseMessage[],
    _options?: any
  ): Promise<ChatResult> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
      },
    });

    const systemInstruction = messages.find((msg) => msg._getType() === 'system')?.content;
    const userMessages = messages.filter((msg) => msg._getType() !== 'system');

    let prompt = '';
    if (systemInstruction) {
      prompt += `System: ${systemInstruction}\n\n`;
    }

    userMessages.forEach((msg) => {
      const role = msg._getType() === 'human' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n\n`;
    });
    prompt += 'Assistant:';

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const aiMessage = new AIMessage(text);
    const generation: ChatGeneration = {
      message: aiMessage,
      text,
    };

    return {
      generations: [generation],
    };
  }
}

export function createLLM(): BaseChatModel {
  if (config.openaiApiKey) {
    const llm = new ChatOpenAI({
      openAIApiKey: config.openaiApiKey,
      modelName: config.llmModel,
      temperature: config.llmTemperature,
      maxTokens: config.llmMaxTokens,
    });
    return llm as BaseChatModel;
  } else if (config.googleGenAiApiKey) {
    logger.info('Using Google Generative AI via direct SDK');
    return new GoogleGenerativeAIWrapper(
      config.googleGenAiApiKey,
      config.llmModel,
      config.llmTemperature,
      config.llmMaxTokens
    );
  } else {
    throw new Error('No LLM API key configured');
  }
}

