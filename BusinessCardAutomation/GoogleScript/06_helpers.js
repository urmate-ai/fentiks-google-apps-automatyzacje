const Helpers = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./02_logger'));

  function setLogger(l) { logger = l; }

  /**
   * Miscellaneous helper functions.
   */
  function isSupportedImageMime_(mime) {
    // Extend as needed
    return [
      MimeType.JPEG,
      MimeType.PNG,
      MimeType.GIF,
      MimeType.TIFF,
      'image/webp',
      'image/heic',
      'image/heif'
    ].includes(mime);
  }

  function getOrCreateSubfolder_(parent, name) {
    const it = parent.getFoldersByName(name);
    if (it.hasNext()) {
      const existing = it.next();
      logger.debug('Using existing subfolder', name);
      return existing;
    }
    logger.info('Creating subfolder', name);
    return parent.createFolder(name);
  }

  function isInSubfolder_(file, subfolder) {
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === subfolder.getId()) return true;
    }
    return false;
  }

  function getOrCreateSheet_(folder, title, headers) {
    // Find existing Sheet in folder
  const files = folder.getFilesByName(title);
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      logger.debug('Using existing sheet', title);
      const sh = SpreadsheetApp.openById(f.getId()).getActiveSheet();
      return sh;
    }
  }
  // Create new spreadsheet and move it to folder
  logger.info('Creating new sheet', title);
  const ss = SpreadsheetApp.create(title);
  const file = DriveApp.getFileById(ss.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  const sh = ss.getActiveSheet();
  sh.clear();
  sh.appendRow(headers);
  return sh;
}

function exportSheetToXlsxInFolder_(sheet, folder, filename) {
  const ssId = sheet.getParent().getId();
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
  const options = {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };

  logger.info('Exporting sheet', sheet.getName ? sheet.getName() : '', 'to XLSX', filename, 'in folder', folder.getName ? folder.getName() : '');
  const xlsxBlob = UrlFetchApp.fetch(url, options).getBlob().setName(filename);

  // Delete any existing file with the same name
  const existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);

  // Save the new XLSX file
  folder.createFile(xlsxBlob);
  logger.info('Export complete', filename);
}

function getOrCreateSheetFromTemplate_(templateFile, subfolder) {
  const title = subfolder.getName();
  logger.debug('Ensuring sheet for subfolder', title);

  // 0) If a file with this name already exists in the subfolder → open it
  const existing = subfolder.getFilesByName(title);
  while (existing.hasNext()) {
    const f = existing.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      logger.debug('Found existing sheet in subfolder', title);
      return SpreadsheetApp.openById(f.getId()).getActiveSheet();
    }
  }

  // 1) Detect template MIME type
  const templateMime = templateFile.getMimeType();
  logger.debug('Template mime type for', title, templateMime);

  // 2) If template is already a native Google Sheet → makeCopy() is fine
  if (templateMime === MimeType.GOOGLE_SHEETS) {
    logger.debug('Copying native Google Sheet template for', title);
    const copy = templateFile.makeCopy(title, subfolder);
    const newId = copy.getId();
    const sh = openSpreadsheetWithRetry_(newId, 12, 1000); // up to ~12s
    logger.debug('Created sheet from native template for', title);
    return sh;
  }

  // 3) Otherwise we must CONVERT (e.g., from XLSX) → use Advanced Drive with convert:true
  //    This returns a Google-native Spreadsheet file.
  logger.debug('Converting and copying template for', title);
  const copied = Drive.Files.copy(
    { title: title, mimeType: MimeType.GOOGLE_SHEETS },
    templateFile.getId(),
    { convert: true }
  );

  const file = DriveApp.getFileById(copied.id);
  file.setName(title);
  subfolder.addFile(file);
  // Optional: keep Drive tidy (remove from My Drive root)
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) { /* ignore if no permission */ }

  // 4) Wait until the converted file is actually ready for SpreadsheetApp
  const sh = openSpreadsheetWithRetry_(copied.id, 20, 1000); // up to ~20s for slow conversions
  logger.debug('Created sheet from converted template for', title);
  return sh;
}

/**
 * Robustly opens a Spreadsheet by ID with retry+backoff.
 * @param {string} id Spreadsheet file ID
 * @param {number} attempts number of attempts
 * @param {number} baseDelayMs base delay in ms (exponential backoff)
 */
