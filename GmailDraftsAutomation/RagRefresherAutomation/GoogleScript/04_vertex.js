const Vertex = (() => {
  function buildDataStoreBaseUrl(config) {
    const encodedProject = encodeURIComponent(config.projectId);
    const encodedLocation = encodeURIComponent(config.location);
    const encodedDataStore = encodeURIComponent(config.dataStoreId);

    return `https://discoveryengine.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/collections/default_collection/dataStores/${encodedDataStore}`;
  }

  function buildDocumentsBaseUrl(config) {
    // For unstructured data we use branches/0 instead of default_branch
    return `${buildDataStoreBaseUrl(config)}/branches/0/documents`;
  }

  function buildImportUrl(config) {
    return `${buildDocumentsBaseUrl(config)}:import`;
  }

  function buildListUrl(config, pageToken) {
    const base = buildDocumentsBaseUrl(config);
    if (!pageToken) {
      return base;
    }

    return `${base}?pageToken=${encodeURIComponent(pageToken)}`;
  }

  function buildDeleteUrl(_, documentName) {
    return `https://discoveryengine.googleapis.com/v1/${documentName}`;
  }

  function parseJsonlContent(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const entries = [];
    const lines = content.split(/\r?\n/);

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        entries.push(JSON.parse(trimmed));
      } catch (err) {
        entries.push({ raw: trimmed, parseError: err.message });
      }
    });

    return entries;
  }

  function buildImportPayload(documents) {
    return {
      inlineSource: {
        documents: documents.map(doc => {
          const entries = parseJsonlContent(doc.content);
          // For unstructured data, 'content' field with text for indexing is required
          // Convert JSONL entries to searchable text
          const contentText = entries
            .map(entry => {
              if (entry.raw) {
                return entry.raw;
              }
              // Extract text fields from each entry for better indexing
              const textParts = [];
              if (entry.content && entry.content.body_text) {
                textParts.push(entry.content.body_text);
              }
              if (entry.gmail && entry.gmail.subject) {
                textParts.push(`Temat: ${entry.gmail.subject}`);
              }
              if (entry.gmail && entry.gmail.snippet) {
                textParts.push(entry.gmail.snippet);
              }
              if (entry.participants) {
                const parts = [];
                if (entry.participants.from) {
                  parts.push(`Od: ${entry.participants.from.name || entry.participants.from.email || ''}`);
                }
                if (entry.participants.to && entry.participants.to.length > 0) {
                  parts.push(`Do: ${entry.participants.to.map(p => p.name || p.email || '').join(', ')}`);
                }
                if (parts.length > 0) {
                  textParts.push(parts.join(' | '));
                }
              }
              // If there's no structure, use JSON as text
              if (textParts.length === 0) {
                try {
                  return JSON.stringify(entry);
                } catch (e) {
                  return String(entry);
                }
              }
              return textParts.join('\n\n');
            })
            .filter(Boolean)
            .join('\n\n---\n\n');
          
          const documentObj = {
            id: doc.id,
          };
          
          // For unstructured data, document must have 'content' field with text
          // Vertex AI Search requires content.rawBytes (base64) with mimeType for unstructured text
          if (contentText) {
            // Convert text to base64 - in Apps Script we use Utilities.base64Encode
            // In Node.js we use btoa as fallback
            let base64;
            try {
              if (typeof Utilities !== 'undefined' && Utilities.base64Encode) {
                base64 = Utilities.base64Encode(contentText);
              } else if (typeof btoa !== 'undefined') {
                base64 = btoa(contentText);
              } else {
                // Last resort - try to manually encode base64
                // In Apps Script Utilities should always be available
                throw new Error('No base64 encoder available');
              }
              
              documentObj.content = {
                mimeType: 'text/plain',
                rawBytes: base64,
              };
            } catch (e) {
              // If we can't encode base64, log error and use structData
              // In practice, Utilities should always be available in Apps Script
              console.warn('Błąd kodowania base64:', e.message);
              // Don't add content, but keep structData
            }
          }
          
          // Also add structData for metadata and structured data
          // This helps with filtering and searching by driveId
          documentObj.structData = {
            driveId: doc.id,
            entries: entries,
          };
          
          // If we couldn't add content, use only structData (may not work for unstructured)
          // In this case the document may not be imported correctly
          if (!documentObj.content && contentText) {
            // Try to add content as string directly (some APIs accept this)
            documentObj.content = contentText;
          }
          
          return documentObj;
        }),
      },
    };
  }

  function importDocuments(config, documents, urlFetchApp, scriptApp) {
    if (!documents.length) {
      return { success: false, code: 400, body: 'No documents to import.' };
    }

    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const url = buildImportUrl(config);
    const payload = buildImportPayload(documents);
    const token = script.getOAuthToken();

    const response = fetcher.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 200 && code < 300) {
      const parsed = JSON.parse(body);
      return { success: true, code, body, operationName: parsed.name };
    }

    return { success: false, code, body };
  }

  function listDocuments(config, urlFetchApp, scriptApp) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const token = script.getOAuthToken();
    const documents = [];
    let pageToken = '';
    let lastResponseCode = 0;
    let lastBody = '';

    do {
      const url = buildListUrl(config, pageToken);
      const response = fetcher.fetch(url, {
        method: 'get',
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
      });

      lastResponseCode = response.getResponseCode();
      lastBody = response.getContentText();

      if (lastResponseCode < 200 || lastResponseCode >= 300) {
        return { success: false, code: lastResponseCode, body: lastBody };
      }

      let parsed;
      try {
        parsed = JSON.parse(lastBody);
      } catch (err) {
        return { success: false, code: lastResponseCode, body: `Invalid JSON: ${err.message}` };
      }

      if (Array.isArray(parsed.documents)) {
        documents.push(...parsed.documents);
      }

      pageToken = parsed.nextPageToken || '';
    } while (pageToken);

    return { success: true, code: lastResponseCode || 200, documents };
  }

  function deleteDocument(config, documentName, urlFetchApp, scriptApp) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;
    const url = buildDeleteUrl(config, documentName);
    const token = script.getOAuthToken();

    const response = fetcher.fetch(url, {
      method: 'delete',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 200 && code < 300) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        return { success: false, code, body: `Invalid JSON: ${err.message}` };
      }

      return { success: true, code, body, operationName: parsed.name };
    }

    return { success: false, code, body };
  }

  function buildOperationStatusUrl(operationName) {
    return `https://discoveryengine.googleapis.com/v1/${operationName}`;
  }

  function checkOperationStatus(_, operationName, urlFetchApp, scriptApp) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const url = buildOperationStatusUrl(operationName);
    const token = script.getOAuthToken();
    const response = fetcher.fetch(url, {
      method: 'get',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 200 && code < 300) {
      const parsed = JSON.parse(body);
      return {
        done: Boolean(parsed.done),
        error: parsed.error ? JSON.stringify(parsed.error) : null,
        code,
        body,
      };
    }

    return { done: false, error: `HTTP ${code}`, code, body };
  }

  return {
    buildImportUrl,
    buildImportPayload,
    parseJsonlContent,
    importDocuments,
    checkOperationStatus,
    buildOperationStatusUrl,
    buildListUrl,
    listDocuments,
    buildDeleteUrl,
    deleteDocument,
    buildDataStoreBaseUrl,
    buildDocumentsBaseUrl,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Vertex;
} else {
  this.Vertex = Vertex;
}
