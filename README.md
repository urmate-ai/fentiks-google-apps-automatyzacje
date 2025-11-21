# Automatyzacje Fentix

Repozytorium gromadzi zautomatyzowane rozwiązania wspierające procesy w firmie Fentix. Każdy katalog reprezentuje osobny projekt automatyzacji.

## Projekty

- [BusinessCardAutomation](BusinessCardAutomation) – przetwarzanie zdjęć wizytówek z wykorzystaniem Google Apps Script i modelu Gemini.
- [GeminiEmailAutomation](GeminiEmailAutomation) – planowana automatyczna odpowiedź na wiadomości e-mail przy użyciu modelu Gemini 2.0 Flash-Lite.
- [InvoicesAutomation](InvoicesAutomation) – w przygotowaniu; będzie przekazywać faktury z Dysku Google do systemów takich jak HubSpot lub iFirma.
- [RagRefresherAutomation](RagRefresherAutomation) – automatyczne odświeżanie korpusu Vertex AI RAG na podstawie dokumentów z Dysku Google.

Każdy projekt posiada swój własny plik `README.md` z dodatkowymi informacjami na temat instalacji i użytkowania.

## Testy

We wszystkich katalogach projektowych (`BusinessCardAutomation`, `GmailKnowledgeSyncer`, `GeminiEmailAutomation`,
`InvoicesAutomation`, `RagRefresherAutomation`) znajdują się katalogi `__tests__` oraz skonfigurowane zadanie `npm test`.
Dzięki temu można uruchamiać testy jednostkowe niezależnie w każdym projekcie:

```bash
cd BusinessCardAutomation
npm test
```

Aby uruchomić testy sekwencyjnie we wszystkich projektach z głównego katalogu repozytorium, można skorzystać z
jednolinijkowego polecenia powłoki:

```bash
for dir in */package.json; do (cd "$(dirname "$dir")" && npm test); done
```

Możliwe jest również zapisanie powyższej pętli w skrypcie (np. `run-all-tests.sh`) w głównym katalogu repozytorium i
nadanie mu uprawnień wykonywalnych (`chmod +x run-all-tests.sh`), aby uruchamiać wszystkie testy jednym poleceniem.

Użytkownicy systemu Windows mogą skorzystać z pliku `run-all-tests.bat` znajdującego się w głównym katalogu repozytorium.
Wystarczy dwukrotnie kliknąć go w Eksploratorze plików (lub uruchomić poleceniem `run-all-tests.bat` w wierszu poleceń),
aby sekwencyjnie wykonać `npm test` w każdym projekcie. Okno pozostanie otwarte na końcu działania, dzięki czemu łatwo
zobaczysz ewentualne błędy.
