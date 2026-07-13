import type { GitHubConnectionResult, WorkspaceSettings } from '../../../../packages/shared-types/src/desktop-api';

type SecretResolver = (name: string) => Promise<string | undefined>;
type FetchLike = typeof fetch;

export async function testGitHubConnection(
  settings: WorkspaceSettings,
  resolveSecret: SecretResolver,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubConnectionResult> {
  const apiBaseURL = (settings.github_api_base_url || 'https://api.github.com').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(apiBaseURL);
  } catch {
    return { status: 'invalid_config', api_base_url: apiBaseURL, error_summary: 'GitHub API Base URL 无效。' };
  }
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) {
    return { status: 'invalid_config', api_base_url: apiBaseURL, error_summary: 'GitHub API 必须使用 HTTPS；仅本机开发地址允许 HTTP。' };
  }
  const token = await resolveSecret('GITHUB_TOKEN');
  if (!token) {
    return { status: 'missing_secret', api_base_url: apiBaseURL, error_summary: 'GITHUB_TOKEN 未配置。' };
  }
  const repository = (settings.github_default_repo || '').trim();
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return { status: 'invalid_config', api_base_url: apiBaseURL, error_summary: '默认仓库必须使用 owner/repo 格式。' };
  }
  const endpoint = repository ? `${apiBaseURL}/repos/${repository}` : `${apiBaseURL}/user`;
  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Joi-Desktop',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const rateLimitRemaining = Number(response.headers.get('x-ratelimit-remaining'));
    if (!response.ok) {
      return {
        status: 'error',
        api_base_url: apiBaseURL,
        repository: repository || undefined,
        rate_limit_remaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : undefined,
        error_summary: `GitHub API ${response.status}: ${String(payload.message || response.statusText)}`,
      };
    }
    return {
      status: 'ok',
      api_base_url: apiBaseURL,
      login: typeof payload.login === 'string' ? payload.login : undefined,
      repository: typeof payload.full_name === 'string' ? payload.full_name : repository || undefined,
      rate_limit_remaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : undefined,
    };
  } catch (error) {
    return { status: 'error', api_base_url: apiBaseURL, repository: repository || undefined, error_summary: error instanceof Error ? error.message : String(error) };
  }
}
