'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CAPABILITIES,
  KINDS,
  createChallengeResponseProvider,
  createPrivacyIdeaTransport,
  createValidationProvider,
  defineProfile,
  profile,
  profiles,
} = require('../src');

const SERIAL = 'P11C0000TEST';
const NONCE = 'a1b2c3d4';
const HINT = 'ab'.repeat(32);

function piChallenge(type, attributes, serial = SERIAL) {
  return {
    result: { status: true, value: false },
    detail: {
      multi_challenge: [{ type, serial, transaction_id: 'tx-123', attributes }],
    },
  };
}

test('pkcs11cr: challenge exposes only nonce, hint and server-held transaction', async () => {
  const calls = [];
  const provider = createChallengeResponseProvider({
    request: async (params, path) => {
      calls.push({ params, path });
      return { ok: true, body: piChallenge('pkcs11cr', { pkcs11cr_challenge: NONCE, pkcs11cr_cert_modulus_sha256: HINT }) };
    },
  });

  const result = await provider.begin({ username: 'user', realm: 'realm', serial: SERIAL });
  assert.equal(result.kind, KINDS.ACCEPT);
  assert.deepEqual(result.challenge, {
    transaction_id: 'tx-123',
    nonce_hex: NONCE,
    key_hint: HINT,
    key_hint_kind: 'cert_modulus_sha256',
    serial: SERIAL,
  });
  assert.deepEqual(calls, [{ params: { user: 'user', realm: 'realm', pass: '' }, path: '/validate/check' }]);
});

test('missing serial never calls privacyIDEA', async () => {
  let calls = 0;
  const provider = createChallengeResponseProvider({ request: async () => { calls += 1; return { ok: true, body: {} }; } });
  const result = await provider.begin({ username: 'user', realm: 'realm' });
  assert.equal(result.kind, KINDS.NOT_LINKED);
  assert.equal(calls, 0);
});

test('wrong returned serial is rejected before any signing is requested', async () => {
  const provider = createChallengeResponseProvider({
    request: async () => ({ ok: true, body: piChallenge('pkcs11cr', { pkcs11cr_challenge: NONCE }, 'OTHER') }),
  });
  const result = await provider.begin({ username: 'user', realm: 'realm', serial: SERIAL });
  assert.equal(result.kind, KINDS.MISCONFIGURED);
  assert.match(result.message, /іншого носія/);
});

test('avtorcc338 profile reads its own challenge and certificate hint', async () => {
  const provider = createChallengeResponseProvider({
    tokenProfile: profile('avtorcc338'),
    request: async () => ({ ok: true, body: piChallenge('avtorcc338', { avtor_challenge: NONCE, avtor_cert_thumbprint: 'A1B2' }) }),
  });
  const result = await provider.begin({ username: 'user', realm: 'realm', serial: SERIAL });
  assert.equal(result.kind, KINDS.ACCEPT);
  assert.equal(result.challenge.key_hint, 'A1B2');
  assert.equal(result.challenge.key_hint_kind, 'cert_thumbprint_sha256');
});

test('profiles expose capabilities and custom profiles are validated', () => {
  assert.deepEqual(profiles().avtorcc338.capabilities, [CAPABILITIES.VALIDATE, CAPABILITIES.CHALLENGE_RESPONSE]);
  assert.deepEqual(defineProfile({
    name: 'vendor-cr',
    tokenType: 'vendorcr',
    capabilities: [CAPABILITIES.VALIDATE, CAPABILITIES.CHALLENGE_RESPONSE],
    nonceAttribute: 'vendor_nonce',
    keyHintAttribute: 'vendor_key_hint',
  }).tokenType, 'vendorcr');
  assert.throws(() => defineProfile({ name: 'broken', tokenType: 'broken', capabilities: [CAPABILITIES.CHALLENGE_RESPONSE] }), /nonceAttribute/);
});

test('generic validation provider supports standard privacyIDEA token types', async () => {
  let received;
  const provider = createValidationProvider({
    request: async (params, path) => {
      received = { params, path };
      return { ok: true, body: { result: { status: true, value: true }, detail: { type: 'totp', serial: SERIAL } } };
    },
  });
  const result = await provider.check({ username: 'user', realm: 'realm', pass: '123456', serial: SERIAL });
  assert.equal(result.kind, KINDS.ACCEPT);
  assert.deepEqual(received, {
    params: { user: 'user', realm: 'realm', pass: '123456', serial: SERIAL },
    path: '/validate/check',
  });
});

test('complete sends signature and transaction only through the server transport', async () => {
  let received;
  const provider = createChallengeResponseProvider({
    request: async (params, path) => {
      received = { params, path };
      return { ok: true, body: { result: { status: true, value: true }, detail: { serial: SERIAL, type: 'pkcs11cr' } } };
    },
  });
  const result = await provider.complete({ username: 'user', realm: 'realm', transactionId: 'tx-123', signatureHex: 'deadbeef' });
  assert.equal(result.kind, KINDS.ACCEPT);
  assert.deepEqual(received, {
    params: { user: 'user', realm: 'realm', transaction_id: 'tx-123', pass: 'deadbeef' },
    path: '/validate/check',
  });
});

test('malformed signature is rejected without a request', async () => {
  let calls = 0;
  const provider = createChallengeResponseProvider({ request: async () => { calls += 1; return { ok: true, body: {} }; } });
  const result = await provider.complete({ username: 'user', realm: 'realm', transactionId: 'tx-123', signatureHex: 'not-a-signature' });
  assert.equal(result.kind, KINDS.REJECT);
  assert.equal(calls, 0);
});

test('successful challenge response keeps serial when PI omits type', async () => {
  const provider = createChallengeResponseProvider({
    tokenProfile: profile('avtorcc338'),
    request: async () => ({
      ok: true,
      body: { result: { status: true, value: true }, detail: { serial: SERIAL } },
    }),
  });
  const result = await provider.complete({ username: 'user', realm: 'realm',
    transactionId: 'tx-123', signatureHex: 'deadbeef' });
  assert.equal(result.kind, KINDS.ACCEPT);
  assert.equal(result.serial, SERIAL);
  assert.equal(result.type, null);
});

test('HTTP transport keeps PI API key on the backend request', async () => {
  let captured;
  const transport = createPrivacyIdeaTransport({
    baseUrl: 'https://pi.example/',
    apiKey: 'backend-only-key',
    apiKeyMode: 'required',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { status: 200, json: async () => ({ result: { status: true, value: false } }) };
    },
  });
  const result = await transport.request({ user: 'user', realm: 'realm', pass: '' });
  assert.equal(result.ok, true);
  assert.equal(captured.url, 'https://pi.example/validate/check');
  assert.equal(captured.options.headers['PI-Authorization'], 'backend-only-key');
  assert.equal(captured.options.body, 'user=user&realm=realm&pass=');
});

test('HTTP transport opens a circuit after repeated network failures', async () => {
  let calls = 0;
  const transport = createPrivacyIdeaTransport({
    baseUrl: 'https://pi.example',
    breakerFailures: 2,
    fetchImpl: async () => { calls += 1; throw new Error('network down'); },
  });
  assert.equal((await transport.request({ user: 'user', realm: 'realm', pass: '' })).kind, KINDS.UNAVAILABLE);
  assert.equal((await transport.request({ user: 'user', realm: 'realm', pass: '' })).kind, KINDS.UNAVAILABLE);
  const blocked = await transport.request({ user: 'user', realm: 'realm', pass: '' });
  assert.equal(blocked.kind, KINDS.UNAVAILABLE);
  assert.equal(calls, 2);
  assert.equal(transport.breakerState().open, true);
});
