import type { InputMode } from '../../api/desktop';

export type ChatInputMode = InputMode;

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: unknown;
  created_at?: string;
  metadata?: Record<string, unknown>;
  run_id?: string;
};

export type StreamingAssistantMessage = ConversationMessage & {
  role: 'assistant';
  complete?: boolean;
};

export type NormalizedStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'redirected'
  | 'skipped'
  | 'blocked';

export type NormalizedRunEvent = {
  id: string;
  runId: string;
  seq: number;
  type: string;
  schemaVersion: number;
  itemId: string;
  itemType: string;
  status: NormalizedStatus;
  parentItemId?: string;
  visibility?: string;
  source?: string;
  terminal?: boolean;
  title?: string;
  summary?: string;
  snapshot: Record<string, unknown>;
  delta: Record<string, unknown>;
  usage: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
  raw: Record<string, unknown>;
};

export type ConversationRenderItem =
  | ChatMessageRenderItem
  | TranscriptLineRenderItem;

export type ChatMessageRenderItem = {
  type: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  streaming?: boolean;
  createdAt?: string;
};

export type TranscriptLineKind =
  | 'thinking'
  | 'tool'
  | 'task'
  | 'approval'
  | 'artifact'
  | 'run'
  | 'system';

export type TranscriptLineRenderItem = {
  type: 'transcript_line';
  id: string;
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  kind: TranscriptLineKind;
  label: string;
  detail?: string;
  traceAvailable?: boolean;
  startedAt?: string;
  completedAt?: string;
};

export type InlineStatusRenderItem = {
  type: 'inline_status';
  id: string;
  runId: string;
  anchorMessageId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  label: string;
  detail?: string;
  traceAvailable?: boolean;
  startedAt?: string;
  completedAt?: string;
};

export type CompactRunCardRenderItem = {
  type: 'compact_run_card';
  id: string;
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_approval';
  title: string;
  progressLabel?: string;
  steps: CompactRunStep[];
  collapsed: boolean;
  traceAvailable?: boolean;
};

export type CompactRunStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  summary?: string;
  durationMs?: number;
};

export type TaskEntryRenderItem = {
  type: 'task_entry';
  id: string;
  runId: string;
  taskId: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  summary?: string;
};

export type ApprovalRenderItem = {
  type: 'approval';
  id: string;
  runId: string;
  title: string;
  riskLevel: 'read_only' | 'private_content' | 'state_change' | 'dangerous';
  summary?: string;
  status: 'waiting_approval' | 'approved' | 'rejected';
};

export type ArtifactRenderItem = {
  type: 'artifact';
  id: string;
  runId: string;
  artifactId: string;
  title: string;
  artifactType: string;
};

export type MemoryRenderItem = {
  type: 'memory_update';
  id: string;
  runId: string;
  memoryId: string;
  title: string;
  summary?: string;
  status: string;
  previousMemoryId?: string;
};

export type ProactiveRenderItem = {
  type: 'proactive_update';
  id: string;
  runId: string;
  proactiveId?: string;
  openLoopId?: string;
  title: string;
  summary?: string;
  status: string;
  dueAt?: string;
  channel?: string;
};

export type HandoffRenderItem = {
  type: 'handoff_banner';
  id: string;
  runId: string;
  title: string;
  summary?: string;
  status: string;
  channel?: string;
  taskId?: string;
  principalId?: string;
};

export type BuildConversationRenderItemsInput = {
  messages: ConversationMessage[];
  streamingAssistant?: StreamingAssistantMessage | null;
  pendingUserMessage?: ConversationMessage | null;
  runEventsByRunId: Record<string, NormalizedRunEvent[]>;
  activeRunId?: string;
  mode: ChatInputMode;
  debug?: boolean;
};

export type BuildConversationRenderItemsOutput = {
  items: ConversationRenderItem[];
  traceOnlyEventsByRunId: Record<string, NormalizedRunEvent[]>;
  activeRunStatusByRunId: Record<string, NormalizedStatus>;
};
