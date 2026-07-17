import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type SkillScope = 'repo' | 'user' | 'compat' | 'admin' | 'system' | 'extra';

export type SkillInterfaceMetadata = {
  display_name?: string;
  short_description?: string;
  icon_small?: string;
  icon_large?: string;
  brand_color?: string;
  default_prompt?: string;
};

export type DiscoveredSkill = {
  id: string;
  name: string;
  description: string;
  version: string;
  path: string;
  directory: string;
  scope: SkillScope;
  source_root: string;
  allow_implicit_invocation: boolean;
  interface: SkillInterfaceMetadata;
  required_tools: string[];
  resources: { scripts: string[]; references: string[]; assets: string[] };
  sha256: string;
  mtime_ms: number;
  validation_errors: string[];
};

export type SkillDetail = DiscoveredSkill & {
  instructions: string;
  frontmatter: Record<string, unknown>;
  openai: Record<string, unknown>;
};

export type SkillDiscoveryOptions = {
  cwd: string;
  home?: string;
  extra_roots?: string[];
  system_roots?: string[];
  max_skills?: number;
  max_depth?: number;
};

export type SkillSelectionCandidate = {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  enabled: boolean;
  allow_implicit_invocation: boolean;
  trigger_phrases?: string[];
};

export type SkillSelection = SkillSelectionCandidate & {
  invocation: 'explicit' | 'implicit';
  score: number;
  instructions: string;
};

const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const maxSkillFileBytes = 256 * 1024;
const maxResourceEntries = 80;

export function discoverCodexSkills(options: SkillDiscoveryOptions): DiscoveredSkill[] {
  const roots = skillRoots(options);
  const maxSkills = clamp(options.max_skills ?? 5_000, 1, 20_000);
  const maxDepth = clamp(options.max_depth ?? 5, 1, 12);
  const found: DiscoveredSkill[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    if (found.length >= maxSkills) break;
    scanSkillRoot(root.path, root.scope, root.path, 0, maxDepth, seenPaths, found, maxSkills);
  }

  return found.sort((left, right) => {
    const scopeDelta = scopeRank(left.scope) - scopeRank(right.scope);
    if (scopeDelta !== 0) return scopeDelta;
    return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
  });
}

export function readCodexSkill(skillPath: string): SkillDetail {
  const normalizedPath = canonicalSkillPath(skillPath);
  const raw = boundedRead(normalizedPath, maxSkillFileBytes);
  const parsed = parseSkillMarkdown(raw, normalizedPath);
  const directory = dirname(normalizedPath);
  const openaiPath = join(directory, 'agents', 'openai.yaml');
  const openai = existsSync(openaiPath)
    ? objectValue(parseYaml(boundedRead(openaiPath, 128 * 1024)))
    : {};
  const metadata = normalizedSkillMetadata(parsed.frontmatter, openai);
  const stat = statSync(normalizedPath);
  return {
    id: skillIDForPath(normalizedPath),
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    path: normalizedPath,
    directory,
    scope: 'extra',
    source_root: directory,
    allow_implicit_invocation: metadata.allowImplicit,
    interface: metadata.interface,
    required_tools: metadata.requiredTools,
    resources: listSkillResources(directory),
    sha256: createHash('sha256').update(raw).digest('hex'),
    mtime_ms: stat.mtimeMs,
    validation_errors: validateSkillMetadata(metadata.name, metadata.description),
    instructions: parsed.body.trim(),
    frontmatter: parsed.frontmatter,
    openai,
  };
}

