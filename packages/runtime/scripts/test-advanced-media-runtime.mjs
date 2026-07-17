import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeLocalSpeechTranscription, executeLocalTextToSpeech, inspectLocalWhisperRuntime, isDegenerateSpeechTranscript } from '../src/local-speech.ts';

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
  const fakeVadModelPath = join(fakeModelDir, 'ggml-silero-v6.2.0.bin');
  const fakeWhisperCpp = join(tempDir, 'whisper-cli');
  mkdirSync(fakeModelDir, { recursive: true });
  writeFileSync(fakeModelPath, 'verified-small-model');
  writeFileSync(fakeVadModelPath, 'verified-vad-model');
  writeFileSync(fakeWhisperCpp, 'whisper.cpp fixture');
  const status = await inspectLocalWhisperRuntime({ model: 'small' }, {
    whisper_cpp_path: fakeWhisperCpp,
    whisper_model_dir: fakeModelDir,
  });
  assert.equal(status.ready, true);
  assert.equal(status.engine, 'whisper.cpp');
  assert.equal(status.acceleration, 'Apple Metal');
  assert.equal(status.vad_ready, true);
  assert.equal(status.vad_model_path, fakeVadModelPath);

  const commands = [];
  const cppTranscript = await executeLocalSpeechTranscription({
    path: speech.file_path,
    model: 'small',
    language: 'zh',
    use_vad: true,
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
  assert.equal(cppTranscript.vad_enabled, true);
  assert.equal(cppTranscript.vad_model_path, fakeVadModelPath);
  const cppCommand = commands.find((command) => command.binary === fakeWhisperCpp);
  assert.ok(cppCommand);
  assert.deepEqual(cppCommand.args.slice(0, 4), ['--model', fakeModelPath, '--file', cppCommand.args[3]]);
  assert.ok(cppCommand.args.includes('--output-json'));
  assert.ok(cppCommand.args.includes('--language'));
  assert.equal(cppCommand.args[cppCommand.args.indexOf('--language') + 1], 'zh');
  assert.equal(cppCommand.args.includes('--prompt'), false, 'voice input must not seed a prompt that can leak into silence');
  assert.ok(cppCommand.args.includes('--vad'));
  assert.equal(cppCommand.args[cppCommand.args.indexOf('--vad-model') + 1], fakeVadModelPath);
  assert.ok(commands.some((command) => command.binary.includes('ffmpeg') && command.args.includes('16000')));
  const durationCommand = commands.find((command) => command.binary.includes('ffprobe'));
  assert.ok(durationCommand?.args.at(-1)?.endsWith('/input.wav'), 'whisper.cpp duration must use normalized WAV for MediaRecorder WebM compatibility');
  assert.equal(isDegenerateSpeechTranscript('你不要再说了，你不要再说了你不要再说了，你不要再说了'), true);
  assert.equal(isDegenerateSpeechTranscript('自己不就是最好的例子吗，是吧'), false);

  await assert.rejects(
    executeLocalSpeechTranscription({
      path: speech.file_path,
      model: 'small',
      language: 'zh',
      use_vad: true,
    }, {
      output_dir: join(tempDir, 'loop-transcription'),
      whisper_cpp_path: fakeWhisperCpp,
      whisper_model_dir: fakeModelDir,
      run_command: async (binary, args) => {
        if (binary === fakeWhisperCpp) {
          const prefix = args[args.indexOf('--output-file') + 1];
          writeFileSync(`${prefix}.json`, JSON.stringify({ transcription: [{ text: '你不要再说了，你不要再说了你不要再说了，你不要再说了' }] }));
        }
        return { stdout: binary.includes('ffprobe') ? '4.2\n' : '', stderr: '', exit_code: 0 };
      },
    }),
    /识别结果异常/,
  );

  if (process.env.JOI_REAL_WHISPER_TEST === '1') {
    const fixtureText = '自己不就是最好的例子吗，是吧。';
    const chineseSpeech = await executeLocalTextToSpeech({
      text: fixtureText,
      voice: 'Tingting',
      format: 'wav',
      rate: 175,
    }, { output_dir: tempDir, timeout_seconds: 60 });
    const paddedSpeechPath = join(tempDir, 'short-chinese-with-silence.wav');
    execFileSync('/opt/homebrew/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=16000:cl=mono',
      '-i', chineseSpeech.file_path,
      '-f', 'lavfi', '-t', '12', '-i', 'anullsrc=r=16000:cl=mono',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', paddedSpeechPath,
    ]);
    const transcript = await executeLocalSpeechTranscription({
      path: paddedSpeechPath,
      model: 'small',
      language: 'zh',
      use_vad: true,
    }, { output_dir: tempDir, timeout_seconds: 600 });
    assert.equal(transcript.engine, 'whisper.cpp');
    assert.equal(transcript.acceleration, 'Apple Metal');
    assert.equal(transcript.vad_enabled, true);
    assert.match(transcript.transcript, /自己/);
    assert.match(transcript.transcript, /最好.*例子/);
    if (process.env.JOI_EVIDENCE_DIR) {
      mkdirSync(process.env.JOI_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.JOI_EVIDENCE_DIR, 'live-chinese-whisper-small-vad.json'), JSON.stringify({
        fixture_text: fixtureText,
        silence_padding_seconds: { before: 1, after: 12 },
        result: transcript,
      }, null, 2));
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('local speech runtime ok');
