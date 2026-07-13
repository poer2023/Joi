import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const dbPath = process.env.JOI_DB || join(homedir(), 'Library/Application Support/Joi/joi.db');
const backupDir = process.env.JOI_DB_BACKUP_DIR || join(process.cwd(), '.local/db-backups');

const specs = [
  {
    projectID: 'prj_joi_desktop',
    projectName: 'Joi Desktop',
    goal: '约束桌面聊天主界面、右侧检查器和执行反馈的 MVP 体验。',
    domain: 'desktop_agent_os',
    phase: 'ui_contract',
    personaID: 'per_joi_desktop',
    personaName: 'Joi',
    handle: '@joi-desktop',
    avatar: 'J',
    tagline: '本地桌面 Agent OS 项目人格',
    intro: '我负责把聊天、任务、运行日志和本地状态组织成一个可验证的桌面工作台。',
    status: 'active',
    roomID: 'room_joi_dm',
    conversationID: 'conv_joi_dm',
    runID: 'run_joi_ui_contract',
    threadID: 'thread_joi_ui_contract',
    artifactID: 'art_joi_ui_contract',
    lastMessage: '右侧概览、成员详情和 mock 约束已进入联调。',
    nextAction: '核对预览布局里的成员详情临时 tab。',
    modelName: 'gpt-5-codex',
    toolName: 'browser_preview',
  },
  {
    projectID: 'prj_ui_system',
    projectName: 'UI System',
    goal: '沉淀 Messenger 风格、间距、边框和紧凑面板规范。',
    domain: 'product_design',
    phase: 'style_lock',
    personaID: 'per_ui_system',
    personaName: 'Mira UI',
    handle: '@mira-ui',
    avatar: 'UI',
    tagline: '界面约束与交互细节负责人',
    intro: '我负责把用户标注的低级 UI 问题转成可复用的布局约束。',
    status: 'active',
    roomID: 'room_ui_system_dm',
    conversationID: 'conv_ui_system_dm',
    runID: 'run_ui_spacing_review',
    threadID: 'thread_ui_spacing',
    artifactID: 'art_ui_spacing_rules',
    lastMessage: '边框内距、hover 灰和输入框编辑状态需要保持一致。',
    nextAction: '把成员列表和表单行纳入同一套密度规则。',
    modelName: 'gpt-5-codex',
    toolName: 'css_audit',
  },
  {
    projectID: 'prj_runtime_ops',
    projectName: 'Runtime Ops',
    goal: '约束 Run Trace、工具调用和确认流在桌面端的可观测形态。',
    domain: 'orchestrator_runtime',
    phase: 'traceable_mvp',
    personaID: 'per_runtime_ops',
    personaName: 'Rune Ops',
    handle: '@rune-ops',
    avatar: 'RO',
    tagline: '运行、线程与工具审计负责人',
    intro: '我负责让每一次模型、工具和节点调度都能被追踪和解释。',
    status: 'warm',
    roomID: 'room_runtime_ops_dm',
    conversationID: 'conv_runtime_ops_dm',
    runID: 'run_runtime_trace_pass',
    threadID: 'thread_runtime_trace',
    artifactID: 'art_runtime_trace_map',
    lastMessage: '运行 tab 需要能看到模型、工具、成本和副作用。',
    nextAction: '补齐失败/等待审批状态的展示样例。',
    modelName: 'deepseek-v4-flash',
    toolName: 'run_trace_audit',
  },
  {
    projectID: 'prj_memory_os',
    projectName: 'Memory OS',
    goal: '把长期记忆、候选建议和本轮召回整理成可编辑的信息架构。',
    domain: 'memory_system',
    phase: 'reviewable_memory',
    personaID: 'per_memory_os',
    personaName: 'Mnemo',
    handle: '@mnemo',
    avatar: 'ME',
    tagline: '记忆召回、候选和反馈负责人',
    intro: '我负责把可追溯、可编辑、可停用的记忆展示成用户能审阅的工作流。',
    status: 'active',
    roomID: 'room_memory_os_dm',
    conversationID: 'conv_memory_os_dm',
    runID: 'run_memory_review',
    threadID: 'thread_memory_review',
    artifactID: 'art_memory_policy',
    lastMessage: '记忆 tab 需要同时展示本轮召回和新建议。',
    nextAction: '验证 pending memory 的确认/修改/别记操作入口。',
    modelName: 'gpt-5-codex',
    toolName: 'memory_retrieval',
  },
  {
    projectID: 'prj_gateway',
    projectName: 'Worker Gateway',
    goal: '约束主节点、Worker、外部入口和镜像房间的边界。',
    domain: 'worker_gateway',
    phase: 'capability_routing',
    personaID: 'per_worker_gateway',
    personaName: 'Gate',
    handle: '@gate',
    avatar: 'GW',
    tagline: '节点、能力和外部入口边界负责人',
    intro: '我负责让本地桌面、Worker 和外部连接保持最小授权与可观测。',
    status: 'dormant',
    roomID: 'room_worker_gateway_dm',
    conversationID: 'conv_worker_gateway_dm',
    runID: 'run_gateway_capability_scan',
    threadID: 'thread_gateway_boundary',
    artifactID: 'art_gateway_matrix',
    lastMessage: '外部连接只作为入口，不能绕过本地 runtime 策略。',
    nextAction: '保留一个等待唤醒状态，约束非活跃成员展示。',
    modelName: 'deepseek-v4-flash',
    toolName: 'capability_registry',
  },
];

