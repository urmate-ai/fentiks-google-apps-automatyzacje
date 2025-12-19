function installMenusInAllFiles() {
  logInfo("🤖 [AUTO] Starting automatic checking...");

  const config = getConfig();

  if (!config.DRIVE_FOLDER_ID) {
    logError("❌ [AUTO] Missing DRIVE_FOLDER_ID in configuration");
    return;
  }

  try {
    const folder = DriveApp.getFolderById(config.DRIVE_FOLDER_ID);
    
    let processedCount = 0;
    let successCount = 0;
    let updatedCount = 0;

    const allFiles = getAllSpreadsheetFilesRecursive(folder);
    
    logInfo(`📁 [AUTO] Found ${allFiles.length} files to process (including subfolders)`);

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      const fileMimeType = file.getMimeType();
      const fileType = fileMimeType === MimeType.GOOGLE_SHEETS ? "📊 Google Sheets" : "📗 Excel";
      const filePath = getFilePath(file, folder);

      if (fileMimeType === MimeType.MICROSOFT_EXCEL) {
        logInfo(`⏭️ [AUTO] Skipping Excel file (not supported): ${file.getName()}${filePath}`);
        continue;
      }

      processedCount++;

      if (hasInstalledScript(file)) {
        logInfo(`🔄 [AUTO] [${processedCount}/${allFiles.length}] Updating existing script: ${file.getName()} (${fileType})${filePath}`);
        
        if (updateExistingScript(file, config)) {
          updatedCount++;
          logInfo(`✅ [AUTO] Updated: ${file.getName()}`);
        } else {
          logInfo(`❌ [AUTO] Failed to update: ${file.getName()}`);
        }
        continue;
      }

      logInfo(`🚀 [AUTO] [${processedCount}/${allFiles.length}] Installing: ${file.getName()} (${fileType})${filePath}`);

      if (installMenuInFile(file, config)) {
        successCount++;
        logInfo(`✅ [AUTO] Success: ${file.getName()}`);
      } else {
        logInfo(`❌ [AUTO] Error: ${file.getName()}`);
      }
    }

    const summary = `🤖 [AUTO] Checked: ${processedCount} | Installed: ${successCount} | Updated: ${updatedCount}`;
    logInfo(summary);
  } catch (e) {
    logError("❌ [AUTO] Error", e);
  }
}

function getAllSpreadsheetFilesRecursive(folder, fileList = []) {
  try {
    const googleSheets = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (googleSheets.hasNext()) {
      fileList.push(googleSheets.next());
    }

    const excelFiles = folder.getFilesByType(MimeType.MICROSOFT_EXCEL);
    while (excelFiles.hasNext()) {
      fileList.push(excelFiles.next());
    }

    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      const subFolder = subFolders.next();
      logInfo(`📂 [AUTO] Searching in subfolder: ${subFolder.getName()}`);
      getAllSpreadsheetFilesRecursive(subFolder, fileList);
    }

    return fileList;
  } catch (e) {
    logError(`❌ [AUTO] Error searching folder ${folder.getName()}:`, e);
    return fileList;
  }
}

function getFilePath(file, rootFolder) {
  try {
    const parents = file.getParents();
    if (!parents.hasNext()) {
      return "";
    }
    
    const parent = parents.next();
    if (parent.getId() === rootFolder.getId()) {
      return "";
    }
    
    let path = parent.getName();
    let currentParent = parent;
    let depth = 0;
    const maxDepth = 10;
    
    while (depth < maxDepth) {
      const grandParents = currentParent.getParents();
      if (!grandParents.hasNext()) break;
      
      const grandParent = grandParents.next();
      if (grandParent.getId() === rootFolder.getId()) break;
      
      path = grandParent.getName() + " > " + path;
      currentParent = grandParent;
      depth++;
    }
    
    return " (📁 " + path + ")";
  } catch (e) {
    return "";
  }
}

