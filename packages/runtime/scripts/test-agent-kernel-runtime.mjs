import assert from 'node:assert/strict';
import {
  AgentModelTransportError,
  inferFinalResponseContract,
  runAgentKernel,
  validateFinalResponseContract,
  validateToolArguments,
} from '../src/agent-kernel.ts';

function response(message, usage = {}) {
  return {
    message,
    usage,
    usage_status: Object.keys(usage).length ? 'recorded' : 'provider_missing',
    raw: { choices: [{ message }], usage },
  };
}

function toolCall(id, name, args) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
  };
}

const echoTool = {
  name: 'echo',
  description: 'Echo text',
  execution_mode: 'parallel',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
};

{
  const expectedContract = {
    fields: [
      { key: 'ROOT_CAUSE', description: 'value for ROOT_CAUSE, grounded in verified conversation and tool evidence' },
      { key: 'ACTION', description: 'value for ACTION, grounded in verified conversation and tool evidence' },
    ],
    delimiter: '=',
    exact_non_empty_lines: 2,
    max_repairs: 1,
  };
  assert.deepEqual(inferFinalResponseContract([
    { role: 'user', content: 'Earlier unrelated GPT and API discussion.' },
    { role: 'user', content: '最终严格输出 2 行 ROOT_CAUSE、ACTION。' },
  ]), expectedContract);
  assert.equal(inferFinalResponseContract([
    { role: 'user', content: '最终严格输出 1 行 RESULT=4。' },
    { role: 'assistant', content: 'RESULT=4' },
    { role: 'user', content: '你能生成图片么？' },
  ]), undefined);
  assert.equal(inferFinalResponseContract([{ role: 'user', content: '普通回答即可' }]), undefined);
}

{
  const contract = {
    fields: [{ key: 'ROOT_CAUSE' }, { key: 'ACTION' }],
    delimiter: '=',
    exact_non_empty_lines: 2,
  };
  assert.equal(validateFinalResponseContract('ROOT_CAUSE=x\nACTION=y', contract).valid, true);
  assert.equal(validateFinalResponseContract('ROOT_CAUSE: x\nACTION: y', contract).valid, false);
}

{
  let calls = 0;
  const events = [];
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'contract' }],
    tools: [],
    final_response_contract: {
      fields: [{ key: 'ROOT_CAUSE', description: 'verified cause' }, { key: 'ACTION', description: 'safe action' }],
      delimiter: '=',
      exact_non_empty_lines: 2,
      max_repairs: 1,
    },
    executeTool() { throw new Error('unused'); },
    callbacks: { onEvent(event) { events.push(event); } },
    async callModel(request) {
      calls += 1;
      if (calls === 1) return response({ role: 'assistant', content: 'ROOT_CAUSE: x\nACTION: y' });
      assert.match(String(request.messages.at(-1).content), /JOI_RUNTIME_RESPONSE_CONTRACT/);
      return response({ role: 'assistant', content: 'ROOT_CAUSE=x\nACTION=y' });
    },
  });
  assert.equal(result.final_message, 'ROOT_CAUSE=x\nACTION=y');
  assert.equal(calls, 2);
  assert.ok(events.some((event) => event.type === 'response.contract_rejected'));
  assert.ok(events.some((event) => event.type === 'response.contract_passed'));
}

{
  assert.deepEqual(validateToolArguments(echoTool.parameters, { text: 'ok' }), []);
  assert.match(validateToolArguments(echoTool.parameters, {})[0], /text is required/);
  assert.match(validateToolArguments(echoTool.parameters, { text: 1 })[0], /must be string/);
  assert.match(validateToolArguments(echoTool.parameters, { text: 'ok', extra: true })[0], /not allowed/);
}

{
  let calls = 0;
  let executions = 0;
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'invalid json' }],
    tools: [echoTool],
    executeTool() {
      executions++;
      throw new Error('must not execute');
    },
    async callModel() {
      calls++;
      return calls === 1
        ? response(toolCall('invalid', 'echo', '{"text":'))
        : response({ role: 'assistant', content: 'recovered' });
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.final_message, 'recovered');
  assert.equal(executions, 0);
  assert.equal(result.tool_results[0].output.code, 'INVALID_TOOL_ARGUMENTS');
}

{
  let calls = 0;
  const retryEvents = [];
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'retry' }],
    tools: [],
    executeTool() {
      throw new Error('unused');
    },
    max_retries: 1,
    retry_backoff_ms: 0,
    callbacks: {
      onRetry(event) {
        retryEvents.push(event);
      },
    },
    async callModel() {
      calls++;
      if (calls === 1) throw new AgentModelTransportError('rate limited', { status: 429, retryable: true });
      return response({ role: 'assistant', content: 'retried' }, { input_tokens: 2, output_tokens: 1, total_tokens: 3 });
    },
  });
  assert.equal(result.final_message, 'retried');
  assert.equal(calls, 2);
  assert.equal(retryEvents.length, 1);
  assert.equal(result.usage.total_tokens, 3);
}

