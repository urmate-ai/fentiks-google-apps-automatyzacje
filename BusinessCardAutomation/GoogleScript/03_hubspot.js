const Hubspot = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./02_logger'));

  function setLogger(l) { logger = l; }

  // --- PUBLIC API ---
  return { setLogger, sendToHubspot_, getHubspotToken_, logMessage_ };

  /**
   * Send contact to HubSpot using Private App token (Bearer) + CRM v3.
   * Before creating a new contact it checks if a contact with the same
   * first name and last name already exists in HubSpot.  If such contact
   * exists and the incoming data contains an email or phone, those fields
   * are compared.  When either email or phone matches the existing record
   * the contact is considered the same person and will not be added again.
   * If no email or phone is available the contact is skipped as we cannot
   * reliably distinguish people with the same name.
  */
  function sendToHubspot_(contact) {
    if (typeof HUBSPOT_CALL_ENABLED !== 'undefined' && !HUBSPOT_CALL_ENABLED) {
      logger.info('HubSpot sync disabled, skipping');
      return null;
    }
    const token = getHubspotToken_();
    if (!token) {
      logger.warn('HUBSPOT_PRIVATE_TOKEN not set, skipping HubSpot sync');
      return null;
    }

    // Map your fields to HubSpot default properties
    const props = {
      email: contact.email || '',
      firstname: contact.imie || '',
      lastname: contact.nazwisko || '',
      phone: contact.telefon || '',
      jobtitle: contact.stanowisko || '',
      company: contact.firma || '',
      address: [contact.ulica, contact.nr_domu].filter(Boolean).join(' '),
      city: contact.miasto || '',
      zip: contact.kod_pocztowy || '',
    };

    try {
        const existing = searchByName_(token, props.firstname, props.lastname);
        if (existing.length > 0) {
          if (props.email || props.phone) {
            const match = existing.find(r => {
              const e = r.properties || {};
              const sameEmail = props.email && e.email && e.email.toLowerCase?.() === props.email.toLowerCase();
              const samePhone = props.phone && e.phone && e.phone === props.phone;
              return sameEmail || samePhone;
            });
            if (match) {
              logger.info('Contact already exists with same email or phone, skipping');
              return extractContactIdFromRecord_(match);
            }
          } else {
            logger.info('Contact with same name exists but no email/phone provided, skipping');
            return null;
          }
        }

        if (contact.uploader_email) {
          const ownerId = getOwnerIdByEmail_(token, contact.uploader_email);
          if (ownerId) props.hubspot_owner_id = ownerId;
        }

        // Create new contact
        const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
        const payload = { properties: props };
        const resp = hubspotFetch_(token, url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload)
        });
        return extractContactIdFromResponse_(resp);
    } catch (e) {
      logger.info('Failed to send to HubSpot', e);
      return null;
    }
  }

  /**
   * Wrapper for all HubSpot API calls with retry after 5 seconds on
   * transient errors (5xx or 429).  It merges provided options with
   * the required headers and ensures every call uses the same logic.
   */
  function hubspotFetch_(token, url, options = {}, attempt = 1) {
    const opts = Object.assign({
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }
    }, options);

    logger.info('Calling HubSpot', url);
    let resp;
    try {
      resp = UrlFetchApp.fetch(url, opts);
    } catch (err) {
      logger.warn('HubSpot fetch error', err);
      if (attempt < 3) {
        Utilities.sleep(5000);
        return hubspotFetch_(token, url, options, attempt + 1);
      }
      throw err;
    }

    const code = resp && resp.getResponseCode ? resp.getResponseCode() : 0;
    logger.info('HubSpot status', code);
    logger.info('HubSpot body', resp && resp.getContentText ? resp.getContentText() : '');

    if ((code === 429 || code >= 500) && attempt < 3) {
      Utilities.sleep(5000);
      return hubspotFetch_(token, url, options, attempt + 1);
    }

    return resp;
  }

  function extractContactIdFromRecord_(record) {
    if (!record) return null;
    if (record.id) return String(record.id);
    const props = record.properties || {};
    if (props.hs_object_id) return String(props.hs_object_id);
    return null;
  }

  function extractContactIdFromResponse_(resp) {
    if (!resp || !resp.getContentText) return null;
    const body = resp.getContentText();
    try {
      const parsed = JSON.parse(body || '{}');
      return extractContactIdFromRecord_(parsed);
    } catch (_) {
      return null;
    }
  }

  function escapeHtml_(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function logMessage_(contactId, details = {}) {
    if (typeof HUBSPOT_CALL_ENABLED !== 'undefined' && !HUBSPOT_CALL_ENABLED) {
      logger.info('HubSpot sync disabled, skipping message log');
      return;
    }
    if (!contactId) {
      logger.info('Missing contactId, skipping HubSpot message log');
      return;
    }
    const token = getHubspotToken_();
    if (!token) {
      logger.warn('HUBSPOT_PRIVATE_TOKEN not set, skipping HubSpot message log');
      return;
    }

    const channel = details.channel || 'message';
    const headerMap = {
      email: 'Kopia wysłanego maila (Business Card Automation)',
      sms: 'Kopia wysłanego SMS-a (Business Card Automation)'
    };
    const header = headerMap[channel] || 'Kopia wysłanej wiadomości (Business Card Automation)';

    const noteParts = [header];
    if (details.to) noteParts.push('Do: ' + details.to);
    if (channel === 'email' && details.subject) noteParts.push('Temat: ' + details.subject);
    noteParts.push('');

    const body = details.body ? String(details.body) : '';
    body.split(/\r?\n/).forEach(line => {
      noteParts.push(line);
    });

    const noteHtml = noteParts
      .map(part => escapeHtml_(part))
      .join('<br>');

    const payload = {
      properties: {
        hs_note_body: noteHtml,
        hs_timestamp: new Date().toISOString()
      },
      associations: [
        {
          to: { id: String(contactId) },
          types: [
            { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }
          ]
        }
      ]
    };

    try {
      const url = 'https://api.hubapi.com/crm/v3/objects/notes';
      hubspotFetch_(token, url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload)
      });
    } catch (err) {
      logger.warn('Failed to log HubSpot message', err);
    }
  }

  function searchByName_(token, firstname, lastname) {
    const url = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
    const payload = {
      filterGroups: [{
        filters: [
          { propertyName: 'firstname', operator: 'EQ', value: firstname },
          { propertyName: 'lastname', operator: 'EQ', value: lastname }
        ]
      }],
      properties: ['email', 'phone'],
      limit: 100
    };
    const resp = hubspotFetch_(token, url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });
    const body = resp && resp.getContentText ? resp.getContentText() : '{}';
    try {
      const parsed = JSON.parse(body || '{}');
      return parsed.results || [];
    } catch (_) {
      return [];
    }
  }

  function getOwnerIdByEmail_(token, email) {
    const url = 'https://api.hubapi.com/crm/v3/owners/?email=' + encodeURIComponent(email) + '&archived=false';
    const resp = hubspotFetch_(token, url);
    const body = resp && resp.getContentText ? resp.getContentText() : '{}';
    try {
      const parsed = JSON.parse(body || '{}');
      const owner = parsed.results && parsed.results[0];
      return owner && owner.id ? owner.id : null;
    } catch (_) {
      return null;
    }
  }

  function getHubspotToken_() {
    // Store your Private App token here (never commit to repo!)
    return PropertiesService.getScriptProperties().getProperty('HUBSPOT_PRIVATE_TOKEN');
  }
})();

if (typeof module !== 'undefined') {
  module.exports = Hubspot;
} else {
  this.Hubspot = Hubspot;
}
