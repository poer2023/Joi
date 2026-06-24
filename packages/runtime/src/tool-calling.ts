import { openAICompatibleChatCompletionsEndpoint } from './model.ts';

export type ToolSpec = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  call_id: string;
  name: string;
  arguments?: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type ToolExecutor = (call: ToolCall, options?: { signal?: AbortSignal }) => Promise<ToolResult> | ToolResult;

export type ToolCallingCallbacks = {
  onModelStarted?: (event: { step: number; model: string; streaming: boolean }) => void;
  onModelDelta?: (event: { step: number; payload: Record<string, unknown> }) => void;
  onModelCompleted?: (event: { step: number; finish_reason?: string; usage_status: UsageStatus }) => void;
  onAssistantDelta?: (event: { step: number; text: string; index: number }) => void;
  onAssistantCompleted?: (event: { step: number; text: string; finish_reason?: string; usage_status: UsageStatus }) => void;
  onToolCallRequested?: (event: { step: number; call: ToolCall }) => void;
  onToolStarted?: (event: { step: number; call: ToolCall }) => void;
  onToolOutputDelta?: (event: { step: number; call: ToolCall; output: Record<string, unknown> }) => void;
  onToolCompleted?: (event: { step: number; call: ToolCall; result: ToolResult }) => void;
  onToolFailed?: (event: { step: number; call: ToolCall; result?: ToolResult; error?: Error }) => void;
  onApprovalRequired?: (event: { step: number; call: ToolCall; result: ToolResult }) => void;
  onUsage?: (event: { step: number; usage: ToolCallingTurnResult['usage']; usage_status: UsageStatus }) => void;
  onError?: (event: { step: number; error: Error }) => void;
};

export type UsageStatus = 'recorded' | 'provider_missing' | 'estimated' | 'failed';

export type ToolCallingTurnRequest = {
  base_url: string;
  api_key: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  timeout_seconds?: number;
  max_steps?: number;
  stream?: boolean;
  signal?: AbortSignal;
  callbacks?: ToolCallingCallbacks;
};

export type ToolCallingTurnResult = {
  status: 'completed' | 'waiting_confirmation' | 'max_steps_exceeded';
  final_message: string;
  tool_results: ToolResult[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_write_input_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
  };
  usage_status: UsageStatus;
  finish_reason?: string;
  model_responses: Array<Record<string, unknown>>;
};

export async function runChatCompletionsToolTurn(req: ToolCallingTurnRequest): Promise<ToolCallingTurnResult> {
  const maxSteps = positiveInteger(req.max_steps, 6);
  const messages = req.messages.map((message) => ({ ...message }));
  const tools = req.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {}, additionalProperties: true },
    },
  }));
  const toolResults: ToolResult[] = [];
  const modelResponses: Array<Record<string, unknown>> = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };
  let usageStatus: UsageStatus = 'provider_missing';
  let finishReason = '';
  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(req.signal);
    req.callbacks?.onModelStarted?.({ step, model: req.model, streaming: Boolean(req.stream) });
    const payload = {
      model: req.model,
      messages,
      tools,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: Boolean(req.stream),
    };
    const response = await fetchWithTimeout(openAICompatibleChatCompletionsEndpoint(req.base_url), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.api_key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, positiveInteger(req.timeout_seconds, 30), req.signal);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`chat completion returned ${response.status} ${response.statusText}: ${body.slice(0, 2000)}`);
    }
    const parsed = req.stream
      ? await parseChatCompletionsSSEResponse(response, req.callbacks, step, req.signal)
      : JSON.parse(await response.text()) as Record<string, unknown>;
    modelResponses.push(parsed);
    const stepUsageStatus = addUsage(usage, parsed.usage);
    usageStatus = mergeUsageStatus(usageStatus, stepUsageStatus);
    finishReason = finishReasonFromPayload(parsed) || finishReason;
    req.callbacks?.onUsage?.({ step, usage: { ...usage }, usage_status: stepUsageStatus });
    req.callbacks?.onModelCompleted?.({ step, finish_reason: finishReason || undefined, usage_status: stepUsageStatus });
    const message = firstChoiceMessage(parsed);
    const toolCalls = parseToolCalls(message.tool_calls);
    if (toolCalls.length === 0) {
      req.callbacks?.onAssistantCompleted?.({
        step,
        text: stringValue(message.content),
        finish_reason: finishReason || undefined,
        usage_status: stepUsageStatus,
      });
      return {
        status: 'completed',
        final_message: stringValue(message.content),
        tool_results: toolResults,
        usage,
        usage_status: usageStatus,
        finish_reason: finishReason || undefined,
        model_responses: modelResponses,
      };
    }
    messages.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    });
    for (const call of toolCalls) {
      throwIfAborted(req.signal);
      req.callbacks?.onToolCallRequested?.({ step, call });
      let result: ToolResult;
      try {
        result = await req.executeTool(call, { signal: req.signal });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        req.callbacks?.onToolFailed?.({ step, call, error: err });
        throw err;
      }
      toolResults.push(result);
      req.callbacks?.onToolOutputDelta?.({ step, call, output: result.output });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(result.output),
      });
      if (result.output?.status === 'waiting_confirmation') {
        req.callbacks?.onApprovalRequired?.({ step, call, result });
        return {
          status: 'waiting_confirmation',
          final_message: stringValue(result.output.message) || '这个受控能力需要你确认后才会执行。',
          tool_results: toolResults,
          usage,
          usage_status: usageStatus,
          finish_reason: finishReason || undefined,
          model_responses: modelResponses,
        };
      }
      req.callbacks?.onToolStarted?.({ step, call });
      if (toolResultFailed(result)) {
        req.callbacks?.onToolFailed?.({ step, call, result });
      } else {
        req.callbacks?.onToolCompleted?.({ step, call, result });
      }
    }
  }
  return {
    status: 'max_steps_exceeded',
    final_message: '',
    tool_results: toolResults,
    usage,
    usage_status: usageStatus,
    finish_reason: finishReason || undefined,
    model_responses: modelResponses,
  };
}

