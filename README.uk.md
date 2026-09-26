# pi-site-backend-2fa-module

**Місце в наскрізному встановленні:** етап 3 — серверний адаптер 2FA для
сайту. До нього мають бути доступні privacyIDEA, потрібний тип токена та
зіставлення сайту з користувачем/токеном. Повна карта етапів, передумови,
результати й усунення несправностей: [`docs/installation-sequence.uk.md`](docs/installation-sequence.uk.md).
Контракт інтеграції: [`docs/integration-contract.uk.md`](docs/integration-contract.uk.md).
English: [`README.md`](README.md).

## Призначення

Серверна бібліотека Node.js для інтеграції сайту з privacyIDEA. Вона не
створює HTTP-маршрутів, сторінок входу, сесій, зіставлень користувачів,
інтерфейсу адміністрування або доменного входу. Ці обов’язки залишаються у
сайту.

Для браузерного сценарію сайт запитує виклик у privacyIDEA, зберігає
`transaction_id` у серверному записі незавершеного входу, передає браузеру
лише nonce та підказку вибору ключа, отримує підпис і завершує перевірку на
сервері. Сесію сайту створює тільки сам сайт після `ACCEPT` та перевірки
серійного номера токена.

URL privacyIDEA, API-ключ, `transaction_id` та рішення про сесію не можна
передавати браузеру або локальному агенту підпису.

## Профілі токенів

- `pkcs11cr`: атрибути `pkcs11cr_challenge` і
  `pkcs11cr_cert_modulus_sha256`; підказка має тип
  `cert_modulus_sha256`.
- `avtorcc338`: атрибути `avtor_challenge` і `avtor_cert_thumbprint`;
  підказка має тип `cert_thumbprint_sha256`.
- Звичайні токени, що перевіряються значенням `pass` (наприклад, OTP),
  використовують `createValidationProvider()`. Вони не є challenge-response
  токенами й не підписують виклик через браузерний агент.

Профіль challenge-response включає capability `challenge_response`.
`begin()` без `serial` повертає `not_linked` і не звертається до privacyIDEA.
Це запобігає створенню виклику для іншого фактора та небажаному збільшенню
лічильника невдалих спроб.

## Встановлення

Для InTrack архів пакета постачається у `backend/vendor/`, а точна версія
закріплена в `backend/package.json`. З каталогу цього репозиторію створіть
архів:

```sh
npm pack --pack-destination /path/to/InTrack/backend/vendor
```

У InTrack змініть локальну залежність на відповідне ім’я архіву, а далі
встановіть її та перебудуйте backend:

```sh
cd /path/to/InTrack
npm install
docker compose build backend
docker compose up -d --no-deps backend
docker exec intrack-backend node -p "require('pi-site-backend-2fa-module/package.json').version"
```

Остання команда має вивести саме закріплену версію пакета. Не копіюйте архів
за межі Docker build context backend. Для іншого сайту встановіть архів його
пакетним менеджером і реалізуйте власні маршрути, зберігання незавершеного
входу, видачу сесії, зіставлення особи та UI enrollment.

Покроковий сценарій із перевірками й troubleshooting: розділ «Етап 3» у
[`docs/installation-sequence.uk.md`](docs/installation-sequence.uk.md).

## Переклади

Ця бібліотека не має користувацького інтерфейсу. Її результати — машинні
стабільні коди (`accept`, `reject`, `no_token`, `unknown_user`,
`misconfigured`, `unavailable`, `not_linked`); бібліотека не перекладає їх і
не формує локалізовані написи. Сайт перетворює ці коди на повідомлення своєю
системою локалізації. У репозиторії та npm-архіві доступні українська й
англійська технічні інструкції.

## Перевірка

```sh
npm test
npm run lint
```

Ручний сайт-тест має окремо підтвердити успішний і відхилений OTP,
challenge-response, правильне зіставлення серійного номера, відмову без
сесії при помилці та відсутність секретів у браузерній відповіді. Доменний
SSO і вхід у саму ОС тестуються як окремі інтеграції.
