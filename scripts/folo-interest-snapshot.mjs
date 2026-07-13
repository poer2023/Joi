#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIEW_DEFINITIONS = new Map([
  [0, { key: 'articles', label: '文章' }],
  [1, { key: 'social_media', label: '社交媒体' }],
  [2, { key: 'pictures', label: '图片' }],
  [3, { key: 'videos', label: '视频' }],
  [4, { key: 'audio', label: '音频' }],
  [5, { key: 'notifications', label: '通知' }],
]);

const TOPIC_RULES = [
  {
    key: 'ai_and_agents',
    label: 'AI、模型与智能体',
    test: ({ searchable }) => /\b(ai|openai|anthropic|claude|llm|gpt|codex)\b|人工智能|智能体/i.test(searchable),
  },
  {
    key: 'developer_tools',
    label: '开发工具与软件',
    test: ({ searchable }) => /\b(linux|github|developer|software|plugin|code)\b|开发|软件|插件/i.test(searchable),
  },
  {
    key: 'x_and_social',
    label: 'X / Twitter 与社交动态',
    test: ({ sourceFamily, searchable }) => sourceFamily === 'x_twitter' || /twitter|x\.com|即刻|bluesky/i.test(searchable),
  },
  {
    key: 'images_and_photography',
    label: '图片、摄影与视觉内容',
    test: ({ view, searchable }) => view === 2 || /photo|photography|instagram|\bins\b|摄影|图片|视觉/i.test(searchable),
  },
  {
    key: 'video_and_hardware',
    label: '视频、数码与硬件',
    test: ({ view, sourceFamily, searchable }) => view === 3 || ['bilibili', 'youtube'].includes(sourceFamily) || /\b(video|hardware|benchmark|review)\b|评测|硬件|数码|视频/i.test(searchable),
  },
  {
    key: 'games',
    label: '游戏与游戏资讯',
    test: ({ searchable }) => /\b(game|games|gaming)\b|游戏/i.test(searchable),
  },
  {
    key: 'news_and_reading',
    label: '资讯、博客与阅读',
    test: ({ view, searchable }) => view === 0 || /\b(news|blog|feed|weekly)\b|资讯|博客|日报|早报|阅读/i.test(searchable),
  },
  {
    key: 'notification_watch',
    label: '更新、发布与提醒',
    test: ({ view }) => view === 5,
  },
];

const SENSITIVE_FIELD_PATTERN = /(?:^|[-_.])(token|secret|password|passwd|authorization|auth|api[-_]?key|session|cookie|signature|sig|credential)(?:$|[-_.])/i;
const SENSITIVE_PATH_PREFIXES = new Set(['token', 'secret', 'password', 'passwd', 'auth', 'authorization', 'key', 'apikey', 'api-key', 'session', 'cookie', 'signature', 'sig', 'credential', 'sub']);
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary');

const SUBSCRIPTION_SQL = String.raw`
SELECT
  s.id AS subscription_id,
  s.view AS view,
  s.is_private AS is_private,
  COALESCE(s.hide_from_timeline, 0) AS hide_from_timeline,
  COALESCE(NULLIF(s.title, ''), NULLIF(f.title, ''), '') AS title,
  f.url AS url,
  COALESCE(f.site_url, '') AS site_url
FROM subscriptions AS s
JOIN feeds AS f ON f.id = s.feed_id
WHERE s.type = 'feed' AND s.feed_id IS NOT NULL
ORDER BY s.view, s.is_private, lower(COALESCE(NULLIF(s.title, ''), NULLIF(f.title, ''), '')), s.id;
`;

export function readFoloSubscriptions(databasePath, options = {}) {
  const sqliteBinary = options.sqliteBinary || 'sqlite3';
  const safePath = validateSnapshotPath(databasePath);
  let stdout;
  try {
    stdout = execFileSync(sqliteBinary, ['-readonly', '-json', safePath, SUBSCRIPTION_SQL], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeoutMs || 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || 'sqlite3 failed');
    if (/no such table|no such column/i.test(stderr)) {
      throw new Error('The snapshot is not a supported Folo database (subscriptions/feeds schema missing).');
    }
    throw new Error(`Unable to read the Folo snapshot with sqlite3: ${sanitizeError(stderr)}`);
  }

  let rows;
  try {
    rows = JSON.parse(stdout || '[]');
  } catch {
    throw new Error('sqlite3 returned malformed JSON for the Folo snapshot.');
  }
  if (!Array.isArray(rows)) throw new Error('Folo snapshot query did not return an array.');

  return rows.map((row) => ({
    subscriptionID: String(row.subscription_id || ''),
    view: Number(row.view),
    isPrivate: Number(row.is_private) === 1,
    hideFromTimeline: Number(row.hide_from_timeline) === 1,
    title: String(row.title || ''),
    url: String(row.url || ''),
    siteURL: String(row.site_url || ''),
  }));
}

