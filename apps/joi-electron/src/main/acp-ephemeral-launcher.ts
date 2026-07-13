import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveACPEphemeralLauncherScript(): string {
  const override = String(process.env.JOI_ACP_EPHEMERAL_LAUNCHER || '').trim();
  const resourcesPath = String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '').trim();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    override,
    resourcesPath ? join(resourcesPath, 'acp-ephemeral-launcher', 'index.mjs') : '',
    resolve(moduleDir, '../../resources/acp-ephemeral-launcher/index.mjs'),
    resolve(process.cwd(), 'apps/joi-electron/resources/acp-ephemeral-launcher/index.mjs'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Joi ACP ephemeral launcher is missing. Checked: ${candidates.join(', ')}`);
  return found;
}
