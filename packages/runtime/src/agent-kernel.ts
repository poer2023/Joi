import type {
  ToolCall,
  ToolCallingCallbacks,
  ToolCallingTurnResult,
  ToolExecutor,
  ToolResult,
  ToolSpec,
  UsageStatus,
} from './tool-calling.ts';

export type AgentKernelEvent = {
  type: string;
  step?: number;
  attempt?: number;
  status?: string;
  tool_call_id?: string;
  tool_name?: string;
  detail?: Record<string, unknown>;
};

export type AgentKernelModelResponse = {
  message: Record<string, unknown>;
  usage?: Partial<ToolCallingTurnResult['usage']>;
  usage_status?: UsageStatus;
  finish_reason?: string;
  raw: Record<string, unknown>;
};

export type AgentKernelModelRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools: ToolSpec[];
  step: number;
  signal?: AbortSignal;
};

export type ToolPreflightDecision = {
  block?: boolean;
  reason?: string;
};

export type ToolPostflightDecision = {
  result?: ToolResult;
  terminate?: boolean;
};

export type FinalResponseContractField = {
  key: string;
  description?: string;
};

export type FinalResponseContract = {
  fields: FinalResponseContractField[];
  delimiter?: '=' | ':';
  exact_non_empty_lines?: number;
  max_repairs?: number;
};

export type AgentKernelRequest = {
  model: string;
  streaming?: boolean;
  messages: Array<Record<string, unknown>>;
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  callModel: (request: AgentKernelModelRequest) => Promise<AgentKernelModelResponse>;
  max_steps?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
  tool_execution?: 'sequential' | 'parallel';
  max_context_messages?: number;
  max_tool_result_bytes?: number;
  final_response_contract?: FinalResponseContract;
  signal?: AbortSignal;
  callbacks?: ToolCallingCallbacks;
  transformMessages?: (
    messages: Array<Record<string, unknown>>,
    context: { step: number; signal?: AbortSignal },
  ) => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
  beforeToolCall?: (
    input: { step: number; call: ToolCall; tool: ToolSpec; messages: Array<Record<string, unknown>>; signal?: AbortSignal },
  ) => Promise<ToolPreflightDecision | void> | ToolPreflightDecision | void;
  afterToolCall?: (
    input: { step: number; call: ToolCall; tool: ToolSpec; result: ToolResult; messages: Array<Record<string, unknown>>; signal?: AbortSignal },
  ) => Promise<ToolPostflightDecision | void> | ToolPostflightDecision | void;
  shouldStopAfterTurn?: (
    input: { step: number; messages: Array<Record<string, unknown>>; tool_results: ToolResult[]; final_message: string },
  ) => Promise<boolean> | boolean;
  getSteeringMessages?: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
  getFollowUpMessages?: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>;
};

type ExecutedTool = {
  call: ToolCall;
  result: ToolResult;
  terminate: boolean;
};

export class AgentModelTransportError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AgentModelTransportError';
    this.status = options.status;
    this.retryable = Boolean(options.retryable);
  }
}

