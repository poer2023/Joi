import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { WorkspaceSettings } from '../../shared-types/src/desktop-api';

export type WorkspaceSearchRequest = {
  root?: string;
  query?: string;
  goal?: string;
  glob?: string;
  max_results?: number;
};

export type FileReadRequest = {
  path?: string;
  start_line?: number;
  end_line?: number;
  max_bytes?: number;
};

export type FileAnalyzeRequest = {
  path?: string;
  question?: string;
  goal?: string;
};

export type WebResearchRequest = {
  url?: string;
  query?: string;
  max_results?: number;
};

export type WebResearchExecutionOptions = {
  enforcePublicOnly?: boolean;
  maxRedirects?: number;
  resolveHost?: (hostname: string) => Promise<ReadonlyArray<LookupAddress>>;
};

export type CapabilityResult = {
  status: 'completed' | 'failed' | 'policy_blocked';
  mode: string;
  summary: string;
  [key: string]: unknown;
};

const defaultFileAnalyzeMaxBytes = 256 * 1024;
const absoluteFileReadMaxBytes = 512 * 1024;
const defaultWorkspaceSearchMaxResults = 50;
const maxWorkspaceSearchResults = 200;
const maxFileAnalyzeExcerpts = 12;
const maxFileAnalyzeSnippetBytes = 220;
const maxReadableTextRunes = 12000;
const maxReadableSummaryRunes = 900;
const defaultWebSearchResults = 6;
const maxWebSearchResults = 10;
const braveSearchMinimumIntervalMs = 1200;
const webSearchSnippetVerificationNote = 'Search results are provider snippets and have not verified the linked page content.';
const webResearchMaxBytes = 1024 * 1024;
const webResearchMaxRedirects = 5;
const webResearchTimeoutMs = 15_000;

let nextBraveSearchAllowedAt = 0;

export function executeUnsupportedCapability(capability: string, req: Record<string, unknown> = {}, reason = 'not_configured'): CapabilityResult {
  const normalizedCapability = capability.trim() || 'unknown';
  return {
    status: 'policy_blocked',
    capability: normalizedCapability,
    reason,
    requested_input: redactCapabilityInput(req),
    summary: `${normalizedCapability} 已注册到本地工具目录，但当前 Joi runtime 尚未连接对应后端，因此没有执行。`,
    mode: 'capability_registry_v1_not_configured',
  };
}

const searchableExtensions = new Set([
  'css', 'go', 'html', 'js', 'json', 'jsx', 'md', 'mdx', 'mjs', 'py', 'sql', 'ts', 'tsx', 'txt', 'yaml', 'yml',
]);

const readableExtensions = new Set([
  ...searchableExtensions,
  'c', 'cc', 'cpp', 'h', 'hpp', 'java', 'kt', 'kts', 'm', 'mm', 'mod', 'php', 'rb', 'rs', 'sh', 'swift', 'toml', 'xml',
]);

function redactCapabilityInput(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(redactCapabilityInput);
  if (typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/key|secret|token|password|credential|authorization/i.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactCapabilityInput(item);
    }
  }
  return result;
}

export function executeWorkspaceSearch(req: WorkspaceSearchRequest, settings: WorkspaceSettings): CapabilityResult {
  const normalized = normalizeWorkspaceSettings(settings);
  const root = resolveWorkspacePath(req.root || normalized.default_root, normalized);
  const info = statSync(root);
  if (!info.isDirectory()) throw new Error('workspace_search root must be a directory');
  const query = (req.query || req.goal || '').trim();
  if (!query) throw new Error('workspace_search query is required');
  const tokens = queryTokens(query);
  const maxResults = boundedLimit(req.max_results, normalized.workspace_search_max_results || defaultWorkspaceSearchMaxResults, maxWorkspaceSearchResults);
  const results: Array<{ path: string; line: number; snippet: string; truncated: boolean }> = [];
  let truncated = false;
  walkWorkspace(root, normalized, (path) => {
    if (results.length >= maxResults) {
      truncated = true;
      return false;
    }
    if (req.glob && !globMatches(path, req.glob)) return true;
    if (!searchableExtensions.has(extension(path))) return true;
    const matches = searchFile(path, root, tokens, maxResults - results.length);
    results.push(...matches);
    if (matches.length >= maxResults) truncated = true;
    return results.length < maxResults;
  });
  results.sort((a, b) => a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path));
  const summary = `在 ${root} 中搜索 "${query}"，命中 ${results.length} 条。${truncated ? ' 结果已按上限截断。' : ''}`;
  return {
    status: 'completed',
    query,
    root,
    glob: req.glob || '',
    max_results: maxResults,
    results,
    truncated,
    summary,
    mode: 'workspace_search_v1_ts_walk',
  };
}

