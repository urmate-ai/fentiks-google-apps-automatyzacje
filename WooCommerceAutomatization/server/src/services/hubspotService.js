import axios from 'axios';
import { getHubSpotConfig } from '../config/index.js';

const HUBSPOT_API_BASE = 'https://api.hubapi.com/crm/v3';
const HUBSPOT_ASSOCIATIONS_BASE = 'https://api.hubapi.com/crm/v4';
const HUBSPOT_ASSOCIATION_LIMIT = 100;
const LOG_PAYLOAD_PREVIEW_LIMIT = 1200;

const PHONE_HEADER_KEYWORDS = [
  'telefon',
  'tel.',
  'tel',
  'phone',
  'nr telefonu',
  'numer telefonu',
  'nr tel',
  'mobile',
  'komórkowy',
  'komorkowy',
  'cell',
  'gsm'
];

function formatPayloadPreview(payload) {
  if (!payload) return '';

  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= LOG_PAYLOAD_PREVIEW_LIMIT) {
      return serialized;
    }
    return `${serialized.slice(0, LOG_PAYLOAD_PREVIEW_LIMIT)}...<truncated>`;
  } catch (error) {
    return '[unserializable payload]';
  }
}

function logHubspotRequest(context, { method = 'GET', url, payload }) {
  const preview = formatPayloadPreview(payload);
  console.log(`[HubSpot][${context}] Request ${method.toUpperCase()} ${url}${preview ? ` payload=${preview}` : ''}`);
}

function logHubspotResponse(context, response) {
  const { status, statusText } = response || {};
  console.log(`[HubSpot][${context}] Response ${status || 'n/a'} ${statusText || ''}`.trim());
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function buildNoteContent(sheetName) {
  const noteText = `Kontakt pochodzi z ${sheetName}`;
  return {
    noteText,
    noteHtml: escapeHtml(noteText)
  };
}

async function fetchAssociatedNoteIds(token, contactId) {
  const ids = [];
  let after;

  try {
    do {
      const url = `${HUBSPOT_ASSOCIATIONS_BASE}/objects/contacts/${contactId}/associations/notes?limit=${HUBSPOT_ASSOCIATION_LIMIT}${after ? `&after=${after}` : ''}`;
      logHubspotRequest('fetchAssociatedNoteIds', { method: 'GET', url });
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        validateStatus: () => true
      });
      logHubspotResponse('fetchAssociatedNoteIds', response);

      if (response.status < 200 || response.status >= 300) {
        break;
      }

      const results = response.data?.results || [];
      results.forEach(result => {
        const noteId = result.toObjectId || result.id || result?.to?.id;
        if (noteId) {
          ids.push(String(noteId));
        }
      });

      after = response.data?.paging?.next?.after;
    } while (after);
  } catch (error) {
    console.warn('[HubSpot] Failed to fetch associated notes', error.message);
  }

  return ids;
}

async function batchReadNotes(token, noteIds = []) {
  if (!noteIds.length) {
    return [];
  }

  try {
    const url = `${HUBSPOT_API_BASE}/objects/notes/batch/read`;
    logHubspotRequest('batchReadNotes', { method: 'POST', url, payload: { properties: ['hs_note_body'], inputs: noteIds.map(id => ({ id: String(id) })) } });
    const response = await axios.post(
      url,
      {
        properties: ['hs_note_body'],
        inputs: noteIds.map(id => ({ id: String(id) }))
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      }
    );
    logHubspotResponse('batchReadNotes', response);

    if (response.status >= 200 && response.status < 300) {
      return response.data?.results || [];
    }
  } catch (error) {
    console.warn('[HubSpot] Failed to batch read notes', error.message);
  }

  return [];
}

async function deleteNotes(token, noteIds = []) {
  const tasks = noteIds.map(async id => {
    try {
      const url = `${HUBSPOT_API_BASE}/objects/notes/${id}`;
      logHubspotRequest('deleteNote', { method: 'DELETE', url });
      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        validateStatus: () => true
      });
      logHubspotResponse('deleteNote', response);
    } catch (error) {
      console.warn('[HubSpot] Failed to delete note', id, error.message);
    }
  });

  await Promise.all(tasks);
}

