import type { NormalizedRunEvent } from '../types';

export function TraceDrawer({ events }: { events: NormalizedRunEvent[] }) {
  if (events.length === 0) {
    return <p className="empty">暂无事件。</p>;
  }
  return (
    <ol className="run-event-list">
      {events.map((event) => (
        <li key={event.id}>
          <strong>#{event.seq || '-'} {event.type}</strong>
          <span>{event.itemType || 'event'} · {event.status}</span>
          {event.title || event.summary || event.error ? (
            <small>{[event.title, event.summary, event.error].filter(Boolean).join(' · ')}</small>
          ) : null}
          <details>
            <summary>JSON</summary>
            <pre>{JSON.stringify({ delta: event.delta, snapshot: event.snapshot, metadata: event.metadata, raw: event.raw }, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}
