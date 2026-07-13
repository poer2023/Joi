import type { RunTrace } from './api/desktop';

type RunStep = NonNullable<RunTrace['steps']>[number];

export type ExecutionActionKind =
  | 'web'
  | 'workspace'
  | 'file'
  | 'command'
  | 'observe'
  | 'artifact'
  | 'memory'
  | 'evidence'
  | 'proactive'
  | 'confirmation'
  | 'diagnostic'
  | 'prepare'
  | 'model'
  | 'finalize';

export type ExecutionActionStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'limited'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

export type ExecutionActionDetail = {
  label: 'COMMAND' | 'INPUT' | 'SOURCE' | 'RESULT' | 'LIMITATIONS' | 'ERROR';
  value: unknown;
};

export type ExecutionAction = {
  id: string;
  kind: ExecutionActionKind;
  title: string;
  description: string;
  status: ExecutionActionStatus;
  summary?: string;
  sourceLabel?: string;
  inputPreview?: string;
  outputPreview?: string;
  limitations?: string[];
  completedLabel?: string;
  visible?: boolean;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  durationMs?: number;
  details: ExecutionActionDetail[];
  raw_steps: RunStep[];
};

export type ExecutionRunViewState = {
  actions: ExecutionAction[];
  status: string;
  hasArtifact?: boolean;
  hasProductTask?: boolean;
  isSeriousTask?: boolean;
};

export type ExecutionDisplayMode = 'inline' | 'rail' | 'task';

export const VISIBLE_KINDS = [
  'web',
  'workspace',
  'file',
  'command',
  'observe',
  'artifact',
  'confirmation',
  'evidence',
  'model',
  'proactive',
] as const;

export const HIDDEN_KINDS = [
  'prepare',
  'finalize',
  'diagnostic',
] as const;

const prepareStepTypes = new Set([
  'task_classified',
  'input_received',
  'router_selected',
  'active_context_resolved',
  'conversation_context_resolved',
  'skill_selected',
  'skill_plan_generated',
  'prompt_assembled',
  'model_call_finished',
  'agent_output_parsed',
]);

const toolStepTypes = new Set([
  'capability_requested',
  'capability_semantic_checked',
  'capability_rejected',
  'capability_blocked',
  'skill_rejected',
  'policy_checked',
  'policy_blocked',
  'workflow_compiled',
  'tool_compiled',
  'node_selected',
  'approval_requested',
  'tool_started',
  'tool_call_started',
  'tool_call_delta',
  'tool_call_completed',
  'tool_call_failed',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'tool_execution_error',
  'tool_step_started',
  'tool_step_completed',
  'mcp_tool_call_started',
  'mcp_tool_call_completed',
  'task_dispatched',
  'tool_finished',
  'worker_finished',
  'worker_failed',
  'product_task_step_started',
  'product_task_step_completed',
]);

const terminalToolBoundaries = new Set([
  'agent_call_finished',
  'response_generated',
  'artifact_created',
  'proactive_candidate_created',
  'conversation_reflection',
]);

const hiddenDetailKeys = new Set([
  'agent_id',
  'assignment_reason',
  'cacheable_prefix',
  'confidence',
  'dynamic_tail',
  'dynamic_tail_hash',
  'memory_context_pack_id',
  'memory_profile_version',
  'model_id',
  'node_id',
  'prefix_hash',
  'privacy_level',
  'prompt_assembly_id',
  'prompt_cache_key',
  'raw_capability',
  'route_result',
  'running_tasks',
  'scheduler',
  'task_attempts',
  'task_id',
  'tool_run_id',
  'tool_schema_version',
  'workflow_name',
  'worker_task_id',
]);

const visibleActionKinds = new Set<ExecutionActionKind>(VISIBLE_KINDS);
const hiddenActionKinds = new Set<ExecutionActionKind>(HIDDEN_KINDS);

export function getExecutionDisplayMode(run: ExecutionRunViewState): ExecutionDisplayMode {
  const visibleActions = visibleExecutionActions(run.actions);

  if (
    visibleActions.length === 1
    && !run.hasArtifact
    && !run.isSeriousTask
    && normalizeRunStatus(run.status) === 'completed'
    && ['web', 'file', 'workspace', 'observe'].includes(visibleActions[0].kind)
  ) {
    return 'inline';
  }

  if (run.isSeriousTask || run.hasProductTask || run.hasArtifact) {
    return 'task';
  }

  return 'rail';
}

