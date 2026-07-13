import type { ChatRequest, PermissionProfile, SettingsRecord } from '../../../../packages/shared-types/src/desktop-api';
import type { ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp';

export type AutomationModelRuntimeRoute = {
  acpProvider?: ACPProviderRuntimeConfig;
  apiKey: string;
  ready: boolean;
  model_selection_policy: 'settings_preferred';
};

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
