import type { ChatRequest, ConversationMessage, ConversationSummary } from '../../../../packages/shared-types/src/desktop-api';
import type { JoiSQLiteStore } from '../../../../packages/store/src/sqlite';
import {
  compileElectronCapabilityTools,
  listElectronCapabilityToolDefinitions,
} from '../../../../packages/runtime/src/capability-compiler.ts';

type LocalCapabilityStore = Pick<
  JoiSQLiteStore,
  | 'recallMemoriesForTool'
  | 'createMemoryCandidateForTool'
  | 'listConversations'
  | 'getConversation'
  | 'branchConversationForTool'
  | 'compactConversationForTool'
  | 'listSkills'
  | 'getSkill'
  | 'listPersonaMessenger'
  | 'listCapabilities'
  | 'listMCPServers'
  | 'listProductTasks'
  | 'getProductTask'
  | 'closeProductTask'
  | 'reopenProductTask'
>;

export function executeMemoryRecallCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const query = stringInput(inputs.query);
  const maxResults = boundedInteger(inputs.max_results, 8, 1, 12);
  const recalled = store.recallMemoriesForTool(req, query, maxResults);
  const memories = recalled.memories.map((result) => ({
    id: result.memory.id,
    type: result.memory.type,
    summary: result.memory.summary,
    content: truncateText(result.memory.content, 4_000),
    scope_type: result.memory.scope_type,
    scope_id: result.memory.scope_id,
    confidence: result.memory.confidence,
    pinned: result.memory.pinned,
    updated_at: result.memory.updated_at,
    score: result.score,
    reason: result.reason,
    matched_terms: result.matched_terms || [],
  }));
  return {
    status: 'completed',
    query,
    memory_count: memories.length,
    memories,
    scope: recalled.scope,
    summary: `Recalled ${memories.length} scoped memor${memories.length === 1 ? 'y' : 'ies'}.`,
    mode: 'memory_recall_v1_scoped',
  };
}

export function executeMemoryWriteCandidateCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const result = store.createMemoryCandidateForTool(req, {
    content: stringInput(inputs.content),
    summary: stringInput(inputs.summary),
    type: stringInput(inputs.type),
    scope: stringInput(inputs.scope),
    source: stringInput(inputs.source),
  });
  return {
    status: 'completed',
    candidate: result.candidate,
    deduped: result.deduped,
    requires_user_review: result.candidate.status !== 'confirmed',
    summary: result.deduped
      ? 'An equivalent memory already exists in this scope; no duplicate was created.'
      : 'Created a pending memory candidate for user review.',
    mode: 'memory_write_candidate_v1_review_queue',
  };
}

export function executeSessionSearchCapability(
  inputs: Record<string, unknown>,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const query = stringInput(inputs.query);
  const maxResults = boundedInteger(inputs.max_results, 10, 1, 20);
  const conversations = store.listConversations({ view: 'all', query, limit: maxResults }).conversations;
  const sessions = conversations.map((conversation) => ({
    ...conversationSummaryForTool(conversation),
    match_excerpt: query ? matchingConversationExcerpt(store, conversation.id, query) : truncateText(conversation.last_message || '', 600),
  }));
  return {
    status: 'completed',
    query,
    session_count: sessions.length,
    sessions,
    summary: `Found ${sessions.length} local session${sessions.length === 1 ? '' : 's'}.`,
    mode: 'session_search_v1_sqlite',
  };
}

export function executeSessionSummaryCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const requestedID = stringInput(inputs.session_id) || stringInput(inputs.thread_id) || stringInput(req.conversation_id);
  if (!requestedID) throw new Error('session_summary requires session_id, thread_id, or a current conversation');
  const conversationID = resolveConversationID(requestedID, store);
  const detail = store.getConversation(conversationID);
  const maxMessages = boundedInteger(inputs.max_messages, 20, 1, 50);
  const maxChars = boundedInteger(inputs.max_chars, 30_000, 1_000, 60_000);
  const selected = detail.messages.slice(-maxMessages);
  const messages: Array<Record<string, unknown>> = [];
  let usedChars = 0;
  for (const message of selected) {
    const remaining = maxChars - usedChars;
    if (remaining <= 0) break;
    const content = truncateText(message.content, Math.min(remaining, 6_000));
    usedChars += content.length;
    messages.push(conversationMessageForTool(message, content));
  }
  const omittedCount = Math.max(0, detail.messages.length - messages.length);
  return {
    status: 'completed',
    session: conversationSummaryForTool(detail.conversation),
    messages,
    returned_message_count: messages.length,
    omitted_message_count: omittedCount,
    transcript_truncated: omittedCount > 0 || selected.some((message, index) => message.content.length > String(messages[index]?.content || '').length),
    summary: `Loaded ${messages.length} recent message${messages.length === 1 ? '' : 's'} from ${detail.conversation.title || detail.conversation.id}.`,
    mode: 'session_summary_v1_bounded_context',
  };
}