export function projectRunTraceToActions(trace: RunTrace | null): ExecutionAction[] {
  const steps = trace?.steps ?? [];
  if (steps.length === 0) return [];

  const usedStepIDs = new Set<string>();
  const actions: ExecutionAction[] = [];

  const prepareSteps = collectUnusedSteps(steps, usedStepIDs, (step) => prepareStepTypes.has(step.step_type));
  if (prepareSteps.length > 0) {
    markUsed(prepareSteps, usedStepIDs);
    actions.push(makeAction({
      id: `${trace?.id ?? 'run'}-prepare`,
      kind: 'prepare',
      title: '理解任务',
      description: '已判断任务类型并选择执行方式',
      visible: false,
      steps: prepareSteps,
      details: buildDetails([
        ['INPUT', sanitizeForDisplay(firstKnown(prepareSteps, ['message', 'requested_input_mode']))],
        ['RESULT', sanitizeForDisplay(lastOutput(prepareSteps))],
      ]),
    }));
  }

  const productTaskSteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type === 'product_task_created');
  for (const step of productTaskSteps) {
    markUsed([step], usedStepIDs);
    actions.push(makeAction({
      id: `${step.id}-product-task`,
      kind: 'artifact',
      title: '创建任务',
      description: '已建立可交付任务',
      steps: [step],
      details: buildDetails([
        ['INPUT', sanitizeForDisplay(step.input)],
        ['RESULT', sanitizeForDisplay(step.output)],
      ]),
    }));
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || usedStepIDs.has(step.id) || step.step_type !== 'capability_requested') continue;

    const toolSteps = collectToolWindow(steps, index, usedStepIDs);
    if (toolSteps.length === 0) continue;

    markUsed(toolSteps, usedStepIDs);
    actions.push(projectToolSteps(trace?.id ?? 'run', toolSteps));
    index += Math.max(0, toolSteps.length - 1);
  }

  const evidenceSteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type === 'followup_grounded' || step.step_type === 'recent_tool_evidence_resolved');
  if (evidenceSteps.length > 0) {
    markUsed(evidenceSteps, usedStepIDs);
    actions.push(projectEvidenceSteps(trace?.id ?? 'run', evidenceSteps));
  }

  const artifactSteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type === 'artifact_created');
  for (const step of artifactSteps) {
    markUsed([step], usedStepIDs);
    actions.push(makeAction({
      id: `${step.id}-artifact`,
      kind: 'artifact',
      title: '生成交付物',
      description: String(step.output?.title || step.output?.type || '已生成可查看结果'),
      steps: [step],
      details: buildDetails([
        ['INPUT', sanitizeForDisplay(step.input)],
        ['RESULT', sanitizeForDisplay(step.output)],
      ]),
    }));
  }

  const proactiveSteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type === 'proactive_candidate_created');
  for (const step of proactiveSteps) {
    markUsed([step], usedStepIDs);
    actions.push(makeAction({
      id: `${step.id}-proactive`,
      kind: 'proactive',
      title: '生成提醒候选',
      description: '已生成后续跟进候选',
      steps: [step],
      details: buildDetails([
        ['INPUT', sanitizeForDisplay(step.input)],
        ['RESULT', sanitizeForDisplay(step.output)],
      ]),
    }));
  }

  const memorySteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type.includes('memory') && step.step_type !== 'memory_context_recalled');
  if (memorySteps.length > 0) {
    markUsed(memorySteps, usedStepIDs);
    actions.push(makeAction({
      id: `${trace?.id ?? 'run'}-memory`,
      kind: 'memory',
      title: '处理记忆',
      description: '已处理本轮记忆相关动作',
      visible: false,
      steps: memorySteps,
      details: buildDetails([
        ['RESULT', sanitizeForDisplay(memorySteps.map((step) => step.output))],
      ]),
    }));
  }

  const finalizeSteps = collectUnusedSteps(steps, usedStepIDs, (step) => step.step_type === 'response_generated' || step.step_type === 'agent_call_finished');
  if (finalizeSteps.length > 0) {
    markUsed(finalizeSteps, usedStepIDs);
    actions.push(makeAction({
      id: `${trace?.id ?? 'run'}-finalize`,
      kind: 'finalize',
      title: '生成回复',
      description: '已生成最终回复',
      visible: false,
      steps: finalizeSteps,
      details: buildDetails([
        ['RESULT', sanitizeForDisplay(lastOutput(finalizeSteps))],
      ]),
    }));
  }

  if (visibleExecutionActions(actions).length === 0) {
    const modelOnlySteps = steps.filter((step) => step.step_type === 'model_call_finished' || step.step_type === 'response_generated' || step.step_type === 'agent_call_finished');
    if (modelOnlySteps.length > 0) {
      actions.push(makeAction({
        id: `${trace?.id ?? 'run'}-model-only`,
        kind: 'model',
        title: '模型回答',
        description: '本轮未执行工具',
        summary: '本轮未执行工具',
        steps: modelOnlySteps,
        details: buildDetails([
          ['RESULT', sanitizeForDisplay(lastOutput(modelOnlySteps))],
        ]),
      }));
    }
  }

  return actions.sort((left, right) => stepOrder(left.raw_steps[0], steps) - stepOrder(right.raw_steps[0], steps));
}

