import assert from 'node:assert/strict';
import {
  executeMemoryRecallCapability,
  executeMemoryWriteCandidateCapability,
  executeProjectListCapability,
  executeSessionBranchCapability,
  executeSessionCompactCapability,
  executeSessionSearchCapability,
  executeSessionSummaryCapability,
  executeSkillsListCapability,
  executeSkillViewCapability,
  executeTaskListCapability,
  executeTaskUpdateCapability,
  executeTaskViewCapability,
  executeToolSearchCapability,
} from '../src/main/local-agent-capabilities.ts';
import {
  executeShellKillCapability,
  executeShellOutputCapability,
  executeShellStartCapability,
  executeShellWriteCapability,
} from '../src/main/terminal-capabilities.ts';

const conversation = {
  id: 'conv_fixture',
  channel: 'desktop',
  user_id: 'desktop_user',
  title: 'Capability fixture',
  lifecycle_status: 'active',
  last_message: 'The local capability needle is here.',
  last_role: 'assistant',
  message_count: 2,
  updated_at: '2026-07-16T00:00:00Z',
};
const messages = [
  { id: 'msg_user', conversation_id: conversation.id, role: 'user', content: 'Find the capability needle.' },
  { id: 'msg_assistant', conversation_id: conversation.id, role: 'assistant', content: 'The local capability needle is here.' },
];
const task = { id: 'task_fixture', title: 'Fixture task', description: 'Test task', status: 'running', mode: 'serious_task', priority: 'normal', risk_level: 'read_only', progress_percent: 50 };
let taskStatus = task.status;

const store = {
  recallMemoriesForTool() {
    return {
      memories: [{
        memory: { id: 'mem_fixture', type: 'note', summary: 'Fixture memory', content: 'Scoped memory needle', scope_type: 'project', scope_id: 'prj_fixture', confidence: 0.8, pinned: false },
        score: 1.2,
        reason: 'fixture match',
        matched_terms: ['needle'],
      }],
      scope: { room_id: 'room_fixture', project_ids: ['prj_fixture'], user_ids: ['desktop_user'], scope_override: 'current_project', cross_project: false },
    };
  },
  createMemoryCandidateForTool(_req, input) {
    return { candidate: { id: 'mem_candidate', type: input.type || 'note', content: input.content, summary: input.summary || 'Candidate', scope_type: 'project', scope_id: 'prj_fixture', status: 'pending' }, deduped: false };
  },
  listConversations(filter) {
    return { conversations: filter.query === 'missing' ? [] : [conversation] };
  },
  getConversation(id) {
    if (id !== conversation.id) throw new Error('Conversation not found');
    return { conversation, messages };
  },
  branchConversationForTool(input) {
    return {
      source_conversation_id: input.source_conversation_id,
      child_conversation_id: 'conv_branch_fixture',
      from_message_id: input.from_message_id || 'msg_assistant',
      copied_message_count: 2,
      source_message_count: 2,
      source_unchanged: true,
    };
  },
  compactConversationForTool(input) {
    return {
      compaction_id: 'compact_fixture',
      conversation_id: input.conversation_id,
      summary: input.summary,
      first_kept_message_id: 'msg_assistant',
      covered_message_count: 1,
      original_message_count: 2,
      original_char_count: 200,
      compacted_context_char_count: 80,
      transcript_preserved: true,
    };
  },
  listSkills() {
    return { skills: [{ id: 'skill_fixture', version: 'v1', name: 'fixture-skill', description: 'Fixture local skill', trigger_phrases: ['fixture'], required_capabilities: ['file_read'], forbidden_capabilities: [], output_contract: '', enabled: true, metadata: { invocation_name: '$fixture-skill', scope: 'repo' } }] };
  },
  getSkill() {
    return { skill: this.listSkills().skills[0], instructions: 'Read the fixture and return FIXTURE_OK.', frontmatter: { name: 'fixture-skill' }, openai: {} };
  },
  listPersonaMessenger() {
    return {
      projects: [{ id: 'prj_fixture', name: 'Fixture Project', goal: 'Verify capabilities', status: 'active' }],
      personas: [{ id: 'per_fixture', project_id: 'prj_fixture', display_name: 'Fixture', handle: '@fixture', status: 'active' }],
      threads: [],
      rooms: [],
    };
  },
  listCapabilities() {
    return { capabilities: [{ id: 'workspace_search', name: 'Workspace Search', description: '', risk_level: 'read_only', enabled: true }] };
  },
  listMCPServers() {
    return { servers: [{ id: 'fixture_mcp', name: 'Fixture MCP', enabled: true, tools: [{ name: 'lookup', description: 'Fixture MCP lookup', enabled: true }], resources: [], prompts: [], status: 'ready', trust: 'local', transport: 'stdio' }] };
  },
  listProductTasks() {
    return { tasks: [{ ...task, status: taskStatus }] };
  },
  getProductTask() {
    return { task: { ...task, status: taskStatus }, steps: [{ id: 'step_fixture', product_task_id: task.id, title: 'Verify', status: 'running', sort_order: 1 }], deliverables: [] };
  },
  closeProductTask() {
    taskStatus = 'completed';
    return this.getProductTask();
  },
  reopenProductTask() {
    taskStatus = 'running';
    return this.getProductTask();
  },
};

