# GmailKnowledgeSyncer

Skrypt synchronizuje wiadomości Gmail do struktury plików `JSONL` w wybranym folderze na Dysku Google. Projekt został zorganizowany podobnie jak automatyzacja wizytówek – kod Apps Script jest podzielony na moduły z prefiksami numerycznymi oraz testowany lokalnie przy pomocy Jest.

## Wymagania

- [Node.js](https://nodejs.org/) wraz z `npm`
- Konto Google z dostępem do Gmaila oraz Google Apps Script

## Instalacja

```bash
npm install
```

## Konfiguracja

Domyślne wartości znajdują się w pliku `GoogleScripts/01_config.js`. Zaleca się ustawienie właściwości skryptu w Apps Script, aby móc je zmieniać bez edycji kodu:

- `GMAIL_KNOWLEDGE_TARGET_FOLDER_ID` – identyfikator folderu na Dysku Google, do którego trafią wszystkie pliki z wiedzą
- `GMAIL_KNOWLEDGE_THRESHOLD_DAYS` – ile dni wstecz maksymalnie sięgamy przy pierwszej synchronizacji (domyślnie 180)
- `GMAIL_KNOWLEDGE_LOG_LEVEL` – poziom logowania (`Error`, `Warning`, `Information`, `Debug`, `None`)
- `GMAIL_KNOWLEDGE_MAX_MESSAGES_PER_RUN` – maksymalna liczba wiadomości pobieranych i zapisywanych podczas jednego uruchomienia (domyślnie 100)

Opcjonalnie możesz dodać właściwość `SLACK_WEBHOOK_URL`, aby wysyłać powiadomienia o błędach na Slacka.

## Kolejność plików

Plik `.clasp.json` definiuje kolejność wysyłania modułów do Apps Script. Dodatkowo numery w nazwach (`01_config.js`, …, `05_main.js`) zapewniają właściwą kolejność w edytorze: najpierw wczytywana jest konfiguracja i logger, następnie moduły pomocnicze, a na końcu funkcja główna.

## Uruchamianie synchronizacji

1. Uzupełnij konfigurację (właściwości skryptu lub wartości domyślne w `01_config.js`).
2. Zaloguj się w narzędziu `clasp` i wyślij kod do Apps Script:
   ```bash
   npx clasp login
   npx clasp push
   ```
3. W edytorze Apps Script uruchom funkcję `syncGmailToDriveJsonl` lub ustaw zadanie czasowe.

Skrypt działa przyrostowo. Przed pobraniem nowych wiadomości sprawdza najnowszy plik `JSONL` w katalogu docelowym i dobiera zapytanie Gmail tak, aby kontynuować synchronizację od ostatniej zapisanej wiadomości (nie cofając się dalej niż `GMAIL_KNOWLEDGE_THRESHOLD_DAYS`).

Limit `GMAIL_KNOWLEDGE_MAX_MESSAGES_PER_RUN` pozwala kontrolować czas i koszt pojedynczej synchronizacji – skrypt pobiera, analizuje i zapisuje maksymalnie tyle wiadomości, ile określisz w tej właściwości (domyślnie 100).

### Struktura danych dla RAG

- Każda wiadomość zapisywana jest w pliku `JSONL` uporządkowanym wg daty: `/ROOT/ROK/ROK-MIESIĄC/ROK-MIESIĄC-DZIEŃ.jsonl`.
- Każdy rekord zawiera metadane (`sync_metadata`), ustrukturyzowaną treść (`content.body_text`, język, załączniki) oraz informacje o uczestnikach konwersacji. Format jest zoptymalizowany pod późniejsze zasilanie systemu Retrieval-Augmented Generation.
- Skrypt automatycznie filtruje wiadomości masowe (newslettery, oferty, spam) korzystając z etykiet Gmail, nagłówków listowych oraz heurystyk rozpoznających adresy typu `noreply`. Dzięki temu do katalogu wiedzy trafiają wyłącznie konwersacje biznesowe.
- Synchronizacja przebiega od najstarszej wiadomości w kolejce, aby zachować kontekst rozmów.

## Testy

Lokalne testy jednostkowe uruchomisz komendą:

```bash
npm test
```

Framework testowy: [Jest](https://jestjs.io/).
