import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeDesktopAppInspect,
  executeDesktopAppList,
} from '../src/desktop-apps.ts';

const root = mkdtempSync(join(tmpdir(), 'joi-desktop-apps-'));

try {
  const appRoot = join(root, 'Applications');
  const appPath = join(appRoot, 'Fixture.app');
  mkdirSync(join(appPath, 'Contents'), { recursive: true });
  writeFileSync(join(appPath, 'Contents', 'Info.plist'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '<key>CFBundleDisplayName</key><string>Fixture App</string>',
    '<key>CFBundleIdentifier</key><string>com.example.fixture</string>',
    '<key>CFBundleShortVersionString</key><string>1.2.3</string>',
    '<key>CFBundleExecutable</key><string>Fixture</string>',
    '</dict></plist>',
  ].join('\n'));

  const nestedIgnored = join(appRoot, 'Nested', 'Too', 'Deep', 'More', 'Ignored.app');
  mkdirSync(join(nestedIgnored, 'Contents'), { recursive: true });

  const roots = [{ path: appRoot, source: 'fixture' }];
  const list = executeDesktopAppList({}, roots);
  assert.equal(list.mode, 'desktop_app_list_v1_bundle_scan');
  assert.equal(list.total, 1);
  assert.equal(list.apps[0].name, 'Fixture App');
  assert.equal(list.apps[0].bundle_id, 'com.example.fixture');
  assert.equal(list.apps[0].content_readable, false);

  const inspectByName = executeDesktopAppInspect({ name: 'fixture' }, roots);
  assert.equal(inspectByName.mode, 'desktop_app_inspect_v1_bundle_scan');
  assert.equal(inspectByName.total, 1);
  assert.equal(inspectByName.matches[0].version, '1.2.3');

  const inspectByBundle = executeDesktopAppInspect({ bundle_id: 'com.example.fixture' }, roots);
  assert.equal(inspectByBundle.total, 1);

  const missing = executeDesktopAppInspect({ name: 'missing' }, roots);
  assert.equal(missing.total, 0);

  assert.throws(() => executeDesktopAppInspect({}, roots), /requires name/);

  console.log('desktop apps runtime tests passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
