export type ChatRequest = {
  conversation_id?: string;
  channel?: string;
  user_id?: string;
  message: string;
  preferred_node?: string;
  allow_worker?: boolean;
};

export type ChatResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  model_calls?: ModelCall[];
};

export type ModelCall = {
  id: string;
  provider: string;
  model_name: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  latency_ms: number;
  metadata?: Record<string, unknown>;
};

export type RunTrace = {
  id: string;
  status: string;
  selected_agent_id: string;
  model_calls?: ModelCall[];
  prompt_assemblies?: Array<{ id: string; prefix_hash: string; dynamic_tail_hash: string; prompt_cache_key: string }>;
  memory_context_packs?: Array<{ id: string; memory_profile_version: string }>;
  steps?: Array<{ id: string; step_type: string; title: string; status: string }>;
};

export type SystemHealth = {
  service_status?: Record<string, unknown>;
  queue_status?: Record<string, unknown>;
  worker_status?: unknown[];
  warnings?: unknown[];
};

type DesktopBindings = {
  SendChat(req: ChatRequest): Promise<ChatResponse>;
  GetRunTrace(runID: string): Promise<RunTrace>;
  GetSystemHealth(): Promise<SystemHealth>;
};

declare global {
  interface Window {
    go?: {
      main?: {
        DesktopApp?: DesktopBindings;
      };
    };
  }
}

function bindings(): DesktopBindings {
  const desktop = window.go?.main?.DesktopApp;
  if (!desktop) {
    return {
      async SendChat(req) {
        const runID = `run_preview_${Date.now()}`;
        return {
          conversation_id: 'conv_preview',
          user_message_id: 'msg_preview_user',
          assistant_message_id: 'msg_preview_assistant',
          run_id: runID,
          selected_agent_id: 'general_agent',
          response: `Preview mode: ${req.message}`,
          model_calls: [],
        };
      },
      async GetRunTrace(runID) {
        return {
          id: runID,
          status: 'preview',
          selected_agent_id: 'general_agent',
          steps: [
            { id: 'step_preview_1', step_type: 'input_received', title: 'Input received', status: 'succeeded' },
            { id: 'step_preview_2', step_type: 'response_generated', title: 'Response generated', status: 'succeeded' },
          ],
        };
      },
      async GetSystemHealth() {
        return {
          service_status: { sqlite: true, orchestrator: 'preview' },
          queue_status: { active_tasks: 0 },
          worker_status: [],
          warnings: [],
        };
      },
    };
  }
  return desktop;
}

export const desktopApi = {
  sendChat: (req: ChatRequest) => bindings().SendChat(req),
  getRunTrace: (runID: string) => bindings().GetRunTrace(runID),
  getSystemHealth: () => bindings().GetSystemHealth(),
};
