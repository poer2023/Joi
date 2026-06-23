import { getEventVisibility } from './eventVisibility';
import { detailForExecutionEvent, summarizeExecutionEvent } from './executionSummary';
import type {
  BuildConversationRenderItemsInput,
  BuildConversationRenderItemsOutput,
  ChatMessageRenderItem,
  ConversationMessage,
  ConversationRenderItem,
  NormalizedRunEvent,
  NormalizedStatus,
  TranscriptLineKind,
  TranscriptLineRenderItem,
} from './types';

export function buildConversationRenderItems(
  input: BuildConversationRenderItemsInput,
): BuildConversationRenderItemsOutput {
  const items: ConversationRenderItem[] = [];
  const traceOnlyEventsByRunId: Record<string, NormalizedRunEvent[]> = {};
  const activeRunStatusByRunId: Record<string, NormalizedStatus> = {};
  const messages = dedupeMessages(input.messages);
  const projectedRunIds = new Set<string>();

  for (const message of messages) {
    const projectedMessage = projectMessage(message, false);
    if (!projectedMessage) continue;
    if (message.role !== 'assistant') {
      items.push(projectedMessage);
      continue;
    }
    const runId = getMessageRunId(message);
    if (!runId) {
      items.push(projectedMessage);
      continue;
    }
    const projected = projectRunEventsForAssistantMessage({
      runId,
      assistantMessageId: message.id,
      events: input.runEventsByRunId[runId] || [],
      mode: input.mode,
      debug: input.debug,
    });
    items.push(...projected.itemsBeforeAssistant);
    items.push(projectedMessage);
    items.push(...projected.itemsAfterAssistant);
    traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
    activeRunStatusByRunId[runId] = projected.status;
    projectedRunIds.add(runId);
  }

  if (input.pendingUserMessage && !messages.some((message) => message.id === input.pendingUserMessage?.id)) {
    const projected = projectMessage(input.pendingUserMessage, true);
    if (projected) items.push(projected);
  }

  if (input.streamingAssistant && !hasPersistedAssistant(messages, input.streamingAssistant)) {
    const streamingMessage: ChatMessageRenderItem = {
      type: 'message',
      id: input.streamingAssistant.id,
      role: 'assistant',
      content: messageContentValue(input.streamingAssistant.content),
      runId: input.streamingAssistant.run_id,
      streaming: !input.streamingAssistant.complete,
      createdAt: input.streamingAssistant.created_at,
    };

    const runId = input.streamingAssistant.run_id || input.activeRunId;
    if (runId) {
      const projected = projectRunEventsForAssistantMessage({
        runId,
        assistantMessageId: input.streamingAssistant.id,
        events: input.runEventsByRunId[runId] || [],
        mode: input.mode,
        debug: input.debug,
      });
      items.push(...projected.itemsBeforeAssistant);
      items.push(streamingMessage);
      items.push(...projected.itemsAfterAssistant);
      traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
      activeRunStatusByRunId[runId] = projected.status;
      projectedRunIds.add(runId);
    } else {
      items.push(streamingMessage);
    }
  }

  const streamingRunId = input.streamingAssistant ? getMessageRunId(input.streamingAssistant) : undefined;
  for (const runId of orderedRunIds(input)) {
    if (projectedRunIds.has(runId) || hasAssistantForRun(messages, runId) || streamingRunId === runId) {
      continue;
    }
    const runEvents = input.runEventsByRunId[runId] || [];
    const assistantMessage = projectAssistantMessageFromRunEvents(runId, runEvents);
    const projected = projectRunEventsForAssistantMessage({
      runId,
      assistantMessageId: assistantMessage?.id || `${runId}:transcript-anchor`,
      events: runEvents,
      mode: input.mode,
      debug: input.debug,
    });
    if (!assistantMessage && projected.items.length === 0) {
      traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
      activeRunStatusByRunId[runId] = projected.status;
      projectedRunIds.add(runId);
      continue;
    }
    if (!assistantMessage) {
      items.push(...projected.items);
      traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
      activeRunStatusByRunId[runId] = projected.status;
      projectedRunIds.add(runId);
      continue;
    }
    items.push(...projected.itemsBeforeAssistant);
    items.push(assistantMessage);
    items.push(...projected.itemsAfterAssistant);
    traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
    activeRunStatusByRunId[runId] = projected.status;
    projectedRunIds.add(runId);
  }

  if (input.activeRunId && !activeRunStatusByRunId[input.activeRunId]) {
    activeRunStatusByRunId[input.activeRunId] = deriveRunStatus(input.runEventsByRunId[input.activeRunId] || []);
  }

  return { items, traceOnlyEventsByRunId, activeRunStatusByRunId };
}

