import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import {
  executeAct,
  executeExpandUi,
  executeFind,
  executeInspectUi,
  executeObserve,
  executeReadText,
  executeSearchUi,
  executeWaitFor,
} from '@injaneity/pi-computer-use/src/bridge.ts';
import { macosHelper } from '@injaneity/pi-computer-use/src/platform/macos/helper.ts';
import {
  shouldRecoverPiWriteSuccessorFailure,
  shouldRetryPiComputerUseFailure,
} from '../../../../packages/runtime/src/pi-computer-use-policy.ts';
import type { ExtensionContext } from './pi-coding-agent-shim';

export const joiPiComputerUseTools = [
  'find_roots',
  'observe_ui',
  'search_ui',
  'expand_ui',
  'inspect_ui',
  'act_ui',
  'read_text',
  'wait_for',
] as const;

export type JoiPiComputerUseTool = typeof joiPiComputerUseTools[number];

type PiExecutor = (
  callID: string,
  params: never,
  signal: AbortSignal | undefined,
  onUpdate: undefined,
  context: ExtensionContext,
) => Promise<{ content?: Array<Record<string, unknown>>; details?: unknown }>;

const require = createRequire(import.meta.url);
const helperExecutable = '/Applications/pi-computer-use.app/Contents/MacOS/bridge';
const executors: Record<JoiPiComputerUseTool, PiExecutor> = {
  find_roots: executeFind as PiExecutor,
  observe_ui: executeObserve as PiExecutor,
  search_ui: executeSearchUi as PiExecutor,
  expand_ui: executeExpandUi as PiExecutor,
  inspect_ui: executeInspectUi as PiExecutor,
  act_ui: executeAct as PiExecutor,
  read_text: executeReadText as PiExecutor,
  wait_for: executeWaitFor as PiExecutor,
};

let helperSetup: Promise<void> | undefined;
let helperRecovery: Promise<void> | undefined;
const piStateSnapshots = new Map<string, PiStateSnapshot>();

type PiStateSnapshot = {
  state_id: string;
  root?: string;
  app?: string;
  window_title?: string;
  nodes: Array<{ text: string; role: string; value: string }>;
};

export async function executeJoiPiComputerUse(
  requestedTool: string,
  rawInputs: Record<string, unknown>,
  options: {
    cwd: string;
    signal?: AbortSignal;
    capture_dir?: string;
    interactive?: boolean;
    /** Harness-only fault injection; never populated by IPC/model input. */
    test_fail_successor_capture_after_act?: boolean;
  },
): Promise<Record<string, unknown>> {
  const { tool, inputs } = normalizeToolRequest(requestedTool, rawInputs);
  await ensurePiComputerUseHelper(options.signal);
  const context: ExtensionContext = {
    cwd: options.cwd,
    hasUI: options.interactive !== false,
    ui: {
      notify(message, level) {
        if (level === 'error') console.warn(`[pi-computer-use] ${message}`);
      },
      async select(title, choices) {
        if (options.interactive === false) return undefined;
        const result = await dialog.showMessageBox({
          type: 'info',
          title: 'Joi Computer Use 权限',
          message: title,
          buttons: choices,
          cancelId: Math.max(0, choices.findIndex((choice) => choice === 'Cancel')),
          defaultId: 0,
          noLink: true,
        });
        return choices[result.response];
      },
    },
    sessionManager: { getBranch: () => [] },
  };
  let result;
  try {
    result = await executePiTool(tool, inputs, options.signal, context);
    if (tool === 'act_ui' && options.test_fail_successor_capture_after_act) {
      throw new Error('Capture timed out while capturing window after checked test action');
    }
  } catch (error) {
    if (shouldRecoverPiWriteSuccessorFailure(tool, error, options.signal?.aborted === true)) {
      result = await recoverPiWriteSuccessor(
        inputs,
        options.signal,
        context,
        error,
        options.test_fail_successor_capture_after_act === true,
      );
    } else {
      if (!shouldRetryPiComputerUseFailure(tool, error, options.signal?.aborted === true) || process.platform !== 'darwin') throw error;
      await recoverPiHelper(options.signal, error);
      result = await executePiTool(tool, inputs, options.signal, context);
    }
  }
  rememberPiState(result);
  return await normalizePiResult(tool, result, options.capture_dir || join(app.getPath('userData'), 'computer-use', 'captures'));
}

