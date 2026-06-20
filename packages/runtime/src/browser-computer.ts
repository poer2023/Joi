import { spawn } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type { PermissionProfile, WorkspaceSettings } from '../../shared-types/src/desktop-api';
import type { CapabilityResult } from './capabilities.ts';
import { webResearchBlockReason } from './capabilities.ts';

export type ObserveRequest = {
  target?: string;
  include_text?: boolean;
  include_screenshot?: boolean;
  max_text_bytes?: unknown;
};

export type BrowserNavigateRequest = {
  url?: string;
  target?: string;
};

export type BrowserInteractionRequest = {
  target?: string;
  selector?: string;
  text?: string;
  permission_profile?: PermissionProfile | string;
};

export type ComputerSnapshot = {
  status?: string;
  front_app?: string;
  bundle_id?: string;
  window_title?: string;
  visible_text?: string;
  text_status?: string;
  error?: string;
  screenshot_ref?: string;
  screenshot_error?: string;
};

export type BrowserSnapshot = {
  status?: string;
  browser_app?: string;
  title?: string;
  url?: string;
  visible_text?: string;
  text_status?: string;
  front_app?: string;
  error?: string;
  screenshot_ref?: string;
  screenshot_error?: string;
};

export type BrowserNavigation = {
  status?: string;
  browser_app?: string;
  url?: string;
  method?: string;
  front_app?: string;
  error?: string;
};

export type BrowserInteraction = {
  status?: string;
  action?: string;
  browser_app?: string;
  front_app?: string;
  selector?: string;
  method?: string;
  result?: Record<string, unknown>;
  error?: string;
};

export type BrowserComputerHost = {
  observeComputer(options: Required<ObserveRequest>): Promise<ComputerSnapshot>;
  observeBrowser(options: Required<ObserveRequest>): Promise<BrowserSnapshot>;
  navigateBrowser(url: string): Promise<BrowserNavigation>;
  interactBrowser(action: 'click' | 'type', selector: string, text: string): Promise<BrowserInteraction>;
};

const defaultObserveTextBytes = 12000;
const maxObserveTextBytes = 48000;
const observeFieldSeparator = '\x1f';

export async function executeComputerObserve(req: ObserveRequest = {}, host: BrowserComputerHost = macOSBrowserComputerHost): Promise<CapabilityResult> {
  const target = req.target?.trim() || 'frontmost_window';
  if (target !== 'frontmost_window' && target !== 'joi_current_window') throw policyDenied('computer_observe target is not allowed');
  const maxBytes = boundedObserveTextBytes(req.max_text_bytes);
  const snapshot = await host.observeComputer(normalizedObserveRequest(req, target, maxBytes));
  return computerSnapshotOutput(snapshot, target, maxBytes);
}

export async function executeBrowserObserve(req: ObserveRequest = {}, host: BrowserComputerHost = macOSBrowserComputerHost): Promise<CapabilityResult> {
  const target = req.target?.trim() || 'frontmost_browser';
  if (target !== 'frontmost_browser') throw policyDenied('browser_observe target is not allowed');
  const maxBytes = boundedObserveTextBytes(req.max_text_bytes);
  const snapshot = await host.observeBrowser(normalizedObserveRequest(req, target, maxBytes));
  let fallback: CapabilityResult | null = null;
  if (snapshot.status !== 'completed' || !snapshot.url) {
    fallback = computerSnapshotOutput(await host.observeComputer(normalizedObserveRequest(req, 'frontmost_window', maxBytes)), 'frontmost_window', maxBytes);
  }
  const text = truncateObserveTextBytes(redactSensitiveText(snapshot.visible_text || ''), maxBytes);
  const observeStatus = snapshot.error && !snapshot.url ? (fallback ? 'fallback_to_computer' : 'failed') : (snapshot.status || 'completed');
  return {
    status: 'completed',
    observe_status: observeStatus,
    target,
    frontmost_app: snapshot.front_app || '',
    browser_app: snapshot.browser_app || '',
    title: snapshot.title || '',
    url: snapshot.url || '',
    visible_text: text.text,
    visible_text_summary: observeTextSummary(text.text, snapshot.title || ''),
    text_status: snapshot.text_status || '',
    text_truncated: text.truncated,
    max_text_bytes: maxBytes,
    screenshot_ref: snapshot.screenshot_ref || '',
    screenshot_error: snapshot.screenshot_error || '',
    dynamic_page_observed: true,
    http_fetch_used: false,
    fallback_observe: fallback,
    privacy_level: 'private_content',
    interaction_allowed: false,
    error: snapshot.error || '',
    summary: observeTextSummary(text.text, snapshot.title || snapshot.error || 'browser observe completed'),
    mode: 'browser_observe_v1_macos_snapshot',
  };
}

