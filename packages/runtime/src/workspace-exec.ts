import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { platform, tmpdir } from 'node:os';
import type { PermissionProfile, WorkspaceSettings } from '../../shared-types/src/desktop-api';
import type { CapabilityResult } from './capabilities.ts';
import { normalizeWorkspaceSettings } from './capabilities.ts';

export type ShellCommandRequest = {
  cmd?: unknown;
  cwd?: string;
  timeout_seconds?: unknown;
  max_output_bytes?: unknown;
  permission_profile?: PermissionProfile | string;
};

export type TestCommandRequest = ShellCommandRequest;

export type ApplyPatchRequest = {
  patch?: string;
  permission_profile?: PermissionProfile | string;
};

type CommandRunResult = {
  status: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  output: string;
  truncated: boolean;
  duration_ms: number;
  mode: string;
  sandbox: Record<string, unknown>;
  error: string;
};

type CommandExecutionOptions = {
  signal?: AbortSignal;
};

type CommandSandbox = {
  engine: string;
  enforced: boolean;
  permission_profile: PermissionProfile;
  temp_dir: string;
  writable_roots: string[];
  reason: string;
  profile_path?: string;
};

type WorkspacePatchOp = {
  kind: 'add' | 'update';
  path: string;
  lines: string[];
};

type WorkspacePatchChange = {
  operation: 'add' | 'update';
  path: string;
  bytes: number;
  lines: number;
  mode: number;
  content: Buffer;
  beforeExists: boolean;
  beforeContent: Buffer;
};

export type WorkspaceChangeSetDraft = {
  id: string;
  patch: string;
  permission_profile: PermissionProfile;
  files: Array<{
    operation: 'add' | 'update';
    path: string;
    mode: number;
    before_exists: boolean;
    before_content_base64: string;
    after_content_base64: string;
    before_hash: string;
    after_hash: string;
    bytes: number;
    lines: number;
  }>;
};

type ApplyPatchExecutionOptions = {
  onPrepared?: (changeSet: WorkspaceChangeSetDraft) => void;
  onApplied?: (changeSet: WorkspaceChangeSetDraft) => void;
  onFailed?: (changeSet: WorkspaceChangeSetDraft, error: Error) => void;
};

const defaultShellCommandTimeoutSeconds = 30;
const maxShellCommandTimeoutSeconds = 180;
const defaultShellCommandOutputBytes = 120000;
const maxShellCommandOutputBytes = 240000;
const defaultTestCommandTimeoutSeconds = 60;
const maxTestCommandTimeoutSeconds = 180;
const defaultTestCommandOutputBytes = 120000;
const maxTestCommandOutputBytes = 240000;

export async function executeShellCommand(req: ShellCommandRequest, settings: WorkspaceSettings, options: CommandExecutionOptions = {}): Promise<CapabilityResult> {
  const normalized = normalizeWorkspaceSettings(settings);
  const argv = commandArgvFrom(req.cmd);
  if (argv.length === 0) throw new Error('shell_command cmd is required');
  const profile = normalizedPermissionProfile(req.permission_profile);
  const cwd = resolveWorkspaceDirectory(req.cwd || normalized.default_root, normalized, 'shell_command cwd must be a directory');
  validateShellCommandArgv(argv, cwd, normalized, profile);
  const timeoutSeconds = boundedInteger(req.timeout_seconds, defaultShellCommandTimeoutSeconds, maxShellCommandTimeoutSeconds);
  const maxOutputBytes = boundedInteger(req.max_output_bytes, defaultShellCommandOutputBytes, maxShellCommandOutputBytes);
  const result = await runCommand(argv, cwd, timeoutSeconds, maxOutputBytes, profile, normalized.allowed_roots, 'shell_command_v1_exec_context', options.signal);
  return {
    status: 'completed',
    command_status: result.status,
    cmd: argv,
    cwd,
    exit_code: result.exit_code,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output,
    truncated: result.truncated,
    output_truncated: result.truncated,
    duration_ms: result.duration_ms,
    max_output_bytes: maxOutputBytes,
    timeout_seconds: timeoutSeconds,
    command_policy: commandPolicyForProfile(profile),
    sandbox: result.sandbox,
    error: result.error,
    summary: `shell_command ${result.status}: ${argv.join(' ')}`,
    mode: result.mode,
  };
}

