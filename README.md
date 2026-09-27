# pi-site-backend-2fa-module

**Installation sequence:** Stage 3 — install the server-side site adapter,
after privacyIDEA and the required token type are available. For the complete
order, prerequisites, and troubleshooting, see
[`docs/installation-sequence.uk.md`](docs/installation-sequence.uk.md).
Languages: [Deutsch](README.de.md) · [Українська](README.uk.md).
Quick deployment: [`DEPLOYMENT.txt`](DEPLOYMENT.txt).

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

`transport.diagnose()` performs an unauthenticated `GET` to the configured
origin to check DNS/TLS/HTTP reachability; it never calls a validation route
or sends the API key. HTTP 5xx is reported as unreachable. This does not prove
API-key validity, token-plugin registration, or successful authentication.
`validatePrivacyIdeaConfig()` checks local settings without network access.
The package version for this API is `0.3.0`.

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
must verify that the returned token serial matches the server-held
pending-login mapping. If privacyIDEA returns a token type, it must also match
the server-held mapping. Some successful challenge responses omit `type`, so
the host must retain the type selected at `begin()` rather than infer it from
the final response. A missing or mismatched serial, or a mismatched supplied
type, is a failed login.

## Verification

The module's unit tests cover both challenge-response profiles, standard
validation, malformed signatures, stale mappings, and transport failures.
On 2026-09-19, an InTrack integration was also tested against a privacyIDEA
instance with a real CC338 token and with TOTP: valid responses issued a site
session; invalid responses did not. The host's domain-account mapping and OS
login are separate integrations, not functions of this package.

## Install in a site backend

This repository is a server-side npm package. It does not install a login
screen, HTTP endpoint, admin page, user mapping, or OS login by itself. The
site backend must own those parts and follow
[`docs/integration-contract.md`](docs/integration-contract.md).

For InTrack, the reviewed archive is vendored at
`backend/vendor/pi-site-backend-2fa-module-0.2.5.tgz` and pinned in
`backend/package.json`. To update it from a module checkout:

The package is a library, not a standalone container/service. Include the
version-pinned archive in the host backend image and persist pending login
state in the host's server-side store (with a TTL); do not rely on process
memory across restarts or replicas. Rebuild and replace only the backend
service. The module does not manage volumes, health checks, sessions, or
container lifecycle. In the current InTrack implementation, pending MFA
challenges are still process-local: restarting its backend invalidates active
logins, and multiple backend replicas are not supported for MFA.

```sh
npm pack --pack-destination /path/to/InTrack/backend/vendor
```

Update the `file:vendor/pi-site-backend-2fa-module-X.Y.Z.tgz` dependency in
`backend/package.json`, then install and rebuild from the InTrack checkout:

```sh
cd /path/to/InTrack
npm install
docker compose build backend
docker compose up -d --no-deps backend
docker exec intrack-backend node -p "require('pi-site-backend-2fa-module/package.json').version"
```

The final command must print the pinned package version. Keep the archive in
`backend/vendor/`, inside the backend Docker build context. For another site,
install the archive with that site's package manager and implement its routes,
pending-login storage, session issuance, identity mapping, and enrollment UI
separately. Never expose privacyIDEA credentials or transaction IDs to a
browser.