function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function j(value) {
  return q(JSON.stringify(value));
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function traits(index) {
  return {
    directness: 0.72 + index * 0.03,
    warmth: 0.48 + index * 0.04,
    humor: 0.1 + index * 0.02,
    verbosity: 0.42 + index * 0.03,
    initiative: 0.68 + index * 0.04,
    risk_sensitivity: 0.78 + index * 0.03,
    divergence: 0.3 + index * 0.05,
  };
}

function runStatus(index) {
  if (index === 2) return 'failed';
  if (index === 4) return 'waiting_confirmation';
  return 'succeeded';
}

function eventSummary(spec, index) {
  if (index === 2) return '预览样例：工具结果缺少截图证据，需要回到浏览器复查。';
  if (index === 4) return '外部入口能力涉及副作用，等待 owner 确认后才会继续。';
  return `${spec.toolName} 已产出 ${spec.projectName} 的检查证据。`;
}

function insertOrReplace(table, fields, values) {
  return `INSERT OR REPLACE INTO ${table} (${fields.join(', ')}) VALUES (${values.map(q).join(', ')});`;
}

function upsert(table, fields, values, updateFields) {
  return `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${values.map(q).join(', ')})
ON CONFLICT(id) DO UPDATE SET ${updateFields.map((field) => `${field}=excluded.${field}`).join(', ')};`;
}

if (!existsSync(dbPath)) {
  throw new Error(`Joi SQLite DB not found: ${dbPath}`);
}

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const backupPath = join(backupDir, `joi-before-preview-seed-${stamp}.db`);
copyFileSync(dbPath, backupPath);

const seedRoomIDs = ['room_private_hub', ...specs.map((spec) => spec.roomID)];
const seedConversationIDs = ['conv_private_hub', ...specs.map((spec) => spec.conversationID)];
const seedRunIDs = specs.map((spec) => spec.runID);

const sql = [
  'PRAGMA foreign_keys=OFF;',
  'BEGIN IMMEDIATE;',
  `DELETE FROM room_members WHERE room_id IN (${seedRoomIDs.map(q).join(', ')});`,
  `DELETE FROM model_calls WHERE run_id IN (${seedRunIDs.map(q).join(', ')});`,
  `DELETE FROM tool_runs WHERE run_id IN (${seedRunIDs.map(q).join(', ')});`,
  `DELETE FROM run_steps WHERE run_id IN (${seedRunIDs.map(q).join(', ')});`,
  `DELETE FROM run_events WHERE run_id IN (${seedRunIDs.map(q).join(', ')});`,
  `DELETE FROM memory_usage_logs WHERE run_id IN (${seedRunIDs.map(q).join(', ')});`,
  `DELETE FROM messenger_thread_events WHERE thread_id IN (${specs.map((spec) => q(spec.threadID)).join(', ')});`,
  `DELETE FROM route_locks WHERE room_id IN (${seedRoomIDs.map(q).join(', ')});`,
  `DELETE FROM confirmation_requests WHERE id='conf_preview_gateway_policy';`,
];

sql.push(upsert(
  'conversations',
  ['id', 'channel', 'user_id', 'title', 'active_agent_id', 'active_project_id', 'lifecycle_status', 'metadata', 'created_at', 'updated_at'],
  ['conv_private_hub', 'desktop', 'desktop_user', '私人总群', 'per_joi_desktop', 'prj_joi_desktop', 'active', JSON.stringify({ room_id: 'room_private_hub', room_type: 'private_hub', preview_seed: true }), minutesAgo(1440), minutesAgo(0)],
  ['title', 'active_agent_id', 'active_project_id', 'lifecycle_status', 'metadata', 'updated_at'],
));
sql.push(upsert(
  'rooms',
  ['id', 'type', 'title', 'subtitle', 'owner_user_id', 'project_id', 'persona_id', 'conversation_id', 'default_ai_participation', 'floor_holder_persona_id', 'metadata', 'created_at', 'updated_at'],
  ['room_private_hub', 'private_hub', '私人总群', '你和五个项目人格', 'desktop_user', null, 'per_joi_desktop', 'conv_private_hub', 'moderate', 'per_joi_desktop', JSON.stringify({ preview_seed: true, project_count: specs.length, avatar: '总' }), minutesAgo(1440), minutesAgo(0)],
  ['title', 'subtitle', 'persona_id', 'conversation_id', 'default_ai_participation', 'floor_holder_persona_id', 'metadata', 'updated_at'],
));

for (const [index, spec] of specs.entries()) {
  const status = runStatus(index);
  const now = minutesAgo(index * 18);
  const roomMetadata = {
    preview_seed: true,
    private_persona_chat: true,
    run_id: spec.runID,
    thread_id: spec.threadID,
    avatar: spec.avatar,
  };
  sql.push(upsert(
    'projects',
    ['id', 'name', 'goal', 'domain', 'phase', 'risk_level', 'status', 'summary', 'metadata', 'created_at', 'updated_at'],
    [spec.projectID, spec.projectName, spec.goal, spec.domain, spec.phase, spec.projectID === 'prj_gateway' ? 'medium' : 'low', 'active', spec.goal, JSON.stringify({ preview_seed: true, primary_persona_id: spec.personaID, local_path: `/Users/hao/project/${spec.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }), minutesAgo(1440), now],
    ['name', 'goal', 'domain', 'phase', 'risk_level', 'status', 'summary', 'metadata', 'updated_at'],
  ));
  sql.push(upsert(
    'personas',
    ['id', 'project_id', 'display_name', 'handle', 'avatar', 'tagline', 'self_intro', 'traits', 'disagreement_style', 'uncertainty_style', 'status', 'version', 'capabilities', 'permission_summary', 'model_strategy', 'metadata', 'created_at', 'updated_at'],
    [spec.personaID, spec.projectID, spec.personaName, spec.handle, spec.avatar, spec.tagline, spec.intro, JSON.stringify(traits(index)), '直接指出风险，并给出可执行替代路径', '说明不确定来源、影响范围和验证方式', spec.status, 2, JSON.stringify(['chat', 'runs', 'threads', 'assets', 'memory']), '默认只读；写入、外部副作用和高风险操作需要确认', spec.modelName, JSON.stringify({ preview_seed: true, room_id: spec.roomID, ai_identity_label: '项目人格' }), minutesAgo(1440), now],
    ['project_id', 'display_name', 'handle', 'avatar', 'tagline', 'self_intro', 'traits', 'disagreement_style', 'uncertainty_style', 'status', 'version', 'capabilities', 'permission_summary', 'model_strategy', 'metadata', 'updated_at'],
  ));
  sql.push(upsert(
    'agents',
    ['id', 'name', 'description', 'system_prompt', 'capabilities', 'metadata', 'created_at', 'updated_at'],
    [spec.personaID, spec.personaName, spec.tagline, spec.intro, JSON.stringify(['chat', 'runs', 'threads', 'assets', 'memory']), JSON.stringify({ preview_seed: true, project_id: spec.projectID }), minutesAgo(1440), now],
    ['name', 'description', 'system_prompt', 'capabilities', 'metadata', 'updated_at'],
  ));
  sql.push(upsert(
    'conversations',
    ['id', 'channel', 'user_id', 'title', 'active_agent_id', 'active_project_id', 'lifecycle_status', 'metadata', 'created_at', 'updated_at'],
    [spec.conversationID, 'desktop', 'desktop_user', spec.personaName, spec.personaID, spec.projectID, 'active', JSON.stringify({ room_id: spec.roomID, room_type: 'project_dm', persona_id: spec.personaID, project_id: spec.projectID, preview_seed: true }), minutesAgo(1200 - index * 30), now],
    ['title', 'active_agent_id', 'active_project_id', 'lifecycle_status', 'metadata', 'updated_at'],
  ));
  sql.push(upsert(
    'rooms',
    ['id', 'type', 'title', 'subtitle', 'owner_user_id', 'project_id', 'persona_id', 'conversation_id', 'default_ai_participation', 'floor_holder_persona_id', 'metadata', 'created_at', 'updated_at'],
    [spec.roomID, 'project_dm', spec.personaName, `${spec.projectName} · ${spec.status}`, 'desktop_user', spec.projectID, spec.personaID, spec.conversationID, 'moderate', index < 2 ? spec.personaID : null, JSON.stringify(roomMetadata), minutesAgo(1200 - index * 30), now],
    ['title', 'subtitle', 'project_id', 'persona_id', 'conversation_id', 'default_ai_participation', 'floor_holder_persona_id', 'metadata', 'updated_at'],
  ));
  sql.push(insertOrReplace('room_members', ['id', 'room_id', 'member_type', 'member_id', 'display_name', 'role', 'persona_id', 'project_id', 'visibility_scope', 'metadata', 'created_at', 'updated_at'], [`rmem_${spec.roomID}_user`, spec.roomID, 'user', 'desktop_user', '你', 'owner', null, null, 'room_members', JSON.stringify({ visible_project_ids: [spec.projectID], can_approve_high_risk: true }), minutesAgo(1200), now]));
  sql.push(insertOrReplace('room_members', ['id', 'room_id', 'member_type', 'member_id', 'display_name', 'role', 'persona_id', 'project_id', 'visibility_scope', 'metadata', 'created_at', 'updated_at'], [`rmem_${spec.roomID}_${spec.personaID}`, spec.roomID, 'persona', spec.personaID, spec.personaName, 'persona', spec.personaID, spec.projectID, 'room_members', JSON.stringify({ presence: spec.status, avatar: spec.avatar }), minutesAgo(1200), now]));
  sql.push(insertOrReplace('room_members', ['id', 'room_id', 'member_type', 'member_id', 'display_name', 'role', 'persona_id', 'project_id', 'visibility_scope', 'metadata', 'created_at', 'updated_at'], [`rmem_room_private_hub_${spec.personaID}`, 'room_private_hub', 'persona', spec.personaID, spec.personaName, 'persona', spec.personaID, spec.projectID, 'room_members', JSON.stringify({ presence: spec.status, avatar: spec.avatar }), minutesAgo(1200), now]));
  sql.push(insertOrReplace('persona_versions', ['id', 'persona_id', 'version', 'changed_by', 'change_reason', 'before_json', 'after_json', 'created_at'], [`pver_${spec.personaID}_1`, spec.personaID, 1, 'desktop_user', '预览初始身份', '{}', JSON.stringify({ display_name: spec.personaName, handle: spec.handle }), minutesAgo(1440)]));
  sql.push(insertOrReplace('persona_versions', ['id', 'persona_id', 'version', 'changed_by', 'change_reason', 'before_json', 'after_json', 'created_at'], [`pver_${spec.personaID}_2`, spec.personaID, 2, 'desktop_user', '按新 Messenger 设计理念补充职责与展示状态', '{}', JSON.stringify({ display_name: spec.personaName, handle: spec.handle, model_strategy: spec.modelName }), now]));
  sql.push(upsert(
    'messenger_threads',
    ['id', 'project_id', 'room_id', 'owner_persona_id', 'title', 'goal', 'status', 'priority', 'collaborator_persona_ids', 'source_room_ids', 'source_message_ids', 'run_ids', 'artifact_ids', 'next_action', 'metadata', 'created_at', 'updated_at'],
    [spec.threadID, spec.projectID, spec.roomID, spec.personaID, `${spec.projectName} · ${spec.phase}`, spec.goal, status === 'waiting_confirmation' ? 'waiting_confirmation' : index === 2 ? 'reviewing' : 'running', index === 0 ? 'high' : 'normal', JSON.stringify(specs.filter((item) => item.personaID !== spec.personaID).slice(0, 2).map((item) => item.personaID)), JSON.stringify(['room_private_hub', spec.roomID]), JSON.stringify([`msg_${spec.conversationID}_user`, `msg_${spec.conversationID}_assistant`]), JSON.stringify([spec.runID]), JSON.stringify([spec.artifactID]), spec.nextAction, JSON.stringify({ preview_seed: true }), minutesAgo(900 - index * 40), now],
    ['project_id', 'room_id', 'owner_persona_id', 'title', 'goal', 'status', 'priority', 'collaborator_persona_ids', 'source_room_ids', 'source_message_ids', 'run_ids', 'artifact_ids', 'next_action', 'metadata', 'updated_at'],
  ));
  sql.push(insertOrReplace('messenger_thread_events', ['id', 'thread_id', 'room_id', 'message_id', 'run_id', 'artifact_id', 'event_type', 'summary', 'metadata', 'created_at'], [`tevt_${spec.threadID}_run`, spec.threadID, spec.roomID, `msg_${spec.conversationID}_assistant`, spec.runID, null, 'run.linked', '最近一次运行已关联到项目线程。', JSON.stringify({ preview_seed: true }), minutesAgo(index * 20)]));
  sql.push(insertOrReplace('messenger_thread_events', ['id', 'thread_id', 'room_id', 'message_id', 'run_id', 'artifact_id', 'event_type', 'summary', 'metadata', 'created_at'], [`tevt_${spec.threadID}_artifact`, spec.threadID, spec.roomID, null, null, spec.artifactID, 'artifact.created', '生成了一份可检查的 UI/功能约束产物。', JSON.stringify({ preview_seed: true }), now]));
  sql.push(insertOrReplace('runs', ['id', 'conversation_id', 'status', 'selected_agent_id', 'route_result', 'started_at', 'finished_at', 'duration_ms', 'metadata', 'created_at', 'entry_channel', 'requested_mode', 'resolved_mode', 'mode_source', 'terminal_status'], [spec.runID, spec.conversationID, status, spec.personaID, JSON.stringify({ room_id: spec.roomID, project_id: spec.projectID, persona_id: spec.personaID, thread_id: spec.threadID, write_targets: ['thread', 'artifact', 'memory_candidate'] }), minutesAgo(index * 18 + 9), status === 'waiting_confirmation' ? null : minutesAgo(index * 18), 1600 + index * 240, JSON.stringify({ preview_seed: true, project_name: spec.projectName }), minutesAgo(index * 18 + 9), 'desktop', 'chat', 'tool_calling', 'preview_seed', 'not_required']));
  sql.push(insertOrReplace('model_calls', ['id', 'run_id', 'agent_id', 'provider', 'model_name', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'total_tokens', 'cost_estimate', 'latency_ms', 'status', 'error_message', 'raw_response', 'metadata', 'created_at', 'completed_at', 'finish_reason', 'usage_status'], [`mcall_${spec.runID}`, spec.runID, spec.personaID, spec.modelName.includes('deepseek') ? 'deepseek' : 'openai', spec.modelName, 1200 + index * 110, 420 + index * 55, 320, 1620 + index * 165, 0.002 + index * 0.0007, 1600 + index * 240, status, index === 2 ? '预览样例：工具结果缺少截图证据，等待重新检查。' : null, '{}', JSON.stringify({ preview_seed: true }), minutesAgo(index * 18 + 7), status === 'waiting_confirmation' ? null : minutesAgo(index * 18 + 5), status === 'failed' ? 'error' : 'stop', 'provider_reported']));
  sql.push(insertOrReplace('tool_runs', ['id', 'run_id', 'capability_id', 'workflow_name', 'tool_name', 'node_id', 'assignment_reason', 'risk_level', 'status', 'input', 'output', 'error', 'started_at', 'finished_at', 'duration_ms', 'created_at', 'side_effect_level', 'output_summary', 'artifact_id', 'error_message'], [`toolrun_${spec.runID}`, spec.runID, null, `${spec.projectName} preview workflow`, spec.toolName, index < 3 ? 'main-node' : null, 'preview_seed', index === 4 ? 'medium' : 'read_only', index === 2 ? 'failed' : status, JSON.stringify({ room_id: spec.roomID, project_id: spec.projectID }), JSON.stringify({ artifact_id: spec.artifactID }), index === 2 ? JSON.stringify({ message: '预览样例：缺少截图证据' }) : null, minutesAgo(index * 18 + 6), status === 'waiting_confirmation' ? null : minutesAgo(index * 18 + 4), 520 + index * 90, minutesAgo(index * 18 + 6), index === 4 ? 'external' : 'none', eventSummary(spec, index), spec.artifactID, index === 2 ? '预览样例：缺少截图证据' : null]));
  for (const [seq, step] of [
    ['input_received', '接收请求', 'succeeded'],
    ['route_project_persona', `路由到 ${spec.personaName}`, 'succeeded'],
    ['response_generated', '生成预览响应', index === 2 ? 'failed' : 'succeeded'],
  ].entries()) {
    sql.push(insertOrReplace('run_steps', ['id', 'run_id', 'step_type', 'title', 'status', 'input', 'output', 'error', 'started_at', 'finished_at', 'duration_ms', 'created_at'], [`step_${spec.runID}_${seq + 1}`, spec.runID, step[0], step[1], step[2], '{}', '{}', step[2] === 'failed' ? '预览失败态' : null, minutesAgo(index * 18 + 8 - seq), minutesAgo(index * 18 + 7 - seq), 80 + seq * 200, minutesAgo(index * 18 + 8 - seq)]));
  }
  const eventRows = [
    ['run.mode_resolved', 'mode_resolution', `mode_${spec.runID}`, 'completed', 'trace_only', '桌面预览进入 tool-calling 运行模式', { resolved_mode: 'tool_calling', mode_source: 'preview_seed' }],
    ['plan.created', 'plan', `plan_${spec.runID}`, 'completed', 'transcript', `确认 ${spec.projectName} 的私聊、运行、线程、资产和记忆展示目标。`, { step: 0 }],
    ['tool.call_requested', 'tool_run', `call_${spec.runID}_${spec.toolName}`, 'requested', 'tool', `请求执行 ${spec.toolName}`, { call_id: `call_${spec.runID}_${spec.toolName}`, tool_name: spec.toolName, step: 2 }],
    [index === 4 ? 'tool.approval_required' : index === 2 ? 'tool.failed' : 'tool.completed', 'tool_run', `call_${spec.runID}_${spec.toolName}`, index === 4 ? 'waiting_confirmation' : index === 2 ? 'failed' : 'completed', index === 4 ? 'approval' : 'tool', eventSummary(spec, index), { call_id: `call_${spec.runID}_${spec.toolName}`, tool_name: spec.toolName, artifact_id: spec.artifactID }],
    ['artifact.created', 'artifact', spec.artifactID, status, 'trace_only', spec.artifactID, { artifact_id: spec.artifactID }],
  ];
  for (const [seq, event] of eventRows.entries()) {
    sql.push(insertOrReplace('run_events', ['id', 'run_id', 'seq', 'event_type', 'payload', 'created_at', 'conversation_id', 'item_type', 'item_id', 'visibility', 'source', 'payload_json', 'error_json', 'level', 'risk_level', 'category', 'feature_key', 'message', 'duration_ms'], [`evt_${spec.runID}_${seq + 1}`, spec.runID, seq + 1, event[0], JSON.stringify({ ...event[6], status: event[3], summary: event[5] }), minutesAgo(index * 18 + 8 - seq), spec.conversationID, event[1], event[2], event[4], event[4] === 'tool' ? 'tool' : 'store', JSON.stringify({ ...event[6], status: event[3], summary: event[5] }), index === 2 && event[0] === 'tool.failed' ? JSON.stringify({ message: event[5] }) : null, index === 2 && event[0] === 'tool.failed' ? 'error' : 'info', index === 4 ? 'confirmation_required' : 'read_only', 'runtime', `preview.${event[0]}`, event[5], 40 + seq * 50]));
  }
  sql.push(upsert('artifacts', ['id', 'type', 'title', 'content', 'content_format', 'source_run_id', 'source_conversation_id', 'source_message_id', 'version', 'status', 'metadata', 'created_at', 'updated_at'], [spec.artifactID, index === 0 ? 'ui_contract' : 'spec', `${spec.projectName} 约束草案`, `# ${spec.projectName}\n\n${spec.goal}\n\n下一步：${spec.nextAction}`, 'markdown', spec.runID, spec.conversationID, `msg_${spec.conversationID}_assistant`, 1, 'active', JSON.stringify({ preview_seed: true, project_id: spec.projectID, room_id: spec.roomID }), minutesAgo(index * 30), now], ['type', 'title', 'content', 'content_format', 'source_run_id', 'source_conversation_id', 'source_message_id', 'version', 'status', 'metadata', 'updated_at']));
  sql.push(upsert('artifacts', ['id', 'type', 'title', 'content', 'content_format', 'source_run_id', 'source_conversation_id', 'version', 'status', 'metadata', 'created_at', 'updated_at'], [`art_${spec.projectID}_checklist`, 'checklist', `${spec.projectName} 验收清单`, `- 私聊可见\n- 运行可追溯\n- 线程/资产/记忆有样例`, 'markdown', spec.runID, spec.conversationID, 1, 'draft', JSON.stringify({ preview_seed: true, project_id: spec.projectID, room_id: spec.roomID }), minutesAgo(index * 35), now], ['type', 'title', 'content', 'content_format', 'source_run_id', 'source_conversation_id', 'version', 'status', 'metadata', 'updated_at']));
  const memoryID = `mem_${spec.projectID}_constraint`;
  sql.push(upsert('memories', ['id', 'type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'created_at', 'updated_at', 'last_used_at'], [memoryID, 'project_constraint', `${spec.projectName} 的预览 UI 必须通过房间、运行、线程、资产、记忆五个入口同时验证。`, `${spec.projectName} 预览约束`, 'project', spec.projectID, 'local', 0.86 + index * 0.02, 'confirmed', JSON.stringify([spec.runID]), JSON.stringify([spec.projectName, spec.personaName]), 3 + index, 0, 4 + index, 2 + index, 0, index < 2 ? 1 : 0, JSON.stringify({ preview_seed: true, run_id: spec.runID }), minutesAgo(1200 - index * 30), now, minutesAgo(index * 25)], ['type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'updated_at', 'last_used_at']));
  sql.push(insertOrReplace('memory_usage_logs', ['id', 'memory_id', 'run_id', 'agent_id', 'retrieval_score', 'injected', 'used_in_answer', 'outcome', 'metadata', 'created_at'], [`muse_${spec.runID}_${memoryID}`, memoryID, spec.runID, spec.personaID, 0.91 - index * 0.03, 1, 1, 'helpful', JSON.stringify({ preview_seed: true }), minutesAgo(index * 25)]));
  sql.push(insertOrReplace('room_connectors', ['id', 'room_id', 'provider', 'connector_id', 'external_room_id', 'status', 'visible_persona_ids', 'allow_temporary_invite', 'retry_count', 'metadata', 'created_at', 'updated_at'], [`rconn_${spec.roomID}_desktop`, spec.roomID, 'desktop', `desktop:${spec.projectID}`, spec.roomID, spec.projectID === 'prj_gateway' ? 'paused' : 'active', JSON.stringify([spec.personaID]), spec.projectID !== 'prj_gateway' ? 1 : 0, 0, JSON.stringify({ preview_seed: true }), minutesAgo(1200), now]));
  sql.push(insertOrReplace('routing_decisions', ['id', 'room_id', 'message_id', 'run_id', 'speaker_persona_id', 'owner_project_id', 'executor_persona_id', 'collaborator_project_ids', 'execution_scope', 'write_targets', 'thread_action', 'confidence', 'risk', 'requires_confirmation', 'reason_codes', 'metadata', 'created_at'], [`rdec_${spec.runID}`, spec.roomID, `msg_${spec.conversationID}_user`, spec.runID, spec.personaID, spec.projectID, spec.personaID, JSON.stringify(specs.filter((item) => item.projectID !== spec.projectID).slice(0, 2).map((item) => item.projectID)), 'project_dm', JSON.stringify(['thread', 'artifact', 'memory_candidate']), JSON.stringify({ action: 'attach', thread_id: spec.threadID }), 0.82 + index * 0.02, index === 4 ? 'medium' : 'low', index === 4 ? 1 : 0, JSON.stringify(['PREVIEW_PROJECT_ROOM', 'PERSONA_MATCH']), JSON.stringify({ preview_seed: true }), minutesAgo(index * 18)]));
}

sql.push(insertOrReplace('room_members', ['id', 'room_id', 'member_type', 'member_id', 'display_name', 'role', 'visibility_scope', 'metadata', 'created_at', 'updated_at'], ['rmem_room_private_hub_user', 'room_private_hub', 'user', 'desktop_user', '你', 'owner', 'room_members', JSON.stringify({ presence: 'online', description: '登录用户 · 真人', visible_project_ids: specs.map((spec) => spec.projectID), can_approve_high_risk: true }), minutesAgo(1200), minutesAgo(0)]));
sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], ['msg_conv_private_hub_user', 'conv_private_hub', 'user', '把五个项目人格都填进当前安装版，右侧所有 tab 都要能约束样式。', '[]', JSON.stringify({ preview_seed: true, room_id: 'room_private_hub' }), minutesAgo(20)]));
sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], ['msg_conv_private_hub_assistant', 'conv_private_hub', 'assistant', '已加入 Joi、Mira UI、Rune Ops、Mnemo、Gate，并为运行、线程、资产和记忆准备联动数据。', '[]', JSON.stringify({ preview_seed: true, room_id: 'room_private_hub', run_id: 'run_joi_ui_contract' }), minutesAgo(0)]));

