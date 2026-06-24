#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const configPath = resolve(root, 'configs/logging_contract.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.go']);
const excludedPathPatterns = [
  /^node_modules\//,
  /^dist\//,
  /^release\//,
  /^\.next\//,
  /^scripts\/check_logging_contract\.mjs$/,
  /^scripts\/desktop_production_schema_migration\.mjs$/,
  /^packages\/[^/]+\/scripts\/test-/,
  /(^|\/)[^/]+\.test\.[cm]?[jt]sx?$/,
  /(^|\/)[^/]+_test\.go$/,
];

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const trackedChangedFiles = git(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => shouldInspectFile(file));
const untrackedFiles = new Set(git(['ls-files', '--others', '--exclude-standard'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => shouldInspectFile(file)));
const changedFiles = [...new Set([...trackedChangedFiles, ...untrackedFiles])];

const failures = [];
const suggestions = [];

for (const file of changedFiles) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const addedText = addedLines(file).join('\n');
  if (!addedText.trim()) continue;
  const analysis = analyzeFile(file, addedText);
  failures.push(...analysis.failures);
  suggestions.push(...analysis.suggestions);
}

for (const suggestion of suggestions) {
  console.warn(`logging-contract suggestion: ${suggestion}`);
}

if (failures.length > 0) {
  console.error('logging-contract failed: high-risk changes need logging coverage.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`logging-contract passed (${changedFiles.length} changed source files checked)`);

function analyzeFile(file, addedText) {
  const failures = [];
  const suggestions = [];
  const forbidden = config.forbidden_high_risk_markers.some((marker) => addedText.includes(marker));
  const hasCoverage = config.coverage_markers.some((marker) => addedText.includes(marker));
  for (const category of config.categories) {
    if (!matchesAnyPrefix(file, category.file_patterns)) continue;
    const re = new RegExp(category.match, 'i');
    if (!re.test(addedText)) continue;
    if (category.high_risk && (forbidden || !hasCoverage)) {
      failures.push(`${file}: ${category.id} (${category.risk}) requires recordAppLog, appendRunEventV2, or "joi-log-coverage: covered-by ..." in the same change. Suggested events: ${category.suggested_events.join(', ')}. Fields: level, risk_level, category, feature_key, message, duration_ms, error.`);
    }
  }
  const lowRisk = config.low_risk && matchesAnyPrefix(file, config.low_risk.file_patterns);
  if (lowRisk && /\b(onClick|useEffect|desktopApi|invoke|fetch)\b/i.test(addedText) && !hasCoverage) {
    suggestions.push(`${file}: consider ${config.low_risk.suggested_events.join(', ')} with level=debug risk_level=read_only for new UI behavior.`);
  }
  return { failures, suggestions };
}

function shouldInspectFile(file) {
  if (excludedPathPatterns.some((pattern) => pattern.test(file))) return false;
  if (!existsSync(resolve(root, file))) return false;
  const dot = file.lastIndexOf('.');
  if (dot < 0) return false;
  return sourceExtensions.has(file.slice(dot));
}

function addedLines(file) {
  if (untrackedFiles.has(file)) {
    return readFileSync(resolve(root, file), 'utf8').split('\n');
  }
  return git(['diff', '--unified=0', 'HEAD', '--', file])
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function matchesAnyPrefix(file, prefixes = []) {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function runSelfTest() {
  const highRiskNoLog = analyzeFile(
    'apps/joi-electron/src/main/new-handler.ts',
    'async function SaveDangerousThing() { await db.exec("DELETE FROM app_logs"); }',
  );
  assert(highRiskNoLog.failures.length > 0, 'high-risk IPC without logging should fail');

  const highRiskWithSameChangeCoverage = analyzeFile(
    'apps/joi-electron/src/main/new-handler.ts',
    '// joi-log-coverage: covered-by ipc wrapper start/success/failure logs\nasync function SaveDangerousThing() { await db.exec("DELETE FROM app_logs"); }',
  );
  assert(highRiskWithSameChangeCoverage.failures.length === 0, 'same-change logging coverage should pass');

  const lowRiskUI = analyzeFile(
    'apps/joi-desktop/frontend/src/Widget.tsx',
    'button onClick={() => setOpen(true)}',
  );
  assert(lowRiskUI.failures.length === 0, 'read-only UI should not fail');
  assert(lowRiskUI.suggestions.length > 0, 'read-only UI should suggest logs');

  const capabilityWithLog = analyzeFile(
    'packages/runtime/src/capability.ts',
    'recordAppLog({ feature_key: "capability.started" }); async function executeCapability() {}',
  );
  assert(capabilityWithLog.failures.length === 0, 'capability with logging should pass');
  console.log('logging-contract self-test passed');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