export function parseChatCompletionsSSE(raw: string, callbacks?: ToolCallingCallbacks, step = 0): Record<string, unknown> {
  let content = '';
  const toolCalls = new Map<number, { id: string; name: string; arguments: string; type: string }>();
  let usage: unknown = undefined;
  let finishReason = '';
  let deltaIndex = 0;
  for (const item of sseDataItems(raw)) {
    if (item === '[DONE]') break;
    const payload = JSON.parse(item) as Record<string, unknown>;
    callbacks?.onModelDelta?.({ step, payload });
    if (payload.usage) usage = payload.usage;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      finishReason = stringValue((choice as Record<string, unknown>).finish_reason) || finishReason;
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== 'object') continue;
      const object = delta as Record<string, unknown>;
      const text = stringValue(object.content);
      if (text) {
        content += text;
        callbacks?.onAssistantDelta?.({ step, text, index: deltaIndex++ });
      }
      const deltaToolCalls = Array.isArray(object.tool_calls) ? object.tool_calls : [];
      for (const call of deltaToolCalls) {
        if (!call || typeof call !== 'object') continue;
        const callObject = call as Record<string, unknown>;
        const index = numberValue(callObject.index);
        const fn = callObject.function && typeof callObject.function === 'object'
          ? callObject.function as Record<string, unknown>
          : {};
        const previous = toolCalls.get(index) || { id: '', name: '', arguments: '', type: 'function' };
        previous.id = stringValue(callObject.id) || previous.id;
        previous.type = stringValue(callObject.type) || previous.type;
        previous.name += stringValue(fn.name);
        previous.arguments += stringValue(fn.arguments);
        toolCalls.set(index, previous);
      }
    }
  }
  const messageToolCalls = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], index) => ({
      id: call.id || `call_${index + 1}`,
      type: call.type || 'function',
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    }));
  return {
    choices: [{
      message: {
        role: 'assistant',
        content,
        tool_calls: messageToolCalls,
      },
      finish_reason: finishReason || undefined,
    }],
    usage: usage || {},
    stream: true,
  };
}

async function parseChatCompletionsSSEResponse(
  response: Response,
  callbacks: ToolCallingCallbacks | undefined,
  step: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!response.body) {
    return parseChatCompletionsSSE(await response.text(), callbacks, step);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let buffer = '';
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      raw += lines.map((line) => `${line}\n`).join('');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const item = line.slice('data:'.length).trim();
        if (!item || item === '[DONE]') continue;
        callbacks && emitSSECallbacks(item, callbacks, step);
      }
    }
    if (buffer) {
      raw += buffer;
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const item = line.slice('data:'.length).trim();
        if (!item || item === '[DONE]') continue;
        callbacks && emitSSECallbacks(item, callbacks, step);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return parseChatCompletionsSSE(raw);
}

