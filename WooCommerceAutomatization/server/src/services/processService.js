import { parseRow } from '../utils/rowParser.js';
import { getOrCreateUser } from './woocommerceService.js';
import { enrollUserToCourses } from './tutorService.js';
import { addContactToHubSpot, mapRowToContact } from './hubspotService.js';
import { BATCH_SIZE } from '../config/index.js';

function findHeaderRow(rows) {
  // Look for header row in first 5 rows
  // Header row should contain common field names like "imię", "nazwisko", "email", "telefon"
  const headerKeywords = ['imię', 'imie', 'firstname', 'nazwisko', 'lastname', 'email', 'e-mail', 'telefon', 'phone', 'tel'];
  
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (!Array.isArray(rows[i])) continue;
    
    const row = rows[i];
    let matchCount = 0;
    
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      if (headerKeywords.some(keyword => cell.includes(keyword))) {
        matchCount++;
      }
    }
    
    // If we found at least 2 matching keywords, this is likely the header row
    if (matchCount >= 2) {
      console.log(`[PROC] Found header row at index ${i} with ${matchCount} matching keywords`);
      return row;
    }
  }
  
  // Fallback: use row[2] if headerOffset is 3, or row[0] otherwise
  const fallbackIndex = rows.length > 2 ? 2 : 0;
  console.log(`[PROC] Using fallback header row at index ${fallbackIndex}`);
  return Array.isArray(rows[fallbackIndex]) ? rows[fallbackIndex] : [];
}

export async function processRowsBatch(rows, startIndex, endIndex, sheetName) {
  const summary = { scanned: 0, newUsers: 0, existingUsers: 0, enrollAdded: 0, enrollFailed: 0, hubspotAdded: 0, hubspotErrors: 0 };
  
  // Find header row by looking for common field names
  const header = findHeaderRow(rows);
  
  for (let i = startIndex; i < endIndex && i < rows.length; i++) {
    try {
      const row = rows[i];
      const { firstName, lastName, email, postcode, city } = parseRow(row);
      
      if (!email || !firstName || !lastName) {
        console.log('[PROC] skip row', { 
          i, 
          len: Array.isArray(row) ? row.length : Object.keys(row || {}).length 
        });
        continue;
      }
      
      summary.scanned++;
      
      const userData = { firstName, lastName, email, postcode, city };
      const { userId, isNew } = await getOrCreateUser(userData);
      
      if (!userId) {
        console.warn('[PROC] skip - user not created/found', email);
        continue;
      }
      
      if (isNew) {
        summary.newUsers++;
      } else {
        summary.existingUsers++;
      }
      
      const enrollResult = await enrollUserToCourses(userId);
      summary.enrollAdded += enrollResult.added;
      summary.enrollFailed += enrollResult.failed;

      // Add contact to HubSpot - use mapRowToContact to get all available fields from header mapping
      console.log(`[PROC] Mapping contact for ${email}, header length: ${header.length}, row length: ${Array.isArray(row) ? row.length : 0}`);
      const hubspotContact = mapRowToContact(header, Array.isArray(row) ? row : []);
      console.log(`[PROC] Mapped contact:`, { 
        email: hubspotContact.email, 
        firstname: hubspotContact.firstname, 
        lastname: hubspotContact.lastname,
        phone: hubspotContact.phone,
        mobilephone: hubspotContact.mobilephone,
        domena_fen: hubspotContact.domena_fen
      });
      
      // Ensure we have at least email, firstname, lastname from parsed data
      if (!hubspotContact.email) hubspotContact.email = email;
      if (!hubspotContact.firstname) hubspotContact.firstname = firstName;
      if (!hubspotContact.lastname) hubspotContact.lastname = lastName;
      if (!hubspotContact.city && city) hubspotContact.city = city;
      if (!hubspotContact.zip && postcode) hubspotContact.zip = postcode;
      
      const hubspotResult = await addContactToHubSpot(hubspotContact, sheetName);
      if (hubspotResult.success) {
        summary.hubspotAdded++;
      } else {
        summary.hubspotErrors++;
      }
      
    } catch (rowErr) {
      console.error('[PROC] row error', rowErr.message);
    }
  }
  
  return summary;
}

export async function processRows(rows, sheetName) {
  const totalSummary = { scanned: 0, newUsers: 0, existingUsers: 0, enrollAdded: 0, enrollFailed: 0, hubspotAdded: 0, hubspotErrors: 0 };
  
  const isObjectFormat = rows.length > 0 && !Array.isArray(rows[0]) && typeof rows[0] === 'object' && rows[0] !== null;
  const headerOffset = isObjectFormat ? 0 : 3;
  const dataRows = rows.slice(headerOffset);
  
  console.log(`[PROC] Format detection: ${isObjectFormat ? 'object' : 'array'}, headerOffset: ${headerOffset}, totalRows: ${rows.length}, dataRows: ${dataRows.length}`);
  
  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, dataRows.length);
    const batchIndex = i + headerOffset;
    
    console.log(`[PROC] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dataRows.length / BATCH_SIZE)} (rows ${batchIndex}-${batchIndex + batchEnd - i - 1})`);
    
    const batchSummary = await processRowsBatch(rows, batchIndex, batchIndex + (batchEnd - i), sheetName);
    
    totalSummary.scanned += batchSummary.scanned;
    totalSummary.newUsers += batchSummary.newUsers;
    totalSummary.existingUsers += batchSummary.existingUsers;
    totalSummary.enrollAdded += batchSummary.enrollAdded;
    totalSummary.enrollFailed += batchSummary.enrollFailed;
    totalSummary.hubspotAdded += batchSummary.hubspotAdded;
    totalSummary.hubspotErrors += batchSummary.hubspotErrors;
  }
  
  return totalSummary;
}

