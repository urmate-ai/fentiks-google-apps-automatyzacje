const ScheduleScraper = (() => {
  const logger = (typeof globalThis !== 'undefined' && globalThis.logger)
    || (typeof require !== 'undefined' ? require('./02_logger') : console);

  const Config = (typeof require !== 'undefined' ? require('./01_config') : {}) || {};

  const SCHEDULE_URL = (typeof globalThis !== 'undefined' && globalThis.SCHEDULE_URL !== undefined)
    ? globalThis.SCHEDULE_URL
    : Config.SCHEDULE_URL || 'https://fentiks.pl/terminarz-szkolen-i-egzaminow/';

  /**
   * Fetches HTML content from the schedule URL
   */
  function fetchScheduleHtml() {
    try {
      logger.info('Pobieram stronę', SCHEDULE_URL);
      const response = UrlFetchApp.fetch(SCHEDULE_URL, {
        muteHttpExceptions: true,
        followRedirects: true,
      });

      if (response.getResponseCode() !== 200) {
        throw new Error(`HTTP ${response.getResponseCode()}: ${response.getContentText().substring(0, 200)}`);
      }

      const html = response.getContentText('UTF-8');
      logger.info('Pobrano HTML', `rozmiar=${html.length} bajtów`);
      return html;
    } catch (error) {
      logger.error('Błąd podczas pobierania strony', error);
      throw error;
    }
  }

  /**
   * Parses HTML to extract schedule entries from the table
   */
  function parseScheduleTable(html) {
    const entries = [];
    
    // Find the table - look for table rows with schedule data
    // The table structure based on the image description: columns are Miejsce, Data, Cena, KUP TERAZ
    const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    
    const rows = [];
    let match;
    while ((match = tableRowRegex.exec(html)) !== null) {
      rows.push(match[1]);
    }

    logger.info('Znaleziono wierszy tabeli', rows.length);

    for (const rowHtml of rows) {
      // Create a new regex for each row to avoid state issues
      const tableCellRegex = /<td[^>]*>(.*?)<\/td>/gis;
      const cells = [];
      let cellMatch;
      while ((cellMatch = tableCellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1]);
      }

      // We expect 4 columns: Miejsce, Data, Cena, KUP TERAZ
      if (cells.length >= 3) {
        const miejsce = cleanHtml(cells[0]).trim();
        const data = cleanHtml(cells[1]).trim();
        const cena = cleanHtml(cells[2]).trim();
        const akcja = cells.length > 3 ? cleanHtml(cells[3]).trim() : '';

        // Skip header row and empty rows
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

    logger.info('Wydobyto wpisów z terminarza', entries.length);
    return entries;
  }

  /**
   * Removes HTML tags and decodes HTML entities
   */
  function cleanHtml(html) {
    if (!html) return '';
    let text = String(html);
    
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    
    // Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    
    // Decode numeric entities
    text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  /**
   * Scrapes schedule from the website and returns entries
   */
  function scrapeSchedule() {
    const html = fetchScheduleHtml();
    const entries = parseScheduleTable(html);
    return entries;
  }

  /**
   * Converts entries to JSON string
   */
  function toJson(entries) {
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Converts entries to CSV string
   */
  function toCsv(entries) {
    if (!entries || entries.length === 0) {
      return 'Miejsce,Data,Cena,Akcja,ScrapedAt\n';
    }

    const headers = ['Miejsce', 'Data', 'Cena', 'Akcja', 'ScrapedAt'];
    const rows = entries.map(entry => {
      const escapeCsv = (value) => {
        const str = String(value || '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      return [
        escapeCsv(entry.miejsce),
        escapeCsv(entry.data),
        escapeCsv(entry.cena),
        escapeCsv(entry.akcja),
        escapeCsv(entry.scrapedAt),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  return {
    fetchScheduleHtml,
    parseScheduleTable,
    cleanHtml,
    scrapeSchedule,
    toJson,
    toCsv,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.ScheduleScraper = ScheduleScraper;
}

if (typeof module !== 'undefined') {
  module.exports = ScheduleScraper;
}
