import { getEventVisibility } from './eventVisibility';
import { detailForExecutionEvent, summarizeExecutionEvent } from './executionSummary';
import { mergeAssistantTextChunks } from './streamingText';
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
      showThinkingStatus: false,
    });
    items.push(...projected.itemsBeforeAssistant);
    items.push(projectedMessage);
    items.push(...projected.itemsAfterAssistant);
    traceOnlyEventsByRunId[runId] = projected.traceOnlyEvents;
    activeRunStatusByRunId[runId] = projected.status;
    projectedRunIds.add(runId);
  }

  if (input.pendingUserMessage && !messages.some((message) => message.id === input.pendingUserMessage?.id)) {
    const projected = projectMessage(input.pendingUserMessage, false);
    if (projected) items.push(projected);
  }

  if (input.streamingAssistant && !hasPersistedAssistant(messages, input.streamingAssistant)) {
    const streamingMessage: ChatMessageRenderItem = {
      type: 'message',
      id: input.streamingAssistant.id,
      role: 'assistant',
      content: messageContentValue(input.streamingAssistant.content),
      attachments: normalizeMessageAttachments(input.streamingAssistant.attachments),
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
        showThinkingStatus: true,
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
    if (!runEventsBelongToConversation(runEvents, input.conversationId)) {
      continue;
    }
    const assistantMessage = projectAssistantMessageFromRunEvents(runId, runEvents);
    const projected = projectRunEventsForAssistantMessage({
      runId,
      assistantMessageId: assistantMessage?.id || `${runId}:transcript-anchor`,
      events: runEvents,
      mode: input.mode,
      debug: input.debug,
      showThinkingStatus: input.activeRunId === runId,
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

  if (
    input.activeRunId
    && !activeRunStatusByRunId[input.activeRunId]
    && runEventsBelongToConversation(input.runEventsByRunId[input.activeRunId] || [], input.conversationId)
  ) {
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
  showThinkingStatus?: boolean;
}): {
  items: ConversationRenderItem[];
  itemsBeforeAssistant: ConversationRenderItem[];
  itemsAfterAssistant: ConversationRenderItem[];
  traceOnlyEvents: NormalizedRunEvent[];
  status: NormalizedStatus;
} {
  const visibleEvents: NormalizedRunEvent[] = [];
  const traceOnlyEvents: NormalizedRunEvent[] = [];
  const runStatus = deriveRunStatus(input.events);
  const terminalRunStatus = deriveTerminalRunStatus(input.events);

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
      runEvents: input.events,
      mode: input.mode,
      showThinkingStatus: Boolean(input.showThinkingStatus),
      runStatus: terminalRunStatus,
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
    status: runStatus,
  };
}

export function getMessageRunId(message: ConversationMessage): string | undefined {
  const runId = message.run_id || stringValue(message.metadata?.run_id);
  return runId || undefined;
}

export function deriveRunStatus(events: NormalizedRunEvent[]): NormalizedStatus {
  const sorted = sortBySeq(events);
  const terminalStatus = deriveTerminalRunStatus(sorted);
  if (terminalStatus) return terminalStatus;
  const latest = sorted[sorted.length - 1];
  if (latest?.status === 'waiting_approval' || sorted.some((event) => event.type === 'approval.required' && event.status === 'waiting_approval')) {
    return 'waiting_approval';
  }
  if (sorted.some((event) => event.status === 'redirected' || event.type === 'run.redirected')) return 'redirected';
  if (sorted.some((event) => event.status === 'running' || event.status === 'queued')) return 'running';
  if (sorted.some((event) => event.status === 'cancelled')) return 'cancelled';
  if (sorted.some((event) => event.status === 'failed' || event.status === 'blocked' || event.type.endsWith('.failed'))) return 'failed';
  if (sorted.some(isSuccessfulTerminalRunEvent)) return 'completed';
  return 'pending';
}

function deriveTerminalRunStatus(events: NormalizedRunEvent[]): NormalizedStatus | undefined {
  const sorted = sortBySeq(events);
  if (sorted.some((event) => (
    event.status === 'cancelled'
    || event.type === 'run.cancelled'
    || event.type === 'run.interrupted'
    || event.type === 'turn.aborted'
  ))) return 'cancelled';
  const terminal = sorted.reverse().find(isTerminalRunOutcomeEvent);
  if (terminal) {
    if (terminal.status === 'cancelled' || terminal.type === 'run.cancelled' || terminal.type === 'run.interrupted' || terminal.type === 'turn.aborted') {
      return 'cancelled';
    }
    if (terminal.status === 'failed' || terminal.status === 'blocked' || terminal.type === 'run.failed') return 'failed';
    if (terminal.status === 'redirected' || terminal.type === 'run.redirected') return 'redirected';
    if (terminal.status === 'completed' || terminal.status === 'skipped' || isSuccessfulTerminalRunEvent(terminal)) return 'completed';
  }
  return undefined;
}

function isTerminalRunOutcomeEvent(event: NormalizedRunEvent): boolean {
  return event.type === 'run.completed'
    || event.type === 'foreground_run.completed'
    || event.type === 'run.finalized'
    || event.type === 'automation.run_completed'
    || event.type === 'assistant.completed'
    || event.type === 'run.failed'
    || event.type === 'run.cancelled'
    || event.type === 'run.interrupted'
    || event.type === 'turn.aborted'
    || event.type === 'run.redirected';
}

function isSuccessfulTerminalRunEvent(event: NormalizedRunEvent): boolean {
  return event.type === 'run.completed'
    || event.type === 'foreground_run.completed'
    || event.type === 'run.finalized'
    || event.type === 'automation.run_completed'
    || event.type === 'assistant.completed';
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
  runEvents?: NormalizedRunEvent[];
  mode: BuildConversationRenderItemsInput['mode'];
}): ConversationRenderItem[] {
  return aggregateVisibleEventGroups({ ...input, showThinkingStatus: false }).map((item) => item.item);
}

function aggregateVisibleEventGroups(input: {
  runId: string;
  assistantMessageId: string;
  events: NormalizedRunEvent[];
  runEvents?: NormalizedRunEvent[];
  mode: BuildConversationRenderItemsInput['mode'];
  showThinkingStatus: boolean;
  runStatus?: NormalizedStatus;
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
    if (input.runStatus === 'cancelled' && group.latest.type === 'run.cancel_requested') continue;
    if (!shouldShowTranscriptGroup(group.latest, group.events, input.showThinkingStatus)) continue;
    items.push({
      item: projectTranscriptLine(input.runId, group.latest, group.events, input.runStatus, input.runEvents || input.events),
      seq: group.events[0]?.seq ?? group.latest.seq,
    });
  }

  return items.sort((a, b) => a.seq - b.seq);
}

function isLeadingAssistantProcessItem(item: ConversationRenderItem): boolean {
  return item.type === 'transcript_line' && (
    item.kind === 'thinking'
    || item.kind === 'tool'
    || item.kind === 'approval'
    || (item.kind === 'run' && item.status === 'failed')
  );
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
  if (isWorkSummaryEvent(event)) {
    return `${event.itemType || 'model'}:${event.itemId || event.runId || 'model'}:step:${modelStepValue(event) || '0'}`;
  }
  if (event.itemType === 'run') {
    return `${event.itemType}:${event.type}:${event.itemId || event.seq}`;
  }
  return event.itemId || `${event.itemType}:${event.title || event.type || event.seq}`;
}

function projectMessage(message: ConversationMessage, streaming: boolean): ChatMessageRenderItem | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (message.role === 'assistant' && isRawConfirmationMessage(message.content)) return null;
  return {
    type: 'message',
    id: message.id,
    role: message.role,
    content: messageContentValue(message.content),
    attachments: normalizeMessageAttachments(message.attachments),
    runId: getMessageRunId(message),
    streaming,
    createdAt: message.created_at,
  };
}

