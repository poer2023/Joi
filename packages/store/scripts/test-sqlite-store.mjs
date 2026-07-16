import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';
import { compileElectronCapabilityTools } from '../../runtime/src/capability-compiler.ts';

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

  const initialWorkspaceSettings = store.getWorkspaceSettings();
  assert.equal(store.resolveAgentIDForTool('Research Agent'), 'research_agent');
  assert.equal(store.resolveAgentIDForTool('research'), 'research_agent');
  assert.equal(store.resolveAgentIDForTool(''), 'research_agent');
  store.saveWorkspaceSettings({ ...initialWorkspaceSettings, allowed_roots: [...initialWorkspaceSettings.allowed_roots, tempDir] });
  const enhancedDiagnosticsPath = store.exportDiagnostics().path;
  const enhancedDiagnosticsManifest = JSON.parse(execFileSync('unzip', ['-p', enhancedDiagnosticsPath, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(enhancedDiagnosticsManifest.redaction_profile, 'enhanced');
  const enhancedDiagnosticsSettings = execFileSync('unzip', ['-p', enhancedDiagnosticsPath, 'settings.json'], { encoding: 'utf8' });
  assert.equal(enhancedDiagnosticsSettings.includes(process.env.HOME || '/Users/hao'), false);
  store.saveWorkspaceSettings({ ...store.getWorkspaceSettings(), diagnostic_redaction_enabled: false });
  const baselineDiagnosticsManifest = JSON.parse(execFileSync('unzip', ['-p', store.exportDiagnostics().path, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(baselineDiagnosticsManifest.redaction_profile, 'secrets_only');
  store.saveWorkspaceSettings({ ...store.getWorkspaceSettings(), diagnostic_redaction_enabled: true });
  const firstCapability = store.listCapabilities().capabilities[0];
  assert.ok(firstCapability);
  store.setCapabilityEnabled({ id: firstCapability.id, enabled: false });
  assert.equal(store.listCapabilities().capabilities.find((item) => item.id === firstCapability.id)?.enabled, false);
  store.setCapabilityEnabled({ id: firstCapability.id, enabled: true });
  const firstSkill = store.listSkills().skills[0];
  assert.ok(firstSkill);
  store.setSkillEnabled({ id: firstSkill.id, enabled: false });
  assert.equal(store.listSkills().skills.find((item) => item.id === firstSkill.id)?.enabled, false);
  store.setSkillEnabled({ id: firstSkill.id, enabled: true });
  const mcpServer = store.saveMCPServer({ id: 'test_mcp', name: 'Test MCP', command: 'node', args: ['server.mjs'], enabled: true }).server;
  assert.equal(mcpServer.status, 'configured');
  assert.equal(store.setMCPServerEnabled({ id: mcpServer.id, enabled: false }).server.enabled, false);
  store.deleteMCPServer(mcpServer.id);
  assert.equal(store.listMCPServers().servers.some((item) => item.id === mcpServer.id), false);
  assert.throws(() => store.syncMCPServer('missing_mcp'), /MCP server not found/);
  assert.equal(store.listMCPServers().servers.some((item) => item.id === 'local_mcp_registry'), false);
  const pluginManifestPath = join(tempDir, 'plugin.json');
  writeFileSync(pluginManifestPath, JSON.stringify({
    id: 'test.settings.plugin',
    name: 'Settings Plugin Test',
    version: 'v1',
    capabilities: [{ id: 'test_plugin_capability', name: 'Test Plugin Capability', risk_level: 'read_only' }],
    workflows: [{ id: 'workflow_test_plugin', capability_id: 'test_plugin_capability', name: 'test_plugin_v1', steps: [{ tool: 'test_tool', risk_level: 'read_only' }] }],
    skills: [{ id: 'test_plugin_skill', name: 'Test Plugin Skill', required_capabilities: ['test_plugin_capability'] }],
    mcp_servers: [{ id: 'test_plugin_mcp', name: 'Test Plugin MCP', command: 'node', args: ['server.mjs'] }],
    providers: [{ id: 'test_plugin_acp', name: 'Test Plugin ACP', protocol: 'acp', runtime: 'node', command: 'agent.mjs', args: [], default_model: 'test-model', models: [{ id: 'test-model', name: 'Test Model' }] }],
  }));
  const installedPlugin = store.installPluginFromManifest(pluginManifestPath).plugin;
  assert.equal(installedPlugin.id, 'test.settings.plugin');
  assert.deepEqual(installedPlugin.provider_ids, ['test_plugin_acp']);
  assert.equal(store.getEnabledPluginProvider('test_plugin_acp')?.command, join(tempDir, 'agent.mjs'));
  assert.equal(store.listCapabilities().capabilities.some((item) => item.id === 'test_plugin_capability'), true);
  assert.equal(store.listToolWorkflows().workflows.some((item) => item.id === 'workflow_test_plugin'), true);
  assert.equal(store.setPluginEnabled({ id: installedPlugin.id, enabled: false }).plugin.enabled, false);
  assert.equal(store.getEnabledPluginProvider('test_plugin_acp'), undefined);
  assert.equal(store.listSkills().skills.find((item) => item.id === 'test_plugin_skill')?.enabled, false);
  store.removePlugin(installedPlugin.id);
  assert.equal(store.listPlugins().plugins.some((item) => item.id === installedPlugin.id), false);

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
  assert.equal(store.listConversations({ view: 'all', query: 'store test ping', limit: 10 }).conversations[0].id, response.conversation_id);
  assert.equal(store.listConversations({ view: 'all', query: 'no-such-session-token', limit: 10 }).conversations.length, 0);

  const detail = store.getConversation(response.conversation_id);
  assert.deepEqual(detail.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(detail.messages[1].content, response.response);

  for (let index = 1; index <= 4; index += 1) {
    store.recordToolCallingChat({
      conversation_id: response.conversation_id,
      message: `branch and compaction history ${index}`,
      model_name: 'deepseek-v4-flash',
      runtime_mode: 'tool_calling',
      permission_profile: 'danger_full_access',
    }, {
      provider: 'openai_compatible',
      model_name: 'deepseek-v4-flash',
      selected_agent_id: 'general_agent',
      final_message: `history response ${index}`,
      tool_results: [],
      usage: {},
      usage_status: 'provider_missing',
      finish_reason: 'stop',
      model_responses: [],
    });
  }
  const sourceBeforeBranch = store.getConversation(response.conversation_id);
  const branch = store.branchConversationForTool({
    source_conversation_id: response.conversation_id,
    from_message_id: sourceBeforeBranch.messages[3].id,
    title: 'Persistent branch fixture',
    source_run_id: response.run_id,
  });
  assert.equal(branch.copied_message_count, 4);
  assert.equal(branch.source_unchanged, true);
  assert.equal(store.getConversation(branch.child_conversation_id).messages.length, 4);
  assert.equal(store.getConversation(response.conversation_id).messages.length, sourceBeforeBranch.messages.length);
  assert.equal(store.getConversation(branch.child_conversation_id).conversation.metadata?.branch?.parent_conversation_id, response.conversation_id);

  const compaction = store.compactConversationForTool({
    conversation_id: response.conversation_id,
    summary: 'Persistent checkpoint: the fixture established branch and compaction provenance.',
    keep_recent_messages: 2,
    reason: 'contract_test',
    source_run_id: response.run_id,
  });
  assert.equal(compaction.transcript_preserved, true);
  assert.equal(compaction.covered_message_count, sourceBeforeBranch.messages.length - 2);
  assert.equal(store.getConversation(response.conversation_id).messages.length, sourceBeforeBranch.messages.length);
  const compactedPrompt = store.assembleToolCallingPrompt({
    conversation_id: response.conversation_id,
    message: 'continue after checkpoint',
    runtime_mode: 'tool_calling',
  }, 'general_agent', 'deepseek-v4-flash');
  assert.match(compactedPrompt.dynamic_tail, /Persistent Conversation Checkpoint/);
  assert.match(compactedPrompt.dynamic_tail, /Persistent checkpoint: the fixture established branch/);
  assert.equal(compactedPrompt.conversation_messages.length, 2);

  const trace = store.getRunTrace(response.run_id);
  assert.equal(trace.status, 'completed');
  assert.equal(trace.selected_agent_id, 'general_agent');
  assert.equal(trace.requested_mode, 'auto');
  assert.equal(trace.resolved_mode, 'chat_assist');
  assert.equal(trace.mode_source, 'automatic');
  assert.equal(trace.events?.length, 5);
  assert.equal(trace.events?.[1]?.event_type, 'run.mode_resolved');
  assert.equal(trace.events?.[1]?.schema_version, 2);
  assert.equal(trace.events?.[1]?.payload?.requested_mode, 'auto');
  assert.equal(trace.events?.[1]?.payload?.resolved_mode, 'chat_assist');
  assert.equal(trace.events?.[1]?.payload?.mode_source, 'automatic');
  assert.equal(trace.events?.[1]?.payload?.mode_locked_by_user, false);
  assert.equal(trace.events?.[2]?.delta, response.response);
  assert.equal(trace.events?.at(-1)?.terminal, true);
  assert.equal(trace.model_calls?.[0]?.model_name, 'deepseek-v4-flash');
  assert.equal(trace.model_calls?.[0]?.provider, 'deterministic_provider');

  const usageResponse = store.recordToolCallingChat({
    message: 'usage stats ping',
    model_name: 'deepseek-v4-flash',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
  }, {
    provider: 'openai_compatible',
    model_name: 'deepseek-v4-flash',
    final_message: 'usage stats pong',
    tool_results: [],
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cached_input_tokens: 200,
      cache_write_input_tokens: 50,
      reasoning_tokens: 25,
      total_tokens: 1500,
    },
    usage_status: 'recorded',
    finish_reason: 'stop',
    model_responses: [{ usage: { prompt_tokens: 1000, completion_tokens: 500 } }],
  });
  const usageTrace = store.getRunTrace(usageResponse.run_id);
  const usageCall = usageTrace.model_calls?.[0];
  assert.equal(usageCall?.input_tokens, 1000);
  assert.equal(usageCall?.output_tokens, 500);
  assert.equal(usageCall?.cached_input_tokens, 200);
  assert.equal(usageCall?.cache_write_input_tokens, 50);
  assert.equal(usageCall?.reasoning_tokens, 25);
  assert.equal(usageCall?.total_tokens, 1500);
  assert.equal(usageCall?.usage_status, 'recorded');
  assert.ok((usageCall?.cost_estimate ?? 0) > 0);
  const usageSummaryItem = store.getModelUsage().items.find((item) => item.provider === 'openai_compatible' && item.model === 'deepseek-v4-flash');
  assert.equal(usageSummaryItem?.total_tokens, 1500);
  assert.ok(Number(usageSummaryItem?.estimated_cost ?? 0) > 0);

  const legacyACPUsageResponse = store.recordToolCallingChat({
    message: 'legacy ACP usage summary',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'gpt-5.6-terra[medium]',
  }, {
    provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-terra[medium]',
    selected_agent_id: 'general_agent',
    final_message: 'legacy ACP usage recorded',
    tool_results: [],
    usage: {
      input_tokens: 56_624,
      output_tokens: 1_000,
      cached_input_tokens: 71_168,
      total_tokens: 128_792,
    },
    usage_status: 'recorded',
    finish_reason: 'end_turn',
    model_responses: [{ protocol: 'acp' }],
  });
  store['exec'](
    `UPDATE model_calls SET metadata=json_remove(metadata, '$.input_tokens_include_cached') WHERE run_id=?`,
    legacyACPUsageResponse.run_id,
  );
  store['exec'](`UPDATE runs SET duration_ms=25000 WHERE id=?`, legacyACPUsageResponse.run_id);
  const legacyACPSummary = store.getModelUsage().items.find((item) => item.provider === 'acp_codex_cli');
  assert.equal(legacyACPSummary?.input_tokens, 56_624 + 71_168);
  assert.ok(Number(legacyACPSummary?.cache_hit_ratio) <= 1);
  assert.ok(Math.abs(Number(legacyACPSummary?.cache_hit_ratio) - (71_168 / (56_624 + 71_168))) < 1e-12);
  assert.equal(legacyACPSummary?.avg_latency_ms, 25_000);

  const acpLatencyStarted = store.beginToolCallingChat({
    message: 'measure ACP model latency',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'gpt-5.6-terra[medium]',
  }, {
    provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-terra[medium]',
    selected_agent_id: 'general_agent',
  });
  store['exec'](`UPDATE model_calls SET created_at=datetime('now', '-25 seconds') WHERE id=?`, acpLatencyStarted.model_call_id);
  store.finishToolCallingChat(acpLatencyStarted, {
    status: 'completed',
    provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-terra[medium]',
    selected_agent_id: 'general_agent',
    final_message: 'ACP latency measured',
    tool_results: [],
    usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 40, total_tokens: 110 },
    usage_status: 'recorded',
    finish_reason: 'end_turn',
    model_responses: [{ protocol: 'acp' }],
  });
  const acpLatencyCall = store.getRunTrace(acpLatencyStarted.run_id).model_calls[0];
  assert.ok(acpLatencyCall.latency_ms >= 24_000 && acpLatencyCall.latency_ms <= 27_000, `unexpected ACP latency: ${acpLatencyCall.latency_ms}`);

  const imageStarted = store.beginToolCallingChat({
    message: '生成一张蓝色圆形图片',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'grok-4.5',
  }, {
    provider: 'grok_build',
    model_name: 'grok-4.5',
    selected_agent_id: 'general_agent',
  });
  const imageResponse = store.finishToolCallingChat(imageStarted, {
    status: 'completed',
    provider: 'grok_build',
    model_name: 'grok-4.5',
    selected_agent_id: 'general_agent',
    final_message: '图片已生成。',
    tool_results: [{
      call_id: 'call_image_generate_1',
      name: 'image_generate',
      arguments: { prompt: '蓝色圆形', aspect_ratio: '1:1' },
      output: {
        status: 'completed',
        capability: 'image_generate',
        mode: 'grok_build_native_image_gen',
        provider: 'grok_build',
        model: 'grok-4.5',
        native_tool: 'image_gen',
        source_session_id: 'grok-session-image-1',
        source_tool_call_id: 'native-image-call-1',
        prompt_sha256: 'prompt-hash',
        aspect_ratio: '1:1',
        file_path: '/tmp/joi-generated-image.jpg',
        summary: 'Grok Build 已生成图片。',
        attachment: {
          id: 'attachment_image_1',
          name: 'joi-generated-image.jpg',
          kind: 'image',
          mime_type: 'image/jpeg',
          size: 2048,
          preview_url: 'file:///tmp/joi-generated-image.jpg',
        },
      },
    }],
    usage: { input_tokens: 50, output_tokens: 20 },
    usage_status: 'recorded',
    finish_reason: 'stop',
    model_responses: [{ id: 'chatcmpl_image_generation' }],
  });
  const imageConversation = store.getConversation(imageResponse.conversation_id);
  assert.deepEqual(imageConversation.messages.at(-1)?.attachments, [{
    id: 'attachment_image_1',
    name: 'joi-generated-image.jpg',
    kind: 'image',
    mime_type: 'image/jpeg',
    size: 2048,
    preview_url: 'file:///tmp/joi-generated-image.jpg',
  }]);
  const imageArtifact = store.listArtifacts({ type: 'image', limit: 10 }).artifacts.find((item) => item.source_run_id === imageResponse.run_id);
  assert.equal(imageArtifact?.metadata?.native_tool, 'image_gen');
  assert.equal(imageArtifact?.metadata?.preview_url, 'file:///tmp/joi-generated-image.jpg');
  const imageTrace = store.getRunTrace(imageResponse.run_id);
  assert.ok(imageTrace.events.some((event) => event.event_type === 'artifact.created' && event.payload?.native_tool === 'image_gen'));

  for (const media of [
    {
      capability: 'video_generate', kind: 'video', mime: 'video/mp4', name: 'joi-generated-video.mp4',
      path: '/tmp/joi-generated-video.mp4', size: 60_165, mode: 'xai_async_video_v1', provider: 'xai', model: 'grok-imagine-video',
    },
    {
      capability: 'text_to_speech', kind: 'audio', mime: 'audio/wav', name: 'joi-generated-speech.wav',
      path: '/tmp/joi-generated-speech.wav', size: 42_000, mode: 'macos_say_ffmpeg_v1', provider: 'local_macos', model: '',
    },
  ]) {
    const started = store.beginToolCallingChat({
      message: `test ${media.capability}`,
      runtime_mode: 'tool_calling',
      model_name: 'fixture-model',
    }, { provider: 'openai_compatible', model_name: 'fixture-model', selected_agent_id: 'general_agent' });
    const responseWithMedia = store.finishToolCallingChat(started, {
      status: 'completed', provider: 'openai_compatible', model_name: 'fixture-model', selected_agent_id: 'general_agent',
      final_message: `${media.capability} completed`,
      tool_results: [{
        call_id: `call_${media.capability}`,
        name: media.capability,
        arguments: {},
        output: {
          status: 'completed', capability: media.capability, mode: media.mode, provider: media.provider, model: media.model,
          duration_seconds: 1.04, file_path: media.path, summary: `${media.capability} completed`,
          attachment: {
            id: `attachment_${media.kind}_fixture`, name: media.name, kind: media.kind,
            mime_type: media.mime, size: media.size, preview_url: `file://${media.path}`,
          },
        },
      }],
      usage: {}, usage_status: 'provider_missing', finish_reason: 'stop', model_responses: [],
    });
    const messageAttachment = store.getConversation(responseWithMedia.conversation_id).messages.at(-1)?.attachments?.[0];
    assert.equal(messageAttachment?.kind, media.kind);
    assert.equal(messageAttachment?.mime_type, media.mime);
    const artifact = store.listArtifacts({ type: media.kind, limit: 10 }).artifacts.find((item) => item.source_run_id === responseWithMedia.run_id);
    assert.equal(artifact?.type, media.kind);
    assert.equal(artifact?.metadata?.generation_mode, media.mode);
  }

  const acpMediaStarted = store.beginToolCallingChat({
    message: 'test ACP wrapped speech attachment', runtime_mode: 'tool_calling', model_name: 'fixture-model',
  }, { provider: 'acp_codex_cli', model_name: 'fixture-model', selected_agent_id: 'general_agent' });
  const acpMediaPayload = {
    status: 'completed', capability: 'text_to_speech', mode: 'macos_say_ffmpeg_v1', provider: 'local_macos',
    duration_seconds: 4.5, file_path: '/tmp/joi-acp-speech.wav',
    attachment: {
      id: 'attachment_acp_audio_fixture', name: 'joi-acp-speech.wav', kind: 'audio',
      mime_type: 'audio/wav', size: 84_000, preview_url: 'file:///tmp/joi-acp-speech.wav',
    },
  };
  const acpMediaResponse = store.finishToolCallingChat(acpMediaStarted, {
    status: 'completed', provider: 'acp_codex_cli', model_name: 'fixture-model', selected_agent_id: 'general_agent',
    final_message: 'ACP speech completed',
    tool_results: [{
      call_id: 'call_acp_text_to_speech', name: 'mcp.joi_capabilities.text_to_speech', arguments: {},
      output: {
        status: 'succeeded', protocol: 'acp', kind: 'other',
        raw_output: { result: { content: [{ type: 'text', text: JSON.stringify(acpMediaPayload) }], structuredContent: acpMediaPayload }, error: null },
      },
    }],
    usage: {}, usage_status: 'provider_missing', finish_reason: 'stop', model_responses: [],
  });
  const acpMediaAttachment = store.getConversation(acpMediaResponse.conversation_id).messages.at(-1)?.attachments?.[0];
  assert.equal(acpMediaAttachment?.kind, 'audio');
  assert.equal(acpMediaAttachment?.preview_url, 'file:///tmp/joi-acp-speech.wav');
  const acpMediaArtifact = store.listArtifacts({ type: 'audio', limit: 20 }).artifacts.find((item) => item.source_run_id === acpMediaResponse.run_id);
  assert.equal(acpMediaArtifact?.metadata?.generation_mode, 'macos_say_ffmpeg_v1');
  assert.equal(acpMediaArtifact?.metadata?.file_path, '/tmp/joi-acp-speech.wav');

  const chatOnlyResponse = await store.sendDeterministicChat({
    message: '今天只做一个纯聊天检查：用一句话回复我，不要创建任务。',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
  });
  const chatOnlyTrace = store.getRunTrace(chatOnlyResponse.run_id);
  assert.equal(chatOnlyTrace.resolved_mode, 'chat_assist');
  assert.equal(chatOnlyResponse.product_task, undefined);
  assert.equal(store.listProductTasks({ conversation_id: chatOnlyResponse.conversation_id, limit: 10 }).tasks.length, 0);

  const explicitChatResponse = await store.sendDeterministicChat({
    message: '请帮我分析和实现这个功能，但这次我明确选择普通聊天，不创建任务。',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
  });
  const explicitChatTrace = store.getRunTrace(explicitChatResponse.run_id);
  const explicitChatModeEvent = explicitChatTrace.events.find((event) => event.event_type === 'run.mode_resolved');
  assert.equal(explicitChatTrace.requested_mode, 'chat_assist');
  assert.equal(explicitChatTrace.resolved_mode, 'chat_assist');
  assert.equal(explicitChatTrace.mode_source, 'explicit');
  assert.equal(explicitChatModeEvent?.payload?.mode_locked_by_user, true);
  assert.equal(explicitChatModeEvent?.payload?.reason, 'User selected chat_assist.');
  assert.equal(store.listProductTasks({ conversation_id: explicitChatResponse.conversation_id, limit: 10 }).tasks.length, 0);

  const telegramBuildTask = await store.sendDeterministicChat({
    channel: 'telegram',
    user_id: 'telegram:1234567890',
    message: '为 joi 构建一个简单的 loading page',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
  });
  const telegramBuildTrace = store.getRunTrace(telegramBuildTask.run_id);
  assert.equal(telegramBuildTrace.entry_channel, 'telegram');
  assert.equal(telegramBuildTrace.requested_mode, 'auto');
  assert.equal(telegramBuildTrace.resolved_mode, 'serious_task');
  assert.equal(telegramBuildTrace.mode_source, 'automatic');
  const telegramBuildProductTask = store.listProductTasks({ conversation_id: telegramBuildTask.conversation_id, limit: 10 })
    .tasks.find((task) => task.source_run_id === telegramBuildTask.run_id);
  assert.ok(telegramBuildProductTask);
  assert.equal(telegramBuildProductTask.mode, 'serious_task');
  assert.equal(telegramBuildProductTask.source_channel, 'telegram');
  assert.equal(telegramBuildProductTask.source_run_id, telegramBuildTask.run_id);
  assert.equal(telegramBuildProductTask.principal_id, telegramBuildTrace.principal_id);
  assert.equal(store['get'](`SELECT product_task_id FROM task_entry_links WHERE principal_id=?`, telegramBuildTrace.principal_id).product_task_id, telegramBuildProductTask.id);

  const models = store.listSavedModels().models.map((model) => model.id);
  assert.ok(models.includes('deepseek-v4-flash'));
  assert.ok(models.includes('deterministic-local-model'));
  assert.ok(!models.includes('mock-model'));

  const health = store.systemHealth();
  assert.deepEqual(health.service_status, { sqlite: true, electron: 'running', runtime: 'electron_ts_sqlite' });
  assert.ok(Number(health.token_cost_today.cache_hit_ratio) <= 1);
  assert.ok(Number(health.model_latency.avg_latency_ms) > 0);

  const capabilities = store.listCapabilities().capabilities.map((capability) => capability.id);
  assert.ok(capabilities.includes('memory_search'));
  assert.ok(capabilities.includes('memory_recall'));
  assert.ok(capabilities.includes('session_search'));
  assert.ok(capabilities.includes('tool_search'));
  assert.ok(capabilities.includes('shell_start'));
  assert.ok(capabilities.includes('task_update'));
  assert.ok(capabilities.includes('apply_patch'));
  assert.ok(capabilities.includes('request_user_input'));
  assert.ok(capabilities.includes('automation_update'));

  const workflows = store.listToolWorkflows().workflows.map((workflow) => workflow.name);
  assert.ok(workflows.includes('memory_search_v1'));
  assert.ok(workflows.includes('memory_recall_v1'));
  assert.ok(workflows.includes('session_search_v1'));
  assert.ok(workflows.includes('shell_start_v1'));

  const automation = store.saveAutomation({
    kind: 'schedule',
    execution_kind: 'cron',
    name: 'Store automation interval',
    trigger_config: { type: 'interval', every_minutes: 15 },
    prompt_template: 'Run store automation for {{payload.subject}}',
    rrule: 'FREQ=MINUTELY;INTERVAL=15',
    model: 'deepseek-v4-flash',
    model_provider: 'openai_compatible',
    model_base_url: 'https://api.deepseek.com/v1',
    reasoning_effort: 'medium',
    cwds: ['/tmp/joi-automation'],
    execution_environment: 'local',
    target: { kind: 'new_task' },
  });
  assert.equal(automation.kind, 'schedule');
  assert.equal(automation.execution_kind, 'cron');
  assert.equal(automation.status, 'ACTIVE');
  assert.equal(automation.enabled, true);
  assert.equal(automation.permission_profile, 'read_only');
  assert.equal(automation.rrule, 'FREQ=MINUTELY;INTERVAL=15');
  assert.equal(automation.model, 'deepseek-v4-flash');
  assert.equal(automation.model_provider, 'openai_compatible');
  assert.equal(automation.model_base_url, 'https://api.deepseek.com/v1');
  assert.equal(automation.reasoning_effort, 'medium');
  assert.deepEqual(automation.cwds, ['/tmp/joi-automation']);
  assert.equal(automation.execution_environment, 'local');
  assert.deepEqual(automation.target, { kind: 'new_task' });
  assert.equal(store.listAutomations({ kind: 'schedule' }).automations.some((item) => item.id === automation.id), true);
  const triggerInsert = store.enqueueAutomationTrigger({
    automation_id: automation.id,
    trigger_type: 'schedule',
    dedup_key: 'schedule:store:1',
    payload: { subject: 'dedup' },
    fire_at: new Date(Date.now() - 1000).toISOString(),
  });
  const triggerDuplicate = store.enqueueAutomationTrigger({
    automation_id: automation.id,
    trigger_type: 'schedule',
    dedup_key: 'schedule:store:1',
    payload: { subject: 'dedup duplicate' },
    fire_at: new Date().toISOString(),
  });
  assert.equal(triggerDuplicate.deduped, true);
  assert.equal(triggerDuplicate.trigger.id, triggerInsert.trigger.id);
  const claimed = store.claimDueAutomationTrigger(new Date().toISOString());
  assert.equal(claimed?.trigger.id, triggerInsert.trigger.id);
  assert.equal(claimed?.trigger.attempt_count, 1);
  assert.equal(store.claimDueAutomationTrigger(new Date().toISOString()), undefined);
  const automationResponse = await store.sendDeterministicChat({
    channel: 'automation',
    message: 'store automation execution',
    input_mode: 'background_task',
    runtime_mode: 'tool_calling',
    permission_profile: 'read_only',
  });
  const automationRun = store.recordAutomationRunStarted({
    automation_id: automation.id,
    trigger_id: claimed.trigger.id,
    run_id: automationResponse.run_id,
    product_task_id: automationResponse.product_task?.id,
    conversation_id: automationResponse.conversation_id,
    source_cwd: automation.cwds[0],
    automation_name: automation.name,
  });
  store.recordAutomationRunCompleted({
    automation_run_id: automationRun.id,
    run_id: automationResponse.run_id,
    output_summary: 'store automation completed',
  });
  const completedAutomationRun = store.listAutomationRuns({ automation_id: automation.id }).runs[0];
  assert.equal(completedAutomationRun.status, 'succeeded');
  assert.equal(completedAutomationRun.conversation_id, automationResponse.conversation_id);
  assert.equal(completedAutomationRun.source_cwd, '/tmp/joi-automation');
  assert.equal(completedAutomationRun.automation_name, automation.name);
  assert.equal(completedAutomationRun.read_at, undefined);
  assert.equal(completedAutomationRun.archived_at, undefined);
  assert.ok(store.setAutomationRunRead({ id: completedAutomationRun.id, read: true }).read_at);
  assert.equal(store.setAutomationRunRead({ id: completedAutomationRun.id, read: false }).read_at, undefined);
  assert.equal(store.markAllAutomationRunsRead({ automation_id: automation.id }).updated, 1);
  assert.ok(store.listAutomationRuns({ automation_id: automation.id }).runs[0].read_at);
  assert.ok(store.setAutomationRunArchived({ id: completedAutomationRun.id, archived: true }).archived_at);
  assert.equal(store.setAutomationRunArchived({ id: completedAutomationRun.id, archived: false }).archived_at, undefined);
  assert.deepEqual(store.archiveAllAutomationRuns({ automation_id: automation.id }), { succeeded_count: 1, failed_count: 0 });
  assert.ok(store.listAutomationRuns({ automation_id: automation.id }).runs[0].archived_at);
  assert.equal(store.listAutomationTriggers({ automation_id: automation.id }).triggers[0].status, 'succeeded');
  const automationCompletedEvent = store.getRunTrace(automationResponse.run_id).events.find((event) => event.event_type === 'automation.run_completed');
  assert.equal(automationCompletedEvent?.status, 'completed');
  assert.equal(automationCompletedEvent?.terminal, true);
  assert.equal(automationCompletedEvent?.visibility, 'trace_only');

  const concurrencyTriggerOne = store.enqueueAutomationTrigger({
    automation_id: automation.id,
    trigger_type: 'schedule',
    dedup_key: 'schedule:store:concurrency:1',
    payload: { concurrency: 1 },
    fire_at: new Date(Date.now() - 1000).toISOString(),
  }).trigger;
  const concurrencyTriggerTwo = store.enqueueAutomationTrigger({
    automation_id: automation.id,
    trigger_type: 'schedule',
    dedup_key: 'schedule:store:concurrency:2',
    payload: { concurrency: 2 },
    fire_at: new Date(Date.now() - 1000).toISOString(),
  }).trigger;
  const firstConcurrencyClaim = store.claimDueAutomationTrigger(new Date().toISOString());
  assert.equal(firstConcurrencyClaim?.trigger.id, concurrencyTriggerOne.id);
  assert.equal(store.claimDueAutomationTrigger(new Date().toISOString()), undefined);
  store.recordAutomationTriggerFailed({
    trigger_id: concurrencyTriggerOne.id,
    error_code: 'TEST_COMPLETE',
    error_message: 'release concurrency slot',
  });
  const secondConcurrencyClaim = store.claimDueAutomationTrigger(new Date().toISOString());
  assert.equal(secondConcurrencyClaim?.trigger.id, concurrencyTriggerTwo.id);
  store.recordAutomationTriggerFailed({
    trigger_id: concurrencyTriggerTwo.id,
    error_code: 'TEST_COMPLETE',
    error_message: 'release concurrency slot',
  });

  store.setAutomationEnabled({ id: automation.id, enabled: false });
  const pausedManualTrigger = store.triggerAutomationNow({ id: automation.id, payload: { paused_manual: true } }).trigger;
  const pausedManualClaim = store.claimDueAutomationTrigger(new Date().toISOString());
  assert.equal(pausedManualClaim?.trigger.id, pausedManualTrigger.id);
  store.recordAutomationTriggerFailed({
    trigger_id: pausedManualTrigger.id,
    error_code: 'TEST_COMPLETE',
    error_message: 'paused manual run was claimable',
  });
  store.setAutomationEnabled({ id: automation.id, enabled: true });

  const retryAutomation = store.saveAutomation({
    kind: 'webhook',
    name: 'Store automation webhook',
    trigger_config: { dedup_json_field: 'event_id' },
    dedup_policy: { dedup_json_field: 'event_id' },
  });
  const retryTrigger = store.enqueueAutomationTrigger({
    automation_id: retryAutomation.id,
    trigger_type: 'webhook',
    dedup_key: 'json:event_id:retry',
    payload: { event_id: 'retry' },
    fire_at: new Date(Date.now() - 1000).toISOString(),
  }).trigger;
  const retryClaim = store.claimDueAutomationTrigger(new Date().toISOString());
  assert.equal(retryClaim?.trigger.id, retryTrigger.id);
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const failedTrigger = store.recordAutomationTriggerFailed({
    trigger_id: retryTrigger.id,
    error_code: 'RUNTIME_FAILED',
    error_message: 'transient failure',
    retry_at: retryAt,
  });
  assert.equal(failedTrigger.status, 'retry_scheduled');
  assert.equal(failedTrigger.next_attempt_at, retryAt);
  store.setAutomationEnabled({ id: retryAutomation.id, enabled: false });
  assert.throws(() => store.enqueueAutomationTrigger({
    automation_id: retryAutomation.id,
    trigger_type: 'webhook',
    dedup_key: 'json:event_id:disabled',
    payload: { event_id: 'disabled' },
  }), /Automation is disabled/);

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
    imessage_enabled: true,
    imessage_allowed_users: '+15551234567',
    imessage_require_mention: true,
    imessage_home_channel: '+15551234567',
    worker_gateway_enabled: false,
    backup_dir: join(tempDir, 'custom-backups'),
    auto_backup_enabled: true,
  });
  assert.equal(store.getSettings().telegram_enabled, true);
  assert.equal(store.getSettings().telegram_allowed_user_ids, '123');
  assert.equal(store.getSettings().imessage_enabled, true);
  assert.equal(store.getSettings().imessage_allowed_users, '+15551234567');
  assert.equal(store.getSettings().imessage_require_mention, true);
  store.saveIMessageSettings({
    enabled: true,
    project_id: 'photon_project_test',
    phone_number: '+15551234567',
    assigned_number: '+15557654321',
    allowed_users: '+15551234567',
    require_mention: false,
    sidecar_port: 8790,
  });
  assert.equal(store.getSettings().imessage_project_id, 'photon_project_test');
  assert.equal(store.getSettings().imessage_assigned_number, '+15557654321');
  assert.equal(store.getSettings().imessage_sidecar_port, 8790);
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
  store.updateMemory({ id: 'mem_test', action: 'edit_confirm', content: 'Prefer direct status updates.', summary: 'Direct status preference', run_id: response.run_id });
  const correctedMemory = store.listMemories({ query: 'direct', limit: 10 }).memories[0];
  assert.equal(correctedMemory.summary, 'Direct status preference');
  assert.notEqual(correctedMemory.id, 'mem_test');
  assert.equal(store['get'](`SELECT status FROM memories WHERE id='mem_test'`).status, 'superseded');
  assert.equal(store['get'](`SELECT merged_into_memory_id FROM memories WHERE id='mem_test'`).merged_into_memory_id, correctedMemory.id);
  assert.ok(store.getRunTrace(response.run_id).events.some((event) => event.event_type === 'memory.corrected' && event.item_id === correctedMemory.id && event.payload.previous_memory_id === 'mem_test'));
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_candidate_api', 'preference', 'Candidate API memory.', 'Candidate API memory', 'global', 'internal', 0.7, 'pending', '[]', '[]', '{}')`,
  );
  assert.equal(store.listMemoryCandidates({ limit: 10 }).memories[0].id, 'mem_candidate_api');
  store.decideMemoryCandidate({ id: 'mem_candidate_api', decision: 'confirm', run_id: response.run_id, comment: 'confirm via direct API' });
  assert.equal(store['get'](`SELECT status FROM memories WHERE id='mem_candidate_api'`).status, 'confirmed');
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_correct_api', 'preference', 'Temporary API memory.', 'Temporary API memory', 'global', 'internal', 0.7, 'confirmed', '[]', '[]', '{}')`,
  );
  store.correctMemory({ id: 'mem_correct_api', content: 'Corrected API memory.', summary: 'Corrected API memory', run_id: response.run_id });
  assert.equal(store['get'](`SELECT status FROM memories WHERE id='mem_correct_api'`).status, 'superseded');
  assert.equal(store.listMemories({ query: 'Corrected API', limit: 10 }).memories[0].summary, 'Corrected API memory');
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_delete_api', 'preference', 'Delete API memory.', 'Delete API memory', 'global', 'internal', 0.7, 'confirmed', '[]', '[]', '{}')`,
  );
  store.deleteMemory({ id: 'mem_delete_api', run_id: response.run_id, reason: 'delete via direct API' });
  assert.equal(store['get'](`SELECT status FROM memories WHERE id='mem_delete_api'`).status, 'deleted');
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_user_state_api', 'current_state', 'Currently validating memory APIs.', 'Memory API validation state', 'global', 'internal', 0.8, 'confirmed', '[]', '[]', '{}')`,
  );
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, pinned, metadata)
     VALUES ('mem_current_state_expired', 'current_state', 'Expired TTL project focus should never be recalled.', 'Expired TTL state', 'global', 'internal', 1.0, 'confirmed', '[]', '[]', 1, ?)`,
    JSON.stringify({ ttl_until: '2000-01-01T00:00:00Z' }),
  );
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_current_state_active', 'current_state', 'Active TTL project focus should be recalled.', 'Active TTL state', 'global', 'internal', 0.7, 'confirmed', '[]', '[]', ?)`,
    JSON.stringify({ ttl_until: '2999-01-01T00:00:00Z' }),
  );
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_relationship_api', 'relationship_state', 'Use direct factual tone.', 'Direct relationship tone', 'global', 'internal', 0.8, 'confirmed', '[]', '[]', '{}')`,
  );
  const userStates = store.listUserStates({ limit: 10 }).memories;
  assert.ok(userStates.some((memory) => memory.id === 'mem_user_state_api'));
  assert.ok(userStates.some((memory) => memory.id === 'mem_current_state_active'));
  assert.ok(!userStates.some((memory) => memory.id === 'mem_current_state_expired'));
  const ttlPrompt = store.assembleToolCallingPrompt({
    message: 'TTL project focus active expired',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, 'general_agent', 'real-tool-model');
  const ttlMemoryIDs = ttlPrompt.memory_results.map((result) => result.memory.id);
  assert.ok(ttlMemoryIDs.includes('mem_current_state_active'));
  assert.ok(!ttlMemoryIDs.includes('mem_current_state_expired'));
  assert.match(ttlPrompt.dynamic_tail, /Active TTL project focus/);
  assert.equal(ttlPrompt.dynamic_tail.includes('Expired TTL project focus'), false);

  store['exec'](`INSERT INTO projects (id, name, status) VALUES ('prj_memory_scope_a', 'Memory Scope A', 'active')`);
  store['exec'](`INSERT INTO projects (id, name, status) VALUES ('prj_memory_scope_b', 'Memory Scope B', 'active')`);
  store['exec'](
    `INSERT INTO conversations (id, channel, user_id, principal_id, active_project_id, title, metadata)
     VALUES ('conv_memory_scope', 'desktop', 'desktop_user', 'desktop_user', 'prj_memory_scope_a', 'Memory scope test', '{}')`,
  );
  store['exec'](
    `INSERT INTO rooms (id, type, title, owner_user_id, project_id, conversation_id, metadata)
     VALUES ('room_memory_scope', 'shared', 'Memory scope test', 'desktop_user', 'prj_memory_scope_a', 'conv_memory_scope', ?)`,
    JSON.stringify({ visible_project_ids: ['prj_memory_scope_a', 'prj_memory_scope_b'] }),
  );
  for (const [id, scopeType, scopeID, content] of [
    ['mem_scope_project_a', 'project', 'prj_memory_scope_a', 'Scope cipher belongs to project alpha.'],
    ['mem_scope_project_b', 'project', 'prj_memory_scope_b', 'Scope cipher belongs to project beta.'],
    ['mem_scope_room', 'room', 'room_memory_scope', 'Scope priority room exact.'],
    ['mem_scope_user', 'user', 'desktop_user', 'Scope priority user exact.'],
    ['mem_scope_global', 'global', '', 'Scope priority global exact.'],
  ]) {
    store['exec'](
      `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
       VALUES (?, 'preference', ?, ?, ?, NULLIF(?, ''), 'internal', 0.8, 'confirmed', '[]', '[]', '{}')`,
      id,
      content,
      content,
      scopeType,
      scopeID,
    );
  }
  const projectScopedPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Scope cipher',
    runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  assert.ok(projectScopedPrompt.memory_results.some((result) => result.memory.id === 'mem_scope_project_a'));
  assert.ok(!projectScopedPrompt.memory_results.some((result) => result.memory.id === 'mem_scope_project_b'));
  assert.deepEqual(projectScopedPrompt.memory_scope.project_ids, ['prj_memory_scope_a']);
  const toolScopedRecall = store.recallMemoriesForTool({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Scope cipher',
    runtime_mode: 'tool_calling',
  }, 'Scope cipher', 8);
  assert.ok(toolScopedRecall.memories.some((result) => result.memory.id === 'mem_scope_project_a'));
  assert.ok(!toolScopedRecall.memories.some((result) => result.memory.id === 'mem_scope_project_b'));
  assert.deepEqual(toolScopedRecall.scope.project_ids, ['prj_memory_scope_a']);
  const toolCandidateRequest = {
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Remember a scoped tool candidate',
    runtime_mode: 'tool_calling',
  };
  const toolCandidate = store.createMemoryCandidateForTool(toolCandidateRequest, {
    content: 'Tool candidate stays inside project alpha.',
    summary: 'Scoped tool candidate',
    scope: 'current_project',
  });
  assert.equal(toolCandidate.candidate.scope_type, 'project');
  assert.equal(toolCandidate.candidate.scope_id, 'prj_memory_scope_a');
  assert.equal(toolCandidate.candidate.status, 'pending');
  assert.equal(store.createMemoryCandidateForTool(toolCandidateRequest, {
    content: 'Tool candidate stays inside project alpha.',
    scope: 'current_project',
  }).deduped, true);
  const crossProjectPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    scope_override: 'cross_project',
    message: 'Scope cipher',
    runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  assert.ok(crossProjectPrompt.memory_results.some((result) => result.memory.id === 'mem_scope_project_a'));
  assert.ok(crossProjectPrompt.memory_results.some((result) => result.memory.id === 'mem_scope_project_b'));
  assert.equal(crossProjectPrompt.memory_scope.cross_project, true);
  const priorityPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Scope priority exact',
    runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  const priorityIDs = priorityPrompt.memory_results.map((result) => result.memory.id);
  assert.ok(priorityIDs.indexOf('mem_scope_room') < priorityIDs.indexOf('mem_scope_user'));
  assert.ok(priorityIDs.indexOf('mem_scope_user') < priorityIDs.indexOf('mem_scope_global'));

  for (let index = 0; index < 70; index += 1) {
    store['exec'](
      `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata, updated_at)
       VALUES (?, 'note', ?, ?, 'project', 'prj_memory_scope_a', 'internal', 0.99, 'confirmed', '[]', '[]', '{}', datetime('now', ?))`,
      `mem_recent_noise_${index}`,
      `Recent unrelated governance memory ${index}`,
      `Recent unrelated ${index}`,
      `-${index} seconds`,
    );
  }
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata, updated_at)
     VALUES ('mem_old_exact_fts', 'note', 'Rarearchivekey remains retrievable after governance truncation.', 'Old exact FTS memory', 'project', 'prj_memory_scope_a', 'internal', 0.2, 'confirmed', '[]', '[]', '{}', datetime('now', '-500 days'))`,
  );
  const oldExactPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Rarearchivekey',
    runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  const oldExact = oldExactPrompt.memory_results.find((result) => result.memory.id === 'mem_old_exact_fts');
  assert.ok(oldExact);
  assert.equal(oldExact.retrieval_source, 'fts');

  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, disabled_at, metadata)
     VALUES ('mem_hard_negative_disabled', 'note', 'Hardnegativekey disabled.', 'Disabled hard negative', 'project', 'prj_memory_scope_a', 'internal', 1, 'confirmed', '[]', '[]', datetime('now'), '{}')`,
  );
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_hard_negative_deleted', 'note', 'Hardnegativekey deleted.', 'Deleted hard negative', 'project', 'prj_memory_scope_a', 'internal', 1, 'deleted', '[]', '[]', '{}')`,
  );
  const hardNegativePrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope', room_id: 'room_memory_scope', message: 'Hardnegativekey', runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  assert.ok(!hardNegativePrompt.memory_results.some((result) => result.memory.id.startsWith('mem_hard_negative_')));

  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_disable_immediate', 'note', 'Immediategovernancekey disable target.', 'Disable target', 'project', 'prj_memory_scope_a', 'internal', 1, 'confirmed', '[]', '[]', '{}')`,
  );
  store.updateMemory({ id: 'mem_disable_immediate', action: 'disable' });
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, metadata)
     VALUES ('mem_delete_immediate', 'note', 'Immediategovernancekey delete target.', 'Delete target', 'project', 'prj_memory_scope_a', 'internal', 1, 'confirmed', '[]', '[]', '{}')`,
  );
  store.deleteMemory({ id: 'mem_delete_immediate' });
  const governedPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope', room_id: 'room_memory_scope', message: 'Immediategovernancekey', runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  assert.ok(!governedPrompt.memory_results.some((result) => ['mem_disable_immediate', 'mem_delete_immediate'].includes(result.memory.id)));

  for (const [id, positive, negative] of [
    ['mem_feedback_preferred', 4, 0],
    ['mem_feedback_penalized', 0, 4],
  ]) {
    store['exec'](
      `INSERT INTO memories (id, type, content, summary, scope_type, scope_id, privacy_level, confidence, status, source_event_ids, entities, positive_feedback, negative_feedback, metadata)
       VALUES (?, 'note', 'Feedbackrankkey comparable memory.', ?, 'project', 'prj_memory_scope_a', 'internal', 0.7, 'confirmed', '[]', '[]', ?, ?, '{}')`,
      id,
      id,
      positive,
      negative,
    );
  }
  const feedbackPrompt = store.assembleToolCallingPrompt({
    conversation_id: 'conv_memory_scope', room_id: 'room_memory_scope', message: 'Feedbackrankkey', runtime_mode: 'tool_calling',
  }, 'general_agent', 'real-tool-model');
  assert.ok(feedbackPrompt.memory_results.findIndex((result) => result.memory.id === 'mem_feedback_preferred')
    < feedbackPrompt.memory_results.findIndex((result) => result.memory.id === 'mem_feedback_penalized'));

  const scopedRetrievalChat = store.recordToolCallingChat({
    conversation_id: 'conv_memory_scope',
    room_id: 'room_memory_scope',
    user_id: 'desktop_user',
    message: 'Scope cipher project alpha',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Scoped retrieval completed.',
    tool_results: [],
    usage: { input_tokens: 4, output_tokens: 3 },
    model_responses: [{ id: 'chatcmpl_scoped_memory' }],
  });
  const scopedTrace = store.getRunTrace(scopedRetrievalChat.run_id);
  assert.ok(scopedTrace.events.some((event) => event.event_type === 'memory.scope_resolved'
    && event.payload.project_ids.includes('prj_memory_scope_a')
    && !event.payload.project_ids.includes('prj_memory_scope_b')));
  assert.ok(scopedTrace.events.some((event) => event.event_type === 'memory.recalled'
    && event.payload.scope_match === 'project'
    && ['fts', 'governance'].includes(event.payload.retrieval_source)));
  const scopedPack = store['get'](`SELECT metadata FROM memory_context_packs WHERE run_id=?`, scopedRetrievalChat.run_id);
  assert.deepEqual(JSON.parse(scopedPack.metadata).memory_scope.project_ids, ['prj_memory_scope_a']);
  assert.ok(Number(store['get'](`SELECT COUNT(*) AS count FROM memory_usage_logs WHERE run_id=? AND injected=1`, scopedRetrievalChat.run_id).count) > 0);

  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata, created_at)
     VALUES ('mem_old_candidate_a', 'preference', 'Duplicate lifecycle candidate.', 'Old candidate A', 'global', 'internal', 0.6, 'proposed', '[]', '[]', '{}', datetime('now', '-10 days'))`,
  );
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, metadata, created_at)
     VALUES ('mem_old_candidate_b', 'preference', 'Duplicate lifecycle candidate.', 'Old candidate B', 'global', 'internal', 0.6, 'pending', '[]', '[]', '{}', datetime('now', '-9 days'))`,
  );
  const memoryMetrics = store.listMemories({ limit: 10 }).metrics;
  assert.ok(memoryMetrics.candidate_count >= 2);
  assert.ok(memoryMetrics.old_candidate_count >= 2);
  assert.ok(memoryMetrics.duplicate_candidate_count >= 1);
  assert.ok(memoryMetrics.injected_count >= 1);
  assert.ok(memoryMetrics.scope_counts.project >= 1);

  assert.ok(ttlPrompt.agent_capabilities.includes('workspace_search'));
  assert.ok(ttlPrompt.agent_capabilities.includes('apply_patch'));
  const researchPrompt = store.assembleToolCallingPrompt({
    message: 'Research current release notes',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, 'research_agent', 'real-tool-model');
  assert.deepEqual(researchPrompt.agent_capabilities, ['web_research']);
  assert.deepEqual(
    compileElectronCapabilityTools('danger_full_access', { allowed_capabilities: researchPrompt.agent_capabilities }).map((tool) => tool.name),
    ['web_research'],
  );
  assert.deepEqual(store.getAgentCapabilities('memory_agent'), ['memory_search']);
  const explicitAgentRoute = store['resolveAgentRoute']('conv_route_explicit', '@devops_agent 检查服务状态');
  assert.equal(explicitAgentRoute.agent_id, 'devops_agent');
  assert.equal(explicitAgentRoute.source, 'explicit');
  const researchAgentRoute = store['resolveAgentRoute']('conv_route_research', '帮我搜一下最新消息');
  assert.equal(researchAgentRoute.agent_id, 'research_agent');
  assert.equal(researchAgentRoute.source, 'rule');
  store['exec'](
    `INSERT INTO conversations (id, channel, user_id, title, active_agent_id, metadata)
     VALUES ('conv_agent_sticky', 'desktop', 'desktop_user', 'Sticky agent', 'memory_agent', '{}')`,
  );
  const stickyAgentRoute = store['resolveAgentRoute']('conv_agent_sticky', '继续刚才的话题');
  assert.equal(stickyAgentRoute.agent_id, 'memory_agent');
  assert.equal(stickyAgentRoute.source, 'sticky');
  assert.equal(store.listRelationshipStates({ limit: 10 }).memories[0].id, 'mem_relationship_api');

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
  store.interruptRun({ run_id: response.run_id, reason: 'duplicate interrupt' });
  const interruptedTrace = store.getRunTrace(response.run_id);
  assert.equal(interruptedTrace.status, 'cancelled');
  assert.equal(interruptedTrace.events?.at(-1)?.event_type, 'run.interrupted');
  assert.equal(interruptedTrace.events.filter((event) => event.event_type === 'run.cancel_requested').length, 1);
  assert.equal(interruptedTrace.events.filter((event) => event.event_type === 'run.cancelled').length, 1);
  assert.equal(interruptedTrace.events.filter((event) => event.event_type === 'run.interrupted').length, 1);

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
  assert.ok(toolCallingChat.used_memories.some((result) => result.memory.id === correctedMemory.id));
  assert.ok(!toolCallingChat.used_memories.some((result) => result.memory.id === 'mem_test'));
  const toolCallingTrace = store.getRunTrace(toolCallingChat.run_id);
  assert.equal(toolCallingTrace.status, 'completed');
  assert.ok(toolCallingTrace.events.some((event) => event.event_type === 'memory.recalled' && event.item_id === correctedMemory.id));
  assert.ok(!toolCallingTrace.events.some((event) => event.event_type === 'memory.recalled' && event.item_id === 'mem_test'));
  const memoriesUsedForToolRun = store.listMemoriesUsedForRun(toolCallingChat.run_id).memories;
  assert.ok(memoriesUsedForToolRun.some((result) => result.memory.id === correctedMemory.id && result.reason));
  assert.equal(toolCallingTrace.model_calls[0].provider, 'openai_compatible');
  assert.equal(toolCallingTrace.model_calls[0].input_tokens, 31);
  assert.equal(toolCallingTrace.model_calls[0].cached_input_tokens, 7);
  assert.equal(JSON.parse(store['get'](`SELECT metadata FROM model_calls WHERE run_id=?`, toolCallingChat.run_id).metadata).tool_run_count, 1);
  assert.equal(toolCallingTrace.steps.find((step) => step.step_type === 'tool_finished')?.output?.mode, 'workspace_search_v1_model_tool_test');
  const turnItemCount = Number(store['get'](`SELECT COUNT(*) AS count FROM turn_items WHERE run_id=?`, toolCallingChat.run_id)?.count || 0);
  assert.equal(turnItemCount, 4);
  const persistedToolRun = store['get'](`SELECT capability_id, input, output FROM tool_runs WHERE run_id=?`, toolCallingChat.run_id);
  assert.equal(persistedToolRun.capability_id, 'workspace_search');
  assert.equal(JSON.parse(persistedToolRun.input).query, 'Run Trace');
  assert.equal(JSON.parse(persistedToolRun.output).mode, 'workspace_search_v1_model_tool_test');

  const webSearchAliasChat = store.recordToolCallingChat({
    message: 'Search for the GPT-6 release date',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'No official GPT-6 release date is available.',
    tool_results: [{
      call_id: 'call_web_search_alias',
      name: 'web_search',
      arguments: { query: 'GPT-6 release date OpenAI' },
      output: { status: 'completed', summary: 'Search completed.' },
    }],
    usage: { input_tokens: 3, output_tokens: 2 },
    model_responses: [{ id: 'chatcmpl_web_search_alias' }],
  });
  const webSearchAliasToolRun = store['get'](
    `SELECT capability_id, workflow_name, tool_name FROM tool_runs WHERE run_id=?`,
    webSearchAliasChat.run_id,
  );
  assert.equal(webSearchAliasToolRun.capability_id, 'web_research');
  assert.equal(webSearchAliasToolRun.workflow_name, 'web_research_v1');
  assert.equal(webSearchAliasToolRun.tool_name, 'web_search');
  assert.equal(store.getRunTrace(webSearchAliasChat.run_id).status, 'completed');

  const unsupportedAliasChat = store.recordToolCallingChat({
    message: 'Record an unsupported model tool safely',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'The requested tool is unsupported.',
    tool_results: [{
      call_id: 'call_unknown_alias',
      name: 'unknown_model_tool',
      arguments: {},
      output: { status: 'failed', error: 'Unsupported capability.' },
    }],
    usage: { input_tokens: 2, output_tokens: 2 },
    model_responses: [{ id: 'chatcmpl_unknown_alias' }],
  });
  const unsupportedAliasToolRun = store['get'](
    `SELECT capability_id, tool_name, status FROM tool_runs WHERE run_id=?`,
    unsupportedAliasChat.run_id,
  );
  assert.equal(unsupportedAliasToolRun.capability_id, null);
  assert.equal(unsupportedAliasToolRun.tool_name, 'unknown_model_tool');
  assert.equal(unsupportedAliasToolRun.status, 'failed');
  const promptRow = store['get'](`SELECT cacheable_prefix, dynamic_tail FROM prompt_assemblies WHERE run_id=?`, toolCallingChat.run_id);
  assert.ok(promptRow.cacheable_prefix.includes('Joi Electron Tool Calling Runtime'));
  assert.ok(promptRow.cacheable_prefix.includes('Your product identity is Joi'));
  assert.ok(promptRow.cacheable_prefix.includes('The selected model id for this run is real-tool-model'));
  assert.ok(promptRow.cacheable_prefix.includes('Do not claim to be Claude'));
  assert.ok(promptRow.cacheable_prefix.includes('Keep ordinary chat replies concise by default'));
  assert.ok(promptRow.cacheable_prefix.includes('Earlier turn-specific wording, exact-output formats'));
  assert.ok(promptRow.cacheable_prefix.includes('Never continue a previous fixed answer such as RESULT=4'));
  assert.ok(promptRow.cacheable_prefix.includes('Do not proactively add emoji'));
  assert.ok(promptRow.dynamic_tail.includes('Prefer direct status updates.'));
  const memoryPackRow = store['get'](`SELECT dynamic_retrieval FROM memory_context_packs WHERE run_id=?`, toolCallingChat.run_id);
  const dynamicMemoryIDs = JSON.parse(memoryPackRow.dynamic_retrieval).map((result) => result.memory.id);
  assert.ok(dynamicMemoryIDs.includes(correctedMemory.id));
  assert.ok(!dynamicMemoryIDs.includes('mem_test'));

  const emojiSanitizedChat = store.recordToolCallingChat({
    message: '给我一个状态更新',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: '✅ 完成。请看。',
    tool_results: [],
    usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
    model_responses: [{ id: 'chatcmpl_emoji_sanitized', choices: [{ message: { content: '✅ 完成。请看。' } }] }],
  });
  assert.equal(emojiSanitizedChat.response, '完成。请看。');

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
  const seriousTaskModeEvent = seriousTaskTrace.events.find((event) => event.event_type === 'run.mode_resolved');
  assert.equal(seriousTaskTrace.requested_mode, 'serious_task');
  assert.equal(seriousTaskTrace.resolved_mode, 'serious_task');
  assert.equal(seriousTaskTrace.mode_source, 'explicit');
  assert.equal(seriousTaskModeEvent?.payload?.mode_locked_by_user, true);
  assert.equal(seriousTaskModeEvent?.payload?.contract_mode, 'execution');
  assert.ok(seriousTaskTrace.steps.some((step) => step.step_type === 'artifact_created'));
  assert.ok(seriousTaskTrace.steps.some((step) => step.step_type === 'task_verification_finished'));

  const disclosedWebFailureChat = store.recordToolCallingChat({
    message: '生成一份只保留已核验来源的免费游戏报告',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Epic 免费游戏页返回 403，无法完成正文核验，因此本期不列具体游戏。',
    tool_results: [{
      call_id: 'call_disclosed_web_failure',
      name: 'mcp.joi_web.web_extract',
      arguments: { url: 'https://store.epicgames.com/en-US/free-games' },
      output: {
        status: 'failed',
        fetch_status: 'http_error',
        status_code: 403,
        failure_class: 'origin_access_restricted',
        summary: 'Source could not be verified: HTTP 403.',
      },
    }],
    usage: { input_tokens: 4, output_tokens: 4 },
    model_responses: [{ id: 'chatcmpl_disclosed_web_failure' }],
  });
  assert.equal(disclosedWebFailureChat.product_task.status, 'completed');
  assert.equal(disclosedWebFailureChat.product_task.verification.status, 'passed');
  assert.match(disclosedWebFailureChat.product_task.verification.summary, /disclosed read-only source limitations/);
  const disclosedFailureCheck = disclosedWebFailureChat.product_task.verification.checks.find((check) => check.name === 'tool_failures_not_hidden');
  assert.equal(disclosedFailureCheck.status, 'passed');
  assert.equal(disclosedFailureCheck.evidence.failed_tool_count, 1);
  assert.equal(disclosedFailureCheck.evidence.disclosed_failure_count, 1);
  const disclosedWebFailureTrace = store.getRunTrace(disclosedWebFailureChat.run_id);
  assert.ok(disclosedWebFailureTrace.events.some((event) => event.event_type === 'tool.failed'));
  assert.ok(disclosedWebFailureTrace.events.some((event) => event.event_type === 'task.completed'));
  assert.ok(!disclosedWebFailureTrace.events.some((event) => event.event_type === 'task.blocked'));

  const hiddenWebFailureChat = store.recordToolCallingChat({
    message: '生成一份确认所有来源都成功的免费游戏报告',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Epic 免费游戏页已经完整核验，一切正常。',
    tool_results: [{
      call_id: 'call_hidden_web_failure',
      name: 'mcp.joi_web.web_extract',
      arguments: { url: 'https://store.epicgames.com/en-US/free-games' },
      output: {
        status: 'failed',
        fetch_status: 'http_error',
        status_code: 403,
        failure_class: 'origin_access_restricted',
      },
    }],
    usage: { input_tokens: 4, output_tokens: 4 },
    model_responses: [{ id: 'chatcmpl_hidden_web_failure' }],
  });
  assert.equal(hiddenWebFailureChat.product_task.status, 'blocked');
  assert.equal(hiddenWebFailureChat.product_task.verification.status, 'failed');
  const hiddenWebFailureTrace = store.getRunTrace(hiddenWebFailureChat.run_id);
  assert.ok(hiddenWebFailureTrace.events.some((event) => event.event_type === 'task.blocked'));

  const telegramTaskChat = store.recordToolCallingChat({
    conversation_id: 'conv_tg_handoff_test',
    channel: 'telegram',
    user_id: 'telegram:4242',
    message: '从 Telegram 开始一个 Joi 跨入口任务',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Telegram task is ready in Desktop.',
    tool_results: [],
    usage: { input_tokens: 6, output_tokens: 5 },
    model_responses: [{ id: 'chatcmpl_tg_handoff', choices: [{ message: { content: 'Telegram task is ready in Desktop.' } }] }],
  });
  const telegramTrace = store.getRunTrace(telegramTaskChat.run_id);
  assert.equal(telegramTrace.entry_channel, 'telegram');
  assert.ok(telegramTrace.principal_id?.startsWith('principal_'));
  assert.equal(telegramTaskChat.product_task.principal_id, telegramTrace.principal_id);
  assert.ok(telegramTrace.events.some((event) => event.event_type === 'handoff.linked' && event.item_type === 'handoff'));
  assert.equal(store['get'](`SELECT channel FROM channel_identities WHERE principal_id=?`, telegramTrace.principal_id).channel, 'telegram');
  assert.equal(store['get'](`SELECT conversation_id FROM conversation_entry_links WHERE principal_id=?`, telegramTrace.principal_id).conversation_id, telegramTaskChat.conversation_id);
  assert.equal(store['get'](`SELECT product_task_id FROM task_entry_links WHERE principal_id=?`, telegramTrace.principal_id).product_task_id, telegramTaskChat.product_task.id);

  const desktopContinuation = store.recordToolCallingChat({
    conversation_id: telegramTaskChat.conversation_id,
    channel: 'desktop',
    user_id: 'desktop_user',
    principal_id: telegramTrace.principal_id,
    product_task_id: telegramTaskChat.product_task.id,
    message: '在桌面继续刚才 Telegram 的任务',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'Desktop continued the same task.',
    tool_results: [],
    usage: { input_tokens: 4, output_tokens: 4 },
    model_responses: [{ id: 'chatcmpl_desktop_handoff', choices: [{ message: { content: 'Desktop continued the same task.' } }] }],
  });
  assert.equal(desktopContinuation.product_task.id, telegramTaskChat.product_task.id);
  const desktopContinuationTrace = store.getRunTrace(desktopContinuation.run_id);
  assert.equal(desktopContinuationTrace.principal_id, telegramTrace.principal_id);
  assert.ok(desktopContinuationTrace.events.some((event) => event.event_type === 'handoff.linked'));
  assert.ok(store.listProductTasks({ principal_id: telegramTrace.principal_id, limit: 20 }).tasks.some((task) => task.id === telegramTaskChat.product_task.id));
  assert.ok(store.listProductTasks({ conversation_id: telegramTaskChat.conversation_id, limit: 20 }).tasks.some((task) => task.id === telegramTaskChat.product_task.id));
  assert.ok(store.listProductTasks({ channel: 'telegram', limit: 20 }).tasks.some((task) => task.id === telegramTaskChat.product_task.id));
  assert.ok(store.listProductTasks({ channel: 'desktop', limit: 20 }).tasks.some((task) => task.id === telegramTaskChat.product_task.id));
  const imessageContinuation = store.recordToolCallingChat({
    conversation_id: 'conv_imessage_handoff_test',
    channel: 'imessage',
    user_id: 'imessage:+15551234567',
    principal_id: telegramTrace.principal_id,
    message: '从 iMessage 查询刚才同一个跨入口任务的进展',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'real-tool-model',
  }, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    selected_agent_id: 'general_agent',
    final_message: 'iMessage continued the same task.',
    tool_results: [],
    usage: { input_tokens: 4, output_tokens: 4 },
    model_responses: [{ id: 'chatcmpl_imessage_handoff', choices: [{ message: { content: 'iMessage continued the same task.' } }] }],
  });
  assert.equal(imessageContinuation.product_task.id, telegramTaskChat.product_task.id);
  const imessageContinuationTrace = store.getRunTrace(imessageContinuation.run_id);
  assert.equal(imessageContinuationTrace.principal_id, telegramTrace.principal_id);
  assert.equal(imessageContinuationTrace.resolved_mode, 'chat_assist');
  assert.ok(imessageContinuationTrace.events.some((event) => event.event_type === 'handoff.linked'));
  assert.ok(store.listProductTasks({ channel: 'imessage', limit: 20 }).tasks.some((task) => task.id === telegramTaskChat.product_task.id));
  const closedHandoffTask = store.closeProductTask({
    id: telegramTaskChat.product_task.id,
    outcome: 'blocked',
    reason: 'manual test closure for handoff task',
    actor: 'store-test',
  });
  assert.equal(closedHandoffTask.task.terminal_status, 'blocked');
  assert.equal(closedHandoffTask.task.terminal_reason, 'manual test closure for handoff task');
  assert.equal(closedHandoffTask.task.metadata.manual_close.reason, 'manual test closure for handoff task');
  const closedHandoffTrace = store.getRunTrace(closedHandoffTask.task.latest_run_id);
  assert.ok(closedHandoffTrace.events.some((event) => event.event_type === 'task.blocked' && event.item_id === telegramTaskChat.product_task.id));
  const reopenedHandoffTask = store.reopenProductTask({
    id: telegramTaskChat.product_task.id,
    reason: 'resume handoff task in test',
    actor: 'store-test',
  });
  assert.equal(reopenedHandoffTask.task.status, 'planning');
  assert.equal(reopenedHandoffTask.task.terminal_status, undefined);
  const reopenedHandoffTrace = store.getRunTrace(reopenedHandoffTask.task.latest_run_id);
  assert.ok(reopenedHandoffTrace.events.some((event) => event.event_type === 'task.planned' && event.item_id === telegramTaskChat.product_task.id && event.payload.reopened));

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
  const backgroundModeEvent = backgroundTrace.events.find((event) => event.event_type === 'run.mode_resolved');
  assert.equal(backgroundTrace.requested_mode, 'background_task');
  assert.equal(backgroundTrace.resolved_mode, 'background_task');
  assert.equal(backgroundTrace.mode_source, 'explicit');
  assert.equal(backgroundModeEvent?.payload?.mode_locked_by_user, true);
  assert.equal(backgroundModeEvent?.payload?.contract_mode, 'background');
  assert.ok(backgroundTrace.steps.some((step) => step.step_type === 'open_loop_created'));
  assert.ok(backgroundTrace.steps.some((step) => step.step_type === 'proactive_candidate_created'));
  assert.ok(backgroundTrace.events.some((event) => event.event_type === 'open_loop.created'));
  assert.ok(backgroundTrace.events.some((event) => event.event_type === 'proactive.candidate_created'));
  const backgroundProactive = store.listProactiveMessages({ status: 'draft' }).messages.find((item) => item.source_product_task_id === backgroundTaskChat.product_task.id);
  assert.ok(backgroundProactive);
  const backgroundOpenLoop = store.listOpenLoops({ status: 'open' }).open_loops.find((loop) => loop.source_product_task_id === backgroundTaskChat.product_task.id);
  assert.ok(backgroundOpenLoop);
  const futureDueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  store.decideOpenLoop({ id: backgroundOpenLoop.id, action: 'schedule', due_at: futureDueAt, feedback: 'scheduled in test' });
  assert.equal(store.listOpenLoops({ status: 'scheduled' }).open_loops.find((loop) => loop.id === backgroundOpenLoop.id).status, 'scheduled');
  store.decideOpenLoop({ id: backgroundOpenLoop.id, action: 'snooze', due_at: futureDueAt, feedback: 'snoozed in test' });
  assert.equal(store.listOpenLoops({ status: 'snoozed' }).open_loops.find((loop) => loop.id === backgroundOpenLoop.id).status, 'snoozed');
  const scheduledOpenLoopTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(scheduledOpenLoopTrace.events.some((event) => event.event_type === 'open_loop.scheduled' && event.item_id === backgroundOpenLoop.id));
  assert.ok(scheduledOpenLoopTrace.events.some((event) => event.event_type === 'open_loop.snoozed' && event.item_id === backgroundOpenLoop.id));
  store['exec'](
    `INSERT INTO proactive_messages (id, type, title, body, reason, source_open_loop_id, source_product_task_id, score, status, channel, metadata)
     VALUES ('pmsg_transition_test', 'followup', 'Transition coverage', 'Transition coverage body', 'state machine coverage', ?, ?, 0.9, 'draft', 'desktop', '{}')`,
    backgroundOpenLoop.id,
    backgroundTaskChat.product_task.id,
  );
  store.decideProactiveMessage({ id: 'pmsg_transition_test', action: 'approve', feedback: 'authorized in test' });
  assert.equal(store.listProactiveMessages({ status: 'authorized' }).messages.find((item) => item.id === 'pmsg_transition_test').status, 'authorized');
  store.decideProactiveMessage({ id: 'pmsg_transition_test', action: 'queue', feedback: 'scheduled in test' });
  assert.equal(store.listProactiveMessages({ status: 'scheduled' }).messages.find((item) => item.id === 'pmsg_transition_test').status, 'scheduled');
  store.decideProactiveMessage({ id: 'pmsg_transition_test', action: 'sent', feedback: 'delivered in test' });
  assert.equal(store.listProactiveMessages({ status: 'delivered' }).messages.find((item) => item.id === 'pmsg_transition_test').status, 'delivered');
  assert.equal(store['get'](`SELECT status FROM notification_deliveries WHERE proactive_message_id='pmsg_transition_test'`).status, 'delivered');
  store.decideProactiveMessage({ id: 'pmsg_transition_test', action: 'useful', feedback: 'responded in test' });
  assert.equal(store.listProactiveMessages({ status: 'responded' }).messages.find((item) => item.id === 'pmsg_transition_test').status, 'responded');
  const proactiveTransitionTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(proactiveTransitionTrace.events.some((event) => event.event_type === 'proactive.authorized' && event.item_id === 'pmsg_transition_test'));
  assert.ok(proactiveTransitionTrace.events.some((event) => event.event_type === 'proactive.scheduled' && event.item_id === 'pmsg_transition_test'));
  assert.ok(proactiveTransitionTrace.events.some((event) => event.event_type === 'proactive.delivered' && event.item_id === 'pmsg_transition_test'));
  assert.ok(proactiveTransitionTrace.events.some((event) => event.event_type === 'proactive.responded' && event.item_id === 'pmsg_transition_test'));
  store.decideProactiveMessage({ id: backgroundProactive.id, action: 'sent', feedback: 'delivered in test' });
  assert.equal(store.listProactiveMessages({ status: 'delivered' }).messages.find((item) => item.id === backgroundProactive.id).status, 'delivered');
  const backgroundNotification = store['get'](`SELECT id, status FROM notification_deliveries WHERE proactive_message_id=?`, backgroundProactive.id);
  assert.equal(backgroundNotification.status, 'delivered');
  const deliveredBackgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(deliveredBackgroundTrace.events.some((event) => event.event_type === 'proactive.delivered' && event.item_id === backgroundProactive.id));
  assert.ok(deliveredBackgroundTrace.events.some((event) => event.event_type === 'notification.sent' && event.payload.proactive_message_id === backgroundProactive.id));
  store.recordNotificationOpened({ id: backgroundNotification.id, actor: 'desktop-test', external_delivery_id: 'delivery_test' });
  const openedNotification = store['get'](`SELECT status, external_delivery_id, opened_at FROM notification_deliveries WHERE id=?`, backgroundNotification.id);
  assert.equal(openedNotification.status, 'opened');
  assert.equal(openedNotification.external_delivery_id, 'delivery_test');
  assert.ok(openedNotification.opened_at);
  store.recordNotificationOpened({ id: backgroundNotification.id, actor: 'duplicate-test' });
  const openedBackgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.equal(openedBackgroundTrace.events.filter((event) => event.event_type === 'notification.opened' && event.item_id === backgroundNotification.id).length, 1);
  assert.equal(openedBackgroundTrace.events.filter((event) => event.event_type === 'notification.resumed' && event.item_id === backgroundNotification.id).length, 1);
  assert.ok(openedBackgroundTrace.events.some((event) => event.event_type === 'notification.resumed' && event.payload.deep_link_target?.startsWith('joi://conversation/')));
  for (const [id, score] of [['pmsg_ignore_1', 0.9], ['pmsg_ignore_2', 0.8], ['pmsg_ignore_3', 0.7]]) {
    store['exec'](
      `INSERT INTO proactive_messages (id, type, title, body, reason, source_open_loop_id, source_product_task_id, score, status, channel, metadata)
       VALUES (?, 'followup', ?, 'Ignore feedback body', 'downrank regression', ?, ?, ?, 'draft', 'desktop', '{}')`,
      id,
      id,
      backgroundOpenLoop.id,
      backgroundTaskChat.product_task.id,
      score,
    );
  }
  store.decideProactiveMessage({ id: 'pmsg_ignore_1', action: 'ignore', feedback: 'not useful now' });
  assert.ok(Number(store['get'](`SELECT score FROM proactive_messages WHERE id='pmsg_ignore_2'`).score) < 0.8);
  store.decideProactiveMessage({ id: 'pmsg_ignore_2', action: 'dismiss', feedback: 'still not useful' });
  store.decideProactiveMessage({ id: 'pmsg_ignore_3', action: 'ignore', feedback: 'third ignore' });
  const suppressedByDownrank = store['get'](`SELECT status, metadata FROM proactive_messages WHERE id='pmsg_ignore_3'`);
  assert.equal(suppressedByDownrank.status, 'suppressed');
  assert.equal(JSON.parse(suppressedByDownrank.metadata).downranking.negative_feedback_count, 3);
  const downrankTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(downrankTrace.events.some((event) => event.event_type === 'proactive.suppressed' && event.item_id === 'pmsg_ignore_3'));
  store.decideProactiveMessage({ id: backgroundProactive.id, action: 'suppress', feedback: 'test suppression' });
  const suppressedBackgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(suppressedBackgroundTrace.events.some((event) => event.event_type === 'proactive.suppressed' && event.item_id === backgroundProactive.id));
  store.decideOpenLoop({ id: backgroundOpenLoop.id, action: 'close', feedback: 'closed in test' });
  assert.equal(store.listOpenLoops({ status: 'closed' }).open_loops.find((loop) => loop.id === backgroundOpenLoop.id).status, 'closed');
  const closedBackgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(closedBackgroundTrace.events.some((event) => event.event_type === 'open_loop.closed' && event.item_id === backgroundOpenLoop.id));
  store['exec'](
    `INSERT INTO open_loops (id, topic, description, status, source_conversation_id, source_run_id, source_product_task_id,
                             suggested_followup, priority, due_at, metadata)
     VALUES ('oloop_expired_test', 'Expired loop', 'Should be classified automatically', 'open', ?, ?, ?,
             'Expired follow-up', 'normal', '2000-01-01T00:00:00Z', '{}')`,
    backgroundTaskChat.conversation_id,
    backgroundTaskChat.run_id,
    backgroundTaskChat.product_task.id,
  );
  store['exec'](
    `INSERT INTO proactive_messages (id, type, title, body, reason, source_open_loop_id, source_product_task_id, score, status, channel, metadata)
     VALUES ('pmsg_expired_test', 'followup', 'Expired proactive', 'Expired body', 'expired loop', 'oloop_expired_test', ?, 0.9, 'draft', 'desktop', '{}')`,
    backgroundTaskChat.product_task.id,
  );
  assert.ok(!store.listOpenLoops({ status: 'open', limit: 100 }).open_loops.some((loop) => loop.id === 'oloop_expired_test'));
  assert.equal(store.listOpenLoops({ status: 'expired', limit: 100 }).open_loops.find((loop) => loop.id === 'oloop_expired_test').status, 'expired');
  assert.equal(store.listProactiveMessages({ status: 'expired', limit: 100 }).messages.find((item) => item.id === 'pmsg_expired_test').status, 'expired');
  const expiredBackgroundTrace = store.getRunTrace(backgroundTaskChat.run_id);
  assert.ok(expiredBackgroundTrace.events.some((event) => event.event_type === 'open_loop.expired' && event.item_id === 'oloop_expired_test'));

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
  assert.ok(waitingTrace.events.some((event) => event.event_type === 'run.waiting_approval'));
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=? AND role='assistant'`, waitingToolCallingChat.conversation_id).count), 0);
  const waitingConfirmation = store.listConfirmations().items.find((item) => item.run_id === waitingToolCallingChat.run_id);
  assert.ok(waitingConfirmation);
  assert.equal(waitingConfirmation.call_id, 'call_apply_patch_waiting');
  assert.equal(waitingConfirmation.turn_id?.startsWith('turn_'), true);
  assert.equal(waitingConfirmation.approval_scope, 'one_call');
  assert.equal(waitingConfirmation.approval_key, 'call_apply_patch_waiting');
  assert.equal(waitingConfirmation.status, 'pending');
  assert.ok(waitingConfirmation.operation_id.startsWith('op_'));
  assert.ok(waitingConfirmation.affected_paths.includes('README.md'));
  assert.equal(waitingToolCallingChat.product_task.status, 'waiting_confirmation');
  const waitingOutput = store['get'](`SELECT status, output FROM turn_items WHERE run_id=? AND item_type='tool_output'`, waitingToolCallingChat.run_id);
  assert.equal(waitingOutput.status, 'waiting_confirmation');
  assert.equal(JSON.parse(waitingOutput.output).confirmation_id, waitingConfirmation.id);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM tool_runs WHERE run_id=?`, waitingToolCallingChat.run_id).count), 0);
  assert.equal(JSON.parse(store['get'](`SELECT metadata FROM model_calls WHERE run_id=?`, waitingToolCallingChat.run_id).metadata).tool_run_count, 0);
  assert.equal(store.getRunTrace(waitingToolCallingChat.run_id).steps.find((step) => step.step_type === 'model_call_finished')?.output?.tool_run_count, 0);
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
  assert.ok(store.listPendingApprovals().items.some((item) => item.id === resumableConfirmation.id));
  store.decideApproval({
    run_id: resumableChat.run_id,
    approval_request_id: resumableConfirmation.id,
    decision: 'approve',
    decided_by: 'test',
    decided_at: '2026-06-22T00:00:00Z',
    reason: 'approve test',
    edited_parameters: { reason: 'edited resume approval', dry_run: true },
  });
  assert.equal(store.listConfirmations().items.find((item) => item.id === resumableConfirmation.id).approved_by, 'test');
  assert.equal(store.listConfirmations().items.find((item) => item.id === resumableConfirmation.id).decided_at, '2026-06-22T00:00:00Z');
  const resumeRequest = store.loadApprovedToolCallingResume(resumableConfirmation.id);
  assert.equal(resumeRequest.call_id, 'call_apply_patch_resume');
  assert.equal(resumeRequest.input.reason, 'edited resume approval');
  assert.equal(resumeRequest.input.dry_run, true);
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
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'approval.resolved' && event.payload.approval_request_id === resumableConfirmation.id && event.payload.decided_by === 'test'));
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'approval.approved' && event.payload.edited_parameters?.reason === 'edited resume approval'));
  assert.equal(resumedTrace.events.filter((event) => event.event_type === 'approval.resumed' && event.item_id === resumableConfirmation.id).length, 1);
  assert.equal(resumedTrace.events.filter((event) => event.event_type === 'run.resumed' && event.payload.resumed_from_confirmation_id === resumableConfirmation.id).length, 1);
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'tool.finished'));
  assert.ok(resumedTrace.events.some((event) => event.event_type === 'run.completed'));
  assert.equal(store.getConversation(resumableChat.conversation_id).messages.at(-1).content, 'Patch resumed final answer.');
  assert.equal(JSON.parse(store['get'](`SELECT output FROM tool_runs WHERE run_id=?`, resumableChat.run_id).output).summary, 'patch applied by approval resume');
  assert.ok(store.listConfirmations().items.find((item) => item.id === resumableConfirmation.id).resumed_at);
  const duplicateResume = store.completeApprovedToolCallingResume(resumableConfirmation.id, {
    provider: 'openai_compatible',
    model_name: 'real-tool-model',
    final_message: 'duplicate resume should not run',
    tool_result: {
      call_id: 'call_apply_patch_resume',
      name: 'apply_patch',
      arguments: resumeRequest.input,
      output: { status: 'completed', summary: 'duplicate resume output' },
    },
    usage: { input_tokens: 99, output_tokens: 99, cached_input_tokens: 99 },
    model_responses: [{ id: 'chatcmpl_duplicate_resume' }],
  });
  assert.equal(duplicateResume, undefined);
  const afterDuplicateResumeTrace = store.getRunTrace(resumableChat.run_id);
  assert.equal(afterDuplicateResumeTrace.events.filter((event) => event.event_type === 'approval.resumed' && event.item_id === resumableConfirmation.id).length, 1);
  assert.equal(afterDuplicateResumeTrace.events.filter((event) => event.event_type === 'run.resumed' && event.payload.resumed_from_confirmation_id === resumableConfirmation.id).length, 1);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM tool_runs WHERE run_id=? AND tool_call_id='call_apply_patch_resume'`, resumableChat.run_id).count), 1);
  const resumedModelMetadata = JSON.parse(store['get'](
    `SELECT metadata FROM model_calls WHERE run_id=? AND json_extract(metadata, '$.resumed_from_confirmation_id')=?`,
    resumableChat.run_id,
    resumableConfirmation.id,
  ).metadata);
  assert.equal(resumedModelMetadata.tool_run_count, 1);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM messages WHERE json_extract(metadata, '$.run_id')=? AND role='assistant'`, resumableChat.run_id).count), 1);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM messages WHERE conversation_id=? AND role='assistant' AND content LIKE 'confirmation_required:%'`, resumableChat.conversation_id).count), 0);

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

  store.replaceFetchedModels('openai_compatible', 'https://api.persona.test/v1', [{
    id: 'persona-special-model',
    display_name: 'Persona Special Model',
    provider: 'openai_compatible',
    base_url: 'https://api.persona.test/v1',
    supports_json_mode: true,
    supports_tool_calling: true,
  }]);

  const routedPersona = store.createProjectPersona({
    project_name: 'Persona Model Route',
    project_goal: 'Verify persona-scoped model routing',
    persona_choice: {
      display_name: 'Model Pilot',
      handle: 'model-pilot',
      tagline: 'Routes runs through the persona model.',
      self_intro: 'I verify persona-scoped model routing.',
      model_strategy: 'persona-special-model',
    },
  });
  const personaModelStarted = store.beginToolCallingChat({
    conversation_id: 'conv_private_hub',
    room_id: 'room_private_hub',
    message: '@model-pilot verify routed model',
    mentions: [routedPersona.persona.id],
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'global-fallback-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'global-fallback-model',
  });
  const personaModelTrace = store.getRunTrace(personaModelStarted.run_id);
  assert.equal(personaModelStarted.selected_agent_id, routedPersona.persona.id);
  assert.equal(personaModelStarted.model_name, 'persona-special-model');
  assert.equal(personaModelTrace.selected_agent_id, routedPersona.persona.id);
  assert.equal(personaModelTrace.model_calls[0].model_name, 'persona-special-model');
  assert.equal(store['get'](`SELECT executor_persona_id FROM routing_decisions WHERE run_id=?`, personaModelStarted.run_id).executor_persona_id, routedPersona.persona.id);
  store.finishToolCallingChat(personaModelStarted, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: personaModelStarted.model_name,
    selected_agent_id: personaModelStarted.selected_agent_id,
    final_message: 'Persona model route finished.',
    tool_results: [],
    usage: { input_tokens: 2, output_tokens: 2, cached_input_tokens: 0 },
    model_responses: [{ id: 'chatcmpl_persona_model_route' }],
  });

  const telegramCurrentModelStarted = store.beginToolCallingChat({
    conversation_id: routedPersona.room.conversation_id,
    room_id: routedPersona.room.id,
    channel: 'telegram',
    user_id: 'telegram:1234567890',
    message: 'Use the current Telegram model despite this old conversation model.',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'gpt-5.6-terra[medium]',
  }, {
    provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-terra[medium]',
    model_reasoning_effort: 'medium',
    model_selection_policy: 'settings_preferred',
  });
  const telegramCurrentModelTrace = store.getRunTrace(telegramCurrentModelStarted.run_id);
  assert.equal(telegramCurrentModelStarted.selected_agent_id, routedPersona.persona.id, 'Telegram may retain the conversation persona');
  assert.equal(telegramCurrentModelStarted.provider, 'acp_codex_cli', 'Telegram must prefer the current settings provider');
  assert.equal(telegramCurrentModelStarted.model_name, 'gpt-5.6-terra[medium]', 'an old persona model must not replace the current Telegram model');
  assert.equal(telegramCurrentModelStarted.model_reasoning_effort, 'medium', 'an old persona reasoning effort must not replace the current Telegram effort');
  assert.equal(telegramCurrentModelTrace.route_result.provider, 'acp_codex_cli');
  assert.equal(telegramCurrentModelTrace.route_result.model, 'gpt-5.6-terra[medium]');
  store.finishToolCallingChat(telegramCurrentModelStarted, {
    status: 'completed',
    provider: telegramCurrentModelStarted.provider,
    model_name: telegramCurrentModelStarted.model_name,
    selected_agent_id: telegramCurrentModelStarted.selected_agent_id,
    final_message: 'Telegram current model route finished.',
    tool_results: [],
    usage: { input_tokens: 2, output_tokens: 2, cached_input_tokens: 0 },
    model_responses: [{ id: 'chatcmpl_telegram_current_model_route' }],
  });

  const automationCurrentModelStarted = store.beginToolCallingChat({
    conversation_id: routedPersona.room.conversation_id,
    room_id: routedPersona.room.id,
    channel: 'automation',
    user_id: 'automation:daily-digest',
    message: 'Use the current automation model despite this old conversation model.',
    input_mode: 'background_task',
    runtime_mode: 'tool_calling',
    model_name: 'gpt-5.6-terra[medium]',
  }, {
    provider: 'acp_codex_cli',
    model_name: 'gpt-5.6-terra[medium]',
    model_reasoning_effort: 'medium',
    model_selection_policy: 'settings_preferred',
  });
  const automationCurrentModelTrace = store.getRunTrace(automationCurrentModelStarted.run_id);
  assert.equal(automationCurrentModelStarted.selected_agent_id, routedPersona.persona.id, 'Automation may retain the conversation persona');
  assert.equal(automationCurrentModelStarted.provider, 'acp_codex_cli', 'Automation must prefer the current settings provider');
  assert.equal(automationCurrentModelStarted.model_name, 'gpt-5.6-terra[medium]', 'an old persona model must not replace the current automation model');
  assert.equal(automationCurrentModelStarted.model_reasoning_effort, 'medium', 'an old persona reasoning effort must not replace the current automation effort');
  assert.equal(automationCurrentModelTrace.route_result.provider, 'acp_codex_cli');
  assert.equal(automationCurrentModelTrace.route_result.model, 'gpt-5.6-terra[medium]');
  store.finishToolCallingChat(automationCurrentModelStarted, {
    status: 'completed',
    provider: automationCurrentModelStarted.provider,
    model_name: automationCurrentModelStarted.model_name,
    selected_agent_id: automationCurrentModelStarted.selected_agent_id,
    final_message: 'Automation current model route finished.',
    tool_results: [],
    usage: { input_tokens: 2, output_tokens: 2, cached_input_tokens: 0 },
    model_responses: [{ id: 'chatcmpl_automation_current_model_route' }],
  });

  const staleModelPersona = store.createProjectPersona({
    project_name: 'Stale Persona Model Route',
    project_goal: 'Verify missing persona model falls back to request model',
    persona_choice: {
      display_name: 'Stale Model Pilot',
      handle: 'stale-model-pilot',
      tagline: 'Falls back when its model is not configured.',
      self_intro: 'I verify stale persona-scoped model routing.',
      model_strategy: 'missing-persona-model',
    },
  });
  const staleModelStarted = store.beginToolCallingChat({
    conversation_id: 'conv_private_hub',
    room_id: 'room_private_hub',
    message: '@stale-model-pilot verify fallback model',
    mentions: [staleModelPersona.persona.id],
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'global-fallback-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'global-fallback-model',
  });
  assert.equal(staleModelStarted.selected_agent_id, staleModelPersona.persona.id);
  assert.equal(staleModelStarted.model_name, 'global-fallback-model');
  assert.equal(store.getRunTrace(staleModelStarted.run_id).model_calls[0].model_name, 'global-fallback-model');
  store.finishToolCallingChat(staleModelStarted, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: staleModelStarted.model_name,
    selected_agent_id: staleModelStarted.selected_agent_id,
    final_message: 'Stale persona model route finished.',
    tool_results: [],
    usage: { input_tokens: 1, output_tokens: 1 },
    model_responses: [{ id: 'chatcmpl_stale_persona_model_route' }],
  });

  const streamStarted = store.beginToolCallingChat({
    message: 'Begin a streaming provider run with tool events',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
  });
  const emittedEventTypes = [];
  const emittedEvents = [];
  const streamCallbacks = store.createToolCallingEventCallbacks(streamStarted, (event) => {
    emittedEvents.push(event);
    emittedEventTypes.push(event.event_type);
  });
  const streamToolCall = {
    id: 'call_stream_workspace_search',
    name: 'workspace_search',
    arguments: { query: 'Run Trace', root: '.', max_results: 3 },
  };
  const streamToolResult = {
    call_id: streamToolCall.id,
    name: streamToolCall.name,
    arguments: streamToolCall.arguments,
    output: {
      status: 'completed',
      mode: 'streaming_persistence_test',
      summary: 'streaming persistence evidence',
    },
  };
  const committedStreamAnswer = 'Streamed answer.\n\n```ts\n  const value = 1;\n```';
  streamCallbacks.onModelStarted({ step: 0, model: 'live-tool-model', streaming: true });
  streamCallbacks.onModelDelta({ step: 0, payload: { choices: [{ delta: { content: 'Streamed ' } }] } });
  streamCallbacks.onToolCallRequested({ step: 0, call: streamToolCall });
  streamCallbacks.onToolStarted({ step: 0, call: streamToolCall });
  streamCallbacks.onToolOutputDelta({ step: 0, call: streamToolCall, output: { summary: 'partial stream evidence' } });
  streamCallbacks.onToolCompleted({ step: 0, call: streamToolCall, result: streamToolResult });
  streamCallbacks.onUsage({
    step: 0,
    usage: { input_tokens: 9, output_tokens: 4, cached_input_tokens: 2 },
    usage_status: 'recorded',
  });
  streamCallbacks.onEvent({
    type: 'work_summary.updated',
    step: 0,
    status: 'completed',
    detail: {
      phase: 'prepared',
      summary: '已准备 3 项 Joi 能力',
      user_visible: true,
      capability_count: 3,
    },
  });
  streamCallbacks.onAssistantDelta({ step: 1, text: `${committedStreamAnswer}\n\n`, index: 0 });
  streamCallbacks.onAssistantCompleted({ step: 1, text: `${committedStreamAnswer}\n\n`, finish_reason: 'stop', usage_status: 'recorded' });
  streamCallbacks.onModelCompleted({ step: 1, finish_reason: 'stop', usage_status: 'recorded' });
  const streamFinished = store.finishToolCallingChat(streamStarted, {
    status: 'completed',
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
    final_message: `${committedStreamAnswer}\n\n`,
    tool_results: [streamToolResult],
    usage: { input_tokens: 9, output_tokens: 4, cached_input_tokens: 2 },
    usage_status: 'recorded',
    finish_reason: 'stop',
    model_responses: [{ id: 'chatcmpl_stream_finished' }],
  });
  assert.equal(streamFinished.response, committedStreamAnswer);
  assert.ok(emittedEventTypes.includes('assistant.delta'));
  assert.ok(emittedEventTypes.includes('tool.completed'));
  assert.ok(emittedEventTypes.includes('work_summary.updated'));
  assert.ok(emittedEvents.every((event) => event.run_id === streamStarted.run_id && event.seq > 0));
  const streamTrace = store.getRunTrace(streamStarted.run_id);
  const streamEventTypes = streamTrace.events.map((event) => event.event_type);
  assert.deepEqual(streamEventTypes.slice(0, 3), ['run.started', 'run.mode_resolved', 'turn.started']);
  assert.ok(streamEventTypes.indexOf('tool.call_requested') < streamEventTypes.indexOf('tool.completed'));
  assert.ok(streamEventTypes.indexOf('tool.completed') < streamEventTypes.indexOf('assistant.delta'));
  assert.ok(streamEventTypes.indexOf('tool.completed') < streamEventTypes.indexOf('assistant.completed'));
  assert.ok(streamEventTypes.indexOf('assistant.completed') < streamEventTypes.indexOf('turn.completed'));
  assert.ok(streamEventTypes.indexOf('turn.completed') < streamEventTypes.indexOf('run.completed'));
  const providerDeltas = streamTrace.events.filter((event) => event.event_type === 'assistant.delta' && event.delta?.stream_source === 'provider_stream');
  assert.equal(providerDeltas.length, 1);
  assert.equal(providerDeltas[0].delta.text, committedStreamAnswer);
  assert.equal(providerDeltas[0].delta.text, streamTrace.events.find((event) => event.event_type === 'assistant.completed')?.delta.text);
  assert.match(providerDeltas[0].delta.text, /\n  const value = 1;/, 'committed chat text must preserve code indentation');
  assert.equal(streamTrace.events.some((event) => event.event_type === 'assistant.delta' && event.delta?.stream_source === 'fallback_final_chunk'), false);
  assert.equal(streamTrace.events.filter((event) => event.event_type === 'assistant.completed').length, 1);
  assert.equal(streamTrace.events.filter((event) => event.event_type === 'tool.call_requested' && event.item_id === streamToolCall.id).length, 1);
  assert.equal(streamTrace.events.filter((event) => event.event_type === 'tool.started' && event.item_id === streamToolCall.id).length, 1);
  assert.equal(streamTrace.events.filter((event) => event.event_type === 'tool.completed' && event.item_id === streamToolCall.id).length, 1);
  assert.equal(streamTrace.events.filter((event) => event.event_type === 'usage.recorded' && event.item_id === streamStarted.model_call_id).length, 1);
  const preparedStage = streamTrace.events.find((event) => event.event_type === 'work_summary.updated');
  assert.equal(preparedStage?.visibility, 'transcript');
  assert.equal(preparedStage?.item_type, 'work_summary');
  assert.equal(preparedStage?.phase, 'prepared');
  assert.equal(preparedStage?.payload?.user_visible, true);
  assert.equal(streamTrace.model_calls[0].input_tokens, 9);
  assert.equal(streamTrace.model_calls[0].cached_input_tokens, 2);
  const streamModelCallRow = store['get'](
    `SELECT streaming_enabled, first_delta_at FROM model_calls WHERE id=?`,
    streamStarted.model_call_id,
  );
  assert.equal(Number(streamModelCallRow.streaming_enabled), 1);
  assert.ok(streamModelCallRow.first_delta_at);
  const streamToolRun = store['get'](`SELECT output FROM tool_runs WHERE run_id=? AND tool_call_id=?`, streamStarted.run_id, streamToolCall.id);
  assert.equal(JSON.parse(streamToolRun.output).mode, 'streaming_persistence_test');

  const redirectStarted = store.beginToolCallingChat({
    conversation_id: liveStarted.conversation_id,
    message: 'Begin a run that will be redirected',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
  }, {
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
  });
  const redirectedTrace = store.redirectRun({ run_id: redirectStarted.run_id, reason: 'test redirect' });
  assert.equal(redirectedTrace.status, 'redirected');
  assert.equal(redirectedTrace.terminal_status, 'redirected');
  assert.ok(redirectedTrace.events.some((event) => event.event_type === 'run.redirected'));
  assert.equal(redirectedTrace.model_calls[0].status, 'cancelled');
  const redirectChild = store.beginToolCallingChat({
    conversation_id: liveStarted.conversation_id,
    message: 'Continue redirected run',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
    parent_run_id: redirectStarted.run_id,
    redirected_from_run_id: redirectStarted.run_id,
  }, {
    provider: 'openai_compatible',
    model_name: 'live-tool-model',
    selected_agent_id: 'general_agent',
  });
  const redirectChildTrace = store.getRunTrace(redirectChild.run_id);
  assert.equal(redirectChildTrace.parent_run_id, redirectStarted.run_id);
  assert.equal(redirectChildTrace.redirected_from_run_id, redirectStarted.run_id);
  store.failToolCallingChat(redirectChild, new Error('redirect child cleanup'), 'cancelled');

  const stickyConversationID = 'conv_telegram_chat_12345_test';
  for (let index = 1; index <= 6; index += 1) {
    store.recordToolCallingChat({
      conversation_id: stickyConversationID,
      channel: 'telegram',
      user_id: 'telegram:12345',
      message: index === 1 ? 'Question 1 follow-up api_key=sk-test-secret-123456' : `Question ${index} follow-up`,
      input_mode: 'auto',
      runtime_mode: 'tool_calling',
      model_name: 'live-tool-model',
    }, {
      status: 'completed',
      provider: 'openai_compatible',
      model_name: 'live-tool-model',
      selected_agent_id: 'general_agent',
      final_message: `Answer ${index}`,
      tool_results: [],
      usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
      model_responses: [{ id: `chatcmpl_context_${index}` }],
    });
  }
  const promptWithHistory = store.assembleToolCallingPrompt({
    conversation_id: stickyConversationID,
    channel: 'telegram',
    user_id: 'telegram:12345',
    message: 'What did we just discuss?',
    input_mode: 'auto',
    runtime_mode: 'tool_calling',
    model_name: 'live-tool-model',
  }, 'general_agent', 'live-tool-model');
  assert.match(promptWithHistory.dynamic_tail, /Conversation Context/);
  assert.match(promptWithHistory.dynamic_tail, /Earlier Conversation Summary/);
  assert.match(promptWithHistory.dynamic_tail, /Recent Conversation/);
  assert.match(promptWithHistory.dynamic_tail, /Question 6 follow-up/);
  assert.match(promptWithHistory.dynamic_tail, /api_key=\[REDACTED\]/);
  assert.equal(promptWithHistory.dynamic_tail.includes('sk-test-secret-123456'), false);
  assert.ok(promptWithHistory.conversation_messages.some((item) => item.role === 'user' && item.content.includes('Question 6 follow-up')));
  assert.ok(promptWithHistory.conversation_messages.some((item) => item.role === 'assistant' && item.content.includes('Answer 6')));
  assert.equal(JSON.stringify(promptWithHistory.conversation_messages).includes('sk-test-secret-123456'), false);

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
  store.interruptRun({ run_id: cancellableChat.run_id, reason: 'duplicate cancel waiting approval' });
  const cancelledTrace = store.getRunTrace(cancellableChat.run_id);
  assert.equal(cancelledTrace.status, 'cancelled');
  assert.equal(cancelledTrace.events.filter((event) => event.event_type === 'run.cancel_requested').length, 1);
  assert.equal(cancelledTrace.events.filter((event) => event.event_type === 'run.cancelled').length, 1);
  assert.equal(cancelledTrace.events.filter((event) => event.event_type === 'run.interrupted').length, 1);
  assert.equal(store['get'](`SELECT status FROM turns WHERE run_id=?`, cancellableChat.run_id).status, 'cancelled');
  assert.equal(store.listConfirmations().items.find((item) => item.id === cancellableConfirmation.id).status, 'rejected');
  assert.equal(store.getProductTask(cancellableChat.product_task.id).task.status, 'paused');

  {
    const recoveryDbPath = join(tempDir, 'recovery-classification.db');
    const recoveryStore = new JoiSQLiteStore({
      dbPath: recoveryDbPath,
      schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
      logDir: join(tempDir, 'recovery-logs'),
      backupDir: join(tempDir, 'recovery-backups'),
      version: 'test',
    });
    const staleRun = recoveryStore.beginToolCallingChat({
      message: 'This live run will be orphaned by restart',
      input_mode: 'auto',
      runtime_mode: 'tool_calling',
      model_name: 'live-tool-model',
    }, {
      provider: 'openai_compatible',
      model_name: 'live-tool-model',
      selected_agent_id: 'general_agent',
    });
    const waitingRecovery = recoveryStore.recordToolCallingChat({
      message: 'This approval should survive restart',
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
        call_id: 'call_apply_patch_recovery',
        name: 'apply_patch',
        arguments: { patch: '*** Begin Patch\n*** End Patch\n', reason: 'restart recovery approval' },
        output: {
          status: 'waiting_confirmation',
          message: 'confirmation_required: workspace write requires approval before execution',
          capability: 'apply_patch',
          risk: 'workspace_write',
        },
      }],
      usage: { input_tokens: 8, output_tokens: 2 },
      model_responses: [{ id: 'chatcmpl_recovery_waiting', choices: [{ message: { tool_calls: [] } }] }],
    });
    recoveryStore.close();
    const reopenedRecoveryStore = new JoiSQLiteStore({
      dbPath: recoveryDbPath,
      schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
      logDir: join(tempDir, 'recovery-logs'),
      backupDir: join(tempDir, 'recovery-backups'),
      version: 'test',
    });
    const staleTrace = reopenedRecoveryStore.getRunTrace(staleRun.run_id);
    assert.equal(staleTrace.status, 'failed');
    assert.equal(staleTrace.terminal_reason, 'runtime state was lost after app restart');
    assert.ok(staleTrace.events.some((event) => event.event_type === 'run.recovery_required'));
    assert.ok(staleTrace.events.some((event) => event.event_type === 'run.failed'));
    const waitingRecoveryTrace = reopenedRecoveryStore.getRunTrace(waitingRecovery.run_id);
    assert.equal(waitingRecoveryTrace.status, 'waiting_confirmation');
    assert.ok(waitingRecoveryTrace.events.some((event) => event.event_type === 'run.recovery_required'));
    const recoverableRuns = reopenedRecoveryStore.listRecoverableRuns({ limit: 10 }).runs;
    assert.ok(recoverableRuns.some((item) => item.run_id === staleRun.run_id && item.recovery_status === 'runtime_lost'));
    assert.ok(recoverableRuns.some((item) => item.run_id === waitingRecovery.run_id && item.recovery_status === 'needs_user_decision'));
    reopenedRecoveryStore.close();
  }

  {
    const automationRecoveryDbPath = join(tempDir, 'automation-recovery.db');
    const automationRecoveryStore = new JoiSQLiteStore({
      dbPath: automationRecoveryDbPath,
      schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
      logDir: join(tempDir, 'automation-recovery-logs'),
      backupDir: join(tempDir, 'automation-recovery-backups'),
      version: 'test',
    });
    const orphanedClaimAutomation = automationRecoveryStore.saveAutomation({
      kind: 'webhook',
      name: 'Recover orphaned claimed automation',
      retry_policy: { max_attempts: 2 },
    });
    const orphanedClaimTrigger = automationRecoveryStore.enqueueAutomationTrigger({
      automation_id: orphanedClaimAutomation.id,
      trigger_type: 'webhook',
      dedup_key: 'recovery:claimed',
      payload: { event_id: 'claimed' },
      fire_at: new Date(Date.now() - 1000).toISOString(),
    }).trigger;
    const orphanedClaim = automationRecoveryStore.claimDueAutomationTrigger(new Date().toISOString());
    assert.equal(orphanedClaim?.trigger.id, orphanedClaimTrigger.id);
    assert.equal(orphanedClaim?.trigger.status, 'claimed');

    const interruptedRunningAutomation = automationRecoveryStore.saveAutomation({
      kind: 'schedule',
      name: 'Recover interrupted running automation',
      retry_policy: { max_attempts: 1 },
    });
    const interruptedRunningTrigger = automationRecoveryStore.enqueueAutomationTrigger({
      automation_id: interruptedRunningAutomation.id,
      trigger_type: 'schedule',
      dedup_key: 'recovery:running',
      payload: { event_id: 'running' },
      fire_at: new Date(Date.now() - 1000).toISOString(),
    }).trigger;
    const interruptedClaim = automationRecoveryStore.claimDueAutomationTrigger(new Date().toISOString());
    assert.equal(interruptedClaim?.trigger.id, interruptedRunningTrigger.id);
    const interruptedRun = automationRecoveryStore.beginToolCallingChat({
      message: 'This automation run will be orphaned by restart',
      channel: 'automation',
      input_mode: 'background_task',
      runtime_mode: 'tool_calling',
      model_name: 'live-tool-model',
    }, {
      provider: 'openai_compatible',
      model_name: 'live-tool-model',
      selected_agent_id: 'general_agent',
    });
    const interruptedAutomationRun = automationRecoveryStore.recordAutomationRunStarted({
      automation_id: interruptedRunningAutomation.id,
      trigger_id: interruptedRunningTrigger.id,
      run_id: interruptedRun.run_id,
    });
    assert.equal(interruptedAutomationRun.status, 'running');
    automationRecoveryStore.close();

    const reopenedAutomationRecoveryStore = new JoiSQLiteStore({
      dbPath: automationRecoveryDbPath,
      schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
      logDir: join(tempDir, 'automation-recovery-logs'),
      backupDir: join(tempDir, 'automation-recovery-backups'),
      version: 'test',
    });
    const recoveredClaimedTrigger = reopenedAutomationRecoveryStore.listAutomationTriggers({ automation_id: orphanedClaimAutomation.id }).triggers[0];
    assert.equal(recoveredClaimedTrigger.status, 'retry_scheduled');
    assert.equal(recoveredClaimedTrigger.error_code, 'runtime_lost_on_restart');
    assert.ok(recoveredClaimedTrigger.next_attempt_at);
    const retryClaim = reopenedAutomationRecoveryStore.claimDueAutomationTrigger(new Date(Date.now() + 1000).toISOString());
    assert.equal(retryClaim?.trigger.id, orphanedClaimTrigger.id);
    assert.equal(retryClaim?.trigger.attempt_count, 2);

    const recoveredRunningTrigger = reopenedAutomationRecoveryStore.listAutomationTriggers({ automation_id: interruptedRunningAutomation.id }).triggers[0];
    assert.equal(recoveredRunningTrigger.status, 'failed');
    assert.equal(recoveredRunningTrigger.error_code, 'runtime_lost_on_restart');
    const recoveredRunningRun = reopenedAutomationRecoveryStore.listAutomationRuns({ automation_id: interruptedRunningAutomation.id }).runs[0];
    assert.equal(recoveredRunningRun.status, 'failed');
    assert.equal(recoveredRunningRun.error_code, 'runtime_lost_on_restart');
    const interruptedTrace = reopenedAutomationRecoveryStore.getRunTrace(interruptedRun.run_id);
    assert.equal(interruptedTrace.status, 'failed');
    assert.ok(interruptedTrace.events.some((event) => event.event_type === 'automation.run_failed'));
    assert.ok(!interruptedTrace.events.some((event) => event.event_type === 'automation.retry_scheduled'));
    reopenedAutomationRecoveryStore.close();
  }

  const closureReport = store.getRecentRunClosureReport({ limit: 100 });
  assert.ok(closureReport.metrics.total_runs > 0);
  assert.ok(closureReport.metrics.terminal_event_runs > 0);
  assert.ok(closureReport.metrics.completed_tasks_with_evidence > 0);
  assert.ok(closureReport.metrics.runs_with_tool_evidence > 0);
  assert.ok(closureReport.metrics.runs_with_memory_events > 0);
  assert.ok(closureReport.metrics.runs_with_proactive_events > 0);
  assert.ok(closureReport.metrics.runs_with_handoff_events > 0);
  assert.ok(closureReport.items.some((item) => item.run_id === telegramTaskChat.run_id && item.handoff_event_count > 0));
  assert.ok(closureReport.items.some((item) => item.run_id === backgroundTaskChat.run_id && item.proactive_event_count > 0));
  assert.ok(closureReport.items.some((item) => item.run_id === backgroundTaskChat.run_id && item.handoff_event_count > 0));
  assertConversationFlowClosureInvariants(store);

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

  const longLogBody = 'x'.repeat(900);
  const appLog = store.recordAppLog({
    level: 'info',
    risk_level: 'state_change',
    category: 'settings',
    feature_key: 'store.test.app_log',
    source: 'store_test',
    message: 'store test app log',
    payload: {
      api_key: 'log-secret-value',
      nested: { password: 'log-password-value' },
      note: 'token=log-token-value',
      long_note: longLogBody,
    },
  });
  assert.equal(appLog.payload.api_key, '[REDACTED]');
  assert.equal(appLog.payload.nested.password, '[REDACTED]');
  assert.equal(String(appLog.payload.note).includes('log-token-value'), false);
  assert.equal(String(appLog.payload.long_note).includes(longLogBody), true);
  assert.equal(appLog.error, undefined);
  assert.match(appLog.created_at, /^\d{4}-\d{2}-\d{2}/);
  const defaultTimestampEvent = store.appendRunEventV2({
    run_id: response.run_id,
    event_type: 'store.test.default_timestamp',
    created_at: '   ',
  });
  assert.match(defaultTimestampEvent.created_at, /^\d{4}-\d{2}-\d{2}/);
  const secretShapeLog = store.recordAppLog({
    level: 'info',
    risk_level: 'state_change',
    category: 'ipc',
    feature_key: 'store.test.secret_shape_log',
    source: 'store_test',
    message: 'secret shape log',
    payload: {
      method: 'SaveSecret',
      payload: { name: 'MODEL_API_KEY', value: 'plain-local-secret-12345' },
    },
  });
  assert.equal(secretShapeLog.payload.payload.value, '[REDACTED]');
  assert.equal(JSON.stringify(secretShapeLog.payload).includes('plain-local-secret-12345'), false);
  const logDetail = store.getLogEntry(appLog.id);
  assert.equal(logDetail?.feature_key, 'store.test.app_log');
  assert.equal(logDetail?.error, undefined);
  const ipcStartedLog = store.recordAppLog({
    level: 'debug',
    risk_level: 'read_only',
    category: 'ipc',
    feature_key: 'ipc.GetSystemHealth.started',
    source: 'electron_ipc',
    message: 'IPC GetSystemHealth started',
  });
  const ipcSucceededLog = store.recordAppLog({
    level: 'debug',
    risk_level: 'read_only',
    category: 'ipc',
    feature_key: 'ipc.GetSystemHealth.succeeded',
    source: 'electron_ipc',
    message: 'IPC GetSystemHealth succeeded',
  });
  const ipcFailedLog = store.recordAppLog({
    level: 'error',
    risk_level: 'read_only',
    category: 'ipc',
    feature_key: 'ipc.GetSystemHealth.failed',
    source: 'electron_ipc',
    message: 'IPC GetSystemHealth failed',
    error: new Error('fixture IPC failure'),
  });
  const defaultIPCLogs = store.listLogs({ sources: ['electron_ipc'], limit: 100 }).logs;
  assert.ok(!defaultIPCLogs.some((log) => log.id === ipcStartedLog.id));
  assert.ok(!defaultIPCLogs.some((log) => log.id === ipcSucceededLog.id));
  assert.ok(defaultIPCLogs.some((log) => log.id === ipcFailedLog.id && log.error?.message === 'fixture IPC failure'));
  const explicitDebugIPCLogs = store.listLogs({ sources: ['electron_ipc'], levels: ['debug'], limit: 100 }).logs;
  assert.ok(explicitDebugIPCLogs.some((log) => log.id === ipcStartedLog.id));
  assert.ok(explicitDebugIPCLogs.some((log) => log.id === ipcSucceededLog.id));
  const unifiedLogs = store.listLogs({ query: 'store.test.app_log', include_trace: true, include_worker_heartbeat: true, limit: 100 }).logs;
  assert.ok(unifiedLogs.some((log) => log.id === appLog.id && log.source_table === 'app_logs'));
  const runLogs = store.listLogs({ run_id: response.run_id, include_trace: true, include_worker_heartbeat: true, limit: 100 }).logs;
  assert.ok(runLogs.some((log) => log.source_table === 'run_events' && log.level && log.risk_level && log.category && log.feature_key));
  const defaultWorkerLogs = store.listLogs({ sources: ['worker_gateway'], limit: 100 }).logs;
  assert.ok(!defaultWorkerLogs.some((log) => ['heartbeat', 'claim'].includes(String(log.action || ''))));
  const conversationCountBeforeLogCleanup = Number(store['get'](`SELECT COUNT(*) AS count FROM conversations`)?.count || 0);
  const memoryCountBeforeLogCleanup = Number(store['get'](`SELECT COUNT(*) AS count FROM memories`)?.count || 0);
  const settingsCountBeforeLogCleanup = Number(store['get'](`SELECT COUNT(*) AS count FROM desktop_settings`)?.count || 0);
  const cleanupPreview = store.previewLogCleanup({ scopes: ['app_logs'], reason: 'store test preview' });
  assert.ok(cleanupPreview.counts.app_logs >= 1);
  assert.equal(cleanupPreview.safe_to_clear, true);
  const cleanupResult = store.clearLogs({ scopes: ['app_logs'], reason: 'store test clear' });
  assert.ok(cleanupResult.cleanup_id);
  assert.ok(cleanupResult.counts.app_logs >= 1);
  assert.equal(store.getLogEntry(appLog.id), null);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM conversations`)?.count || 0), conversationCountBeforeLogCleanup);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM memories`)?.count || 0), memoryCountBeforeLogCleanup);
  assert.equal(Number(store['get'](`SELECT COUNT(*) AS count FROM desktop_settings`)?.count || 0), settingsCountBeforeLogCleanup);
  assert.ok(Number(store['get'](`SELECT COUNT(*) AS count FROM log_cleanup_history`)?.count || 0) >= 1);

  assert.equal(store.getOnboardingStatus().first_backup_created, true);
  store.completeOnboarding();
  assert.equal(store.getOnboardingStatus().completed, true);

  store.close();
  console.log('sqlite store tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function assertNoRows(rows, message) {
  assert.deepEqual(rows, [], `${message}: ${JSON.stringify(rows.slice(0, 5))}`);
}

