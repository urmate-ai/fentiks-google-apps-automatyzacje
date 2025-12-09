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
    const searchRaw = vertex.SEARCH_DATA_STORES || vertex.SEARCH_DATA_STORE;
    if (!searchRaw) {
      Log.debug("No data store configured - VERTEX_SEARCH_DATA_STORES/SEARCH_DATA_STORE is empty");
      return undefined;
    }
    
    const dataStores = searchRaw
      .split(/[\,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (!dataStores.length) {
      Log.debug("No valid data store IDs found after parsing");
      return undefined;
    }
    
    // Build full resource path if not already provided
    const dataStoreId = dataStores[0];
    let dataStorePath = dataStoreId;
    
    // If it's not a full path, construct it
    if (!dataStoreId.includes('/')) {
      const project = vertex.PROJECT_ID;
      if (!project) {
        throw new Error("VERTEX_PROJECT_ID must be set when using dataStore ID instead of full resource path.");
      }
      const location = vertex.LOCATION || "europe-west3";
      // Default collection is "default_collection" if not specified
      const collection = vertex.SEARCH_COLLECTION || "default_collection";
      dataStorePath = `projects/${project}/locations/${location}/collections/${collection}/dataStores/${dataStoreId}`;
    }
    
    // Format tools for Vertex AI Search grounding
    // NOTE: If this format doesn't work, try alternative format:
    // { vertexRagRetrieval: { datastore: dataStorePath } }
    const tools = [{
      retrieval: {
        vertexAiSearch: {
          datastore: dataStorePath
        }
      }
    }];
    
    Log.info("Built Vertex AI Search tools:", JSON.stringify(tools, null, 2));
    Log.info("Data store path:", dataStorePath);
    
    return tools;
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
    if (tools) {
      payload.tools = tools;
      Log.info("Tools added to payload. Tool count:", tools.length);
    } else {
      Log.warn("No tools configured - retrieval/grounding will not be used");
    }

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
      Log.error("Gemini Vertex API error response:", text);
      throw new Error(`Gemini API error ${code}: ${text}`);
    }

    const data = JSON.parse(text);
    
    // Log full response for debugging (especially grounding metadata)
    Log.debug("Gemini Vertex full response:", JSON.stringify(data, null, 2));
    
    // Check if grounding/retrieval was used
    const candidate = data?.candidates?.[0];
    if (candidate?.groundingMetadata) {
      Log.info("Grounding metadata found:", JSON.stringify(candidate.groundingMetadata, null, 2));
      const chunkIndices = candidate.groundingMetadata?.groundingChunks || [];
      if (chunkIndices.length > 0) {
        Log.info(`Grounding used: ${chunkIndices.length} chunks retrieved from data store`);
      } else {
        Log.warn("Grounding metadata present but no chunks retrieved - data store may be empty or query didn't match");
      }
    } else {
      Log.warn("No grounding metadata in response - retrieval tool may not be working or data store is not configured");
    }
    
    const parts = candidate?.content?.parts || [];
    const responseText = parts.map(p => p.text || "").join("").trim();
    
    if (!responseText) {
      Log.error("Empty response text from Gemini. Full response:", JSON.stringify(data, null, 2));
    }
    
    return responseText;
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
