# Gmail Drafts Automation

Automatyzacja odpowiedzi na maile z użyciem LangChain i pgvector (RAG).

## Architektura

Projekt składa się z 4 głównych modułów:

1. **RagRefresherAutomation** - Synchronizacja dokumentów z Google Drive do PostgreSQL (pgvector)
2. **GeminiEmailAutomation** - Automatyczne generowanie odpowiedzi na maile z użyciem LangChain + RAG
3. **GmailKnowledgeSyncer** - Synchronizacja wiadomości Gmail do JSONL na Google Drive
4. **ScheduleScraper** - Pobieranie terminarza i zapisywanie do Google Drive

## Wymagania

- Node.js 20+
- PostgreSQL 15+ z rozszerzeniem pgvector
- Google Cloud Project z włączonymi API:
  - Gmail API
  - Google Drive API
- OAuth 2.0 credentials dla Google APIs

## Konfiguracja

1. Skopiuj `.env.example` do `.env` i uzupełnij wartości:

```bash
cp .env.example .env
```

2. Zainstaluj zależności:

```bash
npm install
```

3. Skonfiguruj bazę danych PostgreSQL z pgvector:

```bash
# W PostgreSQL
CREATE DATABASE gmail_automation;
\c gmail_automation
CREATE EXTENSION vector;
```

Lub użyj migracji:
```bash
psql -d gmail_automation -f src/db/migrations/001_init.sql
```

4. Skonfiguruj Google OAuth:

```bash
npm run oauth:setup
```

Postępuj zgodnie z instrukcjami, aby uzyskać `GOOGLE_REFRESH_TOKEN` i dodaj go do `.env`.

5. Uzupełnij pozostałe zmienne w `.env`:
   - `DATABASE_URL` - connection string do PostgreSQL
   - `OPENAI_API_KEY` lub `GOOGLE_GEN_AI_API_KEY` - klucz API do LLM
   - `RAG_REFRESHER_ROOT_FOLDER_ID` - ID folderu Google Drive z dokumentami
   
   **Opcjonalne - interwały dla `watch:all` (w minutach):**
   - `WATCH_GMAIL_SYNC_INTERVAL_MIN` - interwał synchronizacji Gmail (domyślnie: 5)
   - `WATCH_EMAIL_AUTOMATION_INTERVAL_MIN` - interwał automatyzacji emaili (domyślnie: 10)
   - `WATCH_DRIVE_WATCH_INTERVAL_MIN` - interwał sprawdzania zmian w Drive (domyślnie: 15)
   - `WATCH_FENTIKS_SYNC_INTERVAL_MIN` - interwał scrapingu fentiks.pl (domyślnie: 60)

## Uruchomienie

```bash
# Development
npm run dev

# Production - wszystkie moduły (jednorazowo)
npm run run:all

# Tryb ciągły (watch-all) - ZALECANE dla produkcji
npm run watch:all

# Tylko RAG refresh
npm run rag:refresh

# Tylko email automation
npm run email:automation

# Gmail sync (ostatnie 7 dni)
npm run gmail:sync

# Gmail sync (ostatnie 180 dni)
npm run gmail:sync:full

# Gmail sync w trybie watch (tylko nowe maile)
npm run gmail:watch
```

## Skrypty

- `npm run oauth:setup` - Konfiguracja Google OAuth
- `npm run rag:refresh` - Synchronizacja dokumentów z Drive do pgvector
- `npm run email:automation` - Automatyczne generowanie odpowiedzi na maile
- `npm run run:all` - Uruchomienie wszystkich modułów (jednorazowo)
- `npm run watch:all` - **Tryb ciągły** - uruchamia wszystko w tle:
  - Gmail sync (domyślnie co 5 minut, konfigurowalne przez `WATCH_GMAIL_SYNC_INTERVAL_MIN`)
  - RAG refresh po nowych mailach
  - **Drive folder watch** (domyślnie co 15 minut, konfigurowalne przez `WATCH_DRIVE_WATCH_INTERVAL_MIN`) - automatycznie ładuje nowe/zmienione pliki z Drive do bazy
  - Email automation (domyślnie co 10 minut, konfigurowalne przez `WATCH_EMAIL_AUTOMATION_INTERVAL_MIN`)
  - Fentiks scraping (domyślnie co 1 godzinę, konfigurowalne przez `WATCH_FENTIKS_SYNC_INTERVAL_MIN`)
- `npm run gmail:sync` - Synchronizacja maili z Gmail do Drive (7 dni)
- `npm run gmail:sync:full` - Pełna synchronizacja maili (180 dni)
- `npm run gmail:watch` - Gmail sync w trybie watch (tylko nowe maile)

## Struktura projektu

```
src/
├── shared/           # Wspólne moduły
│   ├── config/      # Konfiguracja
│   ├── logger/      # Logging
│   ├── database/    # Połączenie z PostgreSQL
│   └── utils/       # Narzędzia pomocnicze
├── rag-refresher/   # Synchronizacja RAG
├── email-automation/ # Automatyzacja emaili
├── gmail-syncer/    # Synchronizacja Gmail
└── schedule-scraper/ # Pobieranie terminarza
```

## Wdrożenie na Render

Aplikacja może być wdrożona na Render jako Background Worker. Zobacz [DEPLOY.md](./DEPLOY.md) dla szczegółowych instrukcji.

Szybki start:
1. Utwórz bazę PostgreSQL na Render
2. Utwórz Background Worker z Dockerfile
3. Dodaj wszystkie zmienne środowiskowe
4. Uruchom `CREATE EXTENSION vector;` w bazie danych

## Migracja z Vertex AI

Projekt został przepisany z Vertex AI na:
- **LangChain** - zamiast Vertex AI Gemini
- **pgvector** - zamiast Vertex AI Search (Discovery Engine)
- **Node.js** - zamiast Google Apps Script

