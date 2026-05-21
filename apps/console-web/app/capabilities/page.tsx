"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export default function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<unknown[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/capabilities`)
      .then((response) => response.json())
      .then((payload) => setCapabilities(payload.data?.capabilities ?? []));
  }, []);

  return (
    <main className="shell">
      <section className="pane">
        <div className="paneHeader">
          <h1>Capability Console</h1>
          <span>read only</span>
        </div>
        <pre>{JSON.stringify(capabilities, null, 2)}</pre>
      </section>
    </main>
  );
}
