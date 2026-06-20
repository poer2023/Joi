import assert from 'node:assert/strict';
import {
  DEFAULT_XAI_OAUTH_BASE_URL,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_HERMES_SCOPES,
  XAI_OAUTH_REDIRECT_URI,
  XAI_OAUTH_SECRET_NAME,
  createXAIOAuthAuthorizationRequest,
  exchangeXAIOAuthCode,
  isXAIOAuthProvider,
  loginWithXAIOAuthLoopback,
  normalizeXAIOAuthManualCode,
  normalizeXAIOAuthState,
  resolveXAIOAuthCredentials,
  validateXAIRedirectURI,
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
assert.equal(validateXAIRedirectURI(XAI_OAUTH_REDIRECT_URI), XAI_OAUTH_REDIRECT_URI);
assert.throws(() => validateXAIRedirectURI('https://example.com/callback'), /127\.0\.0\.1/);
assert.equal(validateXAIInferenceBaseURL('https://api.x.ai/v1/'), DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(validateXAIInferenceBaseURL('http://127.0.0.1:8645/v1'), DEFAULT_XAI_OAUTH_BASE_URL);
assert.equal(normalizeXAIOAuthState(savedState).provider, 'xai_oauth');

const authRequest = await createXAIOAuthAuthorizationRequest({
  authorizationEndpoint: 'https://auth.x.ai/oauth2/authorize',
  tokenEndpoint: 'https://auth.x.ai/oauth2/token',
  codeVerifier: 'verifier-123',
  state: 'state-123',
});
const authURL = new URL(authRequest.url);
assert.equal(authURL.origin + authURL.pathname, 'https://auth.x.ai/oauth2/authorize');
assert.equal(authURL.searchParams.get('client_id'), XAI_OAUTH_CLIENT_ID);
assert.equal(authURL.searchParams.get('redirect_uri'), XAI_OAUTH_REDIRECT_URI);
assert.equal(authURL.searchParams.get('scope'), XAI_OAUTH_HERMES_SCOPES.join(' '));
assert.equal(authURL.searchParams.get('state'), 'state-123');
assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256');
assert.notEqual(authURL.searchParams.get('code_challenge'), 'verifier-123');
assert.equal(authRequest.scopes.includes('grok-cli:access'), true);
assert.equal(authRequest.scopes.includes('api:access'), true);

const exchangeCalls = [];
const codeState = await exchangeXAIOAuthCode({
  code: 'code-123',
  codeVerifier: 'verifier-123',
  discovery: {
    authorization_endpoint: 'https://auth.x.ai/oauth2/authorize',
    token_endpoint: 'https://auth.x.ai/oauth2/token',
  },
  fetchImpl: fakeCodeExchangeFetch,
});
assert.equal(exchangeCalls[0].grant_type, 'authorization_code');
assert.equal(exchangeCalls[0].client_id, XAI_OAUTH_CLIENT_ID);
assert.equal(exchangeCalls[0].code, 'code-123');
assert.equal(exchangeCalls[0].redirect_uri, XAI_OAUTH_REDIRECT_URI);
assert.equal(exchangeCalls[0].code_verifier, 'verifier-123');
assert.equal(codeState.source, 'loopback_pkce');
assert.equal(codeState.scope, XAI_OAUTH_HERMES_SCOPES.join(' '));
assert.equal(codeState.tokens.access_token, 'access-code');
assert.equal(codeState.tokens.refresh_token, 'refresh-code');

const manualCode = 'BjHT4zJevv_9h3OB6NAdpNz99C4_lMDCPOyXYoBgqeT9kUOjQSuREU59uWT_i4hzdOcchSkaZQzwnXBPaLCjFw';
assert.equal(normalizeXAIOAuthManualCode(manualCode), manualCode);
assert.equal(normalizeXAIOAuthManualCode('https://accounts.x.ai/oauth2/consent?code=bad'), '');

const loginExchangeCalls = [];
let openedLoginURL = '';
let clipboardValue = '';
const manualLoginResult = await loginWithXAIOAuthLoopback({
  saveSecret,
  fetchImpl: fakeManualLoginFetch,
  redirectURI: 'http://127.0.0.1:56129/callback',
  timeoutSeconds: 2,
  manualCodePollIntervalMs: 10,
  openURL(url) {
    openedLoginURL = url;
    setTimeout(() => {
      clipboardValue = manualCode;
    }, 30);
  },
  readClipboard() {
    return clipboardValue;
  },
});
assert.equal(new URL(openedLoginURL).searchParams.get('scope'), XAI_OAUTH_HERMES_SCOPES.join(' '));
assert.equal(loginExchangeCalls[0].code, manualCode);
assert.equal(loginExchangeCalls[0].redirect_uri, 'http://127.0.0.1:56129/callback');
assert.equal(Boolean(loginExchangeCalls[0].code_verifier), true);
assert.equal(manualLoginResult.source, 'manual_code_pkce');
assert.equal(JSON.parse(stored.get(XAI_OAUTH_SECRET_NAME)).source, 'manual_code_pkce');

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

async function fakeCodeExchangeFetch(url, init) {
  assert.equal(url, 'https://auth.x.ai/oauth2/token');
  const body = new URLSearchParams(init.body);
  exchangeCalls.push(Object.fromEntries(body.entries()));
  return new Response(JSON.stringify({
    access_token: 'access-code',
    refresh_token: 'refresh-code',
    id_token: 'id-code',
    token_type: 'Bearer',
    expires_in: 21600,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function fakeManualLoginFetch(url, init) {
  if (url === 'https://auth.x.ai/.well-known/openid-configuration') {
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://auth.x.ai/oauth2/authorize',
      token_endpoint: 'https://auth.x.ai/oauth2/token',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  assert.equal(url, 'https://auth.x.ai/oauth2/token');
  const body = new URLSearchParams(init.body);
  loginExchangeCalls.push(Object.fromEntries(body.entries()));
  return new Response(JSON.stringify({
    access_token: 'access-manual',
    refresh_token: 'refresh-manual',
    id_token: 'id-manual',
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