function normalizeMessageAttachments(value: unknown): ChatMessageRenderItem['attachments'] {
  if (!Array.isArray(value)) return undefined;
  const attachments: NonNullable<ChatMessageRenderItem['attachments']> = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const raw = item as Record<string, unknown>;
    const name = stringValue(raw.name) || stringValue(raw.filename) || `附件 ${index + 1}`;
    const mimeType = stringValue(raw.mimeType) || stringValue(raw.mime_type) || stringValue(raw.type);
    const rawKind = stringValue(raw.kind);
    const kind = rawKind === 'image' || rawKind === 'video' || rawKind === 'audio'
      ? rawKind
      : mimeType.startsWith('image/')
        ? 'image'
        : mimeType.startsWith('video/')
          ? 'video'
          : mimeType.startsWith('audio/')
            ? 'audio'
          : 'file';
    attachments.push({
      id: stringValue(raw.id) || `${name}-${index}`,
      name,
      kind,
      mimeType,
      size: numberValue(raw.size),
      previewUrl: stringValue(raw.previewUrl) || stringValue(raw.preview_url) || stringValue(raw.url),
    });
  });
  return attachments.length ? attachments : undefined;
}

function projectTranscriptLine(
  runId: string,
  event: NormalizedRunEvent,
  events: NormalizedRunEvent[],
  runOutcome?: NormalizedStatus,
  runEvents: NormalizedRunEvent[] = events,
): TranscriptLineRenderItem {
  const started = events.find((item) => item.status === 'running' || item.type.endsWith('.started'));
  const completed = [...events].reverse().find(isTerminalTranscriptEvent);
  const explicitRunStartedAt = runEvents.map((item) => item.runStartedAt).find(Boolean);
  const explicitRunCompletedAt = [...runEvents].reverse().map((item) => item.runCompletedAt).find(Boolean);
  const runStarted = sortBySeq(runEvents).find((item) => item.type === 'run.started' || item.type === 'foreground_run.started');
  const runCompleted = [...sortBySeq(runEvents)].reverse().find(isTerminalRunOutcomeEvent);
  const runDurationMs = runEvents.map((item) => item.runDurationMs).find((value) => typeof value === 'number' && Number.isFinite(value));
  const kind = transcriptKind(event);
  const status = transcriptStatus(event.status);
  return {
    type: 'transcript_line',
    id: `${runId}:${transcriptIdentity(event)}:transcript`,
    runId,
    status,
    runOutcome,
    kind,
    label: transcriptLabel(event, kind, status),
    detail: transcriptDetail(event, kind),
    detailRows: kind === 'tool' ? toolDetailRows(event, events) : undefined,
    approval: kind === 'approval' || status === 'waiting_approval' ? approvalForEvent(event) : undefined,
    traceAvailable: status === 'failed' || status === 'waiting_approval',
    startedAt: started?.createdAt,
    completedAt: completed?.createdAt,
    runStartedAt: explicitRunStartedAt || runStarted?.createdAt,
    runCompletedAt: explicitRunCompletedAt || runCompleted?.createdAt,
    runDurationMs,
  };
}

