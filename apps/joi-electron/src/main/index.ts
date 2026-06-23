import { app, BrowserWindow } from 'electron';
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
let mainWindow: BrowserWindow | null = null;
let store: JoiSQLiteStore | null = null;
let workerGateway: WorkerGatewayServer | null = null;
let telegramInbound: TelegramInboundService | null = null;
let imessageInbound: IMessageInboundService | null = null;
let isQuitting = false;
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

function showMainWindow(window: BrowserWindow | null = mainWindow) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function ensureMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  showMainWindow(mainWindow);
}

function createMainWindow() {
  const preloadPath = join(mainDir, '../preload/index.mjs');
  const sqliteStore = ensureStore();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 560,
    minHeight: 720,
    title: 'Joi',
    titleBarStyle: 'hiddenInset',
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

  registerIpc(mainWindow, appDirs, sqliteStore, secrets, {
    onTelegramConfigChanged: () => telegramInbound?.scheduleReconfigure(),
    onIMessageConfigChanged: () => imessageInbound?.scheduleReconfigure(),
    getTelegramStatus: () => telegramInbound?.status(),
    getIMessageStatus: () => imessageInbound?.status(),
    testIMessageConnection: () => imessageInbound?.testConnection(),
    sendTestIMessageMessage: (spaceID, message) => imessageInbound?.sendTestMessage(spaceID, message),
    deterministicChat: isDesktopE2E() || envFlag('JOI_DETERMINISTIC_CHAT'),
  });
  void startConfiguredWorkerGateway(sqliteStore);

  const window = mainWindow;
  let didShow = false;
  const revealWindow = () => {
    if (didShow) return;
    didShow = true;
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
    app.on('second-instance', () => {
      ensureMainWindow();
    });
  }

  app.whenReady().then(async () => {
    if (!isDesktopE2E() && !envFlag('JOI_DISABLE_SECRET_LOAD')) {
      await secrets.loadIntoEnv();
    }
    createMainWindow();
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

  app.on('before-quit', () => {
    isQuitting = true;
    telegramInbound?.stop();
    telegramInbound = null;
    imessageInbound?.stop();
    imessageInbound = null;
    void workerGateway?.close();
    workerGateway = null;
    store?.close();
    store = null;
  });
}