export function buildFoloInterestSnapshot(rows, options = {}) {
  const capturedAt = normalizeTimestamp(options.capturedAt || new Date().toISOString());
  const normalizedRows = rows.map(normalizeRow);
  const publicRows = normalizedRows.filter((row) => !row.isPrivate);
  const privateRows = normalizedRows.filter((row) => row.isPrivate);

  return {
    schema_version: 3,
    captured_at: capturedAt,
    source: {
      kind: 'folo_wa_sqlite_aggregate_snapshot',
      access: 'read_only',
      local_path_retained: false,
    },
    privacy: {
      output_mode: 'shareable_redacted',
      aggregate_only: true,
      private_titles_included: false,
      private_urls_included: false,
      public_titles_included: false,
      public_urls_included: false,
      source_names_included: false,
      custom_category_labels_included: false,
      private_category_labels_included: false,
      cookies_or_tokens_included: false,
      representative_sources_included: false,
    },
    counts: {
      total_subscriptions: normalizedRows.length,
      public_subscriptions: publicRows.length,
      private_subscriptions: privateRows.length,
      hidden_from_timeline: normalizedRows.filter((row) => row.hideFromTimeline).length,
      by_view: aggregateViews(normalizedRows),
    },
    categories: aggregateSafeCategories(normalizedRows),
    topics: aggregatePublicTopics(publicRows),
  };
}

export function sanitizeFeedURL(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return '<redacted-invalid-url>';
  }
  if (!['http:', 'https:', 'rsshub:'].includes(parsed.protocol)) return '<redacted-unsupported-scheme>';

  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const segments = parsed.pathname.split('/');
  let redactNext = false;
  parsed.pathname = segments.map((segment) => {
    if (!segment) return segment;
    const decoded = safelyDecode(segment);
    const lower = decoded.toLowerCase();
    if (redactNext || looksSensitivePathSegment(decoded)) {
      redactNext = false;
      return '<redacted>';
    }
    redactNext = SENSITIVE_PATH_PREFIXES.has(lower) || SENSITIVE_FIELD_PATTERN.test(lower);
    return encodeURIComponent(decoded).replaceAll('%3C', '<').replaceAll('%3E', '>');
  }).join('/');
  return parsed.toString().replaceAll('%3Credacted%3E', '<redacted>');
}

export function classifySourceFamily(value) {
  const input = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return 'other';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (parsed.protocol === 'rsshub:') {
    if (['twitter', 'x'].includes(host)) return 'x_twitter';
    if (host === 'bilibili') return 'bilibili';
    if (['telegram', 't.me'].includes(host)) return 'telegram';
    if (host === 'youtube') return 'youtube';
    return 'rsshub_other';
  }
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.xgo.ing')) return 'x_twitter';
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) return 'bilibili';
  if (host === 't.me' || host === 'telegram.org' || host.endsWith('.telegram.org')) return 'telegram';
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  return host || 'other';
}

function validateSnapshotPath(databasePath) {
  if (!databasePath || !isAbsolute(databasePath)) {
    throw new Error('Pass an explicit absolute path with --db; live Folo data is never discovered automatically.');
  }
  const safePath = realpathSync(databasePath);
  const stat = statSync(safePath);
  if (!stat.isFile()) throw new Error('The Folo snapshot path must be a regular file.');
  const descriptor = openSync(safePath, 'r');
  const header = Buffer.alloc(SQLITE_MAGIC.length);
  try {
    readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }
  if (!header.equals(SQLITE_MAGIC)) throw new Error('The Folo snapshot is not a SQLite database.');
  return safePath;
}

function normalizeRow(row) {
  const view = Number.isFinite(Number(row.view)) ? Number(row.view) : -1;
  const title = sanitizeTitle(row.title);
  const rawURL = String(row.url || '');
  return {
    view,
    isPrivate: Boolean(row.isPrivate),
    hideFromTimeline: Boolean(row.hideFromTimeline),
    title,
    url: sanitizeFeedURL(rawURL),
    siteURL: sanitizeFeedURL(row.siteURL),
    sourceFamily: classifySourceFamily(rawURL),
  };
}

