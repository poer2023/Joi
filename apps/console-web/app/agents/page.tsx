"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function AgentsPage() {
  const [agents, setAgents] = useState<unknown[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/agents`)
      .then((response) => response.json())
      .then((payload) => setAgents(payload.data?.agents ?? []));
  }, []);

  return (
    <main className="shell">
      <section className="pane">
        <div className="paneHeader">
          <h1>Agent Registry</h1>
          <span>read only</span>
        </div>
        <pre>{JSON.stringify(agents, null, 2)}</pre>
      </section>
    </main>
  );
}
