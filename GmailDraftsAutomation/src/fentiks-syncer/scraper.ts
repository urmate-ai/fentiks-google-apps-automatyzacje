import { logger } from '../shared/logger/index.js';

const SCHEDULE_URL = 'https://fentiks.pl/terminarz-szkolen-i-egzaminow/';

export interface FentiksScheduleEntry {
  miejsce: string;
  data: string;
  cena: string;
  akcja: string;
  scrapedAt: string;
}

async function fetchScheduleHtml(): Promise<string> {
  try {
    logger.info(`Fetching schedule page: ${SCHEDULE_URL}`);
    const response = await fetch(SCHEDULE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    logger.info(`Fetched HTML, size: ${html.length} bytes`);
    return html;
  } catch (error) {
    logger.error('Error fetching schedule page', error);
    throw error;
  }
}

function cleanHtml(html: string): string {
  if (!html) return '';
  let text = String(html);
  
  text = text.replace(/<[^>]+>/g, ' ');
  
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/g, "'");
  
  text = text.replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

function parseScheduleTable(html: string): FentiksScheduleEntry[] {
  const entries: FentiksScheduleEntry[] = [];
  
  const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  
  const rows: string[] = [];
  let match;
  while ((match = tableRowRegex.exec(html)) !== null) {
    rows.push(match[1]);
  }

  logger.info(`Found ${rows.length} table rows`);

  for (const rowHtml of rows) {
    const tableCellRegex = /<td[^>]*>(.*?)<\/td>/gis;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = tableCellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }

    if (cells.length >= 3) {
      const miejsce = cleanHtml(cells[0]).trim();
      const data = cleanHtml(cells[1]).trim();
      const cena = cleanHtml(cells[2]).trim();
      const akcja = cells.length > 3 ? cleanHtml(cells[3]).trim() : '';

      if (miejsce && data && !miejsce.match(/^miejsce$/i)) {
        entries.push({
          miejsce,
          data,
          cena,
          akcja,
          scrapedAt: new Date().toISOString(),
        });
      }
    }
  }

  logger.info(`Extracted ${entries.length} schedule entries`);
  return entries;
}

export async function scrapeFentiksSchedule(): Promise<FentiksScheduleEntry[]> {
  const html = await fetchScheduleHtml();
  const entries = parseScheduleTable(html);
  return entries;
}

