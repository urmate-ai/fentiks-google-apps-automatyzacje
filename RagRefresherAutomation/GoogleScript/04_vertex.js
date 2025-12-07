const Vertex = (() => {
  function buildDataStoreBaseUrl(config) {
    const encodedProject = encodeURIComponent(config.projectId);
    const encodedLocation = encodeURIComponent(config.location);
    const encodedDataStore = encodeURIComponent(config.dataStoreId);

    return `https://discoveryengine.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/collections/default_collection/dataStores/${encodedDataStore}`;
  }

  function buildDocumentsBaseUrl(config) {
    return `${buildDataStoreBaseUrl(config)}/branches/default_branch/documents`;
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
        documents: documents.map(doc => ({
          id: doc.id,
          structData: {
            driveId: doc.id,
            entries: parseJsonlContent(doc.content),
          },
        })),
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