export async function runAgentKernel(req: AgentKernelRequest): Promise<ToolCallingTurnResult> {
  const maxSteps = positiveInteger(req.max_steps, 6);
  const maxRetries = nonNegativeInteger(req.max_retries, 2);
  const retryBackoffMs = nonNegativeInteger(req.retry_backoff_ms, 250);
  const maxToolResultBytes = positiveInteger(req.max_tool_result_bytes, 64 * 1024);
  let messages = req.messages.map(cloneRecord);
  const toolResults: ToolResult[] = [];
  const modelResponses: Array<Record<string, unknown>> = [];
  const usage = emptyUsage();
  const resultCache = new Map<string, ToolResult>();
  let usageStatus: UsageStatus = 'provider_missing';
  let finishReason = '';
  let activeStep = 0;
  let responseContractRepairs = 0;

  await emitKernelEvent(req.callbacks, { type: 'kernel.started', status: 'running' });
  try {
    for (let step = 0; step < maxSteps; step++) {
      activeStep = step;
      throwIfAborted(req.signal);
      await emitKernelEvent(req.callbacks, { type: 'turn.started', step, status: 'running' });
      messages = boundContext(messages, req.max_context_messages);
      if (req.transformMessages) {
        const transformed = await req.transformMessages(messages.map(cloneRecord), { step, signal: req.signal });
        if (!Array.isArray(transformed) || transformed.length === 0) {
          throw new Error('agent kernel transformMessages must return at least one message');
        }
        messages = transformed.map(cloneRecord);
      }

      await req.callbacks?.onModelStarted?.({ step, model: req.model, streaming: Boolean(req.streaming) });
      await emitKernelEvent(req.callbacks, { type: 'model.started', step, status: 'running' });
      const modelResponse = await callModelWithRetry(req, {
        model: req.model,
        messages: messages.map(cloneRecord),
        tools: req.tools,
        step,
        signal: req.signal,
      }, maxRetries, retryBackoffMs);
      modelResponses.push(modelResponse.raw);
      addUsage(usage, modelResponse.usage);
      const stepUsageStatus = modelResponse.usage_status || usageStatusFor(modelResponse.usage);
      usageStatus = mergeUsageStatus(usageStatus, stepUsageStatus);
      finishReason = modelResponse.finish_reason || finishReason;
      await req.callbacks?.onUsage?.({ step, usage: { ...usage }, usage_status: stepUsageStatus });
      await req.callbacks?.onModelCompleted?.({ step, finish_reason: finishReason || undefined, usage_status: stepUsageStatus });
      await emitKernelEvent(req.callbacks, {
        type: 'model.completed',
        step,
        status: 'completed',
        detail: { finish_reason: finishReason || undefined, usage_status: stepUsageStatus },
      });

      const message = modelResponse.message || {};
      const toolCalls = parseAgentToolCalls(message.tool_calls);
      const assistantText = stringValue(message.content);
      if (toolCalls.length === 0) {
        const contractCheck = validateFinalResponseContract(assistantText, req.final_response_contract);
        if (!contractCheck.valid
          && responseContractRepairs < nonNegativeInteger(req.final_response_contract?.max_repairs, 1)
          && step + 1 < maxSteps) {
          responseContractRepairs += 1;
          messages.push({ role: 'assistant', content: assistantText });
          messages.push(finalResponseRepairMessage(req.final_response_contract!, contractCheck.errors));
          await emitKernelEvent(req.callbacks, {
            type: 'response.contract_rejected',
            step,
            attempt: responseContractRepairs,
            status: 'repairing',
            detail: { errors: contractCheck.errors },
          });
          await emitKernelEvent(req.callbacks, { type: 'turn.completed', step, status: 'repairing' });
          continue;
        }
        await req.callbacks?.onAssistantCompleted?.({
          step,
          text: assistantText,
          finish_reason: finishReason || undefined,
          usage_status: stepUsageStatus,
        });
        if (req.final_response_contract) {
          await emitKernelEvent(req.callbacks, {
            type: contractCheck.valid ? 'response.contract_passed' : 'response.contract_failed',
            step,
            status: contractCheck.valid ? 'completed' : 'failed',
            detail: { errors: contractCheck.errors, repairs: responseContractRepairs },
          });
        }
        await emitKernelEvent(req.callbacks, { type: 'assistant.completed', step, status: 'completed' });
        messages.push({ role: 'assistant', content: assistantText });
        await emitKernelEvent(req.callbacks, { type: 'turn.completed', step, status: 'completed' });
        if (await shouldStop(req, step, messages, toolResults, assistantText)) {
          return completedResult('completed', assistantText, toolResults, usage, usageStatus, finishReason, modelResponses, req.callbacks, step);
        }
        const queued = await drainQueuedMessages(req, true);
        if (queued.length > 0 && step + 1 < maxSteps) {
          messages.push(...queued.map(cloneRecord));
          continue;
        }
        return completedResult('completed', assistantText, toolResults, usage, usageStatus, finishReason, modelResponses, req.callbacks, step);
      }

      messages.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: serializedCallArguments(call) },
        })),
      });

      const executed = await executeToolBatch(req, step, toolCalls, messages, resultCache);
      for (const item of executed) {
        toolResults.push(item.result);
        messages.push({
          role: 'tool',
          tool_call_id: item.call.id,
          name: item.call.name,
          content: serializeToolOutputForModel(item.result.output, maxToolResultBytes),
        });
      }
      const waiting = executed.find((item) => item.result.output?.status === 'waiting_confirmation');
      if (waiting) {
        await emitKernelEvent(req.callbacks, { type: 'turn.completed', step, status: 'waiting_confirmation' });
        return completedResult(
          'waiting_confirmation',
          stringValue(waiting.result.output.message) || '这个受控能力需要你确认后才会执行。',
          toolResults,
          usage,
          usageStatus,
          finishReason,
          modelResponses,
          req.callbacks,
          step,
        );
      }
      await emitKernelEvent(req.callbacks, { type: 'turn.completed', step, status: 'completed' });
      if (executed.length > 0 && executed.every((item) => item.terminate)) {
        const finalMessage = assistantText || '工具执行已完成。';
        return completedResult('completed', finalMessage, toolResults, usage, usageStatus, finishReason, modelResponses, req.callbacks, step);
      }
      if (await shouldStop(req, step, messages, toolResults, assistantText)) {
        const finalMessage = assistantText || '工具执行已完成。';
        return completedResult('completed', finalMessage, toolResults, usage, usageStatus, finishReason, modelResponses, req.callbacks, step);
      }
      const steering = await drainQueuedMessages(req, false);
      if (steering.length > 0) messages.push(...steering.map(cloneRecord));
    }

    const finalMessage = '已达到本轮工具调用上限，请缩小任务范围或继续当前任务。';
    await emitKernelEvent(req.callbacks, { type: 'kernel.completed', step: maxSteps - 1, status: 'max_steps_exceeded' });
    return {
      status: 'max_steps_exceeded',
      final_message: finalMessage,
      tool_results: toolResults,
      usage,
      usage_status: usageStatus,
      finish_reason: finishReason || undefined,
      model_responses: modelResponses,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await req.callbacks?.onError?.({ step: activeStep, error: err });
    await emitKernelEvent(req.callbacks, {
      type: 'kernel.failed',
      step: activeStep,
      status: req.signal?.aborted ? 'cancelled' : 'failed',
      detail: { error: err.message },
    });
    throw err;
  }
}

