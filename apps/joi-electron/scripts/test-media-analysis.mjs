import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImageFile, withTemporaryMediaDataURL } from '../src/main/media-analysis.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'joi-media-analysis-'));
const imagePath = join(tempDir, 'fixture.png');

try {
  const imageScript = join(tempDir, 'fixture.swift');
  writeFileSync(imageScript, String.raw`
import AppKit
import Foundation

let output = CommandLine.arguments[1]
let size = NSSize(width: 1280, height: 720)
let image = NSImage(size: size)
image.lockFocus()
NSColor.white.setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.boldSystemFont(ofSize: 72),
  .foregroundColor: NSColor.black,
]
NSAttributedString(string: "JOI IMAGE REAL TEST", attributes: attributes)
  .draw(in: NSRect(x: 120, y: 300, width: 1040, height: 120))
image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { exit(2) }
try png.write(to: URL(fileURLWithPath: output))
`);
  execFileSync('/usr/bin/swift', [imageScript, imagePath]);

  const image = await analyzeImageFile(imagePath, join(tempDir, 'image-analysis'));
  assert.equal(image.status, 'completed');
  assert.equal(image.capability, 'image_analyze');
  assert.ok(Number(image.width) >= 1200 && Number(image.height) >= 700);
  assert.match(String(image.text).toUpperCase(), /JOI.*IMAGE.*REAL.*TEST/);

  const encoded = Buffer.from('local audio fixture').toString('base64');
  let temporaryPath = '';
  const saved = await withTemporaryMediaDataURL(`data:audio/webm;codecs=opus;base64,${encoded}`, 'audio/webm', async (path, output) => {
    temporaryPath = path;
    assert.ok(existsSync(path));
    assert.equal(output.status, 'completed');
    assert.equal(output.mime_type, 'audio/webm');
    assert.equal('attachment' in output, false);
    return output;
  });
  assert.equal(saved.status, 'completed');
  assert.equal(existsSync(temporaryPath), false);

  let failedTemporaryPath = '';
  await assert.rejects(
    withTemporaryMediaDataURL(`data:audio/webm;codecs=opus;base64,${encoded}`, 'audio/webm', async (path) => {
      failedTemporaryPath = path;
      throw new Error('transcription fixture failure');
    }),
    /transcription fixture failure/,
  );
  assert.equal(existsSync(failedTemporaryPath), false);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('image analysis and transient recording cleanup tests passed');
