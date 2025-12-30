import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const LogLevelSchema = z.enum(['None', 'Error', 'Warning', 'Information', 'Debug']);

const ConfigSchema = z.object({
  databaseUrl: z.string().url(),
  googleClientId: z.string().min(1).optional(),
  googleClientSecret: z.string().min(1).optional(),
  googleRedirectUri: z.string().url().optional(),
  
  openaiApiKey: z.string().optional(),
  googleGenAiApiKey: z.string().optional(),
  
  llmModel: z.string().default('gpt-4-turbo-preview'),
  llmTemperature: z.number().min(0).max(2).default(0.2),
  llmMaxTokens: z.number().positive().default(1024),
  
  ragEmbeddingModel: z.string().default('text-embedding-3-small'),
  ragTopK: z.number().positive().default(5),
  ragSimilarityThreshold: z.number().min(0).max(1).default(0.7),
  
  gmailLabels: z.object({
    ready: z.string().default('Ready'),
    template: z.string().default('Template'),
    failed: z.string().default('Failed'),
    ignored: z.string().default('Ignored'),
  }),
  
  signatures: z.object({
    pl: z.string().default('Mateusz Janota'),
    en: z.string().default('Mateusz Janota'),
  }),
  
  systemContext: z.string().optional(),
  
  confidenceThreshold: z.number().min(0).max(1).default(0.75),
  
  logLevel: LogLevelSchema.default('Information'),
  slackWebhookUrl: z.string().url().optional(),
  
  driveRootFolderId: z.string().optional(),
  driveTargetFolderId: z.string().optional(),
  
  scheduleTargetFolderId: z.string().optional(),
  scheduleFileFormat: z.enum(['json', 'csv']).default('json'),
  
  chatApiKey: z.string().optional(),
  
  watchIntervals: z.object({
    gmailSync: z.number().positive().default(5 * 60 * 1000),
    emailAutomation: z.number().positive().default(10 * 60 * 1000),
    driveWatch: z.number().positive().default(15 * 60 * 1000),
    fentiksSync: z.number().positive().default(60 * 60 * 1000),
  }).default({
    gmailSync: 5 * 60 * 1000,
    emailAutomation: 10 * 60 * 1000,
    driveWatch: 15 * 60 * 1000,
    fentiksSync: 60 * 60 * 1000,
  }),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const rawConfig = {
    databaseUrl: process.env.DATABASE_URL,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleGenAiApiKey: process.env.GOOGLE_GEN_AI_API_KEY,
    llmModel: process.env.LLM_MODEL,
    llmTemperature: process.env.LLM_TEMPERATURE
      ? parseFloat(process.env.LLM_TEMPERATURE)
      : undefined,
    llmMaxTokens: process.env.LLM_MAX_TOKENS
      ? parseInt(process.env.LLM_MAX_TOKENS, 10)
      : undefined,
    ragEmbeddingModel: process.env.RAG_EMBEDDING_MODEL,
    ragTopK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K, 10) : undefined,
    ragSimilarityThreshold: process.env.RAG_SIMILARITY_THRESHOLD
      ? parseFloat(process.env.RAG_SIMILARITY_THRESHOLD)
      : undefined,
    gmailLabels: {
      ready: process.env.LABEL_READY,
      template: process.env.LABEL_TEMPLATE,
      failed: process.env.LABEL_FAILED,
      ignored: process.env.LABEL_IGNORED,
    },
    signatures: {
      pl: process.env.DEFAULT_SIGNATURE_PL,
      en: process.env.DEFAULT_SIGNATURE_EN,
    },
    systemContext: process.env.GEMINI_SYSTEM_CONTEXT,
    confidenceThreshold: process.env.CONFIDENCE_THRESHOLD
      ? parseFloat(process.env.CONFIDENCE_THRESHOLD)
      : undefined,
    logLevel: process.env.LOG_LEVEL || process.env.GEMINI_EMAIL_LOG_LEVEL,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    driveRootFolderId: process.env.RAG_REFRESHER_ROOT_FOLDER_ID,
    driveTargetFolderId: process.env.TARGET_FOLDER_ID,
    scheduleTargetFolderId: process.env.SCHEDULE_SCRAPER_TARGET_FOLDER_ID,
    scheduleFileFormat: process.env.SCHEDULE_SCRAPER_FILE_FORMAT,
    chatApiKey: process.env.CHAT_API_KEY,
    watchIntervals: {
      gmailSync: process.env.WATCH_GMAIL_SYNC_INTERVAL_MIN
        ? parseFloat(process.env.WATCH_GMAIL_SYNC_INTERVAL_MIN) * 60 * 1000
        : undefined,
      emailAutomation: process.env.WATCH_EMAIL_AUTOMATION_INTERVAL_MIN
        ? parseFloat(process.env.WATCH_EMAIL_AUTOMATION_INTERVAL_MIN) * 60 * 1000
        : undefined,
      driveWatch: process.env.WATCH_DRIVE_WATCH_INTERVAL_MIN
        ? parseFloat(process.env.WATCH_DRIVE_WATCH_INTERVAL_MIN) * 60 * 1000
        : undefined,
      fentiksSync: process.env.WATCH_FENTIKS_SYNC_INTERVAL_MIN
        ? parseFloat(process.env.WATCH_FENTIKS_SYNC_INTERVAL_MIN) * 60 * 1000
        : undefined,
    },
  };
        
  if (!rawConfig.openaiApiKey && !rawConfig.googleGenAiApiKey) {
    throw new Error(
      'At least one LLM provider must be configured (OPENAI_API_KEY or GOOGLE_GEN_AI_API_KEY)'
    );
  }

  return ConfigSchema.parse(rawConfig);
}

export const config = loadConfig();
export type { Config };

