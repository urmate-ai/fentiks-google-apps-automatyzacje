const IFirma = (() => {
  let logger = (this.IFirma && this.IFirma.logger)
    || (typeof require !== 'undefined' ? require('./01_logger') : this.logger);

  const baseUrl = 'https://www.ifirma.pl/iapi/';
  const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

  function setLogger(l) {
    logger = l;
  }

  function normalizeCredential_(value) {
    if (typeof value !== 'string') {
      return value;
    }

    return value.replace(/^\ufeff/, '').trim();
  }

  function getScriptProperties_() {
    const propertiesService = typeof PropertiesService !== 'undefined'
      ? PropertiesService
      : (typeof globalThis !== 'undefined' && globalThis.PropertiesService)
        ? globalThis.PropertiesService
        : null;

    if (!propertiesService || !propertiesService.getScriptProperties) {
      throw new Error('Script properties unavailable for iFirma');
    }

    const scriptProperties = propertiesService.getScriptProperties();
    if (!scriptProperties || !scriptProperties.getProperty) {
      throw new Error('Unable to access script properties for iFirma');
    }

    return scriptProperties;
  }

  function getCredentials_(kind) {
    const scriptProperties = getScriptProperties_();
    const login = normalizeCredential_(scriptProperties.getProperty('IFIRMA_LOGIN'));
    const secretProperty = kind === 'sale' ? 'IFIRMA_SALES_KEY' : 'IFIRMA_EXPENSE_KEY';
    const keyNameProperty = kind === 'sale' ? 'IFIRMA_SALES_KEY_NAME' : 'IFIRMA_KEY_NAME';
    const secret = normalizeCredential_(scriptProperties.getProperty(secretProperty));
    const keyName = normalizeCredential_(scriptProperties.getProperty(keyNameProperty))
      || (kind === 'sale' ? 'faktura' : 'wydatek');

    if (!login || !secret) {
      throw new Error('Missing iFirma credentials in Script Properties for ' + kind);
    }

    return { login, secret, keyName };
  }

  function toSignedBytes_(values) {
    return Array.from(values || [], (value) => {
      const byte = Number(value) & 0xff;
      return byte > 127 ? byte - 256 : byte;
    });
  }

  function toUnsignedBytes_(values) {
    return Array.from(values || [], (value) => {
      const byte = Number(value) & 0xff;
      return byte < 0 ? byte + 256 : byte;
    });
  }

  function toUtf8Bytes_(value) {
    const stringValue = value == null ? '' : String(value);

    if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
      try {
        const blob = Utilities.newBlob(stringValue);
        if (blob && blob.getBytes) {
          return blob.getBytes();
        }
      } catch (err) {
        // fall through to the Node/TextEncoder branches when newBlob fails
      }
    }

    if (typeof TextEncoder !== 'undefined') {
      return toSignedBytes_(new TextEncoder().encode(stringValue));
    }

    if (typeof Buffer !== 'undefined') {
      return toSignedBytes_(Buffer.from(stringValue, 'utf8'));
    }

    const bytes = [];
    for (let i = 0; i < stringValue.length; i += 1) {
      const codePoint = stringValue.charCodeAt(i);
      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }

    return toSignedBytes_(bytes);
  }

  function toJsonString_(payload) {
    if (payload == null) {
      return '';
    }

    if (typeof payload === 'string') {
      return payload;
    }

    try {
      return JSON.stringify(payload);
    } catch (err) {
      throw new Error('Unable to serialize payload for iFirma request');
    }
  }

  function normalizeJsonPayload_(payload) {
    const raw = toJsonString_(payload);
    const withoutBom = raw.replace(/^\ufeff/, '');
    const initialSignedBytes = toUtf8Bytes_(withoutBom);
    let signedBytes = initialSignedBytes;
    let unsignedBytes = toUnsignedBytes_(signedBytes);

    let normalized = withoutBom;

    if (unsignedBytes.length) {
      if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
        try {
          const blob = Utilities.newBlob(unsignedBytes);
          if (blob && blob.getDataAsString) {
            normalized = blob.getDataAsString('UTF-8').replace(/^\ufeff/, '');
          }
        } catch (err) {
          // Ignore and fall back to other approaches
        }
      } else if (typeof TextDecoder !== 'undefined' && typeof Uint8Array !== 'undefined') {
        try {
          const decoder = new TextDecoder('utf-8');
          normalized = decoder.decode(Uint8Array.from(unsignedBytes)).replace(/^\ufeff/, '');
        } catch (err) {
          // Ignore and fall back to other approaches
        }
      } else if (typeof Buffer !== 'undefined') {
        normalized = Buffer.from(unsignedBytes).toString('utf8').replace(/^\ufeff/, '');
      }
    }

    if (normalized !== withoutBom) {
      signedBytes = toUtf8Bytes_(normalized);
      unsignedBytes = toUnsignedBytes_(signedBytes);
    }

    return {
      json: normalized,
      signedBytes,
      unsignedBytes,
    };
  }

  function hexToBytes_(value) {
    if (value == null) {
      return [];
    }

    const normalized = String(value)
      .replace(/^\ufeff/, '')
      .replace(/\s+/g, '')
      .toLowerCase();

    if (normalized.length === 0) {
      return [];
    }

    if (normalized.length % 2 !== 0) {
      throw new Error('Invalid HEX length for iFirma secret');
    }

    const bytes = [];
    for (let i = 0; i < normalized.length; i += 2) {
      const hexByte = normalized.substr(i, 2);
      const parsed = parseInt(hexByte, 16);
      if (Number.isNaN(parsed)) {
        throw new Error('Invalid HEX data in iFirma secret');
      }
      bytes.push(parsed);
    }

    return toSignedBytes_(bytes);
  }

  function bytesToHex_(bytes) {
    return Array.from(bytes || [], (byte) => {
      const value = byte < 0 ? byte + 256 : byte;
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function computeHmacSha1_(keyBytes, message) {
    if (!keyBytes || !keyBytes.length) {
      throw new Error('Missing secret for iFirma signature');
    }
    const msg = message || '';
    const messageBytes = toUtf8Bytes_(msg);

    let signatureBytes;
    if (typeof Utilities !== 'undefined' && Utilities.computeHmacSignature) {
      signatureBytes = Utilities.computeHmacSignature(
        Utilities.MacAlgorithm.HMAC_SHA_1,
        messageBytes,
        keyBytes,
      );
    } else if (typeof require !== 'undefined') {
      const crypto = require('crypto');
      const unsignedKey = toUnsignedBytes_(keyBytes);
      const buffer = crypto.createHmac('sha1', Buffer.from(unsignedKey))
        .update(msg, 'utf8')
        .digest();
      signatureBytes = toSignedBytes_(buffer);
    }

    if (!signatureBytes) {
      throw new Error('No HMAC implementation available for iFirma');
    }

    return {
      bytes: signatureBytes,
      hex: bytesToHex_(signatureBytes),
    };
  }

  function getFetchService_() {
    if (typeof UrlFetchApp !== 'undefined') {
      return UrlFetchApp;
    }
    if (typeof globalThis !== 'undefined' && globalThis.UrlFetchApp) {
      return globalThis.UrlFetchApp;
    }
    throw new Error('UrlFetchApp service unavailable for iFirma requests');
  }

  function buildEndpointUrl_(endpoint, queryParams) {
    if (!endpoint) {
      throw new Error('Missing endpoint for iFirma request');
    }

    const normalizedEndpoint = String(endpoint || '')
      .replace(/^\//, '');
    const [endpointPath, endpointQuery] = normalizedEndpoint.split('?');
    const pathWithJson = (endpointPath || '').replace(/\.json$/i, '') + '.json';
    const urlWithoutParams = baseUrl + pathWithJson;

    const query = [];
    if (endpointQuery) {
      query.push(endpointQuery);
    }
    if (queryParams && typeof queryParams === 'object') {
      Object.keys(queryParams).forEach((key) => {
        const value = queryParams[key];
        if (value === undefined || value === null || value === '') {
          return;
        }
        query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      });
    }

    const url = query.length ? `${urlWithoutParams}?${query.join('&')}` : urlWithoutParams;

    return { url, urlWithoutParams };
  }

  async function postRequest_(endpoint, payload, options = {}, kind) {
    const { url, urlWithoutParams } = buildEndpointUrl_(endpoint);

    const payloadInfo = normalizeJsonPayload_(payload);
    const canonicalJson = payloadInfo.json;
    const credentials = getCredentials_(kind);
    const secretBytes = hexToBytes_(credentials.secret);

    const canonicalSignatureInput = urlWithoutParams + credentials.login + credentials.keyName + canonicalJson;
    const signature = computeHmacSha1_(secretBytes, canonicalSignatureInput);
    const authenticationHeader = `IAPIS user=${credentials.login}, hmac-sha1=${signature.hex}`;
    const fetchService = getFetchService_();

    const headers = Object.assign({}, options.headers || {});
    headers.Authentication = authenticationHeader;
    headers.Accept = 'application/json';
    headers['Content-Type'] = JSON_CONTENT_TYPE;
    headers['Accept-Charset'] = 'utf-8';

    const requestOptions = Object.assign({
      method: 'post',
      contentType: JSON_CONTENT_TYPE,
      muteHttpExceptions: true,
    }, options, {
      payload: payloadInfo.unsignedBytes.length
        ? payloadInfo.unsignedBytes
        : canonicalJson,
      headers,
      contentType: JSON_CONTENT_TYPE,
    });

    if (logger && logger.info) {
      logger.info('iFirma requestContent preview', canonicalJson);
    }

    let response;
    try {
      response = fetchService.fetch(url, requestOptions);
    } catch (err) {
      if (logger && logger.error) {
        logger.error('iFirma fetch failed', err);
      }
      throw err;
    }

    const status = response && response.getResponseCode ? response.getResponseCode() : 0;
    const content = response && response.getContentText ? response.getContentText() : '';
    if (logger && logger.info) {
      logger.info('iFirma status', status);
      logger.info('iFirma body preview', content.slice(0, 200));
    }
    let json = null;
    try {
      json = content ? JSON.parse(content) : null;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('iFirma response not JSON', err, content);
      }
    }

    const ok = status >= 200 && status < 300;
    if (!ok && logger && logger.error) {
      logger.error('iFirma responded with non-success', status, content);
    } else if (ok && logger && logger.debug) {
      logger.debug('iFirma response', json || content);
    }

    return { ok, status, body: content, json };
  }

  async function getRequest_(endpoint, queryParams, options = {}, kind) {
    const { url, urlWithoutParams } = buildEndpointUrl_(endpoint, queryParams);
    const credentials = getCredentials_(kind);
    const secretBytes = hexToBytes_(credentials.secret);
    const canonicalSignatureInput = urlWithoutParams + credentials.login + credentials.keyName;
    const signature = computeHmacSha1_(secretBytes, canonicalSignatureInput);
    const authenticationHeader = `IAPIS user=${credentials.login}, hmac-sha1=${signature.hex}`;
    const fetchService = getFetchService_();

    const headers = Object.assign({}, options.headers || {});
    headers.Authentication = authenticationHeader;
    headers.Accept = 'application/json';
    headers['Accept-Charset'] = 'utf-8';

    const requestOptions = Object.assign({
      method: 'get',
      muteHttpExceptions: true,
    }, options, {
      headers,
    });

    let response;
    try {
      response = fetchService.fetch(url, requestOptions);
    } catch (err) {
      if (logger && logger.error) {
        logger.error('iFirma fetch failed', err);
      }
      throw err;
    }

    const status = response && response.getResponseCode ? response.getResponseCode() : 0;
    const content = response && response.getContentText ? response.getContentText() : '';
    if (logger && logger.info) {
      logger.info('iFirma status', status);
      logger.info('iFirma body preview', content.slice(0, 200));
    }
    let json = null;
    try {
      json = content ? JSON.parse(content) : null;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('iFirma response not JSON', err, content);
      }
    }

    const ok = status >= 200 && status < 300;
    if (!ok && logger && logger.error) {
      logger.error('iFirma responded with non-success', status, content);
    } else if (ok && logger && logger.debug) {
      logger.debug('iFirma response', json || content);
    }

    return { ok, status, body: content, json };
  }

  async function postExpense(endpoint, payload, options = {}) {
    return postRequest_(endpoint, payload, options, 'expense');
  }

  async function postSalesInvoice(endpoint, payload, options = {}) {
    return postRequest_(endpoint, payload, options, 'sale');
  }

  async function listSalesInvoices(queryParams = {}, options = {}) {
    return getRequest_('faktury', queryParams, options, 'sale');
  }

  return {
    setLogger,
    postExpense,
    postSalesInvoice,
    listSalesInvoices,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = IFirma;
} else {
  this.IFirma = IFirma;
}
