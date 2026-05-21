"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details: unknown } | null;
  trace_id: string;
};

type ChatResult = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  run_id: string;
  selected_agent_id: string;
  response: string;
  steps: { id: string; step_type: string; title: string; status: string }[];
};

type RunStep = {
  id: string;
  step_type: string;
  title: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number | null;
};

type RunStepsResult = {
  run_id: string;
  steps: RunStep[];
};

type MemoryContextPackRecord = {
  id: string;
  memory_profile_version: string;
  profile: unknown[];
  project_facts: unknown[];
  relevant_episodes: unknown[];
  heuristics: unknown[];
  anti_patterns: unknown[];
  open_issues: unknown[];
  dynamic_retrieval: unknown[];
};

type ModelCallRecord = {
  id: string;
  provider: string;
  model_name: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  latency_ms: number;
  prompt_cache_key: string;
  error_message: string;
  metadata: Record<string, unknown>;
};

type RunDetail = {
  id: string;
  memory_context_packs: MemoryContextPackRecord[];
  model_calls: ModelCallRecord[];
  tasks: {
    id: string;
    capability_id: string;
    assigned_node_id: string;
    preferred_node_id: string;
    status: string;
    attempts: {
      id: string;
      node_id: string;
      status: string;
      attempt_number: number;
      started_at: string;
      finished_at: string | null;
    }[];
  }[];
};

type SystemHealth = {
  service_status: Record<string, unknown>;
  queue_status: Record<string, unknown>;
  worker_status: { id: string; status: string }[];
  tool_failure_rate: Record<string, unknown>;
  token_cost_today: Record<string, unknown>;
};