function installMenuInFile(file, config) {
  try {
    const token = ScriptApp.getOAuthToken();

    logInfo(`   🔍 Checking if script already exists for: ${file.getName()}`);
    if (hasInstalledScript(file)) {
      logInfo("   ⏭️ Script already exists, skipping creation");
      return true;
    }

    logInfo(`   🚀 Creating new script for: ${file.getName()}`);

    const createResponse = UrlFetchApp.fetch(
      "https://script.googleapis.com/v1/projects",
      {
        method: "post",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        payload: JSON.stringify({
          title: file.getName() + " - WooCommerce Automation",
          parentId: file.getId(),
        }),
        muteHttpExceptions: true,
      }
    );

    const createResponseCode = createResponse.getResponseCode();
    logInfo(`   📡 Create project response code: ${createResponseCode}`);

    if (createResponseCode === 409) {
      logInfo("   ⚠️ Project already exists (409 conflict) - trying to get scriptId");
      const token = ScriptApp.getOAuthToken();
      const response = UrlFetchApp.fetch(
        `https://script.googleapis.com/v1/projects?parentId=${file.getId()}`,
        {
          method: "get",
          headers: { Authorization: "Bearer " + token },
          muteHttpExceptions: true,
        }
      );
      
      if (response.getResponseCode() === 200) {
        const result = JSON.parse(response.getContentText());
        if (result.projects && result.projects.length > 0) {
          const wooCommerceProjects = result.projects.filter(project => 
            project.title && project.title.includes("WooCommerce Automation")
          );
          if (wooCommerceProjects.length > 0) {
            const scriptId = wooCommerceProjects[0].scriptId;
            markAsInstalled(file, scriptId);
            return true;
          }
        }
      }
      markAsInstalled(file);
      return true;
    }
    
    if (createResponseCode === 404) {
      logError("   ❌ Apps Script API not available");
      return false;
    }
    
    if (createResponseCode !== 200) {
      logError(`   ❌ Unexpected response code: ${createResponseCode}`);
      return false;
    }

    const newProject = JSON.parse(createResponse.getContentText());
    if (!newProject.scriptId) return false;

    const scriptId = newProject.scriptId;

    const updateResponse = UrlFetchApp.fetch(
      `https://script.googleapis.com/v1/projects/${scriptId}/content`,
      {
        method: "put",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        payload: JSON.stringify({
          files: [
            {
              name: "WooCommerceAutomation",
              type: "SERVER_JS",
              source: generateScriptCode(config),
            },
            {
              name: "MenuTrigger",
              type: "SERVER_JS",
              source: generateMenuCode(),
            },
            {
              name: "appsscript",
              type: "JSON",
              source: JSON.stringify({
                timeZone: "Europe/Warsaw",
                exceptionLogging: "STACKDRIVER",
              }),
            },
          ],
        }),
        muteHttpExceptions: true,
      }
    );

    const updateResponseCode = updateResponse.getResponseCode();
    logInfo(`   📡 Update content response code: ${updateResponseCode}`);
    
    if (updateResponseCode === 200) {
      markAsInstalled(file, scriptId);
      logInfo(`   ✅ Script installed successfully!`);
      return true;
    }
    
    const updateResponseText = updateResponse.getContentText();
    logError(`   ❌ Update failed with code ${updateResponseCode}: ${updateResponseText}`);
    return false;
  } catch (e) {
    logError("   ❌ Error with installation", e);
    return false;
  }
}

