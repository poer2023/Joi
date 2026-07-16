import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

type ProcessResult = { stdout: string; stderr: string; exit_code: number; duration_ms: number };
type OCRResult = { path: string; width: number; height: number; text: string; observations: Array<{ text: string; confidence: number }> };

const maxMediaBytes = 512 * 1024 * 1024;

export async function saveMediaDataURL(
  dataURL: string,
  outputDir: string,
  preferredMime = '',
): Promise<Record<string, unknown>> {
  const matched = dataURL.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/);
  if (!matched) throw new Error('recording data_url is invalid');
  const mimeType = (matched[1] || preferredMime || 'application/octet-stream').toLowerCase();
  const payload = matched[2] ? Buffer.from(matched[3], 'base64') : Buffer.from(decodeURIComponent(matched[3]), 'utf8');
  if (!payload.length || payload.length > maxMediaBytes) throw new Error('recording payload has an invalid size');
  const extension = extensionForMime(mimeType);
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, `joi-recording-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`);
  await writeFile(path, payload);
  return {
    status: 'completed',
    mode: 'renderer_media_recorder_v1',
    file_path: path,
    preview_url: pathToFileURL(path).href,
    mime_type: mimeType,
    size: payload.length,
    attachment: {
      id: `attachment_${randomUUID().replace(/-/g, '')}`,
      name: basename(path),
      kind: mimeType.startsWith('video/') ? 'video' : 'audio',
      mime_type: mimeType,
      size: payload.length,
      preview_url: pathToFileURL(path).href,
    },
  };
}

export async function analyzeImageFile(
  sourcePath: string,
  outputDir: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  await requireMediaFile(sourcePath);
  await mkdir(outputDir, { recursive: true });
  const [probe, ocr] = await Promise.all([
    probeMedia(sourcePath, signal),
    recognizeText([sourcePath], outputDir, signal),
  ]);
  const item = ocr[0] || { path: sourcePath, width: 0, height: 0, text: '', observations: [] };
  return {
    status: 'completed',
    capability: 'image_analyze',
    mode: 'macos_vision_ffprobe_v1',
    source_path: sourcePath,
    preview_url: pathToFileURL(sourcePath).href,
    width: item.width,
    height: item.height,
    text: item.text,
    observations: item.observations,
    media: probe,
    summary: item.text
      ? `Analyzed image and recognized ${item.observations.length} text region(s).`
      : 'Analyzed image; no readable text was detected.',
  };
}

export async function analyzeVideoFile(
  sourcePath: string,
  outputDir: string,
  options: { signal?: AbortSignal; max_frames?: number } = {},
): Promise<Record<string, unknown>> {
  const source = await requireMediaFile(sourcePath);
  const analysisID = `video-analysis-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const analysisDir = join(outputDir, analysisID);
  await mkdir(analysisDir, { recursive: true });
  const probe = await probeMedia(sourcePath, options.signal);
  const duration = mediaDuration(probe);
  const maxFrames = Math.max(1, Math.min(12, Math.round(options.max_frames || 6)));
  const interval = Math.max(0.25, duration > 0 ? duration / maxFrames : 1);
  const framePattern = join(analysisDir, 'frame-%02d.jpg');
  const extracted = await runProcess('/opt/homebrew/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
    '-vf', `fps=1/${interval},scale=960:-2:force_original_aspect_ratio=decrease`,
    '-frames:v', String(maxFrames), framePattern,
  ], { signal: options.signal, timeout_ms: 180_000 });
  if (extracted.exit_code !== 0) throw new Error(`video frame extraction failed: ${safeError(extracted)}`);
  const frames = (await readdir(analysisDir))
    .filter((name) => /^frame-\d+\.jpg$/.test(name))
    .sort()
    .map((name) => join(analysisDir, name));
  if (!frames.length) throw new Error('video analysis produced no keyframes');
  const ocr = await recognizeText(frames, analysisDir, options.signal);
  const contactSheet = join(analysisDir, 'contact-sheet.jpg');
  const tiled = await runProcess('/opt/homebrew/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-pattern_type', 'glob', '-i', join(analysisDir, 'frame-*.jpg'),
    '-vf', `tile=${Math.min(3, frames.length)}x${Math.ceil(frames.length / Math.min(3, frames.length))}:padding=8:margin=8:color=white`,
    '-frames:v', '1', contactSheet,
  ], { signal: options.signal, timeout_ms: 120_000 });
  const hasContactSheet = tiled.exit_code === 0;
  const keyframes = frames.map((path, index) => ({
    path,
    preview_url: pathToFileURL(path).href,
    timestamp_seconds: Math.round(index * interval * 1000) / 1000,
    text: ocr[index]?.text || '',
    observations: ocr[index]?.observations || [],
  }));
  const recognizedText = [...new Set(keyframes.map((frame) => frame.text.trim()).filter(Boolean))].join('\n');
  return {
    status: 'completed',
    capability: 'video_analyze',
    mode: 'ffmpeg_keyframes_macos_vision_v1',
    source_path: sourcePath,
    source_size: source.size,
    duration_seconds: duration,
    media: probe,
    frame_count: keyframes.length,
    keyframes,
    contact_sheet_path: hasContactSheet ? contactSheet : undefined,
    contact_sheet_url: hasContactSheet ? pathToFileURL(contactSheet).href : undefined,
    recognized_text: recognizedText,
    analysis_dir: analysisDir,
    summary: `Analyzed ${duration.toFixed(2)} seconds of video across ${keyframes.length} keyframe(s).`,
  };
}

async function probeMedia(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const result = await runProcess('/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
  ], { signal, timeout_ms: 30_000 });
  if (result.exit_code !== 0) throw new Error(`ffprobe failed: ${safeError(result)}`);
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return record(parsed);
  } catch {
    throw new Error('ffprobe returned invalid JSON');
  }
}

function mediaDuration(probe: Record<string, unknown>): number {
  const format = record(probe.format);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
  const raw = Number(format.duration) || Math.max(0, ...streams.map((stream) => Number(stream.duration) || 0));
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1000) / 1000 : 0;
}

async function recognizeText(paths: string[], outputDir: string, signal?: AbortSignal): Promise<OCRResult[]> {
  const scriptPath = join(outputDir, 'joi-vision-ocr.swift');
  await writeFile(scriptPath, visionOCRSource, 'utf8');
  const result = await runProcess('/usr/bin/swift', [scriptPath, ...paths], { signal, timeout_ms: 180_000 });
  if (result.exit_code !== 0) throw new Error(`macOS Vision analysis failed: ${safeError(result)}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '[]';
  try {
    const parsed = JSON.parse(line) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => normalizeOCRResult(item)) : [];
  } catch {
    throw new Error('macOS Vision returned invalid JSON');
  }
}