export function validateFinalResponseContract(
  value: string,
  contract: FinalResponseContract | undefined,
): { valid: boolean; errors: string[] } {
  if (!contract) return { valid: true, errors: [] };
  const delimiter = contract.delimiter || '=';
  const fields = contract.fields
    .map((field) => ({ ...field, key: stringValue(field.key).trim() }))
    .filter((field) => Boolean(field.key));
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errors: string[] = [];
  const expectedLines = positiveInteger(contract.exact_non_empty_lines, fields.length);
  if (expectedLines && lines.length !== expectedLines) {
    errors.push(`expected exactly ${expectedLines} non-empty lines, received ${lines.length}`);
  }
  for (const field of fields) {
    const prefix = `${field.key}${delimiter}`;
    const matches = lines.filter((line) => line.startsWith(prefix) && line.slice(prefix.length).trim().length > 0);
    if (matches.length !== 1) errors.push(`expected exactly one non-empty ${prefix}<value> line`);
  }
  const allowedKeys = new Set(fields.map((field) => field.key));
  for (const line of lines) {
    const split = line.indexOf(delimiter);
    if (split <= 0 || !allowedKeys.has(line.slice(0, split).trim())) {
      errors.push(`unexpected or malformed line: ${line.slice(0, 120)}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function inferFinalResponseContract(
  messages: Array<Record<string, unknown>>,
): FinalResponseContract | undefined {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const contractText = latestUserMessage ? stringValue(latestUserMessage.content) : '';
  if (!/(?:严格输出|exactly\s+\d+\s+(?:non-empty\s+)?lines?|key\s*=\s*value)/i.test(contractText)) return undefined;
  const keys = [...new Set(contractText.match(/\b[A-Z][A-Z0-9_]{1,}\b/g) || [])];
  if (keys.length === 0 || keys.length > 12) return undefined;
  const explicitCount = firstExplicitLineCount(contractText);
  const lineCount = explicitCount || keys.length;
  if (lineCount !== keys.length) return undefined;
  return {
    fields: keys.map((key) => ({ key, description: `value for ${key}, grounded in verified conversation and tool evidence` })),
    delimiter: '=',
    exact_non_empty_lines: lineCount,
    max_repairs: 1,
  };
}

function firstExplicitLineCount(value: string): number {
  const arabic = value.match(/(?:严格输出|exactly)\s*(\d{1,2})\s*(?:行|(?:non-empty\s+)?lines?)/i);
  if (arabic) return positiveInteger(Number(arabic[1]), 0);
  const chinese = value.match(/严格输出\s*([一二三四五六七八九十])\s*行/);
  if (!chinese) return 0;
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[chinese[1]] || 0;
}

function finalResponseRepairMessage(contract: FinalResponseContract, errors: string[]): Record<string, unknown> {
  const delimiter = contract.delimiter || '=';
  const fieldLines = contract.fields.map((field) => (
    `${field.key}${delimiter}<value>${field.description ? ` — ${field.description}` : ''}`
  ));
  return {
    role: 'system',
    content: [
      'JOI_RUNTIME_RESPONSE_CONTRACT: The preceding draft is not the final answer.',
      'Repair it using only the existing conversation and tool evidence. Do not call more tools unless evidence is missing.',
      `Return exactly ${positiveInteger(contract.exact_non_empty_lines, contract.fields.length)} non-empty lines in this order:`,
      ...fieldLines,
      'Do not add markdown, commentary, or extra lines.',
      `Validation errors: ${errors.join('; ')}`,
    ].join('\n'),
  };
}

export function parseAgentToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const object = item as Record<string, unknown>;
    const fn = object.function && typeof object.function === 'object' ? object.function as Record<string, unknown> : {};
    const id = stringValue(object.id) || `call_${calls.length + 1}`;
    const name = stringValue(fn.name);
    if (!name) continue;
    const parsed = parseArguments(fn.arguments);
    calls.push({
      id,
      name,
      arguments: parsed.arguments,
      raw_arguments: parsed.raw,
      argument_error: parsed.error,
    });
  }
  return calls;
}

export function validateToolArguments(schema: Record<string, unknown> | undefined, value: Record<string, unknown>): string[] {
  if (!schema || Object.keys(schema).length === 0) return [];
  return validateSchemaValue(schema, value, '$');
}

async function executeToolBatch(
  req: AgentKernelRequest,
  step: number,
  calls: ToolCall[],
  messages: Array<Record<string, unknown>>,
  resultCache: Map<string, ToolResult>,
): Promise<ExecutedTool[]> {
  const specs = new Map(req.tools.map((tool) => [tool.name, tool]));
  const parallel = req.tool_execution === 'parallel'
    && calls.every((call) => specs.get(call.name)?.execution_mode !== 'sequential');
  if (parallel) {
    return Promise.all(calls.map((call) => executeOneTool(req, step, call, specs.get(call.name), messages, resultCache)));
  }
  const results: ExecutedTool[] = [];
  for (const call of calls) {
    const result = await executeOneTool(req, step, call, specs.get(call.name), messages, resultCache);
    results.push(result);
    if (result.result.output?.status === 'waiting_confirmation') break;
  }
  return results;
}

async function executeOneTool(
  req: AgentKernelRequest,
  step: number,
  call: ToolCall,
  tool: ToolSpec | undefined,
  messages: Array<Record<string, unknown>>,
  resultCache: Map<string, ToolResult>,
): Promise<ExecutedTool> {
  await req.callbacks?.onToolCallRequested?.({ step, call });
  await emitKernelEvent(req.callbacks, {
    type: 'tool.requested', step, status: 'requested', tool_call_id: call.id, tool_name: call.name,
  });
  if (!tool) {
    return failedTool(req.callbacks, step, call, 'UNKNOWN_TOOL', `Tool ${call.name} is not available to this agent.`);
  }
  if (call.argument_error) {
    return failedTool(req.callbacks, step, call, 'INVALID_TOOL_ARGUMENTS', call.argument_error);
  }
  const validationErrors = validateToolArguments(tool.parameters, call.arguments);
  if (validationErrors.length > 0) {
    return failedTool(req.callbacks, step, call, 'INVALID_TOOL_ARGUMENTS', validationErrors.join('; '));
  }
  const preflight = await req.beforeToolCall?.({ step, call, tool, messages: messages.map(cloneRecord), signal: req.signal });
  if (preflight?.block) {
    return failedTool(req.callbacks, step, call, 'POLICY_DENIED', preflight.reason || `Tool ${call.name} was blocked by policy.`, 'policy_blocked');
  }

  const cacheKey = toolResultCacheKey(call);
  const cached = resultCache.get(cacheKey);
  if (cached) {
    const result = cloneToolResult(cached);
    await req.callbacks?.onToolCompleted?.({ step, call, result });
    await emitKernelEvent(req.callbacks, {
      type: 'tool.completed', step, status: 'completed', tool_call_id: call.id, tool_name: call.name, detail: { idempotent_replay: true },
    });
    return { call, result, terminate: false };
  }

  await req.callbacks?.onToolStarted?.({ step, call });
  await emitKernelEvent(req.callbacks, {
    type: 'tool.started', step, status: 'running', tool_call_id: call.id, tool_name: call.name,
  });
  let result: ToolResult;
  try {
    result = await executeWithTimeout(req.executeTool, call, tool.timeout_seconds, req.signal);
    result = normalizeToolResult(result, call);
  } catch (error) {
    if (req.signal?.aborted) throwIfAborted(req.signal);
    const err = error instanceof Error ? error : new Error(String(error));
    result = failureResult(call, 'TOOL_EXECUTION_FAILED', err.message);
  }
  let terminate = false;
  const postflight = await req.afterToolCall?.({ step, call, tool, result, messages: messages.map(cloneRecord), signal: req.signal });
  if (postflight?.result) result = normalizeToolResult(postflight.result, call);
  terminate = Boolean(postflight?.terminate);
  resultCache.set(cacheKey, cloneToolResult(result));
  await req.callbacks?.onToolOutputDelta?.({ step, call, output: result.output });

  if (result.output?.status === 'waiting_confirmation') {
    await req.callbacks?.onApprovalRequired?.({ step, call, result });
    await emitKernelEvent(req.callbacks, {
      type: 'tool.approval_required', step, status: 'waiting_confirmation', tool_call_id: call.id, tool_name: call.name,
    });
  } else if (toolResultFailed(result)) {
    await req.callbacks?.onToolFailed?.({ step, call, result });
    await emitKernelEvent(req.callbacks, {
      type: 'tool.failed', step, status: 'failed', tool_call_id: call.id, tool_name: call.name, detail: { output: result.output },
    });
  } else {
    await req.callbacks?.onToolCompleted?.({ step, call, result });
    await emitKernelEvent(req.callbacks, {
      type: 'tool.completed', step, status: 'completed', tool_call_id: call.id, tool_name: call.name,
    });
  }
  return { call, result, terminate };
}

async function failedTool(
  callbacks: ToolCallingCallbacks | undefined,
  step: number,
  call: ToolCall,
  code: string,
  message: string,
  status = 'failed',
): Promise<ExecutedTool> {
  const result = failureResult(call, code, message, status);
  await callbacks?.onToolFailed?.({ step, call, result });
  await emitKernelEvent(callbacks, {
    type: 'tool.failed', step, status, tool_call_id: call.id, tool_name: call.name, detail: { code, message },
  });
  return { call, result, terminate: false };
}

async function callModelWithRetry(
  req: AgentKernelRequest,
  modelRequest: AgentKernelModelRequest,
  maxRetries: number,
  retryBackoffMs: number,
): Promise<AgentKernelModelResponse> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(req.signal);
    try {
      return await req.callModel(modelRequest);
    } catch (error) {
      if (req.signal?.aborted) throwIfAborted(req.signal);
      const err = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxRetries || !isRetryableModelError(err)) throw err;
      const delayMs = retryBackoffMs * Math.max(1, 2 ** attempt);
      await req.callbacks?.onRetry?.({ step: modelRequest.step, attempt: attempt + 1, delay_ms: delayMs, error: err });
      await emitKernelEvent(req.callbacks, {
        type: 'model.retry',
        step: modelRequest.step,
        attempt: attempt + 1,
        status: 'retrying',
        detail: { delay_ms: delayMs, error: err.message },
      });
      await sleepWithSignal(delayMs, req.signal);
    }
  }
}

async function executeWithTimeout(
  executor: ToolExecutor,
  call: ToolCall,
  timeoutSeconds: number | undefined,
  parentSignal?: AbortSignal,
): Promise<ToolResult> {
  const seconds = positiveInteger(timeoutSeconds, 60);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Tool ${call.name} timed out after ${seconds}s`)), seconds * 1000);
  try {
    return await Promise.race([
      Promise.resolve(executor(call, { signal: controller.signal })),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          const reason = controller.signal.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason || `Tool ${call.name} aborted`)));
        }, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function completedResult(
  status: ToolCallingTurnResult['status'],
  finalMessage: string,
  toolResults: ToolResult[],
  usage: ToolCallingTurnResult['usage'],
  usageStatus: UsageStatus,
  finishReason: string,
  modelResponses: Array<Record<string, unknown>>,
  callbacks: ToolCallingCallbacks | undefined,
  step: number,
): Promise<ToolCallingTurnResult> {
  await emitKernelEvent(callbacks, { type: 'kernel.completed', step, status });
  return {
    status,
    final_message: finalMessage,
    tool_results: toolResults,
    usage,
    usage_status: usageStatus,
    finish_reason: finishReason || undefined,
    model_responses: modelResponses,
  };
}

