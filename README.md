# pi-site-backend-2fa-module

Server-side adapter for privacyIDEA authentication in web applications. The
package deliberately does not expose an HTTP endpoint and does not contain
browser code: each site retains its own login policy, session issuance,
pending-login storage and administration UI.

## Security boundary

1. The site backend asks privacyIDEA for a fresh challenge.
2. The backend stores `transaction_id` in its pending login.
3. The browser receives only `nonce_hex` and `key_hint`, relays them to a
   local signing agent, and returns a signature.
4. The backend submits the signature and stored transaction ID to privacyIDEA.
5. Only the site backend creates a site session after `ACCEPT`.

The PI URL, API key, transaction ID and session decision must never enter the
browser or the local signing agent.

## Supported profiles

- `pkcs11cr`: `pkcs11cr_challenge` + `pkcs11cr_cert_modulus_sha256`;
  `key_hint_kind=cert_modulus_sha256`.
- `avtorcc338`: `avtor_challenge` + `avtor_cert_thumbprint`;
  `key_hint_kind=cert_thumbprint_sha256`.

The returned challenge carries `key_hint_kind` so a browser-side integration
never guesses whether its key-selection hint is a public-key-modulus hash or a
certificate fingerprint.

The host supplies a server-only `request(params, path)` transport. This keeps
TLS trust, timeout, circuit breaker and API-key policy in the application that
owns them. `createPrivacyIdeaTransport()` is included for sites that do not
already have this transport.

The package also exposes `createValidationProvider()` for ordinary privacyIDEA
token types. It sends the site-provided `pass` value through the same server
transport and classifies `ACCEPT`, `REJECT`, missing-token and configuration
outcomes. The package does not pretend that every privacyIDEA token can do
browser signing: only profiles advertising `challenge_response` may be passed
to `createChallengeResponseProvider()`.

Sites may describe an additional challenge-response token with
`defineProfile()`. The profile must specify the privacyIDEA token type and the
attributes from which the nonce and key-selection hint are read. Domain
connectors, token enrollment, user management and HTTP routes remain host
application responsibilities.

```js
const { createChallengeResponseProvider, profile } = require('pi-site-backend-2fa-module');

const provider = createChallengeResponseProvider({
  tokenProfile: profile('pkcs11cr'),
  request: postToPrivacyIdea,
});

const started = await provider.begin({ username, realm, serial });
// Store started.challenge.transaction_id on the server only.

const checked = await provider.complete({
  username,
  realm,
  transactionId: serverStoredTransactionId,
  signatureHex: signatureFromBrowser,
});
```

For a standard token:

```js
const validator = createValidationProvider({ request: postToPrivacyIdea });
const checked = await validator.check({ username, realm, pass: otpOrPin });
```

`begin()` refuses to contact privacyIDEA when `serial` is absent. This avoids
creating a challenge for an unrelated factor and damaging its failure counter.

Before issuing a site session after `complete()` returns `ACCEPT`, the host
must verify that the returned token serial and type match the server-held
pending-login mapping. A missing or mismatched value is a failed login.

## Verification

The module's unit tests cover both challenge-response profiles, standard
validation, malformed signatures, stale mappings, and transport failures.
On 2026-09-19, an InTrack integration was also tested against a privacyIDEA
instance with a real CC338 token and with TOTP: valid responses issued a site
session; invalid responses did not. The host's domain-account mapping and OS
login are separate integrations, not functions of this package.
