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
  const end = source.indexOf('\n  };\n\n  ipcMain.handle', start);
  if (start < 0 || end < 0) {
    throw new Error('Could not find SQLite DesktopApi handlers');
  }
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s{4}(?:async\s+)?([A-Z][A-Za-z0-9]*)\(/gm)].map((item) => item[1]).sort();
}

const desktopApiContract = read('packages/shared-types/src/desktop-api.ts');
const preload = read('apps/joi-electron/src/preload/index.ts');
const ipc = read('apps/joi-electron/src/main/ipc.ts');
const desktopFrontend = read('apps/joi-desktop/frontend/src/App.tsx');
const desktopBridge = read('apps/joi-desktop/frontend/src/api/desktop.ts');
const rendererRuntime = read('apps/joi-desktop/frontend/src/api/runtime.ts');

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

for (const required of ['contextBridge.exposeInMainWorld', 'invoke<T = unknown>', 'onRunEvent', 'getVersion', 'openExternal']) {
  if (!preload.includes(required)) {
    fail(`preload API is missing required surface: ${required}`);
  }
}

for (const required of ['z.enum(desktopIpcMethods)', "ipcMain.handle('joi:invoke'", "ipcMain.handle('joi:app:getVersion'", "ipcMain.handle('joi:app:openExternal'"]) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing required guard: ${required}`);
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

for (const required of ['executeWorkspaceSearch(', 'executeFileAnalyze(', 'executeFileRead(', 'executeWebResearch(', 'executeShellCommand(', 'executeTestCommand(', 'executeApplyPatch(', 'executeComputerObserve(', 'executeBrowserObserve(', 'executeBrowserNavigate(', 'executeBrowserClick(', 'executeBrowserType(', 'executeDesktopAppList(', 'executeDesktopAppInspect(', 'executeSystemHealthCheck(', 'executeServerDiagnose(']) {
  if (!ipc.includes(required)) {
    fail(`main IPC router is missing real TS workspace/file capability integration: ${required}`);
  }
}

for (const required of ['startWorkerGateway(', 'resolveToken: () => secrets.resolve', 'workerGateway?.close()']) {
  if (!read('apps/joi-electron/src/main/index.ts').includes(required)) {
    fail(`Electron main lifecycle is missing Worker Gateway integration: ${required}`);
  }
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

console.log(`preload contract ok: ${contractMethods.length} DesktopApi methods covered`);
