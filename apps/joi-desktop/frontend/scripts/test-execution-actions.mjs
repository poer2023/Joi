import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'joi-execution-actions-'));

try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/executionActions.ts',
    'src/api/desktop.ts',
    '--target',
    'ES2020',
    '--module',
    'ES2020',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
    '--outDir',
    outDir,
  ], { cwd: root, stdio: 'inherit' });

  const modulePath = existsSync(join(outDir, 'executionActions.js'))
    ? join(outDir, 'executionActions.js')
    : join(outDir, 'src/executionActions.js');
  const { getExecutionDisplayMode, projectRunTraceToActions, visibleExecutionActions } = await import(pathToFileURL(modulePath).href);

  const baseTrace = (steps) => ({
    id: 'run_test',
    status: 'succeeded',
    selected_agent_id: 'general_agent',
    steps,
  });

  const withoutRawSteps = (actions) => actions.map(({ raw_steps: _rawSteps, ...action }) => action);

  {
    const actions = projectRunTraceToActions(baseTrace([
      {
        id: 'step_1',
        step_type: 'task_classified',
        title: 'Task mode classified',
        status: 'succeeded',
        input: { message: '你好' },
        output: { input_mode: 'chat_assist' },
      },
      {
        id: 'step_2',
        step_type: 'prompt_assembled',
        title: 'Prompt assembly finished',
        status: 'succeeded',
        output: { prompt_cache_key: 'secret-key', dynamic_tail_hash: 'secret-tail' },
      },
      {
        id: 'step_3',
        step_type: 'response_generated',
        title: 'Response generated',
        status: 'succeeded',
        output: { response: '你好' },
      },
    ]));
    assert.deepEqual(actions.map((action) => action.title), ['理解任务', '生成回复', '模型回答']);
    assert.equal(visibleExecutionActions(actions).length, 1);
    assert.equal(visibleExecutionActions(actions)[0].description, '本轮未执行工具');
    assert(!JSON.stringify(withoutRawSteps(actions)).includes('prompt_cache_key'));
    assert(!JSON.stringify(withoutRawSteps(actions)).includes('dynamic_tail_hash'));
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      {
        id: 'step_1',
        step_type: 'capability_requested',
        title: 'Agent requested capability',
        status: 'succeeded',
        output: { capability: 'web_research', inputs: { url: 'https://example.com' }, risk: 'read_only' },
      },
      {
        id: 'step_2',
        step_type: 'tool_compiled',
        title: 'Tool workflow compiled',
        status: 'succeeded',
        output: { workflow: { workflow_name: 'web_research_v2' } },
      },
      {
        id: 'step_3',
        step_type: 'node_selected',
        title: 'Node selected',
        status: 'succeeded',
        output: { node_id: 'main-node', scheduler: { noisy: true } },
      },
      {
        id: 'step_4',
        step_type: 'tool_finished',
        title: 'Tool runtime finished',
        status: 'succeeded',
        output: { status: 'succeeded', source_url: 'https://example.com', summary: 'Example Domain' },
      },
    ]));
    assert.equal(actions.length, 1);
    assert.equal(actions[0].title, '读取网页');
    assert.equal(actions[0].kind, 'web');
    assert.equal(actions[0].description, '本轮执行了工具：已读取网页并提取正文');
    assert.equal(actions[0].sourceLabel, 'example.com');
    assert.equal(actions[0].completedLabel, '已读取网页 · example.com');
    assert(actions[0].details.some((detail) => detail.label === 'SOURCE'));
    assert(actions[0].details.some((detail) => detail.label === 'RESULT'));
    assert(!JSON.stringify(actions[0].details).includes('scheduler'));
    assert.equal(getExecutionDisplayMode({
      actions,
      status: 'completed',
      hasArtifact: false,
      hasProductTask: false,
      isSeriousTask: false,
    }), 'inline');
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      { id: 'step_1', step_type: 'product_task_created', title: 'Product task created', status: 'succeeded', output: { title: '计划' } },
      { id: 'step_2', step_type: 'capability_requested', title: 'Agent requested capability', status: 'succeeded', output: { capability: 'workspace_search', inputs: { query: 'Joi Alma' } } },
      { id: 'step_3', step_type: 'tool_compiled', title: 'Tool workflow compiled', status: 'succeeded', output: { workflow: { workflow_name: 'workspace_search_v1' } } },
      { id: 'step_4', step_type: 'tool_finished', title: 'Tool runtime finished', status: 'succeeded', output: { status: 'succeeded', results: [{ path: 'docs/spec.md' }] } },
      { id: 'step_5', step_type: 'artifact_created', title: 'Artifact created', status: 'succeeded', output: { title: '开发计划', type: 'plan' } },
      { id: 'step_6', step_type: 'proactive_candidate_created', title: 'Proactive candidate created', status: 'succeeded', output: { score: 0.8 } },
    ]));
    assert.deepEqual(actions.map((action) => action.title), ['创建任务', '搜索工作区', '生成交付物', '生成提醒候选']);
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      { id: 'step_1', step_type: 'capability_requested', title: 'Agent requested capability', status: 'succeeded', output: { capability: 'file_analyze', inputs: { path: '/Users/hao/Documents/Joi/README.md' } } },
      { id: 'step_2', step_type: 'tool_compiled', title: 'Tool workflow compiled', status: 'succeeded', output: { workflow: { workflow_name: 'file_analyze_v1' } } },
      { id: 'step_3', step_type: 'tool_finished', title: 'Tool runtime finished', status: 'succeeded', output: { status: 'completed', path: '/Users/hao/Documents/Joi/README.md', summary: 'README summary' } },
    ]));
    assert.equal(actions[0].kind, 'file');
    assert.equal(actions[0].sourceLabel, 'README.md');
    assert.equal(actions[0].completedLabel, '已读取文件 · README.md');
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      { id: 'step_1', step_type: 'capability_requested', title: 'Agent requested capability', status: 'succeeded', output: { capability: 'desktop_app_list', inputs: { scope: 'installed_applications' } } },
      { id: 'step_2', step_type: 'capability_semantic_checked', title: 'Semantic gate checked', status: 'succeeded', output: { code: 'OK' } },
      { id: 'step_3', step_type: 'workflow_compiled', title: 'Workflow compiled', status: 'succeeded', output: { workflow: { workflow_name: 'desktop_app_list_v1' } } },
      { id: 'step_4', step_type: 'tool_step_started', title: 'desktop_list_app_bundles started', status: 'succeeded', output: { tool: 'desktop_list_app_bundles' } },
      { id: 'step_5', step_type: 'tool_step_completed', title: 'desktop_list_app_bundles completed', status: 'succeeded', output: { tool: 'desktop_list_app_bundles' } },
      { id: 'step_6', step_type: 'tool_finished', title: 'Tool runtime finished', status: 'succeeded', output: { status: 'completed', mode: 'desktop_app_list_v1_bundle_scan', total: 2 } },
    ]));
    assert.equal(actions.length, 1);
    assert.equal(actions[0].title, '列出本机 App');
    assert.equal(actions[0].status, 'completed');
    assert.equal(actions[0].completedLabel, '列出本机 App');
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      { id: 'step_1', step_type: 'capability_requested', title: 'Agent requested capability', status: 'succeeded', output: { capability: 'shell_command', inputs: { command: 'rm -rf /tmp/nope' } } },
      { id: 'step_2', step_type: 'policy_blocked', title: 'Policy checked', status: 'blocked', output: { reason: 'requires confirmation' }, error: { code: 'POLICY_DENIED' } },
    ]));
    assert.equal(actions[0].status, 'blocked');
    assert(actions[0].details.some((detail) => detail.label === 'ERROR'));
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      {
        id: 'step_1',
        step_type: 'conversation_context_resolved',
        title: 'Conversation context resolved',
        status: 'succeeded',
        output: { message_count: 2, tool_evidence_count: 1 },
      },
      {
        id: 'step_2',
        step_type: 'recent_tool_evidence_resolved',
        title: 'Recent tool evidence resolved',
        status: 'succeeded',
        output: { evidence_count: 1, sources: [{ run_id: 'run_prev', tool_run_id: 'toolrun_prev', capability_id: 'desktop_app_list' }] },
      },
      {
        id: 'step_3',
        step_type: 'followup_grounded',
        title: 'Follow-up grounded',
        status: 'succeeded',
        output: { source_run_id: 'run_prev', tool_run_id: 'toolrun_prev', capability_id: 'desktop_app_list', matches: [{ name: '赛博朋克 2077', path: '/Users/hao/Applications/赛博朋克 2077.app' }] },
      },
      {
        id: 'step_4',
        step_type: 'response_generated',
        title: 'Response generated',
        status: 'succeeded',
        output: { response: '根据上一轮 desktop_app_list 工具结果...' },
      },
    ]));
    const visible = visibleExecutionActions(actions);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].kind, 'evidence');
    assert.equal(visible[0].title, '引用工具证据');
    assert.equal(visible[0].description, '本轮引用了上一轮工具证据');
    assert(JSON.stringify(visible[0].details).includes('toolrun_prev'));
  }

  {
    const actions = projectRunTraceToActions(baseTrace([
      { id: 'step_1', step_type: 'random_internal_hash_dump', title: 'Internal', status: 'succeeded', output: { prompt_cache_key: 'secret' } },
    ]));
    assert.equal(actions.length, 0);
  }

  console.log('execution action projection tests passed');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
