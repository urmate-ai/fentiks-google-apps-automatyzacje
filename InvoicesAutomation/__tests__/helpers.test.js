const Helpers = require('../GoogleScript/05_helpers');
const { PDFDocument } = require('../GoogleScript/03_pdf-lib');

describe('Helpers module', () => {
  let logger;

  beforeEach(() => {
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    Helpers.setLogger(logger);
  });

  test('getOrCreateSubFolder returns existing folder', () => {
    const existingFolder = { getId: () => 'id-1' };
    const iterator = {
      hasNext: jest.fn(() => true),
      next: jest.fn(() => existingFolder),
    };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(),
    };

    const result = Helpers.getOrCreateSubFolder(root, 'Existing');
    expect(result).toBe(existingFolder);
    expect(root.createFolder).not.toHaveBeenCalled();
  });

  test('getOrCreateSubFolder creates when missing', () => {
    const iterator = {
      hasNext: jest.fn(() => false),
    };
    const created = { getId: () => 'id-2' };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(() => created),
    };

    const result = Helpers.getOrCreateSubFolder(root, 'New');
    expect(result).toBe(created);
    expect(root.createFolder).toHaveBeenCalledWith('New');
  });

  test('getOrCreateSubFolder clears color for New folder when DriveAdvanced is available', () => {
    const update = jest.fn();
    global.DriveAdvanced = { Files: { update } };
    const existingFolder = {
      getId: jest.fn(() => 'id-3'),
      getName: jest.fn(() => 'New (Tutaj wgrywamy faktury)'),
    };
    const iterator = {
      hasNext: jest.fn(() => true),
      next: jest.fn(() => existingFolder),
    };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(),
    };

    Helpers.getOrCreateSubFolder(root, 'New (Tutaj wgrywamy faktury)');

    expect(update).toHaveBeenCalledWith(
      { folderColorRgb: null },
      'id-3',
      null,
      { supportsAllDrives: true },
    );

    delete global.DriveAdvanced;
  });

  test('getOrCreateSubFolder uses Drive symbol when DriveAdvanced is missing', () => {
    const update = jest.fn();
    global.Drive = { Files: { update } };
    const existingFolder = {
      getId: jest.fn(() => 'id-4'),
      getName: jest.fn(() => 'Failed'),
    };
    const iterator = {
      hasNext: jest.fn(() => true),
      next: jest.fn(() => existingFolder),
    };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(),
    };

    Helpers.getOrCreateSubFolder(root, 'Failed');

    expect(update).toHaveBeenCalledWith(
      { folderColorRgb: '#ED6E35' },
      'id-4',
      null,
      { supportsAllDrives: true },
    );

    delete global.Drive;
  });

  test('getOrCreateSubFolder applies configured colors for processed hierarchy', () => {
    const update = jest.fn();
    global.DriveAdvanced = { Files: { update } };
    const processed = {
      getId: jest.fn(() => 'processed-id'),
      getName: jest.fn(() => 'Processed (Tutaj zostaną przeniesione)'),
    };
    const iterator = {
      hasNext: jest.fn(() => true),
      next: jest.fn(() => processed),
    };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(),
    };

    Helpers.getOrCreateSubFolder(root, 'Processed (Tutaj zostaną przeniesione)');

    expect(update).toHaveBeenCalledWith(
      { folderColorRgb: '#CABDBF' },
      'processed-id',
      null,
      { supportsAllDrives: true },
    );

    delete global.DriveAdvanced;
  });

  test('getOrCreateSubFolder warns once when no Drive service is available', () => {
    const existingFolder = {
      getId: jest.fn(() => 'id-5'),
      getName: jest.fn(() => 'Successful (Gotowe)'),
    };
    const iterator = {
      hasNext: jest.fn(() => true),
      next: jest.fn(() => existingFolder),
    };
    const root = {
      getFoldersByName: jest.fn(() => iterator),
      createFolder: jest.fn(),
    };

    Helpers.getOrCreateSubFolder(root, 'Successful (Gotowe)');
    Helpers.getOrCreateSubFolder(root, 'Successful (Gotowe)');

    expect(logger.warn).toHaveBeenCalledWith('Drive Advanced service unavailable; unable to set folder colors');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('splitPdfIntoPageBlobs falls back to original blob', async () => {
    const pdfBlob = {
      setName: jest.fn(),
      getAs: jest.fn(() => pdfBlob),
      getBytes: jest.fn(() => new Uint8Array([1, 2, 3])),
    };
    const sourceBlob = { getAs: jest.fn(() => pdfBlob) };
    const file = {
      getName: jest.fn(() => 'invoice.pdf'),
      getBlob: jest.fn(() => sourceBlob),
    };

    const blobs = await Helpers.splitPdfIntoPageBlobs(file);
    expect(Array.isArray(blobs)).toBe(true);
    expect(blobs).toHaveLength(1);
    expect(pdfBlob.setName).toHaveBeenCalledWith('invoice.pdf');
  });

  test('splitPdfIntoPageBlobs returns single-page blobs for multi-page PDF', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage();
    pdfDoc.addPage();
    pdfDoc.addPage();
    const pdfBytes = await pdfDoc.save();

    const sourceBlob = { getBytes: jest.fn(() => pdfBytes) };
    const file = {
      getName: jest.fn(() => 'invoice.pdf'),
      getBlob: jest.fn(() => sourceBlob),
    };

    const blobs = await Helpers.splitPdfIntoPageBlobs(file);
    expect(blobs).toHaveLength(3);
    const names = blobs.map((blob, index) => {
      const name = blob.getName ? blob.getName() : undefined;
      return name || ('invoice_page_' + (index + 1) + '.pdf');
    });
    expect(names).toEqual(['invoice_page_1.pdf', 'invoice_page_2.pdf', 'invoice_page_3.pdf']);

    for (let i = 0; i < blobs.length; i += 1) {
      const blob = blobs[i];
      const bytes = blob.getBytes ? blob.getBytes() : null;
      expect(bytes).toBeInstanceOf(Uint8Array);
      const pageDoc = await PDFDocument.load(bytes);
      expect(pageDoc.getPageCount()).toBe(1);
    }
  });

  test('duplicatePdfBlob uses copyBlob when available', async () => {
    const copy = {
      setName: jest.fn(),
      getContentType: jest.fn(() => 'application/pdf'),
    };
    const source = {
      copyBlob: jest.fn(() => copy),
    };

    const result = await Helpers.duplicatePdfBlob(source, 'output.pdf');
    expect(source.copyBlob).toHaveBeenCalled();
    expect(copy.setName).toHaveBeenCalledWith('output.pdf');
    expect(result).toBe(copy);
  });

  test('duplicatePdfBlob recreates blob from bytes when copy unavailable', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const source = {
      getBytes: jest.fn(() => bytes),
      getContentType: jest.fn(() => 'application/pdf'),
      setName: jest.fn(),
    };

    const duplicate = await Helpers.duplicatePdfBlob(source, 'copy.pdf');
    expect(source.getBytes).toHaveBeenCalled();
    expect(duplicate.getContentType()).toBe('application/pdf');
    expect(duplicate.getName()).toBe('copy.pdf');
  });

  test('classifyInvoice handles success, partial and failure', () => {
    const base = {
      invoiceNumber: 'INV-1',
      issueDate: '2024-01-01',
      currency: 'PLN',
      seller: {
        name: 'Seller',
        taxId: '123',
        address: { street: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
      },
      grossAmount: 123,
      buyer: {
        name: 'Buyer',
        taxId: '456',
        address: { street: 'Buyer 2', postalCode: '00-002', city: 'Kraków', country: 'PL' },
      },
      netAmount: 100,
      vatAmount: 23,
      vatRatePercent: 23,
      salesType: 'goods',
      vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      ifirmaMissingFields: [],
    };

    const perfectInvoice = JSON.parse(JSON.stringify(base));
    expect(Helpers.classifyInvoice(perfectInvoice)).toBe('success');
    expect(perfectInvoice.validationFlags).toBeUndefined();

    const missingRequired = JSON.parse(JSON.stringify(base));
    missingRequired.ifirmaMissingFields = ['NumerFaktury', 'Kontrahent.Nazwa'];
    expect(Helpers.classifyInvoice(missingRequired)).toBe('failed');
    expect(missingRequired.validationFlags).toEqual({
      missingIfirmaFields: ['NumerFaktury', 'Kontrahent.Nazwa'],
    });

    const multiCurrency = JSON.parse(JSON.stringify(base));
    multiCurrency.detectedCurrencies = ['PLN', 'USD'];
    expect(Helpers.classifyInvoice(multiCurrency)).toBe('partial');
    expect(multiCurrency.validationFlags).toEqual({ multiCurrency: true });

    const manualReview = JSON.parse(JSON.stringify(base));
    manualReview.requiresManualReview = true;
    expect(Helpers.classifyInvoice(manualReview)).toBe('partial');
    expect(manualReview.validationFlags).toEqual({ requiresManualReview: true });

    const contextOverride = JSON.parse(JSON.stringify(base));
    delete contextOverride.ifirmaMissingFields;
    expect(Helpers.classifyInvoice(contextOverride, { missingIfirmaFields: ['DataWystawienia'] }))
      .toBe('failed');
    expect(contextOverride.validationFlags).toEqual({ missingIfirmaFields: ['DataWystawienia'] });
  });

  test('buildOutputFilename creates RRMMDD_NIP_NUMBER format', () => {
    const filename = Helpers.buildOutputFilename({
      seller: { taxId: '123-45-67-890' },
      buyer: { taxId: 'PL 9876543210' },
      issueDate: '2024-02-15',
      invoiceNumber: 'FV 123/456',
    }, 0);
    expect(filename).toBe('240215_1234567890_FV-123-456.pdf');
  });

  test('buildOutputFilename falls back gracefully when data missing', () => {
    const filename = Helpers.buildOutputFilename({}, 0);
    expect(filename).toMatch(/^\d{6}_UNKNOWN_UNKNOWN\.pdf$/);
  });
});
