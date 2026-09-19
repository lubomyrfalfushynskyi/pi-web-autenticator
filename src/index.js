'use strict';

// Server-only adapter for privacyIDEA challenge-response tokens.
// A website owns the pending login and its transaction_id. The browser only
// receives a nonce and a key-selection hint for its local signing agent.

const KINDS = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  NO_TOKEN: 'no_token',
  UNKNOWN_USER: 'unknown_user',
  MISCONFIGURED: 'misconfigured',
  UNAVAILABLE: 'unavailable',
  NOT_LINKED: 'not_linked',
});

const CAPABILITIES = Object.freeze({
  VALIDATE: 'validate',
  CHALLENGE_RESPONSE: 'challenge_response',
});

const PROFILES = Object.freeze({
  pkcs11cr: Object.freeze({
    name: 'pkcs11cr',
    tokenType: 'pkcs11cr',
    capabilities: [CAPABILITIES.VALIDATE, CAPABILITIES.CHALLENGE_RESPONSE],
    nonceAttribute: 'pkcs11cr_challenge',
    keyHintAttribute: 'pkcs11cr_cert_modulus_sha256',
    keyHintKind: 'cert_modulus_sha256',
  }),
  avtorcc338: Object.freeze({
    name: 'avtorcc338',
    tokenType: 'avtorcc338',
    capabilities: [CAPABILITIES.VALIDATE, CAPABILITIES.CHALLENGE_RESPONSE],
    nonceAttribute: 'avtor_challenge',
    keyHintAttribute: 'avtor_cert_thumbprint',
    keyHintKind: 'cert_thumbprint_sha256',
  }),
});

function defineProfile({ name, tokenType, capabilities = [], nonceAttribute, keyHintAttribute, keyHintKind }) {
  if (!name || !tokenType) throw new TypeError('Профіль має містити name і tokenType');
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new TypeError('Профіль має містити хоча б одну capability');
  }
  const allowed = new Set(Object.values(CAPABILITIES));
  if (capabilities.some((capability) => !allowed.has(capability))) {
    throw new TypeError('Профіль містить невідому capability');
  }
  if (capabilities.includes(CAPABILITIES.CHALLENGE_RESPONSE) && (!nonceAttribute || !keyHintAttribute)) {
    throw new TypeError('Challenge-response профіль має містити nonceAttribute і keyHintAttribute');
  }
  return Object.freeze({
    name: String(name),
    tokenType: String(tokenType),
    capabilities: Object.freeze([...new Set(capabilities)]),
    ...(nonceAttribute ? { nonceAttribute: String(nonceAttribute) } : {}),
    ...(keyHintAttribute ? { keyHintAttribute: String(keyHintAttribute) } : {}),
    ...(keyHintKind ? { keyHintKind: String(keyHintKind) } : {}),
  });
}

function profile(name) {
  const found = PROFILES[name];
  if (!found) throw new Error(`Невідомий профіль PI challenge-response: ${name}`);
  return { ...found };
}

function profiles() {
  return Object.fromEntries(Object.entries(PROFILES).map(([name, value]) => [name, { ...value }]));
}

function classify(body) {
  const result = body && body.result ? body.result : {};
  const detail = body && body.detail ? body.detail : {};
  const message = detail.message || (result.error && result.error.message) || '';
  if (result.error) {
    return { kind: result.error.code === 904 ? KINDS.UNKNOWN_USER : KINDS.MISCONFIGURED, message };
  }
  if (result.value === true) {
    return { kind: KINDS.ACCEPT, message, serial: detail.serial || null, type: detail.type || null };
  }
  if (/no tokens assigned/i.test(message)) return { kind: KINDS.NO_TOKEN, message };
  return { kind: KINDS.REJECT, message, serial: detail.serial || null, type: detail.type || null };
}

function responseError(body) {
  const result = body && body.result ? body.result : {};
  if (!result.error) return null;
  const message = result.error.message || '';
  return { kind: result.error.code === 904 ? KINDS.UNKNOWN_USER : KINDS.MISCONFIGURED, message };
}

