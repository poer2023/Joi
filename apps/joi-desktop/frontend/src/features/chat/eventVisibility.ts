import type { ChatInputMode, NormalizedRunEvent } from './types';

export type EventVisibility =
  | 'chat'
  | 'transcript'
  | 'inline'
  | 'compact'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'memory'
  | 'proactive'
  | 'handoff'
  | 'trace_only'
  | 'hidden';

export function getEventVisibility(event: NormalizedRunEvent, mode: ChatInputMode): EventVisibility {
  const type = event.type;
  const itemType = event.itemType;
  const declared = normalizeDeclaredVisibility(event.visibility);

  // The composer already renders pending queue entries as cancellable chips and
  // delivered entries become normal user messages. Re-projecting the queue
  // lifecycle as transcript rows leaves a stale "pending" row beside a
  // completed run, which looks like the agent is still working. Keep the full
  // lifecycle in Run Trace without duplicating it in the conversation.
  if (isRunMessageQueueEvent(type)) {
    return 'trace_only';
  }

  if (declared === 'hidden') {
    return 'hidden';
  }

  if (type === 'run.failed' || type === 'run.cancelled' || type === 'run.interrupted' || type === 'turn.aborted') {
    return 'transcript';
  }

  if (itemType === 'automation' || type.startsWith('automation.')) {
    return event.status === 'failed' || event.status === 'cancelled' ? 'transcript' : 'trace_only';
  }

  if (declared === 'trace_only' || declared === 'chat') {
    return declared;
  }
  if (declared === 'transcript') return 'transcript';
  if (declared === 'approval') return 'transcript';
  if (declared === 'artifact') return 'trace_only';
  if (declared === 'task') {
    return 'trace_only';
  }
  if (declared === 'tool') {
    return 'transcript';
  }
  if (declared === 'memory' || declared === 'proactive' || declared === 'handoff') {
    return 'trace_only';
  }
  if (declared === 'inline_status') {
    if (type === 'run.mode_resolved' || itemType === 'model' || itemType === 'mode_resolution') return 'trace_only';
    return 'transcript';
  }

  if (isExecutionProcessEvent(event)) {
    return 'transcript';
  }

  if (type === 'assistant.delta' || type === 'assistant.completed') return 'chat';
  if (type === 'work_summary.updated' || type === 'plan.created' || type === 'plan.updated') return 'transcript';
  if (type === 'approval.required' || type === 'approval.requested') return 'transcript';
  if (type === 'artifact.created' || type.startsWith('verification.')) return 'trace_only';
  if (type === 'run.mode_resolved') return 'trace_only';
  if (type === 'run.resumed' || type === 'run.redirected' || type === 'run.recovery_required' || type === 'run.cancel_requested' || type === 'run.cancelled' || type === 'run.failed') return 'transcript';

  if (itemType === 'memory') return 'trace_only';
  if (itemType === 'open_loop' || itemType === 'proactive') return 'trace_only';
  if (itemType === 'handoff') return 'trace_only';
  if (itemType === 'artifact') return 'trace_only';
  if (itemType === 'reflection') return 'trace_only';
  if (itemType === 'policy' || itemType === 'workflow' || itemType === 'memory' || itemType === 'model') return 'trace_only';

  if (
    type === 'run.started'
    || type === 'run.completed'
    || type === 'foreground_run.completed'
    || type === 'run.finalized'
    || type === 'run.waiting_tool'
    || type === 'run.waiting_confirmation'
  ) {
    return 'hidden';
  }

  if (itemType === 'worker') return 'trace_only';

  if (itemType === 'task') {
    return 'trace_only';
  }

  if (itemType === 'tool' || itemType === 'capability' || itemType === 'node') {
    return 'transcript';
  }

  return 'trace_only';
}

function isRunMessageQueueEvent(type: string): boolean {
  return type === 'run.message_queue_drained'
    || type === 'run.message_queue_cancelled'
    || /^run\.message_(?:steering|follow_up)_(?:queued|delivered|cancelled)$/.test(type);
}

function isExecutionProcessEvent(event: NormalizedRunEvent): boolean {
  const type = event.type.toLowerCase();
  const itemType = event.itemType.toLowerCase();
  if (
    type === 'work_summary.updated'
    || type === 'plan.created'
    || type === 'plan.updated'
    || type.startsWith('tool.')
    || type.startsWith('approval.')
    || type.startsWith('artifact.')
    || type.startsWith('verification.')
  ) {
    return true;
  }
  if (
    type === 'run.resumed'
    || type === 'run.redirected'
    || type === 'run.recovery_required'
    || type === 'run.cancel_requested'
    || type === 'run.cancelled'
    || type === 'run.failed'
    || type === 'run.interrupted'
  ) {
    return true;
  }
  return (
    itemType === 'tool'
    || itemType === 'tool_run'
    || itemType === 'capability'
    || itemType === 'node'
    || itemType === 'approval'
    || itemType === 'artifact'
    || itemType === 'task'
  );
}

function normalizeDeclaredVisibility(value: string | undefined): string {
  const visibility = (value || '').trim();
  if (visibility === 'inline_status') return 'inline_status';
  if (visibility === 'tool') return 'tool';
  if (visibility === 'memory') return 'memory';
  if (visibility === 'proactive') return 'proactive';
  if (visibility === 'handoff') return 'handoff';
  if (visibility === 'chat' || visibility === 'transcript' || visibility === 'task' || visibility === 'approval' || visibility === 'artifact' || visibility === 'trace_only' || visibility === 'hidden') {
    return visibility;
  }
  return '';
}
