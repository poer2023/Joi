import { app, BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';
import { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import { KeychainSecretStore } from '../../../../packages/secrets/src/keychain';
import { startWorkerGateway, type WorkerGatewayServer } from '../../../../packages/runtime/src/worker-gateway';
import schemaSql from '../../../../database/sqlite/001_init_schema.sql?raw';
import { TelegramInboundService } from './telegram-inbound';

const mainDir = dirname(fileURLToPath(import.meta.url));

function configureAppPaths() {
  app.setName('Joi');
  const userDataDir = join(app.getPath('appData'), 'Joi');
  const logDir = join(userDataDir, 'logs');
  const backupDir = join(userDataDir, 'backups');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(join(userDataDir, 'Shared Dictionary', 'cache'), { recursive: true });
  app.setPath('userData', userDataDir);
  return {
    userDataDir,
    logDir,
    backupDir,
    dbPath: join(userDataDir, 'joi.db'),
  };
}

const appDirs = configureAppPaths();
let mainWindow: BrowserWindow | null = null;
let store: JoiSQLiteStore | null = null;
let workerGateway: WorkerGatewayServer | null = null;
let telegramInbound: TelegramInboundService | null = null;
const secrets = new KeychainSecretStore();

function createMainWindow() {
  const preloadPath = join(mainDir, '../preload/index.mjs');
  store = new JoiSQLiteStore({
    dbPath: appDirs.dbPath,
    schemaSql,
    logDir: appDirs.logDir,
    backupDir: appDirs.backupDir,
    version: app.getVersion(),
  });

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

  telegramInbound = new TelegramInboundService({
    store,
    secrets,
    getWindow: () => mainWindow,
    logger: console,
  });

  registerIpc(mainWindow, appDirs, store, secrets, {
    onTelegramConfigChanged: () => telegramInbound?.scheduleReconfigure(),
  });
  void startConfiguredWorkerGateway(store);
  void telegramInbound.start();

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(mainDir, '../renderer/index.html'));
  }
}

async function startConfiguredWorkerGateway(sqliteStore: JoiSQLiteStore) {
  if (workerGateway) return;
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await secrets.loadIntoEnv();
    createMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    telegramInbound?.stop();
    telegramInbound = null;
    void workerGateway?.close();
    workerGateway = null;
    store?.close();
    store = null;
  });
}
