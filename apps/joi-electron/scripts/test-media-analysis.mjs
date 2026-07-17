import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImageFile, analyzeVideoFile, saveMediaDataURL } from '../src/main/media-analysis.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'joi-media-analysis-'));
const imagePath = join(tempDir, 'fixture.png');
const videoPath = join(tempDir, 'fixture.mp4');
const evidence = {};

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
let style = NSMutableParagraphStyle()
style.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.boldSystemFont(ofSize: 72),
  .foregroundColor: NSColor.black,
  .paragraphStyle: style,
]
let text = NSAttributedString(string: "JOI MEDIA REAL TEST", attributes: attributes)
text.draw(in: NSRect(x: 80, y: 300, width: 1120, height: 120))
image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { exit(2) }
try png.write(to: URL(fileURLWithPath: output))
`);
  execFileSync('/usr/bin/swift', [imageScript, imagePath]);
  execFileSync('/opt/homebrew/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', imagePath,
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath,
  ]);

  const image = await analyzeImageFile(imagePath, join(tempDir, 'image-analysis'));
  assert.equal(image.status, 'completed');
  assert.equal(image.capability, 'image_analyze');
  assert.ok(Number(image.width) >= 1200 && Number(image.height) >= 700);
  assert.match(String(image.text).toUpperCase(), /JOI.*MEDIA.*REAL.*TEST/);

  const video = await analyzeVideoFile(videoPath, join(tempDir, 'video-analysis'), { max_frames: 4 });
  assert.equal(video.status, 'completed');
  assert.equal(video.capability, 'video_analyze');
  assert.ok(Number(video.duration_seconds) >= 1.5);
  assert.ok(Number(video.frame_count) >= 1);
  assert.ok(video.contact_sheet_path && existsSync(String(video.contact_sheet_path)));
  assert.match(String(video.recognized_text).toUpperCase(), /JOI.*MEDIA.*REAL.*TEST/);

  const encoded = readFileSync(videoPath).toString('base64');
  const saved = await saveMediaDataURL(`data:video/mp4;base64,${encoded}`, join(tempDir, 'recordings'));
  assert.equal(saved.status, 'completed');
  assert.equal(saved.mime_type, 'video/mp4');
  assert.ok(existsSync(String(saved.file_path)));

  evidence.image = image;
  evidence.video = video;
  evidence.saved_recording = saved;
  if (process.env.JOI_EVIDENCE_DIR) {
    mkdirSync(process.env.JOI_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.JOI_EVIDENCE_DIR, 'media-analysis-result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('media analysis real-runtime tests passed');
