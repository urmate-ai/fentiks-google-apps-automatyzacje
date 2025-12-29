# Synchronizacja Gmail → Google Drive

Moduł do automatycznego pobierania maili z Gmaila i zapisywania ich na Google Drive w formacie JSONL, gotowym do użycia w RAG.

## Funkcjonalność

- **Pobieranie maili z ostatnich 180 dni** (lub inny okres)
- **Automatyczne zapisywanie na Google Drive** w strukturze rocznej/miesięcznej
- **Śledzenie przetworzonych maili** - unika duplikatów
- **Format JSONL** - gotowy do użycia w RAG refresher
- **Tryb watch** - automatyczne sprawdzanie nowych maili co 5 minut

## Struktura zapisu

Maile są zapisywane w strukturze:
```
RAG_REFRESHER_ROOT_FOLDER_ID/
  ├── 2024/
  │   ├── 2024-12/
  │   │   ├── 2024-12-29.jsonl
  │   │   └── 2024-12-30.jsonl
  │   └── 2024-11/
  └── processedEmails.jsonl  (lista przetworzonych maili)
```

## Uruchamianie

### Jednorazowa synchronizacja (ostatnie 7 dni)
```bash
npm run gmail:sync
```

### Pełna synchronizacja (ostatnie 180 dni)
```bash
npm run gmail:sync:full
```

### Tryb watch (automatyczne sprawdzanie co 5 minut)
```bash
npm run gmail:watch
```

Tryb watch:
- Sprawdza nowe maile co 5 minut
- Automatycznie odświeża RAG po znalezieniu nowych maili
- Działa w tle do momentu przerwania (Ctrl+C)

## Konfiguracja

Wymagane zmienne środowiskowe:
- `RAG_REFRESHER_ROOT_FOLDER_ID` - ID folderu Google Drive, gdzie zapisywane są maile
- `GOOGLE_REFRESH_TOKEN` - token OAuth do Gmail i Drive API

## Format danych

Każdy email jest zapisywany jako linia JSONL z następującymi polami:

```json
{
  "gmail": {
    "message_id": "abc123",
    "thread_id": "xyz789",
    "subject": "Temat emaila",
    "snippet": "Podgląd...",
    "received_at": "2024-12-29T15:00:00.000Z",
    "received_internaldate_ms": 1735484400000
  },
  "participants": {
    "from": { "name": "Jan Kowalski", "email": "jan@example.com" },
    "to": [{ "name": "Anna Nowak", "email": "anna@example.com" }]
  },
  "content": {
    "body_text": "Treść emaila...",
    "body_html": "<html>..."
  },
  "sync_metadata": {
    "synced_at": "2024-12-29T15:30:00.000Z",
    "storage_hint": {
      "folder_parts": ["2024", "2024-12"],
      "file_name": "2024-12-29.jsonl"
    }
  }
}
```

## Integracja z RAG

Po synchronizacji maili, uruchom RAG refresh, aby zaimportować je do bazy danych:

```bash
npm run rag:refresh
```

RAG refresher automatycznie:
- Znajdzie wszystkie pliki JSONL w folderze
- Parsuje je i ekstraktuje tekst
- Tworzy embeddingi
- Zapisuje do PostgreSQL z pgvector

## Automatyczne uruchamianie

### Tryb Watch-All (Zalecane)

Uruchamia wszystko w trybie ciągłym:
- Gmail sync co 5 minut
- RAG refresh po nowych mailach
- Email automation co 10 minut

```bash
npm run watch:all
```

Program będzie działał w tle do momentu przerwania (Ctrl+C).

### Inne opcje

1. **Tylko Gmail sync w trybie watch**:
   ```bash
   npm run gmail:watch
   ```

2. **Cron job** (Linux/Mac):
   ```bash
   # Sprawdzaj co 5 minut
   */5 * * * * cd /path/to/project && npm run gmail:sync
   ```

3. **Windows Task Scheduler**:
   - Utwórz zadanie uruchamiające `npm run gmail:sync` co 5 minut

## Filtrowanie maili

Moduł automatycznie pomija:
- Maile z kategorii: promotions, social, updates, forums
- Spam i kosz
- Czaty
- Maile od mailer-daemon

## Limity

- Maksymalnie 500 maili na jedno uruchomienie (można zmienić w kodzie)
- Maile starsze niż 180 dni nie są synchronizowane (domyślnie)