function assertConversationFlowClosureInvariants(store) {
  assertNoRows(store['all'](
    `SELECT run_id, seq, COUNT(*) AS count
     FROM run_events
     GROUP BY run_id, seq
     HAVING COUNT(*) > 1`,
  ), 'run_events must keep unique (run_id, seq) ordering');

  assertNoRows(store['all'](
    `SELECT r.id, r.status, r.terminal_status
     FROM runs r
     WHERE NOT EXISTS (
       SELECT 1 FROM run_events e
       WHERE e.run_id=r.id AND e.terminal=1
     )
       AND NOT EXISTS (
         SELECT 1 FROM run_events e
         WHERE e.run_id=r.id AND e.event_type='run.recovery_required'
       )`,
  ), 'every run must have a terminal event or explicit recovery classification');

  assertNoRows(store['all'](
    `SELECT r.id, r.resolved_mode, r.status, m.content AS user_message, r.metadata
     FROM runs r
     LEFT JOIN messages m ON m.id=r.user_message_id
     WHERE r.resolved_mode IN ('serious_task', 'background_task')
       AND NOT EXISTS (
         SELECT 1 FROM product_tasks pt
         WHERE pt.latest_run_id=r.id
            OR pt.source_run_id=r.id
            OR pt.id=json_extract(r.metadata, '$.product_task_id')
       )
       AND NOT EXISTS (
         SELECT 1 FROM run_events e
         WHERE e.run_id=r.id
           AND (
             e.item_type='refusal'
             OR e.event_type IN ('task.refused', 'task.declined', 'policy.blocked')
           )
       )`,
  ), 'every execution/background run must have a Product Task or refusal event');

  assertNoRows(store['all'](
    `SELECT id, status, terminal_status, evidence_summary
     FROM product_tasks
     WHERE (status='completed' OR terminal_status='completed')
       AND COALESCE(NULLIF(evidence_summary, ''), '')=''`,
  ), 'completed product tasks must have evidence summaries');

  assertNoRows(store['all'](
    `WITH requested AS (
       SELECT run_id, item_id, seq
       FROM run_events
       WHERE event_type='tool.call_requested'
     )
     SELECT requested.run_id, requested.item_id, requested.seq
     FROM requested
     WHERE COALESCE(requested.item_id, '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM run_events e
         WHERE e.run_id=requested.run_id
           AND e.item_id=requested.item_id
           AND e.event_type IN ('tool.completed', 'tool.failed', 'tool.policy_blocked', 'tool.finished', 'tool.cancelled')
       )`,
  ), 'every requested tool call must have a terminal tool event');

  assertNoRows(store['all'](
    `SELECT p.id, p.status
     FROM proactive_messages p
     WHERE p.status IN ('delivered', 'responded', 'closed')
       AND NOT EXISTS (
         SELECT 1 FROM notification_deliveries nd
         WHERE nd.proactive_message_id=p.id
           AND nd.status IN ('delivered', 'sent', 'opened', 'responded')
       )`,
  ), 'delivered proactive messages must have delivery state');

  assertNoRows(store['all'](
    `SELECT DISTINCT m.id, m.status
     FROM memories m
     JOIN memory_usage_logs mul ON mul.memory_id=m.id
     WHERE m.status IN ('superseded', 'deleted', 'rejected')
        OR m.disabled_at IS NOT NULL`,
  ), 'superseded or disabled memories must not be recalled');
}
