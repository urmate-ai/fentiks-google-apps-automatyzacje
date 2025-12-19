function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Automatyzacje")
      .addItem("Dodaj kontakty do WooCommerce", "dodajKontaktyDoWooCommerce")
      .addSeparator()
      .addItem("📊 Sprawdź status", "checkStatus")
      .addSeparator()
      .addItem("Wygeneruj certyfikat ukończenia kursu", "generateCertificate")
      .addToUi();
  } catch (err) {
    Logger.log("[INFO] UI not available for menu creation: " + err);
  }
}

function dodajKontaktyDoWooCommerce() {
  const config = getConfig();
  const proxyBase = config.PROXY_BASE_URL || "";
  const BATCH_SIZE = 20;

  try {
    const data = getSheetData();
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    function containsEmail(row) {
      if (!row || row.length === 0) return false;
      for (let i = 0; i < row.length; i++) {
        let cell = row[i];
        if (cell != null && typeof cell === "string" && emailRegex.test(cell))
          return true;
      }
      return false;
    }
    let filtered = [];
    for (let i = 0; i < data.length; i++) {
      if (i < 3) {
        filtered.push(data[i]);
        continue;
      }
      if (containsEmail(data[i])) filtered.push(data[i]);
    }

    const headerRows = filtered.slice(0, 3);
    const dataRows = filtered.slice(3);
    const batches = [];

    for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
      const batch = headerRows.concat(dataRows.slice(i, i + BATCH_SIZE));
      batches.push(batch);
    }

    if (batches.length === 0) {
      SpreadsheetApp.getUi().alert("❌ Brak danych do wysłania.");
      return;
    }

    const url = proxyBase + "/api/sheet/process";
    const requests = batches.map((batch) => ({
      url: url,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ rows: batch }),
      muteHttpExceptions: true,
    }));

    const responses = UrlFetchApp.fetchAll(requests);

    let successCount = 0;
    let errorCount = 0;
    for (let i = 0; i < responses.length; i++) {
      const code = responses[i].getResponseCode();
      if (code === 202 || (code >= 200 && code < 300)) {
        successCount++;
      } else {
        errorCount++;
        const errorText = responses[i].getContentText();
        logError(`Błąd pakietu ${i + 1}/${batches.length}: ${code} - ${errorText.substring(0, 200)}`);
      }
    }

    if (errorCount === 0) {
      SpreadsheetApp.getUi().alert(
        `✅ Wszystkie pakiety (${batches.length}) przyjęte do przetworzenia w tle.\n\n` +
        `⏳ Przetwarzanie trwa... Sprawdź logi serwera dla szczegółów.`
      );
    } else if (successCount > 0) {
      SpreadsheetApp.getUi().alert(
        `⚠️ Wysłano ${successCount}/${batches.length} pakietów.\n` +
        `${errorCount} błędów.\n\n` +
        `⏳ Przetwarzanie trwa w tle...`
      );
    } else {
      SpreadsheetApp.getUi().alert(`❌ Błąd wysyłki wszystkich pakietów.`);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert(`❌ Błąd wysyłki do serwera: ${e.toString()}`);
    logError("Błąd podczas wysyłki pakietów", e);
  }
}

