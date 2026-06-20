export const XAI_OAUTH_SECRET_NAME = 'XAI_OAUTH_STATE';
export const DEFAULT_XAI_OAUTH_BASE_URL = 'https://api.x.ai/v1';
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
export const XAI_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 3600;

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

export function isXAIOAuthProvider(provider: string | undefined): boolean {
  return ['xai_oauth', 'xai-oauth', 'xai'].includes((provider || '').trim().toLowerCase());
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
  };
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
    return validateXAIOAuthEndpoint(stringValue(payload.token_endpoint), 'token_endpoint');
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
