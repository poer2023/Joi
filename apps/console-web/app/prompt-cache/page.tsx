"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function PromptCachePage() {
  const [health, setHealth] = useState<unknown>(null);
  const [modelCalls, setModelCalls] = useState<unknown[]>([]);
  const [cacheStats, setCacheStats] = useState<unknown[]>([]);
  const [usage, setUsage] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/model-provider/health`).then((response) => response.json()),
      fetch(`${API_BASE}/api/model-calls`).then((response) => response.json()),
      fetch(`${API_BASE}/api/provider-cache-stats`).then((response) => response.json()),
      fetch(`${API_BASE}/api/model-usage-summary`).then((response) => response.json())
    ]).then(([providerHealth, calls, stats, usageSummary]) => {
      setHealth(providerHealth.data ?? null);
      setModelCalls(calls.data?.model_calls ?? []);
      setCacheStats(stats.data?.provider_cache_stats ?? []);
      setUsage(usageSummary.data ?? null);
    });
  }, []);

  return (
    <main className="shell">
      <section className="workspace">
        <section className="pane">
          <div className="paneHeader">
            <h1>Provider Health</h1>
            <span>current default</span>
          </div>
          <pre>{JSON.stringify(health, null, 2)}</pre>
        </section>
        <section className="pane">
          <div className="paneHeader">
            <h1>Model Calls</h1>
            <span>latest 100</span>
          </div>
          <pre>{JSON.stringify(modelCalls, null, 2)}</pre>
        </section>
      </section>
      <section className="shellInner">
        <section className="pane">
          <div className="paneHeader">
            <h1>Model Usage & Cache</h1>
            <span>provider / model / agent</span>
          </div>
          <pre>{JSON.stringify(usage, null, 2)}</pre>
          <div className="paneHeader">
            <h1>Prompt Cache</h1>
            <span>provider stats</span>
          </div>
          <pre>{JSON.stringify(cacheStats, null, 2)}</pre>
        </section>
      </section>
    </main>
  );
}
