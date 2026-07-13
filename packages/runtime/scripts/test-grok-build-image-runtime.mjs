import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeGrokBuildImageGeneration,
  grokBuildImageArguments,
  grokBuildImageResultFromHistory,
  grokBuildSessionIDFromStreamingJSON,
} from '../src/grok-build-image.ts';

const root = await mkdtemp(join(tmpdir(), 'joi-grok-image-test-'));
try {
  const home = join(root, 'home');
  const sessionCwd = join(root, 'runtime');
  const outputDir = join(root, 'generated');
  const sessionID = '019f4b38-f60b-7a82-bbc1-2db19ae0c191';
  await mkdir(sessionCwd, { recursive: true });
  const canonicalCwd = await realpath(sessionCwd);
  const sessionDir = join(home, '.grok', 'sessions', encodeURIComponent(canonicalCwd), sessionID);
  const sourceImage = join(sessionDir, 'images', '1.jpg');
  await mkdir(join(sessionDir, 'images'), { recursive: true });
  await writeFile(sourceImage, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]));
  await writeFile(join(sessionDir, 'chat_history.jsonl'), [
    JSON.stringify({ type: 'assistant', content: '', tool_calls: [{ id: 'call-image-1', name: 'image_gen', arguments: '{"prompt":"blue circle"}' }] }),
    JSON.stringify({ type: 'tool_result', tool_call_id: 'call-image-1', content: JSON.stringify({ path: sourceImage, filename: '1.jpg', session_folder: 'images' }) }),
  ].join('\n'));

  const result = await executeGrokBuildImageGeneration({ prompt: 'blue circle', aspect_ratio: '1:1' }, {
    session_cwd: sessionCwd,
    output_dir: outputDir,
    home_dir: home,
    binary_path: '/fake/grok',
    run_command: async (binary, args, options) => {
      assert.equal(binary, '/fake/grok');
      assert.equal(options.cwd, canonicalCwd);
      assert(args.includes('--disallowed-tools'));
      assert(args.includes('bypassPermissions'));
      return {
        stdout: `not-json\n${JSON.stringify({ type: 'end', stopReason: 'EndTurn', sessionId: sessionID })}\n`,
        stderr: '',
        exit_code: 0,
      };
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.native_tool, 'image_gen');
  assert.equal(result.source_session_id, sessionID);
  assert.equal(result.source_tool_call_id, 'call-image-1');
  assert.equal(result.attachment.mime_type, 'image/jpeg');
  assert.equal(result.attachment.kind, 'image');
  assert(result.attachment.preview_url.startsWith('file:'));
  assert.deepEqual(await readFile(result.file_path), await readFile(sourceImage));

  assert.equal(grokBuildSessionIDFromStreamingJSON(`noise\n${JSON.stringify({ type: 'end', sessionId: 'session-ok' })}`), 'session-ok');
  assert.equal(grokBuildSessionIDFromStreamingJSON('{"type":"text","data":"ok"}'), '');
  assert.equal(grokBuildImageResultFromHistory(JSON.stringify({ type: 'tool_result', tool_call_id: 'unknown', content: JSON.stringify({ path: sourceImage }) })), undefined);
  assert(grokBuildImageArguments('prompt', '16:9').includes('/imagine prompt\nAspect ratio: 16:9'));

  await assert.rejects(
    executeGrokBuildImageGeneration({ prompt: '' }, { session_cwd: sessionCwd, output_dir: outputDir, home_dir: home }),
    /prompt is required/,
  );
  await assert.rejects(
    executeGrokBuildImageGeneration({ prompt: 'test', aspect_ratio: '2:1' }, { session_cwd: sessionCwd, output_dir: outputDir, home_dir: home }),
    /Unsupported image aspect ratio/,
  );

  console.log('grok build image runtime tests passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
