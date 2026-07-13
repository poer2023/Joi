import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THREAD_START_NEEDLE = `    const response = await this.codexClient.threadStart({
      config: await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers),
      modelProvider: this.getModelProvider(),
      cwd: request.cwd
    });`;

const THREAD_START_REPLACEMENT = `    const response = await this.codexClient.threadStart({
      config: await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers),
      modelProvider: this.getModelProvider(),
      cwd: request.cwd,
      ephemeral: process.env.JOI_ACP_EPHEMERAL !== "0"
    });`;

const FULL_ACCESS_APPROVAL_NEEDLE = `    "never",
    { "type": "dangerFullAccess" },
    "danger-full-access"`;

const FULL_ACCESS_APPROVAL_REPLACEMENT = `    "untrusted",
    { "type": "dangerFullAccess" },
    "danger-full-access"`;

export function patchCodexACPSource(source) {
  const threadStartOccurrences = source.split(THREAD_START_NEEDLE).length - 1;
  if (threadStartOccurrences !== 1) {
    throw new Error(`Unsupported codex-acp adapter: expected one threadStart target, found ${threadStartOccurrences}`);
  }
  const approvalOccurrences = source.split(FULL_ACCESS_APPROVAL_NEEDLE).length - 1;
  if (approvalOccurrences !== 1) {
    throw new Error(`Unsupported codex-acp adapter: expected one full-access approval target, found ${approvalOccurrences}`);
  }
  return source
    .replace(THREAD_START_NEEDLE, THREAD_START_REPLACEMENT)
    .replace(FULL_ACCESS_APPROVAL_NEEDLE, FULL_ACCESS_APPROVAL_REPLACEMENT);
}

export async function prepareEphemeralCodexACP(adapterPath) {
  const sourcePath = resolve(String(adapterPath || ''));
  const info = await lstat(sourcePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('codex-acp adapter must be a regular file');
  if (info.size <= 0 || info.size > 16 * 1024 * 1024) throw new Error('codex-acp adapter size is invalid');
  const source = await readFile(sourcePath, 'utf8');
  const patched = patchCodexACPSource(source);
  const digest = createHash('sha256').update(patched).digest('hex').slice(0, 20);
  const outputPath = resolve(dirname(sourcePath), `.joi-ephemeral-${digest}.mjs`);
  try {
    const existing = await readFile(outputPath, 'utf8');
    if (existing === patched) return outputPath;
  } catch {
    // The first launch creates the deterministic, adapter-local cache below.
  }
  const temporary = `${outputPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, patched, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, outputPath);
  await chmod(outputPath, 0o600);
  return outputPath;
}

async function main() {
  const adapterPath = process.argv[2];
  if (!adapterPath) throw new Error('codex-acp adapter path is required');
  const patchedPath = await prepareEphemeralCodexACP(adapterPath);
  const child = spawn(process.execPath, [patchedPath, ...process.argv.slice(3)], {
    cwd: process.cwd(),
    env: { ...process.env, JOI_ACP_EPHEMERAL: process.env.JOI_ACP_EPHEMERAL || '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  const forward = (signal) => {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, forward);
  const result = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
  for (const signal of signals) process.off(signal, forward);
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.code ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Joi ephemeral codex-acp launcher failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
