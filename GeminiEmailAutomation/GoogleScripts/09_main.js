// Entrypoints for the Gmail auto-reply flow using Gemini.
// Requires: 01_config.js, 05_gmail.js, 06_reply.js, 07_utils.js, 04_gemini.js

function setup() { return Main.setup(); }
function main() { return Main.main(); }

const Main = (() => {
  const Gmail = globalThis.Gmail || (typeof require !== 'undefined' ? require('./05_gmail') : this.Gmail);
  let Log = globalThis.Log || (typeof require !== 'undefined' ? require('./02_logger') : this.Log);

  function setLogger(l) { Log = l; if (Gmail.setLogger) Gmail.setLogger(l); }

  const FLAG_KEY = 'RUNNING_SINCE';
  const MAX_RUNTIME_MS = 3 * 60 * 1000; // 3 minutes
  const FLAG_TTL_MS = MAX_RUNTIME_MS + 15 * 1000; // 3 minutes 15 seconds

  /**
   * One-time setup: ensure labels exist + set colors.
   */
  function setup() {
    const names = [
      CFG.LABELS.READY,
      CFG.LABELS.TEMPLATE,
      CFG.LABELS.FAILED,
      CFG.LABELS.IGNORED
    ].filter(Boolean);

    names.forEach(name => {
      if (!GmailApp.getUserLabelByName(name)) {
        GmailApp.createLabel(name);
        Log.info("Created label: " + name);
      }
    });

    // Set label colors (Advanced Gmail API)
    setAllLabelColors_();

    Log.info("Setup complete.");
  }

  /**
   * Main scheduler entry: fetch unread threads and process each safely.
   * Uses LockService to avoid overlapping runs when the trigger fires frequently.
   */
  function main() {
    // Prevent overlapping runs
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) {
      Log.info("Another run in progress; skipping.");
      return;
    }

    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const started = parseInt(props.getProperty(FLAG_KEY), 10);
    if (started && now - started < FLAG_TTL_MS) {
      Log.info("Previous run still active; skipping.");
      lock.releaseLock();
      return;
    }
    props.setProperty(FLAG_KEY, String(now));
    const startTime = now;

    try {
      setup(); // idempotent

      // Fetch normal unread threads and a few failed ones
      const threads = Gmail.fetchCandidateThreads_(5);
      const failed = Gmail.fetchFailedThreads_(2);
      const allThreads = threads.concat(failed);
      Log.info("Threads to process: " + allThreads.length);

      // Process each thread with error isolation and runtime limit
      for (const thread of allThreads) {
        Gmail.processThreadSafely_(thread);
        if (Date.now() - startTime >= MAX_RUNTIME_MS) {
          Log.info("Time limit reached; stopping.");
          break;
        }
      }

      Log.info("Run done.");
    } finally {
      props.deleteProperty(FLAG_KEY);
      lock.releaseLock();
    }
  }

  // --- label colors (uses Advanced Gmail API) ---
  const GmailAdv = (typeof GmailAdvanced !== 'undefined' && GmailAdvanced.Users && GmailAdvanced.Users.Labels)
    ? GmailAdvanced
    : null;


  function setLabelColor_(name, colorOrNull) {
    if (!GmailAdv) {
      Log.warn("Advanced Gmail API not enabled, cannot set colors.");
      return;
    }
    const userId = "me";
    const labels = (GmailAdv.Users.Labels.list(userId).labels || []);
    const existing = labels.find(l => l.name === name);
    if (!existing) return;

    const body = { name, color: colorOrNull === null ? null : colorOrNull };
    GmailAdv.Users.Labels.patch(body, userId, existing.id);
  }

  function setAllLabelColors_() {
    setLabelColor_(CFG.LABELS.READY,    { backgroundColor: "#16a766", textColor: "#ffffff" });
    setLabelColor_(CFG.LABELS.TEMPLATE, { backgroundColor: "#3c78d8", textColor: "#ffffff" });
    setLabelColor_(CFG.LABELS.FAILED,   { backgroundColor: "#ffad47", textColor: "#000000" });
    setLabelColor_(CFG.LABELS.IGNORED,  null); // no color
  }

  return { get logger() { return Log; }, setLogger, setup, main };
})();

if (typeof module !== 'undefined') {
  module.exports = Main;
} else {
  this.Main = Main;
}
