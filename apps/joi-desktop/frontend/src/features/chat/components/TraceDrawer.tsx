import type { NormalizedRunEvent } from '../types';

export function TraceDrawer({ events }: { events: NormalizedRunEvent[] }) {
  if (events.length === 0) {
    return <p className="empty">暂无事件。</p>;
  }
  return (
    <ol className="run-event-list">
      {events.map((event) => (
        <li key={event.id}>
          <strong>{eventDisplayTitle(event)}</strong>
          <span>{eventStatusLabel(event.status)}</span>
          {event.error ? <small>本步骤遇到问题，请在“支持”中导出诊断包后继续排查。</small> : null}
        </li>
      ))}
    </ol>
  );
}

function eventDisplayTitle(event: NormalizedRunEvent) {
  const candidate = (event.title || event.summary || '').trim();
  if (!candidate) return eventTypeLabel(event.type);
  const cleaned = candidate
    .replace(/browser_preview/gi, '网页检查')
    .replace(/ui_contract/gi, '界面方案')
    .replace(/thread_[a-z0-9_-]+/gi, '相关线程')
    .replace(/art_[a-z0-9_-]+/gi, '相关交付物');
  return /[_]|\b(?:tool|runtime|trace|payload)\b/i.test(cleaned) ? eventTypeLabel(event.type) : cleaned;
}

function eventTypeLabel(value: string) {
  if (value.includes('tool')) return '使用能力';
  if (value.includes('model') || value.includes('assistant')) return '生成回复';
  if (value.includes('memory')) return '参考记忆';
  if (value.includes('route')) return '选择处理方式';
  if (value.includes('complete')) return '完成任务';
  if (value.includes('fail') || value.includes('error')) return '处理遇到问题';
  return '处理任务';
}

function eventStatusLabel(value: string) {
  const labels: Record<string, string> = {
    blocked: '已阻止',
    completed: '已完成',
    failed: '失败',
    pending: '等待中',
    queued: '排队中',
    running: '进行中',
    waiting_approval: '等待确认',
  };
  return labels[value] || '已记录';
}