async function executePiTool(
  tool: JoiPiComputerUseTool,
  inputs: Record<string, unknown>,
  signal: AbortSignal | undefined,
  context: ExtensionContext,
) {
  return await executors[tool](`joi_pi_${randomUUID()}`, inputs as never, signal, undefined, context);
}

async function recoverPiHelper(signal: AbortSignal | undefined, originalError: unknown): Promise<void> {
  if (!helperRecovery) {
    helperRecovery = macosHelper.restart(signal).catch((restartError) => {
      const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
      const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
      throw new Error(`Pi computer-use read failed transiently (${originalMessage}); helper recovery failed (${restartMessage}).`);
    }).finally(() => {
      helperRecovery = undefined;
    });
  }
  await helperRecovery;
}

async function recoverPiWriteSuccessor(
  inputs: Record<string, unknown>,
  signal: AbortSignal | undefined,
  context: ExtensionContext,
  originalError: unknown,
  includeTestDebug = false,
): Promise<{ content?: Array<Record<string, unknown>>; details?: unknown }> {
  const baseStateId = stringValue(inputs.stateId);
  const base = baseStateId ? piStateSnapshots.get(baseStateId) : undefined;
  if (!base?.root && !base?.window_title) {
    throw new Error(
      `Pi act_ui may have reached the target, but successor capture failed and the target could not be recovered without replaying the action: ${errorMessage(originalError)}`,
    );
  }

  // This is deliberately a read-only semantic observation. The original
  // action is never dispatched again after a successor capture failure.
  const recovered = await executePiTool('observe_ui', {
    ...(base.root ? { root: base.root } : { app: base.app, windowTitle: base.window_title }),
    image: 'never',
    mode: 'semantic',
    readText: 'never',
  }, signal, context);
  let successor = recovered;
  let recoveredSnapshot = snapshotFromPiResult(recovered);
  const expect = isRecord(inputs.expect) ? inputs.expect : undefined;
  let livePostconditionSatisfied: boolean | undefined;
  const expectedText = expect ? stringValue(expect.text) : '';
  const expectedRole = expect ? stringValue(expect.role) : '';
  const expectedValue = expect ? stringValue(expect.value) : '';
  if (expect && recoveredSnapshot?.state_id && !expectedValue && (expectedText || expectedRole)) {
    successor = await executePiTool('wait_for', {
      stateId: recoveredSnapshot.state_id,
      ...(expectedText ? { text: expectedText } : {}),
      ...(expectedRole ? { role: expectedRole } : {}),
      gone: expect.gone === true,
      timeoutMs: Number.isFinite(Number(expect.timeoutMs)) ? Math.max(100, Math.trunc(Number(expect.timeoutMs))) : 10_000,
      image: 'never',
    }, signal, context);
    const waitDetails = isRecord(successor.details) ? successor.details : {};
    livePostconditionSatisfied = waitDetails.found === true;
    recoveredSnapshot = snapshotFromPiResult(successor) || recoveredSnapshot;
  }
  const verification = expect && recoveredSnapshot
    ? evaluateRecoveredPostcondition(base, recoveredSnapshot, expect, livePostconditionSatisfied)
    : undefined;
  const outcome = verification
    ? verification.status === 'failed' ? 'didnt' : 'worked'
    : 'unknown';
  const observedDetails = isRecord(recovered.details) ? recovered.details : {};
  const recoveredDetails = isRecord(successor.details) ? successor.details : {};
  const error = errorMessage(originalError);
  const recovery = {
    reason: 'successor_capture_failed',
    original_error: error,
    action_replayed: false,
    semantic_successor_observed: true,
    postcondition_rechecked: livePostconditionSatisfied !== undefined,
    state_recovered: Boolean(recoveredSnapshot?.state_id),
    ...(includeTestDebug ? {
      test_debug: {
        before_nodes: base.nodes.length,
        after_nodes: recoveredSnapshot?.nodes.length || 0,
        serial_nodes: (recoveredSnapshot?.nodes || [])
          .filter((node) => `${node.text} ${node.value}`.includes('串行'))
          .slice(0, 20),
      },
    } : {}),
  };
  const execution: Record<string, unknown> = {
    strategy: 'act',
    outcome,
    verification,
    recovery,
  };
  if (verification?.status === 'failed') {
    execution.error = {
      code: 'postcondition_failed_after_semantic_recovery',
      message: 'The action was not replayed and the recovered semantic successor did not satisfy the requested postcondition.',
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: `Pi successor image capture failed after act_ui. Joi did not replay the action and recovered a fresh semantic state${recoveredSnapshot?.state_id ? ` ${recoveredSnapshot.state_id}` : ''}.`,
      },
      ...(successor.content || []),
    ],
    details: {
      ...recoveredDetails,
      target: recoveredDetails.target || observedDetails.target,
      tool: 'act_ui',
      baseStateId: baseStateId || undefined,
      execution,
      recovery,
    },
  };
}

