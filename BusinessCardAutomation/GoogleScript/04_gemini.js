const Gemini = (() => {
  let logger = this.logger || (typeof require !== 'undefined' && require('./02_logger'));

  function setLogger(l) { logger = l; }

  /**
   * Gemini API helpers.
   */
  // Reads blob → calls Gemini (OCR+extraction) → returns normalized fields
  function extractWithGeminiFromImage_(file) {
    logger.debug('Calling Gemini for file', file.getName());
    const blob = file.getBlob();
    const mime = blob.getContentType();
    const base64 = Utilities.base64Encode(blob.getBytes());

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      GEMINI_MODEL + ':generateContent?key=' + getGeminiApiKey_();

    const prompt = [
      'You are an information extraction engine for business cards.',
      'Return STRICT JSON only (no prose, no code fences).',
      'Return an array with a single object with these lowercase Polish keys:',
      'imie, nazwisko, email, stanowisko, pesel, telefon, firma, ulica, nr_domu, kod_pocztowy, miasto.',
      'If multiple phone numbers are present, prefer the mobile number in "telefon".',
      'If unknown, return empty string.',
      'Be conservative; do not hallucinate.'
    ].join(' ');

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json'
      }
    };

    const delays = [2000, 4000, 8000, 16000];
    let lastError;
    let responseContent;
    let parsed;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const resp = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(body),
          muteHttpExceptions: true
        });

        const status = resp.getResponseCode ? resp.getResponseCode() : 200;
        responseContent = resp.getContentText();
        if (status < 200 || status >= 300) {
          const errPayload = safeJsonParse_(responseContent);
          const errMsg = errPayload?.error?.message || ('HTTP ' + status);
          throw new Error('Gemini HTTP error: ' + errMsg);
        }

        parsed = safeJsonParse_(responseContent);
        if (!parsed) {
          throw new Error('Unable to parse Gemini response JSON.');
        }
        break;
      } catch (err) {
        lastError = err;
        logger.warn('Gemini call failed', 'attempt', attempt + 1, 'of', delays.length + 1, 'for', file.getName(), err);
        if (attempt === delays.length) {
          throw new Error('Gemini call failed after retries: ' + err.message);
        }
        Utilities.sleep(delays[attempt]);
      }
    }

    const raw = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      const err = parsed?.error?.message || 'Empty Gemini response.';
      logger.error('Gemini error response', parsed || responseContent);
      throw new Error('Gemini error: ' + err);
    }

    const j = JSON.parse(raw);
    const result = {
      imie: (j[0].imie || '').toString().trim(),
      nazwisko: (j[0].nazwisko || '').toString().trim(),
      email: (j[0].email || '').toString().trim(),
      stanowisko: (j[0].stanowisko || '').toString().trim(),
      pesel: (j[0].pesel || '').toString().trim(),
      telefon: (j[0].telefon || '').toString().trim(),
      firma: (j[0].firma || '').toString().trim(),
      ulica: (j[0].ulica || '').toString().trim(),
      nr_domu: (j[0].nr_domu || '').toString().trim(),
      kod_pocztowy: (j[0].kod_pocztowy || '').toString().trim(),
      miasto: (j[0].miasto || '').toString().trim()
    };
    logger.info('Gemini extraction result for', file.getName(), result);
    return result;
  }

  function getGeminiApiKey_() {
    const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('Missing GEMINI_API_KEY in Script properties.');
    return key;
  }

  function safeJsonParse_(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      logger.warn('Failed to parse JSON text from Gemini', err);
      return null;
    }
  }

  return { setLogger, extractWithGeminiFromImage_, getGeminiApiKey_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Gemini;
} else {
  this.Gemini = Gemini;
}
