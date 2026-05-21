"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Confirmation = {
  id: string;
  run_id: string;
  capability_id: string;
  requested_action: string;
  risk_level: string;
  status: string;
  input: Record<string, unknown>;
  created_at: string;
};

export default function ConfirmationsPage() {
  const [items, setItems] = useState<Confirmation[]>([]);

  async function load() {
    const response = await fetch(`${API_BASE}/api/confirmations`);
    const payload = await response.json();
    setItems(payload.data?.confirmations ?? []);
  }

  async function decide(id: string, action: "approve" | "reject") {
    await fetch(`${API_BASE}/api/confirmations/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "console" })
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
          <h1>Confirmations</h1>
          <span>L2 state_change approval</span>
        </div>
        <div className="cardList">
          {items.map((item) => (
            <article className="itemCard" key={item.id}>
              <div className="stepHeader">
                <strong>{item.capability_id}</strong>
                <span>{item.status}</span>
              </div>
              <p>{item.requested_action}</p>
              <p>risk: {item.risk_level} / run: {item.run_id || "none"}</p>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
              {item.status === "pending" ? (
                <div className="buttonRow">
                  <button type="button" onClick={() => decide(item.id, "approve")}>Approve</button>
                  <button type="button" onClick={() => decide(item.id, "reject")}>Reject</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
