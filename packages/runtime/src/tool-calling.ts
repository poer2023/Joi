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
};

export type ToolCallingTurnResult = {
  status: 'completed' | 'waiting_confirmation' | 'max_steps_exceeded';
  final_message: string;
  tool_results: ToolResult[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  };
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
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(req.signal);
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
    const body = await response.text();
    if (!response.ok) throw new Error(`chat completion returned ${response.status} ${response.statusText}: ${body.slice(0, 2000)}`);
    const parsed = req.stream ? parseChatCompletionsSSE(body) : JSON.parse(body) as Record<string, unknown>;
    modelResponses.push(parsed);
    addUsage(usage, parsed.usage);
    const message = firstChoiceMessage(parsed);
    const toolCalls = parseToolCalls(message.tool_calls);
    if (toolCalls.length === 0) {
      return {
        status: 'completed',
        final_message: stringValue(message.content),
        tool_results: toolResults,
        usage,
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
      const result = await req.executeTool(call, { signal: req.signal });
      toolResults.push(result);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(result.output),
      });
      if (result.output?.status === 'waiting_confirmation') {
        return {
          status: 'waiting_confirmation',
          final_message: stringValue(result.output.message) || 'confirmation_required: tool execution requires approval before it can continue.',
          tool_results: toolResults,
          usage,
          model_responses: modelResponses,
        };
      }
    }
  }
  return {
    status: 'max_steps_exceeded',
    final_message: '',
    tool_results: toolResults,
    usage,
    model_responses: modelResponses,
  };
}

export function parseChatCompletionsSSE(raw: string): Record<string, unknown> {
  let content = '';
  const toolCalls = new Map<number, { id: string; name: string; arguments: string; type: string }>();
  let usage: unknown = undefined;
  for (const item of sseDataItems(raw)) {
    if (item === '[DONE]') break;
    const payload = JSON.parse(item) as Record<string, unknown>;
    if (payload.usage) usage = payload.usage;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== 'object') continue;
      const object = delta as Record<string, unknown>;
      content += stringValue(object.content);
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
    }],
    usage: usage || {},
    stream: true,
  };
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

function addUsage(total: ToolCallingTurnResult['usage'], value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const usage = value as Record<string, unknown>;
  total.input_tokens += numberValue(usage.prompt_tokens) || numberValue(usage.input_tokens);
  total.output_tokens += numberValue(usage.completion_tokens) || numberValue(usage.output_tokens);
  total.cached_input_tokens += numberValue(usage.cached_tokens) || numberValue(usage.cached_input_tokens);
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
