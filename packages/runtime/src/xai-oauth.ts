import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export const XAI_OAUTH_SECRET_NAME = 'XAI_OAUTH_STATE';
export const DEFAULT_XAI_OAUTH_BASE_URL = 'https://api.x.ai/v1';
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
export const XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 3600;
export const XAI_OAUTH_REDIRECT_URI = 'http://127.0.0.1:56121/callback';
export const XAI_OAUTH_HERMES_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'] as const;

export type XAIOAuthSecretResolver = (name: string) => Promise<string> | string;
export type XAIOAuthSecretSaver = (name: string, value: string) => Promise<void> | void;

export type XAIOAuthState = {
  version?: number;
  provider?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  discovery?: {
    authorization_endpoint?: string;
    token_endpoint?: string;
  };
  redirect_uri?: string;
  base_url?: string;
  last_refresh?: string;
  auth_mode?: string;
  source?: string;
  scope?: string;
};

type ResolveOptions = {
  forceRefresh?: boolean;
  refreshIfExpiring?: boolean;
  refreshSkewSeconds?: number;
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
};

export type XAIOAuthCredentials = {
  provider: 'xai_oauth';
  apiKey: string;
  baseURL: string;
  tokenType: string;
  lastRefresh?: string;
};

export type XAIOAuthLoginResult = {
  status: 'succeeded';
  provider: 'xai_oauth';
  base_url: string;
  last_refresh: string;
  source: string;
  scope: string;
  expires_at?: string;
};

export type XAIOAuthAuthorizationRequest = {
  url: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectURI: string;
  scopes: string[];
  discovery: Required<NonNullable<XAIOAuthState['discovery']>>;
};

type LoginOptions = {
  saveSecret: XAIOAuthSecretSaver;
  openURL: (url: string) => Promise<void> | void;
  readClipboard?: () => Promise<string> | string;
  timeoutSeconds?: number;
  manualCodePollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  redirectURI?: string;
  scopes?: string[];
};

export function isXAIOAuthProvider(provider: string | undefined): boolean {
  return ['xai_oauth', 'xai-oauth', 'xai'].includes((provider || '').trim().toLowerCase());
}

export function isGrokBuildProvider(provider: string | undefined): boolean {
  return ['grok_build', 'grok-build'].includes((provider || '').trim().toLowerCase());
}

export function isXAIOAuthBackedProvider(provider: string | undefined): boolean {
  return isXAIOAuthProvider(provider) || isGrokBuildProvider(provider);
}

export async function resolveXAIOAuthCredentials(
  resolveSecret: XAIOAuthSecretResolver,
  saveSecret?: XAIOAuthSecretSaver,
  options: ResolveOptions = {},
): Promise<XAIOAuthCredentials> {
  let state = await loadXAIOAuthState(resolveSecret);
  let tokens = tokensFromState(state);
  const accessToken = tokens.access_token;
  const forceRefresh = Boolean(options.forceRefresh);
  const refreshIfExpiring = options.refreshIfExpiring !== false;
  const skewSeconds = options.refreshSkewSeconds ?? XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS;
  const shouldRefresh = forceRefresh || (refreshIfExpiring && xaiAccessTokenIsExpiring(accessToken, skewSeconds));

  if (shouldRefresh) {
    if (!saveSecret) {
      throw new Error('xAI OAuth token refresh requires secret save support');
    }
    state = await refreshXAIOAuthState(state, {
      timeoutSeconds: options.timeoutSeconds,
      fetchImpl: options.fetchImpl,
    });
    await saveXAIOAuthState(saveSecret, state);
    tokens = tokensFromState(state);
  }

  return {
    provider: 'xai_oauth',
    apiKey: tokens.access_token,
    baseURL: validateXAIInferenceBaseURL(state.base_url || DEFAULT_XAI_OAUTH_BASE_URL),
    tokenType: tokens.token_type || 'Bearer',
    lastRefresh: state.last_refresh,
  };
}