export function visibleExecutionActions(actions: ExecutionAction[]): ExecutionAction[] {
  return actions.filter((action) => (
    action.visible !== false
    && !hiddenActionKinds.has(action.kind)
    && (
      visibleActionKinds.has(action.kind)
      || action.status === 'failed'
      || action.status === 'blocked'
      || action.status === 'limited'
    )
  ));
}

export function summarizeExecutionActions(actions: ExecutionAction[]) {
  const visible = visibleExecutionActions(actions);
  const completed = visible.filter((action) => action.status === 'completed').length;
  const failed = visible.filter((action) => action.status === 'failed' || action.status === 'blocked').length;
  const waiting = visible.filter((action) => action.status === 'waiting_approval').length;
  const webReads = visible.filter((action) => action.kind === 'web').length;
  const artifacts = visible.filter((action) => action.kind === 'artifact').length;
  const memories = visible.filter((action) => action.kind === 'memory').length;
  const duration = visible.reduce((sum, action) => sum + actionDurationMs(action), 0);
  const parts = [`已完成 ${completed || visible.length} 步`];
  if (visible.length <= 3) {
    parts.push(...visible.map((action) => action.title));
  } else if (webReads > 0) {
    parts.push(`读取 ${webReads} 个网页`);
  }
  if (artifacts > 0) parts.push(`生成 ${artifacts} 个交付物`);
  if (memories > 0) parts.push(`处理 ${memories} 个记忆动作`);
  if (waiting > 0) parts.push(`${waiting} 个等待确认`);
  if (failed > 0) parts.push(`${failed} 个需要查看`);
  if (duration > 0) parts.push(formatActionDuration(duration));
  return parts.join(' · ');
}

export function createOptimisticExecutionActions(prompt: string): ExecutionAction[] {
  const text = prompt.trim();
  if (!shouldCreateOptimisticActions(text)) return [];
  const now = new Date().toISOString();
  const url = firstURL(text);
  if (url) {
    return [{
      id: `optimistic-web-${now}`,
      kind: 'web',
      title: '读取网页',
      description: `正在读取 ${sourceLabelFromURL(url) || '网页'}...`,
      summary: '正在提取正文...',
      sourceLabel: sourceLabelFromURL(url),
      status: 'running',
      started_at: now,
      details: [
        { label: 'INPUT', value: { url } },
        { label: 'SOURCE', value: url },
      ],
      raw_steps: [],
    }];
  }
  if (/记住|写入记忆|memory/i.test(text)) {
    return [{
      id: `optimistic-memory-${now}`,
      kind: 'memory',
      title: '写入记忆候选',
      description: '正在整理可确认的记忆...',
      status: 'running',
      started_at: now,
      details: [{ label: 'INPUT', value: text }],
      raw_steps: [],
    }];
  }
  if (/认真执行|交付物|计划|方案|实现|开发/i.test(text)) {
    return [{
      id: `optimistic-task-${now}`,
      kind: 'command',
      title: '执行任务',
      description: '正在交给执行后台处理...',
      status: 'running',
      started_at: now,
      details: [{ label: 'INPUT', value: text }],
      raw_steps: [],
    }];
  }
  return [];
}

