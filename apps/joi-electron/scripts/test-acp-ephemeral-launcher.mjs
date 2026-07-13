import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  patchCodexACPSource,
  prepareEphemeralCodexACP,
} from '../resources/acp-ephemeral-launcher/index.mjs';

const upstream = `before
  static AgentFullAccess = new _AgentMode(
    "agent-full-access",
    "Agent (full access)",
    "Codex can edit files outside this workspace and run commands with network access. Exercise caution when using.",
    "never",
    { "type": "dangerFullAccess" },
    "danger-full-access"
  );
    const response = await this.codexClient.threadStart({
      config: await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers),
      modelProvider: this.getModelProvider(),
      cwd: request.cwd
    });
after`;
const patched = patchCodexACPSource(upstream);
assert.match(patched, /ephemeral: process\.env\.JOI_ACP_EPHEMERAL !== "0"/);
assert.match(patched, /"untrusted",\n    \{ "type": "dangerFullAccess" \}/);
assert.throws(() => patchCodexACPSource('no matching thread start'), /expected one threadStart target, found 0/);
assert.throws(() => patchCodexACPSource(`${upstream}\n${upstream}`), /expected one threadStart target, found 2/);

const root = await mkdtemp(join(tmpdir(), 'joi-acp-ephemeral-launcher-'));
try {
  const adapter = join(root, 'index.js');
  await writeFile(adapter, upstream, { mode: 0o600 });
  const first = await prepareEphemeralCodexACP(adapter);
  const second = await prepareEphemeralCodexACP(adapter);
  assert.equal(first, second);
  assert.match(await readFile(first, 'utf8'), /ephemeral: process\.env\.JOI_ACP_EPHEMERAL !== "0"/);
  assert.match(await readFile(first, 'utf8'), /"untrusted",\n    \{ "type": "dangerFullAccess" \}/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('ACP ephemeral launcher tests passed');
