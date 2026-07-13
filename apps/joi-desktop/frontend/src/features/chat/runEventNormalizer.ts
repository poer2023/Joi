import type { NormalizedRunEvent, NormalizedStatus } from './types';

export function normalizeStatus(status: string): NormalizedStatus {
  switch (status.trim().toLowerCase()) {
    case 'succeeded':
    case 'success':
    case 'completed':
    case 'approved':
    case 'delivered':
    case 'responded':
    case 'closed':
      return 'completed';
    case 'authorized':
    case 'scheduled':
    case 'snoozed':
      return 'queued';
    case 'running':
    case 'in_progress':
      return 'running';
    case 'queued':
      return 'queued';
    case 'pending':
      return 'pending';
    case 'waiting_approval':
    case 'waiting_confirmation':
    case 'requires_confirmation':
      return 'waiting_approval';
    case 'failed':
    case 'error':
    case 'rejected':
    case 'denied':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'aborted':
      return 'cancelled';
    case 'redirected':
      return 'redirected';
    case 'blocked':
      return 'blocked';
    case 'skipped':
    case 'expired':
    case 'suppressed':
    case 'dismissed':
      return 'skipped';
    default:
      return 'running';
  }
}

export function normalizeRunEvent(raw: unknown): NormalizedRunEvent {
  const source = asObject(raw);
  const payload = { ...asObject(source.payload), ...asObject(source.payload_json) };
  const read = (...keys: string[]) => firstDefined(source, payload, keys);
  const type = stringValue(read('type', 'event_type', 'event'));
  const runId = stringValue(read('run_id', 'runID', 'runId'));
  const seq = numberValue(read('seq'));
  const delta = normalizeDelta(read('delta'), read('text'));
  const snapshot = normalizeSnapshot(read('snapshot'), payload, type);
  const metadata = asObject(read('metadata'));
  const itemType = stringValue(read('item_type', 'itemType')) || inferItemType(type, payload);
  const itemId = stringValue(read(
    'item_id',
    'itemID',
    'itemId',
    'assistant_message_id',
    'message_id',
    'call_id',
    'callID',
    'confirmation_id',
    'artifact_id',
    'task_id',
  )) || inferItemId(type, itemType, payload, source);
  const declaredStatus = stringValue(read('status'));
  const inferredStatus = statusFromEventType(type);
  const status = normalizeStatus(inferredStatus === 'running' ? (declaredStatus || inferredStatus) : inferredStatus);
  const createdAt = stringValue(read('created_at', 'createdAt', 'emitted_at')) || undefined;
  const id = stringValue(source.id) || eventIdentity({
    runId,
    seq,
    type,
    itemId,
    createdAt,
    delta,
    snapshot,
  });

  return {
    id,
    runId,
    seq,
    type,
    schemaVersion: numberValue(read('schema_version', 'schemaVersion')) || 1,
    itemId,
    itemType,
    status,
    parentItemId: stringValue(read('parent_item_id', 'parentItemID', 'parentItemId')) || undefined,
    visibility: stringValue(read('visibility')) || undefined,
    source: stringValue(read('source')) || undefined,
    terminal: booleanValue(read('terminal')),
    title: stringValue(read('title')) || undefined,
    summary: stringValue(read('summary', 'message')) || undefined,
    snapshot,
    delta,
    usage: asObject(read('usage', 'usage_json')),
    error: errorValue(read('error'), read('error_json')),
    metadata,
    createdAt,
    raw: source,
  };
}

export function normalizeRunEvents(rawEvents: unknown[]): NormalizedRunEvent[] {
  const normalized = rawEvents.map((event) => normalizeRunEvent(event));
  const hasAssistantV2 = new Set(
    normalized
      .filter((event) => event.type === 'assistant.delta' || event.type === 'assistant.completed')
      .map((event) => event.runId),
  );
  const expanded: NormalizedRunEvent[] = [];
  for (const event of normalized) {
    if (event.type !== 'message.delta') {
      expanded.push(event);
      continue;
    }
    if (hasAssistantV2.has(event.runId)) {
      expanded.push(event);
      continue;
    }
    const text = stringValue(event.delta.text) || stringValue(event.delta) || stringValue(event.snapshot.delta);
    if (!text) {
      expanded.push(event);
      continue;
    }
    const assistantBase = {
      ...event,
      itemType: 'assistant_message',
      itemId: event.itemId || `${event.runId}:assistant`,
      visibility: 'chat',
      source: event.source || 'legacy',
      delta: { text, stream_source: 'legacy_message_delta' },
    };
    expanded.push({
      ...assistantBase,
      id: `${event.id}:assistant-delta`,
      type: 'assistant.delta',
      status: event.status === 'waiting_approval' ? 'waiting_approval' : 'completed',
    });
    expanded.push({
      ...assistantBase,
      id: `${event.id}:assistant-completed`,
      seq: event.seq + 0.001,
      type: 'assistant.completed',
      status: event.status === 'waiting_approval' ? 'waiting_approval' : 'completed',
      terminal: event.status !== 'waiting_approval',
    });
  }
  return expanded;
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeDelta(deltaRaw: unknown, textRaw: unknown): Record<string, unknown> {
  const delta = asObject(deltaRaw);
  if (typeof deltaRaw === 'string' && deltaRaw) {
    delta.text = deltaRaw;
  }
  if (typeof textRaw === 'string' && textRaw && delta.text === undefined) {
    delta.text = textRaw;
  }
  return delta;
}

function normalizeSnapshot(snapshotRaw: unknown, payload: Record<string, unknown>, type: string): Record<string, unknown> {
  const snapshot = asObject(snapshotRaw);
  if (Object.keys(snapshot).length > 0) {
    return snapshot;
  }
  if (type === 'assistant.delta') {
    return {};
  }
  return { ...payload };
}

function firstDefined(
  source: Record<string, unknown>,
  payload: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
    if (payload[key] !== undefined && payload[key] !== null) return payload[key];
  }
  return undefined;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

function errorValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = stringValue(value);
    if (direct) return direct;
    const object = asObject(value);
    const message = stringValue(object.message || object.error);
    if (message) return message;
  }
  return undefined;
}

