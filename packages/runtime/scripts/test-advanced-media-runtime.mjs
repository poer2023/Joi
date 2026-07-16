import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech } from '../src/local-speech.ts';
import { executeXAIVideoGeneration } from '../src/xai-video.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'joi-advanced-media-'));
try {
  const speech = await executeLocalTextToSpeech({
    text: 'Testing local speech recognition. The verification number is forty two.',
    voice: 'Samantha',
    format: 'wav',
    rate: 180,
  }, { output_dir: tempDir, timeout_seconds: 60 });
  assert.equal(speech.status, 'completed');
  assert.equal(speech.attachment.kind, 'audio');
  assert.equal(speech.attachment.mime_type, 'audio/wav');
  assert.ok(speech.attachment.size > 1_000);
  assert.ok(speech.duration_seconds > 0.5);

  if (process.env.JOI_REAL_WHISPER_TEST === '1') {
    const transcript = await executeLocalSpeechTranscription({
      path: speech.file_path,
      model: 'tiny.en',
      language: 'en',
    }, { output_dir: tempDir, timeout_seconds: 600 });
    assert.match(transcript.transcript.toLowerCase(), /verification/);
    assert.match(transcript.transcript.toLowerCase(), /forty|42/);
  }

  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.alloc(128, 1),
  ]);
  let pollCount = 0;
  const fakeFetch = async (url, init = {}) => {
    if (String(url).endsWith('/videos/generations') && init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, 'grok-imagine-video');
      assert.equal(body.duration, 2);
      return new Response(JSON.stringify({ request_id: 'video_fixture', status: 'pending' }), { status: 200 });
    }
    if (String(url).endsWith('/videos/video_fixture')) {
      pollCount += 1;
      return new Response(JSON.stringify({ status: 'done', video: { url: 'https://files.example/video.mp4', duration: 2 } }), { status: 200 });
    }
    if (String(url) === 'https://files.example/video.mp4') return new Response(mp4, { status: 200 });
    return new Response('not found', { status: 404 });
  };
  const video = await executeXAIVideoGeneration({
    prompt: 'A quiet blue circle moving across a white background.',
    duration_seconds: 2,
    aspect_ratio: '16:9',
    resolution: '480p',
  }, {
    api_key: 'test-token',
    base_url: 'https://api.x.ai/v1',
    output_dir: tempDir,
    poll_interval_ms: 1,
    timeout_seconds: 30,
    fetch_impl: fakeFetch,
  });
  assert.equal(pollCount, 1);
  assert.equal(video.attachment.kind, 'video');
  assert.equal(video.attachment.mime_type, 'video/mp4');
  assert.ok(video.attachment.size > 100);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('advanced media runtime ok');
