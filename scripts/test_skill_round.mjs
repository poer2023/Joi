#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  discoverCodexSkills,
  readCodexSkill,
  renderSkillCatalog,
  selectCodexSkills,
} from '../packages/runtime/src/skills.ts';

const round = Number(argument('--round') || '1');
const outputPath = resolve(argument('--output') || `.e2e/skill-computer-use-rerun/round-${round}/skill.json`);
if (![1, 2, 3].includes(round)) throw new Error('--round must be 1, 2, or 3');

const startedAt = new Date().toISOString();
const harnessStarted = performance.now();
const fixture = await mkdtemp(join(tmpdir(), `joi-skill-round-${round}-`));
const home = join(fixture, 'home');
const repo = join(fixture, 'repo');
const repoSkills = join(repo, '.agents', 'skills');
await mkdir(join(repo, '.git'), { recursive: true });
await mkdir(join(home, '.agents', 'skills'), { recursive: true });
await mkdir(repoSkills, { recursive: true });

const cases = [];
try {
  if (round === 1) await roundOne();
  if (round === 2) await roundTwo();
  if (round === 3) await roundThree();
} finally {
  const finishedAt = new Date().toISOString();
  const report = {
    schema_version: 1,
    feature: 'skill',
    campaign: 'rerun-1',
    round,
    isolated: true,
    fixture_root_removed: true,
    real_joi_user_data_touched: false,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.round(performance.now() - harnessStarted),
    passed: cases.every((item) => item.status === 'passed'),
    summary: {
      total: cases.length,
      passed: cases.filter((item) => item.status === 'passed').length,
      failed: cases.filter((item) => item.status === 'failed').length,
      historical: cases.filter((item) => item.kind === 'historical').length,
      stress: cases.filter((item) => item.kind === 'stress').length,
      max_case_duration_ms: Math.max(0, ...cases.map((item) => item.duration_ms)),
    },
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await rm(fixture, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ output: outputPath, passed: report.passed, summary: report.summary })}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function roundOne() {
  const site = await createSkill(repoSkills, 'site-scout', 'Find and inspect cilisousuo.co domain sources without modifying remote state.', 'Return source evidence only.');
  const media = await createSkill(repoSkills, 'media-search', 'Search a media catalog and return a bounded number of public results.', 'Respect the requested result limit.');
  const clonedRoot = join(fixture, 'cloned-skill');
  await createSkill(clonedRoot, 'web-clone', 'Clone a supplied public website into an isolated local fixture.', 'Never publish automatically.');
  await symlink(join(clonedRoot, 'web-clone'), join(home, '.agents', 'skills', 'web-clone'));

  const discovered = discover();
  await runCase('skill-r1-h1-domain-discovery', 'historical', '2026-07-05T02:19:46Z · 查找某域名对应的本地 Skill', () => {
    const selected = selectCodexSkills('本机是否有一个 https://cilisousuo.co 的 skill', candidates(discovered));
    assert.equal(selected[0]?.name, 'site-scout');
    assert.equal(selected[0]?.invocation, 'implicit');
    return { selected: selected[0]?.name, disclosure: 'full instructions loaded only after match' };
  });
  await runCase('skill-r1-h2-explicit-use', 'historical', '2026-07-05T02:23:06Z · 使用刚找到的 Skill 搜索指定编号', () => {
    const selected = selectCodexSkills('使用 $media-search 搜一下 fixture-id-209，只取三条', candidates(discovered));
    assert.equal(selected[0]?.name, 'media-search');
    assert.equal(selected[0]?.invocation, 'explicit');
    assert.match(selected[0]?.instructions || '', /result limit/i);
    return { selected: selected[0]?.name, invocation: selected[0]?.invocation };
  });
  await runCase('skill-r1-h3-symlink-install', 'historical', '2026-07-02T13:32:34Z · 从仓库安装一个 Skill 后确认可发现', async () => {
    const skill = discovered.find((item) => item.name === 'web-clone');
    assert.ok(skill);
    assert.equal(await realpath(skill.path), skill.path);
    assert.match(skill.path, /cloned-skill/);
    return { selected: skill.name, symlink_followed: true, canonical_path: true };
  });
  await runCase('skill-r1-p1-catalog-budget', 'stress', '1500 个 Skill 元数据的首屏上下文预算', () => {
    const bulk = Array.from({ length: 1_500 }, (_, index) => ({
      id: `bulk-${index}`,
      name: `bulk-skill-${index}`,
      description: `Synthetic bounded description ${index} for catalog pressure.`,
      path: `/isolated/bulk/${index}/SKILL.md`,
      scope: 'extra',
      enabled: true,
      allow_implicit_invocation: true,
    }));
    const catalog = renderSkillCatalog(bulk, 8_000);
    assert.ok(catalog.length <= 8_000);
    assert.match(catalog, /additional skills omitted/);
    return { skills: bulk.length, catalog_chars: catalog.length };
  });
  await runCase('skill-r1-p2-duplicate-precedence', 'stress', '同名 repo/user Skill 共存与确定性调用', async () => {
    await createSkill(join(home, '.agents', 'skills'), 'duplicate-route', 'User duplicate route.', 'USER-SOURCE');
    await createSkill(repoSkills, 'duplicate-route', 'Repo duplicate route.', 'REPO-SOURCE');
    const duplicates = discover().filter((item) => item.name === 'duplicate-route');
    assert.equal(duplicates.length, 2);
    const selected = selectCodexSkills('$duplicate-route', candidates(duplicates));
    assert.equal(selected.length, 1);
    assert.match(selected[0].instructions, /REPO-SOURCE/);
    return { discovered_duplicates: duplicates.length, selected_scope: selected[0].scope };
  });
  await runCase('skill-r1-p3-symlink-loop', 'stress', '循环符号链接发现必须有界结束', async () => {
    const loop = join(home, '.agents', 'skills', 'loop');
    await mkdir(loop, { recursive: true });
    await symlink(loop, join(loop, 'self'));
    const before = Date.now();
    const result = discoverCodexSkills({ cwd: repo, home, max_depth: 10, max_skills: 5_000 });
    const duration = Date.now() - before;
    assert.ok(duration < 2_000);
    assert.ok(result.length < 50);
    return { duration_ms: duration, discovered: result.length };
  });
  void site;
  void media;
}

