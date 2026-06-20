import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
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
};

export type CapabilityResult = {
  status: 'completed';
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

const searchableExtensions = new Set([
  'css', 'go', 'html', 'js', 'json', 'jsx', 'md', 'mdx', 'mjs', 'py', 'sql', 'ts', 'tsx', 'txt', 'yaml', 'yml',
]);

const readableExtensions = new Set([
  ...searchableExtensions,
  'c', 'cc', 'cpp', 'h', 'hpp', 'java', 'kt', 'kts', 'm', 'mm', 'mod', 'php', 'rb', 'rs', 'sh', 'swift', 'toml', 'xml',
]);

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

export async function executeWebResearch(req: WebResearchRequest, settings: WorkspaceSettings): Promise<CapabilityResult> {
  const url = req.url?.trim() || '';
  if (!url) throw new Error('web_research requires url');
  const blockedReason = blockedResearchURL(url, settings);
  if (blockedReason) {
    return {
      status: 'completed',
      url,
      fetch_status: 'policy_blocked',
      reason: blockedReason,
      summary: `policy_blocked：${blockedReason}`,
      mode: 'web_research_v2_ts_readonly_fetch',
    };
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Joi-Electron-WebResearch/0.1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const finalURL = response.url || url;
    const redirectBlockedReason = blockedResearchURL(finalURL, settings);
    if (redirectBlockedReason) {
      return {
        status: 'completed',
        url,
        final_url: finalURL,
        fetch_status: 'policy_blocked',
        reason: redirectBlockedReason,
        summary: `policy_blocked：${redirectBlockedReason}`,
        mode: 'web_research_v2_ts_readonly_fetch',
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const truncated = bytes.length > 1024 * 1024;
    const body = decodeUTF8(bytes.subarray(0, 1024 * 1024));
    const extraction = extractReadableHTML(body);
    const readable = truncateRunes(extraction.text, maxReadableTextRunes);
    const links = [...body.matchAll(/href=["']([^"']+)["']/gi)].slice(0, 20).map((match) => match[1]);
    return {
      status: 'completed',
      url,
      final_url: finalURL,
      fetch_status: response.ok ? 'succeeded' : 'http_error',
      status_code: response.status,
      content_type: response.headers.get('content-type') || '',
      title: extraction.title,
      readable_text: readable.text,
      text_length: [...readable.text].length,
      links,
      summary: summarizeReadableText(readable.text),
      extraction: {
        source: extraction.source,
        readable_text_truncated: readable.truncated,
      },
      truncated,
      mode: 'web_research_v2_ts_readonly_fetch',
    };
  } catch (error) {
    return {
      status: 'completed',
      url,
      fetch_status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      summary: `web_research failed: ${error instanceof Error ? error.message : String(error)}`,
      mode: 'web_research_v2_ts_readonly_fetch',
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
    file_analyze_max_bytes: positiveInteger(settings.file_analyze_max_bytes, defaultFileAnalyzeMaxBytes),
    workspace_search_max_results: boundedLimit(settings.workspace_search_max_results, defaultWorkspaceSearchMaxResults, maxWorkspaceSearchResults),
  };
}

export function webResearchBlockReason(rawURL: string, settings: WorkspaceSettings): string {
  return blockedResearchURL(rawURL, settings);
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

function blockedResearchURL(rawURL: string, settings: WorkspaceSettings): string {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    return 'invalid_url';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'only_public_http_https_allowed';
  const host = parsed.hostname.toLowerCase();
  if (!host) return 'missing_host';
  const hostPort = parsed.host.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return privateResearchHostAllowed(host, hostPort, settings) ? '' : 'private_host_not_allowed';
  }
  if (isIPv4(host)) {
    if (host === '169.254.169.254' || host.startsWith('169.254.')) return 'metadata_ip_blocked';
    if (host === '0.0.0.0') return 'unspecified_ip_blocked';
    if (host.startsWith('127.') || isPrivateIPv4(host)) {
      return privateResearchHostAllowed(host, hostPort, settings) ? '' : 'private_host_not_allowed';
    }
  }
  if (host === '::1' || host === '[::1]') {
    return privateResearchHostAllowed(host, hostPort, settings) ? '' : 'private_host_not_allowed';
  }
  return '';
}

function privateResearchHostAllowed(host: string, hostPort: string, settings: WorkspaceSettings): boolean {
  if (!settings.web_research_allow_private_hosts) return false;
  const allowed = (settings.browser_allowed_hosts || []).map((item) => item.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(host) || allowed.includes(hostPort);
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
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

function htmlFragmentToText(fragment: string): string {
  return normalizeReadableText(fragment.replace(/<\s*\/?\s*(?:br|p|div|section|article|main|header|footer|li|ul|ol|h1|h2|h3|h4|blockquote|figcaption)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '));
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
