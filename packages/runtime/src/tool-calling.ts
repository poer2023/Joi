import { openAICompatibleChatCompletionsEndpoint } from './model.ts';
import {
  AgentModelTransportError,
  runAgentKernel,
  type AgentKernelEvent,
  type AgentKernelRequest,
} from './agent-kernel.ts';

export type ToolSpec = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execution_mode?: 'sequential' | 'parallel';
  timeout_seconds?: number;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  raw_arguments?: unknown;
  argument_error?: string;
  metadata?: Record<string, unknown>;
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
  onRetry?: (event: { step: number; attempt: number; delay_ms: number; error: Error }) => void | Promise<void>;
  onEvent?: (event: AgentKernelEvent) => void | Promise<void>;
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
  max_retries?: number;
  retry_backoff_ms?: number;
  stream?: boolean;
  reasoning_effort?: string;
  tool_execution?: 'sequential' | 'parallel';
  max_context_messages?: number;
  max_tool_result_bytes?: number;
  final_response_contract?: AgentKernelRequest['final_response_contract'];
  signal?: AbortSignal;
  callbacks?: ToolCallingCallbacks;
  transformMessages?: AgentKernelRequest['transformMessages'];
  beforeToolCall?: AgentKernelRequest['beforeToolCall'];
  afterToolCall?: AgentKernelRequest['afterToolCall'];
  shouldStopAfterTurn?: AgentKernelRequest['shouldStopAfterTurn'];
  getSteeringMessages?: AgentKernelRequest['getSteeringMessages'];
  getFollowUpMessages?: AgentKernelRequest['getFollowUpMessages'];
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
  const callbacks = committedAnswerCallbacks(req.callbacks);
  return runAgentKernel({
    model: req.model,
    streaming: Boolean(req.stream),
    messages: req.messages,
    tools: req.tools,
    executeTool: req.executeTool,
    max_steps: req.max_steps,
    max_retries: req.max_retries,
    retry_backoff_ms: req.retry_backoff_ms,
    tool_execution: req.tool_execution,
    max_context_messages: req.max_context_messages,
    max_tool_result_bytes: req.max_tool_result_bytes,
    final_response_contract: req.final_response_contract,
    signal: req.signal,
    callbacks,
    transformMessages: req.transformMessages,
    beforeToolCall: req.beforeToolCall,
    afterToolCall: req.afterToolCall,
    shouldStopAfterTurn: req.shouldStopAfterTurn,
    getSteeringMessages: req.getSteeringMessages,
    getFollowUpMessages: req.getFollowUpMessages,
    callModel: async ({ messages, tools, step, signal }) => {
      const providerTools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {}, additionalProperties: true },
        },
      }));
      const payload = {
        model: req.model,
        messages,
        tools: providerTools,
        tool_choice: providerTools.length > 0 ? 'auto' : undefined,
        stream: Boolean(req.stream),
        stream_options: req.stream ? { include_usage: true } : undefined,
        reasoning_effort: normalizeReasoningEffort(req.reasoning_effort),
      };
      const response = await fetchWithTimeout(openAICompatibleChatCompletionsEndpoint(req.base_url), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.api_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }, positiveInteger(req.timeout_seconds, 30), signal);
      if (!response.ok) {
        const body = await response.text();
        throw new AgentModelTransportError(
          `chat completion returned ${response.status} ${response.statusText}: ${body.slice(0, 2000)}`,
          { status: response.status, retryable: retryableHTTPStatus(response.status) },
        );
      }
      const parsed = req.stream
        ? await parseChatCompletionsSSEResponse(response, callbacks, step, signal)
        : JSON.parse(await response.text()) as Record<string, unknown>;
      return {
        message: firstChoiceMessage(parsed),
        usage: normalizedUsage(parsed.usage),
        usage_status: usageStatusFromPayload(parsed.usage),
        finish_reason: finishReasonFromPayload(parsed) || undefined,
        raw: parsed,
      };
    },
  });
}

export function committedAnswerCallbacks(
  callbacks: ToolCallingCallbacks | undefined,
): ToolCallingCallbacks | undefined {
  if (!callbacks) return callbacks;
  return {
    ...callbacks,
    // Provider deltas can belong to a tool-call preamble, a rejected response-
    // contract attempt, or text that the runtime later normalizes. Keep those
    // deltas in model Trace and publish only the answer committed by the kernel.
    onAssistantDelta() {},
    onAssistantCompleted(event) {
      if (event.text) callbacks.onAssistantDelta?.({ step: event.step, text: event.text, index: 0 });
      callbacks.onAssistantCompleted?.(event);
    },
  };
}

export function responseContractSafeCallbacks(
  callbacks: ToolCallingCallbacks | undefined,
  enabled: boolean,
): ToolCallingCallbacks | undefined {
  return enabled ? committedAnswerCallbacks(callbacks) : callbacks;
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
  let deltaIndex = 0;
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
        if (callbacks) deltaIndex = emitSSECallbacks(item, callbacks, step, deltaIndex);
      }
    }
    if (buffer) {
      raw += buffer;
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const item = line.slice('data:'.length).trim();
        if (!item || item === '[DONE]') continue;
        if (callbacks) deltaIndex = emitSSECallbacks(item, callbacks, step, deltaIndex);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return parseChatCompletionsSSE(raw);
}

function emitSSECallbacks(item: string, callbacks: ToolCallingCallbacks, step: number, deltaIndex: number): number {
  const payload = JSON.parse(item) as Record<string, unknown>;
  callbacks.onModelDelta?.({ step, payload });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const delta = (choice as Record<string, unknown>).delta;
    if (!delta || typeof delta !== 'object') continue;
    const text = stringValue((delta as Record<string, unknown>).content);
    if (text) callbacks.onAssistantDelta?.({ step, text, index: deltaIndex++ });
  }
  return deltaIndex;
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

function normalizedUsage(value: unknown): ToolCallingTurnResult['usage'] {
  const total: ToolCallingTurnResult['usage'] = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };
  if (!value || typeof value !== 'object') return total;
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
  return total;
}

function usageStatusFromPayload(value: unknown): UsageStatus {
  const usage = normalizedUsage(value);
  return Object.values(usage).some((item) => item > 0) ? 'recorded' : 'provider_missing';
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

function retryableHTTPStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
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

function normalizeReasoningEffort(value: unknown): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : undefined;
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
