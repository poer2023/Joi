import { MessageScroller } from '@shadcn/react/message-scroller';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MessageAttachmentGrid, MessageBubble, MessageBubbleActions, MessageThreadMarker } from './MessageBubble';
import { MarkdownContent } from './MarkdownContent';
import type { ChatMessageRenderItem, ConversationRenderItem, MessageThreadAnnotation, TranscriptLineRenderItem } from '../types';

type MessageListItem =
  | ConversationRenderItem
  | ProcessGroupItem
  | ProcessStackItem
  | AssistantResponseItem;

type ProcessGroupItem = {
  type: 'process_group';
  id: string;
  header: TranscriptLineRenderItem;
  lines: TranscriptLineRenderItem[];
};

type ProcessStackItem = {
  type: 'process_stack';
  id: string;
  groups: ProcessGroupItem[];
};

type ToolCallCluster = {
  id: string;
  label: string;
  lines: TranscriptLineRenderItem[];
};

type AssistantResponseItem = {
  type: 'assistant_response';
  id: string;
  leadGroups: ProcessGroupItem[];
  message: ChatMessageRenderItem;
  tailGroups: ProcessGroupItem[];
};

export function MessageList({
  assistantAvatarSrc,
  emptyState,
  formatAssistantContent,
  highlightedMessageId,
  items,
  onOpenArtifact,
  onOpenTask,
  onOpenThread,
  onOpenTrace,
  onResolveApproval,
  selectedThreadId,
  threadAnnotations,
  useMessageScrollerItems = false,
}: {
  assistantAvatarSrc?: string;
  emptyState?: ReactNode;
  formatAssistantContent?: (content: string) => string;
  highlightedMessageId?: string;
  items: ConversationRenderItem[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenThread?: (threadId: string) => void;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
  selectedThreadId?: string;
  threadAnnotations?: Record<string, MessageThreadAnnotation>;
  useMessageScrollerItems?: boolean;
}) {
  const groupedItems = useMemo(() => groupProcessItems(items), [items]);

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {groupedItems.map((item) => {
        let content: ReactNode;
        if (item.type === 'message') {
          content = (
            <MessageBubble
              assistantAvatarSrc={assistantAvatarSrc}
              formatAssistantContent={formatAssistantContent}
              highlighted={highlightedMessageId === item.id}
              item={item}
              onOpenThread={onOpenThread}
              threadAnnotation={threadAnnotations?.[item.id]}
              threadSelected={Boolean(selectedThreadId && threadAnnotations?.[item.id]?.threadId === selectedThreadId)}
            />
          );
        } else if (item.type === 'assistant_response') {
          content = (
            <AssistantResponse
              assistantAvatarSrc={assistantAvatarSrc}
              formatAssistantContent={formatAssistantContent}
              highlightedMessageId={highlightedMessageId}
              item={item}
              onOpenThread={onOpenThread}
              onOpenTrace={onOpenTrace}
              onResolveApproval={onResolveApproval}
              selectedThreadId={selectedThreadId}
              threadAnnotations={threadAnnotations}
            />
          );
        } else if (item.type === 'process_group') {
          content = <ProcessGroup assistantAvatarSrc={assistantAvatarSrc} group={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />;
        } else if (item.type === 'process_stack') {
          content = <ProcessStack assistantAvatarSrc={assistantAvatarSrc} item={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />;
        } else {
          content = <TranscriptLine assistantAvatarSrc={assistantAvatarSrc} item={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />;
        }

        const messageId = item.type === 'assistant_response' ? item.message.id : item.id;
        const isNewUserMessage = item.type === 'message' && item.role === 'user' && item.id.startsWith('pending-');
        const itemClassName = `chat-message-scroller-item${isNewUserMessage ? ' chat-message-enter' : ''}`;
        if (!useMessageScrollerItems) {
          return (
            <div className={itemClassName} data-message-id={messageId} key={item.id}>
              {content}
            </div>
          );
        }
        return (
          <MessageScroller.Item
            className={itemClassName}
            key={item.id}
            messageId={messageId}
            scrollAnchor={item.type === 'message' && item.role === 'user'}
          >
            {content}
          </MessageScroller.Item>
        );
      })}
    </>
  );
}

function groupProcessItems(items: ConversationRenderItem[]): MessageListItem[] {
  const result: MessageListItem[] = [];
  let pendingLines: TranscriptLineRenderItem[] = [];

  const flushPending = () => {
    if (pendingLines.length > 0) {
      const groups = groupTranscriptLines(pendingLines);
      if (groups.length > 0) {
        result.push({
          type: 'process_stack',
          id: `${groups[0].id}:stack:${groups.length}`,
          groups,
        });
      }
      pendingLines = [];
    }
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'transcript_line') {
      pendingLines.push(item);
      continue;
    }

    if (item.role === 'assistant') {
      const leadGroups = groupTranscriptLines(pendingLines);
      const tailLines: TranscriptLineRenderItem[] = [];
      pendingLines = [];
      while (items[index + 1]?.type === 'transcript_line') {
        tailLines.push(items[index + 1] as TranscriptLineRenderItem);
        index += 1;
      }
      result.push({
        type: 'assistant_response',
        id: `${item.id}:response`,
        leadGroups,
        message: item,
        tailGroups: groupTranscriptLines(tailLines),
      });
      continue;
    }

    flushPending();
    result.push(item);
  }
  flushPending();
  return result;
}

function groupTranscriptLines(
  lines: TranscriptLineRenderItem[],
  options: { forceSingleGroup?: boolean } = {},
): ProcessGroupItem[] {
  if (lines.length === 0) return [];
  if (options.forceSingleGroup) {
    return [processGroupFromLines(lines)];
  }

  const groups: ProcessGroupItem[] = [];
  let current: TranscriptLineRenderItem[] = [];
  for (const line of lines) {
    if (current.length === 0) {
      current = [line];
      continue;
    }
    const previous = current[current.length - 1];
    if (shouldStayInProcessGroup(previous, line)) {
      current.push(line);
      continue;
    }
    groups.push(processGroupFromLines(current));
    current = [line];
  }
  if (current.length > 0) groups.push(processGroupFromLines(current));
  return groups;
}

function shouldStayInProcessGroup(previous: TranscriptLineRenderItem, next: TranscriptLineRenderItem): boolean {
  if (previous.kind === 'thinking') return next.kind === 'thinking';
  if (previous.kind === 'tool') return next.kind === 'tool';
  return next.kind !== 'thinking' && next.kind !== 'tool';
}

function processGroupFromLines(lines: TranscriptLineRenderItem[]): ProcessGroupItem {
  return {
    type: 'process_group',
    id: `${lines[0].id}:group:${lines.length}`,
    header: lines[0],
    lines,
  };
}

function AssistantResponse({
  assistantAvatarSrc,
  formatAssistantContent,
  highlightedMessageId,
  item,
  onOpenThread,
  onOpenTrace,
  onResolveApproval,
  selectedThreadId,
  threadAnnotations,
}: {
  assistantAvatarSrc?: string;
  formatAssistantContent?: (content: string) => string;
  highlightedMessageId?: string;
  item: AssistantResponseItem;
  onOpenThread?: (threadId: string) => void;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
  selectedThreadId?: string;
  threadAnnotations?: Record<string, MessageThreadAnnotation>;
}) {
  const content = formatAssistantContent ? formatAssistantContent(item.message.content) : item.message.content;
  const attachments = item.message.attachments ?? [];
  const threadAnnotation = threadAnnotations?.[item.message.id];
  return (
    <article
      className={`message-row assistant-message assistant-response-row${item.message.streaming ? ' streaming-message' : ''}${highlightedMessageId === item.message.id ? ' message-source-highlight' : ''}`}
      data-message-id={item.message.id}
      data-run-id={item.message.runId}
    >
      <AssistantAvatar src={assistantAvatarSrc} />
      <div className="assistant-response-stack">
        {item.leadGroups.length > 0 ? (
          <ProcessStackContent groups={item.leadGroups} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
        ) : null}
        <div className="message-bubble-frame">
          <div className="message-bubble">
            {content ? <MarkdownContent content={content} /> : null}
            {attachments.length ? <MessageAttachmentGrid attachments={attachments} expandImages /> : null}
            {!content && attachments.length === 0 ? <p className="message-skeleton">正在组织回复...</p> : null}
          </div>
          <MessageBubbleActions content={content} createdAt={item.message.createdAt} />
        </div>
        {threadAnnotation ? (
          <MessageThreadMarker
            annotation={threadAnnotation}
            selected={Boolean(selectedThreadId && threadAnnotation.threadId === selectedThreadId)}
            onOpenThread={onOpenThread}
          />
        ) : null}
        {item.tailGroups.length > 0 ? (
          <ProcessStackContent groups={item.tailGroups} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
        ) : null}
      </div>
    </article>
  );
}

function ProcessGroup({
  assistantAvatarSrc,
  group,
  onOpenTrace,
  onResolveApproval,
}: {
  assistantAvatarSrc?: string;
  group: ProcessGroupItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  return (
    <article className={`message-row execution-flow-row process-group-row transcript-${group.header.kind}`}>
      <AssistantAvatar src={assistantAvatarSrc} />
      <ProcessGroupContent group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
    </article>
  );
}

function ProcessStack({
  assistantAvatarSrc,
  item,
  onOpenTrace,
  onResolveApproval,
}: {
  assistantAvatarSrc?: string;
  item: ProcessStackItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  return (
    <article className={`message-row execution-flow-row process-stack-row transcript-${item.groups[0]?.header.kind || 'system'}`}>
      <AssistantAvatar src={assistantAvatarSrc} />
      <div className="assistant-response-stack">
        <ProcessStackContent groups={item.groups} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
      </div>
    </article>
  );
}

function ProcessStackContent({
  groups,
  onOpenTrace,
  onResolveApproval,
}: {
  groups: ProcessGroupItem[];
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  const status = processStackStatus(groups);
  const live = status === 'running' || status === 'pending' || status === 'waiting_approval';
  const nowMs = useProcessNow(live);
  const duration = processDurationLabel(groups, live ? nowMs : undefined);
  const stepCount = groups.reduce((total, group) => total + group.lines.length, 0);
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={`process-stack process-stack-${status}`}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary className="process-stack-summary">
        <span className={`status-dot ${statusDotClass(status)}`} />
        <span className="process-stack-title">{processStackTitle(status)}</span>
        {duration ? <span className="process-stack-duration">{duration}</span> : null}
        {stepCount > 0 ? <span className="process-stack-count">{stepCount} 步</span> : null}
      </summary>
      <div className="process-stack-body">
        {groups.map((group) => (
          <ProcessGroupContent key={group.id} group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
        ))}
      </div>
    </details>
  );
}

function ProcessGroupContent({
  group,
  onOpenTrace,
  onResolveApproval,
}: {
  group: ProcessGroupItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  if (group.header.kind === 'tool') {
    const clusters = clusterToolCalls(group.lines);
    return (
      <div className="process-group process-group-flat">
        {clusters.map((cluster) => (
          cluster.lines.length === 1 ? (
            <TranscriptLineContent key={cluster.id} item={cluster.lines[0]} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
          ) : (
            <ToolCallClusterContent key={cluster.id} cluster={cluster} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
          )
        ))}
      </div>
    );
  }

  const bodyLines = group.header.kind === 'thinking' ? [] : group.lines;
  const summary = processGroupSummary(group);
  const stepLabel = group.header.kind === 'thinking'
    ? ''
    : group.lines.length === 1 ? '1 step' : `${group.lines.length} steps`;
  return (
    <details className="process-group" open>
      <summary className="process-group-summary">
        <span className={`status-dot ${statusDotClass(processGroupStatus(group.lines))}`} />
        <span className="process-group-title">{summary}</span>
        {stepLabel ? <span className="process-group-count">{stepLabel}</span> : null}
      </summary>
      {bodyLines.length > 0 ? (
        <div className="process-group-body">
          {bodyLines.map((line) => (
            <TranscriptLineContent key={line.id} item={line} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function ToolCallClusterContent({
  cluster,
  onOpenTrace,
  onResolveApproval,
}: {
  cluster: ToolCallCluster;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  const status = processGroupStatus(cluster.lines);
  return (
    <details className={`process-tool-cluster process-tool-cluster-${status}`}>
      <summary className="process-tool-cluster-summary">
        <span className={`status-dot ${statusDotClass(status)}`} />
        <span className="process-tool-cluster-title">{cluster.label}</span>
        <span className="process-tool-cluster-count">× {cluster.lines.length}</span>
      </summary>
      <div className="process-tool-cluster-body">
        {cluster.lines.map((line, index) => (
          <TranscriptLineContent
            key={line.id}
            item={line}
            labelOverride={toolCallPreview(line, index)}
            onOpenTrace={onOpenTrace}
            onResolveApproval={onResolveApproval}
            showToolDetailsInline
          />
        ))}
      </div>
    </details>
  );
}

function TranscriptLine({
  assistantAvatarSrc,
  item,
  onOpenTrace,
  onResolveApproval,
}: {
  assistantAvatarSrc?: string;
  item: TranscriptLineRenderItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  return (
    <article className={`message-row execution-flow-row transcript-line-row transcript-${item.kind}`}>
      <AssistantAvatar src={assistantAvatarSrc} />
      <TranscriptLineContent item={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
    </article>
  );
}

function AssistantAvatar({ src }: { src?: string }) {
  return src ? <img className="message-avatar assistant" src={src} alt="Joi" /> : <div className="message-avatar assistant">J</div>;
}

function TranscriptLineContent({
  item,
  labelOverride,
  onResolveApproval,
  showToolDetailsInline = false,
}: {
  item: TranscriptLineRenderItem;
  labelOverride?: string;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
  showToolDetailsInline?: boolean;
}) {
  const approval = item.status === 'waiting_approval' ? item.approval : undefined;
  const mainContent = (
    <>
      <span className={`status-dot ${statusDotClass(item.status)}`} />
      <span className="transcript-line-copy">
        <span className="transcript-line-label">{transcriptLabel(labelOverride || item.label)}</span>
        {item.detail ? <span className="transcript-line-detail"> · {transcriptDetail(item.detail)}</span> : null}
      </span>
    </>
  );

  if (item.kind === 'tool' && item.detailRows?.length) {
    if (showToolDetailsInline) {
      return (
        <div className={`transcript-line transcript-${item.kind} transcript-line-expanded`}>
          <div className="transcript-line-main">{mainContent}</div>
          <TranscriptLineDetails rows={item.detailRows} />
        </div>
      );
    }
    return (
      <details className={`transcript-line transcript-${item.kind} transcript-line-collapsible`}>
        <summary className="transcript-line-main transcript-line-summary">
          {mainContent}
        </summary>
        <TranscriptLineDetails rows={item.detailRows} />
      </details>
    );
  }

  return (
    <div className={`transcript-line transcript-${item.kind}`}>
      <div className="transcript-line-main">
        {mainContent}
      </div>
      {item.detailRows?.length ? <TranscriptLineDetails rows={item.detailRows} /> : null}
      {approval && onResolveApproval ? (
        <div className="inline-approval-strip">
          <div>
            <strong>{approval.requestedAction || '受控能力请求'}</strong>
            <small>
              操作：{approval.capability ? '使用受控能力' : '需要你的确认'}
              {approval.resourceLabel ? ` · 范围：${approval.resourceLabel}` : ''}
              {approval.riskLevel ? ` · 风险：${approval.riskLevel}` : ''}
            </small>
          </div>
          <div className="inline-approval-actions">
            <button type="button" onClick={() => onResolveApproval(approval.id, true, 'one_call')}>允许一次</button>
            <button type="button" onClick={() => onResolveApproval(approval.id, true, 'current_run')}>本任务内允许</button>
            <button type="button" onClick={() => onResolveApproval(approval.id, false, 'one_call')}>拒绝</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clusterToolCalls(lines: TranscriptLineRenderItem[]): ToolCallCluster[] {
  const clusters: ToolCallCluster[] = [];
  for (const line of lines) {
    const previous = clusters[clusters.length - 1];
    if (previous?.label === line.label) {
      previous.lines.push(line);
      continue;
    }
    clusters.push({
      id: `${line.id}:tool-cluster`,
      label: line.label,
      lines: [line],
    });
  }
  return clusters;
}

function toolCallPreview(item: TranscriptLineRenderItem, index: number): string {
  const input = item.detailRows?.find((row) => /^input$/i.test(row.label.trim()))?.value;
  const target = input ? toolInputTarget(input) : '';
  return `${index + 1} · ${target || item.label}`;
}

function toolInputTarget(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    const root = detailObject(parsed);
    const args = detailObject(root.arguments || root.args || root.input);
    const candidate = [
      args.query,
      args.url,
      args.command,
      args.path,
      args.pattern,
      root.query,
      root.url,
      root.command,
      root.path,
    ].find((item) => typeof item === 'string' && item.trim());
    if (typeof candidate === 'string') return compactToolTarget(candidate);
  } catch {
    return compactToolTarget(value);
  }
  return '';
}

function detailObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactToolTarget(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 108 ? `${normalized.slice(0, 105)}…` : normalized;
}

function TranscriptLineDetails({ rows }: { rows: NonNullable<TranscriptLineRenderItem['detailRows']> }) {
  const visibleRows = rows
    .filter((row) => !/^(command|input|request|args|arguments|metadata|raw|payload|trace)$/i.test(row.label.trim()))
    .map((row) => ({ ...row, value: transcriptDetailValue(row.value) }))
    .filter((row) => Boolean(row.value));
  if (visibleRows.length === 0) return null;
  return (
    <div className="transcript-line-details">
      <dl>
        {visibleRows.map((row) => (
          <div key={`${row.label}:${row.value.slice(0, 40)}`}>
            <dt>{transcriptLabel(row.label)}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function transcriptLabel(value: string) {
  const labels: Record<string, string> = {
    Approval: '等待确认',
    ERROR: '问题说明',
    LIMITATIONS: '限制',
    OUTPUT: '结果摘要',
    Process: '处理过程',
    RESULT: '结果摘要',
    SOURCES: '参考来源',
    Thinking: '正在思考',
    'Tool calls': '使用能力',
  };
  if (labels[value]) return labels[value];
  if (/browser[_ ]?preview/i.test(value)) return '检查网页';
  if (/_/.test(value)) return '补充信息';
  return value;
}

function transcriptDetail(value: string) {
  return value
    .replace(/browser_preview/gi, '网页检查')
    .replace(/ui_contract/gi, '界面方案')
    .replace(/thread_[a-z0-9_-]+/gi, '相关线程')
    .replace(/art_[a-z0-9_-]+/gi, '相关交付物');
}

function transcriptDetailValue(value: string) {
  const text = value.trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return `${parsed.length} 项`;
      if (parsed && typeof parsed === 'object') return '已完成处理';
    } catch {
      return '内容已隐藏';
    }
  }
  return transcriptDetail(text).slice(0, 240);
}

function processGroupSummary(group: ProcessGroupItem): string {
  if (group.header.kind === 'thinking') return '正在思考';
  if (group.header.kind === 'approval') return '等待确认';
  if (group.header.kind === 'tool') return '使用能力';
  return '处理过程';
}

function processStackTitle(status: TranscriptLineRenderItem['status']): string {
  if (status === 'failed') return '失败';
  if (status === 'waiting_approval') return '等待确认';
  if (status === 'running' || status === 'pending') return '运行中';
  return '已完成';
}

function processStackStatus(groups: ProcessGroupItem[]): TranscriptLineRenderItem['status'] {
  return processGroupStatus(groups.flatMap((group) => group.lines));
}

function processGroupStatus(lines: TranscriptLineRenderItem[]): TranscriptLineRenderItem['status'] {
  if (lines.some((line) => line.status === 'failed')) return 'failed';
  if (lines.some((line) => line.status === 'waiting_approval')) return 'waiting_approval';
  if (lines.some((line) => line.status === 'running' || line.status === 'pending')) return 'running';
  return 'completed';
}

function useProcessNow(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return nowMs;
}

function processDurationLabel(groups: ProcessGroupItem[], liveNowMs?: number): string {
  const lines = groups.flatMap((group) => group.lines);
  const runDurationMs = lines
    .map((line) => line.runDurationMs)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (runDurationMs !== undefined && liveNowMs === undefined) return formatDuration(runDurationMs);
  const runStarts = lines
    .map((line) => timestampMs(line.runStartedAt))
    .filter((value): value is number => typeof value === 'number');
  if (runStarts.length > 0) {
    const startMs = Math.min(...runStarts);
    const runEnds = lines
      .map((line) => timestampMs(line.runCompletedAt))
      .filter((value): value is number => typeof value === 'number');
    const endMs = liveNowMs ?? (runEnds.length > 0 ? Math.max(...runEnds) : Date.now());
    return formatDuration(Math.max(0, endMs - startMs));
  }
  const starts = lines
    .map((line) => timestampMs(line.startedAt) ?? timestampMs(line.completedAt))
    .filter((value): value is number => typeof value === 'number');
  if (starts.length === 0) return '';
  const startMs = Math.min(...starts);
  const completed = lines
    .map((line) => timestampMs(line.completedAt) ?? timestampMs(line.startedAt))
    .filter((value): value is number => typeof value === 'number');
  const endMs = liveNowMs ?? (completed.length > 0 ? Math.max(...completed) : Date.now());
  const durationMs = Math.max(0, endMs - startMs);
  return formatDuration(durationMs);
}

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const normalized = trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function statusDotClass(status: TranscriptLineRenderItem['status']) {
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'waiting_approval') return 'waiting';
  if (status === 'failed') return 'failed';
  return 'done';
}