export function executeFileRead(req: FileReadRequest, settings: WorkspaceSettings): CapabilityResult {
  const normalized = normalizeWorkspaceSettings(settings);
  const pathInput = req.path?.trim();
  if (!pathInput) throw new Error('file_read path is required');
  const path = resolveWorkspacePath(pathInput, normalized);
  const info = statSync(path);
  if (info.isDirectory()) throw new Error('file_read path must be a file');
  const ext = extension(path);
  if (!readableExtensions.has(ext)) throw new Error(`file_read unsupported extension: ${ext}`);
  const startLine = positiveInteger(req.start_line, 1);
  const endLine = positiveInteger(req.end_line, 0);
  if (endLine > 0 && endLine < startLine) throw new Error('file_read end_line must be greater than or equal to start_line');
  const maxBytes = boundedFileReadBytes(req.max_bytes, normalized.file_analyze_max_bytes);
  const { content, lines, scannedLines, lastReturnedLine, truncated } = readBoundedLineRange(path, startLine, endLine, maxBytes);
  const reportedEndLine = endLine > 0 ? endLine : lastReturnedLine;
  const summary = `已读取授权 workspace 文件 ${path} 的 ${lines.length} 行，字节上限 ${maxBytes}。${truncated ? ' 内容已按上限截断。' : ''}`;
  return {
    status: 'completed',
    path,
    size: info.size,
    extension: ext,
    start_line: startLine,
    end_line: reportedEndLine,
    scanned_lines: scannedLines,
    last_returned_line: lastReturnedLine,
    line_count: lines.length,
    content,
    lines,
    truncated,
    max_bytes: maxBytes,
    summary,
    mode: 'file_read_v1_bounded_lines',
  };
}

export function executeFileAnalyze(req: FileAnalyzeRequest, settings: WorkspaceSettings): CapabilityResult {
  const normalized = normalizeWorkspaceSettings(settings);
  const pathInput = req.path?.trim();
  if (!pathInput) throw new Error('file_analyze path is required');
  const path = resolveWorkspacePath(pathInput, normalized);
  const info = statSync(path);
  if (info.isDirectory()) throw new Error('file_analyze path must be a file');
  const ext = extension(path);
  if (!readableExtensions.has(ext)) throw new Error(`file_analyze unsupported extension: ${ext}`);
  const maxBytes = boundedLimit(normalized.file_analyze_max_bytes, defaultFileAnalyzeMaxBytes, absoluteFileReadMaxBytes);
  const raw = readFileSync(path);
  const truncated = raw.length > maxBytes;
  const text = decodeUTF8(raw.subarray(0, maxBytes));
  const question = (req.question || req.goal || '').trim();
  const excerpts = selectExcerpts(text, question);
  const summary = summarizeFile(path, text, question, excerpts, truncated);
  return {
    status: 'completed',
    path,
    size: info.size,
    extension: ext,
    summary,
    excerpts,
    truncated,
    max_bytes: maxBytes,
    mode: 'file_analyze_v1_bounded_read',
  };
}

export async function executeWebResearch(
  req: WebResearchRequest,
  settings: WorkspaceSettings,
  options: WebResearchExecutionOptions = {},
): Promise<CapabilityResult> {
  const url = req.url?.trim() || '';
  const query = req.query?.trim() || '';
  if (!url && query) return executeWebSearch(query, req.max_results, settings);
  if (!url) throw new Error('web_research requires url or query');
  const blockedReason = blockedResearchURL(url, settings, Boolean(options.enforcePublicOnly));
  if (blockedReason) {
    return {
      status: 'policy_blocked',
      url,
      fetch_status: 'policy_blocked',
      reason: blockedReason,
      summary: `policy_blocked：${blockedReason}`,
      mode: 'web_research_v3_pinned_public_fetch',
    };
  }
  try {
    const response = await fetchValidatedWebResearchURL(url, settings, options);
    const finalURL = response.finalURL;
    const body = decodeUTF8(response.body);
    const extraction = extractReadableHTML(body);
    const readable = truncateRunes(extraction.text, maxReadableTextRunes);
    const links = [...body.matchAll(/href=["']([^"']+)["']/gi)].slice(0, 20).map((match) => match[1]);
    return {
      status: response.statusCode >= 200 && response.statusCode < 300 ? 'completed' : 'failed',
      url,
      final_url: finalURL,
      fetch_status: response.statusCode >= 200 && response.statusCode < 300 ? 'succeeded' : 'http_error',
      status_code: response.statusCode,
      content_type: headerValue(response.headers, 'content-type'),
      title: extraction.title,
      readable_text: readable.text,
      text_length: [...readable.text].length,
      links,
      summary: summarizeReadableText(readable.text),
      extraction: {
        source: extraction.source,
        readable_text_truncated: readable.truncated,
      },
      truncated: response.truncated,
      redirect_count: response.redirectCount,
      mode: 'web_research_v3_pinned_public_fetch',
    };
  } catch (error) {
    if (error instanceof WebResearchPolicyError) {
      return {
        status: 'policy_blocked',
        url,
        final_url: error.url,
        fetch_status: 'policy_blocked',
        reason: error.reason,
        summary: `policy_blocked：${error.reason}`,
        mode: 'web_research_v3_pinned_public_fetch',
      };
    }
    return {
      status: 'failed',
      url,
      fetch_status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      summary: `web_research failed: ${error instanceof Error ? error.message : String(error)}`,
      mode: 'web_research_v3_pinned_public_fetch',
    };
  }
}

export function executePublicWebExtract(
  req: WebResearchRequest,
  settings: WorkspaceSettings,
  options: Omit<WebResearchExecutionOptions, 'enforcePublicOnly'> = {},
): Promise<CapabilityResult> {
  return executeWebResearch(req, settings, { ...options, enforcePublicOnly: true });
}