export function executeSessionBranchCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
  sourceRunID = '',
): Record<string, unknown> {
  const requestedID = stringInput(inputs.session_id) || stringInput(req.conversation_id);
  if (!requestedID) throw new Error('session_branch requires session_id or a current conversation');
  const conversationID = resolveConversationID(requestedID, store);
  const result = store.branchConversationForTool({
    source_conversation_id: conversationID,
    from_message_id: stringInput(inputs.from_message_id),
    title: stringInput(inputs.title),
    source_run_id: sourceRunID,
  });
  return {
    status: 'completed',
    capability: 'session_branch',
    ...result,
    summary: `Created branch ${result.child_conversation_id} with ${result.copied_message_count} copied messages; the source transcript is unchanged.`,
    mode: 'session_branch_v1_persistent_tree',
  };
}

export function executeSessionCompactCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
  sourceRunID = '',
): Record<string, unknown> {
  const requestedID = stringInput(inputs.session_id) || stringInput(req.conversation_id);
  if (!requestedID) throw new Error('session_compact requires session_id or a current conversation');
  const conversationID = resolveConversationID(requestedID, store);
  const result = store.compactConversationForTool({
    conversation_id: conversationID,
    summary: stringInput(inputs.summary),
    keep_recent_messages: boundedInteger(inputs.keep_recent_messages, 6, 2, 12),
    reason: stringInput(inputs.reason),
    source_run_id: sourceRunID,
  });
  const reduction = result.original_char_count > 0
    ? Math.max(0, Math.round((1 - result.compacted_context_char_count / result.original_char_count) * 100))
    : 0;
  return {
    status: 'completed',
    capability: 'session_compact',
    ...result,
    approximate_context_reduction_percent: reduction,
    summary: `Persisted checkpoint ${result.compaction_id}; ${result.covered_message_count} earlier messages remain stored but are replaced by the checkpoint in future prompts.`,
    mode: 'session_compact_v1_persistent_checkpoint',
  };
}

export function executeSkillsListCapability(inputs: Record<string, unknown>, store: LocalCapabilityStore): Record<string, unknown> {
  const query = stringInput(inputs.query).toLowerCase();
  const maxResults = boundedInteger(inputs.max_results, 30, 1, 100);
  const skills = store.listSkills().skills
    .filter((skill) => skill.enabled)
    .filter((skill) => textMatches(query, skill.id, skill.name, skill.description, ...skill.trigger_phrases))
    .slice(0, maxResults)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      invocation_name: stringInput(skill.metadata?.invocation_name) || `$${skill.name}`,
      required_capabilities: skill.required_capabilities,
      scope: skill.metadata?.scope,
    }));
  return {
    status: 'completed',
    query,
    skill_count: skills.length,
    skills,
    summary: `Found ${skills.length} enabled local skill${skills.length === 1 ? '' : 's'}.`,
    mode: 'skills_list_v1_registry',
  };
}

export function executeSkillViewCapability(inputs: Record<string, unknown>, store: LocalCapabilityStore): Record<string, unknown> {
  const requestedID = stringInput(inputs.skill_id);
  if (!requestedID) throw new Error('skill_view skill_id is required');
  const exact = store.listSkills().skills.find((skill) => (
    skill.id === requestedID || skill.name.toLowerCase() === requestedID.toLowerCase()
  ));
  if (!exact) throw new Error(`skill not found: ${requestedID}`);
  const detail = store.getSkill(exact.id);
  const maxChars = boundedInteger(inputs.max_chars, 40_000, 1_000, 80_000);
  const instructions = truncateText(detail.instructions, maxChars);
  return {
    status: 'completed',
    skill: detail.skill,
    instructions,
    instructions_truncated: instructions.length < detail.instructions.length,
    frontmatter: detail.frontmatter,
    openai: detail.openai,
    summary: `Loaded local skill ${detail.skill.name}.`,
    mode: 'skill_view_v1_progressive_disclosure',
  };
}

