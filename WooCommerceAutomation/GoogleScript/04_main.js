function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Automatyzacja WooCommerce")
      .addItem("Dodaj kontakty do WooCommerce", "dodajKontaktyDoWooCommerce")
      .addSeparator()
      .addItem("📊 Sprawdź status", "checkStatus")
      .addItem("🔌 Test proxy", "testProxyConnection")
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