function emitSSECallbacks(item: string, callbacks: ToolCallingCallbacks, step: number): void {
  const payload = JSON.parse(item) as Record<string, unknown>;
  callbacks.onModelDelta?.({ step, payload });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const delta = (choice as Record<string, unknown>).delta;
    if (!delta || typeof delta !== 'object') continue;
    const text = stringValue((delta as Record<string, unknown>).content);
    if (text) callbacks.onAssistantDelta?.({ step, text, index: 0 });
  }
}

function sseDataItems(raw: string): string[] {
  const items: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const item = line.slice('data:'.length).trim();
    if (item) items.push(item);
  }
  return items;
}

function firstChoiceMessage(payload: Record<string, unknown>): Record<string, unknown> {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== 'object') return {};
  const message = (first as Record<string, unknown>).message;
  return message && typeof message === 'object' ? message as Record<string, unknown> : {};
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const object = item as Record<string, unknown>;
    const fn = object.function && typeof object.function === 'object' ? object.function as Record<string, unknown> : {};
    const id = stringValue(object.id) || `call_${calls.length + 1}`;
    const name = stringValue(fn.name);
    if (!name) continue;
    calls.push({
      id,
      name,
      arguments: parseArguments(fn.arguments),
    });
  }
  return calls;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function addUsage(total: ToolCallingTurnResult['usage'], value: unknown): UsageStatus {
  if (!value || typeof value !== 'object') return 'provider_missing';
  const usage = value as Record<string, unknown>;
  const promptDetails = objectValue(usage.prompt_tokens_details) || objectValue(usage.input_tokens_details);
  const completionDetails = objectValue(usage.completion_tokens_details) || objectValue(usage.output_tokens_details);
  const inputTokens = numberValue(usage.prompt_tokens) || numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.completion_tokens) || numberValue(usage.output_tokens);
  const cachedInputTokens = numberValue(usage.cached_tokens)
    || numberValue(usage.cached_input_tokens)
    || numberValue(usage.cache_read_input_tokens)
    || numberValue(promptDetails?.cached_tokens);
  const cacheWriteInputTokens = numberValue(usage.cache_write_input_tokens)
    || numberValue(usage.cache_creation_input_tokens)
    || numberValue(promptDetails?.cache_write_tokens)
    || numberValue(promptDetails?.cache_creation_tokens)
    || numberValue(promptDetails?.cache_creation_input_tokens);
  const reasoningTokens = numberValue(usage.reasoning_tokens)
    || numberValue(usage.reasoning_output_tokens)
    || numberValue(completionDetails?.reasoning_tokens);
  const totalTokens = numberValue(usage.total_tokens)
    || numberValue(usage.totalTokens)
    || inputTokens + outputTokens;
  total.input_tokens += inputTokens;
  total.output_tokens += outputTokens;
  total.cached_input_tokens += cachedInputTokens;
  total.cache_write_input_tokens += cacheWriteInputTokens;
  total.reasoning_tokens += reasoningTokens;
  total.total_tokens += totalTokens;
  return inputTokens > 0
    || outputTokens > 0
    || cachedInputTokens > 0
    || cacheWriteInputTokens > 0
    || reasoningTokens > 0
    || totalTokens > 0
    ? 'recorded'
    : 'provider_missing';
}

function mergeUsageStatus(current: UsageStatus, next: UsageStatus): UsageStatus {
  if (current === 'recorded' || next === 'recorded') return 'recorded';
  if (current === 'estimated' || next === 'estimated') return 'estimated';
  if (current === 'failed' || next === 'failed') return 'failed';
  return 'provider_missing';
}

function finishReasonFromPayload(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const finishReason = stringValue((choice as Record<string, unknown>).finish_reason);
    if (finishReason) return finishReason;
  }
  return '';
}

function toolResultFailed(result: ToolResult): boolean {
  const status = stringValue(result.output?.status).toLowerCase();
  return ['failed', 'error', 'policy_blocked', 'blocked', 'cancelled', 'canceled'].includes(status);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('chat completion request timed out')), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(String(signal.reason || 'tool calling turn aborted'));
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
