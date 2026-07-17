import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverCodexSkills } from '../../runtime/src/skills.ts';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const fixture = mkdtempSync(join(tmpdir(), 'joi-skill-store-'));
const repo = join(fixture, 'repo');
const home = join(fixture, 'home');
const skillDirectory = join(repo, '.agents', 'skills', 'fixture-audit');
mkdirSync(join(repo, '.git'), { recursive: true });
mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
mkdirSync(join(skillDirectory, 'agents'), { recursive: true });
writeFileSync(join(skillDirectory, 'SKILL.md'), `---
name: fixture-audit
description: Audit an isolated fixture and return bounded evidence without changing real data.
version: v2
---
Read the isolated fixture only. Return FIXTURE_AUDIT_OK and never mutate external state.
`);
writeFileSync(join(skillDirectory, 'agents', 'openai.yaml'), `interface:
  display_name: Fixture Audit
  short_description: Read-only fixture audit
  default_prompt: Use $fixture-audit on the isolated fixture.
policy:
  allow_implicit_invocation: true
dependencies:
  tools:
    - type: capability
      value: workspace_read
`);

let store;
try {
  store = new JoiSQLiteStore({
    dbPath: join(fixture, 'joi.db'),
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(fixture, 'logs'),
    backupDir: join(fixture, 'backups'),
    version: 'skill-test',
  });
  const discovered = discoverCodexSkills({ cwd: repo, home, max_skills: 50 });
  const fixtureSkill = discovered.find((skill) => skill.name === 'fixture-audit');
  assert.ok(fixtureSkill);
  assert.equal(fixtureSkill.scope, 'repo');
  assert.deepEqual(fixtureSkill.required_tools, ['workspace_read']);

  const synced = store.syncDiscoveredSkills(discovered);
  assert.equal(synced.discovered_count, 1);
  const record = synced.skills.find((skill) => skill.name === 'fixture-audit');
  assert.ok(record);
  assert.equal(record.enabled, true);
  assert.equal(record.metadata?.progressive_disclosure, true);

  const detail = store.getSkill(record.id);
  assert.match(detail.instructions, /FIXTURE_AUDIT_OK/);
  assert.equal(detail.openai?.interface?.display_name, 'Fixture Audit');

  store.setSkillEnabled({ id: record.id, enabled: false });
  store.syncDiscoveredSkills(discovered);
  assert.equal(store.listSkills().skills.find((skill) => skill.id === record.id)?.enabled, false);
  store.setSkillEnabled({ id: record.id, enabled: true });

  const request = {
    message: '请用$fixture-audit检查临时夹具',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    permission_profile: 'read_only',
    model_name: 'fixture-model',
  };
  const prompt = store.assembleToolCallingPrompt(request, 'general_agent', 'fixture-model');
  assert.deepEqual(prompt.selected_skills.map((skill) => skill.name), ['fixture-audit']);
  assert.match(prompt.dynamic_tail, /FIXTURE_AUDIT_OK/);
  assert.doesNotMatch(prompt.skill_catalog, /FIXTURE_AUDIT_OK/);
  assert.ok(prompt.skill_catalog.length <= 8_000);

  const started = store.beginToolCallingChat(request, {
    provider: 'fixture-provider',
    model_name: 'fixture-model',
    selected_agent_id: 'general_agent',
    prompt_assembly: prompt,
  });
  const trace = store.getRunTrace(started.run_id);
  assert.equal(trace.steps?.some((step) => step.step_type === 'skill_selected'), true);
  assert.equal(trace.steps?.some((step) => step.step_type === 'skill_plan_generated'), true);
  assert.equal(trace.steps?.find((step) => step.step_type === 'skill_plan_generated')?.output?.progressive_disclosure, true);

  process.stdout.write('skill store tests passed\n');
} finally {
  store?.close();
  rmSync(fixture, { recursive: true, force: true });
}