async function executeWebSearch(query: string, maxResultsInput: unknown, settings: WorkspaceSettings): Promise<CapabilityResult> {
  const maxResults = boundedLimit(maxResultsInput, defaultWebSearchResults, maxWebSearchResults);
  const provider = normalizeWebSearchProvider(settings.web_search_provider);
  const braveKey = settings.brave_search_api_key?.trim() || '';
  if (provider === 'brave' || (provider === 'auto' && braveKey)) {
    if (!braveKey) {
      return {
        status: 'failed',
        query,
        retrieved_at: new Date().toISOString(),
        fetch_status: 'missing_api_key',
        provider: 'brave',
        verification_note: webSearchSnippetVerificationNote,
        result_count: 0,
        results: [],
        summary: 'Brave Search API key is not configured.',
        mode: 'web_search_v1_brave_api',
      };
    }
    const braveResult = await executeBraveWebSearch(query, maxResults, braveKey);
    if (provider === 'brave' || braveResult.status === 'completed') return braveResult;
  }
  return executeDuckDuckGoWebSearch(query, maxResults);
}

async function waitForBraveSearchSlot(): Promise<number> {
  const now = Date.now();
  const delayMs = Math.max(0, nextBraveSearchAllowedAt - now);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return delayMs;
}

function markBraveSearchSlotComplete(): void {
  nextBraveSearchAllowedAt = Date.now() + braveSearchMinimumIntervalMs;
}

async function executeBraveWebSearch(query: string, maxResults: number, apiKey: string): Promise<CapabilityResult> {
  const searchURL = new URL('https://api.search.brave.com/res/v1/web/search');
  searchURL.searchParams.set('q', query);
  searchURL.searchParams.set('count', String(maxResults));
  const rateLimitDelayMs = await waitForBraveSearchSlot();
  try {
    const response = await fetch(searchURL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'Joi-Electron-WebResearch/0.1',
        'X-Subscription-Token': apiKey,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
    } catch {
      parsed = { raw_text: truncateRunes(body, 1200).text };
    }
    const results = parseBraveSearchResults(parsed).slice(0, maxResults);
    const ok = response.ok && results.length > 0;
    return {
      status: ok ? 'completed' : 'failed',
      query,
      provider: 'brave',
      retrieved_at: new Date().toISOString(),
      verification_note: webSearchSnippetVerificationNote,
      rate_limit_delay_ms: rateLimitDelayMs,
      fetch_status: response.ok ? results.length > 0 ? 'succeeded' : 'no_results' : 'http_error',
      status_code: response.status,
      results,
      result_count: results.length,
      summary: ok
        ? `Brave 搜索 "${query}"，返回 ${results.length} 条未验证摘要结果。`
        : `Brave web_search failed: ${response.ok ? 'no_results' : `HTTP ${response.status}`}`,
      mode: 'web_search_v1_brave_api',
      raw: ok ? undefined : parsed,
    };
  } catch (error) {
    return {
      status: 'failed',
      query,
      provider: 'brave',
      retrieved_at: new Date().toISOString(),
      verification_note: webSearchSnippetVerificationNote,
      rate_limit_delay_ms: rateLimitDelayMs,
      fetch_status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      results: [],
      result_count: 0,
      summary: `Brave web_search failed: ${error instanceof Error ? error.message : String(error)}`,
      mode: 'web_search_v1_brave_api',
    };
  } finally {
    markBraveSearchSlotComplete();
  }
}

async function executeDuckDuckGoWebSearch(query: string, maxResults: number): Promise<CapabilityResult> {
  const searchURL = new URL('https://duckduckgo.com/html/');
  searchURL.searchParams.set('q', query);
  try {
    const response = await fetch(searchURL, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Joi-Electron-WebResearch/0.1)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    const results = parseDuckDuckGoResults(body).slice(0, maxResults);
    const ok = response.ok && results.length > 0;
    return {
      status: ok ? 'completed' : 'failed',
      query,
      provider: 'duckduckgo',
      retrieved_at: new Date().toISOString(),
      verification_note: webSearchSnippetVerificationNote,
      fetch_status: response.ok ? results.length > 0 ? 'succeeded' : 'no_results' : 'http_error',
      status_code: response.status,
      results,
      result_count: results.length,
      summary: ok
        ? `DuckDuckGo 搜索 "${query}"，返回 ${results.length} 条未验证摘要结果。`
        : `web_search failed: ${response.ok ? 'no_results' : `HTTP ${response.status}`}`,
      mode: 'web_search_v1_duckduckgo_html',
    };
  } catch (error) {
    return {
      status: 'failed',
      query,
      provider: 'duckduckgo',
      retrieved_at: new Date().toISOString(),
      verification_note: webSearchSnippetVerificationNote,
      fetch_status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      results: [],
      result_count: 0,
      summary: `web_search failed: ${error instanceof Error ? error.message : String(error)}`,
      mode: 'web_search_v1_duckduckgo_html',
    };
  }
}