for (const spec of specs) {
  sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], [`msg_${spec.conversationID}_user`, spec.conversationID, 'user', `检查 ${spec.projectName} 的私聊、运行和产物展示。`, '[]', JSON.stringify({ preview_seed: true, room_id: spec.roomID, project_id: spec.projectID }), minutesAgo(24)]));
  sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], [`msg_${spec.conversationID}_assistant`, spec.conversationID, 'assistant', `${spec.personaName}: ${spec.lastMessage}`, '[]', JSON.stringify({ preview_seed: true, room_id: spec.roomID, project_id: spec.projectID, run_id: spec.runID }), minutesAgo(18)]));
  sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], [`msg_${spec.conversationID}_user_follow`, spec.conversationID, 'user', spec.nextAction, '[]', JSON.stringify({ preview_seed: true, room_id: spec.roomID, project_id: spec.projectID }), minutesAgo(12)]));
  sql.push(insertOrReplace('messages', ['id', 'conversation_id', 'role', 'content', 'attachments', 'metadata', 'created_at'], [`msg_${spec.conversationID}_assistant_follow`, spec.conversationID, 'assistant', `我会把这条约束写入 ${spec.threadID}，并生成 ${spec.artifactID}。`, '[]', JSON.stringify({ preview_seed: true, room_id: spec.roomID, project_id: spec.projectID, run_id: spec.runID }), minutesAgo(0)]));
}