function extractChallenge(body, tokenProfile) {
  const detail = body && body.detail ? body.detail : {};
  const entries = Array.isArray(detail.multi_challenge) ? detail.multi_challenge : [];
  const entry = entries.find((candidate) => candidate && candidate.type === tokenProfile.tokenType);
  if (!entry) return null;

  const attributes = entry.attributes || {};
  const nonceHex = attributes[tokenProfile.nonceAttribute];
  if (typeof nonceHex !== 'string' || !/^[0-9a-fA-F]+$/.test(nonceHex) || nonceHex.length % 2 !== 0) return null;

  return {
    transaction_id: entry.transaction_id || detail.transaction_id || null,
    nonce_hex: nonceHex,
    key_hint: attributes[tokenProfile.keyHintAttribute] || null,
    key_hint_kind: tokenProfile.keyHintKind || null,
    serial: entry.serial || null,
  };
}

function validSignature(signatureHex) {
  return typeof signatureHex === 'string' && /^[0-9a-fA-F]{2,2048}$/.test(signatureHex);
}

function createValidationProvider({ request }) {
  if (typeof request !== 'function') throw new TypeError('request має бути функцією серверного PI-транспорту');

  async function check({ username, realm, pass, serial }) {
    if (typeof pass !== 'string') return { kind: KINDS.REJECT, message: 'Не передано значення другого фактора' };
    const sent = await request({ user: username, realm, pass, ...(serial ? { serial } : {}) }, '/validate/check');
    if (!sent || !sent.ok) return { kind: sent && sent.kind ? sent.kind : KINDS.UNAVAILABLE, message: (sent && sent.message) || '' };
    return classify(sent.body);
  }

  return Object.freeze({ check });
}

/**
 * Creates the server-only HTTP transport used by site backends that do not
 * already have their own PI client. The transport owns its timeout and
 * circuit-breaker state; browsers and local signing agents never see it.
 */
