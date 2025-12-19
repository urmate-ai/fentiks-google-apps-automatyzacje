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
      
      const alertMessage = 
        "========================================\n" +
        `CERTYFIKAT - OSOBA #${processedCount}\n` +
        "========================================\n" +
        `Numer LP: ${personData.lp || "Brak"}\n` +
        `Imię: ${personData.firstName || "Brak"}\n` +
        `Nazwisko: ${personData.lastName || "Brak"}\n` +
        `PESEL: ${personData.pesel || "Brak"}\n` +
        `Miejsce urodzenia: ${personData.birthPlace || "Brak"}\n` +
        `Data urodzenia: ${personData.birthDate || "Brak"}\n` +
        "---\n" +
        `Nazwa kursu: ${data.courseName}\n` +
        `Wymiar godzin: ${data.hours}\n` +
        `Prowadzący: ${data.instructor}\n` +
        `Miejscowość, data: ${data.locationDate}\n` +
        `Rozporządzenie: ${data.regulation}\n` +
        "========================================";
      
      SpreadsheetApp.getUi().alert(alertMessage);
    }
    
    if (processedCount === 0) {
      SpreadsheetApp.getUi().alert("⚠️ Nie znaleziono żadnych danych osobowych w arkuszu.");
    } else {
      SpreadsheetApp.getUi().alert(`✅ Przetworzono ${processedCount} ${processedCount === 1 ? 'osobę' : 'osób'}.`);
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