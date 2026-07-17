import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceSettings } from '../../../../packages/shared-types/src/desktop-api.ts';
import { resolveWorkspacePath } from '../../../../packages/runtime/src/capabilities.ts';

export async function executeCodeCapability(
  capability: 'execute_code' | 'code_execution' | 'sandbox_run',
  inputs: Record<string, unknown>,
  settings: WorkspaceSettings,
  permissionProfile: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!['workspace_write', 'danger_full_access'].includes(permissionProfile)) throw new Error(`${capability} requires workspace_write or danger_full_access`);
  if (capability === 'sandbox_run') return executeSandboxCommand(inputs, settings, permissionProfile, signal);
  const language = stringInput(inputs.language || 'javascript').toLowerCase();
  const code = typeof inputs.code === 'string' ? inputs.code : '';
  if (!code.trim()) throw new Error('execute_code code is required');
  if (Buffer.byteLength(code) > 1024 * 1024) throw new Error('execute_code source exceeds 1 MiB');
  const cwd = stringInput(inputs.cwd) ? resolveWorkspacePath(stringInput(inputs.cwd), settings) : settings.default_root;
  const timeoutMS = boundedInteger(inputs.timeout_seconds, 60, 1, 600) * 1_000;
  const directory = await mkdtemp(join(tmpdir(), 'joi-code-'));
  try {
    const runtime = await runtimeForCode(language, code, directory);
    const result = await runProcess(runtime.command, runtime.args, { cwd, timeoutMS, signal, env: runtime.env });
    return {
      status: result.exit_code === 0 ? 'completed' : 'failed',
      capability,
      mode: 'ephemeral_code_kernel_v1',
      language,
      command: runtime.label,
      exit_code: result.exit_code,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.duration_ms,
      summary: result.exit_code === 0
        ? `${language} code completed in ${result.duration_ms}ms.`
        : `${language} code exited with ${result.exit_code}.`,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeSandboxCommand(
  inputs: Record<string, unknown>,
  settings: WorkspaceSettings,
  permissionProfile: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const argv = Array.isArray(inputs.cmd) ? inputs.cmd.map(String).map((item) => item.trim()).filter(Boolean) : [];
  if (argv.length === 0) throw new Error('sandbox_run cmd must be a non-empty argv array');
  if (argv.length > 256 || argv.some((item) => item.length > 16_000 || /[\0\r\n]/.test(item))) throw new Error('sandbox_run command is invalid');
  const cwd = stringInput(inputs.cwd) ? resolveWorkspacePath(stringInput(inputs.cwd), settings) : settings.default_root;
  const timeoutMS = boundedInteger(inputs.timeout_seconds, 60, 1, 600) * 1_000;
  const allowNetwork = permissionProfile === 'danger_full_access' && inputs.network !== false;
  const profile = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read*)',
    `(allow file-write* (subpath ${sandboxString(cwd)}) (subpath ${sandboxString(tmpdir())}) (literal "/dev/null") (literal "/dev/tty"))`,
    ...(allowNetwork ? ['(allow network*)'] : []),
  ].join(' ');
  const result = await runProcess('/usr/bin/sandbox-exec', ['-p', profile, '--', ...argv], {
    cwd,
    timeoutMS,
    signal,
    env: { JOI_SANDBOX: '1' },
  });
  return {
    status: result.exit_code === 0 ? 'completed' : 'failed',
    capability: 'sandbox_run',
    mode: 'macos_sandbox_exec_v1',
    cwd,
    argv,
    network_allowed: allowNetwork,
    exit_code: result.exit_code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    duration_ms: result.duration_ms,
    summary: result.exit_code === 0 ? 'Sandboxed command completed.' : `Sandboxed command exited with ${result.exit_code}.`,
  };
}

async function runtimeForCode(language: string, code: string, directory: string): Promise<{ command: string; args: string[]; env?: NodeJS.ProcessEnv; label: string }> {
  if (['javascript', 'js', 'node'].includes(language)) {
    const path = join(directory, 'main.mjs');
    await writeFile(path, code, 'utf8');
    return { command: process.execPath, args: [path], env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'node' };
  }
  if (['typescript', 'ts'].includes(language)) {
    const typescriptModule = await import('typescript');
    const typescript = typescriptModule.default;
    const output = typescript.transpileModule(code, {
      compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022, sourceMap: false },
      reportDiagnostics: true,
    });
    const diagnostics = output.diagnostics || [];
    const errors = diagnostics.filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
    if (errors.length > 0) throw new Error(`TypeScript transpilation failed: ${errors.map((error) => typescript.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`);
    const path = join(directory, 'main.mjs');
    await writeFile(path, output.outputText, 'utf8');
    return { command: process.execPath, args: [path], env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'typescript/node' };
  }
  if (['python', 'python3', 'py'].includes(language)) {
    const path = join(directory, 'main.py');
    await writeFile(path, code, 'utf8');
    return { command: '/opt/homebrew/bin/python3', args: [path], label: 'python3' };
  }
  if (['swift'].includes(language)) {
    const path = join(directory, 'main.swift');
    await writeFile(path, code, 'utf8');
    return { command: '/usr/bin/swift', args: [path], label: 'swift' };
  }
  if (['shell', 'bash', 'zsh', 'sh'].includes(language)) {
    const path = join(directory, 'main.zsh');
    await writeFile(path, code, 'utf8');
    return { command: '/bin/zsh', args: ['-f', path], label: 'zsh' };
  }
  throw new Error(`Unsupported execute_code language: ${language}`);
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMS: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<{ exit_code: number; signal?: string; stdout: string; stderr: string; duration_ms: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}), NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`.slice(-1024 * 1024);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const terminate = (reason: string) => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1_000).unref();
      if (reason === 'abort') {
        const error = new Error('code execution aborted');
        error.name = 'AbortError';
        reject(error);
      }
    };
    const timer = setTimeout(() => terminate('timeout'), options.timeoutMS);
    options.signal?.addEventListener('abort', () => terminate('abort'), { once: true });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit_code: code ?? (signal ? 128 : 1), signal: signal || undefined, stdout, stderr, duration_ms: Date.now() - started });
    });
  });
}

function sandboxString(value: string): string {
  return JSON.stringify(value);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
