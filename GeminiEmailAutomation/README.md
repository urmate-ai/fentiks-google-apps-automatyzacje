# GeminiEmailAutomation

Projekt automatyzuje przygotowywanie odpowiedzi e-mailowych dla Fentix przy użyciu Google Apps Script oraz modeli Gemini. Kontekst merytoryczny jest dostarczany przez korpus Vertex AI RAG, dzięki czemu lokalna baza wiedzy nie jest potrzebna. Kod źródłowy znajduje się w tym katalogu.

## Wymagania

- [Node.js](https://nodejs.org/) wraz z `npm`
- Konto Google z dostępem do Google Apps Script

## Instalacja

```bash
npm install
```

## Uruchamianie skryptu

1. Uzupełnij plik `GoogleScripts/01_config.js`, aby zdefiniować nazwy etykiet Gmail, konfigurację Vertex AI (np. `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_MODEL`, `VERTEX_RAG_CORPUS`) oraz podpisy wiadomości. W razie potrzeby można pozostawić legacy `GEMINI_API_KEY` do testów.
2. W ustawieniach Apps Script możesz opcjonalnie dodać właściwości skryptu:
   - `SLACK_WEBHOOK_URL` – aby otrzymywać powiadomienia o błędach na Slacku.
   - `GEMINI_EMAIL_LOG_LEVEL` – aby sterować poziomem logów (`Error`, `Warning`, `Information`, `Debug`, `None`). Ustaw `Debug`, aby zobaczyć pełne payloady wysyłane do Gemini wraz z docelowym adresem endpointu.
3. Zaloguj się do Apps Script i wgraj kod. Konfiguracja `.clasp.json` znajduje się w katalogu `GoogleScripts`, dlatego podczas
   wykonywania komend przejdź do tego folderu:

   ```bash
   cd GoogleScripts
   npx clasp login
   npx clasp push
   ```

4. W edytorze Apps Script możesz ręcznie uruchomić funkcję `setup`, aby utworzyć etykiety. Funkcja `main` odpowiada za cykliczne przetwarzanie wątków.
5. Skonfiguruj wyzwalacz czasowy w Apps Script, aby regularnie uruchamiać funkcję `main`.

## Kolejność plików

Google Apps Script ładuje pliki zgodnie z kolejnością w edytorze. Nazwy w katalogu `GoogleScripts` mają prefiksy numeryczne (`01_config.js`, ..., `09_main.js`), które wymuszają odpowiednią kolejność: najpierw ładuje się konfiguracja, następnie logger (jako drugi), moduły pomocnicze i na końcu plik główny z punktami wejścia.

## Testy

Lokalne testy jednostkowe uruchomisz komendą:

```bash
npm test
```

Wykorzystywany jest framework [Jest](https://jestjs.io/).