function isTerminalTranscriptEvent(event: NormalizedRunEvent): boolean {
  return event.status === 'completed'
    || event.status === 'failed'
    || event.status === 'blocked'
    || event.status === 'cancelled'
    || event.status === 'redirected'
    || event.status === 'skipped'
    || event.type.endsWith('.completed')
    || event.type.endsWith('.finished')
    || event.type.endsWith('.failed')
    || event.type.endsWith('.cancelled')
    || event.type.endsWith('.interrupted')
    || event.type.endsWith('.aborted');
}

function transcriptKind(event: NormalizedRunEvent): TranscriptLineKind {
  if (isModelProgressEvent(event)) return 'thinking';
  if (isWorkSummaryEvent(event)) return 'thinking';
  if (event.type.startsWith('tool.') || event.itemType === 'tool' || event.itemType === 'capability' || event.itemType === 'node') return 'tool';
  if (event.type.startsWith('approval.') || event.itemType === 'approval') return 'approval';
  if (event.type.startsWith('artifact.') || event.itemType === 'artifact') return 'artifact';
  if (event.type.startsWith('task.') || event.type.startsWith('worker.') || event.itemType === 'task' || event.itemType === 'worker') return 'task';
  if (event.type.startsWith('automation.') || event.itemType === 'automation') return 'task';
  if (event.type.startsWith('run.')) return 'run';
  return 'system';
}