export async function executeBrowserNavigate(
  req: BrowserNavigateRequest,
  settings: WorkspaceSettings,
  host: BrowserComputerHost = macOSBrowserComputerHost,
): Promise<CapabilityResult> {
  const rawURL = req.url?.trim() || '';
  if (!rawURL) throw new Error('browser_navigate url is required');
  let normalizedURL = '';
  try {
    normalizedURL = new URL(rawURL).toString();
  } catch {
    return browserNavigatePolicyBlocked(rawURL, 'invalid_url');
  }
  const blockedReason = webResearchBlockReason(rawURL, {
    ...settings,
    web_research_allow_private_hosts: settings.browser_allowed_hosts.length > 0 || settings.web_research_allow_private_hosts,
  });
  if (blockedReason) return browserNavigatePolicyBlocked(rawURL, blockedReason);
  const target = req.target?.trim() || 'frontmost_or_default_browser';
  if (target !== 'frontmost_or_default_browser') throw policyDenied('browser_navigate target is not allowed');
  const navigation = await host.navigateBrowser(normalizedURL);
  const navigationStatus = navigation.error ? 'failed' : (navigation.status || 'completed');
  return {
    status: 'completed',
    navigation_status: navigationStatus,
    target,
    url: normalizedURL,
    requested_url: rawURL,
    current_url: navigation.url || normalizedURL,
    frontmost_app: navigation.front_app || '',
    browser_app: navigation.browser_app || '',
    method: navigation.method || '',
    allowed_hosts: settings.browser_allowed_hosts,
    private_hosts_allowed: settings.browser_allowed_hosts.length > 0 || settings.web_research_allow_private_hosts,
    http_fetch_used: false,
    playwright_used: false,
    privacy_level: 'private_content',
    interaction_allowed: false,
    error: navigation.error || '',
    summary: navigation.error ? `browser_navigate failed: ${navigation.error}` : `browser_navigate completed: ${normalizedURL}`,
    mode: 'browser_navigate_v1_macos',
  };
}

export async function executeBrowserClick(req: BrowserInteractionRequest, host: BrowserComputerHost = macOSBrowserComputerHost): Promise<CapabilityResult> {
  return executeBrowserInteraction('click', req, host);
}

export async function executeBrowserType(req: BrowserInteractionRequest, host: BrowserComputerHost = macOSBrowserComputerHost): Promise<CapabilityResult> {
  return executeBrowserInteraction('type', req, host);
}

async function executeBrowserInteraction(action: 'click' | 'type', req: BrowserInteractionRequest, host: BrowserComputerHost): Promise<CapabilityResult> {
  const profile = normalizedPermissionProfile(req.permission_profile);
  if (profile !== 'danger_full_access') throw policyDenied(`${action} requires danger_full_access permission profile`);
  const target = req.target?.trim() || 'frontmost_browser';
  if (target !== 'frontmost_browser') throw policyDenied(`${action} target is not allowed`);
  const selector = req.selector?.trim() || '';
  if (!selector) throw new Error(`browser_${action} selector is required`);
  const text = req.text || '';
  if (action === 'type' && !text.trim()) throw new Error('browser_type text is required');
  const interaction = await host.interactBrowser(action, selector, text);
  const interactionStatus = interaction.error ? 'failed' : (interaction.status || 'completed');
  return {
    status: 'completed',
    interaction_status: interactionStatus,
    action,
    target,
    selector,
    text_length: [...text].length,
    frontmost_app: interaction.front_app || '',
    browser_app: interaction.browser_app || '',
    method: interaction.method || '',
    result: interaction.result || {},
    http_fetch_used: false,
    playwright_used: false,
    privacy_level: 'private_content',
    interaction_allowed: true,
    permission_profile: profile,
    requires_permission: 'danger_full_access',
    confirmation_used: false,
    interaction_provider: 'frontmost_browser_javascript',
    error: interaction.error || '',
    summary: interaction.error ? `browser_${action} failed: ${interaction.error}` : `browser_${action} ${interactionStatus}: ${selector}`,
    mode: 'browser_interaction_v1_macos',
  };
}

