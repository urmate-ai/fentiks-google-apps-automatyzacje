const Hubspot = (() => {
  let logger = (globalThis.Hubspot && globalThis.Hubspot.logger)
    || (typeof require !== 'undefined' ? require('./01_logger') : this.logger);

  function setLogger(l) { logger = l; }

  function hubspotFetch_(token, url, options = {}, attempt = 1) {
    const opts = Object.assign({
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }
    }, options);

    logger && logger.info && logger.info('Calling HubSpot', url);
    let resp;
    try {
      resp = UrlFetchApp.fetch(url, opts);
    } catch (err) {
      logger && logger.warn && logger.warn('HubSpot fetch error', err);
      if (attempt < 3) {
        Utilities.sleep(5000);
        return hubspotFetch_(token, url, options, attempt + 1);
      }
      throw err;
    }

    const code = resp && resp.getResponseCode ? resp.getResponseCode() : 0;
    logger && logger.info && logger.info('HubSpot status', code);
    logger && logger.info && logger.info('HubSpot body', resp && resp.getContentText ? resp.getContentText() : '');

    if ((code === 429 || code >= 500) && attempt < 3) {
      Utilities.sleep(5000);
      return hubspotFetch_(token, url, options, attempt + 1);
    }

    return resp;
  }

  function getScriptProperties_() {
    const service = typeof PropertiesService !== 'undefined'
      ? PropertiesService
      : (typeof globalThis !== 'undefined' ? globalThis.PropertiesService : null);
    if (!service || typeof service.getScriptProperties !== 'function') {
      return null;
    }
    try {
      return service.getScriptProperties();
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to access script properties for HubSpot', err);
      }
      return null;
    }
  }

  function getHubspotToken_(scriptProperties) {
    const props = scriptProperties || getScriptProperties_();
    if (!props || typeof props.getProperty !== 'function') {
      return null;
    }
    try {
      return props.getProperty('HUBSPOT_PRIVATE_TOKEN');
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to read HUBSPOT_PRIVATE_TOKEN', err);
      }
      return null;
    }
  }

  function isSyncEnabled_(scriptProperties) {
    if (typeof INVOICES_HUBSPOT_ENABLED !== 'undefined') {
      return !!INVOICES_HUBSPOT_ENABLED;
    }
    const props = scriptProperties || getScriptProperties_();
    if (!props || typeof props.getProperty !== 'function') {
      return true;
    }
    try {
      const raw = props.getProperty('INVOICES_HUBSPOT_ENABLED');
      if (raw === null || raw === undefined || raw === '') {
        return true;
      }
      const normalized = String(raw).trim().toLowerCase();
      if (['false', '0', 'no', 'off'].indexOf(normalized) >= 0) {
        return false;
      }
      if (['true', '1', 'yes', 'on'].indexOf(normalized) >= 0) {
        return true;
      }
      return true;
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('Unable to read INVOICES_HUBSPOT_ENABLED', err);
      }
      return true;
    }
  }

  function safeString_(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function parseDate_(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getTime());
    }
    const str = safeString_(value);
    if (!str) {
      return null;
    }
    const normalized = str.replace(/[.\/]/g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    const fallback = new Date(str);
    if (Number.isNaN(fallback.getTime())) {
      return null;
    }
    return fallback;
  }

  function formatDate_(value) {
    const date = parseDate_(value);
    if (!date) {
      return '';
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function parseAmount_(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value * 100) / 100;
    }
    const str = safeString_(value).replace(/\s+/g, '').replace(',', '.');
    if (!str) {
      return null;
    }
    const parsed = Number(str);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.round(parsed * 100) / 100;
  }

  function sanitiseProperties_(properties) {
    const payload = {};
    const keys = Object.keys(properties || {});
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = properties[key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      payload[key] = value;
    }
    return payload;
  }

  function parseHubspotResponse_(resp) {
    const status = resp && typeof resp.getResponseCode === 'function'
      ? resp.getResponseCode()
      : resp && typeof resp.status === 'number'
        ? resp.status
        : 0;
    const body = resp && typeof resp.getContentText === 'function'
      ? resp.getContentText()
      : resp && typeof resp.body === 'string'
        ? resp.body
        : '';
    let json = null;
    if (body) {
      try {
        json = JSON.parse(body);
      } catch (err) {
        json = null;
      }
    }
    return { status, body, json, response: resp };
  }

  function extractRecordId_(record) {
    if (!record) {
      return null;
    }
    if (record.id) {
      return String(record.id);
    }
    if (record.objectId) {
      return String(record.objectId);
    }
    if (record.properties && record.properties.hs_object_id) {
      return String(record.properties.hs_object_id);
    }
    return null;
  }

  function detectUnsupportedProperties_(parsedResponse, attemptedProperties) {
    const json = parsedResponse && parsedResponse.json;
    if (!json) {
      return null;
    }
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const unsupported = new Set();
    for (let i = 0; i < errors.length; i += 1) {
      const error = errors[i];
      const context = error && error.context;
      const propertyName = context && (context.propertyName || context.property);
      const code = error && (error.errorType || error.code);
      if (propertyName && String(code).toUpperCase().indexOf('PROPERTY_DOESNT_EXIST') >= 0) {
        unsupported.add(propertyName);
      }
    }
    if (!unsupported.size) {
      return null;
    }
    const filtered = {};
    const keys = Object.keys(attemptedProperties || {});
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!unsupported.has(key)) {
        filtered[key] = attemptedProperties[key];
      }
    }
    return filtered;
  }

  function buildInvoiceProperties_(invoice) {
    const invoiceNumber = safeString_(invoice && invoice.invoiceNumber);
    const issueDate = formatDate_(invoice && invoice.issueDate);
    const dueDate = formatDate_(invoice && (invoice.paymentDueDate || invoice.dueDate));
    const saleDate = formatDate_(invoice && invoice.deliveryDate);
    const grossAmount = parseAmount_(invoice && (invoice.grossAmount !== undefined ? invoice.grossAmount : invoice.totalGross));
    const paidAmount = parseAmount_(invoice && (invoice.amountPaid !== undefined ? invoice.amountPaid : invoice.amountPaidLabel));
    const amountDueInput = parseAmount_(invoice && invoice.amountDue);
    let outstanding = amountDueInput;
    if (outstanding === null && grossAmount !== null) {
      const paid = paidAmount !== null ? paidAmount : 0;
      outstanding = Math.max(Math.round((grossAmount - paid) * 100) / 100, 0);
    }
    const description = safeString_(
      (invoice && invoice.notes)
      || (invoice && invoice.comments)
      || (invoice && invoice.additionalInfo)
    );
    const properties = {
      hs_invoice_number: invoiceNumber || undefined,
      hs_issue_date: issueDate || undefined,
      hs_due_date: dueDate || undefined,
      hs_currency: safeString_(invoice && invoice.currency) || undefined,
      hs_total_amount: grossAmount !== null ? grossAmount : undefined,
      hs_total_amount_paid: paidAmount !== null ? paidAmount : undefined,
      hs_balance_outstanding: outstanding !== null ? outstanding : undefined,
      hs_payment_date: saleDate || undefined,
      hs_description: description || undefined,
    };
    return sanitiseProperties_(properties);
  }

  function searchInvoiceByNumber_(token, invoiceNumber) {
    if (!token || !invoiceNumber) {
      return null;
    }
    const payload = {
      filterGroups: [{
        filters: [{
          propertyName: 'hs_invoice_number',
          operator: 'EQ',
          value: invoiceNumber,
        }],
      }],
      properties: ['hs_invoice_number'],
      limit: 1,
    };
    const url = 'https://api.hubapi.com/crm/v3/objects/invoices/search';
    try {
      const resp = hubspotFetch_(token, url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
      });
      const parsed = parseHubspotResponse_(resp);
      if (parsed.status === 404) {
        return null;
      }
      if (parsed.status >= 200 && parsed.status < 300) {
        const results = parsed.json && Array.isArray(parsed.json.results)
          ? parsed.json.results
          : [];
        return results.length ? results[0] : null;
      }
      logger && logger.warn && logger.warn('HubSpot invoice search failed', parsed.status, parsed.body);
      return null;
    } catch (err) {
      logger && logger.warn && logger.warn('HubSpot invoice search threw', err);
      return null;
    }
  }

  function upsertInvoice_(token, properties, existingRecord) {
    if (!token) {
      return { success: false, reason: 'missingToken' };
    }
    const cleaned = sanitiseProperties_(properties);
    if (!Object.keys(cleaned).length) {
      return { success: false, reason: 'missingProperties', message: 'Brak właściwości do synchronizacji z HubSpot.' };
    }

    const attemptCreate = (props) => {
      const resp = hubspotFetch_(token, 'https://api.hubapi.com/crm/v3/objects/invoices', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ properties: props }),
      });
      const parsed = parseHubspotResponse_(resp);
      if (parsed.status >= 200 && parsed.status < 300) {
        return { success: true, action: 'created', id: extractRecordId_(parsed.json), response: parsed };
      }
      return Object.assign({ success: false, action: 'create' }, parsed, { attemptedProperties: props });
    };

    const attemptUpdate = (recordId, props) => {
      const url = 'https://api.hubapi.com/crm/v3/objects/invoices/' + encodeURIComponent(recordId);
      const resp = hubspotFetch_(token, url, {
        method: 'patch',
        contentType: 'application/json',
        payload: JSON.stringify({ properties: props }),
      });
      const parsed = parseHubspotResponse_(resp);
      if (parsed.status >= 200 && parsed.status < 300) {
        return { success: true, action: 'updated', id: recordId, response: parsed };
      }
      return Object.assign({ success: false, action: 'update', id: recordId }, parsed, { attemptedProperties: props });
    };

    if (existingRecord) {
      const recordId = extractRecordId_(existingRecord);
      if (!recordId) {
        return { success: false, reason: 'missingId', message: 'Nie udało się odczytać identyfikatora faktury HubSpot.' };
      }
      let updateAttempt = attemptUpdate(recordId, cleaned);
      if (!updateAttempt.success) {
        const filtered = detectUnsupportedProperties_(updateAttempt, cleaned);
        if (filtered && Object.keys(filtered).length < Object.keys(cleaned).length) {
          logger && logger.warn && logger.warn('Retrying HubSpot invoice update without unsupported properties');
          updateAttempt = attemptUpdate(recordId, filtered);
        }
      }
      return updateAttempt;
    }

    let createAttempt = attemptCreate(cleaned);
    if (!createAttempt.success) {
      const filtered = detectUnsupportedProperties_(createAttempt, cleaned);
      if (filtered && Object.keys(filtered).length < Object.keys(cleaned).length) {
        logger && logger.warn && logger.warn('Retrying HubSpot invoice creation without unsupported properties');
        createAttempt = attemptCreate(filtered);
      }
    }
    return createAttempt;
  }

  async function syncSaleInvoice(invoice, options = {}) {
    if (!invoice || invoice.kind !== 'sale') {
      return { success: true, skipped: true, reason: 'nonSaleInvoice' };
    }

    const scriptProperties = options.scriptProperties || getScriptProperties_();
    if (!isSyncEnabled_(scriptProperties)) {
      logger && logger.info && logger.info('HubSpot sync disabled via script property');
      return { success: true, skipped: true, reason: 'disabled' };
    }

    const token = options.token || getHubspotToken_(scriptProperties);
    if (!token) {
      logger && logger.warn && logger.warn('HUBSPOT_PRIVATE_TOKEN not set, skipping HubSpot sync');
      return { success: true, skipped: true, reason: 'missingToken' };
    }

    const properties = buildInvoiceProperties_(invoice);
    if (!properties.hs_invoice_number) {
      logger && logger.warn && logger.warn('Skipping HubSpot sync – missing invoice number');
      return { success: false, classification: 'partial', reason: 'missingInvoiceNumber', message: 'Brak numeru faktury do synchronizacji z HubSpot.' };
    }

    try {
      const existing = searchInvoiceByNumber_(token, properties.hs_invoice_number);
      const outcome = upsertInvoice_(token, properties, existing);
      if (outcome && outcome.success) {
        logger && logger.info && logger.info('HubSpot invoice synced', properties.hs_invoice_number, outcome.action);
        return Object.assign({ success: true, classification: 'success' }, outcome);
      }
      if (outcome && outcome.reason === 'missingProperties') {
        return Object.assign({ success: false, classification: 'partial' }, outcome);
      }
      const status = outcome && outcome.status;
      const body = outcome && outcome.body;
      logger && logger.error && logger.error('HubSpot sync failed', properties.hs_invoice_number, status, body);
      return Object.assign({
        success: false,
        classification: 'partial',
        reason: outcome && outcome.reason ? outcome.reason : 'apiError',
        status,
        body,
      }, outcome || {});
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

  return {
    get logger() { return logger; },
    setLogger,
    hubspotFetch_,
    getHubspotToken_,
    syncSaleInvoice,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Hubspot;
} else {
  this.Hubspot = Hubspot;
}
