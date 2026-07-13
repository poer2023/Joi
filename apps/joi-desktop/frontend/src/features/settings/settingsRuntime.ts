import type { WorkspaceSettings } from '../../api/desktop';

export type SettingsExecutionRouting = {
  preferredNode: string;
  allowWorker: boolean;
  reason: string;
};

export function executionRoutingForSettings(settings: WorkspaceSettings | null): SettingsExecutionRouting {
  if (!settings || settings.privacy_local_only !== false) {
    return { preferredNode: 'main-node', allowWorker: false, reason: 'privacy_local_only' };
  }
  if (!settings.allow_remote_execution) {
    return { preferredNode: 'main-node', allowWorker: false, reason: 'remote_execution_disabled' };
  }
  if (settings.node_assignment_policy !== 'auto') {
    return {
      preferredNode: 'main-node',
      allowWorker: false,
      reason: settings.node_assignment_policy === 'manual' ? 'manual_assignment_only' : 'main_first',
    };
  }
  if (settings.remote_execution_requires_confirmation !== false) {
    return { preferredNode: 'main-node', allowWorker: false, reason: 'remote_confirmation_required' };
  }
  return { preferredNode: 'auto', allowWorker: true, reason: 'auto_worker_allowed' };
}
