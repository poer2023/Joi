import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { MCPServerRecord, MCPToolCallResult } from '../../../../packages/shared-types/src/desktop-api.ts';

type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

type ManagedConnection = {
  fingerprint: string;
  client: Client;
  transport: MCPTransport;
  connectedAt: number;
  lastUsedAt: number;
};

export type MCPInventory = {
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name?: string }> }>;
};

export class MCPRuntimeManager {
  private connections = new Map<string, ManagedConnection>();

  async inspect(server: MCPServerRecord): Promise<MCPInventory> {
    const connection = await this.connectionFor(server);
    const [tools, resources, prompts] = await Promise.all([
      collectPages((cursor) => connection.client.listTools(cursor ? { cursor } : undefined), 'tools'),
      collectPages((cursor) => connection.client.listResources(cursor ? { cursor } : undefined), 'resources'),
      collectPages((cursor) => connection.client.listPrompts(cursor ? { cursor } : undefined), 'prompts'),
    ]);
    connection.lastUsedAt = Date.now();
    return {
      tools: tools.map((tool) => ({
        name: requiredString(tool.name, 'MCP tool name'),
        description: optionalString(tool.description),
        inputSchema: record(tool.inputSchema),
      })),
      resources: resources.map((resource) => ({
        uri: requiredString(resource.uri, 'MCP resource URI'),
        name: optionalString(resource.name),
        description: optionalString(resource.description),
        mimeType: optionalString(resource.mimeType),
      })),
      prompts: prompts.map((prompt) => ({
        name: requiredString(prompt.name, 'MCP prompt name'),
        description: optionalString(prompt.description),
        arguments: Array.isArray(prompt.arguments)
          ? prompt.arguments.map((argument) => ({ name: optionalString(record(argument).name) })).filter((argument) => argument.name)
          : [],
      })),
    };
  }

  async callTool(server: MCPServerRecord, toolName: string, input: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<MCPToolCallResult> {
    const cleanToolName = toolName.trim();
    if (!cleanToolName) throw new Error('MCP tool name is required');
    const startedAt = Date.now();
    let connection = await this.connectionFor(server);
    try {
      const response = await withTimeout(
        connection.client.callTool({ name: cleanToolName, arguments: input }),
        timeoutMs,
        `MCP tool ${server.id}/${cleanToolName}`,
      );
      connection.lastUsedAt = Date.now();
      return normalizeToolResult(server.id, cleanToolName, response, Date.now() - startedAt);
    } catch (firstError) {
      await this.close(server.id);
      connection = await this.connectionFor(server);
      try {
        const response = await withTimeout(
          connection.client.callTool({ name: cleanToolName, arguments: input }),
          timeoutMs,
          `MCP tool ${server.id}/${cleanToolName}`,
        );
        connection.lastUsedAt = Date.now();
        return normalizeToolResult(server.id, cleanToolName, response, Date.now() - startedAt);
      } catch (retryError) {
        throw new AggregateError([firstError, retryError], `MCP tool ${server.id}/${cleanToolName} failed after reconnect`);
      }
    }
  }

  async close(serverID: string): Promise<void> {
    const connection = this.connections.get(serverID);
    this.connections.delete(serverID);
    if (!connection) return;
    await connection.client.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((serverID) => this.close(serverID)));
  }

  connectionStatus(): Array<{ server_id: string; connected_at: string; last_used_at: string }> {
    return [...this.connections.entries()].map(([serverID, connection]) => ({
      server_id: serverID,
      connected_at: new Date(connection.connectedAt).toISOString(),
      last_used_at: new Date(connection.lastUsedAt).toISOString(),
    }));
  }

  private async connectionFor(server: MCPServerRecord): Promise<ManagedConnection> {
    if (server.enabled === false) throw new Error(`MCP server is disabled: ${server.id}`);
    const fingerprint = serverFingerprint(server);
    const existing = this.connections.get(server.id);
    if (existing && existing.fingerprint === fingerprint) return existing;
    if (existing) await this.close(server.id);
    const transport = createTransport(server);
    const client = new Client({ name: 'joi-desktop', version: '0.1.1' }, { capabilities: {} });
    const connection: ManagedConnection = {
      fingerprint,
      client,
      transport,
      connectedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    transport.onerror = () => {
      if (this.connections.get(server.id) === connection) this.connections.delete(server.id);
    };
    transport.onclose = () => {
      if (this.connections.get(server.id) === connection) this.connections.delete(server.id);
    };
    await withTimeout(client.connect(transport), 30_000, `MCP server ${server.id} connection`);
    this.connections.set(server.id, connection);
    return connection;
  }
}

function createTransport(server: MCPServerRecord): MCPTransport {
  const transport = server.transport.trim().toLowerCase();
  if (transport === 'stdio') {
    const command = server.command?.trim();
    if (!command) throw new Error(`MCP server ${server.id} has no command`);
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...(server.env || {}) }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    return new StdioClientTransport({
      command,
      args: server.args || [],
      env,
      cwd: optionalString(server.metadata?.cwd),
      stderr: 'pipe',
    });
  }
  const rawURL = server.url?.trim();
  if (!rawURL) throw new Error(`MCP server ${server.id} has no URL`);
  const url = new URL(rawURL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Remote MCP server URL must use HTTP or HTTPS');
  const headers = server.headers || {};
  if (transport === 'streamable_http') {
    return new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      reconnectionOptions: {
        initialReconnectionDelay: 500,
        maxReconnectionDelay: 10_000,
        reconnectionDelayGrowFactor: 1.8,
        maxRetries: 3,
      },
    });
  }
  if (transport === 'sse') {
    return new SSEClientTransport(url, {
      requestInit: { headers },
      eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...headers, ...(init?.headers || {}) } }) },
    });
  }
  throw new Error(`Unsupported MCP transport: ${server.transport}`);
}

async function collectPages(
  fetchPage: (cursor?: string) => Promise<Record<string, unknown>>,
  key: 'tools' | 'resources' | 'prompts',
): Promise<Array<Record<string, unknown>>> {
  const collected: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const response = await fetchPage(cursor);
    const values = response[key];
    if (Array.isArray(values)) collected.push(...values.map(record));
    const nextCursor = optionalString(response.nextCursor);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return collected;
}

function normalizeToolResult(serverID: string, toolName: string, response: Record<string, unknown>, durationMs: number): MCPToolCallResult {
  return {
    server_id: serverID,
    tool_name: toolName,
    content: Array.isArray(response.content) ? response.content : [],
    structured_content: recordOrUndefined(response.structuredContent),
    is_error: response.isError === true,
    duration_ms: durationMs,
  };
}

function serverFingerprint(server: MCPServerRecord): string {
  return JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: server.env,
    headers: server.headers,
    enabled: server.enabled,
    cwd: server.metadata?.cwd,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeout = Math.max(1_000, Math.min(10 * 60_000, Math.round(timeoutMs)));
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const parsed = record(value);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function requiredString(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`${label} is required`);
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
