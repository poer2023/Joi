import assert from 'node:assert/strict';
import http from 'node:http';
import {
  fetchAvailableModels,
  isLoopbackModelEndpoint,
  LOCAL_MODEL_PROXY_API_KEY,
  openAICompatibleChatCompletionsEndpoint,
  openAICompatibleModelsEndpoint,
  testModelConnection,
} from '../src/model.ts';
import {
  sendTestTelegramMessage,
  telegramBotURL,
  testTelegramConnection,
} from '../src/telegram.ts';

const requests = [];
const server = http.createServer((req, res) => {
  const request = {
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization,
    contentType: req.headers['content-type'],
    body: '',
  };
  requests.push(request);
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    return;
  }
  if (req.url === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        {
          id: 'model-a',
          owned_by: 'tester',
          context_window: 128000,
          supported_parameters: ['tools', 'response_format'],
          pricing: { prompt: '0.000001', completion: '0.000002' },
        },
        { name: 'reasoner-b', supports_reasoning: true },
      ],
    }));
    return;
  }
  if (req.url === '/bottelegram-test/getMe' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { id: 42, username: 'joi_test_bot' } }));
    return;
  }
  if (req.url === '/bottelegram-fail/getMe' && req.method === 'GET') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    return;
  }
  if (req.url === '/bottelegram-test/sendMessage' && req.method === 'POST') {
    req.on('data', (chunk) => {
      request.body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: 7 } }));
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseURL = `http://127.0.0.1:${port}`;
const settings = {
  app_mode: 'desktop',
  version: 'test',
  data_store: 'sqlite',
  task_queue: 'sqlite',
  sqlite_path: '/tmp/joi.db',
  model_provider: 'openai_compatible',
  model_name: 'model-a',
  model_base_url: baseURL,
  telegram_enabled: false,
  worker_gateway: '',
  backup_dir: '/tmp/backups',
  docker_required: false,
};

try {
  assert.equal(openAICompatibleModelsEndpoint(`${baseURL}/v1`), `${baseURL}/v1/models`);
  assert.equal(openAICompatibleChatCompletionsEndpoint(`${baseURL}/v1/models`), `${baseURL}/v1/chat/completions`);
  assert.equal(isLoopbackModelEndpoint(`${baseURL}/v1`), true);
  assert.equal(isLoopbackModelEndpoint('http://localhost:8645/v1'), true);
  assert.equal(isLoopbackModelEndpoint('https://api.x.ai/v1'), false);
  assert.equal(telegramBotURL('telegram-test', 'getMe', `${baseURL}/`), `${baseURL}/bottelegram-test/getMe`);

  const missing = await testModelConnection(undefined, { ...settings, model_base_url: 'https://api.example.test/v1' }, () => '');
  assert.equal(missing.status, 'missing_api_key');

  requests.length = 0;
  let localResolverCalled = false;
  const localOK = await testModelConnection(undefined, settings, () => {
    localResolverCalled = true;
    return '';
  });
  assert.deepEqual(localOK, { ok: true, status: 'succeeded' });
  assert.equal(localResolverCalled, false);
  assert.equal(requests.at(-1).authorization, `Bearer ${LOCAL_MODEL_PROXY_API_KEY}`);

  const ok = await testModelConnection(
    { provider: 'openai_compatible', base_url: baseURL, name: 'model-a', api_key: 'sk-test' },
    settings,
    () => '',
  );
  assert.deepEqual(ok, { ok: true, status: 'succeeded' });
  assert.equal(requests.at(-1).authorization, 'Bearer sk-test');

  requests.length = 0;
  const listed = await fetchAvailableModels(undefined, settings, () => '');
  assert.equal(listed.ok, true);
  assert.equal(listed.available_models.length, 2);
  assert.equal(listed.available_models[0].id, 'model-a');
  assert.equal(listed.available_models[0].supports_tool_calling, true);
  assert.equal(listed.available_models[0].supports_json_mode, true);
  assert.equal(listed.available_models[0].input_price_per_1m, 1);
  assert.equal(listed.available_models[1].supports_reasoning, true);
  assert.ok(requests.every((request) => request.authorization === `Bearer ${LOCAL_MODEL_PROXY_API_KEY}`));

  const previous = process.env.ALLOW_MOCK_PROVIDER;
  process.env.ALLOW_MOCK_PROVIDER = 'false';
  const mockDisabled = await testModelConnection(
    { provider: 'mock_provider', base_url: '', name: 'mock-model' },
    { ...settings, model_provider: 'mock_provider', model_name: 'mock-model' },
    () => '',
  );
  assert.equal(mockDisabled.status, 'mock_disabled');
  if (previous === undefined) delete process.env.ALLOW_MOCK_PROVIDER;
  else process.env.ALLOW_MOCK_PROVIDER = previous;

  const telegramMissing = await testTelegramConnection();
  assert.equal(telegramMissing.status, 'missing_token');

  const telegramOK = await testTelegramConnection({ token: 'telegram-test', apiBaseURL: baseURL, timeoutSeconds: 1 });
  assert.deepEqual(telegramOK, { ok: true, status: 'succeeded' });

  const telegramNon2xx = await testTelegramConnection({ token: 'telegram-fail', apiBaseURL: baseURL, timeoutSeconds: 1 });
  assert.equal(telegramNon2xx.status, '401 Unauthorized');
  assert.equal(telegramNon2xx.error_summary, 'telegram getMe returned non-2xx');

  const missingChat = await sendTestTelegramMessage({ token: 'telegram-test', apiBaseURL: baseURL });
  assert.equal(missingChat.status, 'missing_chat_id');

  const telegramSent = await sendTestTelegramMessage({
    token: 'telegram-test',
    apiBaseURL: baseURL,
    allowedUserIDs: ' 12345,67890 ',
    message: 'hello from Joi',
    timeoutSeconds: 1,
  });
  assert.deepEqual(telegramSent, { ok: true, status: 'succeeded' });
  const sendRequest = requests.find((request) => request.url === '/bottelegram-test/sendMessage');
  assert.equal(sendRequest.contentType, 'application/x-www-form-urlencoded');
  const sentForm = new URLSearchParams(sendRequest.body);
  assert.equal(sentForm.get('chat_id'), '12345');
  assert.equal(sentForm.get('text'), 'hello from Joi');

  console.log('model runtime tests passed');
} finally {
  server.close();
}
