"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type NodeRecord = {
  id: string;
  name: string;
  role: string;
  status: string;
  capabilities: unknown[];
  assign_policy: Record<string, unknown>;
  auto_assign_enabled: boolean;
  manual_assign_enabled: boolean;
  failed_heartbeat_count: number;
  last_failure_reason: string;
  last_heartbeat_at: string | null;
};

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);

  async function load() {
    const response = await fetch(`${API_BASE}/api/nodes`);
    const payload = await response.json();
    setNodes(payload.data?.nodes ?? []);
  }

  async function heartbeat() {
    await fetch(`${API_BASE}/api/nodes/main-node/heartbeat`, { method: "POST" });
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="shell">
      <section className="pane">
        <div className="paneHeader">
          <h1>Node Console</h1>
          <button className="smallButton" onClick={heartbeat}>
            Heartbeat
          </button>
        </div>
        <div className="cardList">
          {nodes.map((node) => (
            <article className="itemCard" key={node.id}>
              <div className="stepHeader">
                <strong>{node.id}</strong>
                <span>{node.status}</span>
              </div>
              <p>{node.name} / {node.role}</p>
              <div className="metaGrid">
                <div><span>Manual</span><strong>{String(node.manual_assign_enabled)}</strong></div>
                <div><span>Auto</span><strong>{String(node.auto_assign_enabled)}</strong></div>
                <div><span>Failures</span><strong>{node.failed_heartbeat_count}</strong></div>
                <div><span>Heartbeat</span><strong>{node.last_heartbeat_at ?? "never"}</strong></div>
              </div>
              <p>capabilities: {(node.capabilities ?? []).join(", ")}</p>
              <p>policy: {JSON.stringify(node.assign_policy)}</p>
              {node.last_failure_reason ? <p>last failure: {node.last_failure_reason}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