function projectToolSteps(runID: string, steps: RunStep[]): ExecutionAction {
  const capabilityStep = steps.find((step) => step.step_type === 'capability_requested') ?? steps[0];
  const capability = capabilityFromStep(capabilityStep);
  const compiled = steps.find((step) => step.step_type === 'tool_compiled' || step.step_type === 'workflow_compiled');
  const finished = [...steps].reverse().find((step) => ['tool_finished', 'worker_finished', 'worker_failed', 'capability_blocked', 'policy_blocked'].includes(step.step_type));
  const workflow = objectFromUnknown(compiled?.output?.workflow);
  const toolName = String(workflow.workflow_name || workflow.name || workflow.tool_name || capability || '');
  const title = titleForCapability(capability, toolName);
  const kind = kindForCapability(capability, toolName, title);
  const status = statusForSteps(steps);
  const resultOutput = sanitizeForDisplay(finished?.output ?? lastOutput(steps));
  const statusDetail = descriptionForToolAction(title, status, resultOutput);
  const source = extractSource(steps);
  const sourceLabel = extractSourceLabel(source);
  const command = extractCommand(steps);
  const error = extractError(steps);
  const limitations = limitationsFromValue(extractLimitations(steps));

  return makeAction({
    id: `${runID}-tool-${capabilityStep?.id ?? steps[0]?.id ?? 'unknown'}`,
    kind,
    title,
    description: statusDetail,
    summary: statusDetail,
    sourceLabel,
    completedLabel: completedLabelForAction(kind, sourceLabel, title),
    limitations,
    steps,
    details: buildDetails([
      ['COMMAND', command],
      ['INPUT', sanitizeForDisplay(extractInput(capabilityStep, steps))],
      ['SOURCE', source],
      ['RESULT', resultOutput],
      ['LIMITATIONS', extractLimitations(steps)],
      ['ERROR', error],
    ]),
  });
}

function projectEvidenceSteps(runID: string, steps: RunStep[]): ExecutionAction {
  const grounded = steps.find((step) => step.step_type === 'followup_grounded');
  const evidence = grounded ?? steps[steps.length - 1];
  const output = objectFromUnknown(evidence?.output);
  const sourceRunID = String(output.source_run_id || '');
  const toolRunID = String(output.tool_run_id || firstKnown(steps, ['tool_run_id']) || '');
  const capability = String(output.capability_id || firstKnown(steps, ['capability_id']) || 'tool evidence');
  const description = grounded ? '本轮引用了上一轮工具证据' : '本轮注入了最近工具证据';
  return makeAction({
    id: `${runID}-evidence-${evidence?.id ?? 'recent'}`,
    kind: 'evidence',
    title: '引用工具证据',
    description,
    summary: description,
    completedLabel: description,
    steps,
    details: buildDetails([
      ['SOURCE', sanitizeForDisplay(`source_run_id=${sourceRunID} tool_run_id=${toolRunID} capability_id=${capability}`)],
      ['RESULT', sanitizeForDisplay(output)],
    ]),
  });
}

