import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type {
  PluginInstallFromGitHubRequest,
  PluginProviderConfig,
  PluginProviderTestResult,
  PluginRecord,
} from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import {
  compileACPProviderCapabilityAllowlist,
  inspectACPProvider,
  type ACPProviderRuntimeConfig,
} from '../../../../packages/runtime/src/acp.ts';
import {
  canonicalElectronCapabilityName,
  compileElectronCapabilityTools,
} from '../../../../packages/runtime/src/capability-compiler.ts';
import { resolveACPEphemeralLauncherScript } from './acp-ephemeral-launcher.ts';
import { createACPCapabilityMCPServer, createACPWebMCPServer } from './acp-web-bridge.ts';

export type GitHubPluginSource = {
  owner: string;
  repo: string;
  ref?: string;
  clone_url: string;
  source_url: string;
};

type CompatiblePluginInstallRequest = Partial<PluginInstallFromGitHubRequest> & {
  url?: string;
};

export class JoiPluginManager {
  readonly managedRoot: string;
  private readonly store: JoiSQLiteStore;
  private readonly userDataDir: string;

  constructor(store: JoiSQLiteStore, userDataDir: string) {
    this.store = store;
    this.userDataDir = userDataDir;
    this.managedRoot = join(userDataDir, 'plugins');
  }

