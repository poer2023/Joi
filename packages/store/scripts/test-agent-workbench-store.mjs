import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-agent-workbench-store-'));

try {
  const store = new JoiSQLiteStore({
    dbPath: join(tempDir, 'joi.db'),
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'test',
  });

  const active = store.beginToolCallingChat({ message: 'active queue run', runtime_mode: 'tool_calling' }, {
    provider: 'deterministic_provider',
    model_name: 'deterministic-local-model',
    model_selection_policy: 'settings_preferred',
  });
  const steering = store.enqueueRunMessage({ run_id: active.run_id, kind: 'steering', content: 'focus on the second check' });
  const followUp = store.enqueueRunMessage({ run_id: active.run_id, kind: 'follow_up', content: 'then summarize evidence' });
  assert.equal(store.listRunMessages({ run_id: active.run_id, status: 'pending' }).messages.length, 2);
  const delivered = store.claimRunMessages({ run_id: active.run_id, kind: 'steering' });
  assert.equal(delivered[0].status, 'delivered');
  assert.equal(store.cancelRunMessage({ id: followUp.id, run_id: active.run_id }).status, 'cancelled');
  assert.equal(store.getConversation(active.conversation_id).messages.at(-1).content, steering.content);
  store.failToolCallingChat(active, new Error('test cleanup'), 'cancelled');

  const original = await store.sendDeterministicChat({ message: 'conversation tree root', runtime_mode: 'tool_calling' });
  const branch = store.branchConversationForTool({ source_conversation_id: original.conversation_id, source_run_id: original.run_id, title: '实验分支' });
  let tree = store.getConversationTree(branch.child_conversation_id);
  assert.equal(tree.node_count, 2);
  assert.equal(tree.root.children[0].active, true);
  tree = store.updateConversationBranch({ conversation_id: branch.child_conversation_id, label: '方案 B', summary: '保留原会话，验证替代实现。' });
  assert.equal(tree.root.children[0].label, '方案 B');
  const exported = store.exportConversation({ conversation_id: branch.child_conversation_id });
  assert.equal(existsSync(exported.path), true);
  const imported = store.importConversation({ path: exported.path });
  assert.equal(imported.imported_conversation_ids.length, 2);
  assert.equal(store.getConversationTree(imported.conversation_id).node_count, 2);

  let longConversationID = '';
  for (let index = 0; index < 25; index += 1) {
    const response = await store.sendDeterministicChat({
      conversation_id: longConversationID || undefined,
      message: `long conversation turn ${index + 1}`,
      runtime_mode: 'tool_calling',
    });
    longConversationID = response.conversation_id;
  }
  const autoCompact = store.beginToolCallingChat({ conversation_id: longConversationID, message: 'trigger automatic compaction', runtime_mode: 'tool_calling' }, {
    provider: 'deterministic_provider', model_name: 'deterministic-local-model', model_selection_policy: 'settings_preferred',
  });
  assert.equal(store.getConversationTree(longConversationID).root.latest_compaction?.reason, 'automatic_context_threshold');
  store.failToolCallingChat(autoCompact, new Error('test cleanup'), 'cancelled');

  for (const modelID of ['route-default', 'route-fallback', 'route-cheap', 'route-child', 'route-tool', 'route-long']) {
    store.saveModelSettings({
      provider: 'route-fixture', base_url: 'http://127.0.0.1:43111/v1', model_id: modelID,
      display_name: modelID, enabled: true, temperature: 0, timeout_seconds: 5, max_retries: 0,
      supports_json_mode: true, supports_tool_calling: true, supports_reasoning: true,
    });
  }
  const policy = store.saveAgentModelPolicy({
    agent_id: 'general_agent',
    default_model_id: 'route-default',
    fallback_model_ids: ['route-fallback'],
    cheap_model_id: 'route-cheap',
    child_model_id: 'route-child',
    tool_model_id: 'route-tool',
    long_context_model_id: 'route-long',
    reasoning_effort: 'medium',
    max_failovers: 3,
    enabled: true,
  });
  assert.equal(policy.child_model_id, 'route-child');
  assert.equal(store.modelRouteCandidates({ agent_id: 'general_agent', purpose: 'child', fallback: { provider: 'fallback', model_name: 'fallback' } })[0].model_name, 'route-child');
  assert.equal(store.modelRouteCandidates({ agent_id: 'general_agent', purpose: 'tool', fallback: { provider: 'fallback', model_name: 'fallback' } })[0].model_name, 'route-tool');
  assert.equal(store.modelRouteCandidates({ agent_id: 'general_agent', purpose: 'cheap', fallback: { provider: 'fallback', model_name: 'fallback' } })[0].model_name, 'route-cheap');
  assert.equal(store.modelRouteCandidates({ agent_id: 'general_agent', purpose: 'long_context', fallback: { provider: 'fallback', model_name: 'fallback' } })[0].model_name, 'route-long');
  const routedRun = store.beginToolCallingChat({ message: 'tool route test', runtime_mode: 'tool_calling' }, {
    provider: 'route-fixture', model_name: 'route-default', model_route_purpose: 'tool', selected_agent_id: 'general_agent',
  });
  assert.equal(routedRun.model_name, 'route-tool');
  const retargetedRun = store.retargetToolCallingChat(routedRun, {
    model_id: 'route-fallback', provider: 'route-fixture', model_name: 'route-fallback', base_url: 'http://127.0.0.1:43111/v1', route_reason: 'policy_fallback',
  }, new Error('fixture primary failure'), 1);
  assert.equal(retargetedRun.run_id, routedRun.run_id);
  assert.equal(retargetedRun.model_name, 'route-fallback');
  assert.ok(store.getRunTrace(routedRun.run_id).events.some((event) => event.event_type === 'model.route_failover'));
  store.failToolCallingChat(retargetedRun, new Error('test cleanup'), 'cancelled');

  const remoteMCP = store.saveMCPServer({
    id: 'remote_mcp', name: 'Remote MCP', transport: 'streamable_http', url: 'https://example.com/mcp', headers: { 'X-Test': 'yes' }, enabled: true,
  }).server;
  assert.equal(remoteMCP.url, 'https://example.com/mcp');
  assert.equal(remoteMCP.headers?.['X-Test'], 'yes');

  let assistant = store.executeAssistantAction({ action: 'start_activity', title: 'Workbench test', interval_seconds: 30 });
  const sessionID = assistant.snapshot.capture.session_id;
  assert(sessionID);
  store.executeAssistantAction({ action: 'record_activity', session_id: sessionID, text: 'Editing Joi', metadata: { app_name: 'Code', window_title: 'Joi' } });
  store.executeAssistantAction({ action: 'create_calendar_item', title: 'Review Joi', start_at: '2026-07-17T09:00:00+08:00' });
  assistant = store.executeAssistantAction({ action: 'create_plan', title: 'Parity plan', objective: 'Verify all workbench capabilities', conversation_id: original.conversation_id });
  const planID = assistant.item.id;
  const node = store.executeAssistantAction({ action: 'add_plan_node', id: planID, title: 'Run integration tests' });
  store.executeAssistantAction({ action: 'update_plan_node', id: node.item.id, metadata: { status: 'completed', evidence: [{ kind: 'test', passed: true }] } });
  const review = store.executeAssistantAction({ action: 'review_plan', id: planID });
  assert.match(review.item.review_summary, /1\/1/);
  const stopped = store.executeAssistantAction({ action: 'stop_activity', session_id: sessionID });
  assert.equal(stopped.snapshot.capture.active, false);
  assert.equal(stopped.snapshot.recent_activity.length, 1);

  store.close();
  console.log('agent workbench store tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
