import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-chat-projection-'));
const esbuildBin = [
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'esbuild@0.27.7', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  join(root, '..', '..', '..', 'node_modules', '.pnpm', 'node_modules', '.bin', 'esbuild'),
  join(root, 'node_modules', '.bin', 'esbuild'),
].find((candidate) => existsSync(candidate)) || 'node_modules/.bin/esbuild';

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `
    export { normalizeRunEvent, normalizeRunEvents, normalizeStatus } from '${root}/src/features/chat/runEventNormalizer.ts';
    export { getEventVisibility } from '${root}/src/features/chat/eventVisibility.ts';
    export { buildConversationRenderItems } from '${root}/src/features/chat/conversationProjector.ts';
  `);
  execFileSync(esbuildBin, [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const { normalizeRunEvent, normalizeRunEvents, normalizeStatus, getEventVisibility, buildConversationRenderItems } = await import(pathToFileURL(bundle).href);

  const event = (event_type, payload = {}, extra = {}) => normalizeRunEvent({
    id: `${event_type}-${payload.seq || payload.call_id || payload.item_id || payload.task_id || Math.random()}`,
    run_id: 'run_1',
    seq: payload.seq ?? 1,
    event_type,
    payload,
    ...extra,
  });
  const message = {
    id: 'msg_assistant',
    conversation_id: 'conv_1',
    role: 'assistant',
    content: '完成了',
    metadata: { run_id: 'run_1' },
  };

  assert.equal(normalizeStatus('succeeded'), 'completed');
  assert.equal(normalizeStatus('waiting_confirmation'), 'waiting_approval');
  assert.equal(normalizeStatus('delivered'), 'completed');
  assert.equal(normalizeStatus('suppressed'), 'skipped');
  assert.equal(normalizeStatus('rejected'), 'failed');

  {
    const normalized = normalizeRunEvent({
      event_type: 'assistant.delta',
      run_id: 'run_1',
      seq: 2,
      payload: { item_type: 'assistant_message', delta: { text: 'hello', stream_source: 'fallback_final_chunk' } },
    });
    assert.equal(normalized.type, 'assistant.delta');
    assert.equal(normalized.delta.text, 'hello');
    assert.equal(normalized.delta.stream_source, 'fallback_final_chunk');
    assert.equal(getEventVisibility(normalized, 'auto'), 'chat');
  }

  assert.equal(getEventVisibility(event('item.completed', { item_type: 'reflection', status: 'completed' }), 'auto'), 'trace_only');
  assert.equal(getEventVisibility(event('policy.completed', { item_type: 'policy', status: 'completed' }), 'auto'), 'trace_only');
  assert.equal(getEventVisibility(event('workflow.completed', { item_type: 'workflow', status: 'completed' }), 'auto'), 'trace_only');
  assert.equal(getEventVisibility(event('tool.call.started', { tool_name: 'workspace_search_v1', status: 'running' }), 'auto'), 'transcript');
  assert.equal(getEventVisibility(event('tool.call.started', { tool_name: 'workspace_search_v1', status: 'running' }), 'chat_assist'), 'transcript');
  assert.equal(getEventVisibility(event('model.started', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'running', step: 0 }), 'auto'), 'trace_only');
  assert.equal(getEventVisibility(event('worker.started', { task_id: 'task_1', status: 'running' }), 'background_task'), 'trace_only');
  assert.equal(getEventVisibility(event('run.completed', { status: 'succeeded' }), 'auto'), 'hidden');
  assert.equal(getEventVisibility(event('automation.run_started', { status: 'running', summary: '自动化开始执行' }, { item_type: 'automation', visibility: 'inline_status' }), 'background_task'), 'transcript');

  {
    const expanded = normalizeRunEvents([
      { id: 'legacy-final', run_id: 'run_legacy', seq: 1, event_type: 'message.delta', payload: { delta: 'legacy answer', status: 'completed' } },
    ]);
    assert.deepEqual(expanded.map((item) => item.type), ['assistant.delta', 'assistant.completed']);
    assert.equal(expanded[0].delta.text, 'legacy answer');
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_user_stream', conversation_id: 'conv_1', role: 'user', content: 'stream please' },
      ],
      activeRunId: 'run_stream',
      runEventsByRunId: {
        run_stream: [
          event('run.started', { status: 'running', seq: 1 }, { run_id: 'run_stream' }),
          event('assistant.delta', { text: 'hello ', seq: 2 }, {
            run_id: 'run_stream',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_stream',
            visibility: 'chat',
          }),
          event('assistant.delta', { text: 'world', seq: 3 }, {
            run_id: 'run_stream',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_stream',
            visibility: 'chat',
          }),
          event('assistant.completed', { text: 'hello world', status: 'completed', seq: 4 }, {
            run_id: 'run_stream',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_stream',
            visibility: 'chat',
          }),
          event('run.completed', { status: 'succeeded', seq: 5 }, { run_id: 'run_stream' }),
        ],
      },
      mode: 'auto',
    });
    const projectedAssistant = result.items.find((item) => item.type === 'message' && item.role === 'assistant');
    assert.equal(projectedAssistant.id, 'msg_assistant_stream');
    assert.equal(projectedAssistant.content, 'hello world');
    assert.equal(projectedAssistant.streaming, false);
    assert.equal(result.activeRunStatusByRunId.run_stream, 'completed');
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_user_snapshot', conversation_id: 'conv_1', role: 'user', content: 'snapshot stream please' },
      ],
      activeRunId: 'run_snapshot',
      runEventsByRunId: {
        run_snapshot: [
          event('run.started', { status: 'running', seq: 1 }, { run_id: 'run_snapshot' }),
          event('assistant.delta', { text: '你今天心情怎么样', seq: 2 }, {
            run_id: 'run_snapshot',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_snapshot',
            visibility: 'chat',
          }),
          event('assistant.delta', { text: '你今天心情怎么样？好的～那我们换个话题吧。', seq: 3 }, {
            run_id: 'run_snapshot',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_snapshot',
            visibility: 'chat',
          }),
          event('assistant.completed', { text: '好的～那我们换个话题吧。', status: 'completed', seq: 4 }, {
            run_id: 'run_snapshot',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_snapshot',
            visibility: 'chat',
          }),
          event('run.completed', { status: 'succeeded', seq: 5 }, { run_id: 'run_snapshot' }),
        ],
      },
      mode: 'auto',
    });
    const projectedAssistant = result.items.find((item) => item.type === 'message' && item.role === 'assistant');
    assert.equal(projectedAssistant.id, 'msg_assistant_snapshot');
    assert.equal(projectedAssistant.content, '好的～那我们换个话题吧。');
    assert.equal(projectedAssistant.streaming, false);
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_user_token', conversation_id: 'conv_1', role: 'user', content: 'token stream please' },
      ],
      activeRunId: 'run_token',
      runEventsByRunId: {
        run_token: [
          event('run.started', { status: 'running', seq: 1 }, { run_id: 'run_token' }),
          event('assistant.delta', { text: '好', seq: 2 }, {
            run_id: 'run_token',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_token',
            visibility: 'chat',
          }),
          event('assistant.delta', { text: '的', seq: 3 }, {
            run_id: 'run_token',
            item_type: 'assistant_message',
            item_id: 'msg_assistant_token',
            visibility: 'chat',
          }),
          event('run.completed', { status: 'succeeded', seq: 4 }, { run_id: 'run_token' }),
        ],
      },
      mode: 'auto',
    });
    const projectedAssistant = result.items.find((item) => item.type === 'message' && item.role === 'assistant');
    assert.equal(projectedAssistant.id, 'msg_assistant_token');
    assert.equal(projectedAssistant.content, '好的');
    assert.equal(projectedAssistant.streaming, false);
  }

  {
    const result = buildConversationRenderItems({
      messages: [],
      activeRunId: 'run_auto',
      runEventsByRunId: {
        run_auto: [
          event('automation.run_started', { status: 'running', summary: 'Daily report', seq: 1 }, { run_id: 'run_auto', item_type: 'automation', item_id: 'automation_1', visibility: 'inline_status' }),
          event('automation.run_completed', { status: 'completed', summary: 'Daily report done', seq: 2 }, { run_id: 'run_auto', item_type: 'automation', item_id: 'automation_1', visibility: 'inline_status' }),
        ],
      },
      mode: 'background_task',
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, 'transcript_line');
    assert.equal(result.items[0].label, '自动化更新 · Daily report done');
    assert.equal(result.items[0].detail, 'Daily report done');
    assert.equal(result.activeRunStatusByRunId.run_auto, 'completed');
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_current', conversation_id: 'conv_1', role: 'assistant', content: 'current answer', run_id: 'run_current' },
      ],
      runEventsByRunId: {
        run_current: [
          event('tool.finished', { call_id: 'call_current', tool_name: 'web_research_v2', status: 'completed', source_url: 'https://current.example', seq: 1 }, { run_id: 'run_current' }),
        ],
        run_other: [
          event('assistant.delta', { text: 'leaked answer', seq: 1 }, {
            run_id: 'run_other',
            item_type: 'assistant_message',
            item_id: 'msg_other',
            visibility: 'chat',
          }),
          event('assistant.completed', { text: 'leaked answer', status: 'completed', seq: 2 }, {
            run_id: 'run_other',
            item_type: 'assistant_message',
            item_id: 'msg_other',
            visibility: 'chat',
          }),
        ],
      },
      mode: 'auto',
    });
    assert.equal(result.items.some((item) => item.type === 'message' && item.content === 'leaked answer'), false);
    assert.equal(result.items.some((item) => item.type === 'transcript_line' && item.label === '读取网页 · current.example'), true);
    assert.deepEqual(result.items.map((item) => item.type), ['transcript_line', 'message']);
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_null_content', conversation_id: 'conv_1', role: 'assistant', content: null },
        {
          id: 'msg_structured_content',
          conversation_id: 'conv_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'structured ' }, { content: 'answer' }],
        },
      ],
      runEventsByRunId: {},
      mode: 'auto',
    });
    assert.equal(result.items[0].type, 'message');
    assert.equal(result.items[0].content, '');
    assert.equal(result.items[1].type, 'message');
    assert.equal(result.items[1].content, 'structured answer');
  }

  {
    const normalized = normalizeRunEvent({
      id: 'mode-v2',
      run_id: 'run_1',
      schema_version: 2,
      seq: 2,
      event_type: 'run.mode_resolved',
      item_type: 'mode_resolution',
      visibility: 'inline_status',
      payload_json: { resolved_mode: 'serious_task', mode_source: 'explicit', reason: 'User selected Task.' },
    });
    assert.equal(normalized.schemaVersion, 2);
    assert.equal(getEventVisibility(normalized, 'serious_task'), 'trace_only');
  }

  {
    const redirected = normalizeRunEvent({
      id: 'redirect-v2',
      run_id: 'run_1',
      schema_version: 2,
      seq: 3,
      event_type: 'run.redirected',
      visibility: 'inline_status',
      payload_json: { status: 'redirected', reason: 'User changed direction.' },
    });
    assert.equal(redirected.status, 'redirected');
    assert.equal(getEventVisibility(redirected, 'serious_task'), 'transcript');
  }

  {
    const cancelled = normalizeRunEvent({
      id: 'cancelled-v2',
      run_id: 'run_1',
      schema_version: 2,
      seq: 5,
      event_type: 'run.cancelled',
      payload_json: { status: 'cancelled', reason: 'User cancelled.' },
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(getEventVisibility(cancelled, 'serious_task'), 'transcript');
  }

  {
    const recovery = normalizeRunEvent({
      id: 'recovery-v2',
      run_id: 'run_1',
      schema_version: 2,
      seq: 4,
      event_type: 'run.recovery_required',
      visibility: 'inline_status',
      payload_json: { recovery_status: 'needs_user_decision', reason: 'Pending approval survived restart.' },
    });
    assert.equal(recovery.status, 'waiting_approval');
    assert.equal(getEventVisibility(recovery, 'serious_task'), 'transcript');
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_user', conversation_id: 'conv_1', role: 'user', content: '你好' },
        message,
      ],
      runEventsByRunId: {
        run_1: [
          event('run.started', { status: 'running', seq: 1 }),
          event('assistant.delta', { text: '完成了', seq: 2 }),
          event('assistant.completed', { status: 'completed', seq: 3 }),
          event('foreground_run.completed', { status: 'completed', seq: 4 }),
          event('item.completed', { item_type: 'reflection', status: 'completed', seq: 5 }),
          event('run.finalized', { status: 'completed', seq: 6 }),
        ],
      },
      mode: 'auto',
    });
    assert.deepEqual(result.items.map((item) => item.type), ['message', 'message']);
    assert.equal(result.traceOnlyEventsByRunId.run_1.length, 1);
    assert.equal(result.activeRunStatusByRunId.run_1, 'completed');
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('tool.call.started', { call_id: 'call_1', tool_name: 'web_research_v2', status: 'running', seq: 1 }),
          event('tool.finished', { call_id: 'call_1', tool_name: 'web_research_v2', status: 'completed', source_url: 'https://example.com', seq: 2 }),
          event('run.completed', { status: 'succeeded', seq: 3 }),
        ],
      },
      mode: 'auto',
    });
    assert.equal(result.items[0].type, 'transcript_line');
    assert.equal(result.items[0].label, '读取网页 · example.com');
    assert.equal(result.items[0].detail, undefined);
    assert.equal(result.items[1].type, 'message');
    assert.equal(result.activeRunStatusByRunId.run_1, 'completed');
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('model.started', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'running', model: 'grok-4.3', step: 0, seq: 1 }),
          event('model.delta', {
            item_type: 'model_call',
            item_id: 'model_1',
            visibility: 'trace_only',
            status: 'running',
            step: 0,
            delta: { choices: [{ delta: { reasoning_content: 'hidden reasoning must not render', content: 'partial answer' } }] },
            seq: 2,
          }),
          event('model.completed', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'completed', step: 0, seq: 3 }),
          event('model.started', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'running', model: 'grok-4.3', step: 1, seq: 4 }),
          event('model.completed', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'completed', step: 1, seq: 5 }),
          event('tool.finished', { call_id: 'call_1', tool_name: 'web_research_v2', status: 'completed', source_url: 'https://example.com', seq: 6 }),
          event('model.started', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'running', model: 'grok-4.3', step: 2, seq: 7 }),
          event('model.completed', { item_type: 'model_call', item_id: 'model_1', visibility: 'trace_only', status: 'completed', step: 2, seq: 8 }),
          event('assistant.delta', { text: '完成了', seq: 9 }),
          event('assistant.completed', { status: 'completed', seq: 10 }),
        ],
      },
      mode: 'auto',
    });
    const transcriptLines = result.items.filter((item) => item.type === 'transcript_line');
    assert.deepEqual(transcriptLines.map((item) => item.kind), ['tool']);
    assert.deepEqual(transcriptLines.map((item) => item.label), ['读取网页 · example.com']);
    assert.equal(JSON.stringify(result.items).includes('hidden reasoning must not render'), false);
    assert.deepEqual(result.items.map((item) => item.type), ['transcript_line', 'message']);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('work_summary.updated', { item_type: 'work_summary', item_id: 'summary_1', summary: '先检查现有实现', status: 'running', step: 0, seq: 1 }),
          event('plan.updated', { item_type: 'plan', item_id: 'plan_1', summary: '接着补回归测试', status: 'running', step: 1, seq: 2 }),
          event('assistant.completed', { status: 'completed', seq: 3 }),
        ],
      },
      mode: 'auto',
    });
    const transcriptLines = result.items.filter((item) => item.type === 'transcript_line');
    assert.deepEqual(transcriptLines.map((item) => item.kind), ['thinking', 'thinking']);
    assert.deepEqual(transcriptLines.map((item) => item.label), ['Thinking', 'Thinking']);
    assert.deepEqual(transcriptLines.map((item) => item.detail), ['先检查现有实现', '接着补回归测试']);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('tool.call.started', { call_id: 'call_1', tool_name: 'workspace_search_v1', status: 'completed', seq: 1 }),
          event('tool.call.started', { call_id: 'call_2', tool_name: 'file_read', status: 'running', seq: 2 }),
        ],
      },
      mode: 'serious_task',
    });
    const transcriptLines = result.items.filter((item) => item.type === 'transcript_line');
    assert.equal(transcriptLines.length, 2);
    assert.deepEqual(transcriptLines.map((item) => item.kind), ['tool', 'tool']);
    assert.equal(result.items.some((item) => item.type === 'compact_run_card'), false);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [event('worker.started', { task_id: 'task_bg', title: '后台整理', status: 'running', seq: 1 })],
      },
      mode: 'background_task',
    });
    assert.deepEqual(result.items.map((item) => item.type), ['message']);
    assert.equal(result.items.some((item) => item.type === 'compact_run_card'), false);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('artifact.created', {
            item_type: 'artifact',
            item_id: 'artifact_1',
            artifact_id: 'artifact_1',
            title: 'verification.completed',
            artifact_type: 'verification',
            status: 'completed',
            seq: 1,
          }),
        ],
      },
      mode: 'serious_task',
    });
    assert.deepEqual(result.items.map((item) => item.type), ['message', 'transcript_line']);
    assert.equal(result.items[1].label, '生成交付物 · verification.completed');
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('assistant.delta', { text: '旧流', seq: 1 }),
          event('run.completed', { status: 'succeeded', seq: 2 }),
          event('item.completed', { item_type: 'reflection', status: 'completed', seq: 3 }),
        ],
      },
      mode: 'auto',
    });
    assert.deepEqual(result.items.map((item) => item.type), ['message']);
    assert.equal(result.activeRunStatusByRunId.run_1, 'completed');
    assert.equal(result.traceOnlyEventsByRunId.run_1.length, 1);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [
          event('memory.corrected', {
            item_type: 'memory',
            item_id: 'mem_new',
            memory_id: 'mem_new',
            previous_memory_id: 'mem_old',
            status: 'corrected',
            summary: 'Use direct status updates.',
            seq: 1,
          }),
          event('open_loop.expired', {
            item_type: 'open_loop',
            item_id: 'oloop_1',
            open_loop_id: 'oloop_1',
            status: 'expired',
            summary: 'Follow-up expired.',
            due_at: '2000-01-01T00:00:00Z',
            seq: 2,
          }),
          event('proactive.suppressed', {
            item_type: 'proactive',
            item_id: 'pmsg_1',
            proactive_message_id: 'pmsg_1',
            status: 'suppressed',
            summary: 'Repeated ignore feedback.',
            channel: 'desktop',
            seq: 3,
          }),
          event('handoff.linked', {
            item_type: 'handoff',
            item_id: 'chid_telegram',
            principal_id: 'principal_telegram',
            product_task_id: 'ptask_handoff',
            channel: 'telegram',
            status: 'completed',
            summary: 'External entry linked to conversation.',
            seq: 4,
          }),
          event('notification.resumed', {
            item_type: 'handoff',
            item_id: 'notif_1',
            notification_id: 'notif_1',
            product_task_id: 'ptask_handoff',
            channel: 'desktop',
            status: 'resumed',
            deep_link_target: 'joi://conversation/conv_1?task=ptask_handoff',
            seq: 5,
          }),
          event('run.resumed', { status: 'running', resumed_from_confirmation_id: 'confirm_1', seq: 6 }),
          event('run.cancel_requested', { status: 'running', reason: 'User requested cancel.', seq: 7 }),
          event('run.cancelled', { status: 'cancelled', reason: 'User cancelled.', seq: 8 }),
          event('run.redirected', { status: 'redirected', reason: 'User changed direction.', seq: 9 }),
        ],
      },
      mode: 'serious_task',
    });
    assert.equal(result.items.some((item) => item.type === 'memory_update'), false);
    assert.equal(result.items.some((item) => item.type === 'proactive_update'), false);
    assert.equal(result.items.some((item) => item.type === 'handoff_banner'), false);
    assert.equal(result.traceOnlyEventsByRunId.run_1.filter((item) => ['memory', 'open_loop', 'proactive', 'handoff'].includes(item.itemType)).length, 5);
    assert.equal(result.items.some((item) => item.type === 'transcript_line' && item.label.includes('Use direct status updates')), false);
    assert.equal(result.items.some((item) => item.type === 'transcript_line' && item.label.includes('External entry linked')), false);
    assert.ok(result.items.some((item) => item.type === 'transcript_line' && item.status === 'running' && item.label === '已恢复执行'));
    assert.ok(result.items.some((item) => item.type === 'transcript_line' && item.status === 'running' && item.label.includes('User requested cancel')));
    assert.ok(result.items.some((item) => item.type === 'transcript_line' && item.status === 'failed' && item.label.includes('User cancelled')));
    assert.ok(result.items.some((item) => item.type === 'transcript_line' && item.status === 'failed' && item.label.includes('User changed direction')));
    assert.equal(result.activeRunStatusByRunId.run_1, 'cancelled');
  }

  {
    const result = buildConversationRenderItems({
      messages: [
        { id: 'msg_confirm_user', conversation_id: 'conv_1', role: 'user', content: '帮我写入文件' },
        {
          id: 'msg_confirm_raw',
          conversation_id: 'conv_1',
          role: 'assistant',
          content: 'confirmation_required: apply_patch needs approval',
          metadata: { run_id: 'run_confirm' },
        },
      ],
      activeRunId: 'run_confirm',
      runEventsByRunId: {
        run_confirm: [
          event('approval.requested', {
            confirmation_id: 'confirm_1',
            capability: 'apply_patch',
            target_path: '/Users/hao/project/Joi/apps/joi-desktop/frontend/src/App.tsx',
            risk: 'workspace_write',
            status: 'waiting_confirmation',
            seq: 1,
          }, { run_id: 'run_confirm' }),
          event('run.waiting_approval', { status: 'waiting_approval', seq: 2 }, { run_id: 'run_confirm' }),
        ],
      },
      mode: 'serious_task',
    });
    assert.equal(JSON.stringify(result.items).includes('confirmation_required'), false);
    const approvalLine = result.items.find((item) => item.type === 'transcript_line' && item.kind === 'approval');
    assert.equal(approvalLine.status, 'waiting_approval');
    assert.equal(approvalLine.approval.id, 'confirm_1');
    assert.equal(approvalLine.approval.requestedAction, '写入文件');
    assert.equal(result.activeRunStatusByRunId.run_confirm, 'waiting_approval');
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
