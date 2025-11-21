const Gemini = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./01_logger'));
  let apiKeyOverride = null;

  function setLogger(l) {
    logger = l;
  }

  function setApiKeyOverride(key) {
    apiKeyOverride = key;
  }

  function extractInvoicesFromBlob(blob) {
    const mime = blob.getContentType ? blob.getContentType() : 'application/pdf';
    logger.info('Requesting Gemini extraction for blob', blob.getName ? blob.getName() : '');

    const key = getGeminiApiKey_();
    const base64 = Utilities.base64Encode(blob.getBytes());

    // Prompt enforces strict JSON with invoices array and highlights VAT rules.
    const prompt = [
      'You are an accounting assistant extracting structured data from Polish invoices.',
      'Return ONLY valid JSON with a top-level object containing an "invoices" array.',
      'Each entry MUST include invoiceNumber, issueDate (YYYY-MM-DD), currency,',
      'seller { name, taxId, address { street, postalCode, city, country } },',
      'buyer { name, taxId, address { street, postalCode, city, country } }, netAmount, vatAmount,',
      'vatRatePercent, grossAmount, salesType, paymentDueDate, deliveryDate,',
      'vatLines[{ ratePercent, netAmount, vatAmount, grossAmount }]. PTU means',
      '"Podatek od towarów i usług" (VAT) and can be 23, 8, 5, 0 or "zw" (exempt).',
      'Whenever you see phrases like "Sprzedaż opodatkowana A 72,00" and "PTU A 23% 13,46",',
      'always treat the letter markers as fixed VAT mappings: A = 23%, B = 8%, C = 5%.',
      'The "Sprzedaż opodatkowana" row is the gross amount for that rate and the PTU row',
      'is the VAT amount for the same rate.',
      'Record a vatLines entry with ratePercent 23, grossAmount 72.00, vatAmount 13.46 and',
      'netAmount = grossAmount - vatAmount. PTU values are VAT amounts, never net.',
      'Always include the grossAmount exactly as printed on the invoice; do not replace it',
      'with a derived value when the source already provides it.',
      'Match letter markers (A/B/C…) so each PTU row pairs with its "Sprzedaż opodatkowana" row.',
      'Each PTU rate present on the invoice must produce a vatLines entry with matching ratePercent',
      'and monetary amounts so we can fill iFirma fields NumerFaktury, DataWystawienia, NazwaWydatku,',
      'RodzajSprzedazy, KwotaNetto23/08/05/00/Zw and KwotaVat23/08/05. Capture optional values such as',
      'TerminPlatnosci, Kontrahent address or contact details whenever they appear. Use',
      'vatRatePercent: 0 and set vatExemptionReason when the invoice indicates VAT exemption.',
      'Extract payment context: amountPaid (numeric), amountPaidLabel (string exactly as next to "Zapłacono"), amountDue or',
      'remaining balance, paymentStatus (values like "paid", "partial", "unpaid") and paymentMethod. When payment method appears,',
      'set paymentMethod to one of these iFirma codes: GTK (gotówka), POB (za pobraniem), PRZ (przelew), KAR (karta), PZA (polecenie',
      'zapłaty), CZK (czek), KOM (kompensata), BAR (barter), DOT (DotPay), PAL (PayPal), ALG (PayU), P24 (Przelewy24), TPA (tpay.com),',
      'ELE (płatność elektroniczna). Capture a lineItems array with entries { description, quantity, unitPrice, vatRatePercent,',
      'netAmount, vatAmount, grossAmount } whenever positions are visible. Include detectedCurrencies when more than one currency',
      'appears so we can route for manual review. Never hallucinate values and never copy PTU numbers into netAmount.'
    ].join(' ');

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      'gemini-2.5-flash:generateContent?key=' + key;

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
      },
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response.getContentText());
    } catch (err) {
      logger.error('Unable to parse Gemini HTTP response', err);
      throw new Error('Gemini responded with invalid JSON payload.');
    }

    const raw = parsedResponse && parsedResponse.candidates &&
      parsedResponse.candidates[0] && parsedResponse.candidates[0].content &&
      parsedResponse.candidates[0].content.parts &&
      parsedResponse.candidates[0].content.parts[0] &&
      parsedResponse.candidates[0].content.parts[0].text;

    if (!raw) {
      const errMsg = parsedResponse && parsedResponse.error && parsedResponse.error.message;
      logger.error('Gemini missing content', parsedResponse);
      throw new Error('Gemini error: ' + (errMsg || 'Empty response'));
    }

    let invoicesContainer;
    try {
      invoicesContainer = JSON.parse(raw);
    } catch (err) {
      logger.error('Gemini returned non-JSON content', raw);
      throw new Error('Gemini produced invalid JSON in candidate text.');
    }

    const invoicesArray = Array.isArray(invoicesContainer)
      ? invoicesContainer
      : invoicesContainer && Array.isArray(invoicesContainer.invoices)
        ? invoicesContainer.invoices
        : null;

    if (!Array.isArray(invoicesArray)) {
      logger.error('Gemini JSON missing invoices array', invoicesContainer);
      throw new Error('Gemini response did not contain invoices array.');
    }

    const normalised = invoicesArray.map((invoice, index) => normaliseInvoice_(invoice, index));
    logger.debug('Gemini extracted invoices count', normalised.length);
    return normalised;
  }

  function normaliseInvoice_(invoice, index) {
    if (!invoice || typeof invoice !== 'object') {
      throw new Error('Invoice #' + index + ' is not an object.');
    }
    const seller = invoice.seller || {};
    const buyer = invoice.buyer || {};

    const sellerAddress = normaliseAddress_(seller.address || invoice.sellerAddress || seller);
    const buyerAddress = normaliseAddress_(buyer.address || invoice.buyerAddress || buyer);

    const vatRatePercent = coerceNumber(invoice.vatRatePercent);
    const vatAmount = coerceNumber(invoice.vatAmount);
    const netAmount = coerceNumber(invoice.netAmount);
    const grossAmount = coerceNumber(invoice.grossAmount);
    const salesType = coerceString(invoice.salesType || invoice.transactionType);
    const paymentDueDate = coerceString(invoice.paymentDueDate || invoice.paymentDue || invoice.paymentTermDate);
    const deliveryDate = coerceString(invoice.deliveryDate || invoice.deliveryDateOfSupply);

    const vatLines = Array.isArray(invoice.vatLines)
      ? invoice.vatLines.map((line) => {
        const ratePercent = coerceNumber(line && line.ratePercent);
        const lineNet = coerceNumber(line && line.netAmount);
        const lineVat = coerceNumber(line && line.vatAmount);
        const lineGross = coerceNumber(line && (line.grossAmount !== undefined ? line.grossAmount : line.gross));
        const normalisedLine = {};
        if (typeof ratePercent === 'number') {
          normalisedLine.ratePercent = ratePercent;
          normalisedLine.vatRatePercent = ratePercent;
        }
        if (typeof lineNet === 'number') {
          normalisedLine.netAmount = lineNet;
        }
        if (typeof lineVat === 'number') {
          normalisedLine.vatAmount = lineVat;
        }
        if (typeof lineGross === 'number') {
          normalisedLine.grossAmount = lineGross;
        }
        return normalisedLine;
      })
      : [];

    const amountPaid = coerceNumber(
      invoice.amountPaid
        || invoice.paidAmount
        || invoice.zaplacono
        || invoice.paid
    );
    const amountDue = coerceNumber(
      invoice.amountDue
        || invoice.balanceDue
        || invoice.remainingAmount
        || invoice.pozostaloDoZaplaty
    );
    const paymentStatus = coerceString(invoice.paymentStatus || invoice.status);
    const paymentMethod = coerceString(
      invoice.paymentMethodCode
        || invoice.paymentMethod
        || invoice.methodOfPayment
        || invoice.paymentType
    );
    const amountPaidLabel = coerceString(
      invoice.amountPaidLabel
        || invoice.amountPaidText
        || invoice.zaplaconoLabel
        || invoice.zaplaconoText
    );

    const rawLineItems = Array.isArray(invoice.lineItems)
      ? invoice.lineItems
      : Array.isArray(invoice.items)
        ? invoice.items
        : [];
    const lineItems = rawLineItems.map((item) => {
      const description = coerceString(item && (item.description || item.name || item.title));
      const quantity = coerceNumber(item && (item.quantity || item.qty || item.amount));
      const unitPrice = coerceNumber(item && (item.unitPrice || item.price || item.unitNet || item.unitGross));
      const itemNet = coerceNumber(item && (item.netAmount || item.net || item.valueNet));
      const itemVat = coerceNumber(item && (item.vatAmount || item.vat || item.valueVat));
      const itemGross = coerceNumber(item && (item.grossAmount || item.gross || item.valueGross || item.totalAmount));
      const itemRate = coerceNumber(item && (item.vatRatePercent || item.ratePercent || item.vatRate));
      const normalisedItem = {};
      if (description) normalisedItem.description = description;
      if (typeof quantity === 'number') normalisedItem.quantity = quantity;
      if (typeof unitPrice === 'number') normalisedItem.unitPrice = unitPrice;
      if (typeof itemNet === 'number') normalisedItem.netAmount = itemNet;
      if (typeof itemVat === 'number') normalisedItem.vatAmount = itemVat;
      if (typeof itemGross === 'number') normalisedItem.grossAmount = itemGross;
      if (typeof itemRate === 'number') normalisedItem.vatRatePercent = itemRate;
      return normalisedItem;
    }).filter((item) => Object.keys(item).length);

    let detectedCurrencies = invoice.detectedCurrencies;
    if (!Array.isArray(detectedCurrencies)) {
      detectedCurrencies = typeof detectedCurrencies === 'string' && detectedCurrencies
        ? detectedCurrencies.split(/[,;]/).map((c) => c.trim()).filter(Boolean)
        : [];
    }

    const normalised = {
      invoiceNumber: coerceString(invoice.invoiceNumber),
      issueDate: coerceString(invoice.issueDate),
      currency: coerceString(invoice.currency),
      seller: {
        name: coerceString(seller.name),
        taxId: coerceString(seller.taxId),
        address: sellerAddress,
      },
      buyer: {
        name: coerceString(buyer.name),
        taxId: coerceString(buyer.taxId),
        address: buyerAddress,
      },
      netAmount,
      vatAmount,
      vatRatePercent: typeof vatRatePercent === 'number' ? vatRatePercent : undefined,
      grossAmount,
      vatExemptionReason: coerceString(invoice.vatExemptionReason),
      salesType,
      paymentDueDate,
      deliveryDate,
      vatLines,
      detectedCurrencies,
      amountPaid,
      amountDue,
      paymentStatus,
      paymentMethod,
      lineItems,
    };

    if (amountPaidLabel) {
      normalised.amountPaidLabel = amountPaidLabel;
    }

    if (normalised.vatExemptionReason && typeof normalised.vatRatePercent !== 'number') {
      normalised.vatRatePercent = 0;
    }

    if (detectedCurrencies.length > 1) {
      normalised.requiresManualReview = true;
    }

    return normalised;
  }

  function coerceString(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function coerceNumber(value) {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const num = Number(String(value).replace(',', '.'));
    return Number.isFinite(num) ? num : undefined;
  }

  function normaliseAddress_(address) {
    const source = address && typeof address === 'object' ? address : {};
    return {
      street: coerceString(
        source.street || source.street1 || source.streetAddress || source.addressLine || source.line1
      ),
      postalCode: coerceString(source.postalCode || source.zip || source.postCode),
      city: coerceString(source.city || source.town || source.locality),
      country: coerceString(source.country || source.countryCode || source.countryName),
    };
  }

  function getGeminiApiKey_() {
    if (apiKeyOverride) {
      return apiKeyOverride;
    }
    const propsService = PropertiesService.getScriptProperties();
    const key = propsService.getProperty('GEMINI_API_KEY');
    if (!key) {
      throw new Error('Missing GEMINI_API_KEY in script properties');
    }
    return key;
  }

  return {
    setLogger,
    setApiKeyOverride,
    extractInvoicesFromBlob,
    getGeminiApiKey_,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = Gemini;
} else {
  this.Gemini = Gemini;
}
