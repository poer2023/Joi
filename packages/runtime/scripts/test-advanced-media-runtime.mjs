import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech } from '../src/local-speech.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'joi-advanced-media-'));
try {
  const speech = await executeLocalTextToSpeech({
    text: 'Testing local speech recognition. The verification number is forty two.',
    voice: 'Samantha',
    format: 'mp3',
    rate: 180,
  }, { output_dir: tempDir, timeout_seconds: 60 });
  assert.equal(speech.status, 'completed');
  assert.equal(speech.attachment.kind, 'audio');
  assert.equal(speech.attachment.mime_type, 'audio/mpeg');
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
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('local speech runtime ok');
