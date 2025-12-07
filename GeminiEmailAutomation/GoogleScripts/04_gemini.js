// Call Gemini models (Vertex AI with optional legacy fallback) from Apps Script.

const Gemini = (() => {
  let Log = (typeof globalThis !== "undefined" && globalThis.Log)
    || (typeof require !== "undefined" ? require("./02_logger") : console);

  function setLogger(l) {
    Log = l || console;
  }

  const getCfg = () => {
    if (typeof globalThis !== "undefined" && globalThis.CFG) return globalThis.CFG;
    if (typeof require !== "undefined") {
      try {
        return require("./01_config");
      } catch (e) {
        return {};
      }
    }
    return {};
  };

  function buildUserText_(user, extras) {
    let text = user || "";
    if (extras && extras.length) {
      text += "\n\nEXTRA:\n" + extras.map(x => `${x.key}: ${x.value}`).join("\n");
    }
    return text;
  }

  function ensureAccessToken_(cfg) {
    const vertex = cfg.VERTEX || {};
    const direct = vertex.ACCESS_TOKEN || cfg.VERTEX_ACCESS_TOKEN;
    if (direct) return direct;
    if (typeof ScriptApp !== "undefined" && typeof ScriptApp.getOAuthToken === "function") {
      return ScriptApp.getOAuthToken();
    }
    throw new Error("Vertex access token not available. Provide VERTEX_ACCESS_TOKEN or ensure OAuth scopes allow ScriptApp.getOAuthToken().");
  }

  function buildVertexUrl_(cfg) {
    const vertex = cfg.VERTEX || {};
    if (vertex.ENDPOINT) return vertex.ENDPOINT;
    const project = vertex.PROJECT_ID;
    if (!project) {
      throw new Error("VERTEX_PROJECT_ID not set.");
    }
    const location = vertex.LOCATION || "europe-west3";
    const publisher = vertex.PUBLISHER || "google";
    const model = vertex.MODEL || cfg.GEMINI_MODEL || "gemini-2.5-flash";
    return `https://${encodeURIComponent(location)}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/${encodeURIComponent(publisher)}/models/${encodeURIComponent(model)}:generateContent`;
  }

  function buildVertexTools_(cfg) {
    const vertex = cfg.VERTEX || {};
    const searchDataStore = vertex.SEARCH_DATA_STORE;
    if (!searchDataStore) return undefined;
    const dataStores = searchDataStore
      .split(/[\n]/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(data_store => ({ data_store }));
    if (!dataStores.length) return undefined;
    return dataStores.map(store => ({
      retrieval: {
        vertex_ai_search: store
      }
    }));
  }

  function callVertex_(cfg, system, user, extras, responseMimeType) {
    const url = buildVertexUrl_(cfg);
    const payload = {
      contents: [{ role: "user", parts: [{ text: buildUserText_(user, extras) }] }],
      systemInstruction: { role: "system", parts: [{ text: system || "" }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024
      }
    };

    const tools = buildVertexTools_(cfg);
    if (tools) payload.tools = tools;

    if (responseMimeType) {
      payload.generationConfig.responseMimeType = responseMimeType;
    }

    const headers = {
      Authorization: `Bearer ${ensureAccessToken_(cfg)}`,
      "Content-Type": "application/json"
    };

    const payloadJson = JSON.stringify(payload);

    Log.debug("Gemini Vertex request URL:", url);
    Log.debug("Gemini Vertex payload:", payloadJson);

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      muteHttpExceptions: true,
      headers,
      payload: payloadJson
    });

    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`Gemini API error ${code}: ${text}`);
    }

    const data = JSON.parse(text);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || "").join("").trim();
  }

  function callLegacy_(cfg, system, user, extras, responseMimeType) {
    if (!cfg.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set.");
    const model = cfg.GEMINI_MODEL || "gemini-2.0-flash-lite";
    const url = "https://generativelanguage.googleapis.com/v1beta/models/"
      + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(cfg.GEMINI_API_KEY);

    const payload = {
      contents: [{ role: "user", parts: [{ text: buildUserText_(user, extras) }] }],
      systemInstruction: { role: "system", parts: [{ text: system || "" }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024
      }
    };

    if (responseMimeType) {
      payload.generationConfig.responseMimeType = responseMimeType;
    }

    const payloadJson = JSON.stringify(payload);

    Log.debug("Gemini legacy request URL:", url);
    Log.debug("Gemini legacy payload:", payloadJson);

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      muteHttpExceptions: true,
      contentType: "application/json",
      payload: payloadJson
    });

    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`Gemini API error ${code}: ${text}`);
    }

    const data = JSON.parse(text);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || "").join("").trim();
  }

  function callGeminiChat_(system, user, extras, responseMimeType) {
    const cfg = getCfg();
    const vertexConfigured = !!((cfg.VERTEX && (cfg.VERTEX.ENDPOINT || cfg.VERTEX.PROJECT_ID)));
    if (vertexConfigured) {
      return callVertex_(cfg, system, user, extras, responseMimeType);
    }
    return callLegacy_(cfg, system, user, extras, responseMimeType);
  }

  return { setLogger, callGeminiChat_ };
})();

if (typeof module !== 'undefined') {
  module.exports = Gemini;
} else {
  this.Gemini = Gemini;
}
