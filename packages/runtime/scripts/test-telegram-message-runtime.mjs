import assert from 'node:assert/strict';
import {
  markdownToTelegramHTML,
  planTelegramMessage,
  postTelegramMessage,
} from '../src/telegram-message.ts';

const twentyImages = Array.from({ length: 20 }, (_, index) => (
  `![${index + 1}](https://images.example/${index + 1}.webp)`
)).join('\n');

const plan = planTelegramMessage([
  '# 首页封面',
  '',
  twentyImages,
  '',
  '```md',
  '![示例](https://images.example/not-real.jpg)',
  '```',
].join('\n'));
assert.equal(plan.images.length, 20);
assert.equal(plan.text.includes('![1]'), false);
assert.equal(plan.text.includes('![示例]'), true, 'image-looking code must stay code');
assert.equal(planTelegramMessage('![x](javascript:alert(1))').images.length, 0, 'non-HTTP image URLs must stay text');
assert.equal(
  planTelegramMessage(`${'长正文'.repeat(2_000)}\n![末尾图片](https://images.example/after-long-text.jpg)`).images.length,
  1,
  'media extraction must happen before Telegram text-length limiting',
);
assert.equal(markdownToTelegramHTML('![封面](https://images.example/cover.jpg)').startsWith('!'), false);

const calls = [];
const result = await postTelegramMessage({
  apiBaseURL: 'https://telegram.test',
  token: 'test-token',
  chatID: '1234567890',
  text: `**封面如下**\n\n${twentyImages}`,
  fetchImpl: async (url, init) => {
    const method = String(url).split('/').at(-1);
    const body = JSON.parse(String(init?.body || '{}'));
    calls.push({ method, body });
    if (method === 'sendMessage') {
      assert.equal(body.parse_mode, 'HTML');
      assert.equal(body.text, '<b>封面如下</b>');
      return telegramResponse(200, { ok: true, result: { message_id: 100 } });
    }
    assert.equal(method, 'sendMediaGroup');
    assert.equal(body.media.length, 10);
    assert.equal(body.media.every((item) => item.type === 'photo'), true);
    return telegramResponse(200, {
      ok: true,
      result: body.media.map((_, index) => ({ message_id: 200 + calls.length * 10 + index })),
    });
  },
});
assert.equal(result.ok, true);
assert.equal(result.textSent, true);
assert.equal(result.mediaCount, 20);
assert.equal(result.messageIDs.length, 21);
assert.deepEqual(calls.map((call) => call.method), ['sendMessage', 'sendMediaGroup', 'sendMediaGroup']);
assert.deepEqual(calls.slice(1).map((call) => call.body.media.length), [10, 10]);

const singleCalls = [];
const single = await postTelegramMessage({
  apiBaseURL: 'https://telegram.test',
  token: 'test-token',
  chatID: 1234567890,
  text: '![原图](https://images.example/original.webp)',
  fetchImpl: async (url, init) => {
    const method = String(url).split('/').at(-1);
    singleCalls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return telegramResponse(200, { ok: true, result: { message_id: 301 } });
  },
});
assert.equal(single.ok, true);
assert.equal(single.mediaCount, 1);
assert.deepEqual(singleCalls.map((call) => call.method), ['sendPhoto']);
assert.equal(singleCalls[0].body.photo, 'https://images.example/original.webp');
assert.equal(singleCalls[0].body.caption, '原图');

const fallbackCalls = [];
const fallback = await postTelegramMessage({
  apiBaseURL: 'https://telegram.test',
  token: 'test-token',
  chatID: 1234567890,
  text: '![一](https://images.example/one.jpg)\n![二](https://images.example/two.jpg)',
  fetchImpl: async (url) => {
    const method = String(url).split('/').at(-1);
    fallbackCalls.push(method);
    if (method === 'sendMediaGroup') {
      return telegramResponse(400, { ok: false, description: 'Bad Request: one media item is invalid' });
    }
    return telegramResponse(200, { ok: true, result: { message_id: 400 + fallbackCalls.length } });
  },
});
assert.equal(fallback.ok, true);
assert.equal(fallback.mediaCount, 2);
assert.deepEqual(fallbackCalls, ['sendMediaGroup', 'sendPhoto', 'sendPhoto']);

const ambiguousCalls = [];
const ambiguous = await postTelegramMessage({
  apiBaseURL: 'https://telegram.test',
  token: 'test-token',
  chatID: 1234567890,
  text: '![一](https://images.example/one.jpg)\n![二](https://images.example/two.jpg)',
  fetchImpl: async (url) => {
    ambiguousCalls.push(String(url).split('/').at(-1));
    return telegramResponse(500, { ok: false, description: 'Telegram unavailable' });
  },
});
assert.equal(ambiguous.ok, false);
assert.deepEqual(ambiguousCalls, ['sendMediaGroup'], 'ambiguous album outcomes must not be replayed');

console.log('telegram message runtime tests passed');

function telegramResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