function shouldShowTranscriptGroup(event: NormalizedRunEvent, events: NormalizedRunEvent[], showThinkingStatus: boolean): boolean {
  if (isWorkSummaryEvent(event)) {
    if (event.status === 'failed' || event.status === 'blocked') return true;
    if (event.status === 'running' || event.status === 'queued' || event.status === 'pending') return showThinkingStatus;
    return isUserVisibleSemanticSummary(event);
  }
  if (isModelProgressEvent(event) && event.status !== 'running' && event.status !== 'queued' && event.status !== 'pending') {
    if (event.status === 'failed' || event.status === 'blocked') return true;
    return false;
  }
  if (isModelProgressEvent(event)) return showThinkingStatus;
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
    if (status === 'failed') return 'Thinking 失败';
    if (isUserVisibleSemanticSummary(event)) {
      const phase = stringFromEvent(event, ['phase']);
      if (phase === 'prepared') return '能力已就绪';
      if (phase === 'verified') return '结果已核对';
    }
    return 'Thinking';
  }
  if (kind === 'approval') {
    const action = localizedActionFromEvent(event);
    const target = resourceLabelFromEvent(event);
    return `等待确认 · ${action}${target ? ` · ${compactText(target)}` : ''}`;
  }
  if (kind === 'artifact') {
    return `生成交付物 · ${compactText(event.title || stringFromEvent(event, ['title', 'artifact_type', 'type']) || 'artifact')}`;
  }
  if (event.itemType === 'automation' || event.type.startsWith('automation.')) {
    const target = compactText(event.summary || event.title || stringFromEvent(event, ['automation_name', 'name', 'automation_id']) || 'automation');
    if (status === 'running' || status === 'pending') return `自动化运行中 · ${target}`;
    if (status === 'failed') return `自动化失败 · ${target}`;
    return `自动化更新 · ${target}`;
  }
  if (kind === 'task') {
    const target = compactText(event.title || stringFromEvent(event, ['title', 'task_title', 'task_id']) || 'task');
    if (status === 'running' || status === 'pending') return `任务执行中 · ${target}`;
    if (status === 'failed') return `任务失败 · ${target}`;
    return `任务更新 · ${target}`;
  }
  return compactText(summarizeExecutionEvent(event));
}

function transcriptDetail(event: NormalizedRunEvent, kind: TranscriptLineKind): string | undefined {
  if (kind === 'thinking') {
    if (isModelProgressEvent(event)) return undefined;
    return workSummaryText(event) || undefined;
  }
  if (kind === 'tool') return undefined;
  if (kind === 'approval') return approvalDetail(event);
  const detail = usefulSummary(event) || detailForExecutionEvent(event);
  if (!detail) return undefined;
  return compactText(detail, 180);
}

