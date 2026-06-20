import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-chat-projection-'));

try {
  const entry = join(outDir, 'entry.ts');
  const bundle = join(outDir, 'bundle.mjs');
  writeFileSync(entry, `
    export { normalizeRunEvent, normalizeStatus } from '${root}/src/features/chat/runEventNormalizer.ts';
    export { getEventVisibility } from '${root}/src/features/chat/eventVisibility.ts';
    export { buildConversationRenderItems } from '${root}/src/features/chat/conversationProjector.ts';
  `);
  execFileSync('node_modules/.bin/esbuild', [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2020',
    '--outfile=' + bundle,
  ], { cwd: root, stdio: 'inherit' });

  const { normalizeRunEvent, normalizeStatus, getEventVisibility, buildConversationRenderItems } = await import(pathToFileURL(bundle).href);

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
  assert.equal(getEventVisibility(event('tool.call.started', { tool_name: 'workspace_search_v1', status: 'running' }), 'auto'), 'inline');
  assert.equal(getEventVisibility(event('tool.call.started', { tool_name: 'workspace_search_v1', status: 'running' }), 'chat_assist'), 'trace_only');
  assert.equal(getEventVisibility(event('worker.started', { task_id: 'task_1', status: 'running' }), 'background_task'), 'task');
  assert.equal(getEventVisibility(event('run.completed', { status: 'succeeded' }), 'auto'), 'hidden');

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
    assert.equal(result.items[1].type, 'inline_status');
    assert.equal(result.items[1].detail, 'example.com');
    assert.equal(result.activeRunStatusByRunId.run_1, 'completed');
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
    assert.equal(result.items[1].type, 'compact_run_card');
    assert.equal(result.items[1].steps.length, 2);
  }

  {
    const result = buildConversationRenderItems({
      messages: [message],
      runEventsByRunId: {
        run_1: [event('worker.started', { task_id: 'task_bg', title: '后台整理', status: 'running', seq: 1 })],
      },
      mode: 'background_task',
    });
    assert.equal(result.items[1].type, 'task_entry');
    assert.equal(result.items[1].taskId, 'task_bg');
    assert.equal(result.items.some((item) => item.type === 'compact_run_card'), false);
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
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