function normalizeOCRResult(value: unknown): OCRResult {
  const item = record(value);
  return {
    path: String(item.path || ''),
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    text: String(item.text || ''),
    observations: Array.isArray(item.observations)
      ? item.observations.map((entry) => ({ text: String(record(entry).text || ''), confidence: Number(record(entry).confidence || 0) }))
      : [],
  };
}

async function requireMediaFile(path: string) {
  const cleanPath = path.trim();
  if (!cleanPath) throw new Error('media path is required');
  const file = await stat(cleanPath);
  if (!file.isFile() || file.size <= 0 || file.size > maxMediaBytes) throw new Error('media source has an invalid size');
  return file;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('aiff')) return 'aiff';
  if (mimeType.includes('ogg')) return 'ogg';
  return mimeType.startsWith('video/') ? 'mov' : mimeType.startsWith('audio/') ? 'm4a' : 'bin';
}

function runProcess(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeout_ms: number },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`.slice(-4 * 1024 * 1024);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const terminate = () => {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1_000).unref();
    };
    const timer = setTimeout(terminate, options.timeout_ms);
    options.signal?.addEventListener('abort', terminate, { once: true });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal?.aborted) {
        const error = new Error('media analysis aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      resolve({ stdout, stderr, exit_code: code ?? -1, duration_ms: Date.now() - started });
    });
  });
}

function safeError(result: ProcessResult): string {
  return (result.stderr || result.stdout || 'unknown error').replace(/\s+/g, ' ').trim().slice(-1_500);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const visionOCRSource = String.raw`
import AppKit
import Foundation
import Vision

struct Observation: Codable {
  let text: String
  let confidence: Float
}

struct Result: Codable {
  let path: String
  let width: Int
  let height: Int
  let text: String
  let observations: [Observation]
}

var results: [Result] = []
for path in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: path) else {
    results.append(Result(path: path, width: 0, height: 0, text: "", observations: []))
    continue
  }
  var proposedRect = NSRect(origin: .zero, size: image.size)
  guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    results.append(Result(path: path, width: 0, height: 0, text: "", observations: []))
    continue
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  do {
    try handler.perform([request])
    let observations = (request.results ?? []).compactMap { observation -> Observation? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      return Observation(text: candidate.string, confidence: candidate.confidence)
    }
    results.append(Result(
      path: path,
      width: cgImage.width,
      height: cgImage.height,
      text: observations.map { $0.text }.joined(separator: "\n"),
      observations: observations
    ))
  } catch {
    fputs("Vision error for \(path): \(error)\n", stderr)
    results.append(Result(path: path, width: cgImage.width, height: cgImage.height, text: "", observations: []))
  }
}
let data = try JSONEncoder().encode(results)
print(String(data: data, encoding: .utf8) ?? "[]")
`;