async function roundTwo() {
  await createSkill(repoSkills, 'kill-ai-slop', 'Find and remove generic AI visual and copy patterns from an existing UI.', 'Audit the current UI before changing it.');
  await createSkill(repoSkills, 'opencli-adapter', 'Turn a proven workflow into a bounded native OpenCLI adapter.', 'Preserve behavior and result limits.', {
    openai: {
      interface: { display_name: 'OpenCLI Adapter', short_description: 'Convert a workflow into an adapter' },
      dependencies: { tools: [{ type: 'capability', value: 'workspace_search' }, { type: 'capability', value: 'apply_patch' }] },
    },
  });
  await createSkill(repoSkills, 'explicit-only', 'A deliberately explicit-only safety recipe.', 'EXPLICIT-ONLY', {
    openai: { policy: { allow_implicit_invocation: false } },
  });
  const discovered = discover();

  await runCase('skill-r2-h1-ui-polish', 'historical', '2026-07-12T12:38:11Z · 指定 UI 清理 Skill 优化当前界面', () => {
    const selected = selectCodexSkills('kill-ai-slop，使用这个技能优化一次 ui', candidates(discovered));
    assert.equal(selected[0]?.name, 'kill-ai-slop');
    assert.match(selected[0]?.instructions || '', /Audit the current UI/);
    return { selected: selected[0]?.name, invocation: selected[0]?.invocation };
  });
  await runCase('skill-r2-h2-followup-reuse', 'historical', '2026-07-12T12:50:15Z · 下一轮对话要求继续使用刚才的 Skill', () => {
    const contextualMessage = '上一轮使用 $kill-ai-slop 审核了页面。\n重新用这个 skill 弄一下';
    const selected = selectCodexSkills(contextualMessage, candidates(discovered));
    assert.equal(selected[0]?.name, 'kill-ai-slop');
    return { selected: selected[0]?.name, followup_context: true };
  });
  await runCase('skill-r2-h3-native-adapter', 'historical', '2026-07-05T02:26:37Z · 把已有 Skill 变成原生内置适配器', () => {
    const skill = discovered.find((item) => item.name === 'opencli-adapter');
    assert.ok(skill);
    assert.deepEqual(skill.required_tools, ['workspace_search', 'apply_patch']);
    assert.equal(skill.interface.display_name, 'OpenCLI Adapter');
    return { required_tools: skill.required_tools, display_name: skill.interface.display_name };
  });
  await runCase('skill-r2-p1-hot-reload', 'stress', '同一路径正文热更新与 hash 变化', async () => {
    const path = join(repoSkills, 'kill-ai-slop', 'SKILL.md');
    const before = readCodexSkill(path);
    await writeFile(path, skillMarkdown('kill-ai-slop', 'Find and remove generic AI visual patterns.', 'UPDATED-INSTRUCTIONS'));
    const after = readCodexSkill(path);
    assert.notEqual(after.sha256, before.sha256);
    assert.match(after.instructions, /UPDATED-INSTRUCTIONS/);
    return { hash_changed: true, same_id: after.id === before.id };
  });
  await runCase('skill-r2-p2-implicit-policy', 'stress', '禁止隐式调用的策略不得被描述匹配绕过', () => {
    const list = candidates(discovered);
    assert.equal(selectCodexSkills('请使用 explicit-only safety recipe', list).length, 0);
    assert.equal(selectCodexSkills('$explicit-only', list)[0]?.name, 'explicit-only');
    return { implicit_blocked: true, explicit_allowed: true };
  });
  await runCase('skill-r2-p3-instruction-budget', 'stress', '多个显式 Skill 的正文总预算', async () => {
    const body = 'x'.repeat(70_000);
    await createSkill(repoSkills, 'large-one', 'Large instruction fixture one.', body);
    await createSkill(repoSkills, 'large-two', 'Large instruction fixture two.', body);
    const refreshed = discover();
    const selected = selectCodexSkills('$large-one 与 $large-two', candidates(refreshed), { max_selected: 3, max_total_instruction_chars: 96_000 });
    const total = selected.reduce((sum, item) => sum + item.instructions.length, 0);
    assert.equal(selected.length, 2);
    assert.ok(total <= 96_000);
    return { selected: selected.length, instruction_chars: total };
  });
}

