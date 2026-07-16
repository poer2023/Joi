import { MessageScroller } from '@shadcn/react/message-scroller';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollArea } from '../../../components/ScrollArea';
import { MessageAttachmentGrid, MessageBubble, MessageBubbleActions, MessageThreadMarker } from './MessageBubble';
import { MarkdownContent } from './MarkdownContent';
import type { ChatMessageRenderItem, ConversationRenderItem, MessageThreadAnnotation, NormalizedStatus, TranscriptLineRenderItem } from '../types';

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
          id: `${groups[0].header.runId}:process-stack:${groups[0].header.id}`,
          groups,
        });
      }
      pendingLines = [];
    }
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'transcript_line') {
      if (pendingLines.length > 0 && pendingLines[pendingLines.length - 1].runId !== item.runId) {
        flushPending();
      }
      pendingLines.push(item);
      continue;
    }

    if (item.role === 'assistant') {
      if (!item.runId || pendingLines.some((line) => line.runId !== item.runId)) {
        flushPending();
      }
      const leadGroups = groupTranscriptLines(pendingLines);
      const tailLines: TranscriptLineRenderItem[] = [];
      pendingLines = [];
      while (
        items[index + 1]?.type === 'transcript_line'
        && (!item.runId || (items[index + 1] as TranscriptLineRenderItem).runId === item.runId)
      ) {
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
  if (previous.runId !== next.runId) return false;
  if (previous.kind === 'thinking') {
    return next.kind === 'thinking' && previous.label === 'Thinking' && next.label === 'Thinking';
  }
  if (previous.kind === 'tool') return next.kind === 'tool';
  return next.kind !== 'thinking' && next.kind !== 'tool';
}

function processGroupFromLines(lines: TranscriptLineRenderItem[]): ProcessGroupItem {
  return {
    type: 'process_group',
    id: `${lines[0].id}:group`,
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
  const lines = groups.flatMap((group) => group.lines);
  const outcome = terminalProcessOutcome(lines);
  const status = processGroupStatus(lines);
  const failedCount = outcome === 'cancelled' || outcome === 'redirected'
    ? 0
    : processFailureCount(lines);
  const live = status === 'running' || status === 'pending' || status === 'waiting_approval';
  const nowMs = useProcessNow(live);
  const duration = processDurationLabel(groups, live ? nowMs : undefined);
  const [expanded, setExpanded] = useState(() => live);
  useEffect(() => {
    if (live) setExpanded(true);
  }, [live]);
  return (
    <section
      className={`process-stack process-stack-${status}`}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        aria-expanded={expanded}
        className="process-stack-summary disclosure-trigger"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <ToolActivityIcon label={primaryToolLabel(groups)} status={status} />
        <span className="process-stack-title">{processStackSummary(groups, status, outcome)}</span>
        {failedCount > 0 && status !== 'failed'
          ? <span className="process-stack-failure-count">{failedCount} 项失败</span>
          : null}
        {duration ? <span className="process-stack-duration">· {duration}</span> : null}
        <DisclosureChevron />
      </button>
      <div aria-hidden={!expanded} className="disclosure-panel process-stack-panel">
        <div className="disclosure-panel-inner">
          <div className="process-stack-body">
            {groups.map((group) => (
              <ProcessGroupContent key={group.id} group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
            ))}
          </div>
        </div>
      </div>
    </section>
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
            <TranscriptLineContent
              key={cluster.id}
              item={cluster.lines[0]}
              labelOverride={toolCallPreview(cluster.lines[0])}
              onOpenTrace={onOpenTrace}
              onResolveApproval={onResolveApproval}
            />
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
  const failedCount = processFailureCount(cluster.lines);
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className={`process-tool-cluster process-tool-cluster-${status}`}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        aria-expanded={expanded}
        className="process-tool-cluster-summary disclosure-trigger"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <ToolActivityIcon label={cluster.label} status={status} />
        <span className="process-tool-cluster-title">{cluster.label}</span>
        <span className="process-tool-cluster-count">× {cluster.lines.length}</span>
        {failedCount > 0 && status !== 'failed'
          ? <span className="process-tool-cluster-failure-count">{failedCount} 失败</span>
          : null}
        <DisclosureChevron />
      </button>
      <div aria-hidden={!expanded} className="disclosure-panel process-tool-cluster-panel">
        <div className="disclosure-panel-inner">
          <div className="process-tool-cluster-body">
            {cluster.lines.map((line, index) => (
              <TranscriptLineContent
                key={line.id}
                item={line}
                labelOverride={toolCallPreview(line, index)}
                onOpenTrace={onOpenTrace}
                onResolveApproval={onResolveApproval}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
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
}: {
  item: TranscriptLineRenderItem;
  labelOverride?: string;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  const approval = item.status === 'waiting_approval' ? item.approval : undefined;
  const [expanded, setExpanded] = useState(false);
  const resolvedLabel = labelOverride || item.label;
  const mainContent = (
    <>
      {item.kind === 'tool'
        ? <ToolActivityIcon label={resolvedLabel} status={item.status} />
        : <span className={`status-dot ${statusDotClass(item.status)}`} />}
      <span className="transcript-line-copy">
        <span className="transcript-line-label">{transcriptLabel(resolvedLabel)}</span>
        {item.detail ? <span className="transcript-line-detail"> · {transcriptDetail(item.detail)}</span> : null}
      </span>
    </>
  );

  if (item.kind === 'tool' && item.detailRows?.length) {
    return (
      <section
        className={`transcript-line transcript-${item.kind} transcript-line-collapsible`}
        data-expanded={expanded ? 'true' : 'false'}
      >
        <button
          aria-expanded={expanded}
          className="transcript-line-main transcript-line-summary disclosure-trigger"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {mainContent}
          <DisclosureChevron />
        </button>
        <div aria-hidden={!expanded} className="disclosure-panel transcript-line-panel">
          <div className="disclosure-panel-inner">
            <TranscriptLineDetails rows={item.detailRows} />
          </div>
        </div>
      </section>
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

function toolCallPreview(item: TranscriptLineRenderItem, index?: number): string {
  const input = item.detailRows?.find((row) => /^input$/i.test(row.label.trim()))?.value;
  const target = input ? toolInputTarget(input) : '';
  if (index !== undefined) return `${index + 1} · ${target || item.label}`;
  if (!target || item.label.toLowerCase().includes(target.toLowerCase())) return item.label;
  return `${item.label} · ${target}`;
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
  const rawRow = [...rows].reverse().find((row) => /^raw$/i.test(row.label.trim()));
  const visibleRows = rows
    .filter((row) => !/^(input|command|request|args|arguments|metadata|raw|payload|trace)$/i.test(row.label.trim()))
    .map((row) => ({ ...row, value: transcriptDetailValue(row.value) }))
    .filter((row) => Boolean(row.value));
  const rawValue = rawRow ? transcriptDetailValue(rawRow.value) : '';
  if (visibleRows.length === 0 && !rawValue) return null;
  return (
    <div className="transcript-line-details">
      {visibleRows.length > 0 ? (
        <dl>
          {visibleRows.map((row) => (
            <div key={`${row.label}:${row.value.slice(0, 40)}`}>
              <dt>{transcriptLabel(row.label)}</dt>
              <dd>
                {isBlockDetailValue(row.value) ? (
                  <ScrollArea
                    axes="both"
                    className="transcript-detail-scroll-area"
                    contentClassName="transcript-detail-scroll-content"
                    trackVisibility="always"
                    viewportAriaLabel={`${transcriptLabel(row.label)}内容`}
                    viewportTabIndex={0}
                  >
                    <pre className="transcript-detail-value">{row.value}</pre>
                  </ScrollArea>
                ) : (
                  <span className="transcript-detail-value">{row.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rawValue ? (
        <details className="transcript-raw-disclosure">
          <summary>查看原始调用</summary>
          <ScrollArea
            axes="both"
            className="transcript-detail-scroll-area"
            contentClassName="transcript-detail-scroll-content"
            trackVisibility="always"
            viewportAriaLabel="原始调用内容"
            viewportTabIndex={0}
          >
            <pre className="transcript-detail-value">{rawValue}</pre>
          </ScrollArea>
        </details>
      ) : null}
    </div>
  );
}

function DisclosureChevron() {
  return (
    <svg aria-hidden="true" className="disclosure-chevron" viewBox="0 0 16 16">
      <path d="m6.5 5.5 2.5 2.5-2.5 2.5" />
    </svg>
  );
}

function ToolActivityIcon({
  label,
  status,
}: {
  label: string;
  status: TranscriptLineRenderItem['status'];
}) {
  const lower = label.toLowerCase();
  const iconClass = `tool-activity-icon tool-activity-icon-${statusDotClass(status)}`;
  if (/网页|web|browser|url|http/.test(lower)) {
    return (
      <svg aria-hidden="true" className={iconClass} viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.8 8h10.4M8 2.5c1.5 1.5 2.2 3.3 2.2 5.5S9.5 12 8 13.5M8 2.5C6.5 4 5.8 5.8 5.8 8S6.5 12 8 13.5" />
      </svg>
    );
  }
  if (/命令|command|shell|terminal/.test(lower)) {
    return (
      <svg aria-hidden="true" className={iconClass} viewBox="0 0 16 16">
        <rect x="2.25" y="3" width="11.5" height="10" rx="2" />
        <path d="m4.75 6 2 2-2 2M8.5 10h2.75" />
      </svg>
    );
  }
  if (/文件|workspace|search|read|write|path/.test(lower)) {
    return (
      <svg aria-hidden="true" className={iconClass} viewBox="0 0 16 16">
        <path d="M4 2.5h5l3 3V13.5H4zM9 2.5v3h3M6 8h4M6 10.5h4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={iconClass} viewBox="0 0 16 16">
      <path d="M9.7 3.1a3 3 0 0 0-3.6 3.8L2.8 10.2a1.4 1.4 0 0 0 2 2l3.3-3.3a3 3 0 0 0 3.8-3.6L10 7.2 8.8 6z" />
    </svg>
  );
}

function transcriptLabel(value: string) {
  const labels: Record<string, string> = {
    Approval: '等待确认',
    ERROR: '错误',
    INPUT: '输入',
    LIMITATIONS: '限制',
    OUTPUT: '输出',
    'OUTPUT DELTA': '实时输出',
    Process: '处理过程',
    RESULT: '输出',
    SOURCES: '参考来源',
    Thinking: '正在思考',
    'Tool calls': '使用能力',
  };
  if (labels[value]) return labels[value];
  if (labels[value.toUpperCase()]) return labels[value.toUpperCase()];
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
      return boundedToolDetail(JSON.stringify(parsed, null, 2));
    } catch {
      return boundedToolDetail(transcriptDetail(text));
    }
  }
  return boundedToolDetail(transcriptDetail(text));
}

function isBlockDetailValue(value: string): boolean {
  return value.includes('\n') || value.length > 160 || value.startsWith('{') || value.startsWith('[');
}

function boundedToolDetail(value: string): string {
  const maxCharacters = 50_000;
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, maxCharacters)}\n\n… 聊天内省略 ${value.length - maxCharacters} 个字符，原始结果仍保存在 Run Trace。`;
}

function processGroupSummary(group: ProcessGroupItem): string {
  if (group.header.kind === 'thinking') {
    if (group.header.label === 'Thinking') return '正在思考';
    const label = transcriptLabel(group.header.label);
    return group.header.detail ? `${label} · ${transcriptDetail(group.header.detail)}` : label;
  }
  if (group.header.kind === 'approval') return '等待确认';
  if (group.header.kind === 'tool') return '使用能力';
  return '处理过程';
}

function primaryToolLabel(groups: ProcessGroupItem[]): string {
  return groups.flatMap((group) => group.lines).find((line) => line.kind === 'tool')?.label || '处理过程';
}

function processStackSummary(
  groups: ProcessGroupItem[],
  status: TranscriptLineRenderItem['status'],
  outcome?: NormalizedStatus,
): string {
  if (outcome === 'cancelled') return '已取消';
  if (outcome === 'redirected') return '已转向';
  if (outcome === 'blocked') return '已阻止';
  if (status === 'failed') return '处理失败';
  if (status === 'waiting_approval') return '等待确认';

  const lines = groups.flatMap((group) => group.lines);
  const activities = [...new Set(lines
    .filter((line) => line.kind === 'tool')
    .map((line) => completedToolActivity(line.label))
    .filter(Boolean))];
  if (status === 'running' || status === 'pending') {
    const active = [...lines].reverse().find((line) => line.status === 'running' || line.status === 'pending');
    return active?.kind === 'tool' ? runningToolActivity(active.label) : '正在处理';
  }
  if (activities.length === 0) return lines.some((line) => line.kind === 'thinking') ? '已思考' : '已完成';
  if (activities.length === 1) return activities[0];
  return `${activities.slice(0, -1).join('、')}并${activities[activities.length - 1]}`;
}

function completedToolActivity(label: string): string {
  const lower = label.toLowerCase();
  if (/查找工具|tool search/.test(lower)) return '查找了工具';
  if (/搜索会话|session search/.test(lower)) return '搜索了会话';
  if (/读取会话上下文|session summary/.test(lower)) return '读取了会话';
  if (/操作终端/.test(lower)) return '操作了终端';
  if (/运行命令|command|shell|terminal/.test(lower)) return '运行了命令';
  if (/写入文件|edit|write|patch/.test(lower)) return '编辑了文件';
  if (/读取网页|extract|fetch|open url/.test(lower)) return '读取了网页';
  if (/网页搜索|web search|search web/.test(lower)) return '搜索了网页';
  if (/工作区搜索|workspace|grep|\brg\b/.test(lower)) return '搜索了工作区';
  if (/读取文件|read file|path/.test(lower)) return '读取了文件';
  if (/记忆|memory/.test(lower)) return '检索了记忆';
  return '使用了能力';
}

function runningToolActivity(label: string): string {
  return completedToolActivity(label)
    .replace(/^运行了/, '正在运行')
    .replace(/^编辑了/, '正在编辑')
    .replace(/^读取了/, '正在读取')
    .replace(/^搜索了/, '正在搜索')
    .replace(/^检索了/, '正在检索')
    .replace(/^使用了/, '正在使用');
}

function processGroupStatus(lines: TranscriptLineRenderItem[]): TranscriptLineRenderItem['status'] {
  const runOutcome = terminalProcessOutcome(lines);
  if (runOutcome === 'failed' || runOutcome === 'blocked' || runOutcome === 'cancelled' || runOutcome === 'redirected') return 'failed';
  if (runOutcome === 'completed' || runOutcome === 'skipped') return 'completed';
  if (lines.some((line) => line.status === 'waiting_approval')) return 'waiting_approval';
  if (lines.some((line) => line.status === 'running' || line.status === 'pending')) return 'running';
  const actionableLines = lines.filter((line) => line.kind !== 'thinking');
  const terminalLines = actionableLines.length > 0 ? actionableLines : lines;
  const hasFailed = terminalLines.some((line) => line.status === 'failed');
  const hasSucceeded = terminalLines.some((line) => line.status === 'completed');
  if (hasFailed && !hasSucceeded) return 'failed';
  return 'completed';
}

function terminalProcessOutcome(lines: TranscriptLineRenderItem[]): NormalizedStatus | undefined {
  const outcomes = lines.map((line) => line.runOutcome).filter((value): value is NormalizedStatus => Boolean(value));
  if (outcomes.includes('cancelled')) return 'cancelled';
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('blocked')) return 'blocked';
  if (outcomes.includes('redirected')) return 'redirected';
  if (outcomes.includes('completed')) return 'completed';
  if (outcomes.includes('skipped')) return 'skipped';
  return undefined;
}

function processFailureCount(lines: TranscriptLineRenderItem[]): number {
  const actionableLines = lines.filter((line) => line.kind !== 'thinking');
  const countedLines = actionableLines.length > 0 ? actionableLines : lines;
  return countedLines.filter((line) => line.status === 'failed').length;
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
    const observedEnds = lines
      .map((line) => timestampMs(line.completedAt) ?? timestampMs(line.startedAt))
      .filter((value): value is number => typeof value === 'number');
    const fixedEndMs = runEnds.length > 0
      ? Math.max(...runEnds)
      : observedEnds.length > 0
        ? Math.max(...observedEnds)
        : startMs;
    const endMs = liveNowMs ?? fixedEndMs;
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
  const endMs = liveNowMs ?? (completed.length > 0 ? Math.max(...completed) : startMs);
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