{
  let modelCalls = 0;
  let active = 0;
  let maxActive = 0;
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'parallel' }],
    tools: [echoTool],
    tool_execution: 'parallel',
    async executeTool(call) {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { call_id: call.id, name: call.name, output: { status: 'completed', text: call.arguments.text } };
    },
    async callModel() {
      modelCalls++;
      return modelCalls === 1
        ? response({
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'a', type: 'function', function: { name: 'echo', arguments: '{"text":"a"}' } },
            { id: 'b', type: 'function', function: { name: 'echo', arguments: '{"text":"b"}' } },
          ],
        })
        : response({ role: 'assistant', content: 'parallel done' });
    },
  });
  assert.equal(result.final_message, 'parallel done');
  assert.equal(maxActive, 2);
  assert.deepEqual(result.tool_results.map((item) => item.call_id), ['a', 'b']);
}

{
  let modelCalls = 0;
  let executions = 0;
  const seenToolMessages = [];
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'idempotent' }],
    tools: [echoTool],
    tool_execution: 'parallel',
    max_tool_result_bytes: 80,
    executeTool(call) {
      executions++;
      return {
        call_id: call.id,
        name: call.name,
        output: { status: 'completed', summary: 'large output', data: 'x'.repeat(500) },
      };
    },
    async callModel(request) {
      modelCalls++;
      const latestTool = [...request.messages].reverse().find((message) => message.role === 'tool');
      if (latestTool) seenToolMessages.push(String(latestTool.content));
      if (modelCalls < 3) return response(toolCall('same', 'echo', '{"text":"same"}'));
      return response({ role: 'assistant', content: 'cached' });
    },
  });
  assert.equal(result.final_message, 'cached');
  assert.equal(executions, 1);
  assert.equal(result.tool_results.length, 2);
  assert.ok(seenToolMessages.some((content) => content.includes('"truncated":true')));
}

{
  let modelCalls = 0;
  let followUpDrained = false;
  let transformCalls = 0;
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new' },
    ],
    tools: [],
    max_context_messages: 3,
    transformMessages(messages) {
      transformCalls++;
      return messages;
    },
    executeTool() {
      throw new Error('unused');
    },
    getFollowUpMessages() {
      if (followUpDrained) return [];
      followUpDrained = true;
      return [{ role: 'user', content: 'follow up' }];
    },
    async callModel(request) {
      modelCalls++;
      if (modelCalls === 2) assert.equal(request.messages.at(-1).content, 'follow up');
      return response({ role: 'assistant', content: modelCalls === 1 ? 'first' : 'second' });
    },
  });
  assert.equal(result.final_message, 'second');
  assert.equal(modelCalls, 2);
  assert.equal(transformCalls, 2);
}

{
  let modelCalls = 0;
  let steeringDrained = false;
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'steer' }],
    tools: [echoTool],
    executeTool(call) {
      return { call_id: call.id, name: call.name, output: { status: 'completed' } };
    },
    getSteeringMessages() {
      if (steeringDrained) return [];
      steeringDrained = true;
      return [{ role: 'user', content: 'steering message' }];
    },
    async callModel(request) {
      modelCalls++;
      if (modelCalls === 1) return response(toolCall('steer-tool', 'echo', '{"text":"go"}'));
      assert.equal(request.messages.at(-1).content, 'steering message');
      return response({ role: 'assistant', content: 'steered' });
    },
  });
  assert.equal(result.final_message, 'steered');
}

{
  let calls = 0;
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'tool throws' }],
    tools: [echoTool],
    executeTool() {
      throw new Error('executor exploded');
    },
    async callModel() {
      calls++;
      return calls === 1
        ? response(toolCall('throwing', 'echo', '{"text":"x"}'))
        : response({ role: 'assistant', content: 'handled' });
    },
  });
  assert.equal(result.final_message, 'handled');
  assert.equal(result.tool_results[0].output.code, 'TOOL_EXECUTION_FAILED');
}

{
  const result = await runAgentKernel({
    model: 'kernel-test',
    messages: [{ role: 'user', content: 'max steps' }],
    tools: [echoTool],
    max_steps: 1,
    executeTool(call) {
      return { call_id: call.id, name: call.name, output: { status: 'completed' } };
    },
    async callModel() {
      return response(toolCall('limit', 'echo', '{"text":"x"}'));
    },
  });
  assert.equal(result.status, 'max_steps_exceeded');
  assert.ok(result.final_message.length > 0);
}

console.log('agent kernel runtime tests passed');
