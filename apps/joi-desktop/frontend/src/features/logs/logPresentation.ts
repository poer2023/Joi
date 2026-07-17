import type { LogEntry } from '../../api/desktop';

const failureLevels = new Set(['error', 'fatal']);
const failureStatuses = new Set(['failed', 'error', 'fatal', 'blocked', 'denied']);

export function hasNonEmptyLogError(log: Pick<LogEntry, 'error'>): boolean {
  return Boolean(log.error && Object.keys(log.error).length > 0);
}

export function isLogFailure(log: Pick<LogEntry, 'error' | 'level' | 'status'>): boolean {
  const level = String(log.level || '').trim().toLowerCase();
  const status = String(log.status || '').trim().toLowerCase();
  return hasNonEmptyLogError(log) || failureLevels.has(level) || failureStatuses.has(status);
}
