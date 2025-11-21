# InvoicesAutomation

Automatyzacja obsługi faktur dla Fentix. Projekt będzie działał podobnie do `BusinessCardAutomation`, z tą różnicą, że:

- Faktury będą trafiały na Dysk Google.
- Skrypt przesyła dane do iFirmy, wysyła powiadomienia o błędach na Slacku oraz udostępnia wrapper do integracji z HubSpotem.

## Google Apps Script

W katalogu `GoogleScript` znajduje się implementacja integracji z Gemini, iFirmą, Slackiem, wrapper HubSpot oraz wspólne helpery wykorzystywane przez funkcję `processInvoices`.

Dokumentacja i implementacja pojawią się w miarę postępu prac.

## Konfiguracja integracji z iFirmą

Skrypt Google Apps Script korzysta z trzech wartości przechowywanych w Script Properties:

| Klucz Script Property | Opis | Przykład |
| --- | --- | --- |
| `IFIRMA_LOGIN` | Login używany do autoryzacji API. | `kuba4turbo@gmail.com` |
| `IFIRMA_EXPENSE_KEY` | Wartość kolumny **Klucz** dla integracji kosztów. | `DD45971F42B9E215` |
| `IFIRMA_KEY_NAME` | (Opcjonalne) identyfikator klucza kosztowego. Domyślnie `wydatek`. | `wydatek` |
| `IFIRMA_SALES_KEY` | Klucz iFirmy z sekcji sprzedażowej – podpisuje żądania `fakturakraj`. | `AA11BB22CC33DD44` |
| `IFIRMA_SALES_KEY_NAME` | (Opcjonalne) identyfikator klucza sprzedażowego. Domyślnie `faktura`. | `faktura` |
| `IFIRMA_SALES_CITY` | (Opcjonalne) domyślne „Miejsce wystawienia” na fakturach sprzedaży. | `Warszawa` |
| `IFIRMA_SALES_SERIES` | (Opcjonalne) nazwa serii numeracji faktur sprzedaży. | `sprzedaz-2024` |
| `IFIRMA_SALES_TEMPLATE` | (Opcjonalne) szablon wydruku faktury sprzedaży. | `logo` |
| `IFIRMA_SALES_CALCULATION` | (Opcjonalne) parametr `LiczOd` – domyślnie `BRT`. | `BRT` |
| `IFIRMA_SALES_BANK_ACCOUNT` | (Opcjonalne) numer rachunku przypisywany w żądaniach sprzedaży. | `12 3456 7890 1234 5678 9012 3456` |
| `COMPANY_TAX_ID` | NIP Fentix – pozwala rozpoznać faktury sprzedażowe. | `7011073186` |
| `COMPANY_NAME` | (Opcjonalne) nazwa Fentix wykorzystywana jako dodatkowa heurystyka. | `Fentix sp. z o.o.` |

Ustawienie klucza kosztowego (`IFIRMA_EXPENSE_KEY`) nadal jest wymagane do obsługi wydatków. Aby przetwarzać faktury sprzedażowe, należy dodatkowo wprowadzić klucz sprzedażowy oraz wskazać NIP Fentix (`COMPANY_TAX_ID`), dzięki czemu skrypt zidentyfikuje dokumenty sprzedażowe i skieruje je do osobnej integracji `fakturakraj`.

Numeracja faktur sprzedażowych powinna być skonfigurowana w iFirmie poprzez serię (`IFIRMA_SALES_SERIES`). Skrypt wyodrębnia z numeru faktury pierwszą sekwencję cyfr i wysyła ją jako `Numer`; gdy na dokumencie nie ma liczb (np. `FV/SPRZEDAZ`), pole `Numer` ustawiane jest na `null`, co pozwala iFirmie nadać kolejny numer automatycznie w obrębie zdefiniowanej serii.

Faktury wydatkowe trafiają do katalogu `Processed (Wydatki)`, natomiast sprzedażowe do `Processed (Sprzedaż)`. W obu przypadkach skrypt zakłada podfoldery `Successful (Gotowe)`, `Failed` oraz `Originals (Oryginały z folderu "New")`, jednak dla sprzedaży zachowujemy oryginalne nazwy plików podczas przenoszenia do folderów sukcesu lub błędów.

## Powiadomienia o błędach

Każda faktura, która trafi do folderu `Failed`, generuje powiadomienie na Slacku. Wiadomość zawiera numer faktury (jeśli jest dostępny), nazwę kontrahenta, kwotę brutto oraz powód niepowodzenia (np. brak wymaganych danych, problemy z przetworzeniem pliku, ręczna weryfikacja lub komunikat z iFirma). Gdy iFirma zwróci kod błędu inny niż `0`, w powiadomieniu pojawia się również ten kod wraz z opisem i ewentualnym komunikatem z API.

Domyślnie wykorzystywany jest webhook `https://hooks.slack.com/services/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`, ale adres można nadpisać poprzez właściwość skryptu `IFIRMA_SLACK_WEBHOOK_URL` (lub `SLACK_WEBHOOK_URL`).
