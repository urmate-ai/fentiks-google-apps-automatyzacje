jest.mock('../GoogleScript/04_gemini', () => ({
  extractInvoicesFromBlob: jest.fn(),
  setLogger: jest.fn(),
  setApiKeyOverride: jest.fn(),
}));

jest.mock('../GoogleScript/07_ifirma', () => ({
  postExpense: jest.fn(),
  postSalesInvoice: jest.fn(),
  listSalesInvoices: jest.fn(() => Promise.resolve({ ok: true, json: [] })),
  setLogger: jest.fn(),
}));

jest.mock('../GoogleScript/06_hubspot', () => ({
  syncSaleInvoice: jest.fn(() => Promise.resolve({ success: true, classification: 'success' })),
  setLogger: jest.fn(),
}));

jest.mock('../GoogleScript/02_slack', () => ({
  notifyIfirmaError: jest.fn(() => Promise.resolve(true)),
  notifyInvoiceFailure: jest.fn(() => Promise.resolve(true)),
  setLogger: jest.fn(),
}));

describe('processInvoices automation', () => {
  const ROOT_FOLDER_NAME = '💡 Invoices automation (Faktury)';
  const FAILED_SUCCESS_EXPENSES_NAME = 'Done (Stąd trafią do "Successful [Wydatki]")';
  const FAILED_SUCCESS_SALES_NAME = 'Done (Stąd trafią do "Successful [Sprzedaż]")';
  const ROOT_FOLDER_ID = ROOT_FOLDER_NAME + '-id';
  let Main;
  let Helpers;
  let Gemini;
  let IFirma;
  let Hubspot;
  let Slack;
  let logger;
  let lock;
  let newFolder;
  let processedExpensesFolder;
  let processedSalesFolder;
  let expenseSuccessFolder;
  let expenseFailedFolder;
  let expenseOriginalsFolder;
  let expenseFailedRetryFolder;
  let expenseFailedSuccessFolder;
  let salesSuccessFolder;
  let salesFailedFolder;
  let salesOriginalsFolder;
  let salesFailedRetryFolder;
  let salesFailedSuccessFolder;
  let successFolder;
  let failedFolder;
  let originalsFolder;
  let scriptProperties;
  let storedRootFolderId;
  let driveFilesUpdate;
  let spreadsheetStore;
  let driveFilesById;

  const makeIterator = (items) => {
    const snapshot = items.slice();
    let index = 0;
    return {
      hasNext: () => index < snapshot.length,
      next: () => snapshot[index++],
    };
  };

  const createFolder = (name) => {
    const folder = {
      name,
      files: [],
      getName: () => name,
      getId: () => name + '-id',
      addFile: jest.fn((file) => {
        if (!folder.files.includes(file)) {
          folder.files.push(file);
        }
      }),
      removeFile: jest.fn((file) => {
        const index = folder.files.indexOf(file);
        if (index !== -1) {
          folder.files.splice(index, 1);
        }
      }),
      createFile: jest.fn((blob) => {
        const determineName = () => {
          if (blob && blob.setName && blob.setName.mock && blob.setName.mock.calls.length) {
            const lastCall = blob.setName.mock.calls[blob.setName.mock.calls.length - 1];
            if (lastCall && lastCall.length) {
              return lastCall[0];
            }
          }
          if (blob && typeof blob.getName === 'function') {
            return blob.getName();
          }
          return name + '-created.pdf';
        };
        const entry = {
          name: determineName(),
        };
        entry.getName = jest.fn(() => entry.name);
        entry.getId = jest.fn(() => name + '-created');
        folder.files.push(entry);
        return entry;
      }),
      getFiles: jest.fn(() => makeIterator(folder.files)),
      getFilesByName: jest.fn((searchName) => {
        const matches = folder.files.filter((file) => {
          const fileName = file && typeof file.getName === 'function' ? file.getName() : file && file.name;
          return fileName === searchName;
        });
        return makeIterator(matches);
      }),
      getFoldersByName: jest.fn(() => makeIterator([])),
      createFolder: jest.fn((subName) => createFolder(subName)),
    };
    return folder;
  };

  const createPdfBlob = (label) => {
    const clones = [];
    const makeClone = () => {
      const clone = {
        setName: jest.fn(),
        copyBlob: jest.fn(() => makeClone()),
        getBytes: jest.fn(() => new Uint8Array()),
        getContentType: jest.fn(() => 'application/pdf'),
        getName: jest.fn(() => label),
      };
      clones.push(clone);
      return clone;
    };

    const pageBlob = {
      getAs: jest.fn(() => makeClone()),
      copyBlob: jest.fn(() => makeClone()),
      getBytes: jest.fn(() => new Uint8Array()),
      getContentType: jest.fn(() => 'application/pdf'),
      setName: jest.fn(),
      getName: jest.fn(() => label),
    };

    return { pageBlob, clones };
  };

  const createFile = (name, mimeType, options = {}) => {
    const file = {
      name,
      getName: () => file.name,
      getMimeType: () => mimeType,
      isTrashed: () => false,
      getId: () => name + '-id',
    };

    const defaultBlobFactory = () => ({
      getAs: jest.fn(() => ({
        copyBlob: jest.fn(() => ({ setName: jest.fn(), getBytes: jest.fn(() => new Uint8Array()) })),
        setName: jest.fn(),
      })),
      getBytes: jest.fn(() => new Uint8Array()),
      getContentType: jest.fn(() => mimeType),
    });

    const blobFactory = typeof options.getBlob === 'function' ? options.getBlob : defaultBlobFactory;

    file.getBlob = jest.fn(() => blobFactory());

    file.setName = jest.fn((newName) => {
      file.name = newName;
    });

    file.setTrashed = jest.fn();

    file.makeCopy = jest.fn((copyName, destination) => {
      const copy = createFile(copyName || file.name, mimeType);
      copy.isCopy = true;
      copy.original = file;
      if (destination) {
        destination.files.push(copy);
      }
      if (options.onCopy) {
        options.onCopy(copy);
      }
      return copy;
    });

    return file;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    console.log = jest.fn();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-02-03T10:00:00Z'));

    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    global.Utilities = {
      sleep: jest.fn(),
      base64Encode: jest.fn(() => ''),
    };

    lock = { tryLock: jest.fn(() => true), releaseLock: jest.fn() };
    global.LockService = { getScriptLock: jest.fn(() => lock) };

    storedRootFolderId = 'root-folder';
    const propertiesStore = {
      GEMINI_API_KEY: 'test-key',
      INVOICES_ROOT_FOLDER_ID: storedRootFolderId,
    };
    scriptProperties = {
      getProperty: jest.fn((key) => {
        if (key === 'INVOICES_ROOT_FOLDER_ID') {
          return storedRootFolderId;
        }
        return Object.prototype.hasOwnProperty.call(propertiesStore, key)
          ? propertiesStore[key]
          : null;
      }),
      setProperty: jest.fn((key, value) => {
        if (key === 'INVOICES_ROOT_FOLDER_ID') {
          storedRootFolderId = value;
        }
        propertiesStore[key] = value;
      }),
    };
    global.PropertiesService = { getScriptProperties: jest.fn(() => scriptProperties) };

    driveFilesUpdate = jest.fn();
    global.Drive = { Files: { update: driveFilesUpdate } };

    driveFilesById = new Map();

    const makeSheet = () => {
      const sheet = {
        data: [],
        getLastRow: jest.fn(() => sheet.data.length),
        getLastColumn: jest.fn(() => sheet.data.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)),
        getRange: jest.fn((row, column, numRows, numColumns) => ({
          getValues: jest.fn(() => {
            const values = [];
            for (let r = 0; r < numRows; r += 1) {
              const sourceRow = sheet.data[row + r - 1] || [];
              const mapped = [];
              for (let c = 0; c < numColumns; c += 1) {
                mapped.push(sourceRow[column + c - 1] ?? '');
              }
              values.push(mapped);
            }
            return values;
          }),
          setValues: jest.fn((values) => {
            for (let r = 0; r < numRows; r += 1) {
              const targetIndex = row + r - 1;
              if (!sheet.data[targetIndex]) {
                sheet.data[targetIndex] = [];
              }
              for (let c = 0; c < numColumns; c += 1) {
                sheet.data[targetIndex][column + c - 1] = values[r][c];
              }
            }
          }),
        })),
        appendRow: jest.fn((values) => {
          sheet.data.push(values);
        }),
      };
      return sheet;
    };

    spreadsheetStore = new Map();
    let sheetCounter = 0;

    global.SpreadsheetApp = {
      create: jest.fn((title) => {
        sheetCounter += 1;
        const id = 'sheet-' + sheetCounter;
        const sheet = makeSheet();
        spreadsheetStore.set(id, { title, sheet });
        const driveFile = {
          getId: () => id,
          getName: () => title,
          getMimeType: () => 'application/vnd.google-apps.spreadsheet',
          isTrashed: () => false,
        };
        driveFile.getParents = jest.fn(() => makeIterator([]));
        driveFilesById.set(id, driveFile);
        return {
          getId: () => id,
          getActiveSheet: () => sheet,
          getSheets: () => [sheet],
        };
      }),
      openById: jest.fn((id) => {
        const entry = spreadsheetStore.get(id);
        if (!entry) {
          throw new Error('Unknown spreadsheet ' + id);
        }
        return {
          getActiveSheet: () => entry.sheet,
          getSheets: () => [entry.sheet],
        };
      }),
    };

    newFolder = createFolder('New (Tutaj wgrywamy faktury)');
    processedExpensesFolder = createFolder('Processed (Wydatki)');
    processedSalesFolder = createFolder('Processed (Sprzedaż)');
    expenseSuccessFolder = createFolder('Successful (Gotowe)');
    expenseFailedFolder = createFolder('Failed');
    expenseOriginalsFolder = createFolder('Originals (Oryginały z folderu "New")');
    expenseFailedRetryFolder = createFolder('New (Wrzuć tutaj faktury do ponownego przetworzenia)');
    expenseFailedSuccessFolder = createFolder(FAILED_SUCCESS_EXPENSES_NAME);
    salesSuccessFolder = createFolder('Successful (Gotowe)');
    salesFailedFolder = createFolder('Failed');
    salesOriginalsFolder = createFolder('Originals (Oryginały z folderu "New")');
    salesFailedRetryFolder = createFolder('New (Wrzuć tutaj faktury do ponownego przetworzenia)');
    salesFailedSuccessFolder = createFolder(FAILED_SUCCESS_SALES_NAME);

    newFolder.getFoldersByName.mockImplementation(() => makeIterator([]));
    expenseOriginalsFolder.getFoldersByName.mockImplementation(() => makeIterator([]));
    salesOriginalsFolder.getFoldersByName.mockImplementation(() => makeIterator([]));

    processedExpensesFolder.getFoldersByName.mockImplementation((name) => {
      if (name === 'Failed') return makeIterator([expenseFailedFolder]);
      if (name === 'Successful (Gotowe)') return makeIterator([expenseSuccessFolder]);
      if (name === 'Originals (Oryginały z folderu "New")') return makeIterator([expenseOriginalsFolder]);
      return makeIterator([]);
    });
    processedExpensesFolder.createFolder.mockImplementation((name) => {
      if (name === 'Failed') return expenseFailedFolder;
      if (name === 'Successful (Gotowe)') return expenseSuccessFolder;
      if (name === 'Originals (Oryginały z folderu "New")') return expenseOriginalsFolder;
      return createFolder(name);
    });

    processedSalesFolder.getFoldersByName.mockImplementation((name) => {
      if (name === 'Failed') return makeIterator([salesFailedFolder]);
      if (name === 'Successful (Gotowe)') return makeIterator([salesSuccessFolder]);
      if (name === 'Originals (Oryginały z folderu "New")') return makeIterator([salesOriginalsFolder]);
      return makeIterator([]);
    });
    processedSalesFolder.createFolder.mockImplementation((name) => {
      if (name === 'Failed') return salesFailedFolder;
      if (name === 'Successful (Gotowe)') return salesSuccessFolder;
      if (name === 'Originals (Oryginały z folderu "New")') return salesOriginalsFolder;
      return createFolder(name);
    });

    expenseFailedFolder.getFoldersByName = jest.fn((name) => {
      if (name === 'New (Wrzuć tutaj faktury do ponownego przetworzenia)') {
        return makeIterator([expenseFailedRetryFolder]);
      }
      if (name === FAILED_SUCCESS_EXPENSES_NAME) {
        return makeIterator([expenseFailedSuccessFolder]);
      }
      return makeIterator([]);
    });
    expenseFailedFolder.createFolder = jest.fn((name) => {
      if (name === 'New (Wrzuć tutaj faktury do ponownego przetworzenia)') {
        return expenseFailedRetryFolder;
      }
      if (name === FAILED_SUCCESS_EXPENSES_NAME) {
        return expenseFailedSuccessFolder;
      }
      return createFolder(name);
    });

    salesFailedFolder.getFoldersByName = jest.fn((name) => {
      if (name === 'New (Wrzuć tutaj faktury do ponownego przetworzenia)') {
        return makeIterator([salesFailedRetryFolder]);
      }
      if (name === FAILED_SUCCESS_SALES_NAME) {
        return makeIterator([salesFailedSuccessFolder]);
      }
      return makeIterator([]);
    });
    salesFailedFolder.createFolder = jest.fn((name) => {
      if (name === 'New (Wrzuć tutaj faktury do ponownego przetworzenia)') {
        return salesFailedRetryFolder;
      }
      if (name === FAILED_SUCCESS_SALES_NAME) {
        return salesFailedSuccessFolder;
      }
      return createFolder(name);
    });

    successFolder = expenseSuccessFolder;
    failedFolder = expenseFailedFolder;
    originalsFolder = expenseOriginalsFolder;

    const rootFolder = {
      getName: () => 'Root',
      getId: () => 'root-folder',
      getFoldersByName: jest.fn((name) => {
        if (name === 'New (Tutaj wgrywamy faktury)') return makeIterator([newFolder]);
        if (name === 'Processed (Wydatki)') return makeIterator([processedExpensesFolder]);
        if (name === 'Processed (Sprzedaż)') return makeIterator([processedSalesFolder]);
        return makeIterator([]);
      }),
      createFolder: jest.fn((folderName) => {
        if (folderName === 'Processed (Wydatki)') return processedExpensesFolder;
        if (folderName === 'Processed (Sprzedaż)') return processedSalesFolder;
        if (folderName === 'New (Tutaj wgrywamy faktury)') return newFolder;
        return createFolder(folderName);
      }),
    };
    global.DriveApp = {
      getFolderById: jest.fn(() => rootFolder),
      createFolder: jest.fn((name) => createFolder(name)),
      getFoldersByName: jest.fn(() => makeIterator([])),
      getFileById: jest.fn((id) => driveFilesById.get(id)),
    };

    jest.isolateModules(() => {
      Helpers = require('../GoogleScript/05_helpers');
      Gemini = require('../GoogleScript/04_gemini');
      Main = require('../GoogleScript/09_main');
      IFirma = require('../GoogleScript/07_ifirma');
      Hubspot = require('../GoogleScript/06_hubspot');
      Slack = require('../GoogleScript/02_slack');
    });

    Helpers.setLogger(logger);
    Main.setLogger(logger);
    Gemini.setLogger?.(logger);
    IFirma.setLogger?.(logger);
    Hubspot.setLogger?.(logger);
    Slack.notifyIfirmaError.mockClear();
    Slack.notifyIfirmaError.mockResolvedValue(true);
    Slack.notifyInvoiceFailure.mockClear();
    Slack.notifyInvoiceFailure.mockResolvedValue(true);
    jest.spyOn(Helpers, 'splitPdfIntoPageBlobs');
    IFirma.postExpense.mockResolvedValue({
      ok: true,
      status: 201,
      body: '{"response":{"Kod":0}}',
      json: { response: { Kod: 0 } },
    });
    IFirma.postSalesInvoice.mockResolvedValue({
      ok: true,
      status: 201,
      body: '{"response":{"Kod":0}}',
      json: { response: { Kod: 0 } },
    });
    Hubspot.syncSaleInvoice.mockClear();
    Hubspot.syncSaleInvoice.mockResolvedValue({ success: true, classification: 'success' });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.Drive;
    delete global.Utilities;
    delete global.SpreadsheetApp;
  });

  test('moves manual invoices from helper folders into primary destinations', async () => {
    const manualExpense = createFile('manual-expense.pdf', 'application/pdf');
    const manualSale = createFile('manual-sale.pdf', 'application/pdf');
    expenseFailedSuccessFolder.files = [manualExpense];
    salesFailedSuccessFolder.files = [manualSale];

    await Main.processInvoices();

    expect(expenseFailedSuccessFolder.files).not.toContain(manualExpense);
    expect(expenseSuccessFolder.files).toContain(manualExpense);
    expect(salesFailedSuccessFolder.files).not.toContain(manualSale);
    expect(salesSuccessFolder.files).toContain(manualSale);
  });

  test('single PDF page success flow', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: undefined,
        vatRatePercent: 23,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    expect(Slack.notifyIfirmaError).not.toHaveBeenCalled();
    const [endpoint, payload] = IFirma.postExpense.mock.calls[0];
    expect(endpoint).toBe('kosztdzialalnoscivat');
    expect(payload).toMatchObject({
      NumerFaktury: 'INV-1',
      RodzajSprzedazy: 'OP',
      Kontrahent: expect.objectContaining({
        NIP: '1234567890',
        KodPocztowy: '00-001',
        Miejscowosc: 'Warszawa',
      }),
    });
    expect(payload.KwotaNetto23).toBeCloseTo(100);
    expect(payload.KwotaVat23).toBeCloseTo(23);

    expect(Hubspot.syncSaleInvoice).not.toHaveBeenCalled();

    expect(Helpers.splitPdfIntoPageBlobs).toHaveBeenCalledWith(file);
    expect(Gemini.extractInvoicesFromBlob).toHaveBeenCalledWith(pageBlob);
    expect(lock.tryLock).toHaveBeenCalledWith(0);
    expect(lock.releaseLock).toHaveBeenCalled();
    expect(Gemini.setApiKeyOverride).toHaveBeenCalledWith('test-key');
    expect(successFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(1);
    const createdBlob = successFolder.createFile.mock.calls[0][0];
    expect(clones).toContain(createdBlob);
    expect(createdBlob.setName).toHaveBeenCalledWith('240101_1234567890_INV-1.pdf');
    expect(file.makeCopy).not.toHaveBeenCalled();
    expect(successFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Skipping aggregated file move after exporting per-invoice PDFs', 'invoice.pdf', 'status', 'success', 'exportedInvoices', 1);
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(newFolder.removeFile).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).not.toHaveBeenCalled();

    const spreadsheetFile = processedExpensesFolder.files.find((entry) => entry.getMimeType
      && entry.getMimeType() === 'application/vnd.google-apps.spreadsheet');
    expect(spreadsheetFile).toBeDefined();
    const sheetState = spreadsheetStore.get(spreadsheetFile.getId());
    expect(sheetState).toBeDefined();
    const sheetRows = sheetState.sheet.data;
    expect(Array.isArray(sheetRows)).toBe(true);
    const headers = sheetRows[0];
    expect(headers).toContain('Numer faktury');
    const row = sheetRows.find((values, index) => index > 0 && values[0] === 'INV-1');
    expect(row).toBeDefined();
    const sellerIndex = headers.indexOf('NIP sprzedawcy');
    const buyerIndex = headers.indexOf('NIP nabywcy');
    expect(row[sellerIndex]).toBe('1234567890');
    expect(row[buyerIndex]).toBe('0987654321');
  });

  test('lists unpaid and partially paid invoices from iFirma', async () => {
    const statuses = [];
    IFirma.listSalesInvoices.mockImplementation(async (params) => {
      statuses.push(params.status);
      return { ok: true, json: [] };
    });

    const xmlBlob = {
      getDataAsString: jest.fn(() => '<xml></xml>'),
      getBytes: jest.fn(() => []),
      getContentType: jest.fn(() => 'application/xml'),
    };
    const xmlFile = createFile('statement.xml', 'application/xml', { getBlob: () => xmlBlob });
    newFolder.files = [xmlFile];

    await Main.processInvoices();

    expect(IFirma.listSalesInvoices).toHaveBeenCalledTimes(6);
    expect(IFirma.listSalesInvoices).toHaveBeenCalledWith(expect.objectContaining({
      status: 'nieoplacone',
      strona: 1,
      iloscNaStronie: 50,
    }));
    expect(IFirma.listSalesInvoices).toHaveBeenCalledWith(expect.objectContaining({
      status: 'oplaconeCzesciowo',
      strona: 1,
      iloscNaStronie: 50,
    }));
    expect(IFirma.listSalesInvoices).toHaveBeenCalledWith(expect.objectContaining({
      status: 'przeterminowane',
      strona: 1,
      iloscNaStronie: 50,
    }));
    expect(statuses).toEqual([
      'nieoplacone',
      'oplaconeCzesciowo',
      'przeterminowane',
      'nieoplacone',
      'oplaconeCzesciowo',
      'przeterminowane',
    ]);
  });

  test('matches bank statement inflows with outstanding invoices', async () => {
    const xmlContent = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Document>',
      '  <BkToCstmrStmt>',
      '    <Stmt>',
      '      <Ntry>',
      '        <Amt Ccy="PLN">123.45</Amt>',
      '        <CdtDbtInd>CRDT</CdtDbtInd>',
      '        <BookgDt>',
      '          <Dt>2024-05-15</Dt>',
      '        </BookgDt>',
      '        <RmtInf>',
      '          <Ustrd>Zapłata za FV 12/05/2024</Ustrd>',
      '        </RmtInf>',
      '        <RltdPties>',
      '          <Dbtr>',
      '            <Nm>Acme sp. z o.o.</Nm>',
      '          </Dbtr>',
      '        </RltdPties>',
      '        <Refs>',
      '          <EndToEndId>ABC123</EndToEndId>',
      '        </Refs>',
      '      </Ntry>',
      '      <Ntry>',
      '        <Amt>999.00</Amt>',
      '        <CdtDbtInd>DBIT</CdtDbtInd>',
      '      </Ntry>',
      '    </Stmt>',
      '  </BkToCstmrStmt>',
      '</Document>',
    ].join('\n');

    const xmlBlob = {
      getDataAsString: jest.fn(() => xmlContent),
      getBytes: jest.fn(() => Array.from(Buffer.from(xmlContent, 'utf8'))),
      getContentType: jest.fn(() => 'application/xml'),
    };

    const xmlFile = createFile('statement.xml', 'application/xml', {
      getBlob: () => xmlBlob,
    });

    newFolder.files = [xmlFile];

    const invoiceEntry = {
      FakturaId: 'INV-001',
      PelnyNumer: 'FV 12/05/2024',
      Brutto: 123.45,
      Zaplacono: 0,
      TerminPlatnosci: '2024-05-20',
      NazwaKontrahenta: 'Acme Sp. z o.o.',
      DataWystawienia: '2024-05-01',
      DataSprzedazy: '2024-05-01',
    };

    let nieoplaconeCallCount = 0;
    IFirma.listSalesInvoices.mockImplementation(async (params) => {
      if (params.status === 'nieoplacone') {
        nieoplaconeCallCount += 1;
        if (nieoplaconeCallCount <= 2) {
          return { ok: true, json: [invoiceEntry] };
        }
      }
      return { ok: true, json: [] };
    });

    await Main.processInvoices();

    expect(console.log).toHaveBeenCalledWith('Faktura FV 12/05/2024 | doZapłaty=123.45 | wynik= MATCH(linie 5–22)');
    expect(console.log).toHaveBeenCalledWith('MATCH: 1 | NO MATCH: 0');

    const cacheCall = scriptProperties.setProperty.mock.calls.find(([key]) => key === 'BANK_STATEMENT_MATCH_CACHE');
    expect(cacheCall).toBeDefined();
    const storedCache = JSON.parse(cacheCall[1]);
    expect(storedCache.hash).toBeTruthy();
    expect(storedCache.matches).toEqual({
      'INV-001': expect.objectContaining({
        lineFrom: 5,
        lineTo: 22,
      }),
    });
  });

  test('fills missing VAT and net amounts using gross totals per PTU', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-PTU',
        issueDate: '2024-01-10',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: undefined,
        vatAmount: undefined,
        vatRatePercent: undefined,
        grossAmount: 200,
        salesType: 'goods',
        vatLines: [
          { ratePercent: 23, grossAmount: 100 },
          { ratePercent: 8, grossAmount: 100 },
        ],
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    const [endpoint, payload] = IFirma.postExpense.mock.calls[0];
    expect(endpoint).toBe('kosztdzialalnoscivat');
    expect(payload.KwotaNetto23).toBeCloseTo(77);
    expect(payload.KwotaVat23).toBeCloseTo(23);
    expect(payload.KwotaNetto08).toBeCloseTo(92);
    expect(payload.KwotaVat08).toBeCloseTo(8);
    expect(Slack.notifyInvoiceFailure).not.toHaveBeenCalled();
  });

  test('multi invoice page flagged partial routes invoice to failed folder', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
      {
        invoiceNumber: 'INV-2',
        issueDate: '2024-01-02',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 50,
        vatAmount: 11.5,
        vatRatePercent: 23,
        grossAmount: 61.5,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 50, vatAmount: 11.5 }],
        detectedCurrencies: ['PLN', 'USD'],
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    expect(successFolder.createFile).toHaveBeenCalledTimes(1);
    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(2);
    const successBlob = successFolder.createFile.mock.calls[0][0];
    const failedBlob = failedFolder.createFile.mock.calls[0][0];
    expect(clones).toEqual(expect.arrayContaining([successBlob, failedBlob]));
    expect(successBlob.setName).toHaveBeenCalledWith('240101_1234567890_INV-1.pdf');
    expect(failedBlob.setName).toHaveBeenCalledWith('240102_1234567890_INV-2.pdf');
    expect(file.makeCopy).not.toHaveBeenCalled();
    expect(failedFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Skipping aggregated file move after exporting per-invoice PDFs', 'invoice.pdf', 'status', 'failed', 'exportedInvoices', 2);
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-2',
      classification: 'partial',
    }));
  });

  test('routes sales invoice to sales folders and posts fakturakraj payload', async () => {
    scriptProperties.getProperty.mockImplementation((key) => {
      if (key === 'GEMINI_API_KEY') return 'test-key';
      if (key === 'INVOICES_ROOT_FOLDER_ID') return storedRootFolderId;
      if (key === 'COMPANY_TAX_ID') return '1234567890';
      if (key === 'COMPANY_NAME') return 'Fentix';
      if (key === 'IFIRMA_SALES_CITY') return 'Warszawa';
      if (key === 'IFIRMA_SALES_SERIES') return 'custom';
      if (key === 'IFIRMA_SALES_TEMPLATE') return 'logo';
      if (key === 'IFIRMA_SALES_CALCULATION') return 'BRT';
      if (key === 'IFIRMA_SALES_BANK_ACCOUNT') return '12 3456 7890 1234 5678 9012 3456';
      return null;
    });

    const file = createFile('sale.pdf', 'application/pdf');
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('salePage');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: '150/9/2025',
        issueDate: '2024-02-01',
        currency: 'PLN',
        seller: {
          name: 'Fentix sp. z o.o.',
          taxId: '1234567890',
          address: {
            street: 'Główna 1',
            postalCode: '01-234',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Klient sp. z o.o.',
          taxId: '5556667778',
          address: {
            street: 'Poboczna 2',
            postalCode: '02-345',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23, grossAmount: 123 }],
        amountPaid: 123,
        amountPaidLabel: '123,00',
        paymentMethod: 'PRZ',
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postSalesInvoice).toHaveBeenCalledTimes(1);
    expect(IFirma.postExpense).not.toHaveBeenCalled();

    const [endpoint, payload] = IFirma.postSalesInvoice.mock.calls[0];
    expect(endpoint).toBe('fakturakraj');
    expect(payload.Zaplacono).toBeCloseTo(123);
    expect(payload.ZaplaconoNaDokumencie).toBeCloseTo(123);
    expect(payload.DataWystawienia).toBe('2024-02-01');
    expect(payload.MiejsceWystawienia).toBe('Warszawa');
    expect(payload.SposobZaplaty).toBe('PRZ');
    expect(payload.NumerKontaBankowego).toBe('12 3456 7890 1234 5678 9012 3456');
    expect(payload.WidocznyNumerBdo).toBe(false);
    expect(payload.Numer).toBe(150);
    expect(payload.Kontrahent).toEqual(expect.objectContaining({
      Nazwa: 'Klient sp. z o.o.',
      KodPocztowy: '02-345',
      Miejscowosc: 'Kraków',
    }));
    expect(payload.Pozycje).toHaveLength(1);
    expect(payload.Pozycje[0]).toEqual(expect.objectContaining({
      Ilosc: 1,
      StawkaVat: 0.23,
      GTU: 'BRAK',
      TypStawkiVat: 'PRC',
    }));

    expect(Hubspot.syncSaleInvoice).toHaveBeenCalledTimes(1);
    const hubspotPayload = Hubspot.syncSaleInvoice.mock.calls[0][0];
    expect(hubspotPayload).toMatchObject({
      invoiceNumber: '150/9/2025',
      kind: 'sale',
      grossAmount: 123,
    });

    expect(salesSuccessFolder.createFile).toHaveBeenCalledTimes(1);
    expect(salesFailedFolder.createFile).not.toHaveBeenCalled();
    expect(file.setName).not.toHaveBeenCalled();
    expect(salesSuccessFolder.addFile).not.toHaveBeenCalled();
    expect(salesOriginalsFolder.addFile).toHaveBeenCalledWith(file);
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(expenseSuccessFolder.createFile).not.toHaveBeenCalled();
    expect(expenseFailedFolder.createFile).not.toHaveBeenCalled();
  });

  test('marks sale invoice for review when HubSpot sync fails', async () => {
    scriptProperties.getProperty.mockImplementation((key) => {
      if (key === 'GEMINI_API_KEY') return 'test-key';
      if (key === 'INVOICES_ROOT_FOLDER_ID') return storedRootFolderId;
      if (key === 'COMPANY_TAX_ID') return '1234567890';
      if (key === 'COMPANY_NAME') return 'Fentix';
      if (key === 'IFIRMA_SALES_CITY') return 'Warszawa';
      return null;
    });

    const file = createFile('sale-hubspot-fail.pdf', 'application/pdf');
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('saleHubspot');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-HS-1',
        issueDate: '2024-02-10',
        currency: 'PLN',
        seller: {
          name: 'Fentix sp. z o.o.',
          taxId: '1234567890',
          address: {
            street: 'Główna 1',
            postalCode: '01-234',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Klient sp. z o.o.',
          taxId: '5556667778',
          address: {
            street: 'Poboczna 2',
            postalCode: '02-345',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        grossAmount: 123,
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
        amountPaid: 123,
        paymentMethod: 'PRZ',
      },
    ]);

    Hubspot.syncSaleInvoice.mockResolvedValue({
      success: false,
      classification: 'partial',
      reason: 'apiError',
      status: 400,
      message: 'Property invalid',
    });

    await Main.processInvoices();

    expect(IFirma.postSalesInvoice).toHaveBeenCalledTimes(1);
    expect(Hubspot.syncSaleInvoice).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    const failureRecord = Slack.notifyInvoiceFailure.mock.calls[0][0];
    expect(failureRecord).toMatchObject({
      classification: 'partial',
      hubspotReason: 'apiError',
      hubspotStatus: 400,
    });
    expect(salesFailedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(salesSuccessFolder.createFile).not.toHaveBeenCalled();
  });

  test('derives unit net prices from line totals and honours paid label for sales invoices', async () => {
    scriptProperties.getProperty.mockImplementation((key) => {
      if (key === 'GEMINI_API_KEY') return 'test-key';
      if (key === 'INVOICES_ROOT_FOLDER_ID') return storedRootFolderId;
      if (key === 'COMPANY_TAX_ID') return '1234567890';
      if (key === 'COMPANY_NAME') return 'Fentix';
      if (key === 'IFIRMA_SALES_CITY') return 'Warszawa';
      if (key === 'IFIRMA_SALES_SERIES') return 'custom';
      if (key === 'IFIRMA_SALES_TEMPLATE') return 'logo';
      if (key === 'IFIRMA_SALES_CALCULATION') return 'BRT';
      if (key === 'IFIRMA_SALES_BANK_ACCOUNT') return '12 3456 7890 1234 5678 9012 3456';
      return null;
    });

    const file = createFile('sale-multi.pdf', 'application/pdf');
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('saleMultiPage');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: '149/9/2025',
        issueDate: '2025-09-26',
        currency: 'PLN',
        seller: {
          name: 'Fentix sp. z o.o.',
          taxId: '1234567890',
          address: {
            street: 'Główna 1',
            postalCode: '01-234',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Klient sp. z o.o.',
          taxId: '5556667778',
          address: {
            street: 'Poboczna 2',
            postalCode: '02-345',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 1033.2,
        vatAmount: 237.64,
        grossAmount: 1270.84,
        vatLines: [
          { ratePercent: 23, netAmount: 933.2, vatAmount: 214.64, grossAmount: 1147.84 },
          { ratePercent: 23, netAmount: 100, vatAmount: 23, grossAmount: 123 },
        ],
        lineItems: [
          { description: 'Subskrypcja', quantity: 2, netAmount: 933.2, vatAmount: 214.64, grossAmount: 1147.84, vatRatePercent: 23 },
          { description: 'Opłata wdrożeniowa', quantity: 1, netAmount: 100, vatAmount: 23, grossAmount: 123, vatRatePercent: 23 },
        ],
        amountPaidLabel: '0,00',
        paymentStatus: 'Zapłacono',
        paymentMethod: 'PRZ',
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postSalesInvoice).toHaveBeenCalledTimes(1);
    const [, payload] = IFirma.postSalesInvoice.mock.calls[0];
    expect(payload.Zaplacono).toBe(0);
    expect(payload.ZaplaconoNaDokumencie).toBe(0);
    expect(payload.Pozycje).toHaveLength(2);

    const subscription = payload.Pozycje.find((item) => item.NazwaPelna === 'Subskrypcja');
    const setup = payload.Pozycje.find((item) => item.NazwaPelna === 'Opłata wdrożeniowa');
    expect(subscription).toBeDefined();
    expect(setup).toBeDefined();
    expect(subscription.Ilosc).toBeCloseTo(2);
    expect(subscription.CenaJednostkowa).toBeCloseTo(466.6);
    expect(setup.Ilosc).toBeCloseTo(1);
    expect(setup.CenaJednostkowa).toBeCloseTo(100);

    const totalNet = payload.Pozycje.reduce((sum, item) => {
      const qty = Number(item.Ilosc);
      const price = Number(item.CenaJednostkowa);
      return sum + Number((qty * price).toFixed(2));
    }, 0);
    const totalGross = payload.Pozycje.reduce((sum, item) => {
      const qty = Number(item.Ilosc);
      const price = Number(item.CenaJednostkowa);
      const rate = Number(item.StawkaVat);
      const lineNet = Number((qty * price).toFixed(2));
      const lineVat = Number((lineNet * rate).toFixed(2));
      return sum + Number((lineNet + lineVat).toFixed(2));
    }, 0);

    expect(totalNet).toBeCloseTo(1033.2);
    expect(totalGross).toBeCloseTo(1270.84);
  });

  test('skips iFirma export when sale line totals mismatch PDF summary', async () => {
    scriptProperties.getProperty.mockImplementation((key) => {
      if (key === 'GEMINI_API_KEY') return 'test-key';
      if (key === 'INVOICES_ROOT_FOLDER_ID') return storedRootFolderId;
      if (key === 'COMPANY_TAX_ID') return '1234567890';
      if (key === 'COMPANY_NAME') return 'Fentix';
      if (key === 'IFIRMA_SALES_CITY') return 'Warszawa';
      if (key === 'IFIRMA_SALES_SERIES') return 'custom';
      if (key === 'IFIRMA_SALES_TEMPLATE') return 'logo';
      if (key === 'IFIRMA_SALES_CALCULATION') return 'BRT';
      if (key === 'IFIRMA_SALES_BANK_ACCOUNT') return '12 3456 7890 1234 5678 9012 3456';
      return null;
    });

    const file = createFile('sale-mismatch.pdf', 'application/pdf');
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('saleMismatch');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: '154/9/2025',
        issueDate: '2025-09-26',
        currency: 'PLN',
        seller: {
          name: 'Fentix sp. z o.o.',
          taxId: '1234567890',
          address: {
            street: 'Główna 1',
            postalCode: '01-234',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Klient sp. z o.o.',
          taxId: '5556667778',
          address: {
            street: 'Poboczna 2',
            postalCode: '02-345',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 500,
        vatAmount: 115,
        grossAmount: 615,
        vatLines: [
          { ratePercent: 23, netAmount: 500, vatAmount: 115, grossAmount: 615 },
        ],
        lineItems: [
          { description: 'Abonament', quantity: 2, netAmount: 200, vatAmount: 46, grossAmount: 246, vatRatePercent: 23 },
        ],
        amountPaidLabel: '615,00',
        paymentStatus: 'Zapłacono',
        paymentMethod: 'PRZ',
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postSalesInvoice).not.toHaveBeenCalled();
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: '154/9/2025',
      classification: 'failed',
    }));
    expect(logger.error).toHaveBeenCalledWith(
      'Sale invoice totals mismatch before iFirma export',
      '154/9/2025',
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ field: 'gross' })]),
      }),
    );
    expect(salesFailedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(Hubspot.syncSaleInvoice).not.toHaveBeenCalled();
  });

  test('sale invoice without numeric number falls back to auto numbering', async () => {
    scriptProperties.getProperty.mockImplementation((key) => {
      if (key === 'GEMINI_API_KEY') return 'test-key';
      if (key === 'INVOICES_ROOT_FOLDER_ID') return storedRootFolderId;
      if (key === 'COMPANY_TAX_ID') return '1234567890';
      if (key === 'COMPANY_NAME') return 'Fentix';
      if (key === 'IFIRMA_SALES_CITY') return 'Gliwice';
      if (key === 'IFIRMA_SALES_CALCULATION') return 'BRT';
      return null;
    });

    const file = createFile('sale-missing-number.pdf', 'application/pdf');
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('salePage');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'FV/SPRZEDAZ',
        issueDate: '2024-03-01',
        currency: 'PLN',
        seller: {
          name: 'Fentix sp. z o.o.',
          taxId: '1234567890',
          address: {
            street: 'Główna 1',
            postalCode: '01-234',
            city: 'Gliwice',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Nowy Klient sp. z o.o.',
          taxId: '9998887776',
          address: {
            street: 'Kluczowa 3',
            postalCode: '03-210',
            city: 'Łódź',
            country: 'PL',
          },
        },
        netAmount: 200,
        vatAmount: 46,
        vatRatePercent: 23,
        grossAmount: 246,
        vatLines: [{ ratePercent: 23, netAmount: 200, vatAmount: 46, grossAmount: 246 }],
        amountPaid: 0,
        amountPaidLabel: '0,00',
        paymentMethod: 'PRZ',
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postSalesInvoice).toHaveBeenCalledTimes(1);
    const [, payload] = IFirma.postSalesInvoice.mock.calls[0];
    expect(payload.Numer).toBeNull();
    expect(payload.Kontrahent.Nazwa).toBe('Nowy Klient sp. z o.o.');
  });

  test('validateSalePayload marks textual document payment amount as missing', () => {
    const validator = Main.__test__ && Main.__test__.validateSalePayload;
    expect(typeof validator).toBe('function');

    const basePayload = {
      Zaplacono: 123,
      ZaplaconoNaDokumencie: 123,
      LiczOd: 'BRT',
      DataWystawienia: '2024-02-01',
      DataSprzedazy: '2024-02-01',
      FormatDatySprzedazy: 'DZN',
      SposobZaplaty: 'PRZ',
      RodzajPodpisuOdbiorcy: 'OUP',
      WidocznyNumerGios: false,
      WidocznyNumerBdo: false,
      Numer: 1,
      Pozycje: [
        {
          StawkaVat: 0.23,
          Ilosc: 1,
          CenaJednostkowa: 123,
          NazwaPelna: 'Usługa',
          Jednostka: 'szt.',
          GTU: 'BRAK',
          TypStawkiVat: 'PRC',
        },
      ],
      Kontrahent: {
        Nazwa: 'Klient',
        KodPocztowy: '00-001',
        Miejscowosc: 'Warszawa',
      },
    };

    const missingForText = validator({
      ...basePayload,
      ZaplaconoNaDokumencie: 'Zapłacono',
    });
    expect(missingForText).toContain('ZaplaconoNaDokumencie');

    const missingForNumeric = validator({
      ...basePayload,
      ZaplaconoNaDokumencie: 123,
    });
    expect(missingForNumeric).not.toContain('ZaplaconoNaDokumencie');

    const missingForStringNumber = validator({
      ...basePayload,
      Numer: 'FV 1/02/2024',
    });
    expect(missingForStringNumber).toContain('Numer');
  });

  test('recovers when stored root folder id is stale', async () => {
    storedRootFolderId = 'stale-root-folder';
    const recoveryRootFolder = createFolder(ROOT_FOLDER_NAME);
    const createdNewFolder = createFolder('New (Tutaj wgrywamy faktury)');
    const createdProcessedExpenses = createFolder('Processed (Wydatki)');
    const createdProcessedSales = createFolder('Processed (Sprzedaż)');
    const createdExpenseFailed = createFolder('Failed');
    const createdExpenseSuccess = createFolder('Successful (Gotowe)');
    const createdExpenseOriginals = createFolder('Originals (Oryginały z folderu "New")');
    const createdSalesFailed = createFolder('Failed');
    const createdSalesSuccess = createFolder('Successful (Gotowe)');
    const createdSalesOriginals = createFolder('Originals (Oryginały z folderu "New")');

    recoveryRootFolder.getFoldersByName = jest.fn(() => makeIterator([]));
    recoveryRootFolder.createFolder = jest.fn((name) => {
      if (name === 'New (Tutaj wgrywamy faktury)') return createdNewFolder;
      if (name === 'Processed (Wydatki)') return createdProcessedExpenses;
      if (name === 'Processed (Sprzedaż)') return createdProcessedSales;
      return createFolder(name);
    });

    createdProcessedExpenses.getFoldersByName = jest.fn(() => makeIterator([]));
    createdProcessedExpenses.createFolder = jest.fn((name) => {
      if (name === 'Failed') return createdExpenseFailed;
      if (name === 'Successful (Gotowe)') return createdExpenseSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return createdExpenseOriginals;
      return createFolder(name);
    });

    createdProcessedSales.getFoldersByName = jest.fn(() => makeIterator([]));
    createdProcessedSales.createFolder = jest.fn((name) => {
      if (name === 'Failed') return createdSalesFailed;
      if (name === 'Successful (Gotowe)') return createdSalesSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return createdSalesOriginals;
      return createFolder(name);
    });

    global.DriveApp.getFolderById.mockImplementationOnce(() => {
      throw new Error('Folder not found');
    });
    global.DriveApp.createFolder.mockImplementationOnce(() => recoveryRootFolder);

    await Main.processInvoices();

    expect(global.DriveApp.createFolder).toHaveBeenCalledWith(ROOT_FOLDER_NAME);
    expect(scriptProperties.setProperty).toHaveBeenCalledWith('INVOICES_ROOT_FOLDER_ID', ROOT_FOLDER_ID);
    expect(storedRootFolderId).toBe(ROOT_FOLDER_ID);

    expect(recoveryRootFolder.createFolder).toHaveBeenCalledWith('New (Tutaj wgrywamy faktury)');
    expect(recoveryRootFolder.createFolder).toHaveBeenCalledWith('Processed (Wydatki)');
    expect(recoveryRootFolder.createFolder).toHaveBeenCalledWith('Processed (Sprzedaż)');
    expect(createdProcessedExpenses.createFolder).toHaveBeenCalledWith('Failed');
    expect(createdProcessedExpenses.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(createdProcessedExpenses.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
    expect(createdProcessedSales.createFolder).toHaveBeenCalledWith('Failed');
    expect(createdProcessedSales.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(createdProcessedSales.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
  });

  test('reuses existing invoices root folder when configured id missing', async () => {
    storedRootFolderId = null;

    const existingRootFolder = createFolder(ROOT_FOLDER_NAME);
    existingRootFolder.isTrashed = jest.fn(() => false);
    existingRootFolder.getFoldersByName = jest.fn(() => makeIterator([]));

    global.DriveApp.getFoldersByName.mockImplementationOnce(() => makeIterator([existingRootFolder]));

    await Main.processInvoices();

    expect(global.DriveApp.createFolder).not.toHaveBeenCalledWith(ROOT_FOLDER_NAME);
    expect(scriptProperties.setProperty).toHaveBeenCalledWith('INVOICES_ROOT_FOLDER_ID', ROOT_FOLDER_ID);
    expect(storedRootFolderId).toBe(ROOT_FOLDER_ID);
    expect(logger.info).toHaveBeenCalledWith(
      'Reused invoices automation root folder',
      ROOT_FOLDER_NAME,
      ROOT_FOLDER_ID
    );

    const rootColorCall = driveFilesUpdate.mock.calls.find(([, folderId]) => folderId === ROOT_FOLDER_ID);
    const expenseColorCall = driveFilesUpdate.mock.calls.find(([, folderId]) => folderId === 'Processed (Wydatki)-id');
    const salesColorCall = driveFilesUpdate.mock.calls.find(([, folderId]) => folderId === 'Processed (Sprzedaż)-id');
    expect(rootColorCall).toBeDefined();
    expect(expenseColorCall).toBeDefined();
    expect(salesColorCall).toBeDefined();
    expect(rootColorCall[0].folderColorRgb).toBe('#9FC6E7');
  });

  test('recreates root folder when stored id points to missing folder', async () => {
    storedRootFolderId = 'ghost-root-folder';

    const recreatedRootFolder = createFolder(ROOT_FOLDER_NAME);
    const recreatedNewFolder = createFolder('New (Tutaj wgrywamy faktury)');
    const recreatedProcessedExpenses = createFolder('Processed (Wydatki)');
    const recreatedProcessedSales = createFolder('Processed (Sprzedaż)');
    const recreatedExpenseFailed = createFolder('Failed');
    const recreatedExpenseSuccess = createFolder('Successful (Gotowe)');
    const recreatedExpenseOriginals = createFolder('Originals (Oryginały z folderu "New")');
    const recreatedSalesFailed = createFolder('Failed');
    const recreatedSalesSuccess = createFolder('Successful (Gotowe)');
    const recreatedSalesOriginals = createFolder('Originals (Oryginały z folderu "New")');

    recreatedRootFolder.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedRootFolder.createFolder = jest.fn((name) => {
      if (name === 'New (Tutaj wgrywamy faktury)') return recreatedNewFolder;
      if (name === 'Processed (Wydatki)') return recreatedProcessedExpenses;
      if (name === 'Processed (Sprzedaż)') return recreatedProcessedSales;
      return createFolder(name);
    });

    recreatedProcessedExpenses.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedProcessedExpenses.createFolder = jest.fn((name) => {
      if (name === 'Failed') return recreatedExpenseFailed;
      if (name === 'Successful (Gotowe)') return recreatedExpenseSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return recreatedExpenseOriginals;
      return createFolder(name);
    });

    recreatedProcessedSales.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedProcessedSales.createFolder = jest.fn((name) => {
      if (name === 'Failed') return recreatedSalesFailed;
      if (name === 'Successful (Gotowe)') return recreatedSalesSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return recreatedSalesOriginals;
      return createFolder(name);
    });

    global.DriveApp.getFolderById.mockImplementationOnce(() => null);
    global.DriveApp.createFolder.mockImplementationOnce(() => recreatedRootFolder);

    await Main.processInvoices();

    expect(logger.warn).toHaveBeenCalledWith('Configured invoices root folder missing; creating a new one', 'ghost-root-folder');
    expect(global.DriveApp.createFolder).toHaveBeenCalledWith(ROOT_FOLDER_NAME);
    expect(scriptProperties.setProperty).toHaveBeenCalledWith('INVOICES_ROOT_FOLDER_ID', ROOT_FOLDER_ID);
    expect(storedRootFolderId).toBe(ROOT_FOLDER_ID);

    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('New (Tutaj wgrywamy faktury)');
    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('Processed (Wydatki)');
    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('Processed (Sprzedaż)');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Failed');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Failed');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
  });

  test('recreates root folder when stored id points to trashed folder', async () => {
    storedRootFolderId = 'trashed-root-folder';

    const trashedFolder = createFolder('Old Root');
    trashedFolder.isTrashed = jest.fn(() => true);

    const recreatedRootFolder = createFolder(ROOT_FOLDER_NAME);
    const recreatedNewFolder = createFolder('New (Tutaj wgrywamy faktury)');
    const recreatedProcessedExpenses = createFolder('Processed (Wydatki)');
    const recreatedProcessedSales = createFolder('Processed (Sprzedaż)');
    const recreatedExpenseFailed = createFolder('Failed');
    const recreatedExpenseSuccess = createFolder('Successful (Gotowe)');
    const recreatedExpenseOriginals = createFolder('Originals (Oryginały z folderu "New")');
    const recreatedSalesFailed = createFolder('Failed');
    const recreatedSalesSuccess = createFolder('Successful (Gotowe)');
    const recreatedSalesOriginals = createFolder('Originals (Oryginały z folderu "New")');

    recreatedRootFolder.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedRootFolder.createFolder = jest.fn((name) => {
      if (name === 'New (Tutaj wgrywamy faktury)') return recreatedNewFolder;
      if (name === 'Processed (Wydatki)') return recreatedProcessedExpenses;
      if (name === 'Processed (Sprzedaż)') return recreatedProcessedSales;
      return createFolder(name);
    });

    recreatedProcessedExpenses.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedProcessedExpenses.createFolder = jest.fn((name) => {
      if (name === 'Failed') return recreatedExpenseFailed;
      if (name === 'Successful (Gotowe)') return recreatedExpenseSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return recreatedExpenseOriginals;
      return createFolder(name);
    });

    recreatedProcessedSales.getFoldersByName = jest.fn(() => makeIterator([]));
    recreatedProcessedSales.createFolder = jest.fn((name) => {
      if (name === 'Failed') return recreatedSalesFailed;
      if (name === 'Successful (Gotowe)') return recreatedSalesSuccess;
      if (name === 'Originals (Oryginały z folderu "New")') return recreatedSalesOriginals;
      return createFolder(name);
    });

    global.DriveApp.getFolderById.mockImplementationOnce(() => trashedFolder);
    global.DriveApp.createFolder.mockImplementationOnce(() => recreatedRootFolder);

    await Main.processInvoices();

    expect(trashedFolder.isTrashed).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Configured invoices root folder is trashed; creating a new one', 'trashed-root-folder');
    expect(global.DriveApp.createFolder).toHaveBeenCalledWith(ROOT_FOLDER_NAME);
    expect(scriptProperties.setProperty).toHaveBeenCalledWith('INVOICES_ROOT_FOLDER_ID', ROOT_FOLDER_ID);
    expect(storedRootFolderId).toBe(ROOT_FOLDER_ID);

    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('New (Tutaj wgrywamy faktury)');
    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('Processed (Wydatki)');
    expect(recreatedRootFolder.createFolder).toHaveBeenCalledWith('Processed (Sprzedaż)');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Failed');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(recreatedProcessedExpenses.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Failed');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Successful (Gotowe)');
    expect(recreatedProcessedSales.createFolder).toHaveBeenCalledWith('Originals (Oryginały z folderu "New")');
  });

  test('Gemini error routes to failed', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockImplementation(() => { throw new Error('boom'); });

    await Main.processInvoices();

    expect(IFirma.postExpense).not.toHaveBeenCalled();
    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(1);
    const failedBlob = failedFolder.createFile.mock.calls[0][0];
    expect(clones).toContain(failedBlob);
    expect(failedBlob.setName).toHaveBeenCalledWith('240203_UNKNOWN_PAGE-1.pdf');
    expect(file.makeCopy).not.toHaveBeenCalled();
    expect(failedFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Skipping aggregated file move after exporting per-invoice PDFs', 'invoice.pdf', 'status', 'failed', 'exportedInvoices', 1);
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(console.log).not.toHaveBeenCalled();
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'failed',
      reason: expect.stringContaining('Nie udało się automatycznie rozpoznać'),
    }));
  });

  test('Gemini overload defers processing and leaves file for retry', async () => {
    const deferredFile = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    const processedFile = createFile('next.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [deferredFile, processedFile];

    const { pageBlob: deferredBlob } = createPdfBlob('page1');
    const { pageBlob: processedBlob, clones: processedClones } = createPdfBlob('page2');
    Helpers.splitPdfIntoPageBlobs
      .mockResolvedValueOnce([deferredBlob])
      .mockResolvedValueOnce([processedBlob]);

    const overloadedError = new Error('Gemini error: The model is overloaded. Please try again later.');
    Gemini.extractInvoicesFromBlob.mockImplementation((blob) => {
      if (blob === deferredBlob) {
        throw overloadedError;
      }
      return [{
        invoiceNumber: 'INV-OK',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: { street: 'Main 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: { street: 'Side 2', postalCode: '00-002', city: 'Kraków', country: 'PL' },
        },
        netAmount: 100,
        grossAmount: 123,
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
        salesType: 'goods',
      }];
    });

    await Main.processInvoices();

    expect(Utilities.sleep).toHaveBeenCalledTimes(5);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(2, 4000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(3, 8000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(4, 16000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(5, 32000);

    const deferredCalls = Gemini.extractInvoicesFromBlob.mock.calls.filter(([blob]) => blob === deferredBlob);
    expect(deferredCalls).toHaveLength(6);

    expect(logger.warn).toHaveBeenCalledWith(
      'Deferring file due to Gemini overload',
      'invoice.pdf',
      expect.objectContaining({ pageIndex: 1 })
    );

    expect(newFolder.removeFile).toHaveBeenCalledTimes(1);
    expect(newFolder.files).toContain(deferredFile);
    expect(newFolder.files).not.toContain(processedFile);

    expect(successFolder.createFile).toHaveBeenCalledTimes(1);
    const successBlob = successFolder.createFile.mock.calls[0][0];
    expect(processedClones).toContain(successBlob);

    expect(Slack.notifyInvoiceFailure).not.toHaveBeenCalled();

    expect(scriptProperties.setProperty).toHaveBeenCalledWith('INVOICES_PROGRESS', '');
  });

  test('multi currency invoice classified partial stored in failed folder', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        detectedCurrencies: ['PLN', 'USD'],
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
    ]);

    await Main.processInvoices();

    expect(IFirma.postExpense).not.toHaveBeenCalled();
    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(1);
    const failedBlob = failedFolder.createFile.mock.calls[0][0];
    expect(clones).toContain(failedBlob);
    expect(failedBlob.setName).toHaveBeenCalledWith('240101_1234567890_INV-1.pdf');
    expect(file.makeCopy).not.toHaveBeenCalled();
    expect(failedFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Skipping aggregated file move after exporting per-invoice PDFs', 'invoice.pdf', 'status', 'failed', 'exportedInvoices', 1);
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-1',
      classification: 'partial',
    }));
  });

  test('iFirma API error routes invoice to failed folder', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-ERR',
        issueDate: '2024-03-10',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          phone: '+48123123123',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 50,
        vatAmount: 11.5,
        vatRatePercent: 23,
        grossAmount: 61.5,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 50, vatAmount: 11.5 }],
      },
    ]);

    IFirma.postExpense.mockResolvedValueOnce({ ok: false, status: 500, body: 'Internal error' });

    await Main.processInvoices();

    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    expect(successFolder.createFile).not.toHaveBeenCalled();
    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping aggregated file move after exporting per-invoice PDFs',
      'invoice.pdf',
      'status',
      'failed',
      'exportedInvoices',
      1,
    );
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-ERR',
      classification: 'partial',
      reason: expect.stringContaining('iFirma'),
    }));
  });

  test('iFirma non-zero code routes invoice to failed folder', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-ERR',
        issueDate: '2024-03-10',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          phone: '+48123123123',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 50,
        vatAmount: 11.5,
        vatRatePercent: 23,
        grossAmount: 61.5,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 50, vatAmount: 11.5 }],
      },
    ]);

    IFirma.postExpense.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: '{"response":{"Kod":5}}',
      json: { response: { Kod: 5 } },
    });

    await Main.processInvoices();

    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    expect(Slack.notifyIfirmaError).toHaveBeenCalledTimes(1);
    expect(Slack.notifyIfirmaError).toHaveBeenCalledWith(expect.objectContaining({
      code: 5,
      invoiceNumber: 'INV-ERR',
      endpoint: 'kosztdzialalnoscivat',
      httpStatus: 200,
    }));
    expect(successFolder.createFile).not.toHaveBeenCalled();
    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'iFirma returned error for invoice',
      'INV-ERR',
      200,
      '{"response":{"Kod":5}}',
      { responseCode: 5 },
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping aggregated file move after exporting per-invoice PDFs',
      'invoice.pdf',
      'status',
      'failed',
      'exportedInvoices',
      1,
    );
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-ERR',
      classification: 'partial',
      ifirmaCode: 5,
    }));
  });

  test('missing iFirma required fields are reported with Polish names', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    const invoice = {
      invoiceNumber: '',
      issueDate: '',
      currency: 'PLN',
      seller: {
        name: '',
        taxId: '',
        address: { street: '', postalCode: '', city: '', country: 'PL' },
      },
      buyer: {
        name: 'Buyer',
        taxId: '0987654321',
        address: {
          street: 'Side 2',
          postalCode: '00-002',
          city: 'Kraków',
          country: 'PL',
        },
      },
      netAmount: 100,
      vatAmount: 23,
      vatRatePercent: 23,
      grossAmount: 123,
      salesType: 'goods',
      vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
    };

    Gemini.extractInvoicesFromBlob.mockReturnValue([invoice]);

    await Main.processInvoices();

    expect(failedFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(1);
    const failedBlob = failedFolder.createFile.mock.calls[0][0];
    expect(clones).toContain(failedBlob);
    expect(failedBlob.setName).toHaveBeenCalledWith('240203_0987654321_UNKNOWN.pdf');

    expect(invoice.ifirmaMissingFields).toEqual(expect.arrayContaining([
      'NumerFaktury',
      'DataWystawienia',
      'Kontrahent.Nazwa',
      'Kontrahent.KodPocztowy',
      'Kontrahent.Miejscowosc',
    ]));
    expect(invoice.validationFlags).toEqual({
      missingIfirmaFields: expect.arrayContaining([
        'NumerFaktury',
        'DataWystawienia',
        'Kontrahent.Nazwa',
      ]),
    });
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      classification: 'failed',
      reason: expect.stringContaining('Brak wymaganych danych'),
      details: expect.arrayContaining([
        expect.stringContaining('Brak pól wymaganych: NumerFaktury'),
      ]),
    }));
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping aggregated file move after exporting per-invoice PDFs',
      'invoice.pdf',
      'status',
      'failed',
      'exportedInvoices',
      1,
    );
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    const slackPayload = Slack.notifyInvoiceFailure.mock.calls[0][0];
    expect(slackPayload).toEqual(expect.objectContaining({
      invoiceNumber: '',
      classification: 'failed',
    }));
    const detailsText = Array.isArray(slackPayload.details) ? slackPayload.details.join(' ') : '';
    expect(detailsText).toContain('NumerFaktury');
  });

  test('duplicate invoice numbers on one page are flagged as duplicates', async () => {
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob, clones } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
    ]);

    await Main.processInvoices();

    expect(successFolder.createFile).toHaveBeenCalledTimes(1);
    expect(clones).toHaveLength(1);
    const storedNames = successFolder.files.map((entry) => entry.getName());
    expect(storedNames).toEqual(['240101_1234567890_INV-1.pdf']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping iFirma export for duplicate invoice',
      '240101_1234567890_INV-1.pdf'
    );
    expect(file.makeCopy).not.toHaveBeenCalled();
    expect(successFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping aggregated file move after exporting per-invoice PDFs',
      'invoice.pdf',
      'status',
      'success',
      'exportedInvoices',
      1
    );
    expect(IFirma.postExpense).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    const failurePayload = Slack.notifyInvoiceFailure.mock.calls[0][0];
    expect(failurePayload).toMatchObject({
      invoiceNumber: 'INV-1',
      classification: expect.stringMatching(/failed|partial/),
    });
    expect(failurePayload.reason).toContain('duplikat');
  });

  test('duplicate file skips re-archiving original and stays out of failed folder', async () => {
    const existingOriginal = createFile('invoice.pdf', 'application/pdf');
    originalsFolder.files.push(existingOriginal);
    const existingSuccessEntry = {
      name: '240101_1234567890_INV-1.pdf',
      getName: jest.fn(() => '240101_1234567890_INV-1.pdf'),
    };
    successFolder.files.push(existingSuccessEntry);

    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: jest.fn() });
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: {
          name: 'Sprzedawca',
          taxId: '1234567890',
          address: {
            street: 'Main 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        },
        buyer: {
          name: 'Buyer',
          taxId: '0987654321',
          address: {
            street: 'Side 2',
            postalCode: '00-002',
            city: 'Kraków',
            country: 'PL',
          },
        },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
        salesType: 'goods',
        vatLines: [{ ratePercent: 23, netAmount: 100, vatAmount: 23 }],
      },
    ]);

    await Main.processInvoices();

    expect(logger.info).toHaveBeenCalledWith('Original already archived – skipping duplicate copy', 'invoice.pdf');
    const originalMatches = originalsFolder.files.filter((entry) => entry.getName && entry.getName() === 'invoice.pdf');
    expect(originalMatches).toHaveLength(1);
    expect(failedFolder.addFile).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Discarded duplicate processed file copy',
      '240101_1234567890_INV-1.pdf',
      'status',
      'success'
    );
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(file.setTrashed).toHaveBeenCalledWith(true);
    expect(successFolder.addFile).not.toHaveBeenCalled();
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(IFirma.postExpense).not.toHaveBeenCalled();
  });

  test('falls back to moving aggregated file when invoice export fails', async () => {
    let copy;
    const file = createFile('invoice.pdf', 'application/pdf', { onCopy: (c) => { copy = c; } });
    newFolder.files = [file];
    const { pageBlob } = createPdfBlob('page1');
    Helpers.splitPdfIntoPageBlobs.mockResolvedValue([pageBlob]);

    jest.spyOn(Helpers, 'duplicatePdfBlob').mockRejectedValue(new Error('dup fail'));

    Gemini.extractInvoicesFromBlob.mockReturnValue([
      {
        invoiceNumber: 'INV-1',
        issueDate: '2024-01-01',
        currency: 'PLN',
        seller: { name: 'Sprzedawca', taxId: '1234567890' },
        buyer: { name: 'Buyer', taxId: '0987654321' },
        netAmount: 100,
        vatAmount: 23,
        vatRatePercent: 23,
        grossAmount: 123,
      },
    ]);

    await Main.processInvoices();

    expect(Helpers.duplicatePdfBlob).toHaveBeenCalledWith(pageBlob, '240101_1234567890_INV-1.pdf');
    expect(successFolder.createFile).not.toHaveBeenCalled();
    expect(failedFolder.createFile).toHaveBeenCalled();
    expect(copy.setName).toHaveBeenCalledWith('240101_1234567890_INV-1.pdf');
    expect(failedFolder.addFile).toHaveBeenCalledWith(copy);
    expect(logger.info).toHaveBeenCalledWith('Moved processed file copy', '240101_1234567890_INV-1.pdf', 'to', 'Failed', 'status', 'failed');
    expect(logger.info).toHaveBeenCalledWith('Archived original file', 'invoice.pdf', 'Originals (Oryginały z folderu "New")');
    expect(newFolder.removeFile).toHaveBeenCalledWith(file);
    expect(newFolder.removeFile).toHaveBeenCalledWith(copy);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledTimes(1);
    expect(Slack.notifyInvoiceFailure).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: 'INV-1',
      classification: expect.stringMatching(/partial|failed/),
    }));
  });
});