export function projectRunEventsForAssistantMessage(input: {
  runId: string;
  assistantMessageId: string;
  events: NormalizedRunEvent[];
  mode: BuildConversationRenderItemsInput['mode'];
  debug?: boolean;
}): {
  items: ConversationRenderItem[];
  itemsBeforeAssistant: ConversationRenderItem[];
  itemsAfterAssistant: ConversationRenderItem[];
  traceOnlyEvents: NormalizedRunEvent[];
  status: NormalizedStatus;
} {
  const visibleEvents: NormalizedRunEvent[] = [];
  const traceOnlyEvents: NormalizedRunEvent[] = [];

  for (const event of sortBySeq(input.events)) {
    const visibility = input.debug ? 'transcript' : getEventVisibility(event, input.mode);
    if (visibility === 'trace_only') {
      traceOnlyEvents.push(event);
      continue;
    }
    if (visibility === 'hidden' || visibility === 'chat') {
      continue;
    }
    visibleEvents.push(event);
  }

  const groupedItems = aggregateVisibleEventGroups({
      runId: input.runId,
      assistantMessageId: input.assistantMessageId,
      events: visibleEvents,
      mode: input.mode,
    });
  const leadingItems = groupedItems
    .filter((item) => isLeadingAssistantProcessItem(item.item))
    .map((item) => item.item);
  const processItems = groupedItems
    .filter((item) => !isLeadingAssistantProcessItem(item.item))
    .map((item) => item.item);
  const items = [...leadingItems, ...processItems];

  return {
    items,
    itemsBeforeAssistant: leadingItems,
    itemsAfterAssistant: processItems,
    traceOnlyEvents,
    status: deriveRunStatus(input.events),
  };
}

export function getMessageRunId(message: ConversationMessage): string | undefined {
  const runId = message.run_id || stringValue(message.metadata?.run_id);
  return runId || undefined;
}

export function deriveRunStatus(events: NormalizedRunEvent[]): NormalizedStatus {
  const sorted = sortBySeq(events);
  if (sorted.some((event) => event.status === 'cancelled' || event.type === 'run.cancelled')) return 'cancelled';
  if (sorted.some((event) => event.status === 'failed' || event.type.endsWith('.failed'))) return 'failed';
  if (sorted.some((event) => event.status === 'redirected' || event.type === 'run.redirected')) return 'redirected';
  const latest = sorted[sorted.length - 1];
  if (latest?.status === 'waiting_approval' || sorted.some((event) => event.type === 'approval.required' && event.status === 'waiting_approval')) {
    return 'waiting_approval';
  }
  if (sorted.some((event) => (
    event.type === 'run.finalized'
    || event.type === 'foreground_run.completed'
    || event.type === 'assistant.completed'
    || event.type === 'run.completed'
  ))) {
    return 'completed';
  }
  if (sorted.some((event) => event.status === 'running' || event.status === 'queued')) return 'running';
  return 'pending';
}

