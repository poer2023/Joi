import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  desktopApi,
  type BackupRecord,
  type ChatResponse,
  type ConfirmationRecord,
  type MemoryRecord,
  type ModelCall,
  type NodeRecord,
  type OnboardingStatus,
  type RunTrace,
  type SecretStatus,
  type SettingsRecord,
  type SystemHealth,
  type WorkerGatewayAuditRecord,
} from './api/desktop';

type Tab = 'chat' | 'trace' | 'system' | 'memory' | 'nodes' | 'costs' | 'confirmations' | 'settings' | 'backups';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'trace', label: 'Trace' },
  { id: 'system', label: 'System' },
  { id: 'memory', label: 'Memory' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'costs', label: 'Costs' },
  { id: 'confirmations', label: 'Confirm' },
  { id: 'settings', label: 'Settings' },
  { id: 'backups', label: 'Backups' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [message, setMessage] = useState('你现在是什么系统？用一句话回答。');
  const [preferredNode, setPreferredNode] = useState('main-node');
  const [allowWorker, setAllowWorker] = useState(false);
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [gatewayAudit, setGatewayAudit] = useState<WorkerGatewayAuditRecord[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown>[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationRecord[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const stepCount = useMemo(() => trace?.steps?.length ?? 0, [trace]);
  const firstModelCall = trace?.model_calls?.[0] ?? chat?.model_calls?.[0];

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    setError('');
    try {
      const [systemHealth, memoryList, nodeList, gatewayAuditList, modelUsage, confirmationList, backupList, desktopSettings, secrets, onboardingStatus] = await Promise.all([
        desktopApi.getSystemHealth(),
        desktopApi.listMemories({ query: memoryQuery, limit: 50 }),
        desktopApi.listNodes(),
        desktopApi.listWorkerGatewayAuditLogs(),
        desktopApi.getModelUsage(),
        desktopApi.listConfirmations(),
        desktopApi.listBackups(),
        desktopApi.getSettings(),
        desktopApi.getSecretStatus(),
        desktopApi.getOnboardingStatus(),
      ]);
      setHealth(systemHealth);
      setMemories(memoryList.memories ?? []);
      setNodes(nodeList.nodes ?? []);
      setGatewayAudit(gatewayAuditList.items ?? []);
      setUsage(modelUsage.items ?? []);
      setConfirmations(confirmationList.items ?? []);
      setBackups(backupList.backups ?? []);
      setSettings(desktopSettings);
      setSecretStatus(secrets);
      setOnboarding(onboardingStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setTrace(null);
    try {
      const result = await desktopApi.sendChat({
        channel: 'desktop',
        user_id: 'desktop_user',
        message,
        preferred_node: preferredNode,
        allow_worker: allowWorker,
      });
      setChat(result);
      const runTrace = await desktopApi.getRunTrace(result.run_id);
      setTrace(runTrace);
      await refreshAll();
      setActiveTab('trace');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateMemory(id: string, action: string, extra: Partial<MemoryRecord> = {}) {
    await desktopApi.updateMemory({ id, action, reason: 'desktop_ui', content: extra.content, summary: extra.summary });
    await refreshAll();
  }

  async function decideConfirmation(id: string, approve: boolean) {
    await desktopApi.decideConfirmation({ id, approve, actor: 'desktop_admin', reason: approve ? 'approved_in_desktop' : 'rejected_in_desktop' });
    await refreshAll();
  }

  async function setNodeDisabled(nodeID: string, disabled: boolean) {
    if (disabled) {
      await desktopApi.disableNode(nodeID);
      setNotice(`Node disabled: ${nodeID}`);
    } else {
      await desktopApi.enableNode(nodeID);
      setNotice(`Node enabled: ${nodeID}`);
    }
    await refreshAll();
  }

  async function rotateWorkerToken() {
    const result = await desktopApi.generateWorkerToken();
    setNotice(`Worker token rotated: ${result.token}`);
    await refreshAll();
  }

  async function createBackup() {
    const result = await desktopApi.createBackup();
    setNotice(`Backup created: ${result.path}`);
    await refreshAll();
  }

  async function restoreBackup(path: string) {
    await desktopApi.restoreBackup(path);
    setNotice('Backup restored. Secrets remain in Keychain or must be reconfigured.');
    await refreshAll();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>Joi</h1>
          <p>Desktop Mode</p>
        </div>
        <nav>
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} type="button" onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <strong>{tabs.find((tab) => tab.id === activeTab)?.label}</strong>
            <span>SQLite · AppCore · no Docker</span>
          </div>
          <button className="health-pill" type="button" onClick={refreshAll}>
            {health?.service_status?.sqlite ? 'SQLite OK' : 'Refresh'}
          </button>
        </header>

        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner notice">{notice}</div>}

        {onboarding?.required && <OnboardingPanel createBackup={createBackup} refreshAll={refreshAll} setError={setError} setNotice={setNotice} status={onboarding} />}

        {!onboarding?.required && activeTab === 'chat' && (
          <div className="content-grid">
            <section className="panel chat-panel">
              <form onSubmit={submit}>
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
                <div className="control-row">
                  <label>
                    Run on
                    <select value={preferredNode} onChange={(event) => setPreferredNode(event.target.value)}>
                      <option value="main-node">main-node</option>
                      <option value="local-worker-1">local-worker-1</option>
                      <option value="vps-la-1">vps-la-1</option>
                      <option value="auto">auto</option>
                    </select>
                  </label>
                  <label className="check">
                    <input checked={allowWorker} type="checkbox" onChange={(event) => setAllowWorker(event.target.checked)} />
                    allow worker
                  </label>
                  <button type="submit">Send</button>
                </div>
              </form>
              {chat && (
                <article className="answer">
                  <h2>{chat.selected_agent_id}</h2>
                  <p>{chat.response}</p>
                  <small>{chat.run_id}</small>
                </article>
              )}
            </section>
            <TracePanel firstModelCall={firstModelCall} stepCount={stepCount} trace={trace} />
          </div>
        )}

        {!onboarding?.required && activeTab === 'trace' && <TraceDetail firstModelCall={firstModelCall} stepCount={stepCount} trace={trace} />}
        {!onboarding?.required && activeTab === 'system' && <SystemPanel health={health} />}
        {!onboarding?.required && activeTab === 'memory' && <MemoryPanel memories={memories} memoryQuery={memoryQuery} setMemoryQuery={setMemoryQuery} refreshAll={refreshAll} updateMemory={updateMemory} />}
        {!onboarding?.required && activeTab === 'nodes' && <NodesPanel audit={gatewayAudit} nodes={nodes} rotateWorkerToken={rotateWorkerToken} setNodeDisabled={setNodeDisabled} />}
        {!onboarding?.required && activeTab === 'costs' && <CostsPanel calls={trace?.model_calls ?? []} usage={usage} health={health} />}
        {!onboarding?.required && activeTab === 'confirmations' && <ConfirmationsPanel confirmations={confirmations} decide={decideConfirmation} />}
        {!onboarding?.required && activeTab === 'settings' && <SettingsPanel refreshAll={refreshAll} secretStatus={secretStatus} setNotice={setNotice} settings={settings} />}
        {!onboarding?.required && activeTab === 'backups' && <BackupsPanel backups={backups} createBackup={createBackup} restoreBackup={restoreBackup} />}
      </section>
    </main>
  );
}

function OnboardingPanel({
  status,
  createBackup,
  refreshAll,
  setError,
  setNotice,
}: {
  status: OnboardingStatus;
  createBackup: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [provider, setProvider] = useState('openai_compatible');
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com');
  const [modelName, setModelName] = useState('deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [workerToken, setWorkerToken] = useState('');

  async function runStep(action: () => Promise<void>, success: string) {
    setError('');
    try {
      await action();
      setNotice(success);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAndTestModel() {
    await runStep(async () => {
      await desktopApi.saveModelConfig({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
      if (apiKey.trim()) {
        await desktopApi.saveSecret({ name: 'MODEL_API_KEY', value: apiKey.trim() });
        setApiKey('');
      }
      const result = await desktopApi.testModelConnection();
      if (!result.ok) {
        throw new Error(result.error_summary || result.status);
      }
    }, 'Model connection verified.');
  }

  async function saveAndTestTelegram() {
    await runStep(async () => {
      if (telegramToken.trim()) {
        await desktopApi.saveSecret({ name: 'TELEGRAM_BOT_TOKEN', value: telegramToken.trim() });
        setTelegramToken('');
      }
      const result = await desktopApi.testTelegramConnection();
      if (!result.ok) {
        throw new Error(result.error_summary || result.status);
      }
    }, 'Telegram token verified.');
  }

  async function generateWorkerToken() {
    await runStep(async () => {
      const result = await desktopApi.generateWorkerToken();
      setWorkerToken(result.token);
    }, 'Worker token generated.');
  }

  async function finishOnboarding() {
    await runStep(async () => {
      await desktopApi.completeOnboarding();
    }, 'Onboarding completed.');
  }

  return (
    <section className="panel wide onboarding">
      <h2>First-run setup</h2>
      <dl className="metrics">
        <KV label="Model" value={status.model_configured ? 'configured' : 'required'} />
        <KV label="Backup" value={status.first_backup_created ? `${status.backup_count}` : 'required'} />
        <KV label="Telegram" value={status.telegram_configured ? 'configured' : 'optional'} />
        <KV label="Worker" value={status.worker_configured ? 'configured' : 'optional'} />
      </dl>
      <div className="settings-grid">
        <section>
          <h3>Model</h3>
          <label>
            Provider
            <input value={provider} onChange={(event) => setProvider(event.target.value)} />
          </label>
          <label>
            Base URL
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
          </label>
          <label>
            Model
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} />
          </label>
          <label>
            API Key
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          <button type="button" onClick={saveAndTestModel}>Save & Test Model</button>
        </section>
        <section>
          <h3>Optional</h3>
          <label>
            Telegram Token
            <input type="password" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} />
          </label>
          <button type="button" onClick={saveAndTestTelegram}>Test Telegram</button>
          <button type="button" onClick={generateWorkerToken}>Generate Worker Token</button>
          {workerToken && <code>{workerToken}</code>}
        </section>
        <section>
          <h3>Backup</h3>
          <button type="button" onClick={createBackup}>Create First Backup</button>
          <button disabled={!status.model_configured || !status.first_backup_created} type="button" onClick={finishOnboarding}>Finish</button>
        </section>
      </div>
    </section>
  );
}

function TracePanel({ trace, stepCount, firstModelCall }: { trace: RunTrace | null; stepCount: number; firstModelCall?: ModelCall }) {
  return (
    <section className="panel trace-panel">
      <h2>Run Trace</h2>
      {trace ? (
        <>
          <dl>
            <KV label="Status" value={trace.status} />
            <KV label="Agent" value={trace.selected_agent_id} />
            <KV label="Steps" value={String(stepCount)} />
            <KV label="Model" value={firstModelCall?.model_name ?? 'none'} />
            <KV label="Provider" value={firstModelCall?.provider ?? 'none'} />
            <KV label="Tokens" value={firstModelCall ? `${firstModelCall.input_tokens}/${firstModelCall.output_tokens}` : '0/0'} />
          </dl>
          <StepList trace={trace} />
        </>
      ) : (
        <p className="empty">Send a message to generate a trace.</p>
      )}
    </section>
  );
}

function TraceDetail({ trace, stepCount, firstModelCall }: { trace: RunTrace | null; stepCount: number; firstModelCall?: ModelCall }) {
  if (!trace) return <section className="panel wide"><p className="empty">No trace selected.</p></section>;
  return (
    <section className="panel wide">
      <h2>Run Trace</h2>
      <dl className="metrics">
        <KV label="Run" value={trace.id} />
        <KV label="Status" value={trace.status} />
        <KV label="Agent" value={trace.selected_agent_id} />
        <KV label="Steps" value={String(stepCount)} />
        <KV label="Prompt Assemblies" value={String(trace.prompt_assemblies?.length ?? 0)} />
        <KV label="Memory Packs" value={String(trace.memory_context_packs?.length ?? 0)} />
        <KV label="Model Calls" value={String(trace.model_calls?.length ?? 0)} />
        <KV label="Latency" value={`${firstModelCall?.latency_ms ?? 0} ms`} />
      </dl>
      <div className="split">
        <StepList trace={trace} />
        <JsonPreview value={{ route_result: trace.route_result, prompt_assemblies: trace.prompt_assemblies, memory_context_packs: trace.memory_context_packs }} />
      </div>
    </section>
  );
}

function StepList({ trace }: { trace: RunTrace }) {
  return (
    <ol className="step-list">
      {trace.steps?.map((step) => (
        <li key={step.id}>
          <strong>{step.step_type}</strong>
          <span>{step.title}</span>
          {step.output ? <code>{compact(step.output)}</code> : null}
        </li>
      ))}
    </ol>
  );
}

function SystemPanel({ health }: { health: SystemHealth | null }) {
  return (
    <section className="panel wide">
      <h2>System Health</h2>
      <dl className="metrics">
        <KV label="SQLite" value={String(health?.service_status?.sqlite ?? false)} />
        <KV label="Active Tasks" value={String(health?.queue_status?.active_tasks ?? 0)} />
        <KV label="Dead Tasks" value={String(health?.queue_status?.dead_tasks ?? 0)} />
        <KV label="Workers" value={String(health?.worker_status?.length ?? 0)} />
        <KV label="Model Calls Today" value={String(health?.model_latency?.model_calls_today ?? 0)} />
        <KV label="Warnings" value={String(health?.warnings?.length ?? 0)} />
      </dl>
      <JsonPreview value={health ?? {}} />
    </section>
  );
}

function MemoryPanel({
  memories,
  memoryQuery,
  setMemoryQuery,
  refreshAll,
  updateMemory,
}: {
  memories: MemoryRecord[];
  memoryQuery: string;
  setMemoryQuery: (value: string) => void;
  refreshAll: () => Promise<void>;
  updateMemory: (id: string, action: string, extra?: Partial<MemoryRecord>) => Promise<void>;
}) {
  const inbox = memories.filter((memory) => memory.status !== 'confirmed' || memory.confidence < 0.6 || Boolean(memory.conflict_group_id) || Boolean(memory.merged_into_memory_id));

  async function editAndConfirm(memory: MemoryRecord) {
    const edited = window.prompt('Edit memory before confirming', memory.content);
    if (edited === null) return;
    await updateMemory(memory.id, 'edit_confirm', { content: edited, summary: memory.summary });
  }

  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>Memory Studio</h2>
        <div className="control-row">
          <input value={memoryQuery} placeholder="Search memory" onChange={(event) => setMemoryQuery(event.target.value)} />
          <button type="button" onClick={refreshAll}>Search</button>
        </div>
      </div>
      <h3>Memory Inbox</h3>
      <div className="table">
        {inbox.map((memory) => (
          <article key={`inbox-${memory.id}`} className="row-card">
            <div>
              <strong>{memory.summary || memory.type}</strong>
              <p>{memory.content}</p>
              <small>{memory.status} · confidence {memory.confidence.toFixed(2)} · duplicate {memory.merged_into_memory_id || 'no'} · conflict {memory.conflict_group_id || 'no'}</small>
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => updateMemory(memory.id, 'confirm')}>Confirm</button>
              <button type="button" onClick={() => editAndConfirm(memory)}>Edit & Confirm</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_global')}>Global</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_project')}>Project</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'disable')}>Disable</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'delete')}>Delete</button>
            </div>
          </article>
        ))}
        {inbox.length === 0 && <p className="empty">No pending memory candidates.</p>}
      </div>
      <h3>Confirmed & Search Results</h3>
      <div className="table">
        {memories.map((memory) => (
          <article key={memory.id} className="row-card">
            <div>
              <strong>{memory.summary || memory.type}</strong>
              <p>{memory.content}</p>
              <small>{memory.status} · confidence {memory.confidence.toFixed(2)} · hits {memory.usage_count} · +/- {memory.positive_feedback}/{memory.negative_feedback}</small>
              {memory.conflict_group_id && <small>conflict: {memory.conflict_group_id} {memory.conflict_reason}</small>}
              {memory.source_event_ids?.length ? <small>source: {memory.source_event_ids.join(', ')}</small> : null}
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => updateMemory(memory.id, memory.pinned ? 'unpin' : 'pin')}>{memory.pinned ? 'Unpin' : 'Pin'}</button>
              <button type="button" onClick={() => updateMemory(memory.id, memory.disabled ? 'enable' : 'disable')}>{memory.disabled ? 'Enable' : 'Disable'}</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'feedback_positive')}>Good</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'feedback_negative')}>Bad</button>
              <button type="button" onClick={() => updateMemory(memory.id, 'mark_conflict')}>Conflict</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function NodesPanel({
  nodes,
  audit,
  setNodeDisabled,
  rotateWorkerToken,
}: {
  nodes: NodeRecord[];
  audit: WorkerGatewayAuditRecord[];
  setNodeDisabled: (nodeID: string, disabled: boolean) => Promise<void>;
  rotateWorkerToken: () => Promise<void>;
}) {
  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>Nodes</h2>
        <button type="button" onClick={rotateWorkerToken}>Reset Worker Token</button>
      </div>
      <div className="table">
        {nodes.map((node) => (
          <article key={node.id} className="row-card">
            <div>
              <strong>{node.id}</strong>
              <p>{node.name} · {node.role} · {node.status}</p>
              <small>auto {String(node.auto_assign_enabled)} · manual {String(node.manual_assign_enabled)}</small>
              <small>{(node.capabilities ?? []).join(', ')}</small>
            </div>
            <div className="row-actions">
              {node.status === 'disabled' ? (
                <button type="button" onClick={() => setNodeDisabled(node.id, false)}>Enable</button>
              ) : (
                <button type="button" onClick={() => setNodeDisabled(node.id, true)}>Disable</button>
              )}
            </div>
          </article>
        ))}
      </div>
      <h3>Gateway Audit</h3>
      <div className="table">
        {audit.map((item) => (
          <article key={item.id} className="row-card compact">
            <strong>{item.node_id || 'unknown'} · {item.action} · {item.status}</strong>
            <small>{item.reason}</small>
            <small>{compact(item.metadata ?? {})}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function CostsPanel({ usage, calls, health }: { usage: Record<string, unknown>[]; calls: ModelCall[]; health: SystemHealth | null }) {
  return (
    <section className="panel wide">
      <h2>Model Usage & Cache</h2>
      <dl className="metrics">
        <KV label="Input Tokens Today" value={String(health?.token_cost_today?.input_tokens ?? 0)} />
        <KV label="Output Tokens Today" value={String(health?.token_cost_today?.output_tokens ?? 0)} />
        <KV label="Cached Tokens Today" value={String(health?.token_cost_today?.cached_input_tokens ?? 0)} />
        <KV label="Estimated Cost" value={String(health?.token_cost_today?.estimated_cost ?? 0)} />
      </dl>
      <div className="table">
        {usage.map((item, index) => (
          <article key={`${item.provider}-${item.model}-${item.agent}-${index}`} className="row-card compact">
            <strong>{String(item.agent || 'unknown_agent')}</strong>
            <small>{String(item.provider)} / {String(item.model)} · calls {String(item.calls)} · tokens {String(item.input_tokens)}/{String(item.output_tokens)} · cache {String(item.cache_hit_ratio)} · latency {String(item.avg_latency_ms)}</small>
          </article>
        ))}
        {calls.map((call) => (
          <article key={call.id} className="row-card compact">
            <strong>{call.status}</strong>
            <small>{call.provider} / {call.model_name} · {call.input_tokens}/{call.output_tokens} · cached {call.cached_input_tokens} · {call.latency_ms} ms</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConfirmationsPanel({ confirmations, decide }: { confirmations: ConfirmationRecord[]; decide: (id: string, approve: boolean) => Promise<void> }) {
  return (
    <section className="panel wide">
      <h2>Confirmations</h2>
      <div className="table">
        {confirmations.map((item) => (
          <article key={item.id} className="row-card">
            <div>
              <strong>{item.requested_action}</strong>
              <p>{item.capability_id} · {item.risk_level} · {item.status}</p>
              <small>{item.run_id}</small>
            </div>
            {item.status === 'pending' && (
              <div className="row-actions">
                <button type="button" onClick={() => decide(item.id, true)}>Approve</button>
                <button type="button" onClick={() => decide(item.id, false)}>Reject</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({
  settings,
  secretStatus,
  refreshAll,
  setNotice,
}: {
  settings: SettingsRecord | null;
  secretStatus: SecretStatus | null;
  refreshAll: () => Promise<void>;
  setNotice: (value: string) => void;
}) {
  const [secretName, setSecretName] = useState('MODEL_API_KEY');
  const [secretValue, setSecretValue] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [provider, setProvider] = useState(settings?.model_provider ?? 'openai_compatible');
  const [baseURL, setBaseURL] = useState(settings?.model_base_url ?? 'https://api.deepseek.com');
  const [modelName, setModelName] = useState(settings?.model_name ?? 'deepseek-chat');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramAllowed, setTelegramAllowed] = useState(settings?.telegram_allowed_user_ids ?? '');
  const [telegramEnabled, setTelegramEnabled] = useState(settings?.telegram_enabled ?? false);
  const [telegramChatID, setTelegramChatID] = useState('');
  const [workerGatewayEnabled, setWorkerGatewayEnabled] = useState(settings?.worker_gateway_enabled ?? true);
  const [backupDir, setBackupDir] = useState(settings?.backup_dir ?? '');
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(settings?.auto_backup_enabled ?? false);

  useEffect(() => {
    setProvider(settings?.model_provider ?? 'openai_compatible');
    setBaseURL(settings?.model_base_url ?? 'https://api.deepseek.com');
    setModelName(settings?.model_name ?? 'deepseek-chat');
    setTelegramAllowed(settings?.telegram_allowed_user_ids ?? '');
    setTelegramEnabled(settings?.telegram_enabled ?? false);
    setWorkerGatewayEnabled(settings?.worker_gateway_enabled ?? true);
    setBackupDir(settings?.backup_dir ?? '');
    setAutoBackupEnabled(settings?.auto_backup_enabled ?? false);
  }, [settings?.model_provider, settings?.model_base_url, settings?.model_name, settings?.telegram_allowed_user_ids, settings?.telegram_enabled, settings?.worker_gateway_enabled, settings?.backup_dir, settings?.auto_backup_enabled]);

  async function saveSecret() {
    await desktopApi.saveSecret({ name: secretName, value: secretValue });
    setSecretValue('');
    setNotice(`${secretName} saved to Keychain`);
    await refreshAll();
  }

  async function testModel() {
    const result = await desktopApi.testModelConnection();
    setTestStatus(`model: ${result.status}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function saveModel() {
    await desktopApi.saveModelConfig({ provider, base_url: baseURL, name: modelName, timeout_seconds: 60, max_retries: 1 });
    setNotice('Model provider saved');
    await refreshAll();
  }

  async function saveOperationalSettings() {
    await desktopApi.saveOperationalSettings({
      telegram_enabled: telegramEnabled,
      telegram_allowed_user_ids: telegramAllowed,
      worker_gateway_enabled: workerGatewayEnabled,
      backup_dir: backupDir,
      auto_backup_enabled: autoBackupEnabled,
    });
    setNotice('Desktop settings saved');
    await refreshAll();
  }

  async function saveTelegram() {
    await desktopApi.saveTelegramConfig({ token: telegramToken, allowed_user_ids: telegramAllowed, enabled: telegramEnabled });
    setTelegramToken('');
    setNotice('Telegram config saved');
    await refreshAll();
  }

  async function testTelegram() {
    const result = await desktopApi.testTelegramConnection();
    setTestStatus(`telegram: ${result.status}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function sendTelegramTest() {
    const result = await desktopApi.sendTestTelegramMessage({ chat_id: telegramChatID, message: 'Joi Desktop Telegram test' });
    setTestStatus(`telegram message: ${result.status}${result.error_summary ? ` · ${result.error_summary}` : ''}`);
  }

  async function generateWorkerToken() {
    const result = await desktopApi.generateWorkerToken();
    setNotice(`Worker token generated: ${result.token}`);
    await refreshAll();
  }

  async function exportDiagnostics() {
    const result = await desktopApi.exportDiagnostics();
    setNotice(`Diagnostics exported: ${result.path}`);
  }

  return (
    <section className="panel wide">
      <h2>Settings</h2>
      <dl className="metrics">
        <KV label="Version" value={settings?.version ?? '0.1.0-rc0'} />
        <KV label="App Mode" value={settings?.app_mode ?? 'desktop'} />
        <KV label="Data Store" value={settings?.data_store ?? 'sqlite'} />
        <KV label="Task Queue" value={settings?.task_queue ?? 'sqlite'} />
        <KV label="Docker Required" value={String(settings?.docker_required ?? false)} />
        <KV label="Model Provider" value={settings?.model_provider ?? ''} />
        <KV label="Model" value={settings?.model_name ?? ''} />
        <KV label="Telegram" value={settings?.telegram_enabled ? 'configured' : 'not configured'} />
        <KV label="Worker Gateway" value={settings?.worker_gateway ?? ''} />
      </dl>
      <div className="settings-grid">
        <section>
          <h3>Model Provider</h3>
          <div className="control-row">
            <label>
              Provider
              <input value={provider} onChange={(event) => setProvider(event.target.value)} />
            </label>
            <label>
              Base URL
              <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label>
              Model
              <input value={modelName} onChange={(event) => setModelName(event.target.value)} />
            </label>
            <button type="button" onClick={saveModel}>Save Provider</button>
          </div>
        </section>
        <section>
          <h3>Telegram</h3>
          <div className="control-row">
            <label className="check">
              <input checked={telegramEnabled} type="checkbox" onChange={(event) => setTelegramEnabled(event.target.checked)} />
              enabled
            </label>
            <label>
              Bot Token
              <input type="password" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} />
            </label>
            <label>
              Allowed User IDs
              <input value={telegramAllowed} onChange={(event) => setTelegramAllowed(event.target.value)} />
            </label>
            <button type="button" onClick={saveTelegram}>Save Telegram</button>
          </div>
          <div className="control-row">
            <label>
              Test Chat ID
              <input value={telegramChatID} onChange={(event) => setTelegramChatID(event.target.value)} />
            </label>
            <button type="button" onClick={testTelegram}>Test Bot</button>
            <button type="button" onClick={sendTelegramTest}>Send Test Message</button>
          </div>
        </section>
        <section>
          <h3>Runtime</h3>
          <div className="control-row">
            <label className="check">
              <input checked={workerGatewayEnabled} type="checkbox" onChange={(event) => setWorkerGatewayEnabled(event.target.checked)} />
              worker gateway
            </label>
            <label className="check">
              <input checked={autoBackupEnabled} type="checkbox" onChange={(event) => setAutoBackupEnabled(event.target.checked)} />
              auto backup
            </label>
            <label>
              Backup Path
              <input value={backupDir} onChange={(event) => setBackupDir(event.target.value)} />
            </label>
            <button type="button" onClick={saveOperationalSettings}>Save Runtime</button>
          </div>
        </section>
        <section>
          <h3>Secrets</h3>
          <div className="control-row">
            <label>
              Secret
              <select value={secretName} onChange={(event) => setSecretName(event.target.value)}>
                <option value="MODEL_API_KEY">MODEL_API_KEY</option>
                <option value="TELEGRAM_BOT_TOKEN">TELEGRAM_BOT_TOKEN</option>
                <option value="WORKER_TOKEN">WORKER_TOKEN</option>
                <option value="NODE_SECRET">NODE_SECRET</option>
                <option value="ADMIN_TOKEN">ADMIN_TOKEN</option>
              </select>
            </label>
            <label>
              Value
              <input value={secretValue} type="password" onChange={(event) => setSecretValue(event.target.value)} />
            </label>
            <button type="button" onClick={saveSecret}>Save</button>
          </div>
          <div className="secret-status">
            {Object.entries(secretStatus?.secrets ?? {}).map(([name, present]) => (
              <span key={name}>{name}: {present ? 'configured' : 'missing'}</span>
            ))}
          </div>
        </section>
        <section>
          <h3>Connection Tests</h3>
          <div className="control-row">
            <button type="button" onClick={testModel}>Test Model</button>
            <button type="button" onClick={generateWorkerToken}>Generate Worker Token</button>
            <button type="button" onClick={exportDiagnostics}>Export Diagnostics</button>
          </div>
          {testStatus && <p className="empty">{testStatus}</p>}
        </section>
      </div>
      <JsonPreview value={{ sqlite_path: settings?.sqlite_path, log_dir: settings?.log_dir, backup_dir: settings?.backup_dir, model_base_url: settings?.model_base_url }} />
    </section>
  );
}

function BackupsPanel({ backups, createBackup, restoreBackup }: { backups: BackupRecord[]; createBackup: () => Promise<void>; restoreBackup: (path: string) => Promise<void> }) {
  const [path, setPath] = useState('');
  return (
    <section className="panel wide">
      <div className="section-header">
        <h2>Backups</h2>
        <button type="button" onClick={createBackup}>Create Backup</button>
      </div>
      <div className="control-row">
        <input placeholder="Backup path" value={path} onChange={(event) => setPath(event.target.value)} />
        <button disabled={!path.trim()} type="button" onClick={() => restoreBackup(path.trim())}>Restore</button>
      </div>
      <div className="table">
        {backups.map((backup) => (
          <article key={backup.path} className="row-card compact">
            <strong>{backup.name}</strong>
            <small>{backup.modified} · {Math.round(backup.size / 1024)} KB</small>
            <small>{backup.path}</small>
            <button type="button" onClick={() => restoreBackup(backup.path)}>Restore</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function compact(value: unknown) {
  const raw = JSON.stringify(value);
  if (!raw) return '';
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;
}
