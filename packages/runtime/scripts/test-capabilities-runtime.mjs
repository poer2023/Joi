import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeFileAnalyze,
  executeFileRead,
  executePublicWebExtract,
  executeUnsupportedCapability,
  executeWebResearch,
  executeWorkspaceSearch,
  resolveWorkspacePath,
} from '../src/capabilities.ts';

const root = mkdtempSync(join(tmpdir(), 'joi-capabilities-'));
const outside = mkdtempSync(join(tmpdir(), 'joi-capabilities-outside-'));
let server;
let loopRedirectRequests = 0;
let lastRequestHost = '';

try {
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'docs', 'run-trace.md'), [
    '# Run Trace',
    'Run Trace records prompt assembly and tool execution.',
    'token=SHOULD_NOT_LEAK_123456',
    'Tool Compiler keeps capability execution auditable.',
  ].join('\n'));
  writeFileSync(join(root, 'node_modules', 'ignored.md'), 'Run Trace hidden in dependency');
  writeFileSync(join(outside, 'secret.md'), 'outside secret');
  symlinkSync(join(outside, 'secret.md'), join(root, 'docs', 'escape.md'));

  const settings = {
    allowed_roots: [root],
    default_root: root,
    browser_allowed_hosts: [],
    web_research_allow_private_hosts: false,
    web_search_provider: 'auto',
    file_analyze_max_bytes: 1024,
    workspace_search_max_results: 10,
  };

  const resolved = resolveWorkspacePath('docs/run-trace.md', settings);
  assert.equal(resolved, realpathSync(join(root, 'docs', 'run-trace.md')));

  assert.throws(() => resolveWorkspacePath(join(root, 'docs', 'escape.md'), settings), /outside allowed roots/);
  assert.throws(() => resolveWorkspacePath(join(outside, 'secret.md'), settings), /outside allowed roots/);

  const search = executeWorkspaceSearch({ query: 'Run Trace', root }, settings);
  assert.equal(search.status, 'completed');
  assert.equal(search.mode, 'workspace_search_v1_ts_walk');
  assert.ok(search.results.some((item) => item.path === 'docs/run-trace.md' && item.snippet.includes('Run Trace')));
  assert.ok(!search.results.some((item) => item.path.includes('node_modules')));

  const read = executeFileRead({ path: 'docs/run-trace.md', start_line: 2, end_line: 4, max_bytes: 512 }, settings);
  assert.equal(read.mode, 'file_read_v1_bounded_lines');
  assert.equal(read.start_line, 2);
  assert.equal(read.line_count, 3);
  assert.ok(read.content.includes('Tool Compiler'));
  assert.ok(!read.content.includes('SHOULD_NOT_LEAK'));
  assert.ok(read.content.includes('token=[REDACTED]'));

  const tinyRead = executeFileRead({ path: 'docs/run-trace.md', start_line: 1, max_bytes: 16 }, settings);
  assert.equal(tinyRead.truncated, true);

  const analyze = executeFileAnalyze({ path: 'docs/run-trace.md', question: 'Tool Compiler' }, settings);
  assert.equal(analyze.mode, 'file_analyze_v1_bounded_read');
  assert.ok(analyze.summary.includes('Tool Compiler'));
  assert.ok(analyze.excerpts.some((item) => item.snippet.includes('Tool Compiler')));

  const missingBraveKey = await executeWebResearch({ query: 'Joi Brave Search', max_results: 2 }, {
    ...settings,
    web_search_provider: 'brave',
  });
  assert.equal(missingBraveKey.status, 'failed');
  assert.equal(missingBraveKey.fetch_status, 'missing_api_key');
  assert.equal(missingBraveKey.mode, 'web_search_v1_brave_api');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://api.search.brave.com/res/v1/web/search'));
    assert.equal(init.headers['X-Subscription-Token'], 'brave-test-key');
    return new Response(JSON.stringify({
      web: {
        results: [{
          title: 'Joi Brave Result',
          url: 'https://example.com/joi',
          description: 'Brave result description',
          profile: { name: 'Example' },
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const braveSearch = await executeWebResearch({ query: 'Joi Brave Search', max_results: 1 }, {
    ...settings,
    web_search_provider: 'brave',
    brave_search_api_key: 'brave-test-key',
  });
  globalThis.fetch = originalFetch;
  assert.equal(braveSearch.status, 'completed');
  assert.equal(braveSearch.provider, 'brave');
  assert.equal(braveSearch.results[0].title, 'Joi Brave Result');

  server = createServer((request, response) => {
    lastRequestHost = String(request.headers.host || '');
    if (request.url === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<html><head><title>Fixture Research Title</title></head>',
        '<body><main><h1>Fixture Research Title</h1>',
        '<p>Joi web research extracts readable fixture text from HTML.</p>',
        '<a href="https://example.com/reference">reference</a>',
        '</main></body></html>',
      ].join(''));
      return;
    }
    if (request.url === '/redirect-metadata') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
      return;
    }
    if (request.url === '/redirect-loop') {
      loopRedirectRequests += 1;
      response.writeHead(302, { location: '/redirect-loop' });
      response.end();
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.notEqual(typeof address, 'string');
  const localURL = `http://127.0.0.1:${address.port}/article`;

  const blockedPrivate = await executeWebResearch({ url: localURL }, settings);
  assert.equal(blockedPrivate.fetch_status, 'policy_blocked');
  assert.equal(blockedPrivate.reason, 'private_host_not_allowed');

  const allowedPrivate = await executeWebResearch({ url: localURL }, {
    ...settings,
    browser_allowed_hosts: [`127.0.0.1:${address.port}`],
    web_research_allow_private_hosts: true,
  });
  assert.equal(allowedPrivate.fetch_status, 'succeeded');
  assert.equal(allowedPrivate.title, 'Fixture Research Title');
  assert.ok(String(allowedPrivate.readable_text).includes('readable fixture text'));
  assert.deepEqual(allowedPrivate.links, ['https://example.com/reference']);

  const safeHostnameURL = `http://safe.test:${address.port}/article`;
  let safeHostnameResolutions = 0;
  const allowedPinnedPrivate = await executeWebResearch({ url: safeHostnameURL }, {
    ...settings,
    browser_allowed_hosts: [`safe.test:${address.port}`],
    web_research_allow_private_hosts: true,
  }, {
    resolveHost: async (hostname) => {
      safeHostnameResolutions += 1;
      assert.equal(hostname, 'safe.test');
      return [{ address: '127.0.0.1', family: 4 }];
    },
  });
  assert.equal(allowedPinnedPrivate.fetch_status, 'succeeded');
  assert.equal(safeHostnameResolutions, 1, 'validated DNS result must be reused for the network connection');
  assert.equal(lastRequestHost, `safe.test:${address.port}`, 'pinning the IP must preserve the HTTP hostname');

  const strictPrivate = await executePublicWebExtract({ url: safeHostnameURL }, {
    ...settings,
    browser_allowed_hosts: [`safe.test:${address.port}`],
    web_research_allow_private_hosts: true,
  }, {
    resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  assert.equal(strictPrivate.fetch_status, 'policy_blocked');
  assert.equal(strictPrivate.reason, 'private_host_not_allowed');

  const strictPrivateLiteral = await executePublicWebExtract({ url: localURL }, {
    ...settings,
    browser_allowed_hosts: [`127.0.0.1:${address.port}`],
    web_research_allow_private_hosts: true,
  });
  assert.equal(strictPrivateLiteral.fetch_status, 'policy_blocked');
  assert.equal(strictPrivateLiteral.reason, 'private_host_not_allowed');

  const mixedDNS = await executeWebResearch({ url: 'http://mixed-addresses.test/article' }, settings, {
    enforcePublicOnly: true,
    resolveHost: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
  });
  assert.equal(mixedDNS.fetch_status, 'policy_blocked');
  assert.equal(mixedDNS.reason, 'private_host_not_allowed', 'one unsafe DNS answer must reject the entire hop');

  const blockedRedirect = await executeWebResearch({ url: `http://127.0.0.1:${address.port}/redirect-metadata` }, {
    ...settings,
    browser_allowed_hosts: [`127.0.0.1:${address.port}`],
    web_research_allow_private_hosts: true,
  });
  assert.equal(blockedRedirect.fetch_status, 'policy_blocked');
  assert.equal(blockedRedirect.reason, 'metadata_ip_blocked');

  loopRedirectRequests = 0;
  const boundedRedirect = await executeWebResearch({ url: `http://127.0.0.1:${address.port}/redirect-loop` }, {
    ...settings,
    browser_allowed_hosts: [`127.0.0.1:${address.port}`],
    web_research_allow_private_hosts: true,
  }, { maxRedirects: 2 });
  assert.equal(boundedRedirect.fetch_status, 'policy_blocked');
  assert.equal(boundedRedirect.reason, 'too_many_redirects');
  assert.equal(loopRedirectRequests, 3);

  const missingPrivate = await executeWebResearch({ url: `http://127.0.0.1:${address.port}/missing` }, {
    ...settings,
    browser_allowed_hosts: [`127.0.0.1:${address.port}`],
    web_research_allow_private_hosts: true,
  });
  assert.equal(missingPrivate.status, 'failed');
  assert.equal(missingPrivate.fetch_status, 'http_error');
  assert.equal(missingPrivate.status_code, 404);

  const blockedScheme = await executeWebResearch({ url: 'file:///etc/passwd' }, settings);
  assert.equal(blockedScheme.status, 'policy_blocked');
  assert.equal(blockedScheme.fetch_status, 'policy_blocked');
  assert.equal(blockedScheme.reason, 'only_public_http_https_allowed');

  const blockedMetadata = await executeWebResearch({ url: 'http://169.254.169.254/latest/meta-data/' }, {
    ...settings,
    browser_allowed_hosts: ['169.254.169.254'],
    web_research_allow_private_hosts: true,
  });
  assert.equal(blockedMetadata.fetch_status, 'policy_blocked');
  assert.equal(blockedMetadata.reason, 'metadata_ip_blocked');

  for (const [blockedURL, reason] of [
    ['http://100.64.0.1/', 'special_use_ip_blocked'],
    ['http://192.0.2.1/', 'special_use_ip_blocked'],
    ['http://198.18.0.1/', 'special_use_ip_blocked'],
    ['http://203.0.113.1/', 'special_use_ip_blocked'],
    ['http://[fe80::1]/', 'link_local_ip_blocked'],
    ['http://[2001:db8::1]/', 'special_use_ip_blocked'],
    ['http://[::ffff:127.0.0.1]/', 'special_use_ip_blocked'],
    ['http://metadata.google.internal/', 'metadata_host_blocked'],
    ['http://user:password@example.com/', 'url_credentials_not_allowed'],
  ]) {
    const blocked = await executeWebResearch({ url: blockedURL }, settings);
    assert.equal(blocked.fetch_status, 'policy_blocked', blockedURL);
    assert.equal(blocked.reason, reason, blockedURL);
  }

  const planned = executeUnsupportedCapability('image_generate', { prompt: 'test', api_key: 'SHOULD_NOT_LEAK' });
  assert.equal(planned.status, 'policy_blocked');
  assert.equal(planned.reason, 'not_configured');
  assert.equal(planned.mode, 'capability_registry_v1_not_configured');
  assert.equal(planned.requested_input.api_key, '[REDACTED]');

  writeFileSync(join(root, 'binary.bin'), Buffer.from([0xff, 0x00, 0x01]));
  assert.throws(() => executeFileRead({ path: 'binary.bin' }, settings), /unsupported extension/);

  console.log('capability runtime tests passed');
} finally {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
