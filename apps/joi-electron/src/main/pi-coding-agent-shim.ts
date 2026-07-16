import { homedir } from 'node:os';
import { join } from 'node:path';

// pi-computer-use imports this one runtime helper from Pi. Joi keeps the
// computer-use implementation intact while providing the same agent directory
// contract without pulling Pi's complete coding-agent runtime into the app.
export function getAgentDir(): string {
  return process.env.PI_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent');
}

export type AgentToolResult<T = unknown> = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | Record<string, unknown>
  >;
  details: T;
};

export type AgentToolUpdateCallback<T = unknown> = (update: AgentToolResult<T>) => void;

export type ExtensionContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify(message: string, level?: string): void;
    select(title: string, options: string[], config?: { signal?: AbortSignal }): Promise<string | undefined>;
  };
  sessionManager: { getBranch(): unknown[] };
};