function descriptionForToolAction(title: string, status: ExecutionActionStatus, output?: unknown) {
  if (status === 'waiting_approval') {
    if (title === '写入文件') return '等待你的确认，批准前不会写入';
    if (title === '点击浏览器' || title === '输入浏览器') return '等待你的确认，批准前不会操作页面';
    return '等待你的确认，批准前不会执行';
  }
  if (status === 'running' || status === 'queued') {
    if (title === '网页搜索') return '正在搜索网页...';
    if (title === '读取网页') return '正在读取网页...';
    if (title === '搜索 X') return '正在搜索 X...';
    if (title === '搜索工作区') return '正在搜索工作区...';
    if (title === '读取文件') return '正在读取文件...';
    if (title === '查询代码索引') return '正在查询代码索引...';
    if (title === '调试程序') return '正在调试程序...';
    if (title === '执行代码') return '正在执行代码...';
    if (title === '执行沙箱') return '正在执行沙箱...';
    if (title === '派发子任务') return '正在派发子任务...';
    if (title === '调用 MCP 工具') return '正在调用 MCP 工具...';
    if (title === '分析图片') return '正在分析图片...';
    if (title === '生成图片') return '正在生成图片...';
    if (title === '生成视频') return '正在生成视频...';
    if (title === '分析视频') return '正在分析视频...';
    if (title === '生成语音') return '正在生成语音...';
    if (title === '列出本机 App') return '正在列出本机 App...';
    if (title === '检查本机 App') return '正在检查本机 App...';
    if (title === '导航浏览器') return '正在导航浏览器...';
    if (title === '点击浏览器') return '正在点击浏览器...';
    if (title === '输入浏览器') return '正在输入浏览器...';
    if (title === '观察浏览器') return '正在观察当前浏览器...';
    if (title === '观察屏幕') return '正在观察当前窗口...';
    if (title === '运行命令') return '正在运行命令...';
    return '正在执行...';
  }
  if (status === 'failed') return '执行失败，展开可查看原因';
  if (status === 'blocked' || status === 'limited') {
    if (isNotConfiguredToolOutput(output)) return '工具后端未配置，未执行';
    return '需要确认或权限不足';
  }
  if (title === '网页搜索') return '本轮执行了工具：已搜索网页';
  if (title === '读取网页') return '本轮执行了工具：已读取网页并提取正文';
  if (title === '搜索 X') return '本轮执行了工具：已搜索 X';
  if (title === '搜索工作区') return '本轮执行了工具：已搜索工作区';
  if (title === '读取文件') return '本轮执行了工具：已读取文件';
  if (title === '查询代码索引') return '本轮执行了工具：已查询代码索引';
  if (title === '调试程序') return '本轮执行了工具：已执行调试动作';
  if (title === '执行代码') return '本轮执行了工具：已执行代码';
  if (title === '执行沙箱') return '本轮执行了工具：已执行沙箱';
  if (title === '派发子任务') return '本轮执行了工具：已派发子任务';
  if (title === '调用 MCP 工具') return '本轮执行了工具：已调用 MCP 工具';
  if (title === '分析图片') return '本轮执行了工具：已分析图片';
  if (title === '生成图片') return '本轮执行了工具：已生成图片';
  if (title === '生成视频') return '本轮执行了工具：已生成视频';
  if (title === '分析视频') return '本轮执行了工具：已分析视频';
  if (title === '生成语音') return '本轮执行了工具：已生成语音';
  if (title === '列出本机 App') return '本轮执行了工具：已列出本机 App';
  if (title === '检查本机 App') return '本轮执行了工具：已检查本机 App';
  if (title === '导航浏览器') return '本轮执行了工具：已导航浏览器';
  if (title === '点击浏览器') return '本轮执行了工具：已点击浏览器';
  if (title === '输入浏览器') return '本轮执行了工具：已输入浏览器';
  if (title === '观察浏览器') return '本轮执行了工具：已观察当前浏览器';
  if (title === '观察屏幕') return '本轮执行了工具：已观察当前窗口';
  if (title === '运行命令') return '本轮执行了工具：已运行命令';
  if (title === '写入文件') return '本轮执行了工具：已写入文件';
  return '本轮执行了工具：已完成工具动作';
}

function collectToolWindow(steps: RunStep[], startIndex: number, usedStepIDs: Set<string>) {
  const result: RunStep[] = [];
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || usedStepIDs.has(step.id)) continue;
    if (index > startIndex && (step.step_type === 'capability_requested' || terminalToolBoundaries.has(step.step_type))) break;
    if (!toolStepTypes.has(step.step_type)) {
      if (index > startIndex && !step.step_type.includes('task_step')) break;
      continue;
    }
    result.push(step);
  }
  return result;
}

function makeAction(input: {
  id: string;
  kind: ExecutionActionKind;
  title: string;
  description: string;
  summary?: string;
  sourceLabel?: string;
  inputPreview?: string;
  outputPreview?: string;
  limitations?: string[];
  completedLabel?: string;
  visible?: boolean;
  steps: RunStep[];
  details: ExecutionActionDetail[];
}): ExecutionAction {
  const first = input.steps[0];
  const last = input.steps[input.steps.length - 1];
  const durationMs = totalDuration(input.steps);
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    description: input.description,
    summary: input.summary ?? input.description,
    sourceLabel: input.sourceLabel,
    inputPreview: input.inputPreview,
    outputPreview: input.outputPreview,
    limitations: input.limitations,
    completedLabel: input.completedLabel,
    visible: input.visible ?? !hiddenActionKinds.has(input.kind),
    status: statusForSteps(input.steps),
    started_at: first?.started_at || first?.created_at,
    finished_at: last?.finished_at,
    duration_ms: durationMs,
    durationMs,
    details: input.details,
    raw_steps: input.steps,
  };
}