function createPrivacyIdeaTransport({
  baseUrl,
  apiKey = '',
  apiKeyMode = 'none',
  timeoutMs = 5000,
  breakerFailures = 3,
  breakerCooldownSec = 60,
  fetchImpl = globalThis.fetch,
}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new TypeError('baseUrl privacyIDEA обовʼязковий');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl має бути функцією');
  if (!['none', 'optional', 'required'].includes(apiKeyMode)) throw new TypeError('apiKeyMode має бути none, optional або required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs має бути додатним числом');

  const breaker = { failures: 0, openedAt: null };
  const state = (now = Date.now()) => {
    const cooldownMs = breakerCooldownSec * 1000;
    if (breaker.openedAt && now - breaker.openedAt >= cooldownMs) {
      breaker.failures = 0;
      breaker.openedAt = null;
    }
    return {
      open: !!breaker.openedAt,
      failures: breaker.failures,
      retry_in_sec: breaker.openedAt ? Math.ceil((cooldownMs - (now - breaker.openedAt)) / 1000) : 0,
    };
  };
  const failed = () => {
    breaker.failures += 1;
    if (!breaker.openedAt && breaker.failures >= breakerFailures) breaker.openedAt = Date.now();
  };
  const succeeded = () => { breaker.failures = 0; breaker.openedAt = null; };

  async function request(params, path = '/validate/check') {
    const needsRealm = !params.serial;
    if (needsRealm && !params.realm) {
      return { ok: false, kind: KINDS.MISCONFIGURED, message: 'Не задано реалм сервера автентифікації' };
    }
    const current = state();
    if (current.open) {
      return { ok: false, kind: KINDS.UNAVAILABLE, message: `Сервер автентифікації не відповідає, наступна спроба через ${current.retry_in_sec} с` };
    }
    if (apiKeyMode === 'required' && !apiKey) {
      return { ok: false, kind: KINDS.MISCONFIGURED, message: 'Ключ доступу до сервера автентифікації обовʼязковий, але не заданий' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (apiKey && apiKeyMode !== 'none') headers['PI-Authorization'] = apiKey;
      const response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers,
        body: new URLSearchParams(params).toString(),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        failed();
        return {
          ok: false,
          kind: KINDS.MISCONFIGURED,
          message: (body.result && body.result.error && body.result.error.message) || 'Сервер автентифікації відхилив звернення',
        };
      }
      succeeded();
      return { ok: true, body };
    } catch (error) {
      failed();
      return {
        ok: false,
        kind: KINDS.UNAVAILABLE,
        message: error && error.name === 'AbortError' ? 'Сервер автентифікації не відповів вчасно' : 'Сервер автентифікації недоступний',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ request, breakerState: state });
}

/**
 * Creates a PI challenge-response provider.
 *
 * `request(params, path)` is deliberately injected by the host application.
 * It must keep PI credentials, timeouts, TLS policy and circuit-breaker state
 * server-side and return `{ ok: true, body }` or `{ ok: false, kind, message }`.
 */
function createChallengeResponseProvider({ request, tokenProfile = profile('pkcs11cr'), triggerMode = 'check' }) {
  if (typeof request !== 'function') throw new TypeError('request має бути функцією серверного PI-транспорту');
  if (!tokenProfile || !tokenProfile.tokenType || !tokenProfile.nonceAttribute) {
    throw new TypeError('tokenProfile має містити tokenType і nonceAttribute');
  }
  if (!['check', 'trigger'].includes(triggerMode)) throw new TypeError('triggerMode має бути check або trigger');

  async function begin({ username, realm, serial }) {
    if (!serial) return { kind: KINDS.NOT_LINKED, message: 'Для цього користувача не зіставлено апаратного носія' };

    const sent = triggerMode === 'trigger'
      ? await request({ serial }, '/validate/triggerchallenge')
      : await request({ user: username, realm, pass: '' }, '/validate/check');
    if (!sent || !sent.ok) return { kind: sent && sent.kind ? sent.kind : KINDS.UNAVAILABLE, message: (sent && sent.message) || '' };

    const error = responseError(sent.body);
    if (error) return error;
    const challenge = extractChallenge(sent.body, tokenProfile);
    if (!challenge) {
      return {
        kind: KINDS.NO_TOKEN,
        stale_link: true,
        message: 'Апаратний носій цього користувача більше не діє',
      };
    }
    if (!challenge.transaction_id) {
      return { kind: KINDS.MISCONFIGURED, message: 'Сервер не повернув ідентифікатор операції' };
    }
    if (challenge.serial && challenge.serial !== serial) {
      return { kind: KINDS.MISCONFIGURED, message: 'Сервер повернув виклик іншого носія' };
    }
    return { kind: KINDS.ACCEPT, challenge };
  }

  async function complete({ username, realm, transactionId, signatureHex }) {
    if (!transactionId || !signatureHex) return { kind: KINDS.REJECT, message: 'Не передано підпису або ідентифікатора операції' };
    if (!validSignature(signatureHex)) return { kind: KINDS.REJECT, message: 'Підпис має неправильний формат' };

    const sent = await request({
      user: username,
      realm,
      transaction_id: String(transactionId),
      pass: signatureHex,
    }, '/validate/check');
    if (!sent || !sent.ok) return { kind: sent && sent.kind ? sent.kind : KINDS.UNAVAILABLE, message: (sent && sent.message) || '' };
    return classify(sent.body);
  }

  return Object.freeze({ begin, complete, tokenProfile: { ...tokenProfile }, triggerMode });
}

module.exports = {
  CAPABILITIES,
  KINDS,
  PROFILES,
  classify,
  createChallengeResponseProvider,
  createPrivacyIdeaTransport,
  createValidationProvider,
  defineProfile,
  extractChallenge,
  profile,
  profiles,
  validSignature,
};