  async installFromGitHub(req: CompatiblePluginInstallRequest): Promise<{ plugin: PluginRecord }> {
    const normalizedRequest = normalizePluginInstallRequest(req);
    const source = parseGitHubPluginSource(normalizedRequest.source, normalizedRequest.ref);
    await mkdir(this.managedRoot, { recursive: true });
    const stagingRoot = join(this.managedRoot, '.staging');
    await mkdir(stagingRoot, { recursive: true });
    const stagingDir = await mkdtemp(join(stagingRoot, 'github-'));
    const checkoutDir = join(stagingDir, 'repo');
    let backupDir = '';
    let destination = '';
    try {
      const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none'];
      if (source.ref) cloneArgs.push('--branch', source.ref);
      cloneArgs.push(source.clone_url, checkoutDir);
      await runCommand('/usr/bin/git', cloneArgs, { cwd: stagingDir, timeout_seconds: 120 });
      const revision = (await runCommand('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: checkoutDir, timeout_seconds: 15 })).stdout.trim();
      const manifestPath = join(checkoutDir, 'plugin.json');
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const pluginID = String(raw.id || '').trim();
      if (!pluginID || !/^[A-Za-z0-9._-]+$/.test(pluginID)) throw new Error('GitHub plugin manifest requires a safe id');
      await installLockedDependencies(checkoutDir);

      destination = join(this.managedRoot, pluginID);
      assertManagedPath(this.managedRoot, destination);
      backupDir = join(this.managedRoot, `.backup-${pluginID}-${Date.now()}`);
      if (await pathExists(destination)) await rename(destination, backupDir);
      await rename(checkoutDir, destination);
      const result = this.store.installPluginFromManifest(join(destination, 'plugin.json'), {
        trusted_root: this.managedRoot,
        metadata: {
          source: 'github',
          source_url: source.source_url,
          source_ref: source.ref || 'default',
          revision,
          managed_dir: destination,
        },
      });
      if (backupDir) await rm(backupDir, { recursive: true, force: true });
      await rm(stagingDir, { recursive: true, force: true });
      return result;
    } catch (error) {
      if (destination && await pathExists(destination) && backupDir && await pathExists(backupDir)) {
        await rm(destination, { recursive: true, force: true });
        await rename(backupDir, destination);
      }
      await rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const plugin = this.store.listPlugins().plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`plugin not found: ${id}`);
    if (plugin.metadata?.core === true) throw new Error('core plugin cannot be removed');
    const managedDir = String(plugin.metadata?.managed_dir || '').trim();
    this.store.removePlugin(id);
    if (!managedDir) return;
    assertManagedPath(this.managedRoot, managedDir);
    await rm(managedDir, { recursive: true, force: true });
  }

  async testProvider(pluginID: string, providerID?: string): Promise<PluginProviderTestResult> {
    const plugin = this.store.listPlugins().plugins.find((item) => item.id === pluginID);
    if (!plugin) throw new Error(`plugin not found: ${pluginID}`);
    if (!plugin.enabled) throw new Error(`plugin is disabled: ${pluginID}`);
    const id = providerID?.trim() || plugin.provider_ids[0] || '';
    const provider = this.store.getEnabledPluginProvider(id);
    if (!provider || provider.plugin_id !== pluginID) throw new Error(`plugin provider not found: ${id || 'empty'}`);
    const workspace = this.store.getWorkspaceSettings();
    const inspection = await inspectACPProvider(providerRuntimeConfig(
      provider,
      workspace.default_root,
      workspace.allowed_roots,
      'read_only',
      this.userDataDir,
    ));
    return inspection;
  }

  resolveProvider(
    providerID: string,
    permissionProfile: NonNullable<ACPProviderRuntimeConfig['permission_profile']>,
    allowedCapabilities?: Iterable<string>,
  ): ACPProviderRuntimeConfig | undefined {
    const provider = this.store.getEnabledPluginProvider(providerID);
    if (!provider) return undefined;
    const workspace = this.store.getWorkspaceSettings();
    return providerRuntimeConfig(
      provider,
      workspace.default_root,
      workspace.allowed_roots,
      permissionProfile,
      this.userDataDir,
      allowedCapabilities,
    );
  }
}

export function normalizePluginInstallRequest(req: CompatiblePluginInstallRequest): PluginInstallFromGitHubRequest {
  const source = String(req?.source || req?.url || '').trim();
  return {
    source,
    ref: typeof req?.ref === 'string' ? req.ref : undefined,
  };
}

export function parseGitHubPluginSource(input: string, requestedRef?: string): GitHubPluginSource {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) throw new Error('GitHub plugin source is required');
  const shorthand = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  let owner = '';
  let repo = '';
  let urlRef = '';
  if (shorthand) {
    owner = shorthand[1];
    repo = shorthand[2];
  } else {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Only HTTPS github.com plugin sources are allowed');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('GitHub plugin source must include owner and repository');
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, '');
    if (parts[2] === 'tree' && parts[3]) urlRef = decodeURIComponent(parts.slice(3).join('/'));
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('GitHub owner or repository contains unsupported characters');
  }
  const ref = (requestedRef || urlRef || '').trim() || undefined;
  if (ref && !/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error('GitHub ref contains unsupported characters');
  return {
    owner,
    repo,
    ref,
    clone_url: `https://github.com/${owner}/${repo}.git`,
    source_url: `https://github.com/${owner}/${repo}`,
  };
}

export function providerRuntimeConfig(
  provider: PluginProviderConfig,
  cwd: string,
  allowedRoots: string[],
  permissionProfile: NonNullable<ACPProviderRuntimeConfig['permission_profile']>,
  userDataDir: string,
  allowedCapabilities?: Iterable<string>,
): ACPProviderRuntimeConfig {
  if (provider.protocol !== 'acp') throw new Error(`unsupported plugin provider protocol: ${provider.protocol}`);
  const allowedCapabilityNames = allowedCapabilities === undefined
    ? undefined
    : [...allowedCapabilities].map((capability) => canonicalElectronCapabilityName(String(capability))).filter(Boolean);
  const allowedCapabilitySet = allowedCapabilityNames === undefined ? undefined : new Set(allowedCapabilityNames);
  const exposeWeb = allowedCapabilitySet === undefined
    || allowedCapabilitySet.has('*')
    || allowedCapabilitySet.has('web_research');
  const delegatedTools = allowedCapabilityNames === undefined
    ? []
    : compileElectronCapabilityTools(permissionProfile, { allowed_capabilities: allowedCapabilityNames })
      .filter((tool) => tool.name !== 'web_research');
  const delegatedServer = createACPCapabilityMCPServer(userDataDir, delegatedTools, permissionProfile);
  const mcpServers = [
    ...(exposeWeb ? [createACPWebMCPServer(userDataDir)] : []),
    ...(delegatedServer ? [delegatedServer] : []),
  ];
  const trustedMCPTools = [
    ...(exposeWeb ? [
      { server: 'joi_web', tool: 'web_search' },
      { server: 'joi_web', tool: 'web_extract' },
    ] : []),
    ...delegatedTools.map((tool) => ({ server: 'joi_capabilities', tool: tool.name })),
  ];
  const capabilityAllowlist = compileACPProviderCapabilityAllowlist({
    permission_profile: permissionProfile,
    allowed_roots: allowedRoots.length > 0 ? allowedRoots : [cwd],
    trusted_mcp_tools: trustedMCPTools,
  });
  if (provider.runtime === 'node') {
    const useCodexEphemeralLauncher = provider.id === 'acp_codex_cli';
    const commandArgs = useCodexEphemeralLauncher
      ? [resolveACPEphemeralLauncherScript(), provider.command, ...(provider.args || [])]
      : [provider.command, ...(provider.args || [])];
    return {
      provider_id: provider.id,
      command: process.execPath,
      args: commandArgs,
      cwd,
      env: {
        ...(provider.env || {}),
        ELECTRON_RUN_AS_NODE: '1',
        DISABLE_MCP_CONFIG_FILTERING: 'true',
        ...(useCodexEphemeralLauncher ? { JOI_ACP_EPHEMERAL: '1' } : {}),
      },
      auth_method: provider.auth_method,
      model: provider.default_model,
      permission_profile: permissionProfile,
      timeout_seconds: 300,
      mcp_servers: mcpServers,
      capability_allowlist: capabilityAllowlist,
      joi_capability_tools: delegatedTools.map((tool) => tool.name),
      ephemeral_session: true,
    };
  }
  return {
    provider_id: provider.id,
    command: provider.command,
    args: provider.args || [],
    cwd,
    env: { ...(provider.env || {}), DISABLE_MCP_CONFIG_FILTERING: 'true' },
    auth_method: provider.auth_method,
    model: provider.default_model,
    permission_profile: permissionProfile,
    timeout_seconds: 300,
    mcp_servers: mcpServers,
    capability_allowlist: capabilityAllowlist,
    joi_capability_tools: delegatedTools.map((tool) => tool.name),
    ephemeral_session: true,
  };
}

async function installLockedDependencies(directory: string): Promise<void> {
  const packageJSON = join(directory, 'package.json');
  if (!await pathExists(packageJSON)) return;
  if (!await pathExists(join(directory, 'package-lock.json'))) throw new Error('GitHub plugin with package.json requires package-lock.json');
  const npm = await resolveNpmCommand();
  await runCommand(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, timeout_seconds: 300 });
}

async function resolveNpmCommand(): Promise<string> {
  for (const candidate of ['/opt/homebrew/bin/npm', '/usr/local/bin/npm', '/usr/bin/npm']) {
    if (await pathExists(candidate)) return candidate;
  }
  return 'npm';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertManagedPath(root: string, candidate: string): void {
  const cleanRoot = resolve(root);
  const cleanCandidate = resolve(candidate);
  const rel = relative(cleanRoot, cleanCandidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || basename(cleanCandidate).startsWith('.staging')) {
    throw new Error('refusing to modify a path outside the managed plugin root');
  }
}

async function runCommand(command: string, args: string[], options: { cwd: string; timeout_seconds: number }): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-64 * 1024); });
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${options.timeout_seconds}s`));
    }, options.timeout_seconds * 1_000);
    timer.unref?.();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} failed (code=${code ?? 'null'}, signal=${signal || 'none'}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}
