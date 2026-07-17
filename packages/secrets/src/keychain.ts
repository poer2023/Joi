import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const joiKeychainService = process.env.JOI_KEYCHAIN_SERVICE || 'Joi Desktop';

export const desktopSecretNames = [
  'MODEL_API_KEY',
  'XAI_OAUTH_STATE',
  'BRAVE_SEARCH_API_KEY',
  'GITHUB_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'PHOTON_DASHBOARD_TOKEN',
  'PHOTON_PROJECT_SECRET',
  'WORKER_TOKEN',
  'NODE_SECRET',
  'ADMIN_TOKEN',
] as const;

export type DesktopSecretName = typeof desktopSecretNames[number];

export type SecretStatus = {
  secrets: Record<string, boolean>;
};

export type KeychainSecretStoreOptions = {
  service?: string;
  securityBin?: string;
};

export class KeychainSecretStore {
  readonly service: string;
  private securityBin: string;

  constructor(options: KeychainSecretStoreOptions = {}) {
    this.service = options.service || process.env.JOI_KEYCHAIN_SERVICE || joiKeychainService;
    this.securityBin = options.securityBin || process.env.JOI_SECURITY_BIN || 'security';
  }

  async status(): Promise<SecretStatus> {
    const secrets: Record<string, boolean> = {};
    for (const name of desktopSecretNames) {
      secrets[name] = Boolean(await this.resolve(name));
    }
    return { secrets };
  }

  async loadIntoEnv(): Promise<void> {
    for (const name of desktopSecretNames) {
      if (process.env[name]) continue;
      const value = await this.get(name);
      if (value) {
        process.env[name] = value;
      }
    }
  }

  async save(name: string, value: string): Promise<void> {
    assertAllowedSecret(name);
    if (!value.trim()) {
      throw new Error('secret value is required');
    }
    await execFileAsync(this.securityBin, [
      'add-generic-password',
      '-a',
      name,
      '-s',
      this.service,
      '-w',
      value,
      '-U',
    ]);
    process.env[name] = value;
  }

  async resolve(name: string): Promise<string> {
    assertAllowedSecret(name);
    const fromEnv = process.env[name];
    if (fromEnv) return fromEnv;
    return this.get(name);
  }

  async get(name: string): Promise<string> {
    assertAllowedSecret(name);
    try {
      const { stdout } = await execFileAsync(this.securityBin, [
        'find-generic-password',
        '-a',
        name,
        '-s',
        this.service,
        '-w',
      ]);
      return stdout.trim();
    } catch {
      return '';
    }
  }
}

export function assertAllowedSecret(name: string): asserts name is DesktopSecretName {
  if (name.startsWith('JOI_AUTOMATION_WEBHOOK_SECRET_')) return;
  if (/^ASSISTANT_(DISCORD|FEISHU)_WEBHOOK$/.test(name)) return;
  if (!desktopSecretNames.includes(name as DesktopSecretName)) {
    throw new Error('unsupported secret name');
  }
}