export function executeProjectListCapability(inputs: Record<string, unknown>, store: LocalCapabilityStore): Record<string, unknown> {
  const query = stringInput(inputs.query).toLowerCase();
  const maxResults = boundedInteger(inputs.max_results, 30, 1, 100);
  const snapshot = store.listPersonaMessenger();
  const projects = snapshot.projects
    .filter((project) => textMatches(query, project.id, project.name, project.goal, project.domain, project.summary, project.status))
    .slice(0, maxResults)
    .map((project) => ({
      id: project.id,
      name: project.name,
      goal: project.goal,
      domain: project.domain,
      phase: project.phase,
      status: project.status,
      summary: project.summary,
      personas: snapshot.personas
        .filter((persona) => persona.project_id === project.id && persona.status !== 'deleted')
        .map((persona) => ({ id: persona.id, name: persona.display_name, handle: persona.handle, status: persona.status })),
      updated_at: project.updated_at,
    }));
  return {
    status: 'completed',
    query,
    project_count: projects.length,
    projects,
    summary: `Found ${projects.length} local project${projects.length === 1 ? '' : 's'}.`,
    mode: 'project_list_v1_persona_messenger',
  };
}

export function executeToolSearchCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const query = stringInput(inputs.query).toLowerCase();
  const maxResults = boundedInteger(inputs.max_results, 40, 1, 100);
  const compiledNames = new Set(compileElectronCapabilityTools(req.permission_profile).map((tool) => tool.name));
  const registryByID = new Map(store.listCapabilities().capabilities.map((capability) => [capability.id, capability]));
  const nativeTools = listElectronCapabilityToolDefinitions()
    .filter((definition) => compiledNames.has(definition.name))
    .filter((definition) => registryByID.get(definition.name)?.enabled !== false)
    .map((definition) => ({
      kind: 'native_capability',
      name: definition.name,
      description: definition.description,
      risk: definition.risk,
      source: 'joi',
    }));
  const mcpTools = store.listMCPServers().servers.flatMap((server) => (
    server.enabled === false ? [] : server.tools
      .filter((tool) => tool.enabled !== false)
      .map((tool) => ({
        kind: 'mcp_tool',
        name: tool.wrapped_as || `${server.id}.${tool.name}`,
        description: tool.description,
        risk: tool.wrapped_as ? registryByID.get(tool.wrapped_as)?.risk_level || 'configured' : 'unwrapped',
        source: server.name || server.id,
      }))
  ));
  const skills = store.listSkills().skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      kind: 'skill',
      name: `$${skill.name}`,
      description: skill.description,
      risk: 'instructions',
      source: stringInput(skill.metadata?.scope) || 'local',
    }));
  const uniqueEntries = Array.from(new Map(
    [...nativeTools, ...mcpTools, ...skills].map((item) => [`${item.kind}:${item.name}`, item]),
  ).values());
  const results = uniqueEntries
    .map((item) => {
      const match = textMatchScore(query, item.kind, item.name, item.description, item.source);
      const nameMatch = textMatchScore(query, item.name);
      return {
        ...item,
        match_score: (match.score * 0.7) + (nameMatch.score * 0.3),
        matched_terms: match.matchedTerms,
        name_matched_terms: nameMatch.matchedTerms,
      };
    })
    .filter((item) => !query || item.match_score > 0)
    .sort((left, right) => (
      right.match_score - left.match_score
      || toolSearchKindPriority(left.kind) - toolSearchKindPriority(right.kind)
      || left.name.localeCompare(right.name)
    ))
    .slice(0, maxResults);
  return {
    status: 'completed',
    query,
    permission_profile: req.permission_profile || 'read_only',
    result_count: results.length,
    results,
    summary: `Found ${results.length} matching local tool or skill entr${results.length === 1 ? 'y' : 'ies'}.`,
    mode: 'tool_search_v1_local_registry',
  };
}

