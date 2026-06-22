import type { ConnectionTest, PhotonIMessageSetupResult } from '../../shared-types/src/desktop-api';

export const PHOTON_DASHBOARD_TOKEN_SECRET = 'PHOTON_DASHBOARD_TOKEN';
export const PHOTON_PROJECT_SECRET_SECRET = 'PHOTON_PROJECT_SECRET';
export const DEFAULT_PHOTON_DASHBOARD_HOST = 'https://app.photon.codes';
export const DEFAULT_PHOTON_SPECTRUM_HOST = 'https://spectrum.photon.codes';
export const DEFAULT_PHOTON_CLIENT_ID = 'photon-cli';
export const DEFAULT_PHOTON_SCOPE = 'openid profile email';
export const DEFAULT_PHOTON_PROJECT_NAME = 'Joi';

export type PhotonDeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type PhotonSetupOptions = {
  phone_number?: string;
  project_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  timeout_seconds?: number;
  dashboard_host?: string;
  spectrum_host?: string;
  fetchImpl?: typeof fetch;
  openURL?: (url: string) => Promise<void> | void;
  getSecret?: (name: string) => Promise<string> | string;
  saveSecret?: (name: string, value: string) => Promise<void> | void;
  onDeviceCode?: (code: PhotonDeviceCode) => Promise<void> | void;
};

export type PhotonConnectionOptions = {
  project_id?: string;
  project_secret?: string;
  spectrum_host?: string;
  fetchImpl?: typeof fetch;
};

type PhotonProject = {
  id?: string;
  name?: string;
};

type PhotonUser = {
  id?: string;
  phoneNumber?: string;
  assignedPhoneNumber?: string;
};

type JsonRecord = Record<string, unknown>;

const defaultDevicePollIntervalSeconds = 5;
const defaultDevicePollTimeoutSeconds = 1800;
const e164Pattern = /^\+[1-9]\d{6,14}$/;

export async function setupPhotonIMessage(options: PhotonSetupOptions = {}): Promise<PhotonIMessageSetupResult> {
  const fetcher = options.fetchImpl || fetch;
  const dashboardHost = cleanHost(options.dashboard_host || process.env.PHOTON_DASHBOARD_HOST || DEFAULT_PHOTON_DASHBOARD_HOST);
  const spectrumHost = cleanHost(options.spectrum_host || process.env.PHOTON_SPECTRUM_HOST || DEFAULT_PHOTON_SPECTRUM_HOST);
  const projectName = options.project_name?.trim() || DEFAULT_PHOTON_PROJECT_NAME;
  const phoneNumber = normalizePhone(options.phone_number || '');
  if (!phoneNumber) {
    throw new Error('phone_number must be E.164, for example +15551234567');
  }

  let dashboardToken = await maybeGetSecret(options.getSecret, PHOTON_DASHBOARD_TOKEN_SECRET);
  if (!dashboardToken) {
    const code = await requestPhotonDeviceCode({ dashboardHost, fetchImpl: fetcher });
    await options.onDeviceCode?.(code);
    const target = code.verification_uri_complete || code.verification_uri;
    if (target && options.openURL) {
      await options.openURL(target);
    }
    dashboardToken = await pollPhotonDeviceToken(code, {
      dashboardHost,
      timeoutSeconds: options.timeout_seconds,
      fetchImpl: fetcher,
    });
    await validatePhotonDashboardToken(dashboardToken, { dashboardHost, fetchImpl: fetcher });
    await options.saveSecret?.(PHOTON_DASHBOARD_TOKEN_SECRET, dashboardToken);
  } else {
    await validatePhotonDashboardToken(dashboardToken, { dashboardHost, fetchImpl: fetcher });
  }

  const existing = await findPhotonProjectByName(dashboardToken, projectName, { dashboardHost, fetchImpl: fetcher });
  const projectCreated = !existing;
  const project = existing || await createPhotonProject(dashboardToken, projectName, { dashboardHost, fetchImpl: fetcher });
  const projectID = project.id?.trim();
  if (!projectID) throw new Error('Photon did not return a project id');

  const projectSecret = await regeneratePhotonProjectSecret(dashboardToken, projectID, { dashboardHost, fetchImpl: fetcher });
  await options.saveSecret?.(PHOTON_PROJECT_SECRET_SECRET, projectSecret);

  const existingUser = await findPhotonUserByPhone(projectID, projectSecret, phoneNumber, { spectrumHost, fetchImpl: fetcher });
  const userCreated = !existingUser;
  const user = existingUser || await createPhotonUser(projectID, projectSecret, {
    phoneNumber,
    firstName: options.first_name,
    lastName: options.last_name,
    email: options.email,
    spectrumHost,
    fetchImpl: fetcher,
  });

  let assignedNumber = user.assignedPhoneNumber;
  if (!assignedNumber) {
    const line = await getPhotonIMessageLine(dashboardToken, projectID, { dashboardHost, fetchImpl: fetcher }).catch(() => null);
    assignedNumber = stringField(line, 'phoneNumber') || undefined;
  }

  return {
    status: 'succeeded',
    project_id: projectID,
    operator_phone: phoneNumber,
    assigned_number: assignedNumber,
    project_created: projectCreated,
    user_created: userCreated,
  };
}

