function syncGmailToDriveJsonl() {
  return GmailSyncer.syncGmailToDriveJsonl();
}

const GmailSyncer = (() => {
  const logger = (typeof globalThis !== 'undefined' && globalThis.logger)
    || (typeof require !== 'undefined' ? require('./02_logger') : console);
  const DriveHelpers = (typeof globalThis !== 'undefined' && globalThis.DriveHelpers)
    || (typeof require !== 'undefined' ? require('./03_drive') : null);
  const Parser = (typeof globalThis !== 'undefined' && globalThis.GmailParser)
    || (typeof require !== 'undefined' ? require('./04_parser') : null);
  const Config = (typeof require !== 'undefined' ? require('./01_config') : {}) || {};

  const {
    ensureFolderPath,
    getOrCreateFile,
    appendJsonl,
  } = DriveHelpers || {};
  const {
    buildGmailQuery,
    parseMessage,
    getMessageTimestamp,
    isLikelyPersonal,
  } = Parser || {};

  const TARGET_FOLDER_ID = (typeof globalThis !== 'undefined' && globalThis.TARGET_FOLDER_ID !== undefined)
    ? globalThis.TARGET_FOLDER_ID
    : Config.TARGET_FOLDER_ID;
  const THRESHOLD_DAYS = (typeof globalThis !== 'undefined' && globalThis.THRESHOLD_DAYS !== undefined)
    ? globalThis.THRESHOLD_DAYS
    : Config.THRESHOLD_DAYS;
  const MAX_MESSAGES_PER_RUN = (typeof globalThis !== 'undefined'
    && globalThis.MAX_MESSAGES_PER_RUN !== undefined)
    ? globalThis.MAX_MESSAGES_PER_RUN
    : Config.MAX_MESSAGES_PER_RUN;

  const MESSAGES_LIMIT = Math.max(1, Math.floor(MAX_MESSAGES_PER_RUN || 0));
  const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
  const PROCESSED_FILE_NAME = 'processedEmails.jsonl';

  if (!DriveHelpers || !Parser) {
    throw new Error('Required helpers are not available');
  }

  function resolveStorageDetails(parsedMessage) {
    const isoDate = parsedMessage && parsedMessage.gmail && parsedMessage.gmail.received_at;
    if (!isoDate) {
      return {
        folderParts: ['unknown'],
        fileName: 'undated.jsonl',
      };
    }
    const year = isoDate.slice(0, 4);
    const month = isoDate.slice(0, 7);
    const day = isoDate.slice(0, 10);
    return {
      folderParts: [year, month],
      fileName: `${day}.jsonl`,
    };
  }

  function getThresholdTimestamp(nowMs) {
    if (!Number.isFinite(THRESHOLD_DAYS) || THRESHOLD_DAYS <= 0) {
      return 0;
    }
    return Math.max(0, nowMs - THRESHOLD_DAYS * MILLIS_PER_DAY);
  }

  function parseProcessedRecord(line) {
    if (!line) {
      return null;
    }
    try {
      const parsed = JSON.parse(line);
      const gmailId = parsed.gmail_id || parsed.id || (parsed.gmail && parsed.gmail.message_id);
      if (!gmailId) {
        return null;
      }
      const rawTimestamp = parsed.received_internaldate_ms
        || (parsed.gmail && parsed.gmail.received_internaldate_ms)
        || null;
      const timestamp = Number.isFinite(rawTimestamp)
        ? Number(rawTimestamp)
        : (() => {
          const iso = parsed.received_at
            || (parsed.gmail && parsed.gmail.received_at)
            || null;
          const isoTimestamp = iso ? Date.parse(iso) : NaN;
          return Number.isFinite(isoTimestamp) ? isoTimestamp : 0;
        })();
      if (!timestamp) {
        return null;
      }
      const receivedAt = parsed.received_at
        || (parsed.gmail && parsed.gmail.received_at)
        || new Date(timestamp).toISOString();
      return {
        gmail_id: String(gmailId),
        received_internaldate_ms: timestamp,
        received_at: receivedAt,
      };
    } catch (error) {
      logger.warn('Nie udało się sparsować wpisu processedEmails', error);
      return null;
    }
  }

  function loadProcessedEmailsContext(rootFolder) {
    const file = getOrCreateFile(rootFolder, PROCESSED_FILE_NAME);
    const rawContent = file && typeof file.getBlob === 'function'
      ? file.getBlob().getDataAsString('UTF-8')
      : '';
    const entries = [];
    const knownIds = new Set();

    if (rawContent) {
      rawContent
        .split('\n')
        .map((line) => (line && line.trim()) || '')
        .filter(Boolean)
        .forEach((line) => {
          const record = parseProcessedRecord(line);
          if (record && !knownIds.has(record.gmail_id)) {
            entries.push(record);
            knownIds.add(record.gmail_id);
          }
        });
    }

    entries.sort((a, b) => b.received_internaldate_ms - a.received_internaldate_ms);

    const newestTimestamp = entries.length ? entries[0].received_internaldate_ms : 0;
    const oldestTimestamp = entries.length
      ? entries[entries.length - 1].received_internaldate_ms
      : 0;

    return {
      file,
      entries,
      knownIds,
      newestTimestamp,
      oldestTimestamp,
    };
  }

  function saveProcessedEmails(file, entries) {
    const sorted = entries.slice().sort((a, b) => {
      if (a.received_internaldate_ms !== b.received_internaldate_ms) {
        return b.received_internaldate_ms - a.received_internaldate_ms;
      }
      return a.gmail_id.localeCompare(b.gmail_id);
    });
    const payload = sorted
      .map((entry) => JSON.stringify({
        gmail_id: entry.gmail_id,
        received_internaldate_ms: entry.received_internaldate_ms,
        received_at: entry.received_at,
      }))
      .join('\n');
    const finalContent = payload ? `${payload}\n` : '';
    if (file && typeof file.setContent === 'function') {
      file.setContent(finalContent);
      return;
    }
    if (file && typeof file.getBlob === 'function' && typeof file.getId === 'function'
      && Drive && Drive.Files && typeof Drive.Files.update === 'function'
      && typeof Utilities !== 'undefined' && Utilities && typeof Utilities.newBlob === 'function') {
      const blob = Utilities.newBlob(finalContent, 'application/json', file.getName());
      Drive.Files.update({}, file.getId(), blob);
      return;
    }
    throw new Error('Brak możliwości zapisania pliku processedEmails.jsonl');
  }

  function mergeProcessedEntries(existingEntries, newEntries) {
    const map = new Map();
    existingEntries.forEach((entry) => {
      if (entry && entry.gmail_id) {
        map.set(entry.gmail_id, entry);
      }
    });
    newEntries.forEach((entry) => {
      if (entry && entry.gmail_id) {
        map.set(entry.gmail_id, entry);
      }
    });
    return Array.from(map.values());
  }

  function fetchMessage(metaId) {
    try {
      const message = Gmail.Users.Messages.get('me', metaId, { format: 'full' });
      return message;
    } catch (error) {
      logger.error('Nie udało się pobrać szczegółów wiadomości Gmail', metaId, error);
      return null;
    }
  }

  function shouldSkipMessage(message, parsed) {
    if (!parsed) {
      return true;
    }
    if (!isLikelyPersonal(message, parsed)) {
      return true;
    }
    return false;
  }

  function collectFromQuery({
    queryOptions,
    limit,
    logLabel,
    processedIds,
    boundaryCheck,
  }) {
    const collected = [];
    let nextPageToken = null;

    do {
      const remaining = limit - collected.length;
      if (remaining <= 0) {
        break;
      }

      const query = buildGmailQuery('', queryOptions);
      logger.info('Pobieram wiadomości Gmail', logLabel, query);

      const response = Gmail.Users.Messages.list('me', {
        q: query,
        maxResults: Math.min(remaining, 100),
        pageToken: nextPageToken || undefined,
        includeSpamTrash: false,
      });

      const messages = (response && response.messages) || [];
      logger.info('Odebrano listę wiadomości Gmail', logLabel, `liczba=${messages.length}`);

      for (let index = 0; index < messages.length && collected.length < limit; index += 1) {
        const meta = messages[index];
        if (!meta || !meta.id) {
          continue;
        }
        if (processedIds.has(meta.id)) {
          logger.debug('Pomijam wiadomość - już przetworzona', meta.id);
          continue;
        }
        const message = fetchMessage(meta.id);
        if (!message) {
          continue;
        }
        const parsed = parseMessage(message);
        if (shouldSkipMessage(message, parsed)) {
          logger.debug('Pomijam wiadomość - nie spełnia kryteriów', meta.id);
          continue;
        }
        const timestamp = getMessageTimestamp(parsed);
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
          logger.debug('Pomijam wiadomość - brak znacznika czasu', meta.id);
          continue;
        }
        if (boundaryCheck && boundaryCheck(timestamp) === false) {
          logger.debug('Pomijam wiadomość - poza zakresem czasowym', meta.id, timestamp);
          continue;
        }
        collected.push({
          metaId: meta.id,
          timestamp,
          parsed,
        });
        processedIds.add(meta.id);
      }

      if (response && response.nextPageToken) {
        nextPageToken = response.nextPageToken;
      } else {
        nextPageToken = null;
      }

      if (!messages.length) {
        nextPageToken = null;
      }
    } while (nextPageToken);

    return {
      collected,
    };
  }

  function fetchMessagesNewerThan({ sinceTimestamp, limit, processedIds }) {
    const queryOptions = {};
    if (Number.isFinite(sinceTimestamp) && sinceTimestamp > 0) {
      queryOptions.afterTimestamp = sinceTimestamp;
    }
    return collectFromQuery({
      queryOptions,
      limit,
      logLabel: 'nowsze',
      processedIds,
      boundaryCheck: (timestamp) => !sinceTimestamp || timestamp > sinceTimestamp,
    });
  }

  function fetchMessagesOlderThan({ beforeTimestamp, afterTimestamp, limit, processedIds }) {
    const queryOptions = {};
    if (Number.isFinite(afterTimestamp) && afterTimestamp > 0) {
      queryOptions.afterTimestamp = afterTimestamp;
    }
    if (Number.isFinite(beforeTimestamp) && beforeTimestamp > 0) {
      queryOptions.beforeTimestamp = beforeTimestamp;
    }
    return collectFromQuery({
      queryOptions,
      limit,
      logLabel: 'starsze',
      processedIds,
      boundaryCheck: (timestamp) => {
        if (Number.isFinite(beforeTimestamp) && beforeTimestamp > 0 && timestamp >= beforeTimestamp) {
          return false;
        }
        if (Number.isFinite(afterTimestamp) && afterTimestamp > 0 && timestamp <= afterTimestamp) {
          return false;
        }
        return true;
      },
    });
  }

  function syncGmail() {
    if (!TARGET_FOLDER_ID) {
      throw new Error('TARGET_FOLDER_ID is not configured');
    }

    const nowMs = Date.now();
    const targetFolder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    const thresholdTimestamp = getThresholdTimestamp(nowMs);
    const processedContext = loadProcessedEmailsContext(targetFolder);
    const processedIds = new Set(processedContext.knownIds);

    const newerResult = fetchMessagesNewerThan({
      sinceTimestamp: processedContext.newestTimestamp,
      limit: MESSAGES_LIMIT,
      processedIds,
    });

    let collected = newerResult.collected;
    const remaining = MESSAGES_LIMIT - collected.length;

    if (remaining > 0 && processedContext.entries.length > 0) {
      const beforeTimestamp = processedContext.oldestTimestamp > 0
        ? processedContext.oldestTimestamp
        : processedContext.newestTimestamp;
      const olderResult = fetchMessagesOlderThan({
        beforeTimestamp,
        afterTimestamp: thresholdTimestamp,
        limit: remaining,
        processedIds,
      });
      collected = collected.concat(olderResult.collected);
    }

    if (!collected.length) {
      logger.info('Brak nowych konwersacji do synchronizacji');
      return 0;
    }

    collected.sort((a, b) => a.timestamp - b.timestamp);

    let totalWritten = 0;
    const processedUpdates = [];

    collected.forEach(({ parsed }) => {
      try {
        const storage = resolveStorageDetails(parsed);
        const folder = ensureFolderPath(targetFolder, storage.folderParts);
        const file = getOrCreateFile(folder, storage.fileName);
        logger.info(
          'Zapisuję wiadomość Gmail',
          storage.folderParts.join('/') || '(root)',
          storage.fileName,
        );
        const enriched = Object.assign({}, parsed, {
          sync_metadata: Object.assign({}, parsed.sync_metadata, {
            synced_at: new Date().toISOString(),
            storage_hint: {
              folder_parts: storage.folderParts,
              file_name: storage.fileName,
            },
          }),
        });
        appendJsonl(file, enriched);
        totalWritten += 1;
        const ts = getMessageTimestamp(enriched);
        const receivedAt = enriched
          && enriched.gmail
          && enriched.gmail.received_at
          ? enriched.gmail.received_at
          : new Date(ts).toISOString();
        processedUpdates.push({
          gmail_id: enriched.gmail.message_id,
          received_internaldate_ms: ts,
          received_at: receivedAt,
        });
      } catch (error) {
        logger.error('Nie udało się zapisać wiadomości Gmail', error);
      }
    });

    logger.info(`Zapisano ${totalWritten} wiadomości w strukturze rocznej/miesięcznej`);

    if (processedUpdates.length) {
      const merged = mergeProcessedEntries(processedContext.entries, processedUpdates);
      saveProcessedEmails(processedContext.file, merged);
    }

    return totalWritten;
  }

  return {
    resolveStorageDetails,
    getThresholdTimestamp,
    syncGmailToDriveJsonl: syncGmail,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.syncGmailToDriveJsonl = syncGmailToDriveJsonl;
  globalThis.GmailSyncer = GmailSyncer;
}

if (typeof module !== 'undefined') {
  module.exports = GmailSyncer;
}
