import type { ChatRequest } from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';

export function executeRequestUserInputCapability(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 'needs_user_input',
    question: String(inputs.question || '').trim(),
    options: Array.isArray(inputs.options) ? inputs.options.map(String).slice(0, 3) : [],
    header: String(inputs.header || 'Schedule').trim().slice(0, 24),
  };
}

export function executeAutomationUpdateCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: JoiSQLiteStore,
): Record<string, unknown> {
  const mode = String(inputs.mode || '').trim().toLowerCase();
  if (mode !== 'suggested_create') {
    return {
      status: 'review_required',
      mode,
      message: 'Use mode suggested_create to prepare a paused draft, then ask the user to review it in Scheduled tasks.',
    };
  }
  const name = String(inputs.name || '').trim();
  const prompt = String(inputs.prompt || '').trim();
  const rrule = String(inputs.rrule || '').trim();
  const executionKind = String(inputs.kind || 'cron').trim().toLowerCase() === 'heartbeat' ? 'heartbeat' : 'cron';
  const targetThreadID = String(inputs.target_thread_id || '').trim();
  if (!name || !prompt || !rrule) {
    return {
      status: 'invalid_proposal',
      message: 'name, prompt, and rrule are required before a scheduled-task proposal can be reviewed.',
    };
  }
  if (executionKind === 'heartbeat' && !targetThreadID) {
    return {
      status: 'needs_user_input',
      message: 'A heartbeat automation must target an existing Joi task conversation.',
    };
  }
  const cwds = Array.isArray(inputs.cwds)
    ? inputs.cwds.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : [];
  const permission = String(inputs.permission_profile || 'read_only').trim();
  const automation = store.saveAutomation({
    kind: 'schedule',
    execution_kind: executionKind,
    name,
    enabled: false,
    prompt_template: prompt,
    trigger_config: {
      type: 'rrule',
      rrule,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    rrule,
    model: String(inputs.model || '').trim() || undefined,
    reasoning_effort: String(inputs.reasoning_effort || '').trim() || undefined,
    execution_environment: 'local',
    target: executionKind === 'heartbeat'
      ? { type: 'thread', thread_id: targetThreadID }
      : cwds[0]
        ? { type: 'workspace', cwd: cwds[0] }
        : { type: 'projectless' },
    cwds,
    target_thread_id: targetThreadID || undefined,
    conversation_id: executionKind === 'heartbeat' ? targetThreadID : undefined,
    input_mode: 'background_task',
    permission_profile: permission === 'workspace_write' || permission === 'danger_full_access' ? permission : 'read_only',
    preferred_node: 'main-node',
    allow_worker: false,
    retry_policy: {
      max_attempts: 2,
      backoff_seconds: [60, 300],
      no_retry_error_codes: ['POLICY_DENIED', 'INVALID_PAYLOAD', 'PENDING_CONFIRMATION'],
    },
    max_concurrency: 1,
    is_draft: true,
    metadata: {
      suggested_by: 'joi_chat',
      suggested_at: new Date().toISOString(),
      source_conversation_id: req.conversation_id || '',
      source_channel: req.channel || 'desktop',
    },
  });
  return {
    status: 'suggested_create',
    automation_id: automation.id,
    mode: 'create',
    review_required: true,
    snapshot: automation,
    message: 'The paused draft is ready for review in Scheduled tasks. It will not run until the user saves and activates it.',
  };
}