async function ensureSingleSheetNote(token, contactId, sheetName) {
  const { noteHtml } = buildNoteContent(sheetName);
  const associatedNoteIds = await fetchAssociatedNoteIds(token, contactId);

  if (!associatedNoteIds.length) {
    return { exists: false, noteHtml };
  }

  const notes = await batchReadNotes(token, associatedNoteIds);
  const matchingNotes = notes.filter((note = {}) => {
    const body = note.properties?.hs_note_body || '';
    return body.trim() === noteHtml.trim();
  });

  if (matchingNotes.length > 1) {
    const duplicateIds = matchingNotes.slice(1).map(note => note.id).filter(Boolean);
    if (duplicateIds.length) {
      await deleteNotes(token, duplicateIds);
      console.log(`[HubSpot] Removed ${duplicateIds.length} duplicate notes for contact ${contactId}`);
    }
  }

  return {
    exists: matchingNotes.length > 0,
    noteHtml
  };
}

/**
 * Normalize phone number for "Numer telefonu" field
 * Format: +48XXXXXXXXX (without spaces)
 */
function normalizePhone(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters (including +)
  let digits = String(phone).replace(/\D/g, '');
  
  // Remove leading 48 if present
  if (digits.startsWith('48')) {
    digits = digits.substring(2);
  }
  
  // Remove leading 0 if present
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  
  // If we have exactly 9 digits, format as +48XXXXXXXXX
  if (digits && /^\d{9}$/.test(digits)) {
    return `+48${digits}`;
  }
  
  // If already in correct format (+48XXXXXXXXX), return as is
  const phoneStr = String(phone).replace(/\s/g, '');
  if (phoneStr && /^\+48\d{9}$/.test(phoneStr)) {
    return phoneStr;
  }
  
  return '';
}

/**
 * Normalize mobile phone number for "Numer telefonu komórkowego" field
 * Format: 0002XXXXXXXXX (without spaces)
 */
function normalizeMobilePhone(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let digits = String(phone).replace(/\D/g, '');
  
  // If already in correct format (0002XXXXXXXXX), return as is
  if (digits && /^0002\d{9}$/.test(digits)) {
    return digits;
  }
  
  // Remove leading 48 if present
  if (digits.startsWith('48')) {
    digits = digits.substring(2);
  }
  
  // Remove leading 0 if present (but keep it if it's part of 0002)
  if (digits.startsWith('0') && !digits.startsWith('0002')) {
    digits = digits.substring(1);
  }
  
  // If we have exactly 9 digits, format as 0002XXXXXXXXX
  if (digits && /^\d{9}$/.test(digits)) {
    return `0002${digits}`;
  }
  
  return '';
}

/**
 * Normalize domain to full URL format (adds https:// if missing)
 * HubSpot requires domain fields to be full URLs starting with http:// or https://
 */
function normalizeDomain(domain) {
  if (!domain) return '';
  
  const domainStr = String(domain).trim();
  if (!domainStr) return '';
  
  // If it already starts with http:// or https://, return as is
  if (/^https?:\/\//i.test(domainStr)) {
    return domainStr;
  }
  
  // Otherwise, add https:// prefix
  return `https://${domainStr}`;
}

/**
 * Map row data to HubSpot contact properties
 * Based on the commented code in 04_main.js mapujWierszNaKontakt function
 */