function evaluateRecoveredPostcondition(
  before: PiStateSnapshot,
  after: PiStateSnapshot,
  expect: Record<string, unknown>,
  liveSatisfied?: boolean,
): { status: 'verified' | 'preexisting' | 'failed'; text?: string; role?: string; value?: string; gone?: boolean; timeoutMs: number } {
  const text = stringValue(expect.text) || undefined;
  const role = stringValue(expect.role) || undefined;
  const value = stringValue(expect.value) || undefined;
  const gone = expect.gone === true;
  const beforePresent = snapshotMatchesExpectation(before, { text, role, value });
  const afterPresent = snapshotMatchesExpectation(after, { text, role, value });
  const satisfied = liveSatisfied ?? (gone ? !afterPresent : afterPresent);
  const desiredWasPreexisting = gone ? !beforePresent : beforePresent;
  return {
    status: !satisfied ? 'failed' : desiredWasPreexisting ? 'preexisting' : 'verified',
    text,
    role,
    value,
    gone: gone || undefined,
    timeoutMs: Number.isFinite(Number(expect.timeoutMs)) ? Math.max(0, Math.trunc(Number(expect.timeoutMs))) : 10_000,
  };
}

function snapshotMatchesExpectation(
  snapshot: PiStateSnapshot,
  expected: { text?: string; role?: string; value?: string },
): boolean {
  const text = expected.text?.toLocaleLowerCase();
  const role = expected.role?.toLocaleLowerCase();
  const value = expected.value?.toLocaleLowerCase();
  return snapshot.nodes.some((node) => (
    (!text || node.text.includes(text))
    && (!role || node.role.includes(role))
    && (!value || node.value.includes(value))
  ));
}

function rememberPiState(result: { details?: unknown }): void {
  const snapshot = snapshotFromPiResult(result);
  if (!snapshot) return;
  const previous = piStateSnapshots.get(snapshot.state_id);
  const merged: PiStateSnapshot = previous
    ? {
        ...snapshot,
        root: snapshot.root || previous.root,
        app: snapshot.app || previous.app,
        window_title: snapshot.window_title || previous.window_title,
        nodes: snapshot.nodes.length > 0 ? snapshot.nodes : previous.nodes,
      }
    : snapshot;
  piStateSnapshots.delete(snapshot.state_id);
  piStateSnapshots.set(snapshot.state_id, merged);
  while (piStateSnapshots.size > 256) {
    const oldest = piStateSnapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    piStateSnapshots.delete(oldest);
  }
}

