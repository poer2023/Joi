import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeFileAnalyze,
  executeFileRead,
  executeWebResearch,
  executeWorkspaceSearch,
  resolveWorkspacePath,
} from '../src/capabilities.ts';

const root = mkdtempSync(join(tmpdir(), 'joi-capabilities-'));
const outside = mkdtempSync(join(tmpdir(), 'joi-capabilities-outside-'));
let server;

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

  server = createServer((request, response) => {
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

  const blockedScheme = await executeWebResearch({ url: 'file:///etc/passwd' }, settings);
  assert.equal(blockedScheme.fetch_status, 'policy_blocked');
  assert.equal(blockedScheme.reason, 'only_public_http_https_allowed');

  const blockedMetadata = await executeWebResearch({ url: 'http://169.254.169.254/latest/meta-data/' }, {
    ...settings,
    browser_allowed_hosts: ['169.254.169.254'],
    web_research_allow_private_hosts: true,
  });
  assert.equal(blockedMetadata.fetch_status, 'policy_blocked');
  assert.equal(blockedMetadata.reason, 'metadata_ip_blocked');

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
