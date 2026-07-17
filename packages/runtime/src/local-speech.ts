import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type LocalSpeechCommandResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
};

type LocalSpeechOptions = {
  output_dir: string;
  signal?: AbortSignal;
  say_path?: string;
  ffmpeg_path?: string;
  ffprobe_path?: string;
  whisper_path?: string;
  whisper_cpp_path?: string;
  whisper_model_dir?: string;
  timeout_seconds?: number;
  run_command?: (
    binary: string,
    args: string[],
    options: { signal?: AbortSignal; timeout_seconds: number },
  ) => Promise<LocalSpeechCommandResult>;
};

const maxCommandOutputBytes = 2 * 1024 * 1024;
const allowedFormats = new Set(['mp3', 'wav', 'aiff']);
const allowedWhisperModels = new Set([
  'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en',
  'large-v2', 'large-v3', 'large-v3-turbo', 'turbo',
]);
const preferredWhisperCppModel = 'small';
const defaultWhisperCppPath = '/opt/homebrew/bin/whisper-cli';
const defaultOpenAIWhisperPath = '/opt/homebrew/bin/whisper';

export async function inspectLocalWhisperRuntime(
  request: Record<string, unknown> = {},
  options: Pick<LocalSpeechOptions, 'whisper_cpp_path' | 'whisper_model_dir' | 'whisper_path'> = {},
): Promise<Record<string, unknown>> {
  const model = boundedToken(request.model, 80) || preferredWhisperCppModel;
  if (!allowedWhisperModels.has(model)) throw new Error(`unsupported local Whisper model: ${model}`);

  if (model === preferredWhisperCppModel) {
    const binaryPath = options.whisper_cpp_path || defaultWhisperCppPath;
    const modelDir = options.whisper_model_dir || join(homedir(), 'Library', 'Application Support', 'Joi', 'models', 'whisper');
    const modelPath = join(modelDir, 'ggml-small.bin');
    const [binary, modelFile] = await Promise.all([fileStatus(binaryPath), fileStatus(modelPath)]);
    const ready = binary.ready && modelFile.ready;
    return {
      status: ready ? 'ready' : 'missing',
      ready,
      engine: 'whisper.cpp',
      provider: 'local_whisper_cpp',
      acceleration: 'Apple Metal',
      model,
      model_label: 'Small multilingual',
      binary_path: binaryPath,
      model_path: modelPath,
      model_size: modelFile.size,
      error_summary: ready
        ? ''
        : !binary.ready
          ? `whisper.cpp is not installed at ${binaryPath}`
          : `Whisper Small model is not installed at ${modelPath}`,
    };
  }

  const binaryPath = options.whisper_path || defaultOpenAIWhisperPath;
  const modelPath = join(homedir(), '.cache', 'whisper', `${model}.pt`);
  const [binary, modelFile] = await Promise.all([fileStatus(binaryPath), fileStatus(modelPath)]);
  const ready = binary.ready && modelFile.ready;
  return {
    status: ready ? 'ready' : 'missing',
    ready,
    engine: 'openai-whisper',
    provider: 'local_whisper',
    acceleration: 'CPU compatibility mode',
    model,
    model_label: model,
    binary_path: binaryPath,
    model_path: modelPath,
    model_size: modelFile.size,
    error_summary: ready
      ? ''
      : !binary.ready
        ? `OpenAI Whisper CLI is not installed at ${binaryPath}`
        : `Whisper ${model} compatibility model is not installed; Joi will not download it while recording`,
  };
}

