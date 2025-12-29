import winston from 'winston';
import { config } from '../config/index.js';

const logLevels: Record<string, number> = {
  None: 0,
  Error: 1,
  Warning: 2,
  Information: 3,
  Debug: 4,
};

const levelMapping: Record<string, string> = {
  None: 'silent',
  Error: 'error',
  Warning: 'warn',
  Information: 'info',
  Debug: 'debug',
};

const currentLevel = logLevels[config.logLevel] ?? logLevels.Information;
const winstonLevel = levelMapping[config.logLevel || 'Information'] || 'info';

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
      })
    ),
  }),
];

if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      format,
    }),
    new winston.transports.File({
      filename: 'combined.log',
      format,
    })
  );
}

const logger = winston.createLogger({
  level: winstonLevel,
  format,
  transports,
  silent: currentLevel === 0,
});

if (config.slackWebhookUrl) {
  const originalError = logger.error.bind(logger);
  logger.error = ((message: any, ...args: any[]) => {
    const result = originalError(message, ...args);
    
    try {
      const slackMessage = [message, ...args]
        .map((arg) => {
          if (arg instanceof Error) return arg.message;
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      fetch(config.slackWebhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: slackMessage }),
      }).catch(() => {
      });
    } catch {
    }
    
    return result;
  }) as typeof logger.error;
}

export { logger, logLevels };
export default logger;