export const macOSBrowserComputerHost: BrowserComputerHost = {
  async observeComputer(options) {
    if (platform() !== 'darwin') return { status: 'unsupported', error: 'computer_observe real snapshot is implemented for macOS' };
    const script = computerObserveScript(Boolean(options.include_text));
    const output = await runAppleScript(script, 4000);
    if (output.error) return { status: 'failed', error: output.error };
    const parts = splitObserveFields(output.text, 5);
    return {
      status: 'completed',
      front_app: parts[0],
      bundle_id: parts[1],
      window_title: parts[2],
      visible_text: parts[3],
      text_status: parts[4],
    };
  },
  async observeBrowser(options) {
    if (platform() !== 'darwin') return { status: 'unsupported', error: 'browser_observe real snapshot is implemented for macOS' };
    const front = await macOSBrowserComputerHost.observeComputer({ ...options, include_text: false, include_screenshot: false });
    const appName = (front.front_app || '').trim();
    if (!browserAppSupported(appName)) return { status: 'not_browser', front_app: appName, error: 'frontmost app is not a supported browser' };
    const output = await runAppleScript(browserObserveScript(appName, Boolean(options.include_text), options.max_text_bytes), 5000);
    if (output.error) return { status: 'failed', browser_app: appName, front_app: appName, error: output.error };
    const parts = splitObserveFields(output.text, 4);
    return {
      status: 'completed',
      browser_app: appName,
      front_app: appName,
      title: parts[0],
      url: parts[1],
      visible_text: parts[2],
      text_status: parts[3],
    };
  },
  async navigateBrowser(url) {
    if (platform() !== 'darwin') return { status: 'unsupported', url, error: 'browser_navigate is implemented for macOS' };
    const front = await macOSBrowserComputerHost.observeComputer({
      target: 'frontmost_window',
      include_text: false,
      include_screenshot: false,
      max_text_bytes: defaultObserveTextBytes,
    });
    const appName = (front.front_app || '').trim();
    if (browserAppSupported(appName)) {
      const output = await runAppleScript(browserNavigateScript(appName, url), 5000);
      return output.error
        ? { status: 'failed', url, front_app: appName, browser_app: appName, method: 'frontmost_browser_applescript', error: output.error }
        : { status: 'completed', url, front_app: appName, browser_app: appName, method: 'frontmost_browser_applescript' };
    }
    const result = await runProcess('open', [url], 5000);
    return result.error
      ? { status: 'failed', url, front_app: appName, method: 'default_browser_open', error: result.error }
      : { status: 'completed', url, front_app: appName, method: 'default_browser_open' };
  },
  async interactBrowser(action, selector, text) {
    if (platform() !== 'darwin') return { status: 'unsupported', action, selector, error: 'browser interaction is implemented for macOS' };
    const front = await macOSBrowserComputerHost.observeComputer({
      target: 'frontmost_window',
      include_text: false,
      include_screenshot: false,
      max_text_bytes: defaultObserveTextBytes,
    });
    const appName = (front.front_app || '').trim();
    if (!browserAppSupported(appName)) return { status: 'not_browser', action, selector, front_app: appName, error: 'frontmost app is not a supported browser' };
    const output = await runAppleScript(browserInteractionScript(appName, action, selector, text), 5000);
    if (output.error) return { status: 'failed', action, selector, front_app: appName, browser_app: appName, method: 'frontmost_browser_javascript', error: output.error };
    try {
      const result = output.text ? JSON.parse(output.text) : {};
      return {
        status: String(result.status || 'completed'),
        action,
        selector,
        front_app: appName,
        browser_app: appName,
        method: 'frontmost_browser_javascript',
        result,
        error: String(result.error || ''),
      };
    } catch {
      return { status: 'failed', action, selector, front_app: appName, browser_app: appName, method: 'frontmost_browser_javascript', error: 'browser interaction returned invalid JSON', result: { raw_output: output.text } };
    }
  },
};