export async function executeLocalTextToSpeech(
  request: Record<string, unknown>,
  options: LocalSpeechOptions,
): Promise<Record<string, unknown>> {
  const text = stringValue(request.text);
  if (!text) throw new Error('text_to_speech text is required');
  if (text.length > 20_000) throw new Error('text_to_speech text exceeds 20000 characters');
  const voice = boundedToken(request.voice, 80);
  const format = normalizedFormat(request.format);
  const rate = boundedNumber(request.rate, 185, 80, 450);
  const timeoutSeconds = boundedNumber(options.timeout_seconds, 180, 10, 300);
  const run = options.run_command || runCommand;
  await mkdir(options.output_dir, { recursive: true });
  const fileStem = `joi-speech-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const intermediatePath = join(options.output_dir, `${fileStem}.source.aiff`);
  const destinationPath = join(options.output_dir, `${fileStem}.${format}`);
  const sayArgs = [
    ...(voice ? ['-v', voice] : []),
    '-r', String(rate),
    '-o', intermediatePath,
    '--', text,
  ];
  const spoken = await run(options.say_path || '/usr/bin/say', sayArgs, {
    signal: options.signal,
    timeout_seconds: timeoutSeconds,
  });
  if (spoken.exit_code !== 0) throw new Error(`macOS speech synthesis failed: ${safeCommandError(spoken)}`);
  if (format === 'aiff') {
    const { rename } = await import('node:fs/promises');
    await rename(intermediatePath, destinationPath);
  } else {
    const codecArgs = format === 'mp3'
      ? ['-codec:a', 'libmp3lame', '-q:a', '4']
      : ['-codec:a', 'pcm_s16le'];
    const converted = await run(options.ffmpeg_path || '/opt/homebrew/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', intermediatePath, ...codecArgs, destinationPath,
    ], { signal: options.signal, timeout_seconds: timeoutSeconds });
    await rm(intermediatePath, { force: true });
    if (converted.exit_code !== 0) throw new Error(`speech audio conversion failed: ${safeCommandError(converted)}`);
  }
  const fileStat = await stat(destinationPath);
  if (!fileStat.isFile() || fileStat.size <= 0) throw new Error('speech synthesis produced an empty artifact');
  const durationSeconds = await mediaDuration(destinationPath, options, run);
  const mimeType = format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : 'audio/aiff';
  return {
    status: 'completed',
    capability: 'text_to_speech',
    mode: 'macos_say_ffmpeg_v1',
    provider: 'local_macos',
    voice: voice || 'system_default',
    rate,
    format,
    duration_seconds: durationSeconds,
    file_path: destinationPath,
    summary: `Generated ${durationSeconds.toFixed(2)} seconds of playable speech audio.`,
    attachment: {
      id: `attachment_${randomUUID().replace(/-/g, '')}`,
      name: basename(destinationPath),
      kind: 'audio',
      mime_type: mimeType,
      size: fileStat.size,
      preview_url: pathToFileURL(destinationPath).href,
    },
  };
}

export async function executeLocalSpeechTranscription(
  request: Record<string, unknown>,
  options: LocalSpeechOptions,
): Promise<Record<string, unknown>> {
  const sourcePath = stringValue(request.path);
  if (!sourcePath) throw new Error('speech_transcribe path is required');
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error('speech_transcribe source must be a non-empty file');
  const model = boundedToken(request.model, 80) || preferredWhisperCppModel;
  if (!allowedWhisperModels.has(model)) throw new Error(`unsupported local Whisper model: ${model}`);
  const language = boundedToken(request.language, 40) || (model.endsWith('.en') ? 'en' : 'auto');
  const timeoutSeconds = boundedNumber(options.timeout_seconds, 300, 30, 900);
  const run = options.run_command || runCommand;
  const resultDir = join(options.output_dir, `whisper-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(resultDir, { recursive: true });
  const runtime = await inspectLocalWhisperRuntime({ model }, options);
  if (runtime.ready !== true) throw new Error(`local Whisper is not ready: ${stringValue(runtime.error_summary)}`);
  const startedAt = Date.now();
  let parsed: Record<string, unknown>;
  let transcript = '';
  let segmentCount = 0;
  let durationSeconds = 0;

  if (runtime.engine === 'whisper.cpp') {
    const normalizedPath = join(resultDir, 'input.wav');
    const converted = await run(options.ffmpeg_path || '/opt/homebrew/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', normalizedPath,
    ], { signal: options.signal, timeout_seconds: Math.min(timeoutSeconds, 180) });
    if (converted.exit_code !== 0) throw new Error(`speech audio normalization failed: ${safeCommandError(converted)}`);
    durationSeconds = await mediaDuration(normalizedPath, options, run);
    const outputPrefix = join(resultDir, 'transcript');
    const args = [
      '--model', String(runtime.model_path),
      '--file', normalizedPath,
      '--language', language,
      ...(language === 'zh' ? ['--prompt', '以下是简体中文普通话转写，产品名称写作 Joi。'] : []),
      '--threads', '8',
      '--output-json',
      '--output-file', outputPrefix,
      '--no-prints',
      '--no-timestamps',
    ];
    const transcribed = await run(String(runtime.binary_path), args, {
      signal: options.signal,
      timeout_seconds: timeoutSeconds,
    });
    await rm(normalizedPath, { force: true });
    if (transcribed.exit_code !== 0) throw new Error(`local Whisper transcription failed: ${safeCommandError(transcribed)}`);
    parsed = JSON.parse(await readFile(`${outputPrefix}.json`, 'utf8')) as Record<string, unknown>;
    const segments = Array.isArray(parsed.transcription) ? parsed.transcription : [];
    transcript = segments
      .map((entry) => stringValue(recordValue(entry).text))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    segmentCount = segments.length;
  } else {
    const modelDir = join(homedir(), '.cache', 'whisper');
    const args = [
      sourcePath,
      '--model', model,
      '--model_dir', modelDir,
      ...(language === 'auto' ? [] : ['--language', language]),
      '--output_dir', resultDir,
      '--output_format', 'json',
      '--fp16', 'False',
      '--verbose', 'False',
    ];
    const transcribed = await run(String(runtime.binary_path), args, {
      signal: options.signal,
      timeout_seconds: timeoutSeconds,
    });
    if (transcribed.exit_code !== 0) throw new Error(`local Whisper transcription failed: ${safeCommandError(transcribed)}`);
    const jsonPath = join(resultDir, `${basename(sourcePath, extname(sourcePath))}.json`);
    parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as Record<string, unknown>;
    transcript = stringValue(parsed.text);
    segmentCount = Array.isArray(parsed.segments) ? parsed.segments.length : 0;
    durationSeconds = await mediaDuration(sourcePath, options, run);
  }
  if (!transcript) throw new Error('local Whisper returned an empty transcript');
  return {
    status: 'completed',
    capability: 'speech_transcribe',
    mode: runtime.engine === 'whisper.cpp' ? 'local_whisper_cpp_v1' : 'local_whisper_cli_v1',
    provider: runtime.provider,
    engine: runtime.engine,
    acceleration: runtime.acceleration,
    model,
    model_path: runtime.model_path,
    language,
    source_path: sourcePath,
    source_size: sourceStat.size,
    duration_seconds: durationSeconds,
    elapsed_seconds: Math.round((Date.now() - startedAt) / 10) / 100,
    transcript,
    segment_count: segmentCount,
    summary: `Transcribed ${durationSeconds.toFixed(2)} seconds of audio with local Whisper.`,
  };
}

