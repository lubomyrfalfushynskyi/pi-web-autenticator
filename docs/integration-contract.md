# Site integration contract

## Responsibility boundary

The host site owns:

- the login policy and first factor;
- the pending-login record and expiration;
- the `transaction_id` returned by privacyIDEA;
- the mapping from site user to PI realm/resolver/UID/serial;
- session issuance and audit;
- domain connectors and token enrollment UI.

This package owns only the server-side PI request/response contract. It never
receives a browser request directly and never makes a session decision.

## Standard PI token

Use `createValidationProvider()` when the token expects a value in `pass`:

```js
const validator = createValidationProvider({ request: piTransport.request });
const result = await validator.check({
  username: identity.username,
  realm: identity.realm,
  serial: identity.serial,
  pass: submittedCode,
});
```

The host must treat `ACCEPT` as the only successful result. `NO_TOKEN`,
`UNKNOWN_USER` and `MISCONFIGURED` are mapping/configuration failures, not
reasons to ask the user to retry a code.

## Challenge-response token

Use `createChallengeResponseProvider()` for a profile with the
`challenge_response` capability:

```text
begin(identity)
  → PI challenge
  → store transaction_id on the server
  → return nonce_hex/key_hint/key_hint_kind to the browser
  → browser calls local signing agent
  → complete(identity, stored transaction_id, signature)
  → PI ACCEPT/REJECT
```

The host must not accept a client-supplied transaction ID. It must compare the
returned serial with the server-side identity mapping before exposing the
challenge. After `complete()` returns `ACCEPT`, it must require the returned
`serial` to match the pending login's server-held token mapping. If PI supplies
`type`, it must match the server-held type too; a missing `type` is normal for
some successful challenge responses and must not replace the type pinned at
`begin()`. Missing or mismatched serials and mismatched supplied types fail
closed. The browser must never receive the PI URL or API key.

## Profile extension

Use `defineProfile()` for a vendor token that follows the same challenge
contract. The profile must name the PI token type and the token attributes
containing the nonce and key-selection hint. Do not add domain or enrollment
logic to this package to support a new site.

## Verification requirements

Each host integration must test:

- valid and invalid standard token values;
- valid and invalid challenge signatures;
- missing and stale serial mappings;
- wrong returned serial;
- missing or wrong accepted serial, and wrong supplied type before session issuance;
- accepted response without `type`, with type retained from the pending mapping;
- missing transaction ID;
- privacyIDEA timeout and API rejection;
- token wake/reinitialization on the local agent;
- no secrets or transaction IDs in browser-facing responses.
