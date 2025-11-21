# RagRefresherAutomation

Automatyzacja odświeża korpus Vertex AI RAG dla firmy Fentix. Skrypt Google Apps Script monitoruje wskazany folder na Dysku Google i co 30 minut wysyła listę plików do ponownego zaindeksowania w usłudze Vertex AI.

## Wymagania

- Konto Google z dostępem do Google Apps Script oraz Vertex AI
- Uprawnienia do odczytu folderu na Dysku Google z dokumentami wiedzy
- Włączony interfejs Vertex AI (Aiplatform API) w projekcie Google Cloud

## Instalacja

1. Zainstaluj zależności do testów (opcjonalne, lokalnie):

   ```bash
   npm install
   ```

2. Zaloguj się w narzędziu [`clasp`](https://github.com/google/clasp) lub w edytorze Apps Script, aby móc przesłać pliki z katalogu `GoogleScript` do projektu Apps Script.

## Konfiguracja i uruchamianie

1. Dostosuj właściwości skryptu Apps Script (menu **Project Settings → Script properties**) lub wartości domyślne w pliku `GoogleScript/01_config.js`.
   - `RAG_REFRESHER_PROJECT_ID` – identyfikator projektu Google Cloud.
   - `RAG_REFRESHER_LOCATION` – region Vertex AI (domyślnie `europe-west3`).
   - `RAG_REFRESHER_CORPUS_ID` – identyfikator korpusu Vertex AI RAG.
   - `RAG_REFRESHER_ROOT_FOLDER_ID` – ID folderu na Dysku Google, z którego mają być zbierane pliki.
   - `RAG_REFRESHER_LOG_LEVEL` – poziom logowania (`Error`, `Warning`, `Information`, `Debug`, `None`).

2. (Opcjonalnie) usuń lub zmodyfikuj domyślne wartości w `01_config.js`, aby wersjonować konfigurację bez korzystania z właściwości skryptu.

3. Wgraj pliki do Apps Script, zachowując prefiksy numeryczne:

   ```bash
   npx clasp login
   npx clasp push
   ```

4. Po wdrożeniu ustaw wyzwalacz czasowy ręcznie w edytorze Apps Script (**Triggers → Add trigger**), aby cyklicznie uruchamiać `syncRagFromDrive()` w wybranym interwale.

5. Funkcję `syncRagFromDrive()` możesz uruchamiać także ręcznie, np. po pierwszym wdrożeniu.

## Kolejność plików

Katalog `GoogleScript` zawiera pliki z prefiksami numerycznymi, które odzwierciedlają oczekiwaną kolejność ładowania w Apps Script:

1. `01_config.js` – definicje konfiguracji i kluczy właściwości.
2. `02_logger.js` – prosty logger z poziomami szczegółowości.
3. `03_drive.js` – pomocnicze funkcje do pobierania plików z Dysku Google.
4. `04_vertex.js` – budowanie żądań i sprawdzanie statusu operacji Vertex AI.
5. `05_main.js` – funkcja główna `syncRagFromDrive()`.

Prefiksy zapewniają, że zależności (konfiguracja, logger, helpery) są dostępne zanim uruchomione zostaną funkcje główne.

## Testy

Skrypt posiada proste testy jednostkowe weryfikujące logikę pomocniczą. Aby je uruchomić lokalnie, przejdź do katalogu projektu i wykonaj:

```bash
npm test
```

Testy korzystają z frameworka [Jest](https://jestjs.io/).