async function fileStatus(path: string): Promise<{ ready: boolean; size: number }> {
  try {
    const file = await stat(path);
    return { ready: file.isFile() && file.size > 0, size: file.isFile() ? file.size : 0 };
  } catch {
    return { ready: false, size: 0 };
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function mediaDuration(
  path: string,
  options: LocalSpeechOptions,
  run: NonNullable<LocalSpeechOptions['run_command']>,
): Promise<number> {
  const probed = await run(options.ffprobe_path || '/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ], { signal: options.signal, timeout_seconds: 30 });
  if (probed.exit_code !== 0) throw new Error(`ffprobe failed: ${safeCommandError(probed)}`);
  const duration = Number(probed.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe returned an invalid duration');
  return Math.round(duration * 1000) / 1000;
}

async function runCommand(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; timeout_seconds: number },
): Promise<LocalSpeechCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    const append = (current: string, chunk: Buffer | string) => `${current}${String(chunk)}`.slice(-maxCommandOutputBytes);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const abort = () => child.kill('SIGTERM');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout_seconds * 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) {
        const error = new Error('local speech command aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      resolve({ stdout, stderr, exit_code: code ?? -1 });
    });
  });
}

function normalizedFormat(value: unknown): string {
  const format = stringValue(value).toLowerCase() || 'mp3';
  if (!allowedFormats.has(format)) throw new Error(`unsupported speech audio format: ${format}`);
  return format;
}

function boundedToken(value: unknown, maxLength: number): string {
  const token = stringValue(value);
  if (!token) return '';
  if (token.length > maxLength || /[\r\n\0]/.test(token)) throw new Error('invalid bounded token');
  return token;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeCommandError(result: LocalSpeechCommandResult): string {
  return (result.stderr || result.stdout || 'unknown error').replace(/\s+/g, ' ').trim().slice(-1_000);
}