type UsageSummary = {
  items: {
    agent: string;
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_hit_ratio: number;
    estimated_cost: number;
  }[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function Home() {
  const [message, setMessage] = useState("帮我总结当前 Agent OS 项目定位");
  const [conversationID, setConversationID] = useState("");
  const [chatResult, setChatResult] = useState<ChatResult | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [traceRunID, setTraceRunID] = useState("");
  const [preferredNode, setPreferredNode] = useState("main-node");
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const currentRunID = chatResult?.run_id ?? traceRunID;
  const hasTrace = steps.length > 0;
  const stepSummary = useMemo(() => steps.map((step) => step.step_type).join(" -> "), [steps]);
  const latestMemoryPack = runDetail?.memory_context_packs?.at(-1);
  const usedMemories = latestMemoryPack
    ? [
        ...latestMemoryPack.profile,
        ...latestMemoryPack.project_facts,
        ...latestMemoryPack.relevant_episodes,
        ...latestMemoryPack.heuristics,
        ...latestMemoryPack.anti_patterns,
        ...latestMemoryPack.open_issues,
        ...latestMemoryPack.dynamic_retrieval
      ]
    : [];

  useEffect(() => {
    const runID = new URLSearchParams(window.location.search).get("run_id");
    if (!runID) {
      return;
    }
    setTraceRunID(runID);
    loadRunTrace(runID).catch((err) => setError(err instanceof Error ? err.message : "Failed to load run trace"));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/system-health`).then((response) => response.json()),
      fetch(`${API_BASE}/api/model-usage-summary`).then((response) => response.json())
    ]).then(([healthPayload, usagePayload]) => {
      setHealth(healthPayload.data ?? null);
      setUsage(usagePayload.data ?? null);
    }).catch(() => undefined);
  }, []);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationID || undefined,
          channel: "web",
          message,
          options: { allow_tools: true, preferred_node: preferredNode, allow_worker: preferredNode !== "main-node" }
        })
      });
      const payload = (await response.json()) as ApiResponse<ChatResult>;
      if (!payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Chat request failed");
      }
      setChatResult(payload.data);
      setConversationID(payload.data.conversation_id);
      await loadRunTrace(payload.data.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  }

  async function loadRunTrace(runID: string) {
    const [stepsResponse, runResponse] = await Promise.all([
      fetch(`${API_BASE}/api/runs/${runID}/steps`),
      fetch(`${API_BASE}/api/runs/${runID}`)
    ]);
    const stepsPayload = (await stepsResponse.json()) as ApiResponse<RunStepsResult>;
    const runPayload = (await runResponse.json()) as ApiResponse<RunDetail>;
    if (!stepsPayload.ok || !stepsPayload.data) {
      throw new Error(stepsPayload.error?.message ?? "Failed to load run steps");
    }
    if (!runPayload.ok || !runPayload.data) {
      throw new Error(runPayload.error?.message ?? "Failed to load run detail");
    }
    setSteps(stepsPayload.data.steps);
    setRunDetail(runPayload.data);
    setTraceRunID(runID);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Agent OS Console</h1>
          <p>Chat Workbench / Run Trace</p>
        </div>
        <div className="status">
          <span>API</span>
          <strong>{API_BASE}</strong>
        </div>
      </header>

      <section className="dashboard">
        <div>
          <span>Services</span>
          <strong>{health ? (health.service_status.postgres ? "healthy" : "degraded") : "loading"}</strong>
        </div>
        <div>
          <span>Workers</span>
          <strong>{health?.worker_status?.map((node) => `${node.id}:${node.status}`).join(" · ") ?? "loading"}</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>active {String(health?.queue_status?.active_tasks ?? 0)} · dead {String(health?.queue_status?.dead_tasks ?? 0)}</strong>
        </div>
        <div>
          <span>Today Cost</span>
          <strong>${((usage?.items ?? []).reduce((sum, item) => sum + (item.estimated_cost ?? 0), 0)).toFixed(4)}</strong>
        </div>
      </section>

      <section className="workspace">
        <section className="pane chatPane">
          <div className="paneHeader">
            <h2>Chat Workbench</h2>
            {conversationID ? <span>{conversationID}</span> : null}
          </div>

          <form onSubmit={sendMessage} className="composer">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
            <select value={preferredNode} onChange={(event) => setPreferredNode(event.target.value)}>
              <option value="main-node">Run on: main-node</option>
              <option value="local-worker-1">Run on: local-worker-1</option>
              <option value="vps-la-1">Run on: vps-la-1</option>
              <option value="auto">Run on: auto</option>
            </select>
            <button type="submit" disabled={pending || message.trim().length === 0}>
              {pending ? "Sending" : "Send"}
            </button>
          </form>

          {error ? <div className="error">{error}</div> : null}

          {chatResult ? (
            <div className="responseBlock">
              <div className="metaGrid">
                <div>
                  <span>Run</span>
                  <strong>{chatResult.run_id}</strong>
                </div>
                <div>
                  <span>Agent</span>
                  <strong>{chatResult.selected_agent_id}</strong>
                </div>
                <div>
                  <span>Node</span>
                  <strong>{runDetail?.tasks?.[0]?.assigned_node_id ?? preferredNode}</strong>
                </div>
                <div>
                  <span>Trace</span>
                  <strong>{currentRunID}</strong>
                </div>
              </div>
              <p>{chatResult.response}</p>
            </div>
          ) : (
            <div className="empty">发送消息后会创建 conversation、message、run 并展示 mock 回复。</div>
          )}
        </section>

        <section className="pane tracePane">
          <div className="paneHeader">
            <h2>Run Trace Detail</h2>
            {currentRunID ? <span>{currentRunID}</span> : null}
          </div>

          {hasTrace ? (
            <>
              <div className="traceSummary">{stepSummary}</div>
              <div className="traceSummary">
                <strong>Memory Context Pack</strong>
                <span>{latestMemoryPack?.memory_profile_version ?? "none"}</span>
                {usedMemories.length > 0 ? (
                  <ul className="memoryList">
                    {usedMemories.slice(0, 6).map((memory, index) => (
                      <li key={index}>{JSON.stringify(memory)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No memory used in this run.</p>
                )}
              </div>
              <div className="traceSummary">
                <strong>Model Calls</strong>
                {(runDetail?.model_calls ?? []).map((call) => (
                  <p key={call.id}>
                    {call.provider} / {call.model_name} · {call.status} · real {String(call.metadata?.real_model ?? false)} · input {call.input_tokens} · output {call.output_tokens} · cached {call.cached_input_tokens} · {call.latency_ms}ms
                    {call.error_message ? ` · error ${call.error_message}` : ""}
                  </p>
                ))}
              </div>
              <div className="traceSummary">
                <strong>Task Assignment</strong>
                {(runDetail?.tasks ?? []).length > 0 ? (
                  (runDetail?.tasks ?? []).map((task) => (
                    <p key={task.id}>
                      {task.capability_id} · {task.status} · {task.assigned_node_id} · attempts {task.attempts.length}
                    </p>
                  ))
                ) : (
                  <p>No worker task in this run.</p>
                )}
              </div>
              <ol className="timeline">
                {steps.map((step) => (
                  <li key={step.id}>
                    <div className="stepHeader">
                      <strong>{step.title}</strong>
                      <span>{step.status}</span>
                    </div>
                    <code>{step.step_type}</code>
                    <div className="jsonGrid">
                      <pre>{JSON.stringify(step.input, null, 2)}</pre>
                      <pre>{JSON.stringify(step.output, null, 2)}</pre>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="empty">Run Trace 会按 input、router、memory、agent、response 展示。</div>
          )}
        </section>
      </section>
    </main>
  );
}
