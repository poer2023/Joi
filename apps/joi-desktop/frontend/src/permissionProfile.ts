import type { InputMode, PermissionProfile } from './api/desktop';

const workspaceWriteIntentPatterns = [
  /\b(apply\s*patch|patch|edit|modify|update|upgrade|fix|implement|refactor|add|remove|delete|write code|add test|unit test)\b/i,
  /(实现|修改|修复|更新|升级|重构|新增|添加|删除|移除|清理|补齐|补足|改代码|写测试|加测试|提交)/u,
];

export function permissionProfileForPrompt(inputMode: InputMode, message: string): PermissionProfile {
  if (inputMode === 'serious_task' || inputMode === 'background_task') return 'workspace_write';
  if (inputMode === 'chat_assist') return 'read_only';
  const normalized = message.trim();
  if (!normalized) return 'read_only';
  return workspaceWriteIntentPatterns.some((pattern) => pattern.test(normalized)) ? 'workspace_write' : 'read_only';
}
