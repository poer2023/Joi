import type {
  AvailableModel,
  ConnectionTest,
  ModelConnectionTestRequest,
  SettingsRecord,
} from '../../shared-types/src/desktop-api';
import {
  DEFAULT_XAI_OAUTH_BASE_URL,
  isXAIOAuthProvider,
  resolveXAIOAuthCredentials,
  type XAIOAuthSecretSaver,
  validateXAIInferenceBaseURL,
} from './xai-oauth.ts';

export type SecretResolver = (name: string) => Promise<string> | string;

export const LOCAL_MODEL_PROXY_API_KEY = 'joi-local-proxy';

export async function testModelConnection(
  req: ModelConnectionTestRequest | undefined,
  settings: SettingsRecord,
  resolveSecret: SecretResolver,
  saveSecret?: XAIOAuthSecretSaver,
): Promise<ConnectionTest> {
  const config = resolveModelConfig(req, settings);
  if (config.provider === 'mock_provider') {
    if (!mockProviderAllowed()) {
      return { ok: false, status: 'mock_disabled', error_summary: 'mock_provider is disabled by ALLOW_MOCK_PROVIDER' };
    }
    if (!config.modelName) {
      return { ok: false, status: 'missing_model_config', error_summary: 'mock model name is required' };
    }
    return { ok: true, status: 'succeeded' };
  }
  const apiKey = await resolveAPIKey(req, resolveSecret, config, saveSecret);
  if (!apiKey) {
    return { ok: false, status: 'missing_api_key', error_summary: 'MODEL_API_KEY is not configured' };
  }
  if (!config.baseURL || !config.modelName) {
    return { ok: false, status: 'missing_model_config', error_summary: 'model base URL and model name are required' };
  }
  try {
    await testOpenAICompatibleChat(config.baseURL, apiKey, config.modelName, config.timeoutSeconds);
    return { ok: true, status: 'succeeded' };
  } catch (error) {
    return { ok: false, status: 'failed', error_summary: errorMessage(error) };
  }
}

export async function fetchAvailableModels(
  req: ModelConnectionTestRequest | undefined,
  settings: SettingsRecord,
  resolveSecret: SecretResolver,
  saveSecret?: XAIOAuthSecretSaver,
): Promise<ConnectionTest> {
  const config = resolveModelConfig(req, settings);
  if (config.provider === 'mock_provider') {
    if (!mockProviderAllowed()) {
      return { ok: false, status: 'mock_disabled', error_summary: 'mock_provider is disabled by ALLOW_MOCK_PROVIDER' };
    }
    if (!config.modelName) {
      return { ok: false, status: 'missing_model_config', error_summary: 'mock model name is required' };
    }
    return {
      ok: true,
      status: 'succeeded',
      available_models: [mockAvailableModel(config.provider, config.baseURL, config.modelName)],
    };
  }
  const apiKey = await resolveAPIKey(req, resolveSecret, config, saveSecret);
  if (!apiKey) {
    return { ok: false, status: 'missing_api_key', error_summary: 'MODEL_API_KEY is not configured' };
  }
  if (!config.baseURL) {
    return { ok: false, status: 'missing_model_config', error_summary: 'model base URL is required' };
  }
  try {
    const models = await fetchOpenAICompatibleModels(config.baseURL, apiKey, config.timeoutSeconds);
    if (models.length === 0) {
      return { ok: false, status: 'empty_model_list', error_summary: 'provider returned no available models' };
    }
    return {
      ok: true,
      status: 'succeeded',
      available_models: models.map((model) => ({
        ...model,
        provider: config.provider,
        base_url: config.baseURL,
      })),
    };
  } catch (error) {
    return { ok: false, status: 'failed', error_summary: errorMessage(error) };
  }
}

export function openAICompatibleModelsEndpoint(baseURL: string): string {
  const endpoint = baseURL.trim().replace(/\/+$/, '');
  if (endpoint.endsWith('/chat/completions')) return `${endpoint.slice(0, -'/chat/completions'.length)}/models`;
  if (endpoint.endsWith('/models')) return endpoint;
  if (endpoint.endsWith('/v1')) return `${endpoint}/models`;
  return `${endpoint}/v1/models`;
}

export function openAICompatibleChatCompletionsEndpoint(baseURL: string): string {
  const endpoint = baseURL.trim().replace(/\/+$/, '');
  if (endpoint.endsWith('/chat/completions')) return endpoint;
  if (endpoint.endsWith('/models')) return `${endpoint.slice(0, -'/models'.length)}/chat/completions`;
  if (endpoint.endsWith('/v1')) return `${endpoint}/chat/completions`;
  return `${endpoint}/v1/chat/completions`;
}

export function isLoopbackModelEndpoint(baseURL: string): boolean {
  const endpoint = baseURL.trim();
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '0:0:0:0:0:0:0:1') return true;
    if (!/^127(?:\.\d{1,3}){3}$/.test(host)) return false;
    return host.split('.').every((part) => {
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  } catch {
    return false;
  }
}

export async function testOpenAICompatibleChat(baseURL: string, apiKey: string, modelName: string, timeoutSeconds: number): Promise<void> {
  const response = await fetchWithTimeout(openAICompatibleChatCompletionsEndpoint(baseURL), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    }),
  }, timeoutSeconds);
  const raw = await limitedText(response);
  if (!response.ok) {
    throw new Error(`chat completion returned ${response.status} ${response.statusText}: ${raw.trim()}`);
  }
}

export async function fetchOpenAICompatibleModels(baseURL: string, apiKey: string, timeoutSeconds: number): Promise<AvailableModel[]> {
  const response = await fetchWithTimeout(openAICompatibleModelsEndpoint(baseURL), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  }, timeoutSeconds);
  const raw = await limitedText(response);
  if (!response.ok) {
    throw new Error(`model list returned ${response.status} ${response.statusText}: ${raw.trim()}`);
  }
  return parseOpenAICompatibleModels(raw);
}