export function mapRowToContact(header, rowData) {
  const contact = {};

  if (!Array.isArray(header) || !Array.isArray(rowData)) {
    return contact;
  }

  for (let i = 0; i < header.length; i++) {
    const headerName = String(header[i] || '').toLowerCase().trim();
    const value = rowData[i];
    const normalizedValue = String(value || '').trim();
    
    // Debug: log domain-related columns
    if (headerName.includes('domena') || headerName.includes('domain') || headerName === 'dom') {
      console.log(`[HubSpot][mapRowToContact] Checking column at index ${i}: header="${header[i]}", headerName="${headerName}", value="${normalizedValue}"`);
    }

    if (headerName.includes('email') || headerName.includes('e-mail')) {
      contact.email = normalizedValue;
    } else if (headerName.includes('imię') || headerName.includes('imie') || headerName.includes('firstname') || headerName.includes('first name')) {
      contact.firstname = normalizedValue;
    } else if (headerName.includes('nazwisko') || headerName.includes('lastname') || headerName.includes('last name')) {
      contact.lastname = normalizedValue;
    } else if (PHONE_HEADER_KEYWORDS.some(keyword => headerName.includes(keyword))) {
      console.log(`[HubSpot][mapRowToContact] Found phone column at index ${i}: header="${headerName}", value="${normalizedValue}"`);
      if (normalizedValue) {
        const normalizedPhone = normalizePhone(normalizedValue);
        const normalizedMobile = normalizeMobilePhone(normalizedValue);
        
        if (!contact.phone && normalizedPhone) {
          contact.phone = normalizedPhone;
          console.log(`[HubSpot][mapRowToContact] Normalized phone: "${normalizedValue}" -> "${normalizedPhone}"`);
        }
        if (!contact.mobilephone && normalizedMobile) {
          contact.mobilephone = normalizedMobile;
          console.log(`[HubSpot][mapRowToContact] Normalized mobile: "${normalizedValue}" -> "${normalizedMobile}"`);
        }
      }
    } else if (headerName.includes('stanowisko') || headerName.includes('jobtitle') || headerName.includes('job title')) {
      contact.jobtitle = normalizedValue;
    } else if (headerName.includes('firma') || headerName.includes('company')) {
      contact.company = normalizedValue;
    } else if (headerName.includes('miasto') || headerName.includes('city')) {
      contact.city = normalizedValue;
    } else if (headerName.includes('kod pocztowy') || headerName.includes('zip') || headerName.includes('postal')) {
      contact.zip = normalizedValue;
    } else if (headerName.includes('ulica') || headerName.includes('address') || headerName.includes('street')) {
      contact.address = normalizedValue;
    } else if (headerName.includes('pesel')) {
      // PESEL - may need to be mapped to custom property in HubSpot
      contact.pesel = normalizedValue;
    } else if (headerName.includes('domena') || headerName.includes('domain')) {
      // Domain field - send to HubSpot as domena_fen property (custom HubSpot field)
      // IMPORTANT: Check for "domena" BEFORE "dom" to avoid false matches
      // Normalize to full URL format (HubSpot requires https:// or http://)
      if (normalizedValue) {
        contact.domena_fen = normalizeDomain(normalizedValue);
        console.log(`[HubSpot][mapRowToContact] Found domain column at index ${i}: header="${headerName}", value="${normalizedValue}" -> normalized="${contact.domena_fen}"`);
      }
    } else if (!headerName.includes('domena') && (headerName.includes('nr domu') || headerName.includes('house') || headerName.includes('building') || headerName === 'dom')) {
      // House/building number - can be combined with address
      // Only match if it contains house/building keywords, or is exactly "dom" but NOT "domena"
      const houseNumber = normalizedValue;
      if (houseNumber && !contact.address) {
        contact.address = houseNumber;
      } else if (houseNumber && contact.address) {
        contact.address = `${contact.address} ${houseNumber}`.trim();
      }
    }
  }

  if (contact.phone || contact.mobilephone) {
    console.log(`[HubSpot][mapRowToContact] Mapped contact with phone: phone="${contact.phone}", mobilephone="${contact.mobilephone}"`);
  }
  
  if (contact.domena_fen) {
    console.log(`[HubSpot][mapRowToContact] Mapped contact with domain: domena_fen="${contact.domena_fen}"`);
  }

  return contact;
}

/**
 * Search for existing contact by firstname and lastname
 */
