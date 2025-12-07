const Vertex = (() => {
  const DEFAULT_BRANCH = 'default_branch';

  function buildDocumentsBaseUrl(config) {
    const encodedProject = encodeURIComponent(config.projectId);
    const encodedLocation = encodeURIComponent(config.location);
    const encodedDataStore = encodeURIComponent(config.dataStoreId);

    return `https://${config.location}-discoveryengine.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/collections/default_collection/dataStores/${encodedDataStore}/branches/${DEFAULT_BRANCH}/documents`;
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

  function buildDeleteUrl(config, documentName) {
    if (documentName && documentName.startsWith('projects/')) {
      return `https://${config.location}-discoveryengine.googleapis.com/v1/${documentName}`;
    }

    return `${buildDocumentsBaseUrl(config)}/${encodeURIComponent(documentName)}`;
  }

  function buildImportPayload(fileIds) {
    const documents = fileIds.map(id => ({
      id,
      structData: { driveId: id },
      content: {
        uri: `https://drive.google.com/uc?id=${encodeURIComponent(id)}&export=download`,
      },
    }));

    return { inlineSource: { documents } };
  }

  function importDocuments(config, fileIds, urlFetchApp, scriptApp) {
    if (!fileIds.length) {
      return { success: false, code: 400, body: 'No files to import.' };
    }

    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const url = buildImportUrl(config);
    const payload = buildImportPayload(fileIds);
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
      if (!body) {
        return { success: true, code, body: '' };
      }

      try {
        const parsed = JSON.parse(body);
        return { success: true, code, body, operationName: parsed.name };
      } catch (err) {
        return { success: false, code, body: `Invalid JSON: ${err.message}` };
      }
    }

    return { success: false, code, body };
  }

  function buildOperationStatusUrl(config, operationName) {
    return `https://${config.location}-discoveryengine.googleapis.com/v1/${operationName}`;
  }

  function checkOperationStatus(config, operationName, urlFetchApp, scriptApp) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const url = buildOperationStatusUrl(config, operationName);
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
    importDocuments,
    checkOperationStatus,
    buildOperationStatusUrl,
    buildListUrl,
    listDocuments,
    buildDeleteUrl,
    deleteDocument,
    buildDocumentsBaseUrl,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Vertex;
} else {
  this.Vertex = Vertex;
}