function generateCertificate() {
  try {
    const htmlOutput = HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
        <head>
          <base target="_top">
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              max-width: 500px;
            }
            .form-group {
              margin-bottom: 15px;
            }
            label {
              display: block;
              margin-bottom: 5px;
              font-weight: bold;
            }
            input[type="text"], textarea {
              width: 100%;
              padding: 8px;
              box-sizing: border-box;
              border: 1px solid #ccc;
              border-radius: 4px;
            }
            textarea {
              min-height: 80px;
              resize: vertical;
            }
            .button-group {
              margin-top: 20px;
              text-align: right;
            }
            button {
              padding: 10px 20px;
              margin-left: 10px;
              cursor: pointer;
              border: none;
              border-radius: 4px;
            }
            .btn-primary {
              background-color: #4285f4;
              color: white;
            }
            .btn-secondary {
              background-color: #f1f1f1;
              color: #333;
            }
            button:hover {
              opacity: 0.8;
            }
          </style>
        </head>
        <body>
          <h2>Generowanie certyfikatu ukończenia kursu</h2>
          <form id="certificateForm">
            <div class="form-group">
              <label for="courseName">Nazwa kursu:</label>
              <input type="text" id="courseName" name="courseName" required>
            </div>
            
            <div class="form-group">
              <label for="hours">Wymiar godzin:</label>
              <input type="text" id="hours" name="hours" required>
            </div>
            
            <div class="form-group">
              <label for="instructor">Prowadzący:</label>
              <input type="text" id="instructor" name="instructor" required>
            </div>
            
            <div class="form-group">
              <label for="locationDate">Miejscowość, data:</label>
              <input type="text" id="locationDate" name="locationDate" required>
            </div>
            
            <div class="form-group">
              <label for="regulation">Rozporządzenie:</label>
              <textarea id="regulation" name="regulation" required>Zaświadczenie wydano na podstawie § 23 ust.3 rozporządzenia Ministra Edukacji Narodowej z dnia 6 października 2023 r. w sprawie kształcenia ustawicznego w formach pozaszkolnych (Dz.U. 2023 poz. 2175).</textarea>
            </div>
            
            <div class="button-group">
              <button type="button" class="btn-secondary" onclick="google.script.host.close()">Anuluj</button>
              <button type="submit" class="btn-primary">Generuj</button>
            </div>
          </form>
          
          <script>
            document.getElementById('certificateForm').addEventListener('submit', function(e) {
              e.preventDefault();
              
              const formData = {
                courseName: document.getElementById('courseName').value,
                hours: document.getElementById('hours').value,
                instructor: document.getElementById('instructor').value,
                locationDate: document.getElementById('locationDate').value,
                regulation: document.getElementById('regulation').value
              };
              
              google.script.run
                .withSuccessHandler(function() {
                  google.script.host.close();
                })
                .withFailureHandler(function(error) {
                  alert('Błąd: ' + error.message);
                })
                .processCertificateData(formData);
            });
          </script>
        </body>
      </html>
    `)
      .setWidth(550)
      .setHeight(500);

    SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Generowanie certyfikatu");
  } catch (e) {
    SpreadsheetApp.getUi().alert(`❌ Błąd otwierania formularza: ${e.toString()}`);
    logError("Błąd podczas otwierania formularza certyfikatu", e);
  }
}

function processCertificateData(data) {
  try {
    const sheetData = getSheetData();
    
    if (!sheetData || sheetData.length < 4) {
      SpreadsheetApp.getUi().alert("❌ Brak danych w arkuszu. Arkusz musi zawierać nagłówki i dane uczestników.");
      return;
    }

    const headerRows = sheetData.slice(0, 3);
    const dataRows = sheetData.slice(3);
    
    const columnIndices = findColumnIndices(headerRows);
    
    if (!columnIndices.firstName && !columnIndices.lastName) {
      SpreadsheetApp.getUi().alert("❌ Nie znaleziono wymaganych kolumn w arkuszu.\n\nSzukane kolumny: Imię, Nazwisko");
      return;
    }

    let processedCount = 0;
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      if (!row || row.length === 0) continue;
      
      let lpValue = null;
      let birthDateValue = null;
      let birthPlaceValue = null;

      if (row[0] !== null && row[0] !== undefined && String(row[0]).trim() !== "") {
        lpValue = String(row[0]).trim();
      } else {    
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const prevRow = dataRows[j];
          if (prevRow && prevRow[0] !== null && prevRow[0] !== undefined && String(prevRow[0]).trim() !== "") {
            lpValue = String(prevRow[0]).trim();
            break;
          }
        }
      }
        
      if (row[49] !== null && row[49] !== undefined && row[49] !== "") {
        birthDateValue = row[49];
      } else {
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const prevRow = dataRows[j];
          if (prevRow && prevRow[49] !== null && prevRow[49] !== undefined && prevRow[49] !== "") {
            birthDateValue = prevRow[49];
            break;
          }
        }
      }
      
      if (row[50] !== null && row[50] !== undefined && String(row[50]).trim() !== "") {
        birthPlaceValue = String(row[50]).trim();
      } else {
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const prevRow = dataRows[j];
          if (prevRow && prevRow[50] !== null && prevRow[50] !== undefined && String(prevRow[50]).trim() !== "") {
            birthPlaceValue = String(prevRow[50]).trim();
            break;
          }
        }
      }
      
      const personData = extractPersonData(row, columnIndices, i + 4, lpValue, birthDateValue, birthPlaceValue);
      
      if (!personData.firstName && !personData.lastName) {
        continue;
      }
      
      processedCount++;
      
      try {
        const result = generateCertificateDocument(personData, data, processedCount);
        SpreadsheetApp.getUi().alert(`✅ Osoba #${processedCount}/${dataRows.length}\n${personData.firstName} ${personData.lastName}\n\nDokument: ${result.fileName}\nDoc ID: ${result.docId}\nPDF ID: ${result.pdfId}`);
      } catch (docError) {
        const errorMsg = docError.toString();
        logError(`Błąd podczas generowania dokumentu dla osoby #${processedCount} (${personData.firstName} ${personData.lastName}):`, docError);
        SpreadsheetApp.getUi().alert(`❌ Błąd podczas generowania dokumentu dla osoby #${processedCount}:\n${personData.firstName} ${personData.lastName}\n\nBłąd: ${errorMsg}`);
      }
    }
    
    if (processedCount === 0) {
      SpreadsheetApp.getUi().alert("⚠️ Nie znaleziono żadnych danych osobowych w arkuszu.");
    } else {
      SpreadsheetApp.getUi().alert(`✅ Przetworzono ${processedCount} ${processedCount === 1 ? 'osobę' : 'osób'}.\n\nWszystkie dokumenty zostały wygenerowane.`);
    }
  } catch (e) {
    logError("Błąd podczas przetwarzania danych certyfikatu", e);
    SpreadsheetApp.getUi().alert(`❌ Błąd: ${e.toString()}`);
    throw e;
  }
}