function transcriptIdentity(event: NormalizedRunEvent): string {
  if (isWorkSummaryEvent(event)) {
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
  return displayToolName(event, status);
}

function displayToolName(event: NormalizedRunEvent, status: TranscriptLineRenderItem['status']): string {
  const toolName = toolNameFromEvent(event);
  const lower = toolName.toLowerCase();
  void status;
  if (lower.includes('tool_search')) return '查找工具';
  if (lower.includes('session_search')) return '搜索会话';
  if (lower.includes('session_summary')) return '读取会话上下文';
  if (lower.includes('project_list')) return '查看项目';
  if (lower.includes('skills_list')) return '查看技能';
  if (lower.includes('skill_view')) return '读取技能';
  if (lower.includes('task_list')) return '查看任务';
  if (lower.includes('task_view')) return '查看任务详情';
  if (lower.includes('task_update')) return '更新任务';
  if (lower.includes('shell_')) return '操作终端';
  if (event.terminal || lower.includes('terminal') || lower.includes('shell') || lower.includes('command') || lower.includes('exec') || lower.includes('bash')) {
    return '运行命令';
  }
  if (lower.includes('apply_patch') || lower.includes('patch') || lower.includes('workspace_write')) {
    return '写入文件';
  }
  if (
    lower.includes('web_extract')
    || lower.includes('web.extract')
    || lower.includes('browser_read')
    || lower.includes('browser.read')
    || lower.includes('read_url')
    || lower.includes('fetch')
    || lower.includes('http_get')
  ) {
    return '读取网页';
  }
  if (lower.includes('web') || lower.includes('browser') || lower.includes('url') || lower.includes('http')) {
    return '网页搜索';
  }
  if (lower.includes('memory') || lower.includes('memories')) {
    return lower.includes('candidate') || lower.includes('proposal') || lower.includes('write')
      ? '记忆建议'
      : '记忆检索';
  }
  if (lower.includes('workspace') || lower.includes('search') || lower.includes('grep') || lower.includes('rg')) {
    return '工作区搜索';
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('path')) {
    return '读取文件';
  }
  return humanizeToolName(toolName);
}

function toolDetailRows(event: NormalizedRunEvent, events: NormalizedRunEvent[]): TranscriptLineRenderItem['detailRows'] {
  const rows: NonNullable<TranscriptLineRenderItem['detailRows']> = [];
  const input = inputValueForToolEvents(event, events);
  if (input !== undefined) rows.push({ label: 'Input', value: formatDetailValue(input) });
  const rawOutput = rawOutputValueForToolEvents(event, events);
  const output = normalizeToolOutputForDisplay(outputValueForToolEvents(event, events));
  const outputDetail = output !== undefined ? formatDetailValue(output) : '';
  if (outputDetail) rows.push({ label: outputLabelForToolEvent(event), value: outputDetail });
  const error = errorValueForToolEvents(event, events);
  if (error !== undefined) {
    const errorDetail = formatDetailValue(error);
    if (errorDetail && comparableDetailValue(error) !== comparableDetailValue(output)) rows.push({ label: 'Error', value: errorDetail });
  }
  if (!outputDetail && error === undefined && isSuccessfulTerminalToolEvent(event)) {
    rows.push({ label: outputLabelForToolEvent(event), value: '无返回内容' });
  }
  const rawCall = firstPresentValue(input, rawOutput) !== undefined
    ? { input, output: rawOutput ?? output }
    : undefined;
  if (rawCall !== undefined) rows.push({ label: 'Raw', value: formatDetailValue(rawCall) });
  return rows.length > 0 ? rows : undefined;
}

function inputValueForToolEvents(event: NormalizedRunEvent, events: NormalizedRunEvent[]): unknown {
  const sorted = sortBySeq(events);
  for (const item of sorted) {
    const payload = eventPayload(item);
    const input = firstPresentValue(
      payload.input,
      objectValue(payload.arguments),
      item.snapshot.input,
      item.delta.input,
      objectValue(item.snapshot.arguments),
      objectValue(item.delta.arguments),
    );
    if (input !== undefined) return input;
  }
  const payload = eventPayload(event);
  return firstPresentValue(
    payload.input,
    objectValue(payload.arguments),
    event.snapshot.input,
    event.delta.input,
    objectValue(event.snapshot.arguments),
    objectValue(event.delta.arguments),
  );
}

function outputValueForToolEvents(event: NormalizedRunEvent, events: NormalizedRunEvent[]): unknown {
  const sorted = sortBySeq(events).reverse();

  for (const item of sorted) {
    const presented = presentedToolOutput(item);
    if (presented !== undefined) return presented;
  }

  for (const item of sorted) {
    const raw = rawToolOutput(item);
    if (raw !== undefined) return raw;
  }

  for (const item of sorted) {
    if (!isToolOutputEvent(item)) continue;
    const payload = eventPayload(item);
    const fallback = firstMeaningfulToolOutput(
      objectValue(payload.snapshot),
      item.snapshot,
      objectValue(payload.delta),
      item.delta,
    );
    if (fallback !== undefined) return fallback;
  }

  if (isToolOutputEvent(event)) {
    return firstMeaningfulToolOutput(event.snapshot, event.delta);
  }
  return undefined;
}

function rawOutputValueForToolEvents(event: NormalizedRunEvent, events: NormalizedRunEvent[]): unknown {
  const sorted = sortBySeq(events).reverse();
  for (const item of sorted) {
    const raw = rawToolOutput(item);
    if (raw !== undefined) return raw;
  }
  for (const item of sorted) {
    const presented = presentedToolOutput(item);
    if (presented !== undefined) return presented;
  }
  return rawToolOutput(event) ?? presentedToolOutput(event);
}

function presentedToolOutput(event: NormalizedRunEvent): unknown {
  const payload = eventPayload(event);
  const sources = [
    event.delta,
    objectValue(payload.delta),
    event.snapshot,
    objectValue(payload.snapshot),
    payload,
  ];
  for (const source of sources) {
    const structured = firstPresentValue(source.structuredContent, source.structured_content);
    if (structured !== undefined) return structured;
    const formatted = firstPresentValue(source.formatted_output, source.formattedOutput);
    if (formatted !== undefined) {
      const exitCode = firstPresentValue(source.exit_code, source.exitCode);
      return exitCode === undefined || exitCode === 0 || exitCode === '0'
        ? formatted
        : { output: formatted, exit_code: exitCode };
    }
    const direct = firstPresentValue(
      source.output,
      source.result,
      source.content,
      source.stdout,
      source.text,
      source.body,
      source.data,
    );
    if (direct !== undefined) return direct;
  }
  return undefined;
}

function normalizeToolOutputForDisplay(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null || depth > 3) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        return normalizeToolOutputForDisplay(JSON.parse(text) as unknown, depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const structured = firstPresentValue(source.structuredContent, source.structured_content);
  if (structured !== undefined) return normalizeToolOutputForDisplay(structured, depth + 1);

  if (Array.isArray(source.content)) {
    const textBlocks = source.content.filter((item): item is Record<string, unknown> => (
      Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && (item as Record<string, unknown>).type === 'text'
      && typeof (item as Record<string, unknown>).text === 'string'
    ));
    if (textBlocks.length === 1 && source.content.length === 1) {
      return normalizeToolOutputForDisplay(textBlocks[0].text, depth + 1);
    }
    if (textBlocks.length === source.content.length && textBlocks.length > 0) {
      return textBlocks.map((block) => block.text).join('\n');
    }
  }
  return value;
}

function rawToolOutput(event: NormalizedRunEvent): unknown {
  const payload = eventPayload(event);
  const sources = [
    event.snapshot,
    objectValue(payload.snapshot),
    event.delta,
    objectValue(payload.delta),
    payload,
  ];
  for (const source of sources) {
    const raw = firstPresentValue(source.raw_output, source.rawOutput);
    if (raw !== undefined) return raw;
  }
  return undefined;
}

function firstMeaningfulToolOutput(...values: unknown[]): unknown {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length > 0) return value;
      continue;
    }
    if (!value || typeof value !== 'object') {
      const primitive = firstPresentValue(value);
      if (primitive !== undefined) return primitive;
      continue;
    }
    const filtered = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, item]) => (
      !/^(status|protocol|kind|tool_name|toolName|call_id|callId|item_id|itemId|visibility|source)$/i.test(key)
      && firstPresentValue(item) !== undefined
    )));
    if (Object.keys(filtered).length > 0) return filtered;
  }
  return undefined;
}