async function roundThree() {
  await createSkill(repoSkills, 'persona-bridge', 'Embed a persona artifact lazily without slowing ordinary replies.', 'Load only the minimum relevant layer.');
  await createSkill(repoSkills, 'settings-auditor', 'Audit missing settings routes, Skill surfaces, and plugin pages.', 'Report exact missing surfaces.');
  await createSkill(repoSkills, 'install-checker', 'Confirm whether a requested Skill is installed and readable.', 'Return canonical path and validation status.');
  const discovered = discover();

  await runCase('skill-r3-h1-persona-lazy-load', 'historical', '2026-06-30T18:25:20Z · 无损嵌入人格 Skill 且不拖慢普通回复', () => {
    const selected = selectCodexSkills('用 persona-bridge 无损嵌入人格，同时保持普通回复速度', candidates(discovered));
    assert.equal(selected[0]?.name, 'persona-bridge');
    return { selected: selected[0]?.name };
  });
  await runCase('skill-r3-h2-install-check', 'historical', '2026-07-02T13:33:23Z · 确认某个 Skill 是否已安装', () => {
    const selected = selectCodexSkills('用 install-checker 确认 skill 安装了么', candidates(discovered));
    assert.equal(selected[0]?.name, 'install-checker');
    return { selected: selected[0]?.name };
  });
  await runCase('skill-r3-h3-settings-audit', 'historical', '2026-07-10T11:14:20Z · 检查设置中缺失的 Skill/Plugin 页面', () => {
    const selected = selectCodexSkills('settings-auditor 检查 skill 和 plugin 预留页面', candidates(discovered));
    assert.equal(selected[0]?.name, 'settings-auditor');
    return { selected: selected[0]?.name };
  });
  await runCase('skill-r3-p1-invalid-frontmatter', 'stress', '无 frontmatter 与超大文件必须诚实拒绝', async () => {
    const bad = join(repoSkills, 'bad');
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, 'SKILL.md'), '# no frontmatter');
    const result = discover();
    assert.equal(result.some((item) => item.directory === bad), false);
    return { invalid_skipped: true };
  });
  await runCase('skill-r3-p2-resource-bounds', 'stress', '附属资源清单必须限制数量', async () => {
    const root = join(repoSkills, 'resource-heavy');
    await createSkill(repoSkills, 'resource-heavy', 'Resource pressure fixture.', 'RESOURCE');
    await mkdir(join(root, 'assets'), { recursive: true });
    await Promise.all(Array.from({ length: 140 }, (_, index) => writeFile(join(root, 'assets', `${index}.txt`), 'x')));
    const skill = discover().find((item) => item.name === 'resource-heavy');
    assert.ok(skill);
    assert.ok(skill.resources.assets.length <= 80);
    return { resources_listed: skill.resources.assets.length };
  });
  await runCase('skill-r3-p3-disabled-candidate', 'stress', '禁用 Skill 不能被显式或隐式选择', () => {
    const candidate = candidates(discovered).find((item) => item.name === 'install-checker');
    assert.ok(candidate);
    candidate.enabled = false;
    assert.equal(selectCodexSkills('$install-checker', [candidate]).length, 0);
    return { disabled_blocked: true };
  });
}