export async function executeTestCommand(req: TestCommandRequest, settings: WorkspaceSettings, options: CommandExecutionOptions = {}): Promise<CapabilityResult> {
  const normalized = normalizeWorkspaceSettings(settings);
  const argv = commandArgvFrom(req.cmd);
  if (argv.length === 0) throw new Error('test_command cmd is required');
  const profile = normalizedPermissionProfile(req.permission_profile);
  validateTestCommandArgv(argv, profile);
  const cwd = resolveWorkspaceDirectory(req.cwd || normalized.default_root, normalized, 'test_command cwd must be a directory');
  const timeoutSeconds = boundedInteger(req.timeout_seconds, defaultTestCommandTimeoutSeconds, maxTestCommandTimeoutSeconds);
  const maxOutputBytes = boundedInteger(req.max_output_bytes, defaultTestCommandOutputBytes, maxTestCommandOutputBytes);
  const result = await runCommand(argv, cwd, timeoutSeconds, maxOutputBytes, profile, normalized.allowed_roots, 'test_command_v1_allowlisted_exec', options.signal);
  let testStatus = result.status === 'completed' && result.exit_code === 0 ? 'succeeded' : 'failed';
  if (result.status === 'timed_out' || result.status === 'aborted') testStatus = result.status;
  return {
    status: 'completed',
    test_status: testStatus,
    command_status: result.status,
    cmd: argv,
    cwd,
    exit_code: result.exit_code,
    output: result.output,
    stdout: result.stdout,
    stderr: result.stderr,
    output_truncated: result.truncated,
    truncated: result.truncated,
    max_output_bytes: maxOutputBytes,
    timeout_seconds: timeoutSeconds,
    duration_ms: result.duration_ms,
    command_policy: commandPolicyForProfile(profile),
    sandbox: result.sandbox,
    error: result.error,
    summary: `test_command ${testStatus}: ${argv.join(' ')}`,
    mode: result.mode,
  };
}

export function executeApplyPatch(req: ApplyPatchRequest, settings: WorkspaceSettings, options: ApplyPatchExecutionOptions = {}): CapabilityResult {
  const profile = normalizedPermissionProfile(req.permission_profile);
  if (!permissionProfileAllowsWorkspaceWrite(profile)) throw policyDenied('apply_patch requires workspace_write permission profile');
  const patch = req.patch?.trimEnd() || '';
  if (!patch.trim()) throw new Error('apply_patch patch is required');
  const normalized = normalizeWorkspaceSettings(settings);
  const ops = parseWorkspaceApplyPatch(patch);
  const changes = prepareWorkspacePatchChanges(ops, normalized);
  const changeSet: WorkspaceChangeSetDraft = {
    id: `changeset_${randomUUID()}`,
    patch,
    permission_profile: profile,
    files: changes.map((change) => ({
      operation: change.operation,
      path: change.path,
      mode: change.mode,
      before_exists: change.beforeExists,
      before_content_base64: change.beforeContent.toString('base64'),
      after_content_base64: change.content.toString('base64'),
      before_hash: hashWorkspaceContent(change.beforeContent),
      after_hash: hashWorkspaceContent(change.content),
      bytes: change.bytes,
      lines: change.lines,
    })),
  };
  options.onPrepared?.(changeSet);
  const applied: WorkspacePatchChange[] = [];
  try {
    for (const change of changes) {
      writeWorkspaceFileAtomic(change.path, change.content, change.mode);
      applied.push(change);
    }
    options.onApplied?.(changeSet);
  } catch (error) {
    for (const change of [...applied].reverse()) restoreWorkspacePatchChange(change);
    const failure = error instanceof Error ? error : new Error(String(error));
    options.onFailed?.(changeSet, failure);
    throw failure;
  }
  const changedFiles = changes.map((change) => ({
    operation: change.operation,
    path: change.path,
    bytes: change.bytes,
    lines: change.lines,
    before_hash: hashWorkspaceContent(change.beforeContent),
    after_hash: hashWorkspaceContent(change.content),
  }));
  return {
    status: 'completed',
    changed_files: changedFiles,
    changed_file_count: changedFiles.length,
    change_set_id: changeSet.id,
    reversible: true,
    review_patch: patch,
    permission_profile: profile,
    summary: `Applied workspace patch to ${changedFiles.length} file(s).`,
    mode: 'apply_patch_v1_workspace',
  };
}

function commandArgvFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function resolveWorkspaceDirectory(input: string, settings: WorkspaceSettings, errorMessage: string): string {
  const path = resolveWorkspaceTargetPath(input, settings, true);
  if (!statSync(path).isDirectory()) throw new Error(errorMessage);
  return path;
}