export async function testPhotonIMessageConnection(options: PhotonConnectionOptions = {}): Promise<ConnectionTest> {
  const projectID = options.project_id?.trim() || '';
  const projectSecret = options.project_secret?.trim() || '';
  if (!projectID || !projectSecret) {
    return { ok: false, status: 'missing_credentials', error_summary: 'PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are not configured' };
  }
  try {
    await listPhotonUsers(projectID, projectSecret, {
      spectrumHost: cleanHost(options.spectrum_host || process.env.PHOTON_SPECTRUM_HOST || DEFAULT_PHOTON_SPECTRUM_HOST),
      fetchImpl: options.fetchImpl || fetch,
    });
    return { ok: true, status: 'succeeded' };
  } catch (error) {
    return { ok: false, status: 'failed', error_summary: safeErrorMessage(error) };
  }
}

export async function requestPhotonDeviceCode(options: {
  dashboardHost?: string;
  clientID?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonDeviceCode> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: options.clientID || DEFAULT_PHOTON_CLIENT_ID,
      scope: options.scope || DEFAULT_PHOTON_SCOPE,
    }),
  });
  const data = await expectJSON<JsonRecord>(response, 'Photon device-code request');
  return {
    device_code: requiredString(data, 'device_code'),
    user_code: requiredString(data, 'user_code'),
    verification_uri: requiredString(data, 'verification_uri'),
    verification_uri_complete: stringField(data, 'verification_uri_complete') || undefined,
    expires_in: Number(data.expires_in || defaultDevicePollTimeoutSeconds),
    interval: Number(data.interval || defaultDevicePollIntervalSeconds),
  };
}

export async function pollPhotonDeviceToken(code: PhotonDeviceCode, options: {
  dashboardHost?: string;
  clientID?: string;
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
} = {}): Promise<string> {
  const fetcher = options.fetchImpl || fetch;
  const endpoint = `${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/auth/device/token`;
  const deadline = Date.now() + Math.max(1, options.timeoutSeconds || code.expires_in || defaultDevicePollTimeoutSeconds) * 1000;
  let intervalSeconds = Math.max(1, code.interval || defaultDevicePollIntervalSeconds);
  while (Date.now() < deadline) {
    await sleep(intervalSeconds * 1000);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code,
        client_id: options.clientID || DEFAULT_PHOTON_CLIENT_ID,
      }),
    });
    if (response.status === 200) {
      const data = await response.json().catch(() => ({})) as JsonRecord;
      const token = photonTokenFromBody(data, response.headers);
      if (!token) throw new Error('Photon device-token response did not include an access token');
      return token;
    }
    if (response.status === 429) {
      intervalSeconds += 10;
      continue;
    }
    if (response.status === 400) {
      const data = await response.json().catch(() => ({})) as JsonRecord;
      const error = String(data.error || data.message || '');
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      throw new Error(`Photon login failed: ${error || response.statusText || response.status}`);
    }
    throw new Error(`Photon device-token request failed: ${response.status} ${response.statusText}`);
  }
  throw new Error('Photon device login timed out');
}

export async function validatePhotonDashboardToken(token: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const fetcher = options.fetchImpl || fetch;
  const host = cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST);
  await expectOK(await fetcher(`${host}/api/auth/get-session`, { headers: bearer(token) }), 'Photon session validation');
  await expectOK(await fetcher(`${host}/api/projects/`, { headers: bearer(token) }), 'Photon project validation');
}

export async function listPhotonProjects(token: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonProject[]> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/projects`, {
    headers: bearer(token),
  });
  return unwrapList(await expectJSON<unknown>(response, 'Photon list projects')) as PhotonProject[];
}

export async function findPhotonProjectByName(token: string, name: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonProject | null> {
  const target = name.trim().toLowerCase();
  const projects = await listPhotonProjects(token, options);
  return projects.find((project) => (project.name || '').trim().toLowerCase() === target) || null;
}

export async function createPhotonProject(token: string, name: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonProject> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/projects`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      location: 'United States',
      template: false,
      observability: false,
    }),
  });
  const data = await expectJSON<JsonRecord>(response, 'Photon create project');
  return data as PhotonProject;
}

export async function regeneratePhotonProjectSecret(token: string, projectID: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<string> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/projects/${encodeURIComponent(projectID)}/regenerate-secret`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await expectJSON<JsonRecord>(response, 'Photon regenerate project secret');
  const secret = stringField(data, 'projectSecret');
  if (!secret) throw new Error('Photon regenerate-secret returned no projectSecret');
  return secret;
}

export async function listPhotonUsers(projectID: string, projectSecret: string, options: {
  spectrumHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonUser[]> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.spectrumHost || DEFAULT_PHOTON_SPECTRUM_HOST)}/projects/${encodeURIComponent(projectID)}/users/`, {
    headers: basic(projectID, projectSecret),
  });
  return unwrapList(await expectJSON<unknown>(response, 'Photon list users')) as PhotonUser[];
}

