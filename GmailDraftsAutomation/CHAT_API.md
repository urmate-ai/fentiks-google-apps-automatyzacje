# Chat API - Dokumentacja

## Przegląd

Endpoint API do chatu wykorzystujący RAG (Retrieval-Augmented Generation) do generowania inteligentnych odpowiedzi na podstawie bazy wiedzy.

## Konfiguracja

### Zmienne środowiskowe

Dodaj do pliku `.env`:

```bash
CHAT_API_KEY=twoj-sekretny-klucz-api
```

**Ważne:** Użyj silnego, losowego klucza (np. wygenerowanego przez `openssl rand -hex 32`).

## Endpoint

### POST `/api/v1/chat`

**Uwaga:** Endpoint `/api/chat` jest nadal dostępny dla kompatybilności wstecznej, ale zalecamy używanie `/api/v1/chat`.

Generuje odpowiedź na podstawie wiadomości użytkownika i kontekstu z bazy RAG.

#### Autentykacja

Klucz API można przekazać na trzy sposoby:

1. **Header Authorization (zalecane):**
   ```
   Authorization: Bearer twoj-sekretny-klucz-api
   ```

2. **Header X-API-Key:**
   ```
   X-API-Key: twoj-sekretny-klucz-api
   ```

3. **Query parameter (mniej bezpieczne):**
   ```
   POST /api/v1/chat?api_key=twoj-sekretny-klucz-api
   ```

#### Request Body

```json
{
  "message": "Jaki jest koszt szkolenia z AI?",
  "conversationHistory": [
    {
      "role": "user",
      "content": "Cześć!"
    },
    {
      "role": "assistant",
      "content": "Witaj! Jak mogę pomóc?"
    }
  ],
  "context": "Opcjonalny dodatkowy kontekst (jeśli nie podasz, system użyje RAG)"
}
```

**Pola:**
- `message` (wymagane): Treść wiadomości użytkownika
- `conversationHistory` (opcjonalne): Historia konwersacji jako tablica obiektów z `role` i `content`
- `context` (opcjonalne): Dodatkowy kontekst - jeśli nie podasz, system automatycznie wyszuka w bazie RAG

#### Response

**Sukces (200):**
```json
{
  "response": "Koszt szkolenia z AI wynosi 2000 zł...",
  "contextUsed": true
}
```

**Błędy:**
- `401 Unauthorized` - Nieprawidłowy lub brakujący klucz API
- `400 Bad Request` - Nieprawidłowy format request body
- `500 Internal Server Error` - Błąd serwera
- `503 Service Unavailable` - Chat service nie jest dostępny

## Przykłady użycia

### cURL

```bash
curl -X POST https://twoja-domena.com/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer twoj-sekretny-klucz-api" \
  -d '{
    "message": "Jakie są dostępne terminy szkoleń?"
  }'
```

### JavaScript (fetch)

```javascript
const response = await fetch('https://twoja-domena.com/api/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer twoj-sekretny-klucz-api'
  },
  body: JSON.stringify({
    message: 'Jakie są dostępne terminy szkoleń?',
    conversationHistory: [
      { role: 'user', content: 'Cześć!' },
      { role: 'assistant', content: 'Witaj! Jak mogę pomóc?' }
    ]
  })
});

const data = await response.json();
console.log(data.response);
```

### PHP (WordPress)

```php
$response = wp_remote_post('https://twoja-domena.com/api/v1/chat', [
    'headers' => [
        'Content-Type' => 'application/json',
        'Authorization' => 'Bearer twoj-sekretny-klucz-api'
    ],
    'body' => json_encode([
        'message' => 'Jakie są dostępne terminy szkoleń?'
    ])
]);

$body = wp_remote_retrieve_body($response);
$data = json_decode($body, true);
echo $data['response'];
```

### Python

```python
import requests

response = requests.post(
    'https://twoja-domena.com/api/v1/chat',
    headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer twoj-sekretny-klucz-api'
    },
    json={
        'message': 'Jakie są dostępne terminy szkoleń?'
    }
)

data = response.json()
print(data['response'])
```

## CORS

Endpoint obsługuje CORS i akceptuje żądania z dowolnej domeny. W produkcji możesz chcieć to ograniczyć.

## Bezpieczeństwo

1. **Używaj HTTPS** w produkcji
2. **Chroń klucz API** - nie udostępniaj go publicznie
3. **Rotuj klucze** regularnie
4. **Monitoruj użycie** - sprawdzaj logi pod kątem podejrzanych żądań

## Integracja z WordPress

### Przykład shortcode

```php
function chat_api_shortcode($atts) {
    $api_url = 'https://twoja-domena.com/api/v1/chat';
    $api_key = 'twoj-sekretny-klucz-api';
    
    // Pobierz wiadomość z formularza
    $message = sanitize_text_field($_POST['message'] ?? '');
    
    if ($message) {
        $response = wp_remote_post($api_url, [
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $api_key
            ],
            'body' => json_encode(['message' => $message])
        ]);
        
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);
        
        return '<div class="chat-response">' . esc_html($data['response']) . '</div>';
    }
    
    return '<form method="post">
        <input type="text" name="message" placeholder="Zadaj pytanie...">
        <button type="submit">Wyślij</button>
    </form>';
}
add_shortcode('chat', 'chat_api_shortcode');
```

## Troubleshooting

### "Chat service not available"
- Sprawdź czy `CHAT_API_KEY` jest ustawione w zmiennych środowiskowych
- Sprawdź logi serwera

### "Unauthorized"
- Sprawdź czy klucz API jest poprawny
- Sprawdź czy klucz jest przekazywany w nagłówku lub query parameter

### Słabe odpowiedzi
- Upewnij się, że baza RAG jest zsynchronizowana (`npm run rag:refresh`)
- Sprawdź czy podobieństwo wyszukiwania nie jest zbyt wysokie (`RAG_SIMILARITY_THRESHOLD`)

