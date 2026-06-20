import type { CompactRunCardRenderItem, CompactRunStep } from '../types';

export function CompactRunCard({ item, onOpenTrace }: { item: CompactRunCardRenderItem; onOpenTrace?: (runId: string) => void }) {
  return (
    <article className="message-row execution-flow-row">
      <div className={`execution-action-flow execution-action-flow-inline${item.collapsed ? ' is-collapsed' : ''}`}>
        <div className="execution-action-rail">
          <header className="execution-action-rail-header">
            <strong>{item.title}{item.progressLabel ? ` · ${item.progressLabel}` : ''}</strong>
            {item.traceAvailable && onOpenTrace ? <button className="inline-link" type="button" onClick={() => onOpenTrace(item.runId)}>查看</button> : null}
          </header>
          <div className="execution-action-rail-list">
            {item.steps.map((step) => <CompactRunStepRow key={step.id} step={step} />)}
          </div>
        </div>
      </div>
    </article>
  );
}

function CompactRunStepRow({ step }: { step: CompactRunStep }) {
  return (
    <div className={`execution-action-row status-${step.status}`}>
      <span className={`status-dot ${step.status === 'running' || step.status === 'pending' ? 'running' : step.status === 'failed' ? 'failed' : 'done'}`} />
      <span>
        <strong>{step.label}</strong>
        {step.summary || step.durationMs ? <small>{[step.summary, step.durationMs ? `${Math.round(step.durationMs)} ms` : ''].filter(Boolean).join(' · ')}</small> : null}
      </span>
    </div>
  );
}
