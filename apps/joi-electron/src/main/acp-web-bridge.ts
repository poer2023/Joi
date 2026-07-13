import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ACPProviderRuntimeConfig } from '../../../../packages/runtime/src/acp.ts';

const bridgeToken = randomBytes(32).toString('hex');

export function acpWebBridgeToken(): string {
  return bridgeToken;
}

export function createACPWebMCPServer(userDataDir: string): NonNullable<ACPProviderRuntimeConfig['mcp_servers']>[number] {
  const script = resolveACPWebMCPScript();
  const socketPath = String(process.env.JOI_CLI_SOCKET || '').trim() || join(userDataDir, 'joi-cli.sock');
  const bridgeConfigPath = writeACPWebBridgeConfig(userDataDir, socketPath);
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

export function acpWebBridgeConfigPath(userDataDir: string): string {
  return join(userDataDir, 'runtime', 'acp-web-bridge.json');
}

function writeACPWebBridgeConfig(userDataDir: string, socketPath: string): string {
  const path = acpWebBridgeConfigPath(userDataDir);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ socket_path: socketPath, token: bridgeToken })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
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