async function searchByName(token, firstname, lastname) {
  if (!token || !firstname || !lastname) {
    return [];
  }

  try {
    const url = `${HUBSPOT_API_BASE}/objects/contacts/search`;
    const payload = {
      filterGroups: [{
        filters: [
          { propertyName: 'firstname', operator: 'EQ', value: firstname },
          { propertyName: 'lastname', operator: 'EQ', value: lastname }
        ]
      }],
      properties: ['email', 'phone', 'mobilephone', 'domena_fen'],
      limit: 100
    };

    logHubspotRequest('searchByName', { method: 'POST', url, payload });
    logHubspotRequest('createNoteForContact', { method: 'POST', url, payload });
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    logHubspotResponse('createNoteForContact', response);
    logHubspotResponse('searchByName', response);

    if (response.status >= 200 && response.status < 300) {
      return response.data?.results || [];
    }

    return [];
  } catch (error) {
    console.error('[HubSpot] searchByName error', error.message);
    return [];
  }
}

/**
 * Extract contact ID from HubSpot record
 */
function extractContactId(record) {
  if (!record) return null;
  if (record.id) return String(record.id);
  const props = record.properties || {};
  if (props.hs_object_id) return String(props.hs_object_id);
  return null;
}

async function updateContactProperties(token, contactId, properties = {}) {
  if (!token || !contactId || !properties || !Object.keys(properties).length) {
    return;
  }

  try {
    const url = `${HUBSPOT_API_BASE}/objects/contacts/${contactId}`;
    logHubspotRequest('updateContactProperties', { method: 'PATCH', url, payload: { properties } });
    const response = await axios.patch(
      url,
      { properties },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      }
    );
    logHubspotResponse('updateContactProperties', response);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`[HubSpot] Contact ${contactId} properties updated successfully`, properties);
    } else {
      const errorBody = response.data || response.statusText || 'Unknown error';
      console.error(`[HubSpot] Failed to update contact ${contactId} properties:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorBody,
        properties: properties
      });
    }
  } catch (error) {
    console.error('[HubSpot] Exception updating contact properties', {
      message: error.message,
      properties: properties,
      contactId: contactId
    });
  }
}

async function syncContactPhones(token, contactId, contact, existingProps = {}) {
  console.log(`[HubSpot][syncContactPhones] Starting sync for contact ${contactId}`, {
    incomingPhone: contact.phone,
    incomingMobile: contact.mobilephone,
    existingPhone: existingProps.phone,
    existingMobile: existingProps.mobilephone
  });

  const updates = {};
  
  // Normalize incoming phone numbers
  const normalizedIncomingPhone = contact.phone ? normalizePhone(contact.phone) : '';
  const normalizedIncomingMobile = contact.mobilephone ? normalizeMobilePhone(contact.mobilephone) : '';

  if (normalizedIncomingPhone) {
    const currentPhone = existingProps.phone ? String(existingProps.phone).trim() : '';
    console.log(`[HubSpot][syncContactPhones] Phone comparison: incoming="${normalizedIncomingPhone}", current="${currentPhone}"`);
    if (!currentPhone || currentPhone !== normalizedIncomingPhone) {
      updates.phone = normalizedIncomingPhone;
      console.log(`[HubSpot][syncContactPhones] Phone will be updated to "${normalizedIncomingPhone}"`);
    }
  }

  if (normalizedIncomingMobile) {
    const currentMobile = existingProps.mobilephone ? String(existingProps.mobilephone).trim() : '';
    console.log(`[HubSpot][syncContactPhones] Mobile comparison: incoming="${normalizedIncomingMobile}", current="${currentMobile}"`);
    if (!currentMobile || currentMobile !== normalizedIncomingMobile) {
      updates.mobilephone = normalizedIncomingMobile;
      console.log(`[HubSpot][syncContactPhones] Mobile will be updated to "${normalizedIncomingMobile}"`);
    }
  }

  if (Object.keys(updates).length) {
    console.log(`[HubSpot] Phone sync required for contact ${contactId}`, updates);
    await updateContactProperties(token, contactId, updates);
  } else {
    console.log(`[HubSpot] Phone sync skipped for contact ${contactId} (no changes needed)`);
  }
}

/**
 * Create a note for a contact in HubSpot
 */
async function createNoteForContact(token, contactId, sheetName) {
  if (!token || !contactId || !sheetName) {
    return;
  }

  try {
    const { exists, noteHtml } = await ensureSingleSheetNote(token, contactId, sheetName);

    if (exists) {
      console.log(`[HubSpot] Note already exists for contact ${contactId} (${sheetName}), skipping`);
      return;
    }

    const url = `${HUBSPOT_API_BASE}/objects/notes`;
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

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[HubSpot] Note created for contact ${contactId} (${sheetName})`);
    } else {
      console.warn('[HubSpot] Failed to create note', response.data?.message || response.status);
    }
  } catch (error) {
    console.warn('[HubSpot] Failed to create note', error.message);
  }
}

