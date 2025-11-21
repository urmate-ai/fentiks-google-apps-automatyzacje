const Helpers = (() => {
  const pdfLib = (typeof globalThis !== 'undefined' && globalThis.PDFLib)
    || (typeof PDFLib !== 'undefined' ? PDFLib : undefined)
    || (typeof require !== 'undefined' ? require('./03_pdf-lib') : null);
  const { PDFDocument } = pdfLib || {};

  let logger = this.logger || (typeof require !== 'undefined' && require('./01_logger'));
  let driveWarningLogged = false;

  const FOLDER_COLOR_RULES = [
    { pattern: /^(?:💡\s*)?Invoices automation \(Faktury\)$/i, color: '#9FC6E7' },
    { pattern: /^New\b/i, color: null },
    { pattern: /^Processed\b/i, color: '#CABDBF' },
    { pattern: /^Failed\b/i, color: '#ED6E35' },
    { pattern: /^Originals\b/i, color: '#CABDBF' },
    { pattern: /^Successful\b/i, color: '#A7CD66' },
  ];

  function resolveFolderColor_(name) {
    if (!name) {
      return undefined;
    }

    for (let index = 0; index < FOLDER_COLOR_RULES.length; index += 1) {
      const rule = FOLDER_COLOR_RULES[index];
      if (rule.pattern.test(name)) {
        return rule.color;
      }
    }

    return undefined;
  }

  function getDriveAdvanced_() {
    const candidates = [
      () => (typeof DriveAdvanced !== 'undefined' ? DriveAdvanced : null),
      () => (typeof globalThis !== 'undefined' && globalThis.DriveAdvanced ? globalThis.DriveAdvanced : null),
      () => (typeof Drive !== 'undefined' ? Drive : null),
      () => (typeof globalThis !== 'undefined' && globalThis.Drive ? globalThis.Drive : null),
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const service = candidates[index]();
      if (service) {
        return service;
      }
    }

    if (!driveWarningLogged && logger && logger.warn) {
      logger.warn('Drive Advanced service unavailable; unable to set folder colors');
      driveWarningLogged = true;
    }

    return null;
  }

  function setLogger(l) {
    logger = l;
    driveWarningLogged = false;
  }

  function setFolderColor_(folder) {
    if (!folder || !folder.getId) {
      return;
    }

    const folderName = folder.getName ? folder.getName() : '';
    const desiredColor = resolveFolderColor_(folderName);
    if (desiredColor === undefined) {
      return;
    }

    const driveAdvanced = getDriveAdvanced_();
    if (!driveAdvanced || !driveAdvanced.Files || !driveAdvanced.Files.update) {
      return;
    }

    try {
      const folderId = folder.getId();
      if (!folderId) {
        return;
      }

      const resource = {};
      if (desiredColor === null) {
        resource.folderColorRgb = null;
      } else {
        resource.folderColorRgb = desiredColor;
      }

      driveAdvanced.Files.update(
        resource,
        folderId,
        null,
        { supportsAllDrives: true }
      );
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to set folder color', err);
      }
    }
  }

  function setFolderColor(folder) {
    setFolderColor_(folder);
  }

  function getOrCreateSubFolder(rootFolder, name) {
    const iterator = rootFolder.getFoldersByName(name);
    if (iterator.hasNext()) {
      const folder = iterator.next();
      logger.debug('Found existing subfolder', name, folder.getId ? folder.getId() : '');
      setFolderColor_(folder);
      return folder;
    }
    logger.info('Creating subfolder', name);
    const created = rootFolder.createFolder(name);
    setFolderColor_(created);
    return created;
  }

  function getUtilities() {
    if (typeof Utilities !== 'undefined') {
      return Utilities;
    }
    if (typeof globalThis !== 'undefined' && globalThis.Utilities) {
      return globalThis.Utilities;
    }
    return null;
  }

  function ensureUint8Array(bytes) {
    if (bytes instanceof Uint8Array) {
      return bytes;
    }

    if (Array.isArray(bytes) || typeof bytes.length === 'number') {
      try {
        return Uint8Array.from(bytes);
      } catch (err) {
        if (logger && logger.warn) {
          logger.warn('Unable to convert bytes to Uint8Array, falling back to copy', err);
        }
      }
      return new Uint8Array(Array.prototype.slice.call(bytes));
    }

    if (bytes && bytes.buffer instanceof ArrayBuffer) {
      return new Uint8Array(bytes.buffer);
    }

    throw new Error('Unsupported bytes input for PDF blob');
  }

  function createBlobFromBytes(bytes, name) {
    const uint8 = ensureUint8Array(bytes);
    const utilities = getUtilities();
    if (utilities && utilities.newBlob) {
      const blob = utilities.newBlob(Array.from(uint8), 'application/pdf', name);
      if (blob && blob.setName) {
        blob.setName(name);
      }
      return blob;
    }

    const byteArray = uint8;
    let blobName = name;
    const memoryBlob = {
      getBytes: () => new Uint8Array(byteArray),
      getAs: () => memoryBlob,
      copyBlob: () => createBlobFromBytes(new Uint8Array(byteArray), blobName),
      setName: (newName) => { blobName = newName; },
      getName: () => blobName,
      getContentType: () => 'application/pdf',
    };
    return memoryBlob;
  }

  function normalisePdfName(name) {
    if (!name) {
      return 'invoice.pdf';
    }
    if (/\.pdf$/i.test(name)) {
      return name;
    }
    return name.replace(/\.[^.]+$/, '') + '.pdf';
  }

  async function splitPdfIntoPageBlobs(file) {
    const fileName = file.getName ? file.getName() : 'invoice.pdf';
    const fallback = () => {
      const sourceBlob = file.getBlob ? file.getBlob() : null;
      if (!sourceBlob) {
        return [];
      }
      const pdfBlob = sourceBlob.getAs ? sourceBlob.getAs('application/pdf') : sourceBlob;
      if (pdfBlob && pdfBlob.setName) {
        pdfBlob.setName(normalisePdfName(fileName));
      }
      return [pdfBlob];
    };

    try {
      if (!PDFDocument) {
        throw new Error('PDFDocument unavailable');
      }

      const blob = file.getBlob ? file.getBlob() : null;
      if (!blob || !blob.getBytes) {
        throw new Error('Unable to read PDF bytes');
      }

      const pdfBytes = blob.getBytes ? blob.getBytes() : null;
      if (!pdfBytes || !pdfBytes.length) {
        throw new Error('Empty PDF blob');
      }

      const uint8 = ensureUint8Array(pdfBytes);
      const pdfDoc = await PDFDocument.load(uint8);
      const pageCount = pdfDoc.getPageCount();
      if (!pageCount) {
        throw new Error('PDF has no pages');
      }

      const baseName = fileName.replace(/\.pdf$/i, '');
      const blobs = [];

      for (let index = 0; index < pageCount; index += 1) {
        const pageDoc = await PDFDocument.create();
        const [page] = await pageDoc.copyPages(pdfDoc, [index]);
        pageDoc.addPage(page);
        const pageBytes = await pageDoc.save();
        const pageName = baseName + '_page_' + (index + 1) + '.pdf';
        blobs.push(createBlobFromBytes(pageBytes, pageName));
      }

      return blobs;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Falling back to single PDF blob for', fileName, err);
      }
      return fallback();
    }
  }

  async function ensurePdfBlob(blob, name) {
    if (!blob) {
      throw new Error('Missing blob to convert to PDF');
    }

    const desiredName = normalisePdfName(name || (blob.getName ? blob.getName() : 'invoice.pdf'));
    const contentType = blob.getContentType ? blob.getContentType() : '';

    if (contentType === 'application/pdf') {
      if (blob.setName) {
        blob.setName(desiredName);
      }
      return blob;
    }

    const isImage = /^image\//.test(contentType)
      || (blob.getName && /\.(png|jpg|jpeg)$/i.test(blob.getName()));

    if (!isImage) {
      const pdfBlob = blob.getAs ? blob.getAs('application/pdf') : null;
      if (!pdfBlob) {
        throw new Error('Unsupported blob type for PDF conversion: ' + contentType);
      }
      if (pdfBlob.setName) {
        pdfBlob.setName(desiredName);
      }
      return pdfBlob;
    }

    if (!PDFDocument) {
      const pdfBlob = blob.getAs ? blob.getAs('application/pdf') : null;
      if (!pdfBlob) {
        throw new Error('PDFDocument unavailable and getAs conversion failed');
      }
      if (pdfBlob.setName) {
        pdfBlob.setName(desiredName);
      }
      return pdfBlob;
    }

    if (!blob.getBytes) {
      throw new Error('Unable to read blob bytes for PDF conversion');
    }

    const bytes = blob.getBytes();
    const uint8 = ensureUint8Array(bytes);
    const pdfDoc = await PDFDocument.create();

    const mime = contentType || '';
    let embedded;
    try {
      if (/png$/i.test(mime) || /\.png$/i.test(desiredName)) {
        embedded = await pdfDoc.embedPng(uint8);
      } else {
        embedded = await pdfDoc.embedJpg(uint8);
      }
    } catch (err) {
      if (/png$/i.test(mime) || /\.png$/i.test(desiredName)) {
        embedded = await pdfDoc.embedJpg(uint8);
      } else {
        embedded = await pdfDoc.embedPng(uint8);
      }
    }

    const { width, height } = embedded;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();
    return createBlobFromBytes(pdfBytes, desiredName);
  }

  async function duplicatePdfBlob(blob, name) {
    if (!blob) {
      throw new Error('Missing blob to duplicate');
    }

    const desiredName = normalisePdfName(name || (blob.getName ? blob.getName() : 'invoice.pdf'));

    if (blob.copyBlob) {
      const copy = blob.copyBlob();
      if (copy.setName) {
        copy.setName(desiredName);
      }
      return ensurePdfBlob(copy, desiredName);
    }

    if (blob.getBytes) {
      const bytes = blob.getBytes();
      const uint8 = ensureUint8Array(bytes);
      const duplicate = createBlobFromBytes(uint8, desiredName);
      return ensurePdfBlob(duplicate, desiredName);
    }

    const ensured = await ensurePdfBlob(blob, desiredName);
    if (ensured.setName) {
      ensured.setName(desiredName);
    }
    return ensured;
  }

  // Validation focuses on iFirma payload requirements. Missing mandatory
  // fields yields "failed" so invoices land in the manual review queue.
  // Multicurrency and manual-review flags downgrade the status to "partial".
  function classifyInvoice(invoiceObj, context) {
    if (!invoiceObj || typeof invoiceObj !== 'object') {
      return 'failed';
    }

    const asArray = (value) => (Array.isArray(value) ? value : []);

    const contextMissing = context && Array.isArray(context.missingIfirmaFields)
      ? context.missingIfirmaFields
      : null;
    const missingIfirmaFields = contextMissing
      || (Array.isArray(invoiceObj.ifirmaMissingFields) ? invoiceObj.ifirmaMissingFields : []);

    const filteredMissing = missingIfirmaFields
      .filter((field) => typeof field === 'string' && field.trim())
      .filter((field) => field !== 'PrepareIfirmaFailed')
      .filter((field, index, array) => array.indexOf(field) === index);
    const prepareFailed = filteredMissing.length === 0
      && Array.isArray(missingIfirmaFields)
      && missingIfirmaFields.includes('PrepareIfirmaFailed');

    if (filteredMissing.length || prepareFailed) {
      const flags = filteredMissing.length ? filteredMissing.slice() : ['PrepareIfirmaFailed'];
      invoiceObj.validationFlags = { missingIfirmaFields: flags };
      return 'failed';
    }

    let status = 'success';
    const flags = {};

    const detectedCurrencies = asArray(invoiceObj.detectedCurrencies).filter(Boolean);
    const multiCurrency = detectedCurrencies.length > 1
      || (detectedCurrencies.length === 1
        && invoiceObj.currency
        && detectedCurrencies[0] !== invoiceObj.currency);

    if (multiCurrency) {
      status = 'partial';
      flags.multiCurrency = true;
    }

    if (invoiceObj.requiresManualReview) {
      status = 'partial';
      flags.requiresManualReview = true;
    }

    if (status !== 'success' && Object.keys(flags).length) {
      invoiceObj.validationFlags = flags;
    } else if (invoiceObj.validationFlags) {
      delete invoiceObj.validationFlags;
    }

    return status;
  }

  function getBlobExtension(blob) {
    if (!blob) {
      return 'pdf';
    }

    const name = blob.getName ? blob.getName() : '';
    const match = name && name.match(/\.([a-z0-9]+)$/i);
    if (match) {
      return match[1].toLowerCase();
    }

    const contentType = blob.getContentType ? blob.getContentType() : '';
    if (contentType === 'application/pdf') return 'pdf';
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';

    return 'pdf';
  }

  function formatShortDate_(rawDate) {
    let year;
    let month;
    let day;

    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
      year = rawDate.getFullYear();
      month = rawDate.getMonth() + 1;
      day = rawDate.getDate();
    } else if (typeof rawDate === 'string') {
      const match = rawDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      } else {
        const parsed = new Date(rawDate);
        if (!Number.isNaN(parsed.getTime())) {
          year = parsed.getFullYear();
          month = parsed.getMonth() + 1;
          day = parsed.getDate();
        }
      }
    }

    if (!year || !month || !day) {
      const fallback = new Date();
      year = fallback.getFullYear();
      month = fallback.getMonth() + 1;
      day = fallback.getDate();
    }

    const shortYear = String(year).slice(-2);
    const paddedMonth = String(month).padStart(2, '0');
    const paddedDay = String(day).padStart(2, '0');
    return shortYear + paddedMonth + paddedDay;
  }

  function normaliseTaxId_(taxId) {
    if (taxId === undefined || taxId === null) {
      return 'UNKNOWN';
    }

    const digits = taxId.toString().match(/\d/g);
    if (digits && digits.length) {
      return digits.join('');
    }

    const sanitized = taxId.toString().trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
    return sanitized || 'UNKNOWN';
  }

  function normaliseInvoiceNumber_(invoiceNumber) {
    if (invoiceNumber === undefined || invoiceNumber === null) {
      return 'UNKNOWN';
    }

    const prepared = invoiceNumber
      .toString()
      .trim()
      .toUpperCase()
      .replace(/[\\/]+/g, '-')
      .replace(/\s+/g, '-');

    const sanitized = prepared.replace(/[^A-Z0-9_-]+/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/_{2,}/g, '_')
      .replace(/[-_]+$/g, '')
      .replace(/^[-_]+/g, '');

    return sanitized || 'UNKNOWN';
  }

  function buildOutputFilename(invoiceObj, index, extension) {
    const invoice = invoiceObj || {};
    const ext = extension ? extension.replace(/^\./, '') : 'pdf';
    const issueDate = formatShortDate_(invoice.issueDate);
    const taxId = normaliseTaxId_((invoice.seller && invoice.seller.taxId)
      || (invoice.buyer && invoice.buyer.taxId));
    const invoiceNumber = normaliseInvoiceNumber_(invoice.invoiceNumber);
    return issueDate + '_' + taxId + '_' + invoiceNumber + '.' + ext;
  }

  return {
    setLogger,
    setFolderColor,
    getOrCreateSubFolder,
    splitPdfIntoPageBlobs,
    ensurePdfBlob,
    duplicatePdfBlob,
    getBlobExtension,
    classifyInvoice,
    buildOutputFilename,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Helpers;
} else {
  this.Helpers = Helpers;
}
