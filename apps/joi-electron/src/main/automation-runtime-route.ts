import type { AvailableModel, ChatRequest, PermissionProfile, SettingsRecord } from '../../../../packages/shared-types/src/desktop-api';
import type { ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp';

export type AutomationModelRuntimeRoute = {
  acpProvider?: ACPProviderRuntimeConfig;
  apiKey: string;
  ready: boolean;
  model_selection_policy: 'settings_preferred';
};

export function resolveAutomationModelSettings(input: {
  settings: SettingsRecord;
  request: ChatRequest;
  availableModels: AvailableModel[];
}): SettingsRecord {
  const requestedModel = input.request.model_name?.trim() || input.settings.model_name.trim();
  const requestedProvider = input.request.model_provider?.trim() || '';
  const requestedBaseURL = input.request.model_base_url?.trim() || '';
  const reasoningEffort = input.request.reasoning_effort?.trim() || input.settings.model_reasoning_effort;
  if (!requestedModel) {
    return { ...input.settings, model_reasoning_effort: reasoningEffort };
  }

  const candidates = input.availableModels.filter((model) => model.id.trim() === requestedModel);
  const routeCandidates = requestedProvider || requestedBaseURL
    ? candidates.filter((model) => modelMatchesRoute(model, requestedProvider, requestedBaseURL))
    : candidates;
  const explicitCandidate = requestedProvider || requestedBaseURL ? routeCandidates[0] : undefined;
  const currentSettingsMatch = requestedModel === input.settings.model_name
    && (!requestedProvider || requestedProvider === input.settings.model_provider)
    && (!requestedBaseURL || normalizeBaseURL(requestedBaseURL) === normalizeBaseURL(input.settings.model_base_url));
  const inferredCandidate = currentSettingsMatch
    ? undefined
    : [...routeCandidates].sort((left, right) => modelRouteScore(right) - modelRouteScore(left))[0];
  const selected = explicitCandidate || inferredCandidate;

  return {
    ...input.settings,
    model_provider: requestedProvider || selected?.provider?.trim() || input.settings.model_provider,
    model_name: requestedModel,
    model_base_url: requestedBaseURL || selected?.base_url?.trim() || (currentSettingsMatch ? input.settings.model_base_url : ''),
    model_reasoning_effort: reasoningEffort,
    model_timeout_seconds: selected?.config?.timeout_seconds || input.settings.model_timeout_seconds,
    model_max_retries: selected?.config?.max_retries ?? input.settings.model_max_retries,
  };
}

function modelMatchesRoute(model: AvailableModel, provider: string, baseURL: string): boolean {
  if (provider && model.provider?.trim() !== provider) return false;
  if (baseURL && normalizeBaseURL(model.base_url || '') !== normalizeBaseURL(baseURL)) return false;
  return Boolean(provider || baseURL);
}

function modelRouteScore(model: AvailableModel): number {
  const metadata = model.metadata || {};
  let score = 0;
  if (metadata.source === 'desktop_runtime_config') score += 120;
  if (metadata.source === 'provider_model_list') score += 100;
  if (model.base_url?.trim()) score += 50;
  if (model.supports_tool_calling) score += 10;
  if (metadata.observed_from_request) score -= 200;
  return score;
}

function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function resolveAutomationModelRuntimeRoute(input: {
  settings: SettingsRecord;
  request: ChatRequest;
  localProxyAPIKey: string;
  resolveACPProvider: (providerID: string, permissionProfile: PermissionProfile) => ACPProviderRuntimeConfig | undefined;
  resolveAPIKey: () => Promise<string>;
  canRun: (settings: SettingsRecord, apiKey: string, request: ChatRequest, acpProviderConfigured: boolean) => boolean;
}): Promise<AutomationModelRuntimeRoute> {
  const permissionProfile = input.request.permission_profile || 'read_only';
  const acpProvider = input.resolveACPProvider(input.settings.model_provider || '', permissionProfile);
  const apiKey = acpProvider ? input.localProxyAPIKey : await input.resolveAPIKey();
  return {
    acpProvider,
    apiKey,
    ready: input.canRun(input.settings, apiKey, input.request, Boolean(acpProvider)),
    // Automations execute with the current model settings. Their persisted
    // conversation may still select an agent/persona, but an old persona
    // model_strategy must not replace the configured automation model.
    model_selection_policy: 'settings_preferred',
  };
}