function errorValueForToolEvents(event: NormalizedRunEvent, events: NormalizedRunEvent[]): unknown {
  for (const item of sortBySeq(events).reverse()) {
    const payload = eventPayload(item);
    const error = firstPresentValue(
      item.error,
      item.delta.error,
      item.snapshot.error,
      objectValue(payload.delta).error,
      objectValue(payload.snapshot).error,
      payload.error,
    );
    if (error !== undefined && error !== false) return error;
  }
  return event.error || undefined;
}

function isToolOutputEvent(event: NormalizedRunEvent): boolean {
  return event.type === 'tool.output_delta'
    || event.type === 'tool.completed'
    || event.type === 'tool.finished'
    || event.type === 'tool.failed'
    || event.type === 'tool.policy_blocked';
}

function isSuccessfulTerminalToolEvent(event: NormalizedRunEvent): boolean {
  return event.status === 'completed' && (event.type === 'tool.completed' || event.type === 'tool.finished');
}

function outputLabelForToolEvent(event: NormalizedRunEvent): string {
  if (event.type === 'tool.output_delta') return 'Output Delta';
  return 'Output';
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

function isWorkSummaryEvent(event: NormalizedRunEvent): boolean {
  return event.type === 'work_summary.updated' || event.type === 'plan.created' || event.type === 'plan.updated';
}

function isUserVisibleSemanticSummary(event: NormalizedRunEvent): boolean {
  const payload = eventPayload(event);
  return payload.user_visible === true
    || event.snapshot.user_visible === true
    || event.delta.user_visible === true;
}

function workSummaryText(event: NormalizedRunEvent): string {
  if (isModelProgressEvent(event)) {
    if (event.status === 'running' || event.status === 'queued' || event.status === 'pending') return '模型正在组织下一步';
    if (event.status === 'completed') return '模型完成本轮思考';
  }
  return event.summary || stringFromEvent(event, ['summary', 'text', 'message', 'plan_summary', 'rationale']);
}

function usefulSummary(event: NormalizedRunEvent): string {
  const summary = (event.summary || '').trim();
  if (!summary) return '';
  const generic = `${event.type} ${event.status}`.trim().toLowerCase();
  if (summary.toLowerCase() === generic) return '';
  return summary;
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

function firstPresentValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) continue;
    return value;
  }
  return undefined;
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return JSON.stringify(redactSensitiveValue(JSON.parse(value) as unknown), null, 2);
      } catch {
        return redactSensitiveText(value);
      }
    }
    return redactSensitiveText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(redactSensitiveValue(value), null, 2);
  } catch {
    return String(value);
  }
}