function findColumnIndices(headerRows) {
  const indices = {
    lp: 0, 
    firstName: null,
    lastName: null,
    pesel: 3, 
    birthPlace: 50, 
    birthDate: 49   
  };
  
  for (let rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
    const row = headerRows[rowIdx] || [];
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const headerValue = String(row[colIdx] || "").toLowerCase().trim();
      
      if (!indices.firstName && (headerValue.includes("imię") || headerValue.includes("imie") || headerValue === "firstname" || headerValue === "first_name" || headerValue === "name")) {
        indices.firstName = colIdx;
      }
      
      if (!indices.lastName && (headerValue.includes("nazwisko") || headerValue === "lastname" || headerValue === "last_name" || headerValue === "surname")) {
        indices.lastName = colIdx;
      }
    }
  }
  
  return indices;
}

function extractPersonData(row, columnIndices, rowNumber, lpValue = null, birthDateValue = null, birthPlaceValue = null) {
  const getValue = (index) => {
    if (index === null || index === undefined) return null;
    const value = row[index];
    if (value === null || value === undefined || value === "") return null;
    return String(value).trim();
  };
  
  const formatDate = (dateValue) => {
    if (!dateValue) return null;

    if (typeof dateValue === 'string') {
      return dateValue.trim();
    }
    
    if (dateValue instanceof Date) {
      const day = String(dateValue.getDate()).padStart(2, '0');
      const month = String(dateValue.getMonth() + 1).padStart(2, '0');
      const year = dateValue.getFullYear();
      return `${day}.${month}.${year}`;
    }
    
    try {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
      }
    } catch (e) {
    }
    
    return String(dateValue).trim();
  };
  
  let rawBirthDate = birthDateValue;
  if (!rawBirthDate && columnIndices.birthDate !== null) {
    const dateValue = row[columnIndices.birthDate];
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
  const DOC_TEMPLATE_ID = "1GI2DIIvK4CsxR-Ck0qStDMbwOmkrwirnLT5Mw5KGXLM";
  
  let debugMessages = [];
  
  try {
    debugMessages.push(`🔍 Rozpoczynam generowanie dla: ${personData.firstName} ${personData.lastName}`);
    
    const templateFile = DriveApp.getFileById(DOC_TEMPLATE_ID);
    debugMessages.push(`📄 Szablon: ${templateFile.getName()}`);
    
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const spreadsheetFile = DriveApp.getFileById(spreadsheet.getId());
    const parentFolders = spreadsheetFile.getParents();
    const targetFolder = parentFolders.hasNext() ? parentFolders.next() : DriveApp.getRootFolder();
    debugMessages.push(`📁 Folder: ${targetFolder.getName()}`);
    
    const fileName = `${personData.firstName || ""} ${personData.lastName || ""} zaświadczenie`.trim();
    debugMessages.push(`📝 Nazwa pliku: ${fileName}`);
    
    const newFile = templateFile.makeCopy(fileName, targetFolder);
    debugMessages.push(`✅ Skopiowano szablon (ID: ${newFile.getId().substring(0, 10)}...)`);
    
    const newDoc = DocumentApp.openById(newFile.getId());
    const body = newDoc.getBody();
    debugMessages.push(`✏️ Otwarto dokument do edycji`);
    
    const replacements = {
      'name': `${personData.firstName || ""} ${personData.lastName || ""}`.trim() || "Brak",
      'dateOfBrith': personData.birthDate || "Brak",
      'id': personData.pesel || "Brak",
      'curseName': formData.courseName || "Brak",
      'hours': formData.hours || "Brak",
      'teacher': formData.instructor || "Brak",
      'nr': personData.lp || "Brak",
      'cityAndData': formData.locationDate || "Brak",
      'city': personData.birthPlace || "Brak",
      'roz': formData.regulation || "Brak"
    };
    
    let replacedCount = 0;
    for (const [placeholder, value] of Object.entries(replacements)) {
      try {
        const beforeText = body.getText();
        body.replaceText(placeholder, value);
        const afterText = body.getText();
        if (beforeText !== afterText) {
          replacedCount++;
          debugMessages.push(`✓ ${placeholder} → ${value.substring(0, 30)}${value.length > 30 ? '...' : ''}`);
        } else {
          debugMessages.push(`⚠ ${placeholder} - nie znaleziono w dokumencie`);
        }
      } catch (replaceError) {
        debugMessages.push(`❌ Błąd przy ${placeholder}: ${replaceError.toString()}`);
        logError(`Błąd podczas zastępowania placeholder ${placeholder}:`, replaceError);
      }
    }
    debugMessages.push(`📊 Zastąpiono ${replacedCount}/${Object.keys(replacements).length} placeholderów`);
    
    newDoc.saveAndClose();
    debugMessages.push(`💾 Zapisano dokument`);
    
    const pdfBlob = newFile.getAs('application/pdf');
    const pdfFile = targetFolder.createFile(pdfBlob);
    pdfFile.setName(`${fileName}.pdf`);
    debugMessages.push(`📄 Utworzono PDF: ${pdfFile.getName()}`);
    
    // Wyświetl wszystkie komunikaty debugowe
    SpreadsheetApp.getUi().alert(`🔍 DEBUG - Generowanie dokumentu\n\n${debugMessages.join('\n')}`);
    
    return {
      docId: newFile.getId(),
      pdfId: pdfFile.getId(),
      fileName: fileName
    };
  } catch (e) {
    const errorMsg = `Błąd podczas generowania dokumentu: ${e.toString()}\n\nStack: ${e.stack || 'Brak'}\n\nDebug:\n${debugMessages.join('\n')}`;
    logError("Błąd podczas generowania dokumentu", e);
    throw new Error(errorMsg);
  }
}