function processBusinessCardsGemini() {
  return Main.processBusinessCardsGemini();
}

const Main = (() => {
  const logger = this.logger || (typeof require !== 'undefined' && require('./02_logger'));
  const Helpers = globalThis.Helpers || (typeof require !== 'undefined' ? require('./06_helpers') : this.Helpers);
  const Gemini = globalThis.Gemini || (typeof require !== 'undefined' ? require('./04_gemini') : this.Gemini);
  const Hubspot = globalThis.Hubspot || (typeof require !== 'undefined' ? require('./03_hubspot') : this.Hubspot);
  const MessageSender = globalThis.MessageSender || (typeof require !== 'undefined' ? require('./05_messageSender') : this.MessageSender);

  const FAILED_FOLDER_NAME = 'Błędne wizytówki';

  function normalizeContact_(contact) {
    const normalized = Object.assign({}, contact);
    normalized.imie = normalizeNamePart_(contact.imie);
    normalized.nazwisko = normalizeNamePart_(contact.nazwisko);
    normalized.telefon = normalizePhoneNumber_(contact.telefon);
    return normalized;
  }

  function normalizeNamePart_(value) {
    if (value === null || value === undefined) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';

    return trimmed
      .split(/\s+/)
      .map(word =>
        word
          .split('-')
          .map(segment => capitalizeSegment_(segment))
          .join('-')
      )
      .join(' ');
  }

  function capitalizeSegment_(segment) {
    if (!segment) return '';
    const lower = segment.toLocaleLowerCase ? segment.toLocaleLowerCase('pl-PL') : segment.toLowerCase();
    const firstChar = lower.charAt(0);
    const rest = lower.slice(1);
    const upperFirst = firstChar.toLocaleUpperCase ? firstChar.toLocaleUpperCase('pl-PL') : firstChar.toUpperCase();
    return upperFirst + rest;
  }

  function normalizePhoneNumber_(value) {
    if (value === null || value === undefined) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';

    const sanitized = trimmed.replace(/[^+\d]/g, '');
    const digits = sanitized.replace(/\D/g, '');
    if (!digits) return '';

    const hasPlus = sanitized.startsWith('+');
    let prefix = '';
    let national = digits;

    if (hasPlus) {
      if (digits.length > 9) {
        const prefixDigits = digits.slice(0, digits.length - 9);
        prefix = '+' + prefixDigits;
        national = digits.slice(-9);
      } else {
        prefix = '+' + digits;
        national = '';
      }
    } else if (digits.startsWith('0048') && digits.length >= 13) {
      prefix = '+48';
      national = digits.slice(-9);
    } else if (digits.length >= 11 && digits.startsWith('48')) {
      prefix = '+48';
      national = digits.slice(-9);
    } else {
      national = digits;
    }

    if (!national) {
      return prefix || '';
    }

    const groups = national.match(/\d{1,3}/g) || [];
    const grouped = groups.join(' ');
    return prefix ? `${prefix} ${grouped}`.trim() : grouped;
  }

  /**
   * Entry point for processing business cards in all subfolders.
   */
  function processBusinessCardsGemini() {
    logger.info('Starting processBusinessCardsGemini');
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) {
      logger.info('processBusinessCardsGemini already running, skipping');
      return;
    }
    try {
      const root = DriveApp.getFolderById(FOLDER_ID);
      logger.debug('Using root folder', root.getName ? root.getName() : '', '(' + FOLDER_ID + ')');
      const templateIt = root.getFilesByName(TEMPLATE_NAME);
      if (!templateIt.hasNext()) throw new Error('Missing template "' + TEMPLATE_NAME + '"');
      const template = templateIt.next();
      logger.debug('Found template', template.getName ? template.getName() : TEMPLATE_NAME);

      const subfolders = root.getFolders();
      while (subfolders.hasNext()) {
        const folder = subfolders.next();
        if (folder.getName() === 'Przepisane Wizytówki') continue;

        logger.info('Processing subfolder', folder.getName());
        const sheet = Helpers.getOrCreateSheetFromTemplate_(template, folder);
        processFolder_(folder, sheet);
      }
      logger.info('Finished processBusinessCardsGemini');
    } finally {
      lock.releaseLock();
    }
  }

  function moveFileWithFallback_(folder, targetFolder, file, contextLabel) {
    if (!targetFolder) return false;

    try {
      file.moveTo(targetFolder);
      logger.debug('Moved file to ' + contextLabel + ' via moveTo', file.getName());
      return true;
    } catch (moveErr) {
      logger.warn('Unable to move file to ' + contextLabel + ' via moveTo; attempting legacy flow', file.getName(), moveErr);
    }

    try {
      targetFolder.addFile(file);
    } catch (addErr) {
      logger.warn('Unable to add file to ' + contextLabel, file.getName(), addErr);
      return false;
    }

    try {
      folder.removeFile(file);
      logger.debug('Moved file to ' + contextLabel + ' (legacy flow)', file.getName());
      return true;
    } catch (removeErr) {
      logger.warn(
        'Unable to remove file from original folder when moving to ' + contextLabel,
        file.getName(),
        removeErr
      );
      try {
        targetFolder.removeFile && targetFolder.removeFile(file);
      } catch (cleanupErr) {
        logger.warn(
          'Additionally failed to cleanup ' + contextLabel + ' after removal failure',
          file.getName(),
          cleanupErr
        );
      }
    }

    return false;
  }

  function moveFileToProcessed_(folder, processed, file) {
    let targetFolder = processed;
    if (!targetFolder) {
      try {
        targetFolder = Helpers.getOrCreateSubfolder_(folder, 'Przepisane Wizytówki');
      } catch (err) {
        logger.warn('Unable to access processed subfolder for', file.getName(), err);
        return processed;
      }
    }

    if (!targetFolder) return processed;

    moveFileWithFallback_(folder, targetFolder, file, 'processed subfolder');
    return targetFolder;
  }

  function processFolder_(folder, sheet) {
    logger.debug('processFolder_ scanning folder', folder.getName());
    let processedIt = folder.getFoldersByName('Przepisane Wizytówki');
    let processed = processedIt.hasNext() ? processedIt.next() : null;
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) {
        logger.debug('Skipping trashed file', f.getName());
        continue;
      }
      const mime = f.getMimeType();
      logger.debug('Checking file', f.getName(), 'mime', mime);
      if (mime === MimeType.GOOGLE_SHEETS) {
        logger.debug('Skipping Google Sheet', f.getName());
        continue;
      }
      if (processed && Helpers.isInSubfolder_(f, processed)) {
        logger.debug('Skipping already processed file', f.getName());
        continue;
      }
      if (!Helpers.isSupportedImageMime_(mime)) {
        logger.warn('Unsupported mime type for', f.getName(), mime);
        moveFileToFailed_(folder, f);
        continue;
      }

      try {
        logger.info('Extracting data from', f.getName());
        const data = Gemini.extractWithGeminiFromImage_(f);
        logger.info('Extraction result for', f.getName(), data);
        const ownerObj = f.getOwner && f.getOwner();
        const rawContact = {
          imie: data.imie || '',
          nazwisko: data.nazwisko || '',
          email: data.email || '',
          stanowisko: data.stanowisko || '',
          pesel: data.pesel || '',
          telefon: data.telefon || '',
          firma: data.firma || '',
          ulica: data.ulica || '',
          nr_domu: data.nr_domu || '',
          kod_pocztowy: data.kod_pocztowy || '',
          miasto: data.miasto || '',
          uploader_email: ownerObj && ownerObj.getEmail ? ownerObj.getEmail() : '',
          uploader_name: ownerObj && ownerObj.getName ? ownerObj.getName() : '',
          filename: f.getName(),
          fileid: f.getId(),
          timestamp: new Date(),
        };
        const contact = normalizeContact_(rawContact);
        if (!contact.imie || !contact.nazwisko) {
          logger.warn('Missing name or surname for', f.getName(), '- moving to failed folder');
          moveFileToFailed_(folder, f);
          continue;
        }
        const added = Helpers.appendRowWithLp_(sheet, contact);
        const hubspotId = Hubspot.sendToHubspot_(contact);
        if (hubspotId) {
          contact.hubspotId = hubspotId;
        }
        if (added) {
          MessageSender.sendMessage(contact);
        } else {
          logger.info('Duplicate contact, skipping sheet for', f.getName());
        }
        processed = moveFileToProcessed_(folder, processed, f);
      } catch (err) {
        logger.error('Failed on file:', f.getName(), err);
        moveFileToFailed_(folder, f);
      }
    }
  }

  function moveFileToFailed_(folder, file) {
    let failed;
    try {
      failed = Helpers.getOrCreateSubfolder_(folder, FAILED_FOLDER_NAME);
    } catch (err) {
      logger.warn('Unable to access failed subfolder for', file.getName(), err);
      return;
    }

    if (!failed) return;

    moveFileWithFallback_(folder, failed, file, 'failed subfolder');
  }

  return { processBusinessCardsGemini, processFolder_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Main;
} else {
  this.Main = Main;
}