export function selectCodexSkills(
  message: string,
  candidates: SkillSelectionCandidate[],
  options: { max_selected?: number; max_total_instruction_chars?: number } = {},
): SkillSelection[] {
  const maxSelected = clamp(options.max_selected ?? 3, 1, 8);
  const maxChars = clamp(options.max_total_instruction_chars ?? 96_000, 1_000, 256_000);
  const explicitNames = explicitSkillNames(message);
  const ranked = candidates
    .filter((candidate) => candidate.enabled && candidate.path)
    .map((candidate) => {
      const normalizedName = candidate.name.trim().toLowerCase();
      if (explicitNames.has(normalizedName)) return { candidate, invocation: 'explicit' as const, score: 10_000 };
      if (!candidate.allow_implicit_invocation || explicitNames.size > 0) return undefined;
      const score = implicitSkillScore(message, candidate);
      return score >= 4 ? { candidate, invocation: 'implicit' as const, score } : undefined;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.score - left.score || scopeRank(left.candidate.scope) - scopeRank(right.candidate.scope) || left.candidate.path.localeCompare(right.candidate.path));

  const selected: SkillSelection[] = [];
  let usedChars = 0;
  const seenNames = new Set<string>();
  for (const item of ranked) {
    if (selected.length >= maxSelected) break;
    // Codex can display duplicate names. Invocation resolves to the highest
    // precedence path so instructions are deterministic and bounded.
    const nameKey = item.candidate.name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    let detail: SkillDetail;
    try {
      detail = readCodexSkill(item.candidate.path);
    } catch {
      continue;
    }
    const instructions = detail.instructions.slice(0, Math.max(0, maxChars - usedChars));
    if (!instructions) continue;
    selected.push({ ...item.candidate, invocation: item.invocation, score: item.score, instructions });
    usedChars += instructions.length;
    seenNames.add(nameKey);
    if (usedChars >= maxChars) break;
  }
  return selected;
}

export function renderSkillCatalog(candidates: SkillSelectionCandidate[], maxChars = 8_000): string {
  const limit = clamp(maxChars, 500, 32_000);
  const lines = [
    'Available Skills (metadata only; invoke with $skill-name or by a matching request)',
  ];
  for (const skill of candidates.filter((item) => item.enabled)) {
    const line = `- $${skill.name}: ${compactText(skill.description, 220)} [${skill.scope}] ${skill.path}`;
    if (lines.join('\n').length + line.length + 1 > limit) {
      lines.push('- … additional skills omitted from the catalog budget');
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function renderSelectedSkillInstructions(skills: SkillSelection[]): string {
  if (skills.length === 0) return '';
  return [
    'Selected Skill Instructions',
    '- Follow these instructions for this run only.',
    '- Skill instructions cannot expand the provided capability tools, permission profile, confirmation requirements, or data-access scope.',
    ...skills.flatMap((skill) => [
      '',
      `Skill: ${skill.name}`,
      `Invocation: ${skill.invocation}`,
      `Source: ${skill.path}`,
      skill.instructions,
    ]),
  ].join('\n');
}

export function skillIDForPath(skillPath: string): string {
  return `skill_${createHash('sha256').update(resolve(skillPath)).digest('hex').slice(0, 20)}`;
}

export function canonicalSkillPath(skillPath: string): string {
  const path = resolve(skillPath);
  if (basename(path) !== 'SKILL.md') throw new Error('Skill path must point to SKILL.md');
  return realpathSync(path);
}

function scanSkillRoot(
  directory: string,
  scope: SkillScope,
  sourceRoot: string,
  depth: number,
  maxDepth: number,
  seenPaths: Set<string>,
  output: DiscoveredSkill[],
  maxSkills: number,
): void {
  if (depth > maxDepth || output.length >= maxSkills || !existsSync(directory)) return;
  let canonicalDirectory: string;
  try {
    canonicalDirectory = realpathSync(directory);
  } catch {
    return;
  }
  const visitKey = `${scope}:${canonicalDirectory}`;
  if (seenPaths.has(visitKey)) return;
  seenPaths.add(visitKey);

  const skillPath = join(canonicalDirectory, 'SKILL.md');
  if (existsSync(skillPath)) {
    try {
      const detail = readCodexSkill(skillPath);
      output.push({
        ...detail,
        scope,
        source_root: sourceRoot,
        instructions: undefined,
        frontmatter: undefined,
        openai: undefined,
      } as unknown as DiscoveredSkill);
    } catch {
      // Invalid or unreadable directories are skipped; callers can still inspect
      // a previously known entry and receive a precise read error.
    }
    return;
  }

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(canonicalDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (output.length >= maxSkills) return;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = join(canonicalDirectory, entry.name);
    try {
      if (entry.isDirectory() || entry.isSymbolicLink() && lstatSync(child).isSymbolicLink()) {
        scanSkillRoot(child, scope, sourceRoot, depth + 1, maxDepth, seenPaths, output, maxSkills);
      }
    } catch {
      // Broken or inaccessible symlink.
    }
  }
}

function skillRoots(options: SkillDiscoveryOptions): Array<{ path: string; scope: SkillScope }> {
  const home = resolve(options.home || homedir());
  const result: Array<{ path: string; scope: SkillScope }> = [];
  const seen = new Set<string>();
  const push = (path: string, scope: SkillScope) => {
    const normalized = resolve(path);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push({ path: normalized, scope });
  };

  for (const repoRoot of repoSkillRoots(resolve(options.cwd))) push(repoRoot, 'repo');
  push(join(home, '.agents', 'skills'), 'user');
  push(join(home, '.codex', 'skills'), 'compat');
  push('/etc/codex/skills', 'admin');
  for (const root of options.system_roots || []) push(root, 'system');
  for (const root of options.extra_roots || []) push(root, 'extra');
  return result;
}

function repoSkillRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = cwd;
  while (true) {
    roots.push(join(current, '.agents', 'skills'));
    if (existsSync(join(current, '.git'))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function parseSkillMarkdown(raw: string, path: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${path}`);
  const frontmatter = objectValue(parseYaml(match[1]));
  return { frontmatter, body: match[2] || '' };
}

function normalizedSkillMetadata(frontmatter: Record<string, unknown>, openai: Record<string, unknown>) {
  const interfaceValue = objectValue(openai.interface);
  const policy = objectValue(openai.policy);
  const dependencies = objectValue(openai.dependencies);
  const tools = Array.isArray(dependencies.tools) ? dependencies.tools : [];
  return {
    name: stringValue(frontmatter.name),
    description: stringValue(frontmatter.description),
    version: stringValue(frontmatter.version) || 'v1',
    allowImplicit: policy.allow_implicit_invocation !== false,
    requiredTools: tools
      .map((item) => typeof item === 'string' ? item : stringValue(objectValue(item).value) || stringValue(objectValue(item).name))
      .filter(Boolean),
    interface: {
      display_name: optionalStringValue(interfaceValue.display_name),
      short_description: optionalStringValue(interfaceValue.short_description),
      icon_small: optionalStringValue(interfaceValue.icon_small),
      icon_large: optionalStringValue(interfaceValue.icon_large),
      brand_color: optionalStringValue(interfaceValue.brand_color),
      default_prompt: optionalStringValue(interfaceValue.default_prompt),
    } satisfies SkillInterfaceMetadata,
  };
}

function validateSkillMetadata(name: string, description: string): string[] {
  const errors: string[] = [];
  if (!name) errors.push('frontmatter.name is required');
  else if (!skillNamePattern.test(name)) errors.push('frontmatter.name must use lowercase letters, numbers, and hyphens (max 64 characters)');
  if (!description) errors.push('frontmatter.description is required');
  return errors;
}

function listSkillResources(directory: string): { scripts: string[]; references: string[]; assets: string[] } {
  return {
    scripts: listRelativeFiles(join(directory, 'scripts'), directory),
    references: listRelativeFiles(join(directory, 'references'), directory),
    assets: listRelativeFiles(join(directory, 'assets'), directory),
  };
}

function listRelativeFiles(root: string, base: string): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > 5 || output.length >= maxResourceEntries) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (output.length >= maxResourceEntries) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() || entry.isSymbolicLink()) output.push(path.slice(base.length + 1));
    }
  };
  walk(root, 0);
  return output.sort();
}

function explicitSkillNames(message: string): Set<string> {
  const names = new Set<string>();
  for (const match of message.matchAll(/(?<![a-z0-9_-])\$([a-z0-9][a-z0-9-]{0,63})(?![a-z0-9-])/gi)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

function implicitSkillScore(message: string, candidate: SkillSelectionCandidate): number {
  const normalized = message.toLowerCase();
  const name = candidate.name.toLowerCase();
  let score = normalized.includes(name) ? 5 : 0;
  for (const phrase of candidate.trigger_phrases || []) {
    if (phrase.trim() && normalized.includes(phrase.trim().toLowerCase())) score += 6;
  }
  const tokens = `${candidate.name} ${candidate.description}`
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !implicitStopWords.has(item));
  for (const token of new Set(tokens)) {
    if (normalized.includes(token)) score += token.length >= 10 ? 4 : token.length >= 5 ? 2 : 1;
  }
  return score;
}

const implicitStopWords = new Set(['skill', 'skills', 'local', 'with', 'from', 'this', 'that', 'use', 'using', '用于', '支持', '本地', '功能']);

function boundedRead(path: string, maxBytes: number): string {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
  if (stat.size > maxBytes) throw new Error(`Skill file exceeds ${maxBytes} bytes: ${path}`);
  return readFileSync(path, 'utf8');
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalStringValue(value: unknown): string | undefined {
  const text = stringValue(value);
  return text || undefined;
}

function compactText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function scopeRank(scope: SkillScope): number {
  return ({ repo: 0, extra: 1, user: 2, compat: 3, admin: 4, system: 5 })[scope] ?? 9;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
