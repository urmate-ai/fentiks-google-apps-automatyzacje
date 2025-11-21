const Slack = (() => {
  let logger = this.logger || (typeof require !== 'undefined' ? require('./01_logger') : null);

  const DEFAULT_WEBHOOK_URL = 'https://hooks.slack.com/services/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';

  const IFIRMA_ERROR_CODES = {
    0: { description: 'poprawne przetworzenie', notify: false },
    100: { description: 'problem techniczny', notify: true },
    101: { description: 'niepoprawne kodowanie znaków', notify: true },
    102: { description: 'brak lub niepoprawnie określony typ zawartości żądania', notify: true },
    200: { description: 'niepoprawna struktura obiektu domenowego', notify: true },
    201: { description: 'błędy walidacji przesyłanego obiektu w postaci żądania', notify: true },
    202: { description: 'niepoprawne ustawienia w serwisie ifirma', notify: true },
    400: { description: 'niepoprawny nagłówek autoryzacji', notify: true },
    401: { description: 'niepoprawny login użytkownika', notify: true },
    402: { description: 'brak wygenerowanego klucza autoryzacji', notify: true },
    403: { description: 'niepoprawny hash bądź kod wiadomości', notify: true },
    499: {
      description: 'brak akceptacji regulaminu ifirma.pl – zaloguj się w ifirma.pl w celu zaakceptowania regulaminu',
      notify: true,
    },
    500: { description: 'brak uprawnień do danego zasobu', notify: true },
  };

  function toNumericCodeKey_(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return String(numeric);
      }
    }

    return null;
  }

  function parseBoolean_(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        return value !== 0;
      }
      return null;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
      return null;
    }

    return null;
  }

  function normalizeOverrideSource_(source, defaultValue) {
    const map = {};
    if (source == null) {
      return map;
    }

    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (!trimmed) {
        return map;
      }

      if (/^[\[{]/.test(trimmed)) {
        try {
          const parsed = JSON.parse(trimmed);
          return normalizeOverrideSource_(parsed, defaultValue);
        } catch (err) {
          // fall through to treating as a delimited list
        }
      }

      const segments = trimmed.split(/[\s,;]+/).filter((segment) => segment);
      segments.forEach((segment) => {
        const key = toNumericCodeKey_(segment);
        if (!key) {
          return;
        }
        const boolValue = defaultValue !== undefined ? defaultValue : parseBoolean_(segment);
        if (boolValue !== null) {
          map[key] = boolValue;
        } else if (defaultValue !== undefined) {
          map[key] = defaultValue;
        }
      });
      return map;
    }

    if (Array.isArray(source)) {
      source.forEach((entry) => {
        if (entry && typeof entry === 'object') {
          const nested = normalizeOverrideSource_(entry, defaultValue);
          Object.keys(nested).forEach((key) => {
            map[key] = nested[key];
          });
          return;
        }
        const key = toNumericCodeKey_(entry);
        if (!key) {
          return;
        }
        const boolValue = defaultValue !== undefined ? defaultValue : true;
        map[key] = boolValue;
      });
      return map;
    }

    if (typeof source === 'number') {
      const key = toNumericCodeKey_(source);
      if (key) {
        map[key] = defaultValue !== undefined ? defaultValue : true;
      }
      return map;
    }

    if (typeof source === 'object') {
      Object.keys(source).forEach((rawKey) => {
        const key = toNumericCodeKey_(rawKey);
        if (!key) {
          const nested = normalizeOverrideSource_(source[rawKey], defaultValue);
          Object.keys(nested).forEach((nestedKey) => {
            map[nestedKey] = nested[nestedKey];
          });
          return;
        }
        let boolValue = parseBoolean_(source[rawKey]);
        if (boolValue === null) {
          if (defaultValue === undefined) {
            return;
          }
          boolValue = defaultValue;
        }
        map[key] = boolValue;
      });
      return map;
    }

    return map;
  }

  function mergeOverrides_(target, source, defaultValue) {
    const map = normalizeOverrideSource_(source, defaultValue);
    Object.keys(map).forEach((key) => {
      target[key] = map[key];
    });
  }

  function safeString(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function formatAmount(amount, currency) {
    if (amount === null || amount === undefined || amount === '') {
      return null;
    }
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const currencyCode = safeString(currency) || 'PLN';
    return numeric.toFixed(2) + ' ' + currencyCode;
  }

  function setLogger(l) {
    logger = l;
  }

  function normalizeWebhookUrl_(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  function getScriptProperties_() {
    try {
      const service = typeof PropertiesService !== 'undefined'
        ? PropertiesService
        : (typeof globalThis !== 'undefined' ? globalThis.PropertiesService : null);
      if (!service || !service.getScriptProperties) {
        return null;
      }
      const scriptProperties = service.getScriptProperties();
      if (!scriptProperties || !scriptProperties.getProperty) {
        return null;
      }
      return scriptProperties;
    } catch (err) {
      return null;
    }
  }

  function resolveWebhookUrl_(explicit) {
    const candidates = [
      () => normalizeWebhookUrl_(explicit),
      () => {
        if (typeof IFIRMA_SLACK_WEBHOOK_URL !== 'undefined') {
          return normalizeWebhookUrl_(IFIRMA_SLACK_WEBHOOK_URL);
        }
        return null;
      },
      () => {
        if (typeof SLACK_WEBHOOK_URL !== 'undefined') {
          return normalizeWebhookUrl_(SLACK_WEBHOOK_URL);
        }
        return null;
      },
      () => {
        const scriptProperties = getScriptProperties_();
        if (!scriptProperties) {
          return null;
        }
        const propertyValue = scriptProperties.getProperty('IFIRMA_SLACK_WEBHOOK_URL')
          || scriptProperties.getProperty('SLACK_WEBHOOK_URL');
        return normalizeWebhookUrl_(propertyValue);
      },
      () => normalizeWebhookUrl_(DEFAULT_WEBHOOK_URL),
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const value = candidates[index]();
      if (value) {
        return value;
      }
    }

    return null;
  }

  function getIfirmaCodeEntry_(code) {
    const key = toNumericCodeKey_(code);
    if (!key) {
      return null;
    }
    return IFIRMA_ERROR_CODES[key] || null;
  }

  function describeIfirmaCode(code) {
    const entry = getIfirmaCodeEntry_(code);
    return entry && entry.description ? entry.description : null;
  }

  function resolveIfirmaCodeOverrides_(inlineOverrides) {
    const overrides = {};
    mergeOverrides_(overrides, inlineOverrides);

    if (typeof IFIRMA_SLACK_CODE_FLAGS !== 'undefined') {
      mergeOverrides_(overrides, IFIRMA_SLACK_CODE_FLAGS);
    }
    if (typeof IFIRMA_SLACK_DISABLED_CODES !== 'undefined') {
      mergeOverrides_(overrides, IFIRMA_SLACK_DISABLED_CODES, false);
    }

    const scriptProperties = getScriptProperties_();
    if (scriptProperties && scriptProperties.getProperty) {
      const flagsProperty = scriptProperties.getProperty('IFIRMA_SLACK_CODE_FLAGS');
      mergeOverrides_(overrides, flagsProperty);
      const disabledProperty = scriptProperties.getProperty('IFIRMA_SLACK_DISABLED_CODES');
      mergeOverrides_(overrides, disabledProperty, false);
    }

    return overrides;
  }

  function shouldNotifyIfirmaCode(code, inlineOverrides) {
    const key = toNumericCodeKey_(code);
    if (!key) {
      return true;
    }

    const overrides = resolveIfirmaCodeOverrides_(inlineOverrides);
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      return overrides[key];
    }

    const entry = getIfirmaCodeEntry_(key);
    if (entry && typeof entry.notify === 'boolean') {
      return entry.notify;
    }

    return true;
  }

  function resolveInvoiceFailureNotificationFlag_() {
    if (typeof IFIRMA_NOTIFY_FAILED_INVOICES !== 'undefined') {
      const explicit = parseBoolean_(IFIRMA_NOTIFY_FAILED_INVOICES);
      if (explicit !== null) {
        return explicit;
      }
    }

    const scriptProperties = getScriptProperties_();
    if (scriptProperties && scriptProperties.getProperty) {
      const propertyValue = scriptProperties.getProperty('IFIRMA_NOTIFY_FAILED_INVOICES')
        || scriptProperties.getProperty('SLACK_NOTIFY_FAILED_INVOICES');
      const parsed = parseBoolean_(propertyValue);
      if (parsed !== null) {
        return parsed;
      }
    }

    return true;
  }

  function postWebhook_(url, payload) {
    const body = JSON.stringify(payload);
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      try {
        UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: body,
          muteHttpExceptions: true,
        });
        return Promise.resolve(true);
      } catch (err) {
        if (logger && logger.warn) {
          logger.warn('Unable to send Slack notification via UrlFetchApp', err);
        }
        return Promise.resolve(false);
      }
    }

    if (typeof fetch !== 'undefined') {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then(() => true)
        .catch((err) => {
          if (logger && logger.warn) {
            logger.warn('Unable to send Slack notification via fetch', err);
          }
          return false;
        });
    }

    if (logger && logger.warn) {
      logger.warn('No fetch implementation available for Slack notification');
    }
    return Promise.resolve(false);
  }

  async function send(message, contextLines = [], options = {}) {
    const webhookUrl = resolveWebhookUrl_(options.webhookUrl);
    if (!webhookUrl) {
      if (logger && logger.warn) {
        logger.warn('Slack webhook URL unavailable; skipping notification');
      }
      return false;
    }

    const lines = [message].concat((contextLines || []).filter((line) => line));
    const payload = { text: lines.join('\n') };
    return postWebhook_(webhookUrl, payload);
  }

  async function notifyIfirmaError(details = {}) {
    const rawCode = typeof details.code !== 'undefined'
      ? details.code
      : details.responseCode;
    const numericCode = Number(rawCode);
    if (!Number.isFinite(numericCode) || numericCode === 0) {
      return false;
    }

    if (!shouldNotifyIfirmaCode(numericCode, details && details.ifirmaCodeFlags)) {
      if (logger && logger.info) {
        logger.info('Slack notifications disabled for iFirma code', numericCode);
      }
      return false;
    }

    const description = details.description || describeIfirmaCode(numericCode);
    const headlineParts = [':rotating_light: Błąd iFirma (kod ' + numericCode];
    if (description) {
      headlineParts.push('— ' + description);
    }
    headlineParts.push(')');
    const headline = headlineParts.join(' ');

    const contextLines = [];
    if (details.invoiceNumber) {
      contextLines.push('Faktura: ' + details.invoiceNumber);
    }
    if (details.endpoint) {
      contextLines.push('Endpoint: ' + details.endpoint);
    }
    if (typeof details.httpStatus !== 'undefined') {
      contextLines.push('HTTP status: ' + details.httpStatus);
    }
    if (details.message) {
      contextLines.push('Komunikat: ' + details.message);
    }
    if (details.userMessage) {
      contextLines.push('Komunikat dla użytkownika: ' + details.userMessage);
    }
    if (details.description && details.description !== description) {
      contextLines.push('Opis błędu: ' + details.description);
    }
    if (details.rawBody) {
      const snippet = String(details.rawBody).slice(0, 500);
      contextLines.push('Treść odpowiedzi: ' + snippet);
    }

    return send(headline, contextLines, details);
  }

  async function notifyInvoiceFailure(details = {}) {
    const classification = safeString(details.classification);
    if (!resolveInvoiceFailureNotificationFlag_()) {
      if (logger && logger.info) {
        logger.info('Slack notifications for Failed invoices disabled');
      }
      return false;
    }

    const emoji = classification === 'partial' ? ':warning:' : ':x:';
    const invoiceNumber = safeString(details.invoiceNumber);
    const sellerName = safeString(details.sellerName || details.vendorName);
    const fileName = safeString(details.fileName);
    const headlineParts = [emoji, 'Faktura przeniesiona do folderu Failed'];
    if (invoiceNumber) {
      headlineParts.push('— ' + invoiceNumber);
    } else if (fileName) {
      headlineParts.push('— plik ' + fileName);
    }
    const message = headlineParts.join(' ');

    const contextLines = [];
    if (invoiceNumber) {
      contextLines.push('Numer: ' + invoiceNumber);
    }
    if (sellerName) {
      contextLines.push('Sprzedawca: ' + sellerName);
    }

    const grossLine = formatAmount(details.grossAmount, details.currency || details.invoiceCurrency);
    if (grossLine) {
      contextLines.push('Kwota brutto: ' + grossLine);
    }

    if (fileName) {
      contextLines.push('Plik źródłowy: ' + fileName);
    }
    if (details.pageNumber) {
      contextLines.push('Strona: ' + details.pageNumber);
    }
    if (details.invoiceIndex) {
      contextLines.push('Kolejność na stronie: ' + details.invoiceIndex);
    }

    const primaryReason = safeString(details.reason);
    if (primaryReason) {
      contextLines.push('Powód: ' + primaryReason);
    }

    const extraDetails = Array.isArray(details.details) ? details.details : [];
    extraDetails
      .map((line) => safeString(line))
      .filter((line) => line)
      .forEach((line) => contextLines.push(line));

    if (details.ifirmaCode !== undefined && details.ifirmaCode !== null && details.ifirmaCode !== '') {
      const numericCode = Number(details.ifirmaCode);
      if (Number.isFinite(numericCode)) {
        const description = details.ifirmaDescription || describeIfirmaCode(numericCode);
        let codeLine = 'Kod iFirma: ' + numericCode;
        if (description) {
          codeLine += ' — ' + description;
        }
        contextLines.push(codeLine);
      }
    }

    const ifirmaMessage = safeString(details.ifirmaMessage || details.message);
    if (ifirmaMessage) {
      contextLines.push('Komunikat iFirma: ' + ifirmaMessage);
    }

    const ifirmaUserMessage = safeString(details.ifirmaUserMessage || details.userMessage);
    if (ifirmaUserMessage) {
      contextLines.push('Komunikat dla użytkownika: ' + ifirmaUserMessage);
    }

    if (Array.isArray(details.missingFields) && details.missingFields.length) {
      contextLines.push('Brakujące pola dla iFirma: ' + details.missingFields.join(', '));
    }

    return send(message, contextLines, details);
  }

  return {
    setLogger,
    send,
    notifyIfirmaError,
    describeIfirmaCode,
    notifyInvoiceFailure,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Slack;
} else {
  this.Slack = Slack;
}