export function parseOpenAICompatibleModels(raw: string): AvailableModel[] {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const items = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const models: AvailableModel[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const object = item as Record<string, unknown>;
    const id = firstString(object, ['id', 'name', 'model']);
    if (!id) continue;
    const supportedParameters = stringArray(object.supported_parameters);
    const topProvider = objectRecord(object.top_provider);
    const pricing = objectRecord(object.pricing);
    const contextWindow = firstNumber(object, ['context_window', 'context_length', 'max_context_length', 'input_token_limit'])
      || firstNumber(topProvider, ['context_length', 'max_context_length']);
    const maxOutputTokens = firstNumber(object, ['max_output_tokens', 'output_token_limit'])
      || firstNumber(topProvider, ['max_completion_tokens', 'max_output_tokens']);
    const supportsJSONMode = booleanValue(object.supports_json_mode)
      || includesAny(supportedParameters, ['response_format', 'json_schema', 'structured_outputs']);
    const supportsToolCalling = booleanValue(object.supports_tool_calling)
      || includesAny(supportedParameters, ['tools', 'tool_choice', 'function_calling']);
    const supportsReasoning = booleanValue(object.supports_reasoning)
      || includesAny(supportedParameters, ['reasoning', 'reasoning_effort'])
      || id.toLowerCase().includes('reasoner');
    models.push({
      id,
      display_name: firstString(object, ['display_name', 'displayName', 'name']) || id,
      owner: firstString(object, ['owned_by', 'owner', 'organization']),
      object: firstString(object, ['object', 'type']),
      created: stringFromValue(object.created),
      context_window: contextWindow || undefined,
      max_output_tokens: maxOutputTokens || undefined,
      input_price_per_1m: firstPricePer1M(object, pricing, ['input_price_per_1m', 'prompt_price_per_1m', 'prompt']),
      output_price_per_1m: firstPricePer1M(object, pricing, ['output_price_per_1m', 'completion_price_per_1m', 'completion']),
      cached_input_price_per_1m: firstPricePer1M(object, pricing, ['cached_input_price_per_1m', 'cached_prompt_price_per_1m', 'cached_input', 'cache_read', 'cache_read_input']),
      supports_json_mode: supportsJSONMode,
      supports_tool_calling: supportsToolCalling,
      supports_reasoning: supportsReasoning,
      supported_parameters: supportedParameters,
      config: {
        enabled: true,
        temperature: 0.7,
        max_output_tokens: maxOutputTokens || undefined,
        timeout_seconds: 60,
        max_retries: 1,
        supports_json_mode: supportsJSONMode,
        supports_tool_calling: supportsToolCalling,
        supports_reasoning: supportsReasoning,
      },
      metadata: object,
    });
  }
  return models;
}

function resolveModelConfig(req: ModelConnectionTestRequest | undefined, settings: SettingsRecord) {
  const provider = req?.provider?.trim() || settings.model_provider || 'mock_provider';
  const baseURL = req?.base_url?.trim() || settings.model_base_url || '';
  return {
    provider,
    baseURL: isXAIOAuthProvider(provider) ? validateXAIInferenceBaseURL(baseURL || DEFAULT_XAI_OAUTH_BASE_URL) : baseURL,
    modelName: req?.name?.trim() || settings.model_name || '',
    timeoutSeconds: req?.timeout_seconds && req.timeout_seconds > 0 ? req.timeout_seconds : 30,
  };
}

async function resolveAPIKey(
  req: ModelConnectionTestRequest | undefined,
  resolveSecret: SecretResolver,
  config: ReturnType<typeof resolveModelConfig>,
  saveSecret?: XAIOAuthSecretSaver,
): Promise<string> {
  if (req?.api_key?.trim()) return req.api_key.trim();
  if (isLoopbackModelEndpoint(config.baseURL)) return LOCAL_MODEL_PROXY_API_KEY;
  if (isXAIOAuthProvider(config.provider)) {
    const creds = await resolveXAIOAuthCredentials(resolveSecret, saveSecret);
    return creds.apiKey;
  }
  const resolved = await resolveSecret('MODEL_API_KEY');
  return resolved.trim();
}

function mockProviderAllowed(): boolean {
  return process.env.ALLOW_MOCK_PROVIDER !== 'false';
}

function mockAvailableModel(provider: string, baseURL: string, modelName: string): AvailableModel {
  return {
    provider,
    base_url: baseURL,
    id: modelName,
    display_name: modelName,
    owner: 'mock_provider',
    object: 'model',
    supports_json_mode: true,
    supports_tool_calling: false,
    supports_reasoning: false,
    config: {
      enabled: true,
      temperature: 0.7,
      timeout_seconds: 60,
      max_retries: 1,
      supports_json_mode: true,
      supports_tool_calling: false,
      supports_reasoning: false,
    },
    metadata: { mock_provider: true },
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function limitedText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 1024 * 1024 ? text.slice(0, 1024 * 1024) : text;
}

function firstString(object: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstNumber(object: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = object[key];
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function firstPricePer1M(object: Record<string, unknown>, pricing: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = priceValue(object[key]);
    if (direct !== undefined) return direct;
    const priced = priceValue(pricing[key]);
    if (priced !== undefined) return priced;
  }
  return undefined;
}

function priceValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed < 1 ? parsed * 1_000_000 : parsed;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  return false;
}

function includesAny(values: string[], needles: string[]): boolean {
  return needles.some((needle) => values.some((value) => value.toLowerCase().includes(needle)));
}

function stringFromValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
