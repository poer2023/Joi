import { realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { ChatResponse } from '../../../../packages/shared-types/src/desktop-api';

export type IMessageOutboundAttachment = {
  artifact_id: string;
  path: string;
  name: string;
  mime_type: string;
  size: number;
};

const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxOutboundImageBytes = 20 * 1024 * 1024;
const maxOutboundImages = 8;

export function resolveIMessageOutboundAttachments(
  result: ChatResponse,
  generatedImagesDir: string,
): IMessageOutboundAttachment[] {
  let allowedRoot = '';
  try {
    allowedRoot = realpathSync(generatedImagesDir);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const resolved: IMessageOutboundAttachment[] = [];
  for (const artifact of result.artifacts || []) {
    if (resolved.length >= maxOutboundImages) break;
    if (artifact.type !== 'image' || artifact.source_run_id !== result.run_id) continue;
    const metadata = artifact.metadata || {};
    if (metadata.generation_mode !== 'grok_build_native_image_gen' || metadata.native_tool !== 'image_gen') continue;
    const rawPath = stringValue(metadata.file_path);
    const mimeType = stringValue(metadata.mime_type).toLowerCase();
    if (!rawPath || !allowedImageMimeTypes.has(mimeType)) continue;

    try {
      const filePath = realpathSync(resolve(rawPath));
      if (!isInside(allowedRoot, filePath) || seen.has(filePath)) continue;
      const fileStat = statSync(filePath);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxOutboundImageBytes) continue;
      seen.add(filePath);
      resolved.push({
        artifact_id: artifact.id,
        path: filePath,
        name: stringValue(metadata.file_name) || basename(filePath),
        mime_type: mimeType,
        size: fileStat.size,
      });
    } catch {
      continue;
    }
  }
  return resolved;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