function validateShellCommandArgv(argv: string[], cwd: string, settings: WorkspaceSettings, profile: PermissionProfile): void {
  if (profile === 'danger_full_access') {
    validateFullAccessCommandArgv(argv, 'shell_command');
    return;
  }
  validateShellArgSafety(argv);
  const bin = basename(argv[0]);
  if (bin !== argv[0]) throw policyDenied('shell_command executable paths are not allowed');
  if (forbiddenShellExecutable(bin)) throw policyDenied(`shell_command forbids executable ${bin}`);
  switch (bin) {
    case 'pwd':
      if (argv.length !== 1) throw policyDenied('pwd does not accept arguments in shell_command');
      return;
    case 'ls':
      validateShellWorkspaceArgs(argv.slice(1), cwd, settings, false, 'known_paths');
      return;
    case 'cat':
      validateShellWorkspaceArgs(argv.slice(1), cwd, settings, true, 'all_non_flags');
      return;
    case 'sed':
      validateShellWorkspaceArgs(argv.slice(1), cwd, settings, false, 'known_paths');
      return;
    case 'grep':
    case 'rg':
      validateSearchCommandArgv(bin, argv.slice(1), cwd, settings);
      return;
    case 'find':
      validateFindCommandArgv(argv.slice(1), cwd, settings);
      return;
    case 'git':
      validateShellGitArgv(argv.slice(1), cwd, settings);
      return;
    case 'go':
    case 'npm':
    case 'pnpm':
    case 'yarn':
      validateTestCommandArgv(argv, profile);
      return;
    default:
      throw policyDenied(`shell_command executable ${bin} is not allowlisted`);
  }
}

function validateShellArgSafety(argv: string[]): void {
  for (const arg of argv) {
    const trimmed = arg.trim();
    if (!trimmed || arg.includes('\0')) throw policyDenied('shell_command arguments must be non-empty strings');
    if (trimmed.startsWith('~')) throw policyDenied('shell_command does not allow home-relative paths');
    if (shellPathHasParentTraversal(trimmed)) throw policyDenied('shell_command does not allow parent-directory traversal');
    if (shellArgReferencesBlockedPath(trimmed)) throw policyDenied('shell_command does not allow blocked sensitive paths');
  }
}

function forbiddenShellExecutable(bin: string): boolean {
  return new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'curl', 'wget', 'brew', 'docker', 'sh', 'bash', 'zsh', 'python', 'python3', 'node'])
    .has(bin.toLowerCase().trim());
}

const fullAccessBlockedExecutables = new Set([
  'rm',
  'rmdir',
  'unlink',
  'srm',
  'shred',
  'dd',
  'gpt',
  'fdisk',
  'wipefs',
  'sudo',
  'su',
  'doas',
  'shutdown',
  'reboot',
  'halt',
  'csrutil',
  'nvram',
  'bless',
  'dscl',
  'sysadminctl',
]);

const shellCommandExecutables = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh']);

