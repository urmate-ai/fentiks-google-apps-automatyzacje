// Small helpers used across files.

const Utils = (() => {
  let Log = globalThis.Log || (typeof require !== 'undefined' ? require('./02_logger') : this.Log);

  function stripHtml_(html) {
    // Convert basic HTML to plain text for the model/classifier
    return (html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  function extractJson_(s) {
    // Try to extract the first {...} JSON block from a response
    if (!s) return "{}";
    const m = s.match(/\{[\s\S]*\}/);
    return m ? m[0] : s;
  }

  // Retry helper with exponential backoff: waits 2,4,8,16,32s and tries up to 5 times.
  function retryWithBackoff_(fn, maxTries) {
    const delays = [2000, 4000, 8000, 16000, 32000];
    const max = Math.min(maxTries || delays.length, delays.length);
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        return fn();
      } catch (e) {
        if (attempt === max) throw e;
        const delay = delays[attempt - 1];
        Log.warn(`Attempt ${attempt} failed; retrying in ${delay / 1000}s`, e);
        Utilities.sleep(delay);
      }
    }
  }

  return { get logger() { return Log; }, stripHtml_, extractJson_, retryWithBackoff_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Utils;
} else {
  this.Utils = Utils;
}
