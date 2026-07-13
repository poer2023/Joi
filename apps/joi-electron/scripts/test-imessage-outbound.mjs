import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveIMessageOutboundAttachments } from '../src/main/imessage-outbound.ts';

const root = mkdtempSync(join(tmpdir(), 'joi-imessage-outbound-'));
try {
  const generatedImagesDir = join(root, 'generated-images');
  mkdirSync(generatedImagesDir);
  const generated = join(generatedImagesDir, 'generated.jpg');
  writeFileSync(generated, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const outside = join(root, 'outside.jpg');
  writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  symlinkSync(outside, join(generatedImagesDir, 'escape.jpg'));

  const result = {
    conversation_id: 'conv_imessage',
    user_message_id: 'msg_user',
    assistant_message_id: 'msg_assistant',
    run_id: 'run_image',
    selected_agent_id: 'general_agent',
    response: '图片已生成。',
    artifacts: [
      imageArtifact('art_generated', 'run_image', generated),
      imageArtifact('art_wrong_run', 'run_other', generated),
      imageArtifact('art_escape', 'run_image', join(generatedImagesDir, 'escape.jpg')),
      {
        ...imageArtifact('art_untrusted', 'run_image', generated),
        metadata: { file_path: generated, mime_type: 'image/jpeg', generation_mode: 'other', native_tool: 'image_gen' },
      },
    ],
  };

  const attachments = resolveIMessageOutboundAttachments(result, generatedImagesDir);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].artifact_id, 'art_generated');
  assert.equal(attachments[0].path, realpathSync(generated));
  assert.equal(attachments[0].mime_type, 'image/jpeg');
  assert.equal(attachments[0].size, 4);
  assert.deepEqual(resolveIMessageOutboundAttachments({ ...result, artifacts: undefined }, generatedImagesDir), []);
  assert.deepEqual(resolveIMessageOutboundAttachments(result, join(root, 'missing')), []);
  console.log('iMessage outbound attachment tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function imageArtifact(id, runID, filePath) {
  return {
    id,
    type: 'image',
    title: 'generated.jpg',
    content_format: 'image/jpeg',
    source_run_id: runID,
    version: 1,
    status: 'active',
    metadata: {
      generation_mode: 'grok_build_native_image_gen',
      native_tool: 'image_gen',
      file_path: filePath,
      file_name: 'generated.jpg',
      mime_type: 'image/jpeg',
    },
  };
}