/**
 * Add contact to HubSpot
 * Before creating a new contact it checks if a contact with the same
 * first name and last name already exists in HubSpot. If such contact
 * exists and the incoming data contains an email or phone, those fields
 * are compared. When either email or phone matches the existing record
 * the contact is considered the same person and will not be added again.
 */
export async function addContactToHubSpot(contact, sheetName) {
  const { privateToken } = getHubSpotConfig();
  
  if (!privateToken) {
    console.warn('[HubSpot] HUBSPOT_PRIVATE_TOKEN not set, skipping HubSpot sync');
    return { success: false, error: 'Token not configured', contactId: null };
  }

  if (!contact.email && !contact.phone) {
    console.log('[HubSpot] Contact missing email and phone, skipping');
    return { success: false, error: 'Missing email and phone', contactId: null };
  }

  try {
    // Check if contact already exists
    if (contact.firstname && contact.lastname) {
      const existing = await searchByName(privateToken, contact.firstname, contact.lastname);
      
      if (existing.length > 0) {
        if (contact.email || contact.phone) {
          const match = existing.find(r => {
            const e = r.properties || {};
            const sameEmail = contact.email && e.email && 
              e.email.toLowerCase() === contact.email.toLowerCase();
            const samePhone = contact.phone && e.phone && e.phone === contact.phone;
            const sameMobile = contact.mobilephone && e.mobilephone && e.mobilephone === contact.mobilephone;
            return sameEmail || samePhone || sameMobile;
          });
          
          if (match) {
            const contactId = extractContactId(match);
            console.log('[HubSpot] Contact already exists with same email or phone, skipping', contactId);

            await syncContactPhones(privateToken, contactId, contact, match.properties || {});
            
            // Update domain if provided
            if (contact.domena_fen) {
              const existingDomain = (match.properties || {}).domena_fen || '';
              // Normalize domain to full URL format (should already be normalized, but ensure it)
              const normalizedDomain = normalizeDomain(contact.domena_fen);
              if (existingDomain !== normalizedDomain) {
                await updateContactProperties(privateToken, contactId, { domena_fen: normalizedDomain });
                console.log(`[HubSpot] Domain (domena_fen) updated for contact ${contactId}: "${normalizedDomain}"`);
              } else {
                console.log(`[HubSpot] Domain (domena_fen) already set for contact ${contactId}: "${normalizedDomain}"`);
              }
            }
            
            // Still create note for existing contact if sheetName is provided
            if (sheetName) {
              await createNoteForContact(privateToken, contactId, sheetName);
            }
            
            return { success: true, error: null, contactId, isExisting: true };
          }
        } else {
          console.log('[HubSpot] Contact with same name exists but no email/phone provided, skipping');
          return { success: false, error: 'Duplicate name without email/phone', contactId: null };
        }
      }
    }

    // Create new contact
    // Normalize phone numbers before sending to HubSpot
    const normalizedPhone = contact.phone ? normalizePhone(contact.phone) : '';
    const normalizedMobile = contact.mobilephone ? normalizeMobilePhone(contact.mobilephone) : '';
    
    const url = `${HUBSPOT_API_BASE}/objects/contacts`;
    const payload = {
      properties: {
        email: contact.email || '',
        firstname: contact.firstname || '',
        lastname: contact.lastname || '',
        phone: normalizedPhone,
        mobilephone: normalizedMobile,
        jobtitle: contact.jobtitle || '',
        company: contact.company || '',
        address: contact.address || '',
        city: contact.city || '',
        zip: contact.zip || '',
      }
    };
    
    if (normalizedPhone || normalizedMobile) {
      console.log(`[HubSpot] Normalized phone numbers for new contact: phone="${normalizedPhone}", mobile="${normalizedMobile}"`);
    }
    
    // Add PESEL if available (as custom property - adjust property name if needed)
    if (contact.pesel) {
      // Try standard custom property name format
      // If your HubSpot custom property has different name, update this
      payload.properties.pesel = contact.pesel;
    }
    
    // Add domain if available (custom HubSpot field: domena_fen)
    // Normalize to full URL format (should already be normalized, but ensure it)
    if (contact.domena_fen) {
      const normalizedDomain = normalizeDomain(contact.domena_fen);
      payload.properties.domena_fen = normalizedDomain;
      console.log(`[HubSpot] Adding domain (domena_fen) to new contact: "${normalizedDomain}"`);
    }

    logHubspotRequest('addContactToHubSpot:create', { method: 'POST', url, payload });
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${privateToken}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    logHubspotResponse('addContactToHubSpot:create', response);

    if (response.status >= 200 && response.status < 300) {
      const contactId = extractContactId(response.data);
      console.log('[HubSpot] Contact created successfully', contactId);
      
      // Create note for the new contact
      if (sheetName) {
        await createNoteForContact(privateToken, contactId, sheetName);
      }
      
      return { success: true, error: null, contactId, isExisting: false };
    } else {
      const errorMsg = response.data?.message || `HTTP ${response.status}`;
      console.error('[HubSpot] Failed to create contact', errorMsg);
      return { success: false, error: errorMsg, contactId: null };
    }
  } catch (error) {
    console.error('[HubSpot] Exception while adding contact', error.message);
    return { success: false, error: error.message, contactId: null };
  }
}

