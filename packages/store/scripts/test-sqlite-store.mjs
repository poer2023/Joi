import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-store-'));

try {
  const store = new JoiSQLiteStore({
    dbPath: join(tempDir, 'joi.db'),
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'test',
  });

  const response = await store.sendDeterministicChat({
    message: 'store test ping',
    model_name: 'deepseek-v4-flash',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
  });

  assert.equal(response.response, 'Electron SQLite deterministic response: store test ping');

  const conversations = store.listConversations({ view: 'active', limit: 10 }).conversations;
  assert.equal(conversations[0].title, 'store test ping');
  assert.equal(conversations[0].latest_run_id, response.run_id);
  assert.equal(conversations[0].message_count, 2);

  const detail = store.getConversation(response.conversation_id);
  assert.deepEqual(detail.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(detail.messages[1].content, response.response);

  const trace = store.getRunTrace(response.run_id);
  assert.equal(trace.status, 'completed');
  assert.equal(trace.selected_agent_id, 'general_agent');
  assert.equal(trace.events?.length, 4);
  assert.equal(trace.events?.[1]?.delta, response.response);
  assert.equal(trace.model_calls?.[0]?.model_name, 'deepseek-v4-flash');
  assert.equal(trace.model_calls?.[0]?.provider, 'deterministic_provider');

  const models = store.listSavedModels().models.map((model) => model.id);
  assert.ok(models.includes('deepseek-v4-flash'));
  assert.ok(models.includes('deterministic-local-model'));
  assert.ok(!models.includes('mock-model'));

  const health = store.systemHealth();
  assert.deepEqual(health.service_status, { sqlite: true, electron: 'running', runtime: 'electron_ts_sqlite' });

  const capabilities = store.listCapabilities().capabilities.map((capability) => capability.id);
  assert.ok(capabilities.includes('memory_search'));
  assert.ok(capabilities.includes('apply_patch'));

  const workflows = store.listToolWorkflows().workflows.map((workflow) => workflow.name);
  assert.ok(workflows.includes('memory_search_v1'));

  assert.equal(store.listNodes().nodes[0].id, 'main-node');
  store.disableNode('main-node');
  assert.equal(store.listNodes().nodes[0].status, 'disabled');
  store.enableNode('main-node');
  assert.equal(store.listNodes().nodes[0].status, 'healthy');
  assert.ok(store.listWorkerGatewayAuditLogs().items.length >= 2);
  store['exec'](
    `INSERT INTO nodes (id, name, role, status, capabilities, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, metadata)
     VALUES ('worker-alias', 'Worker Alias', 'worker', 'healthy', '["web_research_v1"]', 1, 1, datetime('now'), '{}')`,
  );
  store['exec'](
    `INSERT INTO tasks (id, capability_id, assigned_node_id, privacy_level, status, payload)
     VALUES ('task_worker_alias', 'web_research', 'worker-alias', 'public', 'pending', '{"url":"https://example.com"}')`,
  );
  const claimedAliasTask = store.claimWorkerGatewayTask('worker-alias');
  assert.equal(claimedAliasTask?.id, 'task_worker_alias');
  store.ackWorkerGatewayTask('worker-alias', 'task_worker_alias', { output: { fetch_status: 'succeeded', mode: 'web_research_v2_readonly_fetch' } });
  assert.equal(store['get'](`SELECT status FROM tasks WHERE id='task_worker_alias'`)?.status, 'succeeded');

  store.saveOperationalSettings({
    telegram_enabled: true,
    telegram_allowed_user_ids: '123',
    worker_gateway_enabled: false,
    backup_dir: join(tempDir, 'custom-backups'),
    auto_backup_enabled: true,
  });
  assert.equal(store.getSettings().telegram_enabled, true);
  assert.equal(store.getSettings().telegram_allowed_user_ids, '123');
  assert.equal(store.getSettings().worker_gateway_enabled, false);
  assert.equal(store.getSettings().auto_backup_enabled, true);

  store.saveWorkspaceSettings({
    allowed_roots: [root],
    default_root: root,
    browser_allowed_hosts: ['Example.COM', 'example.com'],
    web_research_allow_private_hosts: false,
    file_analyze_max_bytes: 1024,
    workspace_search_max_results: 12,
  });
  const workspaceSettings = store.getWorkspaceSettings();
  assert.deepEqual(workspaceSettings.allowed_roots, [root]);
  assert.deepEqual(workspaceSettings.browser_allowed_hosts, ['example.com']);
  assert.equal(workspaceSettings.workspace_search_max_results, 12);

  store.saveModelConfig({
    provider: 'openai_compatible',
    base_url: 'https://api.example.test/v1',
    name: 'test-real-model',
    timeout_seconds: 30,
    max_retries: 2,
  });
  assert.ok(store.listSavedModels().models.some((model) => model.id === 'test-real-model'));
  assert.equal(store.getSettings().model_name, 'test-real-model');
  store.replaceFetchedModels('openai_compatible', 'https://api.example.test/v1', [{
    id: 'remote-model-a',
    display_name: 'Remote Model A',
    provider: 'openai_compatible',
    base_url: 'https://api.example.test/v1',
    supports_json_mode: true,
    supports_tool_calling: true,
    supports_reasoning: false,
    supported_parameters: ['tools', 'response_format'],
    context_window: 128000,
    input_price_per_1m: 1,
    output_price_per_1m: 2,
    metadata: { source_fixture: true },
  }]);
  const remote = store.listSavedModels().models.find((model) => model.id === 'remote-model-a');
  assert.equal(remote.display_name, 'Remote Model A');
  assert.equal(remote.supports_tool_calling, true);
  assert.equal(remote.context_window, 128000);

  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_test', 'preference', 'Prefer concise status updates.', 'Concise status preference', 'global', 'internal', 0.9, 'confirmed', '[]', '[]', '{}')`,
  );
  assert.equal(store.listMemories({ query: 'concise', limit: 10 }).memories[0].id, 'mem_test');
  store.updateMemory({ id: 'mem_test', action: 'pin' });
  assert.equal(store.listMemories({ limit: 10 }).memories[0].pinned, true);
  store.updateMemory({ id: 'mem_test', action: 'feedback_positive', comment: 'useful' });
  assert.equal(store.listMemories({ limit: 10 }).memories[0].positive_feedback, 1);
  store.updateMemory({ id: 'mem_test', action: 'edit_confirm', content: 'Prefer direct status updates.', summary: 'Direct status preference' });
  assert.equal(store.listMemories({ query: 'direct', limit: 10 }).memories[0].summary, 'Direct status preference');

  store['exec'](
    `INSERT INTO product_tasks (id, title, description, status, mode, priority, risk_level, progress_percent, summary, metadata)
     VALUES ('ptask_test', 'Ship TS restore', 'Restore backup in TS', 'running', 'serious_task', 'normal', 'read_only', 40, 'Restore work', '{}')`,
  );
  store['exec'](
    `INSERT INTO product_task_steps (id, product_task_id, title, description, status, sort_order, input, output)
     VALUES ('pstep_test', 'ptask_test', 'Implement restore', '', 'running', 1, '{}', '{}')`,
  );
  store['exec'](
    `INSERT INTO artifacts (id, type, title, content, content_format, source_product_task_id, linked_memory_ids, metadata)
     VALUES ('art_test', 'report', 'Restore notes', 'Restore backup details', 'markdown', 'ptask_test', '["mem_test"]', '{}')`,
  );
  store['exec'](
    `INSERT INTO open_loops (id, topic, description, status, suggested_followup, priority, metadata)
     VALUES ('oloop_test', 'Restore follow-up', 'Verify restore', 'open', 'Run restore test', 'normal', '{}')`,
  );
  store['exec'](
    `INSERT INTO proactive_messages (id, type, title, body, reason, source_memory_ids, source_open_loop_id, score, status, channel, metadata)
     VALUES ('pmsg_test', 'followup', 'Run restore check', 'Please run restore check', 'open loop', '["mem_test"]', 'oloop_test', 0.9, 'draft', 'desktop', '{}')`,
  );
  assert.equal(store.listProductTasks({ status: 'active', limit: 10 }).tasks[0].id, 'ptask_test');
  const taskDetail = store.getProductTask('ptask_test');
  assert.equal(taskDetail.steps[0].id, 'pstep_test');
  assert.equal(taskDetail.deliverables[0].id, 'art_test');
  assert.equal(store.listArtifacts({ product_task_id: 'ptask_test' }).artifacts[0].id, 'art_test');
  assert.equal(store.getArtifact('art_test').linked_memory_ids[0], 'mem_test');
  assert.equal(store.listOpenLoops().open_loops[0].id, 'oloop_test');
  assert.equal(store.listProactiveMessages().messages[0].id, 'pmsg_test');
  store.decideProactiveMessage({ id: 'pmsg_test', action: 'dismiss', feedback: 'not now' });
  assert.equal(store.listProactiveMessages({ status: 'dismissed' }).messages[0].feedback, 'not now');

  store['exec'](
    `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input)
     VALUES ('confirm_test', ?, 'shell_command', 'Run test command', 'read_only', 'pending', '{}')`,
    response.run_id,
  );
  assert.equal(store.listConfirmations().items[0].id, 'confirm_test');
  store.decideConfirmation({ id: 'confirm_test', approve: true, actor: 'test' });
  assert.equal(store.listConfirmations().items[0].status, 'approved');

  store.interruptRun({ run_id: response.run_id, reason: 'test interrupt' });
  const interruptedTrace = store.getRunTrace(response.run_id);
  assert.equal(interruptedTrace.status, 'cancelled');
  assert.equal(interruptedTrace.events?.at(-1)?.event_type, 'run.interrupted');

  const capabilityChat = await store.sendDeterministicChat({
    message: '在当前项目里找 Run Trace 的设计文档',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
  }, {
    executeCapability(capability, inputs) {
      assert.equal(capability, 'workspace_search');
      assert.equal(inputs.query, 'Run Trace');
      return {
        output: {
          status: 'completed',
          mode: 'workspace_search_v1_real_executor_test',
          summary: 'real executor summary Run Trace',
          results: [{ path: 'docs/14_RUN_TRACE_OBSERVABILITY.md', line: 1, snippet: 'Run Trace evidence', truncated: false }],
        },
      };
    },
  });
  assert.ok(capabilityChat.response.includes('real executor summary Run Trace'));
  const capabilityTrace = store.getRunTrace(capabilityChat.run_id);
  assert.equal(capabilityTrace.steps.find((step) => step.step_type === 'tool_finished')?.output?.mode, 'workspace_search_v1_real_executor_test');
  const capabilityToolRun = store['get'](`SELECT output FROM tool_runs WHERE run_id=?`, capabilityChat.run_id);
  assert.equal(JSON.parse(capabilityToolRun.output).mode, 'workspace_search_v1_real_executor_test');

  const toolCallingChat = store.recordToolCallingChat({
    message: 'Use a model-generated tool call to find Run Trace docs',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Run Trace evidence found by model tool call.',
    tool_results: [{
      call_id: 'call_workspace_search',
      name: 'workspace_search',
      arguments: { query: 'Run Trace', root: '.', max_results: 5 },
      output: {
        status: 'completed',
        mode: 'workspace_search_v1_model_tool_test',
        summary: 'model tool search summary',
        results: [{ path: 'docs/run-trace.md', line: 1, snippet: 'Run Trace evidence', truncated: false }],
      },
    }],
    usage: { input_tokens: 31, output_tokens: 12, cached_input_tokens: 7 },
    model_responses: [{ id: 'chatcmpl_fixture', choices: [{ message: { content: 'Run Trace evidence found by model tool call.' } }] }],
  });
  assert.equal(toolCallingChat.response, 'Run Trace evidence found by model tool call.');
  assert.ok(toolCallingChat.used_memories.some((result) => result.memory.id === 'mem_test'));
  const toolCallingTrace = store.getRunTrace(toolCallingChat.run_id);
  assert.equal(toolCallingTrace.status, 'completed');
  assert.equal(toolCallingTrace.model_calls[0].provider, 'openai_compatible');
  assert.equal(toolCallingTrace.model_calls[0].input_tokens, 31);
  assert.equal(toolCallingTrace.model_calls[0].cached_input_tokens, 7);
  assert.equal(toolCallingTrace.steps.find((step) => step.step_type === 'tool_finished')?.output?.mode, 'workspace_search_v1_model_tool_test');
  const turnItemCount = Number(store['get'](`SELECT COUNT(*) AS count FROM turn_items WHERE run_id=?`, toolCallingChat.run_id)?.count || 0);
  assert.equal(turnItemCount, 4);
  const persistedToolRun = store['get'](`SELECT capability_id, input, output FROM tool_runs WHERE run_id=?`, toolCallingChat.run_id);
  assert.equal(persistedToolRun.capability_id, 'workspace_search');
  assert.equal(JSON.parse(persistedToolRun.input).query, 'Run Trace');
  assert.equal(JSON.parse(persistedToolRun.output).mode, 'workspace_search_v1_model_tool_test');
  const promptRow = store['get'](`SELECT cacheable_prefix, dynamic_tail FROM prompt_assemblies WHERE run_id=?`, toolCallingChat.run_id);
  assert.ok(promptRow.cacheable_prefix.includes('Joi Electron Tool Calling Runtime'));
  assert.ok(promptRow.cacheable_prefix.includes('Your product identity is Joi'));
  assert.ok(promptRow.cacheable_prefix.includes('The selected model id for this run is real-tool-model'));
  assert.ok(promptRow.cacheable_prefix.includes('Do not claim to be Claude'));
  assert.ok(promptRow.dynamic_tail.includes('Prefer direct status updates.'));
  const memoryPackRow = store['get'](`SELECT dynamic_retrieval FROM memory_context_packs WHERE run_id=?`, toolCallingChat.run_id);
  assert.equal(JSON.parse(memoryPackRow.dynamic_retrieval)[0].memory.id, 'mem_test');

  const seriousTaskChat = store.recordToolCallingChat({
    message: '帮我分析 Joi Task OS 并给出报告',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Joi Task OS report is ready.',
    tool_results: [],
    usage: { input_tokens: 6, output_tokens: 5 },
    model_responses: [{ id: 'chatcmpl_serious_task', choices: [{ message: { content: 'Joi Task OS report is ready.' } }] }],
  });
  assert.ok(seriousTaskChat.product_task);
  assert.equal(seriousTaskChat.product_task.status, 'completed');
  assert.ok(seriousTaskChat.product_task.task_contract.objective.includes('Joi Task OS'));
  assert.equal(seriousTaskChat.product_task.verification.status, 'passed');
  assert.equal(seriousTaskChat.artifacts.length, 1);
  const seriousTaskDetail = store.getProductTask(seriousTaskChat.product_task.id);
  assert.equal(seriousTaskDetail.deliverables[0].id, seriousTaskChat.artifacts[0].id);
  const seriousTaskTrace = store.getRunTrace(seriousTaskChat.run_id);
  assert.ok(seriousTaskTrace.steps.some((step) => step.step_type === 'artifact_created'));
  assert.ok(seriousTaskTrace.steps.some((step) => step.step_type === 'task_verification_finished'));

  const backgroundTaskChat = store.recordToolCallingChat({
    message: '后台跟进 Joi 每日状态并生成提醒',
    input_mode: 'background_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Background task status is ready for review.',
    tool_results: [],
    usage: { input_tokens: 5, output_tokens: 4 },
    model_responses: [{ id: 'chatcmpl_background_task', choices: [{ message: { content: 'Background task status is ready for review.' } }] }],
  });
  assert.equal(backgroundTaskChat.product_task.mode, 'background_task');
  assert.equal(backgroundTaskChat.product_task.status, 'completed');
  assert.ok(store.listOpenLoops({ status: 'open' }).open_loops.some((loop) => loop.source_product_task_id === backgroundTaskChat.product_task.id));
  assert.ok(store.listProactiveMessages({ status: 'draft' }).messages.some((item) => item.source_product_task_id === backgroundTaskChat.product_task.id));
  const backgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(backgroundTrace.steps.some((step) => step.step_type === 'open_loop_created'));
  assert.ok(backgroundTrace.steps.some((step) => step.step_type === 'proactive_candidate_created'));

  const waitingToolCallingChat = store.recordToolCallingChat({
    message: 'Use a model-generated patch that requires approval',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'waiting_confirmation',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'confirmation_required: workspace write requires approval before execution',
    tool_results: [{
      call_id: 'call_apply_patch_waiting',
      name: 'apply_patch',
      arguments: { patch: '*** Begin Patch\n*** Update File: README.md\n*** End Patch\n', reason: 'test approval' },
      output: {
        status: 'waiting_confirmation',
        message: 'confirmation_required: workspace write requires approval before execution',
        capability: 'apply_patch',
        risk: 'workspace_write',
      },
    }],
    usage: { input_tokens: 10, output_tokens: 3 },
    model_responses: [{ id: 'chatcmpl_waiting', choices: [{ message: { tool_calls: [] } }] }],
  });
  assert.equal(waitingToolCallingChat.ui.requires_user_input, true);
  const waitingTrace = store.getRunTrace(waitingToolCallingChat.run_id);
  assert.equal(waitingTrace.status, 'waiting_confirmation');
  assert.ok(waitingTrace.events.some((event) => event.event_type === 'approval.requested'));
  assert.ok(waitingTrace.events.some((event) => event.event_type === 'run.waiting_confirmation'));
  const waitingConfirmation = store.listConfirmations().items.find((item) => item.run_id === waitingToolCallingChat.run_id);
  assert.ok(waitingConfirmation);
  assert.equal(waitingConfirmation.call_id, 'call_apply_patch_waiting');
  assert.equal(waitingConfirmation.turn_id?.startsWith('turn_'), true);
  assert.equal(waitingConfirmation.approval_scope, 'once');
  assert.equal(waitingConfirmation.approval_key, 'call_apply_patch_waiting');
  assert.equal(waitingConfirmation.status, 'pending');
  assert.ok(waitingConfirmation.operation_id.startsWith('op_'));
  assert.ok(waitingConfirmation.affected_paths.includes('README.md'));
  assert.equal(waitingToolCallingChat.product_task.status, 'waiting_confirmation');
  const waitingOutput = store['get'](`SELECT status, output FROM turn_items WHERE run_id=? AND item_type='tool_output'`, waitingToolCallingChat.run_id);
  assert.equal(waitingOutput.status, 'waiting_confirmation');
  assert.equal(JSON.parse(waitingOutput.output).confirmation_id, waitingConfirmation.id);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM tool_runs WHERE run_id=?`, waitingToolCallingChat.run_id).count), 0);
  store.decideConfirmation({ id: waitingConfirmation.id, approve: false, actor: 'test', reason: 'reject test' });
  const rejectedTrace = store.getRunTrace(waitingToolCallingChat.run_id);
  assert.equal(rejectedTrace.status, 'failed');
  assert.equal(rejectedTrace.events.at(-1).event_type, 'run.failed');
  assert.equal(store.listConfirmations().items.find((item) => item.id === waitingConfirmation.id).status, 'rejected');
  assert.equal(store.getProductTask(waitingToolCallingChat.product_task.id).task.status, 'blocked');

  const resumableChat = store.recordToolCallingChat({
    message: 'Use another model-generated patch that will be approved',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'waiting_confirmation',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'confirmation_required: workspace write requires approval before execution',
    tool_results: [{
      call_id: 'call_apply_patch_resume',
      name: 'apply_patch',
      arguments: { patch: '*** Begin Patch\n*** End Patch\n', reason: 'resume approval' },
      output: {
        status: 'waiting_confirmation',
        message: 'confirmation_required: workspace write requires approval before execution',
        capability: 'apply_patch',
        risk: 'workspace_write',
      },
    }],
    usage: { input_tokens: 8, output_tokens: 2 },
    model_responses: [{ id: 'chatcmpl_resumable', choices: [{ message: { tool_calls: [] } }] }],
  });
  const resumableConfirmation = store.listConfirmations().items.find((item) => item.run_id === resumableChat.run_id);
  store.decideConfirmation({ id: resumableConfirmation.id, approve: true, actor: 'test', reason: 'approve test' });
  const resumeRequest = store.loadApprovedToolCallingResume(resumableConfirmation.id);
  assert.equal(resumeRequest.call_id, 'call_apply_patch_resume');
  assert.equal(resumeRequest.input.reason, 'resume approval');
  const resumed = store.completeApprovedToolCallingResume(resumableConfirmation.id, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    final_message: 'Patch resumed final answer.',
    tool_result: {
      call_id: 'call_apply_patch_resume',
      name: 'apply_patch',
      arguments: resumeRequest.input,
      output: { status: 'completed', summary: 'patch applied by approval resume' },
    },
    usage: { input_tokens: 11, output_tokens: 4, cached_input_tokens: 1 },
    model_responses: [{ id: 'chatcmpl_resume_final', choices: [{ message: { content: 'Patch resumed final answer.' } }] }],
  });
  assert.equal(resumed.run_id, resumableChat.run_id);
  assert.equal(resumed.product_task.status, 'completed');
  assert.equal(resumed.product_task.verification.status, 'passed');
  assert.equal(resumed.artifacts.length, 1);
  const resumedTrace = store.getRunTrace(resumableChat.run_id);
  assert.equal(resumedTrace.status, 'succeeded');
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'approval.resolved'));
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'tool.finished'));
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'run.completed'));
  assert.equal(store.getConversation(resumableChat.conversation_id).messages.at(-1).content, 'Patch resumed final answer.');
  assert.equal(JSON.parse(store['get'](`SELECT output FROM tool_runs WHERE run_id=?`, resumableChat.run_id).output).summary, 'patch applied by approval resume');
  assert.ok(store.listConfirmations().items.find((item) => item.id === resumableConfirmation.id).resumed_at);

  const failingResumeChat = store.recordToolCallingChat({
    message: 'Use a model-generated patch whose final resume model call fails',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'waiting_confirmation',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'confirmation_required: workspace write requires approval before execution',
    tool_results: [{
      call_id: 'call_apply_patch_resume_fail',
      name: 'apply_patch',
      arguments: { patch: '*** Begin Patch\n*** End Patch\n', reason: 'resume approval with model failure' },
      output: {
        status: 'waiting_confirmation',
        message: 'confirmation_required: workspace write requires approval before execution',
        capability: 'apply_patch',
        risk: 'workspace_write',
      },
    }],
    usage: { input_tokens: 8, output_tokens: 2 },
    model_responses: [{ id: 'chatcmpl_resumable_fail', choices: [{ message: { tool_calls: [] } }] }],
  });
  const failingResumeConfirmation = store.listConfirmations().items.find((item) => item.run_id === failingResumeChat.run_id);
  store.decideConfirmation({ id: failingResumeConfirmation.id, approve: true, actor: 'test', reason: 'approve model failure test' });
  const failingResumeRequest = store.loadApprovedToolCallingResume(failingResumeConfirmation.id);
  const failedResume = store.completeApprovedToolCallingResume(failingResumeConfirmation.id, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    final_message: 'patch applied before final model failure',
    model_error: 'resume model down',
    tool_result: {
      call_id: 'call_apply_patch_resume_fail',
      name: 'apply_patch',
      arguments: failingResumeRequest.input,
      output: { status: 'completed', summary: 'patch applied before model failure' },
    },
    usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
    model_responses: [],
  });
  assert.equal(failedResume.run_id, failingResumeChat.run_id);
  assert.equal(failedResume.product_task.status, 'blocked');
  const failedResumeTrace = store.getRunTrace(failingResumeChat.run_id);
  assert.equal(failedResumeTrace.status, 'failed');
  assert.ok(failedResumeTrace.steps.some((step) => step.step_type === 'model_call_failed' && step.status === 'failed'));
  assert.ok(failedResumeTrace.events.some((event) => event.event_type === 'tool.finished'));
  assert.ok(failedResumeTrace.events.some((event) => event.event_type === 'run.failed'));
  assert.ok(!failedResumeTrace.events.some((event) => event.event_type === 'run.completed'));
  const failedResumeModelCall = store['get'](`SELECT status, error_code, error_message FROM model_calls WHERE run_id=? AND error_code='approval_resume_model_failed'`, failingResumeChat.run_id);
  assert.equal(failedResumeModelCall.status, 'failed');
  assert.equal(failedResumeModelCall.error_message, 'resume model down');
  assert.equal(store.getConversation(failingResumeChat.conversation_id).messages.at(-1).content.includes('最终模型回复失败：resume model down'), true);
  assert.equal(store['get'](`SELECT status FROM turn_items WHERE run_id=? AND item_type='message' AND role='assistant' ORDER BY seq DESC LIMIT 1`, failingResumeChat.run_id).status, 'failed');
  assert.ok(store.listConfirmations().items.find((item) => item.id === failingResumeConfirmation.id).resumed_at);

  const liveStarted = store.beginToolCallingChat({
    message: 'Begin a cancellable real model run',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
  });
  const liveInitialTrace = store.getRunTrace(liveStarted.run_id);
  assert.equal(liveInitialTrace.status, 'running');
  assert.equal(liveInitialTrace.events[0].event_type, 'run.started');
  assert.equal(liveInitialTrace.model_calls[0].status, 'running');
  const liveFinished = store.finishToolCallingChat(liveStarted, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Live run finished.',
    tool_results: [],
    usage: { input_tokens: 5, output_tokens: 3, cached_input_tokens: 1 },
    model_responses: [{ id: 'chatcmpl_live_finished' }],
  });
  assert.equal(liveFinished.run_id, liveStarted.run_id);
  const liveFinishedTrace = store.getRunTrace(liveStarted.run_id);
  assert.equal(liveFinishedTrace.status, 'completed');
  assert.equal(liveFinishedTrace.model_calls[0].status, 'succeeded');
  assert.equal(liveFinishedTrace.model_calls[0].input_tokens, 5);
  assert.equal(store.getConversation(liveStarted.conversation_id).messages.at(-1).content, 'Live run finished.');

  const liveCancelled = store.beginToolCallingChat({
    message: 'Begin a live run that will be cancelled',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
  });
  const liveCancelledResponse = store.failToolCallingChat(liveCancelled, new Error('test abort'), 'cancelled');
  assert.equal(liveCancelledResponse.response, '运行已取消。');
  const liveCancelledTrace = store.getRunTrace(liveCancelled.run_id);
  assert.equal(liveCancelledTrace.status, 'cancelled');
  assert.equal(liveCancelledTrace.model_calls[0].status, 'cancelled');
  assert.equal(liveCancelledTrace.events.at(-1).event_type, 'run.interrupted');

  const cancellableChat = store.recordToolCallingChat({
    message: 'Use a model-generated patch that will be cancelled',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'waiting_confirmation',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'confirmation_required: workspace write requires approval before execution',
    tool_results: [{
      call_id: 'call_apply_patch_cancel',
      name: 'apply_patch',
      arguments: { patch: '*** Begin Patch\n*** End Patch\n', reason: 'cancel approval' },
      output: {
        status: 'waiting_confirmation',
        message: 'confirmation_required: workspace write requires approval before execution',
        capability: 'apply_patch',
        risk: 'workspace_write',
      },
    }],
    usage: { input_tokens: 8, output_tokens: 2 },
    model_responses: [{ id: 'chatcmpl_cancellable', choices: [{ message: { tool_calls: [] } }] }],
  });
  const cancellableConfirmation = store.listConfirmations().items.find((item) => item.run_id === cancellableChat.run_id);
  store.interruptRun({ run_id: cancellableChat.run_id, reason: 'cancel waiting approval' });
  const cancelledTrace = store.getRunTrace(cancellableChat.run_id);
  assert.equal(cancelledTrace.status, 'cancelled');
  assert.equal(store['get'](`SELECT status FROM turns WHERE run_id=?`, cancellableChat.run_id).status, 'cancelled');
  assert.equal(store.listConfirmations().items.find((item) => item.id === cancellableConfirmation.id).status, 'rejected');
  assert.equal(store.getProductTask(cancellableChat.product_task.id).task.status, 'paused');

  const backup = store.createBackup();
  assert.ok(existsSync(backup.path));
  assert.equal(readFileSync(backup.path).subarray(0, 4).toString('hex'), '504b0304');
  assert.equal(store.listBackups().backups[0].path, backup.path);
  store['exec'](
    `INSERT INTO conversations (id, channel, user_id, title, lifecycle_status, metadata)
     VALUES ('conv_after_backup', 'desktop', 'tester', 'after backup', 'active', '{}')`,
  );
  assert.ok(store.listConversations({ view: 'active', limit: 50 }).conversations.some((conversation) => conversation.id === 'conv_after_backup'));
  store.restoreBackup(backup.path);
  assert.ok(!store.listConversations({ view: 'active', limit: 50 }).conversations.some((conversation) => conversation.id === 'conv_after_backup'));
  assert.equal(store.getProductTask('ptask_test').task.title, 'Ship TS restore');

  store['exec'](
    `UPDATE run_steps
     SET input=?, output=?
     WHERE run_id=?`,
    JSON.stringify({ api_key: 'diagnostic-model-secret-value', nested: { authorization: 'Bearer diagnosticbearer123456' } }),
    JSON.stringify({ text: 'token=diagnostic-token-value', prompt: 'diagnostic prompt text must be redacted' }),
    response.run_id,
  );
  store['exec'](
    `UPDATE model_calls
     SET raw_response=?, metadata=?
     WHERE run_id=?`,
    JSON.stringify({ choices: [{ message: { content: 'diagnostic raw model response must not leak' } }] }),
    JSON.stringify({ model_api_key: 'diagnostic-model-secret-value', note: 'secret=diagnostic-token-value' }),
    response.run_id,
  );
  store['exec'](
    `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, node_id, risk_level, status, input, output, finished_at, duration_ms)
     VALUES ('toolrun_diagnostic_secret', ?, 'shell_command', 'shell_command_v1', 'shell_command_v1', 'main-node', 'read_only', 'succeeded', ?, ?, datetime('now'), 0)`,
    response.run_id,
    JSON.stringify({ password: 'diagnostic-password-value' }),
    JSON.stringify({ stdout: 'authorization: diagnostic-output-secret' }),
  );
  const diagnostics = store.exportDiagnostics();
  assert.ok(existsSync(diagnostics.path));
  const diagnosticsZip = readFileSync(diagnostics.path);
  assert.equal(diagnosticsZip.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(diagnosticsZip.includes(Buffer.from('manifest.json')));
  for (const leaked of [
    'diagnostic-model-secret-value',
    'diagnosticbearer123456',
    'diagnostic-token-value',
    'diagnostic prompt text must be redacted',
    'diagnostic raw model response must not leak',
    'diagnostic-password-value',
    'diagnostic-output-secret',
  ]) {
    assert.equal(diagnosticsZip.includes(Buffer.from(leaked)), false, `diagnostics leaked ${leaked}`);
  }
  assert.ok(diagnosticsZip.includes(Buffer.from('[REDACTED]')));

  assert.equal(store.getOnboardingStatus().first_backup_created, true);
  store.completeOnboarding();
  assert.equal(store.getOnboardingStatus().completed, true);

  store.close();
  console.log('sqlite store tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
