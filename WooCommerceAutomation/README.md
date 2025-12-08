# WooCommerce Automatyzacja

🤖 **Automatyczny system instalacji menu WooCommerce w arkuszach Google Sheets**

Automatyzacja dodawania klientów z Google Sheets do WooCommerce z pełną automatyzacją instalacji.

## 🚀 INSTALACJA KROK PO KROKU

### Krok 1: Przygotowanie projektu Apps Script

1. **Otwórz Google Apps Script**
   - Idź na: https://script.google.com/
   - Kliknij "Nowy projekt"

2. **Skopiuj kod z plików**
   - Skopiuj zawartość każdego pliku z folderu `GoogleScript/` do odpowiednich plików w Apps Script:
     - `01_config.js` → `Code.gs` (lub utwórz nowy plik)
     - `02_logger.js` → nowy plik
     - `03_spreadsheet.js` → nowy plik  
     - `04_woocommerce.js` → nowy plik
     - `05_main.js` → nowy plik
     - `06_installer.js` → nowy plik

3. **Zapisz projekt**
   - Nadaj nazwę: "WooCommerce Automat"
   - Zapisz (Ctrl+S)

### Krok 2: Konfiguracja Script Properties

1. **Otwórz Project Settings**
   - W Apps Script kliknij ikonę koła zębatego ⚙️
   - Wybierz "Project settings"

2. **Dodaj Script Properties**
   - Przewiń w dół do sekcji "Script properties"
   - Dodaj następujące właściwości:

| Nazwa | Wartość | Przykład |
|-------|---------|----------|
| `DRIVE_FOLDER_ID` | ID folderu z arkuszami | `1ABC-xyz123` |
| `URL_BASE` | URL API WooCommerce | `https://twoja-strona.pl/wp-json/wc/v3/customers` |
| `CONSUMER_KEY` | Klucz konsumenta WooCommerce | `ck_xxxxxxxxxxxxxxxxxxxxx` |
| `CONSUMER_SECRET` | Sekret konsumenta WooCommerce | `cs_xxxxxxxxxxxxxxxxxxxxx` |
| `SLACK_WEBHOOK_URL` | (opcjonalnie) Webhook Slack | `https://hooks.slack.com/services/...` |

### Krok 3: Konfiguracja Google Cloud Platform

1. **Powiąż projekt z GCP**
   - W Project Settings znajdź "Google Cloud Platform (GCP) Project"
   - Kliknij "Change project"
   - Wybierz istniejący projekt lub utwórz nowy

2. **Włącz wymagane API**
   - Idź do: https://console.cloud.google.com/
   - Wybierz swój projekt
   - Przejdź do "APIs & Services" → "Library"
   - Włącz następujące API:
     - **Apps Script API** (`script.googleapis.com`)
     - **Google Drive API** (`drive.googleapis.com`)

### Krok 4: Autoryzacja

1. **Uruchom funkcję testową**
   - W Apps Script wybierz funkcję `onOpen`
   - Kliknij "Run" ▶️
   - Zaakceptuj wszystkie uprawnienia

2. **Sprawdź status**
   - Otwórz arkusz Google Sheets z tym skryptem
   - W menu pojawi się "Status Automatu"
   - Kliknij "📊 Sprawdź status" aby zweryfikować konfigurację

### Krok 5: Ustawienie automatu

1. **Utwórz trigger**
   - W Apps Script kliknij "Triggers" ⏰
   - Kliknij "Add Trigger"

2. **Skonfiguruj trigger**
   - **Function to run:** `installMenusInAllFiles`
   - **Event source:** Time-driven
   - **Type of time based trigger:** Minutes timer
   - **Minutes interval:** Every 10 minutes
   - Kliknij "Save"

### Krok 6: Testowanie

1. **Ręczny test**
   - W Apps Script uruchom funkcję `installMenusInAllFiles`
   - Sprawdź logi w "Execution log"

