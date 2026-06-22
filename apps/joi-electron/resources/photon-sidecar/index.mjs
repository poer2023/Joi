import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';

const projectId = process.env.PHOTON_PROJECT_ID;
const projectSecret = process.env.PHOTON_PROJECT_SECRET;
const sharedToken = process.env.PHOTON_SIDECAR_TOKEN;
const port = Number(process.env.PHOTON_SIDECAR_PORT || 8790);
const bind = process.env.PHOTON_SIDECAR_BIND || '127.0.0.1';
const telemetry = /^(1|true|yes|on)$/i.test(String(process.env.PHOTON_TELEMETRY || '').trim());
const maxInlineAttachmentBytes = Number(process.env.PHOTON_MAX_INLINE_ATTACHMENT_BYTES || 20 * 1024 * 1024);
const maxBodyBytes = 2 * 1024 * 1024;
const maxKnownSpaces = 2048;
const maxKnownMessages = 1024;
const e164Pattern = /^\+\d{6,}$/;
const dmSpacePattern = /^any;-;(\+\d{6,})$/;

if (!projectId || !projectSecret || !sharedToken) {
  console.error('photon-sidecar: PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET and PHOTON_SIDECAR_TOKEN are required');
  process.exit(2);
}

let Spectrum;
let imessage;
let attachment;
let voice;
let spectrumText;
let spectrumMarkdown;
let spectrumTyping;

try {
  ({
    Spectrum,
    attachment,
    voice,
    text: spectrumText,
    markdown: spectrumMarkdown,
    typing: spectrumTyping,
  } = await import('spectrum-ts'));
  ({ imessage } = await import('spectrum-ts/providers/imessage'));
} catch (error) {
  console.error(`photon-sidecar: spectrum-ts is not installed or failed to load: ${stack(error)}`);
  process.exit(3);
}

const app = await Spectrum({
  projectId,
  projectSecret,
  providers: [imessage.config()],
  options: { flattenGroups: true },
  telemetry,
});

let consumerRes = null;
let consumerWaiters = [];
const knownSpaces = new Map();
const knownMessages = new Map();

