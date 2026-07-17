import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech, inspectLocalWhisperRuntime } from '../src/local-speech.ts';

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

  const fakeModelDir = join(tempDir, 'models');
  const fakeModelPath = join(fakeModelDir, 'ggml-small.bin');
  const fakeWhisperCpp = join(tempDir, 'whisper-cli');
  mkdirSync(fakeModelDir, { recursive: true });
  writeFileSync(fakeModelPath, 'verified-small-model');
  writeFileSync(fakeWhisperCpp, 'whisper.cpp fixture');
  const status = await inspectLocalWhisperRuntime({ model: 'small' }, {
    whisper_cpp_path: fakeWhisperCpp,
    whisper_model_dir: fakeModelDir,
  });
  assert.equal(status.ready, true);
  assert.equal(status.engine, 'whisper.cpp');
  assert.equal(status.acceleration, 'Apple Metal');

  const commands = [];
  const cppTranscript = await executeLocalSpeechTranscription({
    path: speech.file_path,
    model: 'small',
    language: 'zh',
  }, {
    output_dir: join(tempDir, 'cpp-transcription'),
    whisper_cpp_path: fakeWhisperCpp,
    whisper_model_dir: fakeModelDir,
    run_command: async (binary, args) => {
      commands.push({ binary, args });
      if (binary === fakeWhisperCpp) {
        const prefix = args[args.indexOf('--output-file') + 1];
        writeFileSync(`${prefix}.json`, JSON.stringify({ transcription: [{ text: ' 本地 Whisper 测试通过。' }] }));
      }
      return { stdout: binary.includes('ffprobe') ? '4.2\n' : '', stderr: '', exit_code: 0 };
    },
  });
  assert.equal(cppTranscript.transcript, '本地 Whisper 测试通过。');
  assert.equal(cppTranscript.mode, 'local_whisper_cpp_v1');
  assert.equal(cppTranscript.model_path, fakeModelPath);
  const cppCommand = commands.find((command) => command.binary === fakeWhisperCpp);
  assert.ok(cppCommand);
  assert.deepEqual(cppCommand.args.slice(0, 4), ['--model', fakeModelPath, '--file', cppCommand.args[3]]);
  assert.ok(cppCommand.args.includes('--output-json'));
  assert.ok(cppCommand.args.includes('--language'));
  assert.ok(commands.some((command) => command.binary.includes('ffmpeg') && command.args.includes('16000')));
  const durationCommand = commands.find((command) => command.binary.includes('ffprobe'));
  assert.ok(durationCommand?.args.at(-1)?.endsWith('/input.wav'), 'whisper.cpp duration must use normalized WAV for MediaRecorder WebM compatibility');

  if (process.env.JOI_REAL_WHISPER_TEST === '1') {
    const chineseSpeech = await executeLocalTextToSpeech({
      text: '你好，我是 Joi。这是一段本地语音识别测试，今天的验证码是四十二。',
      voice: 'Tingting',
      format: 'wav',
      rate: 175,
    }, { output_dir: tempDir, timeout_seconds: 60 });
    const transcript = await executeLocalSpeechTranscription({
      path: chineseSpeech.file_path,
      model: 'small',
      language: 'zh',
    }, { output_dir: tempDir, timeout_seconds: 600 });
    assert.equal(transcript.engine, 'whisper.cpp');
    assert.equal(transcript.acceleration, 'Apple Metal');
    assert.match(transcript.transcript, /本地.*(?:语音识别测试|語音識別測試)/);
    assert.match(transcript.transcript, /四十二|42/);
    if (process.env.JOI_EVIDENCE_DIR) {
      mkdirSync(process.env.JOI_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.JOI_EVIDENCE_DIR, 'live-chinese-whisper-small.json'), JSON.stringify({
        fixture_text: '你好，我是 Joi。这是一段本地语音识别测试，今天的验证码是四十二。',
        result: transcript,
      }, null, 2));
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('local speech runtime ok');
