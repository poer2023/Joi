import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { testGitHubConnection } from '../src/main/github.ts';

let observedAuthorization = '';
let observedPath = '';
const server = createServer((request, response) => {
  observedAuthorization = String(request.headers.authorization || '');
  observedPath = String(request.url || '');
  response.setHeader('content-type', 'application/json');
  response.setHeader('x-ratelimit-remaining', '4999');
  response.end(JSON.stringify({ login: 'joi-test-user' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const settings = {
    allowed_roots: ['/tmp'],
    default_root: '/tmp',
    browser_allowed_hosts: [],
    web_research_allow_private_hosts: false,
    file_analyze_max_bytes: 1024,
    workspace_search_max_results: 10,
    github_api_base_url: `http://127.0.0.1:${address.port}`,
    github_default_repo: '',
  };
  const result = await testGitHubConnection(settings, async () => 'test-token');
  assert.equal(result.status, 'ok');
  assert.equal(result.login, 'joi-test-user');
  assert.equal(result.rate_limit_remaining, 4999);
  assert.equal(observedAuthorization, 'Bearer test-token');
  assert.equal(observedPath, '/user');

  const missing = await testGitHubConnection(settings, async () => undefined);
  assert.equal(missing.status, 'missing_secret');

  const invalid = await testGitHubConnection({ ...settings, github_api_base_url: 'http://example.com' }, async () => 'test-token');
  assert.equal(invalid.status, 'invalid_config');
  console.log('GitHub connection tests passed');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
