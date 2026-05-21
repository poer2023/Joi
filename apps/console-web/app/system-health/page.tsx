"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function SystemHealthPage() {
  const [health, setHealth] = useState<unknown>(null);
  const [metrics, setMetrics] = useState("");

  async function load() {
    const [healthResponse, metricsResponse] = await Promise.all([
      fetch(`${API_BASE}/api/system-health`),
      fetch(`${API_BASE}/metrics`)
    ]);
    const healthPayload = await healthResponse.json();
    setHealth(healthPayload.data);
    setMetrics(await metricsResponse.text());
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="shell">
      <section className="pane">
        <div className="paneHeader">
          <h1>System Health</h1>
          <button className="smallButton" onClick={load}>Refresh</button>
        </div>
        <div className="traceSummary">
          <strong>Metrics</strong>
          <pre>{metrics}</pre>
        </div>
        <pre>{JSON.stringify(health, null, 2)}</pre>
      </section>
    </main>
  );
}
