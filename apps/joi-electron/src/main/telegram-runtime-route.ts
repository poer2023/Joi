import type { ChatRequest, PermissionProfile, SettingsRecord } from '../../../../packages/shared-types/src/desktop-api';
import type { ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp';

export const telegramOwnerPermissionProfile: PermissionProfile = 'danger_full_access';

export type TelegramModelRuntimeRoute = {
  acpProvider?: ACPProviderRuntimeConfig;
  apiKey: string;
  ready: boolean;
  model_selection_policy: 'settings_preferred';
};

export async function resolveTelegramModelRuntimeRoute(input: {
  settings: SettingsRecord;
  request: ChatRequest;
  localProxyAPIKey: string;
  resolveACPProvider: (providerID: string, permissionProfile: PermissionProfile) => ACPProviderRuntimeConfig | undefined;
  resolveAPIKey: () => Promise<string>;
  canRun: (settings: SettingsRecord, apiKey: string, request: ChatRequest, acpProviderConfigured: boolean) => boolean;
}): Promise<TelegramModelRuntimeRoute> {
  const permissionProfile = input.request.permission_profile || telegramOwnerPermissionProfile;
  const acpProvider = input.resolveACPProvider(input.settings.model_provider || '', permissionProfile);
  const apiKey = acpProvider ? input.localProxyAPIKey : await input.resolveAPIKey();
  return {
    acpProvider,
    apiKey,
    ready: input.canRun(input.settings, apiKey, input.request, Boolean(acpProvider)),
    // Telegram uses the current model settings for every inbound message.
    // Conversation/room routing may still select a persona, but an old
    // persona model_strategy must not silently replace the channel model.
    model_selection_policy: 'settings_preferred',
  };
}
