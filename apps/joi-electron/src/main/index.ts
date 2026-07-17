import { app, BrowserWindow, dialog, type MessageBoxSyncOptions } from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';
import { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import { startWorkerGateway, type WorkerGatewayServer } from '../../../../packages/runtime/src/worker-gateway';
import schemaSql from '../../../../database/sqlite/001_init_schema.sql?raw';
import { TelegramInboundService } from './telegram-inbound';
import { IMessageInboundService } from './imessage-inbound';
import { AutomationRunner, AutomationWebhookServer } from './automation';
import { stopJoiCommandHost } from './command-host';
import { JoiPluginManager } from './plugin-manager';
import { TelegramOutboundService } from './telegram-outbound';

const mainDir = dirname(fileURLToPath(import.meta.url));

function envFlag(name: string): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function envPath(name: string): string {
  const value = String(process.env[name] || '').trim();
  return value ? resolve(value) : '';
}

function isDesktopE2E(): boolean {
  return envFlag('JOI_DESKTOP_E2E');
}

function isCliHeadlessInvocation(commandLine: string[] = process.argv): boolean {
  return envFlag('JOI_CLI_HEADLESS') || commandLine.includes('--joi-cli-headless');
}

function configureAppPaths() {
  app.setName('Joi');
  const userDataDir = envPath('JOI_USER_DATA_DIR') || envPath('JOI_DESKTOP_USER_DATA_DIR') || join(app.getPath('appData'), 'Joi');
  const logDir = envPath('JOI_LOG_DIR') || envPath('JOI_DESKTOP_LOG_DIR') || join(userDataDir, 'logs');
  const backupDir = envPath('JOI_BACKUP_DIR') || envPath('JOI_DESKTOP_BACKUP_DIR') || join(userDataDir, 'backups');
  const dbPath = envPath('JOI_SQLITE_PATH') || envPath('JOI_DESKTOP_SQLITE_PATH') || join(userDataDir, 'joi.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(join(userDataDir, 'Shared Dictionary', 'cache'), { recursive: true });
  app.setPath('userData', userDataDir);
  return {
    userDataDir,
    logDir,
    backupDir,
    dbPath,
  };
}

const appDirs = configureAppPaths();
const cliHeadless = isCliHeadlessInvocation();
let mainWindow: BrowserWindow | null = null;
let store: JoiSQLiteStore | null = null;
let workerGateway: WorkerGatewayServer | null = null;
let telegramInbound: TelegramInboundService | null = null;
let imessageInbound: IMessageInboundService | null = null;
let automationRunner: AutomationRunner | null = null;
let automationWebhookServer: AutomationWebhookServer | null = null;
let pluginManager: JoiPluginManager | null = null;
let telegramOutbound: TelegramOutboundService | null = null;
let isQuitting = false;
let quitConfirmed = false;
const secrets = new KeychainSecretStore();

function ensureStore() {
  if (!store) {
    store = new JoiSQLiteStore({
      dbPath: appDirs.dbPath,
      schemaSql,
      logDir: appDirs.logDir,
      backupDir: appDirs.backupDir,
      version: app.getVersion(),
    });
  }
  return store;
}

function ensurePluginManager(sqliteStore: JoiSQLiteStore) {
  if (!pluginManager) {
    pluginManager = new JoiPluginManager(sqliteStore, appDirs.userDataDir);
  }
  return pluginManager;
}

function ensureTelegramOutbound(sqliteStore: JoiSQLiteStore) {
  if (!telegramOutbound) {
    telegramOutbound = new TelegramOutboundService({ store: sqliteStore, secrets, logger: console });
  }
  return telegramOutbound;
}

function showMainWindow(window: BrowserWindow | null = mainWindow) {
  if (!window || window.isDestroyed()) return;
  void app.dock?.show();
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function ensureMainWindow() {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  showMainWindow(mainWindow);
}

function createMainWindow() {
  if (!app.isReady()) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow(mainWindow);
    return;
  }
  const preloadPath = join(mainDir, '../preload/index.mjs');
  const sqliteStore = ensureStore();
  const managedPlugins = ensurePluginManager(sqliteStore);
  const outboundTelegram = !isDesktopE2E() && !envFlag('JOI_DISABLE_OUTBOUND_NOTIFICATIONS')
    ? ensureTelegramOutbound(sqliteStore)
    : null;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 560,
    minHeight: 720,
    title: 'Joi',
    // Use a full-size content view so the renderer's 36px titlebar shares the
    // same physical row as the native traffic lights instead of starting below it.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const inboundServicesEnabled = !isDesktopE2E() && !envFlag('JOI_DISABLE_INBOUND_SERVICES');
  if (inboundServicesEnabled) {
    if (!telegramInbound) {
      telegramInbound = new TelegramInboundService({
        store: sqliteStore,
        secrets,
        pluginManager: managedPlugins,
        getWindow: () => mainWindow,
        logger: console,
      });
      void telegramInbound.start();
    }
    if (!imessageInbound) {
      imessageInbound = new IMessageInboundService({
        store: sqliteStore,
        secrets,
        appDirs,
        getWindow: () => mainWindow,
        logger: console,
      });
      void imessageInbound.start();
    }
  }
  startAutomationServices(sqliteStore, managedPlugins, outboundTelegram);

  registerIpc(mainWindow, appDirs, sqliteStore, secrets, {
    pluginManager: managedPlugins,
    onTelegramConfigChanged: () => telegramInbound?.scheduleReconfigure(),
    onIMessageConfigChanged: () => imessageInbound?.scheduleReconfigure(),
    getTelegramStatus: () => telegramInbound?.status(),
    getIMessageStatus: () => imessageInbound?.status(),
    testIMessageConnection: () => imessageInbound?.testConnection(),
    sendTestIMessageMessage: (spaceID, message) => imessageInbound?.sendTestMessage(spaceID, message),
    deterministicChat: isDesktopE2E() || envFlag('JOI_DETERMINISTIC_CHAT'),
    getAutomationWebhookURL: (automation) => automationWebhookServer?.endpointFor(automation) || `http://127.0.0.1:18082/automation/webhooks/${encodeURIComponent(automation.slug)}`,
    requestAutomationDrain: () => automationRunner?.requestDrain(),
    deliverProactiveMessage: outboundTelegram ? (id) => outboundTelegram.deliverProactiveMessage(id) : undefined,
  });
  void startConfiguredWorkerGateway(sqliteStore);

  const window = mainWindow;
  let didShow = false;
  const revealWindow = () => {
    if (didShow) return;
    didShow = true;
    if (cliHeadless) return;
    showMainWindow(window);
  };

  window.once('ready-to-show', revealWindow);
  window.webContents.once('did-finish-load', () => {
    setTimeout(revealWindow, 50);
  });
  window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('renderer failed to load', { errorCode, errorDescription, validatedURL });
    revealWindow();
  });
  const fallbackTimer = setTimeout(revealWindow, 3000);
  fallbackTimer.unref?.();
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer process gone', details);
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    if (isQuitting) {
      clearTimeout(fallbackTimer);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(mainDir, '../renderer/index.html'));
  }
}