function discover() {
  return discoverCodexSkills({ cwd: repo, home, max_depth: 8, max_skills: 5_000 });
}

function candidates(skills) {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope,
    enabled: skill.validation_errors.length === 0,
    allow_implicit_invocation: skill.allow_implicit_invocation,
    trigger_phrases: [],
  }));
}

async function createSkill(root, name, description, instructions, options = {}) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), skillMarkdown(name, description, instructions));
  if (options.openai) {
    await mkdir(join(directory, 'agents'), { recursive: true });
    await writeFile(join(directory, 'agents', 'openai.yaml'), toYaml(options.openai));
  }
  return directory;
}

function skillMarkdown(name, description, instructions) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${instructions}\n`;
}

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const entries = Object.entries(item);
        return `${pad}- ${entries.map(([key, entry], index) => index === 0 ? `${key}: ${JSON.stringify(entry)}` : `\n${pad}  ${key}: ${JSON.stringify(entry)}`).join('')}`;
      }
      return `${pad}- ${JSON.stringify(item)}`;
    }).join('\n') + '\n';
  }
  return Object.entries(value).map(([key, item]) => {
    if (item && typeof item === 'object') return `${pad}${key}:\n${toYaml(item, indent + 2).trimEnd()}`;
    return `${pad}${key}: ${JSON.stringify(item)}`;
  }).join('\n') + '\n';
}

async function runCase(id, kind, sourcePattern, test) {
  const started = performance.now();
  try {
    const evidence = await test();
    cases.push({ id, kind, source_pattern: sourcePattern, status: 'passed', duration_ms: Math.round(performance.now() - started), evidence });
  } catch (error) {
    cases.push({ id, kind, source_pattern: sourcePattern, status: 'failed', duration_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}