export async function findPhotonUserByPhone(projectID: string, projectSecret: string, phoneNumber: string, options: {
  spectrumHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<PhotonUser | null> {
  const target = normalizePhone(phoneNumber);
  const users = await listPhotonUsers(projectID, projectSecret, options);
  return users.find((user) => normalizePhone(user.phoneNumber || '') === target) || null;
}

export async function createPhotonUser(projectID: string, projectSecret: string, options: {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  spectrumHost?: string;
  fetchImpl?: typeof fetch;
}): Promise<PhotonUser> {
  const fetcher = options.fetchImpl || fetch;
  const phoneNumber = normalizePhone(options.phoneNumber);
  if (!phoneNumber) {
    throw new Error('phoneNumber must be E.164, for example +15551234567');
  }
  const body: JsonRecord = {
    type: 'shared',
    phoneNumber,
  };
  if (options.firstName?.trim()) body.firstName = options.firstName.trim();
  if (options.lastName?.trim()) body.lastName = options.lastName.trim();
  if (options.email?.trim()) body.email = options.email.trim();
  const response = await fetcher(`${cleanHost(options.spectrumHost || DEFAULT_PHOTON_SPECTRUM_HOST)}/projects/${encodeURIComponent(projectID)}/users/`, {
    method: 'POST',
    headers: { ...basic(projectID, projectSecret), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await expectJSON<JsonRecord>(response, 'Photon create user');
  const user = objectField(data, 'user') || objectField(data, 'data') || data;
  return user as PhotonUser;
}

export async function getPhotonIMessageLine(token: string, projectID: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<JsonRecord | null> {
  const lines = await listPhotonLines(token, projectID, options);
  const existing = lines.find((line) => String(line.platform || '').toLowerCase() === 'imessage');
  if (existing) return existing;
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/projects/${encodeURIComponent(projectID)}/lines`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'imessage' }),
  });
  const data = await expectJSON<JsonRecord>(response, 'Photon create iMessage line');
  return objectField(data, 'line') || data;
}

async function listPhotonLines(token: string, projectID: string, options: {
  dashboardHost?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<JsonRecord[]> {
  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher(`${cleanHost(options.dashboardHost || DEFAULT_PHOTON_DASHBOARD_HOST)}/api/projects/${encodeURIComponent(projectID)}/lines`, {
    headers: bearer(token),
  });
  return unwrapList(await expectJSON<unknown>(response, 'Photon list iMessage lines')) as JsonRecord[];
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function basic(projectID: string, projectSecret: string): HeadersInit {
  return { Authorization: `Basic ${Buffer.from(`${projectID}:${projectSecret}`).toString('base64')}` };
}

function photonTokenFromBody(body: JsonRecord, headers: Headers): string {
  const candidates = [
    body.access_token,
    body.accessToken,
    objectField(body, 'session')?.access_token,
    objectField(body, 'data')?.access_token,
    objectField(body, 'data')?.accessToken,
    headers.get('set-auth-token'),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const clean = candidate.trim().replace(/^bearer\s+/i, '').trim();
    if (clean) return clean;
  }
  return '';
}

function normalizePhone(value: string): string {
  const normalized = value.replace(/[^\d+]/g, '');
  return e164Pattern.test(normalized) ? normalized : '';
}

function cleanHost(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function maybeGetSecret(getSecret: PhotonSetupOptions['getSecret'], name: string): Promise<string> {
  if (!getSecret) return '';
  return String(await getSecret(name) || '').trim();
}

async function expectOK(response: Response, action: string): Promise<void> {
  if (response.ok) {
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return;
  }
  throw new Error(`${action} failed: ${response.status} ${await responseErrorDetail(response)}`);
}

async function expectJSON<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${action} failed: ${response.status} ${await responseErrorDetail(response)}`);
  }
  return await response.json() as T;
}

async function responseErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText || 'no response body';
  try {
    const data = JSON.parse(text) as JsonRecord;
    return String(data.error || data.message || data.detail || text).slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

function unwrapList(data: unknown): JsonRecord[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  for (const key of ['data', 'projects', 'users', 'lines', 'items']) {
    const inner = data[key];
    if (Array.isArray(inner)) return inner.filter(isRecord);
    if (isRecord(inner)) {
      for (const nested of ['projects', 'users', 'lines', 'items']) {
        const nestedInner = inner[nested];
        if (Array.isArray(nestedInner)) return nestedInner.filter(isRecord);
      }
    }
  }
  return [];
}

function objectField(value: JsonRecord, key: string): JsonRecord | null {
  const field = value[key];
  return isRecord(field) ? field : null;
}

function stringField(value: JsonRecord | null, key: string): string {
  if (!value) return '';
  const field = value[key];
  return typeof field === 'string' ? field.trim() : '';
}

function requiredString(value: JsonRecord, key: string): string {
  const field = stringField(value, key);
  if (!field) throw new Error(`Photon response missing ${key}`);
  return field;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
