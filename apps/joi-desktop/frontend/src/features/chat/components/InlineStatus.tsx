import type { InlineStatusRenderItem } from '../types';

export function InlineStatus({ item, onOpenTrace }: { item: InlineStatusRenderItem; onOpenTrace?: (runId: string) => void }) {
  return (
    <article className="message-row execution-flow-row">
      <div className="execution-inline-wrap">
        <div className="execution-inline-status">
          <span className={`status-dot ${statusDotClass(item.status)}`} />
          <span>{item.label}{item.detail ? ` · ${item.detail}` : ''}</span>
          {item.traceAvailable && onOpenTrace ? (
            <button className="inline-link" type="button" onClick={() => onOpenTrace(item.runId)}>查看</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function statusDotClass(status: InlineStatusRenderItem['status']) {
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'failed' || status === 'waiting_approval') return 'failed';
  return 'done';
}
