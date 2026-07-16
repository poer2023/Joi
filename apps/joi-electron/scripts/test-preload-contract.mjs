import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function extractDesktopMethods(source) {
  const match = source.match(/desktopBindingMethods:[^=]+=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('Could not find desktopBindingMethods array');
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]).sort();
}

function extractSqliteHandlers(source) {
  const start = source.indexOf('const sqliteApi: Record<DesktopIpcMethod, Handler> = {');
  const endRelative = start >= 0 ? source.slice(start).search(/\n  };\n\n  (?:if \(!envFlagValue\(process\.env\.JOI_DISABLE_CLI_HOST\)\)|startBrowserBridgeIfEnabled|ipcMain\.(?:removeHandler|handle))/) : -1;
  const end = endRelative >= 0 ? start + endRelative : -1;
  if (start < 0 || end < 0) {
    throw new Error('Could not find SQLite DesktopApi handlers');
  }
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s{4}(?:async\s+)?([A-Z][A-Za-z0-9]*)\(/gm)].map((item) => item[1]).sort();
}

const desktopApiContract = read('packages/shared-types/src/desktop-api.ts');
const preload = read('apps/joi-electron/src/preload/index.ts');
const ipc = read('apps/joi-electron/src/main/ipc.ts');
const imessageInbound = read('apps/joi-electron/src/main/imessage-inbound.ts');
const desktopFrontend = read('apps/joi-desktop/frontend/src/App.tsx');
const desktopBridge = read('apps/joi-desktop/frontend/src/api/desktop.ts');
const rendererRuntime = read('apps/joi-desktop/frontend/src/api/runtime.ts');
const commandHost = read('apps/joi-electron/src/main/command-host.ts');
const cli = read('apps/joi-cli/src/joi.mjs');

const contractMethods = extractDesktopMethods(desktopApiContract);
const sqliteHandlers = extractSqliteHandlers(ipc);

const missingHandlers = contractMethods.filter((method) => !sqliteHandlers.includes(method));
const extraHandlers = sqliteHandlers.filter((method) => !contractMethods.includes(method));

if (missingHandlers.length > 0) {
  fail(`Electron SQLite DesktopApi is missing handlers: ${missingHandlers.join(', ')}`);
}
if (extraHandlers.length > 0) {
  fail(`Electron SQLite DesktopApi has handlers outside the shared contract: ${extraHandlers.join(', ')}`);
}

for (const required of ['contextBridge.exposeInMainWorld', 'invoke<T = unknown>', 'onRunEvent', 'terminal:', 'joi:terminal:start', 'joi:terminal:event', 'getVersion', 'openExternal']) {
  if (!preload.includes(required)) {
    fail(`preload API is missing required surface: ${required}`);
  }
}

for (const required of ['z.enum(desktopIpcMethods)', 'TerminalSessionManager', "ipcMain.handle('joi:invoke'", "ipcMain.handle('joi:terminal:start'", "ipcMain.handle('joi:terminal:input'", "ipcMain.handle('joi:terminal:resize'", "ipcMain.handle('joi:terminal:kill'", "ipcMain.handle('joi:terminal:getStatus'", "ipcMain.handle('joi:app:getVersion'", "ipcMain.handle('joi:app:openExternal'"]) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing required guard: ${required}`);
  }
}

for (const required of ['startJoiCommandHost(', 'defaultJoiCommandSocketPath(', 'handlers: sqliteApi', 'riskForMethod: ipcRiskLevel']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing CLI command-host integration: ${required}`);
  }
}

for (const required of ['desktopBindingMethods', "| 'subscribe'", "| 'terminal_start'", "| 'terminal_input'", "| 'terminal_resize'", "| 'terminal_kill'", "| 'terminal_status'", 'cliAuxiliaryOperations', 'methodRequiresCliConfirmation', 'chmodSync(options.socketPath, 0o600)', 'dispatchJoiCommand(', 'publishJoiRunEvent(', 'publishJoiTerminalEvent(', 'format: \'jsonl\'']) {
  if (!commandHost.includes(required)) {
    fail(`CLI command host is missing required contract: ${required}`);
  }
}

