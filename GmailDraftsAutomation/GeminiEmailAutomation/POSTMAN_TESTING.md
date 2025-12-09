# Testowanie Vertex AI Gemini z Data Store w Postmanie

Ten dokument opisuje, jak przetestować integrację Vertex AI Gemini z Data Store używając Postmana, żeby sprawdzić, czy grounding/retrieval działa poprawnie.

## Przygotowanie

1. **Importuj kolekcję Postmana**
   - Otwórz Postmana
   - Kliknij "Import" i wybierz plik `Postman_Vertex_AI_Gemini_Test.postman_collection.json`

2. **Ustaw zmienne środowiskowe**

   W Postmanie utwórz środowisko lub użyj istniejącego i ustaw następujące zmienne:

   - `PROJECT_ID` - Twój Google Cloud Project ID
   - `LOCATION` - Lokalizacja (domyślnie: `europe-west3`)
   - `PUBLISHER` - Zawsze `google`
   - `MODEL` - Model Gemini (np. `gemini-2.5-flash`, `gemini-1.5-pro`)
   - `DATA_STORE_ID` - ID twojego Vertex AI Search Data Store
   - `COLLECTION` - Collection name (domyślnie: `default_collection`)
   - `ACCESS_TOKEN` - OAuth2 access token

3. **Uzyskaj Access Token**

   Masz kilka opcji:

   **Opcja A: Użyj gcloud CLI**
   ```bash
   gcloud auth print-access-token
   ```
   Skopiuj token i wklej do zmiennej `ACCESS_TOKEN` w Postmanie.

   **Opcja B: Z Apps Script**
   - W edytorze Apps Script uruchom funkcję pomocniczą:
   ```javascript
   function getToken() {
     Logger.log(ScriptApp.getOAuthToken());
   }
   ```
   - Skopiuj token z logów i użyj w Postmanie

   **Opcja C: OAuth2 flow w Postmanie**
   - Skonfiguruj OAuth2 authentication w Postmanie
   - Użyj Client ID i Client Secret z Google Cloud Console

## Testy do wykonania

### 1. Test z Data Store

Uruchom request "Generate Content with Data Store".

**Co sprawdzić:**
- Status code powinien być `200`
- W odpowiedzi sprawdź pole `candidates[0].groundingMetadata`
- Jeśli `groundingMetadata.groundingChunks` zawiera elementy → retrieval działa!
- Jeśli `groundingMetadata` jest puste lub nie istnieje → problem z konfiguracją

**Oczekiwana struktura odpowiedzi:**
```json
{
  "candidates": [{
    "content": {
      "parts": [{"text": "..."}]
    },
    "groundingMetadata": {
      "groundingChunks": [
        {
          "retrievedContext": {
            "uri": "...",
            "title": "..."
          }
        }
      ],
      "webSearchQueries": []
    }
  }]
}
```

### 2. Test bez Data Store (porównawczy)

Uruchom request "Generate Content WITHOUT Data Store".

**Co sprawdzić:**
- Porównaj odpowiedź z testem #1
- Jeśli odpowiedzi są takie same → data store prawdopodobnie nie jest używany
- Jeśli różnią się → sprawdź szczegółowo, co się zmieniło

### 3. Test symulujący rzeczywiste użycie

Uruchom request "Generate Content - Test Email Reply".

**Co sprawdzić:**
- Czy odpowiedź zawiera informacje z data store?
- Czy struktura JSON jest poprawna?
- Czy `groundingMetadata` pokazuje, że retrieval został użyty?

## Diagnozowanie problemów

### Problem: Brak `groundingMetadata` w odpowiedzi

**Możliwe przyczyny:**
1. ❌ Format tools jest niepoprawny
2. ❌ Data store ID jest błędne
3. ❌ Data store jest pusty
4. ❌ Brak uprawnień do data store
5. ❌ Model nie obsługuje retrieval (sprawdź dokumentację)

**Rozwiązania:**
- Sprawdź w logach Apps Script (z `LOG_LEVEL=Debug`), jaki payload jest wysyłany
- Zweryfikuj, czy data store ma załadowane dokumenty
- Sprawdź uprawnienia IAM dla service account / użytkownika
- Spróbuj innego modelu (niektóre modele mogą nie obsługiwać retrieval)

### Problem: `groundingMetadata` istnieje, ale `groundingChunks` jest puste

**Możliwe przyczyny:**
1. ❌ Data store jest pusty (brak dokumentów)
2. ❌ Query nie pasuje do żadnych dokumentów w data store
3. ❌ Konfiguracja data store jest niepoprawna

**Rozwiązania:**
- Sprawdź, czy data store zawiera dokumenty (użyj Discovery Engine API)
- Spróbuj bardziej ogólnego query
- Zweryfikuj konfigurację data store w Google Cloud Console

### Problem: Format tools może być niepoprawny

Jeśli podstawowy format nie działa, spróbuj alternatywnych formatów:

**Format 1 (obecnie używany):**
```json
{
  "tools": [{
    "retrieval": {
      "vertexAiSearch": {
        "datastore": "projects/.../locations/.../collections/.../dataStores/..."
      }
    }
  }]
}
```

**Format 2 (alternatywny - jeśli Format 1 nie działa):**
```json
{
  "tools": [{
    "vertexRagRetrieval": {
      "datastore": "projects/.../locations/.../collections/.../dataStores/..."
    }
  }]
}
```

## Sprawdzanie logów w Apps Script

Po uruchomieniu z `LOG_LEVEL=Debug` w ustawieniach Apps Script, sprawdź logi dla:

1. **Payload wysyłany do API:**
   ```
   Gemini Vertex payload: {...}
   ```
   Sprawdź, czy `tools` są poprawnie dodane.

2. **Pełna odpowiedź:**
   ```
   Gemini Vertex full response: {...}
   ```
   Sprawdź strukturę odpowiedzi i obecność `groundingMetadata`.

3. **Informacje o grounding:**
   ```
   Grounding used: X chunks retrieved from data store
   ```
   lub
   ```
   No grounding metadata in response
   ```

## Przydatne linki

- [Vertex AI Gemini API Documentation](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
- [Vertex AI Search Documentation](https://cloud.google.com/generative-ai-app-builder/docs/engine-config)
- [Postman Documentation](https://learning.postman.com/docs/)

## Następne kroki

Jeśli testy w Postmanie działają, ale aplikacja nie, sprawdź:
1. Czy konfiguracja w `01_config.js` jest identyczna
2. Czy access token w Apps Script jest prawidłowy
3. Czy są jakieś różnice w payload (porównaj logi z Postmanem)