function snapshotFromPiResult(result: { details?: unknown }): PiStateSnapshot | undefined {
  const details = isRecord(result.details) ? result.details : {};
  const capture = isRecord(details.capture) ? details.capture : {};
  const target = isRecord(details.target) ? details.target : {};
  const root = isRecord(details.root) ? details.root : {};
  const stateId = stringValue(details.stateId) || stringValue(capture.stateId);
  if (!stateId) return undefined;
  const nodes: PiStateSnapshot['nodes'] = [];
  collectPiOutlineNodes(details.outline, nodes, 0);
  return {
    state_id: stateId,
    root: stringValue(target.windowRef) || stringValue(root.ref) || undefined,
    app: stringValue(target.app) || undefined,
    window_title: stringValue(target.windowTitle) || stringValue(root.title) || undefined,
    nodes: nodes.slice(0, 5_000),
  };
}

function collectPiOutlineNodes(value: unknown, output: PiStateSnapshot['nodes'], depth: number): void {
  if (depth > 20 || output.length >= 5_000 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPiOutlineNodes(item, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  const role = stringValue(value.role).toLocaleLowerCase();
  const nodeValue = stringValue(value.value).toLocaleLowerCase();
  const text = [
    stringValue(value.label),
    stringValue(value.title),
    stringValue(value.name),
    stringValue(value.description),
    stringValue(value.value),
    stringValue(value.identifier),
    stringValue(value.string),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
  if (text || role || nodeValue) output.push({ text, role, value: nodeValue });
  for (const item of Object.values(value)) {
    if (typeof item === 'object' && item !== null) collectPiOutlineNodes(item, output, depth + 1);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown Pi computer-use failure');
}

export async function piComputerUseHelperStatus(): Promise<Record<string, unknown>> {
  const externalSocket = String(process.env.PI_CU_SOCKET_PATH || '').trim();
  return {
    implementation: '@injaneity/pi-computer-use',
    version: '0.4.3',
    platform: process.platform,
    helper_path: helperExecutable,
    helper_installed: process.platform !== 'darwin' || externalSocket ? true : await isExecutable(helperExecutable),
    external_socket: externalSocket || undefined,
    tools: [...joiPiComputerUseTools],
  };
}

async function ensurePiComputerUseHelper(signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'darwin' || String(process.env.PI_CU_SOCKET_PATH || '').trim()) return;
  if (await isExecutable(helperExecutable)) return;
  if (!helperSetup) {
    helperSetup = installPiHelper(signal).catch((error) => {
      helperSetup = undefined;
      throw error;
    });
  }
  await helperSetup;
}

async function installPiHelper(signal?: AbortSignal): Promise<void> {
  const packageRoot = app.isPackaged
    ? join(process.resourcesPath, 'pi-computer-use')
    : dirname(require.resolve('@injaneity/pi-computer-use/package.json'));
  const setupScript = await realpath(join(packageRoot, 'scripts', 'setup-helper.mjs'));
  await access(setupScript, fsConstants.R_OK);
  await runProcess(process.execPath, [setupScript, '--runtime'], 90_000, signal, {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  });
  if (!(await isExecutable(helperExecutable))) {
    throw new Error(`Pi computer-use helper was not installed at ${helperExecutable}`);
  }
}

function normalizeToolRequest(requestedTool: string, rawInputs: Record<string, unknown>): { tool: JoiPiComputerUseTool; inputs: Record<string, unknown> } {
  const nestedInput = isRecord(rawInputs.input) ? rawInputs.input : {};
  let toolName = requestedTool;
  let inputs = requestedTool === 'computer_use' ? { ...nestedInput, ...rawInputs } : { ...rawInputs };
  delete inputs.input;
  delete inputs.permission_profile;
  delete inputs.tool;

  if (requestedTool === 'computer_use') {
    toolName = stringValue(rawInputs.tool) || stringValue(rawInputs.action);
    if (toolName === 'observe') toolName = 'observe_ui';
    if (toolName === 'find') toolName = 'find_roots';
    if (['click', 'doubleClick', 'press', 'setText', 'typeText', 'keypress', 'scroll', 'drag', 'moveMouse', 'wait'].includes(toolName)) {
      inputs = { stateId: rawInputs.stateId, image: rawInputs.image, actions: [{ ...nestedInput, ...rawInputs, action: toolName }] };
      const action = inputs.actions as Array<Record<string, unknown>>;
      delete action[0].input;
      delete action[0].permission_profile;
      delete action[0].tool;
      toolName = 'act_ui';
    }
  }

  if (!joiPiComputerUseTools.includes(toolName as JoiPiComputerUseTool)) {
    throw new Error(`Unsupported Pi computer-use tool: ${toolName || 'missing'}`);
  }
  return { tool: toolName as JoiPiComputerUseTool, inputs };
}

async function normalizePiResult(
  tool: JoiPiComputerUseTool,
  result: { content?: Array<Record<string, unknown>>; details?: unknown },
  captureDirectory: string,
): Promise<Record<string, unknown>> {
  const text: string[] = [];
  const images: Array<Record<string, unknown>> = [];
  for (const item of result.content || []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      text.push(item.text.slice(0, 96_000));
      continue;
    }
    if (item.type === 'image' && typeof item.data === 'string') {
      images.push(await persistCapture(item, captureDirectory));
    }
  }
  const details = boundedPiDetails(result.details);
  const summary = text.join('\n').trim() || `${tool} completed.`;
  return {
    status: 'completed',
    capability: tool,
    implementation: '@injaneity/pi-computer-use@0.4.3',
    summary: summary.slice(0, 96_000),
    details,
    images,
  };
}

async function persistCapture(item: Record<string, unknown>, captureDirectory: string): Promise<Record<string, unknown>> {
  const data = Buffer.from(String(item.data || ''), 'base64');
  const mimeType = stringValue(item.mimeType) || 'image/png';
  const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png';
  const sha256 = createHash('sha256').update(data).digest('hex');
  await mkdir(captureDirectory, { recursive: true });
  const path = join(captureDirectory, `${Date.now()}-${sha256.slice(0, 16)}${extension}`);
  await writeFile(path, data, { mode: 0o600 });
  return {
    path,
    mime_type: mimeType,
    byte_count: data.length,
    sha256,
    embedded_in_trace: false,
  };
}

function boundedPiDetails(value: unknown): unknown {
  const sanitized = sanitizeStructuredValue(value, 0);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= 192_000) return sanitized;
  const details = isRecord(sanitized) ? sanitized : {};
  return {
    tool: details.tool,
    target: details.target,
    capture: details.capture,
    stateId: details.stateId,
    baseStateId: details.baseStateId,
    view: details.view,
    changes: Array.isArray(details.changes) ? details.changes.slice(0, 120) : details.changes,
    renderedOutline: typeof details.renderedOutline === 'string' ? details.renderedOutline.slice(0, 96_000) : undefined,
    execution: details.execution,
    recovery: details.recovery,
    helper: details.helper,
    truncated: true,
    original_json_chars: serialized.length,
  };
}

function sanitizeStructuredValue(value: unknown, depth: number): unknown {
  if (depth > 12) return '[depth limit]';
  if (typeof value === 'string') return value.length <= 96_000 ? value : `${value.slice(0, 96_000)}…`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => sanitizeStructuredValue(item, depth + 1));
  if (!isRecord(value)) return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 500)) {
    if ((key === 'data' || key === 'image') && typeof item === 'string' && item.length > 8_000) {
      output[key] = `[omitted ${item.length} chars]`;
    } else {
      output[key] = sanitizeStructuredValue(item, depth + 1);
    }
  }
  return output;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command: string, args: string[], timeoutMs: number, signal: AbortSignal | undefined, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill('SIGTERM');
      reject(new Error('Operation aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { output += String(chunk).slice(0, 16_000); });
    child.stderr.on('data', (chunk) => { output += String(chunk).slice(0, 16_000); });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`Pi helper setup failed (${code}): ${output.trim()}`));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function piCaptureExtension(path: string): string {
  return extname(path).toLowerCase();
}