sql.push(upsert('memories', ['id', 'type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'created_at', 'updated_at', 'last_used_at'], ['mem_desktop_user_owner', 'user_state', '登录用户是私人总群群主 owner，可查看五个项目人格并触发高风险确认。', '登录用户是群主 Owner', 'user', 'desktop_user', 'local', 0.94, 'confirmed', JSON.stringify(['run_joi_ui_contract']), JSON.stringify(['desktop_user', 'owner']), 6, 0, 7, 5, 0, 1, JSON.stringify({ preview_seed: true }), minutesAgo(1500), minutesAgo(0), minutesAgo(10)], ['type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'updated_at', 'last_used_at']));
sql.push(upsert('memories', ['id', 'type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'created_at', 'updated_at'], ['mem_candidate_member_detail_tab', 'ui_candidate', '点击概览成员后应在右侧顶栏临时增加成员详情 tab，hover/focus 时显示关闭按钮。', '成员详情临时 tab 候选', 'room', 'room_private_hub', 'local', 0.71, 'proposed', JSON.stringify(['run_joi_ui_contract']), JSON.stringify(['member_detail', 'right_inspector_tab']), 0, 0, 1, 0, 0, 0, JSON.stringify({ preview_seed: true, run_id: 'run_joi_ui_contract', why: '用户要求从概览成员进入独立详情页' }), minutesAgo(8), minutesAgo(0)], ['type', 'content', 'summary', 'scope_type', 'scope_id', 'privacy_level', 'confidence', 'status', 'source_event_ids', 'entities', 'success_count', 'failure_count', 'usage_count', 'positive_feedback', 'negative_feedback', 'pinned', 'metadata', 'updated_at']));
sql.push(insertOrReplace('memory_usage_logs', ['id', 'memory_id', 'run_id', 'agent_id', 'retrieval_score', 'injected', 'used_in_answer', 'outcome', 'metadata', 'created_at'], ['muse_run_joi_ui_contract_mem_desktop_user_owner', 'mem_desktop_user_owner', 'run_joi_ui_contract', 'per_joi_desktop', 0.88, 1, 1, 'helpful', JSON.stringify({ preview_seed: true }), minutesAgo(10)]));
sql.push(insertOrReplace('external_connector_events', ['id', 'connector_id', 'provider', 'external_event_id', 'room_id', 'external_user_id', 'text', 'status', 'retry_count', 'metadata', 'created_at'], ['extev_preview_gateway_waiting', 'rconn_room_worker_gateway_dm_desktop', 'desktop', 'preview_gateway_waiting', 'room_worker_gateway_dm', 'desktop_user', '等待用户确认 Worker Gateway 外部入口策略。', 'waiting_confirmation', 0, JSON.stringify({ preview_seed: true }), minutesAgo(0)]));
sql.push(insertOrReplace('route_locks', ['id', 'room_id', 'user_id', 'persona_id', 'started_at', 'status', 'metadata'], ['rlock_preview_runtime_ops', 'room_runtime_ops_dm', 'desktop_user', 'per_runtime_ops', minutesAgo(30), 'active', JSON.stringify({ preview_seed: true })]));
sql.push(insertOrReplace('confirmation_requests', ['id', 'run_id', 'capability_id', 'requested_action', 'risk_level', 'status', 'input', 'created_at'], ['conf_preview_gateway_policy', 'run_gateway_capability_scan', null, '确认 Worker Gateway 外部入口策略', 'medium', 'pending', JSON.stringify({ preview_seed: true, room_id: 'room_worker_gateway_dm' }), minutesAgo(0)]));

sql.push('COMMIT;');

const result = spawnSync('/usr/bin/sqlite3', [dbPath], {
  input: sql.join('\n'),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 16,
});

if (result.status !== 0) {
  throw new Error(`sqlite3 seed failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

console.log(JSON.stringify({
  ok: true,
  dbPath,
  backupPath,
  projects: specs.length,
  rooms: seedRoomIDs.length,
  runs: seedRunIDs.length,
}, null, 2));
