declare module '@earendil-works/pi-coding-agent' {
  export function getAgentDir(): string;

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
}
