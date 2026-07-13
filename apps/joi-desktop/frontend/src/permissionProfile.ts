import type { InputMode, PermissionProfile } from './api/desktop';

export function permissionProfileForPrompt(_inputMode: InputMode, _message: string): PermissionProfile {
  // Local Desktop is the owner-controlled surface. Runtime command execution still
  // applies the destructive-command blacklist and explicit confirmation gates.
  return 'danger_full_access';
}
