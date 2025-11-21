# BusinessCardAutomation

Projekt automatyzuje przetwarzanie wizytówek dla Fentix przy użyciu Google Apps Script oraz modelu Gemini. Kod źródłowy znajduje się w tym katalogu.

## Wymagania

- [Node.js](https://nodejs.org/) wraz z `npm`
- Konto Google z dostępem do Google Apps Script

## Instalacja

```bash
npm install
```

## Uruchamianie skryptu

1. Dostosuj plik `GoogleScript/01_config.js` (np. identyfikator folderu na Dysku). Właściwości skryptu Apps Script mogą zostać użyte do konfiguracji:
   - `BUSINESS_CARD_FOLDER_ID`
   - `BUSINESS_CARD_LOG_LEVEL` (`Error`, `Warning`, `Information`, `Debug`, `None`)
   - `BUSINESS_CARD_HUBSPOT_ENABLED`
   - `BUSINESS_CARD_EMAIL_ENABLED`
   - `BUSINESS_CARD_SMS_ENABLED`
   Domyślne wartości w przypadku braku właściwości to `Information` dla poziomu logowania oraz `true` dla wszystkich flag funkcjonalnych.
2. (Opcjonalnie) Dodaj właściwość skryptu `SLACK_WEBHOOK_URL` z adresem webhooka Slacka, aby otrzymywać powiadomienia o błędach.
3. Zaloguj się do Apps Script i wgraj kod:

   ```bash
   npx clasp login
   npx clasp push
   ```

4. W edytorze Apps Script uruchom funkcję `processBusinessCardsGemini`, która przetwarza obrazy z konfiguracji.
5. Skrypt może zostać skonfigurowany w Apps Script, aby uruchamiać się automatycznie.

## API Netlify do wysyłania SMS

W katalogu `Netlify/` znajduje się proste API przygotowane do wdrożenia na Netlify. Funkcja `send-sms` przyjmuje dane potrzebne do wysłania wiadomości SMS przez Multiinfo Plus i przekazuje je dalej do usługi z użyciem wymaganego certyfikatu klienta.

1. W panelu Netlify ustaw katalog `BusinessCardAutomation/Netlify` jako katalog do publikacji.
2. Przed wdrożeniem umieść plik certyfikatu klienta `l.kmiecik.adm.pem` w katalogu `BusinessCardAutomation/Netlify/functions/certs/` (pliku nie dodajemy do repozytorium – jest ignorowany przez `.gitignore`).
3. Wdróż projekt. Funkcja będzie dostępna pod adresem `https://<twoja-domena>.netlify.app/.netlify/functions/send-sms` oraz dzięki przekierowaniu również pod `https://<twoja-domena>.netlify.app/api/send-sms`.
4. Wyślij żądanie `GET`, np.:

   ```bash
   curl "https://<twoja-domena>.netlify.app/api/send-sms?login=start.api&password=xxx&serviceId=27203&text=Mj%20test&dest=509891745"
   ```

   Parametry `login`, `password`, `serviceId`, `text` oraz `dest` są wymagane i są przekazywane bez zmian do Multiinfo Plus.
5. W odpowiedzi otrzymasz informację o statusie wywołania oraz treść odpowiedzi zwróconej przez Multiinfo Plus.

## Kolejność plików

Google Apps Script ładuje pliki w takiej kolejności, w jakiej są ułożone w edytorze. Nazwy w katalogu `GoogleScript` zawierają prefiksy numeryczne (`01_config.js`, ..., `07_main.js`), które wymuszają właściwą kolejność: najpierw ładuje się konfiguracja, następnie logger, a main jako ostatni.

## Testy

Lokalne testy jednostkowe uruchomisz komendą:

```bash
npm test
```

Wykorzystywany jest framework [Jest](https://jestjs.io/).
