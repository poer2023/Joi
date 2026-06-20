import type { TaskEntryRenderItem } from '../types';

export function TaskEntry({ item, onOpenTask }: { item: TaskEntryRenderItem; onOpenTask?: (taskId: string) => void }) {
  return (
    <article className="message-row execution-flow-row">
      <div className="chat-task-entry">
        <span className={`status-dot ${item.status === 'running' || item.status === 'queued' ? 'running' : item.status === 'failed' ? 'failed' : 'done'}`} />
        <span>
          <strong>{item.title}</strong>
          {item.summary ? <small>{item.summary}</small> : null}
        </span>
        {onOpenTask ? <button className="inline-link" type="button" onClick={() => onOpenTask(item.taskId)}>查看任务</button> : null}
      </div>
    </article>
  );
}
