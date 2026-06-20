import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeApplyPatch,
  executeShellCommand,
  executeTestCommand,
} from '../src/workspace-exec.ts';

const root = mkdtempSync(join(process.cwd(), '.tmp-workspace-exec-'));
const outside = mkdtempSync(join(tmpdir(), 'joi-workspace-exec-outside-'));

try {
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'info.txt'), 'hello workspace\ntoken=SHOULD_NOT_LEAK_123456\n');
  writeFileSync(join(outside, 'secret.txt'), 'outside secret\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: {
      'test:fixture': 'node -e "console.log(\'fixture ok\')"',
      'test:slow': 'node -e "setInterval(() => {}, 1000)"',
      'test:write-root': 'node -e "require(\'node:fs\').writeFileSync(\'generated.txt\', \'written\')"',
    },
  }));
  writeFileSync(join(root, 'target.txt'), 'old\nkeep\n');

  const settings = {
    allowed_roots: [root],
    default_root: root,
    browser_allowed_hosts: [],
    web_research_allow_private_hosts: false,
    file_analyze_max_bytes: 1024,
    workspace_search_max_results: 10,
  };

  const shell = await executeShellCommand({ cmd: ['cat', 'docs/info.txt'], cwd: root, max_output_bytes: 4000 }, settings);
  assert.equal(shell.mode, 'shell_command_v1_exec_context');
  assert.equal(shell.command_status, 'completed');
  assert.ok(String(shell.output).includes('hello workspace'));
  assert.ok(!String(shell.output).includes('SHOULD_NOT_LEAK'));
  assert.ok(String(shell.output).includes('token=[REDACTED]'));
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    assert.equal(shell.sandbox.enforced, true);
    assert.equal(shell.sandbox.engine, 'sandbox-exec');
  }

  await assert.rejects(() => executeShellCommand({ cmd: ['rm', 'docs/info.txt'], cwd: root }, settings), /policy_denied/);
  await assert.rejects(() => executeShellCommand({ cmd: ['cat', join(outside, 'secret.txt')], cwd: root }, settings), /policy_denied/);

  const test = await executeTestCommand({ cmd: ['npm', 'run', 'test:fixture'], cwd: root, timeout_seconds: 30, max_output_bytes: 10000 }, settings);
  assert.equal(test.mode, 'test_command_v1_allowlisted_exec');
  assert.equal(test.test_status, 'succeeded');
  assert.ok(String(test.output).includes('fixture ok'));

  {
    const controller = new AbortController();
    const startedAt = Date.now();
    const slow = executeTestCommand({ cmd: ['npm', 'run', 'test:slow'], cwd: root, timeout_seconds: 30 }, settings, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('interrupted by test')), 100).unref();
    await assert.rejects(slow, /interrupted|abort|cancel/i);
    assert.ok(Date.now() - startedAt < 5000);
  }

  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    const generatedPath = join(root, 'generated.txt');
    const readOnlyWrite = await executeTestCommand({ cmd: ['npm', 'run', 'test:write-root'], cwd: root, timeout_seconds: 30 }, settings);
    assert.equal(readOnlyWrite.sandbox.enforced, true);
    assert.equal(readOnlyWrite.sandbox.engine, 'sandbox-exec');
    assert.equal(readOnlyWrite.test_status, 'failed');
    assert.equal(existsSync(generatedPath), false);
    const workspaceWrite = await executeTestCommand({ cmd: ['npm', 'run', 'test:write-root'], cwd: root, timeout_seconds: 30, permission_profile: 'workspace_write' }, settings);
    assert.equal(workspaceWrite.test_status, 'succeeded');
    assert.equal(readFileSync(generatedPath, 'utf8'), 'written');
  }

  await assert.rejects(() => executeTestCommand({ cmd: ['node', '-e', 'console.log(1)'], cwd: root }, settings), /policy_denied/);

  assert.throws(() => executeApplyPatch({
    permission_profile: 'read_only',
    patch: [
      '*** Begin Patch',
      '*** Update File: target.txt',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n'),
  }, settings), /policy_denied/);

  const patchResult = executeApplyPatch({
    permission_profile: 'workspace_write',
    patch: [
      '*** Begin Patch',
      '*** Update File: target.txt',
      '@@',
      '-old',
      '+new',
      ' keep',
      '*** End Patch',
    ].join('\n'),
  }, settings);
  assert.equal(patchResult.mode, 'apply_patch_v1_workspace');
  assert.equal(patchResult.changed_file_count, 1);
  assert.equal(readFileSync(join(root, 'target.txt'), 'utf8'), 'new\nkeep\n');

  const addResult = executeApplyPatch({
    permission_profile: 'workspace_write',
    patch: [
      '*** Begin Patch',
      '*** Add File: docs/added.txt',
      '+added line',
      '*** End Patch',
    ].join('\n'),
  }, settings);
  assert.equal(addResult.changed_file_count, 1);
  assert.equal(readFileSync(join(root, 'docs', 'added.txt'), 'utf8'), 'added line\n');

  assert.throws(() => executeApplyPatch({
    permission_profile: 'workspace_write',
    patch: [
      '*** Begin Patch',
      '*** Add File: ../escape.txt',
      '+escape',
      '*** End Patch',
    ].join('\n'),
  }, settings), /outside allowed roots|workspace path/);

  assert.throws(() => executeApplyPatch({
    permission_profile: 'workspace_write',
    patch: [
      '*** Begin Patch',
      '*** Add File: .git/config',
      '+blocked',
      '*** End Patch',
    ].join('\n'),
  }, settings), /blocked by workspace write policy/);

  console.log('workspace exec runtime tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