function aggregateViews(rows) {
  const groups = new Map();
  for (const row of rows) {
    const definition = viewDefinition(row.view);
    const group = groups.get(row.view) || {
      view: row.view,
      key: definition.key,
      label: definition.label,
      total: 0,
      public: 0,
      private: 0,
      hidden_from_timeline: 0,
    };
    group.total += 1;
    group[row.isPrivate ? 'private' : 'public'] += 1;
    if (row.hideFromTimeline) group.hidden_from_timeline += 1;
    groups.set(row.view, group);
  }
  return [...groups.values()].sort((a, b) => a.view - b.view);
}

function aggregateSafeCategories(rows) {
  return aggregateViews(rows).map(({ key, label, total, public: publicCount, private: privateCount }) => ({
    key,
    label,
    total,
    public: publicCount,
    private: privateCount,
  }));
}

function aggregatePublicTopics(rows) {
  const topics = [];
  for (const rule of TOPIC_RULES) {
    const count = rows.filter((row) => rule.test({
      view: row.view,
      sourceFamily: row.sourceFamily,
      searchable: `${row.title} ${row.url} ${row.siteURL}`,
    })).length;
    if (count > 0) topics.push({ key: rule.key, label: rule.label, matched_public_subscriptions: count });
  }
  return topics.sort((a, b) => b.matched_public_subscriptions - a.matched_public_subscriptions || a.key.localeCompare(b.key));
}

function viewDefinition(view) {
  return VIEW_DEFINITIONS.get(view) || { key: `view_${view}`, label: `未知视图 ${view}` };
}

function sanitizeTitle(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function looksSensitivePathSegment(segment) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (segment.length < 32 || /[\s.]/.test(segment)) return false;
  const hasLower = /[a-z]/.test(segment);
  const hasUpper = /[A-Z]/.test(segment);
  const hasDigit = /\d/.test(segment);
  const hasSymbol = /[-_=]/.test(segment);
  return [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length >= 3;
}

function safelyDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --captured-at timestamp: ${value}`);
  return date.toISOString();
}

function sanitizeError(value) {
  return String(value)
    .replace(/(token|secret|password|authorization|cookie)[=: ]+\S+/gi, '$1=<redacted>')
    .replace(/[A-Za-z0-9_-]{48,}/g, '<redacted>')
    .trim()
    .slice(0, 400);
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') result.help = true;
    else if (flag === '--force') result.force = true;
    else if (flag === '--shareable' || flag === '--redacted') result.outputMode = 'shareable_redacted';
    else if (flag === '--db') result.databasePath = argv[++index];
    else if (flag === '--out') result.outputPath = argv[++index];
    else if (flag === '--captured-at') result.capturedAt = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/folo-interest-snapshot.mjs --db /absolute/path/to/follow.db [options]

Options:
  --out /absolute/path.json  Write mode-0600 JSON atomically (stdout by default)
  --shareable | --redacted  Explicitly select aggregate-only output (the default)
  --captured-at ISO_TIME     Override timestamp for deterministic evidence/tests
  --force                    Replace an existing --out file

The database is opened through sqlite3 -readonly. Output is always shareable and
aggregate-only: counts, predefined categories, and predefined topic counts. It never
contains subscription titles, URLs, source names, custom category labels, credentials,
cookies, tokens, or representative source records.`);
}

function writeSnapshot(outputPath, snapshot, force) {
  if (!isAbsolute(outputPath)) throw new Error('--out must be an explicit absolute path.');
  const target = resolve(outputPath);
  if (existsSync(target) && !force) throw new Error(`Refusing to replace existing output: ${basename(target)} (pass --force).`);
  const parent = dirname(target);
  if (!statSync(parent).isDirectory()) throw new Error('The --out parent must be an existing directory.');
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const rows = readFoloSubscriptions(args.databasePath);
  const snapshot = buildFoloInterestSnapshot(rows, {
    capturedAt: args.capturedAt,
  });
  if (args.outputPath) writeSnapshot(args.outputPath, snapshot, args.force);
  else process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Folo snapshot failed: ${sanitizeError(error?.message || error)}`);
    process.exitCode = 1;
  });
}