function openSpreadsheetWithRetry_(id, attempts, baseDelayMs) {
  logger.debug('Opening spreadsheet with retry', id, 'attempts', attempts);
  // Try opening; if not ready yet, back off and retry
  for (let i = 0; i < attempts; i++) {
    try {
      logger.debug('Attempt', i + 1, 'to open spreadsheet', id);
      // Additional safeguard: ensure Drive reports Google Sheets MIME
      const meta = Drive.Files.get(id);
      if (meta.mimeType === MimeType.GOOGLE_SHEETS) {
        const sh = SpreadsheetApp.openById(id).getActiveSheet();
        logger.debug('Spreadsheet opened on attempt', i + 1, id);
        return sh;
      }
    } catch (e) {
      // swallow and retry
      logger.debug('Spreadsheet not ready, retrying', id, e);
    }
    Utilities.sleep(baseDelayMs * Math.pow(1.2, i)); // exponential-ish backoff
  }
  throw new Error('Unable to open the spreadsheet after multiple attempts: ' + id);
}


function appendRowWithLp_(sheet, data) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // Read header row to map columns
  // Dynamically detect header row: must contain both "imie" and "nazw" after normalization
  let headerRow = null;
  let headers = null;
  for (let r = 1; r <= lastRow; r++) {
    const rowValues = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    const normalizedRow = rowValues.map(v => normalize_(v));
    if (normalizedRow.some(v => v.includes("imie")) && normalizedRow.some(v => v.includes("nazw"))) {
      headerRow = r;
      headers = rowValues;
      logger.debug('Detected header row:', headerRow, headers);
      break;
    }
  }

  if (!headers) {
    throw new Error("No header row found (must contain imie and nazw)");
  }

  const patterns = {
    lp: ['l.p'],
    imie: ['imie', 'imię'],
    nazwisko: ['nazw'],
    email: ['email', 'e-mail'],
    stanowisko: ['stanow'],
    pesel: ['pesel'],
    telefon: ['telefon'],
    firma: ['firma', 'nazwa firmy'],
    ulica: ['ulica'],
    nr_domu: ['dom'],
    kod_pocztowy: ['kod poczt'],
    miasto: ['miasto'],
    filename: ['nazwa pliku'],
    fileid: ['id pliku', 'file id'],
    timestamp: [ 'czas wpisania' ]
  };

  function normalize_(str) {
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  const colIndex = {};
  headers.forEach((h, idx) => {
    const normHeader = normalize_(h);
    logger.debug('Header:', h, '->', normHeader);
    for (const [key, pats] of Object.entries(patterns)) {
      for (const p of pats) {
        const normPattern = normalize_(p);
        if (
          (normHeader === normPattern || normHeader.includes(normPattern)) &&
          colIndex[key] === undefined
        ) {
          colIndex[key] = idx + 1;
          logger.debug('  MATCH!', key, 'at column', idx + 1);
          break;
        }
      }
    }
  });
  logger.debug('Final colIndex:', JSON.stringify(colIndex));

  const lpCol = colIndex.lp || 1;
  const imieCol = colIndex.imie || 2;
  const nazwiskoCol = colIndex.nazwisko || 3;

  // Search for first empty row (lp numeric, imie & nazwisko empty)
  const all = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  // Skip adding if imie+nazwisko already exist (case and accent insensitive)
  const normImie = normalize_(data.imie || '');
  const normNazwisko = normalize_(data.nazwisko || '');
  for (let i = headerRow; i < all.length; i++) {
    const row = all[i];
    if (
      normalize_(row[imieCol - 1]) === normImie &&
      normalize_(row[nazwiskoCol - 1]) === normNazwisko &&
      normImie !== '' &&
      normNazwisko !== ''
    ) {
      logger.info('Duplicate entry found for', data.imie, data.nazwisko, '– skipping');
      return false;
    }
  }
  let targetRow = null;
  for (let i = 1; i < all.length; i++) {
    const row = all[i];
    if (
      typeof row[lpCol - 1] === 'number' &&
      row[imieCol - 1] === '' &&
      row[nazwiskoCol - 1] === ''
    ) {
      targetRow = i + 1; // 1-based
      break;
    }
  }

  if (targetRow) {
    logger.debug('Filling existing row', targetRow, data);
    const range = sheet.getRange(targetRow, 1, 1, lastCol);
    const row = range.getValues()[0];
    for (const [key, val] of Object.entries(data)) {
      const col = colIndex[key];
      if (col) row[col - 1] = val;
    }
    range.setValues([row]);
  } else {
    const row = new Array(lastCol).fill('');
    row[lpCol - 1] = lastRow;
    for (const [key, val] of Object.entries(data)) {
      const col = colIndex[key];
      if (col) row[col - 1] = val;
    }
    logger.debug('Appending row', row);
    sheet.appendRow(row);
  }
  return true;
  }

  return {
    setLogger,
    isSupportedImageMime_,
    getOrCreateSubfolder_,
    isInSubfolder_,
    getOrCreateSheet_,
    exportSheetToXlsxInFolder_,
    getOrCreateSheetFromTemplate_,
    appendRowWithLp_,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Helpers;
} else {
  this.Helpers = Helpers;
}