for (const required of ["command === 'commands'", "command === 'chat'", "command === 'invoke'", "command === 'call'", "command === 'watch'", "action === 'attach'", "action: 'terminal_start'", "action: 'terminal_input'", "action: 'terminal_resize'", "action: 'terminal_kill'", "action: 'terminal_status'", 'subscription.started', 'JOI_CLI_HEADLESS', 'ELECTRON_RUN_AS_NODE', '--no-start', '--yes', '--follow', '--after-seq']) {
  if (!cli.includes(required)) {
    fail(`CLI client is missing required surface: ${required}`);
  }
}

for (const required of ['fetchAvailableModels(', 'testModelConnection(', 'testTelegramConnection(', 'sendTestTelegramMessage(', 'secrets.status()', 'secrets.save(', 'store.replaceFetchedModels(']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing real secret/model integration: ${required}`);
  }
}

for (const forbidden of ['createMockDesktopApi', 'sendMockChat(', 'mockDesktopApi']) {
  if (ipc.includes(forbidden)) {
    fail(`main IPC router still has mock fallback wiring: ${forbidden}`);
  }
}

for (const required of ['runLiveElectronToolCallingChat(', 'AbortController', 'activeToolCallingRuns', 'runChatCompletionsToolTurn(', 'compileElectronCapabilityTools(', 'store.beginToolCallingChat(', 'store.finishToolCallingChat(', 'store.failToolCallingChat(', 'store.assembleToolCallingPrompt(', 'store.loadApprovedToolCallingResume(', 'store.completeApprovedToolCallingResume(', 'canRunRealToolCalling(']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing real TS tool-calling chat integration: ${required}`);
  }
}

for (const required of ['allowed_capabilities: agentCapabilities', "tool_execution: 'parallel'", 'beforeToolCall:', 'max_tool_result_bytes:', 'model_max_retries']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing production Agent Kernel policy: ${required}`);
  }
}

for (const required of ['executeWorkspaceSearch(', 'executeFileAnalyze(', 'executeFileRead(', 'executeWebResearch(', 'executeShellCommand(', 'executeTestCommand(', 'executeApplyPatch(', 'executeComputerObserve(', 'BrowserWorkbenchManager', 'executeBrowserWorkbenchAction(', 'browserRequestFromCapability(', 'executeDesktopAppList(', 'executeDesktopAppInspect(', 'executeSystemHealthCheck(', 'executeServerDiagnose(']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing real TS workspace/file capability integration: ${required}`);
  }
}

for (const required of ['startWorkerGateway(', 'resolveToken: () => secrets.resolve', 'workerGateway?.close()']) {
  if (!read('apps/joi-electron/src/main/index.ts').includes(required)) {
    fail(`Electron main lifecycle is missing Worker Gateway integration: ${required}`);
  }
}

for (const required of ['sidecarNodeRuntime(', 'process.execPath', 'ELECTRON_RUN_AS_NODE', "this.sidecar?.once('error'"]) {
  if (!imessageInbound.includes(required)) {
    fail(`iMessage Photon sidecar spawn is missing packaged Electron guard: ${required}`);
  }
}

if (imessageInbound.includes("PHOTON_NODE_BIN || 'node'") || imessageInbound.includes('PHOTON_NODE_BIN || "node"')) {
  fail('iMessage Photon sidecar must not fall back to a bare node binary in the packaged app');
}

for (const required of ['store.restoreBackup(', 'store.listProductTasks(', 'store.getProductTask(', 'store.listArtifacts(', 'store.getArtifact(', 'store.listOpenLoops(', 'store.listProactiveMessages(', 'store.decideProactiveMessage(']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing SQLite product/restore integration: ${required}`);
  }
}

if (desktopFrontend.includes('../wailsjs/runtime/runtime')) {
  fail('renderer App still imports the Wails runtime directly');
}

for (const forbidden of ['window.go', 'DesktopApp', 'window.runtime', 'EventsOnMultiple', 'EventsOn']) {
  if (desktopBridge.includes(forbidden) || rendererRuntime.includes(forbidden)) {
    fail(`renderer still depends on the Wails bridge/runtime: ${forbidden}`);
  }
}

for (const required of ["mapped.WrapMCPTool", "server_id: serverID", "tool_name: toolName", "request: req"]) {
  if (!desktopBridge.includes(required)) {
    fail(`renderer Electron bridge is missing WrapMCPTool payload packing: ${required}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`preload contract ok: ${contractMethods.length + 9} interface operations covered (${contractMethods.length} DesktopApi + 9 auxiliary)`);
