// HubSpot - zakomentowane
/*
function dodajKontaktDoHubSpot(contact) {
  try {
    const config = getConfig();
    const token = config.HUBSPOT_PRIVATE_TOKEN;
    
    if (!token) {
      logError("HUBSPOT_PRIVATE_TOKEN nie jest ustawiony w konfiguracji");
      return { success: false, error: "Brak tokenu HubSpot" };
    }

    const props = {
      email: contact.email || '',
      firstname: contact.firstname || contact.imie || '',
      lastname: contact.lastname || contact.nazwisko || '',
      phone: contact.phone || contact.telefon || '',
      jobtitle: contact.jobtitle || contact.stanowisko || '',
      company: contact.company || contact.firma || '',
      address: contact.address || [contact.ulica, contact.nr_domu].filter(Boolean).join(' ') || '',
      city: contact.city || contact.miasto || '',
      zip: contact.zip || contact.kod_pocztowy || '',
    };

    const existing = wyszukajKontaktWHubSpot(token, props.email, props.phone);
    if (existing) {
      logInfo(`Kontakt już istnieje w HubSpot (ID: ${existing.id})`);
      return { success: true, contactId: existing.id, existing: true };
    }

    const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
    const payload = { properties: props };
    
    const response = hubspotFetch(token, url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });

    const code = response.getResponseCode();
    
    if (code === 201 || code === 200) {
      const body = JSON.parse(response.getContentText());
      const contactId = body.id || body.properties?.hs_object_id;
      logInfo(`Kontakt dodany do HubSpot (ID: ${contactId})`);
      return { success: true, contactId: contactId, existing: false };
    } else {
      const errorBody = response.getContentText();
      logError(`Błąd dodawania kontaktu do HubSpot (${code}): ${errorBody}`);
      return { success: false, error: `HubSpot API error: ${code}`, details: errorBody };
    }
  } catch (e) {
    logError("Błąd podczas dodawania kontaktu do HubSpot", e);
    return { success: false, error: e.toString() };
  }
}

function wyszukajKontaktWHubSpot(token, email, phone) {
  if (!email && !phone) {
    return null;
  }

  try {
    const url = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
    const filters = [];
    
    if (email) {
      filters.push({
        propertyName: 'email',
        operator: 'EQ',
        value: email
      });
    }
    
    if (phone) {
      filters.push({
        propertyName: 'phone',
        operator: 'EQ',
        value: phone
      });
    }

    const payload = {
      filterGroups: [{
        filters: filters,
        operator: 'OR'
      }],
      properties: ['email', 'phone', 'firstname', 'lastname'],
      limit: 1
    };

    const response = hubspotFetch(token, url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });

    const code = response.getResponseCode();
    if (code === 200) {
      const body = JSON.parse(response.getContentText());
      if (body.results && body.results.length > 0) {
        return body.results[0];
      }
    }
    return null;
  } catch (e) {
    logError("Błąd podczas wyszukiwania kontaktu w HubSpot", e);
    return null;
  }
}

function hubspotFetch(token, url, options = {}, attempt = 1) {
  const opts = Object.assign({
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }
  }, options);

  logInfo(`Wywołanie HubSpot API: ${url}`);
  
  let response;
  try {
    response = UrlFetchApp.fetch(url, opts);
  } catch (err) {
    logError('Błąd połączenia z HubSpot', err);
    if (attempt < 3) {
      Utilities.sleep(2000);
      return hubspotFetch(token, url, options, attempt + 1);
    }
    throw err;
  }

  const code = response.getResponseCode();
  logInfo(`HubSpot API status: ${code}`);

  if ((code === 429 || code >= 500) && attempt < 3) {
    Utilities.sleep(5000);
    return hubspotFetch(token, url, options, attempt + 1);
  }

  return response;
}
*/