function comparableDetailValue(value: unknown): string {
  let normalized = value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      normalized = JSON.parse(value) as unknown;
    } catch {
      normalized = value.trim();
    }
  }
  try {
    return JSON.stringify(redactSensitiveValue(normalized));
  } catch {
    return String(normalized);
  }
}

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (typeof value === 'string') return redactSensitiveText(value);
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|password|api[_-]?key|authorization|cookie/i.test(key)) {
      redacted[key] = '[redacted]';
      continue;
    }
    redacted[key] = redactSensitiveValue(item);
  }
  return redacted;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"'\\]+/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=)[^&#\s"'\\]+/gi, '$1[redacted]')
    .replace(/(--(?:api-key|access-token|refresh-token|token|secret|password)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie)\s*(?:=|:)\s*)(?!\[redacted\])(?:"[^"]*"|'[^']*'|[^\s,;&"'\\}\]]+)/gi, '$1[redacted]');
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
    && !isRawConfirmationMessage(message.content)
    && (message.id === streaming.id || (streamingRunId && getMessageRunId(message) === streamingRunId))
  ));
}

function hasAssistantForRun(messages: ConversationMessage[], runId: string): boolean {
  return messages.some((message) => (
    message.role === 'assistant'
    && getMessageRunId(message) === runId
    && !isRawConfirmationMessage(message.content)
  ));
}

function orderedRunIds(input: BuildConversationRenderItemsInput): string[] {
  const ids = new Set<string>();
  if (input.activeRunId) ids.add(input.activeRunId);
  return [...ids];
}

