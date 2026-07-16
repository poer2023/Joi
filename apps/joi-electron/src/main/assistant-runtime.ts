import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssistantActionRequest, AssistantActionResult, AssistantCalendarItem } from '../../../../packages/shared-types/src/desktop-api.ts';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite.ts';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain.ts';
import { sendTestTelegramMessage } from '../../../../packages/runtime/src/telegram.ts';
import { analyzeImageFile } from './media-analysis.ts';

type CommandResult = { stdout: string; stderr: string; exit_code: number };

export class AssistantRuntimeManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private captureRunning = false;
  private readonly store: JoiSQLiteStore;
  private readonly secrets: KeychainSecretStore;
  private readonly outputDir: string;
  private readonly sendIMessage?: (spaceID?: string, message?: string) => Promise<unknown> | unknown;

  constructor(
    store: JoiSQLiteStore,
    secrets: KeychainSecretStore,
    outputDir: string,
    sendIMessage?: (spaceID?: string, message?: string) => Promise<unknown> | unknown,
  ) {
    this.store = store;
    this.secrets = secrets;
    this.outputDir = outputDir;
    this.sendIMessage = sendIMessage;
  }

  resume(): void {
    const snapshot = this.store.getAssistantWorkspace();
    if (snapshot.capture.active && snapshot.capture.session_id) {
      this.startCapture(snapshot.capture.session_id, snapshot.capture.interval_seconds);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async execute(input: AssistantActionRequest): Promise<AssistantActionResult> {
    const action = String(input.action || '').trim();
    if (action === 'start_activity') {
      const result = this.store.executeAssistantAction(input);
      const snapshot = result.snapshot || this.store.getAssistantWorkspace();
      if (snapshot.capture.session_id) this.startCapture(snapshot.capture.session_id, snapshot.capture.interval_seconds);
      return result;
    }
    if (action === 'stop_activity') {
      this.dispose();
      return this.store.executeAssistantAction(input);
    }
    if (action === 'capture_activity_now') {
      const sessionID = input.session_id || this.store.getAssistantWorkspace().capture.session_id;
      if (!sessionID) throw new Error('activity capture is not active');
      const item = await this.captureSnapshot(sessionID);
      return { ok: true, action, item, snapshot: this.store.getAssistantWorkspace() };
    }
    if (action === 'publish_calendar_item') {
      const item = this.store.getAssistantWorkspace().calendar.find((entry) => entry.id === input.id);
      if (!item) throw new Error(`calendar item not found: ${input.id || ''}`);
      const published = await this.publishCalendarItem(item);
      return this.store.executeAssistantAction({
        action: 'mark_calendar_published',
        id: item.id,
        provider: 'macos_calendar',
        metadata: { external_id: published.external_id, calendar: published.calendar },
      });
    }
    if (action === 'configure_channel') {
      const provider = String(input.provider || '').trim().toLowerCase();
      const webhook = typeof input.metadata?.webhook_url === 'string' ? input.metadata.webhook_url.trim() : '';
      if (webhook) {
        await this.secrets.save(channelSecretName(provider), webhook);
      }
      return this.store.executeAssistantAction({
        ...input,
        metadata: {
          ...(input.metadata || {}),
          webhook_url: undefined,
          configured: Boolean(webhook || input.metadata?.configured || input.enabled),
          credential_store: webhook ? 'macos_keychain' : input.metadata?.credential_store,
        },
      });
    }
    if (action === 'send_channel_message') {
      const output = await this.sendChannelMessage(input);
      return { ok: true, action, item: output, snapshot: this.store.getAssistantWorkspace() };
    }
    return this.store.executeAssistantAction(input);
  }

  private startCapture(sessionID: string, intervalSeconds: number): void {
    this.dispose();
    const interval = Math.max(15, Math.min(3600, Math.round(intervalSeconds || 60)));
    void this.captureSnapshot(sessionID).catch(() => undefined);
    this.timer = setInterval(() => {
      void this.captureSnapshot(sessionID).catch(() => undefined);
    }, interval * 1_000);
    this.timer.unref?.();
  }

  private async captureSnapshot(sessionID: string): Promise<Record<string, unknown>> {
    if (this.captureRunning) return { skipped: true, reason: 'capture_already_running' };
    this.captureRunning = true;
    try {
      const context = await frontmostApplicationContext();
      const captureDir = join(this.outputDir, 'activity', sessionID);
      await mkdir(captureDir, { recursive: true });
      const screenshotPath = join(captureDir, `capture-${Date.now()}-${randomUUID().slice(0, 6)}.png`);
      const screenshot = await runCommand('/usr/sbin/screencapture', ['-x', '-t', 'png', screenshotPath], 30_000);
      let recognizedText = '';
      let visionSummary = '';
      if (screenshot.exit_code === 0) {
        try {
          const analyzed = await analyzeImageFile(screenshotPath, join(captureDir, 'vision'));
          recognizedText = String(analyzed.text || '').slice(0, 12_000);
          visionSummary = String(analyzed.summary || '');
        } catch (error) {
          visionSummary = error instanceof Error ? error.message : String(error);
        }
      }
      const text = recognizedText || [context.app_name, context.window_title].filter(Boolean).join(' · ');
      const recorded = this.store.executeAssistantAction({
        action: 'record_activity',
        session_id: sessionID,
        text,
        path: screenshot.exit_code === 0 ? screenshotPath : undefined,
        metadata: {
          event_type: 'screen_snapshot',
          app_name: context.app_name,
          window_title: context.window_title,
          ocr_provider: 'macos_vision',
          vision_summary: visionSummary,
          screenshot_error: screenshot.exit_code === 0 ? undefined : compactError(screenshot),
        },
      });
      return { recorded: true, item: recorded.item, screenshot_path: screenshot.exit_code === 0 ? screenshotPath : '', ...context };
    } finally {
      this.captureRunning = false;
    }
  }

  private async publishCalendarItem(item: AssistantCalendarItem): Promise<{ external_id: string; calendar: string }> {
    const directory = join(this.outputDir, 'calendar');
    await mkdir(directory, { recursive: true });
    const scriptPath = join(directory, 'publish-event.swift');
    await writeFile(scriptPath, eventKitScript, 'utf8');
    const result = await runCommand('/usr/bin/swift', [
      scriptPath,
      item.title,
      item.start_at,
      item.end_at || '',
      item.notes || '',
    ], 120_000);
    if (result.exit_code !== 0) throw new Error(`macOS Calendar publish failed: ${compactError(result)}`);
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
    const parsed = JSON.parse(line) as { external_id?: string; calendar?: string };
    if (!parsed.external_id) throw new Error('macOS Calendar did not return an event identifier');
    return { external_id: parsed.external_id, calendar: parsed.calendar || '' };
  }

  private async sendChannelMessage(input: AssistantActionRequest): Promise<Record<string, unknown>> {
    const provider = String(input.provider || '').trim().toLowerCase();
    const text = String(input.text || '').trim();
    if (!provider || !text) throw new Error('channel provider and text are required');
    if (provider === 'telegram') {
      const token = await this.secrets.resolve('TELEGRAM_BOT_TOKEN');
      const chatID = String(input.metadata?.target || input.id || '').trim();
      if (!chatID) throw new Error('Telegram chat id is required');
      const result = await sendTestTelegramMessage({ token, chatID, message: text });
      return { provider, target: chatID, result };
    }
    if (provider === 'imessage') {
      if (!this.sendIMessage) throw new Error('iMessage sidecar is not available');
      const target = String(input.metadata?.target || input.id || '').trim();
      return { provider, target, result: await this.sendIMessage(target || undefined, text) };
    }
    if (provider === 'discord' || provider === 'feishu') {
      const webhook = await this.secrets.resolve(channelSecretName(provider));
      if (!webhook) throw new Error(`${provider} webhook is not configured`);
      const body = provider === 'discord'
        ? { content: text }
        : { msg_type: 'text', content: { text } };
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`${provider} webhook HTTP ${response.status}: ${responseText.slice(0, 500)}`);
      return { provider, status: response.status, response: responseText.slice(0, 1_000) };
    }
    if (provider === 'email') {
      const recipient = String(input.metadata?.target || input.id || '').trim();
      if (!recipient || !recipient.includes('@')) throw new Error('email recipient is required');
      const subject = String(input.title || 'Joi').trim().slice(0, 200);
      const script = [
        'tell application "Mail"',
        `set newMessage to make new outgoing message with properties {subject:${appleScriptString(subject)}, content:${appleScriptString(`${text}\n`)}, visible:false}`,
        `tell newMessage to make new to recipient at end of to recipients with properties {address:${appleScriptString(recipient)}}`,
        'send newMessage',
        'end tell',
      ].join('\n');
      const result = await runCommand('/usr/bin/osascript', ['-e', script], 60_000);
      if (result.exit_code !== 0) throw new Error(`Mail send failed: ${compactError(result)}`);
      return { provider, target: recipient, sent: true };
    }
    throw new Error(`Unsupported assistant channel: ${provider}`);
  }
}

