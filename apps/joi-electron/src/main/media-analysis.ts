import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

type ProcessResult = { stdout: string; stderr: string; exit_code: number; duration_ms: number };
type OCRResult = { path: string; width: number; height: number; text: string; observations: Array<{ text: string; confidence: number }> };

const maxMediaBytes = 512 * 1024 * 1024;

export async function saveMediaDataURL(
  dataURL: string,
  outputDir: string,
  preferredMime = '',
): Promise<Record<string, unknown>> {
  if (!dataURL.startsWith('data:')) throw new Error('recording data_url is invalid');
  const comma = dataURL.indexOf(',');
  if (comma <= 5) throw new Error('recording data_url is invalid');
  const headerParts = dataURL.slice(5, comma).split(';').map((part) => part.trim()).filter(Boolean);
  const mimeType = (headerParts[0] || preferredMime || 'application/octet-stream').toLowerCase();
  const encoded = dataURL.slice(comma + 1);
  const payload = headerParts.includes('base64')
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded), 'utf8');
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
  };
}

export async function withTemporaryMediaDataURL<T>(
  dataURL: string,
  preferredMime: string,
  task: (path: string, saved: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const temporaryDir = await mkdtemp(join(tmpdir(), 'joi-voice-input-'));
  try {
    const saved = await saveMediaDataURL(dataURL, temporaryDir, preferredMime);
    const path = typeof saved.file_path === 'string' ? saved.file_path : '';
    if (!path) throw new Error('temporary recording did not return a local path');
    return await task(path, saved);
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
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
