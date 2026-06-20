import type { ChatInputMode, NormalizedRunEvent } from './types';

export type EventVisibility =
  | 'chat'
  | 'inline'
  | 'compact'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'trace_only'
  | 'hidden';

export function getEventVisibility(event: NormalizedRunEvent, mode: ChatInputMode): EventVisibility {
  const type = event.type;
  const itemType = event.itemType;

  if (type === 'assistant.delta' || type === 'assistant.completed') return 'chat';
  if (type === 'approval.required' || type === 'approval.requested') return 'approval';
  if (type === 'artifact.created') return 'artifact';

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

  if (itemType === 'worker') {
    if (mode === 'background_task') return 'task';
    if (mode === 'serious_task') return 'compact';
    if (mode === 'chat_assist') return 'trace_only';
    return 'inline';
  }

  if (itemType === 'task') {
    if (mode === 'chat_assist') return 'trace_only';
    return mode === 'background_task' ? 'task' : 'compact';
  }

  if (itemType === 'tool' || itemType === 'capability' || itemType === 'node') {
    if (mode === 'chat_assist') return 'trace_only';
    if (mode === 'serious_task') return 'compact';
    if (mode === 'background_task') return 'task';
    return 'inline';
  }

  return 'trace_only';
}