function lruSet(map, key, value, cap) {
  if (!key || !value) return;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function rememberKnownSpace(id, space) {
  if (typeof id !== 'string' || !id || !space) return;
  lruSet(knownSpaces, id, space, maxKnownSpaces);
}

function rememberKnownMessage(message) {
  if (!message?.id || typeof message.id !== 'string') return;
  lruSet(knownMessages, message.id, message, maxKnownMessages);
}

function phoneTargetFromSpaceId(spaceId) {
  if (typeof spaceId !== 'string') return null;
  if (e164Pattern.test(spaceId)) return spaceId;
  const match = spaceId.match(dmSpacePattern);
  return match ? match[1] : null;
}

function rememberInboundSpace(space, message) {
  const msgSpace = message?.space || {};
  for (const id of [space?.id, msgSpace.id]) {
    rememberKnownSpace(id, space);
    const phone = phoneTargetFromSpaceId(id);
    if (phone) rememberKnownSpace(phone, space);
  }
}

function waitForConsumer() {
  if (consumerRes) return Promise.resolve();
  return new Promise((resolve) => consumerWaiters.push(resolve));
}

function setConsumer(res) {
  consumerRes = res;
  const waiters = consumerWaiters;
  consumerWaiters = [];
  for (const resolve of waiters) resolve();
}

function clearConsumer(res) {
  if (consumerRes === res) consumerRes = null;
}

async function deliver(line) {
  for (;;) {
    await waitForConsumer();
    const res = consumerRes;
    if (!res) continue;
    try {
      const flushed = res.write(`${line}\n`);
      if (!flushed) await once(res, 'drain');
      return;
    } catch {
      clearConsumer(res);
    }
  }
}

async function normalizeBinaryContent(content) {
  const meta = {
    type: content.type,
    id: content.id ?? null,
    name: content.name ?? null,
    mimeType: content.mimeType ?? null,
    size: typeof content.size === 'number' ? content.size : null,
  };
  if (content.type === 'voice' && typeof content.duration === 'number') {
    meta.duration = content.duration;
  }
  if (meta.size !== null && meta.size > maxInlineAttachmentBytes) return meta;
  if (typeof content.read === 'function') {
    try {
      const bytes = await content.read();
      if (bytes && bytes.length <= maxInlineAttachmentBytes) {
        meta.data = Buffer.from(bytes).toString('base64');
        meta.encoding = 'base64';
      }
    } catch (error) {
      console.error(`photon-sidecar: attachment read failed: ${message(error)}`);
    }
  }
  return meta;
}

async function normalizeContent(content) {
  if (!content || typeof content !== 'object') return { type: 'unknown' };
  if (content.type === 'text') return { type: 'text', text: content.text || '' };
  if (content.type === 'attachment' || content.type === 'voice') return normalizeBinaryContent(content);
  if (content.type === 'group') {
    const items = [];
    for (const item of Array.isArray(content.items) ? content.items : []) {
      items.push({
        id: item?.id ?? null,
        content: await normalizeContent(item?.content),
      });
    }
    return { type: 'group', items };
  }
  if (content.type === 'reaction') {
    return {
      type: 'reaction',
      emoji: content.emoji || '',
      targetMessageId: content.target?.id ?? null,
      targetDirection: content.target?.direction ?? null,
    };
  }
  return { type: content.type || 'unknown' };
}

async function normalizeEvent(space, messageObj) {
  try {
    const msgSpace = messageObj.space || {};
    const timestamp = messageObj.timestamp;
    return {
      messageId: messageObj.id ?? null,
      platform: messageObj.platform || space.__platform || 'iMessage',
      direction: messageObj.direction || null,
      space: {
        id: space.id ?? msgSpace.id ?? null,
        type: space.type ?? msgSpace.type ?? 'dm',
        phone: space.phone ?? msgSpace.phone ?? null,
      },
      sender: { id: messageObj.sender ? messageObj.sender.id : null },
      content: await normalizeContent(messageObj.content),
      timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp ? String(timestamp) : null,
    };
  } catch (error) {
    console.error(`photon-sidecar: event normalize failed: ${stack(error)}`);
    return null;
  }
}

(async () => {
  let backoff = 1000;
  for (;;) {
    try {
      for await (const [space, messageObj] of app.messages) {
        backoff = 1000;
        if (messageObj?.direction && messageObj.direction !== 'inbound') continue;
        rememberInboundSpace(space, messageObj);
        rememberKnownMessage(messageObj);
        const event = await normalizeEvent(space, messageObj);
        if (event) await deliver(JSON.stringify(event));
      }
      console.error('photon-sidecar: inbound stream ended; resubscribing');
    } catch (error) {
      console.error(`photon-sidecar: inbound stream failed; resubscribing: ${message(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, backoff + Math.random() * backoff * 0.2));
    backoff = Math.min(backoff * 2, 30000);
  }
})();

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      req.destroy();
      throw new Error('request body too large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function tokenOk(header) {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(sharedToken);
  const actual = Buffer.from(header);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sendJSON(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function handleInbound(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  if (consumerRes && consumerRes !== res) {
    try {
      consumerRes.end();
    } catch {
      // ignore
    }
  }
  setConsumer(res);
  const heartbeat = setInterval(() => {
    try {
      res.write('\n');
    } catch {
      // ignore
    }
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    clearConsumer(res);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('error', cleanup);
}

async function resolveSpace(spaceId) {
  const cached = knownSpaces.get(spaceId);
  if (cached) return cached;
  const im = imessage(app);
  const phoneTarget = phoneTargetFromSpaceId(spaceId);
  let space = null;
  if (phoneTarget) {
    try {
      space = await im.space.create(phoneTarget);
    } catch (error) {
      console.error(`photon-sidecar: phone DM create failed: ${message(error)}`);
    }
  }
  if (!space) {
    try {
      space = await im.space.get(spaceId);
    } catch (error) {
      console.error(`photon-sidecar: space.get failed: ${message(error)}`);
    }
  }
  if (!space) throw new Error(`unable to resolve space ${spaceId}`);
  rememberKnownSpace(spaceId, space);
  if (phoneTarget) rememberKnownSpace(phoneTarget, space);
  rememberKnownSpace(space.id, space);
  return space;
}

const server = http.createServer(async (req, res) => {
  if (!tokenOk(req.headers['x-joi-sidecar-token'])) {
    return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
  }
  if (req.method === 'GET' && req.url === '/inbound') {
    return handleInbound(req, res);
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  try {
    if (req.url === '/healthz') {
      return sendJSON(res, 200, { ok: true });
    }
    if (req.url === '/shutdown') {
      sendJSON(res, 200, { ok: true });
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
      return;
    }
    const body = await readBody(req);
    if (req.url === '/send') {
      const { spaceId, text, format = 'markdown' } = body || {};
      if (!spaceId || typeof text !== 'string') return sendJSON(res, 400, { ok: false, error: 'spaceId and text are required' });
      const space = await resolveSpace(spaceId);
      const builder = format === 'markdown' ? spectrumMarkdown(text) : spectrumText(text);
      const result = await space.send(builder);
      return sendJSON(res, 200, { ok: true, messageId: result?.id || null });
    }
    if (req.url === '/send-attachment') {
      const { spaceId, path, name, mimeType, caption, kind } = body || {};
      if (!spaceId || typeof path !== 'string' || !path) return sendJSON(res, 400, { ok: false, error: 'spaceId and path are required' });
      const space = await resolveSpace(spaceId);
      const opts = {};
      if (name) opts.name = name;
      if (mimeType) opts.mimeType = mimeType;
      const builder = kind === 'voice'
        ? voice(path, Object.keys(opts).length ? opts : undefined)
        : attachment(path, Object.keys(opts).length ? opts : undefined);
      const result = await space.send(builder);
      if (caption && typeof caption === 'string') {
        await space.send(spectrumText(caption));
      }
      return sendJSON(res, 200, { ok: true, messageId: result?.id || null });
    }
    if (req.url === '/typing') {
      const { spaceId, state = 'start' } = body || {};
      if (!spaceId) return sendJSON(res, 400, { ok: false, error: 'spaceId is required' });
      if (state !== 'start' && state !== 'stop') return sendJSON(res, 400, { ok: false, error: 'state must be start or stop' });
      const space = await resolveSpace(spaceId);
      await space.send(spectrumTyping(state));
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    console.error(`photon-sidecar: request failed: ${stack(error)}`);
    return sendJSON(res, 500, { ok: false, error: 'internal sidecar error' });
  }
});

server.listen(port, bind, () => {
  console.error(`photon-sidecar: listening on ${bind}:${port}`);
});

let stopping = false;
async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  console.error(`photon-sidecar: stopping: ${reason}`);
  try {
    await Promise.race([app.stop(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (error) {
    console.error(`photon-sidecar: app.stop failed: ${message(error)}`);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (process.env.PHOTON_SIDECAR_WATCH_STDIN === '1') {
  process.stdin.resume();
  process.stdin.on('end', () => shutdown('stdin EOF'));
  process.stdin.on('error', () => shutdown('stdin error'));
}

process.on('unhandledRejection', (reason) => {
  console.error(`photon-sidecar: unhandledRejection: ${stack(reason)}`);
});

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function stack(error) {
  return error instanceof Error && error.stack ? error.stack : String(error);
}
