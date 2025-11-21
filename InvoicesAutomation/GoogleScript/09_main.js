function processInvoices() {
  return Main.processInvoices();
}

const Main = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./01_logger'));
  const Helpers = globalThis.Helpers || (typeof require !== 'undefined' ? require('./05_helpers') : this.Helpers);
  const Gemini = globalThis.Gemini || (typeof require !== 'undefined' ? require('./04_gemini') : this.Gemini);
  const IFirma = globalThis.IFirma || (typeof require !== 'undefined' ? require('./07_ifirma') : this.IFirma);
  const Hubspot = globalThis.Hubspot || (typeof require !== 'undefined' ? require('./06_hubspot') : this.Hubspot);
  const Slack = globalThis.Slack || (typeof require !== 'undefined' ? require('./02_slack') : this.Slack);

  const lockService = typeof LockService !== 'undefined' ? LockService : globalThis.LockService;
  const propertiesService = typeof PropertiesService !== 'undefined' ? PropertiesService : globalThis.PropertiesService;
  const driveApp = typeof DriveApp !== 'undefined' ? DriveApp : globalThis.DriveApp;
  const spreadsheetApp = typeof SpreadsheetApp !== 'undefined'
    ? SpreadsheetApp
    : (typeof globalThis !== 'undefined' ? globalThis.SpreadsheetApp : null);

  function setLogger(l) {
    logger = l;
    if (Helpers && Helpers.setLogger) Helpers.setLogger(l);
    if (Gemini && Gemini.setLogger) Gemini.setLogger(l);
    if (IFirma && IFirma.setLogger) IFirma.setLogger(l);
    if (Hubspot && Hubspot.setLogger) Hubspot.setLogger(l);
    if (Slack && Slack.setLogger) Slack.setLogger(l);
  }

  const ROOT_FOLDER_NAME = '💡 Invoices automation (Faktury)';

  const FOLDER_NAMES = {
    source: 'New (Tutaj wgrywamy faktury)',
    processedExpenses: 'Processed (Wydatki)',
    processedSales: 'Processed (Sprzedaż)',
    processedBankStatements: 'Processed (Wyciągi bankowe)',
    success: 'Successful (Gotowe)',
    failed: 'Failed',
    failedRetry: 'Retry (Wrzuć tutaj faktury do ponownego przetworzenia)',
    failedSuccessExpenses: 'Done (Stąd trafią do "Successful [Wydatki]")',
    failedSuccessSales: 'Done (Stąd trafią do "Successful [Sprzedaż]")',
    originals: 'Originals (Oryginały z folderu "New")',
  };

  const MAX_INVOICES_PER_RUN = 10;
  const PROGRESS_PROPERTY_KEY = 'INVOICES_PROGRESS';
  const BANK_STATEMENT_CACHE_PROPERTY = 'BANK_STATEMENT_MATCH_CACHE';
  const IFIRMA_PAYMENT_INVOICE_TYPE = 'prz_faktura_kraj';

  const SHEET_CONFIG = {
    expense: { title: 'Faktury wydatki (Dane)' },
    sale: { title: 'Faktury sprzedaż (Dane)' },
  };

  const SHEET_COLUMNS = [
    { header: 'Numer faktury', value: (invoice) => safeString_(invoice && invoice.invoiceNumber) },
    { header: 'Rodzaj', value: (invoice) => (invoice && invoice.kind === 'sale' ? 'sprzedaż' : 'wydatek') },
    { header: 'Data wystawienia', value: (invoice) => safeString_(invoice && invoice.issueDate) },
    { header: 'Data dostawy', value: (invoice) => safeString_(invoice && invoice.deliveryDate) },
    { header: 'Termin płatności', value: (invoice) => safeString_(invoice && invoice.paymentDueDate) },
    { header: 'Waluta', value: (invoice) => safeString_(invoice && invoice.currency) },
    { header: 'Kwota netto', value: (invoice) => hasValue_(invoice && invoice.netAmount) ? invoice.netAmount : '' },
    { header: 'Kwota VAT', value: (invoice) => hasValue_(invoice && invoice.vatAmount) ? invoice.vatAmount : '' },
    { header: 'Kwota brutto', value: (invoice) => hasValue_(invoice && invoice.grossAmount) ? invoice.grossAmount : '' },
    { header: 'Stawka VAT', value: (invoice) => hasValue_(invoice && invoice.vatRatePercent) ? invoice.vatRatePercent : '' },
    { header: 'Podstawa zwolnienia VAT', value: (invoice) => safeString_(invoice && invoice.vatExemptionReason) },
    { header: 'Typ sprzedaży', value: (invoice) => safeString_(invoice && invoice.salesType) },
    { header: 'Kwota zapłacona', value: (invoice) => hasValue_(invoice && invoice.amountPaid) ? invoice.amountPaid : '' },
    { header: 'Opis kwoty zapłaconej', value: (invoice) => safeString_(invoice && invoice.amountPaidLabel) },
    { header: 'Kwota do zapłaty', value: (invoice) => hasValue_(invoice && invoice.amountDue) ? invoice.amountDue : '' },
    { header: 'Status płatności', value: (invoice) => safeString_(invoice && invoice.paymentStatus) },
    { header: 'Metoda płatności', value: (invoice) => safeString_(invoice && invoice.paymentMethod) },
    { header: 'Nazwa sprzedawcy', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.name) },
    { header: 'NIP sprzedawcy', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.taxId) },
    { header: 'Sprzedawca - ulica', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.address && invoice.seller.address.street) },
    { header: 'Sprzedawca - kod pocztowy', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.address && invoice.seller.address.postalCode) },
    { header: 'Sprzedawca - miasto', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.address && invoice.seller.address.city) },
    { header: 'Sprzedawca - kraj', value: (invoice) => safeString_(invoice && invoice.seller && invoice.seller.address && invoice.seller.address.country) },
    { header: 'Nazwa nabywcy', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.name) },
    { header: 'NIP nabywcy', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.taxId) },
    { header: 'Nabywca - ulica', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.address && invoice.buyer.address.street) },
    { header: 'Nabywca - kod pocztowy', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.address && invoice.buyer.address.postalCode) },
    { header: 'Nabywca - miasto', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.address && invoice.buyer.address.city) },
    { header: 'Nabywca - kraj', value: (invoice) => safeString_(invoice && invoice.buyer && invoice.buyer.address && invoice.buyer.address.country) },
    { header: 'Wykryte waluty', value: (invoice) => Array.isArray(invoice && invoice.detectedCurrencies) ? invoice.detectedCurrencies.join(', ') : safeString_(invoice && invoice.detectedCurrencies) },
    { header: 'Pozycje VAT (JSON)', value: (invoice) => Array.isArray(invoice && invoice.vatLines) && invoice.vatLines.length ? JSON.stringify(invoice.vatLines) : '' },
    { header: 'Pozycje (JSON)', value: (invoice) => Array.isArray(invoice && invoice.lineItems) && invoice.lineItems.length ? JSON.stringify(invoice.lineItems) : '' },
    { header: 'Plik źródłowy', value: (invoice, ctx) => safeString_(ctx && ctx.fileName) },
    { header: 'ID pliku', value: (invoice, ctx) => safeString_(ctx && ctx.fileId) },
    { header: 'Data przetworzenia', value: () => formatDate_(new Date()) },
  ];

  const sheetCache = {};

  let configuration = {
    company: {
      taxId: '',
      normalisedTaxId: '',
      name: '',
      normalisedName: '',
    },
    sales: {
      issueCity: '',
      numberingSeries: '',
      template: '',
      calculationBasis: '',
      bankAccount: '',
    },
  };

  function ensureRootFolder_(scriptProperties) {
    const hasLogger = logger && typeof logger.info === 'function';
    const hasWarnLogger = logger && typeof logger.warn === 'function';
    const hasDebugLogger = logger && typeof logger.debug === 'function';

    const rootFolderId = scriptProperties.getProperty('INVOICES_ROOT_FOLDER_ID');
    if (rootFolderId) {
      try {
        const folder = driveApp.getFolderById(rootFolderId);
        const isTrashed = folder && typeof folder.isTrashed === 'function' ? folder.isTrashed() : false;
        if (folder && !isTrashed) {
          if (hasDebugLogger) {
            const folderName = folder && folder.getName ? folder.getName() : '';
            logger.debug('Loaded invoices root folder', { id: rootFolderId, name: folderName });
          }
          if (Helpers && typeof Helpers.setFolderColor === 'function') {
            Helpers.setFolderColor(folder);
          }
          return folder;
        }
        if (hasWarnLogger) {
          const message = isTrashed
            ? 'Configured invoices root folder is trashed; creating a new one'
            : 'Configured invoices root folder missing; creating a new one';
          logger.warn(message, rootFolderId);
        }
      } catch (err) {
        if (hasWarnLogger) {
          logger.warn('Unable to load configured invoices root folder; creating a new one', rootFolderId, err);
        }
      }
    } else if (hasLogger) {
      logger.info('Invoices root folder ID not set; creating a new root folder');
    }

    let folder;

    let reusedExisting = false;

    if (driveApp && typeof driveApp.getFoldersByName === 'function') {
      try {
        const iterator = driveApp.getFoldersByName(ROOT_FOLDER_NAME);
        if (iterator && typeof iterator.hasNext === 'function' && typeof iterator.next === 'function') {
          while (iterator.hasNext()) {
            const candidate = iterator.next();
            if (!candidate) {
              continue;
            }
            const candidateIsTrashed = typeof candidate.isTrashed === 'function' ? candidate.isTrashed() : false;
            if (!candidateIsTrashed) {
              folder = candidate;
              reusedExisting = true;
              break;
            }
          }
        }
      } catch (err) {
        if (hasWarnLogger) {
          logger.warn('Unable to search for existing invoices automation root folder', err);
        }
      }
    }

    if (!folder) {
      folder = driveApp.createFolder(ROOT_FOLDER_NAME);
    }

    const folderId = folder && folder.getId ? folder.getId() : null;
    if (folderId && scriptProperties.setProperty) {
      scriptProperties.setProperty('INVOICES_ROOT_FOLDER_ID', folderId);
    }
    if (Helpers && typeof Helpers.setFolderColor === 'function') {
      Helpers.setFolderColor(folder);
    }
    if (hasLogger) {
      const folderName = folder && folder.getName ? folder.getName() : ROOT_FOLDER_NAME;
      if (reusedExisting) {
        logger.info('Reused invoices automation root folder', folderName, folderId);
      } else {
        logger.info('Created invoices automation root folder', folderName, folderId);
      }
    }
    return folder;
  }

  function getSheetCacheKey_(folderId, kind) {
    const safeId = safeString_(folderId) || 'unknown';
    return safeId + '::' + (kind || 'expense');
  }

  function findSpreadsheetFileInFolder_(folder, title) {
    if (!folder || !folder.getFilesByName) {
      return null;
    }
    try {
      const iterator = folder.getFilesByName(title);
      while (iterator && iterator.hasNext && iterator.hasNext()) {
        const candidate = iterator.next();
        if (!candidate) {
          continue;
        }
        if (candidate.isTrashed && candidate.isTrashed()) {
          continue;
        }
        const mimeType = candidate.getMimeType ? candidate.getMimeType() : '';
        if (mimeType && mimeType !== 'application/vnd.google-apps.spreadsheet') {
          continue;
        }
        return candidate;
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to search for spreadsheet in folder', title, err);
      }
    }
    return null;
  }

  function openSheetById_(id) {
    if (!id || !spreadsheetApp || !spreadsheetApp.openById) {
      return null;
    }
    try {
      const spreadsheet = spreadsheetApp.openById(id);
      if (!spreadsheet) {
        return null;
      }
      if (typeof spreadsheet.getActiveSheet === 'function') {
        return spreadsheet.getActiveSheet();
      }
      if (typeof spreadsheet.getSheets === 'function') {
        const sheets = spreadsheet.getSheets();
        if (Array.isArray(sheets) && sheets.length) {
          return sheets[0];
        }
      }
      return null;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to open spreadsheet by id', id, err);
      }
      return null;
    }
  }

  function ensureSheetHeaders_(sheet) {
    if (!sheet || !sheet.getRange) {
      return;
    }
    const headers = SHEET_COLUMNS.map((column) => column.header);
    try {
      const range = sheet.getRange(1, 1, 1, headers.length);
      if (!range || !range.getValues || !range.setValues) {
        range && range.setValues && range.setValues([headers]);
        return;
      }
      const current = range.getValues();
      const row = Array.isArray(current) && current.length ? current[0] : [];
      let needsUpdate = row.length !== headers.length;
      if (!needsUpdate) {
        for (let index = 0; index < headers.length; index += 1) {
          if (safeString_(row[index]) !== headers[index]) {
            needsUpdate = true;
            break;
          }
        }
      }
      if (needsUpdate) {
        range.setValues([headers]);
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to ensure spreadsheet headers', err);
      }
    }
  }

  function ensureSpreadsheetForFolder_(folder, kind) {
    if (!folder || !spreadsheetApp) {
      return null;
    }
    const folderId = folder.getId ? folder.getId() : '';
    const cacheKey = getSheetCacheKey_(folderId, kind);
    if (sheetCache[cacheKey]) {
      return sheetCache[cacheKey];
    }

    const sheetConfig = SHEET_CONFIG[kind === 'sale' ? 'sale' : 'expense'];
    const title = sheetConfig && sheetConfig.title ? sheetConfig.title : 'Faktury (Dane)';

    const cached = { sheet: null, id: null };

    const existingFile = findSpreadsheetFileInFolder_(folder, title);
    if (existingFile && existingFile.getId) {
      cached.id = existingFile.getId();
      cached.sheet = openSheetById_(cached.id);
      ensureSheetHeaders_(cached.sheet);
      sheetCache[cacheKey] = cached;
      return cached;
    }

    if (!spreadsheetApp.create || !driveApp || !driveApp.getFileById) {
      return null;
    }

    try {
      const spreadsheet = spreadsheetApp.create(title);
      if (!spreadsheet || !spreadsheet.getId) {
        return null;
      }
      const id = spreadsheet.getId();
      cached.id = id;
      cached.sheet = typeof spreadsheet.getActiveSheet === 'function'
        ? spreadsheet.getActiveSheet()
        : (typeof spreadsheet.getSheets === 'function'
          ? (spreadsheet.getSheets()[0] || null)
          : null);
      const file = driveApp.getFileById(id);
      if (file && folder.addFile) {
        try {
          folder.addFile(file);
        } catch (addErr) {
          if (logger && logger.warn) {
            logger.warn('Unable to add spreadsheet to folder', title, addErr);
          }
        }
      }
      ensureSheetHeaders_(cached.sheet);
      sheetCache[cacheKey] = cached;
      return cached;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to create spreadsheet for folder', title, err);
      }
      return null;
    }
  }

  function getGroupSheet_(group) {
    if (!group) {
      return null;
    }
    if (group.sheet) {
      return group.sheet;
    }
    if (group.sheetId) {
      const sheet = openSheetById_(group.sheetId);
      if (sheet) {
        group.sheet = sheet;
        return sheet;
      }
    }
    return null;
  }

  function sheetHasInvoice_(sheet, invoiceNumber) {
    if (!sheet || !sheet.getLastRow || !sheet.getRange) {
      return false;
    }
    const number = safeString_(invoiceNumber);
    if (!number) {
      return false;
    }
    let lastRow = 0;
    try {
      lastRow = sheet.getLastRow();
    } catch (err) {
      lastRow = 0;
    }
    if (!Number.isFinite(lastRow) || lastRow <= 1) {
      return false;
    }
    try {
      const range = sheet.getRange(2, 1, lastRow - 1, 1);
      if (!range || !range.getValues) {
        return false;
      }
      const values = range.getValues();
      for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
        const row = values[rowIndex];
        if (!Array.isArray(row) || !row.length) {
          continue;
        }
        if (safeString_(row[0]) === number) {
          return true;
        }
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to inspect spreadsheet for duplicates', err);
      }
    }
    return false;
  }

  function appendRowToSheet_(sheet, row) {
    if (!sheet) {
      return;
    }
    try {
      if (sheet.appendRow) {
        sheet.appendRow(row);
        return;
      }
      if (sheet.getRange && sheet.getLastRow) {
        const lastRow = Number(sheet.getLastRow()) || 0;
        const target = sheet.getRange(lastRow + 1 || 1, 1, 1, row.length);
        if (target && target.setValues) {
          target.setValues([row]);
        }
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to append row to spreadsheet', err);
      }
    }
  }

  function buildSheetRow_(invoice, context) {
    return SHEET_COLUMNS.map((column) => {
      try {
        return column.value(invoice, context);
      } catch (err) {
        if (logger && logger.warn) {
          logger.warn('Unable to resolve spreadsheet column value', column.header, err);
        }
        return '';
      }
    });
  }

  function recordInvoiceInSpreadsheet_(invoice, group, context) {
    if (!invoice || !group) {
      return;
    }
    const sheet = getGroupSheet_(group);
    if (!sheet) {
      return;
    }
    const number = invoice && invoice.invoiceNumber;
    if (sheetHasInvoice_(sheet, number)) {
      return;
    }
    const row = buildSheetRow_(invoice, context);
    appendRowToSheet_(sheet, row);
  }

  function normaliseProgressEntry_(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const page = Number(entry.page);
    const invoice = Number(entry.invoice);
    const normalised = {
      page: Number.isFinite(page) && page > 0 ? Math.max(page, 0) : 0,
      invoice: Number.isFinite(invoice) && invoice > 0 ? Math.max(invoice, 0) : 0,
    };
    if (!normalised.page && !normalised.invoice) {
      return null;
    }
    return normalised;
  }

  function loadProgress_(scriptProperties) {
    if (!scriptProperties || !scriptProperties.getProperty) {
      return {};
    }
    const raw = scriptProperties.getProperty(PROGRESS_PROPERTY_KEY);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const progress = {};
      Object.keys(parsed).forEach((key) => {
        const value = parsed[key];
        if (value && typeof value === 'object') {
          const normalised = normaliseProgressEntry_(value);
          if (normalised) {
            progress[key] = normalised;
          }
        } else {
          const legacyValue = Number(value);
          if (Number.isFinite(legacyValue) && legacyValue > 0) {
            progress[key] = { page: 0, invoice: Math.max(legacyValue, 0) };
          }
        }
      });
      return progress;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to parse invoices progress; resetting state', err);
      }
      return {};
    }
  }

  function saveProgress_(scriptProperties, progress) {
    if (!scriptProperties || !scriptProperties.setProperty) {
      return;
    }
    const keys = Object.keys(progress || {});
    if (!keys.length) {
      if (scriptProperties.deleteProperty) {
        scriptProperties.deleteProperty(PROGRESS_PROPERTY_KEY);
      } else {
        scriptProperties.setProperty(PROGRESS_PROPERTY_KEY, '');
      }
      return;
    }
    const payload = {};
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = normaliseProgressEntry_(progress[key]);
      if (value) {
        payload[key] = value;
      }
    }
    const payloadKeys = Object.keys(payload);
    try {
      if (payloadKeys.length) {
        scriptProperties.setProperty(PROGRESS_PROPERTY_KEY, JSON.stringify(payload));
      } else if (scriptProperties.deleteProperty) {
        scriptProperties.deleteProperty(PROGRESS_PROPERTY_KEY);
      } else {
        scriptProperties.setProperty(PROGRESS_PROPERTY_KEY, '');
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to store invoices progress', err);
      }
    }
  }

  function loadConfiguration_(scriptProperties) {
    const getProperty = (key) => (scriptProperties && scriptProperties.getProperty
      ? scriptProperties.getProperty(key)
      : null);

    const companyTaxId = safeString_(getProperty('COMPANY_TAX_ID'));
    const companyName = safeString_(getProperty('COMPANY_NAME'));
    const taxInfo = extractTaxInfo_(companyTaxId);
    configuration = {
      company: {
        taxId: companyTaxId,
        normalisedTaxId: taxInfo.nip || '',
        name: companyName,
        normalisedName: companyName ? companyName.toLowerCase() : '',
      },
      sales: {
        issueCity: safeString_(getProperty('IFIRMA_SALES_CITY')),
        numberingSeries: safeString_(getProperty('IFIRMA_SALES_SERIES')),
        template: safeString_(getProperty('IFIRMA_SALES_TEMPLATE')),
        calculationBasis: safeString_(getProperty('IFIRMA_SALES_CALCULATION')) || 'BRT',
        bankAccount: safeString_(getProperty('IFIRMA_SALES_BANK_ACCOUNT')) || '',
      },
    };
  }

  async function processInvoices() {
    logger.info('Starting processInvoices');
    const lock = lockService && lockService.getScriptLock ? lockService.getScriptLock() : null;
    if (lock && !lock.tryLock(0)) {
      logger.info('processInvoices already running, skipping');
      return;
    }

    try {
      const scriptProperties = propertiesService && propertiesService.getScriptProperties
        ? propertiesService.getScriptProperties()
        : null;

      if (!scriptProperties) {
        logger.error('Script properties unavailable – aborting');
        return;
      }

      const apiKey = scriptProperties.getProperty('GEMINI_API_KEY');
      if (!apiKey) {
        const hasRootFolderId = !!scriptProperties.getProperty('INVOICES_ROOT_FOLDER_ID');
        logger.error('Missing required script properties', { hasApiKey: !!apiKey, hasRootFolderId });
        return;
      }

      if (Gemini && Gemini.setApiKeyOverride) {
        Gemini.setApiKeyOverride(apiKey);
      }

      loadConfiguration_(scriptProperties);

      const rootFolder = ensureRootFolder_(scriptProperties);

      const folders = {
        source: Helpers.getOrCreateSubFolder(rootFolder, FOLDER_NAMES.source),
      };

      const processedExpenses = Helpers.getOrCreateSubFolder(rootFolder, FOLDER_NAMES.processedExpenses);
      const expenseGroup = {
        processed: processedExpenses,
        success: Helpers.getOrCreateSubFolder(processedExpenses, FOLDER_NAMES.success),
        failed: Helpers.getOrCreateSubFolder(processedExpenses, FOLDER_NAMES.failed),
        originals: ensureOriginalsFolders_(processedExpenses),
      };
      expenseGroup.failedRetry = expenseGroup.failed
        && Helpers.getOrCreateSubFolder(expenseGroup.failed, FOLDER_NAMES.failedRetry);
      expenseGroup.failedSuccess = expenseGroup.failed
        && Helpers.getOrCreateSubFolder(expenseGroup.failed, FOLDER_NAMES.failedSuccessExpenses);
      const expenseSheetEntry = ensureSpreadsheetForFolder_(processedExpenses, 'expense');
      if (expenseSheetEntry) {
        expenseGroup.sheet = expenseSheetEntry.sheet;
        expenseGroup.sheetId = expenseSheetEntry.id;
      }

      const processedSales = Helpers.getOrCreateSubFolder(rootFolder, FOLDER_NAMES.processedSales);
      const salesGroup = {
        processed: processedSales,
        success: Helpers.getOrCreateSubFolder(processedSales, FOLDER_NAMES.success),
        failed: Helpers.getOrCreateSubFolder(processedSales, FOLDER_NAMES.failed),
        originals: ensureOriginalsFolders_(processedSales),
      };
      salesGroup.failedRetry = salesGroup.failed
        && Helpers.getOrCreateSubFolder(salesGroup.failed, FOLDER_NAMES.failedRetry);
      salesGroup.failedSuccess = salesGroup.failed
        && Helpers.getOrCreateSubFolder(salesGroup.failed, FOLDER_NAMES.failedSuccessSales);
      const salesSheetEntry = ensureSpreadsheetForFolder_(processedSales, 'sale');
      if (salesSheetEntry) {
        salesGroup.sheet = salesSheetEntry.sheet;
        salesGroup.sheetId = salesSheetEntry.id;
      }

      const processedBankStatements = Helpers.getOrCreateSubFolder(rootFolder, FOLDER_NAMES.processedBankStatements);
      const bankStatementGroup = { processed: processedBankStatements };

      folders.expense = expenseGroup;
      folders.sales = salesGroup;
      folders.bankStatements = bankStatementGroup;

      const helperMoves = [
        { from: expenseGroup.failedRetry, to: folders.source },
        { from: salesGroup.failedRetry, to: folders.source },
        { from: expenseGroup.failedSuccess, to: expenseGroup.success },
        { from: salesGroup.failedSuccess, to: salesGroup.success },
      ];
      for (let i = 0; i < helperMoves.length; i += 1) {
        const entry = helperMoves[i];
        const from = entry && entry.from;
        const to = entry && entry.to;
        if (!from || !to || !from.getFiles) {
          continue;
        }
        const helperFiles = from.getFiles();
        while (helperFiles && helperFiles.hasNext && helperFiles.hasNext()) {
          const file = helperFiles.next();
          moveFile_(file, from, to);
        }
        const helperSubfolders = from.getFolders && from.getFolders();
        while (helperSubfolders && helperSubfolders.hasNext && helperSubfolders.hasNext()) {
          const subfolder = helperSubfolders.next();
          if (subfolder && subfolder.moveTo) {
            subfolder.moveTo(to);
          }
        }
      }

      const progress = loadProgress_(scriptProperties);
      let remainingInvoices = MAX_INVOICES_PER_RUN;

      const files = folders.source.getFiles();
      const bankStatements = [];
      while (files.hasNext() && remainingInvoices > 0) {
        const file = files.next();
        if (file.isTrashed && file.isTrashed()) {
          logger.debug('Skipping trashed file', file.getName ? file.getName() : '');
          continue;
        }
        const outcome = await processFile_(file, folders, {
          limit: remainingInvoices,
          progressMap: progress,
          scriptProperties,
        });
        if (outcome && outcome.bankStatementFile) {
          bankStatements.push({
            file: outcome.bankStatementFile,
            name: outcome.bankStatementName || (outcome.bankStatementFile.getName
              ? outcome.bankStatementFile.getName()
              : ''),
          });
        }
        const processedCount = outcome && Number.isFinite(outcome.processedCount)
          ? outcome.processedCount
          : 0;
        if (processedCount > 0) {
          remainingInvoices = Math.max(remainingInvoices - processedCount, 0);
        }
        if (outcome && outcome.fileId && progress) {
          if (outcome.hasRemaining && outcome.nextStart) {
            progress[outcome.fileId] = outcome.nextStart;
          } else {
            delete progress[outcome.fileId];
          }
        }
      }
      saveProgress_(scriptProperties, progress);
      if (bankStatements.length) {
        await listUnpaidInvoicesStage_();
      }
      for (let i = 0; i < bankStatements.length; i += 1) {
        const entry = bankStatements[i];
        const label = entry && entry.name
          ? entry.name
          : (entry && entry.file && entry.file.getName
            ? entry.file.getName()
            : 'Wyciąg bankowy');
        if (entry && entry.file) {
          try {
            await processBankStatementFile_(entry.file, folders, scriptProperties);
          } catch (err) {
            logger.error('Failed to process bank statement XML', err);
          }
        }
        logger.info(label + ' – wyciąg bankowy');
      }
      logger.info('Finished processInvoices');
    } catch (err) {
      logger.error('processInvoices failed', err);
      throw err;
    } finally {
      if (lock && lock.releaseLock) {
        lock.releaseLock();
      }
    }
  }

  async function processFile_(file, folders, options) {
    const fileName = file.getName ? file.getName() : 'invoice';

    const progressMap = options && options.progressMap && typeof options.progressMap === 'object'
      ? options.progressMap
      : {};
    const scriptPropertiesOverride = options && options.scriptProperties
      ? options.scriptProperties
      : null;
    const limit = options && Number.isFinite(options.limit) ? Number(options.limit) : Infinity;
    if (limit <= 0) {
      logger.info('Invoice limit reached before processing file', fileName);
      let limitedFileId;
      try {
        limitedFileId = file && file.getId ? file.getId() : undefined;
      } catch (err) {
        limitedFileId = undefined;
      }
      return {
        processedCount: 0,
        fileId: limitedFileId,
        nextStart: limitedFileId && progressMap && typeof progressMap[limitedFileId] === 'object'
          ? progressMap[limitedFileId]
          : null,
        hasRemaining: true,
      };
    }
    let fileId;
    try {
      fileId = file && file.getId ? file.getId() : undefined;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to read file id for progress tracking', err);
      }
      fileId = undefined;
    }
    const progressEntry = fileId && progressMap[fileId] && typeof progressMap[fileId] === 'object'
      ? normaliseProgressEntry_(progressMap[fileId])
      : null;
    let startPageIndex = progressEntry ? Math.max(Number(progressEntry.page) || 0, 0) : 0;
    let startInvoiceOffset = progressEntry ? Math.max(Number(progressEntry.invoice) || 0, 0) : 0;

    let blobs;
    let mimeType;
    try {
      mimeType = file.getMimeType ? file.getMimeType() : '';
      if (isXml_(mimeType, fileName)) {
        return {
          processedCount: 0,
          fileId,
          bankStatementName: fileName,
          bankStatementFile: file,
          hasRemaining: false,
        };
      }
      logger.info('ℹ️ Processing file', fileName);
      if (isPdf_(mimeType, fileName)) {
        blobs = await Helpers.splitPdfIntoPageBlobs(file);
      } else if (isImage_(mimeType, fileName)) {
        const blob = file.getBlob ? file.getBlob() : null;
        if (!blob) throw new Error('Unable to read blob for image');
        blobs = [blob];
      } else {
        logger.warn('Unsupported mime type for invoices', mimeType, fileName);
        const defaultGroup = getGroupForKind_(folders, 'expense');
        if (defaultGroup && defaultGroup.failed) {
          moveFile_(file, folders.source, defaultGroup.failed);
        }
        await notifyInvoiceFailure_({
          classification: 'failed',
          reason: 'Nieobsługiwany typ pliku (' + (mimeType || 'nieznany') + ') – dokument przeniesiony do Failed.',
          fileName,
        });
        if (fileId && progressMap) {
          delete progressMap[fileId];
        }
        return {
          processedCount: 0,
          fileId,
          nextStart: null,
          hasRemaining: false,
        };
      }
    } catch (err) {
      logger.error('Failed preparing blobs for file', fileName, err);
      const defaultGroup = getGroupForKind_(folders, 'expense');
      if (defaultGroup && defaultGroup.failed) {
        moveFile_(file, folders.source, defaultGroup.failed);
      }
      const errorMessage = err && err.message ? err.message : String(err);
      await notifyInvoiceFailure_({
        classification: 'failed',
        reason: 'Nie udało się przygotować pliku do przetwarzania.',
        fileName,
        details: [
          'Szczegóły błędu: ' + errorMessage,
          'Typ pliku: ' + (mimeType || 'nieznany'),
        ],
      });
      if (fileId && progressMap) {
        delete progressMap[fileId];
      }
      return {
        processedCount: 0,
        fileId,
        nextStart: null,
        hasRemaining: false,
      };
    }

    const totalPages = Array.isArray(blobs) ? blobs.length : 0;
    if (startPageIndex >= totalPages) {
      startPageIndex = totalPages;
      startInvoiceOffset = 0;
    }

    const pageResults = [];
    const pageBlobs = [];
    const pageIndexes = [];
    const statuses = [];
    let remainingLimit = limit;
    let pendingSkip = startInvoiceOffset;
    let retryLater = false;
    let retryPageIndex = startPageIndex;

    for (let pageIndex = startPageIndex; pageIndex < totalPages && remainingLimit > 0; pageIndex += 1) {
      const blob = blobs[pageIndex];
      const result = await processBlob_(blob, file, pageIndex, folders);
      if (result && result.retryLater) {
        retryLater = true;
        retryPageIndex = pageIndex;
        break;
      }
      statuses.push(result.status);
      pageResults.push(result);
      pageBlobs.push(blob);
      pageIndexes.push(pageIndex);

      const invoiceCount = Array.isArray(result.invoices) && result.invoices.length
        ? result.invoices.length
        : 1;
      const usableFromPage = Math.max(invoiceCount - (pageResults.length === 1 ? pendingSkip : 0), 0);
      if (usableFromPage > 0) {
        remainingLimit -= usableFromPage;
      }
      pendingSkip = 0;
    }

    if (retryLater) {
      logger.warn('Deferring file due to Gemini overload', fileName, { pageIndex: retryPageIndex + 1 });
      return {
        processedCount: 0,
        fileId,
        nextStart: { page: retryPageIndex, invoice: 0 },
        hasRemaining: true,
      };
    }

    const persistOutcome = await persistInvoiceDocuments_(pageBlobs, pageResults, folders, {
      fileName,
      fileId,
    }, {
      limitInvoices: limit,
      pageIndexes,
      startInvoiceOffset,
      totalPages,
    });
    const processedThisRun = persistOutcome && Number.isFinite(Number(persistOutcome.processedCount))
      ? Number(persistOutcome.processedCount)
      : 0;

    if (persistOutcome && persistOutcome.hasRemaining) {
      logger.info('Partial invoice processing, deferring remaining pages', fileName, {
        processedThisRun,
        nextStart: persistOutcome.nextStart,
      });
      return {
        processedCount: processedThisRun,
        fileId,
        nextStart: persistOutcome ? persistOutcome.nextStart : null,
        hasRemaining: true,
      };
    }

    if (fileId && progressMap) {
      delete progressMap[fileId];
    }

    const createdInvoiceCount = persistOutcome && typeof persistOutcome.createdCount === 'number'
      ? persistOutcome.createdCount
      : 0;
    const failedInvoiceExports = persistOutcome && typeof persistOutcome.failureCount === 'number'
      ? persistOutcome.failureCount
      : 0;
    const reviewInvoiceExports = persistOutcome && typeof persistOutcome.reviewCount === 'number'
      ? persistOutcome.reviewCount
      : 0;
    const duplicateInvoiceExports = persistOutcome && typeof persistOutcome.duplicateCount === 'number'
      ? persistOutcome.duplicateCount
      : 0;

    let finalStatus = summariseStatuses_(statuses);
    const blockingReviews = Math.max(reviewInvoiceExports - duplicateInvoiceExports, 0);
    if (blockingReviews > 0 || failedInvoiceExports > 0) {
      finalStatus = 'failed';
    }
    if (finalStatus !== 'success') {
      finalStatus = 'failed';
    }
    const aggregation = resolveAggregatedGroup_(folders, pageResults);
    const aggregatedGroup = aggregation.group || getGroupForKind_(folders, 'expense');
    const aggregatedKind = aggregation.kind;
    const destination = aggregatedGroup
      ? (finalStatus === 'success' ? aggregatedGroup.success : aggregatedGroup.failed)
      : null;

    const hasExportedInvoices = createdInvoiceCount > 0 || duplicateInvoiceExports > 0;
    const keepProcessingCopy = !hasExportedInvoices;
    const { processingFile, archived } = archiveOriginal_(
      file,
      folders.source,
      aggregatedGroup ? aggregatedGroup.originals : null,
      { keepProcessingCopy }
    );
    const shouldMoveAggregated = keepProcessingCopy || !archived;
    if (shouldMoveAggregated) {
      const routedFile = processingFile || file;
      if (aggregatedKind === 'expense') {
        renameProcessedFile_(routedFile, pageResults);
      }
      const routedName = routedFile && routedFile.getName ? routedFile.getName() : fileName;
      const destinationHasDuplicate = finalStatus === 'success' && destination
        ? folderHasFileByName_(destination, routedName)
        : false;

      if (destinationHasDuplicate) {
        discardDuplicateProcessedFile_(routedFile, folders.source);
        logger.info('Discarded duplicate processed file copy', routedName, 'status', finalStatus);
      } else if (destination) {
        moveFile_(routedFile, folders.source, destination);
        logger.info('Moved processed file copy', routedName, 'to', destination.getName ? destination.getName() : '', 'status', finalStatus);
      } else {
        logger.warn('Missing destination folder for processed file copy', routedName, 'status', finalStatus);
      }
    } else {
      logger.info('Skipping aggregated file move after exporting per-invoice PDFs', fileName, 'status', finalStatus, 'exportedInvoices', createdInvoiceCount);
    }
    if (archived) {
      const originalsFolderName = aggregatedGroup
        && aggregatedGroup.originals
        && aggregatedGroup.originals.today
        && aggregatedGroup.originals.today.getName
        ? aggregatedGroup.originals.today.getName()
        : 'Original invoices';
      logger.info('Archived original file', fileName, originalsFolderName);
    }
    return {
      processedCount: processedThisRun,
      fileId,
      nextStart: persistOutcome ? persistOutcome.nextStart : null,
      hasRemaining: false,
    };
  }

  function selectInvoiceForRenaming_(pageResults) {
    const flattened = [];
    for (let i = 0; i < pageResults.length; i += 1) {
      const { invoices } = pageResults[i];
      if (invoices && invoices.length) {
        for (let j = 0; j < invoices.length; j += 1) {
          flattened.push(invoices[j]);
        }
      }
    }

    if (!flattened.length) {
      return null;
    }

    const priorities = ['success', 'partial', 'failed'];
    for (let p = 0; p < priorities.length; p += 1) {
      const match = flattened.find((entry) => entry.classification === priorities[p]);
      if (match) {
        return match.invoice;
      }
    }

    return flattened[0].invoice;
  }

  function renameProcessedFile_(file, pageResults) {
    if (!file || !file.setName || !Helpers || !Helpers.buildOutputFilename) {
      return;
    }

    try {
      const invoiceForName = selectInvoiceForRenaming_(pageResults);
      const newName = Helpers.buildOutputFilename(invoiceForName || { issueDate: new Date() }, 0, 'pdf');
      file.setName(newName);
    } catch (err) {
      logger && logger.warn && logger.warn('Unable to rename processed file', err);
    }
  }

  function ensureUniqueName_(baseName, usedNames) {
    if (!baseName) {
      return ensureUniqueName_('invoice.pdf', usedNames);
    }

    let candidate = baseName;
    const extensionMatch = baseName.match(/(\.[^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : '';
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    let counter = 1;
    while (usedNames.has(candidate)) {
      counter += 1;
      candidate = stem + '_' + counter + extension;
    }
    usedNames.add(candidate);
    return candidate;
  }

  function normaliseSaleOutputName_(name) {
    const original = safeString_(name);
    if (!original) {
      return '';
    }
    if (/\.[^.]+$/.test(original)) {
      return original.replace(/\.[^.]+$/, '.pdf');
    }
    return original + '.pdf';
  }

  function resolveInvoiceOutputBaseName_(invoiceObj, invoiceIndex, options) {
    const invoiceKind = invoiceObj && invoiceObj.kind === 'sale' ? 'sale' : 'expense';
    const originalName = options && options.originalFileName
      ? normaliseSaleOutputName_(options.originalFileName)
      : '';

    if (invoiceKind === 'sale' && originalName) {
      return originalName;
    }

    if (Helpers && Helpers.buildOutputFilename) {
      const extension = options && options.extension ? options.extension : 'pdf';
      return Helpers.buildOutputFilename(invoiceObj, invoiceIndex || 0, extension);
    }

    if (originalName) {
      return originalName;
    }

    return 'invoice.pdf';
  }

  function selectDestinationFolder_(classification, group) {
    if (!group) {
      return null;
    }
    if (classification === 'failed') {
      return group.failed || null;
    }
    if (classification === 'success') {
      return group.success || null;
    }
    return group.failed || null;
  }

  function invoiceExistsInFolder_(invoiceObj, invoiceIndex, destinationFolder, options) {
    if (!destinationFolder || !destinationFolder.getFilesByName) {
      return false;
    }
    const desiredName = resolveInvoiceOutputBaseName_(
      invoiceObj,
      Number.isFinite(invoiceIndex) ? invoiceIndex : 0,
      options
    );
    if (!desiredName) {
      return false;
    }

    try {
      const iterator = destinationFolder.getFilesByName(desiredName);
      return iterator && typeof iterator.hasNext === 'function' && iterator.hasNext();
    } catch (err) {
      logger && logger.warn && logger.warn('Unable to inspect destination folder for duplicates', desiredName, err);
      return false;
    }
  }

  async function persistSingleInvoiceBlob_(
    pageBlob,
    invoiceObj,
    classification,
    usedNames,
    group,
    pageIndex,
    invoiceIndex,
    options
  ) {
    const namingOptions = {
      extension: 'pdf',
      ...(options || {}),
    };

    try {
      const baseName = resolveInvoiceOutputBaseName_(invoiceObj, invoiceIndex || 0, namingOptions);
      const destinationFolder = selectDestinationFolder_(classification, group);
      if (!destinationFolder || !destinationFolder.createFile) {
        logger && logger.warn && logger.warn('Missing destination folder for invoice output', classification, baseName);
        return { created: false, duplicate: false };
      }

      if (invoiceExistsInFolder_(invoiceObj, invoiceIndex || 0, destinationFolder, namingOptions)) {
        logger && logger.warn && logger.warn('Invoice already exists in destination folder', baseName, 'classification', classification);
        return { created: false, duplicate: true };
      }

      const uniqueName = ensureUniqueName_(baseName, usedNames);

      let outputBlob;
      if (Helpers && Helpers.duplicatePdfBlob) {
        outputBlob = await Helpers.duplicatePdfBlob(pageBlob, uniqueName);
      } else if (pageBlob && pageBlob.copyBlob) {
        outputBlob = pageBlob.copyBlob();
        if (outputBlob.setName) {
          outputBlob.setName(uniqueName);
        }
      } else if (Helpers.ensurePdfBlob) {
        outputBlob = await Helpers.ensurePdfBlob(pageBlob, uniqueName);
      } else {
        outputBlob = pageBlob;
        if (outputBlob && outputBlob.setName) {
          outputBlob.setName(uniqueName);
        }
      }

      if (!outputBlob) {
        logger && logger.error && logger.error('Unable to prepare blob for invoice output', uniqueName);
        await persistFailureBlob_(pageBlob, group && group.failed, pageIndex);
        return { created: false, duplicate: false };
      }

      destinationFolder.createFile(outputBlob);
      logger && logger.info && logger.info('Created invoice PDF', uniqueName, 'from page', pageIndex + 1, 'classification', classification);
      return { created: true, duplicate: false };
    } catch (err) {
      logger && logger.error && logger.error('Unable to persist invoice PDF', err);
      await persistFailureBlob_(pageBlob, group && group.failed, pageIndex);
      return { created: false, duplicate: false };
    }
  }

  function hasValue_(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function summariseInvoiceIssues_(invoice, classification) {
    const issues = [];
    if (!invoice || typeof invoice !== 'object') {
      issues.push('Brak danych faktury – sprawdź plik źródłowy.');
      return issues;
    }

    const missingIfirmaFields = Array.isArray(invoice.ifirmaMissingFields)
      ? invoice.ifirmaMissingFields
        .filter((field) => safeString_(field) && field !== 'PrepareIfirmaFailed')
      : [];
    if (missingIfirmaFields.length) {
      issues.push('Brak pól wymaganych: ' + missingIfirmaFields.join(', '));
    }
    if (Array.isArray(invoice.ifirmaMissingFields) && invoice.ifirmaMissingFields.includes('PrepareIfirmaFailed')) {
      issues.push('Nie udało się przygotować danych faktury do formatu iFirma.');
    }

    const detectedCurrencies = Array.isArray(invoice.detectedCurrencies)
      ? invoice.detectedCurrencies
        .map((value) => safeString_(value))
        .filter((value) => value)
      : [];
    const invoiceCurrency = safeString_(invoice.currency);
    if (detectedCurrencies.length > 1) {
      issues.push('Wykryto wiele walut na dokumencie: ' + detectedCurrencies.join(', '));
    } else if (detectedCurrencies.length === 1 && invoiceCurrency && detectedCurrencies[0] !== invoiceCurrency) {
      issues.push('Waluta wykryta (' + detectedCurrencies[0] + ') różni się od waluty dokumentu (' + invoiceCurrency + ').');
    }

    const validationFlags = invoice.validationFlags && typeof invoice.validationFlags === 'object'
      ? invoice.validationFlags
      : {};

    if (invoice.requiresManualReview) {
      issues.push('Faktura oznaczona do ręcznej weryfikacji (requiresManualReview).');
    }

    return issues;
  }

  function buildInvoiceFailureRecord_(options) {
    const {
      invoice,
      classification,
      created,
      pageIndex,
      invoiceIndex,
      exportOutcome,
      hubspotOutcome,
      context,
      manualReason,
      manualDetails,
    } = options || {};

    const finalClassification = classification || ((exportOutcome && exportOutcome.success) ? 'success' : 'failed');
    let outcomeClassification = finalClassification;
    if (created === false && finalClassification === 'success') {
      outcomeClassification = 'failed';
    }
    const shouldSkip = outcomeClassification === 'success'
      && created !== false
      && (!exportOutcome || exportOutcome.success)
      && !manualReason;
    if (shouldSkip) {
      return null;
    }

    const details = Array.isArray(manualDetails) ? manualDetails.slice() : [];
    const record = {
      classification: outcomeClassification,
      invoiceNumber: safeString_(invoice && invoice.invoiceNumber) || safeString_(options && options.syntheticInvoiceNumber),
      sellerName: safeString_(invoice && invoice.seller && invoice.seller.name),
      grossAmount: safeNumber_(invoice && invoice.grossAmount),
      currency: safeString_(invoice && invoice.currency) || undefined,
      fileName: context && context.fileName ? context.fileName : undefined,
      fileId: context && context.fileId ? context.fileId : undefined,
      pageNumber: Number.isFinite(pageIndex) ? pageIndex + 1 : undefined,
      invoiceIndex: Number.isFinite(invoiceIndex) ? invoiceIndex + 1 : undefined,
      details,
    };

    let reason = manualReason || null;

    if (created === false && !reason) {
      reason = 'Nie udało się zapisać wygenerowanego pliku PDF w folderze Failed.';
    }

    if (exportOutcome && !exportOutcome.success) {
      record.exportAttempted = true;
      if (typeof exportOutcome.responseCode !== 'undefined') {
        record.ifirmaCode = exportOutcome.responseCode;
      }
      if (exportOutcome.message) {
        record.ifirmaMessage = exportOutcome.message;
      }
      if (exportOutcome.userMessage) {
        record.ifirmaUserMessage = exportOutcome.userMessage;
      }
      if (exportOutcome.missingFields) {
        record.missingFields = exportOutcome.missingFields;
      }
      if (exportOutcome.httpStatus) {
        record.details.push('HTTP status iFirma: ' + exportOutcome.httpStatus);
      }
      switch (exportOutcome.reason) {
        case 'moduleUnavailable':
          reason = reason || 'Moduł integracji z iFirmą jest niedostępny.';
          break;
        case 'prepareFailed':
          reason = reason || 'Nie udało się przygotować danych faktury do wysyłki do iFirma.';
          break;
        case 'missingFields':
          reason = reason || 'iFirma odrzuciła fakturę – brakuje wymaganych pól.';
          break;
        case 'apiError':
          reason = reason || 'iFirma zwróciła błąd podczas zapisu faktury.';
          break;
        case 'exception':
          reason = reason || 'Wystąpił błąd podczas komunikacji z iFirmą.';
          if (exportOutcome.error) {
            const errorMessage = exportOutcome.error && exportOutcome.error.message
              ? exportOutcome.error.message
              : String(exportOutcome.error);
            record.details.push('Szczegóły wyjątku: ' + errorMessage);
          }
          break;
        default:
          break;
      }
    }

    if (hubspotOutcome && !hubspotOutcome.skipped) {
      record.hubspotAttempted = true;
      if (typeof hubspotOutcome.status !== 'undefined') {
        record.hubspotStatus = hubspotOutcome.status;
      }
      if (hubspotOutcome.reason) {
        record.hubspotReason = hubspotOutcome.reason;
      }
      if (hubspotOutcome.message) {
        record.hubspotMessage = hubspotOutcome.message;
      }
      if (hubspotOutcome.body) {
        record.hubspotBody = hubspotOutcome.body;
      }
      reason = reason || 'Nie udało się zsynchronizować faktury z HubSpot.';
    } else if (hubspotOutcome && hubspotOutcome.skipped) {
      record.hubspotSkipped = true;
      if (hubspotOutcome.reason) {
        record.hubspotReason = hubspotOutcome.reason;
      }
    }

    if (!reason) {
      if (outcomeClassification === 'failed') {
        reason = 'Brak wymaganych danych w odczytanej fakturze.';
      } else if (outcomeClassification === 'partial') {
        reason = 'Faktura wymaga ręcznej weryfikacji przed importem do iFirma.';
      }
    }

    const issueSummaries = summariseInvoiceIssues_(invoice, outcomeClassification);
    for (let i = 0; i < issueSummaries.length; i += 1) {
      const summary = issueSummaries[i];
      if (!reason) {
        reason = summary;
      } else {
        record.details.push(summary);
      }
    }

    if (!reason) {
      reason = 'Nieznany powód – sprawdź logi automatyzacji.';
    }

    record.reason = reason;
    if (!record.details.length) {
      delete record.details;
    }
    return record;
  }

  async function notifyInvoiceFailure_(record) {
    if (!record) {
      return;
    }
    if (!Slack || !Slack.notifyInvoiceFailure) {
      if (logger && logger.warn) {
        logger.warn('Slack invoice failure helper unavailable; pomijam powiadomienie.');
      }
      return;
    }
    try {
      await Slack.notifyInvoiceFailure(record);
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to notify Slack about failed invoice', err);
      }
    }
  }

  async function persistInvoiceDocuments_(pageBlobs, pageResults, folders, context, options) {
    const opts = options || {};
    const limitInvoices = Number.isFinite(Number(opts.limitInvoices))
      ? Math.max(Number(opts.limitInvoices), 0)
      : Infinity;
    const pageIndexes = Array.isArray(opts.pageIndexes) ? opts.pageIndexes : [];
    const totalPages = Number.isFinite(Number(opts.totalPages))
      ? Math.max(Number(opts.totalPages), 0)
      : (Array.isArray(pageResults) ? pageResults.length : 0);
    const startPage = pageIndexes.length ? Math.max(Number(pageIndexes[0]) || 0, 0) : 0;
    const startInvoiceOffset = Math.max(Number(opts.startInvoiceOffset) || 0, 0);

    const usedNames = new Set();
    const namingOptions = {
      originalFileName: context && context.fileName ? context.fileName : '',
      extension: 'pdf',
    };
    let createdCount = 0;
    let failureCount = 0;
    let reviewCount = 0;
    let duplicateCount = 0;
    let processedCount = 0;
    let hasRemaining = false;

    let pointerPage = startPage;
    let pointerInvoice = startInvoiceOffset;
    let limitHit = false;

    if (!Array.isArray(pageResults) || !pageResults.length || limitInvoices <= 0) {
      const clampedPage = Math.min(pointerPage, totalPages);
      const clampedInvoice = clampedPage >= totalPages ? 0 : Math.max(pointerInvoice, 0);
      return {
        createdCount,
        failureCount,
        reviewCount,
        duplicateCount,
        processedCount,
        hasRemaining: clampedPage < totalPages,
        nextStart: { page: clampedPage, invoice: clampedInvoice },
      };
    }

    for (let localIndex = 0; localIndex < pageResults.length; localIndex += 1) {
      const actualPageIndex = Number.isFinite(Number(pageIndexes[localIndex]))
        ? Math.max(Number(pageIndexes[localIndex]), 0)
        : pointerPage + (localIndex === 0 ? 0 : 1);
      pointerPage = actualPageIndex;
      let invoiceOffsetForPage = localIndex === 0 ? startInvoiceOffset : 0;

      const pageBlob = pageBlobs[localIndex];
      if (!pageBlob) {
        pointerPage = actualPageIndex + 1;
        pointerInvoice = 0;
        continue;
      }

      const pageResult = pageResults[localIndex] || {};
      const invoices = Array.isArray(pageResult.invoices) ? pageResult.invoices : [];

      if (!invoices.length) {
        if (invoiceOffsetForPage > 0) {
          pointerPage = actualPageIndex + 1;
          pointerInvoice = 0;
          continue;
        }
        if (processedCount >= limitInvoices) {
          hasRemaining = limitInvoices !== Infinity;
          limitHit = true;
          pointerPage = actualPageIndex;
          pointerInvoice = invoiceOffsetForPage;
          break;
        }
        const fallbackInvoice = {
          issueDate: new Date(),
          invoiceNumber: 'PAGE-' + (actualPageIndex + 1),
        };
        const fallbackGroup = getGroupForKind_(folders, 'expense');
        const persistResult = await persistSingleInvoiceBlob_(
          pageBlob,
          fallbackInvoice,
          pageResult.status || 'partial',
          usedNames,
          fallbackGroup,
          actualPageIndex,
          0,
          namingOptions
        );
        const created = !!(persistResult && persistResult.created);
        const duplicate = !!(persistResult && persistResult.duplicate);
        processedCount += 1;
        if (created) {
          createdCount += 1;
        } else {
          failureCount += 1;
        }
        if (duplicate) {
          reviewCount += 1;
        }
        const manualDetails = [
          'Status analizy strony: ' + (pageResult.status || 'unknown'),
          'Nadany numer zastępczy: ' + fallbackInvoice.invoiceNumber,
        ];
        if (duplicate) {
          manualDetails.push('Wykryto plik o tej samej nazwie w folderze docelowym.');
        }
        const record = buildInvoiceFailureRecord_({
          invoice: fallbackInvoice,
          classification: pageResult.status || 'partial',
          created,
          pageIndex: actualPageIndex,
          invoiceIndex: 0,
          context,
          manualReason: duplicate
            ? 'Wykryto duplikat faktury – dokument wymaga ręcznej weryfikacji.'
            : 'Nie udało się automatycznie rozpoznać faktury na stronie ' + (actualPageIndex + 1) + '.',
          manualDetails,
        });
        await notifyInvoiceFailure_(record);
        pointerInvoice = invoiceOffsetForPage + 1;
        if (processedCount >= limitInvoices) {
          hasRemaining = limitInvoices !== Infinity;
          limitHit = true;
          pointerPage = actualPageIndex + 1;
          pointerInvoice = 0;
          break;
        }
        pointerPage = actualPageIndex + 1;
        pointerInvoice = 0;
        continue;
      }

      const startIndex = Math.min(invoiceOffsetForPage, invoices.length);
      if (startIndex >= invoices.length) {
        pointerPage = actualPageIndex + 1;
        pointerInvoice = 0;
        continue;
      }

      for (let invoiceIndex = startIndex; invoiceIndex < invoices.length; invoiceIndex += 1) {
        if (processedCount >= limitInvoices) {
          hasRemaining = limitInvoices !== Infinity;
          limitHit = true;
          pointerPage = actualPageIndex;
          pointerInvoice = startIndex;
          break;
        }
        const entry = invoices[invoiceIndex] || {};
        const invoiceObj = entry.invoice || {};
        let classification = entry.classification || 'partial';
        let requiresReview = false;

        const isSuccessClassification = classification === 'success';
        const invoiceGroup = resolveInvoiceGroup_(folders, invoiceObj);
        const successFolder = isSuccessClassification
          ? selectDestinationFolder_('success', invoiceGroup)
          : null;
        const alreadyInSuccess = isSuccessClassification
          ? invoiceExistsInFolder_(invoiceObj, invoiceIndex || 0, successFolder, namingOptions)
          : false;

        if (isSuccessClassification && alreadyInSuccess) {
          if (logger && logger.warn) {
            const baseName = resolveInvoiceOutputBaseName_(invoiceObj, invoiceIndex || 0, namingOptions);
            logger.warn('Skipping iFirma export for duplicate invoice', baseName);
          }
        }

        if (isSuccessClassification && !alreadyInSuccess) {
          const ifirmaOutcome = await sendInvoiceToIfirma_(invoiceObj, classification);
          if (ifirmaOutcome) {
            classification = ifirmaOutcome.classification || classification;
            if (!ifirmaOutcome.success) {
              requiresReview = true;
            }
            entry.ifirmaOutcome = ifirmaOutcome;
          }

          if (classification === 'success' && invoiceObj && invoiceObj.kind === 'sale') {
            const hubspotOutcome = await sendInvoiceToHubspot_(invoiceObj);
            entry.hubspotOutcome = hubspotOutcome;
            if (hubspotOutcome) {
              if (hubspotOutcome.success === false && !hubspotOutcome.skipped) {
                classification = hubspotOutcome.classification || 'partial';
                requiresReview = true;
              } else if (hubspotOutcome.classification && hubspotOutcome.classification !== classification) {
                classification = hubspotOutcome.classification;
              }
            }
          }
        }

        entry.classification = classification;

        let persistResult = { created: false, duplicate: false };
        if (!alreadyInSuccess) {
          persistResult = await persistSingleInvoiceBlob_(
            pageBlob,
            invoiceObj,
            classification,
            usedNames,
            invoiceGroup,
            actualPageIndex,
            invoiceIndex,
            namingOptions
          );
        }
        const created = !!(persistResult && persistResult.created);
        const duplicate = alreadyInSuccess || !!(persistResult && persistResult.duplicate);
        processedCount += 1;
        if (created) {
          createdCount += 1;
          if (classification === 'success') {
            recordInvoiceInSpreadsheet_(invoiceObj, invoiceGroup, context);
          }
        } else if (!duplicate) {
          failureCount += 1;
        }
        if (duplicate) {
          duplicateCount += 1;
        }
        if (requiresReview && !duplicate) {
          reviewCount += 1;
        }

        const manualDetails = duplicate
          ? ['Plik o tej samej nazwie znajduje się już w folderze docelowym – sprawdź, czy faktura nie została wcześniej przetworzona.']
          : undefined;
        const record = buildInvoiceFailureRecord_({
          invoice: invoiceObj,
          classification,
          created,
          pageIndex: actualPageIndex,
          invoiceIndex,
          exportOutcome: entry.ifirmaOutcome,
          hubspotOutcome: entry.hubspotOutcome,
          context,
          manualReason: duplicate
            ? 'Wykryto duplikat faktury – dokument wymaga ręcznej weryfikacji.'
            : undefined,
          manualDetails,
        });
        await notifyInvoiceFailure_(record);

        pointerInvoice = invoiceIndex + 1;
        if (processedCount >= limitInvoices) {
          hasRemaining = limitInvoices !== Infinity;
          limitHit = true;
          if (pointerInvoice >= invoices.length) {
            pointerPage = actualPageIndex + 1;
            pointerInvoice = 0;
          } else {
            pointerPage = actualPageIndex;
          }
          break;
        }
      }

      if (processedCount >= limitInvoices) {
        limitHit = true;
        break;
      }

      pointerPage = actualPageIndex + 1;
      pointerInvoice = 0;
    }

    const clampedPage = Math.min(pointerPage, totalPages);
    let clampedInvoice = clampedPage >= totalPages ? 0 : Math.max(pointerInvoice, 0);
    if (clampedPage >= totalPages) {
      clampedInvoice = 0;
    }
    const completed = clampedPage >= totalPages && clampedInvoice === 0;
    if (completed) {
      hasRemaining = false;
    } else if (hasRemaining || limitHit || clampedPage < totalPages) {
      hasRemaining = true;
    }

    return {
      createdCount,
      failureCount,
      reviewCount,
      duplicateCount,
      processedCount,
      hasRemaining,
      nextStart: { page: clampedPage, invoice: clampedInvoice },
    };
  }

  const GEMINI_BACKOFF_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];

  function isGeminiOverloadedError_(err) {
    if (!err) {
      return false;
    }

    const code = err && typeof err.code !== 'undefined' ? err.code : undefined;
    if (code === 503) {
      return true;
    }

    const status = err && typeof err.status !== 'undefined' ? err.status : undefined;
    if (status === 503 || status === 'UNAVAILABLE') {
      return true;
    }

    const message = err && err.message ? err.message : String(err || '');
    if (!message) {
      return false;
    }

    const lower = message.toLowerCase();
    return lower.includes('model is overloaded') || (lower.includes('try again later') && lower.includes('gemini error'));
  }

  function sleep_(ms) {
    if (ms <= 0) {
      return Promise.resolve();
    }

    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.sleep === 'function') {
      Utilities.sleep(ms);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (typeof setTimeout === 'function') {
        setTimeout(resolve, ms);
      } else {
        resolve();
      }
    });
  }

  async function processBlob_(blob, originalFile, pageIndex, folders) {
    const pageStatuses = [];
    const invoicesForPage = [];
    let retryDueToOverload = false;
    try {
      let invoices = [];
      let lastError;
      for (let attempt = 0; attempt <= GEMINI_BACKOFF_DELAYS_MS.length; attempt += 1) {
        try {
          invoices = await Gemini.extractInvoicesFromBlob(blob) || [];
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (isGeminiOverloadedError_(err)) {
            if (attempt >= GEMINI_BACKOFF_DELAYS_MS.length) {
              retryDueToOverload = true;
              break;
            }
            const delay = GEMINI_BACKOFF_DELAYS_MS[attempt];
            logger.warn('Gemini overloaded for page', pageIndex + 1, 'retrying in', Math.round(delay / 1000), 'seconds');
            await sleep_(delay);
            continue;
          }
          throw err;
        }
      }

      if (retryDueToOverload) {
        logger.error('Gemini extraction overloaded after retries for page', pageIndex + 1, lastError);
        return { status: 'failed', invoices: invoicesForPage, retryLater: true };
      }

      if (!invoices.length) {
        logger.warn('No invoices detected for page', pageIndex + 1, 'of', originalFile.getName ? originalFile.getName() : '');
        return { status: 'partial', invoices: invoicesForPage };
      }

      for (let i = 0; i < invoices.length; i += 1) {
        const invoiceObj = invoices[i];
        invoiceObj.kind = determineInvoiceKind_(invoiceObj);
        fillMissingTaxAmounts_(invoiceObj);
        fillVatAmount_(invoiceObj);
        const prepared = prepareIfirmaRequest_(invoiceObj);
        if (prepared) {
          invoiceObj.ifirmaPrepared = prepared;
          invoiceObj.ifirmaMissingFields = Array.isArray(prepared.missingFields)
            ? prepared.missingFields.slice()
            : [];
        } else {
          invoiceObj.ifirmaPrepared = null;
          invoiceObj.ifirmaMissingFields = ['PrepareIfirmaFailed'];
        }
        const classification = Helpers.classifyInvoice(invoiceObj, {
          missingIfirmaFields: invoiceObj.ifirmaMissingFields,
        });
        pageStatuses.push(classification);
        invoicesForPage.push({ invoice: invoiceObj, classification });
      }
    } catch (err) {
      logger.error('Gemini extraction failed for page', pageIndex + 1, err);
      return { status: 'failed', invoices: invoicesForPage };
    }

    return { status: summariseStatuses_(pageStatuses), invoices: invoicesForPage };
  }

  const IFIRMA_LIST_RETRY_DELAYS_MS = [500, 1500, 3000];

  function formatDateYmd_(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normaliseFieldName_(name) {
    return safeString_(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function pickAmount_(entry, candidates) {
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(entry, candidate)) {
        const value = safeNumber_(entry[candidate]);
        if (Number.isFinite(value)) {
          return value;
        }
      }
      const normalisedCandidate = normaliseFieldName_(candidate);
      const keys = Object.keys(entry);
      for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        if (normaliseFieldName_(key) === normalisedCandidate) {
          const value = safeNumber_(entry[key]);
          if (Number.isFinite(value)) {
            return value;
          }
        }
      }
    }
    return undefined;
  }

  function findInvoiceArray_(node, depth = 0) {
    if (node == null || depth > 6) {
      return null;
    }
    if (Array.isArray(node)) {
      if (!node.length) {
        return node;
      }
      const hasInvoiceShape = node.some((item) => item && typeof item === 'object'
        && (Object.prototype.hasOwnProperty.call(item, 'PelnyNumer')
          || Object.prototype.hasOwnProperty.call(item, 'pelnyNumer')
          || Object.prototype.hasOwnProperty.call(item, 'NumerPelny')
          || Object.prototype.hasOwnProperty.call(item, 'numerPelny')
          || Object.prototype.hasOwnProperty.call(item, 'PelnyNumerFaktury')));
      if (hasInvoiceShape) {
        return node;
      }
    }
    if (typeof node === 'object') {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i += 1) {
        const found = findInvoiceArray_(node[keys[i]], depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  function formatAmount_(value) {
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return value.toFixed(2);
  }

  async function fetchInvoicePageWithRetry_(params) {
    if (!IFirma || typeof IFirma.listSalesInvoices !== 'function') {
      return null;
    }
    const attempts = IFIRMA_LIST_RETRY_DELAYS_MS.length + 1;
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await IFirma.listSalesInvoices(params);
        if (response && response.ok) {
          return response;
        }
        const status = response ? response.status : undefined;
        const shouldRetry = (status === 401 || status === 403 || status === 429)
          && attempt < attempts - 1;
        if (shouldRetry) {
          const delay = IFIRMA_LIST_RETRY_DELAYS_MS[Math.min(attempt, IFIRMA_LIST_RETRY_DELAYS_MS.length - 1)];
          logger.warn('iFirma invoices list temporary error', status, 'retrying in', delay, 'ms');
          await sleep_(delay);
          continue;
        }
        if (status === 401 || status === 403) {
          logger.error('iFirma authentication failed while listing outstanding sales invoices', status);
        } else if (status === 429) {
          logger.warn('iFirma rate limit while listing outstanding sales invoices', status);
        } else {
          logger.error('Unexpected iFirma response while listing outstanding sales invoices', status, response && response.body);
        }
        return null;
      } catch (err) {
        lastError = err;
        if (attempt >= attempts - 1) {
          logger.error('Failed to fetch outstanding sales invoices from iFirma', err);
          return null;
        }
        const delay = IFIRMA_LIST_RETRY_DELAYS_MS[Math.min(attempt, IFIRMA_LIST_RETRY_DELAYS_MS.length - 1)];
        logger.warn('iFirma list request failed', err && err.message ? err.message : err);
        await sleep_(delay);
      }
    }
    return null;
  }

  async function listUnpaidInvoicesStage_() {
    if (!IFirma || typeof IFirma.listSalesInvoices !== 'function') {
      return;
    }
    const now = new Date();
    const dateTo = formatDateYmd_(now);
    const from = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const dateFrom = formatDateYmd_(from);
    const pageSize = 50;
    const maxPages = 200;
    const outstandingStatuses = ['nieoplacone', 'oplaconeCzesciowo', 'przeterminowane'];
    for (let s = 0; s < outstandingStatuses.length; s += 1) {
      const status = outstandingStatuses[s];
      for (let page = 1; page <= maxPages; page += 1) {
        const params = {
          dataOd: dateFrom,
          dataDo: dateTo,
          status,
          strona: page,
          iloscNaStronie: pageSize,
        };
        const response = await fetchInvoicePageWithRetry_(params);
        if (!response) {
          break;
        }
        const invoiceArray = findInvoiceArray_(response.json);
        if (!invoiceArray || !invoiceArray.length) {
          break;
        }
        for (let i = 0; i < invoiceArray.length; i += 1) {
          const invoice = invoiceArray[i] || {};
          const number = safeString_(invoice.PelnyNumer
            || invoice.pelnyNumer
            || invoice.NumerPelny
            || invoice.numerPelny
            || invoice.PelnyNumerFaktury
            || invoice.Numer
            || invoice.numer) || 'Brak numeru';
          const remainingField = pickAmount_(invoice, [
            'Pozostalo',
            'Pozostało',
            'PozostaloDoZaplaty',
            'PozostałoDoZapłaty',
            'KwotaPozostala',
            'KwotaPozostała',
          ]);
          const gross = pickAmount_(invoice, [
            'Brutto',
            'KwotaBrutto',
            'BruttoRazem',
            'SumaBrutto',
          ]) || 0;
          const paid = pickAmount_(invoice, [
            'Zaplacono',
            'ZaplaconoBrutto',
            'KwotaZaplacona',
            'KwotaZaplaconaBrutto',
          ]) || 0;
          const remaining = Number.isFinite(remainingField)
            ? remainingField
            : Math.max(0, (gross || 0) - (paid || 0));
          logger.info(`Faktura: ${number} | Pozostało: ${formatAmount_(Math.max(remaining, 0))} PLN`);
        }
        if (invoiceArray.length < pageSize) {
          break;
        }
      }
    }
  }

  const BANK_MATCH_DAY_MS = 24 * 60 * 60 * 1000;

  function decodeXmlEntities_(value) {
    if (!value && value !== 0) {
      return '';
    }
    return String(value)
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
  }

  function normaliseMatchingText_(value) {
    const input = safeString_(value);
    if (!input) {
      return '';
    }
    let normalized = input.replace(/[\r\n\t]+/g, ' ');
    try {
      normalized = normalized.normalize('NFD');
    } catch (err) {
      // ignore when normalize is unavailable
    }
    normalized = normalized.replace(/[\u0300-\u036f]/g, '');
    normalized = normalized.toUpperCase();
    normalized = normalized.replace(/[.,\/\-_\|\u2013\u2014]/g, ' ');
    normalized = normalized.replace(/[^A-Z0-9 ]+/g, ' ');
    normalized = normalized.replace(/\bSPOLKA\s+Z\s+OGRANICZONA\s+ODPOWIEDZIALNOSCIA\b/g, ' SPZOO ');
    normalized = normalized.replace(/\bSPOLKA\s+Z\s+O\s+O\b/g, ' SPZOO ');
    normalized = normalized.replace(/\bSPOLKA\s+ZO\s+O\b/g, ' SPZOO ');
    normalized = normalized.replace(/\bSP\s*Z\s*O\s*O\b/g, ' SPZOO ');
    normalized = normalized.replace(/\bSP\s*ZOO\b/g, ' SPZOO ');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
  }

  function buildInvoiceNumberPatterns_(number) {
    const patterns = new Set();
    const base = safeString_(number);
    const baseNormalised = normaliseMatchingText_(base);
    if (baseNormalised) {
      patterns.add(baseNormalised);
    }
    if (!baseNormalised) {
      return [];
    }
    const tokens = baseNormalised.split(' ').filter((token) => !!token);
    if (tokens.length) {
      patterns.add(tokens.join(' '));
      patterns.add(tokens.join('-'));
      patterns.add(tokens.join('/'));
      const concatenated = tokens.join('');
      if (concatenated) {
        patterns.add(concatenated);
        const digitsOnly = concatenated.replace(/\D+/g, '');
        if (digitsOnly) {
          patterns.add(digitsOnly);
        }
      }
      const joinedForPrefix = tokens.join(' ');
      if (joinedForPrefix) {
        patterns.add(normaliseMatchingText_('FV ' + joinedForPrefix));
        patterns.add(normaliseMatchingText_('FAKTURA ' + joinedForPrefix));
      }
    }
    return Array.from(patterns).filter((value, index, array) => value && array.indexOf(value) === index);
  }

  function buildOrderNumberPatterns_(orderNumber) {
    const patterns = new Set();
    const base = normaliseMatchingText_(orderNumber);
    if (!base) {
      return [];
    }
    patterns.add(base);
    const tokens = base.split(' ').filter((token) => !!token);
    if (tokens.length) {
      patterns.add(tokens.join('-'));
      patterns.add(tokens.join('/'));
      const concatenated = tokens.join('');
      if (concatenated) {
        patterns.add(concatenated);
        const digitsOnly = concatenated.replace(/\D+/g, '');
        if (digitsOnly) {
          patterns.add(digitsOnly);
        }
      }
      const joined = tokens.join(' ');
      patterns.add(normaliseMatchingText_('ZAMOWIENIE ' + joined));
      patterns.add(normaliseMatchingText_('NR ZAMOWIENIA ' + joined));
      patterns.add(normaliseMatchingText_('ZAMOWIENIE NR ' + joined));
    }
    return Array.from(patterns).filter((value, index, array) => value && array.indexOf(value) === index);
  }

  function extractStringField_(entry, candidates) {
    if (!entry || typeof entry !== 'object' || !candidates) {
      return '';
    }
    const keys = Object.keys(entry);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(entry, candidate)) {
        const value = safeString_(entry[candidate]);
        if (value) {
          return value;
        }
      }
      const normalisedCandidate = normaliseFieldName_(candidate);
      for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        if (normaliseFieldName_(key) === normalisedCandidate) {
          const value = safeString_(entry[key]);
          if (value) {
            return value;
          }
        }
      }
    }
    return '';
  }

  function computeInvoiceWindow_(invoice) {
    const issue = invoice && invoice.issueDateObj instanceof Date && !Number.isNaN(invoice.issueDateObj.getTime())
      ? new Date(invoice.issueDateObj.getTime())
      : null;
    const due = invoice && invoice.dueDateObj instanceof Date && !Number.isNaN(invoice.dueDateObj.getTime())
      ? new Date(invoice.dueDateObj.getTime())
      : null;
    let start = issue ? new Date(issue.getTime()) : (due ? new Date(due.getTime()) : null);
    let end = due ? new Date(due.getTime()) : (issue ? new Date(issue.getTime()) : null);
    if (start && end && end.getTime() >= start.getTime()) {
      end = new Date(end.getTime() + (30 * BANK_MATCH_DAY_MS));
    } else {
      const reference = start || end || new Date();
      start = new Date(reference.getTime() - (5 * BANK_MATCH_DAY_MS));
      end = new Date(reference.getTime() + (30 * BANK_MATCH_DAY_MS));
    }
    return { start, end };
  }

  function prepareInvoiceForMatching_(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const id = extractStringField_(entry, ['FakturaId', 'FakturaID', 'Identyfikator', 'InvoiceId', 'Id']);
    const number = extractStringField_(entry, ['PelnyNumer', 'pelnyNumer', 'NumerPelny', 'numerPelny', 'PelnyNumerFaktury', 'Numer', 'numer']);
    const gross = pickAmount_(entry, ['Brutto', 'KwotaBrutto', 'BruttoRazem', 'SumaBrutto']) || 0;
    const paid = pickAmount_(entry, ['Zaplacono', 'ZaplaconoBrutto', 'KwotaZaplacona', 'KwotaZaplaconaBrutto']) || 0;
    let remaining = pickAmount_(entry, ['Pozostalo', 'Pozostało', 'PozostaloDoZaplaty', 'PozostałoDoZapłaty', 'KwotaPozostala', 'KwotaPozostała']);
    if (!Number.isFinite(remaining)) {
      remaining = Math.max(0, (gross || 0) - (paid || 0));
    }
    const doZaplaty = roundAmount_(Number.isFinite(remaining) ? remaining : 0);
    if (doZaplaty <= 0.01) {
      return null;
    }
    const buyerName = extractStringField_(entry, ['NazwaKontrahenta', 'Kontrahent', 'NazwaKlienta', 'Nabywca', 'Klient']);
    const dueDate = extractStringField_(entry, ['TerminPlatnosci', 'TerminPlatności', 'TerminZaplaty', 'TerminZapłaty']);
    const issueDate = extractStringField_(entry, ['DataWystawienia', 'DataWyst', 'Data', 'DataWystawieniaFaktury']);
    const saleDate = extractStringField_(entry, ['DataSprzedazy', 'DataSprzedaży', 'DataSprzed']);
    const orderNumber = extractStringField_(entry, ['NumerZamowienia', 'NrZamowienia', 'Zamowienie', 'ZamowienieNr']);

    const invoice = {
      id: id || null,
      number,
      buyerName,
      dueDate,
      issueDate,
      saleDate,
      gross: roundAmount_(gross || 0),
      paid: roundAmount_(paid || 0),
      doZaplaty,
      orderNumber,
    };

    invoice.normalizedBuyer = normaliseMatchingText_(buyerName);
    invoice.dueDateObj = parseDateInput_(dueDate);
    invoice.issueDateObj = parseDateInput_(issueDate) || parseDateInput_(saleDate);
    if (!invoice.issueDateObj && invoice.dueDateObj instanceof Date) {
      invoice.issueDateObj = new Date(invoice.dueDateObj.getTime());
    }
    invoice.numberPatterns = buildInvoiceNumberPatterns_(number);
    invoice.orderPatterns = buildOrderNumberPatterns_(orderNumber);
    invoice.window = computeInvoiceWindow_(invoice);

    return invoice;
  }

  async function fetchOutstandingInvoicesForMatching_() {
    const invoices = [];
    const now = new Date();
    const dateTo = formatDateYmd_(now);
    const from = new Date(now.getTime() - (30 * BANK_MATCH_DAY_MS));
    const dateFrom = formatDateYmd_(from);
    const pageSize = 50;
    const maxPages = 200;
    const statuses = ['nieoplacone', 'oplaconeCzesciowo', 'przeterminowane'];
    for (let s = 0; s < statuses.length; s += 1) {
      const status = statuses[s];
      for (let page = 1; page <= maxPages; page += 1) {
        const params = {
          dataOd: dateFrom,
          dataDo: dateTo,
          status,
          strona: page,
          iloscNaStronie: pageSize,
        };
        const response = await fetchInvoicePageWithRetry_(params);
        if (!response || !response.ok) {
          break;
        }
        const invoiceArray = findInvoiceArray_(response.json);
        if (!Array.isArray(invoiceArray) || !invoiceArray.length) {
          break;
        }
        for (let i = 0; i < invoiceArray.length; i += 1) {
          const prepared = prepareInvoiceForMatching_(invoiceArray[i]);
          if (prepared) {
            invoices.push(prepared);
          }
        }
        if (invoiceArray.length < pageSize) {
          break;
        }
      }
    }
    return invoices;
  }

  function createLineIndex_(content) {
    const indices = [];
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === '\n') {
        indices.push(i);
      }
    }
    return indices;
  }

  function getLineNumberForIndex_(indices, index) {
    if (!indices || !indices.length) {
      return 1;
    }
    let left = 0;
    let right = indices.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (indices[mid] < index) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left + 1;
  }

  function parseBankStatementEntries_(xmlText) {
    const content = safeString_(xmlText);
    if (!content) {
      return [];
    }
    const newlineIndices = createLineIndex_(content);
    const entries = [];
    const regex = /<Ntry\b[\s\S]*?<\/Ntry>/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const entryText = match[0];
      if (!/<CdtDbtInd>\s*CRDT\s*<\/CdtDbtInd>/i.test(entryText)) {
        continue;
      }
      const startIndex = match.index;
      const endIndex = regex.lastIndex - 1;
      const lineFrom = getLineNumberForIndex_(newlineIndices, startIndex);
      const lineTo = getLineNumberForIndex_(newlineIndices, endIndex);
      const amountMatch = entryText.match(/<Amt[^>]*>([\s\S]*?)<\/Amt>/i);
      const amount = amountMatch ? safeNumber_(decodeXmlEntities_(amountMatch[1])) : undefined;
      const bookMatch = entryText.match(/<BookgDt[^>]*>([\s\S]*?)<\/BookgDt>/i);
      let dateValue = '';
      if (bookMatch) {
        const inner = bookMatch[1];
        const dtTmMatch = inner.match(/<DtTm[^>]*>([\s\S]*?)<\/DtTm>/i);
        const dtMatch = inner.match(/<Dt[^>]*>([\s\S]*?)<\/Dt>/i);
        if (dtTmMatch) {
          dateValue = decodeXmlEntities_(dtTmMatch[1]);
        } else if (dtMatch) {
          dateValue = decodeXmlEntities_(dtMatch[1]);
        }
      }
      if (!dateValue) {
        const valMatch = entryText.match(/<ValDt[^>]*>([\s\S]*?)<\/ValDt>/i);
        if (valMatch) {
          const dtTmMatch = valMatch[1].match(/<DtTm[^>]*>([\s\S]*?)<\/DtTm>/i);
          const dtMatch = valMatch[1].match(/<Dt[^>]*>([\s\S]*?)<\/Dt>/i);
          if (dtTmMatch) {
            dateValue = decodeXmlEntities_(dtTmMatch[1]);
          } else if (dtMatch) {
            dateValue = decodeXmlEntities_(dtMatch[1]);
          }
        }
      }
      const transactionDate = parseDateInput_(dateValue);
      const remittanceMatch = entryText.match(/<RmtInf[^>]*>([\s\S]*?)<\/RmtInf>/i);
      let title = '';
      if (remittanceMatch) {
        const ustrdRegex = /<Ustrd[^>]*>([\s\S]*?)<\/Ustrd>/gi;
        let ustrd;
        const parts = [];
        while ((ustrd = ustrdRegex.exec(remittanceMatch[1])) !== null) {
          parts.push(decodeXmlEntities_(ustrd[1]));
        }
        title = parts.join(' ').trim();
      }
      const relatedMatch = entryText.match(/<RltdPties[^>]*>([\s\S]*?)<\/RltdPties>/i);
      let sender = '';
      if (relatedMatch) {
        const dbtrMatch = relatedMatch[1].match(/<Dbtr[^>]*>([\s\S]*?)<\/Dbtr>/i);
        if (dbtrMatch) {
          const nameMatch = dbtrMatch[1].match(/<Nm[^>]*>([\s\S]*?)<\/Nm>/i);
          if (nameMatch) {
            sender = decodeXmlEntities_(nameMatch[1]).trim();
          }
        }
      }
      const refsMatch = entryText.match(/<Refs[^>]*>([\s\S]*?)<\/Refs>/i);
      let endToEndId = '';
      if (refsMatch) {
        const idMatch = refsMatch[1].match(/<EndToEndId[^>]*>([\s\S]*?)<\/EndToEndId>/i);
        if (idMatch) {
          endToEndId = decodeXmlEntities_(idMatch[1]).trim();
        }
      }
      entries.push({
        amount: Number.isFinite(amount) ? roundAmount_(amount) : undefined,
        date: transactionDate instanceof Date && !Number.isNaN(transactionDate.getTime()) ? transactionDate : null,
        title: safeString_(title),
        sender: safeString_(sender),
        endToEndId: safeString_(endToEndId),
        lineFrom,
        lineTo,
        normalizedTitle: normaliseMatchingText_(title),
        normalizedSender: normaliseMatchingText_(sender),
      });
    }
    return entries;
  }

  function computeXmlHash_(text) {
    const content = safeString_(text);
    if (!content) {
      return '';
    }
    const utilities = (typeof Utilities !== 'undefined' && Utilities)
      || (typeof globalThis !== 'undefined' && globalThis.Utilities)
      || null;
    if (utilities && typeof utilities.computeDigest === 'function' && typeof utilities.base64Encode === 'function'
      && utilities.DigestAlgorithm && utilities.DigestAlgorithm.SHA_256) {
      try {
        const digest = utilities.computeDigest(utilities.DigestAlgorithm.SHA_256, content);
        if (digest) {
          return utilities.base64Encode(digest);
        }
      } catch (err) {
        // ignore and fall back
      }
    }
    if (typeof require === 'function') {
      try {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      } catch (err) {
        // ignore and fall back
      }
    }
    let hash = 0;
    for (let i = 0; i < content.length; i += 1) {
      hash = (hash * 31 + content.charCodeAt(i)) | 0;
    }
    return hash.toString(16);
  }

  function loadBankMatchCache_(scriptProperties) {
    if (!scriptProperties || typeof scriptProperties.getProperty !== 'function') {
      return null;
    }
    try {
      const raw = scriptProperties.getProperty(BANK_STATEMENT_CACHE_PROPERTY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const matches = parsed.matches && typeof parsed.matches === 'object' ? parsed.matches : {};
      return { hash: safeString_(parsed.hash), matches };
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to parse bank statement match cache', err);
      }
      return null;
    }
  }

  function saveBankMatchCache_(scriptProperties, cache) {
    if (!scriptProperties || typeof scriptProperties.setProperty !== 'function') {
      return;
    }
    try {
      scriptProperties.setProperty(BANK_STATEMENT_CACHE_PROPERTY, JSON.stringify(cache || {}));
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to persist bank statement match cache', err);
      }
    }
  }

  function jaroSimilarity_(a, b) {
    const s1 = safeString_(a);
    const s2 = safeString_(b);
    if (!s1 && !s2) {
      return 1;
    }
    if (!s1 || !s2) {
      return 0;
    }
    const len1 = s1.length;
    const len2 = s2.length;
    const matchDistance = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    let matches = 0;
    for (let i = 0; i < len1; i += 1) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance, len2 - 1);
      for (let j = start; j <= end; j += 1) {
        if (s2Matches[j]) {
          continue;
        }
        if (s1[i] !== s2[j]) {
          continue;
        }
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches += 1;
        break;
      }
    }
    if (!matches) {
      return 0;
    }
    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < len1; i += 1) {
      if (!s1Matches[i]) {
        continue;
      }
      while (!s2Matches[k]) {
        k += 1;
      }
      if (s1[i] !== s2[k]) {
        transpositions += 1;
      }
      k += 1;
    }
    transpositions /= 2;
    return ((matches / len1) + (matches / len2) + ((matches - transpositions) / matches)) / 3;
  }

  function jaroWinklerSimilarity_(a, b) {
    const s1 = safeString_(a);
    const s2 = safeString_(b);
    if (!s1 || !s2) {
      return 0;
    }
    const jaro = jaroSimilarity_(s1, s2);
    const prefixLength = Math.min(4, Math.min(s1.length, s2.length));
    let prefix = 0;
    for (let i = 0; i < prefixLength; i += 1) {
      if (s1[i] === s2[i]) {
        prefix += 1;
      } else {
        break;
      }
    }
    return jaro + (prefix * 0.1 * (1 - jaro));
  }

  function amountsEqualByCent_(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    return Math.abs(roundAmount_(a) - roundAmount_(b)) < 0.0001;
  }

  function findBestTransactionMatch_(invoice, transactions) {
    if (!invoice || !Array.isArray(transactions)) {
      return null;
    }
    const matches = [];
    const startTime = invoice.window && invoice.window.start instanceof Date && !Number.isNaN(invoice.window.start.getTime())
      ? invoice.window.start.getTime()
      : null;
    const endTime = invoice.window && invoice.window.end instanceof Date && !Number.isNaN(invoice.window.end.getTime())
      ? invoice.window.end.getTime()
      : null;
    const dueTime = invoice.dueDateObj instanceof Date && !Number.isNaN(invoice.dueDateObj.getTime())
      ? invoice.dueDateObj.getTime()
      : null;

    for (let index = 0; index < transactions.length; index += 1) {
      const tx = transactions[index];
      if (!tx || tx.used) {
        continue;
      }
      const txTime = tx.date instanceof Date && !Number.isNaN(tx.date.getTime()) ? tx.date.getTime() : null;
      if (txTime !== null && startTime !== null && txTime < startTime) {
        continue;
      }
      if (txTime !== null && endTime !== null && txTime > endTime) {
        continue;
      }
      const hasInvoicePattern = invoice.numberPatterns.some((pattern) => pattern && tx.normalizedTitle.includes(pattern));
      const hasOrderPattern = invoice.orderPatterns.some((pattern) => pattern && tx.normalizedTitle.includes(pattern));
      const amountMatches = amountsEqualByCent_(tx.amount, invoice.doZaplaty);
      const similarity = jaroWinklerSimilarity_(invoice.normalizedBuyer, tx.normalizedSender);
      const dueDelta = (dueTime !== null && txTime !== null) ? Math.abs(txTime - dueTime) : Number.POSITIVE_INFINITY;

      let priority = 0;
      if (hasInvoicePattern || hasOrderPattern) {
        priority = 3;
      } else if (amountMatches && similarity >= 0.8) {
        priority = 2;
      } else if (amountMatches && similarity >= 0.7 && similarity < 0.8 && dueDelta <= (3 * BANK_MATCH_DAY_MS)) {
        priority = 1;
      }

      if (priority > 0) {
        matches.push({
          transaction: tx,
          index,
          hasInvoicePattern,
          hasOrderPattern,
          similarity,
          dueDelta,
          priority,
        });
      }
    }

    if (!matches.length) {
      return null;
    }

    matches.sort((a, b) => {
      const aHasNumber = a.hasInvoicePattern || a.hasOrderPattern;
      const bHasNumber = b.hasInvoicePattern || b.hasOrderPattern;
      if (aHasNumber !== bHasNumber) {
        return aHasNumber ? -1 : 1;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      if (Number.isFinite(b.similarity) && Number.isFinite(a.similarity) && b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      const aDue = Number.isFinite(a.dueDelta) ? a.dueDelta : Number.POSITIVE_INFINITY;
      const bDue = Number.isFinite(b.dueDelta) ? b.dueDelta : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) {
        return aDue - bDue;
      }
      return a.index - b.index;
    });

    return matches[0];
  }

  function findTransactionByLines_(transactions, lineFrom, lineTo) {
    if (!Array.isArray(transactions)) {
      return null;
    }
    for (let i = 0; i < transactions.length; i += 1) {
      const tx = transactions[i];
      if (!tx) {
        continue;
      }
      if (tx.lineFrom === lineFrom && tx.lineTo === lineTo) {
        return tx;
      }
    }
    return null;
  }

  async function sendIfirmaPayment_(invoiceNumber, transaction) {
    const fullNumber = safeString_(invoiceNumber);
    if (!fullNumber || fullNumber === 'Brak numeru') {
      return;
    }
    if (!transaction || !Number.isFinite(transaction.amount) || !(transaction.date instanceof Date)) {
      return;
    }
    const normalizedNumber = fullNumber.replace(/\//g, '_');
    const amountValue = roundAmount_(transaction.amount);
    const dateValue = formatDateYmd_(transaction.date);
    let result = 'ERR';
    try {
      const response = await IFirma.postSalesInvoice(
        `faktury/wplaty/${IFIRMA_PAYMENT_INVOICE_TYPE}/${normalizedNumber}.json`,
        {
          Kwota: amountValue,
          Data: dateValue,
        },
      );
      const code = response && response.json
        ? (response.json.response && typeof response.json.response.Kod === 'number'
          ? response.json.response.Kod
          : response.json.Kod)
        : null;
      if (code === 0) {
        result = 'OK';
      }
    } catch (err) {
      result = 'ERR';
    }
    const amountLabel = Number.isFinite(amountValue) ? amountValue.toFixed(2) : safeString_(amountValue);
    console.log(`${fullNumber} | ${amountLabel} | ${dateValue} | wynik=${result}`);
  }

  async function processBankStatementFile_(file, folders, scriptPropertiesOverride) {
    if (!file) {
      return;
    }
    const hasInfoLogger = logger && typeof logger.info === 'function';
    const hasWarnLogger = logger && typeof logger.warn === 'function';
    const fileName = file.getName ? file.getName() : 'Wyciąg bankowy';
    if (hasInfoLogger) {
      logger.info('ℹ️ Processing file', fileName);
    }
    let xmlContent = '';
    try {
      const blob = file.getBlob ? file.getBlob() : null;
      if (!blob) {
        throw new Error('Unable to read XML blob');
      }
      if (typeof blob.getDataAsString === 'function') {
        xmlContent = blob.getDataAsString('UTF-8');
      } else if (typeof blob.getBytes === 'function') {
        const bytes = blob.getBytes();
        if (bytes) {
          if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
            xmlContent = Utilities.newBlob(bytes).getDataAsString('UTF-8');
          } else if (typeof TextDecoder !== 'undefined') {
            const decoder = new TextDecoder('utf-8');
            const uint8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
            xmlContent = decoder.decode(uint8);
          } else if (typeof Buffer !== 'undefined') {
            xmlContent = Buffer.from(bytes).toString('utf8');
          } else {
            throw new Error('Unable to decode XML bytes');
          }
        }
      } else {
        throw new Error('Unsupported blob interface for XML');
      }
    } catch (err) {
      if (logger && logger.error) {
        logger.error('Unable to read bank statement XML', err);
      }
      return;
    }

    const transactions = parseBankStatementEntries_(xmlContent);
    if (!transactions.length && hasWarnLogger) {
      logger.warn('Bank statement XML did not contain credit entries');
    }

    const invoices = await fetchOutstandingInvoicesForMatching_();
    const scriptProperties = scriptPropertiesOverride
      || (propertiesService && propertiesService.getScriptProperties
        ? propertiesService.getScriptProperties()
        : null);
    const cache = loadBankMatchCache_(scriptProperties);
    const xmlHash = computeXmlHash_(xmlContent);
    const sameHash = cache && cache.hash === xmlHash;
    const cachedMatches = sameHash && cache && cache.matches ? cache.matches : {};
    const recordedMatches = sameHash && cache && cache.matches ? Object.assign({}, cache.matches) : {};
    let matchCount = 0;
    let noMatchCount = 0;
    const newMatches = {};

    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      const doZaplatyFormatted = formatAmount_(invoice.doZaplaty);
      const invoiceNumber = invoice.number || 'Brak numeru';
      const invoiceId = invoice.id;
      const cached = invoiceId && cachedMatches ? cachedMatches[invoiceId] : null;
      if (cached) {
        const lineLabel = cached.lineFrom && cached.lineTo
          ? `linie ${cached.lineFrom}–${cached.lineTo}`
          : 'linie ?';
        console.log(`Faktura ${invoiceNumber} | doZapłaty=${doZaplatyFormatted} | wynik= MATCH(${lineLabel})`);
        matchCount += 1;
        const cachedTransaction = findTransactionByLines_(transactions, cached.lineFrom, cached.lineTo);
        if (cachedTransaction) {
          cachedTransaction.used = true;
          await sendIfirmaPayment_(invoiceNumber, cachedTransaction);
        }
        continue;
      }

      const match = findBestTransactionMatch_(invoice, transactions);
      if (match && match.transaction) {
        transactions[match.index].used = true;
        const tx = match.transaction;
        const lineLabel = tx.lineFrom && tx.lineTo ? `linie ${tx.lineFrom}–${tx.lineTo}` : 'linie ?';
        const endToEnd = tx.endToEndId || '-';
        console.log(`Faktura ${invoiceNumber} | doZapłaty=${doZaplatyFormatted} | wynik= MATCH(${lineLabel})`);
        matchCount += 1;
        if (invoiceId) {
          newMatches[invoiceId] = {
            endToEndId: endToEnd,
            lineFrom: tx.lineFrom,
            lineTo: tx.lineTo,
          };
        }
        await sendIfirmaPayment_(invoiceNumber, tx);
      } else {
        console.log(`Faktura ${invoiceNumber} | doZapłaty=${doZaplatyFormatted} | wynik= NO MATCH`);
        noMatchCount += 1;
      }
    }

    console.log(`MATCH: ${matchCount} | NO MATCH: ${noMatchCount}`);

    if (scriptProperties) {
      const matchesToPersist = sameHash
        ? Object.assign({}, recordedMatches, newMatches)
        : newMatches;
      saveBankMatchCache_(scriptProperties, {
        hash: xmlHash,
        matches: matchesToPersist,
      });
    }

    const processedFolder = folders && folders.bankStatements && folders.bankStatements.processed;
    if (processedFolder && folders && folders.source) {
      moveFile_(file, folders.source, processedFolder);
    }
    if (hasInfoLogger) {
      logger.info('Bank statement processing finished', {
        transactions: transactions.length,
        invoices: invoices.length,
        matches: matchCount,
        noMatches: noMatchCount,
      });
    }
  }

  // Finance expects VAT amount even if Gemini omits it; we backfill using
  // gross-minus-net so long as both numbers are available. This keeps the
  // downstream checks consistent with accounting systems.
  function fillVatAmount_(invoiceObj) {
    if (!invoiceObj) return;
    const net = typeof invoiceObj.netAmount === 'number' ? invoiceObj.netAmount : Number(invoiceObj.netAmount);
    const gross = typeof invoiceObj.grossAmount === 'number' ? invoiceObj.grossAmount : Number(invoiceObj.grossAmount);
    const vat = typeof invoiceObj.vatAmount === 'number' ? invoiceObj.vatAmount : Number(invoiceObj.vatAmount);
    if ((net || net === 0) && (gross || gross === 0) && (vat === undefined || Number.isNaN(vat))) {
      const computed = Number((gross - net).toFixed(2));
      if (!Number.isNaN(computed)) {
        invoiceObj.vatAmount = computed;
      }
    }
  }

  function safeString_(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function safeNumber_(value) {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const normalised = String(value).replace(',', '.');
    const parsed = Number(normalised);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function normaliseSaleInvoiceNumber_(value) {
    const label = safeString_(value);
    if (!label) {
      return null;
    }
    const match = label.match(/\d+/);
    if (!match) {
      return null;
    }
    const parsed = Number.parseInt(match[0], 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function roundAmount_(value) {
    const num = typeof value === 'number' ? value : safeNumber_(value);
    if (!Number.isFinite(num)) {
      return 0;
    }
    return Number(num.toFixed(2));
  }

  function amountsAlmostEqual_(a, b, tolerance = 0.02) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    return Math.abs(a - b) <= tolerance;
  }

  function summariseSaleItems_(items) {
    const summary = { net: 0, gross: 0 };
    if (!Array.isArray(items)) {
      return summary;
    }

    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i] || {};
      const quantity = safeNumber_(entry.Ilosc);
      const unitNet = safeNumber_(entry.CenaJednostkowa);
      const rate = safeNumber_(entry.StawkaVat);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitNet)) {
        continue;
      }

      const lineNet = roundAmount_(quantity * unitNet);
      const lineVat = Number.isFinite(rate) ? roundAmount_(lineNet * rate) : 0;
      summary.net += lineNet;
      summary.gross += roundAmount_(lineNet + lineVat);
    }

    summary.net = roundAmount_(summary.net);
    summary.gross = roundAmount_(summary.gross);
    return summary;
  }

  function validateSaleItemsTotals_(invoice, items, breakdown) {
    const summary = summariseSaleItems_(items);
    const expectedNet = Number.isFinite(safeNumber_(invoice && invoice.netAmount))
      ? roundAmount_(invoice.netAmount)
      : roundAmount_(breakdown && breakdown.totalNet);
    const expectedGross = Number.isFinite(safeNumber_(invoice && invoice.grossAmount))
      ? roundAmount_(invoice.grossAmount)
      : roundAmount_(breakdown && breakdown.totalGross);

    const issues = [];
    if (Number.isFinite(expectedNet) && Math.abs(summary.net - expectedNet) > 0.01) {
      issues.push({ field: 'net', expected: expectedNet, computed: summary.net });
    }
    if (Number.isFinite(expectedGross) && Math.abs(summary.gross - expectedGross) > 0.01) {
      issues.push({ field: 'gross', expected: expectedGross, computed: summary.gross });
    }

    return {
      summary,
      expected: { net: expectedNet, gross: expectedGross },
      issues,
    };
  }

  function parseVatRate_(value) {
    const numeric = safeNumber_(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const label = safeString_(value).toLowerCase();
    if (!label) {
      return undefined;
    }
    if (label === 'zw' || label === 'zw.' || label === 'zwolnione' || label === 'np' || label === 'oo') {
      return 0;
    }
    return undefined;
  }

  function computeAmountsForRate_(rate, amounts) {
    const percent = Number.isFinite(rate) ? rate : undefined;
    let net = safeNumber_(amounts && amounts.net);
    let vat = safeNumber_(amounts && amounts.vat);
    let gross = safeNumber_(amounts && amounts.gross);

    if (Number.isFinite(percent)) {
      const multiplier = percent / 100;
      if (!Number.isFinite(vat)) {
        if (Number.isFinite(gross)) {
          vat = gross * multiplier;
        } else if (Number.isFinite(net)) {
          vat = net * multiplier;
        }
      }
      if (!Number.isFinite(net)) {
        if (Number.isFinite(gross) && Number.isFinite(vat)) {
          net = gross - vat;
        } else if (Number.isFinite(vat) && percent !== 0) {
          net = (vat * 100) / percent;
        }
      }
      if (!Number.isFinite(gross)) {
        if (Number.isFinite(net) && Number.isFinite(vat)) {
          gross = net + vat;
        } else if (Number.isFinite(net)) {
          gross = net * (1 + multiplier);
        } else if (Number.isFinite(vat) && percent !== 0) {
          gross = vat * (100 + percent) / percent;
        }
      }
    } else if (!Number.isFinite(gross) && Number.isFinite(net) && Number.isFinite(vat)) {
      gross = net + vat;
    }

    if (Number.isFinite(net)) net = roundAmount_(net);
    if (Number.isFinite(vat)) vat = roundAmount_(vat);
    if (Number.isFinite(gross)) gross = roundAmount_(gross);

    return { net, vat, gross };
  }

  function formatAmountForLog_(value) {
    const numeric = safeNumber_(value);
    if (!Number.isFinite(numeric)) {
      return 'n/a';
    }
    return numeric.toFixed(2);
  }

  function formatRateForLog_(rate) {
    if (!Number.isFinite(rate)) {
      return 'unknown';
    }
    const rounded = Number(rate.toFixed(2));
    if (Number.isInteger(rounded)) {
      return String(rounded);
    }
    return String(rounded);
  }

  function logVatComputation_(kind, context) {
    if (!logger || typeof logger.info !== 'function') {
      return;
    }
    const invoiceNumber = safeString_(context && context.invoiceNumber);
    const rate = Number.isFinite(context && context.rate) ? Number(context.rate) : undefined;
    const gross = context && context.gross;
    const net = context && context.net;
    const vat = context && context.vat;
    const lineIndex = Number.isFinite(context && context.lineIndex) ? Number(context.lineIndex) : undefined;
    const scope = context && context.scope === 'invoice' ? 'invoice' : 'line';

    const parts = ['Counting ' + kind];
    const labelBits = [];
    if (invoiceNumber) {
      labelBits.push('invoice ' + invoiceNumber);
    }
    if (scope === 'line' && lineIndex !== undefined) {
      labelBits.push('line ' + String(lineIndex + 1));
    }
    if (labelBits.length) {
      parts.push('for ' + labelBits.join(' '));
    }
    if (rate !== undefined) {
      parts.push('(rate ' + formatRateForLog_(rate) + '%)');
    }
    parts.push('from gross ' + formatAmountForLog_(gross));
    parts.push('-> net ' + formatAmountForLog_(net));
    parts.push(', vat ' + formatAmountForLog_(vat));

    logger.info(parts.join(' '));
  }

  function fillMissingTaxAmounts_(invoiceObj) {
    if (!invoiceObj || typeof invoiceObj !== 'object') {
      return;
    }

    const vatLines = Array.isArray(invoiceObj.vatLines) ? invoiceObj.vatLines : [];
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;
    let hasLineData = false;

    let fallbackRate;
    const invoiceIdentifier =
      safeString_(invoiceObj && invoiceObj.invoiceNumber) ||
      safeString_(invoiceObj && invoiceObj.number) ||
      safeString_(invoiceObj && invoiceObj.documentNumber);

    const invoiceNetBefore = safeNumber_(invoiceObj && invoiceObj.netAmount);
    const invoiceVatBefore = safeNumber_(invoiceObj && invoiceObj.vatAmount);
    const invoiceGrossBefore = safeNumber_(invoiceObj && invoiceObj.grossAmount);

    for (let index = 0; index < vatLines.length; index += 1) {
      const line = vatLines[index] && typeof vatLines[index] === 'object' ? vatLines[index] : {};
      vatLines[index] = line;
      const rate = parseVatRate_(
        line.ratePercent !== undefined ? line.ratePercent : line.vatRatePercent !== undefined ? line.vatRatePercent : line.ptu
      );
      if (Number.isFinite(rate)) {
        line.ratePercent = rate;
        line.vatRatePercent = rate;
        if (!Number.isFinite(fallbackRate)) {
          fallbackRate = rate;
        }
      }
      const lineNetBefore = safeNumber_(line.netAmount);
      const lineVatBefore = safeNumber_(line.vatAmount);
      const existingGrossKey = line.grossAmount !== undefined ? 'grossAmount' : 'gross';
      const lineGrossBefore = safeNumber_(existingGrossKey ? line[existingGrossKey] : undefined);
      const computed = computeAmountsForRate_(rate, {
        net: line.netAmount,
        vat: line.vatAmount,
        gross: line.grossAmount !== undefined ? line.grossAmount : line.gross,
      });
      if (!Number.isFinite(lineNetBefore) && Number.isFinite(computed.net)) {
        line.netAmount = computed.net;
      }
      if (!Number.isFinite(lineVatBefore) && Number.isFinite(computed.vat)) {
        line.vatAmount = computed.vat;
      }
      if (!Number.isFinite(lineGrossBefore) && Number.isFinite(computed.gross)) {
        line.grossAmount = computed.gross;
      }

      const grossForLog = Number.isFinite(lineGrossBefore)
        ? lineGrossBefore
        : Number.isFinite(computed.gross)
          ? computed.gross
          : undefined;

      if (!Number.isFinite(lineVatBefore) && Number.isFinite(computed.vat)) {
        logVatComputation_('vat', {
          invoiceNumber: invoiceIdentifier,
          rate,
          gross: grossForLog,
          net: computed.net,
          vat: computed.vat,
          lineIndex: index,
          scope: 'line',
        });
      }

      if (!Number.isFinite(lineNetBefore) && Number.isFinite(computed.net)) {
        logVatComputation_('netto', {
          invoiceNumber: invoiceIdentifier,
          rate,
          gross: grossForLog,
          net: computed.net,
          vat: computed.vat,
          lineIndex: index,
          scope: 'line',
        });
      }

      const lineNet = safeNumber_(line.netAmount);
      const lineVat = safeNumber_(line.vatAmount);
      const lineGross = safeNumber_(line.grossAmount !== undefined ? line.grossAmount : line.gross);
      if (Number.isFinite(lineNet) || Number.isFinite(lineVat) || Number.isFinite(lineGross)) {
        totalNet += lineNet || 0;
        totalVat += lineVat || 0;
        totalGross += Number.isFinite(lineGross) ? lineGross : (lineNet || 0) + (lineVat || 0);
        hasLineData = true;
      }
    }

    if (hasLineData) {
      if (!Number.isFinite(invoiceNetBefore)) {
        invoiceObj.netAmount = roundAmount_(totalNet);
      }
      if (!Number.isFinite(invoiceVatBefore)) {
        invoiceObj.vatAmount = roundAmount_(totalVat);
      }
      if (!Number.isFinite(invoiceGrossBefore)) {
        invoiceObj.grossAmount = roundAmount_(totalGross || (totalNet + totalVat));
      }
    }

    let invoiceRate = parseVatRate_(invoiceObj.vatRatePercent);
    if (!Number.isFinite(invoiceRate) && Number.isFinite(fallbackRate)) {
      invoiceRate = fallbackRate;
    }
    if (Number.isFinite(invoiceRate)) {
      invoiceObj.vatRatePercent = invoiceRate;
    }
    const invoiceComputed = computeAmountsForRate_(invoiceRate, {
      net: invoiceObj.netAmount,
      vat: invoiceObj.vatAmount,
      gross: invoiceObj.grossAmount,
    });
    if (!Number.isFinite(invoiceNetBefore) && Number.isFinite(invoiceComputed.net)) {
      invoiceObj.netAmount = invoiceComputed.net;
    }
    if (!Number.isFinite(invoiceVatBefore) && Number.isFinite(invoiceComputed.vat)) {
      invoiceObj.vatAmount = invoiceComputed.vat;
    }
    if (!Number.isFinite(invoiceGrossBefore) && Number.isFinite(invoiceComputed.gross)) {
      invoiceObj.grossAmount = invoiceComputed.gross;
    }

    const grossForInvoiceLog = Number.isFinite(invoiceGrossBefore)
      ? invoiceGrossBefore
      : Number.isFinite(invoiceComputed.gross)
        ? invoiceComputed.gross
        : undefined;

    if (!Number.isFinite(invoiceVatBefore) && Number.isFinite(invoiceComputed.vat)) {
      logVatComputation_('vat', {
        invoiceNumber: invoiceIdentifier,
        rate: invoiceRate,
        gross: grossForInvoiceLog,
        net: invoiceComputed.net,
        vat: invoiceComputed.vat,
        scope: 'invoice',
      });
    }

    if (!Number.isFinite(invoiceNetBefore) && Number.isFinite(invoiceComputed.net)) {
      logVatComputation_('netto', {
        invoiceNumber: invoiceIdentifier,
        rate: invoiceRate,
        gross: grossForInvoiceLog,
        net: invoiceComputed.net,
        vat: invoiceComputed.vat,
        scope: 'invoice',
      });
    }
  }

  function parseDateInput_(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getTime());
    }
    const str = safeString_(value);
    if (!str) {
      return null;
    }
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let parsed;
    if (isoMatch) {
      parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    } else {
      parsed = new Date(str);
    }
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  function formatDate_(dateObj) {
    const date = parseDateInput_(dateObj);
    if (!date) {
      return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function normaliseDate_(primary, fallback) {
    const primaryFormatted = formatDate_(primary);
    if (primaryFormatted) {
      return primaryFormatted;
    }
    if (arguments.length > 1) {
      return formatDate_(fallback);
    }
    return '';
  }

  function buildInvoiceDates_(invoice) {
    const rawIssueDate = invoice && invoice.issueDate;
    const issueDate = normaliseDate_(rawIssueDate);
    const arrivalSource = invoice && invoice.deliveryDate;
    const dueSource = (invoice && invoice.paymentDueDate)
      || (invoice && invoice.deliveryDate);
    const arrivalDate = normaliseDate_(arrivalSource, rawIssueDate);
    const dueDate = normaliseDate_(dueSource, rawIssueDate);
    return { issueDate, arrivalDate, dueDate };
  }

  function extractTaxInfo_(taxId) {
    const raw = safeString_(taxId).toUpperCase();
    if (!raw) {
      return { prefix: '', nip: '' };
    }
    const prefixMatch = raw.match(/^[A-Z]{2}/);
    let prefix = '';
    let remainder = raw;
    if (prefixMatch) {
      prefix = prefixMatch[0];
      remainder = raw.slice(prefix.length);
    }
    const digits = remainder.replace(/[^0-9]/g, '');
    if (!prefix && digits.length === 10) {
      prefix = 'PL';
    }
    return { prefix, nip: digits };
  }

  function determineInvoiceKind_(invoice) {
    const normalisedCompanyTaxId = configuration && configuration.company
      ? configuration.company.normalisedTaxId
      : '';
    const companyName = configuration && configuration.company
      ? configuration.company.normalisedName
      : '';

    const sellerTax = extractTaxInfo_(invoice && invoice.seller && invoice.seller.taxId).nip;
    const buyerTax = extractTaxInfo_(invoice && invoice.buyer && invoice.buyer.taxId).nip;

    if (normalisedCompanyTaxId) {
      if (sellerTax && sellerTax === normalisedCompanyTaxId) {
        return 'sale';
      }
      if (buyerTax && buyerTax === normalisedCompanyTaxId) {
        return 'expense';
      }
    }

    const sellerName = safeString_(invoice && invoice.seller && invoice.seller.name).toLowerCase();
    const buyerName = safeString_(invoice && invoice.buyer && invoice.buyer.name).toLowerCase();

    if (companyName) {
      if (sellerName && sellerName.includes(companyName)) {
        return 'sale';
      }
      if (buyerName && buyerName.includes(companyName)) {
        return 'expense';
      }
    }

    return 'expense';
  }

  function guessPhoneFromInvoice_(invoice, preferredRole) {
    const candidates = [];
    const pushCandidate = (value) => {
      const str = safeString_(value);
      if (!str) return;
      const normalised = str.replace(/[^0-9+]/g, '');
      const digitsOnly = normalised.replace(/[^0-9]/g, '');
      if (digitsOnly.length >= 7) {
        candidates.push(normalised);
      }
    };

    const seller = (invoice && invoice.seller) || {};
    const buyer = (invoice && invoice.buyer) || {};
    const sellerAddress = seller.address || {};
    const buyerAddress = buyer.address || {};

    const sequences = preferredRole === 'buyer'
      ? [[buyer, buyerAddress], [seller, sellerAddress]]
      : [[seller, sellerAddress], [buyer, buyerAddress]];

    const collect = (entity, address) => {
      if (!entity && !address) {
        return;
      }
      const values = [
        entity && entity.phone,
        entity && entity.telephone,
        entity && entity.contactPhone,
        entity && entity.mobile,
        address && address.phone,
      ];
      for (let idx = 0; idx < values.length; idx += 1) {
        pushCandidate(values[idx]);
      }
    };

    for (let i = 0; i < sequences.length; i += 1) {
      const [entity, address] = sequences[i];
      collect(entity || {}, address || {});
    }

    if (Array.isArray(invoice && invoice.contactPhones)) {
      for (let i = 0; i < invoice.contactPhones.length; i += 1) {
        pushCandidate(invoice.contactPhones[i]);
      }
    }

    return candidates.length ? candidates[0] : '';
  }

  const PAYMENT_METHOD_SYNONYMS = {
    GTK: ['gtk', 'gotowka', 'gotówka', 'gotowke', 'gotówkę', 'cash'],
    POB: ['pob', 'za pobraniem', 'pobranie', 'pobrania'],
    PRZ: ['prz', 'przelew'],
    KAR: ['kar', 'karta', 'card'],
    PZA: ['pza', 'polecenie zaplaty', 'polecenie zapłaty'],
    CZK: ['czk', 'czek', 'check'],
    KOM: ['kom', 'kompensata'],
    BAR: ['bar', 'barter'],
    DOT: ['dot', 'dotpay'],
    PAL: ['pal', 'paypal'],
    ALG: ['alg', 'payu'],
    P24: ['p24', 'przelewy24'],
    TPA: ['tpa', 'tpay', 'tpay.com', 'tpaycom'],
    ELE: ['ele', 'platnosc elektroniczna', 'płatność elektroniczna', 'elektroniczna'],
  };

  function normalisePaymentMethodCode_(value) {
    const direct = safeString_(value);
    if (!direct) {
      return '';
    }
    const uppercase = direct.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_SYNONYMS, uppercase)) {
      return uppercase;
    }
    const lower = direct.toLowerCase();
    const stripped = lower.replace(/\s+/g, ' ').trim();
    const normalised = stripped.replace(/[\.-]/g, '');
    for (const code of Object.keys(PAYMENT_METHOD_SYNONYMS)) {
      const variants = PAYMENT_METHOD_SYNONYMS[code];
      if (!Array.isArray(variants)) {
        continue;
      }
      if (variants.includes(lower) || variants.includes(stripped) || variants.includes(normalised)) {
        return code;
      }
    }
    return '';
  }

  function buildKontrahentPayload_(invoice, options) {
    const role = options && options.role === 'buyer' ? 'buyer' : 'seller';
    const counterparty = role === 'buyer'
      ? (invoice && invoice.buyer) || {}
      : (invoice && invoice.seller) || {};
    const address = counterparty.address || {};
    const taxInfo = extractTaxInfo_(counterparty.taxId);
    const phone = guessPhoneFromInvoice_(invoice, role);
    const kontrahent = {
      Nazwa: safeString_(counterparty.name) || undefined,
      Nazwa2: undefined,
      NIP: taxInfo.nip || undefined,
      PrefiksUE: taxInfo.prefix || undefined,
      Ulica: safeString_(address.street) || undefined,
      KodPocztowy: safeString_(address.postalCode) || undefined,
      Kraj: safeString_(address.country) || undefined,
      Miejscowosc: safeString_(address.city) || undefined,
      Email: safeString_(counterparty.email) || undefined,
      Telefon: phone || undefined,
      OsobaFizyczna: !taxInfo.nip,
      JestOdbiorca: true,
      JestDostawca: role !== 'buyer',
    };

    if (!kontrahent.Kraj) {
      kontrahent.Kraj = 'Polska';
    }

    return { kontrahent, taxInfo, phone };
  }

  function normaliseVatRateToDecimal_(value) {
    const numeric = safeNumber_(value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    if (numeric < 0) {
      return undefined;
    }
    if (numeric > 1) {
      return Number((numeric / 100).toFixed(4));
    }
    return Number(numeric.toFixed(4));
  }

  function computeSalePayment_(invoice, breakdown) {
    const grossFromInvoice = safeNumber_(invoice && invoice.grossAmount);
    const gross = Number.isFinite(grossFromInvoice)
      ? roundAmount_(grossFromInvoice)
      : roundAmount_(breakdown && breakdown.totalGross ? breakdown.totalGross : 0);

    let paid = safeNumber_(invoice && invoice.amountPaid);
    const paymentStatus = safeString_(invoice && invoice.paymentStatus).toLowerCase();
    const dueValue = safeNumber_(invoice && invoice.amountDue);
    const labelNumber = safeNumber_(
      invoice && (invoice.amountPaidLabel || invoice.amountPaidText)
    );

    if (Number.isFinite(labelNumber)) {
      paid = labelNumber;
    }

    if (!Number.isFinite(paid)) {
      if (Number.isFinite(dueValue) && Number.isFinite(gross)) {
        paid = roundAmount_(Math.max(gross - dueValue, 0));
      }
    }

    if (!Number.isFinite(paid) && paymentStatus) {
      if (/paid|zapłacono|oplacona|opłacona|zapłacona/.test(paymentStatus)) {
        paid = gross;
      } else if (/unpaid|niezapłacona|nieoplacona/.test(paymentStatus)) {
        paid = 0;
      }
    }

    if (!Number.isFinite(paid)) {
      paid = 0;
    }

    if (Number.isFinite(gross)) {
      paid = Math.min(paid, gross);
    }
    paid = roundAmount_(Math.max(paid, 0));

    let documentAmount = Number.isFinite(labelNumber) ? labelNumber : paid;
    if (!Number.isFinite(documentAmount)) {
      documentAmount = 0;
    }
    if (Number.isFinite(gross)) {
      documentAmount = Math.min(documentAmount, gross);
    }
    documentAmount = roundAmount_(Math.max(documentAmount, 0));

    return {
      grossAmount: Number.isFinite(gross) ? roundAmount_(gross) : 0,
      paidAmount: paid,
      documentAmount,
    };
  }

  function buildSaleItems_(invoice, breakdown) {
    const items = [];
    const rawLineItems = Array.isArray(invoice && invoice.lineItems)
      ? invoice.lineItems
      : [];

    const addItem = (details, fallbackDescription) => {
      if (!details) {
        return;
      }
      const description = safeString_(details.description || details.name || fallbackDescription)
        || fallbackDescription;
      const quantityValueRaw = Number.isFinite(safeNumber_(details.quantity))
        ? safeNumber_(details.quantity)
        : Number.isFinite(safeNumber_(details.qty))
          ? safeNumber_(details.qty)
          : 1;
      const quantityValue = Number.isFinite(quantityValueRaw) && quantityValueRaw > 0
        ? quantityValueRaw
        : 1;
      const quantity = Number(quantityValue.toFixed(4));
      const netCandidate = safeNumber_(details.netAmount || details.net || details.valueNet);
      const grossCandidate = safeNumber_(details.grossAmount || details.gross || details.totalAmount);
      const explicitUnit = safeNumber_(details.unitPrice || details.unitNet || details.unitPriceNet);
      const rateDecimal = normaliseVatRateToDecimal_(
        details.vatRatePercent
          || details.ratePercent
          || details.vatRate
      );

      let netTotal = Number.isFinite(netCandidate) ? netCandidate : undefined;
      if (!Number.isFinite(netTotal) && Number.isFinite(grossCandidate) && typeof rateDecimal === 'number') {
        const divisor = 1 + rateDecimal;
        if (divisor > 0) {
          netTotal = grossCandidate / divisor;
        }
      }
      if (!Number.isFinite(netTotal) && Number.isFinite(explicitUnit)) {
        netTotal = explicitUnit * quantity;
      }

      if (!Number.isFinite(netTotal) && !Number.isFinite(explicitUnit)) {
        return;
      }

      const roundedNetTotal = Number.isFinite(netTotal) ? roundAmount_(netTotal) : undefined;

      let unitNet;
      if (Number.isFinite(explicitUnit)) {
        const multiplied = roundAmount_(explicitUnit * quantity);
        if (Number.isFinite(roundedNetTotal) && amountsAlmostEqual_(multiplied, roundedNetTotal)) {
          unitNet = explicitUnit;
        } else if (
          !Number.isFinite(roundedNetTotal)
          && Number.isFinite(grossCandidate)
          && amountsAlmostEqual_(multiplied, roundAmount_(grossCandidate))
          && typeof rateDecimal === 'number'
        ) {
          const divisor = 1 + rateDecimal;
          if (divisor > 0) {
            unitNet = explicitUnit / divisor;
          }
        } else if (!Number.isFinite(roundedNetTotal)) {
          unitNet = explicitUnit;
        }
      }

      if (!Number.isFinite(unitNet) && Number.isFinite(roundedNetTotal)) {
        unitNet = roundedNetTotal / quantity;
      }

      if (!Number.isFinite(unitNet) && Number.isFinite(explicitUnit)) {
        unitNet = explicitUnit;
      }

      if (!Number.isFinite(unitNet) && Number.isFinite(grossCandidate) && typeof rateDecimal === 'number') {
        const divisor = 1 + rateDecimal;
        if (divisor > 0) {
          unitNet = (roundAmount_(grossCandidate) / divisor) / quantity;
        }
      }

      if (!Number.isFinite(unitNet)) {
        return;
      }

      const normalisedUnitNet = roundAmount_(unitNet);
      const unitLabel = safeString_(details.unit || details.unitName) || 'szt.';

      items.push({
        StawkaVat: typeof rateDecimal === 'number' ? rateDecimal : 0,
        Ilosc: quantity,
        CenaJednostkowa: normalisedUnitNet,
        NazwaPelna: description || 'Sprzedaż towarów i usług',
        Jednostka: unitLabel,
        GTU: 'BRAK',
        TypStawkiVat: typeof rateDecimal === 'number' && rateDecimal === 0 ? 'ZW' : 'PRC',
      });
    };

    if (rawLineItems.length) {
      for (let index = 0; index < rawLineItems.length; index += 1) {
        addItem(rawLineItems[index], 'Sprzedaż towarów i usług');
      }
    }

    if (!items.length && Array.isArray(invoice && invoice.vatLines)) {
      const vatLines = invoice.vatLines;
      for (let idx = 0; idx < vatLines.length; idx += 1) {
        const line = vatLines[idx] || {};
        addItem({
          description: 'Sprzedaż (' + (safeNumber_(line.ratePercent || line.vatRatePercent) || 0) + '%)',
          quantity: 1,
          grossAmount: line.grossAmount,
          netAmount: line.netAmount,
          vatRatePercent: line.ratePercent || line.vatRatePercent,
        }, 'Sprzedaż towarów i usług');
      }
    }

    if (!items.length) {
      const fallbackGross = roundAmount_(
        breakdown && breakdown.totalGross
          ? breakdown.totalGross
          : safeNumber_(invoice && invoice.grossAmount)
      );
      const fallbackRate = Array.isArray(invoice && invoice.vatLines) && invoice.vatLines.length
        ? invoice.vatLines[0].ratePercent || invoice.vatLines[0].vatRatePercent
        : invoice && invoice.vatRatePercent;
      const rateDecimal = normaliseVatRateToDecimal_(fallbackRate) || 0;
      items.push({
        StawkaVat: rateDecimal,
        Ilosc: 1,
        CenaJednostkowa: fallbackGross || roundAmount_(breakdown && breakdown.totalNet ? breakdown.totalNet : 0),
        NazwaPelna: 'Sprzedaż towarów i usług',
        Jednostka: 'szt.',
        GTU: 'BRAK',
        TypStawkiVat: rateDecimal === 0 ? 'ZW' : 'PRC',
      });
    }

    return items;
  }

  function validateSalePayload_(payload) {
    const missing = [];
    if (!payload || typeof payload !== 'object') {
      return ['Payload'];
    }
    if (!Number.isFinite(safeNumber_(payload.Zaplacono))) missing.push('Zaplacono');
    if (!Number.isFinite(safeNumber_(payload.ZaplaconoNaDokumencie))) missing.push('ZaplaconoNaDokumencie');
    if (!safeString_(payload.LiczOd)) missing.push('LiczOd');
    if (!safeString_(payload.DataWystawienia)) missing.push('DataWystawienia');
    if (!safeString_(payload.DataSprzedazy)) missing.push('DataSprzedazy');
    if (!safeString_(payload.FormatDatySprzedazy)) missing.push('FormatDatySprzedazy');
    if (!safeString_(payload.SposobZaplaty)) missing.push('SposobZaplaty');
    if (!safeString_(payload.RodzajPodpisuOdbiorcy)) missing.push('RodzajPodpisuOdbiorcy');
    if (typeof payload.WidocznyNumerGios !== 'boolean') missing.push('WidocznyNumerGios');
    if (typeof payload.WidocznyNumerBdo !== 'boolean') missing.push('WidocznyNumerBdo');
    if (!(payload.Numer === null || Number.isInteger(payload.Numer))) missing.push('Numer');
    if (!Array.isArray(payload.Pozycje) || !payload.Pozycje.length) missing.push('Pozycje');
    const kontrahent = payload.Kontrahent || {};
    if (!safeString_(kontrahent.Nazwa)) missing.push('Kontrahent.Nazwa');
    if (!safeString_(kontrahent.KodPocztowy)) missing.push('Kontrahent.KodPocztowy');
    if (!safeString_(kontrahent.Miejscowosc)) missing.push('Kontrahent.Miejscowosc');

    if (Array.isArray(payload.Pozycje)) {
      for (let i = 0; i < payload.Pozycje.length; i += 1) {
        const item = payload.Pozycje[i] || {};
        if (!Number.isFinite(safeNumber_(item.StawkaVat))) missing.push('Pozycje[' + i + '].StawkaVat');
        if (!Number.isFinite(safeNumber_(item.Ilosc))) missing.push('Pozycje[' + i + '].Ilosc');
        if (!Number.isFinite(safeNumber_(item.CenaJednostkowa))) missing.push('Pozycje[' + i + '].CenaJednostkowa');
        if (!safeString_(item.NazwaPelna)) missing.push('Pozycje[' + i + '].NazwaPelna');
        if (!safeString_(item.Jednostka)) missing.push('Pozycje[' + i + '].Jednostka');
        if (!safeString_(item.GTU)) missing.push('Pozycje[' + i + '].GTU');
        if (!safeString_(item.TypStawkiVat)) missing.push('Pozycje[' + i + '].TypStawkiVat');
      }
    }

    return missing;
  }

  function prepareSaleRequest_(invoice) {
    const breakdown = computeVatBreakdown_(invoice);
    const dates = buildInvoiceDates_(invoice);
    const kontrahentInfo = buildKontrahentPayload_(invoice, { role: 'buyer' });
    const saleItems = buildSaleItems_(invoice, breakdown);
    const saleValidation = validateSaleItemsTotals_(invoice, saleItems, breakdown);
    const payment = computeSalePayment_(invoice, breakdown);
    const saleConfig = configuration && configuration.sales ? configuration.sales : {};
    const paymentMethodCode = normalisePaymentMethodCode_(
      invoice && (invoice.paymentMethodCode || invoice.paymentMethod)
    );

    const saleDate = normaliseDate_(invoice && invoice.deliveryDate, dates.issueDate) || dates.issueDate;

    const payload = {
      Zaplacono: payment.paidAmount,
      ZaplaconoNaDokumencie: payment.documentAmount,
      LiczOd: saleConfig.calculationBasis || 'BRT',
      DataWystawienia: dates.issueDate,
      DataSprzedazy: saleDate,
      FormatDatySprzedazy: 'DZN',
      SposobZaplaty: paymentMethodCode,
      RodzajPodpisuOdbiorcy: 'OUP',
      PodpisOdbiorcy: '',
      PodpisWystawcy: '',
      Uwagi: undefined,
      WidocznyNumerGios: false,
      WidocznyNumerBdo: false,
      Numer: normaliseSaleInvoiceNumber_(invoice && invoice.invoiceNumber),
      Pozycje: saleItems,
      Kontrahent: kontrahentInfo.kontrahent,
    };

    if (saleConfig.issueCity) {
      payload.MiejsceWystawienia = saleConfig.issueCity;
    }
    if (saleConfig.numberingSeries) {
      payload.NazwaSeriiNumeracji = saleConfig.numberingSeries;
    }
    if (saleConfig.template) {
      payload.NazwaSzablonu = saleConfig.template;
    }
    if (saleConfig.bankAccount) {
      payload.NumerKontaBankowego = saleConfig.bankAccount;
    }
    if (dates.dueDate) {
      payload.TerminPlatnosci = dates.dueDate;
    }

    const notes = safeString_(
      (invoice && invoice.notes)
      || (invoice && invoice.comments)
      || (invoice && invoice.additionalInfo)
    );
    if (notes) {
      payload.Uwagi = notes;
    }

    if (kontrahentInfo.phone && !payload.Kontrahent.Telefon) {
      payload.Kontrahent.Telefon = kontrahentInfo.phone;
    }

    if (kontrahentInfo.taxInfo.prefix) {
      payload.PrefiksUEKontrahenta = kontrahentInfo.taxInfo.prefix;
      payload.Kontrahent.PrefiksUE = kontrahentInfo.taxInfo.prefix;
    }
    if (kontrahentInfo.taxInfo.nip) {
      payload.NIPKontrahenta = kontrahentInfo.taxInfo.nip;
      payload.Kontrahent.NIP = kontrahentInfo.taxInfo.nip;
    }

    const missingFields = validateSalePayload_(payload);
    if (saleValidation && Array.isArray(saleValidation.issues) && saleValidation.issues.length) {
      if (logger && logger.error) {
        logger.error(
          'Sale invoice totals mismatch before iFirma export',
          invoice && invoice.invoiceNumber,
          saleValidation,
        );
      }
      if (!missingFields.includes('LineTotalsMismatch')) {
        missingFields.push('LineTotalsMismatch');
      }
    }

    return { endpoint: 'fakturakraj', payload, missingFields, validation: saleValidation };
  }

  function computeVatBreakdown_(invoice) {
    const result = {
      net23: 0,
      net8: 0,
      net5: 0,
      net0: 0,
      netZw: 0,
      vat23: 0,
      vat8: 0,
      vat5: 0,
      totalNet: 0,
      totalVat: 0,
      totalGross: 0,
      hasVat: false,
      hasZero: false,
      hasExempt: false,
      salesType: 'ZW',
    };

    const lines = Array.isArray(invoice && invoice.vatLines) ? invoice.vatLines : [];
    let processed = false;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] || {};
      const rate = typeof line.ratePercent === 'number'
        ? line.ratePercent
        : typeof line.vatRatePercent === 'number'
          ? line.vatRatePercent
          : undefined;
      const net = safeNumber_(line.netAmount) || 0;
      const vat = safeNumber_(line.vatAmount) || 0;
      processed = true;
      if (rate === 23) {
        result.net23 += net;
        result.vat23 += vat;
      } else if (rate === 8) {
        result.net8 += net;
        result.vat8 += vat;
      } else if (rate === 5) {
        result.net5 += net;
        result.vat5 += vat;
      } else if (rate === 0) {
        result.net0 += net;
      } else if (safeString_(invoice && invoice.vatExemptionReason)) {
        result.netZw += net;
      } else {
        result.net0 += net;
      }
    }

    if (!processed) {
      const net = safeNumber_(invoice && invoice.netAmount);
      const vat = safeNumber_(invoice && invoice.vatAmount);
      const gross = safeNumber_(invoice && invoice.grossAmount);
      const rate = typeof (invoice && invoice.vatRatePercent) === 'number'
        ? invoice.vatRatePercent
        : undefined;

      if (rate === 23) {
        result.net23 += net || 0;
        result.vat23 += vat || 0;
      } else if (rate === 8) {
        result.net8 += net || 0;
        result.vat8 += vat || 0;
      } else if (rate === 5) {
        result.net5 += net || 0;
        result.vat5 += vat || 0;
      } else if (rate === 0) {
        result.net0 += net || (gross || 0);
      } else if ((vat || 0) > 0) {
        result.net23 += net || ((gross || 0) - (vat || 0));
        result.vat23 += vat || 0;
      } else if (safeString_(invoice && invoice.vatExemptionReason)) {
        result.netZw += net || (gross || 0);
      } else {
        result.net0 += net || (gross || 0);
      }
    }

    result.net23 = roundAmount_(result.net23);
    result.net8 = roundAmount_(result.net8);
    result.net5 = roundAmount_(result.net5);
    result.net0 = roundAmount_(result.net0);
    result.netZw = roundAmount_(result.netZw);
    result.vat23 = roundAmount_(result.vat23);
    result.vat8 = roundAmount_(result.vat8);
    result.vat5 = roundAmount_(result.vat5);
    result.totalNet = roundAmount_(
      result.net23 + result.net8 + result.net5 + result.net0 + result.netZw,
    );
    result.totalVat = roundAmount_(result.vat23 + result.vat8 + result.vat5);
    result.totalGross = roundAmount_(result.totalNet + result.totalVat);
    result.hasVat = result.totalVat > 0;
    result.hasZero = result.net0 > 0;
    result.hasExempt = result.netZw > 0 || Boolean(safeString_(invoice && invoice.vatExemptionReason));

    if (result.hasVat && (result.hasZero || result.hasExempt)) {
      result.salesType = 'OPIZW';
    } else if (result.hasVat) {
      result.salesType = 'OP';
    } else {
      result.salesType = 'ZW';
    }

    return result;
  }

  function truncateExpenseName_(name) {
    const text = safeString_(name);
    if (!text) {
      return '';
    }
    return text.length > 50 ? text.slice(0, 50) : text;
  }

  function determineExpenseTarget_(invoice, breakdown) {
    return { endpoint: 'kosztdzialalnoscivat', label: 'Koszt prowadzenia działalności' };
  }

  function determineDocumentType_(invoice) {
    const number = safeString_(invoice && invoice.invoiceNumber).toLowerCase();
    if (/par/.test(number)) {
      return 'PAR';
    }
    if (/bil/.test(number)) {
      return 'BIL';
    }
    return 'RACH';
  }

  function validateExpensePayload_(payload, target) {
    const missing = [];
    const kontrahent = payload && payload.Kontrahent ? payload.Kontrahent : null;

    if (target.endpoint === 'kosztdzialalnosci') {
      if (!safeString_(payload && payload.NumerDokumentu)) missing.push('NumerDokumentu');
      if (!safeString_(payload && payload.RodzajDokumentu)) missing.push('RodzajDokumentu');
      if (!safeString_(payload && payload.TerminPlatnosci)) missing.push('TerminPlatnosci');
      if (!(payload && payload.Kwota > 0)) missing.push('Kwota');
    } else {
      if (!safeString_(payload && payload.NumerFaktury)) missing.push('NumerFaktury');
      if (!safeString_(payload && payload.DataWystawienia)) missing.push('DataWystawienia');
      if (!safeString_(payload && payload.NazwaWydatku)) missing.push('NazwaWydatku');
      const requiredNetFields = [
        'KwotaNetto23',
        'KwotaNetto08',
        'KwotaNetto05',
        'KwotaNetto00',
        'KwotaNettoZw',
      ];
      for (let i = 0; i < requiredNetFields.length; i += 1) {
        const field = requiredNetFields[i];
        if (!hasValue_(payload && payload[field])) {
          missing.push(field);
        }
      }
      const requiredVatFields = ['KwotaVat23', 'KwotaVat08', 'KwotaVat05'];
      for (let i = 0; i < requiredVatFields.length; i += 1) {
        const field = requiredVatFields[i];
        if (!hasValue_(payload && payload[field])) {
          missing.push(field);
        }
      }
    }

    if (!safeString_(payload && payload.RodzajSprzedazy)) missing.push('RodzajSprzedazy');

    if (!kontrahent || !safeString_(kontrahent.Nazwa)) missing.push('Kontrahent.Nazwa');
    if (!kontrahent || !safeString_(kontrahent.KodPocztowy)) missing.push('Kontrahent.KodPocztowy');
    if (!kontrahent || !safeString_(kontrahent.Miejscowosc)) missing.push('Kontrahent.Miejscowosc');

    if (target.endpoint === 'oplatatelefon') {
      const phone = safeString_(payload && payload.Telefon) || (kontrahent && safeString_(kontrahent.Telefon));
      if (!phone) {
        missing.push('Telefon');
      }
    }

    return missing;
  }

  function prepareIfirmaRequest_(invoice) {
    if (!invoice) {
      return null;
    }

    if (invoice.kind === 'sale') {
      return prepareSaleRequest_(invoice);
    }

    const breakdown = computeVatBreakdown_(invoice);
    const target = determineExpenseTarget_(invoice, breakdown);
    const dates = buildInvoiceDates_(invoice);
    const kontrahentInfo = buildKontrahentPayload_(invoice, { role: 'seller' });
    const payloadBase = {
      Kontrahent: kontrahentInfo.kontrahent,
      RodzajSprzedazy: breakdown.salesType,
    };

    let payload;
    if (target.endpoint === 'kosztdzialalnosci') {
      payload = Object.assign({}, payloadBase, {
        RodzajDokumentu: determineDocumentType_(invoice),
        NumerDokumentu: safeString_(invoice.invoiceNumber),
        DataWystawienia: dates.issueDate,
        TerminPlatnosci: dates.dueDate,
        NazwaWydatku: truncateExpenseName_(target.label),
        Kwota: breakdown.totalGross || breakdown.totalNet,
      });
    } else {
      payload = Object.assign({}, payloadBase, {
        NumerFaktury: safeString_(invoice.invoiceNumber),
        DataWystawienia: dates.issueDate,
        TerminPlatnosci: dates.dueDate,
        NazwaWydatku: truncateExpenseName_(target.label),
        KwotaNetto23: breakdown.net23,
        KwotaNetto08: breakdown.net8,
        KwotaNetto05: breakdown.net5,
        KwotaNetto00: breakdown.net0,
        KwotaNettoZw: breakdown.netZw,
        KwotaVat23: breakdown.vat23,
        KwotaVat08: breakdown.vat8,
        KwotaVat05: breakdown.vat5,
      });

      if (target.endpoint === 'oplatatelefon') {
        const phone = kontrahentInfo.phone || guessPhoneFromInvoice_(invoice);
        if (phone) {
          payload.Telefon = phone;
          payload.Kontrahent.Telefon = phone;
        }
      }
    }

    if (kontrahentInfo.taxInfo.prefix) {
      payload.PrefiksUEKontrahenta = kontrahentInfo.taxInfo.prefix;
      if (payload.Kontrahent) {
        payload.Kontrahent.PrefiksUE = kontrahentInfo.taxInfo.prefix;
      }
    }
    if (kontrahentInfo.taxInfo.nip) {
      payload.NIPKontrahenta = kontrahentInfo.taxInfo.nip;
      if (payload.Kontrahent) {
        payload.Kontrahent.NIP = kontrahentInfo.taxInfo.nip;
      }
    }

    payload.NazwaWydatku = truncateExpenseName_(payload.NazwaWydatku);

    if (target.endpoint === 'kosztdzialalnosci') {
      payload.Kwota = roundAmount_(payload.Kwota);
    }

    const missingFields = validateExpensePayload_(payload, target);
    return { endpoint: target.endpoint, payload, missingFields };
  }

  async function sendInvoiceToIfirma_(invoice, originalClassification) {
    const isSale = invoice && invoice.kind === 'sale';
    const hasModule = IFirma && (isSale ? IFirma.postSalesInvoice : IFirma.postExpense);
    if (!hasModule) {
      logger && logger.warn && logger.warn('iFirma module unavailable; routing invoice for review');
      return {
        success: false,
        classification: 'partial',
        reason: 'moduleUnavailable',
        message: 'Moduł integracji iFirma jest niedostępny w środowisku wykonawczym.',
      };
    }

    const prepared = (invoice && invoice.ifirmaPrepared) || prepareIfirmaRequest_(invoice);
    if (invoice && prepared && invoice.ifirmaPrepared !== prepared) {
      invoice.ifirmaPrepared = prepared;
    }
    if (!prepared) {
      return {
        success: false,
        classification: 'partial',
        reason: 'prepareFailed',
        message: 'Nie udało się przygotować danych faktury do formatu wymaganego przez iFirma.',
      };
    }

    if (Array.isArray(prepared.missingFields) && prepared.missingFields.length) {
      return {
        success: false,
        classification: 'failed',
        reason: 'missingFields',
        missingFields: prepared.missingFields.slice(),
        message: 'Brakuje wymaganych pól iFirma.',
      };
    }

    const postFn = isSale ? IFirma.postSalesInvoice : IFirma.postExpense;

    try {
      const response = await postFn(prepared.endpoint, prepared.payload);
      const responseBody = response && response.json ? response.json : null;
      const responseEnvelope = responseBody && typeof responseBody === 'object' ? responseBody.response : null;
      const responseCode = responseEnvelope && typeof responseEnvelope.Kod !== 'undefined'
        ? Number(responseEnvelope.Kod)
        : undefined;
      const envelopeMessage = responseEnvelope && (responseEnvelope.Informacja
        || responseEnvelope.Komunikat
        || responseEnvelope.message
        || responseEnvelope.Message);
      const envelopeUserMessage = responseEnvelope && (responseEnvelope.InformacjaDlaUzytkownika
        || responseEnvelope.InformacjaDlaUżytkownika
        || responseEnvelope.userMessage);
      if (response && response.ok && responseCode === 0) {
        logger && logger.info && logger.info(
          'Pushed invoice to iFirma',
          invoice && invoice.invoiceNumber,
          prepared.endpoint,
        );
        return { success: true, classification: originalClassification || 'success', response };
      }
      const hasNonZeroResponseCode = Number.isFinite(responseCode) && responseCode !== 0;
      const failurePayload = {
        success: false,
        classification: 'partial',
        reason: 'apiError',
        response,
        responseCode,
        message: envelopeMessage,
        userMessage: envelopeUserMessage,
        httpStatus: response && response.status,
      };
      if (hasNonZeroResponseCode && Slack && Slack.notifyIfirmaError) {
        try {
          await Slack.notifyIfirmaError({
            code: responseCode,
            invoiceNumber: invoice && invoice.invoiceNumber,
            endpoint: prepared.endpoint,
            httpStatus: response && response.status,
            message: envelopeMessage,
            userMessage: envelopeUserMessage,
            rawBody: response && response.body,
          });
        } catch (notifyErr) {
          logger && logger.warn && logger.warn('Unable to notify Slack about iFirma error', notifyErr);
        }
      }
      logger && logger.error && logger.error(
        'iFirma returned error for invoice',
        invoice && invoice.invoiceNumber,
        response && response.status,
        response && response.body,
        { responseCode },
      );
      return failurePayload;
    } catch (err) {
      logger && logger.error && logger.error('iFirma request threw for invoice', invoice && invoice.invoiceNumber, err);
      return {
        success: false,
        classification: 'partial',
        reason: 'exception',
        error: err,
        message: err && err.message ? err.message : 'Wyjątek podczas wywołania API iFirma.',
      };
    }
  }

  async function sendInvoiceToHubspot_(invoice) {
    if (!invoice || invoice.kind !== 'sale') {
      return { success: true, classification: 'success', skipped: true, reason: 'nonSaleInvoice' };
    }

    const hasModule = Hubspot && typeof Hubspot.syncSaleInvoice === 'function';
    if (!hasModule) {
      logger && logger.warn && logger.warn('HubSpot module unavailable; invoice will require review');
      return {
        success: false,
        classification: 'partial',
        reason: 'moduleUnavailable',
        message: 'Moduł HubSpot jest niedostępny w środowisku wykonawczym.',
      };
    }

    try {
      const outcome = await Hubspot.syncSaleInvoice(invoice);
      if (!outcome) {
        return {
          success: false,
          classification: 'partial',
          reason: 'emptyOutcome',
          message: 'Brak odpowiedzi z synchronizacji HubSpot.',
        };
      }
      const skipped = !!outcome.skipped;
      const successFlag = outcome.success;
      if (successFlag === false && !skipped) {
        return Object.assign({
          success: false,
          classification: outcome.classification || 'partial',
        }, outcome);
      }
      return Object.assign({
        success: true,
        classification: outcome.classification || 'success',
        skipped,
      }, outcome);
    } catch (err) {
      logger && logger.error && logger.error('HubSpot sync threw', invoice && invoice.invoiceNumber, err);
      return {
        success: false,
        classification: 'partial',
        reason: 'exception',
        error: err,
        message: err && err.message ? err.message : 'Wyjątek podczas synchronizacji z HubSpot.',
      };
    }
  }

  async function persistFailureBlob_(blob, failedFolder, pageIndex) {
    if (!failedFolder || !failedFolder.createFile) {
      return;
    }

    try {
      const extension = Helpers.getBlobExtension ? Helpers.getBlobExtension(blob) : 'pdf';
      const name = 'failed_page_' + (pageIndex + 1) + '_' + Date.now() + '.' + extension;
      const blobCopy = blob.copyBlob ? blob.copyBlob() : blob;
      if (blobCopy.setName) blobCopy.setName(name);
      const file = failedFolder.createFile(blobCopy);
      logger.warn('Stored failed blob for review', file.getId ? file.getId() : '');
    } catch (err) {
      logger.error('Unable to persist failure blob', err);
    }
  }

  function summariseStatuses_(statuses) {
    if (!statuses.length) return 'partial';
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('partial')) return 'partial';
    return 'success';
  }

  function getGroupForKind_(folders, kind) {
    if (!folders) {
      return null;
    }
    if (kind === 'sale') {
      return folders.sales || folders.expense || null;
    }
    return folders.expense || folders.sales || null;
  }

  function resolveInvoiceGroup_(folders, invoice) {
    const kind = invoice && invoice.kind === 'sale' ? 'sale' : 'expense';
    return getGroupForKind_(folders, kind);
  }

  function summariseKindsForPages_(pageResults) {
    const kinds = new Set();
    for (let i = 0; i < pageResults.length; i += 1) {
      const page = pageResults[i];
      const invoices = page && page.invoices ? page.invoices : [];
      for (let j = 0; j < invoices.length; j += 1) {
        const entry = invoices[j] || {};
        const kind = entry.invoice && entry.invoice.kind ? entry.invoice.kind : 'expense';
        kinds.add(kind);
      }
    }
    if (!kinds.size) {
      return 'expense';
    }
    if (kinds.size === 1) {
      return kinds.values().next().value;
    }
    return 'mixed';
  }

  function resolveAggregatedGroup_(folders, pageResults) {
    const summary = summariseKindsForPages_(pageResults);
    if (summary === 'sale') {
      return { group: getGroupForKind_(folders, 'sale'), kind: 'sale' };
    }
    return { group: getGroupForKind_(folders, 'expense'), kind: summary === 'mixed' ? 'mixed' : 'expense' };
  }

  function moveFile_(file, sourceFolder, destinationFolder) {
    if (!file || !sourceFolder || !destinationFolder) {
      return;
    }

    const fileName = file.getName ? file.getName() : '';
    const hasDebugLogger = logger && typeof logger.debug === 'function';
    const hasWarnLogger = logger && typeof logger.warn === 'function';

    try {
      if (typeof file.moveTo === 'function') {
        file.moveTo(destinationFolder);
        if (hasDebugLogger) {
          logger.debug('Moved file via moveTo', fileName);
        }
        return;
      }
    } catch (err) {
      if (hasWarnLogger) {
        logger.warn('Unable to move file via moveTo; attempting legacy flow', fileName, err);
      }
    }

    let addedToDestination = false;
    try {
      if (typeof destinationFolder.addFile === 'function') {
        destinationFolder.addFile(file);
        addedToDestination = true;
        if (hasDebugLogger) {
          logger.debug('Added file to destination folder (legacy flow)', fileName);
        }
      }
    } catch (addErr) {
      if (hasWarnLogger) {
        logger.warn('Unable to add file to destination folder', fileName, addErr);
      }
      return;
    }

    try {
      if (typeof sourceFolder.removeFile === 'function') {
        sourceFolder.removeFile(file);
        if (hasDebugLogger) {
          logger.debug('Removed file from source folder (legacy flow)', fileName);
        }
      }
    } catch (removeErr) {
      if (hasWarnLogger) {
        logger.warn('Unable to remove file from source folder after legacy move', fileName, removeErr);
      }
      if (addedToDestination && typeof destinationFolder.removeFile === 'function') {
        try {
          destinationFolder.removeFile(file);
        } catch (cleanupErr) {
          if (hasWarnLogger) {
            logger.warn('Unable to cleanup destination folder after failed removal', fileName, cleanupErr);
          }
        }
      }
    }
  }

  function discardDuplicateProcessedFile_(file, sourceFolder) {
    if (!file || !sourceFolder) {
      return;
    }

    try {
      if (typeof sourceFolder.removeFile === 'function') {
        sourceFolder.removeFile(file);
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to remove duplicate processed file from source folder', err);
      }
    }

    if (file && typeof file.setTrashed === 'function') {
      try {
        file.setTrashed(true);
      } catch (err) {
        if (logger && logger.warn) {
          logger.warn('Unable to trash duplicate processed file copy', err);
        }
      }
    }
  }

  function folderHasFileByName_(folder, name) {
    if (!folder || !name || !folder.getFilesByName) {
      return false;
    }

    try {
      const iterator = folder.getFilesByName(name);
      return iterator && typeof iterator.hasNext === 'function' && iterator.hasNext();
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to inspect folder for duplicate originals', name, err);
      }
      return false;
    }
  }

  function archiveOriginal_(file, sourceFolder, originals, options) {
    const keepProcessingCopy = options && options.keepProcessingCopy;
    if (!originals || !originals.today) {
      return { processingFile: file, archived: false };
    }

    try {
      const fileName = file.getName ? file.getName() : '';
      const duplicateOriginal = folderHasFileByName_(originals.today, fileName);
      if (duplicateOriginal) {
        if (logger && logger.info) {
          logger.info('Original already archived – skipping duplicate copy', fileName);
        }
        return { processingFile: file, archived: false };
      }
      if (keepProcessingCopy) {
        if (!file.makeCopy) {
          logger.warn('File does not support makeCopy; skipping archive copy step', fileName);
          return { processingFile: file, archived: false };
        }
        const copy = file.makeCopy ? file.makeCopy(fileName || undefined, sourceFolder) : null;
        if (!copy) {
          logger.warn('makeCopy returned null – using original file for routing', fileName);
          return { processingFile: file, archived: false };
        }
        moveFile_(file, sourceFolder, originals.today);
        return { processingFile: copy, archived: true };
      }

      moveFile_(file, sourceFolder, originals.today);
      return { processingFile: null, archived: true };
    } catch (err) {
      logger.error('Unable to archive original file', err);
      return { processingFile: file, archived: false };
    }
  }

  function ensureOriginalsFolders_(processedFolder) {
    try {
      const originalsRoot = Helpers.getOrCreateSubFolder(processedFolder, FOLDER_NAMES.originals);
      return { root: originalsRoot, today: originalsRoot };
    } catch (err) {
      logger.error('Unable to prepare originals folders', err);
      return null;
    }
  }

  function isPdf_(mimeType, name) {
    return mimeType === 'application/pdf' || (name && /\.pdf$/i.test(name));
  }

  function isImage_(mimeType, name) {
    if (!mimeType && name) {
      return /\.(png|jpg|jpeg)$/i.test(name);
    }
    return /^image\//.test(mimeType);
  }

  function isXml_(mimeType, name) {
    return mimeType === 'text/xml'
      || mimeType === 'application/xml'
      || (name && /\.xml$/i.test(name));
  }

  const testExports = {
    validateSalePayload: validateSalePayload_,
  };

  return {
    get logger() { return logger; },
    setLogger,
    processInvoices,
    __test__: testExports,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Main;
} else {
  this.Main = Main;
}
