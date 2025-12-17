# Migracja z Vertex AI do LangChain + pgvector

## Przegląd zmian

Projekt został przepisany z Google Apps Script + Vertex AI na Node.js + LangChain + pgvector.

## Główne zmiany

### 1. Platforma
- **Przed**: Google Apps Script
- **Po**: Node.js 20+ z TypeScript

### 2. LLM Provider
- **Przed**: Vertex AI Gemini (Vertex AI API)
- **Po**: LangChain z obsługą:
  - OpenAI (GPT-4, GPT-3.5)
  - Google Generative AI (Gemini)

### 3. RAG Storage
- **Przed**: Vertex AI Search (Discovery Engine)
- **Po**: PostgreSQL z pgvector

### 4. Architektura
- **Przed**: Monolityczne skrypty Google Apps Script
- **Po**: Modułowa architektura Node.js z TypeScript

## Mapowanie modułów

### RagRefresherAutomation
- **Przed**: `RagRefresherAutomation/GoogleScript/04_vertex.js`
- **Po**: `src/rag-refresher/`
  - `drive.ts` - integracja z Google Drive
  - `vector-store.ts` - operacje na pgvector
  - `embedder.ts` - generowanie embeddingów
  - `parser.ts` - parsowanie JSONL
  - `index.ts` - główna logika synchronizacji

### GeminiEmailAutomation
- **Przed**: `GeminiEmailAutomation/GoogleScripts/04_gemini.js`
- **Po**: `src/email-automation/`
  - `llm.ts` - inicjalizacja LangChain LLM
  - `rag.ts` - serwis RAG z pgvector
  - `gmail.ts` - operacje na Gmail
  - `index.ts` - główna logika automatyzacji

### Wspólne moduły
- **Przed**: Każdy moduł miał własne utils/logger/config
- **Po**: `src/shared/`
  - `config/` - centralna konfiguracja z Zod validation
  - `logger/` - Winston logger
  - `database/` - połączenie z PostgreSQL
  - `utils/` - narzędzia pomocnicze

## Konfiguracja

### Zmienne środowiskowe

#### Usunięte (Vertex AI)
- `VERTEX_PROJECT_ID`
- `VERTEX_LOCATION`
- `VERTEX_SEARCH_DATA_STORE`
- `VERTEX_ACCESS_TOKEN`

#### Dodane (LangChain + pgvector)
- `DATABASE_URL` - connection string do PostgreSQL
- `OPENAI_API_KEY` lub `GOOGLE_GEN_AI_API_KEY` - klucz API do LLM
- `RAG_EMBEDDING_MODEL` - model do embeddingów
- `RAG_TOP_K` - liczba dokumentów do pobrania z RAG
- `RAG_SIMILARITY_THRESHOLD` - próg podobieństwa

## Baza danych

### Nowa struktura (PostgreSQL + pgvector)

```sql
-- Tabela dokumentów
CREATE TABLE documents (
  id VARCHAR(255) PRIMARY KEY,
  drive_id VARCHAR(255) UNIQUE NOT NULL,
  file_name TEXT,
  file_path TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Tabela chunków z embeddingami
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY,
  document_id VARCHAR(255) REFERENCES documents(id),
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536), -- lub 768 dla Google
  created_at TIMESTAMP
);
```

### Indeksy
- `ivfflat` index na `embedding` dla szybkiego wyszukiwania podobieństwa
- Indeksy na `document_id` i `drive_id` dla szybkich lookupów

## API Changes

### Vertex AI → LangChain

#### Przed (Vertex AI)
```javascript
const url = `https://${location}-aiplatform.googleapis.com/v1/...`;
const response = UrlFetchApp.fetch(url, {
  method: 'post',
  headers: { Authorization: `Bearer ${token}` },
  payload: JSON.stringify(payload)
});
```

#### Po (LangChain)
```typescript
const llm = new ChatOpenAI({
  openAIApiKey: config.openaiApiKey,
  modelName: config.llmModel,
  temperature: config.llmTemperature
});

const response = await llm.invoke([
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt }
]);
```

### Vertex AI Search → pgvector

#### Przed (Vertex AI Search)
```javascript
const tools = [{
  retrieval: {
    vertexAiSearch: {
      datastore: dataStorePath
    }
  }
}];
```

#### Po (pgvector)
```typescript
const queryEmbedding = await embedder.embedText(query);
const results = await vectorStore.searchSimilar(
  queryEmbedding,
  topK: 5,
  threshold: 0.7
);
```

## Uruchomienie

### Przed (Google Apps Script)
- Automatyczne uruchomienie przez Triggers
- Brak lokalnego środowiska deweloperskiego

### Po (Node.js)
```bash
# Development
npm run dev

# Production
npm run build
npm start

# Osobne moduły
npm run rag:refresh
npm run email:automation
```

## Zalety migracji

1. **Lokalne środowisko deweloperskie** - łatwiejsze testowanie i debugowanie
2. **TypeScript** - type safety i lepsze IDE support
3. **Elastyczność** - możliwość użycia różnych providerów LLM
4. **Kontrola nad bazą danych** - pełna kontrola nad strukturą i zapytaniami
5. **Lepsze narzędzia** - dostęp do całego ekosystemu Node.js
6. **Koszt** - możliwość użycia tańszych alternatyw (np. OpenAI zamiast Vertex AI)

## Uwagi

- Wymagana migracja danych z Vertex AI Search do pgvector (jeśli istnieją)
- Konieczna konfiguracja OAuth dla Google APIs
- Wymagana instalacja i konfiguracja PostgreSQL z pgvector

