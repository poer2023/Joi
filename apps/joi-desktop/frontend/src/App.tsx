import { FormEvent, useEffect, useMemo, useState } from 'react';
import { desktopApi, type ChatResponse, type RunTrace, type SystemHealth } from './api/desktop';

export default function App() {
  const [message, setMessage] = useState('你现在是什么系统？用一句话回答。');
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState('');
  const stepCount = useMemo(() => trace?.steps?.length ?? 0, [trace]);
  const firstModelCall = trace?.model_calls?.[0] ?? chat?.model_calls?.[0];

  useEffect(() => {
    void desktopApi.getSystemHealth().then(setHealth).catch((err) => setError(String(err)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setTrace(null);
    try {
      const result = await desktopApi.sendChat({ channel: 'desktop', user_id: 'desktop_user', message });
      setChat(result);
      const runTrace = await desktopApi.getRunTrace(result.run_id);
      setTrace(runTrace);
      const systemHealth = await desktopApi.getSystemHealth();
      setHealth(systemHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>Joi</h1>
          <p>Desktop Mode</p>
        </div>
        <nav>
          <a className="active">Chat</a>
          <a>Trace</a>
          <a>System</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <strong>Chat Workbench</strong>
            <span>SQLite · AppCore · no Docker</span>
          </div>
          <div className="health-pill">{health?.service_status?.sqlite ? 'SQLite OK' : 'Checking'}</div>
        </header>

        <div className="content-grid">
          <section className="panel chat-panel">
            <form onSubmit={submit}>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
              <button type="submit">Send</button>
            </form>
            {error && <div className="error">{error}</div>}
            {chat && (
              <article className="answer">
                <h2>{chat.selected_agent_id}</h2>
                <p>{chat.response}</p>
                <small>{chat.run_id}</small>
              </article>
            )}
          </section>

          <section className="panel trace-panel">
            <h2>Run Trace</h2>
            {trace ? (
              <>
                <dl>
                  <div><dt>Status</dt><dd>{trace.status}</dd></div>
                  <div><dt>Agent</dt><dd>{trace.selected_agent_id}</dd></div>
                  <div><dt>Steps</dt><dd>{stepCount}</dd></div>
                  <div><dt>Model</dt><dd>{firstModelCall?.model_name ?? 'none'}</dd></div>
                  <div><dt>Provider</dt><dd>{firstModelCall?.provider ?? 'none'}</dd></div>
                  <div><dt>Tokens</dt><dd>{firstModelCall ? `${firstModelCall.input_tokens}/${firstModelCall.output_tokens}` : '0/0'}</dd></div>
                </dl>
                <ol>
                  {trace.steps?.map((step) => (
                    <li key={step.id}>
                      <strong>{step.step_type}</strong>
                      <span>{step.title}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="empty">Send a message to generate a trace.</p>
            )}
          </section>

          <section className="panel system-panel">
            <h2>System Health</h2>
            <dl>
              <div><dt>Mode</dt><dd>desktop</dd></div>
              <div><dt>Queue</dt><dd>{String(health?.queue_status?.active_tasks ?? 0)} active</dd></div>
              <div><dt>Nodes</dt><dd>{String(health?.worker_status?.length ?? 0)}</dd></div>
              <div><dt>Warnings</dt><dd>{String(health?.warnings?.length ?? 0)}</dd></div>
            </dl>
          </section>
        </div>
      </section>
    </main>
  );
}
