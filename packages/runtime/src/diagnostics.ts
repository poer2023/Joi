import { Socket } from 'node:net';
import { arch, freemem, loadavg, platform, totalmem } from 'node:os';
import type { CapabilityResult } from './capabilities.ts';

export type ServerDiagnoseRequest = {
  service_name?: string;
  host?: string;
  port?: unknown;
  url?: string;
};

export function executeSystemHealthCheck(health: Record<string, unknown>): CapabilityResult {
  const serviceStatus = isObject(health.service_status) ? health.service_status : {};
  const unhealthy = Object.entries(serviceStatus)
    .filter(([, value]) => value === false || value === 'failed' || value === 'error')
    .map(([key]) => key);
  return {
    status: 'completed',
    health,
    service_status: serviceStatus,
    queue_status: health.queue_status || {},
    worker_status: health.worker_status || [],
    warnings: health.warnings || [],
    unhealthy,
    summary: unhealthy.length > 0
      ? `System health check completed with unhealthy service(s): ${unhealthy.join(', ')}.`
      : 'System health check completed with no unhealthy services reported.',
    mode: 'system_health_check_v1_ts_store',
  };
}

export async function executeServerDiagnose(req: ServerDiagnoseRequest): Promise<CapabilityResult> {
  const service = req.service_name?.trim() || 'unknown';
  const host = req.host?.trim() || '127.0.0.1';
  const port = positivePort(req.port);
  const url = req.url?.trim() || '';
  const portResult = port > 0 ? await checkPort(host, port, 1200) : { status: 'not_requested' };
  const httpResult = url ? await httpProbe(url) : { status: 'not_requested' };
  const memory = {
    total_bytes: totalmem(),
    free_bytes: freemem(),
    used_ratio: totalmem() > 0 ? Number(((totalmem() - freemem()) / totalmem()).toFixed(4)) : 0,
    loadavg: loadavg(),
  };
  const issues: string[] = [];
  if (port > 0 && portResult.status !== 'open') issues.push('port_not_open');
  if (url && httpResult.status !== 'reachable') issues.push('http_unreachable');
  return {
    status: 'completed',
    service,
    host,
    port: portResult,
    http: httpResult,
    docker: {
      required: false,
      skipped: true,
      reason: 'Electron TS diagnostics do not require Docker by default.',
    },
    system: {
      platform: platform(),
      arch: arch(),
      memory,
    },
    issues,
    summary: issues.length > 0
      ? `server_diagnose completed for ${service}; issues: ${issues.join(', ')}.`
      : `server_diagnose completed for ${service}; no requested probe failed.`,
    mode: 'server_diagnose_v1_ts_readonly',
  };
}

function checkPort(host: string, port: number, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolveResult) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult({ host, port, ...result });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ status: 'open' }));
    socket.once('timeout', () => finish({ status: 'timeout' }));
    socket.once('error', (error) => finish({ status: 'closed', error: error.message }));
    socket.connect(port, host);
  });
}

async function httpProbe(rawURL: string): Promise<Record<string, unknown>> {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    return { status: 'policy_blocked', reason: 'invalid_url', url: rawURL };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { status: 'policy_blocked', reason: 'only_http_https_allowed', url: rawURL };
  }
  if (parsed.hostname === '169.254.169.254' || parsed.hostname.startsWith('169.254.')) {
    return { status: 'policy_blocked', reason: 'metadata_ip_blocked', url: rawURL };
  }
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Joi-Electron-ServerDiagnose/0.1' },
    });
    return {
      status: 'reachable',
      url: parsed.toString(),
      status_code: response.status,
      content_type: response.headers.get('content-type') || '',
    };
  } catch (error) {
    return {
      status: 'failed',
      url: parsed.toString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function positivePort(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 65535) return 0;
  return number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