export function executeTaskListCapability(
  inputs: Record<string, unknown>,
  req: ChatRequest,
  store: LocalCapabilityStore,
): Record<string, unknown> {
  const maxResults = boundedInteger(inputs.max_results, 20, 1, 100);
  const tasks = store.listProductTasks({
    status: stringInput(inputs.status),
    conversation_id: stringInput(inputs.conversation_id) || req.conversation_id,
    principal_id: req.principal_id,
    channel: req.channel,
    limit: maxResults,
  }).tasks;
  return {
    status: 'completed',
    task_count: tasks.length,
    tasks,
    summary: `Found ${tasks.length} persisted task${tasks.length === 1 ? '' : 's'}.`,
    mode: 'task_list_v1_product_tasks',
  };
}

export function executeTaskViewCapability(inputs: Record<string, unknown>, store: LocalCapabilityStore): Record<string, unknown> {
  const taskID = stringInput(inputs.task_id);
  if (!taskID) throw new Error('task_view task_id is required');
  const detail = store.getProductTask(taskID);
  return {
    status: 'completed',
    ...detail,
    summary: `Loaded task ${detail.task.title}.`,
    mode: 'task_view_v1_product_tasks',
  };
}

export function executeTaskUpdateCapability(inputs: Record<string, unknown>, store: LocalCapabilityStore): Record<string, unknown> {
  const taskID = stringInput(inputs.task_id);
  const action = stringInput(inputs.action).toLowerCase();
  if (!taskID) throw new Error('task_update task_id is required');
  if (action === 'close') {
    const detail = store.closeProductTask({
      id: taskID,
      outcome: stringInput(inputs.outcome) || 'completed',
      reason: stringInput(inputs.reason) || 'closed through task_update capability',
      actor: 'model_tool_after_confirmation',
    });
    return { status: 'completed', action, ...detail, summary: `Closed task ${detail.task.title}.`, mode: 'task_update_v1_product_tasks' };
  }
  if (action === 'reopen') {
    const detail = store.reopenProductTask({
      id: taskID,
      reason: stringInput(inputs.reason) || 'reopened through task_update capability',
      actor: 'model_tool_after_confirmation',
    });
    return { status: 'completed', action, ...detail, summary: `Reopened task ${detail.task.title}.`, mode: 'task_update_v1_product_tasks' };
  }
  throw new Error(`Unsupported task_update action: ${action || 'empty'}`);
}

function resolveConversationID(requestedID: string, store: LocalCapabilityStore): string {
  try {
    store.getConversation(requestedID);
    return requestedID;
  } catch {
    const snapshot = store.listPersonaMessenger();
    const thread = snapshot.threads.find((item) => item.id === requestedID);
    const room = thread?.room_id ? snapshot.rooms.find((item) => item.id === thread.room_id) : undefined;
    if (room?.conversation_id) return room.conversation_id;
    throw new Error(`Conversation or thread not found: ${requestedID}`);
  }
}

function matchingConversationExcerpt(store: LocalCapabilityStore, conversationID: string, query: string): string {
  const normalized = query.toLowerCase();
  const messages = store.getConversation(conversationID).messages;
  const match = [...messages].reverse().find((message) => message.content.toLowerCase().includes(normalized));
  return truncateText(match?.content || messages.at(-1)?.content || '', 600);
}

function conversationSummaryForTool(conversation: ConversationSummary): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    channel: conversation.channel,
    lifecycle_status: conversation.lifecycle_status,
    active_agent_id: conversation.active_agent_id,
    message_count: conversation.message_count,
    latest_run_id: conversation.latest_run_id,
    last_role: conversation.last_role,
    last_message: truncateText(conversation.last_message || '', 600),
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

function conversationMessageForTool(message: ConversationMessage, content: string): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    content,
    created_at: message.created_at,
  };
}

function textMatches(query: string, ...values: unknown[]): boolean {
  if (!query) return true;
  const haystack = values.map((value) => String(value || '')).join(' ').toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function textMatchScore(query: string, ...values: unknown[]): { score: number; matchedTerms: string[] } {
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { score: 1, matchedTerms: [] };
  const haystack = values.map((value) => String(value || '')).join(' ').toLowerCase();
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  return { score: matchedTerms.length / terms.length, matchedTerms };
}

function toolSearchKindPriority(kind: string): number {
  if (kind === 'native_capability') return 0;
  if (kind === 'mcp_tool') return 1;
  return 2;
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