/**
 * Add contacts to HubSpot from sheet data
 * Processes contacts in batches with rate limiting
 */
export async function addContactsToHubSpotFromSheet(data, filteredRows) {
  try {
    if (!filteredRows || filteredRows.length < 4) {
      return { success: 0, errors: 0, processed: 0 };
    }

    const header = data[0];
    const HUBSPOT_BATCH_SIZE = 20;
    const dataRows = filteredRows.slice(3);
    let hubspotSuccess = 0;
    let hubspotErrors = 0;
    let processed = 0;

    for (let batchStart = 0; batchStart < dataRows.length; batchStart += HUBSPOT_BATCH_SIZE) {
      const batch = dataRows.slice(batchStart, batchStart + HUBSPOT_BATCH_SIZE);

      for (let j = 0; j < batch.length; j++) {
        const rowData = batch[j];
        const contact = mapRowToContact(header, rowData);

        if (contact.email || contact.phone) {
          const result = await addContactToHubSpot(contact);
          if (result.success) {
            hubspotSuccess++;
          } else {
            hubspotErrors++;
            console.error(`[HubSpot] Błąd dodawania kontaktu do HubSpot: ${result.error}`);
          }
          processed++;

          // Rate limiting: sleep every 5 contacts
          if (processed % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      // Sleep between batches
      if (batchStart + HUBSPOT_BATCH_SIZE < dataRows.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    if (hubspotSuccess > 0 || hubspotErrors > 0) {
      console.log(`[HubSpot] ${hubspotSuccess} dodanych, ${hubspotErrors} błędów (przetworzono ${processed} kontaktów)`);
    }

    return { success: hubspotSuccess, errors: hubspotErrors, processed };
  } catch (e) {
    console.error('[HubSpot] Błąd podczas automatycznego dodawania kontaktów do HubSpot', e);
    return { success: 0, errors: 0, processed: 0 };
  }
}

