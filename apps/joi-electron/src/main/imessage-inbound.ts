import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ChatRequest, ChatResponse, ConnectionTest, PhotonIMessageStatus, SettingsRecord } from '../../../../packages/shared-types/src/desktop-api';
import type { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import { PHOTON_PROJECT_SECRET_SECRET, testPhotonIMessageConnection } from '../../../../packages/runtime/src/imessage';
import { canRunRealToolCalling, emitRunEvents, resolveAPIKeyForModelEndpoint, runLiveElectronToolCallingChat } from './ipc';

type IMessageInboundOptions = {
  store: JoiSQLiteStore;
  secrets: KeychainSecretStore;
  appDirs: { userDataDir: string; logDir: string };
  getWindow: () => BrowserWindow | null;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
};

type PhotonInboundEvent = {
  messageId?: string | null;
  direction?: string | null;
  space?: { id?: string | null; type?: string | null; phone?: string | null };
  sender?: { id?: string | null };
  content?: PhotonContent;
  timestamp?: string | null;
};

type PhotonContent = {
  type?: string;
  text?: string;
  emoji?: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  duration?: number | null;
  items?: Array<{ id?: string | null; content?: PhotonContent }>;
  targetMessageId?: string | null;
  targetDirection?: string | null;
};

type SidecarConfig = {
  projectID: string;
  projectSecret: string;
  port: number;
  allowedUsers: Set<string>;
  requireMention: boolean;
};

type SidecarResponse = {
  ok?: boolean;
  messageId?: string | null;
  error?: string;
};

const defaultSidecarPort = 8790;
const retryDelayMs = 3000;
const dedupMaxSize = 4000;
const dedupWindowMs = 48 * 3600 * 1000;
const typingPulseIntervalMs = 4000;
const mentionPatterns = [
  /(?<![\w@])@?joi\b[,:\-]?/i,
  /(?<![\w@])@?hermes\b[,:\-]?/i,
];
const execFileAsync = promisify(execFile);

export class IMessageInboundService {
  private readonly store: JoiSQLiteStore;
  private readonly secrets: KeychainSecretStore;
  private readonly appDirs: { userDataDir: string; logDir: string };
  private readonly getWindow: () => BrowserWindow | null;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private controller: AbortController | null = null;
  private reconfigureTimer: NodeJS.Timeout | null = null;
  private sidecar: ChildProcessWithoutNullStreams | null = null;
  private sidecarToken = '';
  private activeRuns = new Map<string, AbortController>();
  private seenMessages = new Map<string, number>();
  private configKey = '';
  private lastError = '';
  private connected = false;
  private projectSecretConfigured = false;
  private installPromise: Promise<string> | null = null;

  constructor(options: IMessageInboundOptions) {
    this.store = options.store;
    this.secrets = options.secrets;
    this.appDirs = options.appDirs;
    this.getWindow = options.getWindow;
    this.logger = options.logger || console;
  }

  async start(): Promise<void> {
    await this.reconfigure();
  }

  scheduleReconfigure(): void {
    if (this.reconfigureTimer) clearTimeout(this.reconfigureTimer);
    this.reconfigureTimer = setTimeout(() => {
      this.reconfigureTimer = null;
      void this.reconfigure();
    }, 250);
  }

  async reconfigure(): Promise<void> {
    const settings = this.store.getSettings();
    const projectSecret = await this.secrets.resolve(PHOTON_PROJECT_SECRET_SECRET);
    this.projectSecretConfigured = Boolean(projectSecret.trim());
    const projectID = settings.imessage_project_id?.trim() || process.env.PHOTON_PROJECT_ID || '';
    if (!settings.imessage_enabled || !projectID || !projectSecret.trim()) {
      await this.stopSidecar();
      this.stopInboundOnly();
      this.configKey = '';
      this.connected = false;
      return;
    }

    const nextConfig: SidecarConfig = {
      projectID,
      projectSecret: projectSecret.trim(),
      port: settings.imessage_sidecar_port || Number(process.env.PHOTON_SIDECAR_PORT || 0) || defaultSidecarPort,
      allowedUsers: allowedUsers(settings.imessage_allowed_users || settings.imessage_operator_phone || ''),
      requireMention: Boolean(settings.imessage_require_mention),
    };
    const nextKey = JSON.stringify({
      projectID: nextConfig.projectID,
      port: nextConfig.port,
      allowedUsers: [...nextConfig.allowedUsers].sort(),
      requireMention: nextConfig.requireMention,
    });
    if (this.controller && !this.controller.signal.aborted && this.configKey === nextKey) return;

    this.stopInboundOnly();
    await this.stopSidecar();
    this.configKey = nextKey;
    this.controller = new AbortController();
    try {
      await this.startSidecar(nextConfig, this.controller.signal);
      this.connected = true;
      void this.inboundLoop(nextConfig, this.controller.signal);
    } catch (error) {
      this.connected = false;
      this.lastError = safeErrorMessage(error);
      this.logger.warn('imessage inbound start failed', this.lastError);
      this.stopInboundOnly();
      await this.stopSidecar();
    }
  }

  stop(): void {
    if (this.reconfigureTimer) {
      clearTimeout(this.reconfigureTimer);
      this.reconfigureTimer = null;
    }
    this.stopInboundOnly();
    void this.stopSidecar();
    for (const controller of this.activeRuns.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.activeRuns.clear();
  }

  status(): PhotonIMessageStatus {
    const settings = this.store.getSettings();
    return {
      enabled: Boolean(settings.imessage_enabled),
      configured: Boolean(settings.imessage_project_id?.trim()) && this.projectSecretConfigured,
      connected: this.connected,
      sidecar_running: Boolean(this.sidecar && this.sidecar.exitCode === null),
      sidecar_port: settings.imessage_sidecar_port || defaultSidecarPort,
      project_id: settings.imessage_project_id || '',
      operator_phone: settings.imessage_operator_phone || '',
      assigned_number: settings.imessage_assigned_number || '',
      allowed_users: settings.imessage_allowed_users || '',
      require_mention: Boolean(settings.imessage_require_mention),
      last_error: this.lastError || undefined,
    };
  }

  async testConnection(): Promise<ConnectionTest> {
    const settings = this.store.getSettings();
    const projectSecret = await this.secrets.resolve(PHOTON_PROJECT_SECRET_SECRET);
    this.projectSecretConfigured = Boolean(projectSecret.trim());
    const projectID = settings.imessage_project_id?.trim() || process.env.PHOTON_PROJECT_ID || '';
    const remote = await testPhotonIMessageConnection({
      project_id: projectID,
      project_secret: projectSecret,
    });
    if (!remote.ok) return remote;
    if (!settings.imessage_enabled) return { ok: true, status: 'credentials_ok_disabled' };
    await this.reconfigure();
    if (!this.connected) {
      return { ok: false, status: 'sidecar_failed', error_summary: this.lastError || 'Photon sidecar is not connected' };
    }
    return { ok: true, status: 'succeeded' };
  }

  async sendTestMessage(spaceID?: string, message?: string): Promise<ConnectionTest> {
    const settings = this.store.getSettings();
    const target = spaceID?.trim() || settings.imessage_home_channel?.trim() || settings.imessage_operator_phone?.trim() || '';
    if (!target) {
      return { ok: false, status: 'missing_space_id', error_summary: 'No iMessage space id or phone number configured' };
    }
    try {
      await this.reconfigure();
      if (!this.connected) throw new Error(this.lastError || 'Photon sidecar is not connected');
      await this.sidecarCall('/send', {
        spaceId: target,
        text: message || 'Joi Desktop iMessage test',
        format: 'markdown',
      });
      return { ok: true, status: 'succeeded' };
    } catch (error) {
      return { ok: false, status: 'failed', error_summary: safeErrorMessage(error) };
    }
  }

  private stopInboundOnly(): void {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    this.controller = null;
    this.connected = false;
  }

  private async startSidecar(config: SidecarConfig, signal: AbortSignal): Promise<void> {
    const sidecarDir = await this.ensureSidecarInstalled();
    if (signal.aborted) return;
    this.sidecarToken = randomBytes(24).toString('hex');
    const nodeBin = process.env.PHOTON_NODE_BIN || 'node';
    const env = {
      ...process.env,
      PHOTON_PROJECT_ID: config.projectID,
      PHOTON_PROJECT_SECRET: config.projectSecret,
      PHOTON_SIDECAR_PORT: String(config.port),
      PHOTON_SIDECAR_BIND: '127.0.0.1',
      PHOTON_SIDECAR_TOKEN: this.sidecarToken,
      PHOTON_SIDECAR_WATCH_STDIN: '1',
    };
    this.sidecar = spawn(nodeBin, ['index.mjs'], {
      cwd: sidecarDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.sidecar.stdout.on('data', (chunk: Buffer) => {
      this.logger.info(`[imessage-sidecar] ${chunk.toString('utf8').trim()}`);
    });
    this.sidecar.stderr.on('data', (chunk: Buffer) => {
      this.logger.info(`[imessage-sidecar] ${chunk.toString('utf8').trim()}`);
    });
    this.sidecar.on('exit', (code, procSignal) => {
      if (!this.controller?.signal.aborted) {
        this.connected = false;
        this.lastError = `sidecar exited: ${code ?? procSignal ?? 'unknown'}`;
        this.logger.warn('imessage sidecar exited', this.lastError);
      }
    });
    await this.waitForHealth(config.port, signal);
  }

  private async stopSidecar(): Promise<void> {
    const proc = this.sidecar;
    if (!proc) return;
    this.sidecar = null;
    try {
      proc.stdin.end();
    } catch {
      // ignore
    }
    if (this.sidecarToken) {
      await this.sidecarCall('/shutdown', {}, { timeoutMs: 1500 }).catch(() => undefined);
    }
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  }

  private async ensureSidecarInstalled(): Promise<string> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.installSidecar();
    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
    }
  }

  private async installSidecar(): Promise<string> {
    const sourceDir = resolveSidecarSourceDir();
    const targetDir = join(this.appDirs.userDataDir, 'photon-sidecar');
    mkdirSync(targetDir, { recursive: true });
    const sourcePackage = readFileSync(join(sourceDir, 'package.json'), 'utf8');
    const targetPackagePath = join(targetDir, 'package.json');
    const packageChanged = !existsSync(targetPackagePath) || readFileSync(targetPackagePath, 'utf8') !== sourcePackage;
    copyFileSync(join(sourceDir, 'index.mjs'), join(targetDir, 'index.mjs'));
    writeFileSync(targetPackagePath, sourcePackage);
    if (packageChanged) {
      rmSync(join(targetDir, 'package-lock.json'), { force: true });
    }
    if (packageChanged || !existsSync(join(targetDir, 'node_modules/spectrum-ts/package.json'))) {
      const npmBin = process.env.PHOTON_NPM_BIN || 'npm';
      this.logger.info('installing Photon sidecar dependencies');
      await execFileAsync(npmBin, ['install', '--omit=dev'], {
        cwd: targetDir,
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 12,
      });
    }
    return targetDir;
  }

  private async waitForHealth(port: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 20000;
    let lastError = '';
    while (Date.now() < deadline && !signal.aborted) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
          method: 'POST',
          headers: sidecarHeaders(this.sidecarToken),
          signal,
        });
        if (response.ok) {
          await response.arrayBuffer().catch(() => new ArrayBuffer(0));
          return;
        }
        lastError = `${response.status} ${response.statusText}`;
      } catch (error) {
        lastError = safeErrorMessage(error);
      }
      await sleep(250, signal);
    }
    throw new Error(`Photon sidecar did not become healthy: ${lastError || 'timeout'}`);
  }

  private async inboundLoop(config: SidecarConfig, signal: AbortSignal): Promise<void> {
    let backoff = 1;
    this.logger.info('imessage inbound started');
    while (!signal.aborted) {
      try {
        const response = await fetch(`http://127.0.0.1:${config.port}/inbound`, {
          headers: sidecarHeaders(this.sidecarToken),
          signal,
        });
        if (!response.ok || !response.body) throw new Error(`/inbound returned ${response.status}`);
        backoff = 1;
        await this.consumeInboundStream(response.body, config, signal);
      } catch (error) {
        if (!signal.aborted) {
          this.connected = false;
          this.lastError = safeErrorMessage(error);
          this.logger.warn('imessage inbound stream dropped', this.lastError);
          await sleep(backoff * 1000, signal);
          backoff = Math.min(backoff * 2, 30);
        }
      }
    }
    this.logger.info('imessage inbound stopped');
  }

  private async consumeInboundStream(stream: ReadableStream<Uint8Array>, config: SidecarConfig, signal: AbortSignal): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          await this.handleInboundLine(trimmed, config);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async handleInboundLine(line: string, config: SidecarConfig): Promise<void> {
    let event: PhotonInboundEvent;
    try {
      event = JSON.parse(line) as PhotonInboundEvent;
    } catch {
      return;
    }
    if (event.messageId && this.isDuplicate(event.messageId)) return;
    await this.handleInboundEvent(event, config);
  }

  private isDuplicate(messageID: string): boolean {
    const now = Date.now();
    const seenAt = this.seenMessages.get(messageID);
    if (seenAt && now - seenAt < dedupWindowMs) return true;
    if (this.seenMessages.has(messageID)) this.seenMessages.delete(messageID);
    this.seenMessages.set(messageID, now);
    if (this.seenMessages.size > dedupMaxSize) {
      for (const key of [...this.seenMessages.keys()].slice(0, this.seenMessages.size - dedupMaxSize)) {
        this.seenMessages.delete(key);
      }
    }
    return false;
  }

  private async handleInboundEvent(event: PhotonInboundEvent, config: SidecarConfig): Promise<void> {
    const spaceID = event.space?.id?.trim() || '';
    if (!spaceID) return;
    const senderID = event.sender?.id?.trim() || event.space?.phone?.trim() || '';
    if (config.allowedUsers.size > 0 && (!senderID || !config.allowedUsers.has(normalizeUserID(senderID)))) {
      this.logger.info(`imessage ignored unauthorized sender ${senderID || 'unknown'}`);
      return;
    }
    const chatType = event.space?.type === 'group' ? 'group' : 'dm';
    const text = normalizePhotonText(event.content);
    if (!text) return;
    if (isStatusCommand(text)) {
      await this.sidecarSend(spaceID, await this.imessageStatusReply());
      return;
    }
    let messageText = text;
    if (chatType === 'group' && config.requireMention) {
      if (!mentionPatterns.some((pattern) => pattern.test(messageText))) return;
      messageText = cleanMentionText(messageText);
    }
    await this.runJoiAndReply(spaceID, senderID || spaceID, messageText);
  }

  private async imessageStatusReply(): Promise<string> {
    const settings = this.store.getSettings();
    let modelCredential = 'missing';
    try {
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, this.secrets);
      modelCredential = apiKey.trim() ? 'available' : 'missing';
    } catch (error) {
      modelCredential = `failed: ${compactText(safeErrorMessage(error), 180)}`;
    }
    const health = this.store.systemHealth();
    return [
      'Joi iMessage online.',
      `iMessage: ${settings.imessage_enabled ? 'enabled' : 'disabled'}`,
      `Photon: ${this.connected ? 'connected' : 'not connected'}`,
      `Model: ${settings.model_provider || 'unset'} / ${settings.model_name || 'unset'}`,
      `Model credential: ${modelCredential}`,
      `SQLite: ${health.service_status.sqlite ? 'ok' : 'failed'}`,
    ].join('\n');
  }

  private async runJoiAndReply(spaceID: string, senderID: string, text: string): Promise<void> {
    const req: ChatRequest = {
      conversation_id: stableInboundConversationID('imessage', `space:${spaceID || senderID}`),
      channel: 'imessage',
      user_id: senderID ? `imessage:${senderID}` : `imessage:${spaceID}`,
      message: normalizeIMessageText(text),
      preferred_node: 'main-node',
      allow_worker: false,
      runtime_mode: 'tool_calling',
      permission_profile: 'read_only',
    };
    const stopTyping = this.startTypingLoop(spaceID);
    try {
      const settings = this.store.getSettings();
      const apiKey = await resolveAPIKeyForModelEndpoint(settings, this.secrets);
      if (!canRunRealToolCalling(settings, apiKey, req)) {
        await this.sidecarSend(spaceID, 'Joi iMessage received the message, but the model is not configured. Configure the model in Joi Desktop first.');
        return;
      }
      const result = await runLiveElectronToolCallingChat(req, settings, apiKey, this.store, this.activeRuns, (runID) => {
        const window = this.getWindow();
        if (window && !window.isDestroyed()) emitRunEvents(window, this.store.getRunTrace(runID));
      });
      const window = this.getWindow();
      if (window && !window.isDestroyed()) emitRunEvents(window, this.store.getRunTrace(result.run_id));
      await this.sidecarSend(spaceID, imessageReply(result));
    } catch (error) {
      this.logger.error('imessage inbound run failed', error);
      await this.sidecarSend(spaceID, `处理失败：${compactText(safeErrorMessage(error), 260)}`).catch(() => undefined);
    } finally {
      await stopTyping();
    }
  }

  private startTypingLoop(spaceID: string): () => Promise<void> {
    let stopped = false;
    const pulse = () => {
      if (stopped) return;
      void this.sidecarCall('/typing', { spaceId: spaceID, state: 'start' }, { timeoutMs: 10000 }).catch(() => undefined);
    };
    pulse();
    const timer = setInterval(pulse, typingPulseIntervalMs);
    timer.unref?.();
    return async () => {
      stopped = true;
      clearInterval(timer);
      await this.sidecarCall('/typing', { spaceId: spaceID, state: 'stop' }, { timeoutMs: 10000 }).catch(() => undefined);
    };
  }

  private async sidecarSend(spaceID: string, text: string): Promise<void> {
    await this.sidecarCall('/send', {
      spaceId: spaceID,
      text: compactText(text, 7600),
      format: process.env.PHOTON_MARKDOWN === 'false' ? 'text' : 'markdown',
    });
  }

  private async sidecarCall(path: string, body: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<SidecarResponse> {
    const settings = this.store.getSettings();
    const port = settings.imessage_sidecar_port || defaultSidecarPort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { ...sidecarHeaders(this.sidecarToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({ ok: false, error: 'non-json sidecar response' })) as SidecarResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `sidecar returned ${response.status}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveSidecarSourceDir(): string {
  const candidates = [
    process.env.JOI_PHOTON_SIDECAR_SOURCE,
    join(process.resourcesPath || '', 'photon-sidecar'),
    join(app.getAppPath(), 'resources/photon-sidecar'),
    join(dirname(app.getAppPath()), 'resources/photon-sidecar'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.mjs')) && existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  throw new Error(`Photon sidecar resources not found. Checked: ${candidates.join(', ')}`);
}

function sidecarHeaders(token: string): HeadersInit {
  return { 'X-Joi-Sidecar-Token': token };
}

function allowedUsers(value: string): Set<string> {
  return new Set(value.split(/[\s,]+/).map(normalizeUserID).filter(Boolean));
}

function normalizeUserID(value: string): string {
  return value.trim().replace(/[^\d+@._-]/g, '');
}

function stableInboundConversationID(channel: 'imessage', externalKey: string): string {
  const normalized = externalKey.trim() || 'unknown';
  const slug = normalized.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `conv_${channel}_${slug}_${digest}`;
}

function normalizePhotonText(content?: PhotonContent): string {
  if (!content) return '';
  if (content.type === 'text') return content.text?.trim() || '';
  if (content.type === 'reaction') return `reaction:added:${content.emoji || ''}`;
  if (content.type === 'attachment' || content.type === 'voice') {
    const label = content.type === 'voice' ? 'voice' : 'attachment';
    const name = content.name || 'unnamed';
    const mime = content.mimeType || 'unknown MIME';
    return `[Photon ${label} received: ${name} (${mime})]`;
  }
  if (content.type === 'group') {
    return (content.items || []).map((item) => normalizePhotonText(item.content)).filter(Boolean).join('\n').trim();
  }
  return content.type ? `[Photon content type not handled: ${content.type}]` : '';
}

function isStatusCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/joi_status';
}

function normalizeIMessageText(text: string): string {
  if (text.trim().toLowerCase() === '/joi_status') return 'Joi 自检';
  return text;
}

function cleanMentionText(text: string): string {
  const trimmed = text.trimStart();
  for (const pattern of mentionPatterns) {
    const match = pattern.exec(trimmed);
    if (match && match.index === 0) {
      return trimmed.slice(match.index + match[0].length).replace(/^[\s,:\-]+/, '') || text;
    }
  }
  return text;
}

function imessageReply(result: ChatResponse): string {
  return compactText(result.response || 'Joi 已完成处理，但没有生成可见文本。', 1400);
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
