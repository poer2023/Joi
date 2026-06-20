import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, normalize, relative } from 'node:path';
import type { CapabilityResult } from './capabilities.ts';

export type DesktopAppListRequest = {
  max_results?: unknown;
};

export type DesktopAppInspectRequest = {
  name?: string;
  bundle_id?: string;
  path?: string;
};

export type DesktopAppRoot = {
  path: string;
  source: string;
};

type DesktopAppMetadata = {
  name: string;
  path: string;
  source: string;
  bundle_id: string;
  version: string;
  executable: string;
  metadata_source: string;
  content_readable: false;
};

const defaultMaxDesktopApps = 1000;
const plistStringPattern = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/gs;

export function executeDesktopAppList(
  req: DesktopAppListRequest = {},
  roots: DesktopAppRoot[] = desktopAppRoots(),
): CapabilityResult {
  const apps = listDesktopApps(roots, boundedAppLimit(req.max_results));
  return {
    status: 'completed',
    total: apps.length,
    apps,
    summary: `Found ${apps.length} local app bundle(s).`,
    mode: 'desktop_app_list_v1_bundle_scan',
  };
}

export function executeDesktopAppInspect(
  req: DesktopAppInspectRequest,
  roots: DesktopAppRoot[] = desktopAppRoots(),
): CapabilityResult {
  const name = req.name?.trim().toLowerCase() || '';
  const bundleID = req.bundle_id?.trim().toLowerCase() || '';
  const targetPath = req.path?.trim() || '';
  if (!name && !bundleID && !targetPath) throw new Error('desktop_app_inspect requires name, bundle_id, or path');
  const matches = listDesktopApps(roots, defaultMaxDesktopApps).filter((app) => {
    const appName = app.name.toLowerCase();
    const appBundleID = app.bundle_id.toLowerCase();
    return (name && appName.includes(name))
      || (bundleID && appBundleID === bundleID)
      || (targetPath && normalize(app.path) === normalize(targetPath));
  });
  return {
    status: 'completed',
    total: matches.length,
    matches,
    summary: matches.length > 0
      ? `Found ${matches.length} matching app bundle(s).`
      : 'No matching local app bundle found.',
    mode: 'desktop_app_inspect_v1_bundle_scan',
  };
}

function listDesktopApps(roots: DesktopAppRoot[], limit: number): DesktopAppMetadata[] {
  const seen = new Set<string>();
  const apps: DesktopAppMetadata[] = [];
  for (const root of roots) {
    if (apps.length >= limit) break;
    try {
      if (!statSync(root.path).isDirectory()) continue;
    } catch {
      continue;
    }
    walkAppRoot(root.path, root.path, root.source, apps, seen, limit);
  }
  apps.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return apps;
}

function walkAppRoot(root: string, current: string, source: string, apps: DesktopAppMetadata[], seen: Set<string>, limit: number): void {
  if (apps.length >= limit) return;
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || apps.length >= limit) continue;
    const path = join(current, entry.name);
    if (entry.name.endsWith('.app')) {
      const normalized = normalize(path);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        apps.push(appBundleMetadata(normalized, source));
      }
      continue;
    }
    if (appSearchDepth(root, path) <= 3) walkAppRoot(root, path, source, apps, seen, limit);
  }
}

function desktopAppRoots(): DesktopAppRoot[] {
  return [
    { path: '/Applications', source: 'applications' },
    { path: '/System/Applications', source: 'system' },
    { path: join(homedir(), 'Applications'), source: 'user' },
  ];
}

function appBundleMetadata(path: string, source: string): DesktopAppMetadata {
  const plist = readPlistStrings(join(path, 'Contents', 'Info.plist'));
  const name = firstNonEmptyString(plist.CFBundleDisplayName, plist.CFBundleName) || basename(path, '.app');
  return {
    name,
    path,
    source,
    bundle_id: plist.CFBundleIdentifier || '',
    version: firstNonEmptyString(plist.CFBundleShortVersionString, plist.CFBundleVersion),
    executable: plist.CFBundleExecutable || '',
    metadata_source: plist.metadata_source || 'bundle_path',
    content_readable: false,
  };
}

function readPlistStrings(path: string): Record<string, string> {
  const result: Record<string, string> = { metadata_source: 'bundle_path' };
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch {
    return result;
  }
  if (raw.length === 0) return result;
  if (raw.subarray(0, 6).toString('utf8') === 'bplist') {
    return { metadata_source: 'binary_plist_unparsed' };
  }
  const text = raw.subarray(0, 512 * 1024).toString('utf8');
  for (const match of text.matchAll(plistStringPattern)) {
    result[htmlUnescape(match[1].trim())] = htmlUnescape(match[2].trim());
  }
  result.metadata_source = 'info_plist';
  return result;
}

function appSearchDepth(root: string, path: string): number {
  const rel = relative(root, path);
  if (!rel || rel === '.') return 0;
  return rel.split(/[\\/]+/).filter(Boolean).length;
}

function boundedAppLimit(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return defaultMaxDesktopApps;
  return Math.min(Math.floor(number), defaultMaxDesktopApps);
}

function firstNonEmptyString(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim() || '').find(Boolean) || '';
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
