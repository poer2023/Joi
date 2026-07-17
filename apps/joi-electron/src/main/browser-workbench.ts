import { app, BrowserWindow, session } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BrowserWorkbenchRequest,
  BrowserWorkbenchResult,
} from '../../../../packages/shared-types/src/desktop-api.ts';

type BrowserTab = {
  id: number;
  window: BrowserWindow;
  console: Array<Record<string, unknown>>;
  network: Array<Record<string, unknown>>;
  dialog?: Record<string, unknown>;
};

type BrowserSession = {
  id: string;
  activeTabID: number;
  tabs: Map<number, BrowserTab>;
  visible: boolean;
};

export class BrowserWorkbenchManager {
  private sessions = new Map<string, BrowserSession>();
  private sequence = 0;

  async execute(req: BrowserWorkbenchRequest): Promise<BrowserWorkbenchResult> {
    const action = req.action.trim().toLowerCase();
    if (!action) throw new Error('browser action is required');
    if (action === 'open') {
      const browserSession = await this.createSession(req.visible !== false, req.url);
      return this.snapshot(browserSession, action);
    }
    if (action === 'close') {
      const browserSession = this.requiredSession(req.session_id);
      const result = this.snapshot(browserSession, action);
      this.closeSession(browserSession.id);
      return result;
    }
    const browserSession = await this.ensureSession(req.session_id, req.visible !== false);
    if (action === 'list_tabs') return this.snapshot(browserSession, action);
    if (action === 'new_tab') {
      const tab = await this.createTab(browserSession, req.url || 'about:blank');
      this.activateTab(browserSession, tab.id);
      return this.snapshot(browserSession, action);
    }
    if (action === 'activate_tab') {
      this.activateTab(browserSession, requiredTabID(req.tab_id));
      return this.snapshot(browserSession, action);
    }
    if (action === 'close_tab') {
      this.closeTab(browserSession, requiredTabID(req.tab_id));
      if (browserSession.tabs.size === 0) {
        const tab = await this.createTab(browserSession, 'about:blank');
        this.activateTab(browserSession, tab.id);
      }
      return this.snapshot(browserSession, action);
    }
    const tab = this.requiredTab(browserSession, req.tab_id);
    const contents = tab.window.webContents;
    if (action === 'navigate') {
      const url = allowedBrowserURL(req.url);
      await contents.loadURL(url);
      return this.snapshot(browserSession, action, { url: contents.getURL(), title: contents.getTitle() });
    }
    if (action === 'back') {
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      await waitForNavigationSettled(contents, req.timeout_ms);
      return this.snapshot(browserSession, action);
    }
    if (action === 'forward') {
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      await waitForNavigationSettled(contents, req.timeout_ms);
      return this.snapshot(browserSession, action);
    }
    if (action === 'reload') {
      contents.reload();
      await waitForNavigationSettled(contents, req.timeout_ms);
      return this.snapshot(browserSession, action);
    }
    if (action === 'observe') {
      const observed = await contents.executeJavaScript(`(() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const interactive = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
          .filter(visible).slice(0, 200).map((el, index) => ({
            index,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 300),
            id: el.id || '',
            name: el.getAttribute('name') || '',
            type: el.getAttribute('type') || '',
            href: el.href || '',
          }));
        return { title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 50000), interactive };
      })()`, true);
      return this.snapshot(browserSession, action, {
        title: optionalString(observed?.title),
        url: optionalString(observed?.url),
        text: optionalString(observed?.text),
        result: observed,
      });
    }
    if (action === 'click') {
      const selector = requiredSelector(req.selector);
      const result = await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector_not_found' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return { ok: true, tag: el.tagName.toLowerCase() };
      })()`, true);
      if (!result?.ok) throw new Error(`Browser selector not found: ${selector}`);
      return this.snapshot(browserSession, action, { result });
    }
    if (action === 'type') {
      const selector = requiredSelector(req.selector);
      const text = req.text || '';
      const result = await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'selector_not_found' };
        el.focus();
        const value = ${JSON.stringify(text)};
        if ('value' in el) {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, value); else el.value = value;
        } else el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: 'value' in el ? el.value : el.textContent };
      })()`, true);
      if (!result?.ok) throw new Error(`Browser selector not found: ${selector}`);
      return this.snapshot(browserSession, action, { result });
    }
    if (action === 'press') {
      const key = requiredText(req.key, 'browser key');
      contents.sendInputEvent({ type: 'keyDown', keyCode: key });
      contents.sendInputEvent({ type: 'char', keyCode: key });
      contents.sendInputEvent({ type: 'keyUp', keyCode: key });
      return this.snapshot(browserSession, action, { result: { key } });
    }
    if (action === 'scroll') {
      const deltaX = finiteNumber(req.delta_x, 0);
      const deltaY = finiteNumber(req.delta_y, 700);
      const result = await contents.executeJavaScript(`(() => {
        window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
        return { x: scrollX, y: scrollY, max_y: Math.max(0, document.documentElement.scrollHeight - innerHeight) };
      })()`, true);
      return this.snapshot(browserSession, action, { result });
    }
    if (action === 'upload') {
      const selector = requiredSelector(req.selector);
      const paths = (req.paths || []).map((path) => path.trim()).filter(Boolean);
      if (paths.length === 0) throw new Error('browser upload requires at least one path');
      const document = await contents.debugger.sendCommand('DOM.getDocument', { depth: 1, pierce: true });
      const query = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector });
      if (!query.nodeId) throw new Error(`Browser file input not found: ${selector}`);
      await contents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: query.nodeId, files: paths });
      return this.snapshot(browserSession, action, { result: { selector, paths } });
    }
    if (action === 'screenshot') {
      const capture = await tab.window.capturePage();
      const directory = join(app.getPath('userData'), 'browser-captures');
      await mkdir(directory, { recursive: true });
      const path = join(directory, `browser-${browserSession.id}-${tab.id}-${Date.now()}.png`);
      await writeFile(path, capture.toPNG());
      return this.snapshot(browserSession, action, { screenshot_path: path });
    }
    if (action === 'get_images') {
      const images = await contents.executeJavaScript(`(() => [...document.images].slice(0, 500).map((image) => ({
        src: image.currentSrc || image.src,
        alt: image.alt || '',
        width: image.naturalWidth,
        height: image.naturalHeight,
        displayed_width: image.getBoundingClientRect().width,
        displayed_height: image.getBoundingClientRect().height,
      })))()`, true);
      return this.snapshot(browserSession, action, { images: Array.isArray(images) ? images : [] });
    }
    if (action === 'console') return this.snapshot(browserSession, action, { console: [...tab.console] });
    if (action === 'network') return this.snapshot(browserSession, action, { network: [...tab.network] });
    if (action === 'dialog') {
      const dialogAction = (req.text || 'accept').trim().toLowerCase();
      await contents.debugger.sendCommand('Page.handleJavaScriptDialog', {
        accept: dialogAction !== 'dismiss',
        promptText: dialogAction === 'dismiss' ? undefined : req.params?.prompt_text,
      });
      return this.snapshot(browserSession, action, { result: { handled: true, action: dialogAction, dialog: tab.dialog } });
    }
    if (action === 'evaluate') {
      const expression = requiredText(req.expression, 'browser expression');
      if (expression.length > 50_000) throw new Error('browser expression exceeds 50000 characters');
      const result = await contents.executeJavaScript(expression, true);
      return this.snapshot(browserSession, action, { result: makeSerializable(result) });
    }
    if (action === 'cdp') {
      const method = requiredText(req.method, 'CDP method');
      validateCDPMethod(method);
      const result = await contents.debugger.sendCommand(method, req.params || {});
      return this.snapshot(browserSession, action, { result: makeSerializable(result) });
    }
    throw new Error(`Unsupported browser action: ${action}`);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.closeSession(id);
  }

  private async ensureSession(sessionID: string | undefined, visible: boolean): Promise<BrowserSession> {
    if (sessionID?.trim()) return this.requiredSession(sessionID);
    const existing = [...this.sessions.values()][0];
    return existing || this.createSession(visible);
  }

  private async createSession(visible: boolean, url?: string): Promise<BrowserSession> {
    const id = `browser_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const browserSession: BrowserSession = { id, activeTabID: 0, tabs: new Map(), visible };
    this.sessions.set(id, browserSession);
    const tab = await this.createTab(browserSession, url || 'about:blank');
    this.activateTab(browserSession, tab.id);
    return browserSession;
  }

  private async createTab(browserSession: BrowserSession, rawURL: string): Promise<BrowserTab> {
    const partition = 'persist:joi-browser-workbench';
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(true));
    ses.setPermissionCheckHandler(() => true);
    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      show: false,
      title: 'Joi Browser',
      backgroundColor: '#ffffff',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    });
    const tab: BrowserTab = { id: window.webContents.id, window, console: [], network: [] };
    browserSession.tabs.set(tab.id, tab);
    const defaultAgent = window.webContents.getUserAgent();
    window.webContents.setUserAgent(defaultAgent.replace(/\sElectron\/\S+/g, '').replace(/\sJoi\/\S+/g, ''));
    window.webContents.setWindowOpenHandler(({ url }) => {
      void this.createTab(browserSession, url).then((created) => this.activateTab(browserSession, created.id));
      return { action: 'deny' };
    });
    window.webContents.on('console-message', (...args: unknown[]) => {
      const modern = args[1] && typeof args[1] === 'object' ? args[1] as Record<string, unknown> : undefined;
      pushCapped(tab.console, {
        level: modern?.level ?? args[1],
        message: modern?.message ?? args[2],
        line: modern?.lineNumber ?? args[3],
        source_id: modern?.sourceId ?? args[4],
        at: new Date().toISOString(),
      }, 500);
    });
    window.on('closed', () => {
      browserSession.tabs.delete(tab.id);
      if (browserSession.activeTabID === tab.id) browserSession.activeTabID = browserSession.tabs.keys().next().value || 0;
      if (browserSession.tabs.size === 0) this.sessions.delete(browserSession.id);
    });
    // A newly-created hidden BrowserWindow may not have a live renderer target
    // yet. Loading the empty document first makes CDP attachment deterministic,
    // then Network/Page domains are enabled before the requested page loads.
    await window.webContents.loadURL('about:blank');
    window.webContents.debugger.attach('1.3');
    await Promise.all([
      window.webContents.debugger.sendCommand('Page.enable'),
      window.webContents.debugger.sendCommand('Runtime.enable'),
      window.webContents.debugger.sendCommand('DOM.enable'),
      window.webContents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 2_000_000 }),
    ]);
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
        pushCapped(tab.console, { method, params: makeSerializable(params), at: new Date().toISOString() }, 500);
      }
      if (method.startsWith('Network.')) {
        if (['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed', 'Network.loadingFinished'].includes(method)) {
          pushCapped(tab.network, { method, params: makeSerializable(params), at: new Date().toISOString() }, 1_000);
        }
      }
      if (method === 'Page.javascriptDialogOpening') tab.dialog = makeSerializable(params) as Record<string, unknown>;
      if (method === 'Page.javascriptDialogClosed') tab.dialog = undefined;
    });
    await window.webContents.loadURL(allowedBrowserURL(rawURL));
    return tab;
  }

  private activateTab(browserSession: BrowserSession, tabID: number): void {
    const tab = browserSession.tabs.get(tabID);
    if (!tab) throw new Error(`Browser tab not found: ${tabID}`);
    browserSession.activeTabID = tabID;
    for (const item of browserSession.tabs.values()) {
      if (item.id === tabID && browserSession.visible) item.window.show();
      else item.window.hide();
    }
  }

  private closeTab(browserSession: BrowserSession, tabID: number): void {
    const tab = browserSession.tabs.get(tabID);
    if (!tab) throw new Error(`Browser tab not found: ${tabID}`);
    browserSession.tabs.delete(tabID);
    if (!tab.window.isDestroyed()) tab.window.destroy();
    if (browserSession.activeTabID === tabID) {
      browserSession.activeTabID = browserSession.tabs.keys().next().value || 0;
      if (browserSession.activeTabID) this.activateTab(browserSession, browserSession.activeTabID);
    }
  }

  private closeSession(id: string): void {
    const browserSession = this.sessions.get(id);
    this.sessions.delete(id);
    if (!browserSession) return;
    for (const tab of browserSession.tabs.values()) if (!tab.window.isDestroyed()) tab.window.destroy();
    browserSession.tabs.clear();
  }

  private requiredSession(id: string | undefined): BrowserSession {
    const clean = id?.trim();
    const browserSession = clean ? this.sessions.get(clean) : [...this.sessions.values()][0];
    if (!browserSession) throw new Error(`Browser session not found: ${clean || '(none)'}`);
    return browserSession;
  }

  private requiredTab(browserSession: BrowserSession, requestedID?: number): BrowserTab {
    const id = requestedID || browserSession.activeTabID;
    const tab = browserSession.tabs.get(id);
    if (!tab || tab.window.isDestroyed()) throw new Error(`Browser tab not found: ${id}`);
    return tab;
  }

  private snapshot(browserSession: BrowserSession, action: string, extra: Partial<BrowserWorkbenchResult> = {}): BrowserWorkbenchResult {
    const active = browserSession.tabs.get(browserSession.activeTabID);
    return {
      session_id: browserSession.id,
      action,
      active_tab_id: browserSession.activeTabID || undefined,
      url: active?.window.webContents.getURL(),
      title: active?.window.webContents.getTitle(),
      tabs: [...browserSession.tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.window.webContents.getTitle(),
        url: tab.window.webContents.getURL(),
        active: tab.id === browserSession.activeTabID,
      })),
      ...extra,
    };
  }
}

function allowedBrowserURL(value: string | undefined): string {
  const input = value?.trim() || 'about:blank';
  if (input === 'about:blank') return input;
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Browser navigation only supports HTTP(S) URLs');
  return url.toString();
}

function validateCDPMethod(method: string): void {
  const domain = method.split('.')[0];
  const allowed = new Set(['Page', 'Runtime', 'DOM', 'DOMSnapshot', 'Network', 'Input', 'Emulation', 'Target', 'Browser', 'Performance', 'Storage', 'Log', 'Accessibility', 'CSS', 'Debugger', 'Profiler']);
  if (!allowed.has(domain)) throw new Error(`CDP domain is not enabled: ${domain}`);
  if (['Browser.close', 'Target.closeTarget', 'Browser.crash', 'Page.crash'].includes(method)) throw new Error(`CDP method is blocked: ${method}`);
}

function requiredSelector(value: string | undefined): string {
  return requiredText(value, 'browser selector');
}

function requiredText(value: string | undefined, label: string): string {
  const clean = value?.trim();
  if (!clean) throw new Error(`${label} is required`);
  return clean;
}

function requiredTabID(value: number | undefined): number {
  const id = Number(value || 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error('browser tab_id is required');
  return id;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function pushCapped(target: Array<Record<string, unknown>>, value: Record<string, unknown>, limit: number): void {
  target.push(value);
  if (target.length > limit) target.splice(0, target.length - limit);
}

function makeSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

async function waitForNavigationSettled(contents: Electron.WebContents, timeoutMs = 15_000): Promise<void> {
  if (!contents.isLoading()) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, Math.max(1_000, Math.min(60_000, timeoutMs)));
    function done() {
      clearTimeout(timer);
      contents.off('did-stop-loading', done);
      contents.off('did-fail-load', done);
      resolve();
    }
    contents.once('did-stop-loading', done);
    contents.once('did-fail-load', done);
  });
}