export function resolveWorkspacePath(pathInput: string, settings: WorkspaceSettings): string {
  const normalized = normalizeWorkspaceSettings(settings);
  const raw = pathInput.trim();
  if (!raw) throw new Error('workspace path is required');
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(normalized.default_root, raw);
  const real = realpathSync(candidate);
  if (!normalized.allowed_roots.some((root) => pathWithinRoot(real, root))) {
    throw new Error('workspace path is outside allowed roots');
  }
  return real;
}

export function normalizeWorkspaceSettings(settings: WorkspaceSettings): WorkspaceSettings {
  const allowedRoots = [...new Set((settings.allowed_roots || []).map((root) => realpathSync(resolve(root))))];
  if (allowedRoots.length === 0) throw new Error('workspace.allowed_roots must include at least one root');
  const defaultRoot = settings.default_root ? realpathSync(resolve(settings.default_root)) : allowedRoots[0];
  if (!allowedRoots.some((root) => pathWithinRoot(defaultRoot, root))) {
    throw new Error('workspace.default_root must be inside workspace.allowed_roots');
  }
  return {
    ...settings,
    allowed_roots: allowedRoots,
    default_root: defaultRoot,
    browser_allowed_hosts: [...new Set((settings.browser_allowed_hosts || []).map((host) => host.trim().toLowerCase()).filter(Boolean))],
    web_search_provider: normalizeWebSearchProvider(settings.web_search_provider),
    brave_search_api_key: settings.brave_search_api_key?.trim() || '',
    brave_search_api_key_configured: Boolean(settings.brave_search_api_key_configured || settings.brave_search_api_key?.trim()),
    file_analyze_max_bytes: positiveInteger(settings.file_analyze_max_bytes, defaultFileAnalyzeMaxBytes),
    workspace_search_max_results: boundedLimit(settings.workspace_search_max_results, defaultWorkspaceSearchMaxResults, maxWorkspaceSearchResults),
  };
}

export function webResearchBlockReason(rawURL: string, settings: WorkspaceSettings): string {
  return blockedResearchURL(rawURL, settings);
}

type WebResearchHTTPResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
};

type ValidatedWebResearchResponse = WebResearchHTTPResponse & {
  finalURL: string;
  redirectCount: number;
};

type IPBlockReason = {
  reason: string;
  allowWithExplicitPrivateHost: boolean;
};

class WebResearchPolicyError extends Error {
  readonly reason: string;
  readonly url: string;

  constructor(reason: string, url: string) {
    super(reason);
    this.name = 'WebResearchPolicyError';
    this.reason = reason;
    this.url = url;
  }
}

async function fetchValidatedWebResearchURL(
  rawURL: string,
  settings: WorkspaceSettings,
  options: WebResearchExecutionOptions,
): Promise<ValidatedWebResearchResponse> {
  const publicOnly = Boolean(options.enforcePublicOnly);
  const maxRedirects = boundedLimit(options.maxRedirects, webResearchMaxRedirects, webResearchMaxRedirects);
  const resolveHost = options.resolveHost || resolveWebResearchHost;
  const signal = AbortSignal.timeout(webResearchTimeoutMs);
  let current = rawURL;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const blockedReason = blockedResearchURL(current, settings, publicOnly);
    if (blockedReason) throw new WebResearchPolicyError(blockedReason, current);
    const parsed = new URL(current);
    const address = await validatedPinnedAddress(parsed, settings, publicOnly, resolveHost, !options.resolveHost);
    const response = await requestPinnedWebResearchURL(parsed, address, signal);
    const location = headerValue(response.headers, 'location');
    if (!isRedirectStatus(response.statusCode) || !location) {
      return {
        ...response,
        finalURL: parsed.toString(),
        redirectCount,
      };
    }
    if (redirectCount >= maxRedirects) {
      throw new WebResearchPolicyError('too_many_redirects', parsed.toString());
    }
    try {
      current = new URL(location, parsed).toString();
    } catch {
      throw new WebResearchPolicyError('invalid_redirect_url', parsed.toString());
    }
  }

  throw new WebResearchPolicyError('too_many_redirects', current);
}

async function resolveWebResearchHost(hostname: string): Promise<ReadonlyArray<LookupAddress>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function resolveTrustedPublicDNS(hostname: string): Promise<ReadonlyArray<LookupAddress>> {
  const providers = [
    { baseURL: 'https://1.1.1.1/dns-query', queryKey: 'name' },
    { baseURL: 'https://8.8.8.8/resolve', queryKey: 'name' },
  ];
  let lastError: unknown;
  for (const provider of providers) {
    const queries = await Promise.allSettled([
      resolveTrustedDNSRecordType(provider, hostname, 'A', 4),
      resolveTrustedDNSRecordType(provider, hostname, 'AAAA', 6),
    ]);
    const addresses = queries.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (addresses.length > 0) return addresses;
    lastError = queries.find((result) => result.status === 'rejected')?.reason || lastError;
  }
  throw lastError instanceof Error ? lastError : new Error(`Trusted public DNS returned no addresses for ${hostname}`);
}

