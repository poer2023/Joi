import type { ReactNode } from 'react';
import { CompactRunCard } from './CompactRunCard';
import { InlineStatus } from './InlineStatus';
import { MessageBubble } from './MessageBubble';
import { TaskEntry } from './TaskEntry';
import type { ApprovalRenderItem, ArtifactRenderItem, ConversationRenderItem } from '../types';

export function MessageList({
  assistantAvatarSrc,
  emptyState,
  formatAssistantContent,
  items,
  onOpenArtifact,
  onOpenTask,
  onOpenTrace,
}: {
  assistantAvatarSrc?: string;
  emptyState?: ReactNode;
  formatAssistantContent?: (content: string) => string;
  items: ConversationRenderItem[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenTrace?: (runId: string) => void;
}) {
  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {items.map((item) => {
        if (item.type === 'message') {
          return <MessageBubble key={item.id} assistantAvatarSrc={assistantAvatarSrc} formatAssistantContent={formatAssistantContent} item={item} />;
        }
        if (item.type === 'inline_status') {
          return <InlineStatus key={item.id} item={item} onOpenTrace={onOpenTrace} />;
        }
        if (item.type === 'compact_run_card') {
          return <CompactRunCard key={item.id} item={item} onOpenTrace={onOpenTrace} />;
        }
        if (item.type === 'task_entry') {
          return <TaskEntry key={item.id} item={item} onOpenTask={onOpenTask} />;
        }
        if (item.type === 'approval') {
          return <ApprovalEntry key={item.id} item={item} />;
        }
        return <ArtifactEntry key={item.id} item={item} onOpenArtifact={onOpenArtifact} />;
      })}
    </>
  );
}

function ApprovalEntry({ item }: { item: ApprovalRenderItem }) {
  return (
    <article className="message-row execution-flow-row">
      <div className="chat-task-entry approval-entry">
        <span className="status-dot failed" />
        <span>
          <strong>{item.title}</strong>
          <small>{[item.summary, item.riskLevel, item.status].filter(Boolean).join(' · ')}</small>
        </span>
      </div>
    </article>
  );
}

function ArtifactEntry({ item, onOpenArtifact }: { item: ArtifactRenderItem; onOpenArtifact?: (artifactId: string) => void }) {
  return (
    <article className="message-row execution-flow-row">
      <div className="chat-task-entry artifact-entry">
        <span className="status-dot done" />
        <span>
          <strong>{item.title}</strong>
          <small>{item.artifactType}</small>
        </span>
        {onOpenArtifact ? <button className="inline-link" type="button" onClick={() => onOpenArtifact(item.artifactId)}>打开</button> : null}
      </div>
    </article>
  );
}