async function frontmostApplicationContext(): Promise<{ app_name: string; window_title: string }> {
  const script = [
    'tell application "System Events"',
    'set frontProcess to first application process whose frontmost is true',
    'set appName to name of frontProcess',
    'set windowName to ""',
    'try',
    'set windowName to name of front window of frontProcess',
    'end try',
    'return appName & linefeed & windowName',
    'end tell',
  ].join('\n');
  const result = await runCommand('/usr/bin/osascript', ['-e', script], 30_000);
  if (result.exit_code !== 0) return { app_name: '', window_title: '' };
  const [appName = '', windowTitle = ''] = result.stdout.trim().split(/\r?\n/, 2);
  return { app_name: appName, window_title: windowTitle };
}

function runCommand(command: string, args: string[], timeoutMS: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-4 * 1024 * 1024); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4 * 1024 * 1024); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1_000).unref();
    }, timeoutMS);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? -1 });
    });
  });
}

function compactError(result: CommandResult): string {
  return (result.stderr || result.stdout || 'unknown error').replace(/\s+/g, ' ').trim().slice(-1_500);
}

function channelSecretName(provider: string): string {
  return `ASSISTANT_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_WEBHOOK`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '" & linefeed & "')}"`;
}

const eventKitScript = String.raw`
import EventKit
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 4 else {
  fputs("missing event arguments\n", stderr)
  exit(2)
}
let title = arguments[0]
let startText = arguments[1]
let endText = arguments[2]
let notes = arguments[3]
let parser = ISO8601DateFormatter()
parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
let fallbackParser = ISO8601DateFormatter()
guard let start = parser.date(from: startText) ?? fallbackParser.date(from: startText) else {
  fputs("invalid start date\n", stderr)
  exit(3)
}
let end = parser.date(from: endText) ?? fallbackParser.date(from: endText) ?? start.addingTimeInterval(3600)
let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var allowed = false
store.requestAccess(to: .event) { granted, error in
  allowed = granted
  if let error = error { fputs("\(error)\n", stderr) }
  semaphore.signal()
}
_ = semaphore.wait(timeout: .now() + 60)
guard allowed else {
  fputs("calendar access denied\n", stderr)
  exit(4)
}
guard let calendar = store.defaultCalendarForNewEvents else {
  fputs("no writable default calendar\n", stderr)
  exit(5)
}
let event = EKEvent(eventStore: store)
event.calendar = calendar
event.title = title
event.startDate = start
event.endDate = max(end, start.addingTimeInterval(60))
event.notes = notes
do {
  try store.save(event, span: .thisEvent, commit: true)
  let payload: [String: String] = ["external_id": event.eventIdentifier ?? "", "calendar": calendar.title]
  let data = try JSONSerialization.data(withJSONObject: payload)
  print(String(data: data, encoding: .utf8) ?? "{}")
} catch {
  fputs("\(error)\n", stderr)
  exit(6)
}
`;
