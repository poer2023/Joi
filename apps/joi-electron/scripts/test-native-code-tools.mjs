import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeNativeLSPCapability } from '../src/main/native-lsp-capabilities.ts';
import { NativeDebuggerManager } from '../src/main/debugger-capabilities.ts';
import { executeCodeCapability } from '../src/main/code-execution-capabilities.ts';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const lspFixture = join(fixtureDir, 'native-lsp-fixture.c');
const diagnosticsFixture = join(fixtureDir, 'native-lsp-diagnostics-fixture.c');
const debuggerFixture = join(fixtureDir, 'native-debugger-fixture.c');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-native-code-tools-'));
const settings = {
  default_root: fixtureDir,
  allowed_roots: [fixtureDir, tempDir],
  diagnostic_redaction_enabled: true,
  browser_enabled: true,
  private_research_hosts: [],
};
const evidence = {};

try {
  const diagnostics = await executeNativeLSPCapability('lsp_diagnostics', { path: diagnosticsFixture }, settings);
  assert.equal(diagnostics.backend, 'clangd');
  assert.ok(diagnostics.diagnostic_count >= 1, JSON.stringify(diagnostics));
  assert.match(JSON.stringify(diagnostics.diagnostics), /missing_native_symbol/);
  evidence.diagnostics = diagnostics;

  const definition = await executeNativeLSPCapability('lsp_definition', {
    path: lspFixture,
    line: 6,
    character: 10,
  }, settings);
  assert.ok(definition.location_count >= 1, JSON.stringify(definition));
  assert.equal(definition.locations[0].range.start.line, 1);
  evidence.definition = definition;

  const references = await executeNativeLSPCapability('lsp_references', {
    path: lspFixture,
    line: 1,
    character: 5,
    include_declaration: true,
  }, settings);
  assert.ok(references.location_count >= 2, JSON.stringify(references));
  evidence.references = references;

  const hover = await executeNativeLSPCapability('lsp_hover', { path: lspFixture, line: 6, character: 10 }, settings);
  assert.match(hover.hover.text, /twice/);
  const symbols = await executeNativeLSPCapability('lsp_symbols', { path: lspFixture }, settings);
  assert.ok(symbols.symbol_count >= 2, JSON.stringify(symbols));
  const codeActions = await executeNativeLSPCapability('lsp_code_actions', { path: diagnosticsFixture, line: 1, character: 0 }, settings);
  assert.ok(Array.isArray(codeActions.actions));

  const renameFixture = join(tempDir, 'rename-fixture.c');
  copyFileSync(lspFixture, renameFixture);
  const renamed = await executeNativeLSPCapability('lsp_rename', { path: renameFixture, line: 1, character: 5, new_name: 'twice_renamed' }, settings);
  assert.ok(renamed.changed_files.includes(realpathSync(renameFixture)), JSON.stringify(renamed));
  assert.match(readFileSync(renameFixture, 'utf8'), /twice_renamed/);

  const formatFixture = join(tempDir, 'format-fixture.c');
  writeFileSync(formatFixture, 'int   add(int a,int b){return a+b;}\n');
  const formatted = await executeNativeLSPCapability('lsp_format', { path: formatFixture }, settings);
  assert.ok(formatted.edit_count >= 1, JSON.stringify(formatted));
  assert.match(readFileSync(formatFixture, 'utf8'), /int add\(int a, int b\)/);
  evidence.lsp_deep = { hover, symbols, codeActions, renamed, formatted };

  const codeJavaScript = await executeCodeCapability('execute_code', { language: 'javascript', code: 'console.log(JSON.stringify({answer: 6 * 7}))' }, settings, 'danger_full_access');
  assert.match(codeJavaScript.stdout, /"answer":42/);
  const codeTypeScript = await executeCodeCapability('execute_code', { language: 'typescript', code: 'const answer: number = 40 + 2; console.log(answer)' }, settings, 'danger_full_access');
  assert.match(codeTypeScript.stdout, /42/);
  const codePython = await executeCodeCapability('execute_code', { language: 'python', code: 'print(sum([19, 23]))' }, settings, 'danger_full_access');
  assert.match(codePython.stdout, /42/);
  const codeSwift = await executeCodeCapability('execute_code', { language: 'swift', code: 'print(6 * 7)' }, settings, 'danger_full_access');
  assert.match(codeSwift.stdout, /42/);
  const sandbox = await executeCodeCapability('sandbox_run', { cmd: ['/usr/bin/printf', 'sandbox-ok'], cwd: tempDir, network: false }, settings, 'danger_full_access');
  assert.equal(sandbox.exit_code, 0);
  assert.equal(sandbox.network_allowed, false);
  assert.match(sandbox.stdout, /sandbox-ok/);
  evidence.code_execution = { codeJavaScript, codeTypeScript, codePython, codeSwift, sandbox };

  const binary = join(tempDir, 'native-debugger-fixture');
  execFileSync('/usr/bin/clang', ['-g', '-O0', debuggerFixture, '-o', binary]);
  const manager = new NativeDebuggerManager();
  const attached = await manager.execute('debugger_attach', { target: binary }, settings, 'danger_full_access');
  const sessionID = attached.session.id;
  assert.match(sessionID, /^debug_/);
  const breakpoint = await manager.execute('debugger_breakpoint', { session_id: sessionID, symbol: 'twice' }, settings, 'danger_full_access');
  assert.match(breakpoint.output, /Breakpoint 1/);
  const run = await manager.execute('debugger_step', { session_id: sessionID, action: 'run' }, settings, 'danger_full_access');
  assert.equal(run.process_state, 'stopped');
  const evaluated = await manager.execute('debugger_evaluate', { session_id: sessionID, expression: 'value' }, settings, 'danger_full_access');
  assert.match(evaluated.output, /21/);
  const threads = await manager.execute('debugger_threads', { session_id: sessionID }, settings, 'danger_full_access');
  assert.match(threads.output, /thread #1/i);
  const stack = await manager.execute('debugger_stack', { session_id: sessionID }, settings, 'danger_full_access');
  assert.match(stack.output, /twice/);
  const locals = await manager.execute('debugger_locals', { session_id: sessionID }, settings, 'danger_full_access');
  assert.match(locals.output, /value/);
  const memory = await manager.execute('debugger_memory', { session_id: sessionID, address: '$sp', count: 4, format: 'x' }, settings, 'danger_full_access');
  assert.match(memory.output, /0x[0-9a-f]+/i);
  const watchpoint = await manager.execute('debugger_watchpoint', { session_id: sessionID, variable: 'value' }, settings, 'danger_full_access');
  assert.match(watchpoint.output, /Watchpoint/i);
  const stepped = await manager.execute('debugger_step', { session_id: sessionID, action: 'next' }, settings, 'danger_full_access');
  assert.ok(['stopped', 'ready'].includes(stepped.process_state));
  const stopped = await manager.execute('debugger_stop', { session_id: sessionID }, settings, 'danger_full_access');
  assert.equal(stopped.disposed, true);
  evidence.debugger = { attached, breakpoint, run, evaluated, threads, stack, locals, memory, watchpoint, stepped, stopped };
  assert.rejects(
    () => manager.execute('debugger_step', { session_id: sessionID, action: 'run' }, settings, 'danger_full_access'),
    /not found/,
  );
  manager.dispose();
  if (process.env.JOI_EVIDENCE_DIR) {
    mkdirSync(process.env.JOI_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.JOI_EVIDENCE_DIR, 'native-code-tools-result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('native code tools ok');