export function sortBySeq(events: NormalizedRunEvent[]): NormalizedRunEvent[] {
  return [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function aggregateVisibleEvents(input: {
  runId: string;
  assistantMessageId: string;
  events: NormalizedRunEvent[];
  mode: BuildConversationRenderItemsInput['mode'];
}): ConversationRenderItem[] {
  return aggregateVisibleEventGroups(input).map((item) => item.item);
}

function aggregateVisibleEventGroups(input: {
  runId: string;
  assistantMessageId: string;
  events: NormalizedRunEvent[];
  mode: BuildConversationRenderItemsInput['mode'];
}): Array<{ item: ConversationRenderItem; seq: number }> {
  const groups = [...groupEventsByItem(input.events).entries()]
    .map(([id, events]) => {
      const sorted = sortBySeq(events);
      return { id, events: sorted, latest: sorted[sorted.length - 1] };
    })
    .filter((group): group is { id: string; events: NormalizedRunEvent[]; latest: NormalizedRunEvent } => Boolean(group.latest));
  const items: Array<{ item: ConversationRenderItem; seq: number }> = [];

  for (const group of groups) {
    const visibility = getEventVisibility(group.latest, input.mode);
    if (visibility === 'trace_only' || visibility === 'hidden' || visibility === 'chat') continue;
    if (!shouldShowTranscriptGroup(group.latest, group.events)) continue;
    items.push({
      item: projectTranscriptLine(input.runId, group.latest, group.events),
      seq: group.events[0]?.seq ?? group.latest.seq,
    });
  }

  return items.sort((a, b) => a.seq - b.seq);
}

function isLeadingAssistantProcessItem(item: ConversationRenderItem): boolean {
  return item.type === 'transcript_line' && (item.kind === 'thinking' || item.kind === 'tool');
}

function groupEventsByItem(events: NormalizedRunEvent[]): Map<string, NormalizedRunEvent[]> {
  const grouped = new Map<string, NormalizedRunEvent[]>();
  for (const event of sortBySeq(events)) {
    const key = groupKeyForEvent(event);
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  return grouped;
}

function groupKeyForEvent(event: NormalizedRunEvent): string {
  if (isModelProgressEvent(event)) {
    return `${event.itemType || 'model'}:${event.itemId || event.runId || 'model'}:step:${modelStepValue(event) || '0'}`;
  }
  if (event.itemType === 'run') {
    return `${event.itemType}:${event.type}:${event.itemId || event.seq}`;
  }
  return event.itemId || `${event.itemType}:${event.title || event.type || event.seq}`;
}

function projectMessage(message: ConversationMessage, streaming: boolean): ChatMessageRenderItem | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  return {
    type: 'message',
    id: message.id,
    role: message.role,
    content: messageContentValue(message.content),
    runId: getMessageRunId(message),
    streaming,
    createdAt: message.created_at,
  };
}

function projectTranscriptLine(
  runId: string,
  event: NormalizedRunEvent,
  events: NormalizedRunEvent[],
): TranscriptLineRenderItem {
  const started = events.find((item) => item.status === 'running' || item.type.endsWith('.started'));
  const completed = [...events].reverse().find((item) => item.status === 'completed' || item.type.endsWith('.completed') || item.type.endsWith('.finished'));
  const kind = transcriptKind(event);
  const status = transcriptStatus(event.status);
  return {
    type: 'transcript_line',
    id: `${runId}:${transcriptIdentity(event)}:transcript`,
    runId,
    status,
    kind,
    label: transcriptLabel(event, kind, status),
    detail: transcriptDetail(event, kind),
    traceAvailable: status === 'failed' || status === 'waiting_approval',
    startedAt: started?.createdAt,
    completedAt: completed?.createdAt,
  };
}

function transcriptKind(event: NormalizedRunEvent): TranscriptLineKind {
  if (isModelProgressEvent(event)) return 'thinking';
  if (event.type.startsWith('tool.') || event.itemType === 'tool' || event.itemType === 'capability' || event.itemType === 'node') return 'tool';
  if (event.type.startsWith('approval.') || event.itemType === 'approval') return 'approval';
  if (event.type.startsWith('artifact.') || event.itemType === 'artifact') return 'artifact';
  if (event.type.startsWith('task.') || event.type.startsWith('worker.') || event.itemType === 'task' || event.itemType === 'worker') return 'task';
  if (event.type.startsWith('run.')) return 'run';
  return 'system';
}

function shouldShowTranscriptGroup(event: NormalizedRunEvent, events: NormalizedRunEvent[]): boolean {
  return true;
}

function isRecoverableInternalToolFailure(event: NormalizedRunEvent, events: NormalizedRunEvent[]): boolean {
  if (event.status !== 'failed' && event.status !== 'blocked') return false;
  const toolName = toolNameFromEvent(event).toLowerCase();
  if (toolName === 'browser_navigate' || toolName.includes('browser navigate')) return true;
  const error = `${event.error || ''} ${stringFromEvent(event, ['error', 'summary'])}`.toLowerCase();
  if (error.includes('policy_denied') && (toolName.includes('browser') || toolName.includes('navigate'))) return true;
  return events.some((item) => item.type === 'tool.completed' && item.status === 'completed');
}

function transcriptLabel(
  event: NormalizedRunEvent,
  kind: TranscriptLineKind,
  status: TranscriptLineRenderItem['status'],
): string {
  if (kind === 'tool') {
    return toolTranscriptLabel(event, status);
  }
  if (kind === 'thinking') {
    if (status === 'failed') return 'Thinking failed';
    return 'Thinking';
  }
  if (kind === 'approval') {
    return `Needs confirmation · ${compactText(event.title || stringFromEvent(event, ['requested_action', 'action', 'capability']) || 'action')}`;
  }
  if (kind === 'artifact') {
    return `Generated artifact · ${compactText(event.title || stringFromEvent(event, ['title', 'artifact_type', 'type']) || 'artifact')}`;
  }
  if (kind === 'task') {
    const target = compactText(event.title || stringFromEvent(event, ['title', 'task_title', 'task_id']) || 'task');
    if (status === 'running' || status === 'pending') return `Running task · ${target}`;
    if (status === 'failed') return `Task failed · ${target}`;
    return `Task updated · ${target}`;
  }
  return compactText(summarizeExecutionEvent(event));
}

function transcriptDetail(event: NormalizedRunEvent, kind: TranscriptLineKind): string | undefined {
  if (kind === 'thinking') return undefined;
  const detail = event.summary || detailForExecutionEvent(event);
  if (!detail) return undefined;
  if (kind === 'tool' && transcriptLabel(event, kind, transcriptStatus(event.status)).includes(detail)) return undefined;
  return compactText(detail, 180);
}

function transcriptIdentity(event: NormalizedRunEvent): string {
  if (isModelProgressEvent(event)) {
    return `${event.itemId || event.runId || 'model'}:step:${modelStepValue(event) || '0'}`;
  }
  return event.itemId || event.id;
}

function transcriptStatus(status: NormalizedStatus): TranscriptLineRenderItem['status'] {
  if (status === 'failed' || status === 'blocked' || status === 'cancelled' || status === 'redirected') return 'failed';
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'completed' || status === 'skipped') return 'completed';
  if (status === 'running' || status === 'queued') return 'running';
  return 'pending';
}

function toolTranscriptLabel(event: NormalizedRunEvent, status: TranscriptLineRenderItem['status']): string {
  const toolName = toolNameFromEvent(event);
  const lower = toolName.toLowerCase();
  const verb = status === 'running' || status === 'pending'
    ? 'Running'
    : status === 'failed'
      ? 'Failed'
      : status === 'waiting_approval'
        ? 'Needs confirmation'
        : 'Ran';
  if (event.terminal || lower.includes('terminal') || lower.includes('shell') || lower.includes('command') || lower.includes('exec') || lower.includes('bash')) {
    return `${verb} · ${compactText(stringFromEvent(event, ['command', 'cmd', 'shell_command', 'script']) || 'command')}`;
  }
  if (lower.includes('web') || lower.includes('browser') || lower.includes('url')) {
    const url = stringFromEvent(event, ['final_url', 'url', 'source_url', 'href']) || detailForExecutionEvent(event) || '';
    const target = compactText(hostLabel(url) || url || humanizeToolName(toolName));
    const action = status === 'running' || status === 'pending' ? 'Reading' : status === 'completed' ? 'Read' : verb;
    return `${action} · ${target}`;
  }
  if (lower.includes('workspace') || lower.includes('search') || lower.includes('grep') || lower.includes('rg')) {
    return `${status === 'completed' ? 'Searched' : 'Searching'} · ${compactText(stringFromEvent(event, ['query', 'q', 'pattern', 'search']) || humanizeToolName(toolName))}`;
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('path')) {
    return `${status === 'completed' ? 'Read file' : 'Reading file'} · ${compactText(stringFromEvent(event, ['path', 'file', 'filename', 'target_path']) || humanizeToolName(toolName))}`;
  }
  return `${verb} · ${compactText(humanizeToolName(toolName))}`;
}

function toolNameFromEvent(event: NormalizedRunEvent): string {
  const payload = eventPayload(event);
  return (
    stringValue(event.snapshot.tool_name)
    || stringValue(event.snapshot.name)
    || stringValue(event.snapshot.capability)
    || stringValue(event.snapshot.workflow_name)
    || stringValue(event.delta.tool_name)
    || stringValue(event.delta.name)
    || stringValue(event.delta.capability)
    || stringValue(payload.tool_name)
    || stringValue(payload.name)
    || stringValue(payload.capability)
    || event.title
    || 'tool'
  );
}

function humanizeToolName(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim() || 'tool';
}

function stringFromEvent(event: NormalizedRunEvent, keys: string[]): string {
  const payload = eventPayload(event);
  const sources = [
    event.snapshot,
    event.delta,
    event.metadata,
    payload,
    objectValue(payload.snapshot),
    objectValue(payload.delta),
    objectValue(event.snapshot.input),
    objectValue(event.delta.input),
    objectValue(payload.input),
    objectValue(objectValue(payload.snapshot).input),
    objectValue(event.snapshot.arguments),
    objectValue(event.delta.arguments),
    objectValue(payload.arguments),
    objectValue(event.snapshot.args),
    objectValue(event.delta.args),
  ];
  for (const source of sources) {
    for (const key of keys) {
      const value = stringValue(source[key]);
      if (value) return value;
    }
  }
  return '';
}

function isModelProgressEvent(event: NormalizedRunEvent): boolean {
  return event.type.toLowerCase().startsWith('model.');
}

function modelStepValue(event: NormalizedRunEvent): string {
  return stringFromEvent(event, ['step', 'model_step', 'modelStep', 'index']);
}

function eventPayload(event: NormalizedRunEvent): Record<string, unknown> {
  return firstObject(
    objectValue(event.raw.payload_json),
    objectValue(event.raw.payload),
    objectValue(event.raw.payloadJson),
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function firstObject(...values: Array<Record<string, unknown>>): Record<string, unknown> {
  return values.find((value) => Object.keys(value).length > 0) || {};
}

function hostLabel(value: string): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function compactText(value: string, max = 120): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function dedupeMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const seen = new Set<string>();
  const result: ConversationMessage[] = [];
  for (const message of messages) {
    const runId = getMessageRunId(message);
    const key = message.role === 'assistant' && runId ? `assistant:${runId}` : message.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result;
}

function hasPersistedAssistant(messages: ConversationMessage[], streaming: ConversationMessage): boolean {
  const streamingRunId = getMessageRunId(streaming);
  return messages.some((message) => (
    message.role === 'assistant'
    && (message.id === streaming.id || (streamingRunId && getMessageRunId(message) === streamingRunId))
  ));
}

function hasAssistantForRun(messages: ConversationMessage[], runId: string): boolean {
  return messages.some((message) => message.role === 'assistant' && getMessageRunId(message) === runId);
}

function orderedRunIds(input: BuildConversationRenderItemsInput): string[] {
  const ids = new Set<string>();
  if (input.activeRunId) ids.add(input.activeRunId);
  return [...ids];
}

function projectAssistantMessageFromRunEvents(runId: string, events: NormalizedRunEvent[]): ChatMessageRenderItem | null {
  const sorted = sortBySeq(events);
  const assistantEvents = sorted.filter((event) => event.type === 'assistant.delta' || event.type === 'assistant.completed');
  if (assistantEvents.length === 0) return null;
  const deltaText = assistantEvents
    .filter((event) => event.type === 'assistant.delta')
    .map((event) => textChunkValue(event.delta.text))
    .join('');
  const completedText = textChunkValue([...assistantEvents].reverse().find((event) => event.type === 'assistant.completed')?.delta.text);
  const content = deltaText || completedText;
  if (!content) return null;
  const firstAssistantEvent = assistantEvents[0];
  const complete = sorted.some((event) => (
    event.type === 'assistant.completed'
    || event.type === 'run.completed'
    || event.type === 'run.finalized'
    || event.type === 'foreground_run.completed'
  ));
  return {
    type: 'message',
    id: firstAssistantEvent.itemId || `streaming-${runId}`,
    role: 'assistant',
    content,
    runId,
    streaming: !complete,
    createdAt: firstAssistantEvent.createdAt,
  };
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function textChunkValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function messageContentValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => messageContentValue(item)).filter(Boolean).join('');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const text = textChunkValue(record.text) || textChunkValue(record.content);
    if (text) return text;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}