export async function loadXAIOAuthState(resolveSecret: XAIOAuthSecretResolver): Promise<XAIOAuthState> {
  const raw = String(await resolveSecret(XAI_OAUTH_SECRET_NAME) || '').trim();
  if (!raw) throw new Error('XAI_OAUTH_STATE is not configured');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`XAI_OAUTH_STATE is not valid JSON: ${errorMessage(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('XAI_OAUTH_STATE must be a JSON object');
  }
  return parsed as XAIOAuthState;
}

export async function saveXAIOAuthState(saveSecret: XAIOAuthSecretSaver, state: XAIOAuthState): Promise<void> {
  await saveSecret(XAI_OAUTH_SECRET_NAME, JSON.stringify(normalizeXAIOAuthState(state)));
}

export function normalizeXAIOAuthState(state: XAIOAuthState): XAIOAuthState {
  const tokens = tokensFromState(state);
  return {
    version: state.version || 1,
    provider: 'xai_oauth',
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: stringValue(state.tokens?.id_token),
      expires_in: numberValue(state.tokens?.expires_in),
      token_type: tokens.token_type || 'Bearer',
    },
    discovery: {
      authorization_endpoint: stringValue(state.discovery?.authorization_endpoint),
      token_endpoint: validateXAIOAuthEndpoint(stringValue(state.discovery?.token_endpoint), 'token_endpoint'),
    },
    redirect_uri: stringValue(state.redirect_uri),
    base_url: validateXAIInferenceBaseURL(state.base_url || DEFAULT_XAI_OAUTH_BASE_URL),
    last_refresh: stringValue(state.last_refresh) || new Date().toISOString(),
    auth_mode: stringValue(state.auth_mode) || 'oauth_pkce',
    source: stringValue(state.source) || 'joi',
    scope: stringValue(state.scope),
  };
}

export async function loginWithXAIOAuthLoopback(options: LoginOptions): Promise<XAIOAuthLoginResult> {
  const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 180;
  const request = await createXAIOAuthAuthorizationRequest({
    fetchImpl: options.fetchImpl,
    timeoutSeconds,
    redirectURI: options.redirectURI,
    scopes: options.scopes,
  });
  const callbackURL = new URL(request.redirectURI);
  if (callbackURL.hostname !== '127.0.0.1') {
    throw new Error('xAI OAuth loopback redirect must use 127.0.0.1');
  }

  let server: Server | undefined;
  let settled = false;
  const initialManualCode = normalizeXAIOAuthManualCode(options.readClipboard ? await safeReadClipboard(options.readClipboard) : '');

  try {
    const resultPromise = new Promise<XAIOAuthLoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`xAI OAuth login timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);
      let manualCodePoll: ReturnType<typeof setInterval> | undefined;

      const stopWaiting = () => {
        clearTimeout(timeout);
        if (manualCodePoll) {
          clearInterval(manualCodePoll);
          manualCodePoll = undefined;
        }
      };

      const finish = (fn: () => Promise<XAIOAuthLoginResult>) => {
        if (settled) return;
        settled = true;
        stopWaiting();
        fn().then(resolve, reject).finally(() => {
          closeServer(server);
        });
      };

      const exchangeCode = async (code: string, source: string) => {
        const oauthState = await exchangeXAIOAuthCode({
          code,
          codeVerifier: request.codeVerifier,
          redirectURI: request.redirectURI,
          discovery: request.discovery,
          scopes: request.scopes,
          fetchImpl: options.fetchImpl,
          timeoutSeconds,
        });
        const sourcedState = normalizeXAIOAuthState({ ...oauthState, source });
        await saveXAIOAuthState(options.saveSecret, sourcedState);
        return loginResultFromState(sourcedState);
      };

      if (options.readClipboard) {
        const intervalMs = Math.max(250, options.manualCodePollIntervalMs || 1000);
        manualCodePoll = setInterval(() => {
          if (settled) return;
          Promise.resolve(options.readClipboard?.() || '').then((value) => {
            const code = normalizeXAIOAuthManualCode(value);
            if (!code || code === initialManualCode) return;
            finish(() => exchangeCode(code, 'manual_code_pkce'));
          }).catch(() => {
            // Clipboard reads can fail transiently while the browser is active.
          });
        }, intervalMs);
        manualCodePoll.unref?.();
      }

      server = createServer((req, res) => {
        const incoming = new URL(req.url || '/', request.redirectURI);
        if (incoming.pathname !== callbackURL.pathname) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Unsupported xAI OAuth callback route.');
          return;
        }

        const returnedState = incoming.searchParams.get('state') || '';
        const code = incoming.searchParams.get('code') || '';
        const error = incoming.searchParams.get('error') || '';
        const errorDescription = incoming.searchParams.get('error_description') || '';

        if (error) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(oauthHTML('xAI 登录失败', escapeHTML(errorDescription || error)));
          finish(async () => {
            throw new Error(`xAI OAuth login failed: ${errorDescription || error}`);
          });
          return;
        }
        if (!code || returnedState !== request.state) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(oauthHTML('xAI 登录失败', '授权回调缺少 code，或 state 不匹配。'));
          finish(async () => {
            throw new Error('xAI OAuth callback was missing code or had a mismatched state');
          });
          return;
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(oauthHTML('xAI 登录成功', '可以关闭这个窗口并回到 Joi。'));
        finish(() => exchangeCode(code, 'loopback_pkce'));
      });

      server.on('error', (error) => {
        stopWaiting();
        reject(error);
      });
      server.listen(Number(callbackURL.port), callbackURL.hostname, () => {
        Promise.resolve(options.openURL(request.url)).catch((error) => {
          stopWaiting();
          reject(error);
          closeServer(server);
        });
      });
    });

    return await resultPromise;
  } finally {
    closeServer(server);
  }
}

