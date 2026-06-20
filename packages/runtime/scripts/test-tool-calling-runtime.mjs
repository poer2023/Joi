import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseChatCompletionsSSE, runChatCompletionsToolTurn } from '../src/tool-calling.ts';

const requests = [];
const streamRequests = [];
const waitingRequests = [];
const abortRequests = [];
const server = createServer((req, res) => {
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body);
    if (payload.stream) {
      streamRequests.push(payload);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (streamRequests.length === 1) {
        res.end([
          sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_stream_workspace', type: 'function', function: { name: 'workspace_search', arguments: '{"query"' } }] } }] }),
          sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"Run Trace","root":"."}' } }] } }] }),
          sse({ usage: { prompt_tokens: 8, completion_tokens: 4 } }),
          '',
          'data: [DONE]',
          '',
        ].join('\n'));
        return;
      }
      assert.equal(payload.messages.at(-1).role, 'tool');
      res.end([
        sse({ choices: [{ delta: { content: 'Streamed ' } }] }),
        sse({ choices: [{ delta: { content: 'answer.' } }] }),
        sse({ usage: { prompt_tokens: 13, completion_tokens: 5, cached_input_tokens: 2 } }),
        '',
        'data: [DONE]',
        '',
      ].join('\n'));
      return;
    }
    if (payload.model === 'abort-tool-model') {
      abortRequests.push(payload);
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'too late' } }] }));
      }, 250);
      return;
    }
    if (payload.model === 'waiting-tool-model') {
      waitingRequests.push(payload);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_apply_patch_waiting',
              type: 'function',
              function: {
                name: 'apply_patch',
                arguments: JSON.stringify({ patch: '*** Begin Patch\n*** End Patch\n', reason: 'test approval' }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }));
      return;
    }
    requests.push(payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (requests.length === 1) {
      assert.equal(payload.tools[0].function.name, 'workspace_search');
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_workspace',
              type: 'function',
              function: {
                name: 'workspace_search',
                arguments: JSON.stringify({ query: 'Run Trace', root: '.' }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }));
      return;
    }
    assert.equal(payload.messages.at(-1).role, 'tool');
    assert.equal(payload.messages.at(-1).tool_call_id, 'call_workspace');
    assert.ok(payload.messages.at(-1).content.includes('Run Trace evidence'));
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Run Trace evidence found.' } }],
      usage: { prompt_tokens: 15, completion_tokens: 6, cached_input_tokens: 4 },
    }));
  });
});

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n`;
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const parsedSSE = parseChatCompletionsSSE([
    'data: {"choices":[{"delta":{"content":"hello "}}]}',
    'data: {"choices":[{"delta":{"content":"world"}}]}',
    'data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}',
    'data: [DONE]',
  ].join('\n'));
  assert.equal(parsedSSE.choices[0].message.content, 'hello world');
  assert.equal(parsedSSE.usage.prompt_tokens, 1);

  const result = await runChatCompletionsToolTurn({
    base_url: `http://127.0.0.1:${port}/v1`,
    api_key: 'sk-test',
    model: 'tool-model',
    messages: [{ role: 'user', content: 'Find Run Trace docs.' }],
    tools: [{
      name: 'workspace_search',
      description: 'Search workspace',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }],
    async executeTool(call) {
      assert.equal(call.id, 'call_workspace');
      assert.equal(call.name, 'workspace_search');
      assert.equal(call.arguments.query, 'Run Trace');
      return {
        call_id: call.id,
        name: call.name,
        output: { status: 'completed', summary: 'Run Trace evidence', results: [{ path: 'docs/run-trace.md' }] },
      };
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.final_message, 'Run Trace evidence found.');
  assert.equal(result.tool_results.length, 1);
  assert.equal(result.usage.input_tokens, 25);
  assert.equal(result.usage.output_tokens, 9);
  assert.equal(result.usage.cached_input_tokens, 4);
  assert.equal(requests.length, 2);

  const streamed = await runChatCompletionsToolTurn({
    base_url: `http://127.0.0.1:${port}/v1`,
    api_key: 'sk-test',
    model: 'tool-model',
    messages: [{ role: 'user', content: 'Stream a Run Trace search.' }],
    stream: true,
    tools: [{
      name: 'workspace_search',
      description: 'Search workspace',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }],
    executeTool(call) {
      assert.equal(call.id, 'call_stream_workspace');
      assert.equal(call.arguments.query, 'Run Trace');
      return {
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
        output: { status: 'completed', summary: 'streamed tool output' },
      };
    },
  });
  assert.equal(streamed.status, 'completed');
  assert.equal(streamed.final_message, 'Streamed answer.');
  assert.equal(streamed.tool_results.length, 1);
  assert.equal(streamed.usage.input_tokens, 21);
  assert.equal(streamed.usage.output_tokens, 9);
  assert.equal(streamed.usage.cached_input_tokens, 2);
  assert.equal(streamRequests.length, 2);

  const waiting = await runChatCompletionsToolTurn({
    base_url: `http://127.0.0.1:${port}/v1`,
    api_key: 'sk-test',
    model: 'waiting-tool-model',
    messages: [{ role: 'user', content: 'Patch a file.' }],
    tools: [{ name: 'apply_patch', description: 'Patch workspace' }],
    executeTool(call) {
      assert.equal(call.id, 'call_apply_patch_waiting');
      assert.equal(call.name, 'apply_patch');
      return {
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
        output: {
          status: 'waiting_confirmation',
          message: 'confirmation_required: workspace write requires approval before execution',
          capability: 'apply_patch',
          risk: 'workspace_write',
        },
      };
    },
  });
  assert.equal(waiting.status, 'waiting_confirmation');
  assert.equal(waiting.final_message, 'confirmation_required: workspace write requires approval before execution');
  assert.equal(waiting.tool_results.length, 1);
  assert.equal(waiting.usage.input_tokens, 4);
  assert.equal(waitingRequests.length, 1);

  const controller = new AbortController();
  const aborted = runChatCompletionsToolTurn({
    base_url: `http://127.0.0.1:${port}/v1`,
    api_key: 'sk-test',
    model: 'abort-tool-model',
    messages: [{ role: 'user', content: 'Cancel this request.' }],
    tools: [],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error('test abort')), 25);
  await assert.rejects(aborted, /test abort|aborted/);
  assert.equal(abortRequests.length, 1);

  console.log('tool-calling runtime tests passed');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