function computerSnapshotOutput(snapshot: ComputerSnapshot, target: string, maxBytes: number): CapabilityResult {
  const text = truncateObserveTextBytes(redactSensitiveText(snapshot.visible_text || ''), maxBytes);
  const observeStatus = snapshot.error && !snapshot.front_app ? 'failed' : (snapshot.status || 'completed');
  return {
    status: 'completed',
    observe_status: observeStatus,
    target,
    frontmost_app: snapshot.front_app || '',
    bundle_id: snapshot.bundle_id || '',
    window_title: snapshot.window_title || '',
    visible_text: text.text,
    visible_text_summary: observeTextSummary(text.text, snapshot.window_title || ''),
    text_status: snapshot.text_status || '',
    text_truncated: text.truncated,
    max_text_bytes: maxBytes,
    screenshot_ref: snapshot.screenshot_ref || '',
    screenshot_error: snapshot.screenshot_error || '',
    privacy_level: 'private_content',
    interaction_allowed: false,
    error: snapshot.error || '',
    summary: observeTextSummary(text.text, snapshot.window_title || snapshot.error || 'computer observe completed'),
    mode: 'computer_observe_v2_macos_snapshot',
  };
}

function browserNavigatePolicyBlocked(rawURL: string, reason: string): CapabilityResult {
  return {
    status: 'completed',
    navigation_status: 'policy_blocked',
    requested_url: rawURL,
    reason,
    http_fetch_used: false,
    playwright_used: false,
    interaction_allowed: false,
    summary: `browser_navigate policy_blocked: ${reason}`,
    mode: 'browser_navigate_v1_macos',
  };
}

function normalizedObserveRequest(req: ObserveRequest, target: string, maxBytes: number): Required<ObserveRequest> {
  return {
    target,
    include_text: Boolean(req.include_text),
    include_screenshot: Boolean(req.include_screenshot),
    max_text_bytes: maxBytes,
  };
}

function computerObserveScript(includeText: boolean): string {
  return `
set sep to ASCII character 31
set appName to ""
set bundleID to ""
set winTitle to ""
set textBlob to ""
set textStatus to "not_requested"
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set appName to name of frontProc
  try
    set bundleID to bundle identifier of frontProc
  end try
  try
    set winTitle to name of front window of frontProc
  end try
  if ${appleScriptBool(includeText)} then
    set textStatus to "empty"
    try
      set textItems to {}
      repeat with itemRef in static texts of front window of frontProc
        try
          set end of textItems to value of itemRef as text
        end try
      end repeat
      set AppleScript's text item delimiters to linefeed
      set textBlob to textItems as text
      if textBlob is not "" then set textStatus to "ok"
    on error errMsg
      set textStatus to errMsg
    end try
  end if
end tell
return appName & sep & bundleID & sep & winTitle & sep & textBlob & sep & textStatus
`;
}

function browserObserveScript(appName: string, includeText: boolean, maxTextBytes: unknown): string {
  const js = `document.body ? document.body.innerText.slice(0, ${boundedObserveTextBytes(maxTextBytes)}) : ''`;
  const app = appleScriptQuoted(appName);
  const quotedJS = appleScriptQuoted(js);
  if (appName === 'Safari') {
    return `
set sep to ASCII character 31
tell application ${app}
  if (count of windows) is 0 then error "no browser windows"
  set tabTitle to name of current tab of front window
  set tabURL to URL of current tab of front window
  set textBlob to ""
  set textStatus to "not_requested"
  if ${appleScriptBool(includeText)} then
    try
      set textBlob to do JavaScript ${quotedJS} in current tab of front window
      set textStatus to "ok"
    on error errMsg
      set textStatus to errMsg
    end try
  end if
end tell
return tabTitle & sep & tabURL & sep & textBlob & sep & textStatus
`;
  }
  return `
set sep to ASCII character 31
tell application ${app}
  if (count of windows) is 0 then error "no browser windows"
  set tabTitle to title of active tab of front window
  set tabURL to URL of active tab of front window
  set textBlob to ""
  set textStatus to "not_requested"
  if ${appleScriptBool(includeText)} then
    try
      set textBlob to execute active tab of front window javascript ${quotedJS}
      set textStatus to "ok"
    on error errMsg
      set textStatus to errMsg
    end try
  end if
end tell
return tabTitle & sep & tabURL & sep & textBlob & sep & textStatus
`;
}

function browserNavigateScript(appName: string, rawURL: string): string {
  const app = appleScriptQuoted(appName);
  const url = appleScriptQuoted(rawURL);
  if (appName === 'Safari') {
    return `
tell application ${app}
  if (count of windows) is 0 then make new document
  set URL of current tab of front window to ${url}
  activate
end tell
return "ok"
`;
  }
  return `
tell application ${app}
  if (count of windows) is 0 then make new window
  set URL of active tab of front window to ${url}
  activate
end tell
return "ok"
`;
}