function updateExistingScript(file, config) {
  try {
    const token = ScriptApp.getOAuthToken();
    const fileId = file.getId();
    
    logInfo(`   🔄 Updating script for: ${file.getName()}`);
    
    const scriptProperties = PropertiesService.getScriptProperties();
    const savedScriptId = scriptProperties.getProperty(`WooCommerceAutomation_${fileId}_scriptId`);
    
    let scriptId = savedScriptId;
    
    if (!scriptId) {
      logInfo(`   ℹ️ No saved scriptId found, trying to get from API...`);
      
      const response = UrlFetchApp.fetch(
        `https://script.googleapis.com/v1/projects?parentId=${fileId}`,
        {
          method: "get",
          headers: { Authorization: "Bearer " + token },
          muteHttpExceptions: true,
        }
      );
      
      if (response.getResponseCode() !== 200) {
        logError("   ❌ Could not get projects list from API and no saved scriptId");
        return false;
      }
      
      const result = JSON.parse(response.getContentText());
      if (!result.projects || result.projects.length === 0) {
        logError("   ❌ No projects found");
        return false;
      }
      
      const wooCommerceProjects = result.projects.filter(project => 
        project.title && project.title.includes("WooCommerce Automation")
      );
      
      if (wooCommerceProjects.length === 0) {
        logError("   ❌ No WooCommerce project found");
        return false;
      }
      
      scriptId = wooCommerceProjects[0].scriptId;

      scriptProperties.setProperty(`WooCommerceAutomation_${fileId}_scriptId`, scriptId);
      logInfo(`   💾 Saved scriptId for future updates: ${scriptId}`);
    } else {
      logInfo(`   ✅ Using saved scriptId: ${scriptId}`);
    }
    
    const updateResponse = UrlFetchApp.fetch(
      `https://script.googleapis.com/v1/projects/${scriptId}/content`,
      {
        method: "put",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        payload: JSON.stringify({
          files: [
            {
              name: "WooCommerceAutomation",
              type: "SERVER_JS",
              source: generateScriptCode(config),
            },
            {
              name: "MenuTrigger",
              type: "SERVER_JS",
              source: generateMenuCode(),
            },
            {
              name: "appsscript",
              type: "JSON",
              source: JSON.stringify({
                timeZone: "Europe/Warsaw",
                exceptionLogging: "STACKDRIVER",
              }),
            },
          ],
        }),
        muteHttpExceptions: true,
      }
    );
    
    const updateResponseCode = updateResponse.getResponseCode();
    if (updateResponseCode === 200) {
      logInfo("   ✅ Script updated successfully");
      return true;
    } else {
      const updateResponseText = updateResponse.getContentText();
      logError(`   ❌ Update failed with code ${updateResponseCode}: ${updateResponseText}`);
      return false;
    }
    
  } catch (e) {
    logError("   ❌ Error updating script", e);
    return false;
  }
}

function hasInstalledScript(file) {
  logInfo(`   🔍 Checking if script exists for: ${file.getName()}`);
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const installedFiles = scriptProperties.getProperty('WooCommerceAutomation_installed_files');
    const fileId = file.getId();
    
    logInfo(`   📋 Script properties - installed files: ${installedFiles}`);
    
    if (installedFiles && installedFiles.includes(fileId)) {
      logInfo(`   ✅ Found installation mark in script properties for file: ${fileId}`);
      return true;
    }

    const token = ScriptApp.getOAuthToken();

    const response = UrlFetchApp.fetch(
      `https://script.googleapis.com/v1/projects?parentId=${file.getId()}`,
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );

    logInfo(`   📡 API response code: ${response.getResponseCode()}`);

    if (response.getResponseCode() === 200) {
      const result = JSON.parse(response.getContentText());
      
      if (result.projects && result.projects.length > 0) {
        const wooCommerceProjects = result.projects.filter(project => 
          project.title && project.title.includes("WooCommerce Automation")
        );

        if (wooCommerceProjects.length > 0) {
          const scriptId = wooCommerceProjects[0].scriptId;
          logInfo(`   ✅ Found ${wooCommerceProjects.length} WooCommerce script(s) via API`);
          markAsInstalled(file, scriptId);
          return true;
        }
      }
    } else {
      logInfo(`   ℹ️ API check failed (${response.getResponseCode()}) - proceeding with installation`);
    }
    
    logInfo(`   ❌ No WooCommerce script found for: ${file.getName()}`);
    return false;
  } catch (e) {
    logError("   ❌ Error checking for existing script", e);
    return false;
  }
}

function markAsInstalled(file, scriptId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const installedFiles = scriptProperties.getProperty('WooCommerceAutomation_installed_files') || '';
    const fileId = file.getId();
    
    if (!installedFiles.includes(fileId)) {
      const newInstalledFiles = installedFiles ? `${installedFiles},${fileId}` : fileId;
      scriptProperties.setProperty('WooCommerceAutomation_installed_files', newInstalledFiles);
      scriptProperties.setProperty(`WooCommerceAutomation_${fileId}_installDate`, new Date().toISOString());
      logInfo(`   ✅ Marked file as installed: ${fileId}`);
    }
    
    if (scriptId) {
      scriptProperties.setProperty(`WooCommerceAutomation_${fileId}_scriptId`, scriptId);
      logInfo(`   💾 Saved scriptId: ${scriptId}`);
    }
  } catch (propError) {
    logInfo(`   ⚠️ Could not set script properties: ${propError.message}`);
  }
}