function statusForSteps(steps: RunStep[]): ExecutionActionStatus {
  if (steps.some((step) => step.status === 'waiting_approval' || step.status === 'waiting_confirmation' || step.step_type === 'approval_requested')) return 'waiting_approval';
  if (steps.some((step) => outputStatusForStep(step) === 'policy_blocked')) return 'blocked';
  if (steps.some((step) => outputStatusForStep(step) === 'failed')) return 'failed';
  if (steps.some((step) => step.step_type.includes('blocked') || step.status === 'blocked')) return 'blocked';
  if (steps.some((step) => step.step_type.includes('failed') || step.status === 'failed' || step.error)) return 'failed';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.some((step) => step.step_type === 'task_dispatched')) return 'queued';
  if (steps.every((step) => step.status === 'succeeded' || step.status === 'success' || step.status === 'completed')) return 'completed';
  return normalizeActionStatus(steps[steps.length - 1]?.status);
}

function outputStatusForStep(step: RunStep): string {
  const output = objectFromUnknown(step.output);
  return String(output.status || output.fetch_status || '').trim();
}

function isNotConfiguredToolOutput(value: unknown): boolean {
  const output = objectFromUnknown(value);
  return output.mode === 'capability_registry_v1_not_configured' || output.reason === 'not_configured';
}

