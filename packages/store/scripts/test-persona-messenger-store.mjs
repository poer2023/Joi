import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JoiSQLiteStore } from '../src/sqlite.ts';

const root = resolve(import.meta.dirname, '../../..');
const tempDir = mkdtempSync(join(tmpdir(), 'joi-persona-messenger-'));

try {
  const store = new JoiSQLiteStore({
    dbPath: join(tempDir, 'joi.db'),
    schemaSql: readFileSync(join(root, 'database/sqlite/001_init_schema.sql'), 'utf8'),
    logDir: join(tempDir, 'logs'),
    backupDir: join(tempDir, 'backups'),
    version: 'test',
  });

  const initial = store.listPersonaMessenger();
  assert.ok(initial.rooms.some((room) => room.type === 'private_hub'));
  assert.ok(initial.personas.some((persona) => persona.handle === '@joi-desktop'));
  assert.ok(Array.isArray(initial.persona_versions));

  const candidates = store.generateProjectPersonaCandidates({
    project_name: 'Apollo Mobile',
    project_goal: '推进移动端重构',
    domain: 'product',
    phase: 'implementation',
  }).candidates;
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map((candidate) => candidate.handle)).size, 3);

  const created = store.createProjectPersona({
    project_name: 'Apollo Mobile',
    project_goal: '推进移动端重构',
    domain: 'product',
    phase: 'implementation',
    candidate_id: candidates[1].id,
    persona_choice: {
      display_name: 'Mira',
      self_intro: '我会先厘清约束，再推动可验证的方案。',
    },
  });
  assert.equal(created.project.name, 'Apollo Mobile');
  assert.equal(created.persona.display_name, 'Mira');
  assert.equal(created.project.metadata.persona_candidates.length, 3);
  assert.equal(created.project.metadata.selected_persona_candidate_id, candidates[1].id);
  assert.equal(created.room.type, 'project_dm');
  assert.equal(created.room.conversation_id?.startsWith('conv_'), true);

  const duplicateDisplay = store.createProjectPersona({
    project_name: 'Apollo Web',
    persona_choice: { display_name: 'Mira' },
  });
  assert.equal(duplicateDisplay.persona.display_name, 'Mira');
  assert.notEqual(duplicateDisplay.persona.handle, created.persona.handle);

  const locked = store.setRouteLock({
    room_id: created.room.id,
    persona_id: created.persona.id,
    action: 'lock',
  }).route_lock;
  assert.equal(locked?.persona_id, created.persona.id);
  assert.equal(store.listPersonaMessenger().route_locks.some((lock) => lock.room_id === created.room.id), true);

  const response = await store.sendDeterministicChat({
    room_id: created.room.id,
    conversation_id: created.room.conversation_id,
    message: '继续推进首页重构',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'current_project',
  });
  const afterRun = store.listPersonaMessenger();
  const decision = afterRun.recent_routing_decisions.find((item) => item.run_id === response.run_id);
  assert.ok(decision);
  assert.equal(decision.room_id, created.room.id);
  assert.equal(decision.speaker_persona_id, created.persona.id);
  assert.equal(decision.owner_project_id, created.project.id);
  assert.ok(decision.reason_codes.includes('PROJECT_DM_DEFAULT'));
  assert.ok(decision.reason_codes.includes('ROUTE_LOCK_ACTIVE'));
  const firstThread = afterRun.threads.find((thread) => thread.run_ids.includes(response.run_id));
  assert.ok(firstThread);
  assert.equal(firstThread.project_id, created.project.id);
  assert.equal(firstThread.owner_persona_id, created.persona.id);
  assert.equal(firstThread.source_message_ids.includes(response.user_message_id), true);
  assert.equal(decision.thread_action.thread_id, firstThread.id);
  store['exec'](
    `INSERT INTO artifacts (id, type, title, content, source_run_id, source_conversation_id, source_message_id, status, created_at, updated_at)
     VALUES ('art_thread_manual', 'document', 'Thread Artifact', 'thread artifact smoke', ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    response.run_id,
    created.room.conversation_id,
    response.assistant_message_id,
  );
  store['attachMessengerThreadArtifacts'](response.run_id, undefined, ['art_thread_manual']);
  const firstThreadWithArtifact = store.listPersonaMessenger().threads.find((thread) => thread.id === firstThread.id);
  assert.equal(firstThreadWithArtifact?.artifact_ids.includes('art_thread_manual'), true);
  store['exec'](
    `INSERT INTO messages (id, conversation_id, role, content, attachments, metadata, created_at)
     VALUES ('msg_export_secret', ?, 'user', '导出测试 api_key=sk-export-secret-token', '[]', '{}', datetime('now'))`,
    created.room.conversation_id,
  );
  const threadExport = store.exportPersonaMessengerData({
    thread_id: firstThread.id,
    include_messages: true,
    include_trace: true,
  });
  const threadExportPayload = JSON.parse(readFileSync(threadExport.path, 'utf8'));
  assert.equal(threadExport.manifest.filters.thread_id, firstThread.id);
  assert.ok(threadExportPayload.data.threads.some((thread) => thread.id === firstThread.id));
  assert.ok(threadExportPayload.data.runs.some((run) => run.id === response.run_id));
  assert.ok(threadExportPayload.data.artifacts.some((artifact) => artifact.id === 'art_thread_manual'));
  assert.ok(JSON.stringify(threadExportPayload).includes('[REDACTED]'));
  assert.equal(JSON.stringify(threadExportPayload).includes('sk-export-secret-token'), false);

  const continuedThreadRun = await store.sendDeterministicChat({
    room_id: created.room.id,
    conversation_id: created.room.conversation_id,
    message: '继续这个任务，补充验收标准',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'current_project',
  });
  const afterContinuation = store.listPersonaMessenger();
  const continuedThread = afterContinuation.threads.find((thread) => thread.run_ids.includes(continuedThreadRun.run_id));
  assert.ok(continuedThread);
  assert.equal(continuedThread.id, firstThread.id);
  assert.equal(continuedThread.run_ids.includes(response.run_id), true);

  const newTargetRun = await store.sendDeterministicChat({
    room_id: created.room.id,
    conversation_id: created.room.conversation_id,
    message: '实现一个新的设置页任务',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'current_project',
  });
  const afterNewTarget = store.listPersonaMessenger();
  const newThread = afterNewTarget.threads.find((thread) => thread.run_ids.includes(newTargetRun.run_id));
  assert.ok(newThread);
  assert.notEqual(newThread.id, firstThread.id);

  const threadCountBeforeChat = afterNewTarget.threads.length;
  const chatOnlyRun = await store.sendDeterministicChat({
    room_id: created.room.id,
    conversation_id: created.room.conversation_id,
    message: '只是聊聊今天状态，不要创建任务',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'current_project',
  });
  const afterChatOnly = store.listPersonaMessenger();
  assert.equal(afterChatOnly.threads.length, threadCountBeforeChat);
  const chatOnlyDecision = afterChatOnly.recent_routing_decisions.find((item) => item.run_id === chatOnlyRun.run_id);
  assert.equal(chatOnlyDecision?.thread_action.type, 'none');

  const updated = store.updateProjectPersona({
    persona_id: created.persona.id,
    base_version: created.persona.version,
    display_name: 'Mira Ops',
    avatar: 'avatar://mira-ops',
    tagline: '约束先行的项目推进者',
    self_intro: '我会把目标、风险和验证路径拆清楚再推进。',
    traits: { directness: 0.91, risk_sensitivity: 0.87 },
    change_reason: 'Make ownership clearer in the room list',
  });
  assert.equal(updated.display_name, 'Mira Ops');
  assert.equal(updated.avatar, 'avatar://mira-ops');
  assert.equal(updated.self_intro, '我会把目标、风险和验证路径拆清楚再推进。');
  assert.equal(updated.traits.directness, 0.91);
  assert.equal(updated.version, 2);

  assert.throws(() => store.updateProjectPersona({
    persona_id: created.persona.id,
    base_version: 1,
    display_name: 'Stale Mira',
    change_reason: 'stale update',
  }), /version conflict/);

  const updatedAgain = store.updateProjectPersona({
    persona_id: created.persona.id,
    base_version: updated.version,
    display_name: 'Mira Strategy',
    change_reason: 'Test rollback target',
  });
  assert.equal(updatedAgain.version, 3);

  const rolledBack = store.rollbackProjectPersona({
    persona_id: created.persona.id,
    target_version: 2,
    change_reason: 'Restore prior identity',
  });
  assert.equal(rolledBack.display_name, 'Mira Ops');
  assert.equal(rolledBack.version, 4);

  const hubMention = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: `${rolledBack.handle} 帮我整理 Apollo 移动端状态`,
    mentions: [rolledBack.id],
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  assert.equal(hubMention.selected_agent_id, rolledBack.id);
  const mentionDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === hubMention.run_id);
  assert.ok(mentionDecision);
  assert.equal(mentionDecision.speaker_persona_id, rolledBack.id);
  assert.equal(mentionDecision.owner_project_id, created.project.id);
  assert.ok(mentionDecision.reason_codes.includes('EXPLICIT_MENTION'));

  const roomScope = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: '随手聊一个不归项目的临时问题',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'room_scope',
  });
  const roomScopeDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === roomScope.run_id);
  assert.ok(roomScopeDecision);
  assert.equal(roomScopeDecision.execution_scope, 'room_scope');
  assert.equal(roomScopeDecision.owner_project_id, undefined);
  assert.ok(roomScopeDecision.reason_codes.includes('ROOM_SCOPE_OVERRIDE'));

  store['exec'](`UPDATE personas SET status='dormant', updated_at=datetime('now') WHERE id=?`, duplicateDisplay.persona.id);
  store['exec'](`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id='room_private_hub'`, duplicateDisplay.persona.id);
  const dormantOrdinary = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: '随便聊聊今天的状态',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const dormantOrdinaryDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === dormantOrdinary.run_id);
  assert.ok(dormantOrdinaryDecision);
  assert.notEqual(dormantOrdinaryDecision.speaker_persona_id, duplicateDisplay.persona.id);
  assert.equal(dormantOrdinaryDecision.reason_codes.includes('FLOOR_CONTINUITY'), false);

  const dormantWake = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: 'Apollo Web 项目现在需要继续推进',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const dormantWakeDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === dormantWake.run_id);
  assert.ok(dormantWakeDecision);
  assert.equal(dormantWakeDecision.speaker_persona_id, duplicateDisplay.persona.id);
  assert.equal(dormantWakeDecision.owner_project_id, duplicateDisplay.project.id);
  assert.ok(dormantWakeDecision.reason_codes.includes('PROJECT_ENTITY_MATCH'));
  assert.ok(dormantWakeDecision.reason_codes.includes('DORMANT_PERSONA_WOKEN'));
  assert.equal(store['get'](`SELECT status FROM personas WHERE id=?`, duplicateDisplay.persona.id).status, 'active');

  store['exec'](
    `UPDATE projects SET status='archived', archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    duplicateDisplay.project.id,
  );
  const archivedProjectRoute = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: 'Apollo Web 项目现在继续推进',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const archivedProjectDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === archivedProjectRoute.run_id);
  assert.ok(archivedProjectDecision);
  assert.notEqual(archivedProjectDecision.speaker_persona_id, duplicateDisplay.persona.id);
  assert.notEqual(archivedProjectDecision.owner_project_id, duplicateDisplay.project.id);
  assert.ok(archivedProjectDecision.reason_codes.includes('ARCHIVED_PROJECT_EXCLUDED'));

  store['exec'](
    `UPDATE projects SET status='active', archived_at=NULL, updated_at=datetime('now') WHERE id=?`,
    duplicateDisplay.project.id,
  );
  const afterReactivate = store.listPersonaMessenger();
  assert.ok(afterReactivate.rooms.some((room) => room.id === duplicateDisplay.room.id && room.project_id === duplicateDisplay.project.id));
  assert.ok(afterReactivate.threads.some((thread) => thread.project_id === duplicateDisplay.project.id && thread.run_ids.includes(dormantWake.run_id)));

  const crossProjectRun = await store.sendDeterministicChat({
    room_id: created.room.id,
    conversation_id: created.room.conversation_id,
    message: '继续首页重构，同时参考 Apollo Web 的权限策略',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'current_project',
  });
  const afterCrossProject = store.listPersonaMessenger();
  const crossProjectDecision = afterCrossProject.recent_routing_decisions.find((item) => item.run_id === crossProjectRun.run_id);
  assert.ok(crossProjectDecision);
  assert.equal(crossProjectDecision.speaker_persona_id, rolledBack.id);
  assert.equal(crossProjectDecision.executor_persona_id, rolledBack.id);
  assert.equal(crossProjectDecision.owner_project_id, created.project.id);
  assert.deepEqual(crossProjectDecision.collaborator_project_ids, [duplicateDisplay.project.id]);
  assert.equal(crossProjectDecision.execution_scope, 'cross_project');
  assert.ok(crossProjectDecision.reason_codes.includes('CROSS_PROJECT_REFERENCE'));
  assert.ok(crossProjectDecision.reason_codes.includes('COLLABORATOR_PERSONA_INVITED'));
  const crossProjectThread = afterCrossProject.threads.find((thread) => thread.run_ids.includes(crossProjectRun.run_id));
  assert.ok(crossProjectThread);
  assert.equal(crossProjectThread.project_id, created.project.id);
  assert.ok(crossProjectThread.collaborator_persona_ids.includes(duplicateDisplay.persona.id));

  const hubTaskRun = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: `${rolledBack.handle} 整理 Apollo Mobile 发布计划`,
    mentions: [rolledBack.id],
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const hubTaskThread = store.listPersonaMessenger().threads.find((thread) => thread.run_ids.includes(hubTaskRun.run_id));
  assert.ok(hubTaskThread);
  assert.equal(hubTaskThread.owner_persona_id, rolledBack.id);
  store['exec'](`UPDATE rooms SET floor_holder_persona_id=NULL, updated_at=datetime('now') WHERE id='room_private_hub'`);
  const activeThreadContinuation = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: '继续这个任务，补充测试清单',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const activeThreadDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === activeThreadContinuation.run_id);
  assert.ok(activeThreadDecision);
  assert.equal(activeThreadDecision.speaker_persona_id, rolledBack.id);
  assert.ok(activeThreadDecision.reason_codes.includes('ACTIVE_THREAD_CONTINUITY'));

  store['exec'](`UPDATE rooms SET floor_holder_persona_id=?, updated_at=datetime('now') WHERE id='room_private_hub'`, duplicateDisplay.persona.id);
  const topicSwitch = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: 'Apollo Mobile 项目需要另起一个部署检查',
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const topicSwitchDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === topicSwitch.run_id);
  assert.ok(topicSwitchDecision);
  assert.equal(topicSwitchDecision.speaker_persona_id, rolledBack.id);
  assert.ok(topicSwitchDecision.reason_codes.includes('PROJECT_ENTITY_MATCH'));
  assert.equal(topicSwitchDecision.reason_codes.includes('FLOOR_CONTINUITY'), false);

  const sideEffectDedup = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: `${rolledBack.handle} ${duplicateDisplay.persona.handle} 只能一个人执行发布检查`,
    input_mode: 'serious_task',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
    permission_profile: 'workspace_write',
  });
  const sideEffectDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === sideEffectDedup.run_id);
  assert.ok(sideEffectDecision);
  assert.ok([rolledBack.id, duplicateDisplay.persona.id].includes(sideEffectDecision.speaker_persona_id));
  assert.equal(store['all'](`SELECT id FROM routing_decisions WHERE run_id=?`, sideEffectDedup.run_id).length, 1);
  assert.equal(store['all'](`SELECT id FROM product_tasks WHERE source_run_id=?`, sideEffectDedup.run_id).length, 1);

  store.recordRoutingFeedback({
    routing_decision_id: sideEffectDecision.id,
    room_id: 'room_private_hub',
    run_id: sideEffectDedup.run_id,
    action: 'reroute',
    target_persona_id: duplicateDisplay.persona.id,
    comment: 'prefer Apollo Web owner for release checks',
  });
  const rerouteLock = store.listPersonaMessenger().route_locks.find((lock) => lock.room_id === 'room_private_hub' && lock.user_id === 'desktop_user');
  assert.equal(rerouteLock?.persona_id, duplicateDisplay.persona.id);
  const reroutedFollowup = await store.sendDeterministicChat({
    room_id: 'room_private_hub',
    conversation_id: 'conv_private_hub',
    message: '继续刚才的发布检查',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const reroutedDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === reroutedFollowup.run_id);
  assert.ok(reroutedDecision);
  assert.equal(reroutedDecision.speaker_persona_id, duplicateDisplay.persona.id);
  assert.ok(reroutedDecision.reason_codes.includes('ROUTE_LOCK_ACTIVE'));

  const shared = store.createSharedRoom({
    title: 'Apollo Design Review',
    persona_ids: [rolledBack.id],
    human_members: [
      {
        display_name: '小王',
        external_user_id: 'human_wang',
        role: 'human_member',
        profile: '产品设计',
        visible_project_ids: [created.project.id],
        can_approve_high_risk: true,
      },
      {
        display_name: '访客李',
        external_user_id: 'guest_li',
        role: 'guest',
        profile: '外部评审',
        visible_project_ids: [],
      },
    ],
    ai_participation: 'moderate',
    visible_project_ids: [created.project.id],
    permission_summary: '只共享 Apollo Mobile 的房间上下文',
  }).room;
  assert.equal(shared.type, 'shared');
  assert.ok(shared.members.some((member) => member.type === 'human' && member.id === 'human_wang'));
  assert.ok(shared.members.some((member) => member.type === 'persona' && member.persona_id === rolledBack.id));
  assert.equal(shared.permission_audit.multi_human_ai_throttle, true);
  const privateHub = store.listPersonaMessenger().rooms.find((room) => room.type === 'private_hub');
  assert.equal(privateHub.members.some((member) => member.type === 'human' && member.id === 'human_wang'), false);

  const humanAudit = store.evaluateRoomPermissions({ room_id: shared.id, actor_id: 'human_wang', project_id: created.project.id });
  assert.deepEqual(humanAudit.authorized_project_ids, [created.project.id]);
  assert.equal(humanAudit.can_approve_high_risk, true);
  assert.equal(humanAudit.denied_project_ids.length, 0);

  const guestAudit = store.evaluateRoomPermissions({ room_id: shared.id, actor_id: 'guest_li', project_id: created.project.id });
  assert.equal(guestAudit.can_approve_high_risk, false);
  assert.deepEqual(guestAudit.denied_project_ids, [created.project.id]);

  const otherPersonaDeny = store.evaluateRoomPermissions({
    room_id: created.room.id,
    actor_id: duplicateDisplay.persona.id,
    actor_type: 'persona',
    persona_id: duplicateDisplay.persona.id,
    project_id: created.project.id,
  });
  assert.equal(otherPersonaDeny.can_read_private_persona_dm, false);
  assert.equal(otherPersonaDeny.can_read_room_history, false);

  assert.throws(() => store.updateProjectPersona({
    persona_id: rolledBack.id,
    actor_id: 'human_wang',
    actor_role: 'room_owner',
    room_id: shared.id,
    display_name: 'Unauthorized Mira',
    change_reason: 'room owner without project permission',
  }), /Room Owner cannot modify core Persona/);

  const throttled = await store.sendDeterministicChat({
    room_id: shared.id,
    conversation_id: shared.conversation_id,
    message: '我们继续看视觉细节',
    input_mode: 'chat_assist',
    runtime_mode: 'tool_calling',
    scope_override: 'auto_route',
  });
  const throttleDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === throttled.run_id);
  assert.ok(throttleDecision);
  assert.equal(throttleDecision.speaker_persona_id, undefined);
  assert.equal(throttleDecision.execution_scope, 'room_scope');
  assert.ok(throttleDecision.reason_codes.includes('MULTI_HUMAN_MODERATE_AI_THROTTLE'));

  const highRiskAmbiguous = await store.sendDeterministicChat({
    room_id: shared.id,
    conversation_id: shared.conversation_id,
    message: '请先判断这个高风险请求应由谁处理',
    input_mode: 'serious_task',
    runtime_mode: 'deterministic',
    scope_override: 'auto_route',
    permission_profile: 'danger_full_access',
  });
  const highRiskDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.run_id === highRiskAmbiguous.run_id);
  assert.ok(highRiskDecision);
  assert.equal(highRiskDecision.requires_confirmation, true);
  assert.equal(highRiskDecision.risk, 'high');
  assert.ok(highRiskDecision.reason_codes.includes('MULTI_HUMAN_MODERATE_AI_THROTTLE'));
  assert.ok(highRiskDecision.reason_codes.includes('RISK_HIGH'));
  const routeConfirmation = store['get'](
    `SELECT risk_level, input FROM confirmation_requests WHERE run_id=? AND requested_action='确认消息归属与执行范围' AND status='pending'`,
    highRiskAmbiguous.run_id,
  );
  assert.ok(routeConfirmation);
  assert.equal(routeConfirmation.risk_level, 'high');
  assert.equal(JSON.parse(routeConfirmation.input).room_id, shared.id);

  const external = store.connectExternalMirrorRoom({
    room_id: shared.id,
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    persona_ids: [rolledBack.id],
  });
  assert.equal(external.connector.room_id, shared.id);
  assert.deepEqual(external.connector.visible_persona_ids, [rolledBack.id]);

  const previewExternal = store.previewExternalPersonaMessage({
    room_id: shared.id,
    persona_id: rolledBack.id,
    text: '首页 PRD 已完成。',
  });
  assert.match(previewExternal.text, /Mira Ops · Apollo Mobile ◇/);
  assert.ok(previewExternal.controls.some((item) => item.includes('锁定')));

  const outboundExternal = store.recordExternalConnectorOutbound({
    connector_id: external.connector.id,
    external_message_id: 'tg_out_mira_1',
    persona_id: rolledBack.id,
    text: previewExternal.text,
  });
  assert.equal(outboundExternal.duplicate, false);
  assert.equal(outboundExternal.event.metadata.persona_id, rolledBack.id);
  assert.equal(outboundExternal.message_id.startsWith('msg_'), true);

  const duplicateOutbound = store.recordExternalConnectorOutbound({
    connector_id: external.connector.id,
    external_message_id: 'tg_out_mira_1',
    persona_id: rolledBack.id,
    text: previewExternal.text,
  });
  assert.equal(duplicateOutbound.duplicate, true);
  assert.equal(duplicateOutbound.message_id, outboundExternal.message_id);
  assert.equal(store['get'](`SELECT COUNT(*) AS count FROM external_connector_events WHERE connector_id=? AND external_event_id='tg_out_mira_1'`, external.connector.id).count, 1);

  const replyInbound = store.recordExternalConnectorInbound({
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    external_event_id: 'evt_reply_to_mira',
    external_user_id: 'tg_user_1',
    reply_to_external_message_id: 'tg_out_mira_1',
    text: '收到，继续给 Mira',
  });
  assert.equal(replyInbound.duplicate, false);
  assert.equal(replyInbound.event.metadata.reply_target_persona_id, rolledBack.id);
  assert.equal(replyInbound.event.metadata.reply_to_message_id, outboundExternal.message_id);
  const replyDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.message_id === replyInbound.message_id);
  assert.ok(replyDecision);
  assert.equal(replyDecision.speaker_persona_id, rolledBack.id);
  assert.equal(replyDecision.executor_persona_id, rolledBack.id);
  assert.ok(replyDecision.reason_codes.includes('EXTERNAL_REPLY_TO_PERSONA'));

  const visibleMention = store.recordExternalConnectorInbound({
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    external_event_id: 'evt_visible_mention',
    external_user_id: 'tg_user_1',
    text: `${rolledBack.handle} 请继续同步状态`,
  });
  assert.equal(visibleMention.duplicate, false);
  assert.equal(visibleMention.event.metadata.mentioned_persona_id, rolledBack.id);
  const visibleMentionDecision = store.listPersonaMessenger().recent_routing_decisions.find((item) => item.message_id === visibleMention.message_id);
  assert.ok(visibleMentionDecision);
  assert.equal(visibleMentionDecision.speaker_persona_id, rolledBack.id);
  assert.ok(visibleMentionDecision.reason_codes.includes('EXTERNAL_MENTION'));

  const hiddenMention = store.recordExternalConnectorInbound({
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    external_event_id: 'evt_hidden',
    external_user_id: 'tg_user_1',
    text: `${duplicateDisplay.persona.handle} 不应被这个外部群唤醒`,
  });
  assert.equal(hiddenMention.duplicate, false);
  assert.equal(hiddenMention.event.metadata.mentioned_persona_id, '');

  const lockInbound = store.recordExternalConnectorInbound({
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    external_event_id: 'evt_lock',
    external_user_id: 'tg_user_1',
    text: `/lock ${rolledBack.handle.replace(/^@/, '')}`,
  });
  assert.equal(lockInbound.event.status, 'received');
  const externalLock = store.listPersonaMessenger().route_locks.find((lock) => lock.room_id === shared.id && lock.user_id === 'external:telegram:tg_user_1');
  assert.equal(externalLock?.persona_id, rolledBack.id);

  const duplicateInbound = store.recordExternalConnectorInbound({
    provider: 'telegram',
    external_room_id: 'tg_design_review',
    external_event_id: 'evt_lock',
    external_user_id: 'tg_user_1',
    text: `/lock ${rolledBack.handle.replace(/^@/, '')}`,
  });
  assert.equal(duplicateInbound.duplicate, true);
  assert.equal(store['get'](`SELECT COUNT(*) AS count FROM external_connector_events WHERE external_event_id='evt_lock'`).count, 1);

  const failedExternal = store.recordExternalConnectorFailure({
    connector_id: external.connector.id,
    external_event_id: 'evt_send_fail',
    error: 'telegram send failed',
    retryable: true,
  }).event;
  assert.equal(failedExternal.status, 'send_failed');
  assert.equal(failedExternal.retry_count, 1);
  const retriedExternal = store.retryExternalConnectorEvent({
    event_id: failedExternal.id,
    reason: 'manual retry smoke',
  }).event;
  assert.equal(retriedExternal.status, 'retry_scheduled');
  assert.equal(retriedExternal.retry_count, 2);
  assert.equal(Boolean(retriedExternal.metadata.retryable), true);

  store['exec'](
    `INSERT INTO runs (id, conversation_id, status, selected_agent_id, route_result, terminal_status, created_at, started_at, metadata)
     VALUES ('run_shared_high_risk', ?, 'waiting_confirmation', ?, '{}', 'waiting_confirmation', datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), '{}')`,
    shared.conversation_id,
    rolledBack.id,
  );
  store['exec'](
    `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input, created_at)
     VALUES ('conf_high_guest', 'run_shared_high_risk', NULL, '发送外部消息', 'high', 'pending', '{}', datetime('now', '-29 minutes'))`,
  );
  assert.throws(() => store.decideConfirmation({ id: 'conf_high_guest', approve: true, actor: 'guest_li' }), /requires a permitted approver/);
  store['exec'](
    `INSERT INTO confirmation_requests (id, run_id, capability_id, requested_action, risk_level, status, input, created_at)
     VALUES ('conf_high_allowed', 'run_shared_high_risk', NULL, '发送外部消息', 'high', 'pending', '{}', datetime('now', '-28 minutes'))`,
  );
  store.decideConfirmation({ id: 'conf_high_allowed', approve: true, actor: 'human_wang' });
  assert.equal(store['get'](`SELECT status, approved_by FROM confirmation_requests WHERE id='conf_high_allowed'`).status, 'approved');

  const idleCheckpoint = store.createProjectPersona({
    project_name: 'Apollo Backlog',
    persona_choice: { display_name: 'Nia' },
  });
  store['exec'](
    `UPDATE projects SET created_at=datetime('now', '-2 days'), updated_at=datetime('now', '-2 days') WHERE id=?`,
    idleCheckpoint.project.id,
  );
  store['exec'](
    `INSERT INTO runs (id, conversation_id, status, selected_agent_id, route_result, terminal_status, terminal_reason, created_at, started_at, finished_at, metadata)
     VALUES ('run_checkpoint_done', ?, 'completed', ?, '{}', 'completed', 'checkpoint completion smoke', datetime('now', '-1 hour'), datetime('now', '-1 hour'), datetime('now', '-55 minutes'), '{}')`,
    created.room.conversation_id,
    rolledBack.id,
  );
  store['exec'](
    `INSERT INTO model_calls (id, run_id, agent_id, provider, model_name, input_tokens, output_tokens, cached_input_tokens, total_tokens, cost_estimate, latency_ms, status, raw_response, metadata, created_at)
     VALUES ('mc_checkpoint_done', 'run_checkpoint_done', ?, 'openai_compatible', 'grok-4.3', 100, 40, 10, 140, 0.002, 730, 'succeeded', '{}', '{}', datetime('now', '-54 minutes'))`,
    rolledBack.id,
  );
  store['exec'](
    `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, risk_level, status, input, output, started_at, finished_at, duration_ms, side_effect_level, output_summary)
     VALUES ('tool_checkpoint_done', 'run_checkpoint_done', 'workspace_search', 'workspace_search', 'workspace_search', 'read_only', 'succeeded', '{}', '{}', datetime('now', '-53 minutes'), datetime('now', '-52 minutes'), 610, 'none', 'searched workspace')`,
  );
  store['exec'](
    `INSERT INTO runs (id, conversation_id, status, selected_agent_id, route_result, terminal_status, terminal_reason, error_message, created_at, started_at, finished_at, metadata)
     VALUES ('run_checkpoint_failed', ?, 'failed', ?, '{}', 'failed', 'checkpoint failure smoke', 'tool failed', datetime('now', '-50 minutes'), datetime('now', '-50 minutes'), datetime('now', '-45 minutes'), '{}')`,
    created.room.conversation_id,
    rolledBack.id,
  );
  store['exec'](
    `INSERT INTO tool_runs (id, run_id, capability_id, workflow_name, tool_name, risk_level, status, input, output, error, started_at, finished_at, duration_ms, side_effect_level, error_message)
     VALUES ('tool_checkpoint_failed', 'run_checkpoint_failed', NULL, 'send_email', 'send_email', 'high', 'failed', '{}', '{}', 'smtp failed', datetime('now', '-49 minutes'), datetime('now', '-48 minutes'), 820, 'external_write', 'smtp failed')`,
  );
  store['exec'](
    `INSERT INTO confirmation_requests (id, run_id, requested_action, risk_level, status, input, created_at)
     VALUES ('conf_checkpoint_pending', 'run_checkpoint_failed', '发送外部消息', 'high', 'pending', '{}', datetime('now', '-40 minutes'))`,
  );
  store['exec'](
    `INSERT INTO artifacts (id, type, title, content, source_run_id, source_conversation_id, status, created_at, updated_at)
     VALUES ('art_checkpoint_prd', 'document', 'Apollo PRD', 'checkpoint artifact smoke', 'run_checkpoint_done', ?, 'active', datetime('now', '-35 minutes'), datetime('now', '-35 minutes'))`,
    created.room.conversation_id,
  );

  const checkpointBefore = store.listPersonaMessenger().checkpoint;
  assert.ok(checkpointBefore.completed_count >= 1);
  assert.ok(checkpointBefore.failed_count >= 1);
  assert.ok(checkpointBefore.pending_approval_count >= 1);
  assert.ok(checkpointBefore.new_artifact_count >= 1);
  assert.ok(checkpointBefore.external_unhandled_count >= 1);
  assert.ok(checkpointBefore.no_progress_project_count >= 1);
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'completed'));
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'failed'));
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'approval_required'));
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'artifact_created'));
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'external_unhandled'));
  assert.ok(checkpointBefore.items.some((item) => item.kind === 'no_progress_project'));

  const audit = store.listRunTraceSpans({ limit: 200 });
  assert.ok(audit.spans.some((span) => span.span_type === 'model_span' && span.model_name === 'grok-4.3'));
  assert.ok(audit.spans.some((span) => span.span_type === 'tool_span' && span.tool_name === 'workspace_search'));
  assert.ok(audit.spans.some((span) => span.span_type === 'tool_span' && span.has_external_side_effect && span.has_error));
  assert.ok(audit.summary.model_count >= 1);
  assert.ok(audit.summary.tool_count >= 2);
  assert.ok(audit.summary.error_count >= 1);
  assert.equal(store.listRunTraceSpans({ persona_id: rolledBack.id, model_name: 'grok-4.3', span_type: 'model_span' }).spans.length, 1);
  assert.equal(store.listRunTraceSpans({ project_id: created.project.id, span_type: 'tool_span', has_external_side_effect: true }).spans.length, 1);

  store.recordRoutingFeedback({
    routing_decision_id: decision.id,
    room_id: created.room.id,
    run_id: response.run_id,
    action: 'confirm',
    comment: 'correct route',
  });
  assert.equal(store['get'](`SELECT COUNT(*) AS count FROM routing_feedback WHERE action='confirm'`).count, 1);
  assert.equal(store['get'](`SELECT COUNT(*) AS count FROM routing_feedback WHERE action='reroute'`).count, 1);

  store.setRouteLock({ room_id: created.room.id, action: 'unlock' });
  assert.equal(store.listPersonaMessenger().route_locks.some((lock) => lock.room_id === created.room.id), false);

  const checkpoint = store.completeCheckpoint();
  assert.ok(checkpoint.checked_at);
  assert.equal(checkpoint.completed_count, 0);
  assert.equal(checkpoint.failed_count, 0);
  assert.ok(checkpoint.pending_approval_count >= 2);
  assert.equal(checkpoint.new_artifact_count, 0);
  assert.equal(checkpoint.external_unhandled_count, 0);
  assert.equal(checkpoint.no_progress_project_count, 0);

  console.log('persona messenger store tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