export function validateFullAccessCommandInput(value: unknown, capability = 'shell_command'): void {
  if (Array.isArray(value)) {
    const argv = value.map((item) => String(item).trim()).filter(Boolean);
    if (argv.length !== value.length) throw policyDenied(`${capability} arguments must be non-empty strings`);
    validateFullAccessCommandArgv(argv, capability);
    return;
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${capability} cmd is required`);
  if (value.includes('\0')) throw policyDenied(`${capability} arguments must not contain NUL bytes`);
  validateShellCommandText(value, capability, 0);
}

function validateFullAccessCommandArgv(argv: string[], capability: string, depth = 0): void {
  if (argv.length === 0) throw new Error(`${capability} cmd is required`);
  for (const arg of argv) {
    if (!arg.trim() || arg.includes('\0')) throw policyDenied(`${capability} arguments must be non-empty strings`);
  }
  if (depth > 4) throw policyDenied('command_blacklisted: nested command wrappers exceed policy depth');

  const bin = basename(argv[0]).toLowerCase().trim();
  if (fullAccessBlockedExecutables.has(bin) || /^(?:mkfs|newfs)(?:[._-]|$)/.test(bin)) {
    throw policyDenied(`command_blacklisted: ${bin} is disabled by full_access_blacklist_v1`);
  }

  const args = argv.slice(1);
  const lowerArgs = args.map((arg) => arg.toLowerCase());
  if (bin === 'diskutil' && diskutilCommandIsDestructive(lowerArgs)) {
    throw policyDenied('command_blacklisted: destructive diskutil operation is disabled by full_access_blacklist_v1');
  }
  if (bin === 'asr' && lowerArgs.includes('restore')) {
    throw policyDenied('command_blacklisted: asr restore is disabled by full_access_blacklist_v1');
  }
  if (bin === 'softwareupdate' && lowerArgs.includes('--erase-install')) {
    throw policyDenied('command_blacklisted: softwareupdate --erase-install is disabled by full_access_blacklist_v1');
  }
  if (bin === 'tmutil' && lowerArgs.some((arg) => ['delete', 'deletelocalsnapshots'].includes(arg))) {
    throw policyDenied('command_blacklisted: destructive tmutil operation is disabled by full_access_blacklist_v1');
  }
  if (bin === 'security' && lowerArgs.some((arg) => arg.startsWith('delete-'))) {
    throw policyDenied('command_blacklisted: keychain deletion is disabled by full_access_blacklist_v1');
  }
  if (bin === 'fdesetup' && lowerArgs.some((arg) => ['disable', 'remove', 'removeall'].includes(arg))) {
    throw policyDenied('command_blacklisted: FileVault removal is disabled by full_access_blacklist_v1');
  }
  if (bin === 'launchctl' && lowerArgs.some((arg) => ['bootout', 'remove', 'unload', 'disable'].includes(arg))) {
    throw policyDenied('command_blacklisted: service removal is disabled by full_access_blacklist_v1');
  }
  if (bin === 'find' && lowerArgs.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg))) {
    throw policyDenied('command_blacklisted: destructive find action is disabled by full_access_blacklist_v1');
  }
  if (bin === 'git' && gitCommandDiscardsWorktree(lowerArgs)) {
    throw policyDenied('command_blacklisted: destructive git worktree operation is disabled by full_access_blacklist_v1');
  }

  if (shellCommandExecutables.has(bin)) {
    const commandIndex = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/i.test(arg));
    if (commandIndex >= 0 && args[commandIndex + 1]) {
      validateShellCommandText(args[commandIndex + 1], capability, depth + 1);
    }
  }

  if (['env', 'command', 'nohup'].includes(bin)) {
    const nested = unwrapCommandWrapper(bin, args);
    if (nested.length > 0) validateFullAccessCommandArgv(nested, capability, depth + 1);
  }
}

function diskutilCommandIsDestructive(args: string[]): boolean {
  const text = args.join(' ');
  return /(?:^|\s)(?:erase\w*|partition\w*|secured?erase|zerodisk|randomdisk|resetfusion)(?:\s|$)/.test(text)
    || /(?:^|\s)apfs\s+(?:delete|erase|destroy)\w*/.test(text)
    || /(?:^|\s)appleraid\s+delete(?:\s|$)/.test(text);
}

function gitCommandDiscardsWorktree(args: string[]): boolean {
  if (args[0] === 'clean' || args[0] === 'restore') return true;
  if (args[0] === 'reset' && args.includes('--hard')) return true;
  return args[0] === 'checkout' && args.includes('--');
}

function validateShellCommandText(command: string, capability: string, depth: number): void {
  const segments = command.split(/(?:&&|\|\||[;|\n])/u);
  for (const segment of segments) {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
      .map((token) => token.replace(/^(['"])(.*)\1$/, '$2'))
      .filter(Boolean);
    if (tokens.length > 0) validateFullAccessCommandArgv(tokens, capability, depth);
  }
}

function unwrapCommandWrapper(bin: string, args: string[]): string[] {
  let index = 0;
  if (bin === 'env') {
    while (index < args.length) {
      const arg = args[index];
      if (arg === '-u') {
        index += 2;
        continue;
      }
      if (arg.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
        index += 1;
        continue;
      }
      break;
    }
  } else {
    while (index < args.length && args[index].startsWith('-')) index += 1;
  }
  return args.slice(index);
}

function commandPolicyForProfile(profile: PermissionProfile): string {
  return profile === 'danger_full_access' ? 'full_access_blacklist_v1' : 'sandbox_allowlist_v1';
}

function validateShellWorkspaceArgs(
  args: string[],
  cwd: string,
  settings: WorkspaceSettings,
  mustExist: boolean,
  mode: 'known_paths' | 'all_non_flags',
): void {
  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (shellFlagContainsAbsolutePath(arg)) throw policyDenied('shell_command flags must not contain absolute paths');
      continue;
    }
    if (mode === 'known_paths' && !shellArgLooksLikePath(arg, cwd)) continue;
    validateWorkspacePathArgument(arg, cwd, settings, mustExist);
  }
}

function validateSearchCommandArgv(bin: string, args: string[], cwd: string, settings: WorkspaceSettings): void {
  for (const arg of args) {
    if (['--hidden', '--no-ignore', '--no-ignore-global', '--no-ignore-parent', '--follow'].includes(arg)) {
      throw policyDenied(`${bin} flag ${arg} is not allowed in shell_command`);
    }
  }
  validateShellWorkspaceArgs(args, cwd, settings, false, 'known_paths');
}

function validateFindCommandArgv(args: string[], cwd: string, settings: WorkspaceSettings): void {
  for (const arg of args) {
    if (['-exec', '-execdir', '-ok', '-okdir', '-delete'].includes(arg)) {
      throw policyDenied(`find action ${arg} is not allowed in shell_command`);
    }
  }
  for (const arg of args) {
    if (arg.startsWith('-') || arg === '!' || arg === '(' || arg === ')') break;
    validateWorkspacePathArgument(arg, cwd, settings, true);
  }
}

function validateShellGitArgv(args: string[], cwd: string, settings: WorkspaceSettings): void {
  if (args.length === 0) throw policyDenied('git subcommand is required');
  const subcommand = args[0];
  switch (subcommand) {
    case 'status':
      for (const arg of args.slice(1)) {
        if (!allowedGitStatusArg(arg)) throw policyDenied(`git status argument ${arg} is not allowed`);
      }
      return;
    case 'diff':
      for (const arg of args.slice(1)) {
        if (arg.startsWith('--output') || arg === '--ext-diff') throw policyDenied(`git diff argument ${arg} is not allowed`);
      }
      validateShellWorkspaceArgs(args.slice(1), cwd, settings, false, 'known_paths');
      return;
    case 'log':
      for (const arg of args.slice(1)) {
        if (arg.startsWith('--output') || arg.startsWith('--exec')) throw policyDenied(`git log argument ${arg} is not allowed`);
      }
      validateShellWorkspaceArgs(args.slice(1), cwd, settings, false, 'known_paths');
      return;
    default:
      throw policyDenied(`git subcommand ${subcommand} is not allowed in shell_command`);
  }
}

function allowedGitStatusArg(arg: string): boolean {
  return ['--short', '-s', '--porcelain', '--porcelain=v1', '--porcelain=v2', '--branch', '-b', '-uno', '-u', '-uall'].includes(arg)
    || shellArgLooksLikePath(arg, '');
}

function validateWorkspacePathArgument(arg: string, cwd: string, settings: WorkspaceSettings, mustExist: boolean): void {
  let target = arg.trim();
  if (!target) throw policyDenied('empty path argument');
  if (!isAbsolute(target)) target = join(cwd, target);
  try {
    resolveWorkspaceTargetPath(target, settings, mustExist);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) throw policyDenied(`shell_command path ${arg} is not readable`);
    throw policyDenied(`shell_command path ${arg} is outside allowed workspace`);
  }
}

function validateTestCommandArgv(argv: string[], profile: PermissionProfile = 'read_only'): void {
  if (argv.length === 0) throw new Error('cmd is required');
  if (profile === 'danger_full_access') {
    validateFullAccessCommandArgv(argv, 'test_command');
    return;
  }
  for (const arg of argv) {
    if (!arg.trim() || arg.includes('\0')) throw policyDenied('test_command arguments must be non-empty strings');
  }
  const bin = basename(argv[0]);
  if (bin !== argv[0]) throw policyDenied('test_command executable paths are not allowed');
  switch (bin) {
    case 'go':
      if (argv.length >= 2 && argv[1] === 'test') {
        for (const arg of argv.slice(2)) {
          if (arg.startsWith('-exec') || arg.startsWith('-toolexec')) throw policyDenied(`go test argument ${arg} is not allowed`);
        }
        return;
      }
      break;
    case 'npm':
      if (argv.length === 2 && argv[1] === 'test') return;
      if (argv.length >= 3 && argv[1] === 'run' && allowedNPMTestScript(argv[2])) return;
      break;
    case 'pnpm':
    case 'yarn':
      if (argv.length >= 2 && allowedNPMTestScript(argv[1])) return;
      break;
  }
  throw policyDenied(`test_command executable ${bin} or script is not allowlisted`);
}

function allowedNPMTestScript(script: string): boolean {
  const value = script.trim();
  return value === 'test' || value === 'build' || value.startsWith('test:');
}

function runCommand(
  argv: string[],
  cwd: string,
  timeoutSeconds: number,
  maxOutputBytes: number,
  profile: PermissionProfile,
  allowedRoots: string[],
  mode: string,
  signal?: AbortSignal,
): Promise<CommandRunResult> {
  const tempDir = mkdtempSync(join(tmpdir(), 'joi-sandbox-'));
  for (const dir of ['go-cache', 'go-tmp', 'npm-cache', 'yarn-cache', 'pnpm-home', 'xdg-cache']) {
    mkdirSync(join(tempDir, dir), { recursive: true, mode: 0o700 });
  }
  const sandbox = commandSandbox(tempDir, cwd, profile, allowedRoots);
  const spawnArgv = sandboxedCommandArgv(argv, sandbox);
  return new Promise((resolveResult, rejectResult) => {
    const start = Date.now();
    const stdout = new LimitedOutputBuffer(maxOutputBytes);
    const stderr = new LimitedOutputBuffer(maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let spawnError = '';
    let killTimer: NodeJS.Timeout | undefined;
    const child = spawn(spawnArgv[0], spawnArgv.slice(1), {
      cwd,
      env: sandboxCommandEnv(tempDir),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      rmSync(tempDir, { recursive: true, force: true });
    };
    const killChild = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      killChild();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutSeconds * 1000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout?.on('data', (chunk) => stdout.write(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.write(Buffer.from(chunk)));
    child.on('error', (error) => {
      spawnError = error.message;
    });
    child.on('close', (code, closeSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted) {
        rejectResult(abortError(signal));
        return;
      }
      const stdoutText = redactCommandText(stdout.text());
      const stderrText = redactCommandText(stderr.text());
      const output = `${stdoutText}\n${stderrText}`.trimEnd();
      let status = code === 0 ? 'completed' : 'failed';
      let exitCode = typeof code === 'number' ? code : 1;
      let error = spawnError;
      if (timedOut) {
        status = 'timed_out';
        exitCode = 1;
        error = 'command timed out';
      } else if (closeSignal && !spawnError) {
        status = 'aborted';
        error = `command terminated by ${closeSignal}`;
      }
      resolveResult({
        status,
        exit_code: exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        output,
        truncated: stdout.truncated || stderr.truncated,
        duration_ms: Date.now() - start,
        mode,
        sandbox,
        error,
      });
    });
  });
}

function commandSandbox(tempDir: string, cwd: string, profile: PermissionProfile, allowedRoots: string[]): CommandSandbox {
  if (profile === 'danger_full_access') {
    return {
      engine: 'none',
      enforced: false,
      permission_profile: profile,
      temp_dir: tempDir,
      writable_roots: ['/'],
      reason: 'Host execution enabled for danger_full_access; guarded by full_access_blacklist_v1',
    };
  }
  const writableRoots = sandboxWritableRoots(tempDir, profile, allowedRoots);
  if (platform() !== 'darwin') {
    return {
      engine: 'none',
      enforced: false,
      permission_profile: profile,
      temp_dir: tempDir,
      writable_roots: writableRoots,
      reason: 'sandbox-exec is only available on macOS',
    };
  }
  if (!existsSync('/usr/bin/sandbox-exec')) {
    return {
      engine: 'none',
      enforced: false,
      permission_profile: profile,
      temp_dir: tempDir,
      writable_roots: writableRoots,
      reason: 'macOS sandbox-exec is unavailable',
    };
  }
  const profilePath = join(tempDir, 'sandbox.sb');
  writeFileSync(profilePath, sandboxProfileText(writableRoots), { mode: 0o600 });
  return {
    engine: 'sandbox-exec',
    enforced: true,
    permission_profile: profile,
    temp_dir: tempDir,
    writable_roots: writableRoots,
    profile_path: profilePath,
    reason: `macOS sandbox-exec write boundary for cwd ${cwd}`,
  };
}

function sandboxedCommandArgv(argv: string[], sandbox: CommandSandbox): string[] {
  if (sandbox.enforced && sandbox.profile_path) return ['/usr/bin/sandbox-exec', '-f', sandbox.profile_path, ...argv];
  return argv;
}

function sandboxWritableRoots(tempDir: string, profile: PermissionProfile, allowedRoots: string[]): string[] {
  const roots = [
    tempDir,
    '/tmp',
    '/private/tmp',
    '/dev',
  ];
  if (permissionProfileAllowsWorkspaceWrite(profile)) roots.push(...allowedRoots);
  return uniquePaths(roots.map((root) => safeRealPath(root)));
}

function sandboxProfileText(writableRoots: string[]): string {
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read*)',
    ...writableRoots.map((root) => `(allow file-write* (subpath ${JSON.stringify(root)}))`),
  ].join('\n');
}

function uniquePaths(paths: string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    if (!path || result.some((existing) => existing === path || pathWithinRoot(path, existing))) continue;
    result.push(path);
  }
  return result;
}

function safeRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' && reason.trim() ? reason : 'command execution aborted');
  error.name = 'AbortError';
  return error;
}

class LimitedOutputBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private readonly limit: number;
  public truncated = false;

  constructor(limit: number) {
    this.limit = limit;
  }

  write(chunk: Buffer): void {
    const remaining = this.limit - this.size;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.size += remaining;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function sandboxCommandEnv(tempDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TMPDIR: tempDir,
    GOCACHE: join(tempDir, 'go-cache'),
    GOTMPDIR: join(tempDir, 'go-tmp'),
    NPM_CONFIG_CACHE: join(tempDir, 'npm-cache'),
    YARN_CACHE_FOLDER: join(tempDir, 'yarn-cache'),
    PNPM_HOME: join(tempDir, 'pnpm-home'),
    XDG_CACHE_HOME: join(tempDir, 'xdg-cache'),
  };
}

function parseWorkspaceApplyPatch(patch: string): WorkspacePatchOp[] {
  const lines = patch.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  if (lines.length < 2 || lines[0].trim() !== '*** Begin Patch') throw new Error('patch must start with *** Begin Patch');
  const ops: WorkspacePatchOp[] = [];
  for (let index = 1; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.trim() === '*** End Patch') {
      if (ops.length === 0) throw new Error('patch contains no file operations');
      return ops;
    }
    let op: WorkspacePatchOp;
    if (line.startsWith('*** Add File: ')) {
      op = { kind: 'add', path: line.replace('*** Add File: ', '').trim(), lines: [] };
    } else if (line.startsWith('*** Update File: ')) {
      op = { kind: 'update', path: line.replace('*** Update File: ', '').trim(), lines: [] };
    } else if (line.startsWith('*** Delete File: ')) {
      throw new Error('apply_patch delete file is not enabled');
    } else if (line.startsWith('*** Move to: ')) {
      throw new Error('apply_patch move file is not enabled');
    } else {
      throw new Error(`unsupported patch header: ${line}`);
    }
    if (!op.path) throw new Error('patch file path is required');
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (next.startsWith('*** ') && !next.startsWith('*** End of File')) break;
      op.lines.push(next);
      index++;
    }
    ops.push(op);
  }
  throw new Error('patch must end with *** End Patch');
}

function prepareWorkspacePatchChanges(ops: WorkspacePatchOp[], settings: WorkspaceSettings): WorkspacePatchChange[] {
  const changes: WorkspacePatchChange[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const path = resolveWorkspaceTargetPath(op.path, settings, op.kind === 'update');
    if (forbiddenWorkspaceWritePath(path, settings)) throw new Error('path is blocked by workspace write policy');
    if (seen.has(path)) throw new Error(`patch touches the same file more than once: ${path}`);
    seen.add(path);
    if (op.kind === 'add') {
      let fileExists = false;
      try {
        statSync(path);
        fileExists = true;
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code !== 'ENOENT') throw error;
      }
      if (fileExists) throw new Error(`add file already exists: ${path}`);
      const content = contentForAddPatch(op.lines);
      changes.push({
        operation: 'add',
        path,
        bytes: content.length,
        lines: countLines(content.toString('utf8')),
        mode: 0o644,
        content,
        beforeExists: false,
        beforeContent: Buffer.alloc(0),
      });
      continue;
    }
    const info = statSync(path);
    if (info.isDirectory()) throw new Error('apply_patch update path must be a file');
    const beforeContent = readFileSync(path);
    const next = contentForUpdatePatch(beforeContent.toString('utf8'), op.lines);
    const content = Buffer.from(next, 'utf8');
    changes.push({
      operation: 'update',
      path,
      bytes: content.length,
      lines: countLines(next),
      mode: info.mode & 0o777,
      content,
      beforeExists: true,
      beforeContent,
    });
  }
  return changes;
}

function contentForAddPatch(lines: string[]): Buffer {
  let content = '';
  for (const line of lines) {
    if (line === '') continue;
    if (!line.startsWith('+')) throw new Error('add file patch lines must start with +');
    content += `${line.slice(1)}\n`;
  }
  return Buffer.from(content, 'utf8');
}

function contentForUpdatePatch(original: string, patchLines: string[]): string {
  const hunks = splitWorkspacePatchHunks(patchLines);
  if (hunks.length === 0) throw new Error('update patch contains no hunks');
  let next = original;
  let cursor = 0;
  for (const hunk of hunks) {
    const { oldBlock, newBlock } = hunkBlocks(hunk);
    if (!oldBlock) throw new Error('update hunk must include context or removed lines');
    const index = next.slice(cursor).indexOf(oldBlock);
    if (index < 0) throw new Error('update hunk did not match target file');
    const start = cursor + index;
    next = next.slice(0, start) + newBlock + next.slice(start + oldBlock.length);
    cursor = start + newBlock.length;
  }
  return next;
}

function splitWorkspacePatchHunks(lines: string[]): string[][] {
  const hunks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current.length > 0) hunks.push(current);
      current = [];
      continue;
    }
    if (line.startsWith('*** End of File') || line === '') continue;
    current.push(line);
  }
  if (current.length > 0) hunks.push(current);
  return hunks;
}

function hunkBlocks(lines: string[]): { oldBlock: string; newBlock: string } {
  let oldBlock = '';
  let newBlock = '';
  for (const line of lines) {
    if (line === '') continue;
    const prefix = line[0];
    const text = `${line.slice(1)}\n`;
    switch (prefix) {
      case ' ':
        oldBlock += text;
        newBlock += text;
        break;
      case '-':
        oldBlock += text;
        break;
      case '+':
        newBlock += text;
        break;
      default:
        throw new Error(`unsupported update patch line: ${line}`);
    }
  }
  return { oldBlock, newBlock };
}

function writeWorkspaceFileAtomic(path: string, content: Buffer, mode: number): void {
  const tempPath = join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
  try {
    writeFileSync(tempPath, content);
    chmodSync(tempPath, mode);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function restoreWorkspacePatchChange(change: WorkspacePatchChange): void {
  if (!change.beforeExists) {
    rmSync(change.path, { force: true });
    return;
  }
  writeWorkspaceFileAtomic(change.path, change.beforeContent, change.mode);
}

function hashWorkspaceContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function resolveWorkspaceTargetPath(pathInput: string, settings: WorkspaceSettings, mustExist: boolean): string {
  const normalized = normalizeWorkspaceSettings(settings);
  const allowedRoots = realAndLogicalWorkspaceRoots(normalized.allowed_roots);
  const raw = pathInput.trim();
  if (!raw) throw new Error('workspace path is required');
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(normalized.default_root, raw);
  if (mustExist) {
    const real = realpathSync(candidate);
    if (!allowedRoots.some((root) => pathWithinRoot(real, root))) throw new Error('workspace path is outside allowed roots');
    return real;
  }
  const parent = existingParent(candidate);
  const parentReal = realpathSync(parent);
  const resolved = resolve(parentReal, relative(parent, candidate));
  if (!allowedRoots.some((root) => pathWithinRoot(resolved, root))) throw new Error('workspace path is outside allowed roots');
  return resolved;
}

function realAndLogicalWorkspaceRoots(roots: string[]): string[] {
  const resolvedRoots = new Set<string>();
  for (const root of roots) {
    const logicalRoot = resolve(root);
    resolvedRoots.add(logicalRoot);
    try {
      resolvedRoots.add(realpathSync(logicalRoot));
    } catch {
      // The normalized logical root still provides the boundary for a not-yet-created root.
    }
  }
  return [...resolvedRoots];
}

function existingParent(path: string): string {
  let current = dirname(path);
  for (;;) {
    try {
      if (statSync(current).isDirectory()) return current;
    } catch {
      // Continue walking upward until an existing parent is found.
    }
    const next = dirname(current);
    if (next === current) throw new Error(`workspace parent does not exist: ${path}`);
    current = next;
  }
}

function forbiddenWorkspaceWritePath(path: string, settings: WorkspaceSettings): boolean {
  const roots = realAndLogicalWorkspaceRoots(normalizeWorkspaceSettings(settings).allowed_roots);
  const containingRoot = roots
    .filter((root) => pathWithinRoot(path, root))
    .sort((left, right) => right.length - left.length)[0];
  const relativePath = containingRoot ? relative(containingRoot, path) : path;
  const scopedPath = `/${relativePath.replaceAll('\\', '/')}`;
  if (shellArgReferencesBlockedPath(scopedPath)) return true;
  for (const part of relativePath.split(/[\\/]+/)) {
    if (['.git', '.codex', 'node_modules'].includes(part.toLowerCase())) return true;
  }
  return false;
}

function shellArgLooksLikePath(arg: string, cwd: string): boolean {
  if (arg === '.' || arg === '..' || arg.startsWith('./') || arg.startsWith('../') || isAbsolute(arg)) return true;
  if (arg.includes('/')) return true;
  if (cwd) {
    try {
      statSync(join(cwd, arg));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function shellFlagContainsAbsolutePath(arg: string): boolean {
  return arg.includes('=/') || arg.includes(':/');
}

function shellPathHasParentTraversal(arg: string): boolean {
  const normalized = arg.replaceAll('\\', '/').split('/').filter(Boolean);
  return normalized.includes('..');
}

function shellArgReferencesBlockedPath(arg: string): boolean {
  const lower = arg.toLowerCase().replaceAll('\\', '/');
  for (const blocked of ['/.ssh', '/.git/config', '/.codex', '/.env', '/library/keychains', '/private/etc', '/etc', '/var/db']) {
    if (lower === blocked.replace(/^\//, '') || lower.includes(blocked)) return true;
  }
  for (const part of lower.split(/[\\/=:\s]+/)) {
    if (part === '.env' || part === 'id_rsa' || part.endsWith('.keychain-db')) return true;
  }
  return false;
}

function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizedPermissionProfile(value: unknown): PermissionProfile {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'workspace_write') return 'workspace_write';
  if (text === 'danger_full_access') return 'danger_full_access';
  return 'read_only';
}

function permissionProfileAllowsWorkspaceWrite(profile: PermissionProfile): boolean {
  return profile === 'workspace_write' || profile === 'danger_full_access';
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

function redactCommandText(value: string): string {
  return value
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+/gi, (_match, key) => `${key}=[REDACTED]`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function policyDenied(message: string): Error {
  return new Error(`policy_denied: ${message}`);
}