const request = { conversation_id: conversation.id, message: 'fixture', permission_profile: 'danger_full_access' };
assert.equal(executeMemoryRecallCapability({ query: 'needle' }, request, store).memory_count, 1);
assert.equal(executeMemoryWriteCandidateCapability({ content: 'Remember fixture' }, request, store).requires_user_review, true);
assert.equal(executeSessionSearchCapability({ query: 'needle' }, store).sessions[0].id, conversation.id);
assert.equal(executeSessionSummaryCapability({ session_id: conversation.id }, request, store).returned_message_count, 2);
assert.equal(executeSessionBranchCapability({ session_id: conversation.id }, request, store, 'run_parent').child_conversation_id, 'conv_branch_fixture');
const compacted = executeSessionCompactCapability({ session_id: conversation.id, summary: 'Persistent fixture checkpoint.' }, request, store, 'run_parent');
assert.equal(compacted.transcript_preserved, true);
assert.equal(compacted.approximate_context_reduction_percent, 60);
assert.equal(executeSkillsListCapability({ query: 'fixture' }, store).skills[0].name, 'fixture-skill');
assert.match(executeSkillViewCapability({ skill_id: 'fixture-skill' }, store).instructions, /FIXTURE_OK/);
assert.equal(executeProjectListCapability({ query: 'fixture' }, store).projects[0].personas[0].id, 'per_fixture');
assert.equal(executeToolSearchCapability({ query: 'Fixture MCP lookup' }, request, store).results[0].kind, 'mcp_tool');
const multiTermTools = executeToolSearchCapability({ query: 'session memory shell', max_results: 20 }, request, store).results;
assert.ok(multiTermTools.some((item) => item.name === 'session_search'));
assert.ok(multiTermTools.some((item) => item.name === 'memory_recall'));
assert.ok(multiTermTools.some((item) => item.name === 'shell_start'));
assert.equal(new Set(multiTermTools.map((item) => `${item.kind}:${item.name}`)).size, multiTermTools.length);
assert.equal(executeTaskListCapability({}, request, store).tasks[0].id, task.id);
assert.equal(executeTaskViewCapability({ task_id: task.id }, store).steps.length, 1);
assert.equal(executeTaskUpdateCapability({ task_id: task.id, action: 'close' }, store).task.status, 'completed');
assert.equal(executeTaskUpdateCapability({ task_id: task.id, action: 'reopen' }, store).task.status, 'running');

const terminalSessions = new Map();
const terminalManager = {
  start(payload) {
    const session = { id: 'term_fixture', shell: payload.shell || '/bin/zsh', cwd: payload.cwd, status: 'running' };
    terminalSessions.set(session.id, { session, output: '$ ' });
    return session;
  },
  input({ id, data }) {
    const record = terminalSessions.get(id);
    record.output += data;
  },
  kill({ id }) {
    const record = terminalSessions.get(id);
    record.session = { ...record.session, status: 'exited' };
  },
  getStatus(id) {
    return terminalSessions.get(id) || { output: '' };
  },
};

assert.throws(() => executeShellStartCapability({}, terminalManager, '/tmp', 'read_only'), /danger_full_access/);
const started = executeShellStartCapability({}, terminalManager, '/tmp', 'danger_full_access');
assert.equal(started.session.id, 'term_fixture');
assert.equal(executeShellWriteCapability({ session_id: 'term_fixture', data: 'pwd\n' }, terminalManager, 'danger_full_access').status, 'completed');
assert.throws(() => executeShellWriteCapability({ session_id: 'term_fixture', data: 'rm -rf /tmp/unsafe\n' }, terminalManager, 'danger_full_access'), /command_blacklisted/);
assert.match(executeShellOutputCapability({ session_id: 'term_fixture' }, terminalManager).output, /pwd/);
assert.equal(executeShellKillCapability({ session_id: 'term_fixture' }, terminalManager, 'danger_full_access').session.status, 'exited');

console.log('local agent capabilities ok');
