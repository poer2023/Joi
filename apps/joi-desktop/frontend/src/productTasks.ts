import type { ProductTask } from './api/desktop';

const ACTIVE_TASK_STATUSES = new Set(['planning', 'running', 'waiting_confirmation', 'paused', 'verifying', 'blocked']);
const EXTERNAL_HANDOFF_CHANNELS = new Set(['telegram', 'imessage']);

export function visibleRecentTasksForHandoff(tasks: ProductTask[], limit = 4): ProductTask[] {
  const candidates = [
    ...tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)),
    ...tasks.filter((task) => EXTERNAL_HANDOFF_CHANNELS.has(task.source_channel || '')),
  ];

  const seen = new Set<string>();
  const visible: ProductTask[] = [];
  for (const task of candidates) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    visible.push(task);
    if (visible.length >= limit) break;
  }

  return visible;
}
