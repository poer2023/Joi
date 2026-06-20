import type { InputMode } from '../../api/desktop';

export type ChatInputMode = InputMode;

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | string;
  content: string;
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
  | 'skipped'
  | 'blocked';

export type NormalizedRunEvent = {
  id: string;
  runId: string;
  seq: number;
  type: string;
  itemId: string;
  itemType: string;
  status: NormalizedStatus;
  parentItemId?: string;
  title?: string;
  summary?: string;
  snapshot: Record<string, unknown>;
  delta: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
  raw: Record<string, unknown>;
};

export type ConversationRenderItem =
  | ChatMessageRenderItem
  | InlineStatusRenderItem
  | CompactRunCardRenderItem
  | TaskEntryRenderItem
  | ApprovalRenderItem
  | ArtifactRenderItem;

export type ChatMessageRenderItem = {
  type: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  streaming?: boolean;
  createdAt?: string;
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