function totalDuration(steps: RunStep[]) {
  const values = steps
    .map((step) => step.duration_ms)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function buildDetails(items: Array<[ExecutionActionDetail['label'], unknown]>): ExecutionActionDetail[] {
  return items
    .filter(([, value]) => hasDisplayValue(value))
    .map(([label, value]) => ({ label, value }));
}

function hasDisplayValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function capabilityFromStep(step?: RunStep) {
  const output = objectFromUnknown(step?.output);
  const request = objectFromUnknown(output.capability_request);
  return String(output.capability || output.raw_capability || request.capability || request.raw_capability || 'unknown');
}

function titleForCapability(capability: string, workflow: string) {
  const key = `${capability} ${workflow}`.toLowerCase();
  if (key.includes('x_search')) return '搜索 X';
  if (key.includes('web_extract') || key.includes('web_research_v2') || key.includes('fetch') || key.includes('crawl')) return '读取网页';
  if (key.includes('web_search') || key.includes('web_search_v1')) return '网页搜索';
  if (key.includes('web_research')) return '网页搜索';
  if (key.includes('vision_analyze')) return '分析图片';
  if (key.includes('image_generate')) return '生成图片';
  if (key.includes('video_generate')) return '生成视频';
  if (key.includes('video_analyze')) return '分析视频';
  if (key.includes('text_to_speech') || key.includes('tts')) return '生成语音';
  if (key.includes('execute_code') || key.includes('code_execution')) return '执行代码';
  if (key.includes('sandbox_run')) return '执行沙箱';
  if (key.includes('delegate_task') || key.includes('subagent_delegate')) return '派发子任务';
  if (key.includes('mcp_tool_call')) return '调用 MCP 工具';
  if (key.includes('extension_register_tool')) return '注册扩展工具';
  if (key.includes('lsp_')) return '查询代码索引';
  if (key.includes('debugger_')) return '调试程序';
  if (key.includes('session_search')) return '搜索会话';
  if (key.includes('session_summary')) return '总结会话';
  if (key.includes('session_branch')) return '创建会话分支';
  if (key.includes('compaction')) return '压缩上下文';
  if (key.includes('queue_followup')) return '加入队列';
  if (key.includes('clarify')) return '请求澄清';
  if (key.includes('todo')) return '更新待办';
  if (key.includes('cronjob')) return '设置定时任务';
  if (key.includes('project_')) return '管理项目';
  if (key.includes('skill_') || key.includes('skills_')) return '管理技能';
  if (key.includes('ha_')) return '调用 Home Assistant';
  if (key.includes('apply_patch') || key.includes('patch') || key.includes('workspace_write') || key.includes('write_file')) return '写入文件';
  if (key.includes('desktop_app_list') || key.includes('desktop_list_app')) return '列出本机 App';
  if (key.includes('desktop_app_inspect') || key.includes('desktop_inspect_app')) return '检查本机 App';
  if (key.includes('browser_navigate') || key.includes('browser_navigate_url')) return '导航浏览器';
  if (key.includes('browser_back')) return '浏览器后退';
  if (key.includes('browser_scroll')) return '滚动浏览器';
  if (key.includes('browser_press')) return '按键浏览器';
  if (key.includes('browser_console')) return '读取浏览器控制台';
  if (key.includes('browser_dialog')) return '处理浏览器弹窗';
  if (key.includes('browser_get_images')) return '提取页面图片';
  if (key.includes('browser_vision')) return '分析页面画面';
  if (key.includes('browser_cdp')) return '调用浏览器 CDP';
  if (key.includes('browser_click') || key.includes('browser_click_element')) return '点击浏览器';
  if (key.includes('browser_type') || key.includes('browser_type_text')) return '输入浏览器';
  if (key.includes('browser_observe') || key.includes('browser_snapshot')) return '观察浏览器';
  if (key.includes('computer_use')) return '操作屏幕';
  if (key.includes('computer_observe') || key.includes('computer_snapshot')) return '观察屏幕';
  if (key.includes('workspace_search') || key.includes('search_files') || key.includes('grep') || key.includes('find')) return '搜索工作区';
  if (key.includes('file') || key.includes('read')) return '读取文件';
  if (key.includes('test_command') || key.includes('test')) return '运行测试';
  if (key.includes('shell') || key.includes('bash') || key.includes('command') || key.includes('ls')) return '运行命令';
  if (key.includes('memory')) return '处理记忆';
  if (capability && capability !== 'unknown') return formatCapabilityTitle(capability);
  return '执行工具';
}

function kindForCapability(capability: string, workflow: string, title: string): ExecutionActionKind {
  const key = `${capability} ${workflow} ${title}`.toLowerCase();
  if (key.includes('x_search') || title === '搜索 X') return 'web';
  if (key.includes('web_search') || key.includes('web_research') || key.includes('web_extract') || title === '网页搜索') return 'web';
  if (key.includes('image_generate') || key.includes('video_generate') || title === '生成图片' || title === '生成视频') return 'artifact';
  if (key.includes('vision_analyze') || key.includes('video_analyze') || title === '分析图片' || title === '分析视频') return 'observe';
  if (key.includes('text_to_speech') || title === '生成语音') return 'artifact';
  if (key.includes('lsp_')) return key.includes('rename') || key.includes('format') ? 'file' : 'workspace';
  if (key.includes('debugger_') || key.includes('execute_code') || key.includes('code_execution') || key.includes('sandbox_run')) return 'command';
  if (key.includes('delegate_task') || key.includes('subagent_delegate') || key.includes('mcp_tool_call') || key.includes('extension_register_tool')) return 'command';
  if (key.includes('session_') || key.includes('compaction') || key.includes('queue_followup') || key.includes('todo') || key.includes('cronjob')) return 'proactive';
  if (key.includes('project_') || key.includes('skill_') || key.includes('skills_') || key.includes('ha_')) return 'command';
  if (key.includes('apply_patch') || title === '写入文件') return 'file';
  if (key.includes('web') || key.includes('research') || key.includes('fetch') || key.includes('crawl')) return 'web';
  if (key.includes('browser_click') || key.includes('browser_type') || title === '点击浏览器' || title === '输入浏览器') return 'command';
  if (key.includes('browser_navigate') || title === '导航浏览器') return 'observe';
  if (key.includes('observe') || key.includes('snapshot')) return 'observe';
  if (key.includes('workspace') || key.includes('search')) return 'workspace';
  if (key.includes('file') || key.includes('read')) return 'file';
  if (key.includes('shell') || key.includes('bash') || key.includes('command')) return 'command';
  if (key.includes('memory')) return 'memory';
  return 'command';
}

function completedLabelForAction(kind: ExecutionActionKind, sourceLabel: string | undefined, title: string) {
  if (title === '写入文件') return `已写入文件${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (title === '网页搜索') return `已搜索网页${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (title === '搜索 X') return `已搜索 X${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'web') return `已读取网页${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'file') return `已读取文件${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'workspace') return `已搜索工作区${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  if (kind === 'observe') return `${title}${sourceLabel ? ` · ${sourceLabel}` : ''}`;
  return title;
}

function formatCapabilityTitle(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function extractInput(capabilityStep: RunStep | undefined, steps: RunStep[]) {
  const capabilityOutput = objectFromUnknown(capabilityStep?.output);
  const request = objectFromUnknown(capabilityOutput.capability_request);
  return capabilityOutput.inputs || request.inputs || firstKnown(steps, ['query', 'url', 'path', 'root', 'goal']) || capabilityStep?.input;
}

function extractSource(steps: RunStep[]) {
  const found = findNestedValue(steps.map((step) => ({ input: step.input, output: step.output })), ['url', 'source_url', 'source', 'path', 'target_path', 'file_path', 'affected_paths', 'root', 'query', 'title', 'window_title', 'frontmost_app', 'browser_app']);
  return sanitizeForDisplay(found);
}

function extractSourceLabel(source: unknown) {
  if (Array.isArray(source)) {
    return extractSourceLabel(source.find(Boolean));
  }
  if (typeof source !== 'string') return undefined;
  return sourceLabelFromURL(source) || fileLabelFromPath(source) || truncatePlainLabel(source, 36);
}

function extractCommand(steps: RunStep[]) {
  const value = findNestedValue(steps, ['command', 'cmd', 'shell']);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value;
  return undefined;
}

function extractError(steps: RunStep[]) {
  const stepWithError = steps.find((step) => step.error && Object.keys(step.error).length > 0);
  if (stepWithError?.error) return sanitizeForDisplay(stepWithError.error);
  const blocked = steps.find((step) => step.step_type.includes('blocked') || step.status === 'blocked' || step.status === 'failed');
  return sanitizeForDisplay(blocked?.output);
}

function extractLimitations(steps: RunStep[]) {
  const value = findNestedValue(steps, ['limitations', 'warning', 'warnings', 'truncated', 'readable_text_truncated']);
  return sanitizeForDisplay(value);
}

function limitationsFromValue(value: unknown): string[] | undefined {
  if (!hasDisplayValue(value)) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'boolean') return value ? ['内容可能被截断'] : undefined;
  if (typeof value === 'string') return [value];
  return [formatPreview(value)];
}

function shouldCreateOptimisticActions(text: string) {
  return Boolean(firstURL(text)) || /@research|认真执行|交付物|计划|方案|实现|开发|记住|写入记忆|memory/i.test(text);
}

function firstURL(text: string) {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] ?? '';
}

export function sourceLabelFromURL(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatActionDuration(value: number) {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

export function actionDurationMs(action: ExecutionAction) {
  return action.durationMs ?? action.duration_ms ?? 0;
}

function normalizeActionStatus(status?: string): ExecutionActionStatus {
  if (status === 'succeeded' || status === 'success') return 'completed';
  if (status === 'waiting_confirmation') return 'waiting_approval';
  if (status === 'completed' || status === 'running' || status === 'pending' || status === 'failed' || status === 'blocked' || status === 'queued' || status === 'limited' || status === 'waiting_approval' || status === 'cancelled' || status === 'skipped') {
    return status;
  }
  return 'pending';
}

function normalizeRunStatus(status?: string) {
  if (status === 'succeeded' || status === 'success') return 'completed';
  if (status === 'waiting_confirmation') return 'waiting_approval';
  if (status === 'completed' || status === 'running' || status === 'failed' || status === 'waiting_approval') return status;
  return status || 'pending';
}

function findNestedValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedValue(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key];
  }
  for (const item of Object.values(record)) {
    const found = findNestedValue(item, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function firstKnown(steps: RunStep[], keys: string[]) {
  return findNestedValue(steps.map((step) => ({ input: step.input, output: step.output })), keys);
}

function lastOutput(steps: RunStep[]) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const output = steps[index]?.output;
    if (output && Object.keys(output).length > 0) return output;
  }
  return undefined;
}

function collectUnusedSteps(steps: RunStep[], usedStepIDs: Set<string>, predicate: (step: RunStep) => boolean) {
  return steps.filter((step) => !usedStepIDs.has(step.id) && predicate(step));
}

function markUsed(steps: RunStep[], usedStepIDs: Set<string>) {
  for (const step of steps) usedStepIDs.add(step.id);
}

function stepOrder(step: RunStep | undefined, steps: RunStep[]) {
  if (!step) return Number.MAX_SAFE_INTEGER;
  const index = steps.findIndex((item) => item.id === step.id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function sanitizeForDisplay(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(sanitizeForDisplay).filter(hasDisplayValue);
    return items.length ? items : undefined;
  }
  if (typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (hiddenDetailKeys.has(key)) continue;
    const next = sanitizeForDisplay(item);
    if (hasDisplayValue(next)) result[key] = next;
  }
  return Object.keys(result).length ? result : undefined;
}

function truncatePlainLabel(value: string, maxLength: number) {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function fileLabelFromPath(value: string) {
  const text = value.trim();
  if (!text.includes('/') && !text.includes('\\')) return '';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function formatPreview(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