export async function createXAIOAuthAuthorizationRequest(options: {
  fetchImpl?: typeof fetch;
  timeoutSeconds?: number;
  redirectURI?: string;
  scopes?: string[];
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  codeVerifier?: string;
  state?: string;
} = {}): Promise<XAIOAuthAuthorizationRequest> {
  const scopes = normalizeScopes(options.scopes);
  const redirectURI = validateXAIRedirectURI(options.redirectURI || XAI_OAUTH_REDIRECT_URI);
  const metadata = options.authorizationEndpoint && options.tokenEndpoint
    ? {
        authorization_endpoint: options.authorizationEndpoint,
        token_endpoint: options.tokenEndpoint,
      }
    : await discoverXAIOAuthMetadata(options);
  const discovery = {
    authorization_endpoint: validateXAIOAuthEndpoint(
      options.authorizationEndpoint || metadata.authorization_endpoint,
      'authorization_endpoint',
    ),
    token_endpoint: validateXAIOAuthEndpoint(
      options.tokenEndpoint || metadata.token_endpoint,
      'token_endpoint',
    ),
  };
  const codeVerifier = options.codeVerifier || randomBase64URL(64);
  const state = options.state || randomBase64URL(32);
  const codeChallenge = base64URLDigest(codeVerifier);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', XAI_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectURI);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return {
    url: url.toString(),
    state,
    codeVerifier,
    codeChallenge,
    redirectURI,
    scopes,
    discovery,
  };
}

