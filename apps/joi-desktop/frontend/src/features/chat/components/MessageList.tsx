import type { ReactNode } from 'react';
import { MessageBubble, MessageThreadMarker } from './MessageBubble';
import { MarkdownContent } from './MarkdownContent';
import type { ChatMessageRenderItem, ConversationRenderItem, MessageThreadAnnotation, TranscriptLineRenderItem } from '../types';

type MessageListItem =
  | ConversationRenderItem
  | ProcessGroupItem
  | AssistantResponseItem;

type ProcessGroupItem = {
  type: 'process_group';
  id: string;
  header: TranscriptLineRenderItem;
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
}) {
  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {groupProcessItems(items).map((item) => {
        if (item.type === 'message') {
          return (
            <MessageBubble
              key={item.id}
              assistantAvatarSrc={assistantAvatarSrc}
              formatAssistantContent={formatAssistantContent}
              highlighted={highlightedMessageId === item.id}
              item={item}
              onOpenThread={onOpenThread}
              threadAnnotation={threadAnnotations?.[item.id]}
              threadSelected={Boolean(selectedThreadId && threadAnnotations?.[item.id]?.threadId === selectedThreadId)}
            />
          );
        }
        if (item.type === 'assistant_response') {
          return (
            <AssistantResponse
              key={item.id}
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
        }
        if (item.type === 'process_group') {
          return <ProcessGroup key={item.id} group={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />;
        }
        return <TranscriptLine key={item.id} item={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />;
      })}
    </>
  );
}

function groupProcessItems(items: ConversationRenderItem[]): MessageListItem[] {
  const result: MessageListItem[] = [];
  let pendingLines: TranscriptLineRenderItem[] = [];

  const flushPending = () => {
    if (pendingLines.length > 0) {
      result.push(...groupTranscriptLines(pendingLines));
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
      const leadGroups = groupTranscriptLines(pendingLines, { forceSingleGroup: true });
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
        tailGroups: groupTranscriptLines(tailLines, { forceSingleGroup: true }),
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
  if (previous.kind === 'thinking') return next.kind === 'thinking' || next.kind === 'tool';
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
  const threadAnnotation = threadAnnotations?.[item.message.id];
  return (
    <article
      className={`message-row assistant-message assistant-response-row${item.message.streaming ? ' streaming-message' : ''}${highlightedMessageId === item.message.id ? ' message-source-highlight' : ''}`}
      data-message-id={item.message.id}
      data-run-id={item.message.runId}
    >
      {assistantAvatarSrc ? <img className="message-avatar assistant" src={assistantAvatarSrc} alt="Joi" /> : <div className="message-avatar assistant">J</div>}
      <div className="assistant-response-stack">
        {item.leadGroups.map((group) => (
          <ProcessGroupContent key={group.id} group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
        ))}
        <div className="message-bubble">
          {content ? <MarkdownContent content={content} /> : <p className="message-skeleton">正在组织回复...</p>}
        </div>
        {threadAnnotation ? (
          <MessageThreadMarker
            annotation={threadAnnotation}
            selected={Boolean(selectedThreadId && threadAnnotation.threadId === selectedThreadId)}
            onOpenThread={onOpenThread}
          />
        ) : null}
        {item.tailGroups.map((group) => (
          <ProcessGroupContent key={group.id} group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
        ))}
      </div>
    </article>
  );
}

function ProcessGroup({
  group,
  onOpenTrace,
  onResolveApproval,
}: {
  group: ProcessGroupItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  return (
    <article className={`message-row execution-flow-row process-group-row transcript-${group.header.kind}`}>
      <ProcessGroupContent group={group} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
    </article>
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
  const bodyLines = group.lines;
  const summary = processGroupSummary(group);
  const stepLabel = group.lines.length === 1 ? '1 step' : `${group.lines.length} steps`;
  return (
    <details className="process-group" open>
      <summary className="process-group-summary">
        <span className={`status-dot ${statusDotClass(processGroupStatus(group.lines))}`} />
        <span className="process-group-title">{summary}</span>
        <span className="process-group-count">{stepLabel}</span>
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

function TranscriptLine({
  item,
  onOpenTrace,
  onResolveApproval,
}: {
  item: TranscriptLineRenderItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  return (
    <article className={`message-row execution-flow-row transcript-line-row transcript-${item.kind}`}>
      <TranscriptLineContent item={item} onOpenTrace={onOpenTrace} onResolveApproval={onResolveApproval} />
    </article>
  );
}

function TranscriptLineContent({
  item,
  onOpenTrace,
  onResolveApproval,
}: {
  item: TranscriptLineRenderItem;
  onOpenTrace?: (runId: string) => void;
  onResolveApproval?: (approvalId: string, approve: boolean, scope?: 'one_call' | 'current_run') => void;
}) {
  const approval = item.status === 'waiting_approval' ? item.approval : undefined;
  return (
    <div className={`transcript-line transcript-${item.kind}`}>
      <div className="transcript-line-main">
        <span className={`status-dot ${statusDotClass(item.status)}`} />
        <span className="transcript-line-copy">
          <span className="transcript-line-label">{transcriptLabel(item.label)}</span>
          {item.detail ? <span className="transcript-line-detail"> · {transcriptDetail(item.detail)}</span> : null}
        </span>
        {item.traceAvailable && onOpenTrace ? (
          <button className="transcript-line-link" type="button" onClick={() => onOpenTrace(item.runId)}>查看过程</button>
        ) : null}
      </div>
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

function transcriptLabel(value: string) {
  const labels: Record<string, string> = {
    Approval: '等待确认',
    Process: '处理过程',
    Thinking: '正在思考',
    'Tool calls': '使用能力',
  };
  if (labels[value]) return labels[value];
  if (/browser[_ ]?preview/i.test(value)) return '检查网页';
  if (/[_]/.test(value)) return '使用受控能力';
  return value;
}

function transcriptDetail(value: string) {
  return value
    .replace(/browser_preview/gi, '网页检查')
    .replace(/ui_contract/gi, '界面方案')
    .replace(/thread_[a-z0-9_-]+/gi, '相关线程')
    .replace(/art_[a-z0-9_-]+/gi, '相关交付物');
}

function processGroupSummary(group: ProcessGroupItem): string {
  if (group.header.kind === 'thinking') return '正在思考';
  if (group.header.kind === 'approval') return '等待确认';
  if (group.header.kind === 'tool') return '使用能力';
  return '处理过程';
}

function processGroupStatus(lines: TranscriptLineRenderItem[]): TranscriptLineRenderItem['status'] {
  if (lines.some((line) => line.status === 'failed')) return 'failed';
  if (lines.some((line) => line.status === 'waiting_approval')) return 'waiting_approval';
  if (lines.some((line) => line.status === 'running' || line.status === 'pending')) return 'running';
  return 'completed';
}

function statusDotClass(status: TranscriptLineRenderItem['status']) {
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'waiting_approval') return 'waiting';
  if (status === 'failed') return 'failed';
  return 'done';
}