async function shouldStop(
  req: AgentKernelRequest,
  step: number,
  messages: Array<Record<string, unknown>>,
  toolResults: ToolResult[],
  finalMessage: string,
): Promise<boolean> {
  if (!req.shouldStopAfterTurn) return false;
  return Boolean(await req.shouldStopAfterTurn({
    step,
    messages: messages.map(cloneRecord),
    tool_results: toolResults.map(cloneToolResult),
    final_message: finalMessage,
  }));
}

async function drainQueuedMessages(req: AgentKernelRequest, includeFollowUp: boolean): Promise<Array<Record<string, unknown>>> {
  const steering = req.getSteeringMessages ? await req.getSteeringMessages() : [];
  if (Array.isArray(steering) && steering.length > 0) return steering;
  if (!includeFollowUp || !req.getFollowUpMessages) return [];
  const followUp = await req.getFollowUpMessages();
  return Array.isArray(followUp) ? followUp : [];
}

function parseArguments(value: unknown): { arguments: Record<string, unknown>; raw: unknown; error?: string } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { arguments: value as Record<string, unknown>, raw: value };
  }
  if (typeof value !== 'string' || !value.trim()) return { arguments: {}, raw: value };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { arguments: {}, raw: value, error: 'Tool arguments must be a JSON object.' };
    }
    return { arguments: parsed as Record<string, unknown>, raw: value };
  } catch (error) {
    return {
      arguments: {},
      raw: value,
      error: `Tool arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateSchemaValue(schema: Record<string, unknown>, value: unknown, path: string): string[] {
  const errors: string[] = [];
  const type = stringValue(schema.type);
  if (type && !matchesJSONType(type, value)) {
    return [`${path} must be ${type}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(', ')}`);
  }
  if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, unknown>
      : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in object) || object[key] === undefined || object[key] === null || object[key] === '') {
        errors.push(`${path}.${key} is required`);
      }
    }
    for (const [key, item] of Object.entries(object)) {
      const propertySchema = properties[key];
      if (propertySchema && typeof propertySchema === 'object') {
        errors.push(...validateSchemaValue(propertySchema as Record<string, unknown>, item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  if (type === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, index) => {
      errors.push(...validateSchemaValue(schema.items as Record<string, unknown>, item, `${path}[${index}]`));
    });
  }
  return errors;
}

function matchesJSONType(type: string, value: unknown): boolean {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

function boundContext(messages: Array<Record<string, unknown>>, limitValue: number | undefined): Array<Record<string, unknown>> {
  const limit = positiveInteger(limitValue, 0);
  if (!limit || messages.length <= limit) return messages.map(cloneRecord);
  const system = messages.filter((message) => message.role === 'system');
  const conversational = messages.filter((message) => message.role !== 'system');
  const budget = Math.max(1, limit - system.length);
  let start = Math.max(0, conversational.length - budget);
  while (start > 0 && conversational[start]?.role !== 'user') start--;
  return [...system, ...conversational.slice(start)].map(cloneRecord);
}

function serializedCallArguments(call: ToolCall): string {
  if (typeof call.raw_arguments === 'string') return call.raw_arguments;
  return safeJSONStringify(call.arguments);
}

function serializeToolOutputForModel(output: Record<string, unknown>, maxBytes: number): string {
  const serialized = safeJSONStringify(output);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= maxBytes) return serialized;
  const summary = stringValue(output.summary) || stringValue(output.message) || 'Tool output truncated by Agent Kernel.';
  return JSON.stringify({
    status: output.status || 'completed',
    summary,
    truncated: true,
    original_bytes: bytes,
    max_bytes: maxBytes,
  });
}

function normalizeToolResult(result: ToolResult, call: ToolCall): ToolResult {
  const output = result?.output && typeof result.output === 'object' && !Array.isArray(result.output)
    ? result.output
    : { status: 'failed', code: 'INVALID_TOOL_RESULT', error: 'Tool executor returned an invalid result.' };
  return {
    call_id: result?.call_id || call.id,
    name: result?.name || call.name,
    arguments: result?.arguments || call.arguments,
    output,
  };
}

function failureResult(call: ToolCall, code: string, message: string, status = 'failed'): ToolResult {
  return {
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
    output: { status, code, error: message, summary: message },
  };
}

function toolResultFailed(result: ToolResult): boolean {
  const status = stringValue(result.output?.status).toLowerCase();
  return ['failed', 'error', 'policy_blocked', 'blocked', 'cancelled', 'canceled'].includes(status);
}

function toolResultCacheKey(call: ToolCall): string {
  return `${call.id}:${call.name}:${safeJSONStringify(call.arguments)}`;
}

function cloneToolResult(result: ToolResult): ToolResult {
  return {
    call_id: result.call_id,
    name: result.name,
    arguments: result.arguments ? { ...result.arguments } : undefined,
    output: { ...result.output },
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function emptyUsage(): ToolCallingTurnResult['usage'] {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };
}

function addUsage(total: ToolCallingTurnResult['usage'], value: Partial<ToolCallingTurnResult['usage']> | undefined): void {
  if (!value) return;
  total.input_tokens += finiteNumber(value.input_tokens);
  total.output_tokens += finiteNumber(value.output_tokens);
  total.cached_input_tokens += finiteNumber(value.cached_input_tokens);
  total.cache_write_input_tokens += finiteNumber(value.cache_write_input_tokens);
  total.reasoning_tokens += finiteNumber(value.reasoning_tokens);
  total.total_tokens += finiteNumber(value.total_tokens) || finiteNumber(value.input_tokens) + finiteNumber(value.output_tokens);
}

function usageStatusFor(value: Partial<ToolCallingTurnResult['usage']> | undefined): UsageStatus {
  if (!value) return 'provider_missing';
  return Object.values(value).some((item) => finiteNumber(item) > 0) ? 'recorded' : 'provider_missing';
}

function mergeUsageStatus(current: UsageStatus, next: UsageStatus): UsageStatus {
  if (current === 'recorded' || next === 'recorded') return 'recorded';
  if (current === 'estimated' || next === 'estimated') return 'estimated';
  if (current === 'failed' || next === 'failed') return 'failed';
  return 'provider_missing';
}

function isRetryableModelError(error: Error): boolean {
  if (error instanceof AgentModelTransportError) return error.retryable;
  const status = Number((error as Error & { status?: number }).status || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /timeout|timed out|fetch failed|network|econnreset|econnrefused|socket hang up|temporar/i.test(error.message);
}

async function emitKernelEvent(callbacks: ToolCallingCallbacks | undefined, event: AgentKernelEvent): Promise<void> {
  await callbacks?.onEvent?.(event);
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ status: 'failed', code: 'NON_SERIALIZABLE_VALUE', summary: 'Value could not be serialized.' });
  }
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function finiteNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(String(signal.reason || 'agent kernel aborted'));
}

function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason || 'agent kernel aborted')));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
