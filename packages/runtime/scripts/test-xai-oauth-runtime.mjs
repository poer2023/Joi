import assert from 'node:assert/strict';
import {
  DEFAULT_XAI_OAUTH_BASE_URL,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SECRET_NAME,
  isXAIOAuthProvider,
  normalizeXAIOAuthState,
  resolveXAIOAuthCredentials,
  validateXAIInferenceBaseURL,
  validateXAIOAuthEndpoint,
  xaiAccessTokenIsExpiring,
} from '../src/xai-oauth.ts';

const futureToken = jwtWithExp(Math.floor(Date.now() / 1000) + 7200);
const expiredToken = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
const stored = new Map();
const refreshCalls = [];

stored.set(XAI_OAUTH_SECRET_NAME, JSON.stringify({
  version: 1,
  provider: 'xai_oauth',
  tokens: {
    access_token: futureToken,
    refresh_token: 'refresh-old',
    token_type: 'Bearer',
  },
  discovery: {
    token_endpoint: 'https://auth.x.ai/oauth/token',
  },
  base_url: 'https://api.x.ai/v1/',
  last_refresh: '2026-06-20T00:00:00Z',
}));

const valid = await resolveXAIOAuthCredentials((name) => stored.get(name) || '', saveSecret, {
  fetchImpl: fakeFetch,
});
assert.equal(valid.apiKey, futureToken);
assert.equal(valid.baseURL, DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(refreshCalls.length, 0);

stored.set(XAI_OAUTH_SECRET_NAME, JSON.stringify({
  version: 1,
  provider: 'xai_oauth',
  tokens: {
    access_token: expiredToken,
    refresh_token: 'refresh-old',
    token_type: 'Bearer',
  },
  discovery: {
    token_endpoint: 'https://auth.x.ai/oauth/token',
  },
  base_url: 'https://attacker.example/v1',
}));

const refreshed = await resolveXAIOAuthCredentials((name) => stored.get(name) || '', saveSecret, {
  fetchImpl: fakeFetch,
});
assert.equal(refreshed.apiKey, 'access-new');
assert.equal(refreshed.baseURL, DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(refreshCalls.length, 1);
assert.equal(refreshCalls[0].grant_type, 'refresh_token');
assert.equal(refreshCalls[0].client_id, XAI_OAUTH_CLIENT_ID);
assert.equal(refreshCalls[0].refresh_token, 'refresh-old');

const savedState = JSON.parse(stored.get(XAI_OAUTH_SECRET_NAME));
assert.equal(savedState.tokens.access_token, 'access-new');
assert.equal(savedState.tokens.refresh_token, 'refresh-new');
assert.equal(savedState.discovery.token_endpoint, 'https://auth.x.ai/oauth/token');

assert.equal(isXAIOAuthProvider('xai-oauth'), true);
assert.equal(isXAIOAuthProvider('xai_oauth'), true);
assert.equal(isXAIOAuthProvider('openai_compatible'), false);
assert.equal(xaiAccessTokenIsExpiring(expiredToken, 0), true);
assert.equal(xaiAccessTokenIsExpiring(futureToken, 60), false);
assert.equal(validateXAIOAuthEndpoint('https://auth.x.ai/oauth/token', 'token_endpoint'), 'https://auth.x.ai/oauth/token');
assert.throws(() => validateXAIOAuthEndpoint('http://auth.x.ai/oauth/token', 'token_endpoint'), /HTTPS/);
assert.equal(validateXAIInferenceBaseURL('https://api.x.ai/v1/'), DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(validateXAIInferenceBaseURL('http://127.0.0.1:8645/v1'), DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(normalizeXAIOAuthState(savedState).provider, 'xai_oauth');

console.log('xai oauth runtime tests passed');

async function saveSecret(name, value) {
  stored.set(name, value);
}

async function fakeFetch(url, init) {
  assert.equal(url, 'https://auth.x.ai/oauth/token');
  const body = new URLSearchParams(init.body);
  refreshCalls.push(Object.fromEntries(body.entries()));
  return new Response(JSON.stringify({
    access_token: 'access-new',
    refresh_token: 'refresh-new',
    token_type: 'Bearer',
    expires_in: 21600,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jwtWithExp(exp) {
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ exp }),
    'sig',
  ].join('.');
}

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
