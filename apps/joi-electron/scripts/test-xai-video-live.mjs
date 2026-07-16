import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeychainSecretStore } from '../../../packages/secrets/src/keychain.ts';
import { resolveXAIOAuthCredentials } from '../../../packages/runtime/src/xai-oauth.ts';
import { executeXAIVideoGeneration } from '../../../packages/runtime/src/xai-video.ts';

const root = resolve(import.meta.dirname, '../../..');
const outputDir = resolve(process.argv[2] || `${root}/docs/specs/evidence/joi-advanced-agent-capabilities-2026-07-16/video`);
mkdirSync(outputDir, { recursive: true });
const secrets = new KeychainSecretStore();
const credentials = await resolveXAIOAuthCredentials(
  (name) => secrets.resolve(name),
  (name, value) => secrets.save(name, value),
  { forceRefresh: true },
);
const result = await executeXAIVideoGeneration({
  prompt: 'A single cobalt blue circle glides smoothly from left to right across a clean white background, fixed camera, no text, minimal motion-graphics style.',
  duration_seconds: 1,
  aspect_ratio: '16:9',
  resolution: '480p',
}, {
  api_key: credentials.apiKey,
  base_url: credentials.baseURL,
  output_dir: outputDir,
  poll_interval_ms: 3_000,
  timeout_seconds: 600,
});
assert.equal(result.status, 'completed');
assert.equal(result.attachment.kind, 'video');
assert.ok(statSync(result.file_path).size > 10_000);
const probe = JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,size,format_name', '-of', 'json', result.file_path,
], { encoding: 'utf8' }));
assert.match(String(probe.format?.format_name || ''), /mp4/);
assert.ok(Number(probe.format?.duration || 0) > 0);
writeFileSync(resolve(outputDir, 'live-video-result.json'), `${JSON.stringify({
  status: result.status,
  capability: result.capability,
  mode: result.mode,
  provider: result.provider,
  model: result.model,
  request_id: result.request_id,
  aspect_ratio: result.aspect_ratio,
  resolution: result.resolution,
  duration_seconds: result.duration_seconds,
  file_path: result.file_path,
  size: result.attachment.size,
  ffprobe: probe.format,
}, null, 2)}\n`);
console.log(JSON.stringify({
  status: result.status,
  request_id: result.request_id,
  file_path: result.file_path,
  size: result.attachment.size,
  ffprobe: probe.format,
}));
