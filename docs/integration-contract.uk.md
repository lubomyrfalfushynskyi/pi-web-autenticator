# Контракт інтеграції із сайтом

**Наскрізний етап 3:** цей пакет інтегрується в backend сайту після
підготовки privacyIDEA/типу токена й до встановлення клієнтського агента для
CC338. Повний порядок і таблиця діагностики — у
[`installation-sequence.uk.md`](installation-sequence.uk.md).
English: [`integration-contract.md`](integration-contract.md).

## Межі відповідальності

Сайт відповідає за:

- політику входу та перший фактор;
- серверний запис незавершеного входу, строк його дії й збереження
  `transaction_id`;
- зіставлення облікового запису сайту з PI realm/resolver/UID/serial;
- видачу та аудит сесії;
- доменні конектори, enrollment токенів і адміністративний UI.

Цей пакет реалізує лише серверний контракт запитів/відповідей privacyIDEA.
Він не приймає браузерні запити безпосередньо й не вирішує, чи видавати
сесію.

## Звичайний токен

Для токена, що перевіряє значення `pass`, використовуйте
`createValidationProvider()`:

```js
const validator = createValidationProvider({ request: piTransport.request });
const result = await validator.check({
  username: identity.username,
  realm: identity.realm,
  serial: identity.serial,
  pass: submittedCode,
});
```

Лише `ACCEPT` означає успіх. `NO_TOKEN`, `UNKNOWN_USER` і `MISCONFIGURED` —
помилки зіставлення або конфігурації, а не привід просити користувача
повторити код.

## Challenge-response токен

```text
begin(identity)
  → privacyIDEA повертає виклик
  → сайт зберігає transaction_id на сервері
  → браузер отримує nonce_hex/key_hint/key_hint_kind
  → браузер просить локальний агент підписати виклик
  → complete(identity, серверний transaction_id, signature)
  → privacyIDEA повертає ACCEPT/REJECT
```

Не приймайте `transaction_id` від клієнта. До передачі challenge звірте
серійний номер із серверним зіставленням особи. Після `ACCEPT` знову вимагайте
збіг serial відповіді з серійним номером, збереженим у pending-login. Якщо
privacyIDEA повернув `type`, звірте його із типом, закріпленим на `begin()`.
Відсутність `type` у деяких успішних відповідях нормальна й не змінює
серверне зіставлення. Відсутній/чужий serial або сторонній `type` означає
відмову. URL privacyIDEA та API-ключ ніколи не передаються браузеру.

## Профіль нового токена

`defineProfile()` дозволений лише для vendor token із сумісним
challenge-response контрактом. Профіль має називати PI token type і атрибути
nonce та підказки ключа. Не додавайте в цей пакет доменну інтеграцію,
enrollment чи HTTP-маршрути заради нового сайту.

## Перевірки host-інтеграції

Кожен сайт має тестувати:

- правильне й неправильне стандартне значення токена;
- правильний і неправильний підпис challenge;
- відсутнє, прострочене та неправильне зіставлення serial;
- відсутній/чужий serial у відповіді та неправильний `type` до видачі сесії;
- успішну відповідь без `type` зі збереженням типу з pending-login;
- відсутній transaction ID, timeout privacyIDEA та відхилений API-запит;
- переініціалізацію локального носія після сну;
- відсутність секретів і transaction ID у відповідях браузеру.