function clearScriptProperties() {
  logInfo("🧹 [CLEAR] Clearing all script properties...");
  
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allProperties = scriptProperties.getProperties();
    const wooCommerceKeys = Object.keys(allProperties).filter(key => 
      key.startsWith('WooCommerceAutomation_')
    );
    
    wooCommerceKeys.forEach(key => {
      scriptProperties.deleteProperty(key);
      logInfo(`   🗑️ Deleted property: ${key}`);
    });
    
    logInfo(`✅ [CLEAR] Cleared ${wooCommerceKeys.length} properties`);
  } catch (e) {
    logError("❌ [CLEAR] Error clearing properties", e);
  }
}

function generateMenuCode() {
  return [
    'function onOpen(e) {',
    '  try {',
    '    SpreadsheetApp.getUi().createMenu("Automatyzacja WooCommerce")',
    '      .addItem("Dodaj kontakty do WooCommerce", "dodajKontaktyDoWooCommerce")',
    '      .addSeparator()',
      '      .addItem("📊 Sprawdź status", "checkStatus")',
      '      .addSeparator()',
      '      .addItem("Wygeneruj certyfikat ukończenia kursu", "generateCertificate")',
      '      .addToUi();',
    '  } catch (err) {',
    '    Logger.log("[INFO] UI not available for menu creation: " + err);',
    '  }',
    '}',
    '',
    'function getConfig() {',
    '  var scriptProperties = PropertiesService.getScriptProperties();',
    '  return {',
    '    URL_BASE: scriptProperties.getProperty("URL_BASE") || "",',
    '    CONSUMER_KEY: scriptProperties.getProperty("CONSUMER_KEY") || "",',
    '    CONSUMER_SECRET: scriptProperties.getProperty("CONSUMER_SECRET") || "",',
    '    SLACK_WEBHOOK_URL: scriptProperties.getProperty("SLACK_WEBHOOK_URL") || "",',
    '    DRIVE_FOLDER_ID: scriptProperties.getProperty("DRIVE_FOLDER_ID") || "",',
    '    TUTOR_API_URL: scriptProperties.getProperty("TUTOR_API_URL") || "",',
    '    TUTOR_API_KEY: scriptProperties.getProperty("TUTOR_API_KEY") || "",',
    '    TUTOR_PRIVATE_API_KEY: scriptProperties.getProperty("TUTOR_PRIVATE_API_KEY") || "",',
    '    PROXY_BASE_URL: scriptProperties.getProperty("PROXY_BASE_URL") || "https://fentiksapi.onrender.com",',
    '    DOC_TEMPLATE_ID: scriptProperties.getProperty("DOC_TEMPLATE_ID") || ""',
    '  };',
    '}',
    '',
    'function checkStatus() {',
    '  var config = getConfig();',
    '  var status = "🤖 STATUS AUTOMATU WOOCOMMERCE\\n\\n";',
    '  status += "📁 Folder: " + (config.DRIVE_FOLDER_ID ? "✅ Ustawiony" : "❌ Brak") + "\\n";',
    '  status += "🌐 API: " + (config.URL_BASE ? "✅ Skonfigurowane" : "❌ Brak") + "\\n";',
    '  status += "🔑 Klucze: " + (config.CONSUMER_KEY ? "✅ Ustawione" : "❌ Brak") + "\\n";',
    '  status += "📱 Slack: " + (config.SLACK_WEBHOOK_URL ? "✅ Skonfigurowany" : "❌ Brak") + "\\n\\n";',
    '  status += "⚙️ Automat działa co 10 minut";',
    '  SpreadsheetApp.getUi().alert(status);',
    '}'
  ].join('\n');
}