function inferItemType(type: string, payload: Record<string, unknown>): string {
  const lower = type.toLowerCase();
  if (lower.startsWith('assistant.')) return 'assistant_message';
  if (lower.startsWith('tool.') || lower.startsWith('tool_')) return 'tool';
  if (lower.startsWith('approval.')) return 'approval';
  if (lower.startsWith('artifact.')) return 'artifact';
  if (lower.startsWith('worker.')) return 'worker';
  if (lower.startsWith('task.')) return 'task';
  if (lower.startsWith('open_loop.')) return 'open_loop';
  if (lower.startsWith('proactive.')) return 'proactive';
  if (lower.startsWith('handoff.') || lower.startsWith('notification.')) return 'handoff';
  if (lower === 'run.mode_resolved') return 'mode_resolution';
  if (lower.startsWith('reflection.') || stringValue(payload.item_type) === 'reflection') return 'reflection';
  if (lower.startsWith('policy.')) return 'policy';
  if (lower.startsWith('workflow.')) return 'workflow';
  if (lower.startsWith('model.')) return 'model';
  if (lower.startsWith('run.') || lower.startsWith('foreground_run.')) return 'run';
  if (stringValue(payload.capability)) return 'capability';
  return stringValue(payload.item_type || payload.itemType);
}

function inferItemId(
  type: string,
  itemType: string,
  payload: Record<string, unknown>,
  source: Record<string, unknown>,
): string {
  if (itemType === 'run') return stringValue(payload.run_id || source.run_id || source.runID);
  if (itemType === 'tool') return stringValue(payload.call_id || payload.tool_run_id || payload.tool_name || payload.capability);
  if (itemType === 'approval') return stringValue(payload.confirmation_id || payload.call_id);
  if (itemType === 'artifact') return stringValue(payload.artifact_id || payload.id);
  if (itemType === 'task' || itemType === 'worker') return stringValue(payload.task_id || payload.worker_task_id || payload.id);
  if (itemType === 'memory') return stringValue(payload.memory_id || payload.item_id || payload.id);
  if (itemType === 'open_loop') return stringValue(payload.open_loop_id || payload.item_id || payload.id);
  if (itemType === 'proactive') return stringValue(payload.proactive_message_id || payload.item_id || payload.id);
  if (itemType === 'handoff') return stringValue(payload.notification_id || payload.channel_identity_id || payload.item_id || payload.id);
  if (itemType === 'mode_resolution') return stringValue(payload.mode_resolution_id || payload.item_id || payload.id);
  return `${itemType || 'event'}:${type}`;
}

function statusFromEventType(type: string): string {
  const semanticType = type.replace(/_/g, '.');
  if (type === 'run.cancel_requested') return 'running';
  if (semanticType.endsWith('.failed')) return 'failed';
  if (semanticType.endsWith('.denied') || semanticType.endsWith('.rejected')) return 'rejected';
  if (semanticType.endsWith('.cancelled') || semanticType.endsWith('.canceled')) return 'cancelled';
  if (type === 'run.redirected' || type.endsWith('.redirected')) return 'redirected';
  if (type === 'run.recovery_required') return 'waiting_approval';
  if (semanticType.endsWith('.expired') || semanticType.endsWith('.suppressed') || semanticType.endsWith('.dismissed')) return 'skipped';
  if (semanticType.endsWith('.authorized') || semanticType.endsWith('.scheduled') || semanticType.endsWith('.snoozed')) return 'queued';
  if (semanticType.endsWith('.delivered') || semanticType.endsWith('.responded') || semanticType.endsWith('.closed')) return 'completed';
  if (semanticType.endsWith('.completed') || semanticType.endsWith('.finished') || type === 'run.completed') return 'completed';
  if (semanticType.endsWith('.skipped')) return 'skipped';
  if (semanticType.endsWith('.queued')) return 'queued';
  if (semanticType.endsWith('.required') || semanticType.endsWith('.requested') || type.includes('waiting_confirmation')) return 'waiting_approval';
  return 'running';
}

function eventIdentity(input: {
  runId: string;
  seq: number;
  type: string;
  itemId: string;
  createdAt?: string;
  delta: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}): string {
  const basis = input.createdAt
    || stringValue(input.delta.text)
    || stringValue(input.snapshot.status)
    || JSON.stringify(input.snapshot).slice(0, 80);
  return [
    input.runId || 'run',
    input.seq || 'live',
    input.type || 'event',
    input.itemId || 'item',
    basis || 'payload',
  ].join(':');
}
