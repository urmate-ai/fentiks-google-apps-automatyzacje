// Configuration loader for script properties
const CFG = (() => {
  const props = PropertiesService.getScriptProperties();
  const get = (k, d = "") => props.getProperty(k) || d;

  const logLevel = (() => {
    const fromGemini = get("GEMINI_EMAIL_LOG_LEVEL");
    if (fromGemini) return fromGemini;
    const fromGeneric = get("LOG_LEVEL");
    return fromGeneric || "Information";
  })();

  if (typeof globalThis !== "undefined") {
    globalThis.LOG_LEVEL = logLevel;
  }

  const vertex = (() => {
    const rag = get("VERTEX_RAG_CORPORA", get("VERTEX_RAG_CORPUS", ""));
    return {
      PROJECT_ID: get("VERTEX_PROJECT_ID"),
      LOCATION: get("VERTEX_LOCATION", "europe-west3"),
      PUBLISHER: get("VERTEX_PUBLISHER", "google"),
      MODEL: get("VERTEX_MODEL", get("GEMINI_MODEL", "gemini-2.5-flash")),
      ENDPOINT: get("VERTEX_ENDPOINT"),
      ACCESS_TOKEN: get("VERTEX_ACCESS_TOKEN"),
      RAG_CORPORA: rag,
      RAG_CORPUS: rag
    };
  })();

  const signatures = {
    PL: get("DEFAULT_SIGNATURE_PL", "Mateusz Janota"),
    EN: get("DEFAULT_SIGNATURE_EN", "Mateusz Janota")
  };

  const geminiContext = (() => {
    const fromProps = get("GEMINI_SYSTEM_CONTEXT");
    if (fromProps) return fromProps;
    return [
      "You are Mateusz Janota's private email assistant trained on the history of his mailbox. Respond to emails on his behalf.",
      `Polish signature: ${signatures.PL}`,
      `English signature: ${signatures.EN}`
    ].join(" ");
  })();

  return {
    // --- Gemini (legacy API key support)
    GEMINI_API_KEY: get("GEMINI_API_KEY"),
    GEMINI_MODEL: get("GEMINI_MODEL", "gemini-2.0-flash-lite"),

    // --- Logging
    LOG_LEVEL: logLevel,

    // --- Vertex AI Gemini configuration
    VERTEX: vertex,

    // --- Threshold
    CONFIDENCE: parseFloat(get("CONFIDENCE_THRESHOLD", "0.75")),

    // --- Gmail labels
    LABELS: {
      READY: get("LABEL_READY", "Ready"),
      TEMPLATE: get("LABEL_TEMPLATE", "Template"),
      FAILED: get("LABEL_FAILED", "Failed"),
      IGNORED: get("LABEL_IGNORED", "Ignored")
    },

    // --- Email signatures
    SIGN: signatures,

    // --- Gemini system context
    GEMINI: {
      CONTEXT: geminiContext
    }
  };
})();

if (typeof module !== 'undefined') {
  module.exports = CFG;
} else {
  this.CFG = CFG;
}