2. **Sprawdź rezultat**
   - Otwórz arkusz z folderu `DRIVE_FOLDER_ID`
   - Powinno pojawić się menu "Automatyzacja WooCommerce"

## ✅ GOTOWE!

**Automat będzie:**
- 🤖 Sprawdzał folder co 10 minut
- 📄 Instalował menu w nowych arkuszach
- 📊 Logował wszystkie operacje
- 📱 Wysyłał powiadomienia na Slack (jeśli skonfigurowany)

## 📋 Struktura arkusza Google Sheets

Arkusz powinien zawierać następujące kolumny:
- **Kolumna B (indeks 1):** Imię
- **Kolumna C (indeks 2):** Nazwisko  
- **Kolumna AI (indeks 34):** Email
- **Kolumna AO (indeks 40):** Kod pocztowy
- **Kolumna AP (indeks 41):** Miasto

**Dane zaczynają się od wiersza 4** (wiersze 1-3 to nagłówki).

## 🔧 Jak znaleźć ID folderu Google Drive

1. Otwórz Google Drive
2. Przejdź do folderu z arkuszami
3. Skopiuj ID z URL:
   ```
   https://drive.google.com/drive/folders/1ABC-xyz123
   ID folderu: 1ABC-xyz123
   ```

## 🔑 Jak uzyskać klucze WooCommerce

1. Zaloguj się do WordPress Admin
2. Przejdź do: WooCommerce → Settings → Advanced → REST API
3. Kliknij "Add key"
4. Ustaw uprawnienia: "Read/Write"
5. Skopiuj Consumer Key i Consumer Secret

## 📊 Monitorowanie

**Logi można zobaczyć w:**
- Apps Script Editor → Execution log
- Google Cloud Console → Logs Explorer

**Status można sprawdzić przez:**
- Menu "Status Automatu" → "📊 Sprawdź status"

## 🚨 Rozwiązywanie problemów

### Błąd 404 - Apps Script API niedostępne
- Sprawdź czy Apps Script API jest włączone w Google Cloud Console
- Upewnij się, że projekt GCP jest poprawnie połączony

### Błąd 403 - Brak uprawnień  
- Ponownie autoryzuj skrypt (uruchom `onOpen`)
- Sprawdź czy wszystkie API są włączone

### Menu nie pojawia się w arkuszach
- Sprawdź czy `DRIVE_FOLDER_ID` jest poprawny
- Uruchom `installMenusInAllFiles` ręcznie
- Sprawdź logi w Execution log

### Automat nie działa
- Sprawdź czy trigger jest aktywny w Apps Script → Triggers
- Sprawdź czy funkcja `installMenusInAllFiles` istnieje
- Sprawdź logi czy są błędy

## 📁 Struktura projektu

```
WooCommerceAutomatization/
├── GoogleScript/          # Kod Apps Script
│   ├── 01_config.js       # Konfiguracja
│   ├── 02_logger.js       # Logowanie
│   ├── 03_spreadsheet.js  # Menu i UI
│   ├── 04_woocommerce.js  # API WooCommerce
│   ├── 05_main.js         # Główna logika
│   └── 06_installer.js    # Automatyczny installer
├── __tests__/             # Testy jednostkowe
└── README.md              # Ta dokumentacja
```

## 🎯 Jak to działa

1. **Automat sprawdza folder** co 10 minut
2. **Znajduje nowe arkusze** bez zainstalowanego skryptu
3. **Instaluje menu WooCommerce** w każdym arkuszu
4. **Loguje wszystkie operacje** i wysyła powiadomienia
5. **Użytkownicy mogą używać menu** "Automatyzacja WooCommerce" w arkuszach

## 📞 Wsparcie

W razie problemów:
1. Sprawdź logi w Apps Script Editor
2. Zweryfikuj konfigurację Script Properties
3. Sprawdź czy wszystkie API są włączone w GCP

---

**🎉 Gratulacje! Masz teraz w pełni automatyczny system instalacji WooCommerce!**