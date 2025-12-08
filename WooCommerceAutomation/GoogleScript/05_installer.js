function installMenusInAllFiles() {
  logInfo("🤖 [AUTO] Starting automatic checking...");

  const config = getConfig();

  if (!config.DRIVE_FOLDER_ID) {
    logError("❌ [AUTO] Missing DRIVE_FOLDER_ID in configuration");
    return;
  }

  try {
    const folder = DriveApp.getFolderById(config.DRIVE_FOLDER_ID);
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

    let processedCount = 0;
    let successCount = 0;
    let updatedCount = 0;

    while (files.hasNext()) {
      const file = files.next();
      processedCount++;

      if (hasInstalledScript(file)) {
        logInfo(`🔄 [AUTO] [${processedCount}] Updating existing script: ${file.getName()}`);
        
        if (updateExistingScript(file, config)) {
          updatedCount++;
          logInfo(`✅ [AUTO] Updated: ${file.getName()}`);
        } else {
          logInfo(`❌ [AUTO] Failed to update: ${file.getName()}`);
        }
        continue;
      }

      logInfo(`🚀 [AUTO] [${processedCount}] Installing: ${file.getName()}`);

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
    '    PROXY_BASE_URL: scriptProperties.getProperty("PROXY_BASE_URL") || "https://fentiksapi.onrender.com"',
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
    PROXY_BASE_URL: scriptProperties.getProperty("PROXY_BASE_URL") || "https://fentiksapi.onrender.com"
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
  return sheet.getDataRange().getValues();
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
}`.trim();
}