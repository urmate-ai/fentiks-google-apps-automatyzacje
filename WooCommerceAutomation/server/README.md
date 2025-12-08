Uruchomienie proxy API

1) Zainstaluj zależności:
   npm install

2) Zmienna środowiskowe (stwórz plik .env obok package.json):

PORT=8080
WOOC_URL_BASE=https://twoj-sklep.pl/wp-json/wc/v3/customers
WOOC_CONSUMER_KEY=...
WOOC_CONSUMER_SECRET=...
TUTOR_API_URL=https://twoj-tutor.pl/wp-json/tutor/v1
TUTOR_API_KEY=...
TUTOR_PRIVATE_API_KEY=...

3) Start:
   npm run start

Endpointy:
- POST /api/woocommerce/customers/check { email }
- POST /api/woocommerce/customers/getId { email }
- POST /api/woocommerce/customers/create { firstName, lastName, email, postcode?, city? }
- POST /api/tutor/enroll { userId, courseId }
- POST /api/tutor/enroll/all { userId, courseIds? }

docker buildx build --platform linux/amd64 -t urmateai/fentiks:latest --push .