function generateScriptCode(config) {
  const proxyBaseUrl = (config.PROXY_BASE_URL || "https://fentiksapi.onrender.com")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

  return `var CONFIG = {
  PROXY_BASE_URL: "${proxyBaseUrl}"
};

function getConfig() {
  var scriptProperties = PropertiesService.getScriptProperties();
  return {
    PROXY_BASE_URL: scriptProperties.getProperty("PROXY_BASE_URL") || "https://fentiksapi.onrender.com",
    DOC_TEMPLATE_ID: scriptProperties.getProperty("DOC_TEMPLATE_ID") || ""
  };
}

function logInfo(message) {
  Logger.log("[INFO] " + message);
}

function logError(message, error) {
  Logger.log("[ERROR] " + message + (error ? " -> " + error : ""));
}

function getSheetData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var values = sheet.getDataRange().getValues();
  
  if (!values || values.length === 0) return [];
  
  var header = values.slice(0, 3);
  var rest = values.slice(3);
  
  var filtered = rest.filter(function(row) {
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v === 0) return true;
      if (v != null && String(v).trim() !== "") return true;
    }
    return false;
  });
  
  return header.concat(filtered);
}

function dodajKontaktyDoWooCommerce() {
  var config = getConfig();
  var proxyBase = config.PROXY_BASE_URL || "https://fentiksapi.onrender.com";
  try {
    var data = getSheetData();
    var sheetName = SpreadsheetApp.getActiveSpreadsheet().getName();
    var emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    function containsEmail(row) {
      if (!row || row.length === 0) return false;
      for (var i = 0; i < row.length; i++) {
        var cell = row[i];
        if (cell != null && typeof cell === 'string' && emailRegex.test(cell)) return true;
      }
      return false;
    }
    var filtered = [];
    for (var i = 0; i < data.length; i++) {
      if (i < 3) { filtered.push(data[i]); continue; }
      if (containsEmail(data[i])) filtered.push(data[i]);
    }
    var resp = UrlFetchApp.fetch(proxyBase + "/api/sheet/process", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ rows: filtered, sheetName: sheetName }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 202) {
      SpreadsheetApp.getUi().alert("✅ Dane przyjęte do przetworzenia w tle.");
    } else if (code >= 200 && code < 300) {
      SpreadsheetApp.getUi().alert("✅ Dane przetworzone pomyślnie.");
    } else {
      var errMsg = [
        "❌ Błąd serwera (" + code + ")",
        resp.getContentText().substring(0, 300)
      ].join('\\n');
      SpreadsheetApp.getUi().alert(errMsg);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Błąd wysyłki: " + e.toString());
  }
}

function generateCertificate() {
  try {
    var htmlOutput = HtmlService.createHtmlOutput(
      '<!DOCTYPE html>' +
      '<html>' +
      '  <head>' +
      '    <base target="_top">' +
      '    <style>' +
      '      body { font-family: Arial, sans-serif; padding: 20px; max-width: 500px; }' +
      '      .form-group { margin-bottom: 15px; }' +
      '      label { display: block; margin-bottom: 5px; font-weight: bold; }' +
      '      input[type="text"], textarea { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }' +
      '      textarea { min-height: 80px; resize: vertical; }' +
      '      .button-group { margin-top: 20px; text-align: right; }' +
      '      button { padding: 10px 20px; margin-left: 10px; cursor: pointer; border: none; border-radius: 4px; }' +
      '      .btn-primary { background-color: #4285f4; color: white; }' +
      '      .btn-secondary { background-color: #f1f1f1; color: #333; }' +
      '      button:hover { opacity: 0.8; }' +
      '    </style>' +
      '  </head>' +
      '  <body>' +
      '    <h2>Generowanie certyfikatu ukończenia kursu</h2>' +
      '    <form id="certificateForm">' +
      '      <div class="form-group">' +
      '        <label for="courseName">Nazwa kursu:</label>' +
      '        <input type="text" id="courseName" name="courseName" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label for="hours">Wymiar godzin:</label>' +
      '        <input type="text" id="hours" name="hours" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label for="instructor">Prowadzący:</label>' +
      '        <input type="text" id="instructor" name="instructor" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label for="locationDate">Miejscowość, data:</label>' +
      '        <input type="text" id="locationDate" name="locationDate" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label for="regulation">Rozporządzenie:</label>' +
      '        <textarea id="regulation" name="regulation" required>Zaświadczenie wydano na podstawie § 23 ust.3 rozporządzenia Ministra Edukacji Narodowej z dnia 6 października 2023 r. w sprawie kształcenia ustawicznego w formach pozaszkolnych (Dz.U. 2023 poz. 2175).</textarea>' +
      '      </div>' +
      '      <div class="button-group">' +
      '        <button type="button" class="btn-secondary" onclick="google.script.host.close()">Anuluj</button>' +
      '        <button type="submit" class="btn-primary">Generuj</button>' +
      '      </div>' +
      '    </form>' +
      '    <script>' +
      '      document.getElementById("certificateForm").addEventListener("submit", function(e) {' +
      '        e.preventDefault();' +
      '        var formData = {' +
      '          courseName: document.getElementById("courseName").value,' +
      '          hours: document.getElementById("hours").value,' +
      '          instructor: document.getElementById("instructor").value,' +
      '          locationDate: document.getElementById("locationDate").value,' +
      '          regulation: document.getElementById("regulation").value' +
      '        };' +
      '        google.script.run' +
      '          .withSuccessHandler(function() { google.script.host.close(); })' +
      '          .withFailureHandler(function(error) { alert("Błąd: " + error.message); })' +
      '          .processCertificateData(formData);' +
      '      });' +
      '    </script>' +
      '  </body>' +
      '</html>'
    )
      .setWidth(550)
      .setHeight(500);
    
    SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Generowanie certyfikatu");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Błąd otwierania formularza: " + e.toString());
    logError("Błąd podczas otwierania formularza certyfikatu", e);
  }
}

function processCertificateData(data) {
  try {
    var sheetData = getSheetData();
    
    if (!sheetData || sheetData.length < 4) {
      SpreadsheetApp.getUi().alert("❌ Brak danych w arkuszu. Arkusz musi zawierać nagłówki i dane uczestników.");
      return;
    }

    var headerRows = sheetData.slice(0, 3);
    var dataRows = sheetData.slice(3);
    
    var columnIndices = findColumnIndices(headerRows);
    
    if (columnIndices.firstName === null && columnIndices.lastName === null) {
      SpreadsheetApp.getUi().alert("❌ Nie znaleziono wymaganych kolumn w arkuszu.\\n\\nSzukane kolumny: Imię, Nazwisko");
      return;
    }

    var processedCount = 0;
    
    for (var i = 0; i < dataRows.length; i++) {
      var row = dataRows[i];
      
      if (!row || row.length === 0) continue;
      
      var lpValue = null;
      var birthDateValue = null;
      var birthPlaceValue = null;
      
      if (row[0] !== null && row[0] !== undefined && String(row[0]).trim() !== "") {
        lpValue = String(row[0]).trim();
      } else {
        for (var j = Math.max(0, i - 3); j < i; j++) {
          var prevRow = dataRows[j];
          if (prevRow && prevRow[0] !== null && prevRow[0] !== undefined && String(prevRow[0]).trim() !== "") {
            lpValue = String(prevRow[0]).trim();
            break;
          }
        }
      }
      
      if (row[49] !== null && row[49] !== undefined && row[49] !== "") {
        birthDateValue = row[49];
      } else {
        for (var j = Math.max(0, i - 3); j < i; j++) {
          var prevRow = dataRows[j];
          if (prevRow && prevRow[49] !== null && prevRow[49] !== undefined && prevRow[49] !== "") {
            birthDateValue = prevRow[49];
            break;
          }
        }
      }
      
      if (row[50] !== null && row[50] !== undefined && String(row[50]).trim() !== "") {
        birthPlaceValue = String(row[50]).trim();
      } else {
        for (var j = Math.max(0, i - 3); j < i; j++) {
          var prevRow = dataRows[j];
          if (prevRow && prevRow[50] !== null && prevRow[50] !== undefined && String(prevRow[50]).trim() !== "") {
            birthPlaceValue = String(prevRow[50]).trim();
            break;
          }
        }
      }
      
      var personData = extractPersonData(row, columnIndices, i + 4, lpValue, birthDateValue, birthPlaceValue);
      
      if (!personData.firstName && !personData.lastName) {
        continue;
      }
      
      processedCount++;
      
      try {
        var result = generateCertificateDocument(personData, data, processedCount);
        SpreadsheetApp.getUi().alert("✅ Osoba #" + processedCount + "/" + dataRows.length + "\\n" + personData.firstName + " " + personData.lastName + "\\n\\nDokument: " + result.fileName + "\\nDoc ID: " + result.docId + "\\nPDF ID: " + result.pdfId);
      } catch (docError) {
        var errorMsg = docError.toString();
        logError("Błąd podczas generowania dokumentu dla osoby #" + processedCount + " (" + personData.firstName + " " + personData.lastName + "):", docError);
        SpreadsheetApp.getUi().alert("❌ Błąd podczas generowania dokumentu dla osoby #" + processedCount + ":\\n" + personData.firstName + " " + personData.lastName + "\\n\\nBłąd: " + errorMsg);
      }
    }
    
    if (processedCount === 0) {
      SpreadsheetApp.getUi().alert("⚠️ Nie znaleziono żadnych danych osobowych w arkuszu.");
    } else {
      SpreadsheetApp.getUi().alert("✅ Przetworzono " + processedCount + " " + (processedCount === 1 ? "osobę" : "osób") + ".\\n\\nWszystkie dokumenty zostały wygenerowane.");
    }
  } catch (e) {
    logError("Błąd podczas przetwarzania danych certyfikatu", e);
    SpreadsheetApp.getUi().alert("❌ Błąd: " + e.toString());
    throw e;
  }
}

function findColumnIndices(headerRows) {
  var indices = {
    lp: 0,
    firstName: null,
    lastName: null,
    pesel: 3,
    birthPlace: 50,
    birthDate: 49
  };
  
  for (var rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
    var row = headerRows[rowIdx] || [];
    
    for (var colIdx = 0; colIdx < row.length; colIdx++) {
      var headerValue = String(row[colIdx] || "").toLowerCase().trim();
      
      if (!indices.firstName && (headerValue.indexOf("imię") !== -1 || headerValue.indexOf("imie") !== -1 || headerValue === "firstname" || headerValue === "first_name" || headerValue === "name")) {
        indices.firstName = colIdx;
      }
      
      if (!indices.lastName && (headerValue.indexOf("nazwisko") !== -1 || headerValue === "lastname" || headerValue === "last_name" || headerValue === "surname")) {
        indices.lastName = colIdx;
      }
    }
  }
  
  return indices;
}

function extractPersonData(row, columnIndices, rowNumber, lpValue, birthDateValue, birthPlaceValue) {
  lpValue = lpValue || null;
  birthDateValue = birthDateValue || null;
  birthPlaceValue = birthPlaceValue || null;
  
  function getValue(index) {
    if (index === null || index === undefined) return null;
    var value = row[index];
    if (value === null || value === undefined || value === "") return null;
    return String(value).trim();
  }
  
  function formatDate(dateValue) {
    if (!dateValue) return null;
    
    if (typeof dateValue === "string") {
      return dateValue.trim();
    }
    
    if (dateValue instanceof Date) {
      var day = String(dateValue.getDate());
      if (day.length === 1) day = "0" + day;
      var month = String(dateValue.getMonth() + 1);
      if (month.length === 1) month = "0" + month;
      var year = dateValue.getFullYear();
      return day + "." + month + "." + year;
    }
    
    try {
      var date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        var day = String(date.getDate());
        if (day.length === 1) day = "0" + day;
        var month = String(date.getMonth() + 1);
        if (month.length === 1) month = "0" + month;
        var year = date.getFullYear();
        return day + "." + month + "." + year;
      }
    } catch (e) {
    }
    
    return String(dateValue).trim();
  }
  
  var rawBirthDate = birthDateValue;
  if (!rawBirthDate && columnIndices.birthDate !== null) {
    var dateValue = row[columnIndices.birthDate];
    if (dateValue !== null && dateValue !== undefined && dateValue !== "") {
      rawBirthDate = dateValue;
    }
  }
  
  return {
    lp: lpValue || (columnIndices.lp !== null ? getValue(columnIndices.lp) : String(rowNumber)),
    firstName: getValue(columnIndices.firstName),
    lastName: getValue(columnIndices.lastName),
    pesel: getValue(columnIndices.pesel),
    birthPlace: birthPlaceValue || getValue(columnIndices.birthPlace),
    birthDate: formatDate(rawBirthDate)
  };
}

function generateCertificateDocument(personData, formData, personNumber) {
  var DOC_TEMPLATE_ID = "1GI2DIIvK4CsxR-Ck0qStDMbwOmkrwirnLT5Mw5KGXLM";
  
  var debugMessages = [];
  
  try {
    debugMessages.push("🔍 Rozpoczynam generowanie dla: " + personData.firstName + " " + personData.lastName);
    
    var templateFile = DriveApp.getFileById(DOC_TEMPLATE_ID);
    debugMessages.push("📄 Szablon: " + templateFile.getName());
    
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var spreadsheetFile = DriveApp.getFileById(spreadsheet.getId());
    var parentFolders = spreadsheetFile.getParents();
    var targetFolder = parentFolders.hasNext() ? parentFolders.next() : DriveApp.getRootFolder();
    debugMessages.push("📁 Folder: " + targetFolder.getName());
    
    var fileName = (personData.firstName || "") + " " + (personData.lastName || "") + " zaświadczenie";
    fileName = fileName.trim();
    debugMessages.push("📝 Nazwa pliku: " + fileName);
    
    var newFile = templateFile.makeCopy(fileName, targetFolder);
    debugMessages.push("✅ Skopiowano szablon (ID: " + newFile.getId().substring(0, 10) + "...)");
    
    var newDoc = DocumentApp.openById(newFile.getId());
    var body = newDoc.getBody();
    debugMessages.push("✏️ Otwarto dokument do edycji");
    
    var replacements = {
      "name": ((personData.firstName || "") + " " + (personData.lastName || "")).trim() || "Brak",
      "dateOfBrith": personData.birthDate || "Brak",
      "id": personData.pesel || "Brak",
      "curseName": formData.courseName || "Brak",
      "hours": formData.hours || "Brak",
      "teacher": formData.instructor || "Brak",
      "nr": personData.lp || "Brak",
      "cityAndData": formData.locationDate || "Brak",
      "city": personData.birthPlace || "Brak",
      "roz": formData.regulation || "Brak"
    };
    
    var replacedCount = 0;
    for (var placeholder in replacements) {
      if (replacements.hasOwnProperty(placeholder)) {
        try {
          var beforeText = body.getText();
          body.replaceText(placeholder, replacements[placeholder]);
          var afterText = body.getText();
          if (beforeText !== afterText) {
            replacedCount++;
            var value = replacements[placeholder];
            var displayValue = value.length > 30 ? value.substring(0, 30) + "..." : value;
            debugMessages.push("✓ " + placeholder + " → " + displayValue);
          } else {
            debugMessages.push("⚠ " + placeholder + " - nie znaleziono w dokumencie");
          }
        } catch (replaceError) {
          debugMessages.push("❌ Błąd przy " + placeholder + ": " + replaceError.toString());
          logError("Błąd podczas zastępowania placeholder " + placeholder + ":", replaceError);
        }
      }
    }
    debugMessages.push("📊 Zastąpiono " + replacedCount + "/" + Object.keys(replacements).length + " placeholderów");
    
    newDoc.saveAndClose();
    debugMessages.push("💾 Zapisano dokument");
    
    var pdfBlob = newFile.getAs("application/pdf");
    var pdfFile = targetFolder.createFile(pdfBlob);
    pdfFile.setName(fileName + ".pdf");
    debugMessages.push("📄 Utworzono PDF: " + pdfFile.getName());
    
    SpreadsheetApp.getUi().alert("🔍 DEBUG - Generowanie dokumentu\\n\\n" + debugMessages.join("\\n"));
    
    return {
      docId: newFile.getId(),
      pdfId: pdfFile.getId(),
      fileName: fileName
    };
  } catch (e) {
    var errorMsg = "Błąd podczas generowania dokumentu: " + e.toString() + "\\n\\nStack: " + (e.stack || "Brak") + "\\n\\nDebug:\\n" + debugMessages.join("\\n");
    logError("Błąd podczas generowania dokumentu", e);
    throw new Error(errorMsg);
  }
}`.trim();
}