function browserInteractionScript(appName: string, action: 'click' | 'type', selector: string, text: string): string {
  const app = appleScriptQuoted(appName);
  const js = appleScriptQuoted(browserInteractionJS(action, selector, text));
  if (appName === 'Safari') {
    return `
tell application ${app}
  if (count of windows) is 0 then error "no browser windows"
  return do JavaScript ${js} in current tab of front window
end tell
`;
  }
  return `
tell application ${app}
  if (count of windows) is 0 then error "no browser windows"
  return execute active tab of front window javascript ${js}
end tell
`;
}

function browserInteractionJS(action: 'click' | 'type', selector: string, text: string): string {
  return `(function() {
  const action = ${JSON.stringify(action)};
  const selector = ${JSON.stringify(selector)};
  const text = ${JSON.stringify(text)};
  function result(value) { return JSON.stringify(value); }
  let element;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    return result({status: "invalid_selector", action, selector, error: String(error)});
  }
  if (!element) return result({status: "not_found", action, selector});
  try {
    element.scrollIntoView({block: "center", inline: "center"});
    element.focus && element.focus();
    const rect = element.getBoundingClientRect();
    const eventOptions = {bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2};
    if (action === "click") {
      element.dispatchEvent(new MouseEvent("mouseover", eventOptions));
      element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      if (typeof element.click === "function") element.click();
      else element.dispatchEvent(new MouseEvent("click", eventOptions));
      return result({status: "completed", action, selector, tag: element.tagName, text_preview: (element.innerText || element.value || "").slice(0, 80)});
    }
    if (action === "type") {
      if (element.isContentEditable) {
        element.textContent = text;
      } else if ("value" in element) {
        const prototype = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) descriptor.set.call(element, text);
        else element.value = text;
      } else {
        return result({status: "unsupported_element", action, selector, tag: element.tagName});
      }
      element.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));
      element.dispatchEvent(new Event("change", {bubbles: true}));
      return result({status: "completed", action, selector, tag: element.tagName, text_length: text.length});
    }
    return result({status: "unsupported_action", action, selector});
  } catch (error) {
    return result({status: "failed", action, selector, error: String(error)});
  }
})()`;
}

async function runAppleScript(script: string, timeoutMs: number): Promise<{ text: string; error: string }> {
  return runProcess('osascript', ['-e', script], timeoutMs);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ text: string; error: string }> {
  const tempDir = mkdtempSync(join(tmpdir(), 'joi-browser-computer-'));
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: tempDir } });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { stderr += error.message; });
    child.on('close', (code) => {
      clearTimeout(timer);
      rmSync(tempDir, { recursive: true, force: true });
      const text = redactSensitiveText(stdout.trim());
      const errorText = timedOut ? `${command} timed out` : (code === 0 ? '' : redactSensitiveText((stderr || stdout).trim()));
      resolveResult({ text, error: errorText });
    });
  });
}

function splitObserveFields(output: string, count: number): string[] {
  const parts = output.split(observeFieldSeparator);
  while (parts.length < count) parts.push('');
  if (parts.length > count) return [...parts.slice(0, count - 1), parts.slice(count - 1).join(observeFieldSeparator)];
  return parts;
}

function browserAppSupported(appName: string): boolean {
  return ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Arc', 'Safari'].includes(appName.trim());
}

function observeTextSummary(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback.trim();
  return truncateObserveTextBytes(trimmed, 900).text;
}

function truncateObserveTextBytes(value: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (limit <= 0 || bytes.length <= limit) return { text: value, truncated: false };
  let end = limit;
  while (end > 0 && Buffer.from(value.slice(0, end), 'utf8').length > limit) end--;
  return { text: value.slice(0, end), truncated: true };
}

function boundedObserveTextBytes(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return defaultObserveTextBytes;
  return Math.min(Math.floor(number), maxObserveTextBytes);
}

function normalizedPermissionProfile(value: unknown): PermissionProfile {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'workspace_write') return 'workspace_write';
  if (text === 'danger_full_access') return 'danger_full_access';
  return 'read_only';
}

function appleScriptBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function appleScriptQuoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+/gi, (_match, key) => `${key}=[REDACTED]`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function policyDenied(message: string): Error {
  return new Error(`policy_denied: ${message}`);
}