async function resolveTrustedDNSRecordType(
  provider: { baseURL: string; queryKey: string },
  hostname: string,
  recordType: 'A' | 'AAAA',
  family: 4 | 6,
): Promise<LookupAddress[]> {
  const url = new URL(provider.baseURL);
  url.searchParams.set(provider.queryKey, hostname);
  url.searchParams.set('type', recordType);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Trusted public DNS failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 128 * 1024) throw new Error('Trusted public DNS response exceeds 128 KiB');
  const payload = JSON.parse(decodeUTF8(bytes)) as { Status?: unknown; Answer?: Array<{ type?: unknown; data?: unknown }> };
  if (Number(payload.Status || 0) !== 0) return [];
  const expectedType = family === 4 ? 1 : 28;
  return (Array.isArray(payload.Answer) ? payload.Answer : [])
    .filter((answer) => Number(answer?.type) === expectedType && isIP(String(answer?.data || '')) === family)
    .map((answer) => ({ address: String(answer.data), family }));
}

async function validatedPinnedAddress(
  url: URL,
  settings: WorkspaceSettings,
  publicOnly: boolean,
  resolveHost: (hostname: string) => Promise<ReadonlyArray<LookupAddress>>,
  allowTrustedDNSFallback: boolean,
): Promise<LookupAddress> {
  const hostname = normalizedURLHostname(url);
  const literalFamily = isIP(hostname);
  let addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : [...await resolveHost(hostname)];
  if (
    !literalFamily
    && allowTrustedDNSFallback
    && addresses.length > 0
    && addresses.every((entry) => isFakeDNSAddress(String(entry.address)))
  ) {
    // OpenClash fake-IP DNS deliberately returns 198.18/15. Never connect to that
    // reserved address: resolve through fixed-IP HTTPS DNS, then validate and pin
    // every real answer below exactly like an ordinary system-DNS result.
    addresses = [...await resolveTrustedPublicDNS(hostname)];
  }
  if (addresses.length === 0) throw new Error(`DNS returned no addresses for ${hostname}`);

  const uniqueAddresses = [...new Map(addresses.map((entry) => [
    `${entry.family}:${entry.address}`,
    { address: String(entry.address), family: Number(entry.family) },
  ])).values()];
  for (const address of uniqueAddresses) {
    if ((address.family !== 4 && address.family !== 6) || isIP(address.address) !== address.family) {
      throw new WebResearchPolicyError('invalid_dns_address', url.toString());
    }
    const blocked = blockedIPAddress(address.address);
    if (!blocked) continue;
    const explicitlyAllowed = !publicOnly
      && blocked.allowWithExplicitPrivateHost
      && privateResearchHostAllowed(hostname, url.host.toLowerCase(), settings);
    if (!explicitlyAllowed) throw new WebResearchPolicyError(blocked.reason, url.toString());
  }

  const selected = uniqueAddresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function isFakeDNSAddress(address: string): boolean {
  return isIP(address) === 4 && ipv4InCIDR(ipv4Number(address), '198.18.0.0', 15);
}

function requestPinnedWebResearchURL(
  url: URL,
  address: LookupAddress,
  signal: AbortSignal,
): Promise<WebResearchHTTPResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    const finish = (response: WebResearchHTTPResponse) => {
      if (settled) return;
      settled = true;
      resolveRequest(response);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectRequest(error);
    };
    const pinnedLookup: LookupFunction = (_hostname, _lookupOptions, callback) => {
      callback(null, address.address, address.family);
    };
    const requestOptions: RequestOptions = {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Joi-Electron-WebResearch/0.1',
      },
      // A fresh socket plus the pinned lookup closes the DNS validation/connect
      // TOCTOU window. HTTPS still verifies the original URL hostname below.
      agent: false,
      family: address.family,
      lookup: pinnedLookup,
      signal,
    };
    const onResponse = (response: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      response.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = webResearchMaxBytes - bytes;
        if (remaining > 0) {
          const accepted = buffer.subarray(0, remaining);
          chunks.push(accepted);
          bytes += accepted.length;
        }
        if (buffer.length > remaining) {
          truncated = true;
          finish({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks, bytes),
            truncated,
          });
          response.destroy();
        }
      });
      response.once('end', () => finish({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks, bytes),
        truncated,
      }));
      response.once('error', fail);
    };
    const request = url.protocol === 'https:'
      ? httpsRequest(url, {
        ...requestOptions,
        rejectUnauthorized: true,
        servername: normalizedURLHostname(url),
      }, onResponse)
      : httpRequest(url, requestOptions, onResponse);
    request.once('error', fail);
    request.end();
  });
}

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function isRedirectStatus(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function walkWorkspace(root: string, settings: WorkspaceSettings, visit: (path: string) => boolean): boolean {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (shouldSkip(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const real = realpathSync(path);
      if (!settings.allowed_roots.some((allowed) => pathWithinRoot(real, allowed))) continue;
      if (!walkWorkspace(real, settings, visit)) return false;
      continue;
    }
    if (!entry.isFile()) continue;
    if (lstatSync(path).isSymbolicLink()) continue;
    if (!visit(path)) return false;
  }
  return true;
}

function searchFile(path: string, root: string, tokens: string[], limit: number) {
  const raw = readFileSync(path);
  const maxBytes = Math.min(raw.length, absoluteFileReadMaxBytes);
  const text = decodeUTF8(raw.subarray(0, maxBytes));
  const lines = text.split(/\r?\n/);
  const results: Array<{ path: string; line: number; snippet: string; truncated: boolean }> = [];
  for (let index = 0; index < lines.length && results.length < limit; index++) {
    const lower = lines[index].toLowerCase();
    if (tokens.every((token) => lower.includes(token))) {
      results.push({
        path: relative(root, path) || path,
        line: index + 1,
        snippet: redactSensitiveText(trimSnippet(lines[index], 240)),
        truncated: raw.length > maxBytes,
      });
    }
  }
  return results;
}

function readBoundedLineRange(path: string, startLine: number, endLine: number, maxBytes: number) {
  const text = decodeUTF8(readFileSync(path));
  const sourceLines = text.split(/(\n)/);
  let logicalLine = 1;
  let scannedLines = 0;
  let lastReturnedLine = 0;
  let writtenBytes = 0;
  let content = '';
  let truncated = false;
  const lines: Array<{ line: number; text: string; truncated: boolean }> = [];
  for (let index = 0; index < sourceLines.length; index += 2) {
    const rawLine = sourceLines[index] || '';
    const newline = sourceLines[index + 1] || '';
    scannedLines = logicalLine;
    if (logicalLine >= startLine && (endLine <= 0 || logicalLine <= endLine)) {
      const redacted = redactSensitiveText(rawLine.replace(/\r$/, ''));
      const piece = `${redacted}${newline}`;
      const bytes = Buffer.byteLength(piece);
      if (writtenBytes + bytes > maxBytes) {
        const remaining = maxBytes - writtenBytes;
        if (remaining > 0) {
          const partial = truncateUTF8Bytes(piece, remaining);
          content += partial;
          lines.push({ line: logicalLine, text: partial.replace(/\n$/, ''), truncated: true });
          lastReturnedLine = logicalLine;
        }
        truncated = true;
        break;
      }
      content += piece;
      writtenBytes += bytes;
      lines.push({ line: logicalLine, text: redacted, truncated: false });
      lastReturnedLine = logicalLine;
    }
    if (endLine > 0 && logicalLine >= endLine) break;
    logicalLine++;
  }
  return { content, lines, scannedLines, lastReturnedLine, truncated };
}

function selectExcerpts(text: string, question: string) {
  const tokens = queryTokens(question);
  const lines = text.split(/\r?\n/);
  const excerpts: Array<{ line: number; snippet: string }> = [];
  for (let index = 0; index < lines.length && excerpts.length < maxFileAnalyzeExcerpts; index++) {
    const lower = lines[index].toLowerCase();
    if (tokens.length === 0 || tokens.some((token) => lower.includes(token))) {
      const snippet = redactSensitiveText(trimSnippet(lines[index], maxFileAnalyzeSnippetBytes));
      if (snippet) excerpts.push({ line: index + 1, snippet });
    }
  }
  if (excerpts.length === 0 && lines[0]) {
    excerpts.push({ line: 1, snippet: redactSensitiveText(trimSnippet(lines[0], maxFileAnalyzeSnippetBytes)) });
  }
  return excerpts;
}

function summarizeFile(path: string, text: string, question: string, excerpts: unknown[], truncated: boolean): string {
  const basis = question ? `围绕 "${question}" ` : '';
  return `${basis}分析授权文件 ${path}，提取 ${excerpts.length} 条摘录。${truncated ? ' 内容已按上限截断。' : ''} 文件长度约 ${text.length} 字符。`;
}

function blockedResearchURL(rawURL: string, settings: WorkspaceSettings, publicOnly = false): string {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    return 'invalid_url';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'only_public_http_https_allowed';
  if (parsed.username || parsed.password) return 'url_credentials_not_allowed';
  const host = normalizedURLHostname(parsed);
  if (!host) return 'missing_host';
  const hostPort = parsed.host.toLowerCase();
  if (isMetadataHostname(host)) return 'metadata_host_blocked';
  if (isPrivateHostname(host)) {
    return !publicOnly && privateResearchHostAllowed(host, hostPort, settings) ? '' : 'private_host_not_allowed';
  }
  if (isIP(host)) {
    const blocked = blockedIPAddress(host);
    if (!blocked) return '';
    if (!publicOnly && blocked.allowWithExplicitPrivateHost && privateResearchHostAllowed(host, hostPort, settings)) return '';
    return blocked.reason;
  }
  return '';
}

function privateResearchHostAllowed(host: string, hostPort: string, settings: WorkspaceSettings): boolean {
  if (!settings.web_research_allow_private_hosts) return false;
  const allowed = (settings.browser_allowed_hosts || []).map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(host) || allowed.includes(hostPort);
}

function normalizedURLHostname(url: URL): string {
  const hostname = url.hostname.trim().toLowerCase().replace(/\.$/, '');
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isMetadataHostname(host: string): boolean {
  return [
    'metadata',
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
    'instance-data.ec2.internal',
  ].includes(host);
}

function isPrivateHostname(host: string): boolean {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.localdomain')
    || host.endsWith('.lan')
    || host.endsWith('.home.arpa');
}

function blockedIPAddress(address: string): IPBlockReason | undefined {
  const family = isIP(address);
  if (family === 4) return blockedIPv4Address(address);
  if (family === 6) return blockedIPv6Address(address);
  return { reason: 'invalid_ip_address', allowWithExplicitPrivateHost: false };
}

function blockedIPv4Address(address: string): IPBlockReason | undefined {
  const value = ipv4Number(address);
  if (address === '169.254.169.254') return { reason: 'metadata_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv4InCIDR(value, '0.0.0.0', 8)) return { reason: 'unspecified_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv4InCIDR(value, '10.0.0.0', 8)) return { reason: 'private_host_not_allowed', allowWithExplicitPrivateHost: true };
  if (ipv4InCIDR(value, '100.64.0.0', 10)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv4InCIDR(value, '127.0.0.0', 8)) return { reason: 'private_host_not_allowed', allowWithExplicitPrivateHost: true };
  if (ipv4InCIDR(value, '169.254.0.0', 16)) return { reason: 'link_local_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv4InCIDR(value, '172.16.0.0', 12)) return { reason: 'private_host_not_allowed', allowWithExplicitPrivateHost: true };
  if (ipv4InCIDR(value, '192.168.0.0', 16)) return { reason: 'private_host_not_allowed', allowWithExplicitPrivateHost: true };
  for (const [base, prefix] of [
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.31.196.0', 24],
    ['192.52.193.0', 24],
    ['192.88.99.0', 24],
    ['192.175.48.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    if (ipv4InCIDR(value, base, prefix)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  }
  return undefined;
}

function blockedIPv6Address(address: string): IPBlockReason | undefined {
  const value = ipv6Number(address);
  if (value === undefined) return { reason: 'invalid_ip_address', allowWithExplicitPrivateHost: false };
  if (value === ipv6Number('fd00:ec2::254')) return { reason: 'metadata_ip_blocked', allowWithExplicitPrivateHost: false };
  if (value === 0n) return { reason: 'unspecified_ip_blocked', allowWithExplicitPrivateHost: false };
  if (value === 1n || ipv6InCIDR(value, 'fc00::', 7)) {
    return { reason: 'private_host_not_allowed', allowWithExplicitPrivateHost: true };
  }
  if (ipv6InCIDR(value, 'fe80::', 10)) return { reason: 'link_local_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv6InCIDR(value, 'ff00::', 8)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  if (ipv6InCIDR(value, '::ffff:0:0', 96)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  if (!ipv6InCIDR(value, '2000::', 3)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  for (const [base, prefix] of [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['2620:4f:8000::', 48],
    ['3fff::', 20],
  ] as const) {
    if (ipv6InCIDR(value, base, prefix)) return { reason: 'special_use_ip_blocked', allowWithExplicitPrivateHost: false };
  }
  return undefined;
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function ipv4InCIDR(value: number, base: string, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  const start = ipv4Number(base);
  return value >= start && value < start + size;
}

function ipv6Number(address: string): bigint | undefined {
  const normalized = address.toLowerCase().split('%')[0];
  const doubleColon = normalized.indexOf('::');
  if (doubleColon !== normalized.lastIndexOf('::')) return undefined;
  const [leftRaw, rightRaw = ''] = doubleColon >= 0
    ? [normalized.slice(0, doubleColon), normalized.slice(doubleColon + 2)]
    : [normalized, ''];
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const expandEmbeddedIPv4 = (parts: string[]): string[] => {
    if (parts.length === 0 || !parts.at(-1)?.includes('.')) return parts;
    const ipv4 = parts.at(-1) || '';
    if (isIP(ipv4) !== 4) return ['invalid'];
    const value = ipv4Number(ipv4);
    return [...parts.slice(0, -1), ((value >>> 16) & 0xffff).toString(16), (value & 0xffff).toString(16)];
  };
  const leftParts = expandEmbeddedIPv4(left);
  const rightParts = expandEmbeddedIPv4(right);
  if (leftParts.includes('invalid') || rightParts.includes('invalid')) return undefined;
  const missing = 8 - leftParts.length - rightParts.length;
  if ((doubleColon >= 0 && missing < 1) || (doubleColon < 0 && missing !== 0)) return undefined;
  const parts = [...leftParts, ...Array.from({ length: missing }, () => '0'), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv6InCIDR(value: bigint, base: string, prefix: number): boolean {
  const baseValue = ipv6Number(base);
  if (baseValue === undefined) return false;
  const shift = BigInt(128 - prefix);
  return value >> shift === baseValue >> shift;
}

function extractReadableHTML(body: string): { title: string; text: string; source: string } {
  const title = singleLineText(firstMatch(body, /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(body, /<title[^>]*>(.*?)<\/title>/is)
    || '');
  if (!body.includes('<')) {
    return { title, text: normalizeReadableText(body), source: 'plain_text' };
  }
  const stripped = body
    .replace(/<!--.*?-->/gs, ' ')
    .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
    .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
    .replace(/<noscript[^>]*>.*?<\/noscript>/gis, ' ');
  const article = firstMatch(stripped, /<article[^>]*>(.*?)<\/article>/is) || firstMatch(stripped, /<main[^>]*>(.*?)<\/main>/is) || stripped;
  const blocks = [...article.matchAll(/<(?:h1|h2|h3|h4|p|li|blockquote|figcaption)[^>]*>(.*?)<\/(?:h1|h2|h3|h4|p|li|blockquote|figcaption)>/gis)]
    .map((match) => htmlFragmentToText(match[1]))
    .filter(Boolean);
  const text = blocks.length > 0 ? [...new Set(blocks)].join('\n') : htmlFragmentToText(article);
  return { title, text, source: article === stripped ? 'document' : 'article' };
}

function parseDuckDuckGoResults(body: string): Array<{ title: string; url: string; snippet: string }> {
  const snippets = [...body.matchAll(/<a[^>]+class=["']result__snippet["'][^>]*>(.*?)<\/a>/gis)]
    .map((match) => htmlFragmentToText(match[1]));
  return [...body.matchAll(/<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)]
    .map((match, index) => ({
      title: htmlFragmentToText(match[2]),
      url: normalizeDuckDuckGoResultURL(htmlEntityDecode(match[1])),
      snippet: snippets[index] || '',
    }))
    .filter((result) => result.title && result.url);
}

function parseBraveSearchResults(payload: Record<string, unknown>): Array<{ title: string; url: string; snippet: string; age?: string; source?: string }> {
  const web = payload.web && typeof payload.web === 'object' ? payload.web as Record<string, unknown> : {};
  const results = Array.isArray(web.results) ? web.results : [];
  return results
    .map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const profile = row.profile && typeof row.profile === 'object' ? row.profile as Record<string, unknown> : {};
      return {
        title: stringFromUnknown(row.title),
        url: stringFromUnknown(row.url),
        snippet: htmlFragmentToText(stringFromUnknown(row.description || row.snippet)),
        age: stringFromUnknown(row.age),
        source: stringFromUnknown(profile.name),
      };
    })
    .filter((result) => result.title && result.url);
}

function normalizeWebSearchProvider(value: unknown): 'auto' | 'brave' | 'duckduckgo' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'brave') return 'brave';
  if (normalized === 'duckduckgo') return 'duckduckgo';
  return 'auto';
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeDuckDuckGoResultURL(rawURL: string): string {
  const absolute = rawURL.startsWith('//') ? `https:${rawURL}` : rawURL;
  try {
    const parsed = new URL(absolute);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return rawURL;
  }
}

function htmlFragmentToText(fragment: string): string {
  return normalizeReadableText(htmlEntityDecode(fragment.replace(/<\s*\/?\s*(?:br|p|div|section|article|main|header|footer|li|ul|ol|h1|h2|h3|h4|blockquote|figcaption)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')));
}

function htmlEntityDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeReadableText(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

function singleLineText(text: string): string {
  return normalizeReadableText(text).replace(/\s+/g, ' ');
}

function firstMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  return match?.[1] || '';
}

function truncateRunes(text: string, limit: number): { text: string; truncated: boolean } {
  const runes = [...text];
  if (runes.length <= limit) return { text, truncated: false };
  return { text: runes.slice(0, limit).join(''), truncated: true };
}

function summarizeReadableText(text: string): string {
  const lines: string[] = [];
  let size = 0;
  for (const line of text.split('\n').map((item) => item.trim()).filter(Boolean)) {
    const length = [...line].length;
    if (size > 0 && size + length + 1 > maxReadableSummaryRunes) break;
    lines.push(line);
    size += length + 1;
  }
  return lines.join(' ') || truncateRunes(text.trim(), maxReadableSummaryRunes).text;
}

function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9_\u4e00-\u9fff]+/).map((token) => token.trim()).filter((token) => token.length >= 2);
}

function extension(path: string): string {
  return extname(path).replace(/^\./, '').toLowerCase();
}

function shouldSkip(name: string): boolean {
  return ['.git', 'node_modules', 'dist', 'release', '.next', '.local'].includes(name);
}

function globMatches(path: string, glob: string): boolean {
  if (!glob.trim()) return true;
  if (glob.startsWith('*.')) return path.endsWith(glob.slice(1));
  return path.includes(glob.replaceAll('*', ''));
}

function boundedLimit(value: unknown, fallback: number, max: number): number {
  const parsed = positiveInteger(value, fallback);
  return Math.min(parsed, max);
}

function boundedFileReadBytes(value: unknown, fallback: number): number {
  return boundedLimit(value, fallback || defaultFileAnalyzeMaxBytes, absoluteFileReadMaxBytes);
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function pathWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function decodeUTF8(buffer: Buffer): string {
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('workspace capability supports UTF-8 text files only');
  return text;
}

function trimSnippet(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function truncateUTF8Bytes(value: string, maxBytes: number): string {
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > maxBytes) end--;
  return value.slice(0, end);
}

const sensitiveTextPatterns = [
  /\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

function redactSensitiveText(value: string): string {
  let text = value;
  for (const pattern of sensitiveTextPatterns) {
    text = text.replace(pattern, (match) => {
      const lower = match.toLowerCase();
      if (lower.startsWith('bearer ')) return 'Bearer [REDACTED]';
      const equals = match.indexOf('=');
      if (equals >= 0) return `${match.slice(0, equals + 1)}[REDACTED]`;
      const colon = match.indexOf(':');
      if (colon >= 0) return `${match.slice(0, colon + 1)}[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return text;
}
