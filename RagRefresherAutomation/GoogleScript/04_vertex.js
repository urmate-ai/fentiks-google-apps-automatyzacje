const Vertex = (() => {
  function buildRagFilesBaseUrl(config) {
    const encodedProject = encodeURIComponent(config.projectId);
    const encodedLocation = encodeURIComponent(config.location);
    const encodedCorpus = encodeURIComponent(config.corpusId);

    return `https://${config.location}-aiplatform.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/ragCorpora/${encodedCorpus}/ragFiles`;
  }

  function buildImportUrl(config) {
    return `${buildRagFilesBaseUrl(config)}:import`;
  }

  function buildListUrl(config, pageToken) {
    const base = buildRagFilesBaseUrl(config);
    if (!pageToken) {
      return base;
    }

    return `${base}?pageToken=${encodeURIComponent(pageToken)}`;
  }

  function buildDeleteUrl(config, ragFileName) {
    return `https://${config.location}-aiplatform.googleapis.com/v1/${ragFileName}`;
  }

  function buildImportPayload(resourceIds) {
    return {
      importRagFilesConfig: {
        googleDriveSource: {
          resourceIds,
        },
      },
    };
  }

  function buildResourceIds(fileIds) {
    return fileIds.map(id => ({
      resourceType: 'RESOURCE_TYPE_FILE',
      resourceId: id,
    }));
  }

  function importRagFiles(config, fileIds, urlFetchApp, scriptApp) {
    if (!fileIds.length) {
      return { success: false, code: 400, body: 'No files to import.' };
    }

    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const url = buildImportUrl(config);
    const resourceIds = buildResourceIds(fileIds);
    const payload = buildImportPayload(resourceIds);
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

  function listRagFiles(config, urlFetchApp, scriptApp) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;

    const token = script.getOAuthToken();
    const ragFiles = [];
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

      if (Array.isArray(parsed.ragFiles)) {
        ragFiles.push(...parsed.ragFiles);
      }

      pageToken = parsed.nextPageToken || '';
    } while (pageToken);

    return { success: true, code: lastResponseCode || 200, ragFiles };
  }

  function deleteRagFile(config, ragFileName, urlFetchApp, scriptApp, options = {}) {
    const fetcher = urlFetchApp || UrlFetchApp;
    const script = scriptApp || ScriptApp;
    const url = buildDeleteUrl(config, ragFileName);
    const token = script.getOAuthToken();

    const query = options.forceDelete ? '?forceDelete=true' : '';
    const response = fetcher.fetch(`${url}${query}`, {
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

  function buildOperationStatusUrl(config, operationName) {
    return `https://${config.location}-aiplatform.googleapis.com/v1/${operationName}`;
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
    buildResourceIds,
    importRagFiles,
    checkOperationStatus,
    buildOperationStatusUrl,
    buildListUrl,
    listRagFiles,
    buildDeleteUrl,
    deleteRagFile,
    buildRagFilesBaseUrl,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Vertex;
} else {
  this.Vertex = Vertex;
}