export async function exchangeXAIOAuthCode(options: {
  code: string;
  codeVerifier: string;
  redirectURI?: string;
  discovery?: XAIOAuthState['discovery'];
  scopes?: string[];
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<XAIOAuthState> {
  const code = stringValue(options.code);
  const codeVerifier = stringValue(options.codeVerifier);
  if (!code) throw new Error('xAI OAuth authorization code is missing');
  if (!codeVerifier) throw new Error('xAI OAuth code verifier is missing');
  const redirectURI = validateXAIRedirectURI(options.redirectURI || XAI_OAUTH_REDIRECT_URI);
  const tokenEndpoint = validateXAIOAuthEndpoint(
    stringValue(options.discovery?.token_endpoint) || (await discoverXAIOAuthMetadata(options)).token_endpoint,
    'token_endpoint',
  );
  const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 20;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('xAI OAuth code exchange timed out')), timeoutSeconds * 1000);
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: XAI_OAUTH_CLIENT_ID,
        code,
        redirect_uri: redirectURI,
        code_verifier: codeVerifier,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`xAI OAuth code exchange failed with ${response.status}: ${raw.slice(0, 1000).trim()}`);
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = stringValue(payload.access_token);
    const refreshToken = stringValue(payload.refresh_token);
    if (!accessToken) throw new Error('xAI OAuth code exchange response was missing access_token');
    if (!refreshToken) throw new Error('xAI OAuth code exchange response was missing refresh_token');
    return normalizeXAIOAuthState({
      version: 1,
      provider: 'xai_oauth',
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: stringValue(payload.id_token),
        expires_in: numberValue(payload.expires_in),
        token_type: stringValue(payload.token_type) || 'Bearer',
      },
      discovery: {
        authorization_endpoint: stringValue(options.discovery?.authorization_endpoint) || 'https://auth.x.ai/oauth2/authorize',
        token_endpoint: tokenEndpoint,
      },
      redirect_uri: redirectURI,
      base_url: DEFAULT_XAI_OAUTH_BASE_URL,
      last_refresh: new Date().toISOString(),
      auth_mode: 'oauth_pkce',
      source: 'loopback_pkce',
      scope: normalizeScopes(options.scopes).join(' '),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeXAIOAuthManualCode(value: string): string {
  const candidate = stringValue(value);
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(candidate)) return '';
  return candidate;
}

