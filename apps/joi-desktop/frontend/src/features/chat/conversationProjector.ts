import { getEventVisibility } from './eventVisibility';
import { detailForExecutionEvent, summarizeExecutionEvent } from './executionSummary';
import type {
  ApprovalRenderItem,
  ArtifactRenderItem,
  BuildConversationRenderItemsInput,
  BuildConversationRenderItemsOutput,
  ChatMessageRenderItem,
  CompactRunCardRenderItem,
  CompactRunStep,
  ConversationMessage,
  ConversationRenderItem,
  InlineStatusRenderItem,
  NormalizedRunEvent,
  NormalizedStatus,
  TaskEntryRenderItem,
} from './types';

export function buildConversationRenderItems(
  input: BuildConversationRenderItemsInput,
): BuildConversationRenderItemsOutput {
  const items: ConversationRenderItem[] = [];
  const traceOnlyEventsByRunId: Record<string, NormalizedRunEvent[]> = {};
  const activeRunStatusByRunId: Record<string, NormalizedStatus> = {};
  const messages = dedupeMessages(input.messages);

  for (const message of messages) {
    const projectedMessage = projectMessage(message, false);
    if (!projectedMessage) continue;
    items.push(projectedMessage);

    if (message.role !== 'assistant') continue;
    const runId = getMessageRunId(message);
    if (!runId) continue;
    const projected = projectRunEventsForAssistantMessage({
      runId,
      assistantMessageId: message.id,
      events: input.runEventsByRunId[runId] || [],
      mode: input.mode,
      debug: input.debug,
    });
    items.push(...projected.items);
    traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
    activeRunStatusByRunId[runId] = projected.status;
  }

  if (input.pendingUserMessage && !messages.some((message) => message.id === input.pendingUserMessage?.id)) {
    const projected = projectMessage(input.pendingUserMessage, true);
    if (projected) items.push(projected);
  }

  if (input.streamingAssistant && !hasPersistedAssistant(messages, input.streamingAssistant)) {
    items.push({
      type: 'message',
      id: input.streamingAssistant.id,
      role: 'assistant',
      content: input.streamingAssistant.content,
      runId: input.streamingAssistant.run_id,
      streaming: !input.streamingAssistant.complete,
      createdAt: input.streamingAssistant.created_at,
    });

    const runId = input.streamingAssistant.run_id || input.activeRunId;
    if (runId) {
      const projected = projectRunEventsForAssistantMessage({
        runId,
        assistantMessageId: input.streamingAssistant.id,
        events: input.runEventsByRunId[runId] || [],
        mode: input.mode,
        debug: input.debug,
      });
      items.push(...projected.items);
      traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
      activeRunStatusByRunId[runId] = projected.status;
    }
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
  traceOnlyEvents: NormalizedRunEvent[];
  status: NormalizedStatus;
} {
  const visibleEvents: NormalizedRunEvent[] = [];
  const traceOnlyEvents: NormalizedRunEvent[] = [];

  for (const event of sortBySeq(input.events)) {
    const visibility = input.debug ? 'compact' : getEventVisibility(event, input.mode);
    if (visibility === 'trace_only') {
      traceOnlyEvents.push(event);
      continue;
    }
    if (visibility === 'hidden' || visibility === 'chat') {
      continue;
    }
    visibleEvents.push(event);
  }

  return {
    items: aggregateVisibleEvents({
      runId: input.runId,
      assistantMessageId: input.assistantMessageId,
      events: visibleEvents,
      mode: input.mode,
    }),
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
  if (sorted.some((event) => event.status === 'failed' || event.type.endsWith('.failed'))) return 'failed';
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
  const groups = [...groupEventsByItem(input.events).entries()]
    .map(([id, events]) => {
      const sorted = sortBySeq(events);
      return { id, events: sorted, latest: sorted[sorted.length - 1] };
    })
    .filter((group): group is { id: string; events: NormalizedRunEvent[]; latest: NormalizedRunEvent } => Boolean(group.latest));
  const items: ConversationRenderItem[] = [];
  const executionGroups: typeof groups = [];

  for (const group of groups) {
    const visibility = getEventVisibility(group.latest, input.mode);
    if (visibility === 'approval') {
      items.push(projectApproval(input.runId, group.latest));
    } else if (visibility === 'artifact') {
      items.push(projectArtifact(input.runId, group.latest));
    } else if (visibility === 'task') {
      items.push(projectTask(input.runId, group.latest));
    } else if (visibility === 'inline' || visibility === 'compact') {
      executionGroups.push(group);
    }
  }

  if (executionGroups.length === 1 && input.mode !== 'serious_task') {
    items.push(projectInlineStatus(input.runId, input.assistantMessageId, executionGroups[0].latest, executionGroups[0].events));
  } else if (executionGroups.length > 0) {
    items.push(projectCompactRunCard(input.runId, executionGroups));
  }

  return items;
}

function groupEventsByItem(events: NormalizedRunEvent[]): Map<string, NormalizedRunEvent[]> {
  const grouped = new Map<string, NormalizedRunEvent[]>();
  for (const event of sortBySeq(events)) {
    const key = event.itemId || `${event.itemType}:${event.title || event.type || event.seq}`;
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  return grouped;
}

function projectMessage(message: ConversationMessage, streaming: boolean): ChatMessageRenderItem | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  return {
    type: 'message',
    id: message.id,
    role: message.role,
    content: message.content,
    runId: getMessageRunId(message),
    streaming,
    createdAt: message.created_at,
  };
}

function projectInlineStatus(
  runId: string,
  assistantMessageId: string,
  event: NormalizedRunEvent,
  events: NormalizedRunEvent[],
): InlineStatusRenderItem {
  const started = events.find((item) => item.status === 'running' || item.type.endsWith('.started'));
  const completed = [...events].reverse().find((item) => item.status === 'completed' || item.type.endsWith('.completed') || item.type.endsWith('.finished'));
  return {
    type: 'inline_status',
    id: `${runId}:${event.itemId || event.id}:inline`,
    runId,
    anchorMessageId: assistantMessageId,
    status: inlineStatus(event.status),
    label: summarizeExecutionEvent(event),
    detail: detailForExecutionEvent(event),
    traceAvailable: true,
    startedAt: started?.createdAt,
    completedAt: completed?.createdAt,
  };
}

function projectCompactRunCard(runId: string, groups: Array<{ id: string; events: NormalizedRunEvent[]; latest: NormalizedRunEvent }>): CompactRunCardRenderItem {
  const steps = groups.map(({ id, latest }): CompactRunStep => ({
    id,
    label: summarizeExecutionEvent(latest),
    status: compactStepStatus(latest.status),
    summary: detailForExecutionEvent(latest),
    durationMs: numberValue(latest.snapshot.duration_ms ?? latest.snapshot.durationMs ?? latest.delta.duration_ms ?? latest.delta.durationMs),
  }));
  const completedCount = steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length;
  const status = compactCardStatus(groups.map((group) => group.latest));
  return {
    type: 'compact_run_card',
    id: `${runId}:compact`,
    runId,
    status,
    title: status === 'running' ? 'Joi 正在处理' : '执行过程',
    progressLabel: `${completedCount}/${steps.length}`,
    steps,
    collapsed: status === 'completed',
    traceAvailable: true,
  };
}

function projectTask(runId: string, event: NormalizedRunEvent): TaskEntryRenderItem {
  const taskId = stringValue(event.snapshot.task_id) || stringValue(event.delta.task_id) || event.itemId || `${runId}:task`;
  return {
    type: 'task_entry',
    id: `${runId}:${taskId}:task`,
    runId,
    taskId,
    title: event.title || summarizeExecutionEvent(event) || '后台任务',
    status: taskStatus(event.status),
    summary: event.summary || detailForExecutionEvent(event),
  };
}

function projectApproval(runId: string, event: NormalizedRunEvent): ApprovalRenderItem {
  return {
    type: 'approval',
    id: `${runId}:${event.itemId || event.id}:approval`,
    runId,
    title: event.title || '等待确认',
    riskLevel: riskLevel(event.snapshot.risk || event.delta.risk),
    summary: event.summary || stringValue(event.snapshot.requested_action),
    status: approvalStatus(event),
  };
}

function projectArtifact(runId: string, event: NormalizedRunEvent): ArtifactRenderItem {
  const artifactId = stringValue(event.snapshot.artifact_id) || stringValue(event.snapshot.id) || event.itemId;
  return {
    type: 'artifact',
    id: `${runId}:${artifactId}:artifact`,
    runId,
    artifactId,
    title: event.title || stringValue(event.snapshot.title) || '已生成交付物',
    artifactType: stringValue(event.snapshot.type) || stringValue(event.snapshot.artifact_type) || 'artifact',
  };
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

function inlineStatus(status: NormalizedStatus): InlineStatusRenderItem['status'] {
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'failed';
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'completed' || status === 'skipped') return 'completed';
  if (status === 'running' || status === 'queued') return 'running';
  return 'pending';
}

function compactCardStatus(events: NormalizedRunEvent[]): CompactRunCardRenderItem['status'] {
  if (events.some((event) => event.status === 'failed' || event.status === 'blocked')) return 'failed';
  if (events.some((event) => event.status === 'waiting_approval')) return 'waiting_approval';
  if (events.some((event) => event.status === 'running' || event.status === 'queued' || event.status === 'pending')) return 'running';
  return 'completed';
}

function compactStepStatus(status: NormalizedStatus): CompactRunStep['status'] {
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'failed';
  if (status === 'skipped') return 'skipped';
  if (status === 'completed') return 'completed';
  if (status === 'running' || status === 'queued') return 'running';
  return 'pending';
}

function taskStatus(status: NormalizedStatus): TaskEntryRenderItem['status'] {
  if (status === 'completed' || status === 'skipped') return 'completed';
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'failed';
  if (status === 'queued' || status === 'pending') return 'queued';
  return 'running';
}

function approvalStatus(event: NormalizedRunEvent): ApprovalRenderItem['status'] {
  if (event.type === 'approval.rejected' || event.status === 'failed' || event.status === 'cancelled') return 'rejected';
  if (event.type === 'approval.approved' || event.status === 'completed') return 'approved';
  return 'waiting_approval';
}

function riskLevel(value: unknown): ApprovalRenderItem['riskLevel'] {
  const risk = stringValue(value);
  if (risk === 'private_content' || risk === 'state_change' || risk === 'dangerous') return risk;
  return 'read_only';
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
