# ScheduleScraper

Automatyzacja pobierająca terminarz szkoleń i egzaminów ze strony fentiks.pl i zapisująca go do wskazanego folderu na Dysku Google w formie pliku JSON lub CSV. Projekt został zorganizowany podobnie jak inne automatyzacje – kod Apps Script jest podzielony na moduły z prefiksami numerycznymi oraz testowany lokalnie przy pomocy Jest.

## Wymagania

- [Node.js](https://nodejs.org/) wraz z `npm`
- Konto Google z dostępem do Google Apps Script oraz Google Drive

## Instalacja

```bash
npm install
```

## Konfiguracja

Domyślne wartości znajdują się w pliku `GoogleScript/01_config.js`. Zaleca się ustawienie właściwości skryptu w Apps Script, aby móc je zmieniać bez edycji kodu:

- `SCHEDULE_SCRAPER_TARGET_FOLDER_ID` – identyfikator folderu na Dysku Google, do którego zostaną zapisane pliki z terminarzem (wymagane)
- `SCHEDULE_SCRAPER_URL` – adres URL strony z terminarzem (domyślnie: `https://fentiks.pl/terminarz-szkolen-i-egzaminow/`)
- `SCHEDULE_SCRAPER_LOG_LEVEL` – poziom logowania (`Error`, `Warning`, `Information`, `Debug`, `None`)
- `SCHEDULE_SCRAPER_FILE_FORMAT` – format zapisywanego pliku: `json` (domyślnie) lub `csv`

Opcjonalnie możesz dodać właściwość `SLACK_WEBHOOK_URL`, aby wysyłać powiadomienia o błędach na Slacka.

## Kolejność plików

Plik `.clasp.json` definiuje kolejność wysyłania modułów do Apps Script. Dodatkowo numery w nazwach (`01_config.js`, …, `05_main.js`) zapewniają właściwą kolejność w edytorze: najpierw wczytywana jest konfiguracja i logger, następnie moduły pomocnicze (Drive, scraper), a na końcu funkcja główna.

## Uruchamianie

1. Uzupełnij konfigurację (właściwości skryptu lub wartości domyślne w `01_config.js`). **Ważne**: musisz ustawić `SCHEDULE_SCRAPER_TARGET_FOLDER_ID`.
2. Zaloguj się w narzędziu `clasp` i wyślij kod do Apps Script:
   ```bash
   cd GoogleScript
   npx clasp login
   npx clasp push
   ```
3. W edytorze Apps Script uruchom funkcję `scrapeScheduleToDrive` lub ustaw zadanie czasowe.

### Format plików

Skrypt automatycznie generuje nazwę pliku z znacznikiem czasu w formacie: `terminarz_YYYY-MM-DD_HH-mm-ss.{json|csv}`

**Format JSON** zawiera tablicę obiektów z następującymi polami:
- `miejsce` – opis lokalizacji i rodzaju szkolenia/egzaminu
- `data` – data wydarzenia
- `cena` – cena
- `akcja` – przycisk akcji (np. "Kup teraz", "Zapisz się")
- `scrapedAt` – data i czas pobrania danych (ISO 8601)

**Format CSV** zawiera te same dane w formacie tekstowym rozdzielanym przecinkami, z nagłówkiem w pierwszym wierszu.

## Testy

Lokalne testy jednostkowe uruchomisz komendą:

```bash
npm test
```

Framework testowy: [Jest](https://jestjs.io/).

Testy obejmują:
- Konfigurację (domyślne wartości, odczyt właściwości)
- Funkcje scrapera (pobieranie HTML, parsowanie tabeli, konwersja do JSON/CSV)
- Operacje na Dysku Google (tworzenie i aktualizacja plików)
- Przepływ główny (scraping i zapis do Drive)