export async function refreshXAIOAuthState(
  state: XAIOAuthState,
  options: { timeoutSeconds?: number; fetchImpl?: typeof fetch } = {},
): Promise<XAIOAuthState> {
  const tokens = tokensFromState(state);
  const tokenEndpoint = validateXAIOAuthEndpoint(
    stringValue(state.discovery?.token_endpoint) || await discoverXAITokenEndpoint(options),
    'token_endpoint',
  );
  const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 20;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('xAI OAuth refresh timed out')), timeoutSeconds * 1000);
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: XAI_OAUTH_CLIENT_ID,
        refresh_token: tokens.refresh_token,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      const relogin = [400, 401].includes(response.status);
      throw new Error(`xAI OAuth refresh failed with ${response.status}${relogin ? ' (re-login required)' : ''}: ${raw.slice(0, 1000).trim()}`);
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = stringValue(payload.access_token);
    if (!accessToken) throw new Error('xAI OAuth refresh response was missing access_token');
    const nextState: XAIOAuthState = {
      ...state,
      version: state.version || 1,
      provider: 'xai_oauth',
      tokens: {
        ...state.tokens,
        access_token: accessToken,
        refresh_token: stringValue(payload.refresh_token) || tokens.refresh_token,
        id_token: stringValue(payload.id_token) || stringValue(state.tokens?.id_token),
        expires_in: numberValue(payload.expires_in) ?? numberValue(state.tokens?.expires_in),
        token_type: stringValue(payload.token_type) || tokens.token_type || 'Bearer',
      },
      discovery: {
        ...state.discovery,
        token_endpoint: tokenEndpoint,
      },
      base_url: validateXAIInferenceBaseURL(state.base_url || DEFAULT_XAI_OAUTH_BASE_URL),
      last_refresh: new Date().toISOString(),
      auth_mode: stringValue(state.auth_mode) || 'oauth_pkce',
      source: stringValue(state.source) || 'joi',
    };
    return normalizeXAIOAuthState(nextState);
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverXAITokenEndpoint(options: { timeoutSeconds?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  return (await discoverXAIOAuthMetadata(options)).token_endpoint;
}

export async function discoverXAIOAuthMetadata(options: { timeoutSeconds?: number; fetchImpl?: typeof fetch } = {}): Promise<Required<NonNullable<XAIOAuthState['discovery']>>> {
  const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 15;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('xAI OIDC discovery timed out')), timeoutSeconds * 1000);
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(XAI_OAUTH_DISCOVERY_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`xAI OIDC discovery returned ${response.status}: ${raw.slice(0, 1000).trim()}`);
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return {
      authorization_endpoint: validateXAIOAuthEndpoint(stringValue(payload.authorization_endpoint), 'authorization_endpoint'),
      token_endpoint: validateXAIOAuthEndpoint(stringValue(payload.token_endpoint), 'token_endpoint'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function xaiAccessTokenIsExpiring(accessToken: string, skewSeconds = 0): boolean {
  if (!accessToken.includes('.')) return false;
  try {
    const [, payload] = accessToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = typeof decoded.exp === 'number' ? decoded.exp : NaN;
    return Number.isFinite(exp) && exp <= Date.now() / 1000 + Math.max(0, skewSeconds);
  } catch {
    return false;
  }
}

export function validateXAIOAuthEndpoint(url: string, field: string): string {
  const endpoint = String(url || '').trim();
  if (!endpoint) throw new Error(`xAI OAuth ${field} is missing`);
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:') throw new Error(`xAI OAuth ${field} must use HTTPS`);
  const host = parsed.hostname.toLowerCase();
  if (host !== 'x.ai' && !host.endsWith('.x.ai')) {
    throw new Error(`xAI OAuth ${field} host must be x.ai or a *.x.ai subdomain`);
  }
  return endpoint;
}

export function validateXAIInferenceBaseURL(baseURL: string): string {
  const candidate = String(baseURL || DEFAULT_XAI_OAUTH_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_XAI_OAUTH_BASE_URL;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:') return DEFAULT_XAI_OAUTH_BASE_URL;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'x.ai' && !host.endsWith('.x.ai')) return DEFAULT_XAI_OAUTH_BASE_URL;
  return candidate;
}

export function validateXAIRedirectURI(url: string): string {
  const redirectURI = String(url || '').trim();
  if (!redirectURI) throw new Error('xAI OAuth redirect_uri is missing');
  const parsed = new URL(redirectURI);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error('xAI OAuth redirect_uri must use http://127.0.0.1');
  }
  if (!parsed.port) throw new Error('xAI OAuth redirect_uri must include a loopback port');
  return redirectURI;
}

function tokensFromState(state: XAIOAuthState): { access_token: string; refresh_token: string; token_type: string } {
  const accessToken = stringValue(state.tokens?.access_token);
  const refreshToken = stringValue(state.tokens?.refresh_token);
  if (!accessToken) throw new Error('xAI OAuth state is missing access_token');
  if (!refreshToken) throw new Error('xAI OAuth state is missing refresh_token');
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: stringValue(state.tokens?.token_type) || 'Bearer',
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function normalizeScopes(scopes: string[] | readonly string[] | undefined): string[] {
  const values = scopes?.length ? scopes : XAI_OAUTH_HERMES_SCOPES;
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

async function safeReadClipboard(readClipboard: NonNullable<LoginOptions['readClipboard']>): Promise<string> {
  try {
    return stringValue(await readClipboard());
  } catch {
    return '';
  }
}

function randomBase64URL(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function base64URLDigest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function loginResultFromState(state: XAIOAuthState): XAIOAuthLoginResult {
  const accessToken = tokensFromState(state).access_token;
  return {
    status: 'succeeded',
    provider: 'xai_oauth',
    base_url: validateXAIInferenceBaseURL(state.base_url || DEFAULT_XAI_OAUTH_BASE_URL),
    last_refresh: stringValue(state.last_refresh) || new Date().toISOString(),
    source: stringValue(state.source) || 'loopback_pkce',
    scope: stringValue(state.scope) || normalizeScopes(undefined).join(' '),
    expires_at: accessTokenExpiresAt(accessToken),
  };
}

function accessTokenExpiresAt(accessToken: string): string | undefined {
  if (!accessToken.includes('.')) return undefined;
  try {
    const [, payload] = accessToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = typeof decoded.exp === 'number' ? decoded.exp : NaN;
    return Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function oauthHTML(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHTML(title)}</title><body style="font:14px -apple-system,BlinkMacSystemFont,sans-serif;padding:32px;"><h1>${escapeHTML(title)}</h1><p>${body}</p></body>`;
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function closeServer(server: Server | undefined): void {
  if (server?.listening) {
    server.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
