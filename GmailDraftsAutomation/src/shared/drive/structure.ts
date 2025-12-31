import { logger } from '../logger/index.js';

export const DRIVE_STRUCTURE = {
  GMAIL_KNOWLEDGE: 'Wiedza z Gmaila',
  PROCESSED_EMAILS_FILE: 'processedEmails.jsonl',
  FENTIKS_SCHEDULE_FILE: 'terminarz_szkolen.json',
} as const;

export function getGmailKnowledgePath(year: string, month?: string): string[] {
  const path = [DRIVE_STRUCTURE.GMAIL_KNOWLEDGE, year];
  if (month) {
    path.push(month);
  }
  return path;
}

export function getGmailDailyFileName(date: string): string {
  return `${date}.jsonl`;
}

export function getFentiksSchedulePath(): string[] {
  return [];
}

export function getFentiksScheduleFileName(): string {
  return DRIVE_STRUCTURE.FENTIKS_SCHEDULE_FILE;
}

export function getProcessedEmailsFileName(): string {
  return DRIVE_STRUCTURE.PROCESSED_EMAILS_FILE;
}

export function parseIsoDate(isoDate: string): {
  year: string;
  month: string;
  day: string;
  date: string;
} {
  if (!isoDate || typeof isoDate !== 'string') {
    logger.warn(`Invalid ISO date: ${isoDate}`);
    return {
      year: 'unknown',
      month: 'unknown',
      day: 'unknown',
      date: 'unknown',
    };
  }

  try {
    const year = isoDate.slice(0, 4);
    const month = isoDate.slice(0, 7);
    const day = isoDate.slice(0, 10);

    return { year, month, day, date: day };
  } catch (error) {
    logger.error(`Error parsing ISO date: ${isoDate}`, error);
    return {
      year: 'unknown',
      month: 'unknown',
      day: 'unknown',
      date: 'unknown',
    };
  }
}

export function validateFolderId(folderId: string | undefined, configName: string): asserts folderId is string {
  if (!folderId || !folderId.trim()) {
    throw new Error(`${configName} is not configured. Please set the environment variable.`);
  }
}