function runEventsBelongToConversation(events: NormalizedRunEvent[], conversationId?: string): boolean {
  if (!conversationId) return true;
  const explicitConversationIds = new Set(events.map((event) => event.conversationId).filter(Boolean));
  return explicitConversationIds.size === 0 || explicitConversationIds.has(conversationId);
}

function projectAssistantMessageFromRunEvents(runId: string, events: NormalizedRunEvent[]): ChatMessageRenderItem | null {
  const sorted = sortBySeq(events);
  const assistantEvents = sorted.filter((event) => event.type === 'assistant.delta' || event.type === 'assistant.completed');
  if (assistantEvents.length === 0) return null;
  const deltaText = mergeAssistantTextChunks(assistantEvents
    .filter((event) => event.type === 'assistant.delta')
    .map((event) => textChunkValue(event.delta.text)));
  const completedText = textChunkValue([...assistantEvents].reverse().find((event) => event.type === 'assistant.completed')?.delta.text);
  const content = completedText || deltaText;
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

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
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

function isRawConfirmationMessage(value: unknown): boolean {
  return /^confirmation_required\s*:/i.test(messageContentValue(value).trim());
}

function approvalForEvent(event: NormalizedRunEvent): TranscriptLineRenderItem['approval'] {
  const id = stringFromEvent(event, ['confirmation_id', 'approval_request_id']) || event.itemId;
  if (!id) return undefined;
  return {
    id,
    capability: capabilityFromEvent(event),
    requestedAction: stringFromEvent(event, ['requested_action', 'purpose', 'action']) || localizedActionFromEvent(event),
    riskLevel: stringFromEvent(event, ['risk', 'risk_level']) || 'workspace_write',
    resourceLabel: resourceLabelFromEvent(event),
    preview: approvalPreviewFromEvent(event),
  };
}

function capabilityFromEvent(event: NormalizedRunEvent): string {
  return stringFromEvent(event, ['capability', 'capability_id', 'tool_name', 'name']) || toolNameFromEvent(event);
}

function localizedActionFromEvent(event: NormalizedRunEvent): string {
  const capability = capabilityFromEvent(event).toLowerCase();
  if (capability.includes('apply_patch') || capability.includes('patch')) return '写入文件';
  if (capability.includes('browser_click')) return '点击页面元素';
  if (capability.includes('browser_type')) return '输入页面内容';
  if (capability.includes('shell') || capability.includes('command')) return '运行命令';
  return '执行受控能力';
}

function resourceLabelFromEvent(event: NormalizedRunEvent): string {
  const direct = stringFromEvent(event, ['resource_ref', 'target', 'path', 'target_path', 'file_path', 'root', 'url']);
  if (direct) return direct;
  const affectedPaths = arrayFromEvent(event, ['affected_paths', 'paths', 'targetRefs']);
  if (affectedPaths.length === 1) return affectedPaths[0];
  if (affectedPaths.length > 1) return `${affectedPaths[0]} 等 ${affectedPaths.length} 项`;
  return '';
}

function approvalDetail(event: NormalizedRunEvent): string | undefined {
  const action = localizedActionFromEvent(event);
  const target = resourceLabelFromEvent(event);
  const risk = stringFromEvent(event, ['risk', 'risk_level']);
  return [`${action}等待你的确认`, target, risk ? `风险 ${risk}` : ''].filter(Boolean).join(' · ');
}

function approvalPreviewFromEvent(event: NormalizedRunEvent): string | undefined {
  const patch = stringFromEvent(event, ['patch', 'diff', 'preview']);
  if (patch) return compactText(patch, 300);
  const message = stringFromEvent(event, ['message']);
  if (message && !/^confirmation_required\s*:/i.test(message)) return compactText(message, 220);
  return undefined;
}

function arrayFromEvent(event: NormalizedRunEvent, keys: string[]): string[] {
  const payload = eventPayload(event);
  const sources = [
    event.snapshot,
    event.delta,
    event.metadata,
    payload,
    objectValue(payload.input),
    objectValue(payload.snapshot),
    objectValue(payload.delta),
  ];
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
      const single = stringValue(value);
      if (single) return [single];
    }
  }
  return [];
}
