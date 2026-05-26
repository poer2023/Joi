import type { RunTrace } from './api/desktop';

type RunStep = NonNullable<RunTrace['steps']>[number];

export type ExecutionActionKind = 'prepare' | 'model' | 'tool' | 'artifact' | 'memory' | 'finalize' | 'diagnostic';

export type ExecutionActionDetail = {
  label: 'COMMAND' | 'INPUT' | 'SOURCE' | 'RESULT' | 'ERROR';
  value: unknown;
};

export type ExecutionAction = {
  id: string;
  kind: ExecutionActionKind;
  title: string;
  description: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  details: ExecutionActionDetail[];
  raw_steps: RunStep[];
};

const prepareStepTypes = new Set([
  'task_classified',
  'input_received',
  'router_selected',
  'active_context_resolved',
  'prompt_assembled',
  'model_call_finished',
  'agent_output_parsed',
]);

const toolStepTypes = new Set([
  'capability_requested',
  'capability_blocked',
  'policy_checked',
  'policy_blocked',
  'tool_compiled',
  'node_selected',
  'tool_started',
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
  'prefix_hash',
  'privacy_level',
  'prompt_assembly_id',
  'prompt_cache_key',
  'raw_capability',
  'route_result',
  'running_tasks',
  'scheduler',
  'task_attempts',
  'tool_schema_version',
]);

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
      kind: 'prepare',
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
      kind: 'memory',
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
      steps: finalizeSteps,
      details: buildDetails([
        ['RESULT', sanitizeForDisplay(lastOutput(finalizeSteps))],
      ]),
    }));
  }

  return actions.sort((left, right) => stepOrder(left.raw_steps[0], steps) - stepOrder(right.raw_steps[0], steps));
}

function projectToolSteps(runID: string, steps: RunStep[]): ExecutionAction {
  const capabilityStep = steps.find((step) => step.step_type === 'capability_requested') ?? steps[0];
  const capability = capabilityFromStep(capabilityStep);
  const compiled = steps.find((step) => step.step_type === 'tool_compiled');
  const selected = steps.find((step) => step.step_type === 'node_selected');
  const dispatched = steps.find((step) => step.step_type === 'task_dispatched');
  const finished = [...steps].reverse().find((step) => ['tool_finished', 'worker_finished', 'worker_failed', 'capability_blocked', 'policy_blocked'].includes(step.step_type));
  const workflow = objectFromUnknown(compiled?.output?.workflow);
  const toolName = String(workflow.workflow_name || workflow.name || workflow.tool_name || capability || '');
  const title = titleForCapability(capability, toolName);
  const node = String(selected?.output?.node_id || dispatched?.output?.node_id || finished?.output?.node_id || '');
  const statusDetail = node ? `执行节点：${node}` : '已执行工具动作';
  const resultOutput = sanitizeForDisplay(finished?.output ?? lastOutput(steps));
  const source = extractSource(steps);
  const command = extractCommand(steps);
  const error = extractError(steps);

  return makeAction({
    id: `${runID}-tool-${capabilityStep?.id ?? steps[0]?.id ?? 'unknown'}`,
    kind: 'tool',
    title,
    description: statusDetail,
    steps,
    details: buildDetails([
      ['COMMAND', command],
      ['INPUT', sanitizeForDisplay(extractInput(capabilityStep, steps))],
      ['SOURCE', source],
      ['RESULT', resultOutput],
      ['ERROR', error],
    ]),
  });
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
  steps: RunStep[];
  details: ExecutionActionDetail[];
}): ExecutionAction {
  const first = input.steps[0];
  const last = input.steps[input.steps.length - 1];
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    description: input.description,
    status: statusForSteps(input.steps),
    started_at: first?.started_at || first?.created_at,
    finished_at: last?.finished_at,
    duration_ms: totalDuration(input.steps),
    details: input.details,
    raw_steps: input.steps,
  };
}

function statusForSteps(steps: RunStep[]) {
  if (steps.some((step) => step.step_type.includes('blocked') || step.status === 'blocked')) return 'blocked';
  if (steps.some((step) => step.step_type.includes('failed') || step.status === 'failed' || step.error)) return 'failed';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.some((step) => step.step_type === 'task_dispatched')) return 'queued';
  if (steps.every((step) => step.status === 'succeeded' || step.status === 'success' || step.status === 'completed')) return 'succeeded';
  return steps[steps.length - 1]?.status || 'pending';
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
  if (key.includes('web') || key.includes('research') || key.includes('fetch') || key.includes('crawl')) return '读取网页';
  if (key.includes('workspace_search') || key.includes('search')) return '搜索工作区';
  if (key.includes('file') || key.includes('read')) return '读取文件';
  if (key.includes('shell') || key.includes('bash') || key.includes('command')) return '运行命令';
  if (key.includes('memory')) return '处理记忆';
  if (capability && capability !== 'unknown') return formatCapabilityTitle(capability);
  return '执行工具';
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
  const found = findNestedValue(steps, ['url', 'source_url', 'source', 'path', 'root', 'query']);
  return sanitizeForDisplay(found);
}

function extractCommand(steps: RunStep[]) {
  const value = findNestedValue(steps, ['command', 'cmd', 'shell']);
  return typeof value === 'string' ? value : undefined;
}

function extractError(steps: RunStep[]) {
  const stepWithError = steps.find((step) => step.error && Object.keys(step.error).length > 0);
  if (stepWithError?.error) return sanitizeForDisplay(stepWithError.error);
  const blocked = steps.find((step) => step.step_type.includes('blocked') || step.status === 'blocked' || step.status === 'failed');
  return sanitizeForDisplay(blocked?.output);
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

function objectFromUnknown(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
