# Wdrożenie na Render

Instrukcja wdrożenia aplikacji Gmail Drafts Automation na platformę Render.

## Wymagania wstępne

1. Konto na [Render.com](https://render.com)
2. Repozytorium Git (GitHub, GitLab, Bitbucket)
3. Wszystkie zmienne środowiskowe skonfigurowane

## Krok 1: Przygotowanie bazy danych

### Opcja A: Użyj Render PostgreSQL

1. W Render Dashboard, utwórz nową bazę danych PostgreSQL
2. Wybierz plan (Free, Starter, Standard, Pro)
3. Render automatycznie utworzy zmienną `DATABASE_URL`
4. Po utworzeniu, połącz się z bazą i uruchom:
   ```sql
   CREATE EXTENSION vector;
   ```

### Opcja B: Użyj zewnętrznej bazy danych

Jeśli masz już bazę PostgreSQL z pgvector, użyj jej connection string w zmiennych środowiskowych.

## Krok 2: Konfiguracja zmiennych środowiskowych

W Render Dashboard, dodaj następujące zmienne środowiskowe:

### Wymagane

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob

# LLM (wybierz jeden)
OPENAI_API_KEY=your-openai-key
# LUB
GOOGLE_GEN_AI_API_KEY=your-google-genai-key

# RAG
RAG_REFRESHER_ROOT_FOLDER_ID=your-google-drive-folder-id

# Gmail Labels (opcjonalne)
GMAIL_LABEL_CANDIDATE=AI-Candidate
GMAIL_LABEL_READY=AI-Ready
GMAIL_LABEL_NEEDS_HUMAN=AI-Needs-Human
GMAIL_LABEL_IGNORED=AI-Ignored
GMAIL_LABEL_FAILED=AI-Failed

# Logging (opcjonalne)
LOG_LEVEL=Information
```

### Opcjonalne

```bash
# LLM Configuration
LLM_MODEL=gpt-4
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000

# RAG Configuration
RAG_TOP_K=5
RAG_SIMILARITY_THRESHOLD=0.7

# Node Environment
NODE_ENV=production
```

## Krok 3: Wdrożenie przez Render Dashboard

### Metoda 1: Użyj render.yaml (Zalecane)

1. Wrzuć kod do repozytorium Git
2. W Render Dashboard, kliknij "New" → "Blueprint"
3. Połącz repozytorium
4. Render automatycznie wykryje `render.yaml` i utworzy serwis

### Metoda 2: Ręczne tworzenie Worker

1. W Render Dashboard, kliknij "New" → "Background Worker"
2. Połącz repozytorium Git
3. Ustaw:
   - **Name**: `gmail-drafts-automation`
   - **Environment**: `Docker`
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Context**: `.`
   - **Start Command**: (zostaw puste, Dockerfile ma CMD)
4. Dodaj wszystkie zmienne środowiskowe
5. Wybierz plan (Free, Starter, Standard, Pro)
6. Kliknij "Create Background Worker"

## Krok 4: Weryfikacja wdrożenia

Po wdrożeniu, sprawdź logi w Render Dashboard:

```bash
# Powinieneś zobaczyć:
Starting Gmail Drafts Automation
Starting FULL AUTOMATION in watch mode
Watch mode active. Waiting for tasks...
```

## Krok 5: Monitorowanie

### Logi

W Render Dashboard możesz:
- Oglądać logi w czasie rzeczywistym
- Pobierać logi jako plik
- Konfigurować alerty

### Health Checks

Render automatycznie monitoruje health check z Dockerfile. Jeśli aplikacja się zawiesi, Render ją zrestartuje.

## Rozwiązywanie problemów

### Błąd: "Cannot connect to database"

1. Sprawdź czy `DATABASE_URL` jest poprawnie ustawione
2. Sprawdź czy baza danych ma włączone połączenia zewnętrzne
3. Sprawdź czy pgvector extension jest zainstalowane:
   ```sql
   \dx vector
   ```

### Błąd: "Insufficient Permission" (Google Drive)

1. Upewnij się, że `GOOGLE_REFRESH_TOKEN` ma uprawnienia `drive` (nie `drive.readonly`)
2. Uruchom ponownie `npm run oauth:setup` lokalnie i zaktualizuj token

### Błąd: "No LLM API key configured"

1. Sprawdź czy masz ustawione `OPENAI_API_KEY` LUB `GOOGLE_GEN_AI_API_KEY`
2. Upewnij się, że klucz jest poprawny

### Aplikacja się restartuje w kółko

1. Sprawdź logi pod kątem błędów
2. Sprawdź czy wszystkie wymagane zmienne środowiskowe są ustawione
3. Sprawdź health check w Dockerfile

## Aktualizacje

Render automatycznie wdraża nowe commity z głównej gałęzi. Możesz też:

1. Ręcznie wywołać redeploy w Dashboard
2. Użyć Render API do automatyzacji

## Koszty

- **Free Plan**: 750 godzin/miesiąc (wystarczy dla ciągłej pracy)
- **Starter Plan**: $7/miesiąc - lepsze zasoby
- **Standard Plan**: $25/miesiąc - dedykowane zasoby

PostgreSQL:
- **Free Plan**: 90 dni trial, potem $7/miesiąc
- **Starter Plan**: $7/miesiąc

## Bezpieczeństwo

1. **Nigdy nie commituj** `.env` do Git
2. Używaj **Secret Variables** w Render (są szyfrowane)
3. Regularnie **rotuj** `GOOGLE_REFRESH_TOKEN`
4. Używaj **najmniejszych potrzebnych uprawnień** dla OAuth

## Backup

Render automatycznie tworzy backup bazy danych PostgreSQL (w zależności od planu). Możesz też:

1. Eksportować dane ręcznie przez `pg_dump`
2. Skonfigurować automatyczne backup w Render Dashboard

