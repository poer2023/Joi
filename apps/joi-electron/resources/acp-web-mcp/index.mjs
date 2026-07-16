import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const bridgeConfig = loadBridgeConfig();
const socketPath = String(process.env.JOI_ACP_WEB_SOCKET || bridgeConfig.socket_path || '').trim();
const bridgeToken = String(process.env.JOI_ACP_WEB_TOKEN || bridgeConfig.token || '').trim();
const serverName = String(bridgeConfig.server_name || 'joi_web').trim() || 'joi_web';
if (!socketPath || !bridgeToken) {
  process.stderr.write('Joi ACP MCP bridge configuration is unavailable or invalid.\n');
  process.exit(1);
}
let inputBuffer = '';
let queue = Promise.resolve();

const fallbackWebTools = [
  {
    name: 'web_search',
    description: 'Search the public web through Joi\'s policy-controlled read-only backend. Use this for websites, current information, news, and public X/Twitter links without requiring an interactive Browser session. Search snippets are unverified until a page is extracted.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        max_results: { type: 'number', minimum: 1, maximum: 10, description: 'Maximum search results.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'web_extract',
    description: 'Fetch and extract readable text from a public HTTP(S) URL through Joi\'s policy-controlled read-only backend. Private, loopback, metadata, and otherwise blocked URLs are denied.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public HTTP(S) URL to fetch.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
const tools = Array.isArray(bridgeConfig.tools) && bridgeConfig.tools.length > 0
  ? bridgeConfig.tools
  : fallbackWebTools;

function loadBridgeConfig() {
  const flagIndex = process.argv.indexOf('--bridge-config');
  if (flagIndex < 0 || !process.argv[flagIndex + 1]) return {};
  try {
    const path = String(process.argv[flagIndex + 1]);
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 128 * 1024) return {};
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      socket_path: typeof parsed.socket_path === 'string' ? parsed.socket_path : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      server_name: typeof parsed.server_name === 'string' ? parsed.server_name : '',
      tools: validTools(parsed.tools),
    };
  } catch {
    return {};
  }
}

function validTools(value) {
  if (!Array.isArray(value) || value.length > 64) return [];
  const tools = [];
  const names = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const inputSchema = item.inputSchema;
    if (!/^[A-Za-z0-9_.-]{1,96}$/.test(name) || names.has(name)) return [];
    if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return [];
    names.add(name);
    tools.push({
      name,
      description: typeof item.description === 'string' ? item.description.slice(0, 2_000) : '',
      inputSchema,
    });
  }
  return tools;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += String(chunk);
  for (;;) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line) continue;
    queue = queue.then(() => handleLine(line)).catch((error) => {
      process.stderr.write(`Joi ACP web MCP request failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
});

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, error instanceof Error ? error.message : 'Invalid JSON');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
  const id = message.id;
  const method = String(message.method || '');
  if (method === 'initialize') {
    const requestedVersion = String(message.params?.protocolVersion || '').trim();
    sendResult(id, {
      protocolVersion: requestedVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: serverName.replaceAll('_', '-'), version: '0.2.0' },
    });
    return;
  }
  if (method === 'ping') {
    sendResult(id, {});
    return;
  }
  if (method === 'tools/list') {
    sendResult(id, { tools });
    return;
  }
  if (method === 'resources/list') {
    sendResult(id, { resources: [] });
    return;
  }
  if (method === 'prompts/list') {
    sendResult(id, { prompts: [] });
    return;
  }
  if (method === 'tools/call') {
    await callTool(id, message.params);
    return;
  }
  sendError(id, -32601, `Method not found: ${method}`);
}

async function callTool(id, params) {
  const name = String(params?.name || '').trim();
  if (!tools.some((tool) => tool.name === name)) {
    sendError(id, -32602, `Unsupported Joi capability tool: ${name || '(empty)'}`);
    return;
  }
  const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
    ? params.arguments
    : {};
  if (name === 'web_search' && !String(args.query || '').trim()) {
    sendError(id, -32602, 'web_search query is required');
    return;
  }
  if (name === 'web_extract' && !String(args.url || '').trim()) {
    sendError(id, -32602, 'web_extract url is required');
    return;
  }
  try {
    const envelope = await invokeJoiBridge({
      action: 'acp_web',
      request_id: `acp_bridge_${randomUUID().replaceAll('-', '')}`,
      token: bridgeToken,
      capability: name,
      payload: {
        ...args,
        __joi_parent_run_id: String(process.env.JOI_PARENT_RUN_ID || ''),
        __joi_parent_conversation_id: String(process.env.JOI_PARENT_CONVERSATION_ID || ''),
        __joi_delegation_depth: Number(process.env.JOI_DELEGATION_DEPTH || 0),
      },
    }, ['video_generate', 'speech_transcribe'].includes(name)
      ? 660_000
      : name === 'delegate_task'
        ? 360_000
        : name === 'text_to_speech'
          ? 240_000
          : 30_000);
    if (!envelope?.ok) {
      const error = envelope?.error || {};
      sendResult(id, toolResult({
        status: 'failed',
        capability: name,
        code: String(error.code || 'ACP_BRIDGE_FAILED'),
        summary: String(error.message || 'Joi ACP capability bridge failed'),
      }, true));
      return;
    }
    const output = envelope.data && typeof envelope.data === 'object'
      ? { ...envelope.data, capability: name, trace_id: envelope.trace_id }
      : { status: 'completed', capability: name, result: envelope.data, trace_id: envelope.trace_id };
    sendResult(id, toolResult(output, output.status === 'failed'));
  } catch (error) {
    sendResult(id, toolResult({
      status: 'failed',
      capability: name,
      summary: error instanceof Error ? error.message : String(error),
    }, true));
  }
}

function invokeJoiBridge(request, timeoutMs = 30_000) {
  if (!socketPath) return Promise.reject(new Error('Joi ACP bridge socket is not configured'));
  if (!bridgeToken) return Promise.reject(new Error('Joi ACP bridge token is not configured'));
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Joi ACP capability bridge timed out'));
    }, timeoutMs);
    timer.unref?.();
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      response += String(chunk);
      if (Buffer.byteLength(response, 'utf8') > 2 * 1024 * 1024) {
        socket.destroy();
        reject(new Error('Joi ACP capability bridge response exceeds 2 MiB'));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(response.trim() || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function toolResult(output, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output,
    isError: Boolean(isError),
  };
}

function sendResult(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}
