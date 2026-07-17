import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

type XAIVideoOptions = {
  api_key: string;
  base_url: string;
  output_dir: string;
  signal?: AbortSignal;
  poll_interval_ms?: number;
  timeout_seconds?: number;
  fetch_impl?: typeof fetch;
};

const allowedAspectRatios = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const allowedResolutions = new Set(['480p', '720p']);

export async function executeXAIVideoGeneration(
  request: Record<string, unknown>,
  options: XAIVideoOptions,
): Promise<Record<string, unknown>> {
  const prompt = stringValue(request.prompt);
  if (!prompt) throw new Error('video_generate prompt is required');
  if (prompt.length > 8_000) throw new Error('video_generate prompt exceeds 8000 characters');
  if (!options.api_key.trim()) throw new Error('xAI video generation requires an authenticated API credential');
  const aspectRatio = normalizedChoice(request.aspect_ratio, allowedAspectRatios, '16:9', 'aspect ratio');
  const resolution = normalizedChoice(request.resolution, allowedResolutions, '480p', 'resolution');
  const duration = boundedInteger(request.duration_seconds, 4, 1, 15);
  const baseURL = options.base_url.replace(/\/+$/, '');
  const fetchImpl = options.fetch_impl || fetch;
  const startedAt = Date.now();
  const timeoutMS = boundedInteger(options.timeout_seconds, 300, 30, 900) * 1_000;
  const pollIntervalMS = boundedInteger(options.poll_interval_ms, 2_000, 250, 10_000);
  const created = await fetchJSON(fetchImpl, `${baseURL}/videos/generations`, {
    method: 'POST',
    headers: authHeaders(options.api_key),
    body: JSON.stringify({
      model: 'grok-imagine-video',
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      resolution,
    }),
    signal: options.signal,
  });
  const requestID = stringValue(created.request_id) || stringValue(created.id);
  if (!requestID) throw new Error('xAI video generation did not return a request id');
  let completed: Record<string, unknown> = created;
  while (!videoURL(completed)) {
    const status = stringValue(completed.status).toLowerCase();
    if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status)) {
      throw new Error(`xAI video generation ${status}: ${stringValue(completed.error) || stringValue(completed.message) || requestID}`);
    }
    if (Date.now() - startedAt >= timeoutMS) throw new Error(`xAI video generation timed out for request ${requestID}`);
    await abortableDelay(pollIntervalMS, options.signal);
    completed = await fetchJSON(fetchImpl, `${baseURL}/videos/${encodeURIComponent(requestID)}`, {
      method: 'GET',
      headers: authHeaders(options.api_key),
      signal: options.signal,
    });
  }
  const sourceURL = videoURL(completed);
  const videoResponse = await fetchImpl(sourceURL, { signal: options.signal });
  if (!videoResponse.ok) throw new Error(`xAI video download failed with HTTP ${videoResponse.status}`);
  const payload = Buffer.from(await videoResponse.arrayBuffer());
  if (payload.length < 16 || payload.length > 256 * 1024 * 1024) throw new Error('xAI video artifact has an invalid size');
  if (payload.subarray(4, 8).toString('ascii') !== 'ftyp') throw new Error('xAI video artifact is not a valid MP4 container');
  await mkdir(options.output_dir, { recursive: true });
  const destinationName = `joi-xai-video-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const destinationPath = join(options.output_dir, destinationName);
  await writeFile(destinationPath, payload);
  const fileStat = await stat(destinationPath);
  const reportedDuration = numberValue(record(completed.video).duration) || numberValue(completed.duration) || duration;
  return {
    status: 'completed',
    capability: 'video_generate',
    mode: 'xai_async_video_v1',
    provider: 'xai',
    model: 'grok-imagine-video',
    request_id: requestID,
    aspect_ratio: aspectRatio,
    resolution,
    duration_seconds: reportedDuration,
    source_url: sourceURL,
    file_path: destinationPath,
    summary: `Generated and downloaded a ${reportedDuration}-second MP4 video.`,
    attachment: {
      id: `attachment_${randomUUID().replace(/-/g, '')}`,
      name: basename(destinationPath),
      kind: 'video',
      mime_type: 'video/mp4',
      size: fileStat.size,
      preview_url: pathToFileURL(destinationPath).href,
    },
  };
}

async function fetchJSON(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    payload = record(parsed);
  } catch {
    payload = { message: text.slice(0, 2_000) };
  }
  if (!response.ok) {
    const detail = stringValue(record(payload.error).message) || stringValue(payload.error) || stringValue(payload.message);
    throw new Error(`xAI video API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return payload;
}

function videoURL(payload: Record<string, unknown>): string {
  return stringValue(record(payload.video).url)
    || stringValue(record(payload.output).url)
    || stringValue(payload.url);
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('xAI video generation aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('xAI video generation aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

function normalizedChoice(value: unknown, allowed: Set<string>, fallback: string, label: string): string {
  const normalized = stringValue(value).toLowerCase() || fallback;
  if (!allowed.has(normalized)) throw new Error(`unsupported video ${label}: ${normalized}`);
  return normalized;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
