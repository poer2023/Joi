import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../../store/src/sqlite.ts';
import {
  executeFileAnalyze,
  executeFileRead,
  executeWorkspaceSearch,
} from '../src/capabilities.ts';

if (process.argv.length !== 3) {
  console.error('usage: node --experimental-strip-types packages/runtime/scripts/desktop-evals.mjs <evals/desktop_cases.json>');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '../../..');
const cases = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
assert.ok(Array.isArray(cases) && cases.length > 0, 'no desktop cases found');

const tempDir = mkdtempSync(join(tmpdir(), 'joi-ts-desktop-evals-'));
const store = new JoiSQLiteStore({
  dbPath: join(tempDir, 'joi-desktop-evals.db'),
  schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
  logDir: join(tempDir, 'logs'),
  backupDir: join(tempDir, 'backups'),
  version: 'test',
});

try {
  seedDesktopEvalData(store);
  let passed = 0;
  const failures = [];
  for (const testCase of cases) {
    try {
      await runCase(store, testCase);
      passed++;
    } catch (error) {
      failures.push(`${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const failure of failures) {
    console.error('FAIL', failure);
  }
  console.log(`${passed} passed / ${failures.length} failed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
}

function seedDesktopEvalData(store) {
  store['exec'](
    `INSERT INTO memories (id, type, content, summary, scope_type, privacy_level, confidence, status, source_event_ids, entities, pinned, metadata, updated_at)
     VALUES
       ('mem_desktop_deploy_pref', 'profile', '用户偏好轻量部署，优先 Docker Compose，避免默认推荐 Kubernetes。', '轻量部署偏好', 'global', 'internal', 0.95, 'confirmed', '[]', '["deploy","docker compose"]', 1, '{"seed":"desktop_eval_ts"}', datetime('now')),
       ('mem_desktop_antipattern_k8s', 'anti_pattern', '除非明确要求，不要把个人本地 App 默认引到 Kubernetes 或复杂运维路径。', '避免复杂运维默认路径', 'global', 'internal', 0.9, 'confirmed', '[]', '["kubernetes","ops"]', 0, '{"seed":"desktop_eval_ts"}', datetime('now')),
       ('mem_desktop_joi_direction', 'project_fact', '用户希望把 Joi 做成伙伴式前台 + 严肃执行后台：平时陪用户想，严肃任务时能可追踪、可交付、可审计地干活。', 'Joi 的产品方向', 'global', 'internal', 0.96, 'confirmed', '[]', '["Joi","伙伴式前台","严肃执行后台"]', 1, '{"seed":"desktop_eval_ts"}', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET content=excluded.content, summary=excluded.summary, confidence=excluded.confidence, status=excluded.status, pinned=excluded.pinned, updated_at=datetime('now')`,
  );
  store['exec'](
    `INSERT INTO nodes (id, name, role, status, capabilities, resources, network, assign_policy, auto_assign_enabled, manual_assign_enabled, last_heartbeat_at, version, metadata, updated_at)
     VALUES
       ('local-worker-1', 'Local Worker 1', 'worker', 'healthy', '["web_research_v1","server_diagnose_v1"]', '{}', '{}', '{}', 1, 1, datetime('now'), '0.1.0', '{"seed":"desktop_eval_ts"}', datetime('now')),
       ('vps-la-1', 'VPS LA 1', 'worker', 'healthy', '["web_research_v1","fetch_url","server_diagnose_self","system_health_check_self"]', '{}', '{}', '{}', 0, 1, datetime('now'), '0.1.0', '{"seed":"desktop_eval_ts"}', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, capabilities=excluded.capabilities, manual_assign_enabled=excluded.manual_assign_enabled, auto_assign_enabled=excluded.auto_assign_enabled, last_heartbeat_at=datetime('now'), updated_at=datetime('now')`,
  );
}

async function runCase(store, testCase) {
  const chat = await store.sendDeterministicChat({
    message: testCase.message,
    input_mode: testCase.input_mode,
    preferred_node: testCase.preferred_node,
    allow_worker: Boolean(testCase.allow_worker),
    runtime_mode: 'tool_calling',
  }, {
    executeCapability(capability, inputs) {
      switch (capability) {
        case 'workspace_search':
          return { output: executeWorkspaceSearch(inputs, store.getWorkspaceSettings()) };
        case 'file_analyze':
          return { output: executeFileAnalyze(inputs, store.getWorkspaceSettings()) };
        case 'file_read':
          return { output: executeFileRead(inputs, store.getWorkspaceSettings()) };
        default:
          return undefined;
      }
    },
  });
  const trace = store.getRunTrace(chat.run_id);
  if (testCase.expect_agent && chat.selected_agent_id !== testCase.expect_agent) {
    throw new Error(`selected_agent got ${chat.selected_agent_id} want ${testCase.expect_agent}`);
  }
  if (testCase.expect_response_contains && !chat.response.includes(testCase.expect_response_contains)) {
    throw new Error(`response does not contain ${JSON.stringify(testCase.expect_response_contains)}`);
  }
  const steps = trace.steps || [];
  const modelCalls = trace.model_calls || [];
  const promptAssemblies = trace.prompt_assemblies || [];
  const memoryContextPacks = trace.memory_context_packs || [];
  if (testCase.expect_min_model_calls !== undefined && modelCalls.length < testCase.expect_min_model_calls) {
    throw new Error(`model_calls got ${modelCalls.length} want at least ${testCase.expect_min_model_calls}`);
  }
  if (testCase.expect_min_prompt_assemblies !== undefined && promptAssemblies.length < testCase.expect_min_prompt_assemblies) {
    throw new Error(`prompt_assemblies got ${promptAssemblies.length} want at least ${testCase.expect_min_prompt_assemblies}`);
  }
  if (testCase.expect_min_memory_context_packs !== undefined && memoryContextPacks.length < testCase.expect_min_memory_context_packs) {
    throw new Error(`memory_context_packs got ${memoryContextPacks.length} want at least ${testCase.expect_min_memory_context_packs}`);
  }
  for (const stepType of testCase.expect_step_types || []) {
    if (!hasStep(steps, stepType)) {
      throw new Error(`missing step_type ${stepType}`);
    }
  }
  for (const stepType of testCase.expect_no_step_types || []) {
    if (hasStep(steps, stepType)) {
      throw new Error(`unexpected step_type ${stepType}`);
    }
  }
  if (testCase.expect_capability && !hasCapability(steps, testCase.expect_capability)) {
    throw new Error(`missing capability ${testCase.expect_capability}`);
  }
  if (testCase.expect_node_id && !hasNodeAssignment(steps, testCase.expect_node_id, testCase.expect_assignment_reason)) {
    throw new Error(`missing node assignment node_id=${testCase.expect_node_id} reason=${testCase.expect_assignment_reason || ''}`);
  }
  if ((testCase.expect_min_tasks || 0) > tableCount(store, 'tasks', 'run_id', chat.run_id)) {
    throw new Error(`tasks got ${tableCount(store, 'tasks', 'run_id', chat.run_id)} want at least ${testCase.expect_min_tasks}`);
  }
  if (testCase.expect_tool_run && tableCount(store, 'tool_runs', 'run_id', chat.run_id) === 0) {
    throw new Error('expected tool_run');
  }
  if (testCase.expect_memory_usage && tableCount(store, 'memory_usage_logs', 'run_id', chat.run_id) === 0) {
    throw new Error('expected memory_usage_logs');
  }
  if (testCase.expect_memory_proposal && Number(store['get'](`SELECT COUNT(*) AS count FROM memories WHERE status='pending'`)?.count || 0) === 0) {
    throw new Error('expected pending memory proposal');
  }
  if (testCase.expect_product_task || testCase.expect_no_product_task || testCase.expect_min_product_task_steps > 0) {
    const productTask = store['get'](`SELECT id FROM product_tasks WHERE latest_run_id=? ORDER BY created_at DESC LIMIT 1`, chat.run_id);
    if (testCase.expect_no_product_task && productTask) {
      throw new Error(`unexpected product_task ${productTask.id}`);
    }
    if (!testCase.expect_no_product_task && !productTask) {
      throw new Error('expected product_task');
    }
    if (productTask && testCase.expect_min_product_task_steps > 0) {
      const stepCount = tableCount(store, 'product_task_steps', 'product_task_id', String(productTask.id));
      if (stepCount < testCase.expect_min_product_task_steps) {
        throw new Error(`product_task_steps got ${stepCount} want at least ${testCase.expect_min_product_task_steps}`);
      }
    }
  }
  if (testCase.expect_artifact && tableCount(store, 'artifacts', 'source_run_id', chat.run_id) === 0) {
    throw new Error('expected artifact linked to run');
  }
  if (testCase.expect_open_loop && tableCount(store, 'open_loops', 'source_run_id', chat.run_id) === 0) {
    throw new Error('expected open_loop linked to run');
  }
  if (testCase.expect_proactive_draft) {
    const count = Number(store['get'](
      `SELECT COUNT(*) AS count
       FROM proactive_messages p
       LEFT JOIN open_loops o ON o.id=p.source_open_loop_id
       WHERE p.status='draft'
         AND (o.source_run_id=? OR p.source_product_task_id IN (SELECT id FROM product_tasks WHERE latest_run_id=?))`,
      chat.run_id,
      chat.run_id,
    )?.count || 0);
    if (count === 0) throw new Error('expected proactive draft linked to run');
  }
}

function hasStep(steps, stepType) {
  return steps.some((step) => step.step_type === stepType);
}

function hasCapability(steps, capability) {
  return steps.some((step) => step.step_type === 'capability_requested' && canonicalCapability(step.output?.capability) === canonicalCapability(capability));
}

function hasNodeAssignment(steps, nodeID, reason) {
  return steps.some((step) => step.step_type === 'node_selected'
    && step.output?.node_id === nodeID
    && (!reason || step.output?.assignment_reason === reason));
}

function canonicalCapability(value) {
  const text = String(value || '');
  if (text === 'web_research_v1') return 'web_research';
  if (text === 'server_diagnose_v1') return 'server_diagnose';
  if (text === 'system_health_check_v1') return 'system_health_check';
  return text;
}

function tableCount(store, table, column, value) {
  return Number(store['get'](`SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`, value)?.count || 0);
}
