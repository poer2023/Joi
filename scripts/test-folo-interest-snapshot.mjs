import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFoloInterestSnapshot,
  classifySourceFamily,
  readFoloSubscriptions,
  sanitizeFeedURL,
} from './folo-interest-snapshot.mjs';

const testDir = mkdtempSync(join(tmpdir(), 'joi-folo-snapshot-test-'));
const databasePath = join(testDir, 'follow.db');
const outputPath = join(testDir, 'snapshot.json');
const scriptPath = fileURLToPath(new URL('./folo-interest-snapshot.mjs', import.meta.url));

try {
  createFixture(databasePath);
  const beforeHash = fileHash(databasePath);
  const rows = readFoloSubscriptions(databasePath);
  const afterHash = fileHash(databasePath);
  assert.equal(afterHash, beforeHash, 'read-only import must not mutate the Folo snapshot');
  assert.equal(rows.length, 8);

  const snapshot = buildFoloInterestSnapshot(rows, {
    capturedAt: '2026-07-11T00:00:00.000Z',
  });
  assert.equal(snapshot.schema_version, 3);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'captured_at',
    'categories',
    'counts',
    'privacy',
    'schema_version',
    'source',
    'topics',
  ]);
  assert.equal(snapshot.counts.total_subscriptions, 8);
  assert.equal(snapshot.counts.private_subscriptions, 2);
  assert.equal(snapshot.counts.public_subscriptions, 6);
  assert.equal(snapshot.counts.by_view.find((item) => item.key === 'articles').total, 3);
  assert.deepEqual(snapshot.categories.find((item) => item.key === 'pictures'), {
    key: 'pictures',
    label: '图片',
    total: 1,
    public: 0,
    private: 1,
  });
  assert.equal(snapshot.topics.find((item) => item.key === 'x_and_social').matched_public_subscriptions, 1);
  assert.equal(Object.hasOwn(snapshot, 'source_families'), false);
  assert.equal(Object.hasOwn(snapshot, 'representative_sources'), false);

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'private model photos',
    'private notification title',
    'private-feed-token-should-never-leak',
    'public-query-token',
    'embedded-password',
    'query-secret',
    'private.example',
    'private-notify.example',
    '私密订阅',
    'Example AI Digest',
    'Twitter @fixture_user',
    'Fixture Hardware Videos',
    'Fixture Plugin Releases',
    'Credential test',
    'Fixture Photo Channel',
    'example.com',
    'x.com',
    'bilibili.com',
    't.me',
    'rsshub:',
    'https://',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
  assert.equal(snapshot.privacy.private_titles_included, false);
  assert.equal(snapshot.privacy.private_urls_included, false);
  assert.equal(snapshot.privacy.public_titles_included, false);
  assert.equal(snapshot.privacy.public_urls_included, false);
  assert.equal(snapshot.privacy.source_names_included, false);
  assert.equal(snapshot.privacy.custom_category_labels_included, false);
  assert.equal(snapshot.privacy.private_category_labels_included, false);
  assert.equal(snapshot.privacy.representative_sources_included, false);
  assert.equal(snapshot.privacy.aggregate_only, true);
  assert.equal(snapshot.privacy.output_mode, 'shareable_redacted');
  assertNoConcreteSourceFields(snapshot);

  assert.equal(classifySourceFamily('rsshub://twitter/user/fixture_user'), 'x_twitter');
  assert.equal(classifySourceFamily('rsshub://bilibili/user/video/1'), 'bilibili');
  assert.equal(sanitizeFeedURL('https://user:embedded-password@example.com/rss?token=query-secret'), 'https://example.com/rss');
  assert.equal(
    sanitizeFeedURL('https://example.com/key/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789?auth=query-secret'),
    'https://example.com/key/<redacted>',
  );

  const cli = spawnSync(process.execPath, [
    scriptPath,
    '--db', databasePath,
    '--out', outputPath,
    '--shareable',
    '--captured-at', '2026-07-11T00:00:00.000Z',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const cliSnapshot = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.deepEqual(cliSnapshot, snapshot);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(fileHash(databasePath), beforeHash, 'CLI must leave the input database byte-identical');

  const redactedCLI = spawnSync(process.execPath, [
    scriptPath,
    '--db', databasePath,
    '--redacted',
    '--captured-at', '2026-07-11T00:00:00.000Z',
  ], { encoding: 'utf8' });
  assert.equal(redactedCLI.status, 0, redactedCLI.stderr);
  assert.deepEqual(JSON.parse(redactedCLI.stdout), snapshot);

  const relativePath = spawnSync(process.execPath, [scriptPath, '--db', 'follow.db'], { encoding: 'utf8' });
  assert.notEqual(relativePath.status, 0);
  assert.match(relativePath.stderr, /explicit absolute path/i);

  console.log('Folo interest snapshot helper tests passed');
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

function createFixture(path) {
  execFileSync('sqlite3', [path, String.raw`
CREATE TABLE subscriptions (
  feed_id text,
  list_id text,
  inbox_id text,
  user_id text NOT NULL,
  view integer NOT NULL,
  is_private integer NOT NULL,
  title text,
  category text,
  created_at text,
  type text NOT NULL,
  id text PRIMARY KEY NOT NULL,
  hide_from_timeline integer
);
CREATE TABLE feeds (
  id text PRIMARY KEY NOT NULL,
  title text,
  url text NOT NULL,
  description text,
  image text,
  error_at text,
  site_url text,
  owner_user_id text,
  error_message text
);
INSERT INTO feeds (id,title,url,site_url) VALUES
  ('feed_article','Example AI Digest','https://example.com/feed.xml?token=public-query-token','https://example.com/?utm_source=folo'),
  ('feed_social','Twitter @fixture_user','rsshub://twitter/user/fixture_user?token=public-query-token','https://x.com/fixture_user'),
  ('feed_private_picture','private model photos','https://private.example/sub/private-feed-token-should-never-leak','https://private.example/secret'),
  ('feed_video','Fixture Hardware Videos','rsshub://bilibili/user/video/123','https://space.bilibili.com/123'),
  ('feed_private_notification','private notification title','rsshub://custom/private/private-feed-token-should-never-leak','https://private-notify.example'),
  ('feed_notification','Fixture Plugin Releases','rsshub://github/example/plugin/releases','https://plugins.example.com'),
  ('feed_credential','Credential test','https://user:embedded-password@safe.example.com/key/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789?auth=query-secret','https://safe.example.com'),
  ('feed_telegram','Fixture Photo Channel','rsshub://telegram/channel/fixture_channel','https://t.me/fixture_channel');
INSERT INTO subscriptions (feed_id,user_id,view,is_private,title,category,type,id,hide_from_timeline) VALUES
  ('feed_article','user-secret',0,0,NULL,'','feed','sub_1',0),
  ('feed_social','user-secret',1,0,NULL,'','feed','sub_2',0),
  ('feed_private_picture','user-secret',2,1,'private model photos','私密订阅','feed','sub_3',0),
  ('feed_video','user-secret',3,0,NULL,'','feed','sub_4',0),
  ('feed_private_notification','user-secret',5,1,'private notification title','私密订阅','feed','sub_5',1),
  ('feed_notification','user-secret',5,0,NULL,'','feed','sub_6',0),
  ('feed_credential','user-secret',0,0,NULL,'','feed','sub_7',0),
  ('feed_telegram','user-secret',0,0,NULL,'','feed','sub_8',0);
`], { stdio: 'pipe' });
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertNoConcreteSourceFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoConcreteSourceFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const forbiddenKeys = new Set([
    'name',
    'subscription_id',
    'title',
    'url',
    'site_url',
    'source_family',
    'representative_sources',
  ]);
  for (const [key, item] of Object.entries(value)) {
    assert.equal(forbiddenKeys.has(key), false, `shareable snapshot contains ${path}.${key}`);
    assertNoConcreteSourceFields(item, `${path}.${key}`);
  }
}
