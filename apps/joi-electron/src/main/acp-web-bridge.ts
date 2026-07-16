import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp.ts';
import type { ToolSpec } from '../../../../packages/runtime/src/tool-calling.ts';

const bridgeToken = randomBytes(32).toString('hex');
const bridgeGrants = new Map<string, ACPBridgeGrant>();
const scopedGrantTokens = new Map<string, string>();

export type ACPBridgeGrant = {
  permission_profile: NonNullable<ACPProviderRuntimeConfig['permission_profile']>;
  capabilities: ReadonlySet<string>;
};

type ACPBridgeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const webTools: ACPBridgeTool[] = [
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

bridgeGrants.set(bridgeToken, {
  permission_profile: 'read_only',
  capabilities: new Set(webTools.map((tool) => tool.name)),
});

export function acpWebBridgeToken(): string {
  return bridgeToken;
}

export function authorizeACPBridgeRequest(token: string, capability: string): ACPBridgeGrant | undefined {
  const grant = resolveACPBridgeGrant(token);
  if (!grant || !grant.capabilities.has(capability.trim())) return undefined;
  return grant;
}

export function resolveACPBridgeGrant(token: string): ACPBridgeGrant | undefined {
  return bridgeGrants.get(token.trim());
}

export function createACPWebMCPServer(userDataDir: string): NonNullable<ACPProviderRuntimeConfig['mcp_servers']>[number] {
  const script = resolveACPWebMCPScript();
  const socketPath = String(process.env.JOI_CLI_SOCKET || '').trim() || join(userDataDir, 'joi-cli.sock');
  const bridgeConfigPath = writeACPBridgeConfig(
    acpWebBridgeConfigPath(userDataDir),
    socketPath,
    bridgeToken,
    'joi_web',
    webTools,
  );
  return {
    name: 'joi_web',
    command: '/usr/bin/env',
    args: [
      'ELECTRON_RUN_AS_NODE=1',
      process.execPath,
      script,
      '--bridge-config',
      bridgeConfigPath,
    ],
    env: [],
  };
}

export function createACPCapabilityMCPServer(
  userDataDir: string,
  toolSpecs: ToolSpec[],
  permissionProfile: NonNullable<ACPProviderRuntimeConfig['permission_profile']>,
): NonNullable<ACPProviderRuntimeConfig['mcp_servers']>[number] | undefined {
  const tools = uniqueBridgeTools(toolSpecs);
  if (tools.length === 0) return undefined;
  const scopeKey = createHash('sha256')
    .update(JSON.stringify({
      permission_profile: permissionProfile,
      tools: tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })),
    }))
    .digest('hex')
    .slice(0, 16);
  let token = scopedGrantTokens.get(scopeKey);
  if (!token) {
    token = randomBytes(32).toString('hex');
    scopedGrantTokens.set(scopeKey, token);
  }
  bridgeGrants.set(token, {
    permission_profile: permissionProfile,
    capabilities: new Set(tools.map((tool) => tool.name)),
  });
  const script = resolveACPWebMCPScript();
  const socketPath = String(process.env.JOI_CLI_SOCKET || '').trim() || join(userDataDir, 'joi-cli.sock');
  const bridgeConfigPath = writeACPBridgeConfig(
    acpCapabilityBridgeConfigPath(userDataDir, scopeKey),
    socketPath,
    token,
    'joi_capabilities',
    tools,
  );
  return {
    name: 'joi_capabilities',
    command: '/usr/bin/env',
    args: [
      'ELECTRON_RUN_AS_NODE=1',
      process.execPath,
      script,
      '--bridge-config',
      bridgeConfigPath,
    ],
    env: [],
  };
}

export function acpWebBridgeConfigPath(userDataDir: string): string {
  return join(userDataDir, 'runtime', 'acp-web-bridge.json');
}

export function acpCapabilityBridgeConfigPath(userDataDir: string, scopeKey: string): string {
  return join(userDataDir, 'runtime', `acp-capability-bridge-${scopeKey}.json`);
}

function writeACPBridgeConfig(
  path: string,
  socketPath: string,
  token: string,
  serverName: string,
  tools: ACPBridgeTool[],
): string {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({
    socket_path: socketPath,
    token,
    server_name: serverName,
    tools,
  })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
}

function uniqueBridgeTools(toolSpecs: ToolSpec[]): ACPBridgeTool[] {
  const byName = new Map<string, ACPBridgeTool>();
  for (const spec of toolSpecs) {
    const name = spec.name.trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      description: String(spec.description || '').trim(),
      inputSchema: spec.parameters && typeof spec.parameters === 'object'
        ? spec.parameters
        : { type: 'object', properties: {}, additionalProperties: true },
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveACPWebMCPScript(): string {
  const override = String(process.env.JOI_ACP_WEB_MCP_SCRIPT || '').trim();
  const resourcesPath = String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '').trim();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    override,
    resourcesPath ? join(resourcesPath, 'acp-web-mcp', 'index.mjs') : '',
    resolve(moduleDir, '../../resources/acp-web-mcp/index.mjs'),
    resolve(process.cwd(), 'apps/joi-electron/resources/acp-web-mcp/index.mjs'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Joi ACP web MCP server is missing. Checked: ${candidates.join(', ')}`);
  return found;
}
