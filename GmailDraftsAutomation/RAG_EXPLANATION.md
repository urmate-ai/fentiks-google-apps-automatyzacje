# Jak działa RAG (Retrieval-Augmented Generation) w tym projekcie

## Przegląd architektury

System RAG składa się z dwóch głównych komponentów:

### 1. **RagRefresher** - Synchronizacja dokumentów z Google Drive

**Lokalizacja:** `src/rag-refresher/index.ts`

**Jak działa:**
- Pobiera pliki z Google Drive (z folderu określonego przez `RAG_REFRESHER_ROOT_FOLDER_ID`)
- Parsuje pliki JSONL (JSON Lines) zawierające historię emaili
- Dzieli tekst na fragmenty (chunks) o rozmiarze ~1000 znaków z nakładką 200 znaków
- Tworzy embeddingi (wektory numeryczne) dla każdego fragmentu używając:
  - OpenAI embeddings (1536 wymiarów) - jeśli `OPENAI_API_KEY` jest ustawione
  - Google Generative AI embeddings (768 wymiarów) - jeśli `GOOGLE_GEN_AI_API_KEY` jest ustawione
- Zapisuje embeddingi do bazy danych PostgreSQL z rozszerzeniem pgvector

**Proces synchronizacji:**
1. Listuje wszystkie pliki w folderze Drive (rekurencyjnie)
2. Porównuje z istniejącymi dokumentami w bazie
3. Usuwa dokumenty, które już nie istnieją w Drive
4. Importuje nowe pliki w batchach po 25
5. Dla każdego pliku:
   - Parsuje JSONL
   - Ekstraktuje tekst (temat, treść, uczestnicy)
   - Dzieli na chunki
   - Tworzy embeddingi
   - Zapisuje do bazy danych

### 2. **RagService** - Wyszukiwanie podobnych fragmentów

**Lokalizacja:** `src/email-automation/rag.ts`

**Jak działa:**
- Przyjmuje zapytanie (query) - zazwyczaj temat i treść emaila
- Tworzy embedding dla zapytania
- Wyszukuje w bazie danych najpodobniejsze fragmenty używając cosine similarity
- Zwraca top K fragmentów (domyślnie 5) z podobieństwem >= threshold (domyślnie 0.7)
- Formatuje wyniki jako tekst kontekstu

**Użycie w automatyzacji emaili:**
- Gdy przychodzi nowy email, system:
  1. Tworzy zapytanie z tematu i treści emaila
  2. Używa `RagService.retrieveContext()` do znalezienia podobnych fragmentów
  3. Dodaje znalezione fragmenty do promptu dla LLM
  4. LLM generuje odpowiedź używając zarówno kontekstu emaila jak i znalezionych dokumentów

## Komponenty techniczne

### VectorStore (`src/rag-refresher/vector-store.ts`)
- Zarządza tabelami `documents` i `document_chunks` w PostgreSQL
- Używa pgvector do przechowywania wektorów
- Indeks IVFFlat dla szybkiego wyszukiwania podobieństwa
- Operacje: `upsertDocument()`, `searchSimilar()`, `deleteDocument()`

### Embedder (`src/rag-refresher/embedder.ts`)
- Abstrakcja nad OpenAI i Google Generative AI embeddings
- Automatycznie wybiera provider na podstawie dostępnych kluczy API
- Metody: `embedText()` (pojedynczy tekst), `embedDocuments()` (batch)

### Parser (`src/rag-refresher/parser.ts`)
- `parseJsonlContent()` - parsuje pliki JSONL
- `extractTextFromJsonl()` - ekstraktuje tekst z wpisów JSONL
- `chunkText()` - dzieli tekst na fragmenty z nakładką

## Konfiguracja

Zmienne środowiskowe:
- `RAG_REFRESHER_ROOT_FOLDER_ID` - ID folderu Google Drive z dokumentami
- `OPENAI_API_KEY` lub `GOOGLE_GEN_AI_API_KEY` - klucz API dla embeddings
- `RAG_EMBEDDING_MODEL` - model embeddings (domyślnie: `text-embedding-3-small`)
- `RAG_TOP_K` - liczba zwracanych fragmentów (domyślnie: 5)
- `RAG_SIMILARITY_THRESHOLD` - próg podobieństwa 0-1 (domyślnie: 0.7)

## Przepływ danych

```
Google Drive (JSONL files)
    ↓
RagRefresher.syncRagFromDrive()
    ↓
Parser (parse + extract + chunk)
    ↓
Embedder (create embeddings)
    ↓
VectorStore (save to PostgreSQL)
    ↓
[Nowy email przychodzi]
    ↓
RagService.retrieveContext(query)
    ↓
VectorStore.searchSimilar()
    ↓
[Znalezione fragmenty dodane do promptu LLM]
    ↓
LLM generuje odpowiedź z kontekstem
```

## Uruchamianie

```bash
# Synchronizacja dokumentów z Drive
npm run rag:refresh

# Automatyzacja emaili (używa RAG)
npm run email:automation

# Oba procesy
npm run run:all
```

