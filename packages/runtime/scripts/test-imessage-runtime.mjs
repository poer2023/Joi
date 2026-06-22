import assert from 'node:assert/strict';
import {
  PHOTON_DASHBOARD_TOKEN_SECRET,
  PHOTON_PROJECT_SECRET_SECRET,
  pollPhotonDeviceToken,
  requestPhotonDeviceCode,
  setupPhotonIMessage,
  testPhotonIMessageConnection,
} from '../src/imessage.ts';

const calls = [];
const saved = new Map();
let openedURL = '';

const code = await requestPhotonDeviceCode({ dashboardHost: 'https://app.photon.test', fetchImpl: fakeFetch });
assert.equal(code.device_code, 'device-123');
assert.equal(code.user_code, 'USER-123');

const token = await pollPhotonDeviceToken(code, {
  dashboardHost: 'https://app.photon.test',
  timeoutSeconds: 2,
  fetchImpl: fakeFetch,
});
assert.equal(token, 'dashboard-token');

const setup = await setupPhotonIMessage({
  phone_number: '+1 (555) 123-4567',
  project_name: 'Joi',
  dashboard_host: 'https://app.photon.test',
  spectrum_host: 'https://spectrum.photon.test',
  timeout_seconds: 2,
  fetchImpl: fakeFetch,
  openURL(url) {
    openedURL = url;
  },
  getSecret(name) {
    return saved.get(name) || '';
  },
  saveSecret(name, value) {
    saved.set(name, value);
  },
});

assert.equal(openedURL, 'https://app.photon.test/device?user_code=USER-123');
assert.equal(saved.get(PHOTON_DASHBOARD_TOKEN_SECRET), 'dashboard-token');
assert.equal(saved.get(PHOTON_PROJECT_SECRET_SECRET), 'project-secret-new');
assert.equal(setup.status, 'succeeded');
assert.equal(setup.project_id, 'project-123');
assert.equal(setup.operator_phone, '+15551234567');
assert.equal(setup.assigned_number, '+15550001111');
assert.equal(setup.project_created, false);
assert.equal(setup.user_created, true);

const ok = await testPhotonIMessageConnection({
  project_id: 'project-123',
  project_secret: 'project-secret-new',
  spectrum_host: 'https://spectrum.photon.test',
  fetchImpl: fakeFetch,
});
assert.equal(ok.ok, true);

assert.ok(calls.some((call) => call.url === 'https://app.photon.test/api/projects/project-123/regenerate-secret'));
assert.ok(calls.some((call) => call.url === 'https://spectrum.photon.test/projects/project-123/users/' && call.method === 'POST'));

console.log('imessage runtime tests passed');

async function fakeFetch(url, init = {}) {
  const method = init.method || 'GET';
  calls.push({ url: String(url), method });
  if (url === 'https://app.photon.test/api/auth/device/code') {
    return json({
      device_code: 'device-123',
      user_code: 'USER-123',
      verification_uri: 'https://app.photon.test/device',
      verification_uri_complete: 'https://app.photon.test/device?user_code=USER-123',
      expires_in: 30,
      interval: 0.01,
    });
  }
  if (url === 'https://app.photon.test/api/auth/device/token') {
    return json({ access_token: 'dashboard-token' });
  }
  if (url === 'https://app.photon.test/api/auth/get-session') {
    return json({ user: { id: 'user-dashboard' } });
  }
  if (url === 'https://app.photon.test/api/projects/' || url === 'https://app.photon.test/api/projects') {
    return json({ projects: [{ id: 'project-123', name: 'Joi' }] });
  }
  if (url === 'https://app.photon.test/api/projects/project-123/regenerate-secret') {
    return json({ projectSecret: 'project-secret-new' });
  }
  if (url === 'https://spectrum.photon.test/projects/project-123/users/' && method === 'GET') {
    return json({ users: [] });
  }
  if (url === 'https://spectrum.photon.test/projects/project-123/users/' && method === 'POST') {
    return json({ user: { id: 'spectrum-user', phoneNumber: '+15551234567', assignedPhoneNumber: '+15550001111' } });
  }
  if (url === 'https://app.photon.test/api/projects/project-123/lines') {
    return json({ lines: [{ platform: 'imessage', phoneNumber: '+15550001111' }] });
  }
  return json({ error: `unexpected ${method} ${url}` }, 404);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
