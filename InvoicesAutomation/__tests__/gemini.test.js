describe('Gemini integration helpers', () => {
  let Gemini;
  let mockLogger;
  let mockResponse;
  let blob;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    mockResponse = { getContentText: jest.fn() };
    blob = {
      getBytes: jest.fn(() => new Uint8Array([1, 2, 3])),
      getContentType: jest.fn(() => 'application/pdf'),
      getName: jest.fn(() => 'invoice.pdf'),
    };

    global.PropertiesService = {
      getScriptProperties: jest.fn(() => ({ getProperty: jest.fn(() => 'api-key') })),
    };
    global.Utilities = {
      base64Encode: jest.fn(() => 'BASE64DATA'),
    };
    global.UrlFetchApp = {
      fetch: jest.fn(() => mockResponse),
    };

    mockResponse.getContentText.mockReturnValue(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  invoices: [
                    {
                      invoiceNumber: 'INV-1',
                      issueDate: '2024-01-01',
                      currency: 'PLN',
                      seller: {
                        name: 'Seller',
                        taxId: '123',
                        address: {
                          street: 'Main 1',
                          postalCode: '00-001',
                          city: 'Warszawa',
                          country: 'PL',
                        },
                      },
                      buyer: {
                        name: 'Buyer',
                        taxId: '456',
                        address: {
                          street: 'Second 2',
                          postalCode: '22-222',
                          city: 'Kraków',
                          country: 'PL',
                        },
                      },
                      netAmount: '100,50',
                      vatAmount: '',
                      vatRatePercent: '23',
                      grossAmount: '123,15',
                      vatExemptionReason: '',
                      detectedCurrencies: 'PLN, EUR',
                      salesType: 'goods',
                      paymentDueDate: '2024-01-15',
                      deliveryDate: '2023-12-31',
                      vatLines: [
                        { ratePercent: '23', netAmount: '100,50', vatAmount: '23,12' },
                        { ratePercent: '8', netAmount: '10', vatAmount: '0,80' },
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }));

    Gemini = require('../GoogleScript/04_gemini');
    Gemini.setLogger(mockLogger);
  });

  test('extractInvoicesFromBlob parses and normalises Gemini response', () => {
    const invoices = Gemini.extractInvoicesFromBlob(blob);
    expect(global.UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    expect(global.Utilities.base64Encode).toHaveBeenCalledWith(blob.getBytes());
    expect(invoices).toHaveLength(1);
    expect(invoices[0].netAmount).toBeCloseTo(100.5);
    expect(invoices[0].grossAmount).toBeCloseTo(123.15);
    expect(invoices[0].vatAmount).toBeUndefined();
    expect(invoices[0].detectedCurrencies).toEqual(['PLN', 'EUR']);
    expect(invoices[0].requiresManualReview).toBe(true);
    expect(invoices[0].salesType).toBe('goods');
    expect(invoices[0].paymentDueDate).toBe('2024-01-15');
    expect(invoices[0].deliveryDate).toBe('2023-12-31');
    expect(invoices[0].seller.address).toEqual({
      street: 'Main 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    });
    expect(invoices[0].buyer.address).toEqual({
      street: 'Second 2',
      postalCode: '22-222',
      city: 'Kraków',
      country: 'PL',
    });
    expect(invoices[0].vatLines).toEqual([
      { ratePercent: 23, vatRatePercent: 23, netAmount: 100.5, vatAmount: 23.12 },
      { ratePercent: 8, vatRatePercent: 8, netAmount: 10, vatAmount: 0.8 },
    ]);
  });

  test('normalises optional fields with safe defaults', () => {
    mockResponse.getContentText.mockReturnValueOnce(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  invoices: [
                    {
                      invoiceNumber: 'INV-2',
                      issueDate: '2024-02-01',
                      currency: 'PLN',
                      seller: {},
                      buyer: {},
                      netAmount: '0',
                      vatAmount: '0',
                      grossAmount: '0',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }));

    const [invoice] = Gemini.extractInvoicesFromBlob(blob);
    expect(invoice.seller.address).toEqual({ street: '', postalCode: '', city: '', country: '' });
    expect(invoice.buyer.address).toEqual({ street: '', postalCode: '', city: '', country: '' });
    expect(invoice.vatLines).toEqual([]);
    expect(invoice.salesType).toBe('');
    expect(invoice.paymentDueDate).toBe('');
    expect(invoice.deliveryDate).toBe('');
    expect(invoice.detectedCurrencies).toEqual([]);
  });

  test('supports override API key', () => {
    Gemini.setApiKeyOverride('override');
    Gemini.extractInvoicesFromBlob(blob);
    expect(global.UrlFetchApp.fetch.mock.calls[0][0]).toContain('override');
  });

  test('throws on invalid HTTP JSON', () => {
    mockResponse.getContentText.mockReturnValue('not-json');
    expect(() => Gemini.extractInvoicesFromBlob(blob)).toThrow('Gemini responded with invalid JSON payload.');
  });

  test('throws when candidate text not JSON', () => {
    mockResponse.getContentText.mockReturnValue(JSON.stringify({
      candidates: [
        { content: { parts: [{ text: 'invalid-json' }] } },
      ],
    }));
    expect(() => Gemini.extractInvoicesFromBlob(blob)).toThrow('Gemini produced invalid JSON in candidate text.');
  });
});