function startAutomationServices(sqliteStore: JoiSQLiteStore, managedPlugins: JoiPluginManager, outboundTelegram?: TelegramOutboundService | null) {
  if (envFlag('JOI_DISABLE_AUTOMATION_OS')) return;
  if (!automationRunner) {
    automationRunner = new AutomationRunner({
      store: sqliteStore,
      secrets,
      pluginManager: managedPlugins,
      telegramOutbound: outboundTelegram || undefined,
      getWindow: () => mainWindow,
      deterministicChat: isDesktopE2E() || envFlag('JOI_DETERMINISTIC_CHAT'),
      logger: console,
    });
    automationRunner.start();
  }
  if (!automationWebhookServer && !envFlag('JOI_DISABLE_AUTOMATION_WEBHOOKS')) {
    automationWebhookServer = new AutomationWebhookServer({
      store: sqliteStore,
      secrets,
      runner: automationRunner,
      addr: process.env.JOI_AUTOMATION_WEBHOOK_ADDR || '127.0.0.1:18082',
      logger: console,
    });
    void automationWebhookServer.start().catch((error) => {
      console.warn('automation webhook server skipped', error);
      automationWebhookServer = null;
    });
  }
}

async function startConfiguredWorkerGateway(sqliteStore: JoiSQLiteStore) {
  if (workerGateway) return;
  if (isDesktopE2E() || envFlag('JOI_DISABLE_WORKER_GATEWAY')) return;
  if (String(process.env.WORKER_GATEWAY_ENABLED || '').trim().toLowerCase() === 'false') return;
  if (sqliteStore.getSettings().worker_gateway_enabled === false) return;
  try {
    workerGateway = await startWorkerGateway({
      store: sqliteStore,
      addr: process.env.WORKER_GATEWAY_ADDR || '127.0.0.1:18081',
      resolveToken: () => secrets.resolve('WORKER_TOKEN'),
      logger: console,
    });
  } catch (error) {
    console.warn('worker gateway skipped', error);
  }
}

const singleInstanceLockDisabled = isDesktopE2E() || envFlag('JOI_DISABLE_SINGLE_INSTANCE_LOCK');
const hasSingleInstanceLock = singleInstanceLockDisabled || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (!singleInstanceLockDisabled) {
    app.on('second-instance', (_event, commandLine) => {
      if (isCliHeadlessInvocation(commandLine)) return;
      ensureMainWindow();
    });
  }

  app.whenReady().then(async () => {
    if (cliHeadless) app.dock?.hide();
    if (!isDesktopE2E() && !envFlag('JOI_DISABLE_SECRET_LOAD')) {
      await secrets.loadIntoEnv();
    }
    ensureMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) {
      ensureMainWindow();
      return;
    }
    showMainWindow(mainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (!isDesktopE2E() && !quitConfirmed) {
      const activeSchedules = store?.listAutomations({ kind: 'schedule', enabled: true, limit: 1 }).automations ?? [];
      if (activeSchedules.length > 0) {
        event.preventDefault();
        const quitOptions: MessageBoxSyncOptions = {
          type: 'warning',
          title: '退出 Joi？',
          message: 'Joi 关闭后，已安排的任务不会运行。',
          detail: '保持 Joi 运行可继续执行定时任务和持续监控。',
          buttons: ['保持运行', '退出 Joi'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const choice = mainWindow && !mainWindow.isDestroyed()
          ? dialog.showMessageBoxSync(mainWindow, quitOptions)
          : dialog.showMessageBoxSync(quitOptions);
        if (choice === 1) {
          quitConfirmed = true;
          setImmediate(() => app.quit());
        }
        return;
      }
    }
    isQuitting = true;
    telegramInbound?.stop();
    telegramInbound = null;
    imessageInbound?.stop();
    imessageInbound = null;
    automationRunner?.stop();
    automationRunner = null;
    void automationWebhookServer?.close();
    automationWebhookServer = null;
    void workerGateway?.close();
    workerGateway = null;
    void stopJoiCommandHost();
    store?.close();
    store = null;
    pluginManager = null;
    telegramOutbound = null;
  });
}
