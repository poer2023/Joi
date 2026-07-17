import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WorkspaceSettings } from '../../../../packages/shared-types/src/desktop-api';
import { resolveWorkspacePath } from '../../../../packages/runtime/src/capabilities.ts';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LSPNotification = { method: string; params?: unknown };
type LSPBackend = { name: string; binary: string; args: string[]; language_id: string; env?: NodeJS.ProcessEnv };

const require = createRequire(import.meta.url);

export async function executeNativeLSPCapability(
  capability: 'lsp_definition' | 'lsp_references' | 'lsp_diagnostics' | 'lsp_hover' | 'lsp_symbols' | 'lsp_code_actions' | 'lsp_rename' | 'lsp_format',
  inputs: Record<string, unknown>,
  settings: WorkspaceSettings,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const requestedPath = stringInput(inputs.path);
  if (!requestedPath) throw new Error(`${capability} path is required`);
  const sourcePath = resolveWorkspacePath(requestedPath, settings);
  const source = await readFile(sourcePath, 'utf8');
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new Error('LSP source file exceeds 2 MiB');
  const backend = backendForPath(sourcePath);
  const client = new NativeLSPClient(backend.binary, backend.args, signal, backend.env);
  const uri = pathToFileURL(sourcePath).href;
  const notifications: LSPNotification[] = [];
  const unsubscribe = client.onNotification((notification) => notifications.push(notification));
  try {
    await client.initialize(dirname(sourcePath));
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: backend.language_id, version: 1, text: source },
    });
    // clangd acknowledges didOpen before its background AST is necessarily ready.
    // Waiting for the first diagnostics publication gives definition/reference
    // requests a parsed document instead of racing the initial index build.
    const initialDiagnostics = await waitForDiagnostics(notifications, uri, signal);
    if (capability === 'lsp_diagnostics') {
      const diagnostics = initialDiagnostics;
      return {
        status: 'completed',
        capability,
        mode: 'native_lsp_stdio_v1',
        backend: backend.name,
        path: sourcePath,
        diagnostic_count: diagnostics.length,
        diagnostics: diagnostics.map(normalizeDiagnostic),
        summary: `Native ${backend.name} returned ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}.`,
      };
    }
    if (capability === 'lsp_symbols') {
      const result = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, 15_000);
      const symbols = normalizeSymbols(result);
      return {
        status: 'completed', capability, mode: 'native_lsp_stdio_v2', backend: backend.name,
        path: sourcePath, symbol_count: symbols.length, symbols,
        summary: `Native ${backend.name} returned ${symbols.length} document symbol${symbols.length === 1 ? '' : 's'}.`,
      };
    }
    if (capability === 'lsp_format') {
      const result = await client.request('textDocument/formatting', {
        textDocument: { uri },
        options: { tabSize: boundedInteger(inputs.tab_size, 2, 1, 16), insertSpaces: inputs.insert_spaces !== false },
      }, 20_000);
      const edits = Array.isArray(result) ? result : [];
      const changedFiles = await applyWorkspaceEdit({ changes: { [uri]: edits } }, settings);
      return {
        status: 'completed', capability, mode: 'native_lsp_stdio_v2', backend: backend.name,
        path: sourcePath, edit_count: edits.length, changed_files: changedFiles,
        summary: `Native ${backend.name} applied ${edits.length} formatting edit${edits.length === 1 ? '' : 's'}.`,
      };
    }
    const position = {
      line: boundedInteger(inputs.line, 1, 1, 1_000_000) - 1,
      character: boundedInteger(inputs.character, 0, 0, 1_000_000),
    };
    if (capability === 'lsp_hover') {
      const result = await client.request('textDocument/hover', { textDocument: { uri }, position }, 15_000);
      const hover = normalizeHover(result);
      return {
        status: 'completed', capability, mode: 'native_lsp_stdio_v2', backend: backend.name,
        path: sourcePath, position: { line: position.line + 1, character: position.character }, hover,
        summary: hover.text ? `Native ${backend.name} returned hover information.` : `Native ${backend.name} found no hover information.`,
      };
    }
    if (capability === 'lsp_code_actions') {
      const range = {
        start: position,
        end: {
          line: boundedInteger(inputs.end_line, position.line + 1, 1, 1_000_000) - 1,
          character: boundedInteger(inputs.end_character, position.character, 0, 1_000_000),
        },
      };
      const result = await client.request('textDocument/codeAction', {
        textDocument: { uri }, range,
        context: { diagnostics: initialDiagnostics, only: Array.isArray(inputs.only) ? inputs.only.map(String) : undefined },
      }, 20_000);
      const actions = normalizeCodeActions(result);
      return {
        status: 'completed', capability, mode: 'native_lsp_stdio_v2', backend: backend.name,
        path: sourcePath, action_count: actions.length, actions,
        summary: `Native ${backend.name} returned ${actions.length} code action${actions.length === 1 ? '' : 's'}.`,
      };
    }
    if (capability === 'lsp_rename') {
      const newName = stringInput(inputs.new_name);
      if (!newName || newName.length > 300 || /[\0\r\n]/.test(newName)) throw new Error('lsp_rename new_name is invalid');
      const result = await client.request('textDocument/rename', { textDocument: { uri }, position, newName }, 30_000);
      const edit = record(result);
      const changedFiles = await applyWorkspaceEdit(edit, settings);
      return {
        status: 'completed', capability, mode: 'native_lsp_stdio_v2', backend: backend.name,
        path: sourcePath, new_name: newName, changed_files: changedFiles,
        summary: `Native ${backend.name} renamed the symbol across ${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'}.`,
      };
    }
    const method = capability === 'lsp_definition' ? 'textDocument/definition' : 'textDocument/references';
    const params = capability === 'lsp_definition'
      ? { textDocument: { uri }, position }
      : { textDocument: { uri }, position, context: { includeDeclaration: inputs.include_declaration !== false } };
    const result = await client.request(method, params, 15_000);
    const locations = normalizeLocations(result);
    return {
      status: 'completed',
      capability,
      mode: 'native_lsp_stdio_v1',
      backend: backend.name,
      path: sourcePath,
      position: { line: position.line + 1, character: position.character },
      location_count: locations.length,
      locations,
      summary: `Native ${backend.name} resolved ${locations.length} ${capability === 'lsp_definition' ? 'definition' : 'reference'} location${locations.length === 1 ? '' : 's'}.`,
    };
  } finally {
    unsubscribe();
    await client.stop();
  }
}

class NativeLSPClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextID = 1;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<(notification: LSPNotification) => void>();
  private stderr = '';
  private stopped = false;

  constructor(binary: string, args: string[], signal?: AbortSignal, env: NodeJS.ProcessEnv = {}) {
    this.child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env, NO_COLOR: '1' } });
    this.child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-32_000); });
    this.child.once('error', (error) => this.failAll(error));
    this.child.once('close', (code) => {
      if (!this.stopped && code !== 0) this.failAll(new Error(`language server exited with code ${code}: ${this.stderr.trim().slice(-1_000)}`));
    });
    signal?.addEventListener('abort', () => this.child.kill('SIGTERM'), { once: true });
  }

  async initialize(rootPath: string): Promise<void> {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(rootPath).href,
      capabilities: {
        workspace: { applyEdit: true, workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] } },
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
          rename: { prepareSupport: true },
          formatting: {},
        },
      },
      workspaceFolders: [{ uri: pathToFileURL(rootPath).href, name: 'joi-workspace' }],
    }, 15_000);
    this.notify('initialized', {});
  }

  request(method: string, params: unknown, timeoutMS: number): Promise<unknown> {
    const id = this.nextID++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  onNotification(listener: (notification: LSPNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.request('shutdown', null, 2_000);
      this.notify('exit', null);
    } catch {
      this.child.kill('SIGTERM');
    }
  }

  private send(payload: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) throw new Error('invalid LSP response header');
      const bodyLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + bodyLength) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + bodyLength).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + bodyLength);
      const message = JSON.parse(body) as Record<string, unknown>;
      const id = Number(message.id);
      if (Number.isFinite(id) && this.pending.has(id)) {
        const pending = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`LSP error: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result);
        continue;
      }
      if (typeof message.method === 'string') {
        for (const listener of this.listeners) listener({ method: message.method, params: message.params });
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function backendForPath(path: string): LSPBackend {
  const extension = extname(path).toLowerCase();
  if (['.c', '.h'].includes(extension)) return { name: 'clangd', binary: '/usr/bin/clangd', args: [], language_id: 'c' };
  if (['.cc', '.cpp', '.cxx', '.hpp', '.hh'].includes(extension)) return { name: 'clangd', binary: '/usr/bin/clangd', args: [], language_id: 'cpp' };
  if (extension === '.swift') return { name: 'sourcekit-lsp', binary: '/usr/bin/sourcekit-lsp', args: [], language_id: 'swift' };
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    return nodeLSPBackend('typescript-language-server', require.resolve('typescript-language-server/lib/cli.mjs'), ['--stdio'], extension === '.tsx' ? 'typescriptreact' : extension === '.jsx' ? 'javascriptreact' : extension.includes('ts') ? 'typescript' : 'javascript');
  }
  if (['.py', '.pyi'].includes(extension)) {
    return nodeLSPBackend('pyright', require.resolve('pyright/langserver.index.js'), ['--stdio'], 'python');
  }
  if (extension === '.html' || extension === '.htm') {
    return nodeLSPBackend('vscode-html-language-server', require.resolve('vscode-langservers-extracted/bin/vscode-html-language-server'), ['--stdio'], 'html');
  }
  if (['.css', '.scss', '.less'].includes(extension)) {
    const languageID = extension === '.scss' ? 'scss' : extension === '.less' ? 'less' : 'css';
    return nodeLSPBackend('vscode-css-language-server', require.resolve('vscode-langservers-extracted/bin/vscode-css-language-server'), ['--stdio'], languageID);
  }
  if (['.json', '.jsonc'].includes(extension)) {
    return nodeLSPBackend('vscode-json-language-server', require.resolve('vscode-langservers-extracted/bin/vscode-json-language-server'), ['--stdio'], extension === '.jsonc' ? 'jsonc' : 'json');
  }
  if (extension === '.rs') {
    const binary = ['/opt/homebrew/bin/rust-analyzer', '/usr/local/bin/rust-analyzer', '/usr/bin/rust-analyzer'].find(existsSync);
    if (binary) return { name: 'rust-analyzer', binary, args: [], language_id: 'rust' };
  }
  throw new Error(`no native LSP backend is configured for ${extension || 'this file type'}`);
}

function nodeLSPBackend(name: string, script: string, args: string[], languageID: string): LSPBackend {
  return {
    name,
    binary: process.execPath,
    args: [script, ...args],
    language_id: languageID,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

async function waitForDiagnostics(notifications: LSPNotification[], uri: string, signal?: AbortSignal): Promise<unknown[]> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    const notification = [...notifications].reverse().find((item) => (
      item.method === 'textDocument/publishDiagnostics' && stringInput(record(item.params).uri) === uri
    ));
    if (notification) return Array.isArray(record(notification.params).diagnostics) ? record(notification.params).diagnostics as unknown[] : [];
    if (signal?.aborted) {
      const error = new Error('LSP diagnostics aborted');
      error.name = 'AbortError';
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

function normalizeLocations(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((entry) => {
    const item = record(entry);
    const target = record(item.targetSelectionRange).start ? record(item.targetSelectionRange) : record(item.range);
    const uri = stringInput(item.uri) || stringInput(item.targetUri);
    return { uri, path: uri.startsWith('file:') ? decodeURIComponent(new URL(uri).pathname) : uri, range: normalizeRange(target) };
  }).filter((entry) => entry.uri);
}

function normalizeDiagnostic(value: unknown): Record<string, unknown> {
  const item = record(value);
  return {
    severity: Number(item.severity || 0),
    code: typeof item.code === 'string' || typeof item.code === 'number' ? item.code : '',
    source: stringInput(item.source),
    message: stringInput(item.message),
    range: normalizeRange(record(item.range)),
  };
}

function normalizeHover(value: unknown): { text: string; range?: Record<string, unknown> } {
  const hover = record(value);
  const contents = hover.contents;
  const parts = Array.isArray(contents) ? contents : contents === undefined ? [] : [contents];
  const text = parts.map((part) => {
    if (typeof part === 'string') return part;
    const item = record(part);
    if (typeof item.value === 'string') return item.value;
    return '';
  }).filter(Boolean).join('\n\n');
  return { text, range: record(hover.range).start ? normalizeRange(record(hover.range)) : undefined };
}

function normalizeSymbols(value: unknown): Record<string, unknown>[] {
  const visit = (entry: unknown): Record<string, unknown> => {
    const item = record(entry);
    const location = record(item.location);
    return {
      name: stringInput(item.name),
      detail: stringInput(item.detail),
      kind: Number(item.kind || 0),
      range: normalizeRange(record(item.range).start ? record(item.range) : record(location.range)),
      selection_range: normalizeRange(record(item.selectionRange).start ? record(item.selectionRange) : record(item.range)),
      uri: stringInput(location.uri),
      children: Array.isArray(item.children) ? item.children.map(visit) : [],
    };
  };
  return (Array.isArray(value) ? value : []).map(visit);
}

function normalizeCodeActions(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const item = record(entry);
    const command = record(item.command);
    return {
      title: stringInput(item.title),
      kind: stringInput(item.kind),
      preferred: item.isPreferred === true,
      disabled_reason: stringInput(record(item.disabled).reason),
      has_edit: Object.keys(record(item.edit)).length > 0,
      command: stringInput(command.command) || stringInput(item.command),
      diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.map(normalizeDiagnostic) : [],
    };
  }).filter((item) => item.title);
}

async function applyWorkspaceEdit(edit: Record<string, unknown>, settings: WorkspaceSettings): Promise<string[]> {
  const editsByURI = new Map<string, unknown[]>();
  const changes = record(edit.changes);
  for (const [uri, edits] of Object.entries(changes)) {
    if (Array.isArray(edits)) editsByURI.set(uri, edits);
  }
  if (Array.isArray(edit.documentChanges)) {
    for (const change of edit.documentChanges) {
      const item = record(change);
      const textDocument = record(item.textDocument);
      const uri = stringInput(textDocument.uri);
      if (!uri || !Array.isArray(item.edits)) continue;
      editsByURI.set(uri, [...(editsByURI.get(uri) || []), ...item.edits]);
    }
  }
  const changedFiles: string[] = [];
  for (const [uri, rawEdits] of editsByURI) {
    if (!uri.startsWith('file:')) throw new Error(`LSP workspace edit uses unsupported URI: ${uri}`);
    const path = resolveWorkspacePath(fileURLToPath(uri), settings);
    const source = await readFile(path, 'utf8');
    const edits = rawEdits.map((entry) => {
      const item = record(entry);
      const range = record(item.range);
      const start = record(range.start);
      const end = record(range.end);
      return {
        start: textOffset(source, Number(start.line || 0), Number(start.character || 0)),
        end: textOffset(source, Number(end.line || 0), Number(end.character || 0)),
        text: typeof item.newText === 'string' ? item.newText : '',
      };
    }).sort((a, b) => b.start - a.start || b.end - a.end);
    let next = source;
    let lastStart = source.length + 1;
    for (const item of edits) {
      if (item.start > item.end || item.end > next.length) throw new Error(`Invalid LSP text edit for ${path}`);
      if (item.end > lastStart) throw new Error(`Overlapping LSP text edits for ${path}`);
      next = `${next.slice(0, item.start)}${item.text}${next.slice(item.end)}`;
      lastStart = item.start;
    }
    if (next !== source) {
      await writeFile(path, next, 'utf8');
      changedFiles.push(path);
    }
  }
  return changedFiles;
}

function textOffset(source: string, line: number, character: number): number {
  const targetLine = Math.max(0, Math.floor(line));
  const targetCharacter = Math.max(0, Math.floor(character));
  let offset = 0;
  for (let current = 0; current < targetLine; current += 1) {
    const newline = source.indexOf('\n', offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
  }
  return Math.min(source.length, offset + targetCharacter);
}

function normalizeRange(value: Record<string, unknown>): Record<string, unknown> {
  const start = record(value.start);
  const end = record(value.end);
  return {
    start: { line: Number(start.line || 0) + 1, character: Number(start.character || 0) },
    end: { line: Number(end.line || 0) + 1, character: Number(end.character || 0) },
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
