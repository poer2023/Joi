"use client";

import { FormEvent, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Memory = {
  id: string;
  type: string;
  content: string;
  status: string;
  confidence: number;
  usage_count: number;
  success_count: number;
  failure_count: number;
  positive_feedback: number;
  negative_feedback: number;
  pinned: boolean;
  source_event_ids: string[];
  conflict_reason: string;
  merged_into_memory_id: string;
  recent_usage: { id: string; run_id: string; agent_id: string; outcome: string; retrieval_score: number; created_at: string }[];
};

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [content, setContent] = useState("");
  const pendingMemories = memories.filter((memory) => memory.status !== "confirmed" && memory.status !== "disabled");

  async function load() {
    const response = await fetch(`${API_BASE}/api/memories`);
    const payload = await response.json();
    setMemories(payload.data?.memories ?? []);
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await fetch(`${API_BASE}/api/memories/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source_event_ids: ["console_memory_studio"] })
    });
    setContent("");
    await load();
  }

  async function patchMemory(id: string, body: Record<string, unknown>) {
    await fetch(`${API_BASE}/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    await load();
  }

  async function feedback(id: string, value: "positive" | "negative" | "neutral") {
    await fetch(`${API_BASE}/api/memories/${id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: value })
    });
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="shell">
      <section className="pane">
        <div className="paneHeader">
          <h1>Memory Studio</h1>
          <span>governance / feedback / usage</span>
        </div>
        <form className="composer compactComposer" onSubmit={propose}>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="记住：..." />
          <button type="submit" disabled={!content.trim()}>
            Propose
          </button>
        </form>
        <section className="responseBlock">
          <div className="stepHeader">
            <strong>Memory Inbox</strong>
            <span>{pendingMemories.length} pending</span>
          </div>
          <p>候选记忆需要人工治理，不会自动写成 confirmed。</p>
          <div className="cardList">
            {pendingMemories.slice(0, 8).map((memory) => (
              <article className="itemCard" key={`inbox-${memory.id}`}>
                <div className="stepHeader">
                  <strong>{memory.type}</strong>
                  <span>{memory.status}</span>
                </div>
                <p>{memory.content}</p>
                <div className="buttonRow">
                  <button type="button" onClick={() => patchMemory(memory.id, { disabled: false })}>Confirm</button>
                  <button type="button" onClick={() => patchMemory(memory.id, { disabled: true })}>Disable</button>
                  <button type="button" onClick={() => patchMemory(memory.id, { mark_conflict: true, conflict_reason: "Needs review from Memory Inbox" })}>Conflict</button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className="cardList">
          {memories.map((memory) => (
            <article className="itemCard" key={memory.id}>
              <div className="stepHeader">
                <strong>{memory.type}</strong>
                <span>{memory.status}{memory.pinned ? " / pinned" : ""}</span>
              </div>
              <p>{memory.content}</p>
              <div className="metaGrid">
                <div><span>Used</span><strong>{memory.usage_count}</strong></div>
                <div><span>Success</span><strong>{memory.success_count}</strong></div>
                <div><span>Failure</span><strong>{memory.failure_count}</strong></div>
                <div><span>Feedback</span><strong>{memory.positive_feedback}/{memory.negative_feedback}</strong></div>
              </div>
              <p>source: {(memory.source_event_ids ?? []).join(", ") || "unknown"}</p>
              {memory.conflict_reason ? <p>conflict: {memory.conflict_reason}</p> : null}
              {memory.merged_into_memory_id ? <p>merged into: {memory.merged_into_memory_id}</p> : null}
              <div className="buttonRow">
                <button type="button" onClick={() => patchMemory(memory.id, { pinned: !memory.pinned })}>{memory.pinned ? "Unpin" : "Pin"}</button>
                <button type="button" onClick={() => patchMemory(memory.id, { disabled: memory.status !== "disabled" })}>{memory.status === "disabled" ? "Enable" : "Disable"}</button>
                <button type="button" onClick={() => patchMemory(memory.id, { mark_conflict: memory.status !== "conflicted", conflict_reason: "Marked in Memory Studio" })}>Conflict</button>
                <button type="button" onClick={() => feedback(memory.id, "positive")}>Positive</button>
                <button type="button" onClick={() => feedback(memory.id, "negative")}>Negative</button>
              </div>
              <pre>{JSON.stringify((memory.recent_usage ?? []).slice(0, 10), null, 2)}</pre>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
