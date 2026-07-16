import assert from 'node:assert/strict';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech } from '../../../packages/runtime/src/local-speech.ts';

const root = resolve(import.meta.dirname, '../../..');
const outputDir = resolve(process.argv[2] || `${root}/docs/specs/evidence/joi-advanced-agent-capabilities-2026-07-16/speech`);
mkdirSync(outputDir, { recursive: true });
const speech = await executeLocalTextToSpeech({
  text: 'Testing local speech recognition. The verification number is forty two.',
  voice: 'Samantha',
  format: 'wav',
  rate: 180,
}, { output_dir: outputDir, timeout_seconds: 60 });
const transcription = await executeLocalSpeechTranscription({
  path: speech.file_path,
  model: 'tiny.en',
  language: 'en',
}, { output_dir: outputDir, timeout_seconds: 600 });
assert.ok(statSync(speech.file_path).size > 1_000);
assert.match(String(transcription.transcript).toLowerCase(), /verification/);
assert.match(String(transcription.transcript).toLowerCase(), /forty|42/);
const evidence = {
  tts: {
    status: speech.status,
    capability: speech.capability,
    mode: speech.mode,
    provider: speech.provider,
    voice: speech.voice,
    format: speech.format,
    duration_seconds: speech.duration_seconds,
    file_path: speech.file_path,
    size: speech.attachment.size,
    mime_type: speech.attachment.mime_type,
  },
  transcription: {
    status: transcription.status,
    capability: transcription.capability,
    mode: transcription.mode,
    provider: transcription.provider,
    model: transcription.model,
    language: transcription.language,
    duration_seconds: transcription.duration_seconds,
    transcript: transcription.transcript,
    segment_count: transcription.segment_count,
  },
};
writeFileSync(resolve(outputDir, 'live-speech-result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
