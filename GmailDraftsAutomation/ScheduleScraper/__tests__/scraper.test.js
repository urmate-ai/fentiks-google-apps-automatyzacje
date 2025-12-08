const scraperPath = require.resolve('../GoogleScript/04_scraper.js');
const configPath = require.resolve('../GoogleScript/01_config.js');
const loggerPath = require.resolve('../GoogleScript/02_logger.js');

describe('ScheduleScraper', () => {
  let fetchMock;
  let urlFetchResponse;

  beforeEach(() => {
    jest.resetModules();
    
    urlFetchResponse = {
      getResponseCode: jest.fn(() => 200),
      getContentText: jest.fn(() => ''),
    };

    fetchMock = jest.fn(() => urlFetchResponse);
    global.UrlFetchApp = {
      fetch: fetchMock,
    };

    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: () => null,
      }),
    };

    delete require.cache[configPath];
    delete require.cache[loggerPath];
    delete require.cache[scraperPath];
    require(configPath);
    require(loggerPath);
  });

  afterEach(() => {
    delete global.UrlFetchApp;
    delete global.PropertiesService;
    delete global.SCHEDULE_URL;
    delete global.logger;
  });

  it('fetches HTML from the schedule URL', () => {
    const html = '<html><body><table><tr><td>Test</td></tr></table></body></html>';
    urlFetchResponse.getContentText.mockReturnValue(html);

    const Scraper = require(scraperPath);
    const result = Scraper.fetchScheduleHtml();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fentiks.pl/terminarz-szkolen-i-egzaminow/',
      { muteHttpExceptions: true, followRedirects: true }
    );
    expect(result).toBe(html);
  });

  it('throws error on HTTP error', () => {
    urlFetchResponse.getResponseCode.mockReturnValue(404);
    urlFetchResponse.getContentText.mockReturnValue('Not Found');

    const Scraper = require(scraperPath);
    expect(() => Scraper.fetchScheduleHtml()).toThrow('HTTP 404');
  });

  it('parses schedule table correctly', () => {
    const html = `
      <table>
        <tr>
          <td>POZNAŃ G1/2/3 + EGZAMIN 16:00-19:00</td>
          <td>2025-12-01.</td>
          <td>466,6zł</td>
          <td>Kup teraz</td>
        </tr>
        <tr>
          <td>WARSZAWA G1/2/3 + EGZAMIN 16:00-19:00</td>
          <td>2025-12-03.</td>
          <td>466,6zł</td>
          <td>Kup teraz</td>
        </tr>
      </table>
    `;

    const Scraper = require(scraperPath);
    const entries = Scraper.parseScheduleTable(html);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      miejsce: 'POZNAŃ G1/2/3 + EGZAMIN 16:00-19:00',
      data: '2025-12-01.',
      cena: '466,6zł',
      akcja: 'Kup teraz',
    });
    expect(entries[0].scrapedAt).toBeDefined();
  });

  it('cleans HTML tags and entities', () => {
    const Scraper = require(scraperPath);
    expect(Scraper.cleanHtml('<p>Test &amp; More</p>')).toBe('Test & More');
    expect(Scraper.cleanHtml('&nbsp;&quot;Hello&quot;')).toBe('"Hello"');
    expect(Scraper.cleanHtml('<a href="#">Link</a>')).toBe('Link');
  });

  it('converts entries to JSON', () => {
    const entries = [
      { miejsce: 'Test', data: '2025-12-01', cena: '100zł', akcja: 'Kup', scrapedAt: '2025-01-01T00:00:00Z' },
    ];

    const Scraper = require(scraperPath);
    const json = Scraper.toJson(entries);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual(entries);
  });

  it('converts entries to CSV', () => {
    const entries = [
      { miejsce: 'Test Location', data: '2025-12-01', cena: '100zł', akcja: 'Kup', scrapedAt: '2025-01-01T00:00:00Z' },
      { miejsce: 'Another, "Place"', data: '2025-12-02', cena: '200zł', akcja: 'Zapisz się', scrapedAt: '2025-01-01T00:00:00Z' },
    ];

    const Scraper = require(scraperPath);
    const csv = Scraper.toCsv(entries);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('Miejsce,Data,Cena,Akcja,ScrapedAt');
    expect(lines[1]).toContain('Test Location');
    expect(lines[2]).toContain('"Another, ""Place"""');
  });

  it('handles empty entries', () => {
    const Scraper = require(scraperPath);
    const csv = Scraper.toCsv([]);
    expect(csv).toBe('Miejsce,Data,Cena,Akcja,ScrapedAt\n');
  });
});